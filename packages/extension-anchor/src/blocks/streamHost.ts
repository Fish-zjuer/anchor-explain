/**
 * 块流面板的**宿主侧状态机**（S-P2）：块流 + 队列 → 视图 / 稿件 / 锚点。
 *
 * @anchor 为什么单独一层（与 `WalkthroughSession` 同一条理由）：面板**不维护任何状态**
 *         （CONTRACTS §12.4.2 —— 状态只有一份，就不会出现"界面上的号码和发出去的不一致"）。
 *         而"点一下会变成第几个""发出去的是哪几块、什么顺序"这些数字正是约束 107 盯的东西，
 *         把它们写成纯函数，`node --test` 就能盯住；vscode 那一层只负责搬运与画。
 *
 * 三件在这里定死的事：
 *   1. **点/滑选落在卡片上，不落在块上** —— 卡片数与块数可能不同（图注被并进图卡），
 *      所以区间选择的成员来自 `blockViewOf(...).cards`（屏幕上看得见的那几张），
 *      "拉过哪几张就选哪几张"。
 *   2. **队列要跟块流对齐**（`reconciled`）：图注被并掉时把队列里的图注 ID 改写成图卡 ID、
 *      不属于这份文档的 ID 清掉并报出来 —— 沉默留着它，发稿子时才发现少东西（D81）。
 *   3. **问出去的那份稿子 = `reflow(orderedBlocks(...))`**，一字不改地放进锚点的
 *      `extractedText`（第一层就有全文，模型不必再取件）—— 重排器是 D101 定的那份真相，
 *      面板不许自己拼稿子。
 *
 * 本文件不 import 'vscode'。
 */

import { emptyRegistry, dequeue, describeOrder, enqueue, clearQueue, orderedBlocks, reflow, resolveIds, toggleMode } from '@anchor/pdf-blocks';
import type { Block, BlockIndex, BlockQueue, BlockRegistry, BlockStream, Reflow } from '@anchor/pdf-blocks';
import type { Anchor, PDFLocation } from '@anchor/core';
import { blockViewOf, cardsSummary } from './ui/model.ts';
import type { BlockView } from './ui/model.ts';

export interface BlockDoc {
  /** 磁盘路径（取件与"闪一下那一块"都要它） */
  filePath: string;
  /** 文档指纹（内容 sha1）：会话记忆与块 ID 的文档维度 */
  sourceId: string;
  /** basename，用于显示与取件说明 */
  sourceName: string;
  /** 面板抬头那行（如 "第 3 章 · 12–14 页"） */
  label: string;
}

export interface StreamState {
  doc: BlockDoc;
  /** 引擎的块流（阅读序），ID 已冻结 */
  stream: BlockStream;
  index: BlockIndex;
  /** 冻结用的档案：**留着它，重新拆块时 ID 才不会变**（D100 的"分配一次、只增不减"） */
  registry: BlockRegistry;
  queue: BlockQueue;
}

/**
 * 一份新读进来的块流 → 面板状态。
 *
 * `registry` / `queue` 传上一份的话，重新拆块时**块 ID 会被认回来**（新增的块才铸新号），
 * 用户选过的那几块也还在（不传就是这份文档第一次拆，两者都从零开始）。
 * **这是 D100 的地基在下游的用法**：没有它，每次重拆都会得到一批新 ID，
 * 之前选过的、问过的全都对不上 —— 而"对不上"在界面上表现为徽标全部消失。
 */
export function streamStateOf(
  doc: BlockDoc,
  stream: BlockStream,
  prev: { registry?: BlockRegistry; queue?: BlockQueue } = {},
): StreamState {
  const resolved = resolveIds(prev.registry ?? emptyRegistry(doc.sourceId), stream.blocks);
  const index: BlockIndex = new Map(resolved.blocks.map((block) => [block.id, block]));
  return {
    doc,
    stream: { ...stream, docId: stream.docId ?? doc.sourceId, blocks: resolved.blocks },
    index,
    registry: resolved.registry,
    queue: prev.queue ?? { mode: 'reading', picked: [] },
  };
}

/** 屏幕上那几张卡（区间选择与视图都以它为准） */
export function cardIdsOf(state: StreamState): readonly string[] {
  return viewOf(state).cards.map((card) => card.blockId);
}

export function viewOf(state: StreamState, images?: ReadonlyMap<string, string>): BlockView {
  return blockViewOf(state.stream.blocks, state.queue, state.index, images === undefined ? {} : { images });
}

export function summaryOf(state: StreamState, view: BlockView): string {
  return cardsSummary(view, state.queue.picked.length, orderTextOf(state));
}

export function orderTextOf(state: StreamState): string {
  return describeOrder(state.queue, state.index);
}

/* ── 四个动作（客户端发来的那几条消息就落在这四个函数上） ────────────── */

/** 点一下：不在队列里就加进去，在就拿出来（顺序 = 点选先后，阅读序由模式决定） */
export function toggled(state: StreamState, blockId: string): StreamState {
  if (!state.index.has(blockId)) return state;
  const next = state.queue.picked.includes(blockId) ? dequeue(state.queue, blockId) : enqueue(state.queue, blockId).queue;
  return { ...state, queue: next };
}

/**
 * 滑选 / Shift 点：把**屏幕上**这两张卡（含）之间的每一块都加进去。
 * 已经选过的不动 —— 区间选择是"加"，用点一下来取消（这样来回拉两次不会把自己删空）。
 */
export function ranged(state: StreamState, from: string, to: string): StreamState {
  const ids = cardIdsOf(state);
  const a = ids.indexOf(from);
  const b = ids.indexOf(to);
  if (a < 0 || b < 0) return state;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let queue = state.queue;
  for (let i = lo; i <= hi; i += 1) {
    const id = ids[i]!;
    if (!queue.picked.includes(id)) queue = enqueue(queue, id).queue;
  }
  return { ...state, queue };
}

export function cleared(state: StreamState): StreamState {
  return { ...state, queue: clearQueue(state.queue) };
}

/** 顺序模式：阅读序 ↔ 点选先后（底部那颗按钮） */
export function cycledMode(state: StreamState): StreamState {
  return { ...state, queue: toggleMode(state.queue) };
}

/**
 * 队列与块流对齐：图注被并进图卡时改写 ID、不属于这份文档的 ID 清掉。
 * 返回**这一次真的改了哪几个**，好让界面说一句（用户选过的东西不该无声消失）。
 *
 * ⚠ 注意"报出来的"与"这份块流里存在图注/孤儿"是两件事：`blockViewOf` 每张图卡都会报
 * `folded`（不论队列里有没有那个图注），所以这里只报**队列里真有、且这一次被改了**的。
 */
export function reconciled(state: StreamState): { state: StreamState; folded: readonly string[]; orphans: readonly string[] } {
  const view = viewOf(state);
  const picked = [...state.queue.picked];

  const orphans = picked.filter((id) => view.orphans.includes(id));
  const folded = [...view.folded.keys()].filter((from) => picked.includes(from));

  let next = picked;
  for (const [from, to] of view.folded) {
    if (!next.includes(from)) continue;
    next = next.map((id) => (id === from ? to : id));
  }
  next = next.filter((id) => !orphans.includes(id));
  // 改写可能撞出重复（图注和图卡同时被选过）：保序去重
  next = next.filter((id, i) => next.indexOf(id) === i);

  if (next.length === picked.length && next.every((id, i) => id === picked[i])) {
    return { state, folded: [], orphans: [] };   // 一个都没变：原样返回，面板据此不说废话
  }
  return { state: { ...state, queue: { ...state.queue, picked: next } }, folded, orphans };
}

/* ── 问出去：把选中的块按顺序排成一篇稿子，装进一根 PDF 锚点 ─────────── */

export interface AskPayload {
  /** 交给既有编排链路的锚点（`explain(anchor)` 一行不动） */
  anchor: Anchor;
  /** 发出去的稿子正文（= `anchor.extractedText`） */
  text: string;
  /** 稿子里真实的块顺序（截断时它会比 `queue.picked` 短） */
  blockIds: readonly string[];
  /** 每一块在页面上的位置（`location` 之外还要它，见 `Anchor.segments` 的注释） */
  segments: readonly PDFLocation[];
  /** 因为预算被丢掉的块（用户要能看见"哪些没发出去"） */
  droppedBlockIds: readonly string[];
  chars: number;
  approxTokens: number;
  truncated: boolean;
}

/** 一块的每个 part 都是一个"位置"（跨页块有两处） */
function segmentsOf(doc: BlockDoc, blocks: readonly Block[]): PDFLocation[] {
  const out: PDFLocation[] = [];
  for (const block of blocks) {
    for (const part of block.parts) out.push({ page: part.page, bbox: part.bbox, filePath: doc.filePath });
  }
  return out;
}

/**
 * 队列 → 发得出去的锚点。**空队列返回 null**（按钮那时也是禁的，两边同一判据）。
 *
 * @anchor 为什么载体是 `Anchor`（而不是给编排加一个新入口）：`ExplainProvider` 是
 *         `(anchor) => Promise<ExplanationResult>` 这条**两侧签名一致**的接缝
 *         （ports.ts：这样换实现只动调用点上的一行）。`Anchor` 上已经有
 *         `extractedText`（第一层上下文）、`segments`（多段的位置）、`blockIds`（D104 的块身份）
 *         —— 块流要说的三件事它都说得了，于是编排、会话、侧边栏、播放全链路一行不动。
 */
export function askPayloadOf(state: StreamState, opts: { maxChars?: number } = {}): AskPayload | null {
  const blocks = orderedBlocks(state.queue, state.index);
  if (blocks.length === 0) return null;

  const draft: Reflow = reflow(blocks, {
    docLabel: state.doc.label,
    ...(opts.maxChars === undefined ? {} : { maxChars: opts.maxChars }),
  });
  const kept = new Set(draft.blocks.map((ref) => ref.blockId));
  const keptBlocks = blocks.filter((block) => kept.has(block.id));
  const segments = segmentsOf(state.doc, keptBlocks);
  const first = segments[0];
  if (first === undefined) return null;

  const anchor: Anchor = {
    sourceType: 'pdf',
    sourceId: state.doc.sourceId,
    sourceName: state.doc.sourceName,
    location: first,
    extractedText: draft.text,
    segments,
    blockIds: keptBlocks.map((block) => block.id),
  };
  return {
    anchor,
    text: draft.text,
    blockIds: anchor.blockIds ?? [],
    segments,
    droppedBlockIds: draft.droppedBlockIds,
    chars: draft.chars,
    approxTokens: draft.approxTokens,
    truncated: draft.truncated,
  };
}
