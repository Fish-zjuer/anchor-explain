/**
 * 三档示范的同步锁（D93）。
 *
 * @anchor 为什么值得一个测试文件：三档**全部示范驱动**之后，每档有**两个必须一字不差的副本** ——
 *         编辑面 `scripts/style-lab/exemplar/<档位名>.md`（用户在那里改、实验台跑它）
 *         与线上常量 `src/prompts/exemplars.ts`（打进扩展产物）。
 *         没有锁，"改了示范忘了同步线上"（或反过来）不会报任何错，
 *         用户看到的就是"实验台讲的和实际讲解长得不一样" —— 与键位镜像锁（D10）同一类问题。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONCISE_EXEMPLAR, DETAILED_EXEMPLAR, STANDARD_EXEMPLAR } from '../src/prompts/exemplars.ts';
import { buildSystemPrompt, exemplarSection } from '../src/prompts/index.ts';

const MARKER = '<!-- ANCHOR_EXEMPLAR_START -->';

function exemplarOf(tier: string): string {
  const md = readFileSync(
    new URL(`../scripts/style-lab/exemplar/${tier}.md`, import.meta.url),
    'utf8',
  );
  const at = md.indexOf(MARKER);
  assert.ok(at >= 0, `${tier}.md 里丢了示范标记`);
  return md.slice(at + MARKER.length).trim();
}

test('耦合锁：三个线上常量与各自 exemplar/<档位>.md 的正文一字不差', () => {
  assert.equal(STANDARD_EXEMPLAR, exemplarOf('standard'), '标准示范两边不一致 —— 改了 .md 要重新生成常量');
  assert.equal(CONCISE_EXEMPLAR, exemplarOf('concise'), '精简示范两边不一致');
  assert.equal(DETAILED_EXEMPLAR, exemplarOf('detailed'), '详细示范两边不一致');
});

test('耦合锁：每档只注入**自己的**示范（拿错示范 = 档位白切）', () => {
  const prompts = {
    standard: buildSystemPrompt('standard'),
    concise: buildSystemPrompt('concise'),
    detailed: buildSystemPrompt('detailed'),
  };
  assert.ok(prompts.standard.includes(exemplarSection(STANDARD_EXEMPLAR)));
  assert.ok(prompts.concise.includes(exemplarSection(CONCISE_EXEMPLAR)));
  assert.ok(prompts.detailed.includes(exemplarSection(DETAILED_EXEMPLAR)));

  assert.ok(!prompts.standard.includes(CONCISE_EXEMPLAR), '标准档不该出现精简示范');
  assert.ok(!prompts.standard.includes(DETAILED_EXEMPLAR), '标准档不该出现详细示范');
  assert.ok(!prompts.concise.includes(STANDARD_EXEMPLAR), '精简档不该出现标准示范');
  assert.ok(!prompts.detailed.includes(STANDARD_EXEMPLAR), '详细档不该出现标准示范');
});

test('三档都有「示范」小节，且都排在输出契约之后（结构三档一致，正文各是各的）', () => {
  for (const prompt of [
    buildSystemPrompt('standard'),
    buildSystemPrompt('concise'),
    buildSystemPrompt('detailed'),
  ]) {
    assert.match(prompt, /## 示范（输出的\*\*长相与口吻\*\*以此为准）/);
    assert.match(prompt, /内容必须全部来自用户这次的锚点/, '防"照抄示范"的那句话三档都要有');
    assert.ok(
      prompt.indexOf('## 输出') >= 0 &&
        prompt.indexOf('## 示范（输出的**长相与口吻**以此为准）') > prompt.indexOf('## 输出'),
      '示范在输出契约之后',
    );
  }
});
