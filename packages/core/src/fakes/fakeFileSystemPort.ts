/**
 * 假文件系统 —— `FileSystemPort` 后面的替身。
 *
 * @anchor 它和 `fakeEditorPort` 是同一类东西：**替身放在最外层边界**。
 *         S3 的 `CodeAdapter.fetchContext()` 要读文件，而"读文件"这件事的**决策**
 *         （取哪几行、行号怎么标）与"文件从哪来"无关 —— 所以决策可以全量单测，
 *         只要把来源换掉。这也让测试不必依赖 `test/fixtures/` 的真实内容。
 *
 * 本文件属 core，**禁止 import 'vscode'**。
 */

import type { FileSystemPort } from '../ports.ts';

export interface FakeFileSystemPortOptions {
  /** 路径 → 文本内容。查不到的路径按"文件不存在"处理 */
  files?: Record<string, string>;
  /** `readText` 一律抛这个错，用于验调用方的失败路径 */
  readError?: Error;
}

export interface FakeFileSystemPort extends FileSystemPort {
  /** `readText` 的调用记录，便于断言"确实只读了允许的那一个文件" */
  readonly readCalls: readonly string[];
}

/** 路径比较按反斜杠/正斜杠与大小写归一 —— 与 `paths.ts` 的 samePath 同一个立场 */
function key(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

export function createFakeFileSystemPort(opts: FakeFileSystemPortOptions = {}): FakeFileSystemPort {
  const files = new Map(Object.entries(opts.files ?? {}).map(([p, text]) => [key(p), text]));
  const readCalls: string[] = [];

  return {
    readCalls,
    readText(p: string): Promise<string> {
      readCalls.push(p);
      if (opts.readError) return Promise.reject(opts.readError);
      const found = files.get(key(p));
      if (found === undefined) return Promise.reject(new Error(`ENOENT: ${p}`));
      return Promise.resolve(found);
    },
    readBytes(p: string): Promise<Uint8Array> {
      readCalls.push(p);
      if (opts.readError) return Promise.reject(opts.readError);
      const found = files.get(key(p));
      if (found === undefined) return Promise.reject(new Error(`ENOENT: ${p}`));
      return Promise.resolve(new TextEncoder().encode(found));
    },
    exists(p: string): Promise<boolean> {
      return Promise.resolve(files.has(key(p)));
    },
  };
}
