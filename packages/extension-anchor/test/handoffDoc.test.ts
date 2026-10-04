/**
 * 临时文档的拼装与选区映射（S14 / D130 第四、五节）。
 *
 * 这个文件里最要紧的一组测试是**映射**：拼起来的文档里第 N 行来自哪个文件的哪一行。
 * 探针（`.tmp-probe/mapping-probe.mjs`）先验过 8 条，这里是正式版 ——
 * 因为映射一旦错位**不会报错，只会讲错东西**。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHandoffDoc,
  mapSelection,
  describeMapped,
  HANDOFF_SCHEME,
  HANDOFF_URI_PATH,
} from '../src/external/handoffDoc.ts';
import type { HandoffSegment } from '../src/external/handoffDoc.ts';

function seg(
  filePath: string,
  lineStart: number,
  text: string,
  opts: { expanded?: boolean } = {},
): HandoffSegment {
  const lines = text.split('\n');
  return {
    filePath,
    lineStart,
    lineEnd: lineStart + lines.length - 1,
    text,
    expanded: opts.expanded ?? true,
  };
}

// 两个文件、三段。文档布局见下面的常量注释。
const SEGMENTS: HandoffSegment[] = [
  seg('src/main.c', 10, 'a\nb\nc'),
  seg('src/main.c', 50, 'x\ny'),
  seg('include/util.h', 3, 'p\nq'),
];

/**
 * 拼出来之后（1-based 行号）：
 *   1: // src/main.c  第 10-12 行
 *   2: (空)
 *   3: a        → main.c:10
 *   4: b        → main.c:11
 *   5: c        → main.c:12
 *   6: ==== 分割线
 *   7: (空)
 *   8: // src/main.c  第 50-51 行
 *   9: (空)
 *  10: x        → main.c:50
 *  11: y        → main.c:51
 *  12: ==== 分割线
 *  13: (空)
 *  14: // include/util.h  第 3-4 行
 *  15: (空)
 *  16: p        → util.h:3
 *  17: q        → util.h:4
 */

test('拼装：段首标注 + 空行 + 分割线 + 正文，行数与来源表一一对应', () => {
  const doc = buildHandoffDoc(SEGMENTS);
  assert.equal(doc.lines.length, 17);
  assert.equal(doc.origin.length, 17, '来源表必须与正文等长');
  assert.equal(doc.lines[0], '// src/main.c  第 10-12 行');
  assert.equal(doc.lines[2], 'a');
  // 第一段的前面没有分割线（第 1-5 行全是"段首标注 + 空行 + 三行正文"）
  assert.ok(!doc.lines.slice(0, 5).some((l) => /^=+$/u.test(l)), '第一段前面不该有分割线');
  // 段与段之间的是第 6 行
  assert.match(doc.lines[5]!, /^=+$/u);
});

test('拼装：分割线宽度足够"粗"（用户要的 ASCII 粗分割线）', () => {
  const doc = buildHandoffDoc(SEGMENTS);
  const bar = doc.lines.find((l) => /^=+$/u.test(l))!;
  assert.ok(bar.length >= 40, `分割线太短了：${bar.length}`);
});

test('拼装：未扩到函数边界的段会在标注里如实写出来', () => {
  const doc = buildHandoffDoc([seg('a.c', 1, 'int x;', { expanded: false })]);
  assert.match(doc.lines[0]!, /未能扩到函数边界/);
});

test('拼装：files 是按出现顺序去重的', () => {
  const doc = buildHandoffDoc(SEGMENTS);
  assert.deepEqual(doc.files, ['src/main.c', 'include/util.h']);
});

test('拼装：空输入给空文档，不炸', () => {
  const doc = buildHandoffDoc([]);
  assert.equal(doc.text, '');
  assert.deepEqual(doc.origin, []);
  assert.deepEqual(doc.files, []);
});

test('映射：选单段', () => {
  const doc = buildHandoffDoc(SEGMENTS);
  assert.deepEqual(mapSelection(doc.origin, 3, 5), [
    { filePath: 'src/main.c', lineStart: 10, lineEnd: 12 },
  ]);
});

test('映射：选单段的一部分', () => {
  const doc = buildHandoffDoc(SEGMENTS);
  assert.deepEqual(mapSelection(doc.origin, 4, 5), [
    { filePath: 'src/main.c', lineStart: 11, lineEnd: 12 },
  ]);
});

test('映射：跨过分割线必须断成两段', () => {
  const doc = buildHandoffDoc(SEGMENTS);
  assert.deepEqual(mapSelection(doc.origin, 3, 10), [
    { filePath: 'src/main.c', lineStart: 10, lineEnd: 12 },
    { filePath: 'src/main.c', lineStart: 50, lineEnd: 50 },
  ]);
});

test('映射：跨两个文件必须断成三段', () => {
  const doc = buildHandoffDoc(SEGMENTS);
  assert.deepEqual(mapSelection(doc.origin, 3, 17), [
    { filePath: 'src/main.c', lineStart: 10, lineEnd: 12 },
    { filePath: 'src/main.c', lineStart: 50, lineEnd: 51 },
    { filePath: 'include/util.h', lineStart: 3, lineEnd: 4 },
  ]);
});

test('映射：只选到分割线 → 空（不是"一段空区间"）', () => {
  const doc = buildHandoffDoc(SEGMENTS);
  assert.deepEqual(mapSelection(doc.origin, 6, 6), []);
});

test('映射：选中标注行 + 一行代码 → 只出那一行代码', () => {
  const doc = buildHandoffDoc(SEGMENTS);
  assert.deepEqual(mapSelection(doc.origin, 1, 3), [
    { filePath: 'src/main.c', lineStart: 10, lineEnd: 10 },
  ]);
});

test('映射：同一文件两段不相邻 → 必须是两段，不是 10-51', () => {
  const doc = buildHandoffDoc(SEGMENTS);
  const got = mapSelection(doc.origin, 3, 11);
  assert.equal(got.length, 2);
  assert.deepEqual(got[1], { filePath: 'src/main.c', lineStart: 50, lineEnd: 51 });
});

test('映射：选区两端超界会被夹住，不炸', () => {
  const doc = buildHandoffDoc(SEGMENTS);
  const got = mapSelection(doc.origin, -5, 999);
  assert.equal(got.length, 3);
});

test('映射：空文档 → 空', () => {
  assert.deepEqual(mapSelection([], 1, 3), []);
});

test('describeMapped：给人看的一句话（用 basename，不用全路径）', () => {
  assert.equal(
    describeMapped([
      { filePath: 'C:\\repo\\src\\main.c', lineStart: 105, lineEnd: 172 },
      { filePath: 'C:\\repo\\include\\util.h', lineStart: 3, lineEnd: 40 },
    ]),
    'main.c 第 105-172 行 + util.h 第 3-40 行',
  );
  assert.equal(describeMapped([]), '（没有选中代码）');
});

test('URI 契约是固定的两个常量（provider 与判断共用同一处）', () => {
  assert.equal(HANDOFF_SCHEME, 'anchor-handoff');
  assert.equal(HANDOFF_URI_PATH, 'handoff');
});
