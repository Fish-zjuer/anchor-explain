/**
 * 块流视图的**视图模型**（D101）：块流 + 队列 → 卡片数组。
 *
 * @anchor 为什么单独一层：卡片上"第 3–4 页""徽标 2""悬停预览 5"这些数字
 *         **必须与发出去的稿子、队列面板完全一致**（约束 107），而 DOM 行为在
 *         这个仓库里没有自动化覆盖（已知缺口 1）。把数字算在纯函数里，
 *         至少让"号码对不对"这件事能被 node --test 盯住，DOM 只管画。
 *
 * 图注归并**共用 `unitsOf`**（重排器那一份）—— 两处各写一遍判据必然分家，
 * 分家的后果就是"卡片上是 3 号、发出去的 3 号却是另一段"。
 *
 * 本文件不 import 'vscode'，可脱离宿主直测。
 */

import { badgeNumbers, previewPosition, unitsOf, captionTextOf } from '@anchor/pdf-blocks';
import type { Block, BlockIndex, BlockKind, BlockQueue } from '@anchor/pdf-blocks';

export interface BlockCard {
  blockId: string;
  kind: BlockKind;
  /** 文本块的正文（**提取好的文字**，不是截图 —— 这就是拆块要换来的东西） */
  text: string;
  /**
   * 每一页一段正文。跨页块（一段话被分页截断）在这里有 **两段**，
   * 卡片上按"接缝"分开渲染 —— 用户要的"一次选中在两个页渲染"就落在这里。
   */
  partTexts: readonly string[];
  /** 图块：裁剪图（宿主从页面栅格裁出来喂进来；没有就渲染占位，不假装有） */
  imageUrl?: string;
  /** 块没有正文也没有图（空壳）—— 渲染成薄薄一条，不占大版面 */
  empty: boolean;
  /** 页码标签：单页 `第 3 页`，跨页 `第 3–4 页` */
  pageLabel: string;
  /** 跨页块（parts 落在两页或以上） */
  multiPage: boolean;
  /** 已入队 → **发送位次**（1-based）；未入队为 undefined */
  badge?: number;
  /** 未入队 → 现在加进去会是第几（悬停时显示）；已入队为 undefined */
  preview?: number;
  /** 组内归并来的（表格/清单/代码段）：视觉上标一下，提示这是引擎合过的 */
  grouped: boolean;
  /** 跨页缝合来的：卡片上带"接缝"标记 */
  stitched: boolean;
  /** 被并进这张卡的图注块 ID（宿主据此清理队列里的旧引用） */
  captionId?: string;
}

export interface BlockView {
  cards: readonly BlockCard[];
  /**
   * 队列里存着、但**已经被并进别的块**的 ID（当前唯一来路：图注并进图块）。
   * 值是被并进去的那张卡的 `blockId` —— 宿主应当把队列里的它改写成这个 ID。
   *
   * 为什么必须报出来：不报的话，用户选的那一项在界面上**没有任何痕迹**
   * （徽标算在宿主块身上），而"选中了却看不见反馈"正是 D81 那条踩过的坑。
   */
  folded: ReadonlyMap<string, string>;
  /**
   * 队列里存在、但在**这份块流里根本找不到**的 ID（来自另一份文档，或块已被删）。
   * 宿主应当清掉并说一声 —— 沉默地留着它，发稿子时才发现少了东西。
   */
  orphans: readonly string[];
}

export interface CardsOptions {
  /** 图块裁剪图：块 ID → dataURL。宿主查表；查不到就走占位 */
  images?: ReadonlyMap<string, string>;
}

function pageLabelOf(block: Block): string {
  const pages = [...new Set(block.parts.map((p) => p.page))].sort((a, b) => a - b);
  const first = pages[0] ?? 1;
  const last = pages.at(-1) ?? first;
  return first === last ? `第 ${first} 页` : `第 ${first}–${last} 页`;
}

/** 块流 → 卡片流。顺序**照原样**（阅读序由调用方保证），不在这里排序 */
export function blockViewOf(
  blocks: readonly Block[],
  queue: BlockQueue,
  index: BlockIndex,
  opts: CardsOptions = {},
): BlockView {
  const badges = badgeNumbers(queue, index);
  const cards: BlockCard[] = [];
  const shown = new Set<string>();
  const folded = new Map<string, string>();

  for (const unit of unitsOf(blocks)) {
    const block = unit.block;
    const captionText = captionTextOf(unit);
    // 图块的正文就是它的图注（图注块本身不再单独成卡，与重排稿的编号一致）
    const text = block.kind === 'image' ? (captionText ?? '') : block.text;
    // 队列里存的可能是被并掉的那个图注 ID —— 位次要折到宿主块头上，
    // 否则用户选过的东西在界面上一个痕迹都没有
    const badge = badges.get(block.id) ?? (unit.caption !== undefined ? badges.get(unit.caption.id) : undefined);
    const card: BlockCard = {
      blockId: block.id,
      kind: block.kind,
      text,
      partTexts: block.kind === 'image' ? [text] : (block.partTexts ?? [block.text]),
      empty: block.text.trim() === '' && block.kind !== 'image',
      pageLabel: pageLabelOf(block),
      multiPage: new Set(block.parts.map((p) => p.page)).size > 1,
      grouped: block.grouped === true,
      stitched: block.stitched === true,
    };
    if (badge !== undefined) card.badge = badge;
    else card.preview = previewPosition(queue, index, block.id);
    const url = opts.images?.get(block.id);
    if (url !== undefined) card.imageUrl = url;
    if (unit.caption !== undefined) {
      card.captionId = unit.caption.id;
      folded.set(unit.caption.id, block.id);
    }
    shown.add(block.id);
    cards.push(card);
  }

  const orphans = queue.picked.filter((id) => !shown.has(id) && !folded.has(id));
  return { cards, folded, orphans };
}

/** 卡片流的一句话统计（视图顶部那条；顺序那句话由 `describeOrder` 给） */
export function cardsSummary(view: BlockView, queued: number, orderText: string): string {
  const images = view.cards.filter((c) => c.kind === 'image').length;
  const multi = view.cards.filter((c) => c.multiPage).length;
  const parts = [`${view.cards.length} 块`];
  if (images > 0) parts.push(`图 ${images}`);
  if (multi > 0) parts.push(`跨页 ${multi}`);
  parts.push(queued === 0 ? '还没选' : `已选 ${queued}`);
  parts.push(orderText);
  return parts.join(' · ');
}
