/**
 * 开始面板的 HTML（§5.5）。这里守的是两类**不会报错、只会白屏**的问题：
 *
 *   1. 内联字符串里出现反引号或 `${` —— 那会被外层模板字符串当成结束符/插值，
 *      后果不是编译错误，而是面板打开后一片空白（约束 27 原来只是一句注释，现在是一条断言）
 *   2. CSP 松了 —— `default-src 'none'` 一旦被放开，面板就有了它不需要的能力
 *
 * 面板的 **DOM 行为**仍然只能靠 F5：客户端脚本是字符串常量，`node --test` 执行不到它。
 * 这里只钉住"它被生成出来了""它没被别的东西破坏"。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStartHtml } from '../src/start/ui/startHtml.ts';
import { START_CLIENT_SCRIPT } from '../src/start/ui/startClientScript.ts';
import { START_STYLES } from '../src/start/ui/startStyles.ts';
import { SIDEBAR_CLIENT_SCRIPT } from '../src/sidebar/ui/clientScript.ts';
import { SIDEBAR_STYLES } from '../src/sidebar/ui/styles.ts';

const INLINE_STRINGS: [string, string][] = [
  ['开始面板的客户端脚本', START_CLIENT_SCRIPT],
  ['开始面板的样式', START_STYLES],
  ['侧边栏的客户端脚本', SIDEBAR_CLIENT_SCRIPT],
  ['侧边栏的样式', SIDEBAR_STYLES],
];

test('内联字符串里不许出现反引号或 ${（那是"面板一片空白"的成因，不是编译错误）', () => {
  for (const [name, value] of INLINE_STRINGS) {
    assert.ok(!value.includes('`'), `${name} 里出现了反引号`);
    assert.ok(!value.includes('${'), `${name} 里出现了 \${`);
  }
});

test('开始面板的脚本只往 DOM 写文本（不拼 HTML 字符串）', () => {
  // 模型里有用户自己的配置文本（baseUrl、路径）。拼 HTML 就等于让"设置里写了什么"
  // 决定面板的 DOM —— 一条 baseUrl 里的尖括号就够把结构弄坏。
  assert.ok(!START_CLIENT_SCRIPT.includes('innerHTML'), '出现了 innerHTML');
  assert.ok(START_CLIENT_SCRIPT.includes('textContent'), '应当用 textContent 写文本');
});

test('脚本用 data-action 反查动作，握手与模型两条消息都在', () => {
  assert.ok(START_CLIENT_SCRIPT.includes('data-action'), '点击要靠 data-action 认按钮');
  assert.ok(START_CLIENT_SCRIPT.includes('start:ready'), '缺少启动握手');
  assert.ok(START_CLIENT_SCRIPT.includes('start:model'), '缺少模型消息的处理');
  assert.ok(START_CLIENT_SCRIPT.includes('start:run'), '缺少动作消息的发出');
});

test('renderStartHtml：CSP 取最严那一档，且 nonce 每次都不一样', () => {
  const first = renderStartHtml('vscode-resource://fake');
  const second = renderStartHtml('vscode-resource://fake');

  assert.ok(first.includes("default-src 'none'"), 'CSP 的 default-src 必须是最严的');
  assert.ok(first.includes("script-src 'nonce-"), 'script 只放行带 nonce 的内联');
  assert.ok(first.includes("style-src vscode-resource://fake 'nonce-"), 'style 只放行这次给的来源');
  assert.notEqual(first, second, 'nonce 应当是随机的（两次生成不该一模一样）');
});

test('renderStartHtml：脚本与样式内联进来了，且挂在 root 上渲染', () => {
  const html = renderStartHtml('vscode-resource://fake');

  assert.ok(html.startsWith('<!DOCTYPE html>'), '缺 doctype');
  assert.ok(html.includes('<div id="root"></div>'), '缺挂载点');
  assert.ok(html.includes('acquireVsCodeApi'), '脚本没进去');
  assert.ok(html.includes('--vscode-foreground'), '样式没进去（颜色必须跟主题走）');
});

test('renderStartHtml：面板不加载任何外部资源（因此不需要 localResourceRoots）', () => {
  const html = renderStartHtml('vscode-resource://fake');
  assert.ok(!html.includes('<link'), '出现了外部样式表/资源引用');
  assert.ok(!html.includes('<img'), '出现了图片引用');
});
