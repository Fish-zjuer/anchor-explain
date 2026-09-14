/**
 * 注入脚本（`media/anchor-select.js`）的行为锁 —— 线2 里唯一跑在 webview 页面上、
 * 却既没有类型检查也没有单测覆盖的一段代码（D73）。
 *
 * @anchor 为什么必须给它补夹具：S5/S6 上线后用户的原话是「框选PDF，并没有反应」——
 *         整条链路从第一颗螺丝就断了，而**屏幕上一个字都没有**。根因不在几何、也不在守卫：
 *         `acquireVsCodeApi()` 在同一个 webview 里**只能成功调用一次**（第二次抛错，见
 *         `makeVsCodeApi` 的注释），而这份 PDF 页面里**上游的 pdf.js 已经先调过一次**
 *         （`viewer.mjs` 里 `VSCodeLinkService` 用它把 PDF 里的链接交回宿主，而
 *         `assets/main.mjs` 一开头就 `import` 了 viewer.mjs，所以它必然跑在我们前面）。
 *         我们的脚本排在它后面 → 抛出的异常被自己的 try/catch 吞掉 → `postMessage` 全变成
 *         静默空操作：`anchor:ready` 发不出去 → 宿主永远不补发 `enterSelectMode` →
 *         连十字光标都不出现，用户看到的就是"毫无反应"。
 *
 *         这个文件把那条链路**真的跑一遍**：最小 DOM + 逐字复刻 VS Code 预加载语义的
 *         `acquireVsCodeApi`，断言"宿主推 enterSelectMode → 拖一个框 → 发回来的消息
 *         能被宿主守卫收下、且算得出是第几页的哪一块"。这样"几何 / 消息形状 / 退出口"
 *         这些以前只能靠 F5 手拖一百次找感觉的东西，从此有断言。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSelectMessage } from '../src/anchor/bridge.ts';
import { rectToNormalizedBBox, resolveSelection } from '../src/anchor/rectToNormalizedBBox.ts';

const CLIENT_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'media', 'anchor-select.js'),
  'utf8',
);

// ── 一、复刻 VS Code 那边的语义（这条锁守的是"夹具本身没说谎"）──────────────

/**
 * `acquireVsCodeApi` 的**逐字复刻**，事实源是 VS Code 1.137.0 自己的 webview 预加载：
 * `<安装目录>/resources/app/out/vs/workbench/contrib/webview/browser/pre/index.html`
 * 第 209 行起（`getVsCodeApiScript`）。要点两条：
 *   1. `let acquired = false;` —— **同一个 webview 里只能成功取一次**，第二次
 *      `throw new Error('An instance of the VS Code API has already been acquired')`
 *   2. 只有 `allowMultipleAPIAcquire: true` 的 webview 才允许重复取，而那是
 *      **notebook renderer 与 chat 输出**专用的；自定义编辑器（我们这条线）没有它
 */
function makeVsCodeApi(allowMultiple = false) {
  const posted: unknown[] = [];
  const instance = { postMessage: (message: unknown) => posted.push(message) };
  let acquired = false;
  let successes = 0;
  return {
    posted,
    instance,
    get successes() {
      return successes;
    },
    acquire() {
      if (acquired && !allowMultiple) {
        throw new Error('An instance of the VS Code API has already been acquired');
      }
      acquired = true;
      successes += 1;
      return instance;
    },
  };
}

test('夹具自证：acquireVsCodeApi 第二次调用会抛（与 VS Code 预加载逐字一致）', () => {
  const api = makeVsCodeApi();
  assert.equal(api.acquire(), api.instance);
  assert.throws(() => api.acquire(), /already been acquired/);
  assert.equal(api.successes, 1, '只成功取出过一次');
});

// ── 二、最小 DOM ────────────────────────────────────────────────────────────

interface FakeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 真实 `DOMRect` 的形状：**`x/left`、`y/top` 两套都在**（脚本量的是 `left`/`top`，
 * 因为那是 `getBoundingClientRect()` 最原始的四个字段）。夹具少写一套，
 * 测出来的就不是页面上的行为。
 */
interface FakeDomRect extends FakeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface FakeEl {
  tag: string;
  id: string;
  textContent: string;
  children: FakeEl[];
  parentNode: FakeEl | null;
  attrs: Record<string, string>;
  style: Record<string, string>;
  classList: { add(c: string): void; remove(c: string): void; contains(c: string): boolean };
  appendChild(child: FakeEl): void;
  removeChild(child: FakeEl): void;
  setAttribute(key: string, value: string): void;
  getAttribute(key: string): string | null;
  querySelector(sel: string): FakeEl | null;
  getBoundingClientRect(): FakeDomRect;
}

function fakeEl(tag: string, rect: FakeRect = { x: 0, y: 0, width: 0, height: 0 }): FakeEl {
  const classes = new Set<string>();
  const domRect: FakeDomRect = {
    ...rect,
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
  };
  const node: FakeEl = {
    tag,
    id: '',
    textContent: '',
    children: [],
    parentNode: null,
    attrs: {},
    style: {},
    classList: {
      add: (c) => void classes.add(c),
      remove: (c) => void classes.delete(c),
      contains: (c) => classes.has(c),
    },
    appendChild(child) {
      child.parentNode = node;
      node.children.push(child);
    },
    removeChild(child) {
      child.parentNode = null;
      node.children = node.children.filter((c) => c !== child);
    },
    setAttribute(key, value) {
      node.attrs[key] = value;
    },
    getAttribute(key) {
      return node.attrs[key] ?? null;
    },
    querySelector(sel) {
      if (sel === '.canvasWrapper') return node.children.find((c) => c.id === CANVAS_ID) ?? null;
      return null;
    },
    getBoundingClientRect: () => domRect,
  };
  return node;
}

/**
 * 页面里的一页。pdf.js 的结构是 `.page[data-page-number] > .canvasWrapper > canvas`，
 * 注入脚本量的就是 `.canvasWrapper` 的 `getBoundingClientRect()`（页容器可能带 padding）。
 * 屏幕坐标：左上角 (100,100)，600×800 —— 与 `test/anchor.test.ts` 里那组数字同源。
 */
const CANVAS_ID = 'canvasWrapper';
const PAGE_PX = { x: 100, y: 100, width: 600, height: 800 };
const PAGE_NUMBER = 3;

interface Env {
  doc: object;
  win: object;
  pageAcquire?: unknown;
  /** 宿主 → 注入脚本：推一条 §5.2 的消息进去（origin 正确） */
  message(data: unknown): void;
  messageFrom(origin: string, data: unknown): void;
  pointer(type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number): void;
  key(k: string): void;
  /** 脚本查过的选择器（判据改了要在这里现形） */
  selectors: string[];
  /** 页面上挂着的所有元素 */
  all: FakeEl[];
  /**
   * 脚本跑完之后，页面上的 `acquireVsCodeApi` 是什么（真实页面里它就是脚本装上去的那个"共用壳"）。
   * pdf.js 之后读到的就是它 —— 这条锁守的是"页面链接不会因为我们而坏掉"。
   */
  pageAcquire: unknown;
  byId(id: string): FakeEl | undefined;
  /** 页面上有没有这个 class 的元素（用来验"故障时必须发声"） */
  hasClass(cls: string): boolean;
}

function makeEnv(): Env {
  const all: FakeEl[] = [];
  const byId = (id: string) => all.find((n) => n.id === id);
  const selectors: string[] = [];
  const docListeners: Record<string, ((ev: Record<string, unknown>) => void)[]> = {};
  const winListeners: Record<string, ((ev: Record<string, unknown>) => void)[]> = {};

  const head = fakeEl('head');
  const body = fakeEl('body');
  all.push(head, body);

  const wrapper = fakeEl('div', PAGE_PX);
  wrapper.id = CANVAS_ID;
  const page = fakeEl('div');
  page.attrs['data-page-number'] = String(PAGE_NUMBER);
  page.appendChild(wrapper);
  all.push(page, wrapper);

  const createElement = (tag: string) => {
    const node = fakeEl(tag);
    all.push(node);
    return node;
  };

  const doc = {
    head,
    body,
    getElementById: (id: string) => byId(id) ?? null,
    createElement,
    querySelectorAll: (sel: string) => {
      selectors.push(sel);
      return [page];
    },
    addEventListener: (type: string, handler: (ev: Record<string, unknown>) => void) => {
      (docListeners[type] ??= []).push(handler);
    },
  };

  const win = {
    origin: 'vscode-webview://fixture',
    addEventListener: (type: string, handler: (ev: Record<string, unknown>) => void) => {
      (winListeners[type] ??= []).push(handler);
    },
  };

  const fire = (listeners: ((ev: Record<string, unknown>) => void)[], ev: Record<string, unknown>) => {
    for (const handler of [...listeners]) handler(ev);
  };

  return {
    doc,
    win,
    selectors,
    all,
    byId,
    hasClass: (cls) => all.some((n) => n.classList.contains(cls)),
    message: (data) => fire(winListeners['message'] ?? [], { origin: win.origin, data }),
    messageFrom: (origin, data) => fire(winListeners['message'] ?? [], { origin, data }),
    pointer: (type, x, y) =>
      fire(docListeners[type] ?? [], {
        button: 0,
        clientX: x,
        clientY: y,
        preventDefault() {},
        stopPropagation() {},
      }),
    key: (k) =>
      fire(docListeners['keydown'] ?? [], {
        key: k,
        preventDefault() {},
        stopPropagation() {},
      }),
  };
}

/**
 * 把 `media/anchor-select.js` 放进夹具里跑起来。
 *
 * `acquire` 就是页面里的 `acquireVsCodeApi`（`undefined` = 页面里根本没有这个 API）。
 * 脚本读的是**裸名**，对应 webview 预加载把 API 定义在 `globalThis` 上这件事 ——
 * 所以这里临时挂到真正的 globalThis 上，跑完还原，别污染别的测试。
 */
function loadClient(acquire: unknown): Env {
  const env = makeEnv();
  const holder = globalThis as { acquireVsCodeApi?: unknown };
  const saved = holder.acquireVsCodeApi;
  if (acquire === undefined) delete holder.acquireVsCodeApi;
  else holder.acquireVsCodeApi = acquire;
  try {
    // eslint-disable-next-line no-new-func -- 被测对象就是一段要在 webview 里跑的字符串
    const factory = new Function('document', 'window', CLIENT_SOURCE);
    factory(env.doc, env.win);
    // 脚本跑完后页面上的那个 acquire（装上了壳就是壳）。夹具要还原全局，所以先抄下来。
    env.pageAcquire = holder.acquireVsCodeApi;
  } finally {
    if (saved === undefined) delete holder.acquireVsCodeApi;
    else holder.acquireVsCodeApi = saved;
  }
  return env;
}

/** 一道 100×100 的框，落在那一页里 */
const DRAG = { from: { x: 200, y: 200 }, to: { x: 300, y: 300 } };

function dragOut(env: Env): void {
  env.pointer('pointerdown', DRAG.from.x, DRAG.from.y);
  env.pointer('pointermove', DRAG.to.x, DRAG.to.y);
  env.pointer('pointerup', DRAG.to.x, DRAG.to.y);
}

// ── 三、链路的每一颗螺丝 ────────────────────────────────────────────────────

test('加载即握手：anchor:ready 必须发出去（宿主的"补发 enterSelectMode"全靠它）', () => {
  const api = makeVsCodeApi();
  loadClient(api.acquire);
  assert.deepEqual(api.posted, [{ type: 'anchor:ready' }]);
});

test('（D73 回归）我们把 API 先接下来、再让给 pdf.js 时，框选整条链路走通', () => {
  // 修法的机制：注入脚本必须**排在 pdf.js / main.mjs 之前**加载（见 pdf-viewer-provider.ts），
  // 由它先取一次、把实例记下来，之后 pdf.js 来取就拿到同一个。
  // 「先后」这件事由冒烟里的 HTML 顺序断言守着；这里守的是"顺序对了之后真的能跑通"。
  const api = makeVsCodeApi();
  const env = loadClient(api.acquire);
  assert.equal(api.successes, 1, '我们先取');

  // pdf.js 稍后来取（viewer.mjs 的 VSCodeLinkService 读的也是裸名 → 同一个 globalThis）
  const forPdfJs = (env.pageAcquire as (() => unknown) | undefined)?.();
  assert.equal(forPdfJs, api.instance, 'pdf.js 拿到的是同一个实例，而不是抛错（不能为了自己能用就把页面链接搞坏）');
  assert.equal(api.successes, 1, 'VS Code 那边"只准成功取一次"的约束没被违反');

  assert.deepEqual(api.posted, [{ type: 'anchor:ready' }], '加载完就握手');

  env.message({ type: 'anchor:enterSelectMode' });
  assert.ok(env.hasClass('anchor-active'), '进得了框选模式（十字光标要出来）');

  dragOut(env);

  const captured = api.posted.at(-1);
  assert.deepEqual(
    parseSelectMessage(captured),
    captured,
    '发回去的消息必须能过宿主守卫（§5.2）',
  );

  const message = parseSelectMessage(captured);
  assert.equal(message?.type, 'anchor:captured');
  if (message?.type !== 'anchor:captured') return;

  // 宿主**用 geometry 重算**，不信脚本算的 bbox：这里就是那条重算的兑现
  assert.deepEqual(message.geometry?.dragged, { x: 200, y: 200, width: 100, height: 100 });
  assert.equal(message.geometry?.pages.length, 1);
  const resolved = resolveSelection(message.geometry!.dragged, message.geometry!.pages);
  assert.equal(resolved?.page, PAGE_NUMBER, '落在第 3 页');
  const want = [100 / 600, 100 / 800, 200 / 600, 200 / 800];
  resolved?.bbox.forEach((n, i) => {
    assert.ok(Math.abs(n - want[i]!) < 1e-9, `bbox[${i}]：期望 ${want[i]}，实得 ${n}`);
  });

  assert.ok(
    env.selectors.some((s) => s.includes('data-page-number')),
    '页的判据仍是 pdf.js 自己的 data-page-number（没自创一套）',
  );
  assert.equal(env.byId('anchor-select-fault'), undefined, '一切正常时不许在 PDF 上贴任何东西');
});

test('若 API 已被别人先取走（顺序错了/上游变了）：不崩、不假装能用、在页面上发声', () => {
  // 这是出事那一刻的真实状态。修了顺序之后不该再发生，但只要它发生，
  // 就必须**有声音**——上一版在这里是彻底静默，用户只看到"框选毫无反应"。
  const api = makeVsCodeApi();
  api.acquire();
  const env = loadClient(api.acquire);

  assert.deepEqual(api.posted, [], '拿不到实例，一个字也发不出去（这就是当初的症状）');
  env.message({ type: 'anchor:enterSelectMode' });
  assert.equal(env.hasClass('anchor-fault'), true, '用户一旦要框选，就得告诉他这里坏了');

  api.posted.length = 0;
  dragOut(env);
  assert.deepEqual(api.posted, [], '而且不许假装成功');
});

test('误触（小于 6px）报 cancelled，不产出锚点', () => {
  const api = makeVsCodeApi();
  const env = loadClient(api.acquire);
  env.message({ type: 'anchor:enterSelectMode' });
  env.pointer('pointerdown', 200, 200);
  env.pointer('pointerup', 202, 201);
  assert.equal(api.posted.at(-1)?.type, 'anchor:cancelled');
});

test('退出框选模式后屏幕上不留东西（约束 1：PDF 上不出现任何框）', () => {
  const api = makeVsCodeApi();
  const env = loadClient(api.acquire);
  env.message({ type: 'anchor:enterSelectMode' });
  dragOut(env);
  assert.equal(env.byId('anchor-select-band')?.classList.contains('anchor-active'), false, '橡皮筋收掉');
  assert.equal(env.byId('anchor-select-overlay')?.classList.contains('anchor-active'), false, 'overlay 退出');

  // Esc 是第二个出口，且只清不留
  env.message({ type: 'anchor:enterSelectMode' });
  env.pointer('pointerdown', 200, 200);
  env.pointer('pointermove', 260, 260);
  env.key('Escape');
  assert.equal(api.posted.at(-1)?.type, 'anchor:cancelled');
  assert.equal(env.byId('anchor-select-band')?.classList.contains('anchor-active'), false);
  assert.equal(env.byId('anchor-select-overlay')?.classList.contains('anchor-active'), false);
});

test('拿不到 API 时**必须在页面上发声**，而不是静静失效（D61~D73 的同一件事）', () => {
  const api = makeVsCodeApi();
  const env = loadClient(undefined);
  assert.deepEqual(api.posted, [], '没有 API，一个字也发不出去');
  assert.equal(env.hasClass('anchor-fault'), false, '平时不许在 PDF 上贴东西');

  env.message({ type: 'anchor:enterSelectMode' });
  assert.equal(env.hasClass('anchor-fault'), true, '用户一旦要框选，就得告诉他这里坏了');
  const banner = env.all.find((n) => n.classList.contains('anchor-fault'));
  assert.match(banner?.textContent ?? '', /框选/);
});

test('origin 不匹配的消息一律忽略（上游那条检查要保持）', () => {
  const api = makeVsCodeApi();
  const env = loadClient(api.acquire);
  env.messageFrom('https://evil.example', { type: 'anchor:enterSelectMode' });
  assert.equal(env.hasClass('anchor-active'), false);
});

test('gotoPage：把 PDF 滚到指定那一页（S6 的"只滚，不画框"）', () => {
  // 这条守的是 S6 那条链路的**最后一颗螺丝**：侧边栏点「第 N 页」→ 宿主 → 注入脚本 → pdf.js。
  // 前几颗在链式冒烟里有断言，这一颗没有 —— 而注入脚本既不进类型检查也不进 bundle（D73 的教训）。
  const api = makeVsCodeApi();
  const env = loadClient(api.acquire);
  const viewer = { pdfViewer: { currentPageNumber: 1 } };
  (env.win as { PDFViewerApplication?: unknown }).PDFViewerApplication = viewer;

  env.message({ type: 'anchor:gotoPage', page: 7 });
  assert.equal(viewer.pdfViewer.currentPageNumber, 7, '页码要真的落到 pdf.js 上');

  // 坏页号不许动它：宁可不滚，也不能把视图推到第 0 页或 NaN
  env.message({ type: 'anchor:gotoPage', page: 0 });
  env.message({ type: 'anchor:gotoPage', page: 'x' });
  env.message({ type: 'anchor:gotoPage' });
  assert.equal(viewer.pdfViewer.currentPageNumber, 7, '坏页号一律当作没收到');

  assert.deepEqual(api.posted, [{ type: 'anchor:ready' }], '滚动是单向的：一个字都不回发（§5.2）');
  assert.equal(env.hasClass('anchor-active'), false, '滚动不等于框选：橡皮筋与 overlay 都不该动');
});

// ── 闪现框（S6 补 / D76）──────────────────────────────────────────────────

/** 把内联样式里的 px 读成数字（`199.99999999999997px` → 199.99999999999997） */
function px(value: string | undefined): number {
  return Number.parseFloat(String(value ?? '').replace('px', ''));
}

function flashBox(env: Env): { x: number; y: number; w: number; h: number } | null {
  const node = env.byId('anchor-select-flash');
  if (!node || !node.classList.contains('anchor-active')) return null;
  return { x: px(node.style.left), y: px(node.style.top), w: px(node.style.width), h: px(node.style.height) };
}

test('（D76 核心）闪现框的像素位置 = 已单测的正向换算的**逆**：往返校验', () => {
  // 这一条是"注入脚本里那门逆换算凭什么可以被信任"的全部答案：
  // 用**有单测的正向函数**（rectToNormalizedBBox）把一块像素换算成 bbox，
  // 再让脚本把 bbox 画回像素 —— 画出来的矩形必须就是当初那块像素。
  const api = makeVsCodeApi();
  const env = loadClient(api.acquire);
  const viewer = { pdfViewer: { currentPageNumber: 1 } };
  (env.win as { PDFViewerApplication?: unknown }).PDFViewerApplication = viewer;

  const dragged = { x: 200, y: 200, width: 100, height: 100 };
  const bbox = rectToNormalizedBBox(dragged, PAGE_PX);
  assert.ok(bbox, '正向换算本身要先成立');

  env.message({ type: 'anchor:flashRegion', page: PAGE_NUMBER, bbox });

  const box = flashBox(env);
  assert.ok(box, '框要画出来');
  const near = (a: number, b: number, what: string) =>
    assert.ok(Math.abs(a - b) < 1e-6, `${what}：期望 ${b}，实得 ${a}`);
  near(box!.x, dragged.x, 'left');
  near(box!.y, dragged.y, 'top');
  near(box!.w, dragged.width, 'width');
  near(box!.h, dragged.height, 'height');
  assert.equal(viewer.pdfViewer.currentPageNumber, PAGE_NUMBER, '先把视图滚到那一页，再画');
});

test('闪现框到点自己消失（不许赖在屏幕上）', async () => {
  const api = makeVsCodeApi();
  const env = loadClient(api.acquire);
  const bbox = [0.1, 0.1, 0.3, 0.3];

  // 时长有下限（300ms）：不许出现"5 毫秒闪一下"这种根本看不见的东西 —— 那等于没闪（D76）
  env.message({ type: 'anchor:flashRegion', page: PAGE_NUMBER, bbox, ms: 320 });
  assert.ok(flashBox(env), '刚发出来时应当在');

  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(flashBox(env), null, '到点必须消失（约束 1 放宽后的那一半：只允许"会自己消失"的框）');
  assert.equal(
    env.byId('anchor-select-flash')?.parentNode,
    null,
    '而且要真的从 DOM 上摘掉，不只是隐藏（`byId` 查的是"建过的节点"，所以看它有没有被摘下来）',
  );
});

test('闪现框只在收到消息时出现 —— 自动播放/推进不会自己冒框', () => {
  const api = makeVsCodeApi();
  const env = loadClient(api.acquire);
  env.message({ type: 'anchor:ready' }); // 无关消息
  env.message({ type: 'anchor:enterSelectMode' });
  env.key('Escape');
  assert.equal(env.byId('anchor-select-flash'), undefined, '没让我们闪，一个框都不许有');
});

test('闪现框：坏页号 / 坏 bbox 一律不画（宁可不闪，也不闪错地方）', () => {
  const api = makeVsCodeApi();
  const env = loadClient(api.acquire);
  const good = [0.1, 0.2, 0.5, 0.6];
  const bad: unknown[] = [
    undefined,
    null,
    [],
    [0, 0, 1],
    [0, 0, 0, 1], // 零宽度
    [0.5, 0.5, 0.5, 0.5], // 零面积
    ['0', '0', '1', '1'],
    [0, 0, Number.NaN, 1],
    [0, 0, 1, 2], // 超出 [0,1]
  ];
  for (const bbox of bad) {
    env.message({ type: 'anchor:flashRegion', page: PAGE_NUMBER, bbox });
    assert.equal(env.byId('anchor-select-flash'), undefined, `坏 bbox ${JSON.stringify(bbox)} 不许画框`);
  }
  env.message({ type: 'anchor:flashRegion', page: 0, bbox: good });
  env.message({ type: 'anchor:flashRegion', page: 99, bbox: good }); // 这一页不在文档里
  assert.equal(env.byId('anchor-select-flash'), undefined, '页号不对也不画');
  assert.equal(env.byId('anchor-select-fault'), undefined, '这些是坏输入，不是故障，不用吓用户');
});

test('脏消息不炸：缺字段 / 未知类型都当没发生', () => {
  const api = makeVsCodeApi();
  const env = loadClient(api.acquire);
  for (const bad of [null, 42, { type: 'anchor:unknown' }, { type: 'anchor:gotoPage' }]) {
    env.message(bad);
  }
  assert.equal(api.posted.length, 1, '除了最初的握手，什么都没多发');
});
