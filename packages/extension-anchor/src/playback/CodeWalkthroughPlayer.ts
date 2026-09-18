/**
 * 线1 的渲染层：把会话快照变成编辑器里的荧光笔。
 *
 * @anchor 硬约束（SLICES.md S1 验收标准）：
 *         - 只用 `TextEditorDecorationType` + `setDecorations`，**纯视觉**
 *         - 永不写入文档：本文件不存在任何 `edit` / `applyEdit` / `insertSnippet`
 *         - 配色全部走主题色变量，不写死十六进制（§4.3），并全部 `isWholeLine`
 *         - 定位用 `revealRange(range, InCenter)`（用户指定的"回流"方式）
 *
 * 全部 vscode 取值都发生在函数体内（构造器/方法），模块顶层不碰 `vscode.*` ——
 * 这样 `scripts/smoke-extension.mjs` 只要不触发讲解，就不必给桩补一堆枚举。
 */

import * as vscode from 'vscode';
import type { CodeLocation, HighlightEmphasis } from '@anchor/core';
import { normPath, samePath } from '../paths.ts';
import { EMPHASES, focusFileOf, planForBeat, primaryLocationOf, specsInFile } from './decorationPlan.ts';
import type { WalkthroughSnapshot } from './WalkthroughSession.ts';

type DecorationKey = 'step' | HighlightEmphasis;

const ALL_KEYS: readonly DecorationKey[] = ['step', ...EMPHASES];

/**
 * 步级底色：更淡的中性背景、无描边（§4.3 里 `context` 的视觉）。
 * 与子高亮用**独立的 decoration type**，两者重叠时不会互相盖掉。
 */
function stepBackdrop(): vscode.DecorationRenderOptions {
  return {
    isWholeLine: true,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    backgroundColor: new vscode.ThemeColor('editor.selectionHighlightBackground'),
  };
}

/** §4.3：emphasis → 配色。`已冻结（可调）`，改这里等于改观感。 */
function emphasisStyles(): Record<HighlightEmphasis, vscode.DecorationRenderOptions> {
  const base = {
    isWholeLine: true,
    // ClosedClosed：编辑时不要把框自动撑到新行，避免"高亮追着光标跑"
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  };

  return {
    primary: {
      ...base,
      backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
      borderWidth: '0 0 0 2px',
      borderStyle: 'solid',
      borderColor: new vscode.ThemeColor('editor.findMatchBorder'),
      overviewRulerColor: new vscode.ThemeColor('editor.findMatchBorder'),
      overviewRulerLane: vscode.OverviewRulerLane.Center,
    },
    context: {
      ...base,
      backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
    },
    definition: {
      ...base,
      backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
      borderWidth: '0 0 0 3px',
      borderStyle: 'solid',
      borderColor: new vscode.ThemeColor('editorInfo.foreground'),
    },
    caveat: {
      ...base,
      backgroundColor: new vscode.ThemeColor('editor.wordHighlightStrongBackground'),
      borderWidth: '1px',
      borderStyle: 'dashed',
      borderColor: new vscode.ThemeColor('editorWarning.foreground'),
    },
  };
}

function toRange(loc: CodeLocation, lineCount: number): vscode.Range | undefined {
  if (lineCount <= 0) return undefined;
  // 越界一律夹住而不是丢弃：文档可能在讲解期间被改短，宁可框画短一点也不要整步消失
  const start = Math.min(Math.max(loc.lineStart, 1), lineCount);
  const end = Math.min(Math.max(loc.lineEnd, start), lineCount);
  return new vscode.Range(start - 1, 0, end - 1, 0);
}

export class CodeWalkthroughPlayer {
  readonly #types: Record<DecorationKey, vscode.TextEditorDecorationType>;
  /** 画过框的编辑器：清框时得挨个清，否则上一个文件的框会留在屏幕上 */
  readonly #decorated = new Set<vscode.TextEditor>();
  /**
   * 本会话已开出来的编辑器（按文件记）。
   *
   * @anchor 为什么要记：跨文件讲解时焦点文件会来回跳，而 `#ensureEditor` **每一拍都要问一次**。
   *         没有这张表时每一拍都会 `showTextDocument` —— 同一个文件被反复"打开"，
   *         预览标签反复重建，屏幕上就是持续的抖动（D70 实测里"跳转之后就像卡住了"的观感来源之一）。
   *         记下来之后：**同一个文件且它已经是活动编辑器 → 什么都不做**。
   */
  readonly #editors = new Map<string, vscode.TextEditor>();
  /** 正在渲染的那一拍。用来**合并**堆积的请求，而不是并发跑（见 `render`） */
  #rendering = false;
  #pending: WalkthroughSnapshot | undefined;
  /**
   * 我们**自己**正在"打开/切前台某个文件"这件事里面（D84）。计数而不是布尔：
   * 嵌套调用（`#renderOnce` 里调 `#ensureEditor`）退出时不该把外层的状态一起清掉。
   */
  #switching = 0;
  /** 屏幕**落定**的订阅者（D84）。宿主靠它知道"现在可以看一眼收工判定了"。 */
  readonly #settlers = new Set<() => void>();

  constructor() {
    const emphasis = emphasisStyles();
    this.#types = {
      step: vscode.window.createTextEditorDecorationType(stepBackdrop()),
      primary: vscode.window.createTextEditorDecorationType(emphasis.primary),
      context: vscode.window.createTextEditorDecorationType(emphasis.context),
      definition: vscode.window.createTextEditorDecorationType(emphasis.definition),
      caveat: vscode.window.createTextEditorDecorationType(emphasis.caveat),
    };
  }

  /**
   * 渲染当前拍的框，并把视图滚到它上面。
   *
   * **同一时刻只跑一次**（D70）：每一拍都可能要"打开一个文件 + 滚过去"，那比画框慢得多；
   * 播放（或用户连按 `Alt+]`）比渲染快时，若并发地堆起来，屏幕上就是编辑器反复跳动、
   * 面板迟迟不更新 —— 看起来就是卡死。堆积时**只保留最后一拍**（最新的才是用户要看的）。
   */
  async render(snapshot: WalkthroughSnapshot): Promise<void> {
    if (this.#rendering) {
      this.#pending = snapshot;
      return;
    }
    this.#rendering = true;
    try {
      await this.#renderOnce(snapshot);
    } finally {
      this.#rendering = false;
      const next = this.#pending;
      this.#pending = undefined;
      /**
       * 顺序是刻意的（D84）：**先让下一拍起飞，再宣布落定**。
       *
       * @anchor 反过来的话（先宣布、再起飞）会有一个空档：宿主收到"落定"时，
       *         下一拍的换文件还没开始 —— 于是它会在"屏幕上正空着"的那一刻做收工判定，
       *         而那正是我们要避免的那一帧。提前起飞则不同：下一拍在
       *         `#ensureEditor` 里同步把 `switching` 置回 true，宿主一看就知道"还在换，别判"。
       */
      if (next) void this.render(next);
      this.#markSettled();
    }
  }

  async #renderOnce(snapshot: WalkthroughSnapshot): Promise<void> {
    const specs = planForBeat(snapshot.step, snapshot.pointIndex);
    this.clear();

    /**
     * 一拍只画**一个文件**（D69）。S9a 起 location 可以落在取过件的别的文件里，
     * 而"拿 `specs[0]` 的文件当唯一目标、把所有 spec 都画进去"会把 `protocol.h:16`
     * 画到 `main.c:16` 上 —— 一个看起来很确定的假框。焦点取**最具体**的那一个
     * （有子高亮就跟子高亮），其余文件的框这一拍不画：它们在侧边栏的标签里带着文件名。
     */
    const focusFile = focusFileOf(specs);
    if (!focusFile) return;

    const editor = await this.#ensureEditor(focusFile);
    if (!editor) {
      // 打不开目标文件（被删/权限）时静默退化：讲解文字仍然在侧边栏里，不该因此中断会话
      return;
    }

    const lineCount = editor.document.lineCount;
    const byKey = new Map<DecorationKey, vscode.Range[]>();
    for (const spec of specsInFile(specs, focusFile)) {
      const key: DecorationKey = spec.kind === 'step' ? 'step' : spec.emphasis;
      const range = toRange(spec.location, lineCount);
      if (!range) continue;
      const list = byKey.get(key);
      if (list) list.push(range);
      else byKey.set(key, [range]);
    }

    this.#decorated.add(editor);
    for (const [key, ranges] of byKey) {
      editor.setDecorations(this.#types[key], ranges);
    }

    // 滚动目标：这一拍里**那一步**的位置（它就在焦点文件里时，与单文件时代的行为一字不差），
    // 否则退到最具体那个位置 —— 别为了"滚到步骤"把视图带到另一个文件去
    const target =
      specs.find((spec) => spec.kind === 'step' && samePath(spec.location.filePath, focusFile))?.location ??
      specs[specs.length - 1]!.location;
    const first = toRange(target, lineCount);
    if (first) await this.#reveal(editor, first);
  }

  /** `ui:revealStep`：只把视图滚过去，**不改变当前拍**（对照 S6 里"点一条滚 PDF 到该页"）。 */
  async revealStep(step: WalkthroughSnapshot['step']): Promise<void> {
    try {
      const loc = primaryLocationOf(step);
      if (!loc) return;
      const editor = await this.#ensureEditor(loc.filePath);
      if (!editor) return;
      const range = toRange(loc, editor.document.lineCount);
      if (range) await this.#reveal(editor, range);
    } finally {
      // 侧边栏上点一条位置标签同样是"我们自己在换文件"（D84）—— 走完之后屏幕才落定
      this.#markSettled();
    }
  }

  /**
   * 我们**自己**正在把某个文件打开或切到前台（D84）。
   *
   * @anchor 宿主用它回答一个只有这里才知道的问题：**"刚才那一刻的看不见，是不是我们造成的？"**
   *         VS Code 的一次预览轮换不是原子的 —— 它先报"被顶掉的那个标签关了"，
   *         之后才让新文件出现在 `visibleTextEditors` 里。中间那一帧，我们这边
   *         **一个文件都还不可见**。宿主的收工判定（"这次讲解还有落脚点吗"）若落在那一帧上，
   *         就会把"我们正把用户带到某个文件"读成"用户把讲解的东西全关了" —— 于是收工。
   *
   *         所以这件事不能靠"等一个猜出来的毫秒数"来躲（那是 D78 走过的错路），
   *         只能问**做这件事的人**：播放器知道自己在换，也知道什么时候换完。
   */
  get switching(): boolean {
    return this.#switching > 0;
  }

  /** 屏幕落定（一次打开/切换/绘制走完了）时回调一次。返回退订函数。 */
  onDidSettle(listener: () => void): () => void {
    this.#settlers.add(listener);
    return () => {
      this.#settlers.delete(listener);
    };
  }

  /**
   * 宣布"屏幕落定了"。**逐个兜异常**：订阅者是宿主，它那边出问题不该
   * 把播放器自己的渲染流程带下去（与 `emit` 里三个渲染面各自隔离同一条规矩）。
   */
  #markSettled(): void {
    for (const listener of [...this.#settlers]) {
      try {
        listener();
      } catch (err) {
        console.error('[anchor] 落定回调失败：', err);
      }
    }
  }

  /**
   * 清除所有框。退出讲解、文档关闭、staleness 提示都走这里。
   *
   * **必须逐编辑器兜住异常**：讲解期间用户完全可以关掉那个文件（或让它变成非预览编辑器），
   * 此时 `editor.document.isClosed` 为真、`setDecorations` 会抛。
   * 这个异常若逃出去，`stop()` 后面的收尾（落 context key、收状态栏、通知侧边栏）**全都不会执行**，
   * 会话就卡在"框还在、状态栏还说讲解中、但谁都清不掉"的半死状态 —— 这正是用户报的
   * "按 Esc 没反应、后面都没法测了"。所以清框这一步永远不许把异常带出去。
   */
  clear(): void {
    for (const editor of this.#decorated) {
      if (editor.document.isClosed) continue;
      try {
        for (const key of ALL_KEYS) editor.setDecorations(this.#types[key], []);
      } catch {
        // 编辑器在两次渲染之间失效了：丢掉它，别让它拖累其它编辑器与调用方
      }
    }
    this.#decorated.clear();
  }

  dispose(): void {
    this.clear();
    this.#editors.clear();
    this.#pending = undefined;
    this.#settlers.clear();
    for (const key of ALL_KEYS) this.#types[key].dispose();
  }

  /**
   * 「确保这个文件在屏幕上看得到」的入口 —— 只负责告诉外界**我们正在做这件事**（D84）。
   * 真正的两条路在 `#ensureEditorIn` 里；分成两层是为了让"正在换"这个状态在
   * **任何一条路**（已打开→切前台 / 没打开→开一个预览标签）上都成立，包括中途抛错。
   */
  async #ensureEditor(filePath: string): Promise<vscode.TextEditor | undefined> {
    this.#switching += 1;
    try {
      return await this.#ensureEditorIn(filePath);
    } finally {
      this.#switching -= 1;
    }
  }

  async #ensureEditorIn(filePath: string): Promise<vscode.TextEditor | undefined> {
    const want = normPath(filePath);

    // 本会话已经为它开过、它还活着、而且它已经是活动编辑器 → 什么都不用做。
    // 每一拍都调一次 showTextDocument 会让预览标签反复重建（跨文件讲解时焦点文件来回跳，
    // 屏幕上就是持续抖动 —— D70 实测里"跳转之后像卡住了"的观感来源之一）
    const known = this.#editors.get(want);
    if (known && !known.document.isClosed && vscode.window.activeTextEditor === known) return known;

    /**
     * 目标文件已经在**可见编辑器**里，但它不是活动编辑器 —— 必须把它**切到前台**。
     *
     * @anchor 这里是"讲解中途切换文件就卡死"的那一处（D77）。原先这条分支直接
     *         `return visible`，而调用方接下来要做两件只在活动编辑器上才有效的事：
     *         `setDecorations` 画在用户没看的标签上（屏幕上看不见），
     *         `revealRange` 对非活动编辑器**什么都不做**（不会滚、也不会切过去）。
     *         于是用户一旦手动切走（或讲解期间自己点开了别的文件），
     *         后续每一拍都"画在别的标签上"——屏幕上不再有任何变化，
     *         看着就是讲解卡死了，而状态机其实一直在正常推进。
     *
     * 为什么不能只调 `showTextDocument(doc)`：那会**重建预览标签**，
     * 正是 D70 要消除的抖动。`visibleTextEditors` 里那一个已经是我们想要的编辑器对象，
     * 直接把它设为活动编辑器即可（同一份 document，标签不重建）。
     */
    const visible = vscode.window.visibleTextEditors.find((e) => normPath(e.document.uri.fsPath) === want);
    if (visible) {
      this.#editors.set(want, visible);
      await this.#focus(visible);
      return visible;
    }

    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
      const editor = await vscode.window.showTextDocument(doc, {
        // 侧边栏保有焦点，用户读完还能直接按键继续，不必先点回编辑器
        preserveFocus: true,
        // **预览标签**（D69/S9c 的落地约束）：跨文件讲解会经过好几个文件，
        // 每个都开一个常驻标签，标签栏很快就堆满了 —— 预览标签会被下一个替换，不堆积。
        // 仍然是 `ViewColumn.One`：**不开右侧列、不分屏**（"同时只有一个文件可见"）
        preview: true,
        viewColumn: vscode.ViewColumn.One,
      });
      this.#editors.set(want, editor);
      return editor;
    } catch {
      return undefined;
    }
  }

  /**
   * 把一个**已经打开**的编辑器切到前台（成为 `activeTextEditor`），必要时切它所在的编辑器组。
   *
   * @anchor 两条路是**分层的**，不是重复：
   *   1. `showTextDocument`（带 `preserveFocus`）是官方手段，但它对"已经在别的组里可见"
   *      的文件会**换组显示**，可能重建标签 —— 我们只在必须时才用它。
   *   2. 目标是**当前组**里的另一个标签时（最常见：用户手动点开了另一个文件），
   *      用 `workbench.action.openEditorAtIndex` 之外的官方 API 没有直接办法，
   *      所以退一步用 `showTextDocument` 但**复用已有 document 对象** —— 同一个 document
   *      不会被重新解析，标签也不会被替换成新的（只是被激活）。
   *
   * 失败一律吞掉：切前台失败不该让这一拍的高亮整个消失（框仍然会画在那个编辑器上，
   * 用户切回来就看得到），更不该把异常带进会话。
   */
  async #focus(editor: vscode.TextEditor): Promise<void> {
    // 已经是活动编辑器就不用做任何事（调用方其实已经判过一次，这里是二次保险）
    if (vscode.window.activeTextEditor === editor) return;
    try {
      await vscode.window.showTextDocument(editor.document, {
        // 面板/侧边栏保有键盘焦点：用户读完还能直接按 Alt+] 继续，不必点回编辑器
        preserveFocus: true,
        // 不新建：让 VS Code 复用这份 document 已经打开的编辑器（若不支持该选项，
        // 它也只是退化成"按默认策略打开同一份文档"，行为仍正确）
        preview: true,
        viewColumn: vscode.ViewColumn.One,
      });
    } catch {
      // 切不过去（编辑器正在关闭、或该组被锁）时降级为"只画框、不抢前台"，
      // 与 `#renderOnce` 里"打不开目标文件就静默退化"同一种立场
    }
  }

  async #reveal(editor: vscode.TextEditor, range: vscode.Range): Promise<void> {
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  }
}
