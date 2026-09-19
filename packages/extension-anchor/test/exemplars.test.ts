/**
 * 三档示范的同步锁（D93 起；D94 换用户模板后断言随结构更新）。
 *
 * @anchor 为什么值得一个测试文件：三档**全部示范驱动**之后，每档有**两个必须一字不差的副本** ——
 *         编辑面 `scripts/style-lab/exemplar/<档位名>.md`（用户在那里改、实验台文档引用它）
 *         与线上常量 `src/prompts/exemplars.ts`（打进扩展产物）。
 *         没有锁，"改了示范忘了同步线上"（或反过来）不会报任何错，
 *         用户看到的就是"实验台讲的和实际讲解长得不一样" —— 与键位镜像锁（D10）同一类问题。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONCISE_EXEMPLAR, DETAILED_EXEMPLAR, STANDARD_EXEMPLAR } from '../src/prompts/exemplars.ts';
import { buildSystemPrompt } from '../src/prompts/index.ts';

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

test('耦合锁：每档 prompt 的「示例」节只放**自己的**示范（拿错示范 = 档位白切）', () => {
  const cases = [
    ['standard', '## 标准档示例', STANDARD_EXEMPLAR],
    ['concise', '## 精简档示例', CONCISE_EXEMPLAR],
    ['detailed', '## 详细档示例', DETAILED_EXEMPLAR],
  ] as const;
  for (const [style, heading, exemplar] of cases) {
    const prompt = buildSystemPrompt(style);
    assert.match(prompt, /# 示例（few-shot）/, style);
    assert.match(prompt, /示例只影响口吻、详略和句式密度/, `${style}：示例节的免责句要在`);
    assert.ok(prompt.includes(heading), `${style}：示例小节标题 ${heading} 要在`);
    assert.ok(prompt.includes(exemplar), `${style}：自己的示范正文要在`);
    assert.ok(
      prompt.indexOf(heading) > prompt.indexOf('# 通用规则'),
      `${style}：示例节排在通用规则之后`,
    );
    assert.ok(prompt.trimEnd().endsWith(exemplar), `${style}：示例是 prompt 的最后一节`);
  }
  // 拿错示范的两种方式都要拦住：别的档的示范正文不许出现
  assert.ok(!buildSystemPrompt('standard').includes(CONCISE_EXEMPLAR), '标准档不该出现精简示范');
  assert.ok(!buildSystemPrompt('standard').includes(DETAILED_EXEMPLAR), '标准档不该出现详细示范');
  assert.ok(!buildSystemPrompt('concise').includes(STANDARD_EXEMPLAR), '精简档不该出现标准示范');
  assert.ok(!buildSystemPrompt('detailed').includes(STANDARD_EXEMPLAR), '详细档不该出现标准示范');
});

test('角色段带着本次档位；三档的档位行各不相同', () => {
  assert.match(buildSystemPrompt('standard'), /本次讲解档位：standard（标准）。/);
  assert.match(buildSystemPrompt('concise'), /本次讲解档位：concise（精简）。/);
  assert.match(buildSystemPrompt('detailed'), /本次讲解档位：detailed（详细）。/);
  assert.notEqual(
    buildSystemPrompt('standard'),
    buildSystemPrompt('concise'),
    '改档至少要改档位行与示例节',
  );
});

test('档位规则只进当前档的一节（多放只会有跨档串味）', () => {
  const standard = buildSystemPrompt('standard');
  assert.match(standard, /## standard 标准档/);
  assert.match(standard, /目的：讲清关键判据、操作顺序和原因，但不逐行解释语法。/);
  assert.doesNotMatch(standard, /## concise 精简档/, '标准档不带精简的档位规则');
  assert.doesNotMatch(standard, /## detailed 详细档/, '标准档不带详细的档位规则');
});

test('examples: false（实验台 baseline）= 模板整条在、示例节整段没有', () => {
  const bare = buildSystemPrompt('standard', { examples: false });
  assert.match(bare, /# 角色/);
  assert.match(bare, /# 通用规则/);
  assert.match(bare, /# 取件（扩展环境的工具）/);
  assert.match(bare, /# 输出形状/);
  assert.doesNotMatch(bare, /# 示例（few-shot）/);
  assert.ok(!bare.includes(STANDARD_EXEMPLAR), 'baseline 不带任何示范正文');
});

// ── D97：英文示范的同步锁与注入 ───────────────────────────────────────────

function exemplarEnOf(tier: string): string {
  const md = readFileSync(
    new URL(`../scripts/style-lab/exemplar/${tier}.en.md`, import.meta.url),
    'utf8',
  );
  const at = md.indexOf(MARKER);
  assert.ok(at >= 0, `${tier}.en.md 里丢了示范标记`);
  return md.slice(at + MARKER.length).trim();
}

test('耦合锁（英文面）：三个英文常量与各自 exemplar/<档位>.en.md 的正文一字不差', async () => {
  const { CONCISE_EXEMPLAR_EN, DETAILED_EXEMPLAR_EN, STANDARD_EXEMPLAR_EN } = await import(
    '../src/prompts/exemplars.ts'
  );
  assert.equal(STANDARD_EXEMPLAR_EN, exemplarEnOf('standard'), '英文标准示范两边不一致 —— 改了 .en.md 要重新生成常量');
  assert.equal(CONCISE_EXEMPLAR_EN, exemplarEnOf('concise'), '英文精简示范两边不一致');
  assert.equal(DETAILED_EXEMPLAR_EN, exemplarEnOf('detailed'), '英文详细示范两边不一致');
});

test('语言 = en 时「示例」节放的是当前档的英文示范，且是 prompt 的最后一节', async () => {
  const { CONCISE_EXEMPLAR_EN, DETAILED_EXEMPLAR_EN, STANDARD_EXEMPLAR_EN } = await import(
    '../src/prompts/exemplars.ts'
  );
  const cases = [
    ['standard', '## Standard tier example', STANDARD_EXEMPLAR_EN],
    ['concise', '## Concise tier example', CONCISE_EXEMPLAR_EN],
    ['detailed', '## Detailed tier example', DETAILED_EXEMPLAR_EN],
  ] as const;
  for (const [style, heading, exemplar] of cases) {
    const prompt = buildSystemPrompt(style, { language: 'en' });
    assert.ok(prompt.includes(heading), `${style}：英文示例小节标题 ${heading} 要在`);
    assert.ok(prompt.includes(exemplar), `${style}：自己的英文示范正文要在`);
    assert.ok(prompt.trimEnd().endsWith(exemplar), `${style}：示例是英文 prompt 的最后一节`);
    assert.ok(!prompt.includes('第 1 步'), `${style}：英文 prompt 不该混进中文示范`);
  }
});
