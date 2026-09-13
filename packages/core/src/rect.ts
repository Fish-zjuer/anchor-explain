/**
 * 矩形的基本运算。**两条线共用**，所以放在 core。
 *
 * @anchor 为什么值得一个独立模块：`intersectRects` 出现在三个地方
 *         （线2 的"框落在哪一页"、线2 的"裁到页内再归一化"、线1 的"bbox 命中了哪些文字块"），
 *         而它的边界语义（**不相交返回 null，不是零面积矩形**）是这三处共同依赖的东西 ——
 *         三处各写一遍，早晚有一处写成"返回零面积"，而零面积在判"命中比例"时会变成除零。
 *
 * 坐标系是**屏幕/归一化都行**：这里只做纯算术，不关心单位。
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rectArea(r: Rect): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

/** 两个矩形的交集；**不相交返回 null**（不是零面积矩形 —— 两者在下游含义不同） */
export function intersectRects(a: Rect, b: Rect): Rect | null {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}
