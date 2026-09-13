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
 *   2. **只在框选模式里拦事件**。平时 overlay 完全不参与事件流，
 *      pdf.js 的滚动、缩放、文字选择、链接点击一个都不受影响。
 *   3. 报给宿主的消息形状由 `CONTRACTS` §5.2 冻结，本文件不许自行发明字段。
 */

(() => {
  'use strict';

  // acquireVsCodeApi 只能调用一次。上游的 assets/main.mjs 没有调它，
  // 所以这里正常能拿到；万一将来上游也调了，我们退化成"功能不可用"而不是整个页面报错。
  let vscode = null;
  try {
    vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  } catch {
    vscode = null;
  }

  const post = (message) => {
    if (vscode) vscode.postMessage(message);
  };

  const OVERLAY_ID = 'anchor-select-overlay';
  const BAND_ID = 'anchor-select-band';

  /** 框选模式是否开着。**默认关**：不给页面添任何默认行为。 */
  let active = false;
  /** 按住指针时的起点（屏幕坐标） */
  let origin = null;
  let overlay = null;
  let band = null;

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
    ].join('\n');
    document.head.appendChild(style);
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

  function enterSelectMode() {
    ensureNodes();
    active = true;
    clearBand();
    if (overlay) overlay.classList.add('anchor-active');
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
      if (x2 <= x1 || y2 <= y1) continue;
      const overlap = (x2 - x1) * (y2 - y1);
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
        const app = window.PDFViewerApplication;
        if (app && app.pdfViewer) app.pdfViewer.currentPageNumber = page;
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
