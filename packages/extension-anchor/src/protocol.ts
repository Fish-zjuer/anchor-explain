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
import type { StartModel } from './start/startModel.ts';

/** §5.3 会话状态。`done`/`error` 都会让 `anchorExplain.walkthroughActive` 落回 false（§4.2）。 */
export type WalkthroughState = 'idle' | 'running' | 'playing' | 'paused' | 'done' | 'error';

/**
 * 状态 → 中文词。**只此一份**：状态栏（`sidebar/statusBar.ts`）与开始面板
 * （`start/startModel.ts`）说的是同一句话，两处各写一张表早晚会分家。
 *
 * 放在这里而不是 UI 文件里的理由：它是 `WalkthroughState` 这个联合类型的**满射**，
 * 与类型定义贴着放，加一个状态时不可能只改一处还能编译通过
 * （`test/startModel.test.ts` 有一条锁遍历六个状态断言都有词）。
 */
export const STATE_WORD: Record<WalkthroughState, string> = {
  idle: '已结束',
  running: '讲解中',
  playing: '播放中',
  paused: '已暂停',
  done: '已讲完',
  error: '出错',
};

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
  /**
   * 【D68 新增】`tooltrace:reset`：**一轮讲解开始时清空侧边栏那块取件日志**。
   *
   * 为什么非有不可：`tooltrace:append` 是"追加"，而 webview 的 `trace` 数组**活得比一轮讲解长**
   * （同一个面板接着讲第二次是常态）。没有 reset，第二轮会把上一轮的记录留在下面，
   * 用户看到的是两次讲解混在一起的日志 —— 那比"没有日志"更坏。
   *
   * 另一件事也在这儿说清：宿主侧的取件日志是**逐轮多份**的（`loggerOf()` 每次讲解新建 logger），
   * 但面板是**讲解完才建**的（用户是在开始面板上按的按钮）—— 取件那些记录在面板存在之前就发生了。
   * 宿主因此把它们暂存下来，面板一建好就 `reset` + 逐条 `append` 灌进去（见 `commands.ts` 的 `explain`）。
   */
  | { type: 'tooltrace:reset' }
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
// §5.5 ext-A 内部：宿主 ↔ 开始面板 webview（S8）
// ─────────────────────────────────────────────────────────────

/**
 * 宿主 → 开始面板。**整份模型一次推过去**，不像侧边栏那样逐条重放。
 *
 * @anchor 为什么这个面板不需要重放缓冲：侧边栏是**事件流**（会话一步步走，每拍都要推），
 *         而开始面板是**状态快照**（"现在是什么情况"）—— 后一条天然覆盖前一条，
 *         所以客户端一 ready，宿主现算一份发过去就够了（`start/StartViewProvider.ts`）。
 *         形状也不是 §5.3 那种 `session:update` 的字段拼装，而是**渲染所需的一切**都在
 *         `StartModel` 里：面板端因此没有"从 result 自己推算下一步"这种业务判断。
 */
export type HostToStart = { type: 'start:model'; model: StartModel };

/**
 * 开始面板 → 宿主。
 *
 * `start:run` 只回传**动作 id**，不回传命令 ID —— 这是刻意的：
 * webview 是外部输入，如果它能指定"执行哪个命令"，那它就能执行任意命令。
 * 宿主拿 id 去 `START_ACTIONS` 里查（`start/startModel.ts` 的 `findStartAction`），
 * 查不到就丢；能执行什么是**宿主**决定的，不是面板决定的。
 */
export type StartToHost = { type: 'start:ready' } | { type: 'start:run'; id: string };

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

/**
 * §5.5 宿主侧守卫。与 `parseSidebarMessage` 同一条规矩：不认识的形状一律 null。
 *
 * **这里只查形状，不查"id 认不认识"** —— 成员资格是宿主拿 `START_ACTIONS` 查的
 * （见 `StartToHost` 的注释）。守卫管"这消息能不能读"，业务管"这动作能不能做"，
 * 两件事分开，所以 `id` 只要是非空字符串就放行。
 */
export function parseStartMessage(raw: unknown): StartToHost | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  switch (raw.type) {
    case 'start:ready':
      return { type: 'start:ready' };
    case 'start:run': {
      const id = raw.id;
      if (typeof id !== 'string' || id === '') return null;
      return { type: 'start:run', id };
    }
    default:
      return null;
  }
}
