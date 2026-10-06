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
import { runInNewContext } from 'node:vm';
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

// ── D130：外部 Agent 改的地方 · 输入框 ──────────────────────────────────────
//
// 这一块的 DOM 行为仍然只能靠 F5（脚本是字符串常量）。这里钉住三件**不做就会静默失效**的事：
//   1. 输入框在（不然用户没有地方粘）
//   2. 三种投递方式都在（粘贴 / 拖拽 / 命令面板选文件 —— 最后那个不在这个文件里）
//   3. 草稿回填（用户的原话：「防止讲解切换文件丢掉路径」）

test('D130：开始面板里有一个能粘位置的输入框，且它绑在 loadHandoff 那颗按钮上', () => {
  assert.ok(START_CLIENT_SCRIPT.includes('data-handoff="draft"'), '缺输入框');
  assert.ok(START_CLIENT_SCRIPT.includes('loadHandoff'), '输入框旁边那颗按钮没接上动作');

  // 输入框**不只用 textarea 一个标签就完事**：`rows` 决定它一开始占几行 ——
  // 高度 1 行的框在面板里看起来像一个单行输入框，用户不会想到可以粘一大段。
  assert.ok(START_CLIENT_SCRIPT.includes('textarea'), '输入框要用 textarea（单行 input 粘不下一份清单）');
});

test('D130：三种投递方式都在（粘贴 / 拖拽 / 命令面板选文件）', () => {
  // 用户的原话：「**复制文件，粘贴到文本框应该被支持，也允许拖拽进**。
  //              这个是位置清单文件，因为不知道对方是喜欢输出文本还是 write 一个文件」。
  assert.ok(START_CLIENT_SCRIPT.includes('dragover'), '缺拖拽的 dragover（不 preventDefault 则 drop 不触发）');
  assert.ok(START_CLIENT_SCRIPT.includes('drop'), '缺拖拽落下的处理');
  assert.ok(START_CLIENT_SCRIPT.includes('preventDefault'), '缺 preventDefault（不拦的话 webview 会去打开那个文件）');

  // 拖进来的文件可能是几百 MB 的东西（用户手滑），必须有大小护栏
  assert.ok(/text\(\)/.test(START_CLIENT_SCRIPT), '要真的读文件内容（File.text()）');
});

test('D130：草稿会回填，且发送的是**两条不同的消息**（打字 ≠ 按键）', () => {
  // 回填：`value` 从 `model.handoffDraft` 取 —— 这是"切走再回来草稿还在"的实现。
  assert.ok(START_CLIENT_SCRIPT.includes('handoffDraft'), '缺草稿的回填');

  // 两条消息必须分开：一条是打字（存草稿）、一条是按键（真做事）。
  // 合成一条的后果在 `protocol.ts` 那段注释里写着 —— 打字也能触发读文件。
  assert.ok(START_CLIENT_SCRIPT.includes('start:handoffDraft'), '缺草稿那条消息');
  assert.ok(START_CLIENT_SCRIPT.includes('start:handoff'), '缺投币那条消息');
});

test('D137：真正执行 drop 事件后，草稿会同步宿主，重画不会丢', async () => {
  const handlers = new Map<string, (event: unknown) => void>();
  const posted: Record<string, unknown>[] = [];
  runInNewContext(START_CLIENT_SCRIPT, {
    acquireVsCodeApi: () => ({ postMessage: (m: Record<string, unknown>) => posted.push(m) }),
    document: {getElementById: () => ({}), addEventListener: (name: string, cb: (e: unknown) => void) => handlers.set(name, cb)},
    window: {addEventListener() {}},
  });
  let prevented = false;
  const node = {value:'',placeholder:'',getAttribute:()=> 'draft'};
  handlers.get('drop')!({target:node,preventDefault:()=>{prevented=true;},dataTransfer:{files:[{size:20,name:'positions.txt',text:async()=>'{"filePath":"a.c"}'}]}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, true);
  assert.equal(node.value, '{"filePath":"a.c"}');
  assert.ok(posted.some(m => m.type === 'start:handoffDraft' && m.text === node.value));
});

test('S15：提示词通过复制按钮的悬停提示查看，仍可经宿主复制', () => {
  assert.ok(START_CLIENT_SCRIPT.includes('handoffPrompt'), '悬停提示应使用宿主提供的提示词');
  assert.ok(START_CLIENT_SCRIPT.includes("setAttribute('title', description)"), '图标按钮缺悬停提示');
  assert.ok(START_CLIENT_SCRIPT.includes("setAttribute('aria-label', description)"), '图标按钮缺可访问名称');
  assert.ok(START_CLIENT_SCRIPT.includes('start:copyPrompt'), '提示词应仍能复制给外部 Agent');
});

test('D132：提示词旁边有一颗「复制」按钮，走宿主写剪贴板（不是 navigator.clipboard）', () => {
  // 用户原话：「**最好给一个按钮直接将 prompt 复制到粘贴板**」。
  assert.ok(START_CLIENT_SCRIPT.includes('data-copy-prompt'), '缺那颗复制按钮');
  assert.ok(START_CLIENT_SCRIPT.includes('start:copyPrompt'), '按钮没接上消息');

  // 关键：**不能在 webview 里用 navigator.clipboard** —— 它要 secure context，
  // 权限不保证给，且失败时**静默无效**（用户以为按钮坏了）。走宿主才是稳的。
  assert.ok(
    !START_CLIENT_SCRIPT.includes('navigator.clipboard'),
    '别在面板里直接写剪贴板：失败时静默无效，用户只会看到"点了没反应"',
  );

  // 判定顺序：那颗按钮**不带 data-action**（它不是动作 id，是一条具体请求），
  // 所以必须在 data-action 那条分支**之前**判 —— 顺序反了就会掉进下面、
  // 被当成查不到的动作 id 静默丢掉。
  const copyAt = START_CLIENT_SCRIPT.indexOf('data-copy-prompt');
  const actionAt = START_CLIENT_SCRIPT.indexOf("getAttribute('data-action')");
  assert.ok(copyAt !== -1 && actionAt !== -1, '两处判定都得在（测这个顺序的前提）');
  assert.ok(copyAt < actionAt, '复制那支必须判在 data-action 之前，否则按钮点了没反应');
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
