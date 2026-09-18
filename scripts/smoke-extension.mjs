/**
 * 打包产物冒烟测试 —— 不启动 VS Code，直接 require `dist/extension.cjs`。
 *
 * 只对**最外层边界**打桩：把 `vscode` 模块换成假的（这就是 SLICES.md 说的
 * "假货只允许出现在最外层边界"）。除此之外全是真的：真产物、真 require、
 * 真的走 `activate` → `registerCommand` → 命令回调。
 *
 * 它守住四件事，任何一件坏了都在命令层面立刻可见，不用靠 F5 肉眼看：
 *   1. 产物是合法 CommonJS（宿主的 require 不吃 ESM 入口）
 *   2. activate 确实注册了命令，且**与 package.json 声明的命令逐一对齐**
 *      （声明了没注册 → 用户点了报"命令未找到"；注册了没声明 → 命令面板里看不见）
 *   3. 命令回调能跑通，且 `@anchor/core` 真的被 bundle 进去了（不是只"编译通过"）
 *   4. 侧边栏 webview 的 HTML/客户端脚本确实活到了产物里（它们是字符串常量，
 *      打包器一旦把它们当死代码去掉，F5 时才会表现为"面板一片空白"）
 *
 * 用法：node scripts/smoke-extension.mjs
 */

import Module from 'node:module';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_DIR = path.join(ROOT, 'packages', 'extension-anchor');
const BUNDLE = path.join(PKG_DIR, 'dist', 'extension.cjs');
const SHOW_STATE = 'anchorExplain.showState';
const PEER_ID = 'Fish-zjuer.anchor-pdf';

const pkg = JSON.parse(readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'));
const declaredCommands = pkg.contributes.commands.map((c) => c.command);
const declaredKeybindings = pkg.contributes.keybindings;

const failures = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` —— ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

// ---- 桩：vscode 模块 -------------------------------------------------------
const messages = [];
const registered = new Map();
const statusBarItems = [];
const executedCommands = [];
const webviewViews = [];
/** 输入框排队的答案（`undefined` = 用户按了 Esc）；`warningAnswer` = 警告框点了哪颗按钮 */
const inputAnswers = [];
let warningAnswer;
/** 设置写入的记录（`Anchor: 配置模型端点` 会写它 —— 这条要验） */
const settingsWrites = [];
/** D64：进度的 report 文案 */
const progressReports = [];
const progressOptions = [];
let activeTextEditor;
let peerInstalled = false;

const vscodeStub = {
  StatusBarAlignment: { Left: 1, Right: 2 },
  // 状态栏的 tooltip 是 MarkdownString（D81 起队列那一项也用它）。
  // 桩里缺它的话，`item.tooltip = new vscode.MarkdownString(...)` 那一行会抛 —— 而在
  // `isolated()` 里抛出只留一行日志，屏幕上看就是"状态栏没出来"，又是一个"点了没反应"。
  MarkdownString: class MarkdownString {
    constructor(value = '') {
      this.value = value;
    }
  },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  // S8：`Anchor: 配置模型端点` 用 `ConfigurationTarget.Global` 写用户设置。
  // 漏了它的话 `update()` 会抛 TypeError，而那正好又是一次"点了没反应" —— 桩必须齐。
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  window: {
    // D64：讲解进度挂在通知上（状态栏可能被用户关掉）。桩把每次 report 记下来，测例断言它
    withProgress: async (options, task) => {
      progressOptions.push(options);
      return task(
        { report: (m) => progressReports.push(m.message) },
        { onCancellationRequested: () => ({ dispose() {} }) },
      );
    },
    get activeTextEditor() {
      return activeTextEditor;
    },
    showInformationMessage(msg) {
      messages.push(msg);
      return Promise.resolve(undefined);
    },
    showWarningMessage(msg, ...items) {
      messages.push(msg);
      return Promise.resolve(items.includes(warningAnswer) ? warningAnswer : undefined);
    },
    // S8：`Anchor: 配置模型端点` 的三个输入框。答案由测例排队给（`inputAnswers`）
    showInputBox(options) {
      return Promise.resolve(inputAnswers.shift());
    },
    showErrorMessage(msg) {
      messages.push(msg);
      return Promise.resolve(undefined);
    },
    // D78：宿主靠"可见编辑器变了"分辨"预览替换"与"用户主动关标签"。
    // 和上面两条一样，它必须在 **activate 期间**就存在 —— 缺了它 activate 直接抛，
    // 整份扩展根本没装上（这正是这条桩第一次漏掉它时的现象：`extension.cjs` 第 104192 行抛
    // `onDidChangeVisibleTextEditors is not a function`，而所有断言都还没开始跑）。
    onDidChangeVisibleTextEditors() {
      return { dispose() {} };
    },
    // S8：活动栏那个固定按钮里的视图。VS Code 只在用户点开时才调 resolveWebviewView，
    // 所以这里也**先记下来**，由下面的断言自己去调 —— 那正是"最外层边界打桩，
    // 里面全真"的做法：面板的宿主侧逻辑（握手、转发、守卫）都是真跑一遍的。
    registerWebviewViewProvider(id, provider, options) {
      webviewViews.push({ id, provider, options });
      return { dispose() {} };
    },
    createStatusBarItem() {
      const item = {
        text: '',
        tooltip: undefined,
        command: undefined,
        shown: false,
        show() {
          item.shown = true;
        },
        hide() {
          item.shown = false;
        },
        dispose() {},
      };
      statusBarItems.push(item);
      return item;
    },
    // S3：`Anchor: 显示状态` 现在会报一次模型配置，所以这条命令会读设置
    createOutputChannel(name) {
      return { name, appendLine() {}, append() {}, dispose() {} };
    },
  },
  commands: {
    registerCommand(id, handler) {
      registered.set(id, handler);
      return { dispose() {} };
    },
    executeCommand(id, ...args) {
      executedCommands.push({ id, args });
      return Promise.resolve(undefined);
    },
  },
  workspace: {
    asRelativePath(uri) {
      return uri.fsPath;
    },
    // S3：命令层每次讲解都现读配置（改完设置不必重载窗口）
    // S8：`Anchor: 配置模型端点` 会**写**设置，所以这里得像个真配置：update 改的就是 get 读的那份
    getConfiguration() {
      return {
        get(key) {
          return SETTINGS[key];
        },
        inspect(key) {
          return { globalValue: SETTINGS[key] };
        },
        update(key, value, target) {
          SETTINGS[key] = value;
          settingsWrites.push({ key, value, target });
          return Promise.resolve();
        },
      };
    },
    // 状态栏会读一次用户的 keybindings.json。这里让它 reject（文件就是不存在），
    // 走的正是"读不到就回退默认键位"那条真实分支。
    fs: {
      readFile() {
        return Promise.reject(new Error('ENOENT: keybindings.json'));
      },
    },
    // staleness 与"编辑器关闭即收工"两条订阅（§4.2）
    onDidChangeTextDocument() {
      return { dispose() {} };
    },
    onDidCloseTextDocument() {
      return { dispose() {} };
    },
    // S8：开始面板显示"模型"那一行，改设置要让它立刻变
    onDidChangeConfiguration() {
      return { dispose() {} };
    },
  },
  extensions: {
    getExtension(id) {
      return peerInstalled && id === PEER_ID ? { id } : undefined;
    },
    // S8：开始面板显示"线2 装没装"，装卸线2 要让它立刻变
    onDidChange() {
      return { dispose() {} };
    },
  },
};

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
Module._load = function patched(request, ...rest) {
  if (request === 'vscode') return vscodeStub;
  return originalLoad.call(this, request, ...rest);
};

// ---- 跑 -------------------------------------------------------------------
console.log(`[smoke] 产物：${path.relative(ROOT, BUNDLE)}\n`);

let ext;
try {
  ext = require(BUNDLE);
} catch (err) {
  console.error(`[smoke] 无法 require 产物：${err.message}`);
  process.exit(1);
}

check(typeof ext.activate === 'function', '导出 activate');
check(typeof ext.deactivate === 'function', '导出 deactivate');

const subscriptions = [];
/** §6 配置桩：填齐一个 provider，好让"显示状态"能报出模型配置 */
const SETTINGS = {
  providers: { default: { baseUrl: 'https://example.test/v1', tier1Model: 'test-cheap' } },
  activeProvider: 'default',
  maxFetchRounds: 3,
  preferSecretStorage: true,
};
ext.activate({
  subscriptions: { push: (...items) => subscriptions.push(...items) },
  globalStorageUri: { fsPath: path.join(ROOT, '.tmp-smoke', 'User', 'globalStorage', 'Fish-zjuer.anchor-explain') },
  secrets: { get: () => Promise.resolve('sk'), store: () => Promise.resolve(), delete: () => Promise.resolve() },
  // D83：**空的** Memento。必须真的给这一个（而不是让它缺着）——缺着的话
  // `lastRunOf()` 的 try/catch 会把 TypeError 一起吞掉，于是"面板上那两颗按钮是灰的"
  // 这条断言会在**桩不全**的情况下通过，测的就不是产品行为了。
  workspaceState: { get: () => undefined, update: () => Promise.resolve() },
});
check(subscriptions.length > 0, 'activate 往 subscriptions 里注册了东西', `${subscriptions.length} 项`);

// ---- 声明 ↔ 注册 对齐 ------------------------------------------------------
const missing = declaredCommands.filter((id) => !registered.has(id));
const undeclared = [...registered.keys()].filter((id) => !declaredCommands.includes(id));
check(missing.length === 0, 'package.json 声明的命令全部已注册', missing.join(', ') || `${declaredCommands.length} 个`);
check(undeclared.length === 0, '没有"注册了但没声明"的命令（那种命令面板里看不见）', undeclared.join(', ') || 'ok');

const orphanBindings = declaredKeybindings.filter((k) => !declaredCommands.includes(k.command)).map((k) => k.command);
check(orphanBindings.length === 0, 'keybindings 指向的都是已声明的命令', orphanBindings.join(', ') || `${declaredKeybindings.length} 条`);

// ---- showState 命令本身 ----------------------------------------------------
const handler = registered.get(SHOW_STATE);
check(typeof handler === 'function', `注册了命令 ${SHOW_STATE}`);
// D81：状态栏现在是**两项** —— 讲解那一项（讲的时候才显示）与队列那一项（队列不空才显示）。
// 它们分开是有意的：生命周期不同（讲解结束要收掉，队列不空得一直挂着）。
check(statusBarItems.length === 2, 'activate 建了两个状态栏项（讲解进度 + 多段队列计数）');
check(statusBarItems[1]?.shown === false, '队列那一个**开局是隐藏的**（空队列不该在状态栏占一格）');
check(statusBarItems[1]?.command === 'anchorExplain.showStart', '点队列计数打开开始面板（那儿才有三颗按钮）');

// 情景 A：没有打开的编辑器
peerInstalled = false;
activeTextEditor = undefined;
await handler?.();
check(messages.length === 1, '无编辑器时也弹了通知', messages.at(-1) ?? '(无)');
check((messages.at(-1) ?? '').includes('未安装'), '对端缺失时明确说明"未安装"');

// 情景 B：有编辑器 + 选中第 40-48 行 —— 这一条真正验证 core 被打进产物
peerInstalled = true;
activeTextEditor = {
  document: { uri: { fsPath: 'C:\\anchor-explain\\test\\fixtures\\main.c' } },
  selection: { start: { line: 39 }, end: { line: 47 }, isEmpty: false },
};
await handler?.();
const msg = messages.at(-1) ?? '';
check(msg.includes('第 40-48 行'), 'locationLabel（来自 @anchor/core）在产物里输出正确行号', msg);
check(msg.includes('已安装'), '对端已安装时如实报告');

// ---- 侧边栏资源活着 --------------------------------------------------------
// 读进来先做一次 `\uXXXX` 反解：esbuild 默认 charset='ascii'，产物里的中文是转义形式，
// 直接 includes('讲解整个文件') 会永远假红 —— 而中文文案恰恰是用户唯一看得到的东西。
const bundleText = readFileSync(BUNDLE, 'utf8').replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
  String.fromCharCode(parseInt(hex, 16)),
);
check(bundleText.includes('acquireVsCodeApi'), 'webview 客户端脚本进了产物');
check(bundleText.includes('ui:ready'), 'webview 启动握手（ui:ready）进了产物');
check(bundleText.includes("default-src 'none'"), '侧边栏 CSP 进了产物');
check(bundleText.includes('anchorExplain.walkthroughActive'), 'context key 名进了产物（键位 when 生效的前提）');
check(bundleText.includes('anchorExplain.sessionOpen'), 'sessionOpen 也在产物里（ESC 在 done 之后仍有效的前提，D46）');

// ---- S8 固定按钮（活动栏）+ 开始面板 ---------------------------------------
// 这个切片的四件事都属于"看起来做了其实没做"：图标路径写错（图标静默消失）、
// 视图没声明、视图开了但扩展没被激活、面板点了没反应。没有一件会自己报错。
const container = pkg.contributes.viewsContainers?.activitybar?.[0];
const viewId = pkg.contributes.views?.anchor?.[0]?.id;

check(container?.id === 'anchor', '声明了活动栏容器（固定按钮的落点）', container?.title ?? '(无)');
check(typeof container?.icon === 'string' && container.icon.endsWith('.svg'), '容器图标是 svg', container?.icon ?? '(无)');

const iconPath = join(PKG_DIR, container?.icon ?? '(无)');
check(existsSync(iconPath), '图标文件真的在（路径写错时 VS Code 只是不显示，不会报错）');
check(
  existsSync(iconPath) && readFileSync(iconPath, 'utf8').includes('viewBox="0 0 24 24"'),
  '图标是 24×24（活动栏图标的规定尺寸）',
);
check(
  pkg.activationEvents.includes(`onView:${viewId}`),
  'activationEvents 里有 onView:（否则点开视图时面板可能起不来）',
);
check(
  webviewViews.length === 1 && webviewViews[0].id === viewId,
  '声明的视图 id 与注册的 provider 一致',
  `声明 ${viewId} / 注册 ${webviewViews.map((v) => v.id).join(', ') || '(无)'}`,
);
check(
  webviewViews[0]?.options?.webviewOptions?.retainContextWhenHidden === true,
  '视图保留 DOM（在活动栏里切走再切回不必等重画）',
);

// 演练卡片（欢迎页上的「开始使用 Anchor」）：四步的 markdown 都得在，否则点开是空页
const walkthroughSteps = pkg.contributes.walkthroughs?.[0]?.steps ?? [];
check(walkthroughSteps.length === 4, '演练有四步', `${walkthroughSteps.length} 步`);
const missingDocs = walkthroughSteps
  .map((step) => step.media?.markdown)
  .filter((rel) => typeof rel !== 'string' || !existsSync(join(PKG_DIR, rel)));
check(missingDocs.length === 0, '演练每一步的 markdown 都在', missingDocs.join(', ') || '四份都在');
check(bundleText.includes('start:model'), '开始面板的消息协议进了产物（握手/模型/动作三件）');

// 开始面板的宿主侧**真跑一遍**：外层（vscode 模块）是桩，面板自己的逻辑全是真的
const posted = [];
let receiveFromPanel;
const fakeView = {
  webview: {
    cspSource: 'vscode-resource://smoke',
    options: undefined,
    html: '',
    onDidReceiveMessage(fn) {
      receiveFromPanel = fn;
      return { dispose() {} };
    },
    postMessage(message) {
      posted.push(message);
      return Promise.resolve(true);
    },
  },
  onDidDispose() {
    return { dispose() {} };
  },
};

const waitFor = async (predicate, ms = 300) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return predicate();
};

webviewViews[0]?.provider.resolveWebviewView(fakeView);
check(
  typeof fakeView.webview.html === 'string' && fakeView.webview.html.includes("default-src 'none'"),
  '开始面板的 HTML 生成了，且 CSP 取的是最严那一档',
);
check(typeof receiveFromPanel === 'function', '面板 ready / run 的入口挂上了');

// 握手 → 宿主推一份模型
receiveFromPanel?.({ type: 'start:ready' });
await waitFor(() => posted.length > 0);
const startModel = posted.at(-1)?.model;
check(posted.at(-1)?.type === 'start:model' && startModel !== undefined, '握手后宿主推了一份开始面板模型');
check(
  startModel?.status?.length === 5,
  '模型里有五条状态（模型 / 线2 / 上次捕获 / 多段队列 / 讲解）',
  startModel?.status?.map((item) => item.label).join(' / ') ?? '(无)',
);
// 队列空着时那两颗按钮是灰的，而**状态行要说清下一步去哪**（D61）——
// 面板上多出来的一整组按钮如果只会变灰、不会指路，用户照样卡住。
const queueRow = startModel?.status?.find((item) => item.label === '多段队列');
check(queueRow?.tone === 'muted', '队列是空的时候那一行是静音色（不是假装没事）');
check(
  (queueRow?.value ?? '').includes('加入队列'),
  '空队列那一行**指出下一步**（否则用户不知道那组灰按钮该怎么点亮）',
  queueRow?.value ?? '(无这行)',
);
check(
  startModel?.sections?.some((section) => section.actions.some((a) => a.id === 'addSegment' && a.enabled)),
  '「加入队列」永远可点（队列里有东西是另外两颗的事，不该拖它一起灰）',
);
check(
  startModel?.sections?.some((section) => section.actions.some((a) => a.id === 'capture' && a.chord === 'Ctrl+Shift+A')),
  '面板显示的键位是"用户实际绑的那个"（冒烟里读不到 keybindings.json，走的是回退默认那条真实分支）',
);
check(startModel?.openChord === 'Ctrl+Alt+A', '面板顶部知道怎么再打开自己');

// D83：**刚激活时还没有任何存档**，那两颗按钮必须是灰的，而且说清先去按哪一颗。
// 这里锁的是**接线**（`makeStartModel` 从 `workspaceState` 读出 `hasLastRun`）——
// `buildStartModel` 本身有单测，但"状态真的被传到面板上了"这件事只有端到端能证明：
// 少传一个字段时，面板会**永远**显示"还没有讲过任何一段"，而单测全绿。
const replayAction = (id) =>
  startModel?.sections?.flatMap((section) => section.actions).find((a) => a.id === id);
for (const id of ['replayLast', 'reExplain']) {
  const action = replayAction(id);
  check(
    action !== undefined && action.enabled === false,
    `D83：没有存档时面板上的「${id}」是灰的（激活时 workspaceState 本来就是空的）`,
    JSON.stringify(action ?? null),
  );
  check(
    (action?.note ?? '').includes('讲解选中的代码'),
    `D83：「${id}」灰掉的理由要指出下一步按那颗按钮`,
    action?.note ?? '(无)',
  );
}

// 门厅不许是死路（D61），而且**能一步做完的别让人去别处做**（D62）：面板说"你还缺
// anchorExplain.providers"，那就得有一条**真的能配**的路，而且不受任何前置条件限制
check(
  startModel?.sections?.some((section) =>
    section.actions.some((a) => a.id === 'configure' && a.enabled),
  ),
  '「配置模型端点」始终可点（否则面板把该做什么说清楚了、却一步也走不动）',
);
check(
  startModel?.sections?.some((section) => section.actions.some((a) => a.id === 'openSettings' && a.enabled)),
  '「打开设置」也在（想自己改取件轮数/温度的人有路）',
);

// 点一个动作 → 真的执行了那条命令
receiveFromPanel?.({ type: 'start:run', id: 'capture' });
check(
  await waitFor(() => executedCommands.some((c) => c.id === 'anchorExplain.capture')),
  '点「讲解选中的代码」→ 执行的是那条命令（面板只是指路，命令是唯一实现）',
);

// 表里没有的 id：什么都不做（webview 是不可信输入）
const executedBefore = executedCommands.length;
receiveFromPanel?.({ type: 'start:run', id: '并不是我们的动作' });
await new Promise((resolve) => setTimeout(resolve, 20));
check(executedCommands.length === executedBefore, '面板回传表里没有的 id 时，一条命令都不执行');

// 面板点「配置模型端点」→ 命令层那条命令真的被调起来（输入框那三步不在这里跑，
// 那是 F5 的事；这里守的是"按钮 → 命令"这一跳和命令已声明）
receiveFromPanel?.({ type: 'start:run', id: 'configure' });
check(
  await waitFor(() => executedCommands.some((c) => c.id === 'anchorExplain.configure')),
  '点「配置模型端点」→ 执行的是我们声明的那条命令',
);

// 面板点「打开设置」→ 命令层再去调 VS Code 的内置设置命令（参数在**命令里面**，不在面板里）
receiveFromPanel?.({ type: 'start:run', id: 'openSettings' });
check(
  await waitFor(() => executedCommands.some((c) => c.id === 'anchorExplain.openSettings')),
  '点「打开设置」→ 执行的是我们声明的那条命令',
);
executedCommands.length = 0;
await registered.get('anchorExplain.openSettings')?.();
check(
  executedCommands.some((c) => c.id === 'workbench.action.openSettings' && c.args[0] === 'anchorExplain'),
  '那条命令落到 VS Code 的内置设置命令上，并带上筛选词',
  JSON.stringify(executedCommands.at(-1) ?? null),
);

// 缺前置条件：明确提示 + 不执行（goto 在没有会话时本来是静默返回的）
const gotoBefore = executedCommands.length;
const warnedBefore = messages.length;
receiveFromPanel?.({ type: 'start:run', id: 'goto' });
await waitFor(() => messages.length > warnedBefore);
check(
  messages.length === warnedBefore + 1 && (messages.at(-1) ?? '').includes('没有进行中的讲解'),
  '没有会话时点「跳到指定步」：说清为什么，而不是静默什么都不发生',
  messages.at(-1) ?? '(无)',
);
check(executedCommands.length === gotoBefore, '……并且没有真的去执行 goto');

// 线2 没装：面板照实说，点了也明确提示（那条命令**根本不存在**，不能让它抛"命令未找到"）
peerInstalled = false;
const beforePeerRefresh = posted.length;
receiveFromPanel?.({ type: 'start:ready' });
await waitFor(() => posted.length > beforePeerRefresh);
const peerModel = posted.at(-1)?.model;
check(peerModel?.status?.[1]?.tone === 'warn', '线2 缺失时状态行是警示色（不是悄悄留白）');
check(
  peerModel?.sections?.some((section) => section.actions.some((a) => a.id === 'selectRegion' && !a.enabled)),
  '线2 缺失时「框选 PDF 区域」是灰的',
);

const peerBefore = executedCommands.length;
const peerWarnedBefore = messages.length;
receiveFromPanel?.({ type: 'start:run', id: 'selectRegion' });
await waitFor(() => messages.length > peerWarnedBefore);
check(
  messages.length === peerWarnedBefore + 1 && (messages.at(-1) ?? '').includes('Fish-zjuer.anchor-pdf'),
  '线2 缺失时点了它：明确说没装，而不是抛一个 VS Code 的"命令未找到"',
  messages.at(-1) ?? '(无)',
);
check(executedCommands.length === peerBefore, '……并且没有真的去执行那条不存在的命令');
peerInstalled = true;

// ---- S8 补：`Anchor: 配置模型端点` 会**写用户设置**，这段是它的回归测 -------------
// 起因是用户的原话"这样填完不记忆，没用"：第一版没接住 `update()` 的异常（settings.json
// 有语法错时 VS Code 拒绝写），于是点完三个输入框**什么都没发生**、也没提示。
const configure = registered.get('anchorExplain.configure');
check(typeof configure === 'function', '注册了命令 anchorExplain.configure');

SETTINGS.providers = undefined;
SETTINGS.activeProvider = undefined;
settingsWrites.length = 0;
// providers 是空的 → 不问 provider id，只问 baseUrl 与模型名（两个答案按顺序排队）
inputAnswers.push('https://api.deepseek.com', 'deepseek-chat');
await configure?.();
const providersWrite = settingsWrites.find((w) => w.key === 'providers');
check(
  providersWrite?.value?.default?.baseUrl === 'https://api.deepseek.com' &&
    providersWrite?.value?.default?.tier1Model === 'deepseek-chat',
  '三个输入框的答案真的写进了 providers.default',
  JSON.stringify(providersWrite?.value ?? null),
);
check(
  settingsWrites.some((w) => w.key === 'activeProvider' && w.value === 'default'),
  '并把 activeProvider 指过去（否则配好了也用不上）',
);
check(
  !JSON.stringify(settingsWrites).includes('apiKey'),
  '写设置的命令**永不写 apiKey**（密钥只有 SecretStorage 一条路）',
);

// 写完当场反映到面板上：这才是"记忆住了"（用户报的正是这一条）
const beforeReconfigure = posted.length;
receiveFromPanel?.({ type: 'start:ready' });
await waitFor(() => posted.length > beforeReconfigure);
const configuredModel = posted.at(-1)?.model;
check(configuredModel?.status?.[0]?.tone === 'ok', '配完之后面板的「模型」那行变成正常色（不用重载窗口）');
check(
  configuredModel?.sections?.some((section) => section.actions.some((a) => a.id === 'setApiKey' && a.enabled)),
  '配完之后「设置 API Key」当场变亮',
);

// "少了一层"的形状：先问一句，用户点「整理好它」→ 整理成 providers.default（D63）
SETTINGS.providers = { baseUrl: 'https://flat.test/v1', tier1Model: 'flat-model' };
SETTINGS.activeProvider = 'default';
settingsWrites.length = 0;
warningAnswer = '整理好它';
messages.length = 0;
await configure?.();
check(
  SETTINGS.providers?.default?.baseUrl === 'https://flat.test/v1' &&
    SETTINGS.providers?.default?.tier1Model === 'flat-model',
  '把"少一层"的 providers 整理成 providers.default（值一个不丢）',
  JSON.stringify(SETTINGS.providers ?? null),
);
check(settingsWrites.length > 0 && (messages.at(-1) ?? '').length > 0, '整理完有回话（不许静默）');

// 用户点「我自己改」时什么都不动
SETTINGS.providers = { baseUrl: 'https://flat.test/v1', tier1Model: 'flat-model' };
settingsWrites.length = 0;
warningAnswer = '我自己改';
await configure?.();
check(settingsWrites.length === 0, '点「我自己改」时一行设置都不动');
check(SETTINGS.providers?.baseUrl === 'https://flat.test/v1', '……原来的内容也没被碰');

// .vscodeignore：图标与演练的 markdown 必须打进 .vsix，否则装了扩展也是个没有图标的按钮
// （先剥掉注释行：`.vscodeignore` 的注释是给人看的说明，不是规则；早先用裸 includes，
//  连注释里提到 "assets/" 都会被误判成"排除了它" —— 那是断言比被测对象还粗。）
const extIgnoreText = readFileSync(join(PKG_DIR, '.vscodeignore'), 'utf8');
const extIgnoreRules = extIgnoreText
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');
check(
  !extIgnoreRules.includes('assets/') && !extIgnoreRules.includes('media/'),
  '.vscodeignore 没把 assets/ 或 media/ 排除（打 .vsix 时它们要跟着走）',
);

// ---- S2 接线的硬判据：假选区必须**从产物里整体消失** ----------------------
// S2 删掉的是 `commands.ts` 里 `createFakeEditorPort(...)` 那行覆盖。删干净了没有，
// 有一条比行为断言更硬的判据：`fakes/fakeEditorPort.ts` 里独有的字面量如果已经被
// tree-shake 掉，就说明产物里**根本没有**假选区这条路径 —— 不是"这次没走到"。
// 别拿 `'test/fixtures/main.c'` 当判据：fakeProvider 的兜底路径也是它，会误命中。
check(!bundleText.includes('fake-hash-0000'), '产物里没有假选区的指纹常量（那行覆盖确实删了）');
check(!bundleText.includes('整份 main.c 的替身文本'), '产物里没有假文档正文（「整个文件」走的是真端口）');
check(bundleText.includes('getDocumentSelection'), '「整个文件」读的是端口方法（真实现已进产物）');
check(bundleText.includes('讲解整个文件') && bundleText.includes('只放了光标'), '确认 UI 的两条分支文案都在产物里');

// ---- S3 接线：**两个替身都不该在产物里**，真编排循环该在 -------------------
// S2 删了假选区，S3 删了假 AI。这几条合起来说的是同一件事：
// 产物里已经没有替身了，跑的就是真链路 —— 判据是"替身独有的字面量不见了"，
// 比"这次没走到那条分支"硬。
check(!bundleText.includes('环形队列的出队路径'), '产物里没有假 AI 的脚本内容（fakeProvider 已退出产物）');
check(!bundleText.includes('test/fixtures/main.c'), '产物里没有假 AI 的兜底路径');
check(bundleText.includes('chat/completions'), 'OpenAI 兼容端点进了产物（这是 S3 的真身）');
check(bundleText.includes('fetch_context'), '§8 的工具定义进了产物');
check(bundleText.includes('请求被拒绝'), '§3.2 的拒绝回灌文案进了产物');
check(bundleText.includes('讲解助手'), 'prompt 进了产物（它是产品的一部分，不是注释）');
check(bundleText.includes('anchorExplain.apiKey.'), 'SecretStorage 的键名约定进了产物（读写两侧同源）');

// ---- S7 打包了第三方代码：署名必须一起进产物 ------------------------------
// 产物里现在有 pdfjs-dist（**Apache-2.0**，D85 起本包自身是专有许可，这条署名照样不能少）。
// esbuild 的 legalComments 会把 `/*!` 开头的注释保留下来 —— 那是产物里唯一还留着的署名。
// 这一条守的是"打包了别人的代码却不带署名"，而它恰恰是最难在事后发现的一类问题。
check(
  bundleText.includes('pdfjs-dist') && bundleText.includes('Apache-2.0'),
  '打包进来的 pdfjs-dist 的署名（Apache-2.0）还在产物里',
);
const notices = join(ROOT, 'packages', 'extension-anchor', 'THIRD_PARTY_NOTICES.md');
check(existsSync(notices), 'THIRD_PARTY_NOTICES.md 在（打包第三方代码的声明）');
// 同上：剥注释行再判断，否则"注释里解释了为什么要带上它"也会被判成"把它排除了"
const extIgnoreNoComments = readFileSync(join(ROOT, 'packages', 'extension-anchor', '.vscodeignore'), 'utf8')
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');
// 不用正则：这个断言要的就是"这个文件名有没有出现在排除表里"，includes 足够且不会写错转义
check(
  !extIgnoreNoComments.includes('THIRD_PARTY_NOTICES.md'),
  'THIRD_PARTY_NOTICES.md 没被 .vscodeignore 排除（打 .vsix 时要带上它）',
);

// ---- 纯视觉：产物里根本不存在写文件的路径 ----------------------------------
// 比运行期断言更强：不是"这次没调用"，而是"没有可调用的东西"。
// 匹配**调用形状**（`<某模块>.TextEdit` 一类），不是裸名字 —— D74 那次修复把 pdf.js 的
// worker 也打进了产物，而那份代码里有一串 XFA 的枚举名（`… Text, TextEdit, Time …`）
// 和一个 `_FreeTextEditor`，裸名字扫描当场误报。要守的是"**我们的代码**调用过写入 API"，
// 所以模式里必须带上"谁在调用"（`\w+.`）这半截。
const writeApiPatterns = [
  [/\b\w+\.applyEdit\b/, 'applyEdit'],
  [/\b\w+\.(TextEdit|WorkspaceEdit)\b/, 'TextEdit / WorkspaceEdit'],
  [/\b\w+\.insertSnippet\b/, 'insertSnippet'],
  [/\b\w+\.saveAll\b/, 'saveAll'],
  [/\b\w+\.createFileSystemWatcher\b/, 'createFileSystemWatcher'],
];
const leaked = writeApiPatterns.filter(([re]) => re.test(bundleText)).map(([, name]) => name);
check(leaked.length === 0, '产物里没有任何文档写入 API', leaked.join(', ') || '一个都没有');

// ---- 9. 产物里 pdf.js 真的能打开一份 PDF 吗（D74）----------------------------
// 这一节补的是一条**跑掉了一整片**的锁。pdf.js 的"假 worker"在**源码**里靠 `import.meta.url`
// 推路径，正好推得到 `node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs`；打成 cjs 之后
// 那个路径变成了**产物旁边**（`dist/pdf.worker.mjs`），那儿没有这个文件 ——
// 于是 `Setting up fake worker failed: Cannot find module …`。
// 表现是"PDF 取件永远被拒（无法确定这份文档的总页数）"，而 `pnpm check` 全绿，
// 因为 `node --test` 跑的是源码。**差别只有一个字：打包。** 所以这条锁必须在打包之后跑。
const probeEntry = path.join(ROOT, 'scripts', 'pdf-open-probe.mjs');
const probeOut = path.join(tmpdir(), `anchor-pdf-probe-${process.pid}.cjs`);
const fixturePdf = path.join(ROOT, 'test', 'fixtures', 'sample-30p.pdf');
let probeDetail = '';
try {
  // 与根 esbuild.mjs 的 optionsFor() 同一套选项（那是"用户真的会跑的那份产物"的形状）
  await build({
    entryPoints: [probeEntry],
    outfile: probeOut,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    external: ['vscode'],
    logLevel: 'silent',
  });
  const stdout = execFileSync(process.execPath, [probeOut, fixturePdf], { encoding: 'utf8' });
  probeDetail = stdout.trim();
  check(/pages=30/.test(stdout), '打包之后 pdf.js 仍能打开一份真 PDF（worker 那条路没被 esbuild 打断）', probeDetail);
} catch (err) {
  const why = String(err?.stdout ?? err?.message ?? err).trim().split('\n')[0];
  check(false, '打包之后 pdf.js 仍能打开一份真 PDF（worker 那条路没被 esbuild 打断）', why || '(无输出)');
} finally {
  rmSync(probeOut, { force: true });
}

ext.deactivate();
check(true, 'deactivate 可调用');

// ---- 收尾 -----------------------------------------------------------------
Module._load = originalLoad;

if (failures.length) {
  console.error(`\n[smoke] 失败 ${failures.length} 项：`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\n[smoke] 全部通过');
