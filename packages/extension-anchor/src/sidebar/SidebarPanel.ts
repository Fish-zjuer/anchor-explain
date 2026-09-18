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
}

/** 重放缓冲上限：侧边栏的消息量很小，50 条足够覆盖一次会话 */
const REPLAY_LIMIT = 50;

export class SidebarPanel {
  readonly #panel: vscode.WebviewPanel;
  readonly #handlers: SidebarHandlers;
  readonly #replay: HostToSidebar[] = [];
  #disposed = false;

  private constructor(panel: vscode.WebviewPanel, handlers: SidebarHandlers, chords: ResolvedChords) {
    this.#panel = panel;
    this.#handlers = handlers;

    panel.webview.html = renderSidebarHtml(panel.webview.cspSource, chords);

    panel.webview.onDidReceiveMessage((raw: unknown) => {
      // webview 发来的东西一样当外部输入：形状不对直接丢，不让坏数据进链路
      const msg = parseSidebarMessage(raw);
      if (!msg) return;

      switch (msg.type) {
        case 'ui:ready':
          for (const m of this.#replay) void this.#panel.webview.postMessage(m);
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
      }
    });

    panel.onDidDispose(() => {
      this.#disposed = true;
    });
  }

  /**
   * `chords` 是**用户实际绑定**解析后的键位，会被内联进 webview，好让面板有焦点时
   * 客户端能自己派发 next / prev / stop（见 D47）。
   */
  static create(handlers: SidebarHandlers, chords: ResolvedChords): SidebarPanel {
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
    return new SidebarPanel(panel, handlers, chords);
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
