/**
 * 两处边界的守卫单测（§5）：跨扩展入口的 Anchor、webview 发来的消息。
 * 两处都是不可信输入，坏形状必须在门口就被丢掉。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAnchorLike, parseSidebarMessage } from '../src/protocol.ts';

test('isAnchorLike：合法的代码锚点放行', () => {
  assert.equal(
    isAnchorLike({
      sourceType: 'code',
      sourceId: 'sha1',
      sourceName: 'main.c',
      location: { filePath: 'C:\\repo\\main.c', lineStart: 40, lineEnd: 48 },
      extractedText: '...',
    }),
    true,
  );
});

test('isAnchorLike：合法的 PDF 锚点放行', () => {
  assert.equal(
    isAnchorLike({
      sourceType: 'pdf',
      sourceId: 'pdf-1',
      sourceName: 'sample.pdf',
      location: { page: 23, bbox: [0.1, 0.1, 0.5, 0.2] },
    }),
    true,
  );
});

test('isAnchorLike：缺字段 / 类型不对 / 非对象一律拒绝', () => {
  const bad: unknown[] = [
    null,
    undefined,
    'anchor',
    42,
    [],
    {},
    { sourceType: 'code', sourceId: 'x', sourceName: 'y' },
    { sourceType: 'code', sourceId: 'x', sourceName: 'y', location: {} },
    { sourceType: 'code', sourceId: 1, sourceName: 'y', location: { filePath: 'a', lineStart: 1, lineEnd: 2 } },
    { sourceType: 'pdf', sourceId: 'x', sourceName: 'y', location: { page: 1 } },
    { sourceType: 'video', sourceId: 'x', sourceName: 'y', location: {} },
  ];
  for (const raw of bad) {
    assert.equal(isAnchorLike(raw), false, JSON.stringify(raw));
  }
});

test('isAnchorLike：形状对但数值坏的一律拒绝（不能靠下游兜）', () => {
  const bad: unknown[] = [
    // NaN / Infinity / 1e400：`typeof` 都是 number，core 的宽松守卫拦不住
    { sourceType: 'code', sourceId: 'x', sourceName: 'y', location: { filePath: 'a', lineStart: Number.NaN, lineEnd: 2 } },
    { sourceType: 'code', sourceId: 'x', sourceName: 'y', location: { filePath: 'a', lineStart: 1, lineEnd: Number.POSITIVE_INFINITY } },
    { sourceType: 'code', sourceId: 'x', sourceName: 'y', location: { filePath: 'a', lineStart: 1.5, lineEnd: 2 } },
    { sourceType: 'code', sourceId: 'x', sourceName: 'y', location: { filePath: 'a', lineStart: 0, lineEnd: 2 } },
    { sourceType: 'code', sourceId: 'x', sourceName: 'y', location: { filePath: 'a', lineStart: 9, lineEnd: 2 } },
    { sourceType: 'pdf', sourceId: 'x', sourceName: 'y', location: { page: 1e400, bbox: [0.1, 0.1, 0.2, 0.2] } },
    { sourceType: 'pdf', sourceId: 'x', sourceName: 'y', location: { page: 0, bbox: [0.1, 0.1, 0.2, 0.2] } },
    { sourceType: 'pdf', sourceId: 'x', sourceName: 'y', location: { page: 1, bbox: ['a', 'b', 'c', 'd'] } },
    { sourceType: 'pdf', sourceId: 'x', sourceName: 'y', location: { page: 1, bbox: [0.5, 0.1, 0.5, 0.2] } },
  ];
  for (const raw of bad) {
    assert.equal(isAnchorLike(raw), false, JSON.stringify(raw));
  }
});

test('isAnchorLike：`web` 一律拒绝（本次不接入，放行只会把错报成"AI 输出不合法"）', () => {
  assert.equal(
    isAnchorLike({ sourceType: 'web', sourceId: 'x', sourceName: 'y', location: {} }),
    false,
  );
  assert.equal(
    isAnchorLike({ sourceType: 'web', sourceId: 'x', sourceName: 'y', location: { url: 'https://a', selector: '#b', scrollY: 0 } }),
    false,
  );
});

test('parseSidebarMessage：无参消息放行', () => {
  for (const type of ['ui:ready', 'ui:next', 'ui:prev', 'ui:stop']) {
    assert.deepEqual(parseSidebarMessage({ type }), { type });
  }
});

test('parseSidebarMessage：带下标的消息要求非负整数', () => {
  assert.deepEqual(parseSidebarMessage({ type: 'ui:goto', index: 2 }), { type: 'ui:goto', index: 2 });
  assert.deepEqual(parseSidebarMessage({ type: 'ui:revealStep', index: 0 }), { type: 'ui:revealStep', index: 0 });

  for (const index of [-1, 1.5, '2', null, undefined, Number.NaN]) {
    assert.equal(parseSidebarMessage({ type: 'ui:goto', index }), null, `index=${String(index)}`);
  }
});

test('parseSidebarMessage：未知类型与非对象一律返回 null', () => {
  for (const raw of [null, 'ui:next', 7, [], {}, { type: 'ui:evil' }, { noType: true }]) {
    assert.equal(parseSidebarMessage(raw), null, JSON.stringify(raw));
  }
});
