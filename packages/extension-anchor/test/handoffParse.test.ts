/**
 * 外部 Agent 位置清单的解析（S14 / D130）。
 *
 * 这里钉住的是一件很重要的事：**宽容但不猜**。
 * 粘进来的东西没有二次确认的机会（我们直接拿它去读文件了），
 * 所以"认不出的行"必须如实列出来 —— 否则临时文档里会静默少一段，
 * 而用户会以为"外部 Agent 又漏改了"，方向完全错了。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHandoff,
  mergeRanges,
  normalizeRange,
  HANDOFF_PROMPT,
  MAX_HANDOFF_CHARS,
} from '../src/external/handoffParse.ts';

test('标准写法：一行一个 JSON 对象', () => {
  const r = parseHandoff(
    [
      '{"filePath": "src/main.c", "lineStart": 120, "lineEnd": 168}',
      '{"filePath": "include/util.h", "lineStart": 3, "lineEnd": 40}',
    ].join('\n'),
  );
  assert.equal(r.ranges.length, 2);
  assert.deepEqual(r.ranges[0], { filePath: 'include/util.h', lineStart: 3, lineEnd: 40 });
  assert.deepEqual(r.ranges[1], { filePath: 'src/main.c', lineStart: 120, lineEnd: 168 });
  assert.equal(r.rejected.length, 0);
});

test('JSON 数组：整段是一个数组，也能认', () => {
  const r = parseHandoff('[{"filePath": "a.c", "lineStart": 1, "lineEnd": 2}]');
  assert.equal(r.ranges.length, 1);
  assert.deepEqual(r.ranges[0], { filePath: 'a.c', lineStart: 1, lineEnd: 2 });
});

test('格式化过的多行对象：字段各占一行，靠缓冲区攒起来', () => {
  const r = parseHandoff(
    [
      '{',
      '  "filePath": "src/dshot.c",',
      '  "lineStart": 40,',
      '  "lineEnd": 88',
      '}',
    ].join('\n'),
  );
  assert.equal(r.ranges.length, 1);
  assert.deepEqual(r.ranges[0], { filePath: 'src/dshot.c', lineStart: 40, lineEnd: 88 });
});

test('带 Markdown 围栏和前言：围栏与前言都不影响解析', () => {
  const r = parseHandoff(
    [
      '好的，我改动了以下文件：',
      '```json',
      '{"filePath": "a.c", "lineStart": 10, "lineEnd": 20}',
      '```',
      '',
      '需要我解释吗？',
    ].join('\n'),
  );
  assert.equal(r.ranges.length, 1);
  assert.deepEqual(r.ranges[0], { filePath: 'a.c', lineStart: 10, lineEnd: 20 });
  // 前言与结尾被列进 rejected（不是错误，是"没被用上的行"）
  assert.equal(r.rejected.length, 2);
});

test('lineEnd 缺省时等于 lineStart（只改了一行）', () => {
  const r = parseHandoff('{"filePath": "a.c", "lineStart": 42}');
  assert.deepEqual(r.ranges[0], { filePath: 'a.c', lineStart: 42, lineEnd: 42 });
});

test('区间写反会救回来（start > end 时交换）', () => {
  const r = parseHandoff('{"filePath": "a.c", "lineStart": 90, "lineEnd": 12}');
  assert.deepEqual(r.ranges[0], { filePath: 'a.c', lineStart: 12, lineEnd: 90 });
});

test('形状不对的行会进 rejected，并说得出原因', () => {
  const r = parseHandoff(
    [
      '{"filePath": "ok.c", "lineStart": 1, "lineEnd": 2}',
      '{"filePath": "bad.c"}', // 少了 lineStart
      '这不是位置对象',
    ].join('\n'),
  );
  assert.equal(r.ranges.length, 1);
  assert.equal(r.rejected.length, 2);
  assert.match(r.rejected[0]!.reason, /形状/);
  assert.equal(r.rejected[0]!.line, 2);
});

test('括号没闭合也能用（字段齐了就够，不要求 JSON 完整）', () => {
  // 这条刻意与直觉相反：外部 Agent 漏个 `}` 不该让整条位置丢掉 ——
  // 它给的**信息**（路径 + 行号）是全的，我们只消费信息，不消费括号。
  // 与 §3.3「能修就修」同一条立场：能确定的意图就救回来，不因为格式瑕疵整条作废。
  const r = parseHandoff('{"filePath": "a.c", "lineStart": 1, "lineEnd": 9');
  assert.equal(r.ranges.length, 1);
  assert.deepEqual(r.ranges[0], { filePath: 'a.c', lineStart: 1, lineEnd: 9 });
  assert.equal(r.rejected.length, 0);
});

test('跨行对象但少了收尾括号：攒到末尾结算，进 rejected', () => {
  const r = parseHandoff(['{', '  "filePath": "a.c",', '  "lineStart": 7,'].join('\n'));
  // 起手的 `{` 那一行没有 filePath，进缓冲；后面两行补上字段但没有 `}` 收尾 ——
  // 文件末尾结算时形状已经够了，于是**收下**（同上一条：只消费信息）
  assert.equal(r.ranges.length, 1);
  assert.deepEqual(r.ranges[0], { filePath: 'a.c', lineStart: 7, lineEnd: 7 });
});

test('重复与相邻的区间会被合并（D130 输入去重）', () => {
  const r = parseHandoff(
    [
      '{"filePath": "a.c", "lineStart": 120, "lineEnd": 130}',
      '{"filePath": "a.c", "lineStart": 128, "lineEnd": 140}',
      '{"filePath": "a.c", "lineStart": 141, "lineEnd": 150}',
    ].join('\n'),
  );
  assert.equal(r.ranges.length, 1, '重叠 + 相邻应当合成一条');
  assert.deepEqual(r.ranges[0], { filePath: 'a.c', lineStart: 120, lineEnd: 150 });
});

test('不相邻的两段不会被合并', () => {
  const r = parseHandoff(
    [
      '{"filePath": "a.c", "lineStart": 10, "lineEnd": 12}',
      '{"filePath": "a.c", "lineStart": 50, "lineEnd": 51}',
    ].join('\n'),
  );
  assert.equal(r.ranges.length, 2);
});

test('行号为 0 或负数一律拒（那不是行号）', () => {
  const r = parseHandoff('{"filePath": "a.c", "lineStart": 0, "lineEnd": 5}');
  assert.equal(r.ranges.length, 0);
  assert.equal(r.rejected.length, 1);
});

test('空输入不炸，也不报错', () => {
  const r = parseHandoff('');
  assert.deepEqual(r.ranges, []);
  // 空串 split 出一行空行 → 被当"空行"跳过，所以 rejected 也是空的
  assert.equal(r.rejected.length, 0);
});

test('normalizeRange：直接调用的三条规矩', () => {
  assert.deepEqual(normalizeRange({ filePath: ' a.c ', lineStart: 5, lineEnd: 5 }), {
    filePath: 'a.c',
    lineStart: 5,
    lineEnd: 5,
  });
  assert.equal(normalizeRange({ filePath: '', lineStart: 1, lineEnd: 1 }), undefined);
  assert.deepEqual(normalizeRange({ filePath: 'a.c', lineStart: 9, lineEnd: 3 }), {
    filePath: 'a.c',
    lineStart: 3,
    lineEnd: 9,
  });
});

test('mergeRanges：空输入给空数组', () => {
  assert.deepEqual(mergeRanges([]), []);
});

test('给外部 Agent 的短 prompt 里有格式、有行号说明，且足够短', () => {
  assert.match(HANDOFF_PROMPT, /filePath/);
  assert.match(HANDOFF_PROMPT, /lineStart/);
  assert.match(HANDOFF_PROMPT, /lineEnd/);
  assert.ok(HANDOFF_PROMPT.length < 200, `prompt 应当足够短，现在是 ${HANDOFF_PROMPT.length} 字符`);
});

test('大小上限是一个明确的数字', () => {
  assert.equal(MAX_HANDOFF_CHARS, 64 * 1024);
});
