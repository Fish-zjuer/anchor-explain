/**
 * 块流视图（相册）的排版预览 —— 把**真实生成**的 HTML 落到本地文件，浏览器打开就能看。
 *
 * 为什么值得有：相册的手感（等大、密集、方、圆角、悬浮、按下去的弹、徽标数字的位置）
 * **只能靠眼睛判**，而每改一次都让用户按一遍 F5 去看代价太高（侧边栏那份
 * `preview-sidebar.mjs` 是同一个理由，见 D50）。这里复用的是产物里同一份
 * `renderBlockStreamHtml` + `styles.ts` + `clientScript.ts`，只是把 `acquireVsCodeApi`
 * 换成桩 —— 所以看到的排版就是真排版。
 *
 * 它**不验证 DOM 行为**（点选/滑选仍要靠 F5），只解决"改完一眼能看"。
 * 样本刻意造得多（24 块），因为**相册这件事只有在格子够多时才看得出来**：
 * 五六块的时候它长得像列表，二十来块才像相册。
 *
 * 用法：node scripts/preview-blocks.mjs [--serve]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, '.tmp-preview');
const OUT = path.join(OUT_DIR, 'blocks-preview.html');

// Windows 下动态 import 必须给 file:// URL，不能给盘符路径
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const { registryFrom, resolveIds, EMPTY_QUEUE, enqueue, orderedBlocks, describeOrder, badgeNumbers, reflow } = await load(
  'packages/pdf-blocks/src/index.ts',
);
const { blockViewOf, cardsSummary } = await load('packages/extension-anchor/src/blocks/ui/model.ts');
const { renderBlockStreamHtml } = await load('packages/extension-anchor/src/blocks/ui/html.ts');

const part = (page, y1, y2, x1 = 0.1, x2 = 0.9) => ({ page, bbox: [x1, y1, x2, y2] });
const B = (id, kind, text, parts, extra = {}) => ({
  id,
  kind,
  text,
  parts,
  partTexts: parts.map(() => text),
  ...extra,
});

// ── 样本：一份双栏论文的两页多一点（含图、图注、表、跨页段、OCR 过的图、空壳） ──
const paragraphs = [
  '梯度下降是一阶迭代优化算法：它不构造二阶信息，只沿着当前点的负梯度方向把参数往前推一步。代价是收敛速度对条件数很敏感 —— 条件数大时，等高线被拉成狭长的谷，迭代会在谷壁之间来回震荡。',
  '步长 α 的选择直接决定收敛与震荡的分界。固定步长的判据来自损失函数的二阶上界：α 必须小于 2/L（L 是梯度 Lipschitz 常数），否则更新会越过极小点。',
  '在实际训练里 α 通常由调度器给出：前若干轮用较大值快速下降，接近极小点时收小以免跨过谷底。这条经验背后是同一件事 —— 早期需要大位移，后期需要小位移。',
  '动量的作用是把「本轮的梯度」换成「历史梯度的指数平均」。它让参数在梯度方向一致时加速，在方向来回变时自动抵消，这也是它比纯梯度下降抗震荡的原因。',
  '把学习率按轮次衰减之后，损失曲线在大约第 40 轮进入平台期，此后继续训练只带来极小的收益，而验证集上的表现开始',
];
const tailParagraph = '回落，这时继续迭代已经没有意义，早停是更划算的选择，也更省算力。';

const HEAD = B('f-head', 'heading', '3.2 梯度下降与学习率', [part(12, 0.06, 0.095)], { headingLevel: 2 });
const P12 = paragraphs.slice(0, 2).map((t, i) => B(`f-p12-${i}`, 'text', t, [part(12, 0.11 + i * 0.09, 0.19 + i * 0.09)]));
const FIG = B('f-fig', 'image', '', [part(12, 0.30, 0.50)]);
const CAP = B('f-cap', 'text', '图 3.4 损失随迭代次数的下降曲线（峰值处学习率过大造成震荡）', [part(12, 0.505, 0.53)]);
const P12B = [
  B('f-p12-2', 'text', paragraphs[2], [part(12, 0.55, 0.65)]),
  B('f-p12-3', 'text', paragraphs[3], [part(12, 0.66, 0.78)]),
];
const P12C = B('f-p12-4', 'text', paragraphs[4], [part(12, 0.79, 0.88)]);
const P13A = B('f-p13-0', 'text', tailParagraph, [part(13, 0.10, 0.17)]);
const TABLE = B(
  'f-table',
  'text',
  '学习率 | 收敛轮次 | 验证损失\n0.30 | 不收敛 | —\n0.10 | 118 | 0.412\n0.03 | 240 | 0.398\n0.01 | 610 | 0.401',
  [part(13, 0.19, 0.36)],
  { grouped: true },
);
const P13B = [
  '早停的判据不该只看验证损失的最低点：它本身是噪声的，通常取「连续若干轮没有改善」再回退到最佳权重。',
  '如果要更稳，可以把早停与学习率衰减合起来用 —— 平台期先降一次学习率，仍无改善才停。',
];
const P13B_BLOCKS = P13B.map((t, i) => B(`f-p13-${i + 1}`, 'text', t, [part(13, 0.38 + i * 0.08, 0.44 + i * 0.08)]));
const FIG2 = B('f-fig2', 'image', '', [part(13, 0.53, 0.66)]);
const FIG2_CAP = B('f-fig2-cap', 'text', '图 3.5 不同学习率下的收敛轨迹对比', [part(13, 0.665, 0.69)]);
const P14 = [
  '第三，把上面三条放进一个统一的框架：学习率、动量、早停分别管「步多大」「往哪走稳」「什么时候停」，它们之间没有替代关系。',
  '实践中调参的次序通常是：先固定一个能收敛的学习率，再加动量，最后加调度与早停。',
  '反过来做，你会在一个本来就不收敛的配置上调后面那些旋钮，看到的每一个现象都不可信。',
].map((t, i) => B(`f-p14-${i}`, 'text', t, [part(14, 0.10 + i * 0.09, 0.17 + i * 0.09)]));
const EMPTY = B('f-empty', 'text', '   ', [part(14, 0.40, 0.42)]);
const FIG3 = B('f-fig3', 'image', '', [part(14, 0.44, 0.58)]);

const SOURCE = [
  HEAD,
  ...P12,
  FIG,
  CAP,
  ...P12B,
  P12C,
  P13A,
  TABLE,
  ...P13B_BLOCKS,
  FIG2,
  FIG2_CAP,
  ...P14,
  EMPTY,
  FIG3,
];

// 引擎的内容指纹 ID → 冻结 ID（D100 那一层；真实链路上这一步在拆块之后立刻做）
const first = registryFrom(SOURCE, 'demo-doc');
const byFp = new Map(SOURCE.map((b, i) => [b.id, first.blocks[i]]));

// 跨页缝合：第 12 页末段 + 第 13 页首段合成一块（模拟引擎的 stitchPages）
const stitched = {
  id: byFp.get('f-p12-4').id,
  kind: 'text',
  text: paragraphs[4] + tailParagraph,
  parts: [part(12, 0.79, 0.88), part(13, 0.10, 0.17)],
  partTexts: [paragraphs[4], tailParagraph],
  stitched: true,
};
const folded = resolveIds(
  first.registry,
  first.blocks
    .filter((b) => b.id !== byFp.get('f-p13-0').id && b.id !== byFp.get('f-p12-4').id)
    .concat([stitched])
    .sort((a, b) => a.parts[0].page - b.parts[0].page || a.parts[0].bbox[1] - b.parts[0].bbox[1]),
);
const finalBlocks = folded.blocks;
const index = new Map(finalBlocks.map((b) => [b.id, b]));

// 选五块（含跨页那一块与两张图），让"已选 + 徽标号"在预览里一眼可见
let queue = EMPTY_QUEUE;
for (const b of [finalBlocks[0], finalBlocks[2], finalBlocks[5], finalBlocks[7], finalBlocks[12]]) {
  queue = enqueue(queue, b.id).queue;
}

// 示意用的裁剪图（内联 SVG dataURL）：真实链路里是宿主从页面栅格裁出来的
const crop = (label, hue) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160"><rect width="240" height="160" fill="#1b1b1b"/><polyline fill="none" stroke="${hue}" stroke-width="2" points="14,132 46,124 74,110 100,120 130,84 158,90 190,50 228,46"/><line x1="14" y1="142" x2="228" y2="142" stroke="#3c3c3c"/><text x="14" y="22" fill="#9d9d9d" font-size="11">${label}</text></svg>`,
  );

const images = new Map([
  [byFp.get('f-fig').id, crop('loss vs iter', '#4daafc')],
  [byFp.get('f-fig2').id, crop('lr 0.03 vs 0.10', '#cca700')],
]);

const view = blockViewOf(finalBlocks, queue, index, { images });
const orderText = describeOrder(queue, index);
const queued = badgeNumbers(queue, index).size;

const { text } = reflow(orderedBlocks(queue, index), { docLabel: '深度学习 第 3 章 · 12–14 页' });

const html = renderBlockStreamHtml(
  'vscode-webview://preview',
  {
    docLabel: '深度学习 第 3 章 · 12–14 页',
    summary: cardsSummary(view, queued, orderText),
    view,
    orderText,
    queued,
  },
  1,
  'zh',
);

/** 预览用的 VS Code 深色变量近似值。真机里由 VS Code 注入，**只影响预览观感**，不影响产物。 */
const THEME_VARS = `
:root {
  --vscode-font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
  --vscode-font-size: 13px;
  --vscode-foreground: #cccccc;
  --vscode-editor-background: #1e1e1e;
  --vscode-editorWidget-background: #252526;
  --vscode-sideBar-background: #252526;
  --vscode-descriptionForeground: #9d9d9d;
  --vscode-panel-border: #3c3c3c;
  --vscode-focusBorder: #007fd4;
  --vscode-list-hoverBackground: #2a2d2e;
  --vscode-list-activeSelectionBackground: #04395e;
  --vscode-list-activeSelectionForeground: #ffffff;
  --vscode-list-inactiveSelectionBackground: #37373d;
  --vscode-editorInfo-foreground: #3794ff;
  --vscode-editorWarning-foreground: #cca700;
  --vscode-button-background: #0e639c;
  --vscode-button-foreground: #ffffff;
  --vscode-button-secondaryBackground: #3a3d41;
  --vscode-button-secondaryHoverBackground: #45494e;
  --vscode-button-secondaryForeground: #cccccc;
  --vscode-editor-font-family: Consolas, "Courier New", monospace;
}
/* 预览用：把相册放进一个"面板宽度"的框里，真机里宽度就是面板宽。 */
body { min-height: 100vh; }
#root { width: 480px; margin: 0 auto; outline: 1px dashed #3c3c3c; }
.preview-note {
  width: 480px;
  margin: 14px auto 22px;
  padding: 10px 12px;
  border: 1px dashed var(--vscode-panel-border);
  border-radius: 4px;
  color: var(--vscode-descriptionForeground);
  font-size: 0.8em;
  white-space: pre-wrap;
}
`;

const nonce = /<script nonce="([^"]+)"/.exec(html)?.[1] ?? 'preview';

const boot = `<script nonce="${nonce}">
window.__posted = [];
window.acquireVsCodeApi = function () {
  return { postMessage: function (m) { window.__posted.push(m); }, getState: function () {}, setState: function () {} };
};
</script>`;

// 说明放在**页面最下面**：排版预览的第一屏应该全是相册，不该被一段说明占掉
const note = `<div class=preview-note>本页是<b>排版预览</b>（面板宽 480px）。主题变量是近似值。
<b>相册</b>：每块等大（正方）、密集（4px 缝）、圆角 3px。文字块显示<b>提取好的正文</b>（底部渐隐，
悬停看 tooltip 全文），图块显示裁剪图，跨页块中间一道虚线接缝。
<b>块是静止的</b>：不动的时候块和块内元素一个动画都没有（呼吸、扫光都撤了，见 D105）；
悬停只把边框点亮 —— 砖的位置、角度、大小在任何状态下都不变。
右上角那个灰半透明粗体数字在“悬停（预览第几个发出）/ 选中（发送位次）”之间切换。
点选与按住滑选在这页看不到界面反应（没人接消息，DOM 行为靠 F5 验），只有按下去会弹一下。
D106~D114 那七轮立体（孔口 / 会转的底面 / 坑壁 / 玻璃 / 视线跟随）已按用户的意思<b>全部删掉</b>，
只留相册（D115）—— 现在一整块砖上没有任何 3D。

下面是这次会发出去的稿子（块编号与相册里的数字是同一批）：

${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`;

const out = html
  .replace('</head>', `<style nonce="${nonce}">${THEME_VARS}</style></head>`)
  .replace('</body>', `${note}\n${boot}\n</body>`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, out, 'utf8');
console.log(`[preview] 块流相册预览已生成：${OUT}`);
console.log(`[preview] ${view.cards.length} 块，已选 ${queued} 块（徽标号 ${[...badgeNumbers(queue, index).values()].join('/')}）。`);
console.log('[preview] 用浏览器打开即可（或 pnpm preview:blocks 起本地服务）。它只反映排版，DOM 行为仍要靠 F5 验。');

if (process.argv.includes('--serve')) {
  const { createServer } = await import('node:http');
  const { readFileSync } = await import('node:fs');
  const port = 8732;

  createServer((req, res) => {
    const name = path.basename(new URL(req.url, 'http://x').pathname) || 'blocks-preview.html';
    try {
      const body = readFileSync(path.join(OUT_DIR, name));
      res.writeHead(200, { 'Content-Type': name.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
    }
  }).listen(port, '127.0.0.1', () => {
    console.log(`[preview] 已起本地预览服务：http://127.0.0.1:${port}/blocks-preview.html`);
    console.log('[preview] Ctrl+C 结束。');
  });
}
