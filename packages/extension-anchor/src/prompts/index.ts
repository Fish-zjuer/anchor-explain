/**
 * 给模型的指令。事实源：docs/CONTRACTS.md §3.3（输出必须过的校验）+ §8（工具）。
 *
 * @anchor 这些文本是**产品的一部分**，不是注释：讲解质量、要不要取件、
 *         输出能不能过 `validateExplanation`，全靠它。所以它单独一个目录，
 *         不和编排逻辑混在一起。
 *
 * 三条纪律（都出自踩过的坑）：
 *   1. **把校验规则说在前面**。§3.3 会拒的东西（空 text、行号越界、跑别的文件）
 *      必须在 prompt 里就说清 —— 让模型第一次就写对，比让它错了再 repair 便宜得多。
 *   2. **行号口径必须写死**。模型默认数 0-based 或"从代码片段第一行算起"，
 *      两者都会让高亮画错行，而 §3.3 的越界检查未必拦得住（只要没超出文件总行数）。
 *   3. **repair 只指出问题，不重写答案**。把上一次的输出原样贴回去让它自己改，
 *      比我们替它改更不容易引入幻觉。
 *
 * 本文件属 prompts/，**禁止 import 'vscode'**。
 */

import type { Anchor } from '@anchor/core';
import { formatLineRange, isCodeLocation, isPDFLocation, locationLabel } from '@anchor/core';
import { EXPLANATION_JSON_SHAPE, FETCH_CONTEXT_TOOL } from '../orchestrator/toolSchema.ts';

/** 输出契约的原样描述。system 与 repair 两处都引用它，保证口径一致。 */
export function explainOutputContract(): string {
  return [
    '最终回答必须是**一个 JSON 对象**（可以放在 ```json 围栏里），形状如下：',
    EXPLANATION_JSON_SHAPE,
    '',
    '硬性要求：',
    '- `summary` 非空；`confidence` 是 0 到 1 之间的数字。',
    '- `steps` 至少一个；每个 step 的 `text` 非空。',
    `- 每个 location 的 \`filePath\` 必须与锚点**同一个文件**（逐字相同，别改写路径）。`,
    '- 行号一律是**从文件第一行开始数的 1-based 行号**，不是从选区开始数。',
    '- 行区间必须落在文件范围内，且 `lineStart <= lineEnd`。',
    '- `emphasis` 只能取 `primary` / `context` / `definition` / `caveat` 之一（可省略）。',
    '- 不要把解释写在 JSON 外面 —— JSON 之外的散文会被忽略，但如果 JSON 本身不合法，整次讲解就失败了。',
  ].join('\n');
}

export function buildSystemPrompt(): string {
  return [
    '你是一个代码与技术文档讲解助手。用户会给你一个"锚点"：文档里的一段位置，可能还带着那段的原文。',
    '',
    '你的任务是把这段内容讲清楚，并且**把讲解切成有序的步骤**，每一步对应文档里的一处具体位置。',
    '步骤之间要有推进关系（先判断再取值、先定义再使用），不要只是把同一段话拆成几块。',
    '',
    '每一步还可以带若干 `highlights`（子高亮），对应这一步内部的一个更小的逻辑点。',
    '粒度参考：一步 ≈ 3-8 行的一个完整动作；一个子高亮 ≈ 1-2 行的一个关键点。',
    '',
    '## 什么时候该取件',
    '',
    `如果你手里的信息不足以准确讲解（比如只看到零散几行、不认识某个结构体或宏），`,
    `可以调用工具 \`${FETCH_CONTEXT_TOOL.name}\` 请求额外上下文。规则：`,
    '- 只在**真的需要**时调用。能凭现有信息讲清楚的，不要为了保险而多取一次。',
    '- 一次最多请求一小段（代码按行、PDF 按页）。',
    '- 只能取**锚点所在的那个文件**，不能取别的文件。',
    '- 取件次数有上限，且已经取过的区间不会重复给你。',
    '- 收到取件结果后就该给出最终 JSON，不要反复取件。',
    '',
    '## 输出',
    '',
    explainOutputContract(),
  ].join('\n');
}

/** 锚点的人话描述。模型对"第 40-48 行"的理解远好于对一串路径/JSON 的理解。 */
export function describeAnchor(anchor: Anchor): string {
  const lines: string[] = [`来源类型：${anchor.sourceType}`, `文档名：${anchor.sourceName}`];
  const loc = anchor.location;

  if (isCodeLocation(loc)) {
    lines.push(`文件路径：${loc.filePath}`, `位置：${formatLineRange(loc.lineStart, loc.lineEnd)}`);
  } else if (isPDFLocation(loc)) {
    lines.push(`页码：第 ${loc.page} 页`, `框选范围（归一化）：${loc.bbox.join(', ')}`);
  } else {
    lines.push(`位置：${locationLabel(loc)}`);
  }
  return lines.join('\n');
}

export function buildUserPrompt(anchor: Anchor): string {
  const parts = ['## 锚点', describeAnchor(anchor), ''];

  if (anchor.extractedText && anchor.extractedText.trim() !== '') {
    parts.push('## 锚点处的原文', '```', anchor.extractedText, '```', '');
  } else {
    parts.push(
      '## 锚点处的原文',
      '（没有提供原文。如果仅凭上面的位置信息无法准确讲解，请调用取件工具。）',
      '',
    );
  }

  parts.push('请按 system 里的要求，给出讲解 JSON。');
  return parts.join('\n');
}

/**
 * §3.3 规则 5 的"修复提示"。**只回灌问题清单与上一次的输出**，不替模型改写：
 * 我们改的话就是拿规则拼答案，模型只会顺着我们的措辞复述。
 */
export function buildRepairPrompt(rawPrevious: string, issues: string): string {
  return [
    '你上一次的输出没有通过校验。',
    '',
    '校验发现的问题：',
    issues,
    '',
    '你上一次的输出（原文）：',
    '```',
    rawPrevious.slice(0, 4000),
    '```',
    '',
    '请**只输出修正后的 JSON**，不要解释你改了什么，也不要重复上面的问题清单。',
    explainOutputContract(),
  ].join('\n');
}
