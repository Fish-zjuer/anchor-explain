/**
 * 指令文本的单测（D65 起；D94 换用户模板后随结构更新）。
 *
 * @anchor 为什么 prompt 也值得测：它是**产品表面**，不是注释。用户对讲解的反馈
 *         （"不像人话"、"太从上到下"）最终都落成了这份模板里的硬规则 ——
 *         下次改 prompt 的人（可能还是我）把它当措辞随手改回去时，这里会红。
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

test('五节结构：角色 / 输出形状 / 通用规则 / 档位规则 / 取件 / 示例，三档都在（D94 模板）', () => {
  for (const style of ['standard', 'concise', 'detailed'] as const) {
    const prompt = buildSystemPrompt(style);
    assert.match(prompt, /^# 角色/m, style);
    assert.match(prompt, /^# 输出形状/m, style);
    assert.match(prompt, /^# 通用规则/m, style);
    assert.match(prompt, /^# 档位规则/m, style);
    assert.match(prompt, /^# 取件（扩展环境的工具）/m, style);
    assert.match(prompt, /^# 示例（few-shot）/m, style);
  }
});

test('角色段：生成器定位 + 只讲给出的代码 + 本次档位行（三档各不相同）', () => {
  const cases = [
    ['standard', '本次讲解档位：standard（标准）。'],
    ['concise', '本次讲解档位：concise（精简）。'],
    ['detailed', '本次讲解档位：detailed（详细）。'],
  ] as const;
  for (const [style, line] of cases) {
    const prompt = buildSystemPrompt(style);
    assert.match(prompt, /只讲用户给出的代码，不编造行为/, style);
    assert.match(prompt, /不要改写代码块/, style);
    assert.ok(prompt.includes(line), `${style}：${line}`);
  }
});

test('通用规则原文钉住（用户 D94 的硬要求，改措辞会红）', () => {
  const prompt = buildSystemPrompt('standard');
  assert.match(prompt, /用“写入方 \/ 读取方”，不用“生产者 \/ 消费者”/);
  assert.match(prompt, /不口语化，不拟人，不比喻/);
  assert.match(prompt, /不省略宾语/);
  assert.match(prompt, /标准档和详细档必须写 True \/ False 推演。精简档不写推演，只写结果。/);
  assert.match(prompt, /不要用“重点 \/ 上下文 \/ 定义 \/ 注意”当固定标签/);
  assert.match(prompt, /避免模板腔和 AI 味/);
});

test('输出形状：用户模板的文本形状 + 程序读取规则 + 扩展真实 JSON 契约（D94/D95 适配点）', () => {
  const prompt = buildSystemPrompt('standard');
  assert.match(prompt, /按代码的功能块，不按空行硬拆/);
  // D95：模板只是参考 —— 我们自己的两条硬要求合并了回来
  assert.match(prompt, /讲清数据在这一段里怎么流动 —— 从哪来、在这里被怎么改、出去给谁用/);
  assert.match(prompt, /粒度参考：一步 ≈ 3-8 行的一个完整动作/);
  // D95：程序怎么读 JSON 要明说（行号错 = 高亮错位）
  assert.match(prompt, /程序会读取这份 JSON：`location` 决定高亮画在哪几行/);
  assert.match(prompt, /若上游要求 JSON（本扩展就是），字段为 summary、confidence、steps/);
  assert.match(prompt, /highlights（即 points：location \+ narration，emphasis 可选）/);
  assert.match(prompt, /最终回答必须是\*\*一个 JSON 对象\*\*/, '真实 schema 的契约整段保留');
  assert.match(prompt, /行号一律是\*\*从文件第一行开始数的 1-based 行号\*\*/);
  assert.match(prompt, /不要把「重点 \/ 上下文 \/ 定义 \/ 注意」这类词写进讲解文字里/, 'emphasis 只管颜色，不进文字');
});

test('档位规则只进当前档的一节（跨档串味是示范驱动最怕的事）', () => {
  const standard = buildSystemPrompt('standard');
  assert.match(standard, /## standard 标准档/);
  assert.match(standard, /目的：讲清关键判据、操作顺序和原因，但不逐行解释语法。/);
  assert.doesNotMatch(standard, /## concise 精简档/);
  assert.doesNotMatch(standard, /## detailed 详细档/);

  const concise = buildSystemPrompt('concise');
  assert.match(concise, /## concise 精简档/);
  assert.match(concise, /不写 True \/ False 推演/);
  assert.doesNotMatch(concise, /## standard 标准档/);

  const detailed = buildSystemPrompt('detailed');
  assert.match(detailed, /## detailed 详细档/);
  assert.match(detailed, /补充容易卡住的点/);
  assert.doesNotMatch(detailed, /## standard 标准档/);
});

test('示例节：免责句 + 自己的示范正文（示范正文的耦合锁在 exemplars.test.ts）', () => {
  const standard = buildSystemPrompt('standard');
  assert.match(standard, /# 示例（few-shot）/);
  assert.match(
    standard,
    /示例只影响口吻、详略和句式密度。若示例与上面规则冲突，以规则为准，但优先模仿示例的讲解节奏。/,
  );
  assert.match(standard, /留一个空位/, '标准示范正文在里面');
});

test('三档的 prompt 各不相同（改档不会白改）', () => {
  const prompts = {
    standard: buildSystemPrompt('standard'),
    concise: buildSystemPrompt('concise'),
    detailed: buildSystemPrompt('detailed'),
  };
  assert.notEqual(prompts.standard, prompts.concise);
  assert.notEqual(prompts.standard, prompts.detailed);
  assert.notEqual(prompts.concise, prompts.detailed);
});

test('不传档位时用默认档，且默认是标准（D92：用户定稿的示范就是默认讲法）', () => {
  assert.equal(DEFAULT_STYLE, 'standard');
  assert.equal(buildSystemPrompt(), buildSystemPrompt(DEFAULT_STYLE));
});

test('coerceStyle：三档各归各位，旧值 rigorous 迁到 detailed，其余退化成默认', () => {
  assert.equal(coerceStyle('standard'), 'standard');
  assert.equal(coerceStyle('concise'), 'concise');
  assert.equal(coerceStyle('detailed'), 'detailed');
  assert.equal(coerceStyle('rigorous'), 'detailed', 'D93：旧档位名迁移（两档意图最接近）');
  for (const bad of ['标准', 'SIMPLE', '', null, undefined, 7, {}]) {
    assert.equal(coerceStyle(bad), DEFAULT_STYLE, JSON.stringify(bad));
  }
});

test('describeStyle：三档都有人话名（设置面板与显示状态共用）', () => {
  assert.match(describeStyle('standard'), /标准/);
  assert.match(describeStyle('concise'), /精简/);
  assert.match(describeStyle('detailed'), /详细/);
});

test('输出契约与取件规则没有被风格改动影响（§3.3 与 §8 的口径不变）', () => {
  for (const style of ['standard', 'concise', 'detailed'] as const) {
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

test('D71：单次行数上限写进提示词，且与策略同一个数（不许两处各写一个）', () => {
  const withLimit = buildSystemPrompt('concise', { crossFile: true, maxFetchLines: 400 });
  assert.match(withLimit, /单次最多 400 行/, '要说清上限是多少');
  assert.match(withLimit, /要多了只会给你前 400 行/, '也要说清超了会怎样（截断而不是被拒）');
  assert.doesNotMatch(withLimit, /≤60 行/, '那句是写死的旧值，跨文件时不该再出现');

  const custom = buildSystemPrompt('concise', { crossFile: true, maxFetchLines: 150 });
  assert.match(custom, /单次最多 150 行/);

  // 没给上限（单文件档）时也不许凭空捏一个数字
  assert.doesNotMatch(buildSystemPrompt('concise'), /单次最多 \d+ 行/);
});

test('输出契约按 crossFile 换口径，且两档互斥', () => {
  assert.match(explainOutputContract(false), /必须与锚点\*\*同一个文件\*\*/);
  assert.doesNotMatch(explainOutputContract(true), /必须与锚点/);
  assert.match(explainOutputContract(true), /你这次真的有过的东西/);
  assert.match(explainOutputContract(true), /整次讲解会被判失败/);
});

test('D69：跨文件时要说清"讲的其实是别的文件就落在那个文件里"（别塞回锚点文件凑位置）', () => {
  const cross = explainOutputContract(true);
  assert.match(cross, /就把那一步的 `location` \*\*落在那个文件里\*\*/);
  assert.match(cross, /不要为了显得"跨文件"而硬拆/, '另一半也要说：不许为了凑跨文件硬拆步骤');
  assert.doesNotMatch(explainOutputContract(false), /落在那个文件里/, '单文件档不许出现这条（会自相矛盾）');
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
