/*
 * Copyright 2026 anchor-explain
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * 框选 overlay —— **注入式**，不碰 `assets/pdf.js/`。
 *
 * 这是线2 里唯一跑在 webview 页面里的代码。它与宿主的分工是刻意的：
 *
 *   - 这里只做**跟手的事**：画橡皮筋、报当前的像素几何、报"哪些页在哪"。
 *   - 这里**一行业务数学都不做**：不判断落在第几页、不算归一化 bbox。
 *     那些归宿主的 `src/anchor/rectToNormalizedBBox.ts`（有单测）。
 *     理由：这个文件是字符串常量、不参与类型检查、也没法被单测 ——
 *     把唯一有对错的部分放在这里，等于让它失去覆盖。
 *
 * 三条纪律：
 *   1. **退出框选模式后，屏幕上不留任何东西**（约束 1：PDF 上不出现任何高亮框）。
 *      橡皮筋只在按住指针期间存在，抬手/取消/退出都立刻移除。
 *      **唯一的例外**：拿不到 VS Code API 时的那句故障说明（见 `showFault`）——
 *      那种情况下 postMessage 这条通道根本不存在，页面上这句是唯一还能说话的出口。
 *   2. **只在框选模式里拦事件**。平时 overlay 完全不参与事件流，
 *      pdf.js 的滚动、缩放、文字选择、链接点击一个都不受影响。
 *   3. 报给宿主的消息形状由 `CONTRACTS` §5.2 冻结，本文件不许自行发明字段。
 */

(() => {
  'use strict';

  /**
   * 与页面里其他脚本**共用同一个 VS Code API 实例**（D73）。
   *
   * @anchor `acquireVsCodeApi()` 在一个 webview 里**只能成功调用一次** —— 第二次直接抛
   *         "An instance of the VS Code API has already been acquired"（VS Code 自己的
   *         webview 预加载就是这么写的：`let acquired = false` 加一句 throw；
   *         只有 notebook renderer 与 chat 输出被允许重复取）。
   *
   *         而这份 PDF 页面里**上游的 pdf.js 已经先调过一次** —— `viewer.mjs` 的
   *         `VSCodeLinkService` 用它把 PDF 里的链接交回宿主，而 `assets/main.mjs` 一开头就
   *         `import` 了 viewer.mjs，所以它**必然**跑在我们前面（这也解释了为什么 PDF 渲染正常
   *         而框选全哑：页面先取成功，我们那次调用抛了）。
   *
   *         第一版没意识到这件事，只包了个 try/catch 打算"优雅退化成功能不可用"——
   *         结果是 postMessage 全变成静默空操作：`anchor:ready` 发不出去 → 宿主永远不补发
   *         `enterSelectMode` → 连十字光标都不出现。用户看到的是"框选毫无反应"，
   *         而屏幕上连一个字都没有。
   *
   *         所以这里把那个"只准调一次"换成"谁都拿到同一个"：自己第一个去取、把实例记下来，
   *         之后 pdf.js 再来取就拿到同一个。
   *
   *         **顺序不能反**：若让 pdf.js 先取成功，我们就再也拿不到实例。为此本文件必须排在
   *         pdf.js / main.mjs **之前**加载（见 `pdf-viewer-provider.ts` 注入处那条注释）。
   */
  let vscode = null;
  try {
    const original = globalThis.acquireVsCodeApi;
    if (typeof original === 'function') {
      let shared = null;
      const acquireOnce = () => {
        if (shared === null) shared = original();
        return shared;
      };
      globalThis.acquireVsCodeApi = acquireOnce;
      // 装上没装上必须**验一下**：没装上就不能先取 —— 取了会把 pdf.js 那一次调用变成
      // "第二次"，等于用"我们能用"换"页面上所有链接坏掉"。宁可我们哑（下面会发声），
      // 也不能把 PDF 页面本身搞坏。
      if (globalThis.acquireVsCodeApi === acquireOnce) vscode = acquireOnce();
    }
  } catch {
    vscode = null;
  }

  const post = (message) => {
    if (vscode) vscode.postMessage(message);
  };

  const OVERLAY_ID = 'anchor-select-overlay';
  const BAND_ID = 'anchor-select-band';
  const FAULT_ID = 'anchor-select-fault';
  const FLASH_ID = 'anchor-select-flash';

  /** 闪现框活多久（毫秒）。够看清位置、又不到"赖在屏幕上"的程度（D76）。 */
  const FLASH_MS = 2000;

  /** 框选模式是否开着。**默认关**：不给页面添任何默认行为。 */
  let active = false;
  /** 按住指针时的起点（屏幕坐标） */
  let origin = null;
  let overlay = null;
  let band = null;
  /** 闪现框（D76）。同一时刻只留一个：新的来了先收旧的。 */
  let flash = null;

  function ensureStyles() {
    if (document.getElementById('anchor-select-style')) return;
    const style = document.createElement('style');
    style.id = 'anchor-select-style';
    style.textContent = [
      // 平时不参与事件流：不拦滚动、不拦缩放、不拦文字选择
      '#anchor-select-overlay{position:fixed;inset:0;z-index:2147483000;display:none;cursor:crosshair;background:transparent}',
      '#anchor-select-overlay.anchor-active{display:block}',
      // 橡皮筋：只在按住期间存在。用 dashed 边框而不是填充色，是为了不遮住下面的字
      '#anchor-select-band{position:fixed;z-index:2147483001;display:none;pointer-events:none;border:1px dashed var(--vscode-focusBorder,#0a84ff);background:color-mix(in srgb, var(--vscode-focusBorder,#0a84ff) 12%, transparent)}',
      '#anchor-select-band.anchor-active{display:block}',
      // 闪现框（D76）：回答"讲的是页内哪一块"。**只在你点某一步时出现、到点自己消失**，
      // 自动播放/推进时一个框都不会出现 —— 这是放宽后的约束 1（不许常驻/自动的框）。
      // 配色跟橡皮筋同一族（不是同一个元素），这样用户能看出"这是刚才那个框选的地方"。
      '#anchor-select-flash{position:fixed;z-index:2147482999;display:none;pointer-events:none;border:2px solid var(--vscode-focusBorder,#0a84ff);background:color-mix(in srgb, var(--vscode-focusBorder,#0a84ff) 14%, transparent);border-radius:2px;box-shadow:0 0 0 1px rgba(0,0,0,.25), 0 0 12px rgba(10,132,255,.35)}',
      '#anchor-select-flash.anchor-active{display:block}',
      // 故障说明（D73）：postMessage 那条通道不存在时，这句是页面上唯一还能说话的出口。
      // 复用 VS Code 自己的报错配色，不另发明一套视觉语言。
      '#anchor-select-fault{position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:2147483002;max-width:78%;padding:10px 14px;border-radius:6px;font:13px/1.5 var(--vscode-font-family,sans-serif);color:var(--vscode-inputValidation-errorForeground,#fff);background:var(--vscode-inputValidation-errorBackground,#7a1f1f);border:1px solid var(--vscode-inputValidation-errorBorder,#be1100);box-shadow:0 2px 8px rgba(0,0,0,.4)}',
    ].join('\n');
    document.head.appendChild(style);
  }

  /**
   * 拿不到 VS Code API 时，在页面上说一句（D61~D73 反复出现的同一条：**失败必须发声**）。
   *
   * @anchor 为什么这里必须由注入脚本来喊：没有 API 就没有 postMessage，宿主那边只会一直
   *         等一个永远不来的 `anchor:ready`。用户按下框选后什么都没发生时，至少要知道
   *         是"这里坏了"而不是"我操作不对"。只在用户真的要框选时才出现，平时不给 PDF 页面
   *         添任何东西（约束 1 的精神）。不退隐：会自己消失的报错等于没报错。
   */
  function showFault() {
    if (document.getElementById(FAULT_ID)) return;
    ensureStyles();
    const node = document.createElement('div');
    node.id = FAULT_ID;
    node.classList.add('anchor-fault');
    node.textContent =
      'Anchor：这份 PDF 页面里的框选脚本拿不到 VS Code 接口，框选暂时用不了。' +
      '请把这份 PDF 关掉重新打开；若仍然如此，请在「帮助 → 切换开发人员工具 → Console」里看报错。';
    document.body.appendChild(node);
  }

  function ensureNodes() {
    ensureStyles();
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.setAttribute('aria-hidden', 'true');
      document.body.appendChild(overlay);
    }
    if (!band) {
      band = document.createElement('div');
      band.id = BAND_ID;
      band.setAttribute('aria-hidden', 'true');
      document.body.appendChild(band);
    }
  }

  /** 把屏幕上可见的页全部报出来。选择器是 pdf.js 自己的 `data-page-number`，没有改它。 */
  function visiblePages() {
    const out = [];
    const nodes = document.querySelectorAll('#viewer .page[data-page-number], .pdfViewer .page[data-page-number]');
    for (const node of nodes) {
      const page = Number(node.getAttribute('data-page-number'));
      if (!Number.isInteger(page) || page < 1) continue;
      // 底下的 canvas 才是纸面；page 容器可能带 padding，按 canvas 算才准
      const target = node.querySelector('.canvasWrapper') || node;
      const r = target.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      out.push({ page, rect: { x: r.left, y: r.top, width: r.width, height: r.height } });
    }
    return out;
  }

  function normalizeRect(a, b) {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    };
  }

  /** 把橡皮筋挪到当前矩形上（只在按住期间调用） */
  function paint(dragged) {
    if (!band) return;
    band.classList.add('anchor-active');
    band.style.left = `${dragged.x}px`;
    band.style.top = `${dragged.y}px`;
    band.style.width = `${dragged.width}px`;
    band.style.height = `${dragged.height}px`;
  }

  /** 清掉橡皮筋。**所有出口都必须走这里**（约束 1：退出后不留任何东西）。 */
  function clearBand() {
    origin = null;
    if (band) {
      band.classList.remove('anchor-active');
      band.style.width = '0px';
      band.style.height = '0px';
    }
  }

  function exitSelectMode() {
    active = false;
    clearBand();
    if (overlay) overlay.classList.remove('anchor-active');
  }

  // ── 定位与"闪一下那一块"（S6 补 / D76）────────────────────────────────────────

  /** 把视图滚到第 N 页。pdf.js 自己的 API，没有改它。 */
  function scrollToPage(page) {
    const app = window.PDFViewerApplication;
    if (app && app.pdfViewer) app.pdfViewer.currentPageNumber = page;
  }

  /**
   * 第 N 页的纸面矩形（屏幕坐标）；这一页还没渲染出来就返回 null。
   * 与 `visiblePages` 用同一个"纸面"判据：`.canvasWrapper` 优先 —— page 容器可能带 padding。
   */
  function pageRectOf(page) {
    const nodes = document.querySelectorAll('#viewer .page[data-page-number], .pdfViewer .page[data-page-number]');
    for (const node of nodes) {
      if (Number(node.getAttribute('data-page-number')) !== page) continue;
      const target = node.querySelector('.canvasWrapper') || node;
      const r = target.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    }
    return null;
  }

  /**
   * 归一化 bbox → 屏幕矩形。**这是 `src/anchor/rectToNormalizedBBox.ts` 的逆运算**。
   *
   * @anchor 为什么这条"业务数学"可以留在注入脚本里（别的都留在有单测的宿主那边）：
   *         它是**正向换算的逆**，而正向那份有单测（`rectToNormalizedBBox`）。
   *         所以它的正确性由夹具**往返校验**钉住：用正向函数把一块像素换算成 bbox，
   *         再让脚本反过来画，画出来的矩形应当就是当初那块像素（`test/anchorSelectClient.test.ts`）。
   *         写成别的形式（比如自己去算缩放比例）就没有这条保证了 —— 别加新判据。
   */
  function bboxToRect(bbox, pageRect) {
    const x1 = pageRect.x + bbox[0] * pageRect.width;
    const y1 = pageRect.y + bbox[1] * pageRect.height;
    const x2 = pageRect.x + bbox[2] * pageRect.width;
    const y2 = pageRect.y + bbox[3] * pageRect.height;
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  /** 消息里的 bbox 也不可信（webview 里的任何东西都能往这条通道灌）。与宿主守卫同一套判据。 */
  function readBBox(raw) {
    if (!Array.isArray(raw) || raw.length !== 4) return null;
    const out = [];
    for (const n of raw) {
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) return null;
      out.push(n);
    }
    return out[0] < out[2] && out[1] < out[3] ? out : null;
  }

  function hideFlash() {
    if (!flash) return;
    flash.classList.remove('anchor-active');
    if (flash.parentNode) flash.parentNode.removeChild(flash);
    flash = null;
  }

  /**
   * 滚到那一页，并在那块区域上闪现一个框，到点自己消失（D76）。
   *
   * @anchor 两条刻意的做法：
   *         1. **位置每帧重算**：pdf.js 的滚动是平滑的，用户也可能在闪的这一两秒里自己滚 ——
   *            画一次就不管，框会留在原地骗人。所以只要它还在屏幕上，就跟着页面走。
   *         2. **页还没渲染出来就不画**（`pageRectOf` 返回 null）：宁可不闪，也不闪错地方 ——
   *            屏幕上"看起来很确定的假框"比没有框更坏（D69 那条教训）。
   */
  function flashRegion(page, bbox, ms) {
    ensureStyles();
    hideFlash();

    const first = pageRectOf(page);
    if (!first) return;

    flash = document.createElement('div');
    flash.id = FLASH_ID;
    flash.setAttribute('aria-hidden', 'true');
    document.body.appendChild(flash);

    let stopped = false;
    const paint = () => {
      if (stopped || !flash) return;
      const rect = pageRectOf(page);
      if (!rect) return; // 这一页滚出去了：这一帧不画，等它回来
      const box = bboxToRect(bbox, rect);
      flash.classList.add('anchor-active');
      flash.style.left = `${box.x}px`;
      flash.style.top = `${box.y}px`;
      flash.style.width = `${box.width}px`;
      flash.style.height = `${box.height}px`;
      schedule(paint);
    };
    paint();

    setTimeout(() => {
      stopped = true;
      hideFlash();
    }, Math.max(300, Math.min(10000, Number.isFinite(ms) && ms > 0 ? ms : FLASH_MS)));
  }

  /** `requestAnimationFrame` 在 webview 里有；没有就退化成 16ms 的定时器（夹具里走这条）。 */
  function schedule(fn) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
    else setTimeout(fn, 16);
  }

  function enterSelectMode() {
    ensureNodes();
    active = true;
    clearBand();
    if (overlay) overlay.classList.add('anchor-active');
    // 进得来却报不回去 = 用户拖完一场空。这种时候在页面上把话说清，别让他以为是自己没拖对。
    if (!vscode) showFault();
  }

  function onPointerDown(event) {
    if (!active || event.button !== 0) return;
    event.preventDefault();
    origin = { x: event.clientX, y: event.clientY };
    paint({ x: origin.x, y: origin.y, width: 0, height: 0 });
  }

  function onPointerMove(event) {
    if (!active || !origin) return;
    event.preventDefault();
    paint(normalizeRect(origin, { x: event.clientX, y: event.clientY }));
  }

  function onPointerUp(event) {
    if (!active || !origin) return;
    event.preventDefault();

    const dragged = normalizeRect(origin, { x: event.clientX, y: event.clientY });
    const pages = visiblePages();
    clearBand();
    exitSelectMode();

    // 像素太小当误触：抬手抖两下不该产出一个锚点。
    // 阈值放在这里而不是宿主，因为"什么算误触"是手势问题，与位置数学无关。
    if (dragged.width < 6 || dragged.height < 6 || pages.length === 0) {
      post({ type: 'anchor:cancelled' });
      return;
    }

    const hit = pickDominantPageInScript(dragged, pages);
    if (!hit) {
      post({ type: 'anchor:cancelled' });
      return;
    }

    // bbox 在这里算一遍只是为了满足 §5.2 的冻结形状；**宿主会用 geometry 自己重算一遍**
    // （见 bridge.ts 里 CapturedGeometry 的注释）。这里算错不影响结果，只是让老式宿主也能用。
    post({
      type: 'anchor:captured',
      page: hit.page,
      bbox: clampRectToPage(dragged, hit.rect),
      geometry: { dragged, pages },
    });
  }

  /**
   * 与 `src/anchor/rectToNormalizedBBox.ts` 的 `pickDominantPage` 同一个判据：
   * 交叠面积最大的那一页。**这份是给宿主兜底的副本**，别在这里加新判据 ——
   * 加之前先问"为什么不能放进那个有单测的文件"。
   */
  function pickDominantPageInScript(dragged, pages) {
    let best = null;
    for (const candidate of pages) {
      const x1 = Math.max(dragged.x, candidate.rect.x);
      const y1 = Math.max(dragged.y, candidate.rect.y);
      const x2 = Math.min(dragged.x + dragged.width, candidate.rect.x + candidate.rect.width);
      const y2 = Math.min(dragged.y + dragged.height, candidate.rect.y + candidate.rect.height);
      const overlap = (x2 - x1) * (y2 - y1);
      // `Number.isFinite(overlap)` 这一条与 `rectToNormalizedBBox.ts` 的 `intersectRects` 同一语义：
      // 算不出交叠（页容器尺寸是 0 / 读到了 undefined）就当**没相交**，宁可什么都不选。
      // 少了它，NaN 会顺着 `overlap > best.overlap` 一路赢下来，产出一个 [0,0,0,0] 的框 ——
      // 宿主守门会把它静默丢掉，用户看到的是"拖了、没反应"。
      if (!Number.isFinite(overlap) || overlap <= 0) continue;
      if (!best || overlap > best.overlap) best = { page: candidate.page, rect: candidate.rect, overlap };
    }
    return best;
  }

  function clampRectToPage(dragged, pageRect) {
    const x1 = Math.max(dragged.x, pageRect.x);
    const y1 = Math.max(dragged.y, pageRect.y);
    const x2 = Math.min(dragged.x + dragged.width, pageRect.x + pageRect.width);
    const y2 = Math.min(dragged.y + dragged.height, pageRect.y + pageRect.height);
    const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
    return [
      clamp01((x1 - pageRect.x) / pageRect.width),
      clamp01((y1 - pageRect.y) / pageRect.height),
      clamp01((x2 - pageRect.x) / pageRect.width),
      clamp01((y2 - pageRect.y) / pageRect.height),
    ];
  }

  function onKeyDown(event) {
    if (!active) return;
    if (event.key !== 'Escape') return;
    event.preventDefault();
    // 用捕获阶段并 stopPropagation：pdf.js 自己也监听 Escape（关侧栏/退出演示），
    // 框选模式下这个键的含义必须只有"取消框选"。
    event.stopPropagation();
    clearBand();
    exitSelectMode();
    post({ type: 'anchor:cancelled' });
  }

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('keydown', onKeyDown, true);
  // 指针离开窗口（拖到浏览器外松手）也要收干净，否则橡皮筋会留在屏幕上
  window.addEventListener('blur', () => {
    if (active) {
      clearBand();
      exitSelectMode();
      post({ type: 'anchor:cancelled' });
    }
  });

  // §5.2 的宿主 → 注入脚本三个消息。用 `type` 区分，
  // 与上游 main.mjs 用的 `{action: "reload"}` 互不干扰（两个监听器各看各的字段）。
  window.addEventListener('message', (event) => {
    if (event.origin !== window.origin) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;

    switch (data.type) {
      case 'anchor:enterSelectMode':
        enterSelectMode();
        break;
      case 'anchor:exitSelectMode':
        exitSelectMode();
        break;
      case 'anchor:gotoPage': {
        const page = Number(data.page);
        if (!Number.isInteger(page) || page < 1) return;
        // 滚动，不画框（约束 1 / S6 的"点击滚动定位"）。pdf.js 自己的 API，没有改它。
        scrollToPage(page);
        break;
      }
      case 'anchor:flashRegion': {
        // S6 补（D76）：滚到那一页 + 在那块区域闪现一个框，到点自己消失。
        // 只由"用户点了某一步"触发（宿主那边只有 revealStep 会发这条），自动播放不发。
        const page = Number(data.page);
        if (!Number.isInteger(page) || page < 1) return;
        const bbox = readBBox(data.bbox);
        if (!bbox) return;
        scrollToPage(page);
        flashRegion(page, bbox, Number(data.ms));
        break;
      }
      default:
        break;
    }
  });

  // 告诉宿主脚本活了。宿主可能在脚本加载前就发过 enterSelectMode（面板刚建、页面还在加载），
  // 所以这条握手是必要的 —— 宿主收到它会补发一次。
  post({ type: 'anchor:ready' });
})();
