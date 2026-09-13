/**
 * 线1（代码编辑器）扩展入口。
 *
 * @anchor 这里只做一件事：把 `context` 交给 `commands.ts` 完成四层装配。
 *         入口越薄，越不容易出现"某处顺手 import 了 vscode 破坏分层"的情况。
 */

import * as vscode from 'vscode';
import { registerCommands } from './commands.ts';

export function activate(context: vscode.ExtensionContext): void {
  registerCommands(context);
  console.log('[anchor] anchor-explain 已激活');
}

export function deactivate(): void {
  // 一次性资源（命令、装饰类型、状态栏、webview 面板）全部进了 context.subscriptions
}
