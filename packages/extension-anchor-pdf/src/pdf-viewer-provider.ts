/*
 * Copyright 2021 Mathematic Inc
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * ---------------------------------------------------------------------------
 * 本文件已被 anchor-explain 修改（Apache-2.0 §4(b) 要求的显著声明）。
 * 改动逐条见 MODIFICATIONS.md：
 *   1. `viewType` 由 "pdf.view" 改为 "anchorPdf.view"（避免与上游扩展抢同一个视图类型）
 *   2. 读取配置的命名空间由 "pdf" 改为 "anchorPdf"
 *   3. **S5**：多注入一个 `media/anchor-select.js`（框选 overlay，见该文件顶部的分工说明），
 *      并处理它发回来的消息（`CONTRACTS` §5.2）。注入方式是**多插一个 script 标签**，
 *      且它必须排在上游脚本**之前**（D73：`acquireVsCodeApi()` 一个 webview 只能成功取一次，
 *      要先拿到实例才能共享给 pdf.js）—— `assets/pdf.js/` 一个字都没动，
 *      所以将来升级 pdf.js 不用重做这件事。
 *   4. **S6**：把框选结果交给线1 讲解（`anchorExplain.explainAnchor`），
 *      并接受线1 的 `anchorPdf.revealPage` 请求（滚动，不是画框）。
 *   5. 上面的版权声明之后追加了本段
 * ---------------------------------------------------------------------------
 */

import { createHash } from "node:crypto";
import { join } from "node:path";

import {
  type CustomReadonlyEditorProvider,
  commands,
  type Disposable,
  type ExtensionContext,
  extensions,
  Uri,
  type Webview,
  type WebviewPanel,
  window,
  workspace,
} from "vscode";

import { basenameOf, samePath } from "@anchor/core";
import rawViewerHtml from "../assets/pdf.js/web/viewer.html";
import { parseSelectMessage } from "./anchor/bridge";
import type { HostToSelect, SelectToHost } from "./anchor/bridge";
import { buildPdfAnchor, describePdfAnchor } from "./anchor/captureAnchor";
import { resolveSelection } from "./anchor/rectToNormalizedBBox";
import { disposeAll } from "./disposable";
import { PDFDocument } from "./pdf-document";
import { escapeAttribute } from "./utils";
import { WebviewCollection } from "./webview-collection";

const viewerHtml = rawViewerHtml
  .replace(
    /* html */
    `<link rel="resource" type="application/l10n" href="locale/locale.json" />`,
    "",
  )
  .replace(/* html */ `<script src="../build/pdf.mjs" type="module"></script>`, "")
  .replace(/* html */ `<script src="viewer.mjs" type="module"></script>`, "")
  .replace(/* html */ `<link rel="stylesheet" href="viewer.css" />`, "");

const resourcePathRegex = /\/[^/]+?\.\w+$/u;

/** 线1 的扩展 ID。`CONTRACTS` §5.1 要求对端缺失时**明确提示，不静默失败**。 */
const PEER_EXTENSION_ID = "anchor.anchor-explain";
const PEER_MISSING_MESSAGE =
  "Anchor：没有安装线1（anchor.anchor-explain）扩展，框选结果无处可交。请先安装它。";

/**
 * 按下框选但页面还没握上手时的两句话（D73）。
 *
 * @anchor 为什么非要说话：这类"页面里的脚本没跑起来"的故障，**宿主这边一点异常都看不到** ——
 *         没有报错、没有日志，用户看到的就是"按了没反应"。上一版在这里是彻底静默，
 *         于是框选坏了一整轮都没人知道。第一句是解释（页面还在加载），
 *         第二句是结论（一直没回应），都带下一步能做什么。
 */
const SELECT_LOADING_MESSAGE = "Anchor：PDF 页面还在加载，加载完会自动进入框选模式。";
const SELECT_NO_RESPONSE_MESSAGE =
  "Anchor：这份 PDF 页面一直没有回应框选脚本。可以把它关掉重新打开；若仍然如此，请在「帮助 → 切换开发人员工具」的 Console 里看报错。";

function extAInstalled(): boolean {
  return extensions.getExtension(PEER_EXTENSION_ID) !== undefined;
}

/**
 * 文档指纹（内容哈希），用于 `Anchor.sourceId`。
 *
 * 取不到（文件被删/无权限）返回 null，让 `buildPdfAnchor` 退化成路径 ——
 * 与线1 的 `documentTextHash` 同一条理由：没有指纹只损失会话记忆，不该把框选打断。
 * 这里不复用线1 的端口，是因为两个扩展各自独立安装，线2 不该依赖线1 的代码。
 */
async function documentFingerprint(uri: Uri): Promise<string | null> {
  try {
    const bytes = await workspace.fs.readFile(uri);
    return createHash("sha1").update(bytes).digest("hex");
  } catch {
    return null;
  }
}

function withTrailingSlash(uri: Uri): string {
  const value = uri.toString();
  return value.endsWith("/") ? value : `${value}/`;
}

export class PDFViewerProvider implements CustomReadonlyEditorProvider {
  static readonly viewType = "anchorPdf.view";

  static register(context: ExtensionContext) {
    const provider = new PDFViewerProvider(context);
    // 记下实例：两个静态入口（`selectRegion` / `revealPage`）要靠它找到活着的面板。
    // 一个扩展只会注册一次 provider，所以这里不需要处理"多个实例"。
    PDFViewerProvider.current = provider;
    return window.registerCustomEditorProvider(PDFViewerProvider.viewType, provider, {
      supportsMultipleEditorsPerDocument: false,
    });
  }

  /** Tracks all known webviews */
  private readonly webviews = new WebviewCollection();

  private readonly extensionRoot: Uri;

  /**
   * 已经握过手（发过 `anchor:ready`）的 webview。
   *
   * @anchor 为什么需要它：用户点了「框选」时，页面可能**还没加载完**，
   *         这时 `enterSelectMode` 发出去就石沉大海（脚本还没注册监听器）。
   *         所以宿主记着"哪些面板还没准备好"，等它 ready 了补发一次。
   *         没有这道握手，表现是"第一次点框选没反应，再点一次才行"。
   */
  private readonly readyPanels = new WeakSet<WebviewPanel>();

  /** 记着"这个面板的框选是用户点名要的"，好在 ready 之后补发 */
  private readonly pendingSelect = new WeakSet<WebviewPanel>();

  constructor(context: ExtensionContext) {
    this.extensionRoot = Uri.file(context.extensionPath);
  }

  openCustomDocument(uri: Uri) {
    const document = new PDFDocument(uri);

    const listeners: Disposable[] = [];

    listeners.push(
      document.onDidChange((e) => {
        // Update all webviews when the document changes
        for (const webviewPanel of this.webviews.get(e)) {
          webviewPanel.webview.postMessage({ action: "reload" });
        }
      }),
    );

    document.onDidDelete(() => disposeAll(listeners));

    return document;
  }

  private UriResolver(webview: Webview) {
    return (...paths: string[]): Uri =>
      webview.asWebviewUri(Uri.file(join(this.extensionRoot.path, ...paths)));
  }

  resolveCustomEditor(document: PDFDocument, webviewPanel: WebviewPanel): void {
    // Add the webview to our internal set of active webviews
    this.webviews.add(document.uri, webviewPanel);

    // S5/S6：宿主自己再记一份（上游那个集合只有"按文档找面板"这一个方向）
    this.panels.set(webviewPanel, document.uri);
    this.focused = webviewPanel;
    webviewPanel.onDidDispose(() => {
      this.panels.delete(webviewPanel);
      if (this.focused === webviewPanel) this.focused = undefined;
    });
    // 同时开两份 PDF 时，"框选"该作用在他刚才看的那一份上
    webviewPanel.onDidChangeViewState((event) => {
      if (event.webviewPanel.active) this.focused = event.webviewPanel;
    });

    // Setup initial content for the webview
    const resourceRoot = document.uri.with({
      path: document.uri.path.replace(resourcePathRegex, "/"),
    });
    const webviewResourceRoot = withTrailingSlash(webviewPanel.webview.asWebviewUri(resourceRoot));
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [resourceRoot, this.extensionRoot],
    };

    webviewPanel.webview.html = this.getHtmlForWebview(
      document,
      webviewPanel.webview,
      resourceRoot,
    );

    webviewPanel.webview.onDidReceiveMessage(async (message: unknown) => {
      // S5/S6 的框选消息先过一遍守卫（§5.2）。它和下面那条上游的 `{open}` 消息
      // 各自看各自的字段，互不干扰。
      const select = parseSelectMessage(message);
      if (select) {
        await this.handleSelectMessage(select, document, webviewPanel);
        return;
      }

      if (
        typeof message !== "object" ||
        message === null ||
        !("open" in message) ||
        typeof message.open !== "string"
      ) {
        return;
      }

      try {
        const resourceRootUrl = new URL(webviewResourceRoot);
        const targetUrl = new URL(message.open);
        if (
          targetUrl.origin !== resourceRootUrl.origin ||
          !targetUrl.pathname.startsWith(resourceRootUrl.pathname)
        ) {
          return;
        }

        const relativePath = decodeURIComponent(
          targetUrl.pathname.slice(resourceRootUrl.pathname.length),
        );
        const fragment = decodeURIComponent(targetUrl.hash.slice(1));
        await commands.executeCommand(
          "vscode.open",
          Uri.joinPath(resourceRoot, relativePath).with({ fragment }),
        );
      } catch {
        // Ignore malformed or non-local messages from the webview.
      }
    });
  }

  /**
   * §5.2 收进来的框选消息。
   *
   * @anchor 这里是线2 的**出口**：一个框选在这里被组装成 `Anchor`，然后交给线1。
   *         值得注意的是它**不做任何位置数学** —— 那件事在 `resolveSelection` 里（有单测）。
   */
  private async handleSelectMessage(
    message: SelectToHost,
    document: PDFDocument,
    webviewPanel: WebviewPanel,
  ): Promise<void> {
    switch (message.type) {
      case "anchor:ready":
        this.readyPanels.add(webviewPanel);
        // 用户可能在我们还没准备好时就点了框选 —— 补发
        if (this.pendingSelect.has(webviewPanel)) {
          this.pendingSelect.delete(webviewPanel);
          this.post(webviewPanel, { type: "anchor:enterSelectMode" });
        }
        return;

      case "anchor:cancelled":
        await this.setSelectMode(false);
        return;

      case "anchor:captured": {
        await this.setSelectMode(false);

        // 优先用原始像素几何重算（`geometry` 是 S5 的追加字段）：
        // 注入脚本不参与类型检查、也没法被单测，所以那门换算**不由它定案**。
        // 没带几何的老式脚本退回它给的 `bbox`（`parseSelectMessage` 已经用 `coerceBBox` 验过）。
        const resolved = message.geometry
          ? resolveSelection(message.geometry.dragged, message.geometry.pages)
          : { page: message.page, bbox: message.bbox };

        if (!resolved) {
          // 几何算不出（拖到了页外、或页容器尺寸为 0）→ 明确告诉用户，而不是静默丢掉
          void window.showWarningMessage("Anchor：这次框选没有落在任何一页上，请重新框选。");
          return;
        }

        const anchor = buildPdfAnchor({
          filePath: document.uri.fsPath,
          sourceName: basenameOf(document.uri.fsPath),
          sourceId: await documentFingerprint(document.uri),
          page: resolved.page,
          bbox: resolved.bbox,
        });

        if (!extAInstalled()) {
          void window.showWarningMessage(PEER_MISSING_MESSAGE);
          return;
        }
        // §5.1：单向 executeCommand，不依赖返回值
        await commands.executeCommand("anchorExplain.explainAnchor", anchor);
        return;
      }

      default:
        // 联合类型穷尽了；真走到这里说明 §5.2 加了新消息而这里没跟上
        void describePdfAnchor;
        return;
    }
  }

  private post(panel: WebviewPanel, message: HostToSelect): void {
    void panel.webview.postMessage(message);
  }

  /**
   * 进入/退出框选模式：**同时**推给页面与 context key。
   *
   * @anchor 说实话：`anchorPdf.selectMode` 这个 key 目前**没有任何 `when` 在读**（线1 侧那两个
   *         key 才是键位用的）。留它是给"用户自己想绑一个取消键"留的入口，也方便
   *         `Developer: Inspect Context Keys` 里看出当前状态。别在注释里写"键位靠它" ——
   *         那是假话（同 D73 那一类：屏幕/文档说了、代码里没有）。
   */
  private async setSelectMode(active: boolean): Promise<void> {
    await commands.executeCommand("setContext", "anchorPdf.selectMode", active);
  }

  /**
   * 让当前可见的 PDF 面板进入框选模式（`anchorPdf.selectRegion` 命令的实现）。
   *
   * 找不到面板时明确提示：用户可能在编辑器里点了个 `.ts` 文件然后敲快捷键，
   * 那时"什么都没发生"是最糟的反馈。
   */
  static async startSelectRegion(): Promise<void> {
    const instance = PDFViewerProvider.current;
    if (!instance) {
      void window.showWarningMessage(
        "Anchor：没有打开的 Anchor PDF 视图。先用命令 `Anchor: 用 Anchor 打开 PDF` 打开一份。",
      );
      return;
    }

    const panel = instance.lastFocusedPanel();
    if (!panel) {
      void window.showWarningMessage("Anchor：先点一下 PDF 面板，再开始框选。");
      return;
    }

    await instance.setSelectMode(true);

    // **先推一次，再去管握手**（D73）。握手只说明"页面还没说它准备好了"，
    // 不能说明"页面里的脚本一定是死的"：脚本活着但拿不到 VS Code API 时（正是出事那一幕），
    // 它一个字也发不出来，这条消息就是它**唯一**的入口 —— 进去之后它会在页面上把故障说出来。
    // 推早了是无害的：监听器还没注册，消息落地即消失，后面还有握手后的补发兜着。
    instance.post(panel, { type: "anchor:enterSelectMode" });
    if (instance.readyPanels.has(panel)) return;

    // 页面还没握过手。除了记下来等 `anchor:ready` 补发（否则"第一次点没反应，再点一次才行"），
    // 还必须**在这里说话** —— 页面一直不回应时，屏幕上不能一直是"什么都没发生"。
    const again = instance.pendingSelect.has(panel);
    instance.pendingSelect.add(panel);
    if (again) void window.showWarningMessage(SELECT_NO_RESPONSE_MESSAGE);
    else void window.showInformationMessage(SELECT_LOADING_MESSAGE);
  }

  /**
   * 跨扩展入口（§5.1）：把某份 PDF 滚到第 N 页。**滚动，不是画框**（约束 1）。
   *
   * 它同时是命令面板里的一项（`Anchor: 跳到指定页（PDF）`）。所以 `page` 不合法时
   * **问一句**而不是默默什么都不做 —— 一个点了没反应的面板项比没有这一项更糟。
   */
  static async revealPage(page: unknown, filePath?: string): Promise<void> {
    const instance = PDFViewerProvider.current;
    if (!instance) {
      void window.showWarningMessage(
        "Anchor：没有打开的 Anchor PDF 视图。先用命令 `Anchor: 用 Anchor 打开 PDF` 打开一份。",
      );
      return;
    }

    const target =
      typeof page === "number" && Number.isInteger(page) && page >= 1
        ? page
        : Number(await window.showInputBox({ title: "跳到第几页？", prompt: "输入一个 ≥1 的整数" }));
    if (!Number.isInteger(target) || target < 1) return;

    // §5.1 的调用形状是 `revealPage(page)` —— **不带文件**（`PDFLocation` 里没有路径字段）。
    // 所以"该滚哪一份"落到当前聚焦的那个面板上：同时开着两份 PDF 对比着看时，
    // 用户按下侧边栏那一条，想动的显然是他刚才在看的那一份。
    const panels = filePath === undefined ? [instance.lastFocusedPanel()] : instance.panelsFor(filePath);
    const alive = panels.filter((panel): panel is WebviewPanel => panel !== undefined);
    if (alive.length === 0) {
      void window.showWarningMessage("Anchor：没有打开的 Anchor PDF 视图可以定位。");
      return;
    }
    for (const panel of alive) instance.post(panel, { type: "anchor:gotoPage", page: target });
  }

  /**
   * 最近一次被聚焦过的面板；没有焦点信息时退化成"最后一个"。
   *
   * 为什么要有焦点概念：用户可能同时开着两份 PDF（对比着看），
   * 按下"框选"时该作用在哪一份上，唯一合理的答案是"他刚才在看的那一份"。
   */
  private lastFocusedPanel(): WebviewPanel | undefined {
    if (this.focused && this.panels.has(this.focused)) return this.focused;
    const all = [...this.panels.keys()];
    return all[all.length - 1];
  }

  private panelsFor(filePath: string | undefined): WebviewPanel[] {
    const entries = [...this.panels.entries()];
    if (filePath === undefined) return entries.map(([panel]) => panel);
    return entries.filter(([, uri]) => samePath(uri.fsPath, filePath)).map(([panel]) => panel);
  }

  /** 当前活着的 provider 实例。`register` 时记下来，供两个静态入口用。 */
  private static current: PDFViewerProvider | undefined;

  /**
   * 面板 → 文档 uri。与上游那个 `WebviewCollection` 并存是**刻意的**：
   * 那个集合只提供 `get(uri)`（按文档找面板），而这里要的是反过来的查询
   * （"所有活着的面板"、"这个面板对应哪个文件"）。为了不去改上游文件，宿主自己再记一份。
   */
  private readonly panels = new Map<WebviewPanel, Uri>();

  private focused: WebviewPanel | undefined;

  private getHtmlForWebview(document: PDFDocument, webview: Webview, resourceRoot: Uri): string {
    const resolveUri = this.UriResolver(webview);
    const resolveAssetURI = (...paths: string[]) => resolveUri("assets", ...paths);
    const resolvePdfJsURI = (...paths: string[]) => resolveUri("assets", "pdf.js", ...paths);

    const cspSource = webview.cspSource;

    const config = workspace.getConfiguration("anchorPdf", document.uri);
    const settings = {
      url: `${webview.asWebviewUri(document.uri)}`,
      docBaseUrl: `${webview.asWebviewUri(document.uri)}`,
      resourceRoot: withTrailingSlash(webview.asWebviewUri(resourceRoot)),
      defaultZoomValue: config.get<string>("defaultZoomValue", "auto"),
      sidebarViewOnLoad: config.get<number>("sidebarViewOnLoad", 0),
      sandboxBundleSrc: `${resolvePdfJsURI("build", "pdf.sandbox.mjs")}`,
      cMapUrl: withTrailingSlash(resolvePdfJsURI("web", "cmaps")),
      iccUrl: withTrailingSlash(resolvePdfJsURI("web", "iccs")),
      standardFontDataUrl: withTrailingSlash(resolvePdfJsURI("web", "standard_fonts")),
      wasmUrl: withTrailingSlash(resolvePdfJsURI("web", "wasm")),
      imageResourcesPath: withTrailingSlash(resolvePdfJsURI("web", "images")),
    };

    return viewerHtml
      .replace(
        /* html */ "<title>PDF.js viewer</title>",
        /* html */
        `
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${cspSource} blob: data:; script-src ${cspSource} 'wasm-unsafe-eval'; worker-src ${cspSource} blob:; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} blob: data:; font-src ${cspSource} data:; media-src blob:; base-uri 'none'; form-action 'none';">
<meta id="pdf-view-config" data-config="${escapeAttribute(settings)}">

<title>PDF.js viewer</title>

<link rel="stylesheet" href="${resolvePdfJsURI("web", "viewer.css")}">
<link rel="stylesheet" href="${resolveAssetURI("main.css")}">

<!-- 框选 overlay：独立文件（assets/pdf.js/ 一个字节都没动，将来升级 pdf.js 不用重做这条注入），
     但**必须排在 pdf.js / main.mjs 之前**（D73）。

     原因不是依赖顺序，而是 acquireVsCodeApi() 在一个 webview 里**只能成功调用一次**：
     viewer.mjs 里的 VSCodeLinkService 也要用它（把 PDF 里的链接交回宿主），
     而 assets/main.mjs 一开头就 import 了 viewer.mjs，所以它天然跑在前面。
     谁先拿到实例，谁才能把实例分给别人 —— 我们的脚本先取一次、把实例共享出去，
     之后 pdf.js 来取就拿到同一个。反过来的话，我们那次调用会**抛**，
     postMessage 全变成静默空操作，屏幕上的表现是"框选毫无反应、一个字都没有"。

     module 脚本不带 async 时按文档顺序执行，所以"我们在前"是结构性保证，不靠时序运气。
     注意：这条注释里**不能出现反引号** —— 整段是模板字符串，一个反引号就会把它截断（D69 那类坑）。 -->
<script src="${resolveUri("media", "anchor-select.js")}" type="module"></script>

<script src="${resolvePdfJsURI("build", "pdf.mjs")}" type="module"></script>
<script src="${resolveAssetURI("main.mjs")}" type="module"></script>

<link rel="resource" type="application/l10n" href="${resolvePdfJsURI(
          "web",
          "locale",
          "locale.json",
        )}">`,
      )
      .trim();
  }
}
