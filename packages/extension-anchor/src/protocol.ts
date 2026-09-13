/**
 * 消息协议类型与**边界守卫**。事实源：docs/CONTRACTS.md §5。
 *
 * @anchor 本文件是两处不可信输入的落点：
 *         1. 扩展宿主 ↔ 侧边栏 webview（§5.3）
 *         2. 跨扩展入口 `anchorExplain.explainAnchor(anchor)`（§5.1）—— ext-B 传进来的
 *            东西必须当外部输入对待，不能假定形状正确。
 *         两处都先过守卫再进链路，非法一律丢弃并说明原因。
 *
 * §5.2（ext-B 宿主 ↔ 注入脚本）的类型也放这里，S5/S6 直接用，避免协议散成两处。
 *
 * 本文件**不 import 'vscode'**：`Webview` 之类的宿主对象由调用方转成原始数据后再进来。
 */

import { coerceBBox, isCodeLocation, isPDFLocation, isValidBBox } from '@anchor/core';
import type { Anchor, ContextRequestLogEntry, ExplanationResult, Location } from '@anchor/core';

/** §5.3 会话状态。`done`/`error` 都会让 `anchorExplain.walkthroughActive` 落回 false（§4.2）。 */
export type WalkthroughState = 'idle' | 'running' | 'playing' | 'paused' | 'done' | 'error';

// ─────────────────────────────────────────────────────────────
// §5.3 ext-A 内部：宿主 ↔ 侧边栏 webview
// ─────────────────────────────────────────────────────────────

/**
 * 宿主 → webview。
 *
 * `pointIndex` 是 S1 的"拍"游标带来的第二个附加字段（D48）：`-1` = 正在铺整块底色，
 * `0..n-1` = 正在扫该步的第几个逻辑点。**为什么非加不可**：侧边栏原来是自己按
 * `index >= total - 1` 判断"是不是最后一步"来决定按钮禁用，改成拍之后这个判断会
 * 在最后一步的**第一拍**就把「下一步」按死，而后面还有几个扫描点没走完。
 * 有了它，面板既能按真实拍位禁用按钮，也能把"正在扫第几个点"标出来。
 * 拍总数客户端可以自己从 `result` 算（Σ(1 + highlights.length)），所以不必再传。
 */
export type HostToSidebar =
  | {
      type: 'session:update';
      result: ExplanationResult;
      index: number;
      state: WalkthroughState;
      pointIndex: number;
    }
  | { type: 'session:end' }
  | { type: 'tooltrace:append'; entry: ContextRequestLogEntry };

/**
 * 【新增，非追加之外无改动】`ui:ready` 是 S1 加的握手消息。
 *
 * 为什么非加不可：webview 的 DOM 生命周期与宿主无关 —— 用户关掉标签页再触发一次讲解，
 * 新 webview 的脚本才刚 `acquireVsCodeApi()`，宿主在 `webview.html = ...` 之后立刻 post 的消息
 * 会**丢在脚本订阅之前**。没有握手，重开面板就是一片空白。
 * 有了它，宿主可以在收到 ready 时把最近的若干条消息原样重放，webview 无需自持状态。
 */
export type SidebarToHost =
  | { type: 'ui:ready' }
  | { type: 'ui:next' }
  | { type: 'ui:prev' }
  | { type: 'ui:goto'; index: number }
  | { type: 'ui:stop' }
  | { type: 'ui:revealStep'; index: number };

// ─────────────────────────────────────────────────────────────
// §5.2 ext-B 内部：宿主 ↔ 注入脚本（S5/S6 落地）
// ─────────────────────────────────────────────────────────────

export type HostToSelect =
  | { type: 'anchor:enterSelectMode' }
  | { type: 'anchor:exitSelectMode' }
  | { type: 'anchor:gotoPage'; page: number };

export type SelectToHost =
  | { type: 'anchor:ready' }
  | {
      type: 'anchor:captured';
      page: number;
      bbox: [number, number, number, number];
      capturedImage?: string;
      extractedText?: string;
    }
  | { type: 'anchor:cancelled' };

// ─────────────────────────────────────────────────────────────
// 守卫
// ─────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * §5.1 跨扩展入口的守卫：`anchorExplain.explainAnchor(anchor)` 的参数不可信。
 * 只放行形状正确的 code / pdf 锚点；宁可明确拒绝，也不要拿半截对象去渲染。
 *
 * 两处刻意收紧（都是被独立校验抓出来的）：
 *   1. **`web` 一律拒绝**。§1.3 已写明本次不接入；放行它只会先花掉一次模型往返，
 *      再把"你给的锚点不合法"报成"AI 输出不合法"（`steps[0].location：不支持来源类型`），
 *      把用户引到完全错误的方向去查。
 *   2. **数值不再只看 `typeof`**：`lineStart: NaN`、`page: 1e400`、`bbox: ['a','b','c','d']`
 *      这类形状能骗过 `core` 里那几个宽松守卫，但一定通不过下游的 `checkLocation`。
 *      既然结果注定失败，就在门口失败，并且说清楚是谁的问题。
 */
export function isAnchorLike(raw: unknown): raw is Anchor {
  if (!isRecord(raw)) return false;
  if (typeof raw.sourceId !== 'string' || typeof raw.sourceName !== 'string') return false;
  if (!isRecord(raw.location)) return false;

  const loc = raw.location as unknown as Location;

  if (raw.sourceType === 'code') {
    if (!isCodeLocation(loc)) return false;
    return isPositiveLineRange(loc.lineStart, loc.lineEnd);
  }

  if (raw.sourceType === 'pdf') {
    if (!isPDFLocation(loc)) return false;
    if (!Number.isInteger(loc.page) || loc.page < 1) return false;
    const box = coerceBBox(loc.bbox);
    return box !== null && isValidBBox(box);
  }

  return false;
}

function isPositiveLineRange(lineStart: number, lineEnd: number): boolean {
  return (
    Number.isInteger(lineStart) && Number.isInteger(lineEnd) && lineStart >= 1 && lineEnd >= lineStart
  );
}

/** §5.3 宿主侧守卫：webview 发来的东西同样不可信。非法返回 null，由调用方静默丢弃。 */
export function parseSidebarMessage(raw: unknown): SidebarToHost | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  switch (raw.type) {
    case 'ui:ready':
    case 'ui:next':
    case 'ui:prev':
    case 'ui:stop':
      return { type: raw.type };
    case 'ui:goto':
    case 'ui:revealStep': {
      const index = raw.index;
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return null;
      return { type: raw.type, index };
    }
    default:
      return null;
  }
}
