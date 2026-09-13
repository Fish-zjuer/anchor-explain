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
import type {
  ContextFetchPolicy,
  ContextFetchState,
  FetchedSpan,
} from '../src/orchestrator/validateContextRequest.ts';

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
    validateContextRequest(fileReq({ path: CODE_FILE, start: 20, end: 75 }), codeAnchor(), state()).accepted,
    true,
    '恰好到末行应放行',
  );
  assert.equal(
    validateContextRequest(fileReq({ path: CODE_FILE, start: 20, end: 76 }), codeAnchor(), state()).accepted,
    false,
    '越过末行应拒绝（这是关于这份文件的**事实错误**，说清总行数比默默给它 20-75 更有用）',
  );
  // 行数取不到（null）→ 跳过**上界**检查，而不是跳过整条校验
  assert.equal(
    validateContextRequest(fileReq({ path: CODE_FILE, start: 1, end: 50 }), codeAnchor(), state({ documentLineCount: null })).accepted,
    true,
  );
});

test('D71：单次行数超上限 → **截到上限照常给**，不再整条拒绝（被拒那一轮是白烧的）', () => {
  const policy: ContextFetchPolicy = { scope: 'related', roots: ['C:\\repo'], maxLines: 30 };
  // **别的文件**：行数信息我们拿不到（同步纯函数），所以它只受单次上限管 —— 要 999 行就给 30 行
  const foreign = validateContextRequest(
    fileReq({ path: 'ring_buffer.h', start: 10, end: 999 }),
    codeAnchor(),
    state({ policy }),
  );
  assert.equal(foreign.accepted, true, '要多了不该整条拒 —— 给得起的那一段照给');
  assert.equal(
    foreign.accepted === true ? foreign.request.params.end : null,
    39,
    '放行的请求写的是**截断后**的末行（10 + 30 - 1）：日志、去重、适配器读的区间都靠它',
  );
  assert.equal(
    foreign.accepted === true ? String(foreign.request.params.path) : '',
    'C:/repo/test/fixtures/ring_buffer.h',
    '路径同时也被归一化了',
  );

  // 锚点文件同理（10-75 是 66 行 > 30）：也截到 10-39
  const anchorClamp = validateContextRequest(
    fileReq({ path: CODE_FILE, start: 10, end: 75 }),
    codeAnchor(),
    state({ policy }),
  );
  assert.equal(anchorClamp.accepted === true ? anchorClamp.request.params.end : null, 39);

  // 没超上限时一个字节都不动
  const ok = validateContextRequest(fileReq({ path: CODE_FILE, start: 10, end: 20 }), codeAnchor(), state({ policy }));
  assert.equal(ok.accepted === true ? ok.request.params.end : null, 20);

  // 去重比的是**真正读到的**区间：截断到 10-39 之后，再要同一段才算重复
  const fetched: FetchedSpan[] = [
    { type: 'file', path: CODE_FILE, start: 10, end: 39, content: '旧内容' },
  ];
  const again = validateContextRequest(
    fileReq({ path: CODE_FILE, start: 10, end: 75 }),
    codeAnchor(),
    state({ policy, fetched }),
  );
  assert.equal(again.accepted, false, '同一段（截断后）再来一次应判重复');
  assert.match(again.accepted === false ? again.reason : '', /已经取过了/);
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

// ─────────────────────────────────────────────────────────────
// S9a：跨文件取件的三条边界（related / same-dir / off）与黑名单
// ─────────────────────────────────────────────────────────────

const RELATED = { scope: 'related' as const, roots: ['C:/repo'], maxLines: 60 };

test('S9a related：允许读工作区里的**另一个文件**，并且 path 被归一成绝对路径', () => {
  const r = validateContextRequest(
    fileReq({ path: 'ring_buffer.h', start: 1, end: 20 }),
    codeAnchor(),
    state({ policy: RELATED }),
  );
  assert.equal(r.accepted, true);
  // 相对路径按**锚点文件所在目录**解析（`C:\repo\test\fixtures` + `ring_buffer.h`）
  assert.equal(
    r.accepted === true ? r.request.params.path : null,
    'C:/repo/test/fixtures/ring_buffer.h',
  );
});

test('S9a related：工作区外的路径、以及密钥/依赖/构建产物一律拒（并说清是哪一类）', () => {
  const cases: [string, RegExp][] = [
    ['C:/elsewhere/x.h', /不在允许的范围内/],
    ['../../../etc/passwd', /不在允许的范围内/],
    ['.env', /按约定不读/],
    ['node_modules/foo/index.js', /不在允许的范围内|按约定不读/],
    ['../../.ssh/id_rsa', /不在允许的范围内|按约定不读/],
  ];
  for (const [path, expected] of cases) {
    const r = validateContextRequest(
      fileReq({ path, start: 1, end: 5 }),
      codeAnchor(),
      state({ policy: RELATED }),
    );
    assert.equal(r.accepted, false, path);
    assert.match(r.accepted === false ? r.reason : '', expected, path);
  }
});

test('S9a same-dir：只允许锚点所在目录（跨目录的直接拒）', () => {
  const policy = { scope: 'same-dir' as const, roots: ['C:/repo/test/fixtures'], maxLines: 60 };
  assert.equal(
    validateContextRequest(fileReq({ path: 'ring_buffer.h', start: 1, end: 5 }), codeAnchor(), state({ policy }))
      .accepted,
    true,
    '同目录应放行',
  );
  // 跨目录：连候选都产不出来（root 就是锚点目录），所以理由是"不在允许范围内"——
  // 这正是同目录模式想要的效果：`../inc/...` 这种写法在这里一定走不通
  const out = validateContextRequest(
    fileReq({ path: '../inc/rb.h', start: 1, end: 5 }),
    codeAnchor(),
    state({ policy }),
  );
  assert.equal(out.accepted, false);
  assert.match(out.accepted === false ? out.reason : '', /不在允许的范围内/);
});

test('S9a off：策略缺省就是 off，行为与 S1~S8 完全一致（回退档）', () => {
  const roam = validateContextRequest(
    fileReq({ path: 'C:/repo/other.c', start: 1, end: 5 }),
    codeAnchor(),
    state(),
  );
  assert.equal(roam.accepted, false);
  assert.match(roam.accepted === false ? roam.reason : '', /只允许取锚点所在的文件/);
});

test('S9a 去重按**解析后的文件**比对：同一个文件换个写法也绕不过去重', () => {
  const fetched: FetchedSpan[] = [
    { type: 'file', path: 'C:/repo/test/fixtures/ring_buffer.h', start: 1, end: 20, content: '旧内容' },
  ];
  const again = validateContextRequest(
    fileReq({ path: 'ring_buffer.h', start: 5, end: 10 }),
    codeAnchor(),
    state({ policy: RELATED, fetched }),
  );
  assert.equal(again.accepted, false, '同一个文件（不同写法）的区间重叠应判重复');
  assert.match(again.accepted === false ? again.reason : '', /已经取过了/);
  // 跨文件之后这条文案**必须说清是哪个文件**（D68：用户的截图里就是"1-60 这个区间"，
  // 读起来像在说锚点文件；模糊的指认会把模型和看日志的人一起带偏）
  assert.match(again.accepted === false ? again.reason : '', /ring_buffer\.h 的 1-20 行/, '要说清哪个文件的哪几行');
  assert.equal(again.accepted === false ? again.content : '', '旧内容', '并把上次的内容回灌');
});

test('D68 去重文案：PDF 用页码指认，不用文件名', () => {
  const pdfState = state({
    capabilities: { contextTypes: ['page_range'], maxSpan: 10 },
    pageCount: 30,
    fetched: [{ type: 'page_range', path: null, start: 3, end: 5, content: '旧内容' }],
  });
  const again = validateContextRequest(
    { type: 'page_range', params: { start: 4, end: 6 }, reason: '再看一眼' },
    pdfAnchor(),
    pdfState,
  );
  assert.equal(again.accepted, false);
  assert.match(again.accepted === false ? again.reason : '', /第 3-5 页/);
});
