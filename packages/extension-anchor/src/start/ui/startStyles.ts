/**
 * 开始面板的样式，内联进 webview，沿用最严 CSP 和 VS Code 主题变量。
 * S15：紧凑图标网格；常驻文字交给按钮原生 title / aria-label。
 */
export const START_STYLES = `
* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 8px;
  color: var(--vscode-foreground);
  font-family: var(--vscode-font-family);
  font-size: calc(var(--vscode-font-size, 13px) * var(--anchor-font-scale, 1));
  line-height: 1.5;
}

/* @anchor: 分组并排，窄侧栏自动换行；每组内部仍是多列图标。 */
#root {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 8em), 1fr));
  align-items: start;
  gap: 0.55em;
}

.section {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(2.6em, 1fr));
  gap: 0.3em;
  padding: 0.4em;
  border: 1px solid var(--vscode-panel-border, transparent);
  border-radius: 5px;
  background: var(--vscode-editorWidget-background, transparent);
}
.wide, .handoff { grid-column: 1 / -1; }

.icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  height: 2.8em;
  padding: 0.5em;
  border: 1px solid transparent;
  border-radius: 4px;
  font: inherit;
  color: var(--vscode-foreground);
  background: transparent;
  cursor: pointer;
}
.icon-button:hover {
  background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
  border-color: var(--vscode-toolbar-hoverOutline, transparent);
}
.icon-button:active { background: var(--vscode-toolbar-activeBackground, var(--vscode-list-hoverBackground)); }
.icon-button.off { color: var(--vscode-disabledForeground); cursor: not-allowed; }
.icon-button:focus-visible, .status-icon:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
.action[data-action="capture"], .action[data-action="loadHandoff"] {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
}
.action[data-action="capture"]:hover, .action[data-action="loadHandoff"]:hover {
  background: var(--vscode-button-hoverBackground);
}
.action.off[data-action="capture"], .action.off[data-action="loadHandoff"] { opacity: 0.5; }

svg {
  display: block;
  flex: 0 0 auto;
  width: 1.5em;
  height: 1.5em;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
  pointer-events: none;
}

.handoff { grid-template-columns: minmax(0, 1fr) 2.8em; }
.handoff-tools { display: grid; gap: 0.3em; }
.handoff-input {
  display: block;
  width: 100%;
  min-width: 0;
  min-height: 9em;
  height: 100%;
  resize: vertical;
  padding: 0.45em 0.55em;
  border-radius: 4px;
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, transparent));
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 0.9em;
  line-height: 1.4;
}
.handoff-input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }

.status {
  grid-template-columns: repeat(6, minmax(0, 1fr));
  background: transparent;
  border: none;
  border-top: 1px solid var(--vscode-panel-border, transparent);
  border-radius: 0;
  padding-top: 0.55em;
}
.status-icon {
  min-width: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 2em;
  border-radius: 3px;
  color: var(--vscode-descriptionForeground);
  cursor: help;
}
.status-icon svg { width: 1.15em; height: 1.15em; }
.status-icon.ok { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); }
.status-icon.warn { color: var(--vscode-editorWarning-foreground, var(--vscode-foreground)); }
.status-icon.muted { color: var(--vscode-disabledForeground); }
`;
