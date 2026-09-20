/**
 * 拆块主管线：SplitInput → BlockStream。
 *
 * @anchor 五步的顺序是刻意排的：行 → 分栏 → 成块（每栏）→ 页内阅读序 → 跨页缝合。
 *         前四步都在"一页"的视野里，只有缝合需要全文档 —— 所以它最后、也只做一次。
 *         输入是纯数据（归一化坐标的项），谁抽的项、怎么抽的，引擎不关心。
 *
 * 本文件零依赖。
 */

import { linesOf } from './lines.ts';
import { detectColumns } from './columns.ts';
import { blocksOfColumn, makeBlock, dropFurniture } from './blocks.ts';
import { orderPage } from './order.ts';
import { stitchPages } from './stitch.ts';
import { blockId } from './ids.ts';
import type { Block, PageImageIn, SplitInput, BlockStream } from './types.ts';

function imageBlock(docId: string | undefined, image: PageImageIn): Block {
  const parts = [{ page: image.page, bbox: image.bbox }];
  return { id: blockId(docId, parts, 'image'), kind: 'image', text: '', parts, partTexts: [''] };
}

/** 拆一份文档。`docId` 给了，块 ID 就带文档维度（多文档共享存储时不串） */
export function splitDocument(input: SplitInput): BlockStream {
  const docId = input.docId;
  const blocks: Block[] = [];

  for (const page of input.pages) {
    const lines = linesOf(page);
    if (lines.length === 0) continue;
    const layout = detectColumns(lines);
    const leftBlocks = blocksOfColumn(docId, layout.left);
    const rightBlocks = blocksOfColumn(docId, layout.right);
    // 通栏行（跨沟标题/图注）也走同一套成块逻辑 —— 它们按 y 排，天然成段
    const spannerBlocks = blocksOfColumn(docId, layout.spanners);
    const imageBlocks = (input.images ?? []).filter((im) => im.page === page.page).map((im) => imageBlock(docId, im));
    blocks.push(...orderPage(leftBlocks, rightBlocks, [...spannerBlocks, ...imageBlocks], layout.colCount === 2));
  }

  // 带文字的页脚/书眉（"XX Press — PAGE 12"）是"同模板每页重复"，只有全文档视野能认出它们。
  // **必须在缝合之前剔**：页脚在每页末尾，先缝的话它会和下一页的正文拼成一块，
  // 之后再剔就把正文一起扔了（单测里抓到的顺序事故）。
  const cleaned = dropFurniture({
    ...(docId !== undefined ? { docId } : {}),
    pageCount: input.pages.length,
    blocks,
  });
  const stitched = stitchPages(docId, cleaned.blocks);
  return { ...cleaned, blocks: stitched };
}
