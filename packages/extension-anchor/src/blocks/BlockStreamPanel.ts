/**
 * 块流面板的宿主侧（S-P2）：建面板、收消息、重画。
 *
 * @anchor 这个类**不存任何真相**（§12.4.2）：块流、队列、索引都在调用方（`commands.ts`）
 *         手里的 `StreamState` 上。面板只做三件事 —— 把状态画出来、把用户动作转成
 *         `streamHost` 里的纯函数调用、把结果交回去重画。
 *
 * **重画 = 重设整个 HTML**，而不是增量 DOM 更新。理由有三条：
 *   1. 真相只有一份（宿主），客户端永远只画宿主给的那一份 —— 不会出现"DOM 里还留着
 *      已经不在队列里的徽标"这种两套状态；§12.4.2 那条纪律因此是**结构上成立**的，
 *      而不是靠客户端自觉。
 *   2. 卡片是纯 HTML（图块是 dataURL），没有需要保留的组件状态；
 *   3. 块的数量是"一篇文章"的量级（几十到几百），重画一次的代价远小于维护两套状态的风险。
 * 唯一需要保住的是**滚动位置** —— 客户端用 `vscode.setState` 存一下、加载后恢复
 * （见 `ui/clientScript.ts` 的滚动那一段）：用户点到第 40 块时重画跳回顶部是不能接受的。
 */

import * as vscode from 'vscode';
import { parseBlockMessage } from '../protocol.ts';
import { renderBlockStreamHtml } from './ui/html.ts';
import { askPayloadOf, cleared, cycledMode, orderTextOf, ranged, reconciled, summaryOf, toggled, viewOf } from './streamHost.ts';
import type { AskPayload, StreamState } from './streamHost.ts';
import type { ExplainLanguage } from '../prompts/index.ts';

export interface BlockStreamHandlers {
  /**
   * 用户按了「问 AI」：宿主拿这个 payload 走既有编排（`explain(anchor)`）。
   * **面板不自己发请求、也不知道发到哪** —— 它只把"用户要问这几块"交出去。
   */
  onAsk(payload: AskPayload): void;
  /** 队列与块流对不齐时（图注被并掉、混进了别的文档的块）说一句 —— 用户选过的东西不该无声消失 */
  onAligned?(info: { folded: readonly string[]; orphans: readonly string[] }): void;
  /** 状态变了（宿主可能要刷新状态栏之类的别处） */
  onState?(state: StreamState): void;
}

export class BlockStreamPanel {
  /** webview 的类型 id，与 `package.json` 里的命令同一条命名线 */
  static readonly viewType = 'anchorExplain.blocks';
  /** 单例：同一时刻只该有一个块流窗口（用户再点一次命令应当是"把它拿到前面来"） */
  static #current: BlockStreamPanel | undefined;

  readonly #panel: vscode.WebviewPanel;
  readonly #handlers: BlockStreamHandlers;
  #state: StreamState;
  #fontScale: number;
  #language: ExplainLanguage;
  #disposed = false;

  private constructor(
    panel: vscode.WebviewPanel,
    state: StreamState,
    handlers: BlockStreamHandlers,
    fontScale: number,
    language: ExplainLanguage,
  ) {
    this.#panel = panel;
    this.#state = state;
    this.#handlers = handlers;
    this.#fontScale = fontScale;
    this.#language = language;
    panel.webview.options = { enableScripts: true, localResourceRoots: [] };
    panel.webview.onDidReceiveMessage((raw: unknown) => this.#onMessage(raw));
    panel.onDidDispose(() => {
      this.#disposed = true;
      if (BlockStreamPanel.#current === this) BlockStreamPanel.#current = undefined;
    });
    this.#refresh();
  }

  /** 打开（或把已有的拿到前面）并画上这份块流 */
  static show(
    state: StreamState,
    handlers: BlockStreamHandlers,
    opts: { fontScale?: number; language?: ExplainLanguage; beside?: boolean } = {},
  ): BlockStreamPanel {
    if (BlockStreamPanel.#current !== undefined && !BlockStreamPanel.#current.#disposed) {
      BlockStreamPanel.#current.setState(state);
      BlockStreamPanel.#current.reveal();
      return BlockStreamPanel.#current;
    }
    const panel = vscode.window.createWebviewPanel(
      BlockStreamPanel.viewType,
      `Anchor 块流 · ${state.doc.sourceName}`,
      opts.beside === true ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
      {
        enableScripts: true,
        // 保留 DOM：面板被折叠/切走再回来时不必等重画（与侧边栏同一条理由）
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );
    const created = new BlockStreamPanel(panel, state, handlers, opts.fontScale ?? 1, opts.language ?? 'zh');
    BlockStreamPanel.#current = created;
    return created;
  }

  static get current(): BlockStreamPanel | undefined {
    return BlockStreamPanel.#current;
  }

  get state(): StreamState {
    return this.#state;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /** 换一份块流（新文档 / 重新拆块）。队列由调用方决定要不要带过来（D100 的 ID 认回） */
  setState(state: StreamState): void {
    if (this.#disposed) return;
    this.#state = state;
    this.#panel.title = `Anchor 块流 · ${state.doc.sourceName}`;
    this.#refresh();
  }

  /** 关了面板但状态留着 —— 命令再点时不该从头拆一次（拆一份 30 页 PDF 要几秒） */
  reveal(): void {
    if (this.#disposed) return;
    this.#panel.reveal(undefined, true);
  }

  /** 字号/语言变了：面板上那份文案要跟着走（与侧边栏同一套做法） */
  setStyle(opts: { fontScale?: number; language?: ExplainLanguage }): void {
    if (opts.fontScale !== undefined) this.#fontScale = opts.fontScale;
    if (opts.language !== undefined) this.#language = opts.language;
    this.#refresh();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#panel.dispose();
  }

  /**
   * 一条消息进来。**先过守卫**（`parseBlockMessage`），再过业务（id 认不认识）。
   * 两条分开的理由见 protocol.ts：守卫管"能不能读"，业务管"能不能做"。
   */
  #onMessage(raw: unknown): void {
    const message = parseBlockMessage(raw);
    if (message === null) return;

    if (message.type === 'blocks:ask') {
      const payload = askPayloadOf(this.#state);
      // 空队列时按钮是禁的，但**宿主不靠界面自觉**：判据在这里再说一次
      if (payload !== null) this.#handlers.onAsk(payload);
      return;
    }

    const before = this.#state;
    if (message.type === 'blocks:toggle') this.#state = toggled(this.#state, message.blockId);
    else if (message.type === 'blocks:range') this.#state = ranged(this.#state, message.from, message.to);
    else if (message.type === 'blocks:mode') this.#state = cycledMode(this.#state);
    else this.#state = cleared(this.#state);

    if (this.#state === before) return;      // 没变就不重画（点空白、越界的 id 都会走到这）

    // 队列与块流对齐：图注被并进图卡时把队列里的图注 ID 改写成图卡 ID，
    // 混进来的别的文档的块清掉 —— 并**说一句**（用户选过的东西不该无声消失，D81）
    const aligned = reconciled(this.#state);
    this.#state = aligned.state;
    if (aligned.folded.length > 0 || aligned.orphans.length > 0) this.#handlers.onAligned?.(aligned);

    this.#refresh();
    this.#handlers.onState?.(this.#state);
  }

  #refresh(): void {
    const view = viewOf(this.#state);
    this.#panel.webview.html = renderBlockStreamHtml(
      this.#panel.webview.cspSource,
      {
        docLabel: this.#state.doc.label,
        summary: summaryOf(this.#state, view),
        view,
        orderText: orderTextOf(this.#state),
        queued: this.#state.queue.picked.length,
      },
      this.#fontScale,
      this.#language,
    );
  }
}
