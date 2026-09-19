/**
 * 生成侧边栏 webview 的完整 HTML。样式与客户端脚本**内联**（见 styles.ts 里的理由）。
 *
 * `cspSource` 与 `chords` 由调用方传入，本函数因此不 import 'vscode'，可脱离宿主直测。
 *
 * `chords` 是**用户实际绑定**解析后的键位表，内联成 `ANCHOR_CHORDS` 常量供客户端派发
 * （见 D42/D47：webview 里的按键不会冒泡到工作台，面板有焦点时工作台键位全哑）。
 * 键位来自用户的 `keybindings.json`，属**不可信文本**，所以 JSON 里的 `<` 一律转义成
 * `\u003c` —— 否则一个形如 `</script>` 的键名就能跳出 script 标签。
 *
 * CSP 取最严的一档：`default-src 'none'` + 只放行带 nonce 的内联 script/style。
 * 侧边栏不需要网络、不需要图片、不需要字体 —— 少开一个口子就少一类问题。
 */

import { randomBytes } from 'node:crypto';
import type { ResolvedChords } from '../keybindingResolve.ts';
import { SIDEBAR_CLIENT_SCRIPT } from './clientScript.ts';
import { SIDEBAR_STYLES } from './styles.ts';

function inlineChords(chords: ResolvedChords): string {
  const json = JSON.stringify(chords).replace(/</g, '\\u003c');
  return `var ANCHOR_CHORDS = ${json};`;
}

export function renderSidebarHtml(
  cspSource: string,
  chords: ResolvedChords,
  fontScale: number,
  language: 'zh' | 'en' = 'zh',
): string {
  const nonce = randomBytes(16).toString('base64');

  const csp = [
    "default-src 'none'",
    `style-src ${cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="${language === 'en' ? 'en' : 'zh-CN'}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${language === 'en' ? 'Anchor Explanation' : 'Anchor 讲解'}</title>
<style nonce="${nonce}">${SIDEBAR_STYLES}</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}">${inlineChords(chords)}
var ANCHOR_FONT_SCALE = ${JSON.stringify(fontScale)};
var ANCHOR_LANGUAGE = ${JSON.stringify(language)};
${SIDEBAR_CLIENT_SCRIPT}</script>
</body>
</html>`;
}
