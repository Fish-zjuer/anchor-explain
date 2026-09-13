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
import type { Anchor } from '@anchor/core';
import {
  DEFAULT_STYLE,
  buildRepairPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  coerceStyle,
  describeAnchor,
  describeStyle,
  explainOutputContract,
} from '../src/prompts/index.ts';

const CODE_ANCHOR: Anchor = {
  sourceType: 'code',
  sourceId: 'sha1:x',
  sourceName: 'main.c',
  location: { filePath: 'C:\\repo\\test\\fixtures\\main.c', lineStart: 40, lineEnd: 48 },
  extractedText: 'static int rb_pop(...)',
};

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

// ── S9a 修复（D67）：跨文件时 prompt 的三处口径 ────────────────────────────
//
// 用户实测的返工：`candidates` 只在签名上、契约那句写死"必须与锚点同一个文件"。
// 这两条当时都没有测试盯着，所以 245 条全绿而"它就是没有往外读的想法"。

test('候选文件清单必须真的进 user prompt（不是签名上的装饰）', () => {
  const prompt = buildUserPrompt(CODE_ANCHOR, {
    candidates: ['ring_buffer.h', 'src/config.h'],
    crossFile: true,
  });

  assert.match(prompt, /## 可能相关的文件/);
  assert.match(prompt, /- ring_buffer\.h/);
  assert.match(prompt, /- src\/config\.h/);
  assert.match(prompt, /先用取件工具读一次/, '给清单的同时必须说清"要引用就先读"');
});

test('候选清单只在跨文件时才给（不然是邀请它去撞拒绝）', () => {
  const off = buildUserPrompt(CODE_ANCHOR, { candidates: ['ring_buffer.h'] });
  assert.doesNotMatch(off, /可能相关的文件/);
  assert.doesNotMatch(off, /ring_buffer\.h/);
});

test('锚点给所在目录：相对路径要有基准，否则模型只能猜', () => {
  const text = describeAnchor(CODE_ANCHOR);
  // 目录用 core 路径函数算的，分隔符统一成 `/`（与 samePath 同一立场，跨平台一致）
  assert.match(text, /所在目录：C:\/repo\/test\/fixtures/);
  assert.match(text, /文件路径：C:\\repo\\test\\fixtures\\main\.c/, '文件路径仍是原样，不当场改写');
});

test('输出契约按 crossFile 换口径，且两档互斥', () => {
  assert.match(explainOutputContract(false), /必须与锚点\*\*同一个文件\*\*/);
  assert.doesNotMatch(explainOutputContract(true), /必须与锚点/);
  assert.match(explainOutputContract(true), /你这次真的有过的东西/);
  assert.match(explainOutputContract(true), /整次讲解会被判失败/);
});

test('repair 与 system 说同一句话（repair 说错就等于修不回来）', () => {
  const cross = buildRepairPrompt('{}', '有问题', { crossFile: true });
  assert.match(cross, /你这次真的有过的东西/);
  assert.doesNotMatch(cross, /必须与锚点/);

  const single = buildRepairPrompt('{}', '有问题');
  assert.match(single, /必须与锚点/);
});

test('focus（追问那条线）进 user prompt 时排在原文之前，并说明它优先', () => {
  const prompt = buildUserPrompt(CODE_ANCHOR, { focus: '跟 ring_buffer_t 这条线' });
  assert.match(prompt, /## 用户想追的那条线/);
  assert.match(prompt, /ring_buffer_t 这条线/);
  assert.ok(
    prompt.indexOf('用户想追的那条线') < prompt.indexOf('锚点处的原文'),
    '先说要追什么，再给原文',
  );
});
