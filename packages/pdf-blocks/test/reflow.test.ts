/**
 * 重排器的单测（D101）。
 *
 * @anchor 这一组盯的是"发出去的那份稿子"的四件事：**图文就位**（图块带裁剪、
 *         图注并进图块）、**密集**（不留白不噪声）、**有序**（编号 = 发送位次）、
 *         以及**超预算要说出来**（D79/D81：进了 prompt 的东西必须在屏幕上留下痕迹）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reflow, densify, approxTokens, badgeNumbers, orderedBlocks } from '../src/index.ts';
import type { Block, BlockIndex, BlockKind, BlockPart } from '../src/index.ts';

function part(page: number, y: number, y2 = y + 0.05): BlockPart {
  return { page, bbox: [0.1, y, 0.9, y2] };
}

function block(
  id: string,
  page: number,
  y: number,
  text: string,
  kind: BlockKind = 'text',
  extra: Partial<Block> = {},
): Block {
  return { id, kind, text, parts: [part(page, y)], partTexts: [text], ...extra };
}

test('正文：编号 + 顺序 + 标题前缀，抬头说清本次选了几块', () => {
  const blocks = [
    block('b1', 1, 0.1, '3.2 梯度下降', 'heading', { headingLevel: 2 }),
    block('b2', 1, 0.2, '梯度下降是一阶迭代优化算法。'),
    block('b3', 1, 0.3, '它沿着负梯度方向更新参数。'),
  ];
  const out = reflow(blocks, { docLabel: '深度学习 第 3 章' });

  assert.match(out.text, /文档：深度学习 第 3 章/);
  assert.match(out.text, /本次选送 3 块/);
  assert.match(out.text, /^\[1\] ## 3\.2 梯度下降$/m);
  assert.match(out.text, /^\[2\] 梯度下降是一阶迭代优化算法。$/m);
  assert.match(out.text, /^\[3\] 它沿着负梯度方向更新参数。$/m);
  assert.deepEqual(
    out.blocks.map((r) => [r.index, r.blockId, r.as]),
    [
      [1, 'b1', 'text'],
      [2, 'b2', 'text'],
      [3, 'b3', 'text'],
    ],
  );
  assert.deepEqual(out.images, []);
  assert.equal(out.truncated, false);
});

test('图块：正文里留位置，裁剪图进 images；图注并进图块（不再单占一段）', () => {
  const blocks = [
    block('b1', 1, 0.1, '损失随迭代下降，如下图所示。'),
    block('b2', 1, 0.3, '', 'image', { parts: [part(1, 0.3, 0.55)] }),
    block('b3', 1, 0.56, '图 3.4 损失曲线随迭代次数下降'),
    block('b4', 1, 0.7, '可见第 40 轮之后趋于平稳。'),
  ];
  const out = reflow(blocks);

  // 图注被并进图块：正文里 [3] 就是图 + 图注，图注不再单独成号
  assert.match(out.text, /^\[2\] 〔图〕图 3\.4 损失曲线随迭代次数下降$/m);
  assert.match(out.text, /^\[3\] 可见第 40 轮之后趋于平稳。$/m, '图注之后的那块应当是 3 号');
  assert.equal(out.images.length, 1);
  assert.deepEqual(out.images[0]?.index, 2);
  assert.equal(out.images[0]?.caption, '图 3.4 损失曲线随迭代次数下降');
  assert.deepEqual(out.images[0]?.parts, [part(1, 0.3, 0.55)], '裁剪要的是图本体');
  assert.deepEqual(out.images[0]?.captionParts, [part(1, 0.56)], '图注单独有位置，注释要分两处画');
  assert.equal(out.blocks.length, 3, '四块进、三号出（图注被并入）');
});

test('省 token 模式：不发图，但图注仍在正文里（模型不至于看不见那里有张图）', () => {
  const blocks = [
    block('b1', 1, 0.3, '', 'image'),
    block('b2', 1, 0.56, 'Figure 2 系统总体结构'),
  ];
  const out = reflow(blocks, { includeImages: false });
  assert.deepEqual(out.images, []);
  assert.match(out.text, /〔图〕Figure 2 系统总体结构/);
});

test('没有图注的图块：只留一个占位，不猜它是什么', () => {
  const out = reflow([block('b1', 1, 0.2, '正文在上。'), block('b2', 1, 0.4, '', 'image')]);
  assert.match(out.text, /^\[2\] 〔图〕$/m);
  assert.equal(out.images[0]?.caption, undefined);
});

test('超预算：截断**如实汇报**，抬头也写出来，绝不静默丢块', () => {
  const blocks = Array.from({ length: 6 }, (_, i) =>
    block(`b${i + 1}`, 1, 0.1 + i * 0.1, `第 ${i + 1} 段正文，长度大概这么多字。`),
  );
  const out = reflow(blocks, { docLabel: '某教材', maxChars: 120 });

  assert.equal(out.truncated, true);
  assert.ok(out.droppedBlockIds.length > 0, '丢掉的块要能点名');
  assert.match(out.text, /预算到顶/, '抬头必须说清后面的块没发出去');
  // 发出去的每一块都完整（不许发半块）
  for (const ref of out.blocks) {
    assert.notEqual(ref.blockId, out.droppedBlockIds[0], '第一块被丢的不能同时又出现');
  }
  assert.equal(out.blocks.length + out.droppedBlockIds.length, 6);
});

test('空壳块（图块文字为空/空正文）不进稿子，也不占编号', () => {
  const blocks = [
    block('b1', 1, 0.1, '有正文。'),
    block('b2', 1, 0.2, '   '),
    block('b3', 1, 0.3, '空壳在图里也算图块。', 'image'),
  ];
  const out = reflow(blocks);
  assert.equal(out.blocks.length, 2, '空白块不该占一个编号');
  assert.deepEqual(
    out.blocks.map((r) => r.blockId),
    ['b1', 'b3'],
  );
});

test('密度：行尾空白去掉、连续空行收成一个', () => {
  assert.equal(densify('第一行   \n\n\n第二行\t\n'), '第一行\n\n第二行');
});

test('编号与徽标同源：reflow 的 [N] 就是队列里那块的第 N 个', () => {
  const a = block('b1', 1, 0.5, '下半页的段落。');
  const b = block('b2', 1, 0.1, '上半页的段落。');
  const index: BlockIndex = new Map([
    [a.id, a],
    [b.id, b],
  ]);
  const queue = { mode: 'reading' as const, picked: ['b1', 'b2'] };

  const sent = orderedBlocks(queue, index);
  const out = reflow(sent);
  const badges = badgeNumbers(queue, index);

  for (const ref of out.blocks) {
    assert.equal(ref.index, badges.get(ref.blockId), `${ref.blockId} 在稿子里的编号必须等于徽标号`);
  }
  assert.deepEqual(
    out.blocks.map((r) => r.blockId),
    ['b2', 'b1'],
    '稿子里的顺序就是发送序（阅读序：上半页在前）',
  );
});

test('结尾的引用约定可以关掉（实验台 / 纯摘要用途）', () => {
  const withRefs = reflow([block('b1', 1, 0.1, '一句话。')]);
  assert.match(withRefs.text, /请按上面的块号引用/);
  const without = reflow([block('b1', 1, 0.1, '一句话。')], { askForRefs: false });
  assert.doesNotMatch(without.text, /请按上面的块号引用/);
});

test('token 估算：CJK 按 1、其余按 0.28（只用于预算提示）', () => {
  assert.equal(approxTokens('中文四字'), 4);
  assert.ok(approxTokens('abcdefghij') < 4, '英文按 0.28 折算');
  assert.ok(approxTokens('中文 abc') > 2);
});
