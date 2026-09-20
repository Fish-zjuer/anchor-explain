/**
 * 第三步：一栏（或单栏页）的行 → 块。
 *
 * @anchor 成段的三个判据，全部是"看起来像新段"的版面信号：
 *   1. **行距突变** —— 段间距显著大于行间距（1.6 倍中位数行距，且有下限）；
 *   2. **标题行** —— 字高明显大于中位数、句子短、结尾没有句末标点（论文的节标题几乎都这样）；
 *   3. **列表起点** —— 以项目符号或编号开头的行自成一块。
 *   每个判据都会误伤（居中的公式行像标题、宽行距像分段），所以每一处都给手修留了口子
 *   （manual.ts 的 merge / setKind）—— **启发式负责省时间，不负责终审**。
 *
 * 本文件零依赖。
 */

import type { Line } from './lines.ts';
import { isCjkChar } from './lines.ts';
import type { Block, BlockPart } from './types.ts';
import { blockId } from './ids.ts';

/** 行与行之间"像段间"的最小额外距离（归一化页高的绝对下限） */
const MIN_PARAGRAPH_GAP = 0.014;

const TERMINAL = /[。．.!！?？;；：:]["'”’）)]?$/u;
const BULLET_START = /^([•·▪◦＃#*]|[-–—]\s|\(?\d{1,2}[).、]\s?|[（(]?[一二三四五六七八九十]+[）、.])\s*/u;

/** 句末标点（跨页缝合的判据也用它 —— 导出而非复制） */
export { TERMINAL, BULLET_START };

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** 行与行之间怎么拼（与 stitch 跨页缝合同一条规则，别处不许再写一份） */
export function joinBlockText(prev: string, next: string): string {
  if (prev === '') return next;
  if (next === '') return prev;
  // 英文连字符断词：行尾的 - 甩掉直接接（"state-" + "ment" → "statement"）
  if (/[A-Za-z]-$/u.test(prev) && /^[a-z]/u.test(next)) return prev.slice(0, -1) + next;
  const a = prev.slice(-1);
  const b = next.slice(0, 1);
  if (isCjkChar(a) || isCjkChar(b)) return prev + next;
  return `${prev} ${next}`;
}

function isHeadingLike(line: Line, medianHeight: number): boolean {
  return (
    line.h > medianHeight * 1.25 &&
    line.text.length <= 80 &&
    !TERMINAL.test(line.text) &&
    !BULLET_START.test(line.text)
  );
}

function headingLevelOf(line: Line, medianHeight: number): number {
  const ratio = line.h / Math.max(medianHeight, 1e-6);
  if (ratio >= 1.6) return 1;
  if (ratio >= 1.35) return 2;
  return 3;
}

/** 页码样式：裸数字/罗马数字、N/M、"Page 12" / "第 12 页"。**整行精确匹配** */
const PAGE_NUMBERISH = /^(?:\d+|[ivxlcdm]+|\d+\s*\/\s*\d+|(?:page|p)\.?\s*[-–]?\s*\d+(?:\s*\/\s*\d+)?|第\s*\d+\s*页)$/iu;

/**
 * 页脚/页眉噪音：页码、书眉。不滤掉它们，跨页缝合会把两页的页码拼进正文。
 * 这里只判**简单样式**（整行就是页码）；带文字的页脚/书眉（"XX Press — PAGE 12"）
 * 需要全文档视野 —— 它们是**同一模板每页重复、只有数字在变**，由
 * `dropFurniture` 在文档层补判。
 */
export function isPageFurniture(line: Line): boolean {
  if (line.text.length > 60) return false;
  if (!(line.y < 0.08 || line.y + line.h > 0.9)) return false;
  return PAGE_NUMBERISH.test(line.text.trim());
}

/**
 * 文档层的页眉/页脚补判：同一条线（去掉数字后完全相同）在 ≥3 页的边缘区域反复出现
 * → 是书眉/页脚模板，整批剔除。
 */
export function dropFurniture(stream: import('./types.ts').BlockStream): import('./types.ts').BlockStream {
  const signature = (b: Block): string | null => {
    const part = b.parts[0];
    if (part === undefined) return null;
    if (!(part.bbox[1] < 0.08 || part.bbox[3] > 0.9)) return null;
    if (b.text.length > 60) return null;
    return b.text.replace(/\d+/gu, '#').trim();
  };
  const seen = new Map<string, Set<number>>();
  for (const b of stream.blocks) {
    const sig = signature(b);
    if (sig === null) continue;
    const pages = seen.get(sig) ?? new Set<number>();
    pages.add(b.parts[0]!.page);
    seen.set(sig, pages);
  }
  const repeated = new Set([...seen.entries()].filter(([, pages]) => pages.size >= 3).map(([sig]) => sig));
  if (repeated.size === 0) return stream;
  return { ...stream, blocks: stream.blocks.filter((b) => !repeated.has(signature(b) ?? '')) };
}

function partsOf(lines: readonly Line[]): BlockPart[] {
  const byPage = new Map<number, { x1: number; y1: number; x2: number; y2: number }>();
  for (const l of lines) {
    const box = byPage.get(l.page);
    const next = { x1: Math.min(box?.x1 ?? Infinity, l.x), y1: Math.min(box?.y1 ?? Infinity, l.y), x2: Math.max(box?.x2 ?? -Infinity, l.x + l.w), y2: Math.max(box?.y2 ?? -Infinity, l.y + l.h) };
    byPage.set(l.page, next);
  }
  return [...byPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page, box]) => [page, [box.x1, box.y1, box.x2, box.y2] as [number, number, number, number]] as const)
    .map(([page, bbox]) => ({ page, bbox }));
}

export function makeBlock(docId: string | undefined, lines: readonly Line[], kind: Block['kind'], headingLevel?: number): Block {
  const text = lines.reduce((acc, l) => joinBlockText(acc, l.text), '');
  const parts = partsOf(lines);
  // 每页的正文单独留一份（与 parts 等长对齐）：跨页缝合的"取消缝合"要靠它还原
  const partTexts = parts.map((part) => {
    const pageLines = lines.filter((l) => l.page === part.page);
    return pageLines.reduce((acc, l) => joinBlockText(acc, l.text), '');
  });
  return {
    id: blockId(docId, parts, text),
    kind,
    text,
    parts,
    partTexts,
    ...(kind === 'heading' ? { headingLevel: headingLevel ?? 3 } : {}),
  };
}

/**
 * 一栏的行 → 块（顺序保持输入的行序；输入方保证已按阅读的上下顺序排好）。
 * `docId` 只透传给块 ID。
 */
export function blocksOfColumn(docId: string | undefined, lines: readonly Line[]): Block[] {
  const kept = lines.filter((l) => !isPageFurniture(l));
  if (kept.length === 0) return [];

  const medianHeight = median(kept.map((l) => l.h));
  // 段距阈值基于**字高**而不是行距中位数：稀疏的栏（两三行）里中位行距就是那段空隙本身，
  // "1.6 倍中位行距"永远不触发（单测里抓到的）。字号是稳定的尺度 —— 段间距在实际版面里
  // 很少小于字高的一半，取 1.5 倍字高加上绝对下限，两行页与四十行页通用。
  const paragraphGap = Math.max(medianHeight * 1.5, MIN_PARAGRAPH_GAP);

  const groups: Line[][] = [[kept[0]!]];
  for (let i = 1; i < kept.length; i += 1) {
    const line = kept[i]!;
    const prev = groups[groups.length - 1]!.at(-1)!;
    const gap = line.y - (prev.y + prev.h);
    const headingStart = isHeadingLike(line, medianHeight);
    const bulletStart = BULLET_START.test(line.text);
    if (gap > paragraphGap || headingStart || bulletStart) groups.push([line]);
    else groups[groups.length - 1]!.push(line);
  }

  return groups.map((group) => {
    const first = group[0]!;
    if (isHeadingLike(first, medianHeight)) {
      return makeBlock(docId, group, 'heading', headingLevelOf(first, medianHeight));
    }
    return makeBlock(docId, group, 'text');
  });
}
