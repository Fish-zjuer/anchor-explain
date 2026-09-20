/**
 * 生成块流视图（相册）的完整 HTML。样式与客户端脚本**内联**（同侧边栏的理由，见 styles.ts）。
 *
 * @anchor 三处与侧边栏不同、又必须写清的：
 *
 *   1. **CSP 要多放行一个 `img-src`**：图块的裁剪图是宿主裁好之后以 dataURL 喂进来的，
 *      侧边栏不需要图片所以那边一个口子都不开；这里不给 `img-src ${cspSource} data:`
 *      的话，所有图块都会**静默变成空白**（CSP 违规不抛错，只在控制台里躺着）。
 *   2. **块正文必须转义**：文字是从 PDF 抽出来的**不可信内容**，里面完全可能有 `<`
 *      （数学文档里的 `<` 到处都是）。不转义就是一个注入点。
 *   3. **每块是一个"等大的砖"**（用户给的相册参照）：缩略图（正文片段或裁剪图）+ 底部一条
 *      （页码/属性，悬停或选中才显）+ 右上角那个灰半透明粗体数字。
 *      正文**给 tooltip 全文** —— "不一定展示完全内容"不等于"看不到完整内容"。
 *      这一层 DOM 到此为止：D106~D114 那七轮立体（孔口/底面/坑壁/玻璃）在 D115 全删了，
 *      用户的原话是"那都去掉吧，只留相册设计"。
 *
 * `cspSource` 由调用方传入，本函数因此不 import 'vscode'，可脱离宿主直测（同侧边栏）。
 */

import { randomBytes } from 'node:crypto';
import { BLOCK_VIEW_STYLES } from './styles.ts';
import { BLOCK_VIEW_CLIENT_SCRIPT } from './clientScript.ts';
import type { BlockView, BlockCard } from './model.ts';

export interface BlockStreamView {
  /** 抬头那份文档的名字 */
  docLabel: string;
  /** 抬头右边那句统计（`cardsSummary` 给的） */
  summary: string;
  /** 相册里的砖（`blockViewOf` 给的） */
  view: BlockView;
  /** 底部那行：顺序的一句话（`describeOrder` 给的） */
  orderText: string;
  /** 已选块数（底部计数与按钮禁用态） */
  queued: number;
}

/** 块正文是**不可信内容**（从 PDF 里抽出来的），一律转义 */
export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** tooltip 全文：太长就截断（悬停提示不该是一整页） */
function tooltipOf(card: BlockCard, zh: boolean): string {
  const position =
    card.badge !== undefined
      ? zh ? `第 ${card.badge} 个发出` : `sends #${card.badge}`
      : zh ? `加进去会是第 ${card.preview ?? '?'} 个` : `would send #${card.preview ?? '?'}`;
  const head = `${card.pageLabel} · ${position}`;
  if (card.text.trim() === '') return head;
  const limit = 600;
  const clip = card.text.length > limit ? `${card.text.slice(0, limit)}…` : card.text;
  return `${head}\n\n${clip}`;
}

function thumbOf(card: BlockCard, zh: boolean): string {
  if (card.kind === 'image') {
    const figure =
      card.imageUrl === undefined
        ? `<div class="thumb-placeholder">${zh ? '图（本次未带像素）' : 'figure (no pixels)'}</div>`
        : `<img class="thumb-img" src="${esc(card.imageUrl)}" alt="${zh ? '图块' : 'figure'}" draggable="false">`;
    return figure;
  }
  if (card.empty) return `<div class="thumb-text">${zh ? '（空块）' : '(empty)'}</div>`;

  const parts = card.partTexts.length > 0 ? card.partTexts : [card.text];
  const seam = '<div class="seam"></div>';
  return parts
    .map((part) => `<div class="thumb-text">${esc(part)}</div>`)
    .join(card.multiPage ? seam : '');
}

function cardHtml(card: BlockCard, zh: boolean): string {
  const cls = [
    'card',
    `kind-${card.kind}`,
    card.badge !== undefined ? 'selected' : '',
    card.grouped ? 'grouped' : '',
    card.empty ? 'empty' : '',
  ]
    .filter((c) => c !== '')
    .join(' ');

  const marks = [
    card.multiPage ? `<span class="mark">${zh ? '跨页' : '2 pages'}</span>` : '',
    card.kind === 'heading' ? `<span class="mark">${zh ? '标题' : 'heading'}</span>` : '',
    card.grouped ? `<span class="mark">${zh ? '表' : 'table'}</span>` : '',
  ].join('');

  // 点击热区是**整块**；这颗按钮是状态指示（悬停显预览位次、选中显发送位次），不是唯一入口
  const action = `<button class="card-action" type="button" aria-pressed="${card.badge !== undefined}"
      aria-label="${esc(zh ? '选入队列' : 'add to queue')}"
      ><span class="plus">＋</span><span class="badge" data-pos="${card.badge ?? ''}" data-preview="${card.preview ?? ''}"></span></button>`;

  // 一张卡就是**一层内容 + 一条底栏 + 一颗数字**（D115：那七轮立体的
  // `.window/.plane/.wall-*/.glass` 四层全删了 —— 用户"只留相册设计"）。
  // 缩略图不必完整（底部渐隐），全文在 title 上。
  return `<article class="${cls}" data-block="${esc(card.blockId)}" title="${esc(tooltipOf(card, zh))}">
<div class="thumb">${thumbOf(card, zh)}</div>
<div class="card-bar"><span class="page">${esc(card.pageLabel)}</span>${marks}</div>
${action}
</article>`;
}

export function renderBlockStreamHtml(
  cspSource: string,
  view: BlockStreamView,
  fontScale = 1,
  language: 'zh' | 'en' = 'zh',
): string {
  const zh = language !== 'en';
  const nonce = randomBytes(16).toString('base64');
  const csp = [
    "default-src 'none'",
    `style-src ${cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    // 图块裁剪图是 dataURL —— 不开这个口子，所有图都会静默空白
    `img-src ${cspSource} data:`,
  ].join('; ');

  const foot = `<div class="stream-foot">
<span class="count">${esc(view.queued === 0 ? (zh ? '还没选块 · 点块即入选，按住拖过几块连选' : 'nothing selected · click to add, drag to select a run') : zh ? `已选 ${view.queued} 块` : `${view.queued} selected`)}</span>
<span class="spacer"></span>
<button class="action" type="button" data-action="mode">${esc(view.orderText)}</button>
<button class="action" type="button" data-action="clear"${view.queued === 0 ? ' disabled' : ''}>${zh ? '清空' : 'Clear'}</button>
<button class="action primary" type="button" data-action="ask"${view.queued === 0 ? ' disabled' : ''}>${zh ? '问 AI' : 'Ask AI'}</button>
</div>`;

  return `<!DOCTYPE html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${zh ? 'Anchor 块流' : 'Anchor blocks'}</title>
<style nonce="${nonce}">${BLOCK_VIEW_STYLES}</style>
</head>
<body>
<div id="root">
<div class="stream-head"><span class="doc">${esc(view.docLabel)}</span><span class="summary">${esc(view.summary)}</span></div>
<div class="stream">${view.view.cards.map((c) => cardHtml(c, zh)).join('\n')}</div>
${foot}
</div>
<script nonce="${nonce}">var ANCHOR_FONT_SCALE = ${JSON.stringify(fontScale)};</script>
<script nonce="${nonce}">${BLOCK_VIEW_CLIENT_SCRIPT}</script>
</body>
</html>`;
}
