/**
 * §3.2 取件校验的单测。**五条规则各有一条对应的测试，一条不少。**
 *
 * @anchor 这是"模型不许漫游"的唯一闸门，所以它值得比别的纯函数测得更细：
 *         规则 3 一旦松掉，模型顺着一次 tool_call 就能读到仓库里任意文件；
 *         规则 5 一旦松掉，一次讲解可能打十几次网络请求。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AdapterCapabilities, Anchor, ContextRequest } from '@anchor/core';
import { validateContextRequest } from '../src/orchestrator/validateContextRequest.ts';
import type { ContextFetchState, FetchedSpan } from '../src/orchestrator/validateContextRequest.ts';

const CODE_FILE = 'C:\\repo\\test\\fixtures\\main.c';

/** 线1 的能力：只支持 file，与 §3.1 的能力矩阵一致 */
const CODE_CAPS: AdapterCapabilities = { contextTypes: ['file'], maxSpan: 5 };
/** 线2 的能力 */
const PDF_CAPS: AdapterCapabilities = { contextTypes: ['page_range'], maxSpan: 5 };

function codeAnchor(filePath = CODE_FILE): Anchor {
  return {
    sourceType: 'code',
    sourceId: 'sha1:x',
    sourceName: 'main.c',
    location: { filePath, lineStart: 40, lineEnd: 48 },
    extractedText: 'x',
  };
}

function pdfAnchor(): Anchor {
  return {
    sourceType: 'pdf',
    sourceId: 'sha1:y',
    sourceName: 'sample.pdf',
    location: { page: 23, bbox: [0.1, 0.1, 0.5, 0.5] },
  };
}

function state(over: Partial<ContextFetchState> = {}): ContextFetchState {
  return {
    capabilities: CODE_CAPS,
    pageCount: null,
    documentLineCount: 75,
    fetched: [],
    roundsUsed: 0,
    maxFetchRounds: 3,
    ...over,
  };
}

const fileReq = (params: Record<string, unknown>, reason = '看不全'): ContextRequest => ({
  type: 'file',
  params,
  reason,
});

test('规则 1：类型必须在该适配器声明的能力里', () => {
  // 线1 不支持按页取件
  const r = validateContextRequest(
    { type: 'page_range', params: { start: 1, end: 2 }, reason: 'x' },
    codeAnchor(),
    state(),
  );
  assert.equal(r.accepted, false);
  assert.match(r.accepted === false ? r.reason : '', /只支持 file/);

  // 反向：线2 不支持按文件取件
  const r2 = validateContextRequest(fileReq({ path: CODE_FILE, start: 1, end: 2 }), pdfAnchor(), state({ capabilities: PDF_CAPS, pageCount: 30 }));
  assert.equal(r2.accepted, false);
  assert.match(r2.accepted === false ? r2.reason : '', /只支持 page_range/);
});

test('规则 2：页码范围、整数性、页跨度', () => {
  const page = (start: number, end: number) =>
    validateContextRequest({ type: 'page_range', params: { start, end }, reason: 'x' }, pdfAnchor(), state({ capabilities: PDF_CAPS, pageCount: 30 }));

  assert.equal(page(10, 12).accepted, true);
  assert.equal(page(10, 40).accepted, false, '越过总页数应拒绝');
  assert.equal(page(0, 2).accepted, false, '0 页应拒绝');
  assert.equal(page(2, 1).accepted, false, '区间反了应拒绝');
  assert.equal(page(1, 6).accepted, false, '超过 maxSpan=5 应拒绝');
  assert.equal(page(1, 5).accepted, true, '恰好 maxSpan 页应放行');

  const fractional = validateContextRequest(
    { type: 'page_range', params: { start: 1.5, end: 2 }, reason: 'x' },
    pdfAnchor(),
    state({ capabilities: PDF_CAPS, pageCount: 30 }),
  );
  assert.equal(fractional.accepted, false, '非整数页码应拒绝');

  const unknownCount = validateContextRequest(
    { type: 'page_range', params: { start: 1, end: 2 }, reason: 'x' },
    pdfAnchor(),
    state({ capabilities: PDF_CAPS, pageCount: null }),
  );
  assert.equal(unknownCount.accepted, false, '不知道总页数时不能盲放');
});

test('规则 3：file 只能取锚点所在的那个文件（这条是主要理由）', () => {
  const ok = validateContextRequest(fileReq({ path: CODE_FILE, start: 1, end: 10 }), codeAnchor(), state());
  assert.equal(ok.accepted, true);

  const roam = validateContextRequest(fileReq({ path: 'C:\\repo\\src\\secrets.ts', start: 1, end: 10 }), codeAnchor(), state());
  assert.equal(roam.accepted, false, '模型不许漫游到别的文件');
  assert.match(roam.accepted === false ? roam.reason : '', /只允许取锚点所在的文件/);

  // 大小写/斜杠方向不算漫游：Windows 上严格比较会把同一个文件判成两个
  assert.equal(
    validateContextRequest(fileReq({ path: CODE_FILE.replace(/\\/g, '/').toUpperCase(), start: 1, end: 10 }), codeAnchor(), state()).accepted,
    true,
  );
});

test('规则 3：没给 path 等于"就要锚点这个文件"，放行时补上（§8 的 schema 里没有 path）', () => {
  // §8 的工具 schema 只声明了 request_type / start / end / reason，
  // 所以模型完全可能不给 path。丢掉这种情况会让 file 取件永远走不通 —— S3 踩过。
  const r = validateContextRequest(fileReq({ start: 1, end: 10 }), codeAnchor(), state());
  assert.equal(r.accepted, true);
  assert.equal(
    r.accepted === true ? r.request.params.path : undefined,
    CODE_FILE,
    '放行时要归一化成完整请求，好让适配器直接可用',
  );
});

test('规则 3 补：行上界（§3.2 原文只冻结了 path，行边界是 S3 的实现约定）', () => {
  assert.equal(
    validateContextRequest(fileReq({ path: CODE_FILE, start: 1, end: 75 }), codeAnchor(), state()).accepted,
    true,
    '恰好到末行应放行',
  );
  assert.equal(
    validateContextRequest(fileReq({ path: CODE_FILE, start: 1, end: 76 }), codeAnchor(), state()).accepted,
    false,
    '越过末行应拒绝',
  );
  // 行数取不到（null）→ 跳过上界检查，而不是跳过整条校验
  assert.equal(
    validateContextRequest(fileReq({ path: CODE_FILE, start: 1, end: 9999 }), codeAnchor(), state({ documentLineCount: null })).accepted,
    true,
  );
});

test('规则 4：区间重叠不重复取，改把已有内容回灌', () => {
  const cached: FetchedSpan = { type: 'file', path: CODE_FILE, start: 1, end: 10, content: '早就取过了' };
  const st = state({ fetched: [cached], roundsUsed: 1 });

  const overlap = validateContextRequest(fileReq({ path: CODE_FILE, start: 5, end: 15 }), codeAnchor(), st);
  assert.equal(overlap.accepted, false);
  assert.equal(overlap.accepted === false ? overlap.content : undefined, '早就取过了', '要把已取内容一并回灌');

  // 不重叠就是新的一次取件
  assert.equal(
    validateContextRequest(fileReq({ path: CODE_FILE, start: 20, end: 25 }), codeAnchor(), st).accepted,
    true,
  );

  // 相邻但不重叠（10 与 11）不算重复
  assert.equal(
    validateContextRequest(fileReq({ path: CODE_FILE, start: 11, end: 12 }), codeAnchor(), st).accepted,
    true,
  );
});

test('规则 5：取件次数上限', () => {
  const full = state({ roundsUsed: 3, maxFetchRounds: 3 });
  const r = validateContextRequest(fileReq({ path: CODE_FILE, start: 1, end: 10 }), codeAnchor(), full);
  assert.equal(r.accepted, false);
  assert.match(r.accepted === false ? r.reason : '', /已达上限/);

  assert.equal(
    validateContextRequest(fileReq({ path: CODE_FILE, start: 1, end: 10 }), codeAnchor(), state({ roundsUsed: 2, maxFetchRounds: 3 })).accepted,
    true,
    '还没到上限就该放行',
  );
});

test('顺序：**去重先于频率** —— 轮数用尽时也要把已取内容回灌一次', () => {
  const cached: FetchedSpan = { type: 'file', path: CODE_FILE, start: 1, end: 10, content: '旧内容' };
  const exhausted = state({ fetched: [cached], roundsUsed: 3, maxFetchRounds: 3 });

  const r = validateContextRequest(fileReq({ path: CODE_FILE, start: 3, end: 8 }), codeAnchor(), exhausted);
  assert.equal(r.accepted, false);
  assert.equal(
    r.accepted === false ? r.content : undefined,
    '旧内容',
    '两条规则都命中时，去重的内容比一句"已达上限"对模型有用得多，且不花成本',
  );
});

test('dom_subtree：本次不实现，明说而不是静默放行', () => {
  const r = validateContextRequest(
    { type: 'dom_subtree', params: { start: 1, end: 2 }, reason: 'x' },
    codeAnchor(),
    state({ capabilities: { contextTypes: ['dom_subtree'], maxSpan: 5 } }),
  );
  assert.equal(r.accepted, false);
});

test('start / end 缺失或非正整数一律拒绝，且拒绝原因里带上实际值', () => {
  const r = validateContextRequest(fileReq({ path: CODE_FILE }), codeAnchor(), state());
  assert.equal(r.accepted, false);
  assert.match(r.accepted === false ? r.reason : '', /start=undefined/);
});
