/** 临时位置文档与直接讲解共用的源片段快照/锚点构造。D137。 */
import { basenameOf, compareSegments, samePath } from '@anchor/core';
import type { Anchor, AnchorSegment } from '@anchor/core';
import { mapSelection } from './handoffDoc.ts';
import type { HandoffDoc } from './handoffDoc.ts';
import type { HandoffRange } from './handoffParse.ts';

export async function readSourceSegments(
  ranges: readonly HandoffRange[],
  readText: (path: string) => Promise<string>,
): Promise<AnchorSegment[]> {
  const files = new Map<string, string[]>();
  const segments: AnchorSegment[] = [];
  for (const range of ranges) {
    let lines = files.get(range.filePath);
    if (!lines) {
      lines = (await readText(range.filePath)).split(/\r?\n/);
      files.set(range.filePath, lines);
    }
    if (range.lineStart < 1 || range.lineEnd > lines.length) {
      throw new Error(`${range.filePath} 的第 ${range.lineStart}-${range.lineEnd} 行已经不存在，请重新生成临时文件。`);
    }
    segments.push({ ...range, text: lines.slice(range.lineStart - 1, range.lineEnd).join('\n') });
  }
  return segments;
}

export async function snapshotHandoffSelection(
  doc: HandoffDoc,
  start: number,
  end: number,
  readText: (path: string) => Promise<string>,
): Promise<AnchorSegment[]> {
  return readSourceSegments(mapSelection(doc.origin, start, end), readText);
}

// @anchor 只有用户选中的源文件进入 segments；主 location 的行界只取主文件。
export function sourceSegmentsAnchor(
  segments: readonly AnchorSegment[],
  focus?: string,
  sourceId?: string,
): Anchor {
  const sorted = [...segments].sort(compareSegments);
  const first = sorted[0];
  if (!first) throw new Error('选择队列是空的。');
  const primary = sorted.filter(s => samePath(s.filePath, first.filePath));
  return {
    sourceType: 'code',
    sourceId: sourceId ?? first.filePath,
    sourceName: basenameOf(first.filePath),
    location: {
      filePath: first.filePath,
      lineStart: Math.min(...primary.map(s => s.lineStart)),
      lineEnd: Math.max(...primary.map(s => s.lineEnd)),
    },
    segments: sorted.map(({ filePath, lineStart, lineEnd }) => ({ filePath, lineStart, lineEnd })),
    extractedText: sorted.map((s, i) =>
      `第 ${i + 1} 段（${s.filePath} 第 ${s.lineStart}-${s.lineEnd} 行）\n${s.text}`,
    ).join('\n\n'),
    ...(focus?.trim() ? { focus: focus.trim() } : {}),
  };
}
