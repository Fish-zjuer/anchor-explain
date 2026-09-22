/**
 * 块流面板的**宿主侧**单测（S-P2）。
 *
 * @anchor 这一组盯的是三件在界面上看不出、但错了就全错的事：
 *   1. **点/滑选落在卡片上**（卡片数可能少于块数：图注被并进图卡）——
 *      "拉过哪几张就选哪几张"，而不是按块数组的下标去选；
 *   2. **队列与块流对齐**：图注被并掉时队列里的图注 ID 要改写成图卡 ID，
 *      别的文档的 ID 要清掉并报出来（D81：用户选过的东西不该无声消失）；
 *   3. **问出去的那份稿子**：顺序 = 发出去的顺序、`extractedText` = 重排稿、
 *      `segments`/`blockIds` 与稿子对得上、超预算时**如实汇报**丢了哪些块。
 *
 * 真 PDF 那一条（最后）是本片的"真件"验收：读 `test/fixtures/sample-30p.pdf`，
 * 走的是面板真正走的那条路（`readSplitInput` → `splitDocument`）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { enqueue, orderedBlocks, splitDocument } from '@anchor/pdf-blocks';
import type { Block, BlockPart, BlockStream } from '@anchor/pdf-blocks';
import { isPDFLocation } from '@anchor/core';
import { createPdfDocumentCache } from '../src/adapters/pdf/pdfDocumentCache.ts';
import { createPdfJsSource } from '../src/adapters/pdf/pdfjsSource.ts';
import { itemsOfPage, readSplitInput } from '../src/blocks/blockSource.ts';
import { renderBlockStreamHtml } from '../src/blocks/ui/html.ts';
import { askPayloadOf, cleared, cycledMode, orderTextOf, ranged, reconciled, streamStateOf, summaryOf, toggled, viewOf } from '../src/blocks/streamHost.ts';
import type { BlockDoc } from '../src/blocks/streamHost.ts';
import { parseBlockMessage } from '../src/protocol.ts';

function part(page: number, y: number, x2 = 0.9): BlockPart {
  return { page, bbox: [0.1, y, x2, y + 0.05] };
}

function block(id: string, parts: BlockPart[], text: string, kind: Block['kind'] = 'text'): Block {
  return { id, kind, text, parts, partTexts: parts.map(() => text) };
}

const DOC: BlockDoc = { filePath: 'C:\\x\\教材.pdf', sourceId: 'fp1', sourceName: '教材.pdf', label: '教材.pdf · 共 3 页' };

/** 一份"图 + 图注 + 正文"的小块流：三块进、两张卡出（图注并进图卡） */
function stateOf() {
  const stream: BlockStream = {
    docId: 'fp1',
    pageCount: 3,
    blocks: [
      block('i1', [part(1, 0.3)], '', 'image'),
      block('c1', [part(1, 0.56)], '图 3.4 损失曲线'),
      block('t1', [part(1, 0.7)], '正文接着说。'),
      block('t2', [part(2, 0.1)], '第二页的话。'),
    ],
  };
  const state = streamStateOf(DOC, stream);
  const ids = state.stream.blocks.map((b) => b.id);
  return { state, ids };
}

test('点一下：加进去 / 再点拿出来；徽标就是队列位次（卡片与稿件同一个号）', () => {
  const { state, ids } = stateOf();
  const [i1, c1, t1] = ids as [string, string, string];

  const on = toggled(state, t1);
  assert.deepEqual(on.queue.picked, [t1]);
  const off = toggled(on, t1);
  assert.deepEqual(off.queue.picked, []);

  // 认不出来的 id 不动状态（点空白、别的文档的块）
  assert.equal(toggled(state, '不存在'), state);
  // 图注块点得到（它在卡片上不存在，但队列里允许有它 —— 之后会被折到图卡上，见 reconciled）
  assert.deepEqual(toggled(state, c1).queue.picked, [c1]);
  // 图卡本身也点得到
  assert.deepEqual(toggled(state, i1).queue.picked, [i1]);
});

test('滑选：区间按**屏幕上那几张卡**取（图注那张不存在），已经选过的不重复', () => {
  const { state, ids } = stateOf();
  const [i1, c1, t1, t2] = ids as [string, string, string, string];
  const cards = viewOf(state).cards.map((card) => card.blockId);
  assert.deepEqual(cards, [i1, t1, t2], '三块进、两张卡出（图注并进图卡）');

  // 从图卡拉到第 2 页那块 → 两张卡都进队列；**图注不在队列里**（它在屏幕上没有位置）
  const dragged = ranged(state, i1, t2);
  assert.deepEqual(dragged.queue.picked, [i1, t1, t2]);
  assert.equal(dragged.queue.picked.includes(c1), false, '图注块不该被"拉"进来');

  // 反着拉（从下往上）结果相同
  assert.deepEqual(ranged(state, t2, i1).queue.picked, [i1, t1, t2]);
  // 已经选过的不会重复
  assert.deepEqual(ranged(dragged, i1, t1).queue.picked, [i1, t1, t2]);
  // 认不出来的端点：不动
  assert.equal(ranged(state, '不存在', t1), state);
});

test('对齐：队列里的图注 ID 折到图卡上、别的文档的 ID 清掉并报出来（D81）', () => {
  const { state, ids } = stateOf();
  const [i1, c1, t1] = ids as [string, string, string];

  // 队列里存着图注 ID（用户点的是它）→ 必须折到图卡上，否则界面上一个痕迹都没有
  const withCaption = { ...state, queue: enqueue(state.queue, c1).queue };
  const folded = reconciled(withCaption);
  assert.deepEqual(folded.folded, [c1]);
  assert.deepEqual(folded.state.queue.picked, [i1]);
  assert.equal(viewOf(folded.state).cards.find((c) => c.blockId === i1)?.badge, 1, '位次要折到图卡上');

  // 队列里存着别的文档的块 ID → 清掉并报出来
  const withOrphan = { ...state, queue: { mode: 'reading' as const, picked: [t1, '从别的文档来的ID'] } };
  const cleaned = reconciled(withOrphan);
  assert.deepEqual(cleaned.orphans, ['从别的文档来的ID']);
  assert.deepEqual(cleaned.state.queue.picked, [t1]);

  // 本来就干净：原样返回（面板据此决定要不要说一句）
  const clean = reconciled(state);
  assert.equal(clean.state, state);
  assert.deepEqual(clean.folded, []);
  assert.deepEqual(clean.orphans, []);
});

test('顺序模式与清空：那颗按钮切的是**发送顺序**，底部那句话跟着变', () => {
  const { state, ids } = stateOf();
  const [i1, , t1] = ids as [string, string, string];
  // 先选第 2 页那块、再选第 1 页图卡：阅读序下发送顺序应当反过来
  let s = toggled(state, t1);
  s = toggled(s, i1);
  assert.deepEqual(s.queue.picked, [t1, i1], '点选先后');
  assert.deepEqual(orderedBlocks(s.queue, s.index).map((b) => b.id), [i1, t1], '阅读序');
  assert.match(orderTextOf(s), /阅读序/);

  const pickOrder = cycledMode(s);
  assert.deepEqual(orderedBlocks(pickOrder.queue, pickOrder.index).map((b) => b.id), [t1, i1], '切成点选先后');
  assert.match(orderTextOf(pickOrder), /点选先后/);

  assert.deepEqual(cleared(s).queue.picked, []);
  assert.match(summaryOf(s, viewOf(s)), /已选 2/);
});

test('问出去：稿子顺序 = 发送顺序；锚点带着 segments 与 blockIds，装的是重排稿', () => {
  const { state, ids } = stateOf();
  const [i1, , t1, t2] = ids as [string, string, string, string];
  let s = toggled(state, t2);
  s = toggled(s, t1);
  s = toggled(s, i1);

  const payload = askPayloadOf(s);
  assert.notEqual(payload, null);
  const p = payload!;
  assert.deepEqual(p.blockIds, [i1, t1, t2], '阅读序（默认模式）');
  assert.equal(p.anchor.sourceType, 'pdf');
  assert.equal(p.anchor.sourceId, 'fp1');
  assert.ok(isPDFLocation(p.anchor.location), '锚点的位置必须是 PDF 位置（取件与"闪一下那块"都靠它）');
  assert.equal(p.anchor.location.filePath, DOC.filePath, 'PDF 锚点必须带文件路径（S7 那条）');
  assert.equal(p.anchor.extractedText, p.text, '第一层上下文就是这份稿子');
  assert.match(p.text, /正文接着说。/);
  assert.match(p.text, /第二页的话。/);
  assert.deepEqual(p.anchor.blockIds, p.blockIds, '块身份随锚点走（D104）');
  assert.deepEqual(
    p.segments.map((seg) => seg.page),
    [1, 1, 2],
    '每一块的位置按顺序排好（跨页块会有两个 part）',
  );
  // 空队列 → null（按钮那时也是禁的，两边同一判据）
  assert.equal(askPayloadOf(cleared(s)), null);
});

test('超预算：如实汇报"哪些没发出去"，不假装都发了', () => {
  const { state, ids } = stateOf();
  const [i1, , t1, t2] = ids as [string, string, string, string];
  let s = toggled(state, i1);
  s = toggled(s, t1);
  s = toggled(s, t2);

  const payload = askPayloadOf(s, { maxChars: 20 });
  assert.notEqual(payload, null);
  const p = payload!;
  assert.equal(p.truncated, true);
  assert.ok(p.droppedBlockIds.length > 0, '丢掉的块要报出来');
  assert.ok(p.blockIds.length < 3, '发出去的比选中的少');
  // 报出来的和发出去的**加起来**覆盖选中的（不重不漏）
  assert.deepEqual([...p.blockIds, ...p.droppedBlockIds].sort(), [i1, t1, t2].sort());
});

test('真 PDF：pdf.js 的文字项 → 引擎的输入（字段名映射只此一处）', async () => {
  const bytes = new Uint8Array(await readFile(FIXTURE));
  const size = bytes.length;
  const expectedFingerprint = createHash('sha1').update(bytes).digest('hex');
  // ⚠ 这个端口**故意复用同一块缓冲**（缓存式实现）：pdf.js 会把喂进去的数组 transfer 走，
  // 于是"读完字节再算指纹"会静默算出空串的 sha1（S-P2 实测踩过）。两处都已修：
  // pdfjsSource 无条件复制、readSplitInput 先算指纹再打开。
  const cache = createPdfDocumentCache(createPdfJsSource({ bytes: { readBytes: async () => bytes } }));
  const read = await readSplitInput({ acquire: (p) => cache.acquire(p), readBytes: async () => bytes }, 'fixture.pdf');

  assert.equal(read.pageCount, 30, '样张是 30 页');
  assert.equal(read.input.docId, read.sourceId, '拆块输入带的是同一个文档指纹');
  assert.equal(read.sourceId, expectedFingerprint, '指纹 = 这份文件内容的 sha1（不是空串的）');
  assert.equal(bytes.length, size, '调用方手里那块缓冲不许被 pdf.js 吃掉');
  assert.equal(read.input.pages.length, 30);
  const page1 = read.input.pages[0]!;
  assert.ok(page1.items.length > 0, '第 1 页应当有文字项');
  const item = page1.items[0]!;
  assert.equal(typeof item.str, 'string');
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    assert.equal(typeof item[key], 'number', `${key} 必须是数字（引擎只认这个形状）`);
    assert.ok(item[key] >= -0.01 && item[key] <= 1.01, `${key} 应当在 [0,1] 的归一化范围内`);
  }


  // 拆块：整本跑一遍，块数不为零、页码都在范围内、阅读序不倒退
  const stream = splitDocument(read.input);
  assert.equal(stream.pageCount, 30);
  assert.ok(stream.blocks.length > 10, `30 页样张应当拆出成规模的块流（现在是 ${stream.blocks.length}）`);
  for (const b of stream.blocks) {
    for (const p of b.parts) assert.ok(p.page >= 1 && p.page <= 30, `页码越界：${p.page}`);
  }
  const firstPages = stream.blocks.map((b) => b.parts[0]!.page);
  assert.deepEqual([...firstPages].sort((a, b) => a - b), firstPages, '块流按阅读序（页码不倒退）');
});

test('真 PDF 一路穿到 HTML：拆出来的块 → 视图 → 相册（没有 undefined、没有空卡）', async () => {
  const bytes = new Uint8Array(await readFile(FIXTURE));
  const cache = createPdfDocumentCache(createPdfJsSource({ bytes: { readBytes: async () => bytes } }));
  const read = await readSplitInput({ acquire: (p) => cache.acquire(p), readBytes: async () => bytes }, 'fixture.pdf');
  const state = streamStateOf(
    { filePath: FIXTURE, sourceId: read.sourceId, sourceName: 'sample-30p.pdf', label: 'sample-30p.pdf · 共 30 页' },
    splitDocument(read.input),
  );

  // 选第 1、3 块：卡片上的号与稿子里的号必须是同一次计算的结果（约束 107）
  const ids = state.stream.blocks.map((b) => b.id);
  let s = toggled(state, ids[0]!);
  s = toggled(s, ids[2]!);
  const view = viewOf(s);
  assert.equal(view.cards.length, 30);
  assert.equal(view.cards[0]?.badge, 1);
  assert.equal(view.cards[2]?.badge, 2);
  assert.equal(view.orphans.length, 0);
  assert.equal(askPayloadOf(s)!.blockIds.length, 2);

  const html = renderBlockStreamHtml(
    'vscode-webview://x',
    { docLabel: state.doc.label, summary: summaryOf(s, view), view, orderText: orderTextOf(s), queued: 2 },
    1,
    'zh',
  );
  assert.equal((html.match(/<article class="card/g) ?? []).length, 30, '三十块三十张卡');
  assert.doesNotMatch(html, /undefined/, '真数据不许在 HTML 里漏出 undefined');
  assert.match(html, /class="card kind-text selected"/, '选中的那张要带 selected（徽标才显）');
  assert.match(html, /title="第 1 页 · 第 1 个发出/);
});

test('消息守卫：五条动作放行，其余一律丢弃（面板只发动作，不发状态）', () => {
  assert.deepEqual(parseBlockMessage({ type: 'blocks:toggle', blockId: 'b1' }), { type: 'blocks:toggle', blockId: 'b1' });
  assert.deepEqual(parseBlockMessage({ type: 'blocks:range', from: 'b1', to: 'b3' }), { type: 'blocks:range', from: 'b1', to: 'b3' });
  assert.deepEqual(parseBlockMessage({ type: 'blocks:mode' }), { type: 'blocks:mode' });
  assert.deepEqual(parseBlockMessage({ type: 'blocks:clear' }), { type: 'blocks:clear' });
  assert.deepEqual(parseBlockMessage({ type: 'blocks:ask' }), { type: 'blocks:ask' });

  for (const bad of [
    null,
    42,
    'blocks:ask',
    [],
    {},
    { type: 'blocks:unknown' },
    { type: 'blocks:toggle' },
    { type: 'blocks:toggle', blockId: '' },
    { type: 'blocks:toggle', blockId: 7 },
    { type: 'blocks:range', from: 'b1' },
    { type: 'blocks:range', from: '', to: 'b3' },
    { type: 'sidebar:next' },
  ]) {
    assert.equal(parseBlockMessage(bad), null, `非法消息必须丢弃：${JSON.stringify(bad)}`);
  }
});

test('blockSource：pdf.js 的 item → 引擎的 item（w/h 与 width/height 只在这里换算）', () => {
  const items = itemsOfPage({
    page: 1,
    text: '一段话',
    items: [{ text: '损失曲线', x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
    viewport: { width: 612, height: 792 },
  });
  assert.deepEqual(items, [{ str: '损失曲线', x: 0.1, y: 0.2, w: 0.3, h: 0.04 }]);
});

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../test/fixtures/sample-30p.pdf');
