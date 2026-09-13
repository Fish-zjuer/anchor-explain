/**
 * S7：PDF 取件。事实源：docs/CONTRACTS.md §3.1/§3.2/§3.3 + `SLICES.md` 的 S7 验收标准。
 *
 * @anchor 分两层验，这个分法本身就是设计的一部分：
 *   - **逻辑层**（页码区间、页头、越界、缓存淘汰、bbox 命中）喂**手搓的** `PDFSource`——
 *     快、可穷举边界，而且不需要理解 pdf.js 的返回形状
 *   - **真解析层**一条：真读 `test/fixtures/sample-30p.pdf`，验"pdf.js 的坐标系换算对不对"。
 *     这一层不可能是假的：`transform` 的 y 轴方向、点单位、viewport 尺寸都只有真数据说了算。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createPdfAdapter, pageHeader } from '../src/adapters/PDFAdapter.ts';
import { createPdfDocumentCache } from '../src/adapters/pdf/pdfDocumentCache.ts';
import { openPdfJsSource } from '../src/adapters/pdf/pdfjsSource.ts';
import { joinLines, normalizeItems, readingOrder } from '../src/adapters/pdf/pageTextIndex.ts';
import type { PDFPageText, PDFSource } from '../src/adapters/pdf/PDFSource.ts';
import { HIT_RATIO, itemsInBBox, textInBBox } from '../src/adapters/pdf/textSearch.ts';

const FIXTURE = fileURLToPath(new URL('../../../test/fixtures/sample-30p.pdf', import.meta.url));

/** 手搓一份 5 页的 PDF：第 N 页有两行，第二行故意是"同一行的两块" */
function fakeSource(pageCount = 5): PDFSource & { disposed: boolean; opened: number } {
  const state = { disposed: false, opened: 0 };
  return {
    pageCount,
    get disposed() {
      return state.disposed;
    },
    get opened() {
      return state.opened + 1;
    },
    page(page: number): Promise<PDFPageText | null> {
      if (page < 1 || page > pageCount) return Promise.resolve(null);
      const items = [
        { text: `Page ${page} title`, x: 0.1, y: 0.1, width: 0.4, height: 0.03 },
        { text: `body of`, x: 0.1, y: 0.5, width: 0.15, height: 0.03 },
        { text: `page ${page}`, x: 0.26, y: 0.5, width: 0.15, height: 0.03 },
      ];
      return Promise.resolve({
        page,
        text: joinLines(items),
        items,
        viewport: { width: 595, height: 842 },
      });
    },
    dispose(): void {
      state.disposed = true;
    },
  };
}

function adapterWith(source: PDFSource) {
  return createPdfAdapter({ cache: createPdfDocumentCache(() => Promise.resolve(source)) });
}

const req = (over: Record<string, unknown> = {}) => ({
  type: 'file' as const,
  params: { path: '/docs/a.pdf', start: 2, end: 3, ...over },
  reason: '看不全',
});

// ── 逻辑层 ────────────────────────────────────────────────────────────────

test('fetchContext：页码范围 + 每页一个页头（S7 验收点名的格式）', async () => {
  const adapter = adapterWith(fakeSource());
  // 注意这里是 page_range（PDF 的能力矩阵只声明了它）
  const text = await adapter.fetchContext({ ...req(), type: 'page_range' });

  assert.match(text, /共 5 页/);
  assert.equal(text.match(/--- 第 2 页 ---/g)?.length, 1, '第 2 页的页头出现且只出现一次');
  assert.match(text, /--- 第 3 页 ---/);
  assert.doesNotMatch(text, /--- 第 4 页 ---/, '只取请求的那两页');
  assert.match(text, /Page 2 title/);
  assert.match(text, /body of page 3/, '同一行的两块被拼成一行');
  assert.ok(text.indexOf('--- 第 2 页 ---') < text.indexOf('--- 第 3 页 ---'), '页序不能乱');
});

test('fetchContext：页头格式就是 S7 验收里的那个', () => {
  assert.equal(pageHeader(23), '--- 第 23 页 ---');
});

test('fetchContext：区间被夹到 [1, pageCount]，且完全越界时给一句人话', async () => {
  const adapter = adapterWith(fakeSource());

  const clamped = await adapter.fetchContext({ ...req(), type: 'page_range', params: { path: '/a.pdf', start: 1, end: 999 } });
  assert.match(clamped, /--- 第 5 页 ---/, '上界被夹到最后一页');
  assert.doesNotMatch(clamped, /--- 第 6 页 ---/);

  const empty = await adapter.fetchContext({ ...req(), type: 'page_range', params: { path: '/a.pdf', start: 9, end: 12 } });
  assert.match(empty, /没有内容/);
});

test('fetchContext：空白页也给页头，不让后面几页整体错位', async () => {
  const blank: PDFSource = {
    pageCount: 3,
    page: (page) => Promise.resolve({ page, text: '', items: [], viewport: { width: 1, height: 1 } }),
    dispose() {},
  };
  const text = await adapterWith(blank).fetchContext({ ...req(), type: 'page_range', params: { path: '/a.pdf', start: 1, end: 3 } });

  assert.equal(text.match(/--- 第 \d 页 ---/g)?.length, 3, '三页三个页头');
  assert.match(text, /没有文字层/);
});

test('fetchContext：参数不完整直接抛 CONTEXT_REJECTED（不静默返回空串）', async () => {
  await assert.rejects(
    () => adapterWith(fakeSource()).fetchContext({ ...req(), type: 'page_range', params: { path: '/a.pdf' } }),
    (err: unknown) => (err as { code?: string }).code === 'CONTEXT_REJECTED',
  );
});

test('pageCount：打不开时返回 null（让 §3.3 跳过上界检查，而不是让讲解失败）', async () => {
  const adapter = createPdfAdapter({ cache: createPdfDocumentCache(() => Promise.reject(new Error('ENOENT'))) });
  assert.equal(await adapter.pageCount('/nope.pdf'), null);
});

test('缓存：同一路径只打开一次；**淘汰时必须释放句柄**', async () => {
  const sources: ReturnType<typeof fakeSource>[] = [];
  const cache = createPdfDocumentCache(() => {
    const s = fakeSource();
    sources.push(s);
    return Promise.resolve(s);
  }, { limit: 2 });

  await cache.acquire('/a.pdf');
  await cache.acquire('/a.pdf');
  assert.equal(sources.length, 1, '同一路径复用同一句柄');
  assert.equal(cache.size(), 1);

  await cache.acquire('/b.pdf');
  await cache.acquire('/c.pdf'); // 撑爆 limit=2
  assert.equal(cache.size(), 2, '上限生效');
  assert.equal(sources.length, 3);
  assert.equal(sources[0]?.disposed, true, '最旧的被淘汰时**必须** dispose（不然就是内存泄漏）');
  assert.equal(sources[2]?.disposed, false, '最近用过的不能被淘汰');

  cache.disposeAll();
  assert.equal(sources.every((s) => s.disposed), true, 'disposeAll 要把每一个都放掉');
  assert.equal(cache.size(), 0);
});

test('缓存：并发要同一份时不重复打开', async () => {
  let opened = 0;
  const cache = createPdfDocumentCache(async () => {
    opened += 1;
    await new Promise((r) => setTimeout(r, 5));
    return fakeSource();
  });

  await Promise.all([cache.acquire('/a.pdf'), cache.acquire('/a.pdf'), cache.acquire('/a.pdf')]);
  assert.equal(opened, 1, '三个并发请求只该打开一次');
});

// ── 归一化与行拼接（纯函数） ────────────────────────────────────────────────

test('normalizeItems：PDF 用户空间 → 归一化，**y 要翻过来**', () => {
  const viewport = { width: 600, height: 800 };
  // 一个 12pt 的字块，基线在 y=800（页面顶部，PDF 的 y 从下往上）
  const items = normalizeItems([{ str: 'top', transform: [12, 0, 0, 12, 60, 788], width: 60, height: 12 }], viewport);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.x, 0.1, 'x 直接按宽度归一');
  assert.equal(items[0]?.y, 0, 'y=788+12=800 是页面顶端 → 归一化后 0（从上往下）');
  assert.ok(Math.abs((items[0]?.height ?? 0) - 0.015) < 1e-9);

  // 页面底部的字块 → 归一化后接近 1
  const bottom = normalizeItems([{ str: 'bottom', transform: [12, 0, 0, 12, 60, 0], width: 60, height: 12 }], viewport);
  assert.ok((bottom[0]?.y ?? 0) > 0.98, '最底下的字块 y 应接近 1');
});

test('normalizeItems：丢掉空白项与坏坐标（pdf.js 会用空串项承载换行标记）', () => {
  const viewport = { width: 100, height: 100 };
  const items = normalizeItems(
    [
      { str: '', transform: [1, 0, 0, 1, 10, 10], width: 0, height: 0 },
      { str: '   ', transform: [1, 0, 0, 1, 10, 10], width: 0, height: 0 },
      { str: 'ok', transform: [1, 0, 0, 1, 10, 90], width: 5, height: 5 },
      { str: 'bad', transform: [1, 0, 0, 1, Number.NaN, 90], width: 5, height: 5 },
    ],
    viewport,
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]?.text, 'ok');
});

test('normalizeItems：viewport 尺寸为 0（页面还没渲染）→ 空数组，不是 NaN 坐标', () => {
  assert.deepEqual(normalizeItems([{ str: 'x', transform: [1, 0, 0, 1, 10, 10], width: 5, height: 5 }], { width: 0, height: 0 }), []);
});

test('joinLines：同一行拼一行，不同行补换行', () => {
  const items = [
    { text: 'first line', x: 0.1, y: 0.1, width: 0.3, height: 0.02 },
    { text: 'second line', x: 0.1, y: 0.2, width: 0.3, height: 0.02 },
  ];
  assert.equal(joinLines(items), 'first line\nsecond line');
});

test('joinLines：英文之间补空格、中文之间不补（否则中文会被切成"这 一段 话"）', () => {
  const en = [
    { text: 'Hello', x: 0.1, y: 0.1, width: 0.1, height: 0.02 },
    { text: 'world', x: 0.21, y: 0.1, width: 0.1, height: 0.02 },
  ];
  assert.equal(joinLines(en), 'Hello world');

  const zh = [
    { text: '这一段', x: 0.1, y: 0.1, width: 0.1, height: 0.02 },
    { text: '话', x: 0.21, y: 0.1, width: 0.05, height: 0.02 },
  ];
  assert.equal(joinLines(zh), '这一段话');

  // 已经带空格的别叠一个
  const spaced = [
    { text: 'Hello ', x: 0.1, y: 0.1, width: 0.1, height: 0.02 },
    { text: ' world', x: 0.21, y: 0.1, width: 0.1, height: 0.02 },
  ];
  assert.equal(joinLines(spaced), 'Hello  world');
});

test('readingOrder：先上后下、再左到右（y 差小于容差算同一行）', () => {
  const items = [
    { text: 'b', x: 0.5, y: 0.1, width: 0.05, height: 0.02 },
    { text: 'a', x: 0.1, y: 0.1005, width: 0.05, height: 0.02 },
    { text: 'c', x: 0.1, y: 0.3, width: 0.05, height: 0.02 },
  ];
  assert.deepEqual(readingOrder(items).map((i) => i.text), ['a', 'b', 'c']);
});

// ── bbox → 文本（第二层） ──────────────────────────────────────────────────

test('textInBBox：命中框里的文字，按阅读顺序、行间补换行', () => {
  const items = [
    { text: '标题行', x: 0.1, y: 0.1, width: 0.4, height: 0.05 },
    { text: '正文第一行', x: 0.1, y: 0.3, width: 0.6, height: 0.04 },
    { text: '正文第二行', x: 0.1, y: 0.36, width: 0.6, height: 0.04 },
    { text: '页脚', x: 0.4, y: 0.95, width: 0.2, height: 0.02 },
  ];

  assert.equal(textInBBox(items, [0.05, 0.28, 0.75, 0.42]), '正文第一行\n正文第二行', '只命中正文两行');
  assert.equal(textInBBox(items, [0.05, 0.05, 0.9, 0.99]), '标题行\n正文第一行\n正文第二行\n页脚');
  assert.equal(textInBBox(items, [0.8, 0.8, 0.9, 0.9]), '', '框在空白处 → 空串');
});

test('textInBBox：按**文字块自身的比例**判命中，不是按框的面积', () => {
  const items = [
    { text: '整块', x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
    { text: '只擦到一点', x: 0.1, y: 0.3, width: 0.2, height: 0.1 },
  ];
  // 大框从上往下擦过第二块的顶边一点点：按框面积算会把它吸进来，按自身比例算不会
  const hit = itemsInBBox(items, [0.05, 0.05, 0.9, 0.302]);
  assert.deepEqual(hit.map((i) => i.text), ['整块'], '只有第一块被完全包住');

  // 块自身被盖住超过阈值就算命中
  const partial = itemsInBBox(items, [0.1, 0.1, 0.3, 0.36]);
  assert.deepEqual(partial.map((i) => i.text), ['整块', '只擦到一点'], '第二块被盖住 60% > 阈值 50%');
  assert.ok(HIT_RATIO > 0 && HIT_RATIO <= 1);
});

test('adapter.textInBBox：命中不到返回 null（扫描件是正常情况，不是故障）', async () => {
  const adapter = adapterWith(fakeSource());
  const hit = await adapter.textInBBox('/docs/a.pdf', 2, [0.05, 0.05, 0.9, 0.2]);
  assert.equal(hit, 'Page 2 title');

  assert.equal(await adapter.textInBBox('/docs/a.pdf', 2, [0.8, 0.8, 0.9, 0.9]), null);
  assert.equal(await adapter.textInBBox('/docs/a.pdf', 99, [0, 0, 1, 1]), null, '页号越界 → null');
});

// ── 真解析（一条，验坐标系换算） ───────────────────────────────────────────

test('真 fixture：30 页、第 23 页能取到文字、bbox 能命中', async () => {
  const cache = createPdfDocumentCache(openPdfJsSource);
  const adapter = createPdfAdapter({ cache });

  try {
    assert.equal(await adapter.pageCount(FIXTURE), 30, 'fixture 是 30 页');

    const text = await adapter.fetchContext({
      type: 'page_range',
      params: { path: FIXTURE, start: 22, end: 24 },
      reason: 'S7 验收：取附近页',
    });
    assert.match(text, /--- 第 22 页 ---/);
    assert.match(text, /--- 第 23 页 ---/);
    assert.match(text, /--- 第 24 页 ---/);
    assert.match(text, /Page 23 \/ 30/u, '第 23 页的标题在结果里');

    // bbox 命中：整个上半页（pdf.js 的坐标换算对不对，只有真数据说了算）
    const hit = await adapter.textInBBox(FIXTURE, 23, [0, 0, 1, 0.2]);
    assert.ok(hit, '上半页应该有字');
    assert.match(hit, /Page 23 \/ 30/u);

    // 命中不到的地方（右下角空白）
    assert.equal(await adapter.textInBBox(FIXTURE, 23, [0.7, 0.9, 1, 1]), null);
  } finally {
    cache.disposeAll();
  }
});
