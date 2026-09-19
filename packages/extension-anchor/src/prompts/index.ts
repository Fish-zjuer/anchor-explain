/**
 * 给模型的指令。事实源：docs/CONTRACTS.md §3.3（输出必须过的校验）+ §8（工具）。
 *
 * @anchor prompt 是**产品的一部分**。D94 起整体换成用户给的模板：
 *         # 角色 → # 输出形状 → # 通用规则 → # 档位规则 → （取件，扩展工具循环必需）
 *         → # 示例（few-shot）。三档**全部示范驱动**，同一时刻只实例化当前档：
 *         「档位规则」只放当前档的一节、「示例」只放当前档的示范正文 ——
 *         档位由设置固定而不是逐条请求指定，多放只会有跨档串味和多花 token。
 *         模板文本是用户 D94 的原文，仅两处必要适配（都标注了）：
 *           1. 「若上游要求 JSON」按本扩展的真实 schema 落（location / highlights ——
 *              校验闸门、侧边栏、高亮都消费它；模板里的 line_range / points 与之等价）；
 *           2. 取件一节是模板之外必须保留的（没有它模型不会正确使用 fetch_context）。
 *
 * 三条纪律（都出自踩过的坑，D94 仍然成立）：
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
import { CONCISE_EXEMPLAR, DETAILED_EXEMPLAR, STANDARD_EXEMPLAR } from './exemplars.ts';
import {
  buildRepairPromptEn,
  buildSystemPromptEn,
  buildUserPromptEn,
  describeAnchorEn,
  explainOutputContractEn,
} from './en.ts';

/**
 * 讲解风格（D93 起三档全部示范驱动，D94 起按用户模板进同一个 prompt 结构）：
 *
 * - `standard`（**标准**，默认）：讲清关键判据、操作顺序和原因，不逐行解释语法。
 * - `concise`（**精简**）：让读者快速知道这段代码做什么、成功失败结果是什么。
 * - `detailed`（**详细**）：面向初学者，逐行讲清每行在做什么、为什么这样写。
 *
 * 旧值 `rigorous`（D65 的严谨档）随 D93 退役：设置里还存着它的用户自动迁到 `detailed`。
 */
export type ExplainStyle = 'standard' | 'concise' | 'detailed';

export const DEFAULT_STYLE: ExplainStyle = 'standard';

export function coerceStyle(raw: unknown): ExplainStyle {
  if (raw === 'standard' || raw === 'concise' || raw === 'detailed') return raw;
  if (raw === 'rigorous') return 'detailed'; // D93：旧档位名迁移（两档意图最接近）
  return DEFAULT_STYLE;
}

/** 风格的人话名。设置面板、`显示状态` 与测试共用。 */
export function describeStyle(style: ExplainStyle): string {
  if (style === 'standard') return '标准（讲清判据、顺序与原因）';
  if (style === 'concise') return '精简（快速知道做什么、成功失败结果）';
  return '详细（逐行讲解，面向初学者）';
}

/**
 * 讲解语言（D97）：模型**输出**（以及讲解内容链上的各处文案）用哪种语言。
 * 默认 `zh`；`en` 时三个 prompt 换成 `en.ts` 的英文面，示范换成三份英文示范。
 *
 * @anchor 只有两处语言：讲解内容（prompt → 侧边栏标签 → 导出）跟着这个设置走；
 *         扩展自身的界面（按钮/通知/设置说明）**不**跟着走 —— 那是另一件事
 *         （该跟 VS Code 显示语言走，量级也完全不同）。取件工具层的回灌文案
 *         （拒绝原因、取件内容头、失败说明）保持中文：那是模型侧的指令文本，
 *         模型读中文没有障碍，输出语言由 system prompt + 示范决定。
 */
export type ExplainLanguage = 'zh' | 'en';

export const DEFAULT_LANGUAGE: ExplainLanguage = 'zh';

export function coerceLanguage(raw: unknown): ExplainLanguage {
  return raw === 'en' ? 'en' : DEFAULT_LANGUAGE;
}

/** 语言的人话名（`显示状态` 用）。 */
export function describeLanguage(language: ExplainLanguage): string {
  return language === 'en' ? 'English' : '中文';
}

/**
 * 输出契约的原样描述。system 的「输出形状」与 repair 两处都引用它，保证口径一致。
 *
 * @anchor `crossFile` 不是可选的美化，是**必须**：S9a 的第一版这里写死了
 *         "`filePath` 必须与锚点**同一个文件**"（S1 时代的口径），而它同时被 repair 轮引用 ——
 *         于是如果模型引用了刚读过的兄弟文件、被判失败，我们递回去的修复提示
 *         **又把那条错规则说了一遍**，第二次注定还是失败，最后以 `SCHEMA_VIOLATION` 收场。
 *         这就是用户实测到的"第一轮报错"。**初次与 repair 必须说同一句话**（D67）。
 */
export function explainOutputContract(crossFile = false, language: ExplainLanguage = DEFAULT_LANGUAGE): string {
  if (language === 'en') return explainOutputContractEn(crossFile);
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

/** 档位的人话名（进角色段的那行「本次讲解档位」）。 */
const TIER_LABEL: Record<ExplainStyle, string> = {
  standard: 'standard（标准）',
  concise: 'concise（精简）',
  detailed: 'detailed（详细）',
};

/** 各档的示范正文（编辑面：`scripts/style-lab/exemplar/<档位名>.md`，常量有同步锁）。 */
const TIER_EXEMPLAR: Record<ExplainStyle, string> = {
  standard: STANDARD_EXEMPLAR,
  concise: CONCISE_EXEMPLAR,
  detailed: DETAILED_EXEMPLAR,
};

function roleSection(style: ExplainStyle): string {
  return [
    '# 角色',
    '',
    '你是代码讲解生成器。用户会给你一段代码，并指定讲解档位：concise（精简）、standard（标准）、' +
      'detailed（详细）。未指定时用 standard。你输出中文讲解，只讲用户给出的代码，不编造行为。' +
      '不要改写代码块。',
    // 扩展适配：代码以"锚点"的形式给出（文档名、位置与该处的原文），档位由扩展按设置显式指定。
    '在本扩展里，这段代码以"锚点"的形式给出：文档名、位置，以及该处的原文。',
    `本次讲解档位：${TIER_LABEL[style]}。`,
  ].join('\n');
}

function outputShapeSection(crossFile: boolean): string {
  return [
    '# 输出形状',
    '',
    '按以下形状输出：',
    '',
    'summary：<一段话，概括代码目标、外部行为、关键约定>',
    '',
    '第 N 步：<短标题>（第 X-Y 行）',
    '',
    '- <子点>',
    '- <子点>',
    '',
    '行号必须来自用户代码的编辑器行号，从 1 起。步骤划分按代码的功能块，不按空行硬拆；',
    '组织时讲清数据在这一段里怎么流动 —— 从哪来、在这里被怎么改、出去给谁用 —— ' +
      '不要从上到下逐行念代码（详细档的逐行解释除外）。',
    '粒度参考：一步 ≈ 3-8 行的一个完整动作；一个子点 ≈ 1-2 行的一个关键点。',
    '',
    // 扩展适配：模板原文是"字段为 summary、steps；steps 内放 title、line_range、points"，
    // 这里按本扩展的真实 schema 落（line_range ↔ location，points ↔ highlights）。
    '若上游要求 JSON（本扩展就是），字段为 summary、confidence、steps；steps 内放 title、' +
      'location（行区间：filePath / lineStart / lineEnd，即 line_range）、intro、text、' +
      'highlights（即 points：location + narration，emphasis 可选）。文本内容仍遵守下面的规则。',
    '',
    // 扩展适配：把"程序怎么读你的输出"明说 —— 模型知道行号的后果，才不会随手写错。
    '程序会读取这份 JSON：`location` 决定高亮画在哪几行（行号错，高亮就错位），' +
      '`narration` 显示在侧边栏，`title` 是步骤标题。',
    '',
    explainOutputContract(crossFile),
    '',
    '（`emphasis` 只决定高亮颜色与侧边栏的小标签；不要把「重点 / 上下文 / 定义 / 注意」这类词写进讲解文字里 —— 见通用规则 7。）',
  ].join('\n');
}

/** 通用规则 —— 用户 D94 模板原文，一字未改。 */
const GENERAL_RULES_SECTION = [
  '# 通用规则',
  '',
  '1. 用“写入方 / 读取方”，不用“生产者 / 消费者”。',
  '2. 不口语化，不拟人，不比喻。不要写“追着跑”“撞上”“让位”这类说法。' +
    '用“等于”“重合”“下一个位置是”“返回失败”这类直接表述。',
  '3. 变量、参数、字段第一次出现时，先说明它是什么、存放什么、谁用它做什么，再在后续子点里使用。不要让它突然出现。',
  '4. 不省略宾语。写“把整数 v 写进写位置当前格子”，不要写“往写位置写”。',
  '5. summary 只概括目标、外部行为、关键约定。复杂原因、逐行语法、条件推演放到下面的步骤或逐行解释里。',
  '6. 条件判断优先写成：',
  '   `条件`：',
  '   - True：……',
  '   - False：……',
  '   标准档和详细档必须写 True / False 推演。精简档不写推演，只写结果。',
  '7. 每个子点信息密度要高，但不要堆砌术语。不要用“重点 / 上下文 / 定义 / 注意”当固定标签；' +
    '需要时直接用“满判据”“空判据”“顺序”“为什么这样判”这类描述性标题。',
  '8. 不要每步都套同一个句式。避免模板腔和 AI 味。',
].join('\n');

/** 档位规则 —— 用户 D94 模板原文，一字未改（按当前档只实例化一节）。 */
const TIER_RULES: Record<ExplainStyle, string> = {
  concise: [
    '## concise 精简档',
    '',
    '目的：让读者快速知道“这段代码做什么、成功失败结果是什么”。',
    '',
    '- 形状：summary + 1-2 个步骤。每步 1-2 段或 1-2 条子点，不要拆太碎。',
    '- 只讲目标、结果、外部行为。不解释内部变量名、取模、指针、顺序原因。',
    '- 尽量用“读位置 / 写位置”指代，不出现 head / tail 等代码名。',
    '- 写入方要放整数：满了拒绝，返回失败；没满放入，返回成功。',
    '- 读取方要取整数：空了拒绝，返回失败；不空取出，返回成功。',
    '- 不写 True / False 推演。',
    '- 语言直接，避免连续使用“目标是把……；如果……就……”这种模板句。',
  ].join('\n'),
  standard: [
    '## standard 标准档',
    '',
    '目的：讲清关键判据、操作顺序和原因，但不逐行解释语法。',
    '',
    '- 形状：summary + 第 N 步 + 子点。',
    '- summary 概括目标、外部行为、空 / 满约定。',
    '- 步骤里要写：',
    '  - 判据：条件为 True 怎样，False 怎样。',
    '  - 为什么这样判：例如满时再写会让写位置与读位置重合，而重合表示空，无法区分。',
    '  - 顺序：先写后移、先读后移；否则另一方可能读到未就绪数据，或覆盖未交出数据。',
    '- 可以用 head / tail 等名字，但第一次出现要说明它是什么。',
    '- 不逐行解释 #include、#define、typedef、rb->、*out、% 等语法。',
  ].join('\n'),
  detailed: [
    '## detailed 详细档',
    '',
    '目的：面向初学者，逐行或逐块讲清每行在做什么、为什么这样写。',
    '',
    '- 形状：summary + 第 N 步 + 子点。子点按行号或行号块组织。',
    '- summary 只概括整体，不展开推演；复杂逻辑放到下面逐行解释。',
    '- 每行解释要显式：',
    '  - 这一行定义了什么、存放什么、谁用它做什么。',
    '  - 语法含义：如 #include、#define、typedef struct、rb->、*out、% 取模。',
    '  - 条件判断写完整 True / False 推演。',
    '- 对“为什么 (tail + 1) % N == head 是满”必须单独展开：举例、推演、说明留一个空位的原因。' +
      '例如假设 head=0、tail=15，再写一个 tail 会变 0 与 head 重合，而重合表示空，所以最后一个空位不能写。',
    '- 补充容易卡住的点：空 / 满、取模循环、指针语法、无锁条件。',
    '- 不写口语比喻。',
  ].join('\n'),
};

/**
 * 「取件」一节 —— **模板之外必须保留的一段**（扩展适配）：
 * 没有它模型不会正确使用 `fetch_context`，跨文件讲解（S9a）就废了。
 *
 * @anchor 跨文件那一版要**同时**做两件事：给它许可（否则它就是不敢引用别的文件，
 *         讲解里只会写"某个宏"），和给它节制（一次一个文件、只为讲清数据流）。
 *         用户的原话是"没有跨文件的理解啊，像是嵌入式等等，很多分散的代码"——
 *         所以这里明确点名嵌入式最常见的三样：**宏、结构体、调用者**。
 */
function fetchSection(crossFile: boolean, maxFetchLines?: number): string {
  if (!crossFile) {
    return [
      '# 取件（扩展环境的工具）',
      '',
      '如果你手里的信息不足以准确讲解（比如只看到零散几行、不认识某个结构体或宏），',
      `可以调用工具 \`${FETCH_CONTEXT_TOOL.name}\` 请求额外上下文。规则：`,
      '- 只在**真的需要**时调用。能凭现有信息讲清楚的，不要为了保险而多取一次。',
      '- 一次最多请求一小段（代码按行、PDF 按页），并且 `start` / `end` 都要给。',
      '- 只能取**锚点所在的那个文件**，不能取别的文件。',
      '- 取件次数有上限，且已经取过的区间不会重复给你。',
      '- 收到取件结果后就该给出最终 JSON，不要反复取件。',
    ].join('\n');
  }
  // 行数上限**只说一个数**：它来自策略（`anchorExplain.maxFetchLines`，默认 400）。
  // 想读的范围比上限大时不会被拒，只会截到上限（回灌的内容头部写着真实行范围）——
  // 所以这里不必教它"别超"，只要把它想要的如实写出来。
  const limit = typeof maxFetchLines === 'number' && maxFetchLines > 0 ? maxFetchLines : null;
  return [
    '# 取件（扩展环境的工具）',
    '',
    '如果你手里的信息不足以准确讲解（比如只看到零散几行、不认识某个结构体或宏），',
    `可以调用工具 \`${FETCH_CONTEXT_TOOL.name}\` 请求额外上下文。规则：`,
    '- 只在**真的需要**时调用。能凭现有信息讲清楚的，不要为了保险而多取一次。',
    '- 一次最多请求一小段（代码按行、PDF 按页），并且 `start` / `end` 都要给。',
    '- **可以读锚点文件之外的相关文件** —— 用 `path` 点名要读哪个文件（写相对路径时按**锚点文件所在目录**算，' +
      '例如 `ring_buffer.h`），`path` 省略才是"锚点这个文件"。',
    '  宏定义、类型/结构体、以及**调用它或被它调用的代码**通常不在同一个文件里 ——',
    '  讲不清"数据从哪来、给谁用"时就去读，这是被鼓励的。用户给过一句原话："没有跨文件的理解啊，' +
      '像是嵌入式等等，很多分散的代码。"',
    '- 一次读**一个**文件的一段：**只取你真的需要的那一段**（不要因为"反正能读"就整份要）' +
      (limit === null ? '；读完就该给出结论。' : `，单次最多 ${limit} 行 —— 要多了只会给你前 ${limit} 行。`),
    '- **不要猜路径** —— `path` 要么照抄「可能相关的文件」清单里的写法，要么用你在读过的内容里' +
      '亲眼见过的路径。自己拼出来的目录（比如构建产物目录）多半不存在；路径不存在会得到「取件失败」，白费一轮。',
    '- 密钥、依赖目录（`node_modules`）、构建产物读不到，也不用试。',
    '- 你**只能在讲解里引用你读过的文件**（或锚点文件）—— 没读过的文件不许出现在 location 里。',
    '- 取件次数有上限，且已经取过的区间不会重复给你。',
    '- 收到取件结果后就该给出最终 JSON，不要反复取件。',
  ].join('\n');
}

function examplesSection(style: ExplainStyle): string {
  // 小节标题沿用用户模板原文：「精简档示例 / 标准档示例 / 详细档示例」。
  const headings: Record<ExplainStyle, string> = {
    standard: '## 标准档示例',
    concise: '## 精简档示例',
    detailed: '## 详细档示例',
  };
  return ['# 示例（few-shot）', '', '示例只影响口吻、详略和句式密度。若示例与上面规则冲突，以规则为准，但优先模仿示例的讲解节奏。', '', headings[style], '', TIER_EXEMPLAR[style]].join('\n');
}

export function buildSystemPrompt(
  style: ExplainStyle = DEFAULT_STYLE,
  options: { language?: ExplainLanguage; crossFile?: boolean; maxFetchLines?: number; examples?: boolean } = {},
): string {
  // 英文面（D97）：整套段落与示范都换成 en.ts 的版本，骨架（五节 + 只实例化当前档）不变。
  if (options.language === 'en') {
    return buildSystemPromptEn(style, options);
  }
  const crossFile = options.crossFile === true;
  const withExamples = options.examples !== false;
  const parts = [
    roleSection(style),
    outputShapeSection(crossFile),
    GENERAL_RULES_SECTION,
    `# 档位规则\n\n${TIER_RULES[style]}`,
    fetchSection(crossFile, options.maxFetchLines),
  ];
  if (withExamples) parts.push(examplesSection(style));
  return parts.join('\n\n');
}

/**
 * 锚点的人话描述。模型对"第 40-48 行"的理解远好于对一串路径/JSON 的理解。
 *
 * 代码锚点还会给**所在目录**：跨文件取件时相对路径要有基准，
 * 否则模型只能猜"`ring_buffer.h` 是相对谁写的"（S9a）。
 */
export function describeAnchor(anchor: Anchor, language: ExplainLanguage = DEFAULT_LANGUAGE): string {
  if (language === 'en') return describeAnchorEn(anchor);
  const lines: string[] = [`来源类型：${anchor.sourceType}`, `文档名：${anchor.sourceName}`];
  const loc = anchor.location;

  if (isCodeLocation(loc)) {
    lines.push(`文件路径：${loc.filePath}`, `位置：${formatLineRange(loc.lineStart, loc.lineEnd)}`);
    /**
     * 多段（D80）：把每一段都报出来。
     *
     * @anchor 为什么非说不可：`loc` 是各段的**并集外框** —— 不额外交代的话，
     *         模型（照它读过的所有例子）会把 `第 10-80 行` 读成"选中了连续 10-80 行"，
     *         于是它去讲中间那些**用户从未选过**的行。原话的需求是
     *         "只想快速定位某功能"，讲一堆没选的东西正好是反面。
     */
    if (anchor.segments !== undefined && anchor.segments.length > 1) {
      lines.push(
        `**这一段是非连续的多段选择**，共 ${anchor.segments.length} 段：`,
        anchor.segments.map((s, i) => `  第 ${i + 1} 段：第 ${s.lineStart}-${s.lineEnd} 行`).join('\n'),
        '上面那个「第几行-第几行」只是这些段的**外框**，框内未被列举的行**没有**被选中 —— 只讲列举出来的那几段。',
      );
    }
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
  options: { language?: ExplainLanguage; candidates?: readonly string[]; focus?: string; crossFile?: boolean } = {},
): string {
  if (options.language === 'en') return buildUserPromptEn(anchor, options);
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
  options: { language?: ExplainLanguage; crossFile?: boolean } = {},
): string {
  if (options.language === 'en') return buildRepairPromptEn(rawPrevious, issues, options);
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
