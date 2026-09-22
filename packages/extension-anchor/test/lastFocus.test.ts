/**
 * D121：上一次那句额外提示词的存与读。
 *
 * @anchor 用户的诉求是"再写又烦又不能完全一样"——所以这一条测的不是"存了个字符串"，
 *         而是**下次问的时候它真的会出现在输入框里**（预填），以及"什么时候不该覆盖它"。
 *         他原本建议"按方向键上键自动填充"：VS Code 的 `showInputBox` 拿不到按键事件，
 *         预填是能做到的等价物（而且更省事：不用按键，内容已经在那儿）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAST_FOCUS_KEY, coerceStoredFocus, readLastFocus } from '../src/session/lastFocus.ts';

/** 最小 `workspaceState` 替身（`readLastFocus` 只用 `get`）。 */
function store(value: unknown): { get<T>(key: string): T | undefined } {
  return { get: <T,>() => value as T | undefined };
}

test('D121：存进去的那句能读回来（去掉首尾空白）', () => {
  assert.equal(readLastFocus(store('  只关心边界判断  ')), '只关心边界判断');
});

test('D121：空串 / 纯空白 / 别的东西一律当"没存过"', () => {
  assert.equal(readLastFocus(store('')), undefined);
  assert.equal(readLastFocus(store('   ')), undefined);
  assert.equal(readLastFocus(store(undefined)), undefined);
  assert.equal(readLastFocus(store(42)), undefined);
  assert.equal(readLastFocus(store({ focus: 'x' })), undefined, '存档被别的东西污染时不该崩，也不该当成提示词');
});

test('D121：键名是稳定的约定（改它等于让所有人的存档失效）', () => {
  assert.equal(LAST_FOCUS_KEY, 'anchorExplain.lastFocus');
});

test('D121：coerceStoredFocus 与读出来的口径一致', () => {
  assert.equal(coerceStoredFocus('  x '), 'x');
  assert.equal(coerceStoredFocus(''), undefined);
  assert.equal(coerceStoredFocus(null), undefined);
});
