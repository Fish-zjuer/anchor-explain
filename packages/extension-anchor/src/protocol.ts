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
import type { TokenUsage } from './orchestrator/providers/types.ts';
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
      /**
       * 【D69 新增】锚点所在的文件（PDF 锚点为 `null`）。
       *
       * 为什么非加不可：S9a 起 location 可以落在**别的文件**里，而面板一直把行号裸着显示成
       * `[第 16 行]` —— 用户看到的就像"main.c 的第 16 行"，而它其实是 `protocol.h` 的第 16 行。
       * 客户端没有别的地方能拿到"锚点是哪个文件"，于是无从判断"这个位置要不要标文件名"。
       */
      anchorPath: string | null;
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
  | { type: 'tooltrace:append'; entry: ContextRequestLogEntry }
  /**
   * 【D89 新增】当前的字号缩放系数。**为什么走消息而不是只内联**：系数可以在面板活着的时候
   * 被 A−/A+ 或快捷键改掉 —— 面板收到就更新 `--anchor-font-scale`。`ui:ready` 重放之后
   * 宿主会补发一条当前的值（`SidebarPanel` 存着它），重建的面板因此不会丢样式。
   */
  | { type: 'ui:fontScale'; scale: number }
  /**
   * 【D120 新增】本次讲解累计的 token 用量，显示在面板**最下面**那一行。
   *
   * 为什么走消息而不是塞进 `session:update`：它是**几轮模型调用累出来的**，
   * 而 `session:update` 只在讲解结束时有值 —— 讲解跑几十秒的过程中，
   * 用户盯着面板时就能看见数字在涨，那是"它还在动"的一条额外证据。
   *
   * `null` = 这次一个 token 数都没拿到（端点没返回 `usage`），面板据此说"未提供"
   * 而不是画一排 0（把"不知道"写成 0 是在编一个看起来很确定的数）。
   */
  | { type: 'ui:usage'; usage: TokenUsage | null };

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
  | { type: 'ui:revealStep'; index: number }
  /**
   * 【D83 新增】讲完之后那两颗按钮。**为什么非加不可**：`done` 之后「下一步」按不动了，
   * 而面板上就此**没有任何出口** —— 用户的原话是「讲解结束时，需要能重新讲」。
   * 在那之前唯一的办法是回编辑器重新选一段再按快捷键，而那时他正看着面板、
   * 手边没有"重来一次"的任何按钮（D61/D72 是同一条规矩：讲完不许变成死路）。
   *
   * 两条刻意分成两个消息、**不合成一个带参数的消息**：它们的代价差一个数量级 ——
   * `ui:replay` 是本地重放（不碰网络、不花钱），`ui:reExplain` 要再问一次模型。
   * 合成一个的话，面板就得回传"要哪一种"这个参数，而 webview 是外部输入，
   * 能指定行为的面板就多一个能指错的地方（与 §5.5「只回传动作 id」同一条立场）。
   */
  | { type: 'ui:replay' }
  | { type: 'ui:reExplain' }
  /**
   * 【D89 新增】字号调节（A−/A+ 按钮，以及转发用户给 fontLarger / fontSmaller 绑的键）。
   * 只回传**动作**，不回传"调到多少" —— 系数的合法范围与持久化都在宿主一侧，
   * webview 是外部输入，能指定行为的面板就少一个能指错的地方（§5.5 同一条立场）。
   */
  | { type: 'ui:fontLarger' }
  | { type: 'ui:fontSmaller' }
  /**
   * 【D89 新增】导出与历史文件夹。与字号同理只回传动作 id；
   * "上次讲解存不存在"由宿主判断（面板上的导出按钮已经在无快照时禁用，双保险）。
   */
  | { type: 'ui:export' }
  | { type: 'ui:openHistory' };

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

/**
 * §12.4.4 块流面板 → 宿主（S-P2）。五种动作，对应 `blocks/ui/clientScript.ts` 的五个 post。
 *
 * @anchor 为什么这里一条**状态**都没有：面板不维护选中态（§12.4.2），
 *         所以"现在选了几块""第几个发出"一律由宿主算完再画；
 *         客户端只说用户做了什么（点了哪块 / 从哪块滑到哪块 / 按了底部哪颗按钮）。
 *         这样界面上的号码与发出去的稿子不可能分家 —— 它们本来就是同一次计算的结果。
 */
export type BlockToHost =
  | { type: 'blocks:toggle'; blockId: string }
  | { type: 'blocks:range'; from: string; to: string }
  | { type: 'blocks:mode' }
  | { type: 'blocks:clear' }
  | { type: 'blocks:ask' };

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
    case 'ui:replay':
    case 'ui:reExplain':
    case 'ui:fontLarger':
    case 'ui:fontSmaller':
    case 'ui:export':
    case 'ui:openHistory':
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

/**
 * §12.4.4 块流面板 → 宿主。**五条全是动作，没有一条是状态** ——
 * 面板不维护选中态（§12.4.2），所以客户端只说"用户做了什么"，不说"现在是什么样"。
 *
 * 与另两条守卫同一条规矩：形状不对一律 null（丢弃，不进链路）。
 * 这里同样**只查形状** —— `blockId` 认不认识由宿主拿块流的索引查（可能来自别的文档，
 * 那种情况要如实告诉用户"这块不在当前文档里"，而不是在守卫里静默吃掉）。
 */
export function parseBlockMessage(raw: unknown): BlockToHost | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  switch (raw.type) {
    case 'blocks:mode':
    case 'blocks:clear':
    case 'blocks:ask':
      return { type: raw.type };
    case 'blocks:toggle': {
      const blockId = raw.blockId;
      if (typeof blockId !== 'string' || blockId === '') return null;
      return { type: 'blocks:toggle', blockId };
    }
    case 'blocks:range': {
      const from = raw.from;
      const to = raw.to;
      if (typeof from !== 'string' || from === '') return null;
      if (typeof to !== 'string' || to === '') return null;
      return { type: 'blocks:range', from, to };
    }
    default:
      return null;
  }
}
