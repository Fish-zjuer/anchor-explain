/**
 * 第一步：文字项 → 行。
 *
 * @anchor pdf.js 给的 item 是"一次绘制的字符串"，一行正文常被打散成好几个 item
 *         （字体切换、字距都会切断它）。**行**是后面一切（分栏、成段、标题）的地基：
 *         行拼错了，段就散了。拼接规则在这里统一：CJK 直接接，英文按 item 间距补空格，
 *         行尾连字符接下页/下行时甩掉（拆块器里唯一一处"改原文"，见 stitch.ts 的同一规则）。
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
 * 一页的行。输出**已按阅读的上下顺序**排好（同页内先不管分栏 —— 那是 columns.ts 的事，
 * 但行的 y 排序对任何布局都成立）。
 */
export function linesOf(page: PageTextIn): Line[] {
  const items: TextItemIn[] = page.items
    .filter((it) => it.str.trim() !== '')
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x);
  if (items.length === 0) return [];

  const groups: TextItemIn[][] = [];
  let current: TextItemIn[] = [items[0]!];
  for (let i = 1; i < items.length; i += 1) {
    const item = items[i]!;
    const line = current;
    const lineH = Math.max(...line.map((it) => it.h));
    const lineCy = line.reduce((sum, it) => sum + centerY(it), 0) / line.length;
    // 同一行还要**水平邻接**：双栏版面里左右栏的行共享同一个 y ——
    // 只看垂直中心的话，左右栏会被并成一条横贯两栏的"行"（单测里抓到的第一号 bug）。
    // 间距超过字高两倍半的两个 item 视为不连续（栏间沟远大于这个）。
    const lineRight = Math.max(...line.map((it) => it.x + it.w));
    const gap = item.x - lineRight;
    const sameRow = Math.abs(centerY(item) - lineCy) <= 0.6 * Math.max(lineH, item.h);
    if (sameRow && gap <= 2.5 * Math.max(lineH, item.h)) {
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
      page: page.page,
      text: text.replace(/\s+/gu, ' ').trim(),
      x,
      y: top,
      w: right - x,
      h: bottom - top,
    };
  });
}
