/**
 * 第二步：一页的行 → 分栏判定。
 *
 * @anchor 目标域是教材与论文，最常见的版面是**单栏**与**双栏**（IEEE/ACM、教材正文）。
 *         判据是经典的 x 向投影：把页面横向切成 100 个桶，统计每个桶被文字盖住的
 *         纵向高度；**贯穿页面内容高度的白缝**就是栏间沟。只认页宽中段（25%–75%）
 *         的沟 —— 边上的白是页边距，不是栏沟。
 *         跨沟的行（通栏标题、图表说明）不是"分栏错了"，是**spanner**：它按自己的
 *         y 位置插回阅读流（order.ts），不参与左右栏的先后判定。
 *
 * 本文件零依赖。
 */

import type { Line } from './lines.ts';

export interface PageLayout {
  /** 1 = 单栏；2 = 双栏（更多栏的版面按单栏退化 —— 罕见且错了有手修兜底） */
  colCount: 1 | 2;
  /** 双栏时栏沟的中心 x（归一化） */
  gutter?: number;
  /** 跨沟的行（通栏内容） */
  spanners: Line[];
  /** 左（单栏时=唯一）栏的行，已按 y 排好 */
  left: Line[];
  /** 右栏的行，已按 y 排好（仅双栏时有意义） */
  right: Line[];
}

const BUCKETS = 100;
/** 沟的最小宽度（页宽的 2%）：再窄多半是字距，不是栏沟 */
const MIN_GUTTER_BUCKETS = 2;

export function detectColumns(lines: readonly Line[]): PageLayout {
  if (lines.length < 6) {
    return { colCount: 1, spanners: [], left: lines.slice().sort((a, b) => a.y - b.y), right: [] };
  }

  /**
   * 每个桶**有几条行**跨过。判据用行数而不用覆盖高度：通栏标题/图注只有一两条，
   * 按"行数 ≤ max(1, 12%)" 它们盖不住栏沟 —— 按"覆盖高度"的话，短页上一条通栏
   * 标题的高度占比就能一票否决真实的栏沟（单测里抓到的）。
   */
  const lineCount = new Array<number>(BUCKETS).fill(0);
  for (const l of lines) {
    const from = Math.max(0, Math.floor(l.x * BUCKETS));
    const to = Math.min(BUCKETS - 1, Math.floor((l.x + l.w) * BUCKETS));
    for (let b = from; b <= to; b += 1) lineCount[b] = (lineCount[b] ?? 0) + 1;
  }
  const emptyCeiling = Math.max(1, Math.round(lines.length * 0.12));

  // 中段里找最长的连续空白沟
  let bestStart = -1;
  let bestLen = 0;
  let runStart = -1;
  for (let b = 0; b < BUCKETS; b += 1) {
    const inMiddle = b / BUCKETS >= 0.25 && b / BUCKETS <= 0.75;
    const empty = inMiddle && (lineCount[b] ?? 0) <= emptyCeiling;
    if (empty) {
      if (runStart < 0) runStart = b;
      if (b - runStart + 1 > bestLen) {
        bestLen = b - runStart + 1;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
    }
  }

  const twoColumn =
    bestLen >= MIN_GUTTER_BUCKETS && bestStart >= 0
      ? (() => {
          const gutter = (bestStart + bestLen / 2) / BUCKETS;
          const left: Line[] = [];
          const right: Line[] = [];
          const spanners: Line[] = [];
          for (const l of lines) {
            if (l.x < gutter && l.x + l.w > gutter) spanners.push(l);
            else if (l.x + l.w / 2 < gutter) left.push(l);
            else right.push(l);
          }
          // 两边都得有像样的内容才算双栏；跨沟的行超过四成说明根本不是分栏版面
          return left.length >= lines.length * 0.25 &&
            right.length >= lines.length * 0.25 &&
            spanners.length <= lines.length * 0.4
            ? { colCount: 2 as const, gutter, left: left.sort((a, b) => a.y - b.y), right: right.sort((a, b) => a.y - b.y), spanners }
            : null;
        })()
      : null;

  if (twoColumn) return twoColumn;
  return { colCount: 1, spanners: [], left: lines.slice().sort((a, b) => a.y - b.y), right: [] };
}
