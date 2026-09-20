/**
 * 块身份冻结层的单测（D100）。
 *
 * @anchor 这一组测的不是"算法对不对"，而是**承诺**：回答过的问答不能因为
 *         内容后续被补出来而失去落点。所以每个用例对应一条**真实会发生的变更**：
 *         OCR 回填改文字、抽取抖动、跨页缝合、取消缝合、引擎升级换指纹。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveIds,
  registryFrom,
  emptyRegistry,
  resolveAlias,
  isKnownId,
  aliasesOf,
  partsKeyOf,
  PART_EPS,
} from '../src/index.ts';
import type { Block, BlockKind, BlockPart } from '../src/index.ts';

/** 一个块：`fingerprint` 模拟引擎给的内容指纹 ID（真实链路上就是 `blockId(...)`） */
function block(fingerprint: string, parts: BlockPart[], text: string, kind: BlockKind = 'text'): Block {
  return {
    id: fingerprint,
    kind,
    text,
    parts,
    partTexts: parts.map(() => text),
  };
}

function part(page: number, y1: number, y2: number, x1 = 0.1, x2 = 0.9): BlockPart {
  return { page, bbox: [x1, y1, x2, y2] };
}

const P1 = [part(1, 0.7, 0.9)];
const P2 = [part(2, 0.1, 0.2)];

test('分配一次：同一份块流跑两遍，ID 逐字相同（幂等）', () => {
  const blocks = [block('fpA', P1, '第一块'), block('fpB', P2, '第二块')];
  const first = registryFrom(blocks, 'doc');
  assert.deepEqual(
    first.blocks.map((b) => b.id),
    ['b1', 'b2'],
  );
  const again = resolveIds(first.registry, first.blocks);
  assert.deepEqual(
    again.blocks.map((b) => b.id),
    ['b1', 'b2'],
  );
  // 第二遍不该再铸新 ID
  assert.deepEqual(again.minted, []);
});

test('OCR 回填：文字变了、parts 没变 → ID 不变（D99 那版会换 ID，问答就丢了）', () => {
  const empty = block('fpImage', P1, '', 'image');
  const first = registryFrom([empty], 'doc');
  assert.equal(first.blocks[0]!.id, 'b1');

  // 回填：图块升级成 text 块，文字从无到有
  const filled: Block = { ...first.blocks[0]!, kind: 'text', text: '图 3.4 损失曲线随迭代下降' };
  const second = resolveIds(first.registry, [filled]);
  assert.equal(second.blocks[0]!.id, 'b1');
  assert.deepEqual(second.minted, []);
  // 历史指纹仍能查到这一块
  assert.equal(resolveAlias(second.registry, 'fpImage'), 'b1');
});

test('抽取抖动：bbox 偏 0.001（小于容差）仍认作同一块', () => {
  const a = block('fpA', [part(1, 0.7, 0.9)], '同一段话');
  const first = registryFrom([a], 'doc');
  const jittered = block('fpA2', [part(1, 0.7 + 0.001, 0.9 - 0.001)], '同一段话');
  const second = resolveIds(first.registry, [jittered]);
  assert.equal(second.blocks[0]!.id, 'b1');
  assert.ok(PART_EPS > 0.001, '容差必须大于抖动幅度');
});

test('跨页缝合：赢家保留自己的 ID，被吞并那块改嫁过去（旧 ID 不消失）', () => {
  const a = block('fpA', P1, '这一句话被分页');
  const b = block('fpB', P2, '截断了，下半句在这里。');
  const first = registryFrom([a, b], 'doc');
  assert.deepEqual(
    first.blocks.map((x) => x.id),
    ['b1', 'b2'],
  );

  // 缝合后：一个块、两个 part
  const stitched = block('fpC', [...P1, ...P2], '这一句话被分页截断了，下半句在这里。');
  const second = resolveIds(first.registry, [stitched]);

  assert.equal(second.blocks[0]!.id, 'b1', '复用的是最靠前那一块的 ID');
  assert.equal(second.blocks[0]!.parts.length, 2);
  // 三个历史键全部落到缝合块上
  for (const old of ['b2', 'fpB', 'fpA']) {
    assert.equal(resolveAlias(second.registry, old), 'b1', `${old} 应当解析到 b1`);
  }
  assert.deepEqual(second.minted, [], '缝合不该铸新 ID');
});

test('取消缝合：碎片拿回**自己的**历史 ID，而不是变成新块', () => {
  const a = block('fpA', P1, '这一句话被分页');
  const b = block('fpB', P2, '截断了，下半句在这里。');
  const first = registryFrom([a, b], 'doc');
  const stitched = block('fpC', [...P1, ...P2], '这一句话被分页截断了，下半句在这里。');
  const second = resolveIds(first.registry, [stitched]);

  // 拆开：两片按流序回来
  const pieceA = block('fpA2', P1, '这一句话被分页');
  const pieceB = block('fpB2', P2, '截断了，下半句在这里。');
  const third = resolveIds(second.registry, [pieceA, pieceB]);

  assert.deepEqual(
    third.blocks.map((x) => x.id),
    ['b1', 'b2'],
    '两片都要拿回自己的历史 ID',
  );
  // 只有 b2 走了"从墓园认回"这条路；b1 从来没离开过有效项，所以不算 reclaim
  assert.deepEqual([...third.reclaimed], ['b2']);
  assert.deepEqual(third.minted, []);
  // 各自的旧指纹也跟着回到各自身上，不再互相串
  assert.equal(resolveAlias(third.registry, 'fpA'), 'b1');
  assert.equal(resolveAlias(third.registry, 'fpB'), 'b2');
  assert.equal(resolveAlias(third.registry, 'fpA2'), 'b1');
  assert.equal(resolveAlias(third.registry, 'fpB2'), 'b2');
});

test('认不回原块时兜底：第一个碎片**继承**容器的身份，问答不至于凭空消失', () => {
  // 一块从没单独登记过（首次处理就是缝好的样子）→ 墓园里没有它的碎片
  const stitched = block('fpC', [...P1, ...P2], '缝好的整段话。');
  const first = registryFrom([stitched], 'doc');
  assert.equal(first.blocks[0]!.id, 'b1');

  const pieceA = block('fpA', P1, '上半句');
  const pieceB = block('fpB', P2, '下半句');
  const second = resolveIds(first.registry, [pieceA, pieceB]);

  assert.equal(second.blocks[0]!.id, 'b1', '第一片继承容器');
  assert.equal(resolveAlias(second.registry, 'b1'), 'b1', '容器 ID 之后还要继续当真实块用');
  assert.ok(second.blocks[1]!.id !== 'b1', '第二片是新块，不能冒用同一个 ID');
  assert.equal(new Set(second.blocks.map((b) => b.id)).size, 2, 'ID 不许重复');
  // 收缩之后再缝回去，仍然回到 b1 这个身份上
  const restitched = resolveIds(second.registry, [block('fpC2', [...P1, ...P2], '缝好的整段话。')]);
  assert.equal(restitched.blocks[0]!.id, 'b1');
});

test('不认识的 ID：原样返回，绝不抛（它可能是命令的第一跳）', () => {
  const reg = emptyRegistry('doc');
  assert.equal(resolveAlias(reg, '从没见过的ID'), '从没见过的ID');
  assert.equal(isKnownId(reg, '从没见过的ID'), false);
});

test('isKnownId / aliasesOf：退休的 ID 仍算"我们发过"，能查全它的历史', () => {
  const a = block('fpA', P1, '上半句');
  const b = block('fpB', P2, '下半句');
  const first = registryFrom([a, b], 'doc');
  const stitched = block('fpC', [...P1, ...P2], '上半句下半句');
  const second = resolveIds(first.registry, [stitched]);

  assert.equal(isKnownId(second.registry, 'b2'), true);
  const history = aliasesOf(second.registry, 'b2');
  assert.ok(history.includes('b1'), '按任何一个历史 ID 问，都要能拿到当前块的全部历史键');
  assert.ok(history.includes('fpB'));
});

test('partsKeyOf：同一组 parts 与顺序无关（别名与查重的键）', () => {
  assert.equal(partsKeyOf([...P1, ...P2]), partsKeyOf([...P2, ...P1]));
  assert.notEqual(partsKeyOf(P1), partsKeyOf(P2));
});
