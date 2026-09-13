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
import { dirnameOf, formatLineRange, isCodeLocation, isPDFLocation, locationLabel } from '@anchor/core';
import { EXPLANATION_JSON_SHAPE, FETCH_CONTEXT_TOOL } from '../orchestrator/toolSchema.ts';

/**
 * 讲解风格（D65）。**两档，用户可选**（`anchorExplain.style`）：
 *
 * - `concise`（简约，默认）：说人话，能用大白话就不用术语 —— 用户的原话是
 *   "不要那么多名词什么的，要不还不如读代码本身了"。
 * - `rigorous`（严谨）：术语可以用，但每个术语都要落到这段代码的具体位置上，并说清依据
 *   （不变量、边界、返回值）。
 *
 * **两档共享的那一条更重要**：步骤按**数据怎么流**来切，不按从上到下的行序 ——
 * 用户的原话是"太从上到下了，我希望能表达出数据流转的感觉"。
 */
export type ExplainStyle = 'concise' | 'rigorous';

export const DEFAULT_STYLE: ExplainStyle = 'concise';

export function coerceStyle(raw: unknown): ExplainStyle {
  return raw === 'rigorous' ? 'rigorous' : DEFAULT_STYLE;
}

/** 风格的人话名。设置面板、`显示状态` 与测试共用。 */
export function describeStyle(style: ExplainStyle): string {
  return style === 'rigorous' ? '严谨（术语可用，但要说清依据）' : '简约（说人话，少用术语）';
}

/**
 * 输出契约的原样描述。system 与 repair 两处都引用它，保证口径一致。
 *
 * @anchor `crossFile` 不是可选的美化，是**必须**：S9a 的第一版这里写死了
 *         "`filePath` 必须与锚点**同一个文件**"（S1 时代的口径），而它同时被 repair 轮引用 ——
 *         于是如果模型引用了刚读过的兄弟文件、被判失败，我们递回去的修复提示
 *         **又把那条错规则说了一遍**，第二次注定还是失败，最后以 `SCHEMA_VIOLATION` 收场。
 *         这就是用户实测到的"第一轮报错"。**初次与 repair 必须说同一句话**（D67）。
 */
export function explainOutputContract(crossFile = false): string {
  return [
    '最终回答必须是**一个 JSON 对象**（可以放在 ```json 围栏里），形状如下：',
    EXPLANATION_JSON_SHAPE,
    '',
    '硬性要求：',
    '- `summary` 非空；`confidence` 是 0 到 1 之间的数字。',
    '- `steps` 至少一个；每个 step 的 `text` 非空。',
    crossFile
      ? '- 每个 location 的 `filePath` 只能是**你这次真的有过的东西**：锚点所在的文件，' +
        '或者你用取件工具**读过**的文件（读过就用它请求时的那个写法，别改写路径）。' +
        '**没读过的文件出现在 location 里，整次讲解会被判失败。**\n' +
        '- **如果某一步讲的其实是另一个文件里的东西**（宏怎么定义、结构体长什么样、协议状态机在哪），' +
        '就把那一步的 `location` **落在那个文件里** —— 你已经读过它了，别为了"不越界"把它硬塞回锚点文件里' +
        '凑一个不相干的位置。侧边栏会显示文件名，读者点得过去。\n' +
        '- 反过来也成立：**不要为了显得"跨文件"而硬拆**。数据主要在锚点文件里流动，' +
        '就老老实实讲锚点文件；引用了别处的定义才出去。'
      : '- 每个 location 的 `filePath` 必须与锚点**同一个文件**（逐字相同，别改写路径）。',
    '- 行号一律是**从文件第一行开始数的 1-based 行号**，不是从选区开始数。',
    '- 行区间必须落在文件范围内，且 `lineStart <= lineEnd`。',
    '- `emphasis` 只能取 `primary` / `context` / `definition` / `caveat` 之一（可省略）。',
    '- 不要把解释写在 JSON 外面 —— JSON 之外的散文会被忽略，但如果 JSON 本身不合法，整次讲解就失败了。',
  ].join('\n');
}

export function buildSystemPrompt(
  style: ExplainStyle = DEFAULT_STYLE,
  options: { crossFile?: boolean; maxFetchLines?: number } = {},
): string {
  const crossFile = options.crossFile === true;
  return [
    '你是一个代码与技术文档讲解助手。用户会给你一个"锚点"：文档里的一段位置，可能还带着那段的原文。',
    '',
    '你的任务是把这段内容讲清楚，并且**把讲解切成有序的步骤**，每一步对应文档里的一处具体位置。',
    '',
    '## 步骤怎么切：按数据怎么流，不要按行序',
    '',
    '**这是最重要的一条。** 不要从上到下一行一行地讲 —— 那等于把代码念一遍，用户不如自己读。',
    '请按**数据在这段代码里的流动**来组织步骤，每一步回答三件事：',
    '- 数据**从哪来**（谁写进去的、入参、上一个结构）',
    '- 在这里**被怎么改**（取值、计算、转移、判掉）',
    '- 出去**给谁用**（返回给谁、留给后面哪一步、影响什么状态）',
    '',
    '于是步骤的顺序是**数据走一圈的顺序**，可能与行号顺序不同 —— 这是允许的，',
    '但每一步的 `location` 仍要指向文档里真实的行/页。',
    '如果这段的逻辑就是"顺序执行"，那就把每个动作说成"数据经过它之后变成了什么"。',
    '',
    '每一步还可以带若干 `highlights`（子高亮），对应这一步内部的一个更小的逻辑点。',
    '粒度参考：一步 ≈ 3-8 行的一个完整动作；一个子高亮 ≈ 1-2 行的一个关键点。',
    '',
    '## 说话的方式',
    '',
    styleSection(style),
    '',
    '## 什么时候该取件',
    '',
    `如果你手里的信息不足以准确讲解（比如只看到零散几行、不认识某个结构体或宏），`,
    `可以调用工具 \`${FETCH_CONTEXT_TOOL.name}\` 请求额外上下文。规则：`,
    '- 只在**真的需要**时调用。能凭现有信息讲清楚的，不要为了保险而多取一次。',
    '- 一次最多请求一小段（代码按行、PDF 按页），并且 `start` / `end` 都要给。',
    fetchSourceRule(crossFile, options.maxFetchLines),
    '- 取件次数有上限，且已经取过的区间不会重复给你。',
    '- 收到取件结果后就该给出最终 JSON，不要反复取件。',
    '',
    '## 输出',
    '',
    explainOutputContract(crossFile),
  ].join('\n');
}

/**
 * "能取哪里的件"这一句，按 `anchorExplain.fetchScope` 走（S9a）。
 *
 * @anchor 跨文件那一版要**同时**做两件事：给它许可（否则它就是不敢引用别的文件，
 *         讲解里只会写"某个宏"），和给它节制（一次一个文件、只为讲清数据流）。
 *         用户的原话是"没有跨文件的理解啊，像是嵌入式等等，很多分散的代码"——
 *         所以这里明确点名嵌入式最常见的三样：**宏、结构体、调用者**。
 */
function fetchSourceRule(crossFile: boolean, maxFetchLines?: number): string {
  if (!crossFile) return '- 只能取**锚点所在的那个文件**，不能取别的文件。';
  // 行数上限**只说一个数**：它来自策略（`anchorExplain.maxFetchLines`，默认 400）。
  // 想读的范围比上限大时不会被拒，只会截到上限（回灌的内容头部写着真实行范围）——
  // 所以这里不必教它"别超"，只要把它想要的如实写出来。
  const limit = typeof maxFetchLines === 'number' && maxFetchLines > 0 ? maxFetchLines : null;
  return [
    '- **可以读锚点文件之外的相关文件** —— 用 `path` 点名要读哪个文件（写相对路径时按**锚点文件所在目录**算，' +
      '例如 `ring_buffer.h`），`path` 省略才是"锚点这个文件"。',
    '  宏定义、类型/结构体、以及**调用它或被它调用的代码**通常不在同一个文件里 ——',
    '  讲不清"数据从哪来、给谁用"时就去读，这是被鼓励的。用户给过一句原话："没有跨文件的理解啊，' +
      '像是嵌入式等等，很多分散的代码。"',
    '- 一次读**一个**文件的一段：**只取你真的需要的那一段**（不要因为"反正能读"就整份要）' +
      (limit === null ? '；读完就该给出结论。' : `，单次最多 ${limit} 行 —— 要多了只会给你前 ${limit} 行。`),
    '- 密钥、依赖目录（`node_modules`）、构建产物读不到，也不用试。',
    '- 你**只能在讲解里引用你读过的文件**（或锚点文件）—— 没读过的文件不许出现在 location 里。',
  ].join('\n');
}

/**
 * 两档风格的具体指令。**都要被"少讲废话"这条约束管住**（D65）——
 * 用户对第一版的原话是"不要那么多名词什么的，要不还不如读代码本身了"。
 */
function styleSection(style: ExplainStyle): string {
  const shared = [
    '- `summary` 一句话说清**这块在干什么、数据从哪到哪**，不要写成摘要式套话。',
    '- 不要写"这段代码实现了一个……它的作用是……"这种开场白，直接讲事情。',
    '- 不要复述代码已经写出来的东西（"这里调用了一个函数"）；讲的是它**为什么**在这儿、**带来什么后果**。',
  ];

  if (style === 'rigorous') {
    return [
      '**严谨档**：术语可以用，但每个术语都必须落到这段代码里的具体位置或字段上，并说清依据。',
      '',
      ...shared,
      '- 讲判断/计算时，说清**不变量、边界与返回值**（空、满、溢出、越界、-1 这类哨兵值）。',
      '- 讲状态变更时，说清**改了哪个字段、它之前/之后是什么含义**。',
      '- 允许一步更小（1-3 行一点），宁可多一步，不要含糊。',
    ].join('\n');
  }

  return [
    '**简约档**：说人话 —— 能用大白话讲清的，就不要用术语。',
    '',
    ...shared,
    '- 术语只在**它就是这段代码里的标识符**时才用（结构体名、函数名、字段名），不要引入代码里没出现过的名词。',
    '- 一句话讲完一个动作。写不出来就说明还没想清楚，不要用名词堆砌来充数。',
    '- 一句话超过 40 个字就该拆开重写。',
  ].join('\n');
}

/**
 * 锚点的人话描述。模型对"第 40-48 行"的理解远好于对一串路径/JSON 的理解。
 *
 * 代码锚点还会给**所在目录**：跨文件取件时相对路径要有基准，
 * 否则模型只能猜"`ring_buffer.h` 是相对谁写的"（S9a）。
 */
export function describeAnchor(anchor: Anchor): string {
  const lines: string[] = [`来源类型：${anchor.sourceType}`, `文档名：${anchor.sourceName}`];
  const loc = anchor.location;

  if (isCodeLocation(loc)) {
    lines.push(`文件路径：${loc.filePath}`, `位置：${formatLineRange(loc.lineStart, loc.lineEnd)}`);
    const dir = dirnameOf(loc.filePath);
    // 根目录（`/` 或 `C:`）没有信息量，不如不给 —— 给了反而像"一定要写出这个前缀"
    if (dir !== '' && dir !== '/' && !/^[A-Za-z]:$/u.test(dir)) lines.push(`所在目录：${dir}`);
  } else if (isPDFLocation(loc)) {
    lines.push(`页码：第 ${loc.page} 页`, `框选范围（归一化）：${loc.bbox.join(', ')}`);
  } else {
    lines.push(`位置：${locationLabel(loc)}`);
  }
  return lines.join('\n');
}

/**
 * @anchor 候选文件清单（S9a）**必须真的出现在这里**。第一版只在签名上收了 `candidates`
 *         而函数体没读过它 —— 清单一次都没进过 prompt，模型于是**不知道可以问哪个文件**，
 *         这正是用户实测的"没有往外读的想法"（D67）。它只写进 user prompt，不进 system：
 *         清单是"这一次的上下文"，不是"永远的行为准则"。
 */
export function buildUserPrompt(
  anchor: Anchor,
  options: { candidates?: readonly string[]; focus?: string; crossFile?: boolean } = {},
): string {
  const parts = ['## 锚点', describeAnchor(anchor), ''];

  if (options.focus !== undefined && options.focus.trim() !== '') {
    parts.push(
      '## 用户想追的那条线',
      options.focus.trim(),
      '请围绕这条线组织步骤（它优先于"从头讲一遍"）。',
      '',
    );
  }

  if (anchor.extractedText && anchor.extractedText.trim() !== '') {
    parts.push('## 锚点处的原文', '```', anchor.extractedText, '```', '');
  } else {
    parts.push(
      '## 锚点处的原文',
      '（没有提供原文。如果仅凭上面的位置信息无法准确讲解，请调用取件工具。）',
      '',
    );
  }

  const candidates = options.candidates ?? [];
  if (options.crossFile === true && candidates.length > 0) {
    parts.push(
      '## 可能相关的文件',
      '这些是工作区里和锚点文件逻辑相关的文件（按相关性排序，`#include` 提到过的排最前）。',
      '清单只是**线索**，不代表你一定要用；但如果讲解要说到它们里面的东西（宏、结构体、调用者），',
      '**先用取件工具读一次再说**（`path` 写下面这些名字，一次一个文件）：',
      ...candidates.map((name) => `- ${name}`),
      '',
    );
  }

  parts.push('请按 system 里的要求，给出讲解 JSON。');
  return parts.join('\n');
}

/**
 * §3.3 规则 5 的"修复提示"。**只回灌问题清单与上一次的输出**，不替模型改写：
 * 我们改的话就是拿规则拼答案，模型只会顺着我们的措辞复述。
 *
 * @anchor `crossFile` 必须与 system 那一遍**同口径**：否则模型因为"引用了读过的文件"被判失败，
 *         拿到的修复提示却又说"必须与锚点同一个文件" —— 第二次照旧失败（D67）。
 */
export function buildRepairPrompt(
  rawPrevious: string,
  issues: string,
  options: { crossFile?: boolean } = {},
): string {
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
    explainOutputContract(options.crossFile === true),
  ].join('\n');
}
