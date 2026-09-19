/**
 * 开始面板的样式。**内联**进 webview（与侧边栏同一个理由，见 `sidebar/ui/styles.ts`）：
 * CSP 取最严的一档（`default-src 'none'`），不加载任何本地/远程样式表，
 * 于是面板不需要 `localResourceRoots`，也不存在"样式文件没打进 .vsix"这类失败面。
 *
 * 颜色一律走 VS Code 的主题变量：面板长在活动栏里，它必须跟着用户的主题走，
 * 写死颜色在浅色主题下就是一块补丁。**这里没有一处固定色值。**
 */

export const START_STYLES = `
* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 12px 12px 24px;
  color: var(--vscode-foreground);
  font-family: var(--vscode-font-family);
  /* D89：与讲解面板同一条公式 —— 基准字号乘用户自己的缩放系数。
     下面原来的固定 px（15/12/11）全部换成 em：这个面板过去在 VS Code 缩放下
     标题和正文各走各的，现在整块等比例伸缩，结构不再散架。 */
  font-size: calc(var(--vscode-font-size, 13px) * var(--anchor-font-scale, 1));
  line-height: 1.5;
}

.head { margin-bottom: 16px; }
.head .brand { font-size: 1.15em; font-weight: 600; letter-spacing: 0.02em; }
.head .sub { color: var(--vscode-descriptionForeground); font-size: 0.92em; margin-top: 2px; }

.section { margin-bottom: 18px; }
.section > h2 {
  margin: 0 0 8px;
  font-size: 0.85em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--vscode-descriptionForeground);
}

.action {
  border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 8px;
  background: var(--vscode-editorWidget-background, transparent);
}

.action.off { opacity: 0.6; }

.row-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.row-head .title { font-weight: 600; }

.chord {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 0.85em;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
}

.note { color: var(--vscode-descriptionForeground); font-size: 0.92em; margin: 4px 0 8px; }

button.run {
  font-family: inherit;
  font-size: 0.92em;
  padding: 3px 10px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
}
button.run:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
button.run:disabled { cursor: default; opacity: 0.5; }

.status-line { display: flex; gap: 8px; font-size: 0.92em; padding: 2px 0; }
.status-line .label { flex: 0 0 62px; color: var(--vscode-descriptionForeground); }
.status-line .value { flex: 1 1 auto; word-break: break-word; }
.status-line.ok .value { color: var(--vscode-foreground); }
.status-line.warn .value { color: var(--vscode-editorWarning-foreground, var(--vscode-foreground)); }
.status-line.muted .value { color: var(--vscode-descriptionForeground); }
`;
