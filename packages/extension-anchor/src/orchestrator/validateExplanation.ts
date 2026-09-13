/**
 * 输出校验闸门。事实源：docs/CONTRACTS.md §3.3。
 *
 * @anchor 这是「AI 输出不可信」的唯一入口。所有渲染（decoration / 侧边栏 / 状态栏）
 *         都只消费本模块**重建**出来的对象，不直接消费模型返回的 JSON ——
 *         因此坐标越界、文件漫游、缺字段这类问题不可能漏到渲染层。
 *
 * 本文件属 orchestrator 层，**禁止 import 'vscode'**（可在 node --test 下直测）。
 *
 * 与 §3.3 的逐条对应：
 *   1. 容忍 ```json 围栏与前后散文      → parseMaybeJson
 *   2. steps≥1 / confidence∈[0,1] / summary 非空 → checkEnvelope
 *   3. 每个 step（含 highlights）的 location 合法性 → checkLocation
 *   4. 不做覆盖度校验（D16）
 *   5. 失败 → 返回 issues，由调用方决定重试还是报错（S3 接 repair prompt）
 */

import {
  coerceBBox,
  isCodeLocation,
  isPDFLocation,
  isValidBBox,
} from '@anchor/core';
import type {
  Anchor,
  BBox,
  ExplanationResult,
  HighlightEmphasis,
  Location,
  SubHighlight,
  WalkthroughStep,
} from '@anchor/core';
import { samePath } from '../paths.ts';

export interface ValidationIssue {
  /** JSON 路径，如 `steps[2].highlights[0].location.bbox`；顶层问题用 `$` */
  path: string;
  message: string;
}

/** §3.3 里 `ctx` 的两项上界。取不到就传 `null`，跳过该上界检查（不是跳过整条 location 校验）。 */
/**
 * §3.3 的放行选项（S9a）。
 *
 * @anchor `allowedPaths` = **模型这次真取过件的文件**（不含锚点文件，那个永远允许）。
 *         跨文件讲解就靠它把关：**不是不许出去，是"出去过的地方才许写"** ——
 *         模型没读过 `isr.c` 却把某一步放到 `isr.c` 里，仍然判失败。
 *         第二道闸门（`commands.ts` 里那次）也从取件日志收集同一个集合传进来。
 */
export interface ExplanationValidationOptions {
  readonly allowedPaths?: readonly string[];
}

export interface ExplanationOutline {
  /** code：文档总行数 */
  documentLineCount?: number | null;
  /** pdf：总页数 */
  pageCount?: number | null;
}

export type ExplanationValidation =
  | { ok: true; result: ExplanationResult; issues: readonly [] }
  | { ok: false; issues: readonly ValidationIssue[] };

const EMPHASES: readonly HighlightEmphasis[] = ['primary', 'context', 'definition', 'caveat'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 把 `emphasis` 归一化成配色档位。
 *
 * **未知值一律降级为 undefined（不判失败）**：§4.3 的 emphasis 只影响颜色，
 * 为一个装饰性字段把整段讲解判死，代价远大于收益（真实模型很容易多写个空格或换行）。
 * 但形状不是字符串就按缺省处理，同样不判失败。
 */
export function coerceEmphasis(raw: unknown): HighlightEmphasis | undefined {
  if (typeof raw !== 'string') return undefined;
  const norm = raw.trim().toLowerCase();
  return EMPHASES.find((e) => e === norm);
}

/**
 * 抽出 JSON：容忍 ```json 围栏、``` 裸围栏、以及前后夹的散文。
 * 已经解析好的对象（S1 的 fakeProvider 走的就是这条）原样返回。
 */
export function parseMaybeJson(raw: unknown): { value: unknown } | { error: string } {
  if (typeof raw !== 'string') return { value: raw };

  const text = raw.trim();
  if (text === '') return { error: 'AI 返回了空内容' };

  const direct = tryParse(text);
  if (direct.ok) return { value: direct.value };

  // ```json ... ``` / ``` ... ```：**逐个围栏都试**，不只试第一个 ——
  // 模型完全可能先给一段示例或坏掉的一截，再给真正的那份。
  for (const fence of text.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)) {
    const inner = fence[1];
    if (inner === undefined) continue;
    const parsed = tryParse(inner.trim());
    if (parsed.ok) return { value: parsed.value };
  }

  // 第一层 `{` 到最后一层 `}`：兜住"这里是讲解：{...} 希望有帮助"这种散文包裹
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const sliced = tryParse(text.slice(start, end + 1));
    if (sliced.ok) return { value: sliced.value };
  }

  return { error: `无法从 AI 输出里解析出 JSON：${direct.error}` };
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * §3.3 第 3 条的 bbox 部分。
 *
 * `coerceBBox` 会把越界分量裁进 [0,1]，所以这里必须回头查**原始值**：
 * §3.3 要求四项 ∈ [0,1]，不是"裁进来就算合法"。
 */
function checkBBox(raw: unknown, path: string, issues: ValidationIssue[]): BBox | null {
  const box = coerceBBox(raw);
  if (!box) {
    issues.push({ path, message: 'bbox 必须是 4 个有限数字（NaN / Infinity 判无效，不静默清零）' });
    return null;
  }
  // coerceBBox 会裁剪越界分量，所以必须回头查原始值：§3.3 要求四项 ∈ [0,1]，不是"裁进来就行"
  const inRange = Array.isArray(raw) && raw.every((n) => typeof n === 'number' && n >= 0 && n <= 1);
  if (!inRange) {
    issues.push({ path, message: `bbox 四个分量必须落在 [0,1]，收到 ${JSON.stringify(raw)}` });
    return null;
  }
  if (!isValidBBox(box)) {
    issues.push({ path, message: 'bbox 退化：必须 x1 < x2 且 y1 < y2（零面积框无法定位）' });
    return null;
  }
  return box;
}

/**
 * §3.3 第 3 条：location 必须与 anchor 同源、且在文档范围内。
 * 返回**重建**后的 Location（只保留契约字段），不合法返回 null。
 */
function checkLocation(
  raw: unknown,
  anchor: Anchor,
  outline: ExplanationOutline,
  path: string,
  issues: ValidationIssue[],
  allowedPaths: readonly string[],
): Location | null {
  if (!isRecord(raw)) {
    issues.push({ path, message: 'location 必须是对象' });
    return null;
  }

  // 收窄成 Location 联合，好让下面的类型守卫（签名要求 `Location`）能接住它。
  // 这一步**不构成信任**：每个分支仍需逐字段验证，最后返回的是重建过的新对象。
  const loc = raw as unknown as Location;

  if (anchor.sourceType === 'code') {
    if (!isCodeLocation(anchor.location)) {
      issues.push({ path: '$', message: '内部错误：anchor.sourceType 是 code，但 anchor.location 不是 CodeLocation' });
      return null;
    }
    if (!isCodeLocation(loc)) {
      issues.push({ path, message: 'anchor 是代码来源，此处 location 必须是 CodeLocation（含 filePath/lineStart/lineEnd）' });
      return null;
    }
    // §3.3 第 3 条（S9a 改写）：可以落在**别的文件**，但只限"锚点文件 ∪ 这次真取过件的文件"。
    const allowed =
      samePath(loc.filePath, anchor.location.filePath) ||
      allowedPaths.some((p) => samePath(p, loc.filePath));
    if (!allowed) {
      issues.push({
        path: `${path}.filePath`,
        message:
          `这个文件没读过，不能引用：收到 ${loc.filePath}。` +
          `只允许锚点所在的文件（${anchor.location.filePath}），或者你这次用取件工具读过的文件。`,
      });
      return null;
    }
    const { lineStart, lineEnd } = loc;
    if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd)) {
      issues.push({ path, message: `行号必须是整数，收到 ${lineStart}-${lineEnd}` });
      return null;
    }
    if (lineStart < 1 || lineEnd < lineStart) {
      issues.push({ path, message: `行号区间非法：${lineStart}-${lineEnd}（要求 1 ≤ lineStart ≤ lineEnd）` });
      return null;
    }
    // 行上界只对**锚点文件**成立：别的文件的行数校验层拿不到（它是同步纯函数），
    // 那些文件由适配器把 end 夹到文件末尾（S9a）
    const total = samePath(loc.filePath, anchor.location.filePath) ? outline.documentLineCount : null;
    if (total != null && lineEnd > total) {
      issues.push({ path, message: `行号越界：${lineEnd} 超出文档总行数 ${total}` });
      return null;
    }
    return { filePath: loc.filePath, lineStart, lineEnd };
  }

  if (anchor.sourceType === 'pdf') {
    if (!isPDFLocation(loc)) {
      issues.push({ path, message: 'anchor 是 PDF 来源，此处 location 必须是 PDFLocation（含 page/bbox）' });
      return null;
    }
    if (!Number.isInteger(loc.page) || loc.page < 1) {
      issues.push({ path: `${path}.page`, message: `页码必须是不小于 1 的整数，收到 ${loc.page}` });
      return null;
    }
    const total = outline.pageCount;
    if (total != null && loc.page > total) {
      issues.push({ path: `${path}.page`, message: `页码越界：${loc.page} 超出总页数 ${total}` });
      return null;
    }
    const bbox = checkBBox(loc.bbox, `${path}.bbox`, issues);
    if (!bbox) return null;
    return { page: loc.page, bbox };
  }

  issues.push({ path, message: `不支持来源类型：${anchor.sourceType}（web 本次不接入）` });
  return null;
}

function checkHighlights(
  raw: unknown,
  anchor: Anchor,
  outline: ExplanationOutline,
  stepPath: string,
  issues: ValidationIssue[],
  allowedPaths: readonly string[],
): SubHighlight[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    issues.push({ path: `${stepPath}.highlights`, message: 'highlights 必须是数组' });
    return undefined;
  }

  const out: SubHighlight[] = [];
  raw.forEach((h, j) => {
    const path = `${stepPath}.highlights[${j}]`;
    if (!isRecord(h)) {
      issues.push({ path, message: '子高亮必须是对象' });
      return;
    }
    const location = checkLocation(h.location, anchor, outline, `${path}.location`, issues, allowedPaths);
    if (!location) return;
    if (typeof h.narration !== 'string' || h.narration.trim() === '') {
      issues.push({ path: `${path}.narration`, message: '子高亮的 narration 必须是非空字符串' });
      return;
    }
    // 只挂已确认存在的键：`emphasis: undefined` 也会出现在 Object.keys 里，
    // 一路带到 webview 就是个"看起来有值其实没有"的字段，不如根本不写。
    const sub: SubHighlight = { location, narration: h.narration };
    const emphasis = coerceEmphasis(h.emphasis);
    if (emphasis !== undefined) sub.emphasis = emphasis;
    out.push(sub);
  });

  return out.length > 0 ? out : undefined;
}

function checkSteps(
  raw: unknown,
  anchor: Anchor,
  outline: ExplanationOutline,
  issues: ValidationIssue[],
  allowedPaths: readonly string[],
): WalkthroughStep[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    issues.push({ path: '$.steps', message: 'steps 必须是长度不小于 1 的数组' });
    return [];
  }

  const steps: WalkthroughStep[] = [];
  raw.forEach((s, i) => {
    const path = `steps[${i}]`;
    if (!isRecord(s)) {
      issues.push({ path, message: 'step 必须是对象' });
      return;
    }
    const location = checkLocation(s.location, anchor, outline, `${path}.location`, issues, allowedPaths);
    if (!location) return;

    // §3.3 未逐字要求 text 非空，但空 text 的 step 在侧边栏里是一片空白——
    // 与其渲染一个说不出话的步骤，不如让模型重来一次。这是**比 §3.3 严一格**的规则。
    if (typeof s.text !== 'string' || s.text.trim() === '') {
      issues.push({ path: `${path}.text`, message: 'step.text 必须是非空字符串' });
      return;
    }

    // 逐字段挂载而非一次性字面量：`key: undefined` 也是存在的键，
    // 会跟着对象一路带到渲染层，表现成"这个字段有值但值是空的"。
    const step: WalkthroughStep = { location, text: s.text };
    if (typeof s.color === 'string' && s.color.trim() !== '') step.color = s.color;
    if (typeof s.title === 'string' && s.title.trim() !== '') step.title = s.title;
    if (typeof s.intro === 'string' && s.intro.trim() !== '') step.intro = s.intro;
    const highlights = checkHighlights(s.highlights, anchor, outline, path, issues, allowedPaths);
    if (highlights !== undefined) step.highlights = highlights;

    steps.push(step);
  });

  return steps;
}

/**
 * 校验并**重建** `ExplanationResult`。
 *
 * 返回的 `result` 只含契约字段：模型多塞的键（哪怕叫 `__proto__`）不会流到渲染层。
 */
export function validateExplanation(
  raw: unknown,
  anchor: Anchor,
  outline: ExplanationOutline = {},
  options: ExplanationValidationOptions = {},
): ExplanationValidation {
  const issues: ValidationIssue[] = [];
  const allowedPaths = options.allowedPaths ?? [];

  const parsed = parseMaybeJson(raw);
  if ('error' in parsed) return { ok: false, issues: [{ path: '$', message: parsed.error }] };

  const root = parsed.value;
  if (!isRecord(root)) return { ok: false, issues: [{ path: '$', message: 'AI 输出必须是 JSON 对象' }] };

  if (typeof root.summary !== 'string' || root.summary.trim() === '') {
    issues.push({ path: '$.summary', message: 'summary 必须是非空字符串' });
  }

  const confidence = root.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    issues.push({ path: '$.confidence', message: `confidence 必须是 [0,1] 内的数字，收到 ${JSON.stringify(confidence)}` });
  }

  const steps = checkSteps(root.steps, anchor, outline, issues, allowedPaths);

  if (issues.length > 0) return { ok: false, issues };

  const result: ExplanationResult = {
    steps,
    summary: root.summary as string,
    confidence: confidence as number,
  };
  if (typeof root.title === 'string' && root.title.trim() !== '') result.title = root.title;

  return { ok: true, issues: [], result };
}

/** 给用户看的一行摘要；也用于 S3 的 repair prompt 回灌。 */
export function describeIssues(issues: readonly ValidationIssue[]): string {
  const head = issues
    .slice(0, 3)
    .map((i) => `${i.path}：${i.message}`)
    .join('；');
  return issues.length > 3 ? `${head}；…另有 ${issues.length - 3} 处` : head;
}
