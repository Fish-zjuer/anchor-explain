/**
 * 线1（代码编辑器）扩展的入口 —— 目前只到「F2 骨架」程度：
 * 扩展能被激活、命令能出现在命令面板、能证明 `@anchor/core` 真的被链接进来了。
 *
 * F2 刻意**只贡献一个命令**。§4.1 里其余命令（capture / next / prev / stop …）
 * 在 S1 才有处理函数 —— 提前把没有实现的命令写进 package.json，
 * 用户点了只会得到「命令未找到」，比没有更糟。
 *
 * @anchor 装配顺序（S1 起）：commands → sidebar → playback → statusbar，
 *         四层之间只通过 `@anchor/core` 的类型与 ports 通信。
 */

import * as vscode from 'vscode';
import { locationLabel, type CodeLocation } from '@anchor/core';

/** 线2 的扩展 ID（D27）。对端缺失时必须明确提示，不静默失败。 */
const PEER_EXTENSION_ID = 'anchor.anchor-pdf';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand('anchorExplain.showState', showState));
}

export function deactivate(): void {
  // 目前无需清理：所有一次性资源都进了 context.subscriptions
}

/**
 * 骨架自检命令。它同时是一次**接线验证**：
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
