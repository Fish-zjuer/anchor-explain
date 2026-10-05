/**
 * 侧边栏宿主侧：建面板、发消息、收消息。渲染逻辑全在 `ui/`（原生 DOM，无 React，见 D12）。
 *
 * @anchor 这里有一处必须解释的设计：**消息重放**。
 * webview 的 DOM 生命周期与宿主无关 —— 用户关掉面板再触发一次讲解时，
 * 新 webview 的脚本才刚 `acquireVsCodeApi()`，宿主紧接着 post 的消息会丢在它订阅之前。
 * 所以客户端一启动就发 `ui:ready`（protocol.ts 里说明了为什么非加不可），
 * 宿主收到后把最近的若干条消息原样重放，webview 因此**不需要自己持久化任何状态**。
 */

import * as vscode from 'vscode';
import { parseSidebarMessage } from '../protocol.ts';
import type { HostToSidebar } from '../protocol.ts';
import type { ExplainLanguage } from '../prompts/index.ts';
import { DEFAULT_SIDEBAR_STYLE, type SidebarStyle } from '../config.ts';
import type { TokenUsage } from '../orchestrator/providers/types.ts';
import type { ResolvedChords } from './keybindingResolve.ts';
import { renderSidebarHtml } from './ui/html.ts';

export interface SidebarHandlers {
  onNext(): void;
  onPrev(): void;
  onGoto(index: number): void;
  onStop(): void;
  onRevealStep(index: number): void;
  /** D83：把上次那份讲解从第 1 步再走一遍（不碰网络） */
  onReplay(): void;
  /** D83：拿同一个锚点再问一次模型（贵，但会得到另一种讲法） */
  onReExplain(): void;
  /** D89：字号调节。合法范围与持久化都在宿主（commands.ts），面板只管喊一声 */
  onFontLarger(): void;
  onFontSmaller(): void;
  /** D89：把上次那份讲解导出成 Markdown 文件 */
  onExport(): void;
  /** D89：打开讲解历史文件夹 */
  onOpenHistory(): void;
  /** S13：打开完整留档的历史面板。 */
  onHistoryPanel(): void;
  /** D126：对第 `index` 步追问一句（面板上的输入框 + 那颗按钮） */
  onAsk(index: number, question: string): void;
}

/** 重放缓冲上限：侧边栏的消息量很小，50 条足够覆盖一次会话 */
const REPLAY_LIMIT = 50;

export class SidebarPanel {
  readonly #panel: vscode.WebviewPanel;
  readonly #handlers: SidebarHandlers;
  readonly #replay: HostToSidebar[] = [];
  #disposed = false;
  /** 当前的字号缩放系数（D89）。`ui:ready` 重放完补发它 —— 重建的面板不丢样式。 */
  #fontScale: number;
  /** 面板文案的语言（D97）。建面板那一刻的设置值就是初值；讲解中途切换要下一次讲解才生效。 */
  readonly #language: ExplainLanguage;
  /**
   * 排版风格（D129）。与 `#language` 同一条约定：**建面板那一刻的设置值就是初值**，
   * 中途改设置要下一次讲解（或重建面板）才生效 —— 它改的是内联进 HTML 的常量与
   * `<body data-anchor-style>`，而这两样都是建面板时一次性写死的。
   */
  readonly #sidebarStyle: SidebarStyle;
  /**
   * 本次讲解累计的 token 用量（D120/S13）。这里仅缓存展示值；完整留档由命令层负责。
   * 存一份的理由与 `#fontScale` 相同 —— `ui:ready` 之后要补发，
   * 面板重建（折叠再展开）时不至于把那行数字丢掉。
   */
  #usage: TokenUsage | null = null;
  /**
   * 追问的状态（D126）。与 `#usage` 同一条理由存一份：`ui:ready` 之后要补发，
   * 面板重建（折叠再展开）时不至于把"这一问正在跑"丢掉 —— 那会让人以为它没在动，
   * 于是又按一次（而第二次会被宿主的忙碌判定挡掉，屏幕上就只剩困惑）。
   */
  #ask: { index: number; state: 'running' | 'idle' | 'error'; message?: string } | null = null;

  private constructor(
    panel: vscode.WebviewPanel,
    handlers: SidebarHandlers,
    chords: ResolvedChords,
    fontScale: number,
    language: ExplainLanguage,
    sidebarStyle: SidebarStyle,
  ) {
    this.#panel = panel;
    this.#handlers = handlers;
    this.#fontScale = fontScale;
    this.#language = language;
    this.#sidebarStyle = sidebarStyle;

    panel.webview.html = renderSidebarHtml(
      panel.webview.cspSource,
      chords,
      fontScale,
      language,
      sidebarStyle,
    );

    panel.webview.onDidReceiveMessage((raw: unknown) => {
      // webview 发来的东西一样当外部输入：形状不对直接丢，不让坏数据进链路
      const msg = parseSidebarMessage(raw);
      if (!msg) return;

      switch (msg.type) {
        case 'ui:ready':
          for (const m of this.#replay) void this.#panel.webview.postMessage(m);
          // 重放里那条 ui:fontScale 可能已经被挤出去（缓冲只有 50 条），
          // 所以 ready 之后**总是**补发一次当前的值 —— 面板不需要自己持久化任何状态
          void this.#panel.webview.postMessage({ type: 'ui:fontScale', scale: this.#fontScale });
          // token 那一行同理（D120）：它可能在面板存在之前就已经发过一轮
          void this.#panel.webview.postMessage({ type: 'ui:usage', usage: this.#usage });
          // 追问状态同理（D126）：面板重建时若那一问还在跑，得让它照旧显示"追问中…"
          if (this.#ask) void this.#panel.webview.postMessage({ type: 'ask:state', ...this.#ask });
          break;
        case 'ui:next':
          this.#handlers.onNext();
          break;
        case 'ui:prev':
          this.#handlers.onPrev();
          break;
        case 'ui:goto':
          this.#handlers.onGoto(msg.index);
          break;
        case 'ui:revealStep':
          this.#handlers.onRevealStep(msg.index);
          break;
        case 'ui:stop':
          this.#handlers.onStop();
          break;
        case 'ui:replay':
          this.#handlers.onReplay();
          break;
        case 'ui:reExplain':
          this.#handlers.onReExplain();
          break;
        case 'ui:fontLarger':
          this.#handlers.onFontLarger();
          break;
        case 'ui:fontSmaller':
          this.#handlers.onFontSmaller();
          break;
        case 'ui:export':
          this.#handlers.onExport();
          break;
        case 'ui:openHistory':
          this.#handlers.onOpenHistory();
          break;
        case 'ui:showHistory':
          this.#handlers.onHistoryPanel();
          break;
        case 'ui:ask':
          this.#handlers.onAsk(msg.index, msg.question);
          break;
      }
    });

    panel.onDidDispose(() => {
      this.#disposed = true;
    });
  }

  /**
   * `chords` 是**用户实际绑定**解析后的键位，会被内联进 webview，好让面板有焦点时
   * 客户端能自己派发 next / prev / stop（见 D47）。`fontScale` 同理内联（D89）：
   * 建面板那一刻的系数就是初值，之后的变更走 `setFontScale`。
   * `language` 同理内联（D97）：决定面板文案（按钮/徽章/日志）用中英哪一套。
   */
  static create(
    handlers: SidebarHandlers,
    chords: ResolvedChords,
    fontScale: number,
    language: ExplainLanguage = 'zh',
    sidebarStyle: SidebarStyle = DEFAULT_SIDEBAR_STYLE,
  ): SidebarPanel {
    const panel = vscode.window.createWebviewPanel(
      'anchorExplain.sidebar',
      'Anchor 讲解',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        // 保留 DOM：面板被折叠再展开时不必等重放，观感更稳
        retainContextWhenHidden: true,
        // 全部资源内联，不需要任何本地资源根
        localResourceRoots: [],
      },
    );
    return new SidebarPanel(panel, handlers, chords, fontScale, language, sidebarStyle);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  post(message: HostToSidebar): void {
    if (this.#disposed) return;
    this.#replay.push(message);
    while (this.#replay.length > REPLAY_LIMIT) this.#replay.shift();
    void this.#panel.webview.postMessage(message);
  }

  /**
   * 字号变了（D89）。**存一份再发**：发的这条进重放缓冲（面板重建时照常收到），
   * 而这份字段保证 `ui:ready` 之后补发的那个值永远是最新的。
   */
  setFontScale(scale: number): void {
    this.#fontScale = scale;
    this.post({ type: 'ui:fontScale', scale });
  }

  /**
   * token 用量更新了（D120）。与 `setFontScale` 同一个套路：**存一份再发**。
   * `null` = 这次一个数都没拿到（端点没返回 `usage`），面板据此说"未提供"。
   */
  setUsage(usage: TokenUsage | null): void {
    this.#usage = usage;
    this.post({ type: 'ui:usage', usage });
  }

  /**
   * 追问的状态变了（D126）。`message` 只在 `state === 'error'` 时有意义 ——
   * 失败原因要显示在**被追问的那一块下面**，而不是弹一个与面板失去关联的通知。
   * `state === 'idle'` 且没有 message = 这一问结束了（成功或放弃），面板清掉标记。
   */
  setAskState(index: number, state: 'running' | 'idle' | 'error', message?: string): void {
    this.#ask = message === undefined ? { index, state } : { index, state, message };
    this.post({ type: 'ask:state', ...this.#ask });
  }

  reveal(): void {
    if (this.#disposed) return;
    this.#panel.reveal(vscode.ViewColumn.Beside, true);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#panel.dispose();
  }
}
