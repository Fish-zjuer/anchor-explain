/**
 * 生成开始面板的完整 HTML。样式与客户端脚本**内联**（理由见 `startStyles.ts`）。
 *
 * CSP 与侧边栏取同一档最严的：`default-src 'none'` + 只放行带 nonce 的内联 script/style。
 * 面板不需要网络、图片、字体，也不需要任何 `localResourceRoots`。
 *
 * 这里**不内联键位表** —— 侧边栏要那份表是因为"webview 里的按键不会冒泡到工作台"（D47），
 * 而开始面板不接管任何按键：它显示键位（`StartModel` 里已经格式化好了），不派发按键。
 */

import { randomBytes } from 'node:crypto';
import { START_CLIENT_SCRIPT } from './startClientScript.ts';
import { START_STYLES } from './startStyles.ts';

export function renderStartHtml(cspSource: string): string {
  const nonce = randomBytes(16).toString('base64');

  const csp = [
    "default-src 'none'",
    `style-src ${cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Anchor</title>
<style nonce="${nonce}">${START_STYLES}</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}">${START_CLIENT_SCRIPT}</script>
</body>
</html>`;
}
