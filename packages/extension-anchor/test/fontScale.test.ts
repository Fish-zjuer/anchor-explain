/**
 * 字号缩放的钳制与步进（D89）。这是纯函数：Memento 的读写由 commands.ts 做，这里只管数值。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FONT_SCALE_DEFAULT,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  clampFontScale,
  stepFontScale,
} from '../src/sidebar/fontScale.ts';

test('clampFontScale：没存过 / 坏值一律退回默认', () => {
  for (const raw of [undefined, null, '1.2', Number.NaN, Number.POSITIVE_INFINITY, {}]) {
    assert.equal(clampFontScale(raw), FONT_SCALE_DEFAULT, String(raw));
  }
});

test('clampFontScale：合法值原样保留（含两位小数以内的尾巴清理）', () => {
  assert.equal(clampFontScale(1), 1);
  assert.equal(clampFontScale(1.2), 1.2);
  // 浮点尾巴收掉：Memento 里可能有 1.2000000000000002
  assert.equal(clampFontScale(1.2000000000000002), 1.2);
});

test('clampFontScale：越界夹回边界', () => {
  assert.equal(clampFontScale(0.1), FONT_SCALE_MIN);
  assert.equal(clampFontScale(9), FONT_SCALE_MAX);
});

test('stepFontScale：一档 10%，整数个 0.1 地加（不跟浮点打游击）', () => {
  assert.equal(stepFontScale(1, 'larger'), 1.1);
  assert.equal(stepFontScale(1, 'smaller'), 0.9);
  // 0.7 + 0.1 在浮点里是 0.7999999...：必须干净地落在 0.8
  assert.equal(stepFontScale(0.7, 'larger'), 0.8);
});

test('stepFontScale：reset 回默认，边界上不再往外走', () => {
  assert.equal(stepFontScale(1.3, 'reset'), FONT_SCALE_DEFAULT);
  assert.equal(stepFontScale(FONT_SCALE_MAX, 'larger'), FONT_SCALE_MAX);
  assert.equal(stepFontScale(FONT_SCALE_MIN, 'smaller'), FONT_SCALE_MIN);
});
