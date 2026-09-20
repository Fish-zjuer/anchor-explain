/**
 * 宿主 ↔ 注入脚本的消息。事实源：docs/CONTRACTS.md §5.2。
 *
 * @anchor §5.2 的两个联合类型是**冻结**的，这里只是把它们落成 TS 类型 + 一个边界守卫。
 *         守卫是必要的：注入脚本跑在 webview 里，它的输出对宿主而言和 AI 的输出一样不可信
 *         （任何脚本、任何 devtools 里的手打消息都能往这个通道灌）。
 *
 * 本文件属 `src/anchor/`，**禁止 import 'vscode'** —— 它要能在 Node 里直测。
 */

import { coerceBBox, isValidBBox } from '@anchor/core';
import type { BBox } from '@anchor/core';
import type { PixelRect } from './rectToNormalizedBBox.ts';

// ── §5.2 宿主 → 注入脚本 ────────────────────────────────────────────────────

export type HostToSelect =
  | { type: 'anchor:enterSelectMode' }
  | { type: 'anchor:exitSelectMode' }
  | { type: 'anchor:gotoPage'; page: number }
  /**
   * S6 补（D76）：滚到那一页 + 在那块区域上闪现一个框，到点自己消失。
   *
   * 为什么加它：S6 只做"滚到那一页"，而用户实测的原话是「图里没有对应位置的指示的跳转，
   * 根本不知道讲的哪里」—— 页数对上了，页**内**那一块还是得自己找。约束 1（PDF 上不出现
   * 任何高亮框）因此收窄为：**不许常驻/自动的框，只允许"用户点击触发、会自动消失"的位置提示**。
   * 这条消息只由宿主在"用户点了某一步"时发出（`revealStep`），自动播放永远不发。
   */
  | { type: 'anchor:flashRegion'; page: number; bbox: BBox }
  // ── D104（拆块活页）：以下四条不在 §5.2 的冻结集合里，是加法扩展 ──
  // （编号说明：这几条原先写在注释里的号是 `D100`，而 `D100` 是另一件"块身份冻结"。
  //   见 DECISIONS.md 的 D100 末尾与 D104。CONTRACTS §5.2 已同步。）
  /** 页模式：pdf.js 切成"整页翻看"（不允许连续滚动），并开始观测停稳的页 */
  | { type: 'anchor:pageMode' }
  /** 让注入脚本抽取某一页的文字项（归一化坐标）—— 拆块的原料 */
  | { type: 'anchor:requestPageText'; page: number }
  /**
   * 在第 page 页上显示块覆盖层（空白暗下去 + 圆角细框）。
   * **注入脚本收到后清掉旧块再画新的** —— 翻页即散、不持久（约束 1 的 D104 版：
   * 覆盖层是显式新交互、瞬时、绝不改文档）。
   */
  | { type: 'anchor:showBlocks'; page: number; blocks: { id: string; bbox: BBox; kind: 'text' | 'heading' | 'image'; selected: boolean }[] }
  | { type: 'anchor:clearBlocks' };

// ── §5.2 注入脚本 → 宿主 ────────────────────────────────────────────────────

/**
 * `anchor:captured` 的**原始像素几何**（S5 新增，可选）。
 *
 * 为什么加它：§5.2 冻结的 `bbox` 是"归一化后的四项"，也就是**由注入脚本自己算的**。
 * 但注入脚本不参与类型检查、也没法被单测（它是 webview 里的字符串常量）——
 * 让它独自承担这门换算等于让唯一有对错的部分失去覆盖。
 * 于是它把**原始像素**也报上来，宿主用 `resolveSelection`（有单测）重算一遍；
 * 只有 `page` / `bbox` 的老式脚本仍然能用（走 `coerceBBox` 兜底校验）。
 */
export interface CapturedGeometry {
  /** 拖拽出来的矩形，屏幕坐标系 */
  dragged: PixelRect;
  /** 当时可见的所有页的矩形 */
  pages: { page: number; rect: PixelRect }[];
}

export type SelectToHost =
  | { type: 'anchor:ready' }
  | {
      type: 'anchor:captured';
      page: number;
      bbox: BBox;
      capturedImage?: string;
      extractedText?: string;
      geometry?: CapturedGeometry;
    }
  | { type: 'anchor:cancelled' }
  // ── D104（拆块活页）：以下三条同样是加法扩展 ──
  /** 某页停稳了（切页后约 0.9 秒没有新的翻页动作）—— 宿主据此开始处理该页 */
  | { type: 'anchor:pageSettled'; page: number }
  /** `anchor:requestPageText` 的回答：该页的文字项（归一化坐标，y 向下）。可能为空（无文字层） */
  | { type: 'anchor:pageText'; page: number; items: { str: string; x: number; y: number; w: number; h: number }[] }
  /** 用户点了覆盖层里的某一块（选中/取消由宿主维护，脚本只报事实） */
  | { type: 'anchor:blockClick'; id: string };

// ── 守卫 ────────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function readRect(raw: unknown): PixelRect | null {
  if (!isRecord(raw)) return null;
  const { x, y, width, height } = raw;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  return { x, y, width, height };
}

function readGeometry(raw: unknown): CapturedGeometry | null {
  if (!isRecord(raw)) return null;
  const dragged = readRect(raw.dragged);
  if (!dragged || !Array.isArray(raw.pages)) return null;

  const pages: { page: number; rect: PixelRect }[] = [];
  for (const item of raw.pages) {
    if (!isRecord(item) || !isPositiveInt(item.page)) continue;
    const rect = readRect(item.rect);
    if (rect) pages.push({ page: item.page, rect });
  }
  return pages.length > 0 ? { dragged, pages } : null;
}

/**
 * 解析注入脚本发来的消息。**不合法一律返回 null**，由调用方忽略 ——
 * 与 §5.3 的 `parseSidebarMessage` 同一立场：边界上的坏输入不值得抛异常，
 * 但必须挡住，不能让一个 `page: "三"` 流进 `PDFLocation`。
 */
export function parseSelectMessage(raw: unknown): SelectToHost | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;

  if (raw.type === 'anchor:ready' || raw.type === 'anchor:cancelled') return { type: raw.type };

  // ── D104 的三条加法消息（同样不可信，逐条守卫） ──
  if (raw.type === 'anchor:pageSettled') {
    return isPositiveInt(raw.page) ? { type: 'anchor:pageSettled', page: raw.page } : null;
  }
  if (raw.type === 'anchor:blockClick') {
    return typeof raw.id === 'string' && raw.id !== '' ? { type: 'anchor:blockClick', id: raw.id } : null;
  }
  if (raw.type === 'anchor:pageText') {
    if (!isPositiveInt(raw.page) || !Array.isArray(raw.items)) return null;
    const items: { str: string; x: number; y: number; w: number; h: number }[] = [];
    for (const it of raw.items) {
      if (!isRecord(it) || typeof it.str !== 'string') continue;
      if (!isFiniteNumber(it.x) || !isFiniteNumber(it.y) || !isFiniteNumber(it.w) || !isFiniteNumber(it.h)) continue;
      items.push({ str: it.str, x: it.x, y: it.y, w: it.w, h: it.h });
    }
    return { type: 'anchor:pageText', page: raw.page, items };
  }

  if (raw.type !== 'anchor:captured') return null;
  if (!isPositiveInt(raw.page)) return null;

  // `bbox` 是冻结字段：老式脚本只给这个。
  // 两道都要过：`coerceBBox` 管形状与数值（面向不可信输入），`isValidBBox` 管非退化 ——
  // 一个零面积的框进不了 `PDFLocation`（它会卡在 §3.3 的 bbox 校验上，或者变成一个谁也看不见的锚点）。
  // 注入脚本自己也拦了误触（<6px），这里是边界上的第二道。
  const bbox = coerceBBox(raw.bbox);
  if (!bbox || !isValidBBox(bbox)) return null;

  const out: SelectToHost = { type: 'anchor:captured', page: raw.page, bbox };
  const geometry = readGeometry(raw.geometry);
  if (geometry) (out as { geometry?: CapturedGeometry }).geometry = geometry;
  if (typeof raw.capturedImage === 'string') (out as { capturedImage?: string }).capturedImage = raw.capturedImage;
  if (typeof raw.extractedText === 'string') (out as { extractedText?: string }).extractedText = raw.extractedText;
  return out;
}
