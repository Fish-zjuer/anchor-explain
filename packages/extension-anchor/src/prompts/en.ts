/**
 * 讲解语言的**英文面**（D97）：`anchorExplain.language = "en"` 时，system / user / repair
 * 三个 prompt 的全部段落从这里出，与 `index.ts` 的中文段落一一对应。
 *
 * @anchor 为什么独立成文件而不是散在 index.ts 里：中文模板是**用户 D94 的原文**（一字未改，
 *         有测试钉着），英文版是它的**适配翻译** —— 两份文本必然各自演进，混在一个文件里
 *         早晚会有人改错边。分开放还有一条硬理由：通用规则、档位规则这些段落不是"逐句直译"，
 *         而是把**同一条纪律**换成英文里自然的说法（比如规则 1 的写入方/读取方就是
 *         writer / reader），逐句对照反而会写出翻译腔。
 *
 * 三条不变的口径（与中文版同一条纪律）：
 *   1. JSON 契约的**形状**一字不差 —— 校验闸门只认形状，语言只换说明文字；
 *   2. 行号口径（1-based、编辑器行号）必须说死，英文模型同样默认 0-based；
 *   3. 取件一节必须保留 —— 没有它模型不会正确使用 `fetch_context`。
 *
 * 本文件属 prompts/，**禁止 import 'vscode'**。
 */

import { dirnameOf, isCodeLocation, isPDFLocation, locationLabel } from '@anchor/core';
import type { Anchor } from '@anchor/core';
import { EXPLANATION_JSON_SHAPE_EN, FETCH_CONTEXT_TOOL } from '../orchestrator/toolSchema.ts';
import type { ExplainStyle } from './index.ts';
import { CONCISE_EXEMPLAR_EN, DETAILED_EXEMPLAR_EN, STANDARD_EXEMPLAR_EN } from './exemplars.ts';

/** 档位在英文角色段里的写法。 */
const TIER_LABEL_EN: Record<ExplainStyle, string> = {
  standard: 'standard',
  concise: 'concise',
  detailed: 'detailed',
};

/** 各档的英文示范正文（编辑面：`scripts/style-lab/exemplar/<档位名>.en.md`，常量有同步锁）。 */
const TIER_EXEMPLAR_EN: Record<ExplainStyle, string> = {
  standard: STANDARD_EXEMPLAR_EN,
  concise: CONCISE_EXEMPLAR_EN,
  detailed: DETAILED_EXEMPLAR_EN,
};

export function roleSectionEn(style: ExplainStyle): string {
  return [
    '# Role',
    '',
    'You are a code-explanation generator. The user hands you a piece of code and a tier: ' +
      'concise, standard, or detailed. When unspecified, use standard. You write the explanation ' +
      'in English, cover only the code the user gave you, and never invent behavior. ' +
      'Do not rewrite code blocks.',
    // 扩展适配：代码以"锚点"的形式给出（文档名、位置与该处的原文），档位由扩展按设置显式指定。
    'In this extension the code arrives as an "anchor": the document name, its location, ' +
      'and the source text at that location.',
    `Current tier: ${TIER_LABEL_EN[style]}.`,
  ].join('\n');
}

export function explainOutputContractEn(crossFile: boolean): string {
  return [
    'Your final answer must be **a single JSON object** (a ```json fence is fine), shaped like this:',
    EXPLANATION_JSON_SHAPE_EN,
    '',
    'Hard requirements:',
    '- `summary` is non-empty; `confidence` is a number between 0 and 1.',
    '- `steps` has at least one entry; every step has a non-empty `text`.',
    crossFile
      ? '- Every `location.filePath` must be something **you actually had this run**: the anchor file, ' +
        'or a file you **read** with the fetch tool (quote the path exactly as you requested it, do not rewrite it). ' +
        'A file you never read, appearing in a location, fails the whole explanation.\n' +
        '- **If a step is really about something in another file** (how a macro is defined, what a struct ' +
        'looks like, where a protocol state machine lives), put that step\'s `location` **in that file** — ' +
        'you already read it; do not shove it back into the anchor file at an unrelated spot just to "stay safe". ' +
        'The sidebar shows the file name and the reader can jump to it.\n' +
        '- The reverse also holds: **do not split steps just to look cross-file**. If the data mainly flows ' +
        'inside the anchor file, explain the anchor file; go elsewhere only when you cite a definition there.'
      : '- Every `location.filePath` must be **the anchor file itself** (character-for-character; do not rewrite paths).',
    '- Line numbers are always **1-based counted from the first line of the file**, not from the start of the selection.',
    '- A range must fit inside the file, and `lineStart <= lineEnd`.',
    '- `emphasis` must be one of `primary` / `context` / `definition` / `caveat` (optional).',
    '- Do not write prose outside the JSON — prose outside is ignored, but if the JSON itself is invalid, the whole explanation fails.',
  ].join('\n');
}

export function outputShapeSectionEn(crossFile: boolean): string {
  return [
    '# Output shape',
    '',
    'Write the explanation in this shape:',
    '',
    'summary: <one paragraph: the goal, the external behavior, the key conventions>',
    '',
    'Step N: <short title> (lines X-Y)',
    '',
    '- <bullet point>',
    '- <bullet point>',
    '',
    'Line numbers must come from the user\'s editor, counted from 1. Split steps by functional blocks of the code, not by blank lines;',
    'organize the explanation around **how data flows through this piece** — where it comes from, how it is changed here, ' +
      'who consumes it downstream — do not read the code out line by line (except the detailed tier, which is line-by-line by design).',
    'Granularity: one step ≈ one complete action over 3-8 lines; one bullet ≈ one key fact over 1-2 lines.',
    '',
    // 扩展适配：真实 schema（line_range ↔ location，points ↔ highlights）。
    'If the upstream expects JSON (this extension does), the fields are summary, confidence, steps; inside steps: title, ' +
      'location (a line range: filePath / lineStart / lineEnd, i.e. line_range), intro, text, ' +
      'highlights (i.e. points: location + narration, emphasis optional). The prose still follows the rules below.',
    '',
    // 扩展适配：把"程序怎么读你的输出"明说 —— 模型知道行号的后果，才不会随手写错。
    'A program reads this JSON: `location` decides which lines get highlighted (wrong line numbers, wrong highlights), ' +
      '`narration` is shown in the sidebar, `title` is the step heading.',
    '',
    explainOutputContractEn(crossFile),
    '',
    '(`emphasis` only picks the highlight color and the sidebar tag; never write the words "Key point / Context / Definition / Caveat" into the explanation text — see general rule 7.)',
  ].join('\n');
}

/** 通用规则 —— 用户 D94 模板的英文面：同一条纪律，英文里自然的说法。 */
export const GENERAL_RULES_SECTION_EN = [
  '# General rules',
  '',
  '1. Say "writer / reader", not "producer / consumer".',
  '2. No colloquialisms, no anthropomorphism, no metaphors. Never write "chases after", "bumps into", "steps aside". ' +
    'Write "equals", "coincides with", "the next slot is", "returns failure" — plain, direct statements.',
  '3. When a variable, parameter, or field appears for the first time, state what it is, what it holds, and who uses it for what, ' +
    'before using it in later bullets. Never let it appear out of nowhere.',
  '4. Do not drop objects. Write "writes the integer v into the slot currently at the write position", not "writes to the write position".',
  '5. The summary only states the goal, the external behavior, and the key conventions. Complex reasoning, line-by-line syntax, ' +
    'and condition walkthroughs belong in the steps below.',
  '6. Prefer writing conditionals as:',
  '   `condition`:',
  '   - True: ...',
  '   - False: ...',
  '   The standard and detailed tiers must write out the True / False walkthrough. The concise tier states results only.',
  '7. Every bullet should be information-dense, but do not pile up jargon. Never use "Key point / Context / Definition / Caveat" as fixed labels; ' +
    'use descriptive headings like "the full condition", "the empty condition", "the ordering", "why judge it this way".',
  '8. Do not force every step into the same sentence pattern. Avoid template flavor and AI smell.',
].join('\n');

/** 档位规则 —— 用户 D94 模板的英文面（按当前档只实例化一节）。 */
export const TIER_RULES_EN: Record<ExplainStyle, string> = {
  concise: [
    '## concise tier',
    '',
    'Goal: let the reader quickly know "what this code does, and what happens on success and failure".',
    '',
    '- Shape: summary + 1-2 steps. One or two paragraphs (or bullets) per step; do not shred it.',
    '- Cover only the goal, the result, and the external behavior. Do not explain internal variable names, modulo, pointers, or ordering reasons.',
    '- Prefer "read position / write position"; avoid code names like head / tail.',
    '- The writer wants to store an integer: full → refuse and return failure; not full → store it and return success.',
    '- The reader wants to take an integer: empty → refuse and return failure; not empty → take one and return success.',
    '- No True / False walkthrough.',
    '- Direct language; avoid repeating template sentences like "the goal is to ...; if ..., then ...".',
  ].join('\n'),
  standard: [
    '## standard tier',
    '',
    'Goal: explain the key conditions, the order of operations, and the reasons — without walking through syntax line by line.',
    '',
    '- Shape: summary + Step N + bullets.',
    '- The summary states the goal, the external behavior, and the empty / full conventions.',
    '- Steps must cover:',
    '  - The conditions: what happens when it is True, what when False.',
    '  - Why it is judged this way: e.g. writing while full would make the write position coincide with the read position, ' +
      'and coincidence means empty — the two states would be indistinguishable.',
    '  - The ordering: write first, then advance; read first, then advance — otherwise the other side may read data that is not ready yet, ' +
      'or overwrite data that has not been handed over.',
    '- Code names like head / tail are allowed, but the first mention must say what they are.',
    '- Do not explain syntax line by line: #include, #define, typedef, rb->, *out, %, etc.',
  ].join('\n'),
  detailed: [
    '## detailed tier',
    '',
    'Goal: for beginners — go line by line (or block by block) and explain what every line does and why it is written that way.',
    '',
    '- Shape: summary + Step N + bullets. Bullets are organized by line numbers or line blocks.',
    '- The summary only states the whole; no walkthroughs there — complex logic goes into the line-by-line part below.',
    '- Every line explanation must be explicit about:',
    '  - What this line defines, what it holds, who uses it for what.',
    '  - What the syntax means: e.g. #include, #define, typedef struct, rb->, *out, % modulo.',
    '  - Full True / False walkthroughs for conditionals.',
    '- "Why is (tail + 1) % N == head the full condition" must get its own expansion: an example, the walkthrough, ' +
      'and the reason one slot is left empty. E.g. suppose head=0 and tail=15: writing one more makes tail wrap to 0 and coincide with head, ' +
      'and coincidence means empty — so the last empty slot must not be written.',
    '- Add the points beginners usually get stuck on: empty vs full, modulo wrapping, pointer syntax, the lock-free assumption.',
    '- No colloquial metaphors.',
  ].join('\n'),
};

/**
 * 「取件」一节的英文面 —— 与中文版同一条扩展适配：没有它模型不会正确使用 `fetch_context`。
 * 含 D96 的「不要猜路径」一条（两种语言同口径）。
 */
export function fetchSectionEn(crossFile: boolean, maxFetchLines?: number): string {
  if (!crossFile) {
    return [
      '# Fetching context (tool available in this environment)',
      '',
      'If the information you have is not enough for an accurate explanation (say, you only see a few scattered lines, ' +
        'or you do not recognize a struct or a macro),',
      `you may call the tool \`${FETCH_CONTEXT_TOOL.name}\` to request more context. Rules:`,
      '- Call it only when you **really** need it. If you can explain it with what you have, do not fetch "just to be safe".',
      '- Request one small span at a time (lines for code, pages for PDF), and always give both `start` and `end`.',
      '- You may only fetch **the file the anchor is in**, no other file.',
      '- The number of fetches is limited, and a range you already fetched will not be given twice.',
      '- After you receive a fetch result, produce the final JSON — do not keep fetching.',
    ].join('\n');
  }
  const limit = typeof maxFetchLines === 'number' && maxFetchLines > 0 ? maxFetchLines : null;
  return [
    '# Fetching context (tool available in this environment)',
    '',
    'If the information you have is not enough for an accurate explanation (say, you only see a few scattered lines, ' +
      'or you do not recognize a struct or a macro),',
    `you may call the tool \`${FETCH_CONTEXT_TOOL.name}\` to request more context. Rules:`,
    '- Call it only when you **really** need it. If you can explain it with what you have, do not fetch "just to be safe".',
    '- Request one small span at a time (lines for code, pages for PDF), and always give both `start` and `end`.',
    '- **You may read files other than the anchor file** — name the file with `path` (a relative path is resolved ' +
      'against **the directory of the anchor file**, e.g. `ring_buffer.h`); omitting `path` means "the anchor file itself".',
    '  Macro definitions, types/structs, and **the callers or callees** usually live in other files —',
    '  when you cannot explain "where the data comes from and who consumes it", go read them; that is encouraged. ' +
      'The user once put it this way: "There is no cross-file understanding — embedded code and the like is scattered across many files."',
    '- Read **one** span of **one** file per fetch: **take only the span you actually need** (do not ask for a whole file "since you can") ' +
      (limit === null ? '; conclude once you have read it.' : `, at most ${limit} lines per fetch — asking for more only gets you the first ${limit} lines.`),
    '- **Do not guess paths** — `path` must either be copied verbatim from the "Files that may be related" list, ' +
      'or be a path you saw with your own eyes in content you already read. Directories you made up (such as build-output dirs) usually do not exist; ' +
      'a nonexistent path only earns a fetch failure and wastes a round.',
    '- Secrets, dependency directories (`node_modules`), and build outputs cannot be read — do not try.',
    '- You may only cite files **you actually read** (or the anchor file) in the explanation — a file you never read must not appear in a location.',
    '- The number of fetches is limited, and a range you already fetched will not be given twice.',
    '- After you receive a fetch result, produce the final JSON — do not keep fetching.',
  ].join('\n');
}

export function examplesSectionEn(style: ExplainStyle): string {
  const headings: Record<ExplainStyle, string> = {
    standard: '## Standard tier example',
    concise: '## Concise tier example',
    detailed: '## Detailed tier example',
  };
  return [
    '# Examples (few-shot)',
    '',
    'The examples set the tone, the depth, and the density of sentences. If an example conflicts with the rules above, the rules win — ' +
      'but prefer to imitate the rhythm of the example.',
    '',
    headings[style],
    '',
    TIER_EXEMPLAR_EN[style],
  ].join('\n');
}

export function buildSystemPromptEn(
  style: ExplainStyle,
  options: { crossFile?: boolean; maxFetchLines?: number; examples?: boolean } = {},
): string {
  const crossFile = options.crossFile === true;
  const withExamples = options.examples !== false;
  const parts = [
    roleSectionEn(style),
    outputShapeSectionEn(crossFile),
    GENERAL_RULES_SECTION_EN,
    `# Tier rules\n\n${TIER_RULES_EN[style]}`,
    fetchSectionEn(crossFile, options.maxFetchLines),
  ];
  if (withExamples) parts.push(examplesSectionEn(style));
  return parts.join('\n\n');
}

/** 行区间 / 页码的英文格式（与 core 的 `formatLineRange` 同一立场：单行不写区间）。 */
function lineRangeEn(lineStart: number, lineEnd: number): string {
  return lineEnd > lineStart ? `lines ${lineStart}-${lineEnd}` : `line ${lineStart}`;
}

/** 锚点描述的英文面（`describeAnchor` 的对应版；字段口径完全一致）。 */
export function describeAnchorEn(anchor: Anchor): string {
  const lines: string[] = [`Source type: ${anchor.sourceType}`, `Document name: ${anchor.sourceName}`];
  const loc = anchor.location;

  if (isCodeLocation(loc)) {
    lines.push(`File path: ${loc.filePath}`, `Location: ${lineRangeEn(loc.lineStart, loc.lineEnd)}`);
    if (anchor.segments !== undefined && anchor.segments.length > 1) {
      lines.push(
        `**This is a non-contiguous multi-segment selection**, ${anchor.segments.length} segments in total:`,
        anchor.segments.map((s, i) => `  Segment ${i + 1}: lines ${s.lineStart}-${s.lineEnd}`).join('\n'),
        'The "lines X-Y" above is only the outer frame of these segments; lines inside the frame that are not listed ' +
          '**were not selected** — explain only the listed segments.',
      );
    }
    const dir = dirnameOf(loc.filePath);
    if (dir !== '' && dir !== '/' && !/^[A-Za-z]:$/u.test(dir)) lines.push(`Directory: ${dir}`);
  } else if (isPDFLocation(loc)) {
    lines.push(`Page: ${loc.page}`, `Selected box (normalized): ${loc.bbox.join(', ')}`);
  } else {
    lines.push(`Location: ${locationLabel(loc)}`);
  }
  return lines.join('\n');
}

export function buildUserPromptEn(
  anchor: Anchor,
  options: { candidates?: readonly string[]; focus?: string; crossFile?: boolean } = {},
): string {
  const parts = ['## Anchor', describeAnchorEn(anchor), ''];

  if (options.focus !== undefined && options.focus.trim() !== '') {
    parts.push(
      '## The line the user wants to follow',
      options.focus.trim(),
      'Organize the steps around this line (it takes priority over "explain it all from the top").',
      '',
    );
  }

  if (anchor.extractedText && anchor.extractedText.trim() !== '') {
    parts.push('## Source text at the anchor', '```', anchor.extractedText, '```', '');
  } else {
    parts.push(
      '## Source text at the anchor',
      '(No source text was provided. If the location above is not enough for an accurate explanation, call the fetch tool.)',
      '',
    );
  }

  const candidates = options.candidates ?? [];
  if (options.crossFile === true && candidates.length > 0) {
    parts.push(
      '## Files that may be related',
      'These are files in the workspace logically related to the anchor file (sorted by relevance; ones mentioned by `#include` come first).',
      'The list is only a **lead** — you do not have to use it; but if the explanation needs to touch what is inside them ' +
        '(macros, structs, callers),',
      '**read them with the fetch tool first** (put the name in `path`, one file at a time):',
      ...candidates.map((name) => `- ${name}`),
      '',
    );
  }

  parts.push('Now produce the explanation JSON as required by the system prompt.');
  return parts.join('\n');
}

/** repair 提示的英文面（口径与 `explainOutputContractEn` 一致 —— D67 的规矩两种语言都成立）。 */
export function buildRepairPromptEn(rawPrevious: string, issues: string, options: { crossFile?: boolean } = {}): string {
  return [
    'Your previous output did not pass validation.',
    '',
    'Problems found:',
    issues,
    '',
    'Your previous output (verbatim):',
    '```',
    rawPrevious.slice(0, 4000),
    '```',
    '',
    'Output **only the corrected JSON** — do not explain what you changed, and do not repeat the problem list.',
    explainOutputContractEn(options.crossFile === true),
  ].join('\n');
}
