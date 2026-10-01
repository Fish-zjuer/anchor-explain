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
import { SIDEBAR_STYLES } from '../src/sidebar/ui/styles.ts';
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
function runSidebarClient(
  script: string,
  /**
   * 内联的排版风格（D129）。`undefined` = 桩里根本没有这个常量 ——
   * 那正是**旧宿主**的样子，客户端必须安全落在默认（可收起）那一支。
   */
  sidebarStyle?: string,
): {
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
    'ANCHOR_SIDEBAR_STYLE',
    script,
  );
  factory(
    documentStub,
    windowStub,
    () => ({ postMessage: (m: { type?: string }) => posted.push(m) }),
    () => 0,
    // 面板里被转发的那几个键（宿主内联进来的**用户实际绑定**，D47）
    { next: 'alt+]', prev: 'alt+[', stop: 'escape' },
    sidebarStyle,
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

/**
 * 按 `data-act` 找一个元素（D83 起用它）。
 *
 * @anchor 为什么不复用 `findByText`：那一层的"按钮是哪个"靠**文案**认，
 *         而文案恰恰是最容易改的东西 —— 改一个字，按文字找的断言就红了，
 *         于是有人会把断言改成新的文案，而 `data-act` 与协议消息的对应关系
 *         仍然没人看着。`data-act` 是**行为**的标识（客户端拿它派发消息），
 *         用它认元素，断言才不会随着文案漂移。
 */
function findByAttr(node: FakeNode, key: string, value: string): FakeNode | undefined {
  if (node.attrs[key] === value) return node;
  for (const child of node.children) {
    const hit = findByAttr(child, key, value);
    if (hit) return hit;
  }
  return undefined;
}

/** 按 class 找一个元素（D125 起用它认"哪一块是当前步"）。 */
function findByClass(node: FakeNode, cls: string): FakeNode | undefined {
  if (node.className.split(' ').includes(cls)) return node;
  for (const child of node.children) {
    const hit = findByClass(child, cls);
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

// ── 三·五、一次只有一块（D125）─────────────────────────────────────────────
//
// 用户的原话："右侧列表不再是一次性展示出所有讲解内容。只显示一块，
// 然后对当前讲解的进行更强的突出。"
//
// 这条锁守的是"只显示一块"必须是**结构上**的：非当前步的正文节点根本不该被创建。
// 若哪天有人把它改回"全部渲染 + CSS 压暗"，屏幕上又会变成所有内容都在眼前 ——
// 而那正是用户这次要改掉的东西。所以这里断言的是**节点在不在**，不是"亮不亮"。

function twoStepSession(index: number): unknown {
  return sessionUpdate({
    result: {
      title: 't',
      summary: 's',
      confidence: 0.5,
      steps: [
        {
          location: { filePath: ANCHOR, lineStart: 1, lineEnd: 2 },
          title: '第一步标题',
          text: '第一步正文',
          highlights: [{ location: { filePath: ANCHOR, lineStart: 1, lineEnd: 1 }, narration: '第一点', emphasis: 'primary' }],
        },
        {
          location: { filePath: ANCHOR, lineStart: 3, lineEnd: 4 },
          title: '第二步标题',
          text: '第二步正文',
          highlights: [{ location: { filePath: ANCHOR, lineStart: 3, lineEnd: 3 }, narration: '第二点', emphasis: 'primary' }],
        },
      ],
    },
    index,
  });
}

test('D125：只有当前步铺开正文，其余步骤只留一行索引', () => {
  const client = runSidebarClient(SIDEBAR_CLIENT_SCRIPT);
  client.send(twoStepSession(1));

  const text = client.root.text;
  assert.match(text, /第二步正文/, '当前步（第 2 步）的正文要铺开');
  assert.match(text, /第二点/, '当前步的逻辑点也要铺开');
  assert.doesNotMatch(text, /第一步正文/, '非当前步的正文一个节点都不该建 —— 这才是"只显示一块"');
  assert.doesNotMatch(text, /第一点/, '非当前步的逻辑点同理');
  assert.match(text, /第一步标题/, '但索引行要留着（它是指回那一步的把手）');

  const current = findByClass(client.root, 'current');
  const indexRow = findByClass(client.root, 'index-row');
  assert.equal(current?.attrs['data-index'], '1', '当前步那一个块的 data-index 必须落在当前步上');
  assert.equal(indexRow?.attrs['data-index'], '0', '非当前步落到索引行');
  assert.equal(current?.attrs['data-act'], 'goto', '索引行与当前块都得能点回去（goto）');
});

test('D125：换到哪一步，铺开的就是哪一步（不是永远铺第一步）', () => {
  const client = runSidebarClient(SIDEBAR_CLIENT_SCRIPT);
  client.send(twoStepSession(0));
  assert.match(client.root.text, /第一步正文/, '第 1 步当前时铺开它');
  assert.doesNotMatch(client.root.text, /第二步正文/);

  client.send(twoStepSession(1));
  assert.match(client.root.text, /第二步正文/, '换到第 2 步之后铺开的要跟着换');
  assert.doesNotMatch(client.root.text, /第一步正文/, '上一块要收回去 —— 否则屏幕上会越积越多');
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
    /按「上一步」可以回看，按「退出」收掉高亮/,
    '那句话要说清现在还能做什么，而不是只说"结束了"',
  );

  /**
   * D83：讲完之后**还必须有"再来一遍"的出口**。
   *
   * 用户的原话是「讲解结束时，需要能重新讲，并且应该能保存/重放之前的内容」——
   * 在那之前这一块只有一句"结束了"加一个禁掉的「下一步」，等于告诉他"这条线到头了"。
   * 两颗按钮**分开**是规格的一部分（一颗不花钱、一颗要再问一次模型），
   * 所以这里连 `data-act` 与 title 一起钉住：改了名字而忘了改宿主那一侧，点击就会静默失效。
   */
  const replay = findByAttr(client.root, 'data-act', 'replay');
  const again = findByAttr(client.root, 'data-act', 'reExplain');
  assert.equal(replay?.textContent, '重放上次讲解');
  assert.equal(again?.textContent, '重新讲一遍');
  assert.match(replay?.title ?? '', /不再问模型/, '「重放」必须说清它不花钱');
  assert.match(again?.title ?? '', /再问一次模型/, '「重新讲」必须说清它会再花一次钱');
});

test('D83：面板上那两颗按钮的 act 名与协议消息是**成对**的（改名只改一边会静默失效）', () => {
  // 客户端脚本是字符串常量、不参与类型检查（见文件头那三条纪律），
  // 所以"act 名 ↔ 消息类型"这层对应关系没有编译器帮我们看着 —— 这条锁就是那一层。
  assert.match(SIDEBAR_CLIENT_SCRIPT, /act === "replay"[\s\S]{0,80}ui:replay/);
  assert.match(SIDEBAR_CLIENT_SCRIPT, /act === "reExplain"[\s\S]{0,80}ui:reExplain/);
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

// ── 四·五、追问那一格（D126）──────────────────────────────────────────────
//
// 用户的原话："然后可以追问，追问时，只提供给AI当前代码块（或一函数等）和当前讲解，
// 补充讲解可以插入讲解队列。"
//
// 这一格只在**当前步**下面 —— 与"只显示一块"（D125）是一致的：追问的对象永远是
// 屏幕上铺开的那一块。会话收掉（ended）之后不给这一格：宿主那边没有会话可插，
// 摆一个能打字、按下去却没反应的框，比"没有这个框"更坏。

test('D126：当前步下面有追问那一格，且 act 名与协议消息成对（改名只改一边会静默失效）', () => {
  const client = runSidebarClient(SIDEBAR_CLIENT_SCRIPT);
  client.send(sessionUpdate());

  const input = findByAttr(client.root, 'data-act', 'askInput');
  const button = findByAttr(client.root, 'data-act', 'ask');
  assert.ok(input, '当前步下面要有追问输入框');
  assert.ok(button, '以及那颗「追问」按钮');
  assert.match(client.root.text, /补充讲解会插在这一步后面/, '要说清结果插在哪里');

  // 客户端脚本是字符串常量、不参与类型检查，所以这层对应关系只能这样钉。
  // **分两段钉**而不是"两个词挨得近"：提交走的是 submitAsk，中间隔着几十行 ——
  // 只查距离的话，把 postMessage 挪进别的函数里也照样绿，而那正是会出错的情形。
  assert.match(SIDEBAR_CLIENT_SCRIPT, /act === "ask"\)\s*submitAsk\(/, '那颗按钮要落到 submitAsk 上');
  assert.match(SIDEBAR_CLIENT_SCRIPT, /vscode\.postMessage\(\{ type: "ui:ask"/, '而 submitAsk 要发 ui:ask');
});

test('D125+D126：追问那一格只长在当前步下面，索引行上没有', () => {
  const client = runSidebarClient(SIDEBAR_CLIENT_SCRIPT);
  client.send(twoStepSession(1));

  const boxes = findByAttr(client.root, 'data-act', 'askInput');
  assert.ok(boxes, '当前步（第 2 步）下面有');
  assert.equal(
    boxes.attrs['data-index'],
    '1',
    '而且它认的是当前那一步 —— 宿主拿这个下标找步骤，认错了就插错位置',
  );
});

test('D126：追问在跑时按钮禁用并改成「追问中…」（不然用户会再按一次）', () => {
  const client = runSidebarClient(SIDEBAR_CLIENT_SCRIPT);
  client.send(sessionUpdate());
  client.send({ type: 'ask:state', index: 0, state: 'running' });

  const button = findByAttr(client.root, 'data-act', 'ask');
  const input = findByAttr(client.root, 'data-act', 'askInput');
  assert.equal(button?.disabled, true, '跑的时候按不动');
  assert.equal(button?.textContent, '追问中…', '按钮自己要说在做什么');
  assert.equal(input?.disabled, true, '输入框同理');
});

test('D126：追问失败要显示在**那一格下面**（通知说不清是哪一次失败的）', () => {
  const client = runSidebarClient(SIDEBAR_CLIENT_SCRIPT);
  client.send(sessionUpdate());
  client.send({ type: 'ask:state', index: 0, state: 'error', message: '端点没有返回内容' });

  assert.match(client.root.text, /追问失败：端点没有返回内容/);
  const button = findByAttr(client.root, 'data-act', 'ask');
  assert.equal(button?.disabled, false, '失败之后要能再试一次（那不是死路）');
});

test('D126：拿不准的 ask:state 形状一律不当成状态（宁可不画，也不画一个我们不知道的结论）', () => {
  const client = runSidebarClient(SIDEBAR_CLIENT_SCRIPT);
  client.send(sessionUpdate());
  client.send({ type: 'ask:state', index: 0, state: '说不清的状态' });

  const button = findByAttr(client.root, 'data-act', 'ask');
  assert.equal(button?.disabled, false, '不认识的状态 = 没在跑');
  assert.doesNotMatch(client.root.text, /追问失败/);
});

test('D126：按过「退出」之后不再给追问那一格（宿主那边会话已经收了）', () => {
  const client = runSidebarClient(SIDEBAR_CLIENT_SCRIPT);
  client.send(sessionUpdate());
  assert.ok(findByAttr(client.root, 'data-act', 'ask'), '会话还在时有');

  client.send({ type: 'session:end' });
  assert.equal(findByAttr(client.root, 'data-act', 'ask'), undefined, '结束之后不该留一个按不动的框');
});

// ── 五、页脚钉住（D127）───────────────────────────────────────────────────
//
// 用户的原话："我需要你把下一步什么的按钮固定在底部，不要随上面内容的变化而变。"
//
// 从前工具条是 `position: sticky; bottom: 0` —— 那在"内容比面板高"时才贴得住，
// 内容一短它就回到文档流里，于是换一步、换一块，三颗按钮跟着上下跳。
// 现在改**两段式**：#root 是满高 flex，.pane 吃剩余高度并自己滚，.foot 钉在底部。
//
// 这两条锁是配套的：一条锁 DOM 真的分了两棵子树（否则 CSS 再对也没用），
// 一条锁 CSS 那边没有再回到 sticky（那是最容易被"顺手改回去"的一处）。

test('D127：面板分成"会滚的 .pane"和"钉住的 .foot"两棵子树', () => {
  const client = runSidebarClient(SIDEBAR_CLIENT_SCRIPT);
  client.send(sessionUpdate());

  const pane = findByClass(client.root, 'pane');
  const foot = findByClass(client.root, 'foot');
  assert.ok(pane, '要有滚动区 .pane');
  assert.ok(foot, '要有钉住的页脚 .foot');

  // 分法是"读的会滚、按的不会滚" —— 逐颗钉住，改归属时这里会红
  for (const label of ['上一步', '下一步', '退出']) {
    assert.equal(findByText(pane, label), undefined, `${label} 不该在滚动区里（那它就会跟着上下跑）`);
    assert.ok(findByText(foot, label), `${label} 要在页脚里`);
  }
  for (const label of ['导出讲解', '历史文件夹']) {
    assert.ok(findByText(foot, label), `${label}（把成果拿走）也要钉住 —— 它跟工具条是一类`);
  }
  assert.ok(findByText(pane, '取件日志'), '取件日志是"读"的东西，留在滚动区');
});

test('D127：没有快照（还在等讲解）时不建空的 .foot（否则留一条没内容的分隔线）', () => {
  const client = runSidebarClient(SIDEBAR_CLIENT_SCRIPT);
  assert.equal(findByClass(client.root, 'foot'), undefined, '还没开始讲时不该有页脚');

  client.send(sessionUpdate());
  assert.ok(findByClass(client.root, 'foot'), '有讲解之后才有');
});

test('D127：样式那边不许再回到 sticky（钉住是 .foot 的职责，不是工具条自己的）', () => {
  // 这条防的是"顺手改回去"：sticky 在**长内容**下看起来是对的，
  // 只有内容一短才露馅（而那正是用户报的那个现象）。所以必须锁住机制本身。
  assert.doesNotMatch(
    SIDEBAR_STYLES,
    /\.toolbar\s*\{[^}]*position:\s*sticky/,
    '工具条不许自己 sticky —— 那正是"内容一短就跟着跳"的成因',
  );
  assert.match(SIDEBAR_STYLES, /\.pane\s*\{[^}]*overflow-y:\s*auto/, '.pane 要自己滚');
  assert.match(SIDEBAR_STYLES, /\.pane\s*\{[^}]*min-height:\s*0/, 'min-height:0 不给，flex 子项会被内容撑高、overflow 不生效');
  assert.match(SIDEBAR_STYLES, /#root\s*\{[^}]*height:\s*100vh/, '#root 要满高，否则页脚会飘到内容后面');
});

// ── 六、两套排法可选（D129）与页脚一行按钮 ────────────────────────────────
//
// 用户的两句："还有下面的按钮你放在一排行不行，靠左和靠右区分。"
// 以及"之前的经典样式和现在的可收起样式，我们在设置里弄成可选项。"

test('D129 classic：每一步的正文都铺开，且**没有**索引行', () => {
  const client = runSidebarClient(SIDEBAR_CLIENT_SCRIPT, 'classic');
  client.send(twoStepSession(1));

  assert.match(client.root.text, /第二步正文/);
  assert.match(client.root.text, /第一步正文/, '经典样式要的就是"全都铺开"');
  assert.match(client.root.text, /第一点/, '逻辑点同理');
  assert.equal(findByClass(client.root, 'index-row'), undefined, '经典样式里不该有索引行');
  assert.ok(findByClass(client.root, 'current'), '当前块照样要标出来（显眼那一条两档通用）');
});

test('D129 classic：追问框**仍然只有一个**，且在当前步上', () => {
  // 这是经典样式最容易犯的错：非当前步也会走到"渲染正文"那一段，
  // 于是每一块下面都长出一个追问框（而宿主只认当前那一步）。
  const client = runSidebarClient(SIDEBAR_CLIENT_SCRIPT, 'classic');
  client.send(twoStepSession(1));

  let count = 0;
  let firstIndex: string | undefined;
  const walk = (node: FakeNode): void => {
    if (node.attrs['data-act'] === 'askInput') {
      count += 1;
      firstIndex ??= node.attrs['data-index'];
    }
    for (const child of node.children) walk(child);
  };
  walk(client.root);

  assert.equal(count, 1, '只能有一个追问框');
  assert.equal(firstIndex, '1', '而且它认的是当前那一步');
});

test('D129：内联常量缺失（旧宿主）或值不认识时，都安全落在默认那一支', () => {
  // 裸引用一个不存在的常量会抛 ReferenceError，而 webview 里的异常表现为
  // "面板整块不更新、屏幕上没有任何报错"（D70 踩过的那种死法）—— 所以必须安全退化。
  const missing = runSidebarClient(SIDEBAR_CLIENT_SCRIPT);
  missing.send(twoStepSession(1));
  assert.match(missing.root.text, /第二步正文/, '缺常量也要能画出来');
  assert.doesNotMatch(missing.root.text, /第一步正文/, '缺常量时按默认（只铺开一块）走');
  assert.ok(findByClass(missing.root, 'index-row'));

  const typo = runSidebarClient(SIDEBAR_CLIENT_SCRIPT, '折叠');
  typo.send(twoStepSession(1));
  assert.ok(findByClass(typo.root, 'index-row'), '设置写错一个词不该让面板变样');
});

test('D129：两处都要下发风格 —— body 属性（CSS 用）与内联常量（客户端用）', async () => {
  const { renderSidebarHtml } = await import('../src/sidebar/ui/html.ts');
  const { defaultChords } = await import('../src/sidebar/keybindingResolve.ts');

  const classic = renderSidebarHtml('vscode-webview://x', defaultChords(false), 1, 'zh', 'classic');
  assert.match(classic, /<body data-anchor-style="classic">/, 'CSS 靠它区分两套规则');
  assert.match(classic, /var ANCHOR_SIDEBAR_STYLE = "classic";/, '客户端靠它决定要不要建正文节点');

  const plain = renderSidebarHtml('vscode-webview://x', defaultChords(false), 1);
  assert.match(plain, /<body data-anchor-style="collapsible">/, '不传就是默认档');
  assert.match(plain, /var ANCHOR_SIDEBAR_STYLE = "collapsible";/);
});

test('D129：五颗按钮排在**同一行**里，左组推进、右组出口', () => {
  const client = runSidebarClient(SIDEBAR_CLIENT_SCRIPT);
  client.send(sessionUpdate());

  const bar = findByClass(client.root, 'foot-bar');
  assert.ok(bar, '页脚里要有一个 .foot-bar 把它们装在同一行');
  for (const label of ['上一步', '下一步', '退出', '导出讲解', '历史文件夹']) {
    assert.ok(findByText(bar, label), `${label} 要在这一行里`);
  }

  // 两组**仍然是两个容器**：靠边对齐得有东西可挂。合并成一个容器就没法把右组顶到边上。
  assert.ok(findByClass(bar, 'toolbar'), '左组');
  assert.ok(findByClass(bar, 'tools'), '右组');
  assert.match(SIDEBAR_STYLES, /\.tools\s*\{[^}]*margin-left:\s*auto/, '右组靠 margin-left:auto 靠右');
  assert.match(SIDEBAR_STYLES, /\.foot-bar\s*\{[^}]*display:\s*flex/, '.foot-bar 要是一行 flex');
});
