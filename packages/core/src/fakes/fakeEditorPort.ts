/**
 * 假选区 —— `EditorPort` 后面的替身，「选区从哪来」这一问的隔离点。
 *
 * S1 用它返回写死的第 40-48 行；S2 换成真实现（`vscode/ports/`）后，
 * 播放器、侧边栏、状态栏一行不动 —— 因为 S1 消费的是 `EditorPort` 接口本身，
 * 不是"假的 Selection 对象"。这就是把假货关在最外层边界的意义。
 *
 * 除了假选区，它还**记录** `revealLocation` / `documentTextHash` 的调用，
 * 好让单测能断言"确实定位到了目标行"、"确实做了 staleness 检查"。
 *
 * 本文件属 core，**禁止 import 'vscode'**。
 */

import type { EditorPort, EditorSelection } from '../ports.ts';
import type { CodeLocation } from '../types.ts';

/** 与 `test/fixtures/main.c` 第 40-48 行对齐 */
export const FAKE_FILE_PATH = 'test/fixtures/main.c';
export const FAKE_LINE_START = 40;
export const FAKE_LINE_END = 48;

/**
 * 选中行原文。**故意与 `main.c` 第 40-48 行逐字一致**：
 * 这样假选区在侧边栏里看起来和真的一样，手感评审不会被"样例很假"干扰。
 * 改 `main.c` 对应区间，必须同步改这里。
 */
export const FAKE_SELECTION_TEXT = [
  'static int rb_pop(ring_buffer_t *rb, int *out)',
  '{',
  '    if (rb->count == 0) return -1;',
  '',
  '    *out = rb->data[rb->head];',
  '    rb->head = (rb->head + 1) % RB_CAPACITY;',
  '    rb->count--;',
  '    return 0;',
  '}',
].join('\n');

export const FAKE_DOCUMENT_HASH = 'fake-hash-0000';

export interface FakeEditorPortOptions {
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  selectionText?: string;
  /** `null` 模拟「文件读不到」，用于走 staleness 的失效分支 */
  documentHash?: string | null;
  /** `true` 模拟「只放了光标没选内容」——S2 要提示而非静默失败 */
  noSelection?: boolean;
  /** `true` 模拟「没有打开的编辑器」——S2 的另一种提示分支 */
  noActiveFile?: boolean;
}

export interface FakeEditorPort extends EditorPort {
  /** 当前假选区，便于断言 */
  readonly selection: EditorSelection | null;
  /** `revealLocation` 的调用记录 */
  readonly revealCalls: readonly CodeLocation[];
  /** `documentTextHash` 的调用记录 */
  readonly hashRequests: readonly string[];
}

export function createFakeEditorPort(opts: FakeEditorPortOptions = {}): FakeEditorPort {
  const filePath = opts.filePath ?? FAKE_FILE_PATH;

  const selection: EditorSelection | null = opts.noSelection
    ? null
    : {
        filePath,
        lineStart: opts.lineStart ?? FAKE_LINE_START,
        lineEnd: opts.lineEnd ?? FAKE_LINE_END,
        text: opts.selectionText ?? FAKE_SELECTION_TEXT,
      };

  const activeFile = opts.noActiveFile ? null : filePath;
  const documentHash = opts.documentHash === undefined ? FAKE_DOCUMENT_HASH : opts.documentHash;

  const revealCalls: CodeLocation[] = [];
  const hashRequests: string[] = [];

  return {
    selection,
    revealCalls,
    hashRequests,
    getSelection: () => Promise.resolve(selection),
    getActiveFilePath: () => Promise.resolve(activeFile),
    revealLocation: (loc) => {
      revealCalls.push(loc);
      return Promise.resolve();
    },
    documentTextHash: (p) => {
      hashRequests.push(p);
      return Promise.resolve(documentHash);
    },
  };
}
