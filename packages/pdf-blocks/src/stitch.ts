/**
 * 第五步：跨页缝合。
 *
 * @anchor 教材/论文的一段话被分页拦腰截断，是"块必须完整"最大的敌人。判据刻意保守：
 *   1. 前块是正文（标题、图块不缝）；
 *   2. 前块**末尾没有句末标点** —— 一句话没说完；
 *   3. 后块以小写字母或 CJK 字符开头 —— 英文大写开头多半是新段/新标题，
 *      中文没有大小写，只靠第 2 条；
 *   4. 后块不是列表起点。
 *   四条全中才缝。误缝的代价（两段被连在一起）比漏缝的代价（一段被读成两截）小，
 *   且 `unstitch` 是一键手修 —— 所以这里宁可保守。
 *
 * 本文件零依赖。
 */

import { BULLET_START, TERMINAL, joinBlockText } from './blocks.ts';
import { isCjkChar } from './lines.ts';
import { blockId } from './ids.ts';
import type { Block } from './types.ts';

export function canStitch(prev: Block, next: Block): boolean {
  if (prev.kind !== 'text' || next.kind !== 'text') return false;
  if (TERMINAL.test(prev.text)) return false;
  if (BULLET_START.test(next.text)) return false;
  return /^[a-z]/u.test(next.text) || isCjkChar(next.text.slice(0, 1));
}

export function stitchPair(docId: string | undefined, prev: Block, next: Block): Block {
  const parts = [...prev.parts, ...next.parts];
  const partTexts = [...(prev.partTexts ?? [prev.text]), ...(next.partTexts ?? [next.text])];
  return {
    id: blockId(docId, parts, joinBlockText(prev.text, next.text)),
    kind: 'text',
    text: joinBlockText(prev.text, next.text),
    parts,
    partTexts,
    stitched: true,
  };
}

/**
 * 对**文档序**的块流做跨页缝合。合并发生在"前页最后一块 + 后页第一块"上 ——
 * 流序保证了这一点（后页第一块的前一个块必然是前页最后一块）。
 * 合并后**不前进**：合成的块还可能继续缝上后两页（一段话跨三页）。
 */
export function stitchPages(docId: string | undefined, blocks: readonly Block[]): Block[] {
  const result = blocks.slice();
  let i = 0;
  while (i < result.length - 1) {
    const a = result[i]!;
    const b = result[i + 1]!;
    const aLastPage = a.parts.at(-1)?.page ?? 0;
    const bFirstPage = b.parts[0]?.page ?? 0;
    if (bFirstPage === aLastPage + 1 && canStitch(a, b)) {
      result.splice(i, 2, stitchPair(docId, a, b));
      // 不前进：合成块可能继续缝下一页
    } else {
      i += 1;
    }
  }
  return result;
}
