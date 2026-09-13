/**
 * 代码适配器的单测。**全部 vscode-free**：`CodeAdapter` 只认 `EditorPort`，
 * 所以"选区 → Anchor"这件事可以在 `node --test` 里验完，不必按 F5。
 *
 * 这一条正是 D19 那条铁律换来的东西：`capture()` 曾经住在 `commands.ts`，
 * 于是它的每一行都只有肉眼可见 —— 搬进 `adapters/` 才第一次变得可断言。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnchorError, isCodeLocation } from '@anchor/core';
import type { Anchor, CodeLocation } from '@anchor/core';
import {
  createFakeEditorPort,
  FAKE_DOCUMENT_HASH,
  FAKE_DOCUMENT_LINE_COUNT,
  FAKE_DOCUMENT_TEXT,
  FAKE_FILE_PATH,
  FAKE_SELECTION_TEXT,
} from '@anchor/core/fakes/fakeEditorPort';
import { createCodeAdapter } from '../src/adapters/CodeAdapter.ts';

const adapterWith = (opts: Parameters<typeof createFakeEditorPort>[0] = {}) =>
  createCodeAdapter({ editor: createFakeEditorPort(opts) });

async function captureAnchor(scope?: 'selection' | 'whole-file'): Promise<Anchor> {
  return adapterWith().capture(scope);
}

/** 线1 的锚点定位必须是 CodeLocation；这里顺带把类型窄化掉，省得每个断言都写一遍 */
function codeLocationOf(anchor: Anchor): CodeLocation {
  assert.ok(isCodeLocation(anchor.location), '线1 的锚点必须是 CodeLocation');
  return anchor.location;
}

test('capture: 默认讲选区，location / sourceName / extractedText 都跟着选区走', async () => {
  const anchor = await captureAnchor();
  const loc = codeLocationOf(anchor);

  assert.equal(anchor.sourceType, 'code');
  assert.equal(loc.filePath, FAKE_FILE_PATH);
  assert.equal(loc.lineStart, 40);
  assert.equal(loc.lineEnd, 48);
  assert.equal(anchor.extractedText, FAKE_SELECTION_TEXT, 'extractedText 必须逐字是选中行原文');
});

test('capture: sourceId 取文档指纹，取不到时退化成路径而不是失败', async () => {
  const withHash = await captureAnchor();
  assert.equal(withHash.sourceId, FAKE_DOCUMENT_HASH);

  // 文件被删/无权限：讲解照常走，只损失 staleness 检查
  const noHash = await adapterWith({ documentHash: null }).capture();
  assert.equal(noHash.sourceId, FAKE_FILE_PATH, '没有指纹时应退化成路径');
  assert.equal(codeLocationOf(noHash).lineStart, 40, '退化不应影响定位');
});

test("capture('whole-file'): 区间是 1..总行数，正文是整份文档", async () => {
  const loc = codeLocationOf(await captureAnchor('whole-file'));
  assert.equal(loc.lineStart, 1);
  assert.equal(loc.lineEnd, FAKE_DOCUMENT_LINE_COUNT);
  assert.equal((await captureAnchor('whole-file')).extractedText, FAKE_DOCUMENT_TEXT);
});

test('capture: sourceName 是 basename（Windows 反斜杠路径也要切对）', async () => {
  const win = await adapterWith({ filePath: 'C:\\repo\\src\\ring_buffer.c' }).capture();
  assert.equal(win.sourceName, 'ring_buffer.c', 'sourceName 是显示名，不该带目录');

  const posix = await adapterWith({ filePath: '/home/me/ring_buffer.c' }).capture();
  assert.equal(posix.sourceName, 'ring_buffer.c');
});

test('capture: 确认之后范围没了 → 抛 ADAPTER_UNAVAILABLE，而不是静默返回', async () => {
  // 「只放光标」：getSelection 返回 null
  await assert.rejects(
    () => adapterWith({ noSelection: true }).capture('selection'),
    (err: unknown) => err instanceof AnchorError && err.code === 'ADAPTER_UNAVAILABLE',
  );

  // 「编辑器被关掉」：整文件也取不到
  await assert.rejects(
    () => adapterWith({ noActiveFile: true }).capture('whole-file'),
    (err: unknown) => err instanceof AnchorError && err.code === 'ADAPTER_UNAVAILABLE',
  );
});

test('capabilities: 线1 只声明 file，与 §3.1 的能力矩阵一致', async () => {
  const adapter = adapterWith();
  assert.equal(adapter.type, 'code');
  assert.deepEqual(adapter.capabilities.contextTypes, ['file']);
  assert.ok(adapter.capabilities.maxSpan > 0);
});

test('capture 的形状仍满足 §3 的 SourceAdapter（可选参数不算改契约）', async () => {
  // 同一段赋值既是断言也是文档：冻结的接口是零参 `capture(): Promise<Anchor>`，
  // 加一个可选参数后依然可赋值 —— 所以"范围从哪来"不必污染契约。
  const zeroArg: () => Promise<Anchor> = adapterWith().capture;
  const anchor = await zeroArg();
  assert.equal(codeLocationOf(anchor).lineStart, 40);
});
