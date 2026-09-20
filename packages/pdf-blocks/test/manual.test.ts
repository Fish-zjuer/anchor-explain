/**
 * 手修与线程的纯操作单测（D99）。
 *
 * @anchor 手修是"启发式不终审"承诺的兑现处，线程是"解答附着在块上"的状态机 ——
 *         两者的判据都简单，但 ID 的稳定性、partTexts 的对齐这类**承诺**只有测试钉得住。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitDocument, mergeBlocks, unstitch, setKind, fillImageText } from '../src/index.ts';
import type { PageTextIn, TextItemIn } from '../src/index.ts';
import {
  makeThread,
  attachThread,
  removeThread,
  threadsForBlock,
  threadsEndingAtBlock,
  addFollowUp,
  makeFollowUp,
  threadContext,
} from '../src/threads.ts';
import type { ThreadStore } from '../src/index.ts';

const H = 0.02;
function line(str: string, x: number, y: number, w: number, h = H): TextItemIn {
  return { str, x, y, w, h };
}
function page(n: number, items: TextItemIn[]): PageTextIn {
  return { page: n, items };
}

/** 造一份跨页缝合的双页文档（手修测试的共用 fixture） */
function stitchedFixture() {
  return splitDocument({
    docId: 'doc1',
    pages: [
      page(1, [
        line('第一段：捕获噪声主要来自开关的导通电阻，这一段说完就结束。', 0.1, 0.2, 0.8),
        // 页面**最后**一块没有句末标点 → 与下页缝合（stitch 只发生在页边界上）
        line('第二段：保持电容的取值需要在 droop 与噪声之间折中，结论是', 0.1, 0.4, 0.8),
      ]),
      page(2, [line('电容越大 droop 越小，但捕获时间常数随之变长。', 0.1, 0.1, 0.8)]),
    ],
  });
}

test('mergeBlocks：两个块并成一块，文本按块拼接、parts 合并、ID 重算', () => {
  const stream = stitchedFixture();
  assert.equal(stream.blocks.length, 2, '第一段一块 + 跨页缝合一块');

  const [a, b] = stream.blocks as [typeof stream.blocks[number], typeof stream.blocks[number]];
  const merged = mergeBlocks(stream, [a.id, b.id]);
  assert.equal(merged.blocks.length, 1);

  const target = merged.blocks[0]!;
  assert.notEqual(target.id, a.id, '合并出的新块 ID 是新的（旧 ID 不许被冒用）');
  assert.ok(target.text.includes(a.text) && target.text.includes(b.text));
  assert.deepEqual(target.parts.length, a.parts.length + b.parts.length);
});

test('unstitch：跨页缝合的块拆回每页一块，正文各回各页', () => {
  const stream = stitchedFixture();
  const stitched = stream.blocks.find((b) => b.stitched);
  assert.ok(stitched, 'fixture 里应该有一块缝合块');
  assert.equal(stitched?.parts.length, 2);

  const undone = unstitch(stream, stitched!.id);
  assert.equal(undone.blocks.length, stream.blocks.length + 1);
  const texts = undone.blocks.map((b) => b.text);
  assert.ok(texts.some((t) => t.startsWith('第二段')), '上页的字回到上页那块');
  assert.ok(texts.some((t) => t.includes('电容越大 droop 越小')), '下页的字回到下页那块');
});

test('unstitch：普通块（没缝合过）原样返回', () => {
  const stream = stitchedFixture();
  const plain = stream.blocks.find((b) => !b.stitched)!;
  assert.deepEqual(unstitch(stream, plain.id), stream);
});

test('setKind：标题判反了可以改回来', () => {
  const stream = stitchedFixture();
  const block = stream.blocks[0]!;
  const flipped = setKind(stream, block.id, 'heading', 2);
  assert.equal(flipped.blocks.find((b) => b.id === block.id)?.kind, 'heading');
  assert.equal(flipped.blocks.find((b) => b.id === block.id)?.headingLevel, 2);
});

test('mergeBlocks / unstitch：找不到块 ID 明说（静默返回会让用户以为改成了）', () => {
  const stream = stitchedFixture();
  assert.throws(() => mergeBlocks(stream, ['nope']), /找不到块/);
  assert.throws(() => unstitch(stream, 'nope'), /找不到块/);
});

// ── 线程：解答附着在块上的全部状态 ──────────────────────────────────────────

function store(): ThreadStore {
  return { docId: 'doc1', threads: [] };
}

test('线程：挂块、按块查、组线程归末块', () => {
  const t1 = makeThread(['blk-a'], '这块在讲什么？', '讲的是 droop 的来源。', 1000, 'deepseek-flash');
  let s = attachThread(store(), t1);
  const t2 = makeThread(['blk-a', 'blk-b'], '这两块合起来说明什么？', '说明折中关系。', 2000);
  s = attachThread(s, t2);

  assert.equal(threadsForBlock(s, 'blk-a').length, 2, '单块 + 组线程都算挂在这块上');
  assert.equal(threadsForBlock(s, 'blk-c').length, 0);
  assert.deepEqual(threadsEndingAtBlock(s, 'blk-b').map((t) => t.id), [t2.id], '组线程显示在末块之后');
  assert.deepEqual(threadsEndingAtBlock(s, 'blk-a'), []);
});

test('线程：追问累积 + 按线程拼上下文（有界：块原文 + 线程本身）', () => {
  let s = attachThread(store(), makeThread(['blk-a'], '第一问', '第一答', 1000));
  s = addFollowUp(s, s.threads[0]!.id, makeFollowUp('追问一', '回答一', 2000));
  s = addFollowUp(s, s.threads[0]!.id, makeFollowUp('追问二', '回答二', 3000));
  assert.equal(s.threads[0]?.followUps.length, 2);

  const ctx = threadContext(s, s.threads[0]!.id, ['块原文']);
  assert.match(ctx, /块原文/);
  assert.match(ctx, /第一问/);
  assert.match(ctx, /追问二/);
  // 找不到线程时退化为纯块原文（不炸 —— 讲解不能因为存档丢失而失败）
  assert.equal(threadContext(s, 'nope', ['块原文']), '块原文');
});

test('线程：删除一条不影响别的；按内容+时间算 ID', () => {
  let s = attachThread(store(), makeThread(['blk-a'], '问一', '答一', 1000));
  s = attachThread(s, makeThread(['blk-b'], '问二', '答二', 2000));
  const removed = removeThread(s, s.threads[0]!.id);
  assert.equal(removed.threads.length, 1);
  assert.equal(removed.threads[0]?.question, '问二');

  const a = makeThread(['blk-a'], '同一问', '同一答', 1000);
  const b = makeThread(['blk-a'], '同一问', '同一答', 2000);
  assert.notEqual(a.id, b.id, '时间不同 → ID 不同');
});
