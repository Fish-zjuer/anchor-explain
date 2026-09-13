/**
 * 侧边栏样式。**只用 VS Code 主题变量**（`--vscode-*`），不写死颜色 ——
 * 与 §4.3「全部走主题色变量」是同一条约束的两侧：编辑器里是 decoration 主题色，这里是 CSS 变量。
 *
 * 为什么 CSS 放在 TS 里而不是 `.css` 文件：侧边栏的 HTML 由宿主一次性生成并内联（见 html.ts），
 * 不引入 `asWebviewUri` / 静态资源拷贝，`esbuild` 打包时它自然跟着产物走，没有第二个拷贝步骤。
 */

export const SIDEBAR_STYLES = `
:root {
  --anchor-gap: 10px;
  --anchor-radius: 4px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 0;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
  line-height: 1.55;
}

#root { padding: var(--anchor-gap); }

.header { margin-bottom: var(--anchor-gap); }

.header .doc-title {
  font-size: 1.05em;
  font-weight: 600;
  margin: 0 0 4px;
}

.summary {
  margin: 0 0 6px;
  color: var(--vscode-descriptionForeground);
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 0.85em;
  color: var(--vscode-descriptionForeground);
}

.meta .badge {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 999px;
  padding: 0 8px;
}

.steps { list-style: none; margin: 0; padding: 0; }

.step {
  border: 1px solid transparent;
  border-left: 3px solid transparent;
  border-radius: var(--anchor-radius);
  padding: 8px;
  margin-bottom: 6px;
  cursor: pointer;
}

.step:hover { background: var(--vscode-list-hoverBackground); }

.step.current {
  border-color: var(--vscode-focusBorder);
  border-left-color: var(--vscode-focusBorder);
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}

.step.dim { opacity: 0.62; }

.step .step-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.step .step-title { font-weight: 600; }

.loc {
  font: inherit;
  font-size: 0.85em;
  color: var(--vscode-textLink-foreground);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-decoration: underline;
}

.loc:hover { color: var(--vscode-textLink-activeForeground); }

.intro {
  margin: 4px 0;
  color: var(--vscode-descriptionForeground);
  font-style: italic;
}

.text { margin: 4px 0 0; white-space: pre-wrap; }

.highlights { list-style: none; margin: 8px 0 0; padding: 0; }

.highlights li {
  display: flex;
  gap: 6px;
  padding: 3px 0;
  border-top: 1px dashed var(--vscode-panel-border);
}

/* 正在被"扫描"的那个逻辑点：和编辑器里那行亮色对应上（D48） */
.highlights li.scanning {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
  border-radius: 3px;
}

.scan-mark {
  flex: 0 0 auto;
  color: var(--vscode-editorInfo-foreground);
  font-weight: 700;
}

.tag {
  flex: 0 0 auto;
  align-self: flex-start;
  font-size: 0.8em;
  border-radius: 3px;
  padding: 0 6px;
  border: 1px solid var(--vscode-panel-border);
}

.tag-primary { border-color: var(--vscode-editor-findMatchBorder); }
.tag-context { color: var(--vscode-descriptionForeground); }
.tag-definition { border-color: var(--vscode-editorInfo-foreground); }
.tag-caveat { border-color: var(--vscode-editorWarning-foreground); }

.toolbar {
  position: sticky;
  bottom: 0;
  display: flex;
  gap: 6px;
  padding: 8px 0;
  margin-top: var(--anchor-gap);
  background: var(--vscode-sideBar-background);
  border-top: 1px solid var(--vscode-panel-border);
}

.toolbar button {
  font: inherit;
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
  border: none;
  border-radius: var(--anchor-radius);
  padding: 3px 10px;
  cursor: pointer;
}

.toolbar button:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
.toolbar button:disabled { opacity: 0.45; cursor: default; }

.trace { margin-top: var(--anchor-gap); font-size: 0.85em; }

.trace h2 {
  font-size: 0.9em;
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

.empty { color: var(--vscode-descriptionForeground); }
`;
