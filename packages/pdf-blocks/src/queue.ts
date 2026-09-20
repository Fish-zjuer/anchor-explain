/**
 * 选块队列与编号（D101）：**顺序、位次、徽标数字的唯一来源**。
 *
 * @anchor 队列里存的是**点选先后**（原始意图），发送顺序是**算出来的**。为什么这么分：
 *         用户随时可以切"按阅读序 / 按点选先后"，若存的时候就按某一种排好，
 *         切回来就再也还原不出另一种了 —— 原始意图一旦丢掉就是丢了。
 *
 * ## 三个界面上的号码必须是同一个（约束 107）
 *
 * 卡片徽标上的数字、队列面板里第 N 项、重排稿里的 `[N]` —— 三处各自排一遍的话，
 * 用户点掉"第 1 块"删掉的是模型眼里的第 2 块（D80 踩过这个坑，而且**不报错**）。
 * 所以位次只由 `orderedIds()` 一条路算出来，别处一律消费它的结果。
 *
 * ## 徽标数字是**当前的发送位次**，不是"入队时的序号"
 *
 * 按阅读序排时，后加的块可能插到前面去，于是已有块的号码会变。这是**诚实的**：
 * 号码要回答的问题是"它会被第几个发出去"。D80 的实测教训是可见性比编号稳定性重要
 * （用户因为"没看到反馈"而重复点了同一段）。
 *
 * ## 排序键是 `(页码, y)`，不是数组下标
 *
 * 下标会随增量精修（缝合把两块并一块、手修拆开）移位，而 `(page, topOf)` 不会 ——
 * 已入队的顺序不该在用户脚下悄悄变。`topOf()` 来自 `order.ts`。
 *
 * 本文件零依赖，node --test 直测。
 */

import { topOf } from './order.ts';
import type { Block } from './types.ts';

/** `reading` = 按阅读序（默认，自动）；`pick` = 按用户点选先后 */
export type OrderMode = 'reading' | 'pick';

export interface BlockQueue {
  mode: OrderMode;
  /** 点选先后（原始意图，**永远按加入顺序存**） */
  picked: readonly string[];
}

export const EMPTY_QUEUE: BlockQueue = { mode: 'reading', picked: [] };

export type BlockIndex = ReadonlyMap<string, Block>;

/** 排序键：先页码、再纵向位置。**不依赖块流下标**，所以增量精修不会挪动它 */
export function orderKeyOf(block: Block): readonly [number, number] {
  const first = block.parts[0];
  return [first?.page ?? Number.MAX_SAFE_INTEGER, topOf(block)];
}

export interface EnqueueResult {
  queue: BlockQueue;
  /**
   * 这一次到底加进去了没有。**必须回报**：用户连点两次的常见原因是
   * "第一次没看见反应"（D81），静默去重只会让他以为坏了。
   */
  added: boolean;
}

export function enqueue(queue: BlockQueue, blockId: string): EnqueueResult {
  if (queue.picked.includes(blockId)) return { queue, added: false };
  return { queue: { ...queue, picked: [...queue.picked, blockId] }, added: true };
}

export function dequeue(queue: BlockQueue, blockId: string): BlockQueue {
  return { ...queue, picked: queue.picked.filter((id) => id !== blockId) };
}

export function clearQueue(queue: BlockQueue): BlockQueue {
  return { ...queue, picked: [] };
}

export function hasBlock(queue: BlockQueue, blockId: string): boolean {
  return queue.picked.includes(blockId);
}

export function setMode(queue: BlockQueue, mode: OrderMode): BlockQueue {
  return queue.mode === mode ? queue : { ...queue, mode };
}

export function toggleMode(queue: BlockQueue): BlockQueue {
  return setMode(queue, queue.mode === 'reading' ? 'pick' : 'reading');
}

/**
 * 阅读序能不能用：队列里每一块都要**在当前的块索引里找得到**。
 * 找不到 = 还没处理出来、或来自另一份文档 —— 跨文档的块之间没有阅读序可言
 * （这正是用户说的"如果不能在一开始处理好"），此时只能退回点选先后。
 */
export function readingComparable(queue: BlockQueue, index: BlockIndex): boolean {
  return queue.picked.every((id) => index.has(id));
}

/** 实际生效的顺序模式（选了阅读序但排不了，就退回点选先后） */
export function effectiveMode(queue: BlockQueue, index: BlockIndex): OrderMode {
  if (queue.mode === 'pick') return 'pick';
  return readingComparable(queue, index) ? 'reading' : 'pick';
}

/**
 * 发送顺序。阅读序时按 `(页码, y)` 升序；同键（理论上不会发生）按块 ID 兜底，
 * 保证是**全序**（同样的输入永远给同样的输出）。索引里找不到的块排到最后。
 */
export function orderedIds(queue: BlockQueue, index: BlockIndex): readonly string[] {
  if (effectiveMode(queue, index) === 'pick') return [...queue.picked];
  const rank = new Map<string, readonly [number, number]>();
  for (const id of queue.picked) {
    const block = index.get(id);
    if (block !== undefined) rank.set(id, orderKeyOf(block));
  }
  return [...queue.picked].sort((a, b) => {
    const ra = rank.get(a);
    const rb = rank.get(b);
    if (ra === undefined || rb === undefined) {
      if (ra === rb) return queue.picked.indexOf(a) - queue.picked.indexOf(b);
      return ra === undefined ? 1 : -1;
    }
    return ra[0] - rb[0] || ra[1] - rb[1] || (a < b ? -1 : a > b ? 1 : 0);
  });
}

/** 发送序的块（重排器吃的就是它） */
export function orderedBlocks(queue: BlockQueue, index: BlockIndex): readonly Block[] {
  return orderedIds(queue, index)
    .map((id) => index.get(id))
    .filter((b): b is Block => b !== undefined);
}

/**
 * 位次表：块 ID → **发送位次**（1-based）。卡片徽标、队列面板、重排稿的 `[N]`
 * 全部消费这一份，所以它们不可能对不上。
 */
export function badgeNumbers(queue: BlockQueue, index: BlockIndex): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  orderedIds(queue, index).forEach((id, i) => out.set(id, i + 1));
  return out;
}

/** 单块的发送位次；不在队列里返 0 */
export function positionOf(queue: BlockQueue, index: BlockIndex, blockId: string): number {
  return badgeNumbers(queue, index).get(blockId) ?? 0;
}

/**
 * 悬停预览："这一块现在加进去会是第几"。**不改队列**（纯计算）。
 * 已在队列里就直接给它的位次 —— 悬停要回答的是"它会第几个被发出去"。
 */
export function previewPosition(queue: BlockQueue, index: BlockIndex, candidateId: string): number {
  const current = badgeNumbers(queue, index).get(candidateId);
  if (current !== undefined) return current;
  if (effectiveMode(queue, index) === 'pick') return queue.picked.length + 1;
  const candidate = index.get(candidateId);
  if (candidate === undefined) return queue.picked.length + 1;
  const [page, y] = orderKeyOf(candidate);
  let before = 0;
  for (const id of queue.picked) {
    const block = index.get(id);
    if (block === undefined) continue;
    const [p, yy] = orderKeyOf(block);
    if (p < page || (p === page && yy < y)) before += 1;
  }
  return before + 1;
}

/**
 * 顺序的一句话（上屏幕用）：**说的是实际生效的那一种**，不是用户选的那一种。
 * 选了阅读序却排不了而退回点选先后时必须说出来 —— 否则屏幕上在说反话（D68 的同类）。
 */
export function describeOrder(queue: BlockQueue, index: BlockIndex): string {
  const mode = effectiveMode(queue, index);
  if (mode === 'pick') {
    return queue.mode === 'reading'
      ? '顺序：按点选先后（有块不在当前文档里，阅读序排不了）'
      : '顺序：按点选先后';
  }
  return '顺序：按阅读序（自动）';
}
