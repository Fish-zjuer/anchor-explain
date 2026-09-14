/**
 * 侧边栏客户端脚本的两条锁（D69）。**这个文件守的是一个反复出事的边界。**
 *
 * @anchor 为什么值得单独一个测试文件：`clientScript.ts` 是**一个巨大的模板字符串**，
 *         `node --test` 既不编译它、类型检查也管不到字符串里的代码 —— 而它一旦出错，
 *         用户看到的是**一整块空白面板**（没有任何报错落在屏幕上）。已经出事两次：
 *           1. `tooltrace:append` 客户端渲染好了，**宿主从来没发过**（D68）—— 面板永远说"没有请求上下文"
 *           2. 新写的一句 `replace(/\/+$/, "")` 被模板字符串吃掉一个反斜杠，运行时成了
 *              `replace(//+$/, "")` —— **语法错误，整块白**（D69 实测）
 *         `startUi.test.ts` 里那条"不许出现反引号"只挡住了最容易的一种写法；这里补两条：
 *         **真的把它解析一遍**（`new Function`，不需要 DOM）+ **用最小 DOM 跑一遍渲染**，
 *         这样"标签带不带文件名"这种逻辑也有断言，而不是靠 F5 手测。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIDEBAR_CLIENT_SCRIPT } from '../src/sidebar/ui/clientScript.ts';
import { START_CLIENT_SCRIPT } from '../src/start/ui/startClientScript.ts';

// ── 一、语法：解析不过就整块白，所以这是最硬的一条 ─────────────────────────

test('内联客户端脚本必须能解析（解析不过 = 面板一片空白，且屏幕上没有任何报错）', () => {
  for (const [name, code] of [
    ['侧边栏', SIDEBAR_CLIENT_SCRIPT],
    ['开始面板', START_CLIENT_SCRIPT],
  ] as const) {
    // 只解析、不执行：webview 那一层能过语法，才谈得上渲染
    assert.doesNotThrow(() => new Function(code), `${name}的客户端脚本有语法错误`);
  }
});

// ── 二、让脚本真的跑一遍（最小 DOM）────────────────────────────────────────

interface FakeNode {
  tag: string;
  className: string;
  disabled?: boolean;
  textContent: string;
  title: string;
  id: string;
  children: FakeNode[];
  attrs: Record<string, string>;
  firstChild: FakeNode | null;
  appendChild(child: FakeNode): void;
  setAttribute(key: string, value: string): void;
  removeChild(child: FakeNode): void;
  insertBefore(child: FakeNode): void;
  addEventListener(): void;
  get text(): string;
}

function fakeNode(tag: string): FakeNode {
  const node: FakeNode = {
    tag,
    className: '',
    textContent: '',
    title: '',
    id: '',
    children: [],
    attrs: {},
    firstChild: null,
    appendChild(child) {
      node.children.push(child);
      node.firstChild = node.children[0] ?? null;
    },
    setAttribute(key, value) {
      node.attrs[key] = value;
    },
    removeChild(child) {
      node.children = node.children.filter((c) => c !== child);
      node.firstChild = node.children[0] ?? null;
    },
    insertBefore(child) {
      node.children.unshift(child);
      node.firstChild = node.children[0] ?? null;
    },
    addEventListener() {},
    get text() {
      return [node.textContent, ...node.children.map((c) => c.text)].join('');
    },
  };
  return node;
}

/** 把脚本放进一个最小环境里跑起来，返回"发出去的消息"与根节点（好读渲染出来的文字） */
function runSidebarClient(script: string): {
  root: FakeNode;
  posted: { type?: string }[];
  send: (message: unknown) => void;
  key: (type: string, ev: Record<string, unknown>) => void;
} {
  const root = fakeNode('div');
  const handlers: ((ev: { data: unknown }) => void)[] = [];
  const posted: { type?: string }[] = [];

  const windowHandlers: Record<string, ((ev: unknown) => void)[]> = {};

  const documentStub = {
    getElementById: (id: string) => (id === 'root' ? root : null),
    createElement: (tag: string) => fakeNode(tag),
    addEventListener: () => {},
    body: fakeNode('body'),
  };
  const windowStub = {
    addEventListener: (type: string, handler: (ev: { data: unknown }) => void) => {
      if (type === 'message') handlers.push(handler);
      (windowHandlers[type] ??= []).push(handler as (ev: unknown) => void);
    },
    // 客户端会用它在面板里派发用户键位（D47）；这里只要存在
    removeEventListener: () => {},
  };

  // eslint-disable-next-line no-new-func -- 这就是被测对象：一段要在 webview 里跑的字符串
  const factory = new Function(
    'document',
    'window',
    'acquireVsCodeApi',
    'setTimeout',
    'ANCHOR_CHORDS',
    script,
  );
  factory(
    documentStub,
    windowStub,
    () => ({ postMessage: (m: { type?: string }) => posted.push(m) }),
    () => 0,
    // 面板里被转发的那几个键（宿主内联进来的**用户实际绑定**，D47）
    { next: 'alt+]', prev: 'alt+[', stop: 'escape' },
  );

  return {
    root,
    posted,
    send: (message) => {
      for (const handler of handlers) handler({ data: message });
    },
    key: (type: string, ev: Record<string, unknown>) => {
      for (const handler of windowHandlers[type] ?? []) handler(ev);
    },
  };
}

/** 在假 DOM 里按文字找一个元素（按钮的状态断言要靠它） */
function findByText(node: FakeNode, text: string): FakeNode | undefined {
  if (node.textContent === text) return node;
  for (const child of node.children) {
    const hit = findByText(child, text);
    if (hit) return hit;
  }
  return undefined;
}

const ANCHOR = 'C:\\repo\\Core\\Src\\main.c';

function sessionUpdate(over: Record<string, unknown> = {}): unknown {
  return {
    type: 'session:update',
    result: {
      title: '主控串口命令 → 12 路 DShot',
      summary: '总述',
      confidence: 0.8,
      steps: [
        {
          location: { filePath: ANCHOR, lineStart: 322, lineEnd: 347 },
          title: '放行油门',
          text: '正文',
          highlights: [
            // 这一条落在**另一个文件**里 —— 用户实测就是被它绕住的（行号看着像 main.c 的）
            { location: { filePath: 'C:\\repo\\Core\\Inc\\esc.h', lineStart: 41, lineEnd: 44 }, narration: '放行开关', emphasis: 'definition' },
          ],
        },
      ],
    },
    index: 0,
    state: 'playing',
    pointIndex: -1,
    anchorPath: ANCHOR,
    ...over,
  };
}

test('面板启动先握手：渲染发生在收到消息之后（靠 ui:ready 的重放保证不丢）', () => {
  const client = runSidebarClient(SIDEBAR_CLIENT_SCRIPT);
  assert.equal(client.posted[0]?.type, 'ui:ready', '必须先发 ui:ready，否则宿主重放的消息会丢在订阅之前');
  assert.equal(client.root.text, '', '还没收到任何消息时不画东西（宿主会把最近的若干条重放过来）');

  client.send(sessionUpdate());
  assert.match(client.root.text, /放行油门/, '收到 session:update 之后才有内容');
});

test('不在锚点文件里的位置，标签带上文件名（D69：否则行号看起来是锚点文件的）', () => {
  const client = runSidebarClient(SIDEBAR_CLIENT_SCRIPT);
  client.send(sessionUpdate());

  const text = client.root.text;
  assert.match(text, /esc\.h 第 41-44 行/, '另一个文件里的子高亮必须标出文件名');
  assert.match(text, /第 322-347 行/, '锚点文件里的步骤不该被加前缀');
  assert.doesNotMatch(text, /main\.c 第 322-347 行/, '锚点文件自己不需要报文件名');
});

test('同一个文件的两种写法（反斜杠 / 正斜杠）算同一个文件，不标文件名', () => {
  const client = runSidebarClient(SIDEBAR_CLIENT_SCRIPT);
  client.send(
    sessionUpdate({
      result: {
        title: 't',
        summary: 's',
        confidence: 0.5,
        steps: [
          {
            location: { filePath: 'C:/repo/Core/Src/main.c', lineStart: 10, lineEnd: 12 },
            title: 'x',
            text: 'y',
          },
        ],
      },
      anchorPath: ANCHOR,
    }),
  );

  assert.doesNotMatch(
    client.root.text,
    /main\.c 第 10-12 行/,
    '大小写与斜杠方向不该改变"是不是同一个文件"的判断（与 core 的 samePath 同立场）',
  );
});

test('取件日志显示"末两段路径 + 行范围"，且新一轮会清空（D68）', () => {
  const client = runSidebarClient(SIDEBAR_CLIENT_SCRIPT);
  // 日志跟着会话一起出现（那一块只在有讲解时才画）
  client.send(sessionUpdate());
  client.send({ type: 'tooltrace:append', entry: {
    at: 0, round: 1, accepted: true, resultChars: 1296,
    request: { type: 'file', params: { path: 'C:/repo/Core/Inc/esc.h', start: 1, end: 60 }, reason: 'x' },
  } });

  assert.match(client.root.text, /第 1 轮 Inc\/esc\.h 1-60 行 接受 · 1296 字/);

  client.send({ type: 'tooltrace:reset' });
  assert.match(client.root.text, /没有请求额外上下文/, '新一轮开始时日志必须清空');
});

// ── 三、用户的真实数据形状（D70）：反斜杠绝对路径 + 多个外部文件 + 多条取件记录 ──
//
// 这一段是照着实测现场抄的：讲的是 `_build_tmp` 里那份 main.c，子高亮落在同目录树的
// protocol.h / esc.h 里，而这些路径是模型**用反斜杠写**的（`c:\Users\...`，小写盘符）。
// 面板当时"卡死"，先在夹具里把它跑一遍 —— 客户端脚本抛异常时，表现是**整块不再更新**
// （连报错都不会出现在屏幕上），所以必须在这里拦住。

const REAL_MAIN = 'c:\\Users\\29927\\Desktop\\DeepSeek_Harness_Code_V1.0\\_build_tmp\\fw\\App\\Src\\main.c';
const REAL_PROTOCOL = 'c:\\Users\\29927\\Desktop\\DeepSeek_Harness_Code_V1.0\\_build_tmp\\fw\\App\\Inc\\protocol.h';
const REAL_ESC = 'c:\\Users\\29927\\Desktop\\DeepSeek_Harness_Code_V1.0\\_build_tmp\\fw\\App\\Inc\\esc.h';

function realWorldSession(): unknown {
  return {
    type: 'session:update',
    result: {
      title: 'main.c：把主控串口命令变成 12 路双向 DShot 的中枢',
      summary: '总述',
      confidence: 0.78,
      steps: [
        {
          location: { filePath: REAL_MAIN, lineStart: 227, lineEnd: 263 },
          title: '上电顺序：时钟—外设—接上命令回调—起 0 帧',
          text: '正文',
          highlights: [
            { location: { filePath: REAL_PROTOCOL, lineStart: 16, lineEnd: 16 }, narration: 'protocol_feed 就是被挂上的回调', emphasis: 'definition' },
            { location: { filePath: REAL_ESC, lineStart: 11, lineEnd: 14 }, narration: 'esc_init 语义', emphasis: 'definition' },
          ],
        },
        {
          location: { filePath: REAL_MAIN, lineStart: 265, lineEnd: 271 },
          title: '按模式分叉',
          text: '正文',
        },
      ],
    },
    index: 0,
    state: 'playing',
    pointIndex: 0,
    anchorPath: REAL_MAIN,
  };
}

test('实测数据形状：反斜杠路径 + 两个外部文件 + 两条取件记录，渲染不抛异常', () => {
  const client = runSidebarClient(SIDEBAR_CLIENT_SCRIPT);
  client.send(realWorldSession());
  client.send({ type: 'tooltrace:append', entry: {
    at: 0, round: 1, accepted: false, rejectReason: '一次最多取 60 行，这次要了 80 行',
    request: { type: 'file', params: { path: REAL_ESC, start: 1, end: 80 }, reason: 'x' },
  } });
  client.send({ type: 'tooltrace:append', entry: {
    at: 0, round: 2, accepted: true, resultChars: 1296,
    request: { type: 'file', params: { path: 'c:/Users/29927/Desktop/DeepSeek_Harness_Code_V1.0/_build_tmp/fw/App/Inc/esc.h', start: 1, end: 60 }, reason: 'x' },
  } });

  const text = client.root.text;
  // 反斜杠路径也要能切成**末两段**（之前只按正斜杠切，于是整条绝对路径都印在标签上）
  assert.match(text, /protocol\.h 第 16 行/, '反斜杠写的路径也要切得开（标签只印文件名）');
  assert.match(text, /esc\.h 第 11-14 行/);
  assert.match(text, /第 227-263 行/, '锚点文件里的步骤不带文件名前缀');
  assert.doesNotMatch(text, /_build_tmp\fw\App\Inc\protocol\.h 第/, '不许把整条绝对路径印进标签');
  assert.match(text, /Inc\/esc\.h 1-60 行 接受 · 1296 字/, '取件日志同样按末两段显示');
});

test('D70：内联脚本里零反斜杠 —— 这条不变量比"出一次错修一次"划算', () => {
  // 这个文件是一整个模板字符串：反斜杠每次都要写两遍才对，写错一次就是
  // 语法错误（整块白，屏幕上没报错）或静默切不开路径（整条绝对路径印进标签）。
  // 已经栽过两次，所以干脆不许出现 —— 需要反斜杠时用 String.fromCharCode(92) 或字符类。
  assert.ok(
    !SIDEBAR_CLIENT_SCRIPT.includes(String.fromCharCode(92)),
    '内联脚本里出现了反斜杠：请用 String.fromCharCode(92) 或字符类（见 pathParts 的注释）',
  );
});

test('D70：面板脚本抛异常时，错因要出现在面板里（而不是"卡死"）', () => {
  const client = runSidebarClient(SIDEBAR_CLIENT_SCRIPT);
  client.send(sessionUpdate());
  // 宿主发来的形状不对（比如 result 为空）—— 渲染时必然抛
  client.send({ type: 'session:update', result: null, index: 0, state: 'playing', pointIndex: -1, anchorPath: null });

  assert.match(
    client.root.text,
    /面板脚本出错：/,
    '异常必须变成面板上看得见的一行 —— 否则用户只看到"卡死"，我们两头都拿不到证据',
  );
});

// ── 四、讲完之后不许是死路（D72）：按钮要和键盘说同一句话 ────────────────────

test('D72：讲完之后「上一步」与「退出」仍然可点，「下一步」才该禁', () => {
  const client = runSidebarClient(SIDEBAR_CLIENT_SCRIPT);
  // 宿主真实顺序：先把最后一拍按 state=done 推一次，再推 session:end
  // （下标必须落在 result.steps 里 —— 这不是客套：下标越界时客户端会在建头部那一步抛，
  //   被 D70 的兜底接住并显示红字，工具栏根本轮不到渲染）
  const steps = (realWorldSession() as { result: unknown }).result;
  client.send(sessionUpdate({ result: steps, index: 1, pointIndex: -1, state: 'done' }));
  client.send({ type: 'session:end' });

  const prev = findByText(client.root, '上一步');
  const next = findByText(client.root, '讲完了');
  const stop = findByText(client.root, '退出');

  assert.equal(next?.disabled, true, '讲完了确实没东西可推进');
  assert.equal(
    prev?.disabled,
    false,
    '回看是把讲解用完 —— 而键盘那边 Alt+[ 一直是好的，按钮不能比键盘还小气',
  );
  assert.equal(
    stop?.disabled,
    false,
    '「退出」是收掉高亮的唯一按钮出口，禁掉它 = 面板成了死路（D61 同一条规矩）',
  );
  assert.match(
    client.root.text,
    /可以按「上一步」回看，或按「退出」收掉高亮/,
    '那句话要说清现在还能做什么，而不是只说"结束了"',
  );
});

test('D72：按住不放（键盘自动重复）不许变成连发', () => {
  const client = runSidebarClient(SIDEBAR_CLIENT_SCRIPT);
  client.send(sessionUpdate());

  const before = client.posted.length;
  client.key('keydown', { key: ']', altKey: true, repeat: true, preventDefault() {} });
  assert.equal(client.posted.length, before, '自动重复不该再发 ui:next（那是把面板和编辑器一起压住）');

  client.key('keydown', { key: ']', altKey: true, repeat: false, preventDefault() {} });
  assert.equal(
    client.posted.at(-1)?.type,
    'ui:next',
    '真正的按键仍然要转发（面板有焦点时工作台的键位到不了这儿，D47）',
  );
});
