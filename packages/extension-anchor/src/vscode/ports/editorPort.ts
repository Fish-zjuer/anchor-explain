/**
 * `EditorPort` 的 vscode 真实现。事实源：docs/CONTRACTS.md §2。
 *
 * @anchor S1 里 `getSelection` 是**被替身顶掉的**：`commands.ts` 用
 *         `fakes/fakeEditorPort.ts` 覆盖了这一个方法，其余三个方法（定位、哈希、活动文件）
 *         从第一天起就是真实现。**S2 已把那行覆盖删掉** —— 本文件现在是全部真实现，
 *         命令层拿到的选区就是编辑器里那个选区。
 *
 * 本文件是 core 之外的实现层：`core/` 不许 import 'vscode'，`vscode/` 负责兑现 core 的接口。
 */

import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
import type { CodeLocation, EditorPort, EditorSelection } from '@anchor/core';
import { samePath } from '../../paths.ts';

function findVisibleEditor(filePath: string): vscode.TextEditor | undefined {
  return vscode.window.visibleTextEditors.find((e) => samePath(e.document.uri.fsPath, filePath));
}

function findDocument(filePath: string): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find((d) => samePath(d.uri.fsPath, filePath));
}

export function createEditorPort(): EditorPort {
  return {
    async getSelection(): Promise<EditorSelection | null> {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return null;

      const sel = editor.selection;
      // 只放了光标（isEmpty）也返回 null：调用方要么提示"请选中一段"，要么退化成整文件。
      // 不在这里自作主张取当前行 —— 那是产品决策，不该藏在端口里。
      if (sel.isEmpty) return null;

      const doc = editor.document;
      const start = Math.min(sel.start.line, sel.end.line);
      const end = Math.max(sel.start.line, sel.end.line);

      // 取到最后一行的行尾为止，**不带末尾换行** —— 与 fakes/fakeEditorPort.ts 的
      // FAKE_SELECTION_TEXT 保持同一种形状，S2 换真选区时上层看不出差别。
      const text = doc.getText(new vscode.Range(start, 0, end, doc.lineAt(end).text.length));

      return {
        filePath: doc.uri.fsPath,
        lineStart: start + 1,
        lineEnd: end + 1,
        text,
      };
    },

    async getDocumentSelection(): Promise<EditorSelection | null> {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return null;

      const doc = editor.document;
      // 与 getSelection 同一种形状：取到最后一行的行尾为止，**不带末尾换行**。
      // 为什么不复用 getSelection 再退化：那会把"没选内容"和"要整个文件"混成一件事，
      // 而这两件事在 UI 上是两个不同的选项，必须能分别要。
      const last = doc.lineCount - 1;
      return {
        filePath: doc.uri.fsPath,
        lineStart: 1,
        lineEnd: doc.lineCount,
        text: doc.getText(new vscode.Range(0, 0, last, doc.lineAt(last).text.length)),
      };
    },

    async getActiveFilePath(): Promise<string | null> {
      return vscode.window.activeTextEditor?.document.uri.fsPath ?? null;
    },

    async revealLocation(loc: CodeLocation, opts?: { inCenter?: boolean }): Promise<void> {
      const editor = findVisibleEditor(loc.filePath);
      if (!editor) return;
      const range = new vscode.Range(loc.lineStart - 1, 0, loc.lineEnd - 1, 0);
      editor.revealRange(
        range,
        opts?.inCenter === false ? vscode.TextEditorRevealType.AtTop : vscode.TextEditorRevealType.InCenter,
      );
    },

    /**
     * 文档指纹。**优先取内存里的文档文本**：用户可能改了还没保存，
     * 而 staleness 要判的恰恰是"内容变了没有"，读磁盘会漏掉未保存的改动。
     */
    async documentTextHash(filePath: string): Promise<string | null> {
      try {
        const open = findDocument(filePath);
        const text = open
          ? open.getText()
          : new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(vscode.Uri.file(filePath)));
        return createHash('sha1').update(text, 'utf8').digest('hex');
      } catch {
        // 文件被删/无权限：返回 null 让上层放弃 staleness 检查，而不是把讲解打断
        return null;
      }
    },
  };
}
