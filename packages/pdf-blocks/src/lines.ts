/**
 * 第一步：文字项 → 行。
 *
 * @anchor pdf.js 给的 item 是"一次绘制的字符串"，一行正文常被打散成好几个 item
 *         （字体切换、字距都会切断它）。**行**是后面一切（分栏、成段、标题）的地基：
 *         行拼错了，段就散了。拼接规则在这里统一：CJK 直接接，英文按 item 间距补空格，
 *         行尾连字符接下页/下行时甩掉（拆块器里唯一一处"改原文"，见 stitch.ts 的同一规则）。
 *
 *         **容差分两个量级，这是被真实论文教出来的**：
 *         `COLUMN_GAP_FACTOR`（1.2×行高）用于"我怀疑这一页是双栏"时把两栏分开；
 *         `LINE_GAP_FACTOR`（2.5×行高）用于**已经确定在同一栏内**时把行拼完整。
 *         第一版只有一个 2.5 的阈值，而 ACM 双栏论文的栏沟只有 **1.7×行高** ——
 *         阈值比栏沟还大，于是左右两栏被并进同一行，**75% 的正文变成两栏交错的乱序**
 *         （TraceMonkey 实测）。所以现在的主路径是：**先按 item 切栏，再在栏内按 2.5 成行**
 *         （见 columns.ts 的 `partitionItems`）—— 两条判据各管一件事，不再互相打架。
 *
 * 本文件零依赖。
 */

import type { PageTextIn, TextItemIn } from './types.ts';

export interface Line {
  page: number;
  text: string;
  /** 合成外框（归一化 0-1，y 向下） */
  x: number;
  y: number;
  w: number;
  h: number;
}

const CJK = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/u;

export function isCjkChar(ch: string): boolean {
  return CJK.test(ch);
}

/** 两栏之间那条沟的判定容差（× 行高）。同一栏内的字距再大也大不过它。 */
export const COLUMN_GAP_FACTOR = 1.2;
/** 同一栏内把一行拼完整用的容差（× 行高）。表格/列表里的列间距也会被它跨过，这是想要的。 */
export const LINE_GAP_FACTOR = 2.5;

/** 两个 item 之间该不该补一个空格：间距够一个"空格宽"且两边都不是 CJK */
function needsSpace(prev: TextItemIn, next: TextItemIn): boolean {
  const gap = next.x - (prev.x + prev.w);
  if (gap <= 0.3 * Math.max(prev.h, 0.005)) return false;
  if (prev.str.endsWith(' ') || next.str.startsWith(' ')) return false;
  return !(isCjkChar(prev.str.slice(-1)) || isCjkChar(next.str.slice(0, 1)));
}

/** 行盒的垂直中心（行归并的判据） */
function centerY(item: { y: number; h: number }): number {
  return item.y + item.h / 2;
}

/**
 * 把一组（同一栏的）文字项拼成行。输出已按上下顺序排好。
 *
 * `gapFactor` 是"同一行"的水平邻接容差（× 行高）。默认 `LINE_GAP_FACTOR`（栏内拼行）；
 * 传 `COLUMN_GAP_FACTOR` 则用于"还没确定分栏"的场合 —— **别用它去跨栏拼行**。
 */
export function formLines(
  page: number,
  items: readonly TextItemIn[],
  gapFactor: number = LINE_GAP_FACTOR,
): Line[] {
  const kept: TextItemIn[] = items
    .filter((it) => it.str.trim() !== '')
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x);
  if (kept.length === 0) return [];

  const groups: TextItemIn[][] = [];
  let current: TextItemIn[] = [kept[0]!];
  for (let i = 1; i < kept.length; i += 1) {
    const item = kept[i]!;
    const line = current;
    const lineH = Math.max(...line.map((it) => it.h));
    const lineCy = line.reduce((sum, it) => sum + centerY(it), 0) / line.length;
    // 同一行要同时满足两条：垂直中心对齐，且**水平邻接** ——
    // 只看垂直中心的话，左右栏共享同一个 y 会被并成一条横贯两栏的"行"。
    const lineRight = Math.max(...line.map((it) => it.x + it.w));
    const gap = item.x - lineRight;
    const sameRow = Math.abs(centerY(item) - lineCy) <= 0.6 * Math.max(lineH, item.h);
    if (sameRow && gap <= gapFactor * Math.max(lineH, item.h)) {
      line.push(item);
    } else {
      groups.push(line);
      current = [item];
    }
  }
  groups.push(current);

  return groups.map((group) => {
    const ordered = group.slice().sort((a, b) => a.x - b.x);
    let text = '';
    for (let i = 0; i < ordered.length; i += 1) {
      const it = ordered[i]!;
      if (i > 0 && needsSpace(ordered[i - 1]!, it)) text += ' ';
      text += it.str;
    }
    const x = Math.min(...ordered.map((it) => it.x));
    const top = Math.min(...ordered.map((it) => it.y));
    const right = Math.max(...ordered.map((it) => it.x + it.w));
    const bottom = Math.max(...ordered.map((it) => it.y + it.h));
    return {
      page,
      text: text.replace(/\s+/gu, ' ').trim(),
      x,
      y: top,
      w: right - x,
      h: bottom - top,
    };
  });
}

/**
 * 一页的行（**单栏假设**）。分栏路径请用 `formLines` 按栏分别成行 ——
 * 这里是"这一页没有可分栏"的退化路径，也是历史调用点（测试/探针）的入口。
 */
export function linesOf(page: PageTextIn): Line[] {
  return formLines(page.page, page.items);
}
