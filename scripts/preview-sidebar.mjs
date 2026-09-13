/**
 * 侧边栏排版预览 —— 把**真实生成**的侧边栏 HTML 落到一个本地文件，用浏览器打开就能看排版。
 *
 * 为什么值得有这个东西：侧边栏的排版（对齐、层级、哪里该突出）是**只能靠眼睛判**的，
 * 而每次改完都让用户按一遍 F5 去看，代价太高。这里复用的是产物里同一份
 * `renderSidebarHtml` + `styles.ts` + `clientScript.ts`，只是把
 * `acquireVsCodeApi` 换成桩、再喂一条假的 `session:update`，所以看到的排版就是真排版。
 *
 * 它**不验证行为**（DOM 交互仍要靠 F5），只解决"改完一眼能看"。
 *
 * 用法：node scripts/preview-sidebar.mjs [切到第几拍]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, '.tmp-preview');
const OUT = path.join(OUT_DIR, 'sidebar-preview.html');

// Windows 下动态 import 必须给 file:// URL，不能给盘符路径
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const { renderSidebarHtml } = await load('packages/extension-anchor/src/sidebar/ui/html.ts');
const { defaultChords } = await load('packages/extension-anchor/src/sidebar/keybindingResolve.ts');

const FILE = 'main.c';
/** 与 fakes/fakeProvider.ts 的脚本一致，只是把行号换成预览用的空文件 */
const SAMPLE = {
  title: '环形队列的出队路径',
  summary:
    '这 9 行是一个标准的环形队列出队：先挡住空队列，再从 head 取值并把指针往前推，最后维护 count。三个动作的顺序不能换 —— 先判断、后取值、再改状态。',
  confidence: 0.9,
  steps: [
    {
      location: { filePath: FILE, lineStart: 40, lineEnd: 42 },
      title: '出队前先挡住空队列',
      intro: 'rb_pop 要先回答一个问题：队列里还有东西吗？没有就当场认输，一个指针都不碰。',
      text: '第 40 行是函数签名，两个参数分别是要操作的环形队列，以及接住结果的出参指针。第 42 行是提前返回：count 为 0 时直接返回 -1，调用方据此知道这次出队没拿到数据。注意这里把「空」当成正常返回值而不是异常，所以 main 里的 while 循环可以写得很干净。',
      highlights: [
        {
          location: { filePath: FILE, lineStart: 40, lineEnd: 40 },
          narration: 'out 是出参指针，用来把取到的值带回调用方 —— 因为返回值已经被 -1 / 0 占满了。',
          emphasis: 'context',
        },
        {
          location: { filePath: FILE, lineStart: 42, lineEnd: 42 },
          narration: '空队列返回 -1：这是本函数的失败信号，也是 main 里 while 的终止条件。',
          emphasis: 'definition',
        },
      ],
    },
    {
      location: { filePath: FILE, lineStart: 44, lineEnd: 45 },
      title: '取值，并把 head 往前推',
      intro: '数据在 head 指向的位置。取走之后 head 必须跟着走，否则下次会重复取到同一个元素。',
      text: '第 44 行把 head 位置的元素写进 out 指向的内存。第 45 行推进 head，并对 RB_CAPACITY 取模：取模是环形队列的全部关键 —— head 走到数组末尾时会自动折回 0，不需要额外的分支判断。',
      highlights: [
        {
          location: { filePath: FILE, lineStart: 44, lineEnd: 44 },
          narration: '*out 是解引用赋值，改的是调用方栈上的变量，不是本地副本。',
          emphasis: 'primary',
        },
        {
          location: { filePath: FILE, lineStart: 45, lineEnd: 45 },
          narration: '对容量取模实现了回绕：这就是「环形」二字的全部实现成本。',
          emphasis: 'definition',
        },
      ],
    },
    {
      location: { filePath: FILE, lineStart: 46, lineEnd: 48 },
      title: '维护计数并报告成功',
      intro: '指针动了，count 也得动。否则下一次的空队列判断就会出错。',
      text: '第 46 行把 count 减一：它是本结构里「现在有多少元素」的唯一真相来源。head 和 tail 相等并不代表队列为空 —— 满和空两种情况都会让两者相等，只有 count 说了算。第 47 行返回 0 表示成功。',
      highlights: [
        {
          location: { filePath: FILE, lineStart: 46, lineEnd: 46 },
          narration: 'count 是唯一权威：head == tail 在「满」和「空」时都成立，单看指针会误判。',
          emphasis: 'caveat',
        },
        {
          location: { filePath: FILE, lineStart: 47, lineEnd: 47 },
          narration: '返回 0 表示成功，与上面的 -1 共同构成这对函数的约定。',
          emphasis: 'context',
        },
      ],
    },
  ],
};

/** 预览用的 VS Code 深色变量近似值。真机里这些由 VS Code 注入，所以**只影响预览观感**，不影响产物。 */
const THEME_VARS = `
:root {
  --vscode-font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
  --vscode-font-size: 13px;
  --vscode-foreground: #cccccc;
  --vscode-sideBar-background: #252526;
  --vscode-descriptionForeground: #9d9d9d;
  --vscode-panel-border: #3c3c3c;
  --vscode-focusBorder: #007fd4;
  --vscode-list-hoverBackground: #2a2d2e;
  --vscode-list-activeSelectionBackground: #04395e;
  --vscode-list-activeSelectionForeground: #ffffff;
  --vscode-list-inactiveSelectionBackground: #37373d;
  --vscode-textLink-foreground: #3794ff;
  --vscode-textLink-activeForeground: #4daafc;
  --vscode-badge-background: #4d4d4d;
  --vscode-button-secondaryBackground: #3a3d41;
  --vscode-button-secondaryHoverBackground: #45494e;
  --vscode-button-secondaryForeground: #cccccc;
  --vscode-editor-findMatchBorder: #f8a11f;
  --vscode-editorInfo-foreground: #3794ff;
  --vscode-editorWarning-foreground: #cca700;
}
/* 不给 body 定宽：真机里侧边栏的宽就是面板宽。要试窄面板请改浏览器视口宽度。 */
body { min-height: 100vh; }
`;

const html = renderSidebarHtml('vscode-webview://preview', defaultChords(false));
const nonce = /<script nonce="([^"]+)"/.exec(html)?.[1] ?? 'preview';

const boot = `<script nonce="${nonce}">
window.__posted = [];
window.acquireVsCodeApi = function () {
  return { postMessage: function (m) { window.__posted.push(m); }, getState: function () {}, setState: function () {} };
};
</script>`;

const feed = `<script nonce="${nonce}">
var SAMPLE = ${JSON.stringify(SAMPLE)};
</script>
<script nonce="${nonce}">
window.dispatchEvent(new MessageEvent('message', {
  data: { type: 'session:update', result: SAMPLE, index: 2, state: 'running', pointIndex: 0 }
}));
</script>`;

const out = html
  .replace('</head>', `<style nonce="${nonce}">${THEME_VARS}</style></head>`)
  .replace('<div id="root"></div>', `<div id="root"></div>\n${boot}`)
  .replace('</body>', `${feed}\n</body>`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, out, 'utf8');
console.log(`[preview] 侧边栏排版预览已生成：${OUT}`);
console.log('[preview] 用浏览器打开即可。它只反映排版（DOM 行为仍要靠 F5 验）。');

// `--serve` 起一个只读的本地静态服务：浏览器工具打不开 file://，只能走 http。
// 顺带也方便你自己开一个窗口边改边看。
if (process.argv.includes('--serve')) {
  const { createServer } = await import('node:http');
  const { readFileSync } = await import('node:fs');
  const port = 8731;

  createServer((req, res) => {
    const name = path.basename(new URL(req.url, 'http://x').pathname) || 'sidebar-preview.html';
    const file = path.join(OUT_DIR, name);
    try {
      const body = readFileSync(file);
      const type = name.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
    }
  }).listen(port, '127.0.0.1', () => {
    console.log(`[preview] 已起本地预览服务：http://127.0.0.1:${port}/sidebar-preview.html`);
    console.log('[preview] Ctrl+C 结束。');
  });
}
