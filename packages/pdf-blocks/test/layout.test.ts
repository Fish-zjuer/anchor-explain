/**
 * 版面修正的单测（P0/P1/P2，全部来自真实文档实测返工）。
 *
 * @anchor 这个文件里的每一条都对应一次**实测抓到的错**，不是为了覆盖率凑的：
 *   - P0：紧栏沟的双栏论文被并成一行 → 75% 的正文变成两栏交错的乱序；
 *   - P1a：段落边界只靠"空隙"判 → ACM 双栏（段间距≈0）整栏并成一块；
 *   - P1b：表格/清单被切成几十张卡片（实测一张表 104 张，占全文块数 48%）；
 *   - P2：`dropFurniture` 把"空签名"当成重复模板 → 有图块时正文被整批删光（496 → 6 块）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitDocument,
  partitionItems,
  formLines,
  linesOf,
  detectColumns,
  blocksOfColumn,
  groupRuns,
  dropFurniture,
  markFurnitureLines,
  COLUMN_GAP_FACTOR,
} from '../src/index.ts';
import type { Block, BlockStream, PageTextIn, TextItemIn } from '../src/index.ts';

const H = 0.012; // 真实论文的正文字高（10pt / 792pt 页高 ≈ 0.0126）
const LINE_STEP = 0.0176; // 行距
const LEFT_X = 0.09;
const RIGHT_X = 0.5; // 栏沟 = 0.5 - (0.09+0.39) = 0.02 ≈ 1.67×行高 —— 这是关键

function line(str: string, x: number, y: number, w: number, h = H): TextItemIn {
  return { str, x, y, w, h };
}
function page(n: number, items: TextItemIn[]): PageTextIn {
  return { page: n, items };
}

/** 造一页**紧栏沟**双栏论文（照 TraceMonkey 的真实几何） */
function tightTwoColumnPage(): PageTextIn {
  const items: TextItemIn[] = [];
  const leftSentences = [
    '左栏第一句讲了采样开关的导通电阻。',
    '左栏第二句继续讲电荷注入效应。',
    '左栏第三句给出孔径抖动的定义。',
    '左栏第四句说明它与孔径时间的关系。',
    '左栏第五句给出量化误差的量级。',
    '左栏第六句收束本节论证。',
  ];
  const rightSentences = [
    '右栏第一句从频域视角重新叙述。',
    '右栏第二句给出一阶近似公式。',
    '右栏第三句讨论适用频段。',
    '右栏第四句说明近似的误差来源。',
    '右栏第五句给出实验对照。',
    '右栏第六句收束全节。',
  ];
  leftSentences.forEach((s, i) => items.push(line(s, LEFT_X, 0.1 + i * LINE_STEP, 0.39)));
  rightSentences.forEach((s, i) => items.push(line(s, RIGHT_X, 0.1 + i * LINE_STEP, 0.39)));
  return page(1, items);
}

test('P0 partitionItems：左边缘双峰（0.09 与 0.50）→ 切出两栏，且栏沟只有 1.7×行高也能切开', () => {
  const p = tightTwoColumnPage();
  const parts = partitionItems(p.items);
  assert.equal(parts.colCount, 2, '左边缘双峰必须判成双栏');
  assert.equal(parts.left.length, 6);
  assert.equal(parts.right.length, 6);
  assert.equal(parts.spanners.length, 0);
  // 分界必须落在两簇之间（0.09 簇与 0.50 簇）
  assert.ok((parts.splitX ?? 0) > 0.11 && (parts.splitX ?? 0) < 0.5, `splitX=${parts.splitX}`);
});

test('P0 能红验证：只靠"行合并的宽松容差"会把两栏并进同一行（这正是返工的根据）', () => {
  const p = tightTwoColumnPage();
  const lines = formLines(1, p.items); // 默认 LINE_GAP_FACTOR = 2.5
  const spanning = lines.filter((l) => l.x < 0.5 && l.x + l.w > 0.5);
  assert.ok(
    spanning.length > 0,
    '2.5×行高的容差（0.03）比栏沟（0.02）还大 → 左右栏必然被并成一行；' +
      '所以切栏必须在成行之前（partitionItems），这也是 P0 的全部理由',
  );
  // 反过来：用栏沟级容差就不会跨栏
  const tight = formLines(1, p.items, COLUMN_GAP_FACTOR);
  assert.equal(tight.filter((l) => l.x < 0.5 && l.x + l.w > 0.5).length, 0);
});

test('P0 端到端：块流里**没有任何一块**同时含左栏与右栏的文字（交错是这次要根治的病）', () => {
  const stream = splitDocument({ docId: 'd', pages: [tightTwoColumnPage()] });
  const LEFT_ONLY = '孔径抖动的定义';
  const RIGHT_ONLY = '频域视角';

  for (const b of stream.blocks) {
    const hasLeft = b.text.includes(LEFT_ONLY);
    const hasRight = b.text.includes(RIGHT_ONLY);
    assert.ok(!(hasLeft && hasRight), `第 ${b.parts[0]?.page} 页有块同时含两栏文字（交错）：${b.text.slice(0, 60)}`);
  }
  const joined = stream.blocks.map((b) => b.text).join('\n');
  assert.ok(
    joined.indexOf(LEFT_ONLY) < joined.indexOf(RIGHT_ONLY),
    '阅读序应先左栏读完再右栏',
  );
});

test('P0 detectColumns（行级兜底路径）与 partitionItems 的判据各自守一件事', () => {
  const p = tightTwoColumnPage();
  const lines = linesOf(p); // 单栏假设成行 → 已经交错，行级投影救不回来
  const layout = detectColumns(lines);
  // 这条路径在本 fixture 上判不出双栏 —— 它正是被 P0 换掉的原因（留作兜底，不是主路径）
  assert.equal(layout.colCount, 1, '行级路径在紧栏沟上失效，这是已知且已记录的边界');
});

// ── P1a：段落边界三判据 ──────────────────────────────────────────────────────

test('P1a 首行缩进 = 新段落（中文段落的真实信号）', () => {
  const items = [
    line('第一段的第一行，讲到采样开关。', 0.1, 0.1, 0.8),
    line('第一段的第二行，继续讲电荷注入。', 0.1, 0.1 + LINE_STEP, 0.8),
    line('第二段以缩进起头，讲孔径抖动。', 0.13, 0.1 + 2 * LINE_STEP, 0.77), // 缩进 2 字符
  ];
  const blocks = blocksOfColumn('d', linesOf(page(1, items)));
  assert.equal(blocks.length, 2, '缩进起头必须是新段');
  assert.match(blocks[0]!.text, /第一段的第一行/);
  assert.match(blocks[0]!.text, /第二行/);
  assert.match(blocks[1]!.text, /第二段以缩进起头/);
});

test('P1a 末行短 + 句末标点 = 段落结束（两端对齐正文里最稳的信号）', () => {
  const items = [
    line('这是第一段的第一行，写得很满，占满整个栏宽，一直写到右边界。', 0.1, 0.1, 0.8),
    line('第一段结束。', 0.1, 0.1 + LINE_STEP, 0.3), // 明显不满行且以句号收尾
    line('第二段从这一行开始，又是一行占满栏宽的正文，写到右边界。', 0.1, 0.1 + 2 * LINE_STEP, 0.8),
  ];
  const blocks = blocksOfColumn('d', linesOf(page(1, items)));
  assert.equal(blocks.length, 2);
  assert.match(blocks[0]!.text, /第一段结束/);
  assert.match(blocks[1]!.text, /第二段从这一行开始/);
});

test('P1a 空隙大于段距阈值 = 新段落；都没有信号时不许乱切', () => {
  const spaced = [
    line('上一段的内容写完就结束了，这一行是它的结尾。', 0.1, 0.1, 0.8),
    // 空隙 = 0.05 —— 远大于行距，段距式版面
    line('下一段隔开一段空白。', 0.1, 0.1 + LINE_STEP + 0.05, 0.8),
  ];
  assert.equal(blocksOfColumn('d', linesOf(page(1, spaced))).length, 2);

  const continuous = [
    line('同一段的第一行，没有句末标点说明还没说完，', 0.1, 0.1, 0.8),
    line('第二行接着说完了这一句。', 0.1, 0.1 + LINE_STEP, 0.8),
    line('第三行还在同一段里，也占满栏宽继续写下去。', 0.1, 0.1 + 2 * LINE_STEP, 0.8),
  ];
  assert.equal(blocksOfColumn('d', linesOf(page(1, continuous))).length, 1, '没有段落信号就不许切');
});

// ── P1b：表格 / 清单 / 代码段归并 ────────────────────────────────────────────

function tinyBlock(text: string, x: number, y: number): Block {
  return {
    id: `t-${text}-${x}-${y}`,
    kind: 'text',
    text,
    parts: [{ page: 1, bbox: [x, y, x + 0.12, y + 0.014] }],
    partTexts: [text],
  };
}

test('P1b 成片的短行（2 列 × 4 行）→ 归成一块，行内按 x 排、行间按 y 排', () => {
  const blocks: Block[] = [];
  for (let row = 0; row < 4; row += 1) {
    const y = 0.2 + row * 0.02;
    blocks.push(tinyBlock(`左${row}`, 0.1, y), tinyBlock(`右${row}`, 0.3, y));
  }
  const grouped = groupRuns('d', blocks, H);
  assert.equal(grouped.length, 1, '8 个短块必须归成 1 块（这就是"一张表一张卡片"）');
  const lines = grouped[0]!.text.split('\n');
  assert.equal(lines.length, 4, '4 行');
  assert.equal(lines[0], '左0 | 右0', '行内按 x 排序，读起来是"第一列 | 第二列"');
  assert.equal(lines[3], '左3 | 右3');
  assert.equal(grouped[0]!.grouped, true);
});

test('P1b 不该归的别乱归：块太少 / 铺得太开 / 不是单行', () => {
  // 只有 3 块
  const few = [tinyBlock('a', 0.1, 0.2), tinyBlock('b', 0.3, 0.22), tinyBlock('c', 0.1, 0.24)];
  assert.equal(groupRuns('d', few, H).length, 3, '少于 4 块不归并');

  // 铺满整页（高 > 55% 页高）
  const spread = [
    tinyBlock('a', 0.1, 0.05),
    tinyBlock('b', 0.3, 0.3),
    tinyBlock('c', 0.1, 0.6),
    tinyBlock('d', 0.3, 0.9),
  ];
  assert.equal(groupRuns('d', spread, H).length, 4, '铺得太开说明不是一张表，不归并');

  // 有长块（正文段落）就不该被吸进表格
  const paragraph: Block = {
    id: 'p',
    kind: 'text',
    text: '这是一段正常的正文，长度远超六十个字，说明它不是表格里的格子，而是一个真正的段落，不该被归进表格块里。',
    parts: [{ page: 1, bbox: [0.1, 0.5, 0.9, 0.56] }],
    partTexts: [''],
  };
  const mixed = [tinyBlock('a', 0.1, 0.2), tinyBlock('b', 0.3, 0.2), tinyBlock('c', 0.1, 0.22), tinyBlock('d', 0.3, 0.22), paragraph];
  const out = groupRuns('d', mixed, H);
  assert.ok(out.some((b) => b.id === 'p'), '正文段落必须原样留下');
});

// ── P2：dropFurniture 的"空签名"事故 ────────────────────────────────────────

test('P2 有图块时不许把正文整批删光（496 → 6 块那次事故的回归）', () => {
  const blocks: Block[] = [];
  for (let p = 1; p <= 3; p += 1) {
    // 页边的图块：文字为空 —— 第一版就是拿它的空签名当成"重复模板"
    blocks.push({ id: `img${p}`, kind: 'image', text: '', parts: [{ page: p, bbox: [0.1, 0.95, 0.9, 0.99] }], partTexts: [''] });
    // 页边的长正文块：不是候选，第一版被 `signature(b) ?? ''` 一起删掉
    blocks.push({
      id: `txt${p}`,
      kind: 'text',
      text: `第 ${p} 页的正文，这一段明显超过六十个字，所以它绝不是页眉页脚的模板；任何情况下它都不该被删掉，这条测试守的就是这件事，页边的图块也不能成为删它的理由。`,
      parts: [{ page: p, bbox: [0.1, 0.9, 0.9, 0.94] }],
      partTexts: [''],
    });
  }
  const stream: BlockStream = { docId: 'd', pageCount: 3, blocks };
  const out = dropFurniture(stream);
  assert.equal(out.blocks.length, 6, '图块与长正文块都必须留下');
  assert.equal(out.blocks.filter((b) => b.kind === 'text').length, 3);
});

test('P2 行级掩码：跨 ≥3 页重复的书眉要删，只在两页出现的边缘行要留', () => {
  const H2 = 0.012;
  const lines = [];
  for (let p = 1; p <= 4; p += 1) {
    lines.push({ page: p, text: `XX Press — PAGE ${p}`, x: 0.1, y: 0.96, w: 0.3, h: H2 }); // 模板
    lines.push({ page: p, text: `第 ${p} 页独有的一段正文。`, x: 0.1, y: 0.5, w: 0.8, h: H2 }); // 正文
  }
  lines.push({ page: 1, text: '只在第 1 页出现的边缘行。', x: 0.1, y: 0.95, w: 0.4, h: H2 });
  lines.push({ page: 2, text: '只在第 2 页出现的边缘行。', x: 0.1, y: 0.95, w: 0.4, h: H2 });

  const drop = markFurnitureLines(lines);
  const dropped = [...drop].map((l) => l.text);
  assert.equal(dropped.filter((t) => t.startsWith('XX Press')).length, 4, '4 页的书眉全删');
  assert.equal(dropped.filter((t) => t.includes('独有的一段正文')).length, 0, '正文一行都不许删');
  assert.equal(dropped.filter((t) => t.includes('边缘行')).length, 0, '只在两页出现的边缘行不是模板');
});
