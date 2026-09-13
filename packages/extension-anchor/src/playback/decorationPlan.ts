/**
 * 从「一个 step」算出「该画哪些框」—— 纯函数，不 import 'vscode'，可直测。
 *
 * @anchor 把这一步单独拿出来，是为了让「配色分支」在 `node --test` 里可验：
 *         播放器只负责把这里的输出喂给 `setDecorations`，不再自己判断 emphasis。
 *
 * 两处刻意设计：
 *   1. **步级范围只画一层中性底色**，`emphasis` 配色只作用于子高亮。
 *      步级范围与子高亮经常重叠，两套半透明底色叠在一起会糊成一团，
 *      反而看不清「这一步在讲哪几行、重点是哪一行」（DECISIONS D41）。
 *   2. **非代码位置一律不产出框**。线2 的硬约束是「PDF 上不出现任何高亮框」，
 *      把它写在这里，S6 之后即便 AI 返回 PDF location 也不会漏出一个框。
 */

import { isCodeLocation } from '@anchor/core';
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
 * 步级高亮 + 子高亮，按「先铺底色、再点重点」的顺序返回。
 * 空数组 = 这一步没有可渲染的框（非代码来源，或全被过滤掉）。
 */
export function planForStep(step: WalkthroughStep): readonly DecorationSpec[] {
  const specs: DecorationSpec[] = [];

  if (isCodeLocation(step.location)) {
    specs.push({ kind: 'step', location: step.location, emphasis: FALLBACK_EMPHASIS });
  }

  for (const h of step.highlights ?? []) {
    if (!isCodeLocation(h.location)) continue;
    specs.push({
      kind: 'highlight',
      location: h.location,
      emphasis: h.emphasis ?? FALLBACK_EMPHASIS,
    });
  }

  return specs;
}

/** 这一步是否值得为它打开/滚动编辑器（有代码位置才值得）。 */
export function primaryLocationOf(step: WalkthroughStep): CodeLocation | undefined {
  return planForStep(step)[0]?.location;
}
