/**
 * S1 链路冒烟 —— 不启动 VS Code，把 `capture` 命令从选区一路跑到 decoration。
 *
 * 与 `smoke-extension.mjs` 的分工：
 *   - `smoke-extension.mjs`：产物能不能加载、命令有没有注册（**结构**）
 *   - 本脚本：一次真实讲解走完全链路，并检查高亮真的画对了行（**行为**）
 *
 * 只对最外层边界打桩（`vscode` 模块）。桩之外全是真的：
 *   - 真的读磁盘上的 `test/fixtures/main.c`（所以行数上界检查用的是真数据）
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
import { existsSync, readFileSync, statSync } from 'node:fs';
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
const lineCount = source.split(/\r?\n/).length - (source.endsWith('\n') ? 1 : 0);

const messages = [];
const registered = new Map();
const executed = [];
const decorationTypes = [];
const reveals = [];
const webviews = [];
const statusItems = [];
let applyEditCalls = 0;
let receiveFromWebview;

const editor = {
  document: {
    uri: { fsPath: MAIN_C },
    lineCount,
    getText: () => source,
    lineAt: (n) => ({ text: source.split(/\r?\n/)[n] ?? '' }),
  },
  decorations: new Map(),
  setDecorations(type, ranges) {
    editor.decorations.set(type, [...ranges]);
  },
  revealRange(range, kind) {
    reveals.push({ range: range.toString(), kind });
  },
};

const vscodeStub = {
  Position,
  Range,
  ThemeColor,
  MarkdownString,
  StatusBarAlignment: { Left: 1, Right: 2 },
  // 取值与 @types/vscode@1.90.0 的 index.d.ts 一致：OpenOpen=0、ClosedClosed=1。
  // 写反过一次（ClosedClosed: 0），那等于把"编辑时框不撑到新行"这条契约在测试里反转成相反语义。
  DecorationRangeBehavior: { OpenOpen: 0, ClosedClosed: 1, OpenClosed: 2, ClosedOpen: 3 },
  OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
  TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
  ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2 },
  Uri: { file: (p) => ({ scheme: 'file', fsPath: p }) },

  window: {
    visibleTextEditors: [editor],
    activeTextEditor: editor,
    showInformationMessage: (m) => (messages.push(['info', m]), Promise.resolve(undefined)),
    showWarningMessage: (m) => (messages.push(['warn', m]), Promise.resolve(undefined)),
    showErrorMessage: (m) => (messages.push(['error', m]), Promise.resolve(undefined)),
    showQuickPick: () => Promise.resolve(undefined),
    openTextDocument: () => Promise.resolve(editor.document),
    showTextDocument: () => Promise.resolve(editor),
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
    applyEdit() {
      applyEditCalls += 1;
      return Promise.resolve(true);
    },
    onDidChangeTextDocument: () => ({ dispose() {} }),
    onDidCloseTextDocument: () => ({ dispose() {} }),
    fs: {
      readFile: (uri) => Promise.resolve(readFileSync(uri.fsPath)),
      stat: (uri) => (existsSync(uri.fsPath) ? Promise.resolve(statSync(uri.fsPath)) : Promise.reject(new Error('ENOENT'))),
    },
  },

  extensions: { getExtension: () => undefined },
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
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// ---- 跑 -------------------------------------------------------------------
console.log(`[chain] 产物：${path.relative(ROOT, BUNDLE)}`);
console.log(`[chain] 样本：test/fixtures/main.c（${lineCount} 行）\n`);

const beforeBytes = sha1(readFileSync(MAIN_C));

const ext = require(BUNDLE);
const subscriptions = [];
ext.activate({
  subscriptions: { push: (...items) => subscriptions.push(...items) },
  globalStorageUri: { fsPath: path.join(ROOT, '.tmp-smoke', 'User', 'globalStorage', 'anchor.anchor-explain') },
});

check(decorationTypes.length === 0, '激活阶段不建 decoration type（延迟到第一次讲解）');

// ---- 1. 坏锚点必须被跨扩展入口挡下 ----------------------------------------
await registered.get('anchorExplain.explainAnchor')?.({ sourceType: 'code', sourceId: 1 });
check(messages.at(-1)?.[0] === 'error', '非法锚点走错误提示', messages.at(-1)?.[1] ?? '(无)');
check(webviews.length === 0, '非法锚点没有起会话');

// ---- 2. 正常捕获 -----------------------------------------------------------
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

// 第 1 步：40-42 铺底；40 上下文；42 定义
check(
  linesOf(typeByBackground('editor.selectionHighlightBackground')).join() === '40-42',
  '步级底色铺在第 40-42 行',
  linesOf(typeByBackground('editor.selectionHighlightBackground')).join() || '(空)',
);
check(
  linesOf(typeByBackground('editor.wordHighlightBackground')).join() === '40',
  'context 档落在第 40 行',
  linesOf(typeByBackground('editor.wordHighlightBackground')).join() || '(空)',
);
check(
  linesOf(typeByBorderColor('editorInfo.foreground')).join() === '42',
  'definition 档（左侧边线）落在第 42 行',
  linesOf(typeByBorderColor('editorInfo.foreground')).join() || '(空)',
);
check(reveals.at(-1)?.kind === 1, '用 InCenter 定位（TextEditorRevealType.InCenter = 1）', `kind=${reveals.at(-1)?.kind}`);
check(statusItems[0]?.shown === true, '状态栏显示中');
check(statusItems[0]?.text.includes('下一步'), '状态栏提示里带键位', statusItems[0]?.text ?? '');

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

// ---- 3. 流转 ---------------------------------------------------------------
registered.get('anchorExplain.next')?.();
await flush();
check(webviews[0].webview.posted.at(-1)?.index === 1, 'next 推进到第 2 步');
check(
  linesOf(typeByBackground('editor.selectionHighlightBackground')).join() === '44-45',
  '第 2 步的底色换到第 44-45 行（上一步的框被清掉）',
  linesOf(typeByBackground('editor.selectionHighlightBackground')).join() || '(空)',
);
check(
  linesOf(typeByBorderColor('editor.findMatchBorder')).join() === '44',
  'primary 档（强调描边）落在第 44 行',
  linesOf(typeByBorderColor('editor.findMatchBorder')).join() || '(空)',
);

registered.get('anchorExplain.next')?.();
await flush();
check(webviews[0].webview.posted.at(-1)?.index === 2, 'next 推进到第 3 步');
check(
  linesOf(typeByBorderColor('editorWarning.foreground')).join() === '46',
  'caveat 档（虚线警示）落在第 46 行',
  linesOf(typeByBorderColor('editorWarning.foreground')).join() || '(空)',
);
check(
  linesOf(typeByBackground('editor.selectionHighlightBackground')).join() === '46-48',
  '第 3 步的底色换到第 46-48 行',
  linesOf(typeByBackground('editor.selectionHighlightBackground')).join() || '(空)',
);

// 到最后一步再 next → 收尾
registered.get('anchorExplain.next')?.();
await flush();
const doneFrame = webviews[0].webview.posted.at(-1);
check(doneFrame?.state === 'done', '讲完落到 done', doneFrame?.state ?? '(无)');
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

// ---- 收尾 -----------------------------------------------------------------
Module._load = originalLoad;

if (failures.length) {
  console.error(`\n[chain] 失败 ${failures.length} 项：`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\n[chain] 全部通过');
