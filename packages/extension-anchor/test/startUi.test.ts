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

// ── D68：侧边栏那块「取件日志」 ────────────────────────────────────────────
//
// 这块曾经是一句假话：`tooltrace:append` 在协议里、在客户端渲染里都实现了，
// **只有宿主从来没发过** —— 于是它永远写着"本次讲解没有请求额外上下文"，
// 而那一轮明明读了两个文件。用户就是拿着这句假话来的。
// 客户端脚本是字符串常量，这里只能钉住"该处理的消息在、该显示的东西在"。

test('D68：侧边栏脚本处理取件日志的两条消息（append 与 reset）', () => {
  assert.ok(SIDEBAR_CLIENT_SCRIPT.includes('tooltrace:append'), '缺取件记录的处理');
  assert.ok(SIDEBAR_CLIENT_SCRIPT.includes('tooltrace:reset'), '缺新一轮的清空（不然两轮日志会叠在一起）');
});

test('D68：取件日志要显示"哪个文件的哪几行"，不只是类型', () => {
  assert.ok(SIDEBAR_CLIENT_SCRIPT.includes('describeEntry'), '缺指认那一段的渲染');
  assert.ok(SIDEBAR_CLIENT_SCRIPT.includes('params.path'), '要读请求里的路径');
  assert.ok(
    SIDEBAR_CLIENT_SCRIPT.includes('shortTail'),
    '要取路径末两段（两个同名文件分不清时，只看文件名等于没说）',
  );
  assert.ok(SIDEBAR_CLIENT_SCRIPT.includes('行'), '缺行范围（截图问题 3.4 的验收就是这一句）');
  assert.ok(SIDEBAR_CLIENT_SCRIPT.includes('页'), '缺 PDF 那条（按页取件也要指认得清）');
});

test('D69：不在锚点文件里的位置必须带上文件名（否则行号看起来像锚点文件的）', () => {
  assert.ok(SIDEBAR_CLIENT_SCRIPT.includes('anchorPath'), '要从 session:update 拿锚点文件');
  assert.ok(SIDEBAR_CLIENT_SCRIPT.includes('locTextWithFile'), '缺"带文件名的位置标签"');
  assert.ok(SIDEBAR_CLIENT_SCRIPT.includes('normLoc'), '比较文件要忽略大小写与斜杠方向（与 samePath 同立场）');
  // 两处标签都要走它：步骤头那一行，以及子高亮那一行
  const uses = SIDEBAR_CLIENT_SCRIPT.split('locTextWithFile(').length - 1;
  assert.ok(uses >= 3, `locTextWithFile 只被用了 ${uses - 1} 处（步骤头 + 子高亮都要用）`);
});
