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
import type { TextItemIn } from './types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// P0（实测返工）：**分栏判定必须发生在成行之前**。
//
// @anchor 为什么顺序不能反：行合并与分栏判定用的是同一个量（水平间距），
//         而两栏之间的沟**可能比同一个栏内的某些间隙还窄**。ACM 双栏论文实测：
//         栏沟只有 0.02（=1.7×行高），而"把一行拼完整"需要的容差是 2.5×行高 ——
//         用同一个阈值同时干两件事，必然在紧栏沟的版面上把两栏并进一行。
//         后果不是"顺序略有出入"，而是**75% 的正文变成两栏交错的乱序**
//         （TraceMonkey 第 5 页那个 6019 字的块：左栏一句、右栏一句交替出现）。
//
//         所以主路径改成：**先按 item 的左边缘直方图切栏 → 再在各栏内成行**。
//         左边缘是双峰分布时（0.1 处 65 个、0.50 处 58 个），切栏判据非常干净；
//         判不出来就退回单栏（`detectColumns` 那条老路径仍然保留作兜底）。
// ─────────────────────────────────────────────────────────────────────────────

/** 每个"栏"的文字项（尚未成行）。`spanners` 是跨栏的通栏内容（标题、通栏图注）。 */
export interface ItemColumns {
  colCount: 1 | 2;
  /** 双栏时判定用的分界 x（两簇左边缘之间的中线） */
  splitX?: number;
  left: TextItemIn[];
  right: TextItemIn[];
  spanners: TextItemIn[];
}

const HIST_BUCKETS = 100;
/** 计入"一栏"的最小占比：一栏至少占 15% 的文字项，否则那是零星缩进而非一栏 */
const MIN_CLUSTER_SHARE = 0.15;
/** 两簇的中心至少差这么远才算两栏（防止把"正文 + 缩进的引文"当成两栏） */
const MIN_CENTER_DISTANCE = 0.15;
/** 通栏判据：从左侧栏区开始、却伸进右侧栏区的项 */
const SPANNER_MARGIN = 0.01;

/**
 * 按文字项的**左边缘**直方图切栏。
 *
 * 为什么用左边缘而不是"占用覆盖"：栏的起点是齐的（正文每行都从栏的左边界开始），
 * 所以左边缘天然是双峰；而覆盖面积会被通栏标题、插图之类的东西污染。
 */
export function partitionItems(items: readonly TextItemIn[]): ItemColumns {
  const kept = items.filter((it) => it.str.trim() !== '');
  const single = (): ItemColumns => ({ colCount: 1, left: kept.slice(), right: [], spanners: [] });
  if (kept.length < 10) return single(); // 项太少时双峰统计不可靠，宁可当单栏

  // 左边缘直方图 → 连续占用的簇（允许 2 个空桶的缝，容纳缩进造成的偏移）
  const hist = new Array<number>(HIST_BUCKETS).fill(0);
  for (const it of kept) {
    const b = Math.min(HIST_BUCKETS - 1, Math.max(0, Math.floor(it.x * HIST_BUCKETS)));
    hist[b] = (hist[b] ?? 0) + 1;
  }
  const clusters: { from: number; to: number; count: number }[] = [];
  let run: { from: number; to: number; count: number } | null = null;
  let holes = 0;
  for (let b = 0; b < HIST_BUCKETS; b += 1) {
    const n = hist[b] ?? 0;
    if (n > 0) {
      if (run === null) run = { from: b, to: b, count: 0 };
      run.to = b;
      run.count += n;
      holes = 0;
    } else if (run !== null) {
      holes += 1;
      if (holes > 2) {
        clusters.push(run);
        run = null;
        holes = 0;
      }
    }
  }
  if (run !== null) clusters.push(run);

  const big = clusters.filter((c) => c.count >= Math.max(3, kept.length * MIN_CLUSTER_SHARE));
  if (big.length < 2) return single();
  const sorted = big.slice().sort((a, b) => b.count - a.count);
  const [first, second] = [sorted[0]!, sorted[1]!];
  const centerOf = (c: { from: number; to: number }) => (c.from + c.to + 1) / 2 / HIST_BUCKETS;
  const cA = centerOf(first);
  const cB = centerOf(second);
  if (Math.abs(cA - cB) < MIN_CENTER_DISTANCE) return single();
  if (first.count + second.count < kept.length * 0.5) return single();

  const splitX = (cA + cB) / 2;
  const leftCluster = cA < cB ? first : second;
  const rightCluster = cA < cB ? second : first;

  // 右栏的起始 x：右簇里最靠左的那个项（用它判"谁伸过了界"）
  const rightStart = Math.min(
    ...kept
      .filter((it) => {
        const b = Math.min(HIST_BUCKETS - 1, Math.max(0, Math.floor(it.x * HIST_BUCKETS)));
        return b >= rightCluster.from && b <= rightCluster.to;
      })
      .map((it) => it.x),
  );

  const left: TextItemIn[] = [];
  const right: TextItemIn[] = [];
  const spanners: TextItemIn[] = [];
  for (const it of kept) {
    const b = Math.min(HIST_BUCKETS - 1, Math.max(0, Math.floor(it.x * HIST_BUCKETS)));
    const inRightCluster = b >= rightCluster.from && b <= rightCluster.to;
    const inLeftCluster = b >= leftCluster.from && b <= leftCluster.to;
    // 通栏：落在左栏区、却一直伸进右栏区（标题/通栏图注/跨栏表格）
    if (inLeftCluster && it.x + it.w > rightStart - SPANNER_MARGIN) {
      spanners.push(it);
    } else if (inRightCluster || it.x >= splitX) {
      right.push(it);
    } else {
      left.push(it);
    }
  }
  // 一边太空（<10%）说明那"一簇"其实是零星缩进，不是一栏
  if (left.length < kept.length * 0.1 || right.length < kept.length * 0.1) return single();

  return { colCount: 2, splitX, left, right, spanners };
}

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

/**
 * 一页的行 → 分栏判定（**兜底路径**：当 `partitionItems` 判不出双栏时用它）。
 *
 * @anchor 这条路径的前提是"行已经正确拼好"，而它在紧栏沟的版面上恰恰做不到这一点 ——
 *         所以主路径已经换成先切栏后成行（见本文件顶部的说明与 `partitionItems`）。
 *         这里保留的原因是两个：① 单栏版面本来就该走它；② 有些版面（例如栏内还有
 *         多级缩进）用行级投影反而更稳，留一条退路比只有一个判据安全。
 */
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
