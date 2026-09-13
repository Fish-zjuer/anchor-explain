/**
 * 从「一拍」算出「该画哪些框」—— 纯函数，不 import 'vscode'，可直测。
 *
 * @anchor 两层视觉，对应 `WalkthroughSession` 的"拍"（D48）：
 *
 * ```
 * planForBeat(step, -1)  →  [整块底色]                    ← 先看清这一段整体
 * planForBeat(step,  1)  →  [整块底色, 扫第 2 个子高亮]    ← 再逐个点亮内部逻辑点
 * ```
 *
 * 三处刻意设计：
 *  1. **块级范围永远画**，而且只有一层中性底色。用户的原话是"浅色荧光包住整个块" ——
 *     块要均匀，任何"这一行比那一行深"都必须来自正在扫描的那个点，而不是随手叠上的第二层。
 *  2. **一次只点亮一个点**。S1 第一版把所有子高亮一次画完，于是三行三种混合色，
 *     用户看到的是"隔行乱变颜色"。改成一次一个之后，块级底色恒为均匀。
 *  3. **非代码位置一律不产出框**。线2 的硬约束是"PDF 上不出现任何高亮框"，
 *     把它写在这里，S6 之后即便 AI 返回 PDF location 也不会漏出一个框。
 */

import { isCodeLocation, samePath } from '@anchor/core';
import type { CodeLocation, HighlightEmphasis, WalkthroughStep } from '@anchor/core';

export type DecorationKind = 'step' | 'highlight';

export interface DecorationSpec {
  readonly kind: DecorationKind;
  readonly location: CodeLocation;
  /** 仅 `kind === 'highlight'` 时参与配色；步级底色固定走中性视觉 */
  readonly emphasis: HighlightEmphasis;
}

export const EMPHASES: readonly HighlightEmphasis[] = ['primary', 'context', 'definition', 'caveat'];

export const FALLBACK_EMPHASIS: HighlightEmphasis = 'primary';

/**
 * 返回这一拍要画的框，顺序是"先铺底、再点亮"。
 * 空数组 = 这一拍没有可渲染的框（非代码来源，或整步都被过滤掉）。
 */
export function planForBeat(step: WalkthroughStep, pointIndex: number): readonly DecorationSpec[] {
  const specs: DecorationSpec[] = [];

  if (isCodeLocation(step.location)) {
    specs.push({ kind: 'step', location: step.location, emphasis: FALLBACK_EMPHASIS });
  }

  const point = pointIndex >= 0 ? step.highlights?.[pointIndex] : undefined;
  if (point && isCodeLocation(point.location)) {
    specs.push({
      kind: 'highlight',
      location: point.location,
      emphasis: point.emphasis ?? FALLBACK_EMPHASIS,
    });
  }

  return specs;
}

/** 这一步的第一个代码位置（用于"把视图滚过去"）。 */
export function primaryLocationOf(step: WalkthroughStep): CodeLocation | undefined {
  return planForBeat(step, -1)[0]?.location;
}

/**
 * 这一拍的**焦点文件**：有子高亮就跟着子高亮走，否则跟着步骤（D69）。
 *
 * @anchor S9a 之前，"一拍 = 一个文件"是成立的，所以播放器直接拿 `specs[0]` 的文件当唯一目标。
 *         §3.3 从 S9a 起允许 location 落在**取过件的别的文件**里 —— 那个假设就错了，
 *         后果是 `protocol.h:16` 被画到 `main.c:16` 上：屏幕上出现一个**看起来很确定的假框**。
 *         比不画更坏的东西只有"画错"，所以焦点只能有一个，其余文件的框不画
 *         （它们在侧边栏的标签里带着文件名，用户点得过去）。
 */
export function focusFileOf(specs: readonly DecorationSpec[]): string | undefined {
  // 顺序是"先铺底、再点亮"，所以最后一个就是最具体的那一个
  return specs[specs.length - 1]?.location.filePath;
}

/** 只留落在**这个文件**里的框。别的文件这一拍不画（原因见 `focusFileOf`）。 */
export function specsInFile(
  specs: readonly DecorationSpec[],
  filePath: string,
): readonly DecorationSpec[] {
  return specs.filter((spec) => samePath(spec.location.filePath, filePath));
}
