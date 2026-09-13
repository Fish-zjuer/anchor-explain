/**
 * 线2（`extension-anchor-pdf`）的冒烟 —— 产物冒烟，不启动 VS Code。
 *
 * 与 `smoke-extension.mjs` 同一个套路：只对最外层边界（`vscode` 模块）打桩。
 * 它守的几件事，恰好是 S4 的验收标准：
 *   1. **不劫持**：`customEditors[0].priority === "option"`，且 viewType 只出现在我们自己的命名空间下
 *   2. **改名改干净了**：`viewType` / 配置命名空间 / 命令 id 三处的 `pdf.*` 全变成 `anchorPdf.*`，
 *      且产物里没有上游品牌字样与募捐文案
 *   3. **真能打开**：`anchorPdf.openInAnchorViewer` 打到 `vscode.openWith`，用的是我们自己的 viewType
 *   4. **assets 没被排除**：视图是运行时从扩展目录读 `assets/` 的，`.vscodeignore` 一旦排除它，
 *      表现是"窗口打开了一片空白"，而这条在打包前根本发现不了
 *
 * 用法：node scripts/smoke-pdf-extension.mjs
 */

import Module from 'node:module';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_DIR = path.join(ROOT, 'packages', 'extension-anchor-pdf');
const BUNDLE = path.join(PKG_DIR, 'dist', 'extension.cjs');
const MANIFEST = path.join(PKG_DIR, 'package.json');

const failures = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` —— ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

// ---- vscode 桩 -------------------------------------------------------------
const registeredCommands = new Map();
const executed = [];
const editorProviders = [];
const openDialogs = [];
let activeTextEditor;

const vscodeStub = {
  Uri: {
    file: (p) => ({ scheme: 'file', fsPath: p, path: p, toString: () => `file://${p}` }),
    joinPath: (base, ...segs) => ({ ...base, fsPath: path.join(base.fsPath, ...segs) }),
    parse: (s) => ({ toString: () => s }),
  },
  window: {
    get activeTextEditor() {
      return activeTextEditor;
    },
    registerCustomEditorProvider(viewType, provider, options) {
      editorProviders.push({ viewType, provider, options });
      return { dispose() {} };
    },
    showOpenDialog(options) {
      openDialogs.push(options);
      return Promise.resolve(undefined);
    },
    showInformationMessage: () => Promise.resolve(undefined),
    showErrorMessage: () => Promise.resolve(undefined),
  },
  commands: {
    registerCommand(id, handler) {
      registeredCommands.set(id, handler);
      return { dispose() {} };
    },
    executeCommand(id, ...args) {
      executed.push({ id, args });
      return Promise.resolve(undefined);
    },
  },
  workspace: {
    getConfiguration: () => ({ get: (_k, d) => d }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
};

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
Module._load = function patched(request, ...rest) {
  if (request === 'vscode') return vscodeStub;
  return originalLoad.call(this, request, ...rest);
};

// ---- 跑 -------------------------------------------------------------------
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
console.log(`[pdf] 产物：${path.relative(ROOT, BUNDLE)}`);
console.log(`[pdf] 扩展 ID：${manifest.publisher}.${manifest.name}\n`);

check(existsSync(BUNDLE), '产物存在（先跑 pnpm build）');
const ext = require(BUNDLE);
check(typeof ext.activate === 'function', '导出 activate');
check(typeof ext.deactivate === 'function', '导出 deactivate');

const subscriptions = [];
ext.activate({
  subscriptions: { push: (...items) => subscriptions.push(...items) },
  extensionPath: PKG_DIR,
});
check(subscriptions.length >= 2, 'activate 注册了 provider 与命令', `${subscriptions.length} 项`);

// ---- 1. 不劫持 -------------------------------------------------------------
const customEditors = manifest.contributes?.customEditors ?? [];
check(customEditors.length === 1, '只声明一个 customEditor');
check(
  customEditors[0]?.priority === 'option',
  'customEditors[0].priority === "option"（**不劫持**：用户的默认 PDF 打开方式不变）',
  String(customEditors[0]?.priority),
);
check(
  customEditors[0]?.viewType === 'anchorPdf.view',
  'viewType 是我们自己的命名空间',
  String(customEditors[0]?.viewType),
);
check(
  editorProviders.length === 1 && editorProviders[0]?.viewType === customEditors[0]?.viewType,
  '注册的 viewType 与声明的一致（不一致的话视图永远不会被调用）',
  editorProviders.map((p) => p.viewType).join(','),
);
check(
  editorProviders[0]?.options?.supportsMultipleEditorsPerDocument === false,
  '保留了上游的 supportsMultipleEditorsPerDocument: false',
);

// ---- 2. 改名改干净了 -------------------------------------------------------
const rawBundle = readFileSync(BUNDLE, 'utf8');
// esbuild 默认 charset='ascii'，中文是 \uXXXX 形式，比对中文前先解回来
const bundleText = rawBundle.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
  String.fromCharCode(parseInt(hex, 16)),
);

check(manifest.publisher === 'anchor', 'publisher 不再沿用上游（商标要求）', String(manifest.publisher));
check(!/mathematic/i.test(manifest.displayName ?? ''), 'displayName 里没有上游品牌', String(manifest.displayName));
check(manifest.author === undefined && manifest.repository === undefined, 'author / repository 没指回上游');
check(!/mathematic/i.test(bundleText), '产物里没有上游品牌字样（含版权头以外的引用）');
check(!bundleText.includes('Support Mathematic'), '上游的募捐弹窗已经删掉（不再替用户做主）');

const configKeys = Object.keys(manifest.contributes?.configuration?.properties ?? {});
check(
  configKeys.length === 2 && configKeys.every((k) => k.startsWith('anchorPdf.')),
  '两个配置项都在 anchorPdf.* 命名空间下（与上游扩展互不干扰）',
  configKeys.join(', '),
);
check(bundleText.includes('getConfiguration("anchorPdf"'), '读配置用的也是 anchorPdf 命名空间');
check(!bundleText.includes('getConfiguration("pdf"'), '没有漏掉上游的 "pdf" 命名空间');

const declaredCommands = (manifest.contributes?.commands ?? []).map((c) => c.command);
const missing = declaredCommands.filter((id) => !registeredCommands.has(id));
const undeclared = [...registeredCommands.keys()].filter((id) => !declaredCommands.includes(id));
check(missing.length === 0, 'package.json 声明的命令全部已注册', missing.join(', ') || declaredCommands.join(', '));
check(undeclared.length === 0, '没有"注册了但没声明"的命令（那种命令面板里看不见）', undeclared.join(', ') || 'ok');
check(
  (manifest.activationEvents ?? []).includes('onCommand:anchorPdf.openInAnchorViewer'),
  '命令在 activationEvents 里（不激活就点不动）',
);

// ---- 3. 真能打开 -----------------------------------------------------------
const handler = registeredCommands.get('anchorPdf.openInAnchorViewer');
check(typeof handler === 'function', '注册了 anchorPdf.openInAnchorViewer');

const PDF_URI = { scheme: 'file', fsPath: 'C:\\repo\\test\\fixtures\\sample-30p.pdf', path: '/repo/test/fixtures/sample-30p.pdf' };
await handler?.(PDF_URI);
const openWith = executed.at(-1);
check(openWith?.id === 'vscode.openWith', '给 uri 时打到 vscode.openWith（与"打开方式"选我们是同一条路）', String(openWith?.id));
check(openWith?.args?.[0] === PDF_URI, '用的是传进来的那个 uri');
check(openWith?.args?.[1] === 'anchorPdf.view', '用的是我们自己的 viewType', String(openWith?.args?.[1]));

// 没给 uri、活动编辑器也不是 PDF → 应该让用户挑文件，而不是瞎开一个
executed.length = 0;
activeTextEditor = { document: { uri: { path: '/repo/a.txt', fsPath: 'C:\\repo\\a.txt' } } };
await handler?.();
check(openDialogs.length === 1, '活动编辑器不是 PDF 时弹文件选择框');
check(executed.length === 0, '用户取消选择时什么都不做（不瞎开）', JSON.stringify(executed));

executed.length = 0;
activeTextEditor = { document: { uri: { path: '/repo/b.PDF', fsPath: 'C:\\repo\\b.PDF' } } };
await handler?.();
check(executed.at(-1)?.args?.[0] === activeTextEditor.document.uri, '活动编辑器是 PDF 时直接用它（大小写不敏感）');
activeTextEditor = undefined;

// ---- 4. assets 没被排除 ----------------------------------------------------
const assetsDir = path.join(PKG_DIR, 'assets');
check(existsSync(path.join(assetsDir, 'main.mjs')), 'assets/main.mjs 在（页面的客户端脚本）');
check(existsSync(path.join(assetsDir, 'main.css')), 'assets/main.css 在');
check(
  existsSync(path.join(assetsDir, 'pdf.js', 'build', 'pdf.mjs')) &&
    existsSync(path.join(assetsDir, 'pdf.js', 'web', 'viewer.css')) &&
    existsSync(path.join(assetsDir, 'pdf.js', 'web', 'cmaps')),
  'vendored pdf.js 的关键目录都在（build / web/viewer.css / web/cmaps）',
);

const ignore = readFileSync(path.join(PKG_DIR, '.vscodeignore'), 'utf8');
check(
  !ignore.split('\n').some((line) => line.trim().replace(/\/+$/, '') === 'assets'),
  '.vscodeignore 没有排除 assets/（排掉的话视图打开是一片空白，打包前发现不了）',
);
check(
  ignore.split('\n').some((line) => line.trim() === 'src/**'),
  '.vscodeignore 排掉了 src/**（源码不该进 .vsix）',
);

// viewer.html 是被**内联进产物**的（esbuild 的 text loader），所以产物里能看到它
check(bundleText.includes('pdf-view-config'), 'viewer.html 内联进了产物（id=pdf-view-config 那一段是我们注入的）');
check(bundleText.includes("default-src 'none'"), '宿主注入的 CSP 在产物里');
check(bundleText.includes("base-uri 'none'") && bundleText.includes("form-action 'none'"), 'CSP 的两条收紧指令都在');

ext.deactivate();
check(true, 'deactivate 可调用');

// ---- 收尾 -----------------------------------------------------------------
Module._load = originalLoad;

if (failures.length) {
  console.error(`\n[pdf] 失败 ${failures.length} 项：`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\n[pdf] 全部通过');
