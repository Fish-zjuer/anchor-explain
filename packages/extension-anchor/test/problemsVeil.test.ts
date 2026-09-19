/**
 * 报错遮罩的还原判据（D89）。`problemsVeil.ts` 里唯一可离线测的就是这个纯函数 ——
 * 而"什么情况下该还原、什么情况下必须收手"恰恰是非破坏性承诺的全部。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreAction } from '../src/problemsVeilRule.ts';

test('没有记录 → 永远不动设置（看到 false 也不能替用户打开）', () => {
  assert.equal(restoreAction(undefined, false), 'noop');
  assert.equal(restoreAction(undefined, undefined), 'noop');
  assert.equal(restoreAction(undefined, true), 'noop');
});

test('有记录且全局值还是我们写的 false → 原样写回（undefined = 删掉我们的键）', () => {
  assert.deepEqual(restoreAction({ original: undefined }, false), { write: undefined });
  assert.deepEqual(restoreAction({ original: true }, false), { write: true });
  assert.deepEqual(restoreAction({ original: false }, false), { write: false });
});

test('有记录但全局值已不是 false → 用户中途改过，保留用户的值、记录作废', () => {
  assert.equal(restoreAction({ original: true }, true), 'noop');
  assert.equal(restoreAction({ original: undefined }, undefined), 'noop');
});
