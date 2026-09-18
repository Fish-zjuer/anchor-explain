/**
 * 多段锚点：把「用户一次一次选出来的几段」合成**一个**锚点去讲（D80）。
 *
 * @anchor 为什么要单独一个文件：合并这件事有**多条路与多个坏答案**
 *         （区间要不要排序去重？段间的空白要不要算进去？每段的名字怎么标？跨域文件怎么办？），
 *         而且它是**纯函数** —— 放在 core 里能被 `node --test` 直接测，
 *         不必等 extension 那一侧的 vscode 桩。
 *
 * 本文件属 core，**禁止 import 'vscode'**。
 */

import type { Anchor, CodeLocation } from './types.ts';
import { isCodeLocation } from './types.ts';
import { samePath } from './paths.ts';

/**
 * 一段选区的完整身信息。
 *
 * 为什么连 `text` 一起带上：`Anchor.extractedText` 是从**选区**来的，
 * 队列里存文本比存行号后再回头读文件可靠 —— 中间用户可能改了文件，
 * 那时我们宁可讲"选的那一刻看到的字"（STALENESS 那条由 `documentTextHash` 负责报）。
 */
export interface AnchorSegment {
  filePath: string;
  lineStart: number; // 1-based, inclusive
  lineEnd: number; // 1-based, inclusive
  text: string;
}

/** 队列为空时不该悄悄讲一份空东西 —— 明说。 */
export class EmptyQueueError extends Error {
  constructor() {
    super('还没有选中任何段。');
    this.name = 'EmptyQueueError';
  }
}

/**
 * 所有段必须落在**同一个文件**里。
 *
 * 为什么不允许跨文件多段：一次讲解只有一个锚点文件（`sessionAnchorPath`、
 * D78 的收尾判据、以及"这次讲解到头了"的判据都是按"一个锚点文件"写的）。
 * 多文件的 spread 讲解会牵动那一整套语义，收益却很小 ——
 * 真要跨文件，取件那一跳（`FETCH_CONTEXT_TOOL`）已经在做这件事了。
 */
export function sameFileAsFirst(segments: readonly AnchorSegment[]): boolean {
  if (segments.length <= 1) return true;
  const first = segments[0]!.filePath;
  return segments.every((s) => samePath(s.filePath, first));
}

/** 一段的行区间（比较器只需要这两个字段，`AnchorSegment` 与 `CodeLocation` 都符合它） */
interface SegmentRange {
  readonly lineStart: number;
  readonly lineEnd: number;
}

/**
 * **唯一的行序比较器**。
 *
 * @anchor 为什么单独导出：同一个"第 1 段"必须在**三个地方指同一段** ——
 *         队列那一行列出的一段、用户可以点掉的那一段、发给模型时标了号的那一段。
 *         排序若各处（比如只有 merge 时）排一遍，用户点掉"第 1 段"移除的
 *         其实是模型眼里的第 2 段 —— 那是最难发现的一类错：它不报错、不崩，
 *         只是讲的内容与用户以为的对不上。所以比较器只有这一个，加完当场就排。
 */
export function compareSegments(a: SegmentRange, b: SegmentRange): number {
  return a.lineStart - b.lineStart || a.lineEnd - b.lineEnd;
}

/**
 * 把几段合成一个 `Anchor`。段按**行号**排序 ——
 * 用户选的顺序常常是"想到哪选到哪"，而模型（与人）读一段从上到下的代码最省力。
 *
 * **不刻意去重区间**：两段重叠通常意味着"我想把这两句连在一起讲"，
 * 合并成一个并集区间是合理行为；强行去重反而会让用户纳闷"我那段怎么没了"。
 */
export function mergeSegments(
  segments: readonly AnchorSegment[],
  meta: { sourceId: string; sourceName: string; focus?: string },
): Anchor {
  if (segments.length === 0) throw new EmptyQueueError();
  if (!sameFileAsFirst(segments)) {
    throw new Error('这几段不在同一个文件里 —— 一次讲解只支持同一个文件内的多段。');
  }

  const ordered = [...segments].sort(compareSegments);
  const first = ordered[0]!;

  const locations: CodeLocation[] = ordered.map((s) => ({
    filePath: s.filePath,
    lineStart: s.lineStart,
    lineEnd: s.lineEnd,
  }));

  // 锚点的 location = **并集的外框**。
  // 它必须保留单的形状（`CodeLocation`），否则下游几十处（decoration、§3.3 校验、
  // `locationLabel` 显示、D78 的锚点文件判据）都要改。
  // 代价是"段之间的空白行也在框里"，但那本来就是这个文件的真实内容，不算错；
  // 真正指出"哪些是用户选的"的是下面的 `segments` 与标了号的原文。
  const union: CodeLocation = {
    filePath: first.filePath,
    lineStart: first.lineStart,
    lineEnd: ordered.reduce((max, s) => Math.max(max, s.lineEnd), first.lineEnd),
  };

  return {
    sourceType: 'code',
    sourceId: meta.sourceId,
    sourceName: meta.sourceName,
    location: union,
    extractedText: composeText(ordered),
    // 每一段的行区间都留着：模型据此知道"用户说的是这几块，中间那些行没被选中"
    segments: locations,
    ...(typeof meta.focus === 'string' && meta.focus.trim() !== '' ? { focus: meta.focus.trim() } : {}),
  };
}

/**
 * 多段原文的拼法。**必须标号**，否则模型面对一坨连续文本，
 * 会把它读成"这是一段完整代码" —— 于是它会去讲那些**中间的空隙**，
 * 而那些行用户从来没选过。
 */
function composeText(ordered: readonly AnchorSegment[]): string {
  if (ordered.length === 1) return ordered[0]!.text;

  const parts: string[] = [
    `注意：下面是同一个文件里的 ${ordered.length} 段代码，按行号从上到下排列；`,
    '段与段之间的行**没有**被选中，不必讲它们。',
    '',
  ];

  ordered.forEach((seg, i) => {
    parts.push(`— 第 ${i + 1} 段（第 ${seg.lineStart}-${seg.lineEnd} 行）—`, seg.text, '');
  });

  return parts.join('\n');
}

/**
 * `Anchor` 里那几段的**行号区间**（只认代码锚点）。
 *
 * 为什么单独一个取值函数：`Anchor.segments` 是可选的，且 PDF 锚点没有它 ——
 * 调用方各自去判 `isCodeLocation(anchor.location) && Array.isArray(anchor.segments)`，
 * 迟早有一处漏判。集中一处，语义也就只有一个。
 */
export function segmentsOf(anchor: Anchor): readonly CodeLocation[] | undefined {
  if (!isCodeLocation(anchor.location)) return undefined;
  return anchor.segments;
}

/** 一句话说清"讲了哪几段"，给开始面板与「显示状态」共用（与 `captureSummary` 同一条立场）。 */
export function describeSegments(segments: readonly AnchorSegment[]): string {
  if (segments.length === 0) return '没有选中任何段';
  return segments
    .map((s) => `${s.lineStart}-${s.lineEnd}`)
    .join(' + ');
}
