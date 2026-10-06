/**
 * 开始面板的样式，内联进 webview，沿用最严 CSP 和 VS Code 主题变量。
 * S15-fix1：按窗口高度展开的图标＋短名称布局；详细说明由原生 title / aria-label 提供。
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

/* @anchor: 分配整个视口高度；长窗口展开，短窗口内容保持可读并允许滚动。 */
#root {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 16px);
  gap: 0.55em;
}

.section {
  min-width: 0;
  display: grid;
  flex: 1 0 auto;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.4em;
  padding: 0.4em;
  border: 1px solid var(--vscode-panel-border, transparent);
  border-radius: 5px;
  background: transparent;
}
.start .action[data-action="capture"] { grid-column: 1 / -1; flex-direction: row; }
.paired-sections {
  flex: 0.85 0 auto;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 8em), 1fr));
  gap: 0.55em;
}
.paired-sections .section { grid-template-columns: minmax(0, 1fr); }

.icon-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4em;
  min-width: 0;
  min-height: 4.2em;
  padding: 0.5em;
  border: 1px solid var(--vscode-panel-border, transparent);
  border-radius: 4px;
  font: inherit;
  color: var(--vscode-foreground);
  background: var(--vscode-editorWidget-background, transparent);
  cursor: pointer;
}
.button-label { font-size: 0.9em; line-height: 1.3; text-align: center; overflow-wrap: anywhere; }
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
  width: 1.6em;
  height: 1.6em;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
  pointer-events: none;
}

.handoff { flex: 1.5 0 auto; grid-template-columns: minmax(0, 1fr) 4.2em; }
.handoff-tools { display: grid; grid-template-rows: repeat(3, minmax(0, 1fr)); gap: 0.4em; }
.handoff-input {
  display: block;
  width: 100%;
  min-width: 0;
  min-height: 14.9em;
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
  flex: 0 0 auto;
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
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 0.25em;
  min-height: 3.5em;
  border-radius: 3px;
  color: var(--vscode-descriptionForeground);
  cursor: help;
}
.status-icon svg { width: 1.15em; height: 1.15em; }
.status-icon.ok { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); }
.status-icon.warn { color: var(--vscode-editorWarning-foreground, var(--vscode-foreground)); }
.status-icon.muted { color: var(--vscode-disabledForeground); }
.status-label { font-size: 0.8em; line-height: 1.3; text-align: center; overflow-wrap: anywhere; }

/* 高度不足时恢复横排按钮，靠自然滚动保证小窗口的文字不被压扁。 */
@media (max-height: 1100px) {
  .icon-button { min-height: 3.4em; padding: 0.3em; gap: 0.2em; }
  .icon-button svg { width: 1.3em; height: 1.3em; }
  .session { grid-template-columns: repeat(auto-fit, minmax(4.2em, 1fr)); }
  .paired-sections .section { grid-template-columns: repeat(auto-fit, minmax(3.5em, 1fr)); }
}
@media (max-width: 300px) {
  .status { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

/* 保留 S15 的纯图标排法，作为可切换的紧凑模式。 */
#root.layout-compact {
  display: grid;
  height: auto;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 8em), 1fr));
  align-items: start;
}
.layout-compact .section { grid-template-columns: repeat(auto-fill, minmax(2.6em, 1fr)); gap: 0.3em; }
.layout-compact .start, .layout-compact .session, .layout-compact .handoff, .layout-compact .status { grid-column: 1 / -1; }
.layout-compact .start .action[data-action="capture"] { grid-column: auto; flex-direction: column; }
.layout-compact .icon-button { min-height: 0; height: 2.8em; padding: 0.5em; border-color: transparent; background: transparent; }
.layout-compact .icon-button svg { width: 1.5em; height: 1.5em; }
.layout-compact .icon-button:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
.layout-compact .button-label, .layout-compact .status-label { display: none; }
.layout-compact .action[data-action="capture"], .layout-compact .action[data-action="loadHandoff"] {
  color: var(--vscode-button-foreground); background: var(--vscode-button-background);
}
.layout-compact .handoff { grid-template-columns: minmax(0, 1fr) 2.8em; }
.layout-compact .handoff-tools { gap: 0.3em; }
.layout-compact .handoff-input { min-height: 9em; }
.layout-compact .status { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.layout-compact .status-icon { min-height: 0; height: 2em; }

/* 保留最初的单列文字卡片；只作用于 classic，避免三种样式互相覆盖。 */
body[data-start-layout="classic"] { padding: 12px 12px 24px; }
#root.layout-classic { display: block; height: auto; }
.layout-classic .head { margin-bottom: 16px; }
.layout-classic .brand { font-size: 1.15em; font-weight: 600; letter-spacing: 0.02em; }
.layout-classic .sub { color: var(--vscode-descriptionForeground); font-size: 0.92em; margin-top: 2px; }
.classic-section { margin-bottom: 18px; }
.classic-section > h2 {
  margin: 0 0 8px; font-size: 0.85em; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--vscode-descriptionForeground);
}
.classic-action, .classic-handoff {
  border: 1px solid var(--vscode-panel-border, transparent); border-radius: 6px;
  padding: 8px 10px; margin-bottom: 8px; background: var(--vscode-editorWidget-background, transparent);
}
.classic-action.off { opacity: 0.6; }
.layout-classic .row-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.layout-classic .title { font-weight: 600; }
.layout-classic .chord {
  font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85em; padding: 1px 5px;
  border-radius: 4px; border: 1px solid var(--vscode-panel-border, transparent);
  color: var(--vscode-descriptionForeground); white-space: nowrap;
}
.layout-classic .note { color: var(--vscode-descriptionForeground); font-size: 0.92em; margin: 4px 0 8px; }
.classic-run {
  font-family: inherit; font-size: 0.92em; padding: 3px 10px; border: none; border-radius: 4px;
  cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background);
}
.classic-run:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
.classic-run:disabled { cursor: default; opacity: 0.5; }
.classic-run:focus-visible, .classic-copy:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
.layout-classic .status-line { display: flex; gap: 8px; font-size: 0.92em; padding: 2px 0; }
.layout-classic .status-line .label { flex: 0 0 62px; color: var(--vscode-descriptionForeground); }
.layout-classic .status-line .value { flex: 1 1 auto; word-break: break-word; }
.layout-classic .status-line.warn .value { color: var(--vscode-editorWarning-foreground, var(--vscode-foreground)); }
.layout-classic .status-line.muted .value { color: var(--vscode-descriptionForeground); }
.layout-classic .handoff-label { font-size: 0.92em; color: var(--vscode-descriptionForeground); margin-bottom: 6px; }
.layout-classic .handoff-input { height: auto; min-height: 4.5em; padding: 6px 8px; }
.layout-classic .handoff-hint { font-size: 0.85em; color: var(--vscode-descriptionForeground); margin: 8px 0 4px; }
.layout-classic .handoff-prompt {
  display: block; white-space: pre-wrap; word-break: break-word; padding: 6px 8px; border-radius: 4px;
  background: var(--vscode-textCodeBlock-background, transparent); font-family: var(--vscode-editor-font-family, monospace);
  font-size: 0.85em; line-height: 1.4; user-select: text;
}
.classic-copy {
  margin-top: 4px; padding: 2px 8px; font-size: 0.85em;
  color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  background: var(--vscode-button-secondaryBackground, transparent);
  border: 1px solid var(--vscode-button-border, transparent); border-radius: 3px; cursor: pointer;
}
.classic-copy:hover { background: var(--vscode-button-secondaryHoverBackground, transparent); }
.layout-classic .handoff-row { margin-top: 8px; }
`;
