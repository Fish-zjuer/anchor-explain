/**
 * 第四步：一页的块 → 阅读序。
 *
 * @anchor 双栏的读法是**先读完左栏、再读右栏**，通栏内容（标题、图表、图注）按自己的
 *         y 位置插进这条流：左栏在它上方的内容 → 通栏内容 → 右栏在它上方的内容，
 *         然后继续。这是近似（真排版里通栏图会把左右栏"顶开"），但对目标域
 *         （论文节标题、跨栏图表）够用；错了有手修兜底。
 *
 * 本文件零依赖。
 */

import type { Block } from './types.ts';

/** 块在页面上的纵向起点（阅读序的排序键） */
export function topOf(block: Block): number {
  return block.parts[0]?.bbox[1] ?? 1;
}

/**
 * 一页的阅读流。
 * 单栏：栏内块 + 通栏/图块按 y 归并。
 * 双栏：左栏 → 通栏（按 y 插入，插入前先排空左右栏在它上方的块）→ 右栏。
 */
export function orderPage(left: readonly Block[], right: readonly Block[], spanners: readonly Block[], twoColumn: boolean): Block[] {
  const sp = spanners.slice().sort((a, b) => topOf(a) - topOf(b));
  if (!twoColumn) {
    return [...left, ...sp].sort((a, b) => topOf(a) - topOf(b));
  }
  const result: Block[] = [];
  let li = 0;
  let ri = 0;
  for (const s of sp) {
    while (li < left.length && topOf(left[li]!) < topOf(s)) result.push(left[li++]!);
    while (ri < right.length && topOf(right[ri]!) < topOf(s)) result.push(right[ri++]!);
    result.push(s);
  }
  while (li < left.length) result.push(left[li++]!);
  while (ri < right.length) result.push(right[ri++]!);
  return result;
}
