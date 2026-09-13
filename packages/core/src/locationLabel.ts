/**
 * 位置标签。事实源：docs/CONTRACTS.md §9。
 *
 * @anchor 侧边栏每条 step 显示的「第 23 页」/「第 40-48 行」由这里生成，
 *         两条线共用，避免两处各写一套格式化。
 */

import { isCodeLocation, isPDFLocation } from './types.ts';
import type { Location } from './types.ts';

/** 单行不加区间，避免出现「第 40-40 行」。 */
export function formatLineRange(lineStart: number, lineEnd: number): string {
  return lineEnd > lineStart ? `第 ${lineStart}-${lineEnd} 行` : `第 ${lineStart} 行`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export function locationLabel(loc: Location): string {
  if (isCodeLocation(loc)) return formatLineRange(loc.lineStart, loc.lineEnd);
  if (isPDFLocation(loc)) return `第 ${loc.page} 页`;
  // web 本次不接入（DECISIONS.md D7），这里给一个不崩的兜底即可
  return `${hostOf(loc.url)} ${loc.selector}`.trim().slice(0, 40);
}
