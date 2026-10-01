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
 * ## 两条层级纪律
 *
 * 1. **一次只有一块**（D125）。非当前步**折叠成一行索引**（序号 + 标题 + 位置），
 *    正文由客户端**根本不生成** —— 所以"只显示一块"是结构上的，
 *    不是靠调暗做出来的。从前是全部铺开、只把非当前步压到 0.62，
 *    那等于"所有内容都还在屏幕上"，翻到第 5 步时前 4 步的正文全在眼前（用户原话：
 *    "右侧列表不再是一次性展示出所有讲解内容。只显示一块"）。
 * 2. **当前块要明显压过索引行**：左侧粗色条 + 焦点描边 + 选中底色 + 更大的标题 +
 *    上下留白。索引行之间只用细虚线分；当前块两侧是留白，不参与"列表"的观感。
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
  /* D89：基准字号 = VS Code 字号 × 用户自己的缩放系数。系数变了只动这一行 ——
     下面的字号全是 em，整块布局等比例伸缩；固定槽宽（--anchor-gutter-w / --anchor-tag-w）
     不跟着缩，那是"列对齐"的职责，不能被字号动摇。 */
  font-size: calc(var(--vscode-font-size, 13px) * var(--anchor-font-scale, 1));
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
  line-height: 1.6;
}

/**
 * **两段式布局（D127）：内容区滚动，页脚钉住。**
 *
 * @anchor 原来工具条是 position: sticky; bottom: 0 —— 那只在"内容比面板高"时才贴得住；
 *         内容一短它就回到文档流里（紧跟在上面的内容之后）。于是换一步、展开/收起一块，
 *         三颗按钮就跟着上下跳。用户的原话是"把下一步什么的按钮固定在底部，
 *         不要随上面内容的变化而变"。
 *
 *         **sticky 治不了这件事** —— 它管的是"滚出视野时贴住"，不是"永远在底部"。
 *         要"永远在底部"就得让容器本身分两段：滚动的那一段吃剩余高度，
 *         钉住的那一段不参与滚动。
 */
#root {
  display: flex;
  flex-direction: column;
  /* 满高：VS Code 的 webview 视口就是面板高度，100vh 就是我们要的那个高度 */
  height: 100vh;
  /* 滚动交给 .pane，根节点自己不滚（不然会同时出现两条滚动条） */
  overflow: hidden;
}

/**
 * 滚动区。min-height: 0 不是多余的：flex 子项的默认 min-height: auto 会被内容撑高，
 * 于是 overflow-y 永远不生效、整块面板又变回"整页滚动"。这一行就是两段式能否成立的关键。
 */
.pane {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--anchor-gap) var(--anchor-gap) 0;
}

/**
 * 钉住的那一条：不滚、不缩，永远坐在面板底部。
 * 上边那条分隔线画在**整个页脚**上（而不是画在工具条上）——
 * 页脚里还有导出/历史与用量两行，线画在工具条上会显得它们属于滚动区。
 */
.foot {
  flex: 0 0 auto;
  padding: 0 var(--anchor-gap) 6px;
  border-top: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
}

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

/* ── 字号调节（D89）：头部右下的两颗小按钮 ──────────────────── */

.font-tools {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 4px;
}

/* 配色与尺寸复用工具条按钮那一套：同一块面板里不该有两种"小按钮"长相 */
.font-tools button {
  font: inherit;
  font-size: 0.8em;
  line-height: 1.2;
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
  border: none;
  border-radius: var(--anchor-radius);
  padding: 2px 9px;
  cursor: pointer;
}

.font-tools button:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

/* ── 步骤列表（两套排法，设置里可选：D125 / D129）────────────── */

.steps { list-style: none; margin: 0; padding: 0; }

/**
 * 一步。**共同的那点壳**——两套排法各自的样子在下面分开写。
 *
 * @anchor opacity: 1 明写出来（而不是"不赋值"）：压暗是**两套排法各自的决定**，
 *         不是共同的默认。默认样式把非当前步折成一行（本来就不抢眼），
 *         经典样式才需要压暗它。写成一个共同的 0.55 会让"一行索引"看着像被禁用了。
 */
.step {
  border: 1px solid transparent;
  border-left: var(--anchor-accent-w) solid transparent;
  border-radius: var(--anchor-radius);
  cursor: pointer;
  opacity: 1;
  padding: 8px 10px;
  margin-bottom: 6px;
}

/* ── 排法 A（默认，collapsible）：**非当前步 = 索引行**（D125）──
   一行高，只有序号 + 标题 + 位置（正文节点由客户端**不生成**）。
   它就是这块面板的目录 —— 点一下跳到那一步，那一步随即成为当前步并展开。 */

/* 只在**索引行之间**画分隔线：当前块上下要留白，画进去就成了"列表里的又一项" */
.step.index-row + .step.index-row { border-top: 1px dashed var(--vscode-panel-border); }

.step.index-row {
  padding: 3px 8px;
  margin-bottom: 2px;
  opacity: 0.55;
}

.step.index-row:hover {
  opacity: 1;
  background: var(--vscode-list-hoverBackground);
}

/* 索引行必须**占死一行**：标题过长就省略，位置标签留在右边不参与挤压 */
.step.index-row .step-head { flex-wrap: nowrap; }

.step.index-row .step-title {
  flex: 1 1 auto;
  /* min-width:0 是 flex 省略号那条经典的必需项：不给它，标题会把容器顶宽而不是省略 */
  min-width: 0;
  font-size: 0.92em;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.step.index-row .loc { flex: 0 0 auto; }

/**
 * **当前步 = 唯一铺开的那一块**，而且要一眼压过上面那些索引行：
 * 粗色条 + 焦点描边 + 选中底色 + 更大的标题 + 上下留白。
 * 只用主题变量（本文件的纪律）：描边走 focusBorder、底色走 list-inactiveSelectionBackground。
 * 注意这段注释在模板字符串**里面** —— 一个反引号都不能写（写了就是把文件切成两半）。
 *
 * 经典样式（body[data-anchor-style="classic"]）下这一段**照样生效** —— 它压的是
 * "当前这一块要显眼"，那在两套排法里都是对的；区别只在"别的块是什么样"。
 */
.step.current {
  opacity: 1;
  margin: 6px 0 8px;
  padding: 12px 12px 14px;
  border-color: var(--vscode-focusBorder);
  border-left-width: 5px;
  background: var(--vscode-list-inactiveSelectionBackground);
}

/**
 * 排法 B（anchorExplain.sidebarStyle = classic）：**经典样式** ——
 * 每一步的正文全部铺开，非当前步压暗到 0.62。这是 D19 起的做法，
 * 现在是"设置里可选的一档"，不再是唯一形态（D129）。
 *
 * 分隔线用 :not(.current) 之外的老写法（.step + .step）会连当前块一起画上，
 * 所以下面那条把当前块的上边框**改回实线 + 焦点色** —— 它是被强调的那一块，
 * 顶上挂一条虚线看着像"列表里的一项"。
 */
body[data-anchor-style="classic"] .step + .step { border-top: 1px dashed var(--vscode-panel-border); }

body[data-anchor-style="classic"] .step.current {
  border-top-color: var(--vscode-focusBorder);
  border-top-style: solid;
}

body[data-anchor-style="classic"] .step:not(.current) { opacity: 0.62; }

body[data-anchor-style="classic"] .step:not(.current):hover {
  opacity: 1;
  background: var(--vscode-list-hoverBackground);
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

.step.current .step-title { font-size: 1.15em; font-weight: 700; }

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

/* ── 追问（D126）：只长在当前那一步下面 ─────────────────────── */

.ask {
  margin-top: 12px;
  padding-top: 10px;
  /* 用虚线把它与"这一步的内容"分开：它是**动作**，不是讲解的一部分 */
  border-top: 1px dashed var(--vscode-panel-border);
}

.ask-row { display: flex; gap: 6px; align-items: stretch; }

.ask-input {
  flex: 1 1 auto;
  min-width: 0;
  font: inherit;
  font-size: 0.9em;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: var(--anchor-radius);
  padding: 3px 8px;
}

.ask-input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }

/* 追问那两颗（输入框 + 按钮）里的按钮：与工具条同长相，但它属于**这一步** */
.ask-row button {
  flex: 0 0 auto;
  font: inherit;
  font-size: 0.86em;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border: none;
  border-radius: var(--anchor-radius);
  padding: 3px 12px;
  cursor: pointer;
}

.ask-row button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }

.ask-row button:disabled {
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
  cursor: default;
}

.ask-hint,
.ask-error {
  margin-top: 5px;
  font-size: 0.82em;
  color: var(--vscode-descriptionForeground);
}

/* 失败要说得出话：用主题的 errorForeground，且不加底色 —— 面板窄，色块会盖住文字 */
.ask-error { color: var(--vscode-errorForeground); }

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
  /* 扫描这一行时客户端会把它滚进视野。页脚已经钉住、不再盖住滚动区（D127），
     所以这里只需要一点点呼吸空间，不必再为"工具条压在下面"留一整行。 */
  scroll-margin-bottom: 12px;
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

/**
 * 页脚里那一行按钮（D129）。**左组靠左、右组靠右**：
 *   - .toolbar：上一步 / 下一步 / 退出 —— 推进这一遍讲解
 *   - .tools：导出讲解 / 历史文件夹 —— 把成果拿走
 *
 * @anchor 用户的原话是"还有下面的按钮你放在一排行不行，靠左和靠右区分"。
 *         两组**仍旧是两个容器**（不是合成一个），靠 margin-left: auto 把右组顶到边上 ——
 *         合并成一个容器就没法靠边，而用 :nth-child 去数第几颗更脆（按钮顺序一改就错位）。
 *
 * flex-wrap: wrap 是留的台阶：面板很窄时右组会折到第二行（因为 auto margin 仍然靠右，
 * 看上去是一行一组的自然折行，而不是挤成一坨）。gap 配合 padding 略微收紧，
 * 是为了让五颗按钮在常见的 340px 宽度下**真的排得下一行**。
 */
.foot-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 0 0;
  flex-wrap: wrap;
}

/* 左组：不靠边，跟在最左边 */
.toolbar {
  display: flex;
  gap: 6px;
}

/* 右组：margin-left: auto 就是"靠右"的全部实现 —— 它吃掉左侧所有剩余空间 */
.tools {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.toolbar button,
.rerun button,
.tools button {
  font: inherit;
  font-size: 0.88em;
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
  border: none;
  border-radius: var(--anchor-radius);
  /* 9px 而不是 12px：页脚那一行要**排得下五颗**（D129）。再宽一点右组就会折行 ——
     面板窄是常态，把横向留白让给文字是划算的。 */
  padding: 3px 9px;
  cursor: pointer;
  white-space: nowrap;
}

.toolbar button:hover:not(:disabled),
.rerun button:hover:not(:disabled),
.tools button:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }

.toolbar button:disabled,
.rerun button:disabled,
.tools button:disabled { opacity: 0.45; cursor: default; }

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

/* 本次 token 用量（D120）。**面板最下面一行**，压得比取件日志还轻：
   它是"顺带看一眼"的信息，不该跟讲解正文抢注意力。 */
.usage {
  margin-top: 10px;
  padding-top: 6px;
  border-top: 1px solid var(--vscode-panel-border);
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  font-size: 0.78em;
  color: var(--vscode-descriptionForeground);
}

.usage-title { font-weight: 600; }

.usage-item { white-space: nowrap; }

.usage-key { margin-right: 3px; opacity: 0.8; }

/* 数字用等宽，边涨边看的时候不会左右跳 */
.usage-val { font-family: var(--vscode-editor-font-family, monospace); }

.usage-unknown { opacity: 0.75; }

.usage-note { opacity: 0.65; font-size: 0.92em; }

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

/**
 * D89：导出讲解 / 历史文件夹（右组的位置规则见上面 .foot-bar 那一段）。
 * 按钮长相复用工具条那一套（见合并后的选择器），这里不再另写一份。
 */
.tools { flex-wrap: wrap; }

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
