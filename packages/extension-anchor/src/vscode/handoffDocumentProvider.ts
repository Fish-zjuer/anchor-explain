/**
 * 临时位置文档的内容提供者（`anchor-handoff:` scheme）。事实源：docs/DECISIONS.md D130 第四节。
 *
 * @anchor **为什么不用 `untitled:`**（这是这一片最重要的技术决策）：
 *         `untitled:` 文档**用户可以编辑** —— 而他只要删一行、改一个字，
 *         我们的"文档第 N 行 = 源文件第 M 行"那张表就**静默错位**了。
 *         错位的后果不是报错，是**讲错东西** —— 那是用户最难发现的失败
 *         （他会以为"模型讲得不好"，而真因在我们的映射上）。
 *
 *         所以用自定义 scheme：`TextDocumentContentProvider` 提供内容，
 *         **VS Code 对非 file scheme 默认只读** → 用户改不了 → 表永远有效。
 *         代价是这一个文件（约 30 行），换的是"映射不可能错"。
 *
 * 内容由这个对象**持有着**（不是从磁盘读、也不持久化）：
 * 用户的原始要求是"这个文件不立即消失…直到下次输入覆盖" —— 也就是它活在**这一次会话**里。
 */

import * as vscode from 'vscode';
import { HANDOFF_SCHEME, HANDOFF_URI_PATH } from '../external/handoffDoc.ts';

export interface HandoffDocumentHost {
  /** 当前内容。`undefined` = 还没有任何一份（按钮据此说"先粘一段位置"）。 */
  get(): string | undefined;
  /** 覆盖内容（用户下一次输入）。**同一个 URI**，所以标签页是原地刷新，不堆新的。 */
  set(text: string): void;
}

export interface HandoffDocumentProvider extends vscode.Disposable {
  /** 临时文档的 URI。**固定不变** —— 这正是"原地覆盖"与"再呼出置顶同一个"的实现基础。 */
  readonly uri: vscode.Uri;
  /** 内容变了之后叫醒 VS Code 重画（`onDidChange` 那一枪）。 */
  refresh(): void;
  /** 当前内容（供宿主侧判断"有没有东西可讲"）。 */
  readonly host: HandoffDocumentHost;
}

/**
 * 建 provider 并注册。
 *
 * @anchor 为什么用 `vscode.workspace.registerTextDocumentContentProvider` 而不是
 *         `vscode.workspace.openTextDocument({content})`（那个也能开只读文档）：
 *         后者的 URI 每次调用都是新的 —— 于是"再呼出置顶原本那份"与"原地覆盖"
 *         就都做不到（两个要求都是用户明确提的）。固定 URI 才能"同一份"。
 */
export function createHandoffDocumentProvider(): HandoffDocumentProvider {
  let content: string | undefined;

  const emitter = new vscode.EventEmitter<vscode.Uri>();
  const uri = vscode.Uri.from({ scheme: HANDOFF_SCHEME, path: HANDOFF_URI_PATH });

  const registration = vscode.workspace.registerTextDocumentContentProvider(HANDOFF_SCHEME, {
    onDidChange: emitter.event,
    provideTextDocumentContent(asked: vscode.Uri): string {
      // 只认自己那一个 URI（别的东西来问就回空串，而不是把内容给它）
      if (asked.scheme !== HANDOFF_SCHEME || asked.path !== HANDOFF_URI_PATH) return '';
      return content ?? '';
    },
  });

  return {
    uri,
    host: {
      get: () => content,
      set: (text: string) => {
        content = text;
      },
    },
    refresh: () => emitter.fire(uri),
    dispose: () => {
      registration.dispose();
      emitter.dispose();
    },
  };
}

/**
 * 打开（或置顶）临时文档。
 *
 * @anchor `showTextDocument` 的第二个参数 `preview: false` 是**必须的**：
 *         默认 `true` 时它开的是**预览标签**，而预览标签会被下一个预览**顶掉** ——
 *         这恰好是用户说的"讲解切换文件丢掉路径"那个现象（D78 踩过同一个坑）。
 *         这一份文档存在的意义就是"一直在那儿"，所以它必须是**固定标签**。
 */
export async function openHandoffDocument(provider: HandoffDocumentProvider): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(provider.uri);
  await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
}
