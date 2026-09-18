/**
 * 侧边栏样式。**只用 VS Code 主题变量**（`--vscode-*`），不写死颜色 ——
 * 与 §4.3「全部走主题色变量」是同一条约束的两侧：编辑器里是 decoration 主题色，这里是 CSS 变量。
 *
 * 为什么 CSS 放在 TS 里而不是 `.css` 文件：侧边栏的 HTML 由宿主一次性生成并内联（见 html.ts），
 * 不引入 `asWebviewUri` / 静态资源拷贝，`esbuild` 打包时它自然跟着产物走，没有第二个拷贝步骤。
 *
 * ## 两条对齐纪律（用户实测提过"有点没对齐"）
 *
 * 1. **标签列固定宽**（`--anchor-tag-w`）。`上下文` 是 3 个字、`定义`/`注意` 是 2 个，
 *    若各按内容撑开，后面那截讲解文字的左边缘就会逐行错开。固定宽 + 居中之后，
 *    所有讲解文字从同一条竖线开始。
 * 2. **标记槽固定宽**（`--anchor-gutter-w`）。"正在扫"的那一行有个 `▸`，
 *    若这个字符只存在于那一行，那一行整体会被顶右 3–4px，上下两行的标签就对不齐了。
 *    所有行都占同样宽的槽（空行也留着），`▸` 只是往槽里填内容。
 *
 * ## 一条层级纪律（用户实测提过"布局不够鲜明、没有突出点"）
 *
 * **非当前步骤一律压暗**（`.step:not(.current)`），不管它在当前步之前还是之后。
 * 第一版只压暗"已讲过的"，于是还没讲的那些和当前步一样亮 —— 走到第 1 步时整屏都在喊。
 */

export const SIDEBAR_STYLES = `
:root {
  --anchor-gap: 10px;
  --anchor-radius: 4px;
  --anchor-tag-w: 4.6em;
  --anchor-gutter-w: 14px;
  --anchor-accent-w: 3px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 0;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
  line-height: 1.6;
}

#root { padding: var(--anchor-gap) var(--anchor-gap) 0; }

/* ── 头部：整段讲解的定位 ───────────────────────────────────── */

.header { margin-bottom: 14px; }

.header .doc-title {
  font-size: 1.15em;
  font-weight: 700;
  margin: 0 0 6px;
  line-height: 1.35;
}

.summary {
  margin: 0 0 8px;
  font-size: 0.95em;
  color: var(--vscode-descriptionForeground);
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 0.8em;
  color: var(--vscode-descriptionForeground);
}

.meta .badge {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 999px;
  padding: 0 8px;
  white-space: nowrap;
}

/* 当前拍的那一条单独给点颜色，让"现在在哪"一眼可见 */
.meta .badge.live {
  border-color: var(--vscode-focusBorder);
  color: var(--vscode-foreground);
  font-weight: 600;
}

/* ── 步骤列表 ───────────────────────────────────────────────── */

.steps { list-style: none; margin: 0; padding: 0; }

.step {
  border: 1px solid transparent;
  border-left: var(--anchor-accent-w) solid transparent;
  border-radius: var(--anchor-radius);
  padding: 8px 10px;
  margin-bottom: 6px;
  cursor: pointer;
  /* 非当前步压暗：之前和之后的一视同仁，否则"当前步"没有焦点可言。
     0.62 是兼顾的：再低读起来费劲（面板是阅读面），再高当前步就不突出了。 */
  opacity: 0.62;
}

.step + .step { border-top: 1px dashed var(--vscode-panel-border); }

.step:hover { opacity: 1; background: var(--vscode-list-hoverBackground); }

.step.current {
  opacity: 1;
  border-color: var(--vscode-focusBorder);
  border-left-width: var(--anchor-accent-w);
  background: var(--vscode-list-inactiveSelectionBackground);
  padding-bottom: 12px;
}

.step-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.step .step-title {
  font-size: 1.02em;
  font-weight: 600;
}

.step.current .step-title { font-size: 1.08em; }

/* 位置标签做成小胶囊：比下划线更像"可点的东西"，也和标题在同一基线上 */
.loc {
  font: inherit;
  font-size: 0.78em;
  color: var(--vscode-textLink-foreground);
  background: var(--vscode-badge-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 999px;
  padding: 0 8px;
  cursor: pointer;
  white-space: nowrap;
}

.loc:hover {
  color: var(--vscode-textLink-activeForeground);
  border-color: var(--vscode-textLink-activeForeground);
}

.intro {
  margin: 6px 0 0;
  font-size: 0.92em;
  color: var(--vscode-descriptionForeground);
  font-style: italic;
}

.text {
  margin: 6px 0 0;
  font-size: 0.95em;
  white-space: pre-wrap;
}

/* ── 步内逻辑点（"荧光扫描"的列表侧对应物）─────────────────── */

.highlights { list-style: none; margin: 10px 0 0; padding: 0; }

.highlights li {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 4px 6px;
  font-size: 0.88em;
  color: var(--vscode-descriptionForeground);
  border-left: var(--anchor-accent-w) solid transparent;
  border-radius: 3px;
}

/* 固定槽：没有 ▸ 的行也占同样宽，保证标签列永远在同一条竖线上 */
.highlights .mark {
  flex: 0 0 var(--anchor-gutter-w);
  text-align: center;
  color: var(--vscode-focusBorder);
  font-weight: 700;
}

/* 正在被扫描的那一行 —— 面板里的"突出点" */
.highlights li.scanning {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
  border-left-color: var(--vscode-focusBorder);
  font-weight: 600;
  /* 底部工具条是 sticky 的，会盖住滚动区最后约一行的高度。
     留出这段 margin，客户端那句 scrollIntoView 才不会把这一行刚好停在工具条底下。 */
  scroll-margin-bottom: 64px;
}

/* 扫描行里的标签去掉填充，只留描边：两个实心底色叠在一起会显得脏 */
.highlights li.scanning .tag { background: transparent; }

.tag {
  flex: 0 0 var(--anchor-tag-w);
  font-size: 1em;
  text-align: center;
  border-radius: 3px;
  padding: 0 2px;
  border: 1px solid var(--vscode-panel-border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.highlights li.scanning .tag { border-color: currentColor; }
.tag-primary { border-color: var(--vscode-editor-findMatchBorder); }
.tag-definition { border-color: var(--vscode-editorInfo-foreground); }
.tag-caveat { border-color: var(--vscode-editorWarning-foreground); }

.narration { flex: 1 1 auto; }

/* ── 工具条与取件日志 ───────────────────────────────────────── */

.toolbar {
  position: sticky;
  bottom: 0;
  display: flex;
  gap: 6px;
  padding: 10px 0;
  margin-top: 12px;
  background: var(--vscode-sideBar-background);
  border-top: 1px solid var(--vscode-panel-border);
}

.toolbar button,
.rerun button {
  font: inherit;
  font-size: 0.9em;
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
  border: none;
  border-radius: var(--anchor-radius);
  padding: 3px 12px;
  cursor: pointer;
}

.toolbar button:hover:not(:disabled),
.rerun button:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }

.toolbar button:disabled,
.rerun button:disabled { opacity: 0.45; cursor: default; }

.trace { margin-top: 12px; font-size: 0.82em; padding-bottom: var(--anchor-gap); }

.trace h2 {
  font-size: 0.95em;
  margin: 0 0 4px;
  color: var(--vscode-descriptionForeground);
  font-weight: 600;
}

.trace ul { list-style: none; margin: 0; padding: 0; }

.trace li {
  padding: 2px 0;
  border-bottom: 1px solid var(--vscode-panel-border);
  color: var(--vscode-descriptionForeground);
  word-break: break-all;
}

.ended {
  margin-top: var(--anchor-gap);
  color: var(--vscode-descriptionForeground);
  font-style: italic;
}

/**
 * D83：讲完之后那两颗按钮（重放上次讲解 / 重新讲一遍）。
 *
 * 与上面那段 .ended 说明是**一对**：说明说"还能做什么"，这一行是"能做"。
 * 放在工具条**上方**而不是塞进工具条：工具条那三颗是"这一遍讲解的推进"，
 * 而这两颗是"再开一遍" —— 混在一行里，用户会以为「上一步」与「重放」是同类操作。
 * 按钮的配色与尺寸直接复用工具条那一套（见上面合并后的选择器），不各写一份。
 *
 * 注意：本文件整个是**内联进 webview 的模板字符串**，注释里一个反引号都不许有
 * （写一个就把字符串截断，面板一片空白 —— 与 clientScript 同一条坑，D70）。
 */
.rerun {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  padding-bottom: var(--anchor-gap);
}

.empty { color: var(--vscode-descriptionForeground); }

/* 面板脚本出错时那一行（D70）：不能只留在控制台 —— 用户看到的是"卡死" */
.client-error {
  margin: 0 0 var(--anchor-gap) 0;
  padding: 6px 8px;
  border-left: 3px solid var(--vscode-editorError-foreground, #f14c4c);
  color: var(--vscode-editorError-foreground, #f14c4c);
  font-size: 0.85em;
  word-break: break-all;
}
`;
