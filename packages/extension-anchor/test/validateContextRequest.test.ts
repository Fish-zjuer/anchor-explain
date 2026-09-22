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
import { validateContextRequest, describeFetched, relatedRoots } from '../src/orchestrator/validateContextRequest.ts';
import type {
  ContextFetchPolicy,
  ContextFetchState,
  FetchedSpan,
} from '../src/orchestrator/validateContextRequest.ts';
import type { CandidateFile } from '../src/relatedFiles.ts';

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

function pdfAnchor(filePath: string = 'C:/repo/docs/sample.pdf'): Anchor {
  return {
    sourceType: 'pdf',
    sourceId: 'sha1:y',
    sourceName: 'sample.pdf',
    location: { page: 23, bbox: [0.1, 0.1, 0.5, 0.5], filePath },
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

/**
 * 清单里的一条（S9a-fix10）。**`related` / `same-dir` 档下清单就是可取范围**：
 * 只有清单里的文件取得动，清单外的一律拒（这正是 D119 要立起来的东西）。
 */
function cand(path: string): CandidateFile {
  // 标签取末三段：真实实现用的是"相对工作区根"的写法（天然唯一），这里取末三段同样唯一 ——
  // 唯一性是必须的，否则 `findCandidate` 的后缀匹配会判"对上多条"（那是给模型截太短用的分支）。
  return { path, label: path.split('/').slice(-3).join('/') };
}

/**
 * 一个"这次能取这几个文件"的策略。
 *
 * @anchor 为什么测试也要跟着改成"必须先有清单"：旧契约下 `roots` 一个人说了算，
 *         清单只是提示；新契约把两者并成一件事。测试若还按旧写法摆（只给 roots 不给清单），
 *         测到的就是一条**产品里不会出现**的组合 —— 那种测试绿着也没有意义。
 */
function listPolicy(
  scope: 'related' | 'same-dir',
  roots: readonly string[],
  paths: readonly string[],
  maxLines = 400,
): ContextFetchPolicy {
  return { scope, roots, maxLines, candidates: paths.map((p) => cand(p)) };
}

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
  // D74：这条拒绝对模型是"别请求了"，对**人**却是唯一的线索 ——
  // 它过去只说"无法确定总页数"，把原因指向那份 PDF 本身，而真正的原因（pdf.js 在产物里
  // 找不到 worker）在我们自己的输出通道里。所以它必须指出往哪看。
  assert.match(
    unknownCount.accepted === false ? unknownCount.reason : '',
    /输出面板/,
    '读不到页数时要说清往哪看（那一句才是能救人的）',
  );
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
  const policy = listPolicy('related', ['C:\\repo'], ['C:/repo/test/fixtures/ring_buffer.h'], 30);
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

const RELATED = listPolicy('related', ['C:/repo'], ['C:/repo/test/fixtures/ring_buffer.h'], 60);

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
    ['C:/elsewhere/x.h', /不在这次可取的清单里/],
    ['../../../etc/passwd', /不在这次可取的清单里/],
    // S9a-fix10：密钥/依赖/构建产物**根本不会进清单**（`buildCandidateFiles` 就滤掉了），
    // 所以模型撞到的是"清单里没有"这一句。两句话都在守同一件事，测试跟着实际行为走。
    ['.env', /不在这次可取的清单里|按约定不读/],
    ['node_modules/foo/index.js', /不在这次可取的清单里|按约定不读/],
    ['../../.ssh/id_rsa', /不在这次可取的清单里|按约定不读/],
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
  const policy = listPolicy('same-dir', ['C:/repo/test/fixtures'], ['C:/repo/test/fixtures/ring_buffer.h'], 60);
  assert.equal(
    validateContextRequest(fileReq({ path: 'ring_buffer.h', start: 1, end: 5 }), codeAnchor(), state({ policy }))
      .accepted,
    true,
    '同目录应放行',
  );
  // 跨目录：连清单里都不可能有它（root 就是锚点目录），所以理由是"清单里没有"——
  // 这正是同目录模式想要的效果：`../inc/...` 这种写法在这里一定走不通
  const out = validateContextRequest(
    fileReq({ path: '../inc/rb.h', start: 1, end: 5 }),
    codeAnchor(),
    state({ policy }),
  );
  assert.equal(out.accepted, false);
  assert.match(out.accepted === false ? out.reason : '', /不在这次可取的清单里/);
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

// ─────────────────────────────────────────────────────────────
// D117：范围算错的两种情形（用户实测那条报错）+ 第四档 `any`
//
// 起因：用户实测第 1 轮就被拒 —— `"../Inc/dshot_dma.h" 不在允许的范围内`，
// 而那个头文件**就在锚点文件的兄弟目录里**（源在 `Src/`、头在 `Inc/`，嵌入式最常见的形状）。
// 根因不在解析，在"范围"的定义：`related` 原来只有工作区根，而**锚点不在工作区里是常态**
// （用「打开文件」而不是「打开文件夹」、开发宿主窗口开在别的目录）——
// 那时锚点目录自己都不是根，连锚点旁边那个文件都读不到。
// ─────────────────────────────────────────────────────────────

/** 用户工程的实际形状：源在 `Src/`、头在兄弟目录 `Inc/` */
const FW_SRC = 'C:\\fw\\Driver\\dshot\\Src\\dshot_dma.c';

test('D117 related：锚点不在工作区里 → 范围退化成"锚点所在的这一层"（目录 + 上一层）', () => {
  assert.deepEqual(relatedRoots('C:/fw/Driver/dshot/Src/dshot_dma.c', ['C:/other-project']), [
    'C:/other-project',
    'C:/fw/Driver/dshot/Src',
    // 上一层是必要的，不是凑数：`Src/` 与 `Inc/` 是兄弟目录，`../Inc/x.h` 过不了锚点目录这一关
    'C:/fw/Driver/dshot',
  ]);
  // 没有打开文件夹（`workspaceFolders` 为空）时同理 —— 修之前这时**什么都读不到**
  assert.deepEqual(relatedRoots('C:/fw/Driver/dshot/Src/dshot_dma.c', []), [
    'C:/fw/Driver/dshot/Src',
    'C:/fw/Driver/dshot',
  ]);
});

test('D117 related：`../Inc/...` 与同目录文件名都放行（报错那条正是前者）', () => {
  const roots = relatedRoots('C:/fw/Driver/dshot/Src/dshot_dma.c', ['C:/other-project']);
  const policy: ContextFetchPolicy = listPolicy('related', roots, [
    'C:/fw/Driver/dshot/Inc/dshot_dma.h',
    'C:/fw/Driver/dshot/Src/dshot_dma.h',
  ]);
  // ① 用户报的那一条：兄弟目录里的头文件
  const sibling = validateContextRequest(
    fileReq({ path: '../Inc/dshot_dma.h', start: 1, end: 200 }),
    codeAnchor(FW_SRC),
    state({ policy }),
  );
  assert.equal(sibling.accepted, true);
  assert.equal(
    sibling.accepted === true ? sibling.request.params.path : null,
    'C:/fw/Driver/dshot/Inc/dshot_dma.h',
  );

  // ② 锚点旁边那个文件：修之前它同样被拒（候选还要落在某个根里才算数，锚点目录从来不是根）
  const beside = validateContextRequest(
    fileReq({ path: 'dshot_dma.h', start: 1, end: 20 }),
    codeAnchor(FW_SRC),
    state({ policy }),
  );
  assert.equal(beside.accepted, true);
  assert.equal(
    beside.accepted === true ? beside.request.params.path : null,
    'C:/fw/Driver/dshot/Src/dshot_dma.h',
  );

  // ③ 照抄清单里那一行（D124：这才是正路）
  const byLabel = validateContextRequest(
    fileReq({ path: 'dshot/Inc/dshot_dma.h', start: 1, end: 20 }),
    codeAnchor(FW_SRC),
    state({ policy }),
  );
  assert.equal(byLabel.accepted, true);
  assert.equal(byLabel.accepted === true ? byLabel.request.params.path : null, 'C:/fw/Driver/dshot/Inc/dshot_dma.h');

  // ③b 假名已经没有了：写 `f1` 不算命中（D124 去掉了那一列）
  const byAlias = validateContextRequest(fileReq({ path: 'f1', start: 1, end: 20 }), codeAnchor(FW_SRC), state({ policy }));
  assert.equal(byAlias.accepted, false);

  // ④ 再往上就出界了：`../../x.h` 落在 `C:/fw/Driver`，不在这一层里，也不在清单里
  const out = validateContextRequest(
    fileReq({ path: '../../x.h', start: 1, end: 5 }),
    codeAnchor(FW_SRC),
    state({ policy }),
  );
  assert.equal(out.accepted, false);
});

test('D117 related：锚点**在工作区里**时范围不变（不许顺手把工作区外面放开）', () => {
  // 锚点在工作区根直下是最能暴露"随手加父目录"的形状：那一步会把整个盘放开
  assert.deepEqual(relatedRoots('C:/repo/main.c', ['C:/repo']), ['C:/repo']);
  assert.deepEqual(relatedRoots('C:/repo/test/fixtures/main.c', ['C:/repo']), ['C:/repo']);
  // 多根工作区照旧全带上（命中哪一个都算在范围内）
  assert.deepEqual(relatedRoots('C:/b/main.c', ['C:/a', 'C:/b']), ['C:/a', 'C:/b']);
});

test('D119：拒绝文案要说清"清单就是范围" + 这次有几个可选 + 真不够用时往哪调', () => {
  const roots = relatedRoots('C:/fw/Driver/dshot/Src/dshot_dma.c', ['C:/other-project']);
  const policy = listPolicy('related', roots, [
    'C:/fw/Driver/dshot/Inc/dshot_dma.h',
    'C:/fw/Driver/dshot/Inc/dshot.h',
  ]);
  const out = validateContextRequest(
    fileReq({ path: 'C:/sdk/hal_gpio.h', start: 1, end: 5 }),
    codeAnchor(FW_SRC),
    state({ policy }),
  );
  assert.equal(out.accepted, false);
  const reason = out.accepted === false ? out.reason : '';
  assert.match(reason, /当前取件范围 "related"/);
  assert.match(reason, /清单里那 2 个文件/, '要说出这次一共有几个可选 —— 用户看日志时靠它判断"是不是被截断了"');
  assert.match(reason, /照抄/);
  assert.match(reason, /不要自己拼路径/, '要把"自己拼路径"这条堵死说清');
  assert.match(reason, /也不要把名字改写成别的形状/, 'D124：改写形状（`../Inc/x.h`）是上一版实测里最贵的那个动作');
  // 还差一步时给得出下一步：两个设置名都要写进文案
  assert.match(reason, /anchorExplain\.fetchScope/);
  assert.match(reason, /anchorExplain\.maxCandidateFiles/);
  // 第一句以句号收尾、且边界信息落在这句里：进度通知只取第一句（`briefReason`）
  assert.equal(
    reason.slice(0, reason.indexOf('。') + 1),
    '"C:/sdk/hal_gpio.h" 不在这次可取的清单里（当前取件范围 "related"）。',
  );
});

test('D119：清单为空时拒绝文案要说清"一个都取不到"+ 允许的根（那是唯一的线索）', () => {
  const roots = relatedRoots('C:/fw/Driver/dshot/Src/dshot_dma.c', ['C:/other-project']);
  const policy: ContextFetchPolicy = { scope: 'related', roots, maxLines: 400, candidates: [] };
  const out = validateContextRequest(fileReq({ path: 'x.h', start: 1, end: 5 }), codeAnchor(FW_SRC), state({ policy }));
  assert.equal(out.accepted, false);
  const reason = out.accepted === false ? out.reason : '';
  assert.match(reason, /一个别的文件都取不到/);
  assert.match(reason, /允许的根/, '清单为空时根是"为什么一个都没有"的唯一线索');
  assert.match(reason, /C:\/other-project/);
  assert.match(reason, /C:\/fw\/Driver\/dshot/);
  assert.match(reason, /anchorExplain\.fetchScope/);
});

test('D117 any：不按根判范围 —— 工作区外的绝对路径也放行', () => {
  const policy: ContextFetchPolicy = { scope: 'any', roots: [], maxLines: 400 };
  const r = validateContextRequest(
    fileReq({ path: 'C:/sdk/Drivers/hal_gpio.h', start: 1, end: 40 }),
    codeAnchor(),
    state({ policy }),
  );
  assert.equal(r.accepted, true);
  assert.equal(
    r.accepted === true ? r.request.params.path : null,
    'C:/sdk/Drivers/hal_gpio.h',
  );
  // 相对写法仍按锚点文件所在目录算（与别的档同一套坐标）
  const rel = validateContextRequest(
    fileReq({ path: '../Inc/x.h', start: 1, end: 5 }),
    codeAnchor(),
    state({ policy }),
  );
  assert.equal(rel.accepted, true);
  assert.equal(rel.accepted === true ? rel.request.params.path : null, 'C:/repo/test/Inc/x.h');
});

test('D117 any：密钥/依赖/构建产物**照样挡**（那是底线，不是范围问题）', () => {
  const policy: ContextFetchPolicy = { scope: 'any', roots: [], maxLines: 400 };
  for (const path of ['C:/repo/.env', 'C:/repo/.env.local', 'C:/repo/keys/server.pem', 'C:/repo/node_modules/x/index.js', 'C:/repo/build/gen.h']) {
    const out = validateContextRequest(fileReq({ path, start: 1, end: 5 }), codeAnchor(), state({ policy }));
    assert.equal(out.accepted, false, path);
    assert.match(out.accepted === false ? out.reason : '', /按约定不读/, path);
  }
});

test('D117 any：去重与频率两条规则照跑（放宽的是范围，不是整套闸门）', () => {
  const policy: ContextFetchPolicy = { scope: 'any', roots: [], maxLines: 400 };
  const fetched: FetchedSpan[] = [
    { type: 'file', path: 'C:/sdk/Drivers/hal_gpio.h', start: 1, end: 40, content: '旧内容' },
  ];
  const again = validateContextRequest(
    fileReq({ path: './hal_gpio.h', start: 5, end: 10 }),
    codeAnchor('C:\\sdk\\Drivers\\main.c'),
    state({ policy, fetched }),
  );
  assert.equal(again.accepted, false);
  assert.match(again.accepted === false ? again.reason : '', /已经取过了/);
  assert.equal(again.accepted === false ? again.content : undefined, '旧内容');
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

// ── D98：page_range 的 path 口径（省略兜底 / 只认锚点文档 / 老锚点明说） ──────────

test('D98 page_range：path 省略 = 兜底成锚点文档（放行请求里 materialize 成绝对路径）', () => {
  const r = validateContextRequest(
    { type: 'page_range', params: { start: 3, end: 5 }, reason: 'x' },
    pdfAnchor(),
    state({ capabilities: PDF_CAPS, pageCount: 30 }),
  );
  assert.equal(r.accepted, true);
  if (r.accepted) {
    assert.equal(r.request.params.path, 'C:/repo/docs/sample.pdf', '适配器拿到的必须是完整的绝对路径');
  }
});

test('D98 page_range：path 写对（大小写/分隔符差异）也放行，同样归一', () => {
  const r = validateContextRequest(
    { type: 'page_range', params: { path: 'c:\\repo\\docs\\sample.pdf', start: 3, end: 5 }, reason: 'x' },
    pdfAnchor(),
    state({ capabilities: PDF_CAPS, pageCount: 30 }),
  );
  assert.equal(r.accepted, true, 'samePath 判等后应放行');
});

test('D98 page_range：path 指向别的文件 → 拒绝并给正确写法（只认锚点文档）', () => {
  const r = validateContextRequest(
    { type: 'page_range', params: { path: 'C:/repo/docs/other.pdf', start: 3, end: 5 }, reason: 'x' },
    pdfAnchor(),
    state({ capabilities: PDF_CAPS, pageCount: 30 }),
  );
  assert.equal(r.accepted, false);
  assert.match(r.accepted === false ? r.reason : '', /只认锚点这一份文档/);
  assert.match(r.accepted === false ? r.reason : '', /sample\.pdf/);
});

test('D98 page_range：老锚点没有 filePath → 明说拒绝，不再漏到适配器炸"参数不完整"', () => {
  // 注意不能靠 pdfAnchor(undefined) 造老锚点 —— JS 默认参数对显式 undefined 一样生效。
  const old: Anchor = { ...pdfAnchor(), location: { page: 23, bbox: [0.1, 0.1, 0.5, 0.5] } };
  const r = validateContextRequest(
    { type: 'page_range', params: { start: 3, end: 5 }, reason: 'x' },
    old,
    state({ capabilities: PDF_CAPS, pageCount: 30 }),
  );
  assert.equal(r.accepted, false);
  assert.match(r.accepted === false ? r.reason : '', /没有携带 PDF 的文件路径/);
});

test('D98 describeFetched：page_range 带路径时说"文件名 的第 X-Y 页"，不说成行码', () => {
  assert.equal(describeFetched({ type: 'page_range', path: 'C:/repo/docs/sample.pdf', start: 3, end: 5 }), 'sample.pdf 的第 3-5 页');
  assert.equal(describeFetched({ type: 'page_range', path: null, start: 3, end: 5 }), '第 3-5 页');
});
