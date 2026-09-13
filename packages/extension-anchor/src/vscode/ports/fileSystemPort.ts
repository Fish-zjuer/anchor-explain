/**
 * `FileSystemPort` 的 vscode 真实现。事实源：docs/CONTRACTS.md §2。
 *
 * @anchor 走 `vscode.workspace.fs` 而不是 `node:fs`：前者对 remote / 虚拟文件系统同样成立，
 *         后者会在这类工作区里静默读到空。代价是所有方法都是异步的 —— 接口本来也是 Promise。
 */

import * as vscode from 'vscode';
import type { FileSystemPort } from '@anchor/core';
import { countTextLines } from '../../paths.ts';

export function createFileSystemPort(): FileSystemPort {
  return {
    async readText(path: string): Promise<string> {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(path));
      return new TextDecoder('utf-8').decode(bytes);
    },

    async readBytes(path: string): Promise<Uint8Array> {
      return vscode.workspace.fs.readFile(vscode.Uri.file(path));
    },

    async exists(path: string): Promise<boolean> {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(path));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * 数一个文本文件有多少行。取不到返回 `null` —— 校验闸门（§3.3）把 `null` 当作
 * 「跳过行号上界检查」，而不是当作 0 行（那会把每一条 step 都判越界）。
 */
export async function countLines(fs: FileSystemPort, path: string): Promise<number | null> {
  try {
    return countTextLines(await fs.readText(path));
  } catch {
    return null;
  }
}
