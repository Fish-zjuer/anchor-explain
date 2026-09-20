/**
 * 手修操作：拆块是启发式，**用户才是终审**。
 *
 * @anchor 三个操作覆盖三类最常见的错：两段被错开（merge）、跨页缝错了（unstitch）、
 *         标题/正文判反了（setKind）。全部是**纯函数**：给进旧流，吐出新流 ——
 *         调用方（活页/工作室）负责落缓存。ID 按新内容重算：合并后的块是"另一个块"，
 *         旧 ID 不该被冒用（挂在线程上的引用由调用方决定要不要迁移）。
 *
 * 本文件零依赖。
 */

import { blockId } from './ids.ts';
import type { Block, BlockKind, BlockStream } from './types.ts';

function indexOfId(blocks: readonly Block[], id: string): number {
  return blocks.findIndex((b) => b.id === id);
}

/** 把几个块并成一块（按流里出现的顺序拼接；不要求相邻，但通常应该相邻） */
export function mergeBlocks(stream: BlockStream, ids: readonly string[]): BlockStream {
  const blocks = stream.blocks.slice();
  const picked: Block[] = [];
  const indexes: number[] = [];
  for (const id of ids) {
    const at = indexOfId(blocks, id);
    if (at < 0) throw new Error(`找不到块 ${id}`);
    indexes.push(at);
    picked.push(blocks[at]!);
  }
  if (picked.length < 2) return stream;
  indexes.sort((a, b) => a - b);

  const parts = picked.flatMap((b) => b.parts);
  const partTexts = picked.flatMap((b) => b.partTexts ?? [b.text]);
  const text = picked.map((b) => b.text).filter((t) => t !== '').join('\n\n');
  const allHeadings = picked.every((b) => b.kind === 'heading');
  const merged: Block = {
    id: blockId(stream.docId, parts, text),
    kind: allHeadings ? 'heading' : 'text',
    text,
    parts,
    partTexts,
    ...(allHeadings ? { headingLevel: Math.min(...picked.map((b) => b.headingLevel ?? 3)) } : {}),
  };
  // 从后往前删，前面的下标不失效
  for (let i = indexes.length - 1; i >= 0; i -= 1) blocks.splice(indexes[i]!, 1);
  const insertAt = Math.min(indexes[0]!, blocks.length);
  blocks.splice(insertAt, 0, merged);
  return { ...stream, blocks };
}

/** 取消跨页缝合：一块还原成每页一块（`partTexts` 还原"哪段字来自哪一页"） */
export function unstitch(stream: BlockStream, id: string): BlockStream {
  const blocks = stream.blocks.slice();
  const at = indexOfId(blocks, id);
  if (at < 0) throw new Error(`找不到块 ${id}`);
  const block = blocks[at]!;
  if (!block.stitched || block.parts.length < 2) return stream;

  const texts = block.partTexts ?? [block.text];
  const pieces: Block[] = block.parts.map((part, i) => ({
    id: blockId(stream.docId, [part], texts[i] ?? ''),
    kind: 'text',
    text: texts[i] ?? '',
    parts: [part],
    partTexts: [texts[i] ?? ''],
  }));
  blocks.splice(at, 1, ...pieces);
  return { ...stream, blocks };
}

/** 改块的种类（标题判成正文、正文判成标题……用户的眼睛说了算） */
export function setKind(stream: BlockStream, id: string, kind: BlockKind, headingLevel?: number): BlockStream {
  const blocks = stream.blocks.slice();
  const at = indexOfId(blocks, id);
  if (at < 0) throw new Error(`找不到块 ${id}`);
  const block = blocks[at]!;
  blocks[at] = {
    ...block,
    kind,
    ...(kind === 'heading' ? { headingLevel: headingLevel ?? block.headingLevel ?? 3 } : {}),
  };
  return { ...stream, blocks };
}

/**
 * 把 OCR 出的文字填进图块（D102 的降级链在引擎侧的落点）：
 * 图块升级成 text 块（保留原图 part —— 定位/闪现还要用）。
 */
export function fillImageText(stream: BlockStream, id: string, text: string): BlockStream {
  const blocks = stream.blocks.slice();
  const at = indexOfId(blocks, id);
  if (at < 0) throw new Error(`找不到块 ${id}`);
  const block = blocks[at]!;
  if (block.kind !== 'image') return stream;
  blocks[at] = {
    ...block,
    kind: 'text',
    text: text.trim(),
    id: blockId(stream.docId, block.parts, text.trim()),
  };
  return { ...stream, blocks };
}
