/**
 * 多段合并（D80）。这三件事是这个文件的全部内容：
 *   1. 并集外框算得对不对（下游几十处只读 `location`）
 *   2. 拼出来的原文有没有**标号**（不标号模型会去讲没选中的行）
 *   3. 坏输入是否被**明说**（空队列、跨文件）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EmptyQueueError,
  describeSegments,
  mergeSegments,
  sameFileAsFirst,
  segmentsOf,
} from '../src/segments.ts';
import type { AnchorSegment } from '../src/segments.ts';

const FILE = '/repo/main.c';

function seg(lineStart: number, lineEnd: number, text = 'code'): AnchorSegment {
  return { filePath: FILE, lineStart, lineEnd, text };
}

const META = { sourceId: 'sha1:abc', sourceName: 'main.c' };

test('单段：与从前的锚点一字不差（location 就是那一段，原文不带标号）', () => {
  const one = mergeSegments([seg(40, 48, 'int rb_pop(...)')], META);

  assert.deepEqual(one.location, { filePath: FILE, lineStart: 40, lineEnd: 48 });
  // 单段时不加"第 1 段"这种废话 —— 那句说明是为多段才存在的
  assert.equal(one.extractedText, 'int rb_pop(...)');
  // 长度为 1 的数组没有必要：`location` 本身就是那一段
  assert.equal(one.segments?.length, 1);
});

test('多段：按行号排序，location 是**并集外框**，且每段都在 `segments` 里', () => {
  // 故意乱序给进去：用户通常是"想到哪选到哪"
  const merged = mergeSegments([seg(80, 90), seg(10, 14), seg(40, 48)], META);

  assert.deepEqual(merged.location, { filePath: FILE, lineStart: 10, lineEnd: 90 });
  assert.deepEqual(
    merged.segments?.map((s) => [s.lineStart, s.lineEnd]),
    [
      [10, 14],
      [40, 48],
      [80, 90],
    ],
  );
});

test('多段的原文**逐段标号**并说明"段之间的行没被选中"', () => {
  const merged = mergeSegments([seg(10, 14, 'AAA'), seg(40, 48, 'BBB')], META);
  const text = merged.extractedText ?? '';

  assert.ok(text.includes('第 1 段'), text);
  assert.ok(text.includes('第 2 段'), text);
  assert.ok(text.includes('10-14'), text);
  assert.ok(text.includes('40-48'), text);
  assert.ok(text.includes('AAA') && text.includes('BBB'), text);
  // 这句是最关键的：不写清楚，模型就会去讲 15-39 行那些从未被选中的行
  assert.ok(text.includes('没有') && text.includes('选中'), text);
});

test('focus 传下去并在多段时仍然生效', () => {
  const merged = mergeSegments([seg(1, 2), seg(5, 6)], { ...META, focus: '  只看边界  ' });
  assert.equal(merged.focus, '只看边界');
});

test('空队列：抛而不是返回一个空壳锚点', () => {
  // 静默返回一个 location-lineEnd<lineStart 的东西会一路走到校验才炸，
  // 而那时报错的是"AI 输出不合法" —— 完全指错了方向
  assert.throws(() => mergeSegments([], META), EmptyQueueError);
});

test('跨文件的多段：明说不行为什么（沉默地只讲第一个文件更坏）', () => {
  const cross = [seg(1, 5), { filePath: '/repo/other.c', lineStart: 1, lineEnd: 5, text: 'x' }];
  assert.equal(sameFileAsFirst(cross), false);
  assert.throws(() => mergeSegments(cross, META), /同一个文件/);
});

test('segmentsOf：非代码锚点/老锚点一律 undefined（调用方不必各自判一次）', () => {
  const merged = mergeSegments([seg(1, 2), seg(5, 6)], META);
  assert.equal(segmentsOf(merged)?.length, 2);

  const pdf = { ...merged, location: { page: 3, bbox: [0, 0, 1, 1] as [number, number, number, number] } };
  assert.equal(segmentsOf(pdf), undefined);

  const old = { ...merged, segments: undefined };
  assert.equal(segmentsOf(old), undefined);
});

test('describeSegments：给面板那一行的"+ 号连接"；空队列有话说', () => {
  assert.equal(describeSegments([seg(10, 14), seg(40, 48)]), '10-14 + 40-48');
  assert.equal(describeSegments([]), '没有选中任何段');
});
