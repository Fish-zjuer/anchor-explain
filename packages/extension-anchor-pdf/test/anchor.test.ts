/**
 * 线2 的框选几何与消息守卫。
 *
 * @anchor 这个文件是 S5 唯一有对错的部分。拖拽手感只能靠人手确认，但
 *         **"这块落在哪一页、占那一页的百分之几"是算出来的** ——
 *         页容器有 padding、有缩放、有滚动偏移，肉眼判不出算错两三个像素还是算反了。
 *         所以注入脚本一行业务数学都不做，全部压到这里来测。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPDFLocation, isValidBBox } from '@anchor/core';
import {
  intersectRects,
  pickDominantPage,
  rectArea,
  rectToNormalizedBBox,
  resolveSelection,
} from '../src/anchor/rectToNormalizedBBox.ts';
import type { PageRect, PixelRect } from '../src/anchor/rectToNormalizedBBox.ts';
import { parseSelectMessage } from '../src/anchor/bridge.ts';
import { buildPdfAnchor, describePdfAnchor } from '../src/anchor/captureAnchor.ts';

const at = (x: number, y: number, width: number, height: number): PixelRect => ({ x, y, width, height });

test('intersectRects：不相交返回 null（不是零面积矩形）', () => {
  assert.deepEqual(intersectRects(at(0, 0, 10, 10), at(5, 5, 10, 10)), at(5, 5, 5, 5));
  assert.equal(intersectRects(at(0, 0, 10, 10), at(10, 0, 5, 5)), null, '刚好挨着不算相交');
  assert.equal(intersectRects(at(0, 0, 10, 10), at(50, 50, 5, 5)), null);
  assert.equal(rectArea(at(0, 0, 3, 4)), 12);
});

test('pickDominantPage：取交叠面积最大的那一页', () => {
  const pages: PageRect[] = [
    { page: 1, rect: at(0, 0, 100, 100) },
    { page: 2, rect: at(0, 120, 100, 100) },
  ];

  assert.equal(pickDominantPage(at(10, 10, 20, 20), pages)?.page, 1);
  assert.equal(pickDominantPage(at(10, 130, 20, 20), pages)?.page, 2);

  // 跨页拖：从第 1 页底部一路拖到第 2 页里 —— 第 2 页盖得多，判给第 2 页
  // （刻意做成不对称：y 80..160 对第 1 页占 20、对第 2 页占 40）
  const spanning = pickDominantPage(at(10, 80, 40, 80), pages);
  assert.equal(spanning?.page, 2, '跨页时按面积判，不是按起点');

  // 对称地跨在页缝上时应当**平局**，此时取页号小的那个（行为可预期，已在下一条断言）
  const splitEvenly = pickDominantPage(at(10, 80, 40, 60), pages);
  assert.equal(splitEvenly?.page, 1, '两边一样多时取页号小的那个');

  // 页缝里（两页之间 100-120 那段空白）
  assert.equal(pickDominantPage(at(10, 105, 20, 5), pages), null, '拖在页外/页缝上应判不出来');

  // 面积相同 → 保留先出现的那一页，行为可预期
  const tie: PageRect[] = [
    { page: 7, rect: at(0, 0, 100, 100) },
    { page: 8, rect: at(100, 0, 100, 100) },
  ];
  assert.equal(pickDominantPage(at(60, 10, 80, 20), tie)?.page, 7, '面积相同时取页号小的那个');
});

test('rectToNormalizedBBox：归一化到该页内部，且四项都在 [0,1]', () => {
  const page = at(100, 200, 400, 800); // 页容器在屏幕上的位置与尺寸
  const dragged = at(200, 400, 100, 200);

  const bbox = rectToNormalizedBBox(dragged, page);
  assert.ok(bbox);
  // 横向：(200-100)/400 = 0.25 → (300-100)/400 = 0.5
  assert.deepEqual(bbox, [0.25, 0.25, 0.5, 0.5]);
  assert.ok(isValidBBox(bbox), '产出的框必须通过 core 的 isValidBBox（非退化 + 四项在 [0,1]）');
});

test('rectToNormalizedBBox：**先裁到页内再归一**（用户会从页外拖进来、也会拖出页外）', () => {
  const page = at(100, 200, 400, 800);

  const fromOutside = rectToNormalizedBBox(at(0, 0, 300, 400), page);
  assert.deepEqual(fromOutside, [0, 0, 0.5, 0.25], '从页外左下拖进来，应从页边缘起算');

  const beyondPage = rectToNormalizedBBox(at(400, 900, 500, 500), page);
  assert.deepEqual(beyondPage, [0.75, 0.875, 1, 1], '拖出页外应裁到页边缘（1.0，不是 1.5）');
});

test('rectToNormalizedBBox：退化情形返回 null，而不是零面积框', () => {
  assert.equal(rectToNormalizedBBox(at(10, 10, 20, 20), at(0, 0, 0, 0)), null, '页容器尺寸为 0');
  assert.equal(rectToNormalizedBBox(at(10, 10, 20, 20), at(0, 0, 100, 0)), null, '页容器高度为 0（还没渲染出来）');
  assert.equal(rectToNormalizedBBox(at(500, 500, 10, 10), at(0, 0, 100, 100)), null, '完全在页外');
  assert.equal(rectToNormalizedBBox(at(10, 10, 0, 30), at(0, 0, 100, 100)), null, '零宽度（误触）');
});

test('resolveSelection：一次算完"哪一页 + 归一化框"', () => {
  const pages: PageRect[] = [
    { page: 1, rect: at(0, 0, 100, 100) },
    { page: 2, rect: at(0, 120, 100, 100) },
  ];
  assert.deepEqual(resolveSelection(at(10, 130, 50, 50), pages), { page: 2, bbox: [0.1, 0.1, 0.6, 0.6] });
  assert.equal(resolveSelection(at(10, 105, 20, 5), pages), null);
});

// ── §5.2 消息守卫 ──────────────────────────────────────────────────────────

test('parseSelectMessage：三种合法消息', () => {
  assert.deepEqual(parseSelectMessage({ type: 'anchor:ready' }), { type: 'anchor:ready' });
  assert.deepEqual(parseSelectMessage({ type: 'anchor:cancelled' }), { type: 'anchor:cancelled' });

  const captured = parseSelectMessage({ type: 'anchor:captured', page: 3, bbox: [0.1, 0.2, 0.3, 0.4] });
  assert.equal(captured?.type, 'anchor:captured');
  assert.equal(captured?.type === 'anchor:captured' ? captured.page : null, 3);
});

test('parseSelectMessage：坏输入一律 null（注入脚本的输出和 AI 输出一样不可信）', () => {
  const cases: [unknown, string][] = [
    [null, 'null'],
    ['anchor:ready', '字符串'],
    [[], '数组'],
    [{}, '没有 type'],
    [{ type: 42 }, 'type 不是字符串'],
    [{ type: 'anchor:captured' }, '缺 page'],
    [{ type: 'anchor:captured', page: 0, bbox: [0, 0, 1, 1] }, 'page 为 0'],
    [{ type: 'anchor:captured', page: 1.5, bbox: [0, 0, 1, 1] }, 'page 非整数'],
    [{ type: 'anchor:captured', page: '3', bbox: [0, 0, 1, 1] }, 'page 是字符串'],
    [{ type: 'anchor:captured', page: 1 }, '缺 bbox'],
    [{ type: 'anchor:captured', page: 1, bbox: [0, 0, 1] }, 'bbox 只有三项'],
    [{ type: 'anchor:captured', page: 1, bbox: [0, 0, 0, 1] }, '零宽度 bbox（退化）'],
    [{ type: 'anchor:captured', page: 1, bbox: [0.5, 0.5, 0.5, 0.5] }, '点状 bbox（零面积）'],
    [{ type: 'anchor:captured', page: 1, bbox: [0, 0, Number.NaN, 1] }, 'NaN'],
    [{ type: 'anchor:captured', page: 1, bbox: [0, 0, 1, Number.POSITIVE_INFINITY] }, 'Infinity'],
    [{ type: 'anchor:captured', page: 1, bbox: ['0', '0', '1', '1'] }, 'bbox 是字符串'],
    [{ type: 'anchor:unknown' }, '未知类型'],
  ];
  for (const [input, what] of cases) {
    assert.equal(parseSelectMessage(input), null, `${what} 应被挡下`);
  }
});

test('parseSelectMessage：geometry 是可选的，带了就解析，坏了就当没带', () => {
  const good = parseSelectMessage({
    type: 'anchor:captured',
    page: 1,
    bbox: [0.1, 0.1, 0.2, 0.2],
    geometry: { dragged: { x: 1, y: 2, width: 3, height: 4 }, pages: [{ page: 1, rect: { x: 0, y: 0, width: 10, height: 10 } }] },
  });
  assert.equal(good?.type === 'anchor:captured' ? good.geometry?.pages.length : null, 1);

  const broken = parseSelectMessage({
    type: 'anchor:captured',
    page: 1,
    bbox: [0.1, 0.1, 0.2, 0.2],
    geometry: { dragged: { x: Number.NaN, y: 0, width: 1, height: 1 }, pages: [] },
  });
  assert.equal(broken?.type, 'anchor:captured', '几何坏了不该连整条消息一起丢掉');
  assert.equal(
    broken?.type === 'anchor:captured' ? broken.geometry : 'had-geometry',
    undefined,
    '坏几何 = 当作没带，宿主会退回用 bbox',
  );

  // 只有老式的 page+bbox（没有 geometry）也要能过：§5.2 的冻结形状不能被 S5 的追加字段破坏
  const legacy = parseSelectMessage({ type: 'anchor:captured', page: 9, bbox: [0.1, 0.1, 0.9, 0.9] });
  assert.equal(legacy?.type, 'anchor:captured');
  assert.equal(legacy?.type === 'anchor:captured' ? legacy.page : null, 9);
});

// ── Anchor 组装 ────────────────────────────────────────────────────────────

test('buildPdfAnchor：产出的是一个合法 PDF 锚点，且 sourceId 有退化路径', () => {
  const PDF = 'C:' + '\repo\test\fixtures\sample-30p.pdf';
  const anchor = buildPdfAnchor({
    filePath: PDF,
    sourceName: 'sample-30p.pdf',
    sourceId: 'sha1:abc',
    page: 23,
    bbox: [0.1, 0.2, 0.5, 0.6],
  });

  assert.equal(anchor.sourceType, 'pdf');
  assert.equal(anchor.sourceId, 'sha1:abc');
  assert.equal(anchor.sourceName, 'sample-30p.pdf');
  assert.deepEqual(anchor.location, { page: 23, bbox: [0.1, 0.2, 0.5, 0.6], filePath: PDF });
  assert.equal(anchor.capturedImage, undefined, 'S5 不产图（第二层视觉兜底还没做）');

  const fallback = buildPdfAnchor({
    filePath: '/tmp/a.pdf',
    sourceName: 'a.pdf',
    sourceId: null,
    page: 1,
    bbox: [0, 0, 1, 1],
  });
  assert.equal(fallback.sourceId, '/tmp/a.pdf', '没有指纹时退化成路径，而不是让框选失败');
});

test('buildPdfAnchor 带上 filePath 是**必须**的（S7）：线1 要靠它去读文件取件', () => {
  const anchor = buildPdfAnchor({
    filePath: '/docs/spec.pdf',
    sourceName: 'spec.pdf',
    sourceId: 'sha1:z',
    page: 2,
    bbox: [0.1, 0.1, 0.2, 0.2],
  });
  const loc = anchor.location;
  assert.ok(isPDFLocation(loc));
  assert.equal(loc.filePath, '/docs/spec.pdf', '没有它，线1 只说得出"第 2 页的哪一块"，说不出"哪一份"');
});

test('describePdfAnchor：把 bbox 说成人话（线2 不画框，位置只能用文字交代）', () => {
  const anchor = buildPdfAnchor({
    filePath: '/tmp/a.pdf',
    sourceName: 'a.pdf',
    sourceId: 'x',
    page: 23,
    bbox: [0.123, 0.078, 0.48, 0.22],
  });
  const line = describePdfAnchor(anchor);
  assert.match(line, /a\.pdf/);
  assert.match(line, /第 23 页/);
  assert.match(line, /横向 12%–48%/);
  assert.match(line, /纵向 8%–22%/);
});
