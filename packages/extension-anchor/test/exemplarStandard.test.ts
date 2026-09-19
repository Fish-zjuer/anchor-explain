/**
 * 标准示范的同步锁（D91）。
 *
 * @anchor 为什么值得一条锁：示范有**两个必须一字不差的副本** ——
 *         编辑面 `scripts/style-lab/exemplar/standard.md`（用户在那里改、实验台跑它）
 *         与线上常量 `src/prompts/exemplarStandard.ts`（打进扩展产物）。
 *         没有这条锁，"改了示范忘了同步线上"（或反过来）不会报任何错，
 *         用户看到的就是"实验台讲的和实际讲解长得不一样" —— 与键位镜像锁（D10）同一类问题。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STANDARD_EXEMPLAR } from '../src/prompts/exemplarStandard.ts';
import { buildSystemPrompt, exemplarSection, EXEMPLAR_STYLE_POINTER } from '../src/prompts/index.ts';

const MARKER = '<!-- ANCHOR_EXEMPLAR_START -->';

test('耦合锁：线上常量与 exemplar/standard.md 标记之后的正文一字不差', () => {
  const md = readFileSync(new URL('../scripts/style-lab/exemplar/standard.md', import.meta.url), 'utf8');
  const at = md.indexOf(MARKER);
  assert.ok(at >= 0, 'standard.md 里丢了示范标记');
  assert.equal(STANDARD_EXEMPLAR, md.slice(at + MARKER.length).trim(), '两边副本不一致 —— 改了示范要两边同步（或跑一遍生成器）');
});

test('线上简约档 = 指针 + 标准示范，示范排在输出契约之后（它是一节的结尾，不是插在中间的注脚）', () => {
  const prompt = buildSystemPrompt('concise');
  assert.match(prompt, /以文末「示范」为准/, '说话的方式一节只剩指针');
  assert.ok(prompt.includes(exemplarSection(STANDARD_EXEMPLAR)), '示范小节整段在线上 prompt 里');
  assert.ok(
    prompt.indexOf('## 输出') >= 0 && prompt.indexOf('## 示范（输出的**长相与口吻**以此为准）') > prompt.indexOf('## 输出'),
    '示范在输出契约之后',
  );
  assert.match(prompt, /留一个空位/, '示范正文真的在里面（用户定稿的那份，不是别的什么话）');
});

test('严谨档不吃示范（那是另一档口味，用户没有要求它变）', () => {
  const prompt = buildSystemPrompt('rigorous');
  assert.doesNotMatch(prompt, /## 示范/);
  assert.ok(!prompt.includes(EXEMPLAR_STYLE_POINTER), '指针也不该出现');
});
