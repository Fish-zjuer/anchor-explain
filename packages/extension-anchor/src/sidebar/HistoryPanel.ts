/** S13 历史列表。宿主只接收安全 ID，数据文本用 textContent，ready 后重放当前列表。 */
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { parseHistoryMessage } from '../session/archive.ts';
import type { ArchiveSummary } from '../session/archive.ts';
import { historyHtml } from './ui/historyHtml.ts';

export interface HistoryHandlers {
  onRefresh(): Promise<void>;
  onOpen(id: string): Promise<void>;
  onDelete(id: string): Promise<void>;
  onClear(): Promise<void>;
  onFolder(): Promise<void>;
}

export class HistoryPanel {
  readonly #panel: vscode.WebviewPanel;
  #disposed = false;
  #entries: readonly ArchiveSummary[] = [];
  #error = '';
  #note = '';
  #busy = false;
  #canClear = false;
  constructor(handlers: HistoryHandlers) {
    this.#panel = vscode.window.createWebviewPanel('anchorExplain.history', 'Anchor 讲解历史', vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true });
    this.#panel.webview.html = historyHtml(this.#panel.webview.cspSource, randomBytes(18).toString('base64'));
    this.#panel.webview.onDidReceiveMessage((raw: unknown) => {
      const message = parseHistoryMessage(raw);
      if (!message) return;
      if (message.type === 'history:ready') { this.#post(); return; }
      if (this.#busy) return;
      this.#busy = true;
      this.#error = '';
      this.#post();
      const action = Promise.resolve().then(() => message.type === 'history:refresh' ? handlers.onRefresh()
        : message.type === 'history:open' ? handlers.onOpen(message.id)
        : message.type === 'history:delete' ? handlers.onDelete(message.id)
        : message.type === 'history:clear' ? handlers.onClear() : handlers.onFolder());
      void action.catch((err: unknown) => { this.#error = err instanceof Error ? err.message : String(err); })
        .finally(() => { this.#busy = false; this.#post(); });
    });
    this.#panel.onDidDispose(() => { this.#disposed = true; });
  }
  get disposed(): boolean { return this.#disposed; }
  dispose(): void { this.#panel.dispose(); }
  reveal(): void { this.#panel.reveal(vscode.ViewColumn.Beside, true); }
  setEntries(entries: readonly ArchiveSummary[], note = '', hasDamaged = false): void { this.#entries = entries; this.#canClear = entries.length > 0 || hasDamaged; this.#note = note; this.#error = ''; this.#post(); }
  setError(error: string): void { this.#error = error; this.#post(); }
  #post(): void { if (!this.#disposed) void this.#panel.webview.postMessage({ type:'history:list', entries:this.#entries, canClear:this.#canClear, note:this.#note, error:this.#error, busy:this.#busy }); }
}
