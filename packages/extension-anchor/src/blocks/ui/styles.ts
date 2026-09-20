/**
 * 块流视图（相册）的样式。**只用 VS Code 主题变量**（`--vscode-*`），不写死颜色 ——
 * 与侧边栏（`sidebar/ui/styles.ts`）同一条约束：编辑器里走 decoration 主题色，
 * webview 里走 CSS 变量，两边都不许出现"我觉得好看"的固定色。
 *
 * CSS 放 TS 里而不是 `.css` 文件：HTML 由宿主一次性生成并内联（同 sidebar 的理由），
 * 不引入 `asWebviewUri` / 静态资源拷贝，esbuild 打包时自然跟着产物走。
 *
 * ⚠⚠ **本文件是模板字符串的宿主**：`BLOCK_VIEW_STYLES` 的**反引号之内**，
 * 一个字都不许出现反引号（会当场截断 CSS → 语法错、测试红），也不许出现未求值的 `${`
 * （那个更坏：**静默**留在产物里，只有 test/blockView.test.ts 那条断言挡得住）。
 * 写 CSS 注释时不要用反引号包属性名 —— 这个坑已经踩过三次。
 *
 * ## 版面：**相册**，不是列表（用户给了手机相册作参照）
 *
 * 用户的原话："每个块等大、密集。每个块里有一个缩略图，不一定展示完全内容…
 * 应该稍微密一点，方一点。" 所以：
 *
 *   - **等大**：`aspect-ratio: 1` + 网格行高一致 → 每块都是同一块砖；
 *   - **密集**：`gap: 4px`（"不完全紧贴"但不留大缝）；
 *   - **方一点**：圆角 3px、内边距压到 7px 8px；
 *   - **缩略图，不必完整**：文字块渲染**提取好的正文**（不是截图）并**底部渐隐**，
 *     图块渲染那一块的裁剪（`object-fit: cover`）。悬停时 `title` 给出全文。
 *
 * 格子宽度用 **em**（`--anchor-tile: 7.6em`）：用户调字号系数时整块版面等比伸缩（D89）。
 *
 * ## 立体：**没有了，全删了**（D115）
 *
 * D106~D114 有七轮在给这块砖做立体（浅箱 → 凹进去的箱 → 坑 → "砖不动、视线动"的投影孔 →
 * 底面真的转 → 挖深加厚坑壁），每一轮的起因与判词都在 `DECISIONS.md`。
 * 最后一轮用户看着成果说：
 *
 * > "去掉后面的所有设计吧，你根本实现不了我的想法，那都去掉吧，只留相册设计"
 *
 * 所以下面这些**一个字都不留**（删得干净比留着调参重要，留着就会有人再去调它）：
 *
 *   - 四层结构 `.window`（孔口）/ `.plane`（会转的底面）/ `.wall-*`（坑壁）/ `.glass`（玻璃）；
 *   - 视线：`--eye-x` / `--eye-y` 两个变量、`@property` 注册、240ms 的插值过渡、
 *     以及几何旋钮 `--anchor-depth` / `--anchor-far` / `--anchor-tilt` / `--anchor-plane` /
 *     `--anchor-rim`、`container-type: size` 与那些 `cqh`；
 *   - 玻璃反光、底面暗角（那两片就是用户说的"固定遮罩"，它压在内容之上）；
 *   - 底面的字号补偿 —— 内容现在就是原尺寸，不再放大缩小。
 *
 * 相册的骨架原样留着（它们不依赖上面任何一条）：等大的砖、密集的网格、缩略图 + 底部渐隐、
 * 悬停才显的页码条、右上角那颗数字、按下去的弹。
 *
 * ## 手感纪律（D105 立的；D115 之后**只剩两条**）
 *
 * 1. **静止是默认**：块与块内元素在"用户没在操作"时**没有任何动画**（撤掉过 3.2s 的呼吸）。
 * 2. **外框绝对不动**：砖的位置、角度、大小在任何状态下都不许变 ——
 *    悬停位移被骂过（"很吸引视线，又让人很难受"），整块砖转也被骂过（"晃动很累"）。
 *    不装变换还有一层好处：密集网格里十几块同时悬停也不会有相对错动。
 * 3. **不做整屏扫光**：做过一版 `.cone` 光锥，用户明确否掉（"不要后面一道光在这扫"）。
 * 4. **动只作为指针的回执**：现在只剩"按下去弹一下"（`.pop`，260ms），
 *    而且只动被按的那一块。悬停只换边框色，**不位移**。
 */

export const BLOCK_VIEW_STYLES = `
:root {
  --anchor-radius: 3px;
  --anchor-gap: 4px;
  --anchor-tile: 7.6em;
  --anchor-bar: 22px;
  --anchor-tile-bg: var(--vscode-editorWidget-background, var(--vscode-editor-background));
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 0;
  font-family: var(--vscode-font-family);
  font-size: calc(var(--vscode-font-size, 13px) * var(--anchor-font-scale, 1));
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  line-height: 1.5;
}

#root { padding: var(--anchor-gap); }

/* ── 顶部一行 + 底部一条（都贴在边上，中间全是相册） ───────────── */

.stream-head {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  padding: 4px 2px 8px;
  background: var(--vscode-editor-background);
}

.stream-head .doc { font-weight: 600; }
.stream-head .summary { font-size: 0.82em; color: var(--vscode-descriptionForeground); }

.stream-foot {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-top: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
}

.stream-foot .count { font-size: 0.82em; color: var(--vscode-descriptionForeground); }
.stream-foot .spacer { flex: 1; }

button.action {
  font: inherit;
  font-size: 0.82em;
  padding: 2px 9px;
  border-radius: var(--anchor-radius);
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  cursor: pointer;
}

button.action:hover { background: var(--vscode-button-secondaryHoverBackground); }
button.action.primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border-color: var(--vscode-button-background);
}
button.action.primary:disabled { opacity: 0.5; cursor: default; }

/* ── 相册网格：等大、密集、方 ─────────────────────────────────── */

.stream {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--anchor-tile), 1fr));
  gap: var(--anchor-gap);
  padding-bottom: calc(var(--anchor-bar) + 26px);
}

/*
  一格（相册里的一张）。**它自己不装任何变换**：位置、角度、大小在任何状态下都不变 ——
  那七轮立体（D106→D114）做的都是"让这一格转起来/看出来是个坑"，用户最后一句是
  "那都去掉吧，只留相册设计"（D115）。所以：方（aspect-ratio 1/1）、密（网格的 gap）、
  等大（网格列宽一致）、圆角 3px、一条细边框 —— 就这些。

  overflow: hidden 是为了让图片的直角被圆角切掉（缩略图自己那层不负责切角）。
*/
.card {
  position: relative;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--anchor-radius);
  background: var(--anchor-tile-bg);
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease;
}

/* 悬停/选中：**只换边框色与底色，不位移、不缩放**（D105 第 2 条） */
.card:hover {
  z-index: 5;
  border-color: var(--vscode-focusBorder);
}

.card.selected {
  border-color: var(--vscode-focusBorder);
  background: var(--vscode-list-inactiveSelectionBackground);
}

/* 按下之后弹一下（过冲是全部要点）—— 客户端在按下时挂 .pop，动画结束自己摘掉。
   这是**唯一**会动的地方，而且只动被按的那一块。 */
.card.pop { animation: anchor-pop 260ms cubic-bezier(0.34, 1.56, 0.64, 1); }

@keyframes anchor-pop {
  0%   { transform: scale(1); }
  38%  { transform: scale(0.968); }
  68%  { transform: scale(1.012); }
  100% { transform: scale(1); }
}

/* ── 缩略图：不展示完全内容，但让人认得出 ─────────────────────── */

.thumb {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  /* 底下留出那条页码条的高度：它悬停才显，显出来时压在缩略图的空白处而不是字上 */
  padding: 7px 8px calc(var(--anchor-bar) - 4px);
  overflow: hidden;
}

.thumb-text {
  font-size: 0.72em;
  line-height: 1.42;
  overflow: hidden;
  /* 底部渐隐：告诉眼睛"这块还有下文"，比截断省略号更像相册。
     62% 起渐隐在第一版里切得太早（半句话就没了），放宽到 72% —— 能多读两行，
     又不至于让人以为"这就是全部"（悬停有 tooltip 全文兜底）。 */
  -webkit-mask-image: linear-gradient(to bottom, #000 72%, transparent 100%);
  mask-image: linear-gradient(to bottom, #000 72%, transparent 100%);
  word-break: break-word;
}

.card.kind-heading .thumb-text {
  font-size: 0.86em;
  font-weight: 700;
  line-height: 1.3;
}

/* 表格/清单/代码段：等宽更像"一整块"，行也更好数 */
.card.grouped .thumb-text {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 0.66em;
  white-space: pre-wrap;
}

/* 图块：裁剪图铺满整块（相册里那张"照片"） */
.thumb-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: var(--vscode-editor-background);
}

/* 拿不到裁剪时的占位：斜纹 + 一句实话，不假装有内容 */
.thumb-placeholder {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background-image: repeating-linear-gradient(
    45deg,
    var(--vscode-panel-border) 0 1px,
    transparent 1px 7px
  );
  color: var(--vscode-descriptionForeground);
  font-size: 0.68em;
  text-align: center;
  padding: 6px;
}

/* 空壳块：薄薄一层灰，认出来即可 */
.card.empty .thumb { justify-content: center; align-items: center; }
.card.empty .thumb-text {
  color: var(--vscode-descriptionForeground);
  font-style: italic;
  font-size: 0.68em;
  -webkit-mask-image: none;
  mask-image: none;
}

/* 跨页块：两片之间一道虚线接缝（相册里"这一块跨了两张"） */
.seam {
  margin: 3px -2px;
  border-top: 1px dashed var(--vscode-panel-border);
  flex: 0 0 auto;
}

/* ── 底部那一条：页码 + 属性（悬停或选中才显，保持网格干净） ──── */

.card-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: var(--anchor-bar);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  font-size: 0.66em;
  color: var(--vscode-descriptionForeground);
  /* 半透明底：压在缩略图上也能看清，且不用给文字加描边 */
  background: linear-gradient(to top, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0));
  border-radius: 0 0 var(--anchor-radius) var(--anchor-radius);
  opacity: 0;
  transition: opacity 120ms ease;
  z-index: 2;
}

.card:hover .card-bar,
.card.selected .card-bar { opacity: 1; }

.card-bar .page { white-space: nowrap; }
.card-bar .mark {
  border: 1px solid var(--vscode-focusBorder);
  border-radius: 999px;
  padding: 0 4px;
  color: #fff;
}

/* ── 那个数字（用户点名的那一条）：右上角，平时不显 ───────────── */

.card-action {
  position: absolute;
  top: 4px;
  right: 4px;
  display: grid;
  place-items: center;
  width: var(--anchor-bar);
  height: var(--anchor-bar);
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--anchor-radius);
  /* 深色半透明底：让那个"灰色半透明粗体数字"压在任何缩略图上都看得清 */
  background: rgba(0, 0, 0, 0.5);
  color: var(--vscode-foreground);
  font: inherit;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease, border-color 120ms ease;
  z-index: 2;
}

.card:hover .card-action,
.card.selected .card-action { opacity: 1; }
.card:hover .card-action { border-color: var(--vscode-focusBorder); }

/* ＋ 与数字叠在同一个格子里，谁显谁隐由状态决定 */
.card-action > * { grid-area: 1 / 1; }

.card-action .plus { opacity: 0.6; font-size: 1em; line-height: 1; }

.card-action .badge {
  opacity: 0;
  /* 灰、半透明、粗体 —— 三个字都照用户的原话 */
  color: var(--vscode-foreground);
  font-weight: 700;
  font-size: 0.9em;
  line-height: 1;
}

/* 已入队：常显它的**发送位次** */
.card.selected .card-action .badge { opacity: 0.62; }
.card.selected .card-action .plus { opacity: 0; }

/* 未入队 + 悬停：显示"加进去会是第几"（预览位次） */
.card:not(.selected):hover .card-action .badge { opacity: 0.5; }
.card:not(.selected):hover .card-action .plus { opacity: 0; }

/* 数字正文：两个取值的切换**只用 CSS**（徽标没有第二份真相） */
.card-action .badge::after { content: attr(data-pos); }
.card:not(.selected):hover .card-action .badge::after { content: attr(data-preview); }

/* ── 窄面板：格子跟着变小，但等大这条不变 ─────────────────────── */

@media (max-width: 300px) {
  :root { --anchor-tile: 6.4em; }
}

@media (prefers-reduced-motion: reduce) {
  .card, .card-action, .card-bar { transition: none; }
  .card.pop { animation: none; }
}
`;
