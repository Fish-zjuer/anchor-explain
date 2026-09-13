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

  /** 渲染当前拍的框，并把视图滚到它上面。 */
  async render(snapshot: WalkthroughSnapshot): Promise<void> {
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
    const loc = primaryLocationOf(step);
    if (!loc) return;
    const editor = await this.#ensureEditor(loc.filePath);
    if (!editor) return;
    const range = toRange(loc, editor.document.lineCount);
    if (range) await this.#reveal(editor, range);
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
    for (const key of ALL_KEYS) this.#types[key].dispose();
  }

  async #ensureEditor(filePath: string): Promise<vscode.TextEditor | undefined> {
    const want = normPath(filePath);
    const visible = vscode.window.visibleTextEditors.find((e) => normPath(e.document.uri.fsPath) === want);
    if (visible) return visible;

    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
      return await vscode.window.showTextDocument(doc, {
        // 侧边栏保有焦点，用户读完还能直接按键继续，不必先点回编辑器
        preserveFocus: true,
        // **预览标签**（D69/S9c 的落地约束）：跨文件讲解会经过好几个文件，
        // 每个都开一个常驻标签，标签栏很快就堆满了 —— 预览标签会被下一个替换，不堆积。
        // 仍然是 `ViewColumn.One`：**不开右侧列、不分屏**（"同时只有一个文件可见"）
        preview: true,
        viewColumn: vscode.ViewColumn.One,
      });
    } catch {
      return undefined;
    }
  }

  async #reveal(editor: vscode.TextEditor, range: vscode.Range): Promise<void> {
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  }
}
