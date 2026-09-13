/**
 * 两处边界的守卫单测（§5）：跨扩展入口的 Anchor、webview 发来的消息。
 * 两处都是不可信输入，坏形状必须在门口就被丢掉。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATE_WORD, isAnchorLike, parseSidebarMessage, parseStartMessage } from '../src/protocol.ts';

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

test('parseStartMessage：ready 放行，run 要非空 id', () => {
  assert.deepEqual(parseStartMessage({ type: 'start:ready' }), { type: 'start:ready' });
  assert.deepEqual(parseStartMessage({ type: 'start:run', id: 'capture' }), {
    type: 'start:run',
    id: 'capture',
  });

  for (const id of ['', null, undefined, 7, {}, []]) {
    assert.equal(parseStartMessage({ type: 'start:run', id }), null, `id=${JSON.stringify(id)}`);
  }
});

test('parseStartMessage：未知类型与非对象一律返回 null', () => {
  for (const raw of [null, 'start:run', 7, [], {}, { type: 'start:evil' }, { noType: true }]) {
    assert.equal(parseStartMessage(raw), null, JSON.stringify(raw));
  }
});

test('parseStartMessage：**只查形状，不查 id 认不认识**（成员资格是宿主查表的活）', () => {
  // 这条是"守卫管能不能读、业务管能不能做"这条分工的锁：
  // 若有人把"id 必须在 START_ACTIONS 里"塞进守卫，这里会红 —— 而那会让
  // 宿主那侧的 `findStartAction` 变成一段永远为真的死代码。
  assert.deepEqual(parseStartMessage({ type: 'start:run', id: '并不是我们的动作' }), {
    type: 'start:run',
    id: '并不是我们的动作',
  });
});

test('STATE_WORD 是 WalkthroughState 的满射（加状态时漏了词会在这里红）', () => {
  const states = ['idle', 'running', 'playing', 'paused', 'done', 'error'] as const;
  for (const state of states) {
    assert.equal(typeof STATE_WORD[state], 'string', state);
    assert.notEqual(STATE_WORD[state], '', state);
  }
  assert.equal(Object.keys(STATE_WORD).length, states.length, '状态词表与状态联合类型的条数不一致');
});
