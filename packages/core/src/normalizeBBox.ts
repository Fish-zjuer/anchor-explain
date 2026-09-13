/**
 * bbox 归一化。事实源：docs/CONTRACTS.md §9。
 *
 * @anchor 这是全项目 bbox 数学的唯一实现，fork（extension-anchor-pdf）也复用本文件，
 *         不在 fork 里另写一份（DECISIONS.md D20）。
 */

export type BBox = [number, number, number, number];

/**
 * 裁剪到 [0,1]。
 * 非有限数（NaN / ±Infinity）→ 0：本函数面向"本来就该是数字"的输入（UI 像素换算），
 * 遇到脏值时给出退化的零面积切片，让下游的 isValidBBox 去拒绝，
 * 而不是在这里抛错打断捕获流程。
 */
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * 裁剪 + 排序：保证 x1<=x2、y1<=y2，且四个分量都落在 [0,1]。
 * 输入方向任意（用户从上往下或从下往上拖拽都会走到这里）。
 */
export function normalizeBBox(raw: readonly [number, number, number, number]): BBox {
  const x1 = clamp01(raw[0]);
  const y1 = clamp01(raw[1]);
  const x2 = clamp01(raw[2]);
  const y2 = clamp01(raw[3]);
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

/**
 * 把不可信输入（如 LLM 返回的 JSON）转成 BBox，形状或数值不合法时返回 null。
 *
 * 与 normalizeBBox 的差异是**有意的**：normalizeBBox 把非有限数悄悄变成 0（防御性），
 * 而这里直接判无效——模型吐出 NaN 属于输出损坏，必须走 validateExplanation 的拒绝/重试路径，
 * 不能靠静默把它变成一个看似合法的零面积框（CONTRACTS §3.3）。
 */
export function coerceBBox(raw: unknown): BBox | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const nums: number[] = raw.map((v) => (typeof v === 'number' ? v : Number.NaN));
  if (!nums.every((n) => Number.isFinite(n))) return null;
  return normalizeBBox(nums as unknown as BBox);
}

/** 有效的可高亮切片：非退化（面积 > 0）且分量全在 [0,1]。 */
export function isValidBBox(b: BBox): boolean {
  const inRange = b.every((n) => Number.isFinite(n) && n >= 0 && n <= 1);
  return inRange && b[0] < b[2] && b[1] < b[3];
}

export function bboxArea(b: BBox): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}
