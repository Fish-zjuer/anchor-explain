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
const warnings = [];
const posted = [];
let activeTextEditor;
let peerInstalled = true;

const makeUri = (p) => {
  const uri = {
    scheme: 'file',
    fsPath: p,
    path: p.replace(/\\/g, '/'),
    query: '',
    fragment: '',
    toString: () => `file://${p}`,
    // 上游的 resolveCustomEditor 会用 `document.uri.with({path: ...})` 掐掉文件名
    with(patch) {
      const next = makeUri(p);
      if (patch.path !== undefined) next.path = patch.path;
      if (patch.fragment !== undefined) next.fragment = patch.fragment;
      return next;
    },
  };
  return uri;
};

const vscodeStub = {
  Uri: {
    file: makeUri,
    joinPath: (base, ...segs) => makeUri(path.join(base.fsPath, ...segs)),
    parse: (s) => ({ ...makeUri(s), toString: () => s }),
  },
  extensions: {
    getExtension: (id) => (peerInstalled && id === 'anchor.anchor-explain' ? { id } : undefined),
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
    showInformationMessage: (m) => (warnings.push(m), Promise.resolve(undefined)),
    showWarningMessage: (m) => (warnings.push(m), Promise.resolve(undefined)),
    showErrorMessage: (m) => (warnings.push(m), Promise.resolve(undefined)),
    showInputBox: () => Promise.resolve(undefined),
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
    fs: { readFile: () => Promise.resolve(new TextEncoder().encode('PDF-BYTES')) },
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

// ---- 5. S5/S6：框选整条链路（消息 → 守卫 → 几何 → Anchor → 交给线1） -------
// 这一节真的开了个面板、真的灌了一条 `anchor:captured` 进去，所以它验的是
// "框选结果能不能变成锚点并交出去"，而不只是"代码里有没有这些字符串"。
const panel = {
  webview: {
    cspSource: 'vscode-webview://smoke',
    html: '',
    options: {},
    asWebviewUri: (uri) => ({ toString: () => `vscode-webview://smoke${uri.path}` }),
    postMessage: (message) => (posted.push(message), Promise.resolve(true)),
    onDidReceiveMessage: (cb) => ((onWebviewMessage = cb), { dispose() {} }),
  },
  onDidDispose: () => ({ dispose() {} }),
  onDidChangeViewState: () => ({ dispose() {} }),
  active: true,
};
let onWebviewMessage;

const provider = editorProviders[0]?.provider;
check(typeof provider?.resolveCustomEditor === 'function', '拿到了 provider 实例');

const PDF_PATH = 'C:\\repo\\test\\fixtures\\sample-30p.pdf';
const stubDocument = { uri: vscodeStub.Uri.file(PDF_PATH) };
provider?.resolveCustomEditor(stubDocument, panel);

check(typeof panel.webview.html === 'string' && panel.webview.html.length > 0, '拼出了 webview HTML');
check(panel.webview.html.includes('anchor-select.js'), 'S5：框选脚本被注入进 HTML（不是靠改 assets/pdf.js）');
check(
  panel.webview.html.includes('assets/pdf.js/build/pdf.mjs') && panel.webview.html.includes('assets/main.mjs'),
  '上游自己的两个脚本仍在（注入是追加，不是替换）',
);
check(panel.webview.html.includes("default-src 'none'"), 'CSP 仍然只有一份（注入没有破坏它的唯一性）');
check(
  panel.webview.html.indexOf('assets/main.mjs') < panel.webview.html.indexOf('anchor-select.js'),
  '框选脚本排在上游脚本之后（要靠 pdf.js 的 DOM 才能算位置）',
);

// 进入框选模式：命令 → context key + 推给页面。
// 注意面板此刻**还没握过手**（页面可能还在加载），所以宿主应当先记下、不推。
executed.length = 0;
posted.length = 0;
await registeredCommands.get('anchorPdf.selectRegion')?.();
check(
  executed.some((c) => c.id === 'setContext' && c.args[0] === 'anchorPdf.selectMode' && c.args[1] === true),
  '进入框选模式时把 anchorPdf.selectMode 置为 true（键位的 when 靠它）',
  JSON.stringify(executed.map((c) => c.args)),
);
check(posted.length === 0, '未握手时先不推（推了也石沉大海）');

await onWebviewMessage?.({ type: 'anchor:ready' });
check(
  posted.at(-1)?.type === 'anchor:enterSelectMode',
  '握手时补发 enterSelectMode（没有这道握手，表现是"第一次点框选没反应，再点一次才行"）',
  JSON.stringify(posted.at(-1)),
);

// 已经握过手之后，再点就是即时生效
posted.length = 0;
await registeredCommands.get('anchorPdf.selectRegion')?.();
check(posted.at(-1)?.type === 'anchor:enterSelectMode', '已握手时即时推给页面（§5.2 的宿主→注入脚本方向）');

// 框选结果：宿主用 geometry 重算，而不是照抄脚本给的 bbox
executed.length = 0;
const captured = {
  type: 'anchor:captured',
  page: 1,
  bbox: [0.9, 0.9, 0.99, 0.99], // 刻意给一个**错的** bbox：宿主要用 geometry 覆盖它
  geometry: {
    dragged: { x: 200, y: 400, width: 100, height: 200 },
    pages: [{ page: 23, rect: { x: 100, y: 200, width: 400, height: 800 } }],
  },
};
await onWebviewMessage?.(captured);

const handed = executed.find((c) => c.id === 'anchorExplain.explainAnchor');
check(Boolean(handed), '框选结果交给了线1（§5.1 的 anchorExplain.explainAnchor）');
const anchor = handed?.args?.[0];
check(anchor?.sourceType === 'pdf', '交出去的是 PDF 锚点', String(anchor?.sourceType));
check(anchor?.location?.page === 23, '页号来自 geometry 重算，不是照抄脚本给的 page=1', String(anchor?.location?.page));
check(
  Array.isArray(anchor?.location?.bbox) && anchor.location.bbox[0] === 0.25 && anchor.location.bbox[2] === 0.5,
  'bbox 是 geometry 重算的结果（0.25–0.5），脚本给的那个被覆盖了',
  JSON.stringify(anchor?.location?.bbox),
);
check(anchor?.sourceName === 'sample-30p.pdf', 'sourceName 是 basename', String(anchor?.sourceName));
check(
  anchor?.location?.filePath === PDF_PATH,
  'S7：PDF 锚点带上了 filePath（不带的话线1 只说得出"第 23 页的哪一块"，说不出"哪一份"）',
  String(anchor?.location?.filePath),
);
check(typeof anchor?.sourceId === 'string' && anchor.sourceId.length === 40, 'sourceId 是文档指纹（sha1 40 位）', String(anchor?.sourceId));
check(
  executed.some((c) => c.id === 'setContext' && c.args[0] === 'anchorPdf.selectMode' && c.args[1] === false),
  '框选完成后把 selectMode 落回 false（不留"还在框选"的假状态）',
);

// 对端没装：明确提示，不静默失败（§5.1）
peerInstalled = false;
executed.length = 0;
warnings.length = 0;
await onWebviewMessage?.(captured);
check(!executed.some((c) => c.id === 'anchorExplain.explainAnchor'), '对端缺失时不去 executeCommand（会抛"命令未找到"）');
check(warnings.some((w) => w.includes('没有安装线1')), '对端缺失时明确提示', warnings.at(-1) ?? '');
peerInstalled = true;

// 取消：落回 false，且什么都不交
executed.length = 0;
await onWebviewMessage?.({ type: 'anchor:cancelled' });
check(!executed.some((c) => c.id === 'anchorExplain.explainAnchor'), '取消时一个锚点都不交');
check(
  executed.some((c) => c.id === 'setContext' && c.args[0] === 'anchorPdf.selectMode' && c.args[1] === false),
  '取消也把 selectMode 落回 false',
);

// 坏几何：不崩、不交，给一句人话
executed.length = 0;
warnings.length = 0;
await onWebviewMessage?.({
  type: 'anchor:captured',
  page: 5,
  bbox: [0.1, 0.1, 0.2, 0.2],
  geometry: { dragged: { x: 0, y: 0, width: 5, height: 5 }, pages: [{ page: 9, rect: { x: 500, y: 500, width: 100, height: 100 } }] },
});
check(!executed.some((c) => c.id === 'anchorExplain.explainAnchor'), '框在页外时不交锚点');
check(warnings.some((w) => w.includes('没有落在任何一页')), '框在页外时给一句人话', warnings.at(-1) ?? '');

// 脏消息：一律丢掉，绝不把 page:"三" 之类的值带进 PDFLocation
executed.length = 0;
for (const bad of [null, 42, {}, { type: 'anchor:captured' }, { type: 'anchor:captured', page: '三', bbox: [0, 0, 1, 1] }]) {
  await onWebviewMessage?.(bad);
}
check(executed.length === 0, '五条脏消息一条都没漏进去');

// S6 的 revealPage：滚页，不是画框
executed.length = 0;
posted.length = 0;
await registeredCommands.get('anchorPdf.revealPage')?.(23);
check(posted.at(-1)?.type === 'anchor:gotoPage' && posted.at(-1)?.page === 23, 'revealPage 推的是 gotoPage（滚动，不画框）', JSON.stringify(posted.at(-1)));
posted.length = 0;
await registeredCommands.get('anchorPdf.revealPage')?.('不是数字');
check(posted.length === 0, '页号不合法时什么都不推（它会去问用户，而不是瞎滚一页）');

// ---- 6. 「PDF 上不出现任何高亮框」的结构性保证 -----------------------------
check(
  !bundleText.includes('createTextEditorDecorationType') && !bundleText.includes('TextEditorDecorationType'),
  '线2 的产物里根本没有 decoration API（"不画框"不是靠自觉，是没有可画的东西）',
);
const overlay = readFileSync(path.join(PKG_DIR, 'media', 'anchor-select.js'), 'utf8');
check(existsSync(path.join(PKG_DIR, 'media', 'anchor-select.js')), 'media/anchor-select.js 在（运行时从扩展目录读）');
check(
  overlay.includes('anchor:captured') && overlay.includes('anchor:enterSelectMode') && overlay.includes('anchor:gotoPage'),
  '注入脚本用的是 §5.2 冻结的三个消息名，没有自创字段',
);
check(
  !/classList\.add\(['"]anchor-active['"]\)[\s\S]{0,400}?post\(/.test(overlay) === false ||
    overlay.includes('exitSelectMode'),
  '注入脚本有明确的退出口（否则橡皮筋会留在屏幕上）',
);

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
