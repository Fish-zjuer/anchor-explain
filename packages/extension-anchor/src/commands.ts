/**
 * 四层装配 + §4.1 全部命令。事实源：docs/CONTRACTS.md §4.1。
 *
 * @anchor 本文件是整个线1 里**唯一**知道"假货在哪"的地方。两个替身各占一行，各自标注了
 *         替换时机，S2 / S3 只需要删掉或改掉那一行 —— 中间链路
 *         （校验 → 会话 → decoration → 侧边栏 → 状态栏）一行不用动。
 *
 * 装配顺序（STATE.md 里写死的）：commands → sidebar → playback → statusbar。
 */

import * as path from 'node:path';
import { existsSync } from 'node:fs';
import * as vscode from 'vscode';
import { AnchorError, describeError, isCodeLocation, locationLabel } from '@anchor/core';
import type {
  Anchor,
  CodeLocation,
  EditorPort,
  EditorSelection,
  ExplainProvider,
  ExplanationResult,
  FileSystemPort,
} from '@anchor/core';
import { createFakeEditorPort, FAKE_FILE_PATH } from '@anchor/core/fakes/fakeEditorPort';
import { fakeProvider } from '@anchor/core/fakes/fakeProvider';
import { describeIssues, validateExplanation } from './orchestrator/validateExplanation.ts';
import { isAnchorLike } from './protocol.ts';
import { CodeWalkthroughPlayer } from './playback/CodeWalkthroughPlayer.ts';
import { WalkthroughSession } from './playback/WalkthroughSession.ts';
import type { WalkthroughSnapshot } from './playback/WalkthroughSession.ts';
import { SidebarPanel } from './sidebar/SidebarPanel.ts';
import type { SidebarHandlers } from './sidebar/SidebarPanel.ts';
import { createStatusBar } from './sidebar/statusBar.ts';
import { samePath } from './paths.ts';
import { createEditorPort } from './vscode/ports/editorPort.ts';
import { countLines, createFileSystemPort } from './vscode/ports/fileSystemPort.ts';

/** 线2 的扩展 ID（D27）。对端缺失时必须明确提示，不静默失败。 */
const PEER_EXTENSION_ID = 'anchor.anchor-pdf';

export function registerCommands(context: vscode.ExtensionContext): void {
  const fsPort: FileSystemPort = createFileSystemPort();

  const realEditorPort = createEditorPort();

  // ★ S2 接线点（唯一）：删掉下面两行里对 getSelection 的覆盖，真选区即刻生效。
  //   其余三个方法（revealLocation / documentTextHash / getActiveFilePath）从 S1 起就是真的。
  const fakeSelection = createFakeEditorPort({ filePath: resolveS1FixturePath() });
  const editorPort: EditorPort = { ...realEditorPort, getSelection: () => fakeSelection.getSelection() };

  // ★ S3 接线点（唯一）：换成 orchestrator 循环（真实 AI + fetch_context 取件）。
  const provider: ExplainProvider = fakeProvider;

  const status = createStatusBar(context);

  let player: CodeWalkthroughPlayer | undefined;
  let sidebar: SidebarPanel | undefined;
  let session: WalkthroughSession | undefined;
  let unsubscribe: (() => void) | undefined;
  /** 每次 explain() 领一个号：慢的那次回来时若号已过期，就丢弃它的结果（见 explain） */
  let generation = 0;

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
      if (step) void playerOf().revealStep(step);
    },
  };

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

  /** 三个渲染方读的是同一份快照，所以"侧边栏说第 2 步、编辑器高亮第 3 步"不可能发生。 */
  function emit(snapshot: WalkthroughSnapshot): void {
    // 渲染是异步的（先把目标文件打开到编辑器里）。这里兜住 rejection：
    // 讲解过程中一次渲染失败不该让扩展宿主崩掉 —— 侧边栏的文字仍然是有用的。
    void playerOf()
      .render(snapshot)
      .catch((err: unknown) => console.error('[anchor] decoration 渲染失败：', err));

    sidebar?.post({
      type: 'session:update',
      result: snapshot.result,
      index: snapshot.index,
      state: snapshot.state,
    });
    status.update(snapshot);
    setActive(snapshot.state !== 'idle' && snapshot.state !== 'done');
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
    unsubscribe?.();
    unsubscribe = undefined;
    session?.dispose();
    session = undefined;
    player?.clear();
    status.hide();
    setActive(false);
    setContextKey('anchorExplain.sessionOpen', false);
    // 面板不清空：讲解文字留着，用户还能回看。侧边栏据此显示"已结束"。
    sidebar?.post({ type: 'session:end' });
  }

  /**
   * 捕获 → 请求 → 校验 → 开会话。**校验失败一律不渲染**（§3.3 第 5 条），
   * 而不是"能画多少画多少" —— 错位的荧光笔比没有荧光笔更糟。
   */
  async function explain(anchor: Anchor): Promise<void> {
    stop();
    const gen = (generation += 1);
    status.showBusy('正在讲解…');

    try {
      const result = await provider(anchor);
      // 期间用户又发起了一次：这次的结果已经过期，直接丢掉。
      // 没有这道闸，先发后到的那次会把 UI 拽回旧讲解（S3 接上真 AI 后必然遇到）。
      if (gen !== generation) return;

      const outline = isCodeLocation(anchor.location)
        ? { documentLineCount: await countLines(fsPort, anchor.location.filePath), pageCount: null }
        : { documentLineCount: null, pageCount: null };

      const verdict = validateExplanation(result, anchor, outline);
      if (!verdict.ok) {
        throw new AnchorError('SCHEMA_VIOLATION', `AI 输出未通过校验：${describeIssues(verdict.issues)}`, {
          issues: verdict.issues,
        });
      }

      startSession(verdict.result);
    } catch (err) {
      if (gen !== generation) return;
      status.hide();
      setActive(false);
      setContextKey('anchorExplain.sessionOpen', false);
      void vscode.window.showErrorMessage(`Anchor：${describeError(err)}`);
    }
  }

  /**
   * 从选区组装 Anchor。
   *
   * S2 会把这段搬进 `adapters/CodeAdapter.ts` 的 `capture()`（§3.1 的能力矩阵），
   * S1 先留在装配层：手里只有一条来源线，提前抽接口等于凭空猜第二个消费者的形状。
   */
  async function buildAnchor(selection: EditorSelection): Promise<Anchor> {
    const location: CodeLocation = {
      filePath: selection.filePath,
      lineStart: selection.lineStart,
      lineEnd: selection.lineEnd,
    };
    const hash = await editorPort.documentTextHash(selection.filePath);

    return {
      sourceType: 'code',
      // 文档指纹：会话记忆与 staleness 都用它，取不到就退化成路径
      sourceId: hash ?? selection.filePath,
      sourceName: vscode.workspace.asRelativePath(vscode.Uri.file(selection.filePath)),
      location,
      extractedText: selection.text,
    };
  }

  async function capture(): Promise<void> {
    const selection = await editorPort.getSelection();
    if (!selection) {
      void vscode.window.showWarningMessage('Anchor：先在编辑器里选中一段代码。');
      return;
    }
    await explain(await buildAnchor(selection));
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
   * 骨架自检命令（F2 遗留）。它同时是一次**接线验证**：
   * `locationLabel` 来自 `@anchor/core`，能正常输出就说明 workspace 链接与打包都通了。
   */
  function showState(): void {
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

    const peer = vscode.extensions.getExtension(PEER_EXTENSION_ID);
    parts.push(`对端 anchor-pdf：${peer ? '已安装' : '未安装'}`);

    const line = parts.join(' · ');
    console.log('[anchor] showState:', line);
    void vscode.window.showInformationMessage(`Anchor：${line}`);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('anchorExplain.capture', capture),
    vscode.commands.registerCommand('anchorExplain.explainAnchor', explainAnchor),
    vscode.commands.registerCommand('anchorExplain.next', next),
    vscode.commands.registerCommand('anchorExplain.prev', prev),
    vscode.commands.registerCommand('anchorExplain.stop', stop),
    vscode.commands.registerCommand('anchorExplain.goto', goto),
    vscode.commands.registerCommand('anchorExplain.playPause', playPause),
    vscode.commands.registerCommand('anchorExplain.showState', showState),

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
      },
    },
  );
}

/**
 * ── S1 脚手架（S2 删除）──
 *
 * 假选区里的路径是**仓库相对**的（`test/fixtures/main.c`），而 F5 调试宿主打开的工作区是
 * `test/fixtures`。真选区走 `document.uri.fsPath`，天生绝对路径，不需要这一步。
 *
 * 两个候选依次试：先「工作区根 + 文件名」（配合 .vscode/launch.json 的工作区设置命中），
 * 再「工作区根 + 整个相对路径」（工作区开的是仓库根时命中）。都不在就退回相对路径 ——
 * 那会让行数上界检查退化为跳过（`countLines` 返回 null），但讲解本身照常走。
 */
function resolveS1FixturePath(): string {
  const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  for (const root of roots) {
    for (const candidate of [path.join(root, path.basename(FAKE_FILE_PATH)), path.join(root, FAKE_FILE_PATH)]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return FAKE_FILE_PATH;
}
