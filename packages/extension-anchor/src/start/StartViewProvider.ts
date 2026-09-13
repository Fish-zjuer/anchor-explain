/**
 * 开始面板的宿主侧：活动栏那个固定按钮点开的就是它。
 *
 * @anchor 这个面板与侧边栏（`sidebar/SidebarPanel.ts`）的**根本差别**，是两者对
 *         "面板什么时候存在"这件事的假设不同：
 *
 *         - 侧边栏是**宿主建**的（`createWebviewPanel`），讲解一开始就把它顶出来，
 *           所以它必须处理"面板比消息晚"：靠重放缓冲。
 *         - 开始面板是**用户建**的 —— 活动栏图标一直挂在那儿（这就是"固定按钮"），
 *           但视图可能整个会话都没被点开过。所以宿主这边它随时可能是 `undefined`，
 *           而"现在是什么情况"是**一份快照**而不是事件流：谁 ready 谁拿一份现算的。
 *           两份心智模型强行统一（给这儿也加重放缓冲）只会带来一份没人读的缓冲。
 *
 * 于是 `refresh()` 在视图不存在时**什么都不做**：状态变化不需要排队等待，
 * 下一次 ready 会重新算一份 —— 快照天然覆盖旧快照。
 */

import * as vscode from 'vscode';
import { parseStartMessage } from '../protocol.ts';
import type { StartModel } from './startModel.ts';
import { renderStartHtml } from './ui/startHtml.ts';

export interface StartViewHandlers {
  /**
   * 面板点了某个动作。**只传 id，不传命令** —— 能不能执行由宿主查表决定（§5.5）。
   */
  onRun(id: string): void;
}

export class StartViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'anchorExplain.start';

  private readonly handlers: StartViewHandlers;
  /** 现算一份模型。每次 ready / 每次状态变化都算一次：面板显示的是**此刻**，不是历史。 */
  private readonly makeModel: () => Promise<StartModel>;
  private view: vscode.WebviewView | undefined;
  private disposed = false;

  private constructor(handlers: StartViewHandlers, makeModel: () => Promise<StartModel>) {
    this.handlers = handlers;
    this.makeModel = makeModel;
  }

  /** 注册进 `context.subscriptions`，生命周期交给宿主 —— 与两外两个渲染面一致。 */
  static register(
    context: vscode.ExtensionContext,
    handlers: StartViewHandlers,
    makeModel: () => Promise<StartModel>,
  ): StartViewProvider {
    const provider = new StartViewProvider(handlers, makeModel);

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(StartViewProvider.viewId, provider, {
        // 保留 DOM：用户在活动栏里切来切去时不必等重画
        webviewOptions: { retainContextWhenHidden: true },
      }),
      { dispose: () => provider.dispose() },
    );

    return provider;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = renderStartHtml(view.webview.cspSource);

    view.webview.onDidReceiveMessage((raw: unknown) => {
      // webview 发来的东西一律当外部输入：形状不对就丢（§5.5）
      const message = parseStartMessage(raw);
      if (!message) return;

      if (message.type === 'start:ready') {
        void this.refresh();
        return;
      }
      this.handlers.onRun(message.id);
    });

    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
  }

  /**
   * 状态变了推一份新的。**视图没开过就是空操作**（见文件头的理由）。
   *
   * 自己吞掉异常：面板是三个渲染面里最不重要的一个，它画不出来不该影响讲解，
   * 更不该让 `emit()` 的调用方看到异常（D49 的隔离规矩）。
   */
  async refresh(): Promise<void> {
    const view = this.view;
    if (!view || this.disposed) return;

    let model: StartModel;
    try {
      model = await this.makeModel();
    } catch (err) {
      console.error('[anchor] 开始面板取状态失败：', err);
      return;
    }

    // 现算期间视图可能已经被关掉
    if (this.view !== view || this.disposed) return;
    void view.webview.postMessage({ type: 'start:model', model });
  }

  dispose(): void {
    this.disposed = true;
    this.view = undefined;
  }
}
