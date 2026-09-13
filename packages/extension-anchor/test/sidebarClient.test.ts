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
  textContent: string;
  title: string;
  id: string;
  children: FakeNode[];
  attrs: Record<string, string>;
  firstChild: FakeNode | null;
  appendChild(child: FakeNode): void;
  setAttribute(key: string, value: string): void;
  removeChild(child: FakeNode): void;
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
} {
  const root = fakeNode('div');
  const handlers: ((ev: { data: unknown }) => void)[] = [];
  const posted: { type?: string }[] = [];

  const documentStub = {
    getElementById: (id: string) => (id === 'root' ? root : null),
    createElement: (tag: string) => fakeNode(tag),
    addEventListener: () => {},
    body: fakeNode('body'),
  };
  const windowStub = {
    addEventListener: (type: string, handler: (ev: { data: unknown }) => void) => {
      if (type === 'message') handlers.push(handler);
    },
    // 客户端会用它在面板里派发用户键位（D47）；这里只要存在
    removeEventListener: () => {},
  };

  // eslint-disable-next-line no-new-func -- 这就是被测对象：一段要在 webview 里跑的字符串
  const factory = new Function('document', 'window', 'acquireVsCodeApi', 'setTimeout', script);
  factory(
    documentStub,
    windowStub,
    () => ({ postMessage: (m: { type?: string }) => posted.push(m) }),
    () => 0,
  );

  return {
    root,
    posted,
    send: (message) => {
      for (const handler of handlers) handler({ data: message });
    },
  };
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
