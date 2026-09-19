/**
 * 讲解面板的字号缩放。事实源：docs/CONTRACTS.md §5.3（`ui:fontScale` 消息）。
 *
 * @anchor 为什么要有它：用户要的是**独立于 VS Code 的 Ctrl+= / Ctrl+- 的字号调节** ——
 *         那两个键缩放的是整个窗口（`window.zoomLevel`），连带编辑器、终端、面板一起变，
 *         而且 webview 里没有内置的第二档缩放。侧边栏是讲解的**阅读面**，"字再大一点"是
 *         读书人最朴素的要求，所以给它一个自己的系数。
 *
 *         **结构不被损坏**靠的是两条既有纪律，这里只是兑现它们：
 *           1. 面板内所有字号都是 **em 相对单位**（`sidebar/ui/styles.ts` 开头的对齐纪律），
 *              系数只乘在 body 的基准字号上，整块布局等比例伸缩；
 *           2. 对齐用的固定槽宽（`--anchor-gutter-w` / `--anchor-tag-w`）保持原样 ——
 *              它们的职责是"列永远在同一条竖线上"，缩放不能动摇这件事。
 *
 * 本文件**不 import 'vscode'**：`workspaceState` 的读写由调用方（commands.ts）做，
 * 这里只管"一个合法的系数长什么样"。值存 `Memento` 而不是 webview 的 `setState`：
 * 面板随时会被销毁重建，宿主必须在**建面板那一刻**就知道当前的系数（内联进 HTML）。
 */

/** 下限：再小就 Reading 困难了，宁可让人去调 VS Code 全局缩放。 */
export const FONT_SCALE_MIN = 0.75;
/** 上限：再大一行放不下几个字，面板会滚得没法读。 */
export const FONT_SCALE_MAX = 1.75;
/** 一档 = 10%。比 5% 有体感，比 25% 不容易一步过头。 */
export const FONT_SCALE_STEP = 0.1;
export const FONT_SCALE_DEFAULT = 1;

/** `workspaceState` 的键。**加进存档的读侧**：读到不合法的值一律退回默认（见 `clampFontScale`）。 */
export const FONT_SCALE_KEY = 'anchorExplain.fontScale';

/**
 * 把一个来路不明的值收成合法系数。`undefined`（没存过）、非数字、有限性之外
 * 全部退回默认 —— 这个值可能是上一个版本的我们写的，也可能是手改存储改出来的。
 */
export function clampFontScale(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return FONT_SCALE_DEFAULT;
  if (raw < FONT_SCALE_MIN) return FONT_SCALE_MIN;
  if (raw > FONT_SCALE_MAX) return FONT_SCALE_MAX;
  // 存储里可能有 1.2000000000000002 这类浮点尾巴：收成两位小数，面板上显示的百分比才干净
  return Math.round(raw * 100) / 100;
}

/**
 * 走一档。`reset` 回默认。
 *
 * @anchor 用整数个 0.1 来加（先乘 10 再除回去），不用 `current + 0.1`：
 *         `0.7 + 0.1` 在浮点里是 `0.7999999999999999`，连按两次就会被 `clampFontScale`
 *         的两位小数截成 0.8 —— 表面没事，但每次都经一道"纠偏"是在跟浮点打游击。
 */
export function stepFontScale(current: number, direction: 'larger' | 'smaller' | 'reset'): number {
  if (direction === 'reset') return FONT_SCALE_DEFAULT;
  const delta = direction === 'larger' ? FONT_SCALE_STEP : -FONT_SCALE_STEP;
  const tenths = Math.round(current * 10) + Math.round(delta * 10);
  return clampFontScale(tenths / 10);
}
