/**
 * 拆块主管线：SplitInput → BlockStream。
 *
 * @anchor 顺序是刻意排的，而且**顺序本身就是两次实测返工的结果**：
 *
 *   **第一遍（几何）**：文字项 →（`partitionItems` 按 item 左边缘切栏）→ 栏内成行。
 *   切栏必须最先做：栏沟可能比栏内某个间隙还窄（ACM 双栏论文实测沟宽 0.02 ≈ 1.7×行高，
 *   而"把一行拼完整"的容差是 2.5×行高）。第一版是"先成行、再从行投影找栏沟"，
 *   于是两栏被并进一行、**75% 的正文变成两栏交错的乱序**（P0）。
 *
 *   **第二遍（成块）**：全文档的行先过一道**页眉页脚掩码**（`markFurnitureLines`），
 *   再按栏成块。掩码必须在成块之前：页脚就在段落下方，段落归并会把它们并进同一块，
 *   之后不删则页脚混进正文、删掉则正文一起没了（单测里 4 块全被删光的那次）。
 *
 *   收尾三步也在缝合之前：连续短行归并（表格/清单/代码段各归一块）→ 块级兜底过滤 → 跨页缝合。
 *   先缝的话页脚会和下一页正文拼成一块（早期抓到的顺序事故）。
 *
 * 本文件零依赖。
 */

import { formLines } from './lines.ts';
import type { Line } from './lines.ts';
import { partitionItems, detectColumns } from './columns.ts';
import { blocksOfColumn, makeBlock, dropFurniture, groupRuns, estimateLineHeight, markFurnitureLines } from './blocks.ts';
import { orderPage } from './order.ts';
import { stitchPages } from './stitch.ts';
import { blockId } from './ids.ts';
import type { Block, PageImageIn, SplitInput, BlockStream, TextItemIn } from './types.ts';

function imageBlock(docId: string | undefined, image: PageImageIn): Block {
  const parts = [{ page: image.page, bbox: image.bbox }];
  return { id: blockId(docId, parts, 'image'), kind: 'image', text: '', parts, partTexts: [''] };
}

/** 一页的几何：切栏 + 各栏成行（**不做块**，块要等文档级掩码之后） */
interface PageGeometry {
  page: number;
  twoColumn: boolean;
  left: Line[];
  right: Line[];
  spanners: Line[];
}

function geometryOf(page: number, items: readonly TextItemIn[]): PageGeometry {
  if (items.length === 0) return { page, twoColumn: false, left: [], right: [], spanners: [] };
  const parts = partitionItems(items);
  if (parts.colCount === 2) {
    return {
      page,
      twoColumn: true,
      left: formLines(page, parts.left),
      right: formLines(page, parts.right),
      spanners: formLines(page, parts.spanners),
    };
  }
  // 兜底：判不出双栏就按单栏走（行级投影再试一次，主路径的紧栏沟问题在这里不会出现，
  // 因为 partitionItems 已经排除掉了"确实是双栏"的情况）
  const lines = formLines(page, items);
  const layout = detectColumns(lines);
  return { page, twoColumn: layout.colCount === 2, left: layout.left, right: layout.right, spanners: layout.spanners };
}

/** 拆一份文档。`docId` 给了，块 ID 就带文档维度（多文档共享存储时不串） */
export function splitDocument(input: SplitInput): BlockStream {
  const docId = input.docId;
  const geometry = input.pages.map((p) => geometryOf(p.page, p.items));

  // 文档级页眉页脚掩码（行级）—— 必须早于成块，理由见文件头
  const allLines = geometry.flatMap((g) => [...g.left, ...g.right, ...g.spanners]);
  const furniture = markFurnitureLines(allLines);
  const keep = (lines: readonly Line[]): Line[] => lines.filter((l) => !furniture.has(l));

  const blocks: Block[] = [];
  for (const g of geometry) {
    const left = blocksOfColumn(docId, keep(g.left));
    const right = blocksOfColumn(docId, keep(g.right));
    const spanners = blocksOfColumn(docId, keep(g.spanners));
    const images = (input.images ?? []).filter((im) => im.page === g.page).map((im) => imageBlock(docId, im));
    blocks.push(...orderPage(left, right, [...spanners, ...images], g.twoColumn));
  }

  const lineH = estimateLineHeight(blocks);
  const grouped = groupRuns(docId, blocks, lineH);
  const cleaned = dropFurniture({
    ...(docId !== undefined ? { docId } : {}),
    pageCount: input.pages.length,
    blocks: grouped,
  });
  return { ...cleaned, blocks: stitchPages(docId, cleaned.blocks) };
}

export { makeBlock };
