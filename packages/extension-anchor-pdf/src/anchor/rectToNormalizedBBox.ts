/**
 * 像素矩形 → 「第几页 + 归一化 bbox」。
 *
 * @anchor 为什么这门换算要单独一个**纯函数**文件，而不是写在注入脚本里：
 *         "拖出来的这块落在哪一页、占那一页的百分之几"是这门功能里唯一有对错的部分
 *         （页容器有 padding、缩放比例、滚动偏移，肉眼根本判不出算错了两三个像素还是算反了）。
 *         放在这里能用 `node --test` 钉住；写进 `media/anchor-select.js` 就只能靠拖一百次找感觉。
 *         注入脚本因此只负责"画矩形 + 报像素"，一行业务数学都不做。
 *
 * **禁止 import 'vscode'**：本文件要能在 Node 里直测。
 */

import { intersectRects, normalizeBBox, rectArea } from '@anchor/core';
import type { BBox, Rect } from '@anchor/core';

/**
 * 屏幕坐标系（CSS 像素）下的矩形。注入脚本用 `getBoundingClientRect()` 拿到的东西就是这个形状。
 * 与 core 的 `Rect` 是同一个东西 —— 这里留个名字只是为了让这门换算的代码读起来贴合场景。
 */
export type PixelRect = Rect;

// 矩形运算复用 `@anchor/core`（两条线共用一份，见该文件的 @anchor 注释）
export { intersectRects, rectArea };

export interface PageRect {
  /** 1-based 页号，与 `PDFLocation.page` 一致 */
  page: number;
  rect: PixelRect;
}

/**
 * 拖出来的矩形落在哪一页：**取交叠面积最大的那一页**。
 *
 * 为什么不是"取中心点所在的那一页"：用户经常从上一页的末尾一路拖到下一页的开头，
 * 此时中心点可能落在两页之间的缝隙里（页与页之间有间距），会取到任意一页。
 * 面积最大的那一页才是他"主要在看"的那一页。
 * 完全不相交（拖到页面外的灰底上）→ null，由调用方给一句人话。
 */
export function pickDominantPage(
  dragged: PixelRect,
  pages: readonly PageRect[],
): { page: number; rect: PixelRect; overlap: number } | null {
  let best: { page: number; rect: PixelRect; overlap: number } | null = null;
  for (const candidate of pages) {
    const hit = intersectRects(dragged, candidate.rect);
    if (!hit) continue;
    const overlap = rectArea(hit);
    // 严格大于：面积相同时保留**先出现的那一页**（页号小的），行为可预期
    if (!best || overlap > best.overlap) best = { page: candidate.page, rect: candidate.rect, overlap };
  }
  return best;
}

/**
 * 归一化：把"拖出来的像素矩形"换算成"该页内的 `[x1,y1,x2,y2]`，四项都在 `[0,1]`"。
 *
 * 先把拖拽矩形**裁到页容器内**（用户可能从页外拖进来，或拖出页外），
 * 再按页容器尺寸归一。最后过一遍 `@anchor/core` 的 `normalizeBBox` ——
 * 它保证排序（x1≤x2、y1≤y2）与裁剪，是两条线共用的唯一实现（`CONTRACTS` §10.1）。
 *
 * 退化情形（页容器宽高为 0、或压根没交叠）返回 null：
 * 一个零面积 bbox 在 `PDFLocation` 里是没有意义的，而且 `isValidBBox` 也会拒它。
 */
export function rectToNormalizedBBox(dragged: PixelRect, pageRect: PixelRect): BBox | null {
  if (pageRect.width <= 0 || pageRect.height <= 0) return null;
  const clipped = intersectRects(dragged, pageRect);
  if (!clipped || rectArea(clipped) <= 0) return null;

  return normalizeBBox([
    (clipped.x - pageRect.x) / pageRect.width,
    (clipped.y - pageRect.y) / pageRect.height,
    (clipped.x + clipped.width - pageRect.x) / pageRect.width,
    (clipped.y + clipped.height - pageRect.y) / pageRect.height,
  ]);
}

/** 把注入脚本报上来的"拖拽矩形 + 所有可见页的矩形"一次性算成定位。 */
export function resolveSelection(
  dragged: PixelRect,
  pages: readonly PageRect[],
): { page: number; bbox: BBox } | null {
  const hit = pickDominantPage(dragged, pages);
  if (!hit) return null;
  const bbox = rectToNormalizedBBox(dragged, hit.rect);
  if (!bbox) return null;
  return { page: hit.page, bbox };
}
