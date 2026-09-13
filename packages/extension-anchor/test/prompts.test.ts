/**
 * 指令文本的单测（D65）。
 *
 * @anchor 为什么 prompt 也值得测：它是**产品表面**，不是注释。用户对第一版的反馈是
 *         "不要那么多名词什么的，要不还不如读代码本身了"、"太从上到下了，我希望能表达出
 *         数据流转的感觉" —— 这两句话必须变成**指令里的硬要求**，否则下次改 prompt 的人
 *         （可能还是我）会把它当措辞随手改回去。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STYLE, buildSystemPrompt, coerceStyle, describeStyle } from '../src/prompts/index.ts';

test('两档风格都要求"按数据怎么流"组织步骤（这是用户最在意的那一条）', () => {
  for (const style of ['concise', 'rigorous'] as const) {
    const prompt = buildSystemPrompt(style);
    assert.match(prompt, /按数据怎么流/, style);
    assert.match(prompt, /从哪来/, style);
    assert.match(prompt, /给谁用/, style);
    // 反面要求也要在：不许从上到下一行行念
    assert.match(prompt, /不要从上到下一行一行地讲/, style);
  }
});

test('两档都要"少讲废话"：不复述代码、不写开场白', () => {
  for (const style of ['concise', 'rigorous'] as const) {
    const prompt = buildSystemPrompt(style);
    assert.match(prompt, /不要写成摘要式套话/, style);
    assert.match(prompt, /不要复述代码已经写出来的东西/, style);
  }
});

test('简约档：禁用术语（除非它就是代码里的标识符），且要有长度约束', () => {
  const prompt = buildSystemPrompt('concise');
  assert.match(prompt, /\*\*简约档\*\*/);
  assert.match(prompt, /不要用术语/);
  assert.match(prompt, /它就是这段代码里的标识符/);
  assert.match(prompt, /超过 40 个字/, '一句话的长度上限是防名词堆砌的具体手段');
});

test('严谨档：术语可以用，但必须落到具体位置并说清依据', () => {
  const prompt = buildSystemPrompt('rigorous');
  assert.match(prompt, /\*\*严谨档\*\*/);
  assert.match(prompt, /说清依据/);
  assert.match(prompt, /不变量、边界与返回值/);
});

test('两档的指令确实不一样（改档不会白改）', () => {
  assert.notEqual(buildSystemPrompt('concise'), buildSystemPrompt('rigorous'));
});

test('不传档位时用默认档，且默认是简约（D65：用户嫌名词多）', () => {
  assert.equal(DEFAULT_STYLE, 'concise');
  assert.equal(buildSystemPrompt(), buildSystemPrompt(DEFAULT_STYLE));
});

test('coerceStyle：只认严谨档，其余（含拼错）一律退化成默认', () => {
  assert.equal(coerceStyle('rigorous'), 'rigorous');
  assert.equal(coerceStyle('concise'), 'concise');
  for (const bad of ['严谨', 'RIGOROUS', '', null, undefined, 7, {}]) {
    assert.equal(coerceStyle(bad), 'concise', JSON.stringify(bad));
  }
});

test('describeStyle：两档都有人话名（设置面板与显示状态共用）', () => {
  assert.match(describeStyle('concise'), /简约/);
  assert.match(describeStyle('rigorous'), /严谨/);
});

test('输出契约与取件规则没有被风格改动影响（§3.3 与 §8 的口径不变）', () => {
  for (const style of ['concise', 'rigorous'] as const) {
    const prompt = buildSystemPrompt(style);
    assert.match(prompt, /fetch_context/, style);
    assert.match(prompt, /1-based/, style);
    assert.match(prompt, /confidence/, style);
  }
});
