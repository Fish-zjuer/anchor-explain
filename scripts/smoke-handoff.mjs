/**
 * 链路冒烟（D130）：**外部 Agent 的位置清单 → 临时只读文档 → 二次选择**。
 *
 * @anchor 这一片最大的风险点不是 UI，是**行号映射**：拼起来的文档里第 N 行，
 *         到底来自哪个源文件的哪一行。映射错了的表现是**讲出没取出来的代码** ——
 *         屏幕上一切正常、没有报错、模型也答得很流畅，只是讲的是别的函数。
 *         所以这个脚本盯的就是那一条：**逐行核对来源表与文档内容**。
 *
 * 三块：
 *   1. 拼装 + 来源表（`buildHandoffDoc`）：每一行的来源与正文必须对得上
 *   2. 行号映射（`mapSelection`）：跨文件断开、分割线是断点、标注行是断点
 *   3. 只读文档 provider（`handoffDocumentProvider`）：scheme 判定 + 内容换新 + 再打开不重新生成
 *
 * 前两块是纯逻辑（可以直接跑），第三块要打桩 `vscode`（provider import 了它）。
 *
 * 用法：node scripts/smoke-handoff.mjs
 */

import Module from 'node:module';
import { createRequire } from 'node:module';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, '.tmp-smoke');
mkdirSync(OUT_DIR, { recursive: true });

const SRC = path.join(ROOT, 'packages', 'extension-anchor', 'src');
await build({
  entryPoints: [
    path.join(SRC, 'external', 'handoffDoc.ts'),
    path.join(SRC, 'external', 'handoffBuild.ts'),
    path.join(SRC, 'external', 'handoffParse.ts'),
    path.join(SRC, 'external', 'expandToBlock.ts'),
    path.join(SRC, 'vscode', 'handoffDocumentProvider.ts'),
  ],
  outdir: OUT_DIR,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  outExtension: { '.js': '.cjs' },
  external: ['vscode'],
  logLevel: 'silent',
});

const LOG = [];
const failures = [];
const out = (line) => {
  LOG.push(line);
  try {
    console.log(line);
  } catch {
    /* 控制台编码坏掉不该让脚本挂掉 */
  }
};
const check = (ok, label, detail = '') => {
  out(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` —— ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

// ---- vscode 桩（provider 需要的那几样） ---------------------------------------
const registered = new Map();
/** 最近一次 `showTextDocument` 的选项 —— 要验 `preview: false`（见下面的桩） */
let lastShowOptions;
const vscodeStub = {
  /**
   * 事件发射器桩。`TextDocumentContentProvider` 的 `onDidChange` 用它。
   *
   * @anchor 这个桩要**真的能订阅**（不是空函数）：provider 的 `refresh()`
   *         靠 `fire()` 通知宿主"内容变了"。空实现会让"覆盖之后面板没更新"
   *         这类问题在冒烟里彻底看不见 —— 而那正是这一片用户明确要的行为
   *         （「原地覆盖」＋「原本那个」＝同一份文档、内容换新、要真的刷新）。
   */
  EventEmitter: class EventEmitter {
    constructor() {
      this.listeners = [];
    }
    get event() {
      return (listener) => {
        this.listeners.push(listener);
        return { dispose: () => {} };
      };
    }
    fire(value) {
      for (const l of this.listeners) l(value);
    }
    dispose() {
      this.listeners = [];
    }
  },
  Uri: {
    from: (parts) => ({ scheme: parts.scheme, path: parts.path, toString: () => `${parts.scheme}://${parts.path}` }),
    file: (p) => ({ scheme: 'file', fsPath: p, toString: () => `file:///${p}` }),
  },
  workspace: {
    registerTextDocumentContentProvider(scheme, provider) {
      registered.set(scheme, provider);
      return { dispose() {} };
    },
    openTextDocument: async (uri) => {
      const provider = registered.get(uri.scheme);
      const text = provider ? provider.provideTextDocumentContent(uri) : '';
      return { uri, getText: () => text, lineCount: text.split('\n').length };
    },
  },
  window: {
    showTextDocument: async (doc, opts) => {
      // 记下 `preview` —— D78 / D130 都踩过这个坑：默认预览标签会被下一份预览顶掉，
      // 表现就是用户说的"讲解切换文件丢掉路径"。所以这里必须验到它是 `false`。
      lastShowOptions = opts;
      return { document: doc };
    },
  },
};

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
Module._load = function patched(request, ...rest) {
  if (request === 'vscode') return vscodeStub;
  return originalLoad.call(this, request, ...rest);
};

// esbuild 会保留入口相对 `src/` 的目录结构（`external/`、`vscode/`）——
// 这里**跟着结构的形状写**，而不是加 `outbase` 把它们拉平：
// 保持结构的话，将来某个入口改成 import 别的东西时路径仍然对得上。
const { buildHandoffDoc, mapSelection, describeMapped, HANDOFF_SCHEME, HANDOFF_URI_PATH } = require(
  path.join(OUT_DIR, 'external', 'handoffDoc.cjs'),
);
const { buildHandoff } = require(path.join(OUT_DIR, 'external', 'handoffBuild.cjs'));
const { HANDOFF_PROMPT } = require(path.join(OUT_DIR, 'external', 'handoffParse.cjs'));
const { createHandoffDocumentProvider, openHandoffDocument } = require(
  path.join(OUT_DIR, 'vscode', 'handoffDocumentProvider.cjs'),
);

// ---- 夹具：两个文件、三段（其中一段是"精准到行"、一段已经是完整函数） ----
//
// @anchor 路径一律写**正斜杠**（`C:/repo/...`）：JSON 里反斜杠要写两遍，
//         而 `\\\\` 在"JS 字符串 → JSON 文本 → JSON.parse"这条路上极易变成
//         两个反斜杠字符（`C:\\\\repo`）。那样 `readText` 收到的路径与夹具的键不相等，
//         表现是 ENOENT —— 看着像读文件有问题，其实是夹具自己的转义。
//         真实代码里宿主给的路径来自 `vscode.Uri.fsPath`，形状由那边统一，不受这里影响。
const A = 'C:/repo/fw/App/Src/main.c';
const B = 'C:/repo/fw/Driver/dshot/Src/dshot_dma.c';

const FILE_A = [
  '#include <stdint.h>',
  '',
  'static void init_clock(void) {',
  '    RCC->CR |= 1;',            // 4
  '    while (!(RCC->CR & 2)) {', // 5
  '        ;',
  '    }',
  '}',
  '',
  'int main(void) {',
  '    init_clock();',            // 11
  '    run();',
  '    return 0;',                // 13
  '}',                           // 14
].join('\n');

const FILE_B = [
  '#include "dshot_dma.h"',
  '',
  'void dshot_send(uint16_t *frames, uint16_t n) {',  // 3
  '    for (uint16_t i = 0; i < n; i++) {',           // 4
  '        DMA1_Stream1->CR |= frames[i];',
  '    }',                                            // 6
  '}',                                                // 7
  '',                                                 // 8
  'void dshot_stop(void) {',                          // 9
  '    DMA1_Stream1->CR = 0;',                        // 10
  '}',                                                // 11
].join('\n');

const FILES = new Map([[A, FILE_A], [B, FILE_B]]);

/**
 * 路径比对用的规范形状。
 *
 * @anchor 为什么要这一步：JSON 往返会把 `C:\repo\a.c` 里的反斜杠原样带过来，
 *         但读取端（`resolveHandoffPath` / `readText`）可能给出正斜杠或首字母大小写不同的写法。
 *         真实代码里那条链路上有 `samePath` 兜着，而这个夹具的 `Map` 是**字符串精确相等** ——
 *         不规范化就会以"ENOENT"的样子失败，看着像读文件有问题，其实是夹具自己没对齐。
 */
const norm = (p) => p.replace(/\\/g, '/').toLowerCase();
const readText = async (p) => {
  const hit = [...FILES.entries()].find(([k]) => norm(k) === norm(p));
  if (hit === undefined) throw new Error(`ENOENT: ${p}`);
  return hit[1];
};

out('=== D130：外部位置 → 临时文档 → 二次选择 ===\n');
out(`  夹具：main.c 共 ${FILE_A.split('\n').length} 行；dshot_dma.c 共 ${FILE_B.split('\n').length} 行\n`);

// ── 1. 拼装与来源表 ───────────────────────────────────────────────────────────
// 用户说「临时文件是对方修改涉及区域，由对方给出，但考虑到对方可能精准到行，
//           不方便看，我们自己扩充为函数块放在临时文件」。
// 所以这里给**精准到行**的输入（11-11），看它有没有被扩成整个 main。
const raw = [
  JSON.stringify({ filePath: A, lineStart: 11, lineEnd: 11 }),
  JSON.stringify({ filePath: B, lineStart: 4, lineEnd: 4 }),
].join('\n');

const built = await buildHandoff(raw, {
  readText,
  resolvePath: (p) => p,
});

check(built.segmentCount === 2, '两段都解析出来了', `实际 ${built.segmentCount}`);
check(built.missing.length === 0, '没有读不到的文件', built.missing.join('、'));

const doc = built.doc;
// 用 `doc.lines` 而不是 `doc.text.split('\n')`：契约保证它与 `origin` **逐行对齐**
// （见 `HandoffDoc` 那一段注释）—— 而逐行对齐正是下面那条核对的全部依据。
const lines = doc.lines;

// ── 逐行核对来源表（这一片最要紧的一条） ─────────────────────────────────────
let mismatch = 0;
for (let i = 0; i < lines.length; i += 1) {
  const origin = doc.origin[i];
  if (origin === undefined) {
    mismatch += 1;
    continue;
  }
  if (origin.kind !== 'source') continue;
  const sourceText = [...FILES.entries()].find(([k]) => norm(k) === norm(origin.filePath))?.[1].split('\n')[
    origin.line - 1
  ];
  if (sourceText !== lines[i]) mismatch += 1;
}
check(mismatch === 0, '文档里的每一行都与它标注的源文件那一行**逐字相同**', `不一致 ${mismatch} 行`);

/**
 * 从**来源表**推出段落（不做别的推断，只用「同文件 + 行号连续」这一条）。
 *
 * @anchor 为什么不从别处拿段信息：`HandoffDoc` 里就没有这个字段（它只有逐行来源）。
 *         而"段 = 同一个文件里行号连续的一段正文"这个定义是可以从来源表直接推出来的 ——
 *         用别人给的段列表反而会**绕过**来源表，那这一条核对就变成了自己验自己。
 */
function segmentsFromOrigin(origin) {
  const segs = [];
  let cur = null;
  for (const o of origin) {
    if (o.kind !== 'source') {
      cur = null;
      continue;
    }
    if (cur !== null && cur.filePath === o.filePath && o.line === cur.lineEnd + 1) {
      cur.lineEnd = o.line;
      cur.count += 1;
      continue;
    }
    cur = { filePath: o.filePath, lineStart: o.line, lineEnd: o.line, count: 1 };
    segs.push(cur);
  }
  return segs;
}

const segs = segmentsFromOrigin(doc.origin);
check(segs.length === 2, '来源表推出两段', `实际 ${segs.length}`);

// ── 2. 扩到了函数块（不是只有那一行） ────────────────────────────────────────
//
// @anchor 这里钉的是**扩块的判据**，值得写清楚，因为最容易想歪：
//         输入是 `main.c` 第 11 行（`    init_clock();`，在 `main` 的函数体里）。
//         正确的扩法是"扩到**包含这一行**的那个完整函数" = `main`（10-14）——
//         **不是** `init_clock`（3-8）。后者是"这一行调用了谁"，那是调用图的事，
//         跟"把改动点扩展成一个完整结构"完全是两回事（用户的原话是
//         「反正得是一个较为完整的结构」，指的是**包住它的那一块**）。
//         第一版冒烟我把期望写成了 init_clock，是本脚本自己错了。
const seg = segs[0];
check(
  seg !== undefined && seg.lineStart === 10 && seg.lineEnd === 14,
  '「精准到行」被扩成了**包含它**的那个完整函数（main 的第 10-14 行）',
  `实际 ${seg?.lineStart}-${seg?.lineEnd}`,
);
check(
  seg !== undefined &&
    FILE_A.split('\n').slice(seg.lineStart - 1, seg.lineEnd).join('\n') ===
      'int main(void) {\n    init_clock();\n    run();\n    return 0;\n}',
  '扩出来的块正文就是那个函数（不含前面的 #include 与空行）',
);
check(
  seg !== undefined && !FILE_A.split('\n').slice(seg.lineStart - 1, seg.lineEnd).join('\n').includes('#include'),
  '扩块没把文件头的 #include 一起吞进来（那会让"改动点"变成一个没有边界的区间）',
);

// ── 3. 分割线：不同文件之间要有可见的分界 ────────────────────────────────────
// D133：用户实测"不够显眼" → 改成三行、100 宽。判据写死这两条，
// 日后有人把三行改回一行（或把宽度调窄）会在这里红。
const BAR = '='.repeat(100);
check(doc.text.includes(BAR), '两个文件之间有 ASCII 粗分割线（100 宽）');
const barLines = lines.filter((l) => l === BAR).length;
check(
  barLines === (segs.length - 1) * 3,
  '分割线行数 = （段数 - 1）× 3（D133 起是每个分界三行，不首不尾）',
  `实际 ${barLines} 行`,
);

// ── 4. 每段的标注行写着**源文件**路径与行号 ──────────────────────────────────
check(
  doc.text.includes('main.c') && doc.text.includes('dshot_dma.c'),
  '标注行写出了两个源文件名（用户看得出这一段是从哪来的）',
);
check(
  doc.files.length === 2,
  'doc.files 记下了出现过的两个文件（取件范围要用它，D130 第六节）',
  doc.files.join('、'),
);

// ── 5. 映射：在代码行上选 → 落回源文件 ───────────────────────────────────────
out('\n  · 映射（在临时文档里选一段）');

/** 找文档里第 `segIndex` 段正文的第一行（文档行号，1-based） */
function firstBodyLine(segIndex) {
  const target = segs[segIndex];
  for (let i = 0; i < doc.origin.length; i += 1) {
    const o = doc.origin[i];
    if (o.kind === 'source' && o.filePath === target.filePath && o.line === target.lineStart) return i + 1;
  }
  return -1;
}

const aStart = firstBodyLine(0);
const aEnd = aStart + (segs[0].lineEnd - segs[0].lineStart);
const mappedA = mapSelection(doc.origin, aStart, aEnd);
check(mappedA.length === 1, '第一段单独选 → 一段', `实际 ${mappedA.length}`);
check(mappedA[0] !== undefined && norm(mappedA[0].filePath) === norm(A), '落回 main.c', mappedA[0]?.filePath);
check(
  mappedA[0]?.lineStart === segs[0].lineStart && mappedA[0]?.lineEnd === segs[0].lineEnd,
  '行号与源文件一致（不是文档行号）',
  `实际 ${mappedA[0]?.lineStart}-${mappedA[0]?.lineEnd}`,
);

// ── 6. 跨过分割线的选择必须**断开**（这是"讲出没取出来的代码"的入口） ────────
const lastA = aEnd;
const firstB = firstBodyLine(1);
const across = mapSelection(doc.origin, lastA, firstB);
check(across.length === 2, '从第一段末尾跨到第二段开头 → 必须断成两段（不合并）', `实际 ${across.length}`);
check(
  across[0] !== undefined && across[1] !== undefined && norm(across[0].filePath) === norm(A) && norm(across[1].filePath) === norm(B),
  '两段分别指向两个不同的文件',
  across.map((r) => r.filePath).join('、'),
);

// ── 7. 选中标注行 / 分割线 → 什么都不返回（不是错误） ────────────────────────
const annotationLine = doc.origin.findIndex((o) => o.kind === 'filler') + 1;
const pickFiller = mapSelection(doc.origin, annotationLine, annotationLine);
check(pickFiller.length === 0, '选中标注行 → 空（宿主据此提示"你选中的是标注行"）', `实际 ${pickFiller.length}`);

// ── 8. describeMapped 说得出"哪个文件的哪几行" ───────────────────────────────
const described = describeMapped(mappedA);
check(described.includes('main.c'), '确认框里带文件名', described);
out(`  · 确认框会显示：${described}`);

// ── 9. 只读文档 provider ─────────────────────────────────────────────────────
out('\n  · 只读文档 provider');

const provider = createHandoffDocumentProvider();
check(provider.uri.scheme === HANDOFF_SCHEME, 'provider 注册用的 scheme 与判定常量**是同一个**', provider.uri.scheme);
check(registered.has(HANDOFF_SCHEME), 'provider 真的注册进了 vscode');

/**
 * 内容读回来的两条路都要对：
 *   - `provider.host.get()` —— 宿主自己读（判"有没有东西可讲"）
 *   - 注册进 vscode 的那个回调 —— VS Code 重画标签时走这条
 * 只验其中一条会漏掉"内容写进去了但标签没刷新"那类问题（用户会看到旧内容）。
 */
const registeredProvider = registered.get(HANDOFF_SCHEME);
const readViaVscode = (uri) => registeredProvider.provideTextDocumentContent(uri);

provider.host.set(doc.text);
check(provider.host.get() === doc.text, 'host.get() 读到的就是写进去的内容');
check(readViaVscode(provider.uri) === doc.text, 'VS Code 那条路读到的也是同一份内容');

// 只认自己那一个 URI：别的东西来问不许把内容给它
const otherUri = { scheme: HANDOFF_SCHEME, path: '别的' };
check(readViaVscode(otherUri) === '', '别的 URI 来问 → 空串（不把内容给它）');

// ── 覆盖：同一份文档，内容换新（用户说「原地覆盖」） ──────────────────────────
let notified = 0;
registeredProvider.onDidChange(() => {
  notified += 1;
});
provider.host.set('新的一份');
provider.refresh();
check(provider.host.get() === '新的一份', '覆盖之后 host 读到的是新的');
check(readViaVscode(provider.uri) === '新的一份', '覆盖之后 VS Code 那条路也是新的');
check(notified === 1, '覆盖时 refresh() 真的通知了一次（不然标签上还显示旧内容）', `通知 ${notified} 次`);

// ---- 再打开不重新生成（用户说「原本那个」） --------------------------------
//
// @anchor 两条要分开验，因为它们管的是**不同的失败**：
//   1. `openHandoffDocument` 不返回东西（契约就是 `Promise<void>`）——
//      验"能不能再开一次不炸"（第二次打开时文档已经在标签里了，走的是"置顶"那条路）
//   2. 两次打开要的是**同一份文档**（不是新 content、不是新 URI）——
//      验"原本那个"这个要求；用 `host.get()` 的内容在两次打开之间没有变过来间接钉住。
provider.host.set(doc.text);
const shownUris = [];
const origShow = vscodeStub.window.showTextDocument;
vscodeStub.window.showTextDocument = async (d, opts) => {
  shownUris.push(d.uri);
  return origShow(d, opts);
};

await openHandoffDocument(provider);
await openHandoffDocument(provider);

check(shownUris.length === 2, '两次调用都真的开了文档（第二次不是静默返回）', `实际 ${shownUris.length} 次`);
check(
  shownUris[0].scheme === HANDOFF_SCHEME && shownUris[1].scheme === HANDOFF_SCHEME,
  '两次打开的都是临时文档那一份（scheme 相同）',
);
check(
  shownUris[0].path === shownUris[1].path,
  '两次打开指向**同一个 URI**（不是新造一份）',
  `${shownUris[0].path} / ${shownUris[1].path}`,
);
check(provider.host.get() === doc.text, '两次打开之间内容没被清掉（"原本那个"还在）');
check(provider.uri.path === HANDOFF_URI_PATH, 'URI 的 path 就是那个固定常量', provider.uri.path);
check(
  lastShowOptions?.preview === false,
  '打开时传了 `preview: false`（默认的预览标签会被下一份预览顶掉 —— 那正是"丢掉路径"）',
  JSON.stringify(lastShowOptions),
);

// ── 11. 提示词（给对方的那段） ───────────────────────────────────────────────
out('\n  · 给外部 Agent 的提示词');
check(HANDOFF_PROMPT.includes('filePath'), '提示词里给了字段名', '');
check(HANDOFF_PROMPT.includes('lineStart'), '提示词里给了 lineStart', '');
check(!HANDOFF_PROMPT.includes('```'), '提示词没教对方加代码块围栏（解析器虽然容错，但教对了更省事）');
check(HANDOFF_PROMPT.length < 300, '提示词足够短', `${HANDOFF_PROMPT.length} 字符`);

// ── 12. 部分成功不抛（一个文件读不到，另一段照给） ───────────────────────────
out('\n  · 容错');
const partial = await buildHandoff(
  [JSON.stringify({ filePath: A, lineStart: 11, lineEnd: 11 }), JSON.stringify({ filePath: 'C:/nope/x.c', lineStart: 1, lineEnd: 2 })].join('\n'),
  { readText, resolvePath: (p) => p },
);
check(partial.segmentCount === 1, '读不到的进 missing，读到的那段照给', `segmentCount=${partial.segmentCount}`);
check(partial.missing.length === 1, 'missing 里记着那一个文件');

// ---- 收尾 --------------------------------------------------------------------
const passed = LOG.filter((l) => l.startsWith('  ok  ')).length;
const failed = failures.length;
out(`\n======================`);
out(`通过 ${passed} 条，失败 ${failed} 条`);
if (failed > 0) {
  out(`失败项：\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
