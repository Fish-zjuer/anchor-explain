/**
 * 队列与编号的单测（D101）。
 *
 * @anchor 这一组盯的是**三个界面上的号码必须是同一个**（约束 107）：
 *         卡片徽标、队列面板第 N 项、重排稿里的 `[N]`。另外还盯两条纪律：
 *         排序键不能用数组下标（增量精修会挪动下标）、屏幕上的"顺序"说的必须是
 *         **实际生效**的那一种（选了阅读序但排不了时要明说，不能将错就错）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_QUEUE,
  enqueue,
  dequeue,
  clearQueue,
  hasBlock,
  toggleMode,
  setMode,
  readingComparable,
  effectiveMode,
  orderedIds,
  orderedBlocks,
  badgeNumbers,
  positionOf,
  previewPosition,
  describeOrder,
  orderKeyOf,
} from '../src/index.ts';
import type { Block, BlockIndex, BlockQueue, BlockPart } from '../src/index.ts';

function part(page: number, y: number): BlockPart {
  return { page, bbox: [0.1, y, 0.9, y + 0.05] };
}

function block(id: string, page: number, y: number, text = `第${page}页${y}`): Block {
  return { id, kind: 'text', text, parts: [part(page, y)], partTexts: [text] };
}

/** 索引：块流里各块按阅读序排列（数组下标与阅读序**故意不一致**，用来抓"用下标排序"的实现） */
function indexOf(...blocks: Block[]): BlockIndex {
  return new Map(blocks.map((b) => [b.id, b]));
}

function withPicks(mode: BlockQueue['mode'], ...ids: string[]): BlockQueue {
  return { mode, picked: ids };
}

test('enqueue：幂等，且**必须回报**这一次到底加没加进去（D81 的教训）', () => {
  const first = enqueue(EMPTY_QUEUE, 'b1');
  assert.equal(first.added, true);
  assert.deepEqual(first.queue.picked, ['b1']);

  const second = enqueue(first.queue, 'b1');
  assert.equal(second.added, false, '重复点选要说"already"，不能静默');
  assert.deepEqual(second.queue.picked, ['b1'], '不许出现两份同样的范围');
  assert.equal(hasBlock(second.queue, 'b1'), true);
});

test('阅读序：按 (页码, y) 排，而**不是**按块流下标 —— 下标会被增量精修挪动', () => {
  const a = block('b1', 1, 0.5);
  const b = block('b2', 1, 0.1);
  const c = block('b3', 2, 0.1);
  // 索引里的数组顺序是 a, b, c（故意与阅读序不同：b 在 a 上面）
  const index = indexOf(a, b, c);
  const queue = withPicks('reading', 'b1', 'b2', 'b3');
  assert.deepEqual(orderedIds(queue, index), ['b2', 'b1', 'b3']);
  assert.deepEqual(
    orderedBlocks(queue, index).map((x) => x.text),
    [b.text, a.text, c.text],
  );
  assert.deepEqual(orderKeyOf(a), [1, 0.5]);
});

test('点选序：原样按点选先后发（原始意图永远留着，切回来能还原）', () => {
  const a = block('b1', 1, 0.5);
  const b = block('b2', 1, 0.1);
  const index = indexOf(a, b);
  const queue = withPicks('pick', 'b1', 'b2');
  assert.deepEqual(orderedIds(queue, index), ['b1', 'b2']);
  assert.deepEqual(toggleMode(queue).picked, ['b1', 'b2'], '切换模式不许改动原始点选序');
  assert.deepEqual(orderedIds(toggleMode(queue), index), ['b2', 'b1']);
});

test('徽标数字 = 发送位次；预览位次是纯计算，不改队列', () => {
  const a = block('b1', 1, 0.5);
  const b = block('b2', 1, 0.1);
  const index = indexOf(a, b);
  const queue = withPicks('reading', 'b1');

  assert.equal(positionOf(queue, index, 'b1'), 1);
  assert.equal(positionOf(queue, index, 'b2'), 0, '不在队列里给 0');
  // 悬停：b2 按阅读序会插到 b1 前面（它在上方）
  assert.equal(previewPosition(queue, index, 'b2'), 1);
  assert.equal(previewPosition(queue, index, 'b1'), 1, '已在队列里就给它的现位次');
  assert.deepEqual(queue.picked, ['b1'], '预览绝不能改动队列');

  // 点选序下悬停就是队尾 + 1
  assert.equal(previewPosition(setMode(queue, 'pick'), index, 'b2'), 2);
});

test('徽标位次与重排稿的编号同源：badgeNumbers 就是 orderedIds 的序号', () => {
  const a = block('b1', 2, 0.3);
  const b = block('b2', 1, 0.9);
  const c = block('b3', 1, 0.1);
  const index = indexOf(a, b, c);
  const queue = withPicks('reading', 'b1', 'b2', 'b3');
  const badges = badgeNumbers(queue, index);
  orderedIds(queue, index).forEach((id, i) => {
    assert.equal(badges.get(id), i + 1, `${id} 的徽标号必须等于它的发送位次`);
  });
  assert.deepEqual([...badges.keys()], ['b3', 'b2', 'b1']);
});

test('增量精修不挪动顺序：缝合后块的阅读位置仍由首个 part 决定', () => {
  const upper = block('b1', 1, 0.7);
  const lower = block('b2', 2, 0.1);
  const before = indexOf(upper, lower);
  const queue = withPicks('reading', 'b2', 'b1');
  assert.deepEqual(orderedIds(queue, before), ['b1', 'b2']);

  // 缝合：两块并成一块，ID 复用了 b1（见 registry 的规则），parts 变成两个
  const stitched: Block = {
    id: 'b1',
    kind: 'text',
    text: upper.text + lower.text,
    parts: [...upper.parts, ...lower.parts],
    partTexts: [upper.text, lower.text],
    stitched: true,
  };
  const after = indexOf(stitched, lower);
  assert.equal(positionOf(queue, after, 'b1'), 1, '缝合不该让已入队的块换位次');
});

test('跨文档 / 还没处理出来的块：阅读序排不了，**退回点选先后并说出来**', () => {
  const a = block('b1', 1, 0.1);
  const index = indexOf(a); // b9 不在这份索引里（另一份文档，或还没处理）
  const queue = withPicks('reading', 'b1', 'b9');

  assert.equal(readingComparable(queue, index), false);
  assert.equal(effectiveMode(queue, index), 'pick');
  assert.deepEqual(orderedIds(queue, index), ['b1', 'b9'], '退回点选先后');
  assert.match(describeOrder(queue, index), /点选先后/);
  assert.match(describeOrder(queue, index), /排不了/, '屏幕上必须说清为什么不是阅读序');

  // 全都在索引里时，报的就是阅读序
  const both = indexOf(a, block('b9', 2, 0.1));
  assert.match(describeOrder(queue, both), /阅读序/);
});

test('dequeue / clearQueue：删一块、清空，都不动别的块', () => {
  const queue = withPicks('reading', 'b1', 'b2', 'b3');
  assert.deepEqual(dequeue(queue, 'b2').picked, ['b1', 'b3']);
  assert.deepEqual(clearQueue(queue).picked, []);
  assert.equal(clearQueue(queue).mode, 'reading', '清空不动模式');
});
