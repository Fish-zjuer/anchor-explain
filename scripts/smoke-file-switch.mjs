/**
 * 链路冒烟（第 9 条）：**讲解进行中用户切换文件，视图必须跟着讲解走**（D77）。
 *
 * @anchor 用户报的原话是「在讲解时，如果过程中遭遇切换文件，会直接造成讲解卡死」。
 *         真机上的表现：一旦手动切走（或讲解期间自己点开了别的文件），
 *         后续每一拍都"画在别的标签上" —— 屏幕上不再有任何变化，看着就是讲解卡死了，
 *         而状态机其实一直在正常推进（输出通道干净、没有任何异常）。
 *
 * 根因在 `CodeWalkthroughPlayer.#ensureEditor`：目标文件若已经在 `visibleTextEditors`
 * 里但**不是活动编辑器**，旧代码直接把它返回；而调用方紧接着做的两件事都只在
 * **活动编辑器**上才有效 ——
 *   - `editor.setDecorations(...)` 画在用户没看的标签上（屏幕上看不见）
 *   - `editor.revealRange(...)` 对非活动编辑器**什么都不做**（不滚、也不切过去）
 * 于是"切走一次"就等于"从此再也跟不上"。
 *
 * 与 `smoke-walkthrough.mjs` 同一套打法（只对 `vscode` 打桩，其余全是真的），
 * 但补上了那边没有的两件事：
 *   1. `activeTextEditor` 会被"用户"切走（冒烟里它从头到尾钉在同一个编辑器上）
 *   2. `showTextDocument` 的**异步**语义（真实 API 是 async 的）
 *
 * 播放层 `import 'vscode'`，所以先在进程内把它打成 cjs（`.tmp-smoke/`），
 * 再用 `Module._load` 钩子把 'vscode' 换成桩 —— cjs 的 require 会走这条钩子。
 *
 * 用法：node scripts/smoke-file-switch.mjs
 */

import Module from 'node:module';
import { createRequire } from 'node:module';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, '.tmp-smoke');
mkdirSync(OUT_DIR, { recursive: true });

// ---- 把播放层打成 cjs（进程内调 esbuild，不依赖 pnpm build） -----------------
const PLAYBACK = path.join(ROOT, 'packages', 'extension-anchor', 'src', 'playback');
await build({
  entryPoints: [path.join(PLAYBACK, 'WalkthroughSession.ts'), path.join(PLAYBACK, 'CodeWalkthroughPlayer.ts')],
  outdir: OUT_DIR,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  outExtension: { '.js': '.cjs' },
  external: ['vscode'],
  logLevel: 'silent',
});

// ---- 结果：同时写文件（Windows 控制台编码会把中文吐成乱码） -----------------
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

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const flush = async (n = 20) => {
  for (let i = 0; i < n; i += 1) await tick();
};

// ---- vscode 桩 -------------------------------------------------------------
class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}
class Range {
  constructor(a, b, c, d) {
    if (a instanceof Position) {
      this.start = a;
      this.end = b;
    } else {
      this.start = new Position(a, b);
      this.end = new Position(c, d);
    }
  }
}

const decorationTypes = [];
const documents = new Map();

function makeDocument(fsPath, lineCount) {
  return {
    uri: { fsPath, toString: () => `file:///${fsPath}` },
    lineCount,
    isClosed: false,
    lineAt: () => ({ text: '' }),
    getText: () => '',
  };
}

function makeEditor(fsPath, lineCount) {
  const doc = documents.get(fsPath) ?? makeDocument(fsPath, lineCount);
  documents.set(fsPath, doc);
  return {
    document: doc,
    decorations: new Map(),
    /** 每次 reveal 都记下"当时它是不是活动编辑器" —— 那条就是 D77 的判据 */
    reveals: [],
    setDecorations(type, ranges) {
      if (doc.isClosed) throw new Error('document is closed');
      this.decorations.set(type, ranges.slice());
    },
    revealRange(range, kind) {
      this.reveals.push({ range, kind, wasActive: win.activeTextEditor === this });
    },
  };
}

const win = { activeTextEditor: undefined, visibleTextEditors: [], showTextDocumentCalls: 0 };

const vscodeStub = {
  Range,
  Position,
  DecorationRangeBehavior: { ClosedClosed: 1, OpenOpen: 0 },
  OverviewRulerLane: { Center: 2, Left: 1, Right: 4, Full: 7 },
  TextEditorRevealType: { InCenter: 1, AtTop: 0, InCenterIfOutsideViewport: 2 },
  ViewColumn: { One: 1, Two: 2, Beside: -2 },
  ThemeColor: class ThemeColor {
    constructor(id) {
      this.id = id;
    }
  },
  Uri: { file: (p) => ({ fsPath: p, toString: () => `file:///${p}` }) },
  window: {
    get activeTextEditor() {
      return win.activeTextEditor;
    },
    get visibleTextEditors() {
      return win.visibleTextEditors;
    },
    createTextEditorDecorationType(options) {
      const type = { options, dispose() {} };
      decorationTypes.push(type);
      return type;
    },
    async showTextDocument(doc, _opts) {
      win.showTextDocumentCalls += 1;
      await tick();
      const existing = win.visibleTextEditors.find((e) => e.document.uri.fsPath === doc.uri.fsPath);
      const editor = existing ?? makeEditor(doc.uri.fsPath, doc.lineCount);
      if (!existing) win.visibleTextEditors.push(editor);
      // preserveFocus: true —— 面板保有键盘焦点，但 activeTextEditor 换成它
      win.activeTextEditor = editor;
      return editor;
    },
  },
  workspace: {
    openTextDocument: async (uri) => {
      await tick();
      const doc = documents.get(uri.fsPath) ?? makeDocument(uri.fsPath, 500);
      documents.set(uri.fsPath, doc);
      return doc;
    },
  },
  commands: { executeCommand: () => Promise.resolve() },
};

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
Module._load = function patched(request, ...rest) {
  if (request === 'vscode') return vscodeStub;
  return originalLoad.call(this, request, ...rest);
};

const { WalkthroughSession } = require(path.join(OUT_DIR, 'WalkthroughSession.cjs'));
const { CodeWalkthroughPlayer } = require(path.join(OUT_DIR, 'CodeWalkthroughPlayer.cjs'));

// ---- 夹具：两步讲解，第一步在 main.c，第二步跨到 protocol.h ----------------
const A = 'C:\\repo\\fw\\App\\Src\\main.c';
const B = 'C:\\repo\\fw\\App\\Inc\\protocol.h';

const result = {
  steps: [
    {
      location: { filePath: A, lineStart: 40, lineEnd: 42 },
      title: '第一步：在 main.c 里',
      text: 'x',
      highlights: [{ location: { filePath: A, lineStart: 41, lineEnd: 41 }, narration: 'a', emphasis: 'primary' }],
    },
    {
      location: { filePath: B, lineStart: 16, lineEnd: 18 },
      title: '第二步：跨到 protocol.h',
      text: 'y',
      highlights: [{ location: { filePath: B, lineStart: 16, lineEnd: 16 }, narration: 'b', emphasis: 'definition' }],
    },
  ],
  summary: 's',
  confidence: 1,
};

const editorA = makeEditor(A, 500);
const editorB = makeEditor(B, 200);
win.visibleTextEditors.push(editorA, editorB);
win.activeTextEditor = editorA;

const session = new WalkthroughSession(result);
const player = new CodeWalkthroughPlayer();

let renderErrors = 0;
session.onDidChange((snap) => {
  void player.render(snap).catch(() => {
    renderErrors += 1;
  });
});
// commands.ts 的 startSession 在挂上监听之后**立刻 emit 一次首帧快照**，这里照做
void player.render(session.snapshot);

const typeByBackground = (id) => decorationTypes.find((t) => t.options.backgroundColor?.id === id);
const typeByBorderColor = (id) => decorationTypes.find((t) => t.options.borderColor?.id === id);

out('=== D77：讲解中途切换文件，视图必须跟着讲解走 ===\n');

// ── 1. 首拍正常 ───────────────────────────────────────────────────────────
await flush();
check(editorA.reveals.length > 0, '首拍滚到了 main.c');
check(editorA.reveals.every((r) => r.wasActive), '首拍的 reveal 都作用在活动编辑器上');
check((editorA.decorations.get(typeByBackground('editor.selectionHighlightBackground'))?.length ?? 0) === 1,
  '首拍把步级底色画在 main.c 上');

// ── 2. 关键：用户手动切到 protocol.h，然后继续推进 ────────────────────────
win.activeTextEditor = editorB;
out('  · 用户切到 protocol.h（讲解还在 main.c 的那一步）');

session.next();
await flush();

const lastA = editorA.reveals[editorA.reveals.length - 1];
check(!!lastA, '切文件之后仍产生了 reveal');
check(
  !!lastA && lastA.wasActive === true,
  '切文件之后的 reveal 作用在**活动**编辑器上（否则屏幕上不会有任何可见变化）',
  lastA ? `wasActive=${lastA.wasActive}` : '(无 reveal)',
);
check(
  win.activeTextEditor === editorA,
  '视图被带回了讲解所在的文件 main.c',
  win.activeTextEditor === editorA ? '是' : `现在停在 ${win.activeTextEditor?.document.uri.fsPath}`,
);

// ── 3. 跨文件那一拍：把用户带到 protocol.h ────────────────────────────────
const beforeB = editorB.reveals.length;
session.goto(1);
await flush();
check(editorB.reveals.length > beforeB, '跨文件那一拍滚到了 protocol.h');
check(
  (editorB.decorations.get(typeByBackground('editor.selectionHighlightBackground'))?.length ?? 0) === 1,
  '步级底色画在 protocol.h 上（goto 落的是该步第一拍，只铺底 —— D48）',
);

session.next();
await flush();
check(
  (editorB.decorations.get(typeByBorderColor('editorInfo.foreground'))?.length ?? 0) === 1,
  '推进一拍后，definition 档的框画在 protocol.h 上',
);
check(win.activeTextEditor === editorB, '此时视图停在 protocol.h 上（跨文件那一拍把用户带过去了）');

// ── 4. 再切回去，仍然能自愈 ───────────────────────────────────────────────
win.activeTextEditor = editorA;
session.goto(0);
await flush();
check(
  win.activeTextEditor === editorA,
  '再次切走后推进：视图仍被带回 main.c（不是只有第一次能自愈）',
  win.activeTextEditor === editorA ? '是' : `实际停在 ${win.activeTextEditor?.document.uri.fsPath}`,
);

// ── 5. 连按（模拟按住 alt+]）：不丢拍、不抛异常、最后有框 ────────────────
for (let i = 0; i < 6; i += 1) session.next();
await flush(40);
check(session.snapshot.state === 'done', '连按之后落到了 done', `state=${session.snapshot.state}`);
check(renderErrors === 0, '渲染过程中没有异常逃出', `${renderErrors} 次`);

// ── 6. 结构性断言：没有任何一次 reveal 落在非活动编辑器上 ────────────────
const allReveals = [...editorA.reveals, ...editorB.reveals];
check(
  allReveals.every((r) => r.wasActive),
  '**整条链路**里没有任何一次 reveal 落在非活动编辑器上（D77 的核心不变量）',
  `总共 ${allReveals.length} 次 reveal`,
);

// ── 7. D84：播放器要能回答"我是不是正在换文件" ────────────────────────────
// 宿主（commands.ts 的 `evaluateSessionEnd`）靠这个回答决定收工判定能不能做：
// VS Code 的一次预览轮换**不是原子动作**，"旧标签关了"与"新文件可见了"是两个先后到达的信号，
// 夹在中间那一帧我们这边什么文件都还不可见 —— 判定若落在那一帧上，就会把
// "播放器正把用户带到某个文件"读成"用户把讲解的东西全关了"，于是讲解被收掉。
// 所以这里锁的是**接口契约**：换文件期间 `switching` 必须为真，换完必须为假、且回调一次。
let settled = 0;
player.onDidSettle(() => {
  settled += 1;
});
win.activeTextEditor = editorA; // 用户此刻在 main.c 上，而这一拍要讲 protocol.h
session.goto(1);
const midFlight = player.switching;
check(
  midFlight === true,
  'D84：换文件期间 switching === true（宿主据此推迟收工判定）',
  `switching=${midFlight}`,
);
await flush();
check(
  player.switching === false,
  'D84：换完之后 switching 落回 false（否则收工判定会被永久推迟）',
  `switching=${player.switching}`,
);
check(settled > 0, 'D84：换完之后有「落定」回调（宿主靠它补做一次判定）', `${settled} 次`);
check(win.activeTextEditor === editorB, 'D84：这一跳确实把 protocol.h 切到了前台（上面那两条测的是真事情）');

out('\n=== 数字 ===');
out(`showTextDocument 调用次数：${win.showTextDocumentCalls}`);
for (const [name, ed] of [['main.c', editorA], ['protocol.h', editorB]]) {
  const inactive = ed.reveals.filter((r) => !r.wasActive).length;
  out(`  ${name}: reveals=${ed.reveals.length}（非活动编辑器上：${inactive}）`);
}

out('');
if (failures.length) {
  out(`[smoke-file-switch] ${failures.length} 条未通过：`);
  for (const f of failures) out(`  - ${f}`);
  process.exitCode = 1;
} else {
  out('[smoke-file-switch] 全部通过');
}

writeFileSync(path.join(ROOT, '.tmp-smoke-file-switch.txt'), LOG.join('\n') + '\n', 'utf8');
