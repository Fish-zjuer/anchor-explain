/**
 * 拆块管线的端到端单测。
 *
 * @anchor 这里放的每个用例都对应一类**真实 PDF 的版面**：单栏正文、双栏论文、
 *         跨页断句、页脚页码、栏间通栏标题、栏内插图。fixtures 全部用代码造
 *         （归一化坐标的 item），不依赖任何 PDF 文件 —— 引擎的输入本来就是纯数据。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitDocument, linesOf, detectColumns, orderPage, fillImageText } from '../src/index.ts';
import type { PageTextIn, TextItemIn, Block } from '../src/index.ts';

const H = 0.02; // 常规正文字高（归一化）

function item(str: string, x: number, y: number, w: number, h = H): TextItemIn {
  return { str, x, y, w, h };
}

/** 一行正文（单个 item 造一行） */
function line(str: string, x: number, y: number, w: number, h = H): TextItemIn {
  return item(str, x, y, w, h);
}

function page(n: number, items: TextItemIn[]): PageTextIn {
  return { page: n, items };
}

test('单栏：连续行按行距合成一块，段间空隙另起一块', () => {
  const stream = splitDocument({
    pages: [
      page(1, [
        line('采样保持电路是模数转换的前置环节，它负责在量化期间锁住信号。', 0.1, 0.1, 0.8),
        line('锁住的依据是保持电容上的电压不会立刻泄放。', 0.1, 0.132, 0.8),
        line('这三行连成一块，说的都是工作原理。', 0.1, 0.164, 0.8),
        line('第二段从应用视角出发，讲的是音频前端为什么要用它。', 0.1, 0.24, 0.8),
      ]),
    ],
  });

  assert.equal(stream.blocks.length, 2);
  const first = stream.blocks[0]!;
  const second = stream.blocks[1]!;
  assert.equal(first.kind, 'text');
  assert.match(first.text, /采样保持电路/);
  assert.match(first.text, /泄放/);
  assert.match(first.text, /工作原理/);
  assert.equal(second.text, '第二段从应用视角出发，讲的是音频前端为什么要用它。');
  // 单 part（单页），bbox 是并集
  assert.equal(first.parts.length, 1);
  assert.equal(first.parts[0]?.page, 1);
});

test('标题：字高大、句子短、没有句末标点 → heading 块，级别按字号比', () => {
  const stream = splitDocument({
    pages: [
      page(1, [
        line('第 3 章 采样与保持', 0.1, 0.06, 0.5, 0.04), // 字高是正文的两倍 → 级别 1
        line('采样保持电路处在模拟前端与量化器之间。', 0.1, 0.16, 0.8),
        line('它的工作原理可以用一个开关和一个电容概括。', 0.1, 0.192, 0.8),
      ]),
    ],
  });

  assert.equal(stream.blocks.length, 2);
  assert.equal(stream.blocks[0]?.kind, 'heading');
  assert.equal(stream.blocks[0]?.headingLevel, 1);
  assert.equal(stream.blocks[1]?.kind, 'text');
});

test('页脚页码不进块流（否则跨页缝合会把页码拼进正文）', () => {
  const lines = linesOf(
    page(1, [line('正文一行。', 0.1, 0.5, 0.8), line('24', 0.48, 0.96, 0.04)]),
  );
  const stream = splitDocument({
    pages: [page(1, [line('正文一行。', 0.1, 0.5, 0.8), line('24', 0.48, 0.96, 0.04)])],
  });
  assert.equal(lines.length, 2);
  assert.equal(stream.blocks.length, 1);
  assert.match(stream.blocks[0]?.text ?? '', /正文一行/);
  assert.doesNotMatch(stream.blocks[0]?.text ?? '', /24/);
});

test('双栏：左栏读完读右栏，栏间通栏标题按 y 插入', () => {
  // 版面接近真实论文页：栏内行距 0.032（行隙 0.012 ≈ 0.6 倍字高），段距明显更大
  const leftLines = [
    line('左栏第一段的第一行，讲到采样开关的导通电阻。', 0.08, 0.12, 0.36),
    line('左栏第一段的第二行，继续讲电荷注入效应。', 0.08, 0.152, 0.36),
    line('左栏第一段的第三行，补充工艺相关的细节说明。', 0.08, 0.184, 0.36),
    line('左栏第二段单独讲孔径抖动的影响。', 0.08, 0.26, 0.36),
    line('左栏第二段的第二行，给出抖动的定义式。', 0.08, 0.292, 0.36),
  ];
  const rightLines = [
    line('右栏第一行从抖动的频域视角重新叙述一遍。', 0.56, 0.12, 0.36),
    line('右栏第二行给出一阶近似公式。', 0.56, 0.152, 0.36),
    line('右栏第三行讨论公式适用的频段范围。', 0.56, 0.26, 0.36),
    line('右栏第四行收束本节的论证。', 0.56, 0.292, 0.36),
  ];
  const spanner = line('2.1 开关电容的非理想因素', 0.08, 0.05, 0.84, 0.03);

  const stream = splitDocument({ pages: [page(1, [...leftLines, ...rightLines, spanner])] });

  const texts = stream.blocks.map((b) => b.text);
  assert.equal(texts.length, 5, `实际块：${JSON.stringify(texts)}`);
  assert.match(texts[0] ?? '', /2\.1 开关电容/);
  assert.match(texts[1] ?? '', /左栏第一段的第一行/);
  assert.match(texts[2] ?? '', /左栏第二段/);
  assert.match(texts[3] ?? '', /右栏第一行/);
  assert.match(texts[4] ?? '', /右栏第四行/);
});

test('跨页缝合：上页末尾没有句末标点 + 下页开头小写/CJK → 合成一块', () => {
  const stream = splitDocument({
    pages: [
      page(1, [line('保持电容的取值需要在 droop 与捕获噪声之间折中，这一段的结论是', 0.1, 0.8, 0.8)]),
      page(2, [line('电容越大 droop 越小，但捕获时间常数随之变长。', 0.1, 0.1, 0.8)]),
    ],
  });

  assert.equal(stream.blocks.length, 1, '两页各一块，缝合成一块');
  const merged = stream.blocks[0]!;
  assert.equal(merged.stitched, true);
  assert.equal(merged.parts.length, 2, '两个 part：上页 + 下页');
  assert.equal(merged.parts[0]?.page, 1);
  assert.equal(merged.parts[1]?.page, 2);
  assert.match(merged.text, /结论是电容越大/);
  assert.deepEqual(merged.partTexts?.length, 2, '每页的正文单独留着 —— unstitch 靠它还原');
});

test('跨页不缝合：上页以句号收尾 / 下页是标题', () => {
  const complete = splitDocument({
    pages: [
      page(1, [line('这一段已经说完了。', 0.1, 0.8, 0.8)]),
      page(2, [line('新的段落从这里开始，以句号收尾的上一行不缝合。', 0.1, 0.1, 0.8)]),
    ],
  });
  assert.equal(complete.blocks.length, 2, '句号收尾 → 不缝');

  const headingNext = splitDocument({
    pages: [
      page(1, [line('这一段的末尾没有句末标点，但下一页是', 0.1, 0.8, 0.8)]),
      page(2, [line('2.2 孔径抖动', 0.1, 0.08, 0.5, 0.035)]),
    ],
  });
  assert.equal(headingNext.blocks.length, 2, '下一页是标题 → 不缝');
});

test('图块：单独成块、插进阅读序；OCR 回填后升级为 text 块（fillImageText）', () => {
  const stream = splitDocument({
    pages: [
      page(1, [
        line('图上面的那一段。', 0.1, 0.1, 0.8),
        line('图上面的第二行，和上一行连成一块。', 0.1, 0.132, 0.8),
        line('图下面的那一段。', 0.1, 0.7, 0.8),
        line('图下面的第二行，和上一行连成一块。', 0.1, 0.732, 0.8),
      ]),
    ],
    images: [{ page: 1, bbox: [0.15, 0.3, 0.85, 0.6] }],
  });

  assert.equal(stream.blocks.length, 3);
  assert.equal(stream.blocks[1]?.kind, 'image');
  assert.deepEqual(stream.blocks[1]?.parts[0]?.bbox, [0.15, 0.3, 0.85, 0.6]);

  const filled = fillImageText(stream, stream.blocks[1]!.id, 'FIG. 1. A sample-and-hold circuit.');
  assert.equal(filled.blocks[1]?.kind, 'text');
  assert.match(filled.blocks[1]?.text ?? '', /sample-and-hold/);
  assert.equal(filled.blocks[1]?.parts[0]?.page, 1, '回填后仍保留原图位置');
});

test('块 ID 稳定：同内容重拆两次 ID 不变；bbox 微抖动（<0.0005）也不变', () => {
  const a = splitDocument({ pages: [page(1, [line('同一段文字。', 0.1, 0.1, 0.8)])] });
  const b = splitDocument({ pages: [page(1, [line('同一段文字。', 0.1, 0.1, 0.8)])] });
  assert.equal(a.blocks[0]?.id, b.blocks[0]?.id);

  const jittered = splitDocument({ pages: [page(1, [line('同一段文字。', 0.1003, 0.1, 0.8)])] });
  assert.equal(a.blocks[0]?.id, jittered.blocks[0]?.id, '三位小数以下的抖动不换 ID');
});

test('detectColumns：双栏找出沟与跨沟的行', () => {
  const lines = linesOf(
    page(1, [
      line('左栏一行足够长的正文。', 0.08, 0.1, 0.36),
      line('左栏第二行足够长的正文。', 0.08, 0.132, 0.36),
      line('左栏第三行足够长的正文。', 0.08, 0.164, 0.36),
      line('左栏第四行足够长的正文。', 0.08, 0.196, 0.36),
      line('右栏一行足够长的正文。', 0.56, 0.1, 0.36),
      line('右栏第二行足够长的正文。', 0.56, 0.132, 0.36),
      line('右栏第三行足够长的正文。', 0.56, 0.164, 0.36),
      line('右栏第四行足够长的正文。', 0.56, 0.196, 0.36),
    ]),
  );
  const layout = detectColumns(lines);
  assert.equal(layout.colCount, 2);
  assert.equal(layout.left.length, 4);
  assert.equal(layout.right.length, 4);
  assert.equal(layout.spanners.length, 0);
});

test('detectColumns：单栏正文不误判成双栏', () => {
  const lines = linesOf(
    page(1, [
      line('这是一行占满整页宽度的正文，没有栏沟。', 0.1, 0.1, 0.8),
      line('这是另一行占满整页宽度的正文，同样没有栏沟。', 0.1, 0.132, 0.8),
      line('第三行正文继续占满整页宽度，排除偶然的空白。', 0.1, 0.164, 0.8),
      line('第四行正文继续占满整页宽度，空白判据不会触发。', 0.1, 0.196, 0.8),
      line('第五行正文继续占满整页宽度，投影剖面持续被覆盖。', 0.1, 0.228, 0.8),
      line('第六行正文继续占满整页宽度，这是明确的单栏版面。', 0.1, 0.26, 0.8),
    ]),
  );
  const layout = detectColumns(lines);
  assert.equal(layout.colCount, 1);
});

test('orderPage：双栏的阅读序是左栏全读完再右栏（通栏按 y 插入）', () => {
  const mk = (text: string, pageNo: number, y: number): Block => ({
    id: text,
    kind: 'text',
    text,
    parts: [{ page: pageNo, bbox: [0.1, y, 0.9, y + 0.02] }],
  });
  const ordered = orderPage(
    [mk('L1', 1, 0.1), mk('L2', 1, 0.5)],
    [mk('R1', 1, 0.1), mk('R2', 1, 0.5)],
    [mk('H', 1, 0.05)],
    true,
  );
  assert.deepEqual(
    ordered.map((b) => b.text),
    ['H', 'L1', 'L2', 'R1', 'R2'],
    '通栏标题在最顶上；左栏读完再右栏',
  );
});

test('书眉/页脚模板：同一条线每页重复、只有数字在变 → 整批剔除（dropFurniture）', () => {
  const footer = (n: number) => line(`Anchor Explain fixture -- PAGE-${String(n).padStart(2, '0')} footer`, 0.1, 0.96, 0.8);
  const stream = splitDocument({
    pages: [1, 2, 3, 4].map((n) =>
      page(n, [line(`第 ${n} 页的唯一一段正文，内容各页不同。`, 0.1, 0.4, 0.8), footer(n)]),
    ),
  });
  assert.equal(stream.blocks.length, 4, '每页只剩正文那块，页脚模板全剔除');
  assert.match(stream.blocks[0]?.text ?? '', /唯一一段正文/);
  assert.doesNotMatch(stream.blocks[0]?.text ?? '', /footer/);

  // 只出现一两页的边缘短行不算模板（可能是真的正文注释）
  const few = splitDocument({
    pages: [
      page(1, [line('正文。', 0.1, 0.4, 0.8), line('特例说明 A-1。', 0.1, 0.96, 0.8)]),
      page(2, [line('正文二。', 0.1, 0.4, 0.8), line('特例说明 B-2。', 0.1, 0.96, 0.8)]),
    ],
  });
  assert.equal(few.blocks.length, 4, '不同文字的边缘行不是模板');
});
