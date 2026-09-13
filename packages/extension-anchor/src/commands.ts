/**
 * 四层装配 + §4.1 全部命令。事实源：docs/CONTRACTS.md §4.1。
 *
 * @anchor **本文件已经没有任何替身**（S3 收掉了最后一个）。
 *
 *         S1 有两处（假选区 / 假 AI），S2 删掉假选区，S3 删掉假 AI ——
 *         两次删除都只动了"来源"，中间链路
 *         （校验 → 会话 → decoration → 侧边栏 → 状态栏）一行没改。
 *         这就是把假货关在最外层边界想要的结果（D17/D18）。
 *
 * 装配顺序（STATE.md 里写死的）：commands → sidebar → playback → statusbar。
 */

import * as vscode from 'vscode';
import {
  AnchorError,
  createContextRequestLogger,
  describeError,
  isAnchorError,
  isCodeLocation,
  isPDFLocation,
  locationLabel,
} from '@anchor/core';
import type {
  Anchor,
  CodeLocation,
  ContextRequestLogger,
  EditorPort,
  ExplanationResult,
  FileSystemPort,
  WalkthroughStep,
} from '@anchor/core';
import { createCodeAdapter } from './adapters/CodeAdapter.ts';
import { createPdfAdapter } from './adapters/PDFAdapter.ts';
import { createPdfDocumentCache } from './adapters/pdf/pdfDocumentCache.ts';
import { openPdfJsSource } from './adapters/pdf/pdfjsSource.ts';
import { primaryLocationOf } from './playback/decorationPlan.ts';
import type { CaptureScope } from './adapters/CodeAdapter.ts';
import { DEFAULT_ACTIVE_PROVIDER, checkBaseUrl, describeConfig, normalizeBaseUrl } from './config.ts';
import { captureSummary } from './describe.ts';
import { createOrchestrator } from './orchestrator/Orchestrator.ts';
import { createModelRouter } from './orchestrator/ModelRouter.ts';
import { createOpenAICompatibleProvider } from './orchestrator/providers/openAICompatible.ts';
import { describeIssues, validateExplanation } from './orchestrator/validateExplanation.ts';
import { isAnchorLike } from './protocol.ts';
import { CodeWalkthroughPlayer } from './playback/CodeWalkthroughPlayer.ts';
import { WalkthroughSession } from './playback/WalkthroughSession.ts';
import type { WalkthroughSnapshot } from './playback/WalkthroughSession.ts';
import { SidebarPanel } from './sidebar/SidebarPanel.ts';
import type { SidebarHandlers } from './sidebar/SidebarPanel.ts';
import { createStatusBar } from './sidebar/statusBar.ts';
import { StartViewProvider } from './start/StartViewProvider.ts';
import { buildStartModel, findStartAction } from './start/startModel.ts';
import type { StartModel } from './start/startModel.ts';
import { samePath } from './paths.ts';
import {
  configuredProviderIds,
  rawProvider,
  readAnchorConfig,
  storeApiKey,
  writeProviderSettings,
} from './vscode/configSource.ts';
import { createEditorPort } from './vscode/ports/editorPort.ts';
import { countLines, createFileSystemPort } from './vscode/ports/fileSystemPort.ts';

/** 线2 的扩展 ID（D27）。对端缺失时必须明确提示，不静默失败。 */
const PDF_EXTENSION_ID = 'anchor.anchor-pdf';

/**
 * 线2 装没装。三处问的是同一个问题（`revealStep` / `runStartAction` / `showState`），
 * 所以只留一个问法 —— 三处各写一遍 `vscode.extensions.getExtension(...)` 的那种写法，
 * 第一次改 ID 时就会漏掉一处。
 */
function peer(): vscode.Extension<unknown> | undefined {
  return vscode.extensions.getExtension(PDF_EXTENSION_ID);
}

/**
 * 弹给用户的那句话：**不带错误码**。
 *
 * @anchor 为什么专门写一个：`describeError` 给的是 `PROVIDER_ERROR: 没有可用的 provider（…）` ——
 *         那个码是**给我们排查用的**，用户看到它只会以为是"报错编号"，还会以为是扩展坏了。
 *         真正需要码的时候：错误里的中文说明已经说清该怎么办，而取件/调用记录在输出面板「Anchor」通道。
 *         （判断成败仍然靠码，所以状态机、校验、日志一律继续用 `describeError`。）
 */
function userFacing(err: unknown): string {
  return isAnchorError(err) ? err.message : describeError(err);
}

export function registerCommands(context: vscode.ExtensionContext): void {
  const fsPort: FileSystemPort = createFileSystemPort();

  // 真选区（S2）。这里不再有任何覆盖：命令层拿到的就是编辑器里那个选区，
  // 以及（「整个文件」分支要的）当前文档的全文与行数。
  const editorPort: EditorPort = createEditorPort();
  const codeAdapter = createCodeAdapter({ editor: editorPort, fs: fsPort });

  // S7：PDF 侧。缓存是有界 LRU（打开一份 30 页 PDF 要读盘 + 解析，同一轮讲解会问好几次），
  // 淘汰时释放句柄 —— 见 pdfDocumentCache.ts 的注释。
  const pdfAdapter = createPdfAdapter({ cache: createPdfDocumentCache(openPdfJsSource) });

  /**
   * 按锚点选适配器。
   *
   * @anchor **为什么不是用 §3 的 `detect()`**：`detect()` 问的是"当前环境适不适用"，
   *         而我们的环境里同时可能开着代码编辑器和 PDF —— 那个问题没有唯一答案。
   *         锚点自己带着 `sourceType`，那是**确定的**依据。
   *         `detect()` 因此在我们的架构里一直没有消费者（`CONTRACTS` §9.2 记着这条判断）。
   */
  function adapterFor(anchor: Anchor) {
    return anchor.sourceType === 'pdf' ? pdfAdapter : codeAdapter;
  }

  const status = createStatusBar(context);

  /**
   * 取件日志的落点（§7 要求每个 `ContextRequest` 都记录，含被拒的）。
   * 侧边栏的 ToolTrace 面板还没做（不在任何切片范围内），所以先落到输出通道 ——
   * 排查"模型为什么讲歪了"时，这张表是唯一能看的东西。
   */
  let output: vscode.OutputChannel | undefined;
  const loggerOf = (): ContextRequestLogger => {
    output ??= vscode.window.createOutputChannel('Anchor');
    return createContextRequestLogger({
      sink: (entry) => {
        const verdict = entry.accepted ? '取件' : `拒绝（${entry.rejectReason ?? ''}）`;
        output?.appendLine(
          `[${new Date(entry.at).toLocaleTimeString()}] 第 ${entry.round} 轮 ${verdict} ` +
            `${entry.request.type} ${JSON.stringify(entry.request.params)} — ${entry.request.reason}` +
            (entry.resultChars !== undefined ? `（${entry.resultChars} 字）` : ''),
        );
      },
    });
  };

  let player: CodeWalkthroughPlayer | undefined;
  let sidebar: SidebarPanel | undefined;
  let start: StartViewProvider | undefined;
  let session: WalkthroughSession | undefined;
  let unsubscribe: (() => void) | undefined;
  /** 每次 explain() 领一个号：慢的那次回来时若号已过期，就丢弃它的结果（见 explain） */
  let generation = 0;
  /**
   * 开始面板上一次推到 webview 的"会话维度"的指纹（见 refreshStartOn）。
   * 面板显示的是快照，而快照的其余维度（模型/对端/上次捕获）变化都走**低频**路径，
   * 只有会话维度是逐点扫描时每拍都变的 —— 只有它需要去重。
   */
  let startKey: string | undefined;
  /**
   * 最近一次捕获的锚点与范围。**只为 `Anchor: 显示状态` 而留**：
   * 真选区接上之后，"我选的是不是我以为的那段"变成了唯一无法从屏幕上直接看出来的事
   * （高亮画在哪由讲解内容决定，不由选区决定）。留着它，用户按一下命令就能核对。
   */
  let lastCapture: { anchor: Anchor; scope: CaptureScope } | undefined;

  // 播放器与侧边栏都延迟构造：激活阶段不做任何 vscode 取值/建面板，启动开销为零，
  // 也让 scripts/smoke-extension.mjs 的桩不必覆盖一堆用不到的 API。
  const playerOf = (): CodeWalkthroughPlayer => (player ??= new CodeWalkthroughPlayer());

  const handlers: SidebarHandlers = {
    onNext: () => next(),
    onPrev: () => prev(),
    onGoto: (index) => {
      session?.goto(index);
    },
    onStop: () => stop(),
    onRevealStep: (index) => {
      const step = session?.snapshot.result.steps[index];
      if (step) void revealStep(step);
    },
  };

  /**
   * 「定位到这一步」的点击（侧边栏每条 step 上的位置标签）。
   *
   * @anchor 两条线的定位方式**必须是两套**（约束 1）：
   *   - 线1（代码）：在编辑器里高亮 + 滚过去（`CodeWalkthroughPlayer.revealStep`）
   *   - 线2（PDF）：**只滚到那一页，不画任何框** —— 框选出来的位置信息仅用于导航
   *
   * 这里也是"PDF 上不出现高亮框"的落点之一：PDF 那句话根本不经过播放器，
   * 而 `decorationPlan` 又会过滤掉所有非 `CodeLocation`（约束 20），两头都不会画。
   */
  async function revealStep(step: WalkthroughStep): Promise<void> {
    if (primaryLocationOf(step)) {
      await playerOf().revealStep(step);
      return;
    }

    if (isPDFLocation(step.location)) {
      const { page } = step.location;
      if (peer() === undefined) {
        // §5.1：对端缺失时明确提示，不静默失败
        void vscode.window.showWarningMessage(
          'Anchor：没有安装线2（anchor.anchor-pdf），无法把 PDF 滚到这一页。',
        );
        return;
      }
      // §5.1 的调用形状就是 (page)。**不传文件**：`PDFLocation` 里没有路径字段
      // （它只有 page/bbox），而线2 那边会把"该滚哪一份"落到当前聚焦的那个面板上。
      await vscode.commands.executeCommand('anchorPdf.revealPage', page);
      return;
    }

    // web：本次不接入（D7）。什么都不做，而不是抛错。
  }

  function sidebarOf(): SidebarPanel {
    if (!sidebar || sidebar.disposed) {
      // 把用户实际键位一并交给面板：webview 里的按键到不了工作台，得它自己派发（D47）
      sidebar = SidebarPanel.create(handlers, status.chords());
    }
    return sidebar;
  }

  function setContextKey(key: string, value: boolean): void {
    void vscode.commands.executeCommand('setContext', key, value);
  }

  /** 单个渲染面失败只记日志，不向上抛（D49：一个面坏了不该把会话一起带走）。 */
  function isolated(what: string, run: () => void): void {
    try {
      run();
    } catch (err) {
      console.error(`[anchor] ${what}更新失败：`, err);
    }
  }

  /**
   * §4.2 的两个 key 分工（D46）：
   *   - `walkthroughActive`：running / playing / paused 为 true，**done 与 idle 都落 false**。
   *     `next` / `prev` / `goto` / `playPause` 绑在它上面 —— 讲完了就不该再吃这些键。
   *   - `sessionOpen`：从开会话起为 true，**只到 stop / 编辑器关闭才落 false**。
   *     `stop` 绑在它上面 —— 否则 `alt+]` 走到最后一步之后，屏幕上的框就再没人能清掉。
   */
  function setActive(active: boolean): void {
    setContextKey('anchorExplain.walkthroughActive', active);
  }

  /**
   * 三个渲染方读的是同一份快照，所以"侧边栏说第 2 步、编辑器高亮第 3 步"不可能发生。
   *
   * **顺序与隔离都是刻意的**（D49）：
   *   1. 先把 context key 落定 —— 三个渲染面各自都可能失败（编辑器被关掉、webview 已释放…），
   *      但"会话现在算不算活着"不能因为其中一个失败而错位。第一版把 `setActive` 放在最后，
   *      结果状态栏一抛异常就会跳过它，用户就卡在"讲完了 alt+] 还在响应"的状态里。
   *   2. 三个渲染面各自 try/catch：一个面失败不该把另外两个拖下水，更不该让异常逃回会话内部
   *      （`emit` 同时是会话变更的监听器，异常逃出去会污染状态机）。
   */
  function emit(snapshot: WalkthroughSnapshot): void {
    setActive(snapshot.state !== 'idle' && snapshot.state !== 'done');

    isolated('decoration', () => {
      void playerOf()
        .render(snapshot)
        .catch((err: unknown) => console.error('[anchor] decoration 渲染失败：', err));
    });
    isolated('侧边栏', () => {
      sidebar?.post({
        type: 'session:update',
        result: snapshot.result,
        index: snapshot.index,
        state: snapshot.state,
        pointIndex: snapshot.pointIndex,
      });
    });
    isolated('状态栏', () => {
      status.update(snapshot);
    });
    // 开始面板也吃这条快照，但它只显示"第几步"，所以按会话维度去重（见 refreshStartOn）
    refreshStartOn(`${snapshot.state}|${snapshot.index}/${snapshot.total}|${snapshot.stale}`);
  }

  function startSession(result: ExplanationResult): void {
    // 先彻底收掉上一轮（正常情况下 explain() 已经 stop 过，这里是二次保险）：
    // 只覆盖 unsubscribe 而不退订，旧会话的监听器就会继续把 UI 拽回它那一步。
    unsubscribe?.();
    unsubscribe = undefined;
    session?.dispose();

    const fresh = new WalkthroughSession(result);
    session = fresh;
    sidebarOf().reveal();
    unsubscribe = fresh.onDidChange(emit);
    setContextKey('anchorExplain.sessionOpen', true);
    emit(fresh.snapshot);
  }

  function stop(): void {
    // 顺序同样是刻意的：**先收状态，再清视觉**（D49）。
    // 清框要碰编辑器，而编辑器可能在讲解期间被关掉（`setDecorations` 会抛）。
    // 第一版是"先清框"，于是一次异常就能让后面的收尾全部跳过 ——
    // 用户看到的就是"按 Esc 没反应、框还在、后面都没法测了"。
    unsubscribe?.();
    unsubscribe = undefined;
    session?.dispose();
    session = undefined;
    setActive(false);
    setContextKey('anchorExplain.sessionOpen', false);
    status.hide();

    isolated('清框', () => player?.clear());
    isolated('侧边栏', () => {
      // 面板不清空：讲解文字留着，用户还能回看。侧边栏据此显示"已结束"。
      sidebar?.post({ type: 'session:end' });
    });
    refreshStartOn('idle');
  }

  // ───────────────────────────────────────────────────────────
  // 开始面板（活动栏那个固定按钮，S8）
  // ───────────────────────────────────────────────────────────

  /**
   * 面板要显示的一切（§5.5）。**现算**，不缓存：模型配置、对端有没有装、
   * 上次捕获的是哪一段、讲解走到第几步 —— 这四件事随时会变，缓存一份就得回答
   * "谁负责让它失效"，而现算的代价只是读一次设置。
   */
  async function makeStartModel(): Promise<StartModel> {
    const cfg = await readAnchorConfig(context);
    const snapshot = session?.snapshot;
    const lastLine = lastCapture ? captureSummary(lastCapture.anchor, lastCapture.scope) : null;

    return buildStartModel({
      chords: status.chords(),
      providerReady: cfg.provider !== null,
      providerSummary: describeConfig(cfg),
      peerInstalled: peer() !== undefined,
      captureSummary: lastLine,
      session: snapshot
        ? { index: snapshot.index, total: snapshot.total, state: snapshot.state, stale: snapshot.stale }
        : null,
    });
  }

  /** 状态变了就推一份。**视图没开过是空操作**，所以可以随便调。 */
  function refreshStart(): void {
    void start?.refresh();
  }

  /**
   * 只在"面板显示的东西真的变了"时推。
   *
   * @anchor 为什么非要有这个去重：会话游标是**拍**不是**步**（D48）——
   *         一个 5 步的讲解会走十几二十拍，每拍都会 `emit`。而推一次面板要重读设置
   *         与 SecretStorage（后者是异步 IPC）。不去重的话，讲解过程中会为了
   *         一个没变过的「第 2/5 步」反复问 20 次密钥存储。
   */
  function refreshStartOn(key: string): void {
    if (key === startKey) return;
    startKey = key;
    refreshStart();
  }

  /**
   * 开始面板上的一次点击。**id → 命令的唯一解析处**（§5.5）。
   *
   * @anchor 面板里灰掉一个按钮与这里再判一次**不是重复**，是两层不同的东西：
   *   - 前者是**提示**：让用户不必点下去才知道缺什么
   *   - 后者是**执行前的判断**：webview 是不可信输入，它喊"我要跑 goto"的时候，
   *     会话可能刚好结束了 —— 它看到的那个状态已经是上一刻的
   *
   * 另外两条守卫是命令自己**没法**提供的：
   *   - `peer`：线2 没装时那条命令**根本不存在**，`executeCommand` 会抛"命令未找到"，
   *     用户看到的是一个 VS Code 的报错框，而不是"你没装线2"
   *   - `session`：`goto` 在没有会话时是**静默返回**的，那违反"不静默失败"
   * （`provider` 那条不需要额外守卫：`Anchor: 设置 API Key` 自己会讲清缺什么。）
   */
  async function runStartAction(id: string): Promise<void> {
    const action = findStartAction(id);
    if (!action) return; // 表里没有的 id：不是我们的按钮，丢掉

    if (action.requires === 'peer' && peer() === undefined) {
      void vscode.window.showWarningMessage('Anchor：没有安装线2（anchor.anchor-pdf），这条命令用不了。');
      return;
    }
    if (action.requires === 'session' && !session) {
      void vscode.window.showWarningMessage('Anchor：现在没有进行中的讲解。');
      return;
    }

    await vscode.commands.executeCommand(action.command);
  }

  /**
   * 固定按钮的"快捷键那一份"：把活动栏里那个容器聚焦出来。
   *
   * `<viewId>.focus` 是 VS Code 按视图 id 自动生成的命令 —— 但那是**约定**，
   * 所以留一条退路：退回聚焦整个容器（容器 id 是我们自己在 package.json 里声明的）。
   * 退路只是为了"按了没反应"不至于成为唯一结果，不是我们在赌哪个能用。
   */
  async function showStart(): Promise<void> {
    try {
      await vscode.commands.executeCommand(`${StartViewProvider.viewId}.focus`);
    } catch {
      await vscode.commands.executeCommand('workbench.view.extension.anchor');
    }
  }

  /**
   * 捕获 → 请求 → 校验 → 开会话。
   *
   * **「讲解失败」与「渲染失败」在这里被分开**（D49）：只有 provider / 校验的失败才算讲解失败；
   * 一旦有了合法的 `ExplanationResult`，`startSession` 就在 try 之外调用 ——
   * 否则渲染面的一次异常会走进下面这个 catch，把好不容易拿到的讲解当成失败丢掉，
   * 还顺手把 context key 落成 false（用户按 Esc 就真没反应了）。
   */
  /**
   * §3.3 的 `ctx`：文档总行数（代码）或总页数（PDF）。取不到返回 null，
   * 校验会**跳过那一项上界**而不是跳过整条 location 校验。
   */
  async function makeOutline(anchor: Anchor): Promise<{ documentLineCount: number | null; pageCount: number | null }> {
    if (isCodeLocation(anchor.location)) {
      return { documentLineCount: await countLines(fsPort, anchor.location.filePath), pageCount: null };
    }
    // S7：PDF 的总页数终于有了来源（无头打开一次就有），
    // 于是 §3.3 里 `1 ≤ page ≤ pageCount` 那条上界不再被跳过 —— 这是 S6 留下的缺口（D55 第 4 条）。
    // 没有 filePath 的老锚点（S5 之前造的）仍然只能跳过。
    if (isPDFLocation(anchor.location) && anchor.location.filePath) {
      return { documentLineCount: null, pageCount: await pdfAdapter.pageCount(anchor.location.filePath) };
    }
    return { documentLineCount: null, pageCount: null };
  }

  /**
   * 给 PDF 锚点补上 `extractedText`（**第一层优先**，`Anchor.extractedText` 的注释就是这个意思）。
   *
   * @anchor 为什么要做这一件事：框选出来的 bbox 是**地址**，而那一块里的文字才是模型第一批
   *         该看到的东西。不填的话，模型只知道"第 23 页的一小块"，还得先请求取件才看得到内容 ——
   *         白花一轮网络往返，而且它对"该取哪一页"也只能猜。
   *
   * 失败一律**静默忽略**（扫描件没有文字层是正常情况）：锚点照原样交出去，
   * 模型自己会去取件。填充失败不该让讲解不可用。
   */
  async function withPdfText(anchor: Anchor): Promise<Anchor> {
    const loc = anchor.location;
    if (anchor.sourceType !== 'pdf' || anchor.extractedText) return anchor;
    if (!isPDFLocation(loc) || !loc.filePath) return anchor;

    try {
      const text = await pdfAdapter.textInBBox(loc.filePath, loc.page, loc.bbox);
      return text ? { ...anchor, extractedText: text } : anchor;
    } catch {
      return anchor;
    }
  }

  /**
   * 现读配置、现建编排器。
   *
   * @anchor 为什么**不是**在激活时建一次留着用：用户改完设置应该立刻生效，
   *         而不是"改设置 → 重载窗口 → 再试"。`ExplainProvider` 就是"一个函数"，
   *         重建它的成本只有两次对象字面量。
   *
   * 没有可用配置时**明确报错**，不静默退化成"什么都不发生" ——
   * 后者让人以为是扩展坏了，而不是"我还没填 baseUrl"。
   */
  async function makeProvider(anchor: Anchor): Promise<ReturnType<typeof createOrchestrator>> {
    const cfg = await readAnchorConfig(context);
    if (!cfg.provider) throw new AnchorError('PROVIDER_ERROR', describeConfig(cfg));

    return createOrchestrator({
      chat: createOpenAICompatibleProvider({
        baseUrl: cfg.provider.baseUrl,
        apiKey: cfg.provider.apiKey,
        extraHeaders: cfg.provider.extraHeaders,
        extraBody: cfg.provider.extraBody,
      }),
      routeModel: createModelRouter({
        tier1Model: cfg.provider.tier1Model,
        tier2Model: cfg.provider.tier2Model,
      }),
      adapter: adapterFor(anchor),
      makeOutline,
      maxFetchRounds: cfg.maxFetchRounds,
      temperature: cfg.temperature,
      logger: loggerOf(),
    });
  }

  async function explain(anchor: Anchor): Promise<void> {
    stop();
    const gen = (generation += 1);
    status.showBusy('正在讲解…');

    let result: ExplanationResult;
    try {
      const prepared = await withPdfText(anchor);
      const provider = await makeProvider(prepared);
      const produced = await provider(prepared);
      // 期间用户又发起了一次：这次的结果已经过期，直接丢掉。
      // 没有这道闸，先发后到的那次会把 UI 拽回旧讲解（真 AI 下必然遇到）。
      if (gen !== generation) return;

      // 第二道闸：编排层内部已经过了一次 §3.3，这里再查一次。
      // 不是不信任它，而是"渲染层只消费校验过的数据"这条规矩不该有例外 ——
      // 编排层将来多一条产出路径（比如缓存命中），这里仍然拦得住。
      const verdict = validateExplanation(produced, prepared, await makeOutline(prepared));
      if (!verdict.ok) {
        throw new AnchorError('SCHEMA_VIOLATION', `AI 输出未通过校验：${describeIssues(verdict.issues)}`, {
          issues: verdict.issues,
        });
      }
      result = verdict.result;
    } catch (err) {
      if (gen !== generation) return;
      status.hide();
      setActive(false);
      setContextKey('anchorExplain.sessionOpen', false);
      void vscode.window.showErrorMessage(`Anchor：${userFacing(err)}`);
      return;
    }

    startSession(result);
  }

  /**
   * 「讲解什么」的确认 —— S2 新增的唯一交互。
   *
   * 两种"没得讲"分开提示，因为要用户做的事不一样：没打开文件要去打开，只放了光标要去选内容。
   * 只放光标那一路**不直接开始讲整个文件**：整份文件往往是几百行，命中率通常比一段低得多，
   * 与其猜，不如把「要讲整份吗」摆出来让用户拍板（他也可以直接按 Esc 走开）。
   */
  async function askWhatToExplain(editor: vscode.TextEditor): Promise<CaptureScope | undefined> {
    const relative = vscode.workspace.asRelativePath(editor.document.uri);

    if (editor.selection.isEmpty) {
      const picked = await vscode.window.showWarningMessage(
        `Anchor：${relative} 里只放了光标，没有选中内容。`,
        '讲解整个文件',
      );
      return picked ? 'whole-file' : undefined;
    }

    const start = Math.min(editor.selection.start.line, editor.selection.end.line) + 1;
    const end = Math.max(editor.selection.start.line, editor.selection.end.line) + 1;
    const items: { label: string; description: string; scope: CaptureScope }[] = [
      { label: '讲解这段', description: `第 ${start}-${end} 行`, scope: 'selection' },
      { label: '讲解整个文件', description: `共 ${editor.document.lineCount} 行`, scope: 'whole-file' },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Anchor 讲解',
      placeHolder: '要讲解哪一段？',
    });
    return picked?.scope;
  }

  async function capture(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showWarningMessage('Anchor：先打开一个文件，再选中要讲解的代码。');
      return;
    }

    const scope = await askWhatToExplain(editor);
    if (!scope) return; // 用户取消：什么也不做，比默默讲一段他没点过头的内容好

    let anchor: Anchor;
    try {
      anchor = await codeAdapter.capture(scope);
    } catch (err) {
      // 确认之后、取件之前环境变了（文件被关掉）。这不是"讲解失败"，所以不走 explain 的提示。
      void vscode.window.showErrorMessage(`Anchor：${userFacing(err)}`);
      return;
    }

    lastCapture = { anchor, scope };
    refreshStart();
    await explain(anchor);
  }

  /** 跨扩展入口（§5.1）。参数来自别的扩展，属于外部输入，必须先过形状守卫。 */
  async function explainAnchor(rawAnchor: unknown): Promise<void> {
    if (!isAnchorLike(rawAnchor)) {
      void vscode.window.showErrorMessage('Anchor：收到的锚点格式不合法（来自其他扩展），已忽略。');
      return;
    }
    await explain(rawAnchor);
  }

  function next(): void {
    session?.next();
  }

  function prev(): void {
    session?.prev();
  }

  function playPause(): void {
    session?.togglePlay();
  }

  async function goto(): Promise<void> {
    const current = session;
    if (!current) return;

    const items = current.snapshot.result.steps.map((step, index) => ({
      label: `第 ${index + 1} 步：${step.title ?? '（无标题）'}`,
      description: locationLabel(step.location),
      index,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Anchor 讲解',
      placeHolder: '跳到哪一步？',
    });
    if (!picked) return;
    current.goto(picked.index);
  }

  /**
   * `Anchor: 配置模型端点` —— 点三下把端点配好（D62）。
   *
   * @anchor 为什么值得一条专门命令，而不是让用户去设置里手写：
   *         `providers` 是**嵌套对象**，在设置界面里不好改，用户于是手写 JSON ——
   *         而这一步连续翻过两次车（第一次找不到入口，第二次把整段对象填进了
   *         `activeProvider` 那个**字符串**设置里，整个 settings.json 语法都坏了）。
   *         **一件事讲清楚两次还是做不对，就不该再靠讲**。三个输入框、带校验、带预填，
   *         写完立刻能用，而且**永不碰 apiKey**（那个走 SecretStorage）。
   */
  async function configure(): Promise<void> {
    const ids = configuredProviderIds();
    let id = DEFAULT_ACTIVE_PROVIDER;

    if (ids.length > 0) {
      const picked = await vscode.window.showInputBox({
        title: 'Anchor：给哪个 provider 配端点？',
        prompt: `已有的：${ids.join(' / ')}（直接回车就改当前在用的那个）`,
        value: (await readAnchorConfig(context)).providerId,
        ignoreFocusOut: true,
      });
      if (picked === undefined) return; // Esc = 什么都不做
      id = picked.trim() || DEFAULT_ACTIVE_PROVIDER;
    }

    // 预填已有的值：改一个字段不该重打整行
    const before = rawProvider(id);
    const baseUrl = await vscode.window.showInputBox({
      title: `Anchor：providers.${id}.baseUrl`,
      prompt: 'OpenAI 兼容端点（不带 /chat/completions）',
      value: typeof before?.baseUrl === 'string' ? before.baseUrl : '',
      placeHolder: 'https://api.deepseek.com/v1',
      validateInput: (value) => checkBaseUrl(value),
      ignoreFocusOut: true,
    });
    if (baseUrl === undefined) return;

    const model = await vscode.window.showInputBox({
      title: `Anchor：providers.${id}.tier1Model`,
      prompt: '端点那边认的模型 id',
      value: typeof before?.tier1Model === 'string' ? before.tier1Model : '',
      placeHolder: 'deepseek-chat',
      validateInput: (value) => (value.trim() === '' ? '模型名不能为空' : null),
      ignoreFocusOut: true,
    });
    if (model === undefined) return;

    const { replaced, activeChanged } = await writeProviderSettings(id, baseUrl, model);
    void vscode.window.showInformationMessage(
      `Anchor：已${replaced ? '更新' : '写入'}用户设置 anchorExplain.providers.${id}` +
        `（${model.trim()} @ ${normalizeBaseUrl(baseUrl)}）` +
        `${activeChanged ? `，并把 activeProvider 指到 ${id}` : ''}。下一步：设置 API Key。`,
    );
  }

  /**
   * 存 API Key 进 `SecretStorage`（D25）。
   *
   * @anchor 这条命令不是为了方便，而是**默认走安全路径的必要条件**：
   *         §6 规定 apiKey 优先从 SecretStorage 读，但如果没有一条写入的路，
   *         用户就只能把它填进 settings.json 的明文里 —— 那份文件会被同步、被截图、被提交。
   */
  async function setApiKey(): Promise<void> {
    const ids = configuredProviderIds();
    const providerId =
      ids.length > 1
        ? await vscode.window.showQuickPick(ids, { title: 'Anchor：给哪个 provider 存 key？' })
        : (ids[0] ?? (await readAnchorConfig(context)).providerId);

    if (!providerId) {
      void vscode.window.showWarningMessage(
        'Anchor：先在设置里配置 anchorExplain.providers（至少要有 baseUrl 与 tier1Model），再存 key。',
      );
      return;
    }
    await storeApiKey(context, providerId);
  }

  /**
   * 骨架自检命令（F2 遗留）。它同时是一次**接线验证**：
   * `locationLabel` 来自 `@anchor/core`，能正常输出就说明 workspace 链接与打包都通了。
   *
   * 它还报三件"只有肉眼可见、脚本判不了"的东西：
   *   - 讲解当前是否活着、扫到第几步第几点（用来核对 UI 有没有跟上状态机）
   *   - 状态栏项实际显示成什么（用来分辨"提示没显示"与"提示显示了但没找到"）
   *   - **上次捕获的范围**（真选区接上后，这是唯一能复核锚点区间的观测点，D51）
   *   - **模型配置**（配错了要能一眼看出来，而不是等讲解失败）
   */
  async function showState(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const selection = editor?.selection;

    const parts: string[] = ['骨架就绪', 'core 已接入'];

    if (editor && selection) {
      const loc: CodeLocation = {
        filePath: editor.document.uri.fsPath,
        lineStart: selection.start.line + 1,
        lineEnd: selection.end.line + 1,
      };
      parts.push(vscode.workspace.asRelativePath(editor.document.uri));
      parts.push(selection.isEmpty ? `光标在 ${locationLabel(loc)}` : `选中 ${locationLabel(loc)}`);
    } else {
      parts.push('没有活动的代码编辑器');
    }

    const peerInstalled = peer() !== undefined;
    parts.push(`对端 anchor-pdf：${peerInstalled ? '已安装' : '未安装'}`);

    // 真选区接上之后，"我刚才那一按到底讲了哪一段"屏幕上再也看不出来
    // （高亮画在哪由讲解内容决定，不由选区决定）。所以这里单独报一次。
    // 这句与开始面板显示的是**同一句** —— 格式化在 `describe.ts` 里只有一处。
    parts.push(
      lastCapture ? `上次捕获：${captureSummary(lastCapture.anchor, lastCapture.scope)}` : '还没有捕获过',
    );

    parts.push(`模型：${describeConfig(await readAnchorConfig(context))}`);

    const step = session?.snapshot;
    parts.push(
      step
        ? `讲解中：第 ${step.index + 1}/${step.total} 步${step.pointIndex >= 0 ? ` · 第 ${step.pointIndex + 1}/${step.pointTotal} 点` : '（整块）'}`
        : '没有进行中的讲解',
    );

    const bar = status.probe();
    parts.push(`状态栏：${bar.shown ? bar.text : '未显示'}`);

    const line = parts.join(' · ');
    console.log('[anchor] showState:', line);
    void vscode.window.showInformationMessage(`Anchor：${line}`);
  }

  // 固定按钮（活动栏容器 + 里面的「开始」视图）。注册本身只是"挂个号"，
  // 视图要等用户点开才存在 —— 所以 `start` 是懒的（见 refreshStart）。
  start = StartViewProvider.register(context, { onRun: (id) => void runStartAction(id) }, makeStartModel);

  /**
   * 打开设置，并筛到我们的配置项（D61）。
   *
   * @anchor 这是开始面板里**唯一**一条不指向我们自己功能的动作（它落到 VS Code 的内置命令
   *         `workbench.action.openSettings` 上）。之所以包成一条我们自己的命令，而不是让面板
   *         直接指向内置命令，是因为有一条锁断言"动作表里的每条命令都在所属扩展里声明过" ——
   *         内置命令没法声明，那条锁就守不住了。包一层，规则不变，而且用户也能从命令面板
   *         （或在键盘快捷方式里给它绑一个键）用到它。
   *
   * **参数放在这里，不放面板**：面板只会说"执行哪条命令"，说不出"带什么参数"
   * （§5.5 的 `start:run` 只回传 id，这是刻意的）。所以命令自己带着它要的参数。
   */
  async function openSettings(): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'anchorExplain');
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('anchorExplain.capture', capture),
    vscode.commands.registerCommand('anchorExplain.explainAnchor', explainAnchor),
    vscode.commands.registerCommand('anchorExplain.next', next),
    vscode.commands.registerCommand('anchorExplain.prev', prev),
    vscode.commands.registerCommand('anchorExplain.stop', stop),
    vscode.commands.registerCommand('anchorExplain.goto', goto),
    vscode.commands.registerCommand('anchorExplain.playPause', playPause),
    vscode.commands.registerCommand('anchorExplain.showStart', showStart),
    vscode.commands.registerCommand('anchorExplain.openSettings', openSettings),
    vscode.commands.registerCommand('anchorExplain.configure', configure),
    vscode.commands.registerCommand('anchorExplain.showState', showState),
    vscode.commands.registerCommand('anchorExplain.setApiKey', setApiKey),

    // 开始面板显示的四件事里，有两件不经过 emit：模型配置（改设置）与对端（装/卸线2）。
    // 不订阅它们的话，面板会一直显示打开那一刻的旧话。
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('anchorExplain')) refreshStart();
    }),
    vscode.extensions.onDidChange(() => refreshStart()),

    // staleness：讲解期间文档被改动 → 标记失效，由状态栏如实告诉用户，而不是继续画错位的框
    vscode.workspace.onDidChangeTextDocument((e) => {
      const stale = session?.snapshot.step;
      if (stale && isCodeLocation(stale.location) && samePath(stale.location.filePath, e.document.uri.fsPath)) {
        session?.markStale();
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const step = session?.snapshot.step;
      if (step && isCodeLocation(step.location) && samePath(step.location.filePath, doc.uri.fsPath)) stop();
    }),

    {
      dispose: () => {
        unsubscribe?.();
        session?.dispose();
        player?.dispose();
        status.dispose();
        sidebar?.dispose();
        output?.dispose();
      },
    },
  );
}
