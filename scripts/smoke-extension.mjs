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
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_DIR = path.join(ROOT, 'packages', 'extension-anchor');
const BUNDLE = path.join(PKG_DIR, 'dist', 'extension.cjs');
const SHOW_STATE = 'anchorExplain.showState';
const PEER_ID = 'anchor.anchor-pdf';

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
let activeTextEditor;
let peerInstalled = false;

const vscodeStub = {
  StatusBarAlignment: { Left: 1, Right: 2 },
  window: {
    get activeTextEditor() {
      return activeTextEditor;
    },
    showInformationMessage(msg) {
      messages.push(msg);
      return Promise.resolve(undefined);
    },
    showWarningMessage(msg) {
      messages.push(msg);
      return Promise.resolve(undefined);
    },
    showErrorMessage(msg) {
      messages.push(msg);
      return Promise.resolve(undefined);
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
    getConfiguration() {
      return {
        get(key) {
          return SETTINGS[key];
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
  globalStorageUri: { fsPath: path.join(ROOT, '.tmp-smoke', 'User', 'globalStorage', 'anchor.anchor-explain') },
  secrets: { get: () => Promise.resolve('sk'), store: () => Promise.resolve(), delete: () => Promise.resolve() },
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
check(statusBarItems.length === 1, 'activate 建了状态栏项（讲解期间的常驻入口）');

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
check(startModel?.status?.length === 4, '模型里有四条状态（模型 / 线2 / 上次捕获 / 讲解）');
check(
  startModel?.sections?.some((section) => section.actions.some((a) => a.id === 'capture' && a.chord === 'Ctrl+Shift+A')),
  '面板显示的键位是"用户实际绑的那个"（冒烟里读不到 keybindings.json，走的是回退默认那条真实分支）',
);
check(startModel?.openChord === 'Ctrl+Alt+A', '面板顶部知道怎么再打开自己');

// 门厅不许是死路（D61）：面板说"你还缺 anchorExplain.providers"，那就得有一条去配它的路，
// 而且那条路**不受任何前置条件限制**
check(
  startModel?.sections?.some((section) =>
    section.actions.some((a) => a.id === 'openSettings' && a.enabled),
  ),
  '没配模型时「打开设置」仍可点（否则面板把该做什么说清楚了、却一步也走不动）',
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
  messages.length === peerWarnedBefore + 1 && (messages.at(-1) ?? '').includes('anchor.anchor-pdf'),
  '线2 缺失时点了它：明确说没装，而不是抛一个 VS Code 的"命令未找到"',
  messages.at(-1) ?? '(无)',
);
check(executedCommands.length === peerBefore, '……并且没有真的去执行那条不存在的命令');
peerInstalled = true;

// .vscodeignore：图标与演练的 markdown 必须打进 .vsix，否则装了扩展也是个没有图标的按钮
const extIgnoreText = readFileSync(join(PKG_DIR, '.vscodeignore'), 'utf8');
check(
  !extIgnoreText.includes('assets/') && !extIgnoreText.includes('media/'),
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
// 产物里现在有 pdfjs-dist（**Apache-2.0**，比本包的 MIT 更严）。
// esbuild 的 legalComments 会把 `/*!` 开头的注释保留下来 —— 那是产物里唯一还留着的署名。
// 这一条守的是"打包了别人的代码却不带署名"，而它恰恰是最难在事后发现的一类问题。
check(
  bundleText.includes('pdfjs-dist') && bundleText.includes('Apache-2.0'),
  '打包进来的 pdfjs-dist 的署名（Apache-2.0）还在产物里',
);
const notices = join(ROOT, 'packages', 'extension-anchor', 'THIRD_PARTY_NOTICES.md');
check(existsSync(notices), 'THIRD_PARTY_NOTICES.md 在（打包第三方代码的声明）');
const extIgnore = readFileSync(join(ROOT, 'packages', 'extension-anchor', '.vscodeignore'), 'utf8');
// 不用正则：这个断言要的就是"这个文件名有没有出现在排除表里"，includes 足够且不会写错转义
check(
  !extIgnore.includes('THIRD_PARTY_NOTICES.md'),
  'THIRD_PARTY_NOTICES.md 没被 .vscodeignore 排除（打 .vsix 时要带上它）',
);

// ---- 纯视觉：产物里根本不存在写文件的路径 ----------------------------------
// 比运行期断言更强：不是"这次没调用"，而是"没有可调用的东西"。
// 用词边界匹配：裸 includes('TextEdit') 会被 TextEditorDecorationType 误命中。
const writeApiPatterns = [
  [/\bapplyEdit\b/, 'applyEdit'],
  [/\bWorkspaceEdit\b/, 'WorkspaceEdit'],
  [/\bTextEdit\b/, 'TextEdit'],
  [/\binsertSnippet\b/, 'insertSnippet'],
  [/\bsaveAll\b/, 'saveAll'],
  [/\bcreateFileSystemWatcher\b/, 'createFileSystemWatcher'],
];
const leaked = writeApiPatterns.filter(([re]) => re.test(bundleText)).map(([, name]) => name);
check(leaked.length === 0, '产物里没有任何文档写入 API', leaked.join(', ') || '一个都没有');

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
