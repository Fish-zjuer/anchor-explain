import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clamp01,
  normalizeBBox,
  coerceBBox,
  isValidBBox,
  bboxArea,
} from '../src/normalizeBBox.ts';

test('clamp01: 端点与越界', () => {
  assert.equal(clamp01(0), 0);
  assert.equal(clamp01(1), 1);
  assert.equal(clamp01(0.5), 0.5);
  assert.equal(clamp01(-0.5), 0);
  assert.equal(clamp01(1.5), 1);
});

test('clamp01: 非有限数退化为 0（防御性，交给 isValidBBox 去拒绝）', () => {
  assert.equal(clamp01(Number.NaN), 0);
  assert.equal(clamp01(Number.POSITIVE_INFINITY), 0);
  assert.equal(clamp01(Number.NEGATIVE_INFINITY), 0);
});

test('normalizeBBox: 区间内的值原样通过', () => {
  assert.deepEqual(normalizeBBox([0.1, 0.2, 0.3, 0.4]), [0.1, 0.2, 0.3, 0.4]);
});

test('normalizeBBox: 越界值被裁剪到 [0,1]', () => {
  assert.deepEqual(normalizeBBox([-0.2, -1, 1.7, 2]), [0, 0, 1, 1]);
  assert.deepEqual(normalizeBBox([0, 0, 1, 1]), [0, 0, 1, 1]);
});

test('normalizeBBox: 反向拖拽被排序（从右下往左上拖）', () => {
  assert.deepEqual(normalizeBBox([0.8, 0.9, 0.2, 0.1]), [0.2, 0.1, 0.8, 0.9]);
  // x 反向但 y 正向
  assert.deepEqual(normalizeBBox([0.8, 0.1, 0.2, 0.9]), [0.2, 0.1, 0.8, 0.9]);
});

test('normalizeBBox: 退化零面积保持有序且相等', () => {
  assert.deepEqual(normalizeBBox([0.5, 0.5, 0.5, 0.5]), [0.5, 0.5, 0.5, 0.5]);
  // 纯水平线：高度 0
  assert.deepEqual(normalizeBBox([0.1, 0.5, 0.9, 0.5]), [0.1, 0.5, 0.9, 0.5]);
  // 纯垂直线：宽度 0
  assert.deepEqual(normalizeBBox([0.5, 0.1, 0.5, 0.9]), [0.5, 0.1, 0.5, 0.9]);
});

test('normalizeBBox: 非有限数被压成 0', () => {
  assert.deepEqual(normalizeBBox([Number.NaN, 0.2, 0.8, Number.NaN]), [0, 0, 0.8, 0.2]);
});

test('coerceBBox: 合法输入', () => {
  assert.deepEqual(coerceBBox([0.1, 0.2, 0.3, 0.4]), [0.1, 0.2, 0.3, 0.4]);
  // 反向也算合法，会被排序
  assert.deepEqual(coerceBBox([0.4, 0.3, 0.2, 0.1]), [0.2, 0.1, 0.4, 0.3]);
});

test('coerceBBox: 形状不合法 → null', () => {
  assert.equal(coerceBBox(null), null);
  assert.equal(coerceBBox(undefined), null);
  assert.equal(coerceBBox('0.1,0.2'), null);
  assert.equal(coerceBBox([0.1, 0.2, 0.3]), null);          // 长度不足
  assert.equal(coerceBBox([0.1, 0.2, 0.3, 0.4, 0.5]), null); // 长度超出
  assert.equal(coerceBBox({}), null);
});

test('coerceBBox: 数值损坏 → null（与 normalizeBBox 有意不同）', () => {
  assert.equal(coerceBBox([0.1, 0.2, 0.3, 'x']), null);
  assert.equal(coerceBBox([0.1, 0.2, Number.NaN, 0.4]), null);
  assert.equal(coerceBBox([0.1, 0.2, Number.POSITIVE_INFINITY, 0.4]), null);
  assert.equal(coerceBBox([0.1, 0.2, null, 0.4]), null);
});

test('isValidBBox: 非退化且区间内才是有效切片', () => {
  assert.equal(isValidBBox([0.1, 0.2, 0.3, 0.4]), true);
  assert.equal(isValidBBox([0, 0, 1, 1]), true);
  // 退化零面积
  assert.equal(isValidBBox([0.5, 0.5, 0.5, 0.5]), false);
  assert.equal(isValidBBox([0.1, 0.5, 0.9, 0.5]), false);
  // 反向（未经过 normalizeBBox 的裸值）
  assert.equal(isValidBBox([0.4, 0.4, 0.2, 0.2]), false);
  // 越界
  assert.equal(isValidBBox([-0.1, 0.2, 0.3, 0.4]), false);
  assert.equal(isValidBBox([0.1, 0.2, 1.3, 0.4]), false);
});

test('bboxArea', () => {
  assert.equal(bboxArea([0, 0, 0.5, 0.25]), 0.125);
  assert.equal(bboxArea([0.5, 0.5, 0.5, 0.5]), 0);
  assert.equal(bboxArea([0.1, 0.5, 0.9, 0.5]), 0);
  // 反向也不出负数
  assert.equal(bboxArea([0.9, 0.9, 0.1, 0.1]), 0);
});
