/**
 * 打包产物冒烟测试 —— 不启动 VS Code，直接 require `dist/extension.cjs`。
 *
 * 只对**最外层边界**打桩：把 `vscode` 模块换成假的（这就是 SLICES.md 说的
 * "假货只允许出现在最外层边界"）。除此之外全是真的：真产物、真 require、
 * 真的走 `activate` → `registerCommand` → 命令回调。
 *
 * 它守住三件事，任何一件坏了都在 CI/命令层面立刻可见，不用靠 F5 肉眼看：
 *   1. 产物是合法 CommonJS（宿主的 require 不吃 ESM 入口）
 *   2. activate 确实注册了命令
 *   3. 命令回调能跑通，且 `@anchor/core` 真的被 bundle 进去了（不是只"编译通过"）
 *
 * 用法：node scripts/smoke-extension.mjs
 */

import Module from 'node:module';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'packages', 'extension-anchor', 'dist', 'extension.cjs');
const EXPECTED_COMMAND = 'anchorExplain.showState';
const PEER_ID = 'anchor.anchor-pdf';

const failures = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` —— ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

// ---- 桩：vscode 模块 -------------------------------------------------------
const messages = [];
const registered = new Map();
let activeTextEditor;
let peerInstalled = false;

const vscodeStub = {
  window: {
    get activeTextEditor() {
      return activeTextEditor;
    },
    showInformationMessage(msg) {
      messages.push(msg);
      return Promise.resolve(undefined);
    },
  },
  commands: {
    registerCommand(id, handler) {
      registered.set(id, handler);
      return { dispose() {} };
    },
  },
  workspace: {
    asRelativePath(uri) {
      return uri.fsPath;
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
ext.activate({ subscriptions: { push: (d) => subscriptions.push(d) } });
check(subscriptions.length > 0, 'activate 往 subscriptions 里注册了东西', `${subscriptions.length} 项`);

const handler = registered.get(EXPECTED_COMMAND);
check(typeof handler === 'function', `注册了命令 ${EXPECTED_COMMAND}`);

// 情景 A：没有打开的编辑器
peerInstalled = false;
activeTextEditor = undefined;
handler?.();
check(messages.length === 1, '无编辑器时也弹了通知', messages.at(-1) ?? '(无)');
check((messages.at(-1) ?? '').includes('未安装'), '对端缺失时明确说明"未安装"');

// 情景 B：有编辑器 + 选中第 40-48 行 —— 这一条真正验证 core 被打进产物
peerInstalled = true;
activeTextEditor = {
  document: { uri: { fsPath: 'C:\\anchor-explain\\test\\fixtures\\main.c' } },
  selection: { start: { line: 39 }, end: { line: 47 }, isEmpty: false },
};
handler?.();
const msg = messages.at(-1) ?? '';
check(msg.includes('第 40-48 行'), 'locationLabel（来自 @anchor/core）在产物里输出正确行号', msg);
check(msg.includes('已安装'), '对端已安装时如实报告');

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
