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
import { readFileSync } from 'node:fs';
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
  },
  extensions: {
    getExtension(id) {
      return peerInstalled && id === PEER_ID ? { id } : undefined;
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
