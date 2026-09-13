/**
 * `bbox → 文本`：框选出来的那块里到底有哪些字。
 *
 * @anchor 这是"截图 = 带地址的锚点"的第二层：`bbox` 是地址，它指的那段文字本身
 *         才是模型第一批该看到的东西（`Anchor.extractedText`）。
 *         没有它，模型要等到自己请求取件才知道那一块写了什么 —— 白花一轮，
 *         而且它连"该取哪一页"都得猜。
 *
 * 命中判据是**面积重叠**，不是"包含中心点"：框选出来的矩形很少刚好框住整行，
 * 用户往往从行中间切进去。按中心点判会让这类框一个都命中不了。
 *
 * **禁止 import 'vscode'**。
 */

import { intersectRects, rectArea } from '@anchor/core';
import type { BBox, Rect } from '@anchor/core';
import type { TextItem } from './pageTextIndex.ts';
import { joinLines } from './pageTextIndex.ts';

/** `TextItem` 就是 core 的 `Rect` 再加一个 text */
function asRect(item: TextItem): Rect {
  return { x: item.x, y: item.y, width: item.width, height: item.height };
}

/**
 * 命中阈值：与框有交叠、且交叠面积占**文字块自身**的比例超过它，就算选中了。
 *
 * 为什么按"文字块自身的比例"而不是"框的面积"：框可以很大（用户框了一整段），
 * 也可以很小（框了一个词）。按框算的话，大框会把轻轻擦到的邻行也吸进来，
 * 而那正是"命中到隔壁段落"这类错误的来源。
 */
export const HIT_RATIO = 0.5;

export function itemsInBBox(items: readonly TextItem[], bbox: BBox): TextItem[] {
  const [x1, y1, x2, y2] = bbox;
  const box: Rect = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };

  const hits: TextItem[] = [];
  for (const item of items) {
    const hit = intersectRects(box, asRect(item));
    if (!hit) continue;
    const own = rectArea(asRect(item));
    if (own <= 0) continue;
    if (rectArea(hit) / own >= HIT_RATIO) hits.push(item);
  }
  return hits;
}

/**
 * 框里的文字，**按阅读顺序拼、行间补换行**。
 * 命不中时返回空串 —— 由调用方决定"那一块没有文字层"要怎么说（不抛错）。
 */
export function textInBBox(items: readonly TextItem[], bbox: BBox): string {
  return joinLines(itemsInBBox(items, bbox));
}
