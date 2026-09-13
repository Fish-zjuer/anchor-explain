/**
 * S1 链路冒烟 —— 不启动 VS Code，把 `capture` 命令从选区一路跑到 decoration。
 *
 * 与 `smoke-extension.mjs` 的分工：
 *   - `smoke-extension.mjs`：产物能不能加载、命令有没有注册（**结构**）
 *   - 本脚本：一次真实讲解走完全链路，并检查高亮真的画对了行（**行为**）
 *
 * 只对最外层边界打桩（`vscode` 模块）。桩之外全是真的：
 *   - 真的读磁盘上的 `test/fixtures/main.c`（所以行数上界检查用的是真数据）
 *   - **S2 起真的读编辑器选区**（桩提供的 `window.activeTextEditor.selection`，第 9 节会改它来验接线）
 *   - 真的 `fakeProvider` → 真的 `validateExplanation` → 真的 `WalkthroughSession`
 *   - 真的 `CodeWalkthroughPlayer` 决策，只是把 `setDecorations` 记下来
 *   - 真的 `SidebarPanel` 生成 HTML，只是把 `postMessage` 记下来
 *
 * 因此它能守住用户 F5 才会发现的几件事：
 *   1. 每一步画在**哪几行**、用的是**哪一档配色**（§4.3 的映射）
 *   2. 退出时所有 decoration type 都被清空（不留残影）
 *   3. **文件字节未变**、`workspace.applyEdit` 从未被调用（"纯视觉"的硬要求）
 *   4. 侧边栏收到的是合法的 `HostToSidebar` 消息，且 `ui:ready` 会触发重放
 *
 * 用法：node scripts/smoke-walkthrough.mjs
 */

import Module from 'node:module';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN_C = path.join(ROOT, 'test', 'fixtures', 'main.c');
const FIXTURES = path.dirname(MAIN_C);
const BUNDLE = path.join(ROOT, 'packages', 'extension-anchor', 'dist', 'extension.cjs');

const failures = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` —— ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');

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
  toString() {
    return `${this.start.line + 1}-${this.end.line + 1}`;
  }
}
class ThemeColor {
  constructor(id) {
    this.id = id;
  }
}
class MarkdownString {
  constructor(value) {
    this.value = value;
  }
}

const source = readFileSync(MAIN_C, 'utf8');
const sourceLines = source.split(/\r?\n/);
const lineCount = sourceLines.length - (source.endsWith('\n') ? 1 : 0);

const messages = [];
const registered = new Map();
const executed = [];
const decorationTypes = [];
const reveals = [];
const webviews = [];
const statusItems = [];
const quickPicks = [];
const outputLines = [];
const fetchCalls = [];
let applyEditCalls = 0;
let receiveFromWebview;
let onCloseDocument;

// ── S3：模型端点也是桩 ──────────────────────────────────────────────────────
// 从 S3 起 `capture` 走的是**真的编排循环 + 真的 OpenAI 兼容实现**，
// 唯一被换掉的是最外面那一跳 `fetch`。于是"取件轮数、拒绝回灌、输出闸门"
// 这些逻辑在冒烟里跑的是真代码，只有字节没有真的过网线。
let fetchMode = 'with-fetch';
let fetchFail;
let peerPdfInstalled = true;

/** main.c 第 40-48 行的三个步骤（内容对应 rb_pop）——这就是"模型返回什么" */
const EXPLANATION_JSON = JSON.stringify({
  title: '环形队列的出队路径',
  summary: '这 9 行是一个标准的环形队列出队：先挡住空队列，再从 head 取值并把指针往前推，最后维护 count。',
  confidence: 0.9,
  steps: [
    {
      location: { filePath: MAIN_C, lineStart: 40, lineEnd: 42 },
      title: '出队前先挡住空队列',
      intro: 'rb_pop 要先回答一个问题：队列里还有东西吗？',
      text: '第 40 行是函数签名，第 42 行是提前返回：count 为 0 时直接返回 -1。',
      highlights: [
        { location: { filePath: MAIN_C, lineStart: 40, lineEnd: 40 }, narration: 'out 是出参指针。', emphasis: 'context' },
        { location: { filePath: MAIN_C, lineStart: 42, lineEnd: 42 }, narration: '空队列返回 -1。', emphasis: 'definition' },
      ],
    },
    {
      location: { filePath: MAIN_C, lineStart: 44, lineEnd: 45 },
      title: '取值，并把 head 往前推',
      intro: '数据在 head 指向的位置，取走之后 head 必须跟着走。',
      text: '第 44 行取值，第 45 行推进 head 并对 RB_CAPACITY 取模。',
      highlights: [
        { location: { filePath: MAIN_C, lineStart: 44, lineEnd: 44 }, narration: '*out 是解引用赋值。', emphasis: 'primary' },
        { location: { filePath: MAIN_C, lineStart: 45, lineEnd: 45 }, narration: '取模实现回绕。', emphasis: 'definition' },
      ],
    },
    {
      location: { filePath: MAIN_C, lineStart: 46, lineEnd: 48 },
      title: '维护计数并报告成功',
      intro: '指针动了，count 也得动。',
      text: '第 46 行把 count 减一，第 47 行返回 0 表示成功。',
      highlights: [
        { location: { filePath: MAIN_C, lineStart: 46, lineEnd: 46 }, narration: 'count 是唯一权威。', emphasis: 'caveat' },
        { location: { filePath: MAIN_C, lineStart: 47, lineEnd: 47 }, narration: '返回 0 表示成功。', emphasis: 'context' },
      ],
    },
  ],
});

/**
 * D67 的回归场景：讲解里有一步落在**刚读过的兄弟文件**里，而且 filePath 照抄取件时用的
 * **相对写法**（`ring_buffer.h`）—— 这是 S9a 交付时必然被夹死的形状：
 * 内部闸门的允许集合是绝对路径、命令层第二道闸门收的是模型原样写的相对路径，两边对不上。
 */
const SIBLING_EXPLANATION_JSON = JSON.stringify({
  title: '容量宏不在这个文件里',
  summary: '队列的容量不是写死的 16，它来自另一个文件的宏 —— 取模回绕靠的就是它。',
  confidence: 0.8,
  steps: [
    {
      location: { filePath: 'ring_buffer.h', lineStart: 10, lineEnd: 16 },
      title: '容量宏决定了环有多大',
      text: 'RB_CAPACITY 是 16，head 走到末尾时靠它对 16 取模绕回去。',
    },
    {
      location: { filePath: MAIN_C, lineStart: 40, lineEnd: 42 },
      title: '出队前先挡住空队列',
      text: '第 42 行 count 为 0 时直接返回 -1。',
    },
  ],
});

/** 锚点同目录那个兄弟文件解析出来的绝对路径（core 的路径函数统一用 `/`） */
const SIBLING_ABS = MAIN_C.replace(/\\/g, '/').replace(/\/[^/]*$/, '/ring_buffer.h');

function toolCallTurn() {
  // `related` 与 `related-ref` 都要读**兄弟文件**（后者还要求讲解里引用它）
  const related = fetchMode === 'related' || fetchMode === 'related-ref';
  return {
    content: '',
    tool_calls: [
      {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'fetch_context',
          arguments: JSON.stringify({
            request_type: 'file',
            // 跨文件那次要读到**宏与结构体**（它们不在文件开头），其余情形随便一小段
            start: related ? 10 : 1,
            end: related ? 20 : 5,
            reason: '想先看看文件头部有哪些定义',
            // §8 声明了 `path` 之后模型才可能点名文件（S9a 修订，D67）—— 这里刻意带上，
            // 好验证它一路被带到校验与适配器那两步。
            // S9a：`related*` 模式下**读锚点文件之外的兄弟文件是合法的** —— 这里用相对路径，
            // 好验证"先按锚点文件所在目录解析"那条规则。另外两个模式用来验拒绝路径。
            path: related
              ? 'ring_buffer.h'
              : fetchMode === 'outside'
                ? 'C:/Windows/win.ini'
                : fetchMode === 'secret'
                  ? '.env'
                  : MAIN_C,
          }),
        },
      },
    ],
  };
}

/** 线2 的锚点长这样：没有 filePath，只有 page/bbox */const PDF_PATH = path.join(FIXTURES, 'sample-30p.pdf');

const PDF_EXPLANATION_JSON = JSON.stringify({
  summary: '这一块是环形队列的图示与出队顺序说明。',
  confidence: 0.8,
  steps: [
    {
      location: { page: 23, bbox: [0.1, 0.1, 0.6, 0.4] },
      title: '图示里的三个元素',
      text: 'head、tail、count 三者的关系在这张图上标了出来。',
      highlights: [
        { location: { page: 23, bbox: [0.1, 0.1, 0.2, 0.2] }, narration: 'head 指向下一个要取的位置。', emphasis: 'primary' },
      ],
    },
    {
      location: { page: 24, bbox: [0.2, 0.2, 0.8, 0.6] },
      title: '出队顺序',
      text: '取走之后 head 前移，图上用箭头画了出来。',
    },
  ],
});

/** 假端点：只看"对话里有没有 tool 结果"来决定回哪一轮，因此无状态、可重入 */
function cannedCompletion(body) {
  const seen = (body.messages ?? []).map((m) => m.role);
  if (fetchMode === 'always-fetch') return toolCallTurn();
  if (!seen.includes('tool')) return toolCallTurn();
  if (fetchMode === 'related-ref') return { content: SIBLING_EXPLANATION_JSON };
  // PDF 锚点的 prompt 里写的是「页码：第 N 页」，拿它区分两条线
  const prompt = String(body.messages?.[1]?.content ?? '');
  return { content: prompt.includes('页码：') ? PDF_EXPLANATION_JSON : EXPLANATION_JSON };
}

globalThis.fetch = (url, init) => {
  const body = JSON.parse(String(init?.body ?? '{}'));
  fetchCalls.push({ url, body, headers: init?.headers ?? {} });
  if (fetchFail) return Promise.reject(new Error(fetchFail));
  return Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify({ choices: [{ message: cannedCompletion(body) }] })),
  });
};

/** S3 的配置桩。`providers.default` 齐了，所以 `makeProvider()` 不会报"还没配置" */
let settingsValues = {
  providers: { default: { baseUrl: 'https://example.test/v1', tier1Model: 'test-cheap' } },
  activeProvider: 'default',
  maxFetchRounds: 3,
  preferSecretStorage: true,
};
let secretValue = 'sk-from-secret-storage';

// S2：capture 现在走**真选区**（`window.activeTextEditor.selection`），所以桩必须真的给一个，
// 而且要能改 —— "只放光标没选内容"、QuickPick 里选哪一项，都是靠改下面这几个变量走的。
// 行号 0-based，与 VS Code 的 Position 一致；默认 39..47 = 第 40-48 行（1-based）。
let selectionStartLine = 39;
let selectionEndLine = 47;
let selectionEmpty = false;
/** 用户在 QuickPick 里点的 label；undefined = 用户按 Esc 取消 */
let quickPickAnswer;
/** 用户在警告提示上点的按钮（S2 的"只放光标"分支）；undefined = 没点 */
let warningAnswer;

const editor = {
  document: {
    uri: { fsPath: MAIN_C },
    lineCount,
    // 必须支持按 Range 取：真实现是 `doc.getText(new Range(start, 0, end, 行尾))`。
    // 如果这里忽略参数返回全文，`extractedText` 会悄悄变成整份文件，而没有任何断言会红。
    getText: (range) => {
      if (!range) return source;
      const { start, end } = range;
      const out = sourceLines.slice(start.line, end.line + 1);
      if (out.length === 0) return '';
      out[out.length - 1] = out[out.length - 1].slice(0, end.character);
      out[0] = out[0].slice(start.character);
      return out.join('\n');
    },
    lineAt: (n) => ({ text: sourceLines[n] ?? '' }),
    // 讲解期间用户完全可能把这个文件关掉。桩必须能模拟它 —— 见下面第 6 节
    get isClosed() {
      return closed;
    },
  },
  get selection() {
    // 只放光标时 VSCode 的 start/end 是同一个位置（`isEmpty` 就是"两者相等"），
    // 桩照这个来，否则 showState 会打出一句"光标在 第 10-14 行"这种真实里不会出现的话
    return {
      isEmpty: selectionEmpty,
      start: { line: selectionStartLine, character: 0 },
      end: { line: selectionEmpty ? selectionStartLine : selectionEndLine, character: 0 },
    };
  },
  decorations: new Map(),
  setDecorations(type, ranges) {
    // 真实的 VS Code 在编辑器已释放时抛异常。`disposedThrow` 用来单独验"没有 isClosed 兜底时"的路径
    if (closed || disposedThrow) throw new Error('TextEditor has been disposed');
    editor.decorations.set(type, [...ranges]);
  },
  revealRange(range, kind) {
    reveals.push({ range: range.toString(), kind });
  },
};
let closed = false;
let disposedThrow = false;

/** D64：进度的 report 文案（链式冒烟会断言"模型在跑的时候屏幕上真有东西"） */
const progressReports = [];
const progressOptions = [];

const vscodeStub = {
  Position,
  Range,
  ThemeColor,
  MarkdownString,
  StatusBarAlignment: { Left: 1, Right: 2 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  // 取值与 @types/vscode@1.90.0 的 index.d.ts 一致：OpenOpen=0、ClosedClosed=1。
  // 写反过一次（ClosedClosed: 0），那等于把"编辑时框不撑到新行"这条契约在测试里反转成相反语义。
  DecorationRangeBehavior: { OpenOpen: 0, ClosedClosed: 1, OpenClosed: 2, ClosedOpen: 3 },
  OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
  TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
  ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2 },
  Uri: { file: (p) => ({ scheme: 'file', fsPath: p }) },

  window: {
    // D64：讲解进度挂在通知上（状态栏可能被用户关掉）。桩把每次 report 记下来，测例断言它
    withProgress: async (options, task) => {
      progressOptions.push(options);
      return task(
        { report: (m) => progressReports.push(m.message) },
        { onCancellationRequested: () => ({ dispose() {} }) },
      );
    },
    visibleTextEditors: [editor],
    activeTextEditor: editor,
    showInformationMessage: (m) => (messages.push(['info', m]), Promise.resolve(undefined)),
    showWarningMessage: (m) => (messages.push(['warn', m]), Promise.resolve(warningAnswer)),
    showErrorMessage: (m) => (messages.push(['error', m]), Promise.resolve(undefined)),
    showQuickPick: (items) => {
      quickPicks.push(items);
      // S2：capture 先弹一次确认。答什么由 `quickPickAnswer` 决定 ——
      // undefined 表示用户按了 Esc，那条路径也要能跑（取消不该起会话）。
      return Promise.resolve(items.find((i) => i.label === quickPickAnswer));
    },
    createOutputChannel: (name) => ({
      name,
      appendLine: (line) => outputLines.push(line),
      append: (line) => outputLines.push(line),
      dispose() {},
    }),
    openTextDocument: () => Promise.resolve(editor.document),
    showTextDocument: () => Promise.resolve(editor),
    // S8：活动栏里的「开始」视图。这条冒烟跑的是"捕获→讲解→高亮"那条链路，
    // 面板的宿主侧行为由 `smoke-extension.mjs` 真跑（那边会拿到 provider 并驱动它）。
    // 这里只需要"注册不炸"——多写一份驱动只会变成两处都要改的重复。
    registerWebviewViewProvider: () => ({ dispose() {} }),
    createTextEditorDecorationType(options) {
      const type = { options, dispose() {} };
      decorationTypes.push(type);
      return type;
    },
    createStatusBarItem() {
      const item = {
        text: '',
        shown: false,
        show() {
          item.shown = true;
        },
        hide() {
          item.shown = false;
        },
        dispose() {},
      };
      statusItems.push(item);
      return item;
    },
    createWebviewPanel(viewType, title, column, options) {
      const panel = {
        viewType,
        title,
        options,
        disposed: false,
        webview: {
          cspSource: 'vscode-webview://smoke',
          html: '',
          posted: [],
          postMessage(message) {
            panel.webview.posted.push(message);
            return Promise.resolve(true);
          },
          onDidReceiveMessage(cb) {
            receiveFromWebview = cb;
            return { dispose() {} };
          },
        },
        onDidDispose(cb) {
          panel._onDispose = cb;
          return { dispose() {} };
        },
        reveal() {},
        dispose() {
          panel.disposed = true;
          panel._onDispose?.();
        },
      };
      webviews.push(panel);
      return panel;
    },
  },

  commands: {
    registerCommand(id, handler) {
      registered.set(id, handler);
      return { dispose() {} };
    },
    executeCommand(id, ...args) {
      executed.push({ id, args });
      return Promise.resolve(undefined);
    },
  },

  workspace: {
    workspaceFolders: [{ uri: { fsPath: FIXTURES }, name: 'fixtures', index: 0 }],
    textDocuments: [],
    asRelativePath: (uri) => path.relative(FIXTURES, uri.fsPath).split(path.sep).join('/'),
    // S9a：候选文件清单要靠它扫工作区。桩必须真的扫（按扩展名过滤 fixtures 目录），
    // 否则 `listRelatedFiles` 会走进"扫不出来就返回空清单"那条路，而**空清单与"这个工作区
    // 里没有相关文件"在断言里长得一模一样** —— 死参数那个 bug 就是这么在全绿的冒烟里活下来的
    findFiles: (glob, _exclude, limit) => {
      const exts = /\.\{([^}]+)\}/.exec(String(glob))?.[1]?.split(',') ?? [];
      const out = [];
      const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (out.length >= (limit ?? 400)) return;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (exts.some((ext) => entry.name.endsWith(`.${ext}`))) {
            out.push({ fsPath: full, path: full.split(path.sep).join('/') });
          }
        }
      };
      walk(FIXTURES);
      return Promise.resolve(out);
    },
    // S3：命令层每次讲解都现读配置（改完设置不必重载窗口），所以这个桩是必经之路
    getConfiguration: () => ({ get: (key) => settingsValues[key] }),
    applyEdit() {
      applyEditCalls += 1;
      return Promise.resolve(true);
    },
    onDidChangeTextDocument: () => ({ dispose() {} }),
    // S8：开始面板显示"模型"那一行，改设置要让它立刻变（这里不需要触发，只要不炸）
    onDidChangeConfiguration: () => ({ dispose() {} }),
    // 把回调留下来：第 6 节要手动触发"讲解期间文件被关掉"这条回归路径
    onDidCloseTextDocument: (cb) => {
      onCloseDocument = cb;
      return { dispose() {} };
    },
    fs: {
      readFile: (uri) => Promise.resolve(readFileSync(uri.fsPath)),
      stat: (uri) => (existsSync(uri.fsPath) ? Promise.resolve(statSync(uri.fsPath)) : Promise.reject(new Error('ENOENT'))),
    },
  },

  // S6：线2 装没装，会改变"点侧边栏定位"那一跳的行为
  // S8：开始面板还要在装/卸线2 时刷新
  extensions: {
    getExtension: (id) => (peerPdfInstalled && id === 'anchor.anchor-pdf' ? { id } : undefined),
    onDidChange: () => ({ dispose() {} }),
  },
};

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
Module._load = function patched(request, ...rest) {
  if (request === 'vscode') return vscodeStub;
  return originalLoad.call(this, request, ...rest);
};

// ---- 取装饰结果的小工具 ----------------------------------------------------
/** §4.3 的映射就是断言本身：按配色/描边反查 decoration type。 */
const typeByBackground = (id) => decorationTypes.find((t) => t.options.backgroundColor?.id === id);
const typeByBorderColor = (id) => decorationTypes.find((t) => t.options.borderColor?.id === id);
const linesOf = (type) =>
  (editor.decorations.get(type) ?? []).map((r) => (r.start.line === r.end.line ? `${r.start.line + 1}` : `${r.start.line + 1}-${r.end.line + 1}`));

/**
 * `player.render()` 是异步的（要先确保目标文件在编辑器里打开），
 * 所以命令回调返回之后还要放一轮事件循环，装饰才落到编辑器上。
 */
// 让异步渲染落定。播放器的 render 是**异步**的（打开文件 + 滚过去 + 画框），
// 而且从 D70 起**同一时刻只跑一次**（堆积时只保留最后一拍）—— 于是"按几次 next 再断言"
// 中间要多让几跳。这里固定让两轮宏任务过去，断言才不会跟渲染抢跑。
const flush = async () => {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

// ---- 跑 -------------------------------------------------------------------
console.log(`[chain] 产物：${path.relative(ROOT, BUNDLE)}`);
console.log(`[chain] 样本：test/fixtures/main.c（${lineCount} 行）\n`);

const beforeBytes = sha1(readFileSync(MAIN_C));

const ext = require(BUNDLE);
const subscriptions = [];
ext.activate({
  subscriptions: { push: (...items) => subscriptions.push(...items) },
  globalStorageUri: { fsPath: path.join(ROOT, '.tmp-smoke', 'User', 'globalStorage', 'anchor.anchor-explain') },
  // S3：apiKey 默认从 SecretStorage 读（§6 的 preferSecretStorage），所以桩必须有一个
  secrets: {
    get: () => Promise.resolve(secretValue),
    store: (name, value) => {
      secretValue = value;
      return Promise.resolve();
    },
    delete: () => {
      secretValue = undefined;
      return Promise.resolve();
    },
  },
});

check(decorationTypes.length === 0, '激活阶段不建 decoration type（延迟到第一次讲解）');

// ---- 1. 坏锚点必须被跨扩展入口挡下 ----------------------------------------
await registered.get('anchorExplain.explainAnchor')?.({ sourceType: 'code', sourceId: 1 });
check(messages.at(-1)?.[0] === 'error', '非法锚点走错误提示', messages.at(-1)?.[1] ?? '(无)');
check(webviews.length === 0, '非法锚点没有起会话');

// ---- 2. 正常捕获 -----------------------------------------------------------
// S2 起 capture 之前会先弹一次确认。默认按「讲解这段」答，让本节验的还是"选中一段"这条主路径；
// 整文件 / 取消 / 只放光标三条分支在第 9 节单独走。
quickPickAnswer = '讲解这段';
await registered.get('anchorExplain.capture')?.();

check(webviews.length === 1, '捕获后建了侧边栏面板');
check(decorationTypes.length === 5, '建了 5 个 decoration type（1 个步级底色 + 4 档 emphasis）', `${decorationTypes.length}`);
check(
  executed.some((c) => c.id === 'setContext' && c.args[0] === 'anchorExplain.walkthroughActive' && c.args[1] === true),
  'context key 置为 true（键位 when 生效的前提）',
);

const update = webviews[0].webview.posted.at(-1);
check(update?.type === 'session:update', '侧边栏收到 session:update', update?.type ?? '(无)');
check(update?.result?.steps?.length === 3, '讲解结果是 3 个 step', `${update?.result?.steps?.length}`);
check(update?.index === 0 && update?.state === 'running', '首帧是 running / 第 0 步');
check(update?.pointIndex === -1, '首帧停在第 0 步的"整块"那一拍（不是直接扫点）', `pointIndex=${update?.pointIndex}`);
check(
  typeof webviews[0].webview.html === 'string' &&
    webviews[0].webview.html.includes('ui:ready') &&
    webviews[0].webview.html.includes('acquireVsCodeApi'),
  'webview HTML 是内联客户端脚本的完整文档',
);
check(
  webviews[0].webview.html.includes('ANCHOR_CHORDS') && webviews[0].webview.html.includes('"next":"alt+]"'),
  '用户实际键位被内联进 webview（面板有焦点时客户端自己派发，D47）',
);
// 排版的两条对齐纪律 + 一条层级纪律（D50）：这几条脚本判不了观感，但能判"东西有没有到产物里"
const html = webviews[0].webview.html;
check(
  html.includes('--anchor-tag-w') && html.includes('--anchor-gutter-w'),
  '标签列与标记槽的固定宽进了产物（否则讲解文字左边缘会逐行错开）',
);
check(
  html.includes('"mark"') || html.includes("'mark'"),
  '每一行子高亮都带固定宽的标记槽（▸ 不再把那一行顶右）',
);
check(
  html.includes('.step:not(.current)') || html.includes('anchor-scanning'),
  '非当前步压暗 + 扫描行锚点都在产物里（"突出点"靠这两条）',
);

// 第 1 步：整块 40-42，**只有一个点被点亮**（第一拍 = 只铺底色）
check(
  linesOf(typeByBackground('editor.selectionHighlightBackground')).join() === '40-42',
  '步级底色铺在第 40-42 行',
  linesOf(typeByBackground('editor.selectionHighlightBackground')).join() || '(空)',
);
check(
  linesOf(typeByBackground('editor.wordHighlightBackground')).length === 0 &&
    linesOf(typeByBorderColor('editorInfo.foreground')).length === 0,
  '整块那一拍：一个子高亮都不亮（"隔行乱变颜色"就是这么修掉的）',
  `context=${linesOf(typeByBackground('editor.wordHighlightBackground')).join() || '空'} definition=${linesOf(typeByBorderColor('editorInfo.foreground')).join() || '空'}`,
);
check(reveals.at(-1)?.kind === 1, '用 InCenter 定位（TextEditorRevealType.InCenter = 1）', `kind=${reveals.at(-1)?.kind}`);
check(statusItems[0]?.shown === true, '状态栏显示中');
check(statusItems[0]?.text.includes('下一步'), '状态栏提示里带键位', statusItems[0]?.text ?? '');
check(statusItems[0]?.text.includes('1/3 步'), '状态栏显示步进度', statusItems[0]?.text ?? '');

// §4.3 的硬指标：半透明主题色 + isWholeLine + ClosedClosed。一次把 5 个 type 全查一遍。
check(
  decorationTypes.every((t) => t.options.isWholeLine === true),
  '5 个 decoration type 全部 isWholeLine',
);
check(
  decorationTypes.every((t) => t.options.rangeBehavior === 1),
  '5 个 decoration type 全部 ClosedClosed（编辑时框不撑到新行）',
  decorationTypes.map((t) => t.options.rangeBehavior).join(','),
);
check(
  decorationTypes.every((t) => t.options.backgroundColor instanceof ThemeColor),
  '5 个 decoration type 的背景都是 ThemeColor（主题变量，无写死十六进制）',
);
check(
  !JSON.stringify(decorationTypes.map((t) => t.options)).match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/),
  '没有任何写死颜色',
);

// ---- 3. 扫描与流转 ---------------------------------------------------------
// 第 2 拍：扫第 1 步的第 1 个点（40 行 ·上下文）
registered.get('anchorExplain.next')?.();
await flush();
check(
  webviews[0].webview.posted.at(-1)?.pointIndex === 0,
  'next 从"整块"进到"扫第 1 个点"',
  `pointIndex=${webviews[0].webview.posted.at(-1)?.pointIndex}`,
);
check(
  linesOf(typeByBackground('editor.wordHighlightBackground')).join() === '40',
  'context 档点亮在第 40 行',
  linesOf(typeByBackground('editor.wordHighlightBackground')).join() || '(空)',
);
check(
  linesOf(typeByBackground('editor.selectionHighlightBackground')).join() === '40-42',
  '扫描时块级底色不变（40-42 仍然整块铺着）',
  linesOf(typeByBackground('editor.selectionHighlightBackground')).join() || '(空)',
);
check(
  linesOf(typeByBorderColor('editorInfo.foreground')).length === 0,
  '只亮一个点：另一个点（42 行 ·定义）此刻不许亮',
  linesOf(typeByBorderColor('editorInfo.foreground')).join() || '空',
);

// 第 3 拍：扫第 1 步的第 2 个点（42 行 ·定义），上一个点必须灭掉
registered.get('anchorExplain.next')?.();
await flush();
check(
  webviews[0].webview.posted.at(-1)?.pointIndex === 1,
  '再 next 进到"扫第 2 个点"',
  `pointIndex=${webviews[0].webview.posted.at(-1)?.pointIndex}`,
);
check(
  linesOf(typeByBorderColor('editorInfo.foreground')).join() === '42',
  'definition 档（左侧边线）点亮在第 42 行',
  linesOf(typeByBorderColor('editorInfo.foreground')).join() || '(空)',
);
check(
  linesOf(typeByBackground('editor.wordHighlightBackground')).length === 0,
  '上一个点（40 行 ·上下文）已灭',
  linesOf(typeByBackground('editor.wordHighlightBackground')).join() || '空',
);
check(
  executed.filter((c) => c.id === 'setContext' && c.args[1] === true).length >= 1 &&
    webviews[0].webview.posted.at(-1)?.state === 'running',
  '扫描过程中会话一直是活的',
);

// 第 4 拍：进第 2 步的整块拍
registered.get('anchorExplain.next')?.();
await flush();
const stepTwo = webviews[0].webview.posted.at(-1);
check(stepTwo?.index === 1 && stepTwo?.pointIndex === -1, '扫完第 1 步的两个点才进第 2 步的整块拍', `index=${stepTwo?.index} pointIndex=${stepTwo?.pointIndex}`);
check(
  linesOf(typeByBackground('editor.selectionHighlightBackground')).join() === '44-45',
  '第 2 步的底色换到第 44-45 行（上一步的框全灭）',
  linesOf(typeByBackground('editor.selectionHighlightBackground')).join() || '(空)',
);
check(
  decorationTypes.every(
    (t) => linesOf(t).length === 0 || t.options.backgroundColor?.id === 'editor.selectionHighlightBackground',
  ),
  '第 2 步的整块拍上没有多余的点亮',
);

// 第 5 拍：扫第 2 步的第 1 个点（44 行 ·重点）
registered.get('anchorExplain.next')?.();
await flush();
check(
  linesOf(typeByBorderColor('editor.findMatchBorder')).join() === '44',
  'primary 档（强调描边）点亮在第 44 行',
  linesOf(typeByBorderColor('editor.findMatchBorder')).join() || '(空)',
);

// 走到第 3 步的**第 1 个点**（拍数 = 1+2 + 1+2 + 1+2 = 9；这一拍是 caveat 46）
for (let i = 0; i < 3; i += 1) registered.get('anchorExplain.next')?.();
await flush();
const caveatBeat = webviews[0].webview.posted.at(-1);
check(
  caveatBeat?.index === 2 && caveatBeat?.pointIndex === 0,
  '走到第 3 步的第 1 个点（caveat 那一拍）',
  `index=${caveatBeat?.index} pointIndex=${caveatBeat?.pointIndex}`,
);
check(
  linesOf(typeByBorderColor('editorWarning.foreground')).join() === '46',
  'caveat 档（虚线警示）点亮在第 46 行',
  linesOf(typeByBorderColor('editorWarning.foreground')).join() || '(空)',
);

// 再走一拍：点亮的换成下一个点，**上一个点的框必须同时清掉**（"一次只点亮一个点"）
// 这一条只有等渲染真的落定才测得出来 —— 渲染是异步的，而 D70 起同一时刻只跑一次（堆积只留最后一拍）
registered.get('anchorExplain.next')?.();
await flush();
const lastBeat = webviews[0].webview.posted.at(-1);
check(lastBeat?.index === 2 && lastBeat?.pointIndex === 1, '走到第 3 步的第 2 个点 = 最后一拍', `index=${lastBeat?.index} pointIndex=${lastBeat?.pointIndex}`);
check(lastBeat?.state === 'running', '还在最后一拍时状态不是 done（还能再按一次）');
check(
  linesOf(typeByBorderColor('editorWarning.foreground')).join() === '',
  '换点之后上一拍的 caveat 框已经清掉（不是两拍的框叠在一起）',
  linesOf(typeByBorderColor('editorWarning.foreground')).join() || '(空)',
);
check(
  linesOf(typeByBackground('editor.wordHighlightBackground')).join() === '47',
  '这一拍点亮的是第 47 行（context 档）',
  linesOf(typeByBackground('editor.wordHighlightBackground')).join() || '(空)',
);

registered.get('anchorExplain.next')?.();
await flush();
const doneFrame = webviews[0].webview.posted.at(-1);
check(doneFrame?.state === 'done', '最后一拍再 next 落成 done', doneFrame?.state ?? '(无)');
check(
  executed.filter((c) => c.id === 'setContext' && c.args[0] === 'anchorExplain.walkthroughActive' && c.args[1] === false)
    .length >= 1,
  '讲完后 walkthroughActive 落回 false（alt+] / alt+[ 失效）',
);
check(
  executed.some(
    (c) => c.id === 'setContext' && c.args[0] === 'anchorExplain.sessionOpen' && c.args[1] === true,
  ),
  'sessionOpen 在 done 时仍为 true（否则 ESC 变哑、框清不掉，D46）',
);
check(
  statusItems[0]?.text.includes('已讲完'),
  '状态栏文案在 done 时是「已讲完」而不是「讲解中」',
  statusItems[0]?.text ?? '',
);
check(
  !statusItems[0]?.text.includes('下一步') && !statusItems[0]?.text.includes('上一步'),
  'done 时状态栏不再展示已失效的 next / prev 键',
  statusItems[0]?.text ?? '',
);
check(statusItems[0]?.text.includes('退出'), 'done 时仍然展示「退出」（它还有效）', statusItems[0]?.text ?? '');

// done 之后再按 next：不应越界，也不应把状态从 done 拽回 running
registered.get('anchorExplain.next')?.();
await flush();
check(webviews[0].webview.posted.at(-1)?.state === 'done', 'done 之后 next 不再是"讲解中"');

// ---- 4. webview 重新加载 → 握手重放 ----------------------------------------
const postedBefore = webviews[0].webview.posted.length;
receiveFromWebview?.({ type: 'ui:ready' });
check(
  webviews[0].webview.posted.length - postedBefore === postedBefore,
  'ui:ready 触发全量重放（重开面板不会是空白）',
  `重放 ${webviews[0].webview.posted.length - postedBefore} 条`,
);
receiveFromWebview?.({ type: 'ui:evil' });
check(
  webviews[0].webview.posted.length === postedBefore * 2,
  '未知消息类型被挡下，不触发任何重放',
);

// ---- 5. 退出：清框 + 落 context + 停状态栏 ---------------------------------
registered.get('anchorExplain.stop')?.();
const uncleared = decorationTypes.filter((t) => linesOf(t).length > 0);
check(uncleared.length === 0, 'stop 后所有 decoration type 都被清空（不留残影）', `${uncleared.length} 个没清`);
check(webviews[0].webview.posted.at(-1)?.type === 'session:end', '侧边栏收到 session:end');
check(statusItems[0]?.shown === false, '状态栏隐藏');
check(
  executed.some((c) => c.id === 'setContext' && c.args[0] === 'anchorExplain.sessionOpen' && c.args[1] === false),
  'stop 之后 sessionOpen 落回 false',
);
check(
  decorationTypes.every((t) => editor.decorations.get(t)?.length === 0),
  '每个 type 都被显式设成空数组（而不是"没动过"）',
);

// ---- 6. 纯视觉：文件一个字节都没变 ----------------------------------------
const afterBytes = sha1(readFileSync(MAIN_C));
check(afterBytes === beforeBytes, 'main.c 字节未变（高亮是纯装饰）');
check(applyEditCalls === 0, 'workspace.applyEdit 从未被调用');

// ---- 7. 回归：讲解期间目标文件被关掉，stop() 必须照样收完尾 -----------------
// 这就是用户报的"按 Esc 没反应、后面都没法测了"：编辑器一旦释放，
// `setDecorations` 会抛；修之前异常会把 stop() 后面的收尾全部跳过，会话卡在半死状态。
closed = true;
const contextBefore = executed.filter((c) => c.id === 'setContext').length;

await registered.get('anchorExplain.capture')?.(); // 起一个新的会话（此时编辑器已在桩里被标成已关闭）
check(webviews[0].webview.posted.at(-1)?.type === 'session:update', '文件已关闭时仍能起讲解（渲染退化为无高亮）');

let stopThrew = false;
try {
  registered.get('anchorExplain.stop')?.();
} catch {
  stopThrew = true;
}
const contextAfter = executed.filter((c) => c.id === 'setContext').slice(contextBefore);
check(!stopThrew, 'stop() 在编辑器已释放时也不抛（异常不许逃出清框这一步）');
check(
  contextAfter.some((c) => c.args[0] === 'anchorExplain.sessionOpen' && c.args[1] === false) &&
    contextAfter.some((c) => c.args[0] === 'anchorExplain.walkthroughActive' && c.args[1] === false),
  '关文件后 stop() 仍然把两个 context key 都落回 false（收尾没有被打断）',
  JSON.stringify(contextAfter.map((c) => c.args)),
);
check(statusItems[0]?.shown === false, '关文件后 stop() 仍然收起了状态栏');
check(webviews[0].webview.posted.at(-1)?.type === 'session:end', '关文件后 stop() 仍然通知了侧边栏');

// 同一个坑的另一条路径：编辑器对象被释放但 isClosed 没报（只有 try/catch 能兜住）
closed = false;
disposedThrow = true;
await registered.get('anchorExplain.capture')?.();
let stopThrew2 = false;
try {
  registered.get('anchorExplain.stop')?.();
} catch {
  stopThrew2 = true;
}
check(!stopThrew2, 'setDecorations 直接抛异常时 stop() 也不抛（try/catch 那一层兜住了）');
check(statusItems[0]?.shown === false, '这条路径下状态栏同样被收起');
disposedThrow = false;

// ---- 8. 真·onDidCloseTextDocument：讲解期间关文件 → 自动收工 ----------------
await registered.get('anchorExplain.capture')?.();
check(webviews[0].webview.posted.at(-1)?.type === 'session:update', '为关文件路径起了新会话');
closed = true;
let closeThrew = false;
try {
  onCloseDocument?.({ uri: { fsPath: MAIN_C } });
} catch {
  closeThrew = true;
}
check(!closeThrew, 'onDidCloseTextDocument 回调本身不抛');
check(webviews[0].webview.posted.at(-1)?.type === 'session:end', '关掉正在讲的文件会主动结束会话（§4.2）');
check(statusItems[0]?.shown === false, '关文件后状态栏已收起');
closed = false;

// ---- 9. S2：真选区接线 + 确认 UI 的四条分支 --------------------------------
// 这一节的本事在于**能区分真选区与替身**：替身写死 40-48 行，所以这里把桩的选区改成
// 一个替身绝不会给的值（第 10-14 行），再看锚点跟不跟着走。
// 放在最后跑：它每走一次都重开会话，会打乱第 3 节依赖的那条游标。
const stateLine = () => messages.at(-1)?.[1] ?? '';

selectionStartLine = 9;
selectionEndLine = 13; // 第 10-14 行

quickPicks.length = 0;
quickPickAnswer = '讲解这段';
await registered.get('anchorExplain.capture')?.();

const asked = quickPicks.at(-1) ?? [];
check(asked.length === 2, '有选区时确认框给两个选项（这段 / 整个文件）', `${asked.length}`);
check(
  asked.map((i) => i.label).join('|') === '讲解这段|讲解整个文件',
  '两个选项的文案与顺序都是定好的',
  asked.map((i) => i.label).join('|'),
);
check(asked[0]?.description === '第 10-14 行', '确认框里的行区间来自编辑器真实选区', asked[0]?.description ?? '');
check(asked[1]?.description === `共 ${lineCount} 行`, '「整个文件」选项报的是真实行数', asked[1]?.description ?? '');

await registered.get('anchorExplain.showState')?.();
check(stateLine().includes('第 10-14 行'), '锚点用的是刚选的那段，不是替身写死的 40-48', stateLine());
check(stateLine().includes('（选区）'), '捕获方式如实记为「选区」', stateLine());

// 「整个文件」：同一个编辑器、同一份文档，只是范围换成 1..总行数
quickPickAnswer = '讲解整个文件';
await registered.get('anchorExplain.capture')?.();
await registered.get('anchorExplain.showState')?.();
check(stateLine().includes(`第 1-${lineCount} 行`), '「整个文件」的锚点区间是 1..总行数', stateLine());
check(stateLine().includes('（整个文件）'), '捕获方式如实记为「整个文件」', stateLine());
check(stateLine().includes('第 10-14 行'), '整文件分支不影响编辑器里那个真实选区本身', stateLine());

// 只放光标：不该弹二选一（没有"这段"可讲），而是问一句要不要讲整份
selectionEmpty = true;
quickPicks.length = 0;
await registered.get('anchorExplain.capture')?.();
check(quickPicks.length === 0, '只放光标时**不弹**二选一（没有"这段"可选）');
check(stateLine().includes('只放了光标'), '只放光标 → 明确提示未选中内容', stateLine());

warningAnswer = '讲解整个文件';
await registered.get('anchorExplain.capture')?.();
await registered.get('anchorExplain.showState')?.();
check(stateLine().includes(`第 1-${lineCount} 行`), '在提示上点「讲解整个文件」→ 走整文件分支', stateLine());
warningAnswer = undefined;
selectionEmpty = false;

// 取消：确认框按 Esc 走开，什么都不该发生
quickPickAnswer = undefined;
const postedBeforeCancel = webviews[0].webview.posted.length;
const decorationTypesBefore = decorationTypes.length;
await registered.get('anchorExplain.capture')?.();
check(webviews[0].webview.posted.length === postedBeforeCancel, '取消确认 → 不起会话、不打扰');
check(decorationTypes.length === decorationTypesBefore, '取消确认 → 连 decoration type 都不该多建');

// 没有活动编辑器：与"只放光标"要用户做的事不同，提示也必须不同
vscodeStub.window.activeTextEditor = undefined;
await registered.get('anchorExplain.capture')?.();
check(stateLine().includes('先打开一个文件'), '没有活动编辑器 → 提示去打开文件（不是"未选中"）', stateLine());
vscodeStub.window.activeTextEditor = editor;

// 收尾前把桩恢复成主路径的样子（真选区接上之后它已经不带任何 S1 脚手架了）
quickPickAnswer = '讲解这段';
selectionStartLine = 39;
selectionEndLine = 47;

// ---- 10. S3：真编排循环（只有 fetch 这一跳是桩） ---------------------------
// 这一节的价值在于：从 `capture` 命令到"模型返回的那份 JSON"，中间跑的是
// 真的 Orchestrator、真的 §3.2 校验、真的 §3.3 闸门、真的 openAICompatible，
// 唯一被换掉的只有最外面那一跳 `fetch`。
quickPickAnswer = '讲解这段';
selectionStartLine = 39;
selectionEndLine = 47;
fetchMode = 'with-fetch';
fetchCalls.length = 0;
outputLines.length = 0;

const postedBeforeS3 = webviews[0].webview.posted.length;
await registered.get('anchorExplain.capture')?.();

check(webviews[0].webview.posted.length > postedBeforeS3, 'S3 主路径：讲解照常起来了');check(fetchCalls.length === 2, '取件一轮 = 两次模型调用（先要上下文，再给答案）', `${fetchCalls.length}`);

const firstCall = fetchCalls[0] ?? {};
check(firstCall.url === 'https://example.test/v1/chat/completions', '打的是配置里的 baseUrl（§6）', firstCall.url ?? '');
check(
  firstCall.headers?.authorization === 'Bearer sk-from-secret-storage',
  'apiKey 来自 SecretStorage，不是 settings 里的明文（§6 的 preferSecretStorage）',
  String(firstCall.headers?.authorization),
);
check(
  firstCall.body?.tools?.[0]?.function?.name === 'fetch_context',
  '§8 的工具定义随请求发出去了（不发出去模型永远没法要求取件）',
);
check(firstCall.body?.model === 'test-cheap', '用的是 tier1Model', String(firstCall.body?.model));

const secondMessages = fetchCalls[1]?.body?.messages ?? [];
const toolResult = secondMessages.find((m) => m.role === 'tool');
check(Boolean(toolResult), '模型要的上下文以 role=tool 回灌进了对话');
check(toolResult?.tool_call_id === 'call_1', 'tool 结果归属到了那次 tool_call（少了它端点会报错）');
check(
  /行 1-5（共 75 行）/.test(String(toolResult?.content ?? '')),
  '回灌的是 main.c 第 1-5 行、且报了全文行数',
  String(toolResult?.content ?? '').split('\n')[1] ?? '',
);
check(/\n\s*1\t/.test(String(toolResult?.content ?? '')), '取件内容带行号（模型要靠它算 location）');

const s3Update = webviews[0].webview.posted.at(-1);
check(s3Update?.result?.steps?.length === 3, '模型给的 JSON 过闸门后变成 3 个 step', `${s3Update?.result?.steps?.length}`);
check(
  linesOf(typeByBackground('editor.selectionHighlightBackground')).join() === '40-42',
  'S3 的结果与 S1/S2 画在同一处（同一个样本，同一条链路）',
  linesOf(typeByBackground('editor.selectionHighlightBackground')).join() || '(空)',
);
check(outputLines.some((l) => l.includes('取件')), '取件落进了输出通道（§7 要求每次取件都记录）', outputLines.at(-1) ?? '');

// ── S9a：跨文件取件的三条路径 ─────────────────────────────────────────────
// ① 合法：读锚点文件**同目录**的兄弟文件（相对路径按锚点目录解析）—— 这是嵌入式最常见的那一下
fetchMode = 'related';
fetchCalls.length = 0;
await registered.get('anchorExplain.capture')?.();
const relatedTool = (fetchCalls[1]?.body?.messages ?? []).find((m) => m.role === 'tool');
const relatedContent = String(relatedTool?.content ?? '');
check(!/请求被拒绝/.test(relatedContent), '跨文件读**相关文件**是放行的（不再是"漫游"）', relatedContent.slice(0, 60));
check(
  relatedContent.includes('ring_buffer.h') && relatedContent.includes('RB_CAPACITY'),
  '真把兄弟文件的**内容与行号**取回来了（宏/结构体就在这种文件里）',
  relatedContent.split('\n').slice(0, 2).join(' / '),
);
check(
  outputLines.some((l) => l.includes('取件') && l.includes('ring_buffer.h') && l.includes('start')),
  '取件日志里有**文件与行范围**（截图问题 3.4：AI 的背后操作要看得见）',
  outputLines.at(-1) ?? '',
);

// ② §8 的 `path` 必须真的在 schema 里 —— 不然模型没有"点名某个文件"这个动作，
//    "可以读别的文件"就只是一句它看不见的许可（S9a 交付时正是这样，D67）
const toolProps = fetchCalls[0]?.body?.tools?.[0]?.function?.parameters?.properties ?? {};
check(
  typeof toolProps.path?.type === 'string',
  '§8 的工具 schema 声明了 path（许可必须可执行，不能只写在提示里）',
  JSON.stringify(Object.keys(toolProps)),
);

// ③ 许可要写进 system，且**不能**同时留着"必须与锚点同一个文件"那句（自相矛盾=不敢引用）
const s9aSystem = String(fetchCalls[0]?.body?.messages?.[0]?.content ?? '');
const s9aUser = String(fetchCalls[0]?.body?.messages?.[1]?.content ?? '');
check(
  s9aSystem.includes('可以读锚点文件之外的相关文件') && !s9aSystem.includes('必须与锚点'),
  'system 里既有"可以往外读"的许可，也没有那句 S1 时代的"必须与锚点同一个文件"',
);
check(
  s9aUser.includes('可能相关的文件') && s9aUser.includes('ring_buffer.h'),
  '候选文件清单真的进了 user prompt（第一版它只是个死参数，模型不知道可以问谁）',
  s9aUser.includes('可能相关的文件') ? '有清单' : '没清单',
);

// ④ 最难的那一下：模型**读了兄弟文件，又在讲解里引用它**（filePath 写的是相对写法）。
//    内部闸门的允许集合是绝对路径、命令层第二道闸门收的是模型原样写的相对路径 ——
//    S9a 交付时这两套坐标对不上，所以这件事**必然**报错（用户实测的第一轮报错，D67）
fetchMode = 'related-ref';
fetchCalls.length = 0;
outputLines.length = 0;
await registered.get('anchorExplain.capture')?.();
// 取**带 result 的那条**，不是 `at(-1)`：讲解起来之后侧边栏还会继续收到状态/拍的消息
const refResult = [...webviews[0].webview.posted].reverse().find((m) => m?.result)?.result;
const refStep = refResult?.steps?.[0]?.location;
check(
  String(refStep?.filePath ?? '').toLowerCase() === SIBLING_ABS.toLowerCase(),
  '讲解的某一步可以落在**读过的兄弟文件**里，且交出来的是解析后的绝对路径',
  String(refStep?.filePath ?? `(没有这个 step；最后一条消息：${JSON.stringify(webviews[0].webview.posted.at(-1)).slice(0, 120)})`),
);
check(
  refResult?.steps?.length === 2,
  '这一轮讲解完整通过了 §3.3 闸门（没有降级成报错）',
  `带 result 的那条消息里有 ${refResult?.steps?.length ?? '0'} 个 step`,
);
check(
  outputLines.some((l) => l.includes('取件') && l.includes('ring_buffer.h')),
  '取件日志记的是**归一化后**的路径（日志要能复核到底读了哪个文件）',
  outputLines.at(-1) ?? '',
);

// ⑤ 侧边栏那块「取件日志」不许是假话（D68）。它曾经永远写着"本次讲解没有请求额外上下文"——
//    因为 `tooltrace:append` 协议里有、客户端也渲染了，**只有宿主从来没发过**。
const traceAppends = webviews[0].webview.posted.filter((m) => m?.type === 'tooltrace:append');
check(traceAppends.length >= 1, '取件记录真的推给了侧边栏（不是只有输出面板有）', `${traceAppends.length} 条`);
check(
  traceAppends.some(
    (m) => String(m.entry?.request?.params?.path ?? '').includes('ring_buffer.h') &&
      m.entry?.request?.params?.start === 10,
  ),
  '推给侧边栏的那条带着**文件与行范围**（截图问题 3.4 的验收就是这一句）',
  JSON.stringify(traceAppends.at(-1)?.entry?.request?.params ?? null),
);
check(
  webviews[0].webview.posted.some((m) => m?.type === 'tooltrace:reset'),
  '新一轮开始时先清空上一轮的日志（不然两轮会叠在一起）',
);
// D69：面板要拿锚点文件才能判断"这个位置要不要标文件名"（不在锚点文件里就标）
check(
  [...webviews[0].webview.posted].reverse().find((m) => m?.type === 'session:update')?.anchorPath === MAIN_C,
  'session:update 带着锚点文件（客户端据此给别的文件里的位置标上文件名）',
  String([...webviews[0].webview.posted].reverse().find((m) => m?.type === 'session:update')?.anchorPath),
);

// D69：内联脚本在**最终 HTML**（产物 → renderSidebarHtml → webview）里必须仍能解析。
// 一个转义写错就是整块空白面板，而屏幕上**不会有任何报错** —— 所以最后一环也要解析一遍。
const sidebarInline = /<script[^>]*>([\s\S]*?)<\/script>/.exec(webviews[0].webview.html)?.[1] ?? '';
check(sidebarInline.length > 0, '侧边栏 HTML 里带着内联脚本', `${webviews[0].webview.html.length} 字`);
let inlineParseOk = true;
let inlineParseErr = '';
try {
  new Function(sidebarInline);
} catch (err) {
  inlineParseOk = false;
  inlineParseErr = String(err && err.message ? err.message : err);
}
check(inlineParseOk, '内联脚本在最终产物里仍能解析（解析不过 = 面板一片空白）', inlineParseErr);

// ⑥ 讲解进行中再按一次：不许开出第二份（D68）。白烧一份 token 之外，屏幕上还会多出一个
//    要等它自己跑完才消失的进度通知 —— 用户截图里那条"正在讲解: 第 2 轮取件被拒"就是它。
//    诊断靠输出通道那两行"开始/结束"：光看屏幕分不清"通知滞留"与"两份在跑"。
fetchMode = 'related';
fetchCalls.length = 0;
outputLines.length = 0;
const firstRun = registered.get('anchorExplain.capture')?.();
const secondRun = registered.get('anchorExplain.capture')?.();
await Promise.all([firstRun, secondRun]);
check(
  fetchCalls.length === 2,
  '讲解进行中重复按下不产生第二次讲解（一次讲解 = 2 次模型调用）',
  `${fetchCalls.length} 次模型调用`,
);
check(
  outputLines.filter((l) => l.includes('讲解开始')).length === 1,
  '日志里只有一次"讲解开始"（一眼看出只开了一份）',
  outputLines.filter((l) => l.includes('讲解开始')).join(' | '),
);
check(
  outputLines.some((l) => l.includes('重复按下被忽略')),
  '被挡下的那一次在日志里留了痕（不然屏幕上分不清滞留通知与两份在跑）',
  outputLines.find((l) => l.includes('重复按下被忽略')) ?? '(没有)',
);
check(
  outputLines.some((l) => l.includes('讲解的等待结束')),
  '等待阶段结束也留了一行 —— 它是"进度通知此刻已关闭"的凭据',
  outputLines.find((l) => l.includes('讲解的等待结束')) ?? '(没有)',
);

// ② 工作区之外：拒
fetchMode = 'outside';
fetchCalls.length = 0;
await registered.get('anchorExplain.capture')?.();
const outsideTool = (fetchCalls[1]?.body?.messages ?? []).find((m) => m.role === 'tool');
check(/请求被拒绝/.test(String(outsideTool?.content ?? '')), '工作区之外的文件被拒，且原因是回灌而不是抛错');
check(/不在允许的范围内/.test(String(outsideTool?.content ?? '')), '拒绝原因说清了边界在哪');

// ③ 密钥类：拒（模型能读工作区任意文件之后，这一条是必须的）
fetchMode = 'secret';
fetchCalls.length = 0;
await registered.get('anchorExplain.capture')?.();
const secretTool = (fetchCalls[1]?.body?.messages ?? []).find((m) => m.role === 'tool');
check(/按约定不读/.test(String(secretTool?.content ?? '')), '密钥类文件按约定不读（`.env` 也在射程内，必须挡住）');
check(webviews[0].webview.posted.at(-1)?.type === 'session:update', '被拒之后整次讲解仍然继续（不是整段失败）');
check(outputLines.some((l) => l.includes('拒绝')), '被拒的取件也落了日志（被拒原因正是要看的）');

// 一直要上下文：必须在有限轮之后收场，并给用户一句人话
fetchMode = 'always-fetch';
settingsValues = { ...settingsValues, maxFetchRounds: 1 };
await registered.get('anchorExplain.capture')?.();
check(messages.at(-1)?.[0] === 'error', '模型一直要上下文 → 明确报错而不是转圈', messages.at(-1)?.[1] ?? '');
check(
  /被拒 2 次/.test(String(messages.at(-1)?.[1] ?? '')) && /maxFetchRounds/.test(String(messages.at(-1)?.[1] ?? '')),
  '错误里说清了"被拒几次 + 该调哪个设置"（照得做）',
  String(messages.at(-1)?.[1] ?? ''),
);
check(fetchCalls.length <= 8, '调用次数有界，不会无限循环', `${fetchCalls.length}`);
settingsValues = { ...settingsValues, maxFetchRounds: 3 };
fetchMode = 'with-fetch';

// 没配置 provider：明确报错，不静默什么都不做
const savedProviders = settingsValues.providers;
settingsValues = { ...settingsValues, providers: {} };
await registered.get('anchorExplain.capture')?.();
check(/没有可用的 provider/.test(String(messages.at(-1)?.[1] ?? '')), '没配 provider 时给的是"去改哪个设置键"', messages.at(-1)?.[1] ?? '');
settingsValues = { ...settingsValues, providers: savedProviders };

// 网络层失败：转成一句带端点地址的人话
fetchFail = 'getaddrinfo ENOTFOUND example.test';
await registered.get('anchorExplain.capture')?.();
check(/连不上/.test(String(messages.at(-1)?.[1] ?? '')), '连不上端点时错误里带上了地址', messages.at(-1)?.[1] ?? '');
fetchFail = undefined;

// 图省事而漏掉的一环：确认框取消时**一次网络请求都不该发**
quickPickAnswer = undefined;
const fetchCallsBeforeCancel = fetchCalls.length;
await registered.get('anchorExplain.capture')?.();
check(fetchCalls.length === fetchCallsBeforeCancel, '取消确认时一次网络请求都不发（不白花钱）');
quickPickAnswer = '讲解这段';

// ---- 11. S6：PDF 锚点走线1（不画框 + 点击滚页） ----------------------------
// 这一节把线2 交出来的那种锚点灌进线1 的跨扩展入口，验三件用户在 F5 才会发现的事：
//   1. PDF 锚点也能出讲解（侧边栏每条 step 带「第 N 页」标签）
//   2. **编辑器里一个框都不画**（约束 1 在这一侧也要成立）
//   3. 点侧边栏那条位置标签 → `anchorPdf.revealPage`（滚动），不是画框
const pdfAnchor = {
  sourceType: 'pdf',
  sourceId: 'sha1:pdf',
  sourceName: 'sample-30p.pdf',
  location: { page: 23, bbox: [0.1, 0.1, 0.6, 0.4] },
};

// 先收掉上一节留下的框，免得下面的断言把旧框算进来
registered.get('anchorExplain.stop')?.();

fetchCalls.length = 0;
await registered.get('anchorExplain.explainAnchor')?.(pdfAnchor);

const pdfUpdate = webviews[0].webview.posted.at(-1);
check(pdfUpdate?.type === 'session:update', 'PDF 锚点也能起讲解（跨扩展入口 §5.1）');
check(pdfUpdate?.result?.steps?.length === 2, 'PDF 讲解有两个 step', `${pdfUpdate?.result?.steps?.length}`);
check(
  pdfUpdate?.result?.steps?.[0]?.location?.page === 23,
  'step 的 location 是 PDF 位置（侧边栏据此显示「第 23 页」）',
  JSON.stringify(pdfUpdate?.result?.steps?.[0]?.location),
);

const dirty = decorationTypes.filter((t) => (editor.decorations.get(t) ?? []).length > 0);
check(dirty.length === 0, '**PDF 会话一拍都不画框**（约束 1：PDF 上不出现任何高亮框）', `${dirty.length} 个 type 有框`);

// 点「第 23 页」那条 → 应该去滚 PDF，而不是去编辑器里定位
executed.length = 0;
receiveFromWebview?.({ type: 'ui:revealStep', index: 0 });
await flush();
const revealCall = executed.find((c) => c.id === 'anchorPdf.revealPage');
check(Boolean(revealCall), '点 PDF 那一步 → 调 anchorPdf.revealPage（滚动定位）', executed.map((c) => c.id).join(','));
check(revealCall?.args?.[0] === 23, '带的是那一步的页码', String(revealCall?.args?.[0]));

// 对端缺失：明确提示，不静默失败（§5.1）
peerPdfInstalled = false;
executed.length = 0;
messages.length = 0;
receiveFromWebview?.({ type: 'ui:revealStep', index: 0 });
await flush();
check(!executed.some((c) => c.id === 'anchorPdf.revealPage'), '没装线2 时不去 executeCommand（会抛"命令未找到"）');
check(messages.some((m) => String(m[1]).includes('没有安装线2')), '没装线2 时明确提示', String(messages.at(-1)?.[1] ?? ''));
peerPdfInstalled = true;

// 代码锚点仍然走播放器（两条线的定位方式必须是两套）
quickPickAnswer = '讲解这段';
await registered.get('anchorExplain.capture')?.();
executed.length = 0;
reveals.length = 0;
receiveFromWebview?.({ type: 'ui:revealStep', index: 0 });
await flush();
check(!executed.some((c) => c.id === 'anchorPdf.revealPage'), '代码锚点**不**去调线2（不然会在 PDF 里瞎滚）');
check(reveals.length > 0, '代码锚点走的是编辑器里的定位（revealRange）', `${reveals.length} 次`);

// ---- D64：讲解期间屏幕上必须有东西在动（用户报的是"点两次才有反应"） -----------------
// 状态栏可以被用户关掉（真的关了：workbench.statusBar.visible=false），所以进度必须也挂在通知上，
// 而且**取件那一段也要变成进度** —— 它在等磁盘/等解析，是最容易被误认为"卡住了"的时刻。
check(progressOptions.some((o) => o.location === 15 && o.cancellable === true), '进度挂在通知上，且可取消');
check(
  progressReports.some((m) => m.includes('正在请求模型')),
  '报告了"正在请求模型…"（模型在后台跑的时候，屏幕上得有字）',
  progressReports.join(' | ').slice(0, 160),
);
check(
  progressReports.some((m) => m.includes('取件')),
  '取件那一段也变成了进度（AI 的"背后操作"要看得见）',
  progressReports.filter((m) => m.includes('取件')).join(' | '),
);
// D68：进度那两句话都要说人话，并且**指向正在发生的事**（拒绝不是错误 —— 用户会把它读成"出错了"）
check(
  progressReports.some((m) => /已读 .+ 的 \d+-\d+ 行/.test(m) && m.includes('正在等它的结论')),
  '取到件那条进度写的是"已读哪个文件的哪几行"，不是一坨 JSON，且尾巴朝向"正在等结论"',
  progressReports.find((m) => m.includes('已读')) ?? '(没有)',
);
check(
  progressReports.some((m) => m.includes('正在等它基于现有信息作答')),
  '被拒那条的尾巴也是"正在等它作答"，而不是停在"被拒"两个字上',
  progressReports.find((m) => m.includes('被拒')) ?? '(没有)',
);

// ---- 收尾 -----------------------------------------------------------------
Module._load = originalLoad;

if (failures.length) {
  console.error(`\n[chain] 失败 ${failures.length} 项：`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\n[chain] 全部通过');
