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
/** 浏览器打印出来的页眉/页脚（URL 行），以及别处出现的长 URL */
const URLISH = /file:\/\/\/|^https?:\/\//iu;

/** 这一行像不像页眉页脚（单页判据：在页面上下边缘 + 够短） */
function furnitureCandidate(line: Line): boolean {
  const t = line.text.trim();
  if (t.length === 0 || t.length > 60) return false;
  return line.y < 0.08 || line.y + line.h > 0.9;
}

const hasLetters = (t: string): boolean => (t.match(/[A-Za-z\u4e00-\u9fff]/gu) ?? []).length >= 2;

/**
 * 页脚/页眉噪音：页码、书眉。不滤掉它们，跨页缝合会把两页的页码拼进正文。
 * 这里只判**简单样式**（整行就是页码 / URL）；带文字的页眉页脚交给 `markFurnitureLines`。
 */
export function isPageFurniture(line: Line): boolean {
  if (!furnitureCandidate(line)) return false;
  const t = line.text.trim();
  return PAGE_NUMBERISH.test(t) || URLISH.test(t);
}

/**
 * **文档级**页眉页脚判定（行级，必须在成块之前跑）。
 *
 * @anchor 为什么要提到"成块之前"：页脚就在正文段落的下方，段落归并会把它们**并进同一块**；
 *         之后无论怎么过滤都不对 —— 不删，页脚留在正文里；删掉，正文跟着一起没了。
 *         实测（这正是被单测抓到的那次）：4 页的合成件里 4 块全被删光，因为
 *         "正文 + 页脚"拼成的块签名在 4 页里重复。所以在行级判、在成块前剔除，
 *         是唯一两头都不伤的顺序。
 *
 * 判据：① 整行是页码或 URL；② 同一条线（数字掩成 `#`）在 **≥3 个不同页**的边缘反复出现
 * 且含字母（书眉模板）。**跨页计数**这一条不能省：只按"全文出现 ≥3 次"判，会把
 * 中文数学文档里的公式碎片（`− x`、`∞`、`+ a 2 s`）当成页眉页脚，实测误吃三成正文。
 */
export function markFurnitureLines(lines: readonly Line[]): Set<Line> {
  const pagesOf = new Map<string, Set<number>>();
  for (const line of lines) {
    if (!furnitureCandidate(line)) continue;
    const sig = line.text.trim().replace(/\d+/gu, '#');
    const pages = pagesOf.get(sig) ?? new Set<number>();
    pages.add(line.page);
    pagesOf.set(sig, pages);
  }
  const drop = new Set<Line>();
  for (const line of lines) {
    const t = line.text.trim();
    if (PAGE_NUMBERISH.test(t) || URLISH.test(t)) {
      drop.add(line);
      continue;
    }
    if (!furnitureCandidate(line)) continue;
    const pages = pagesOf.get(t.replace(/\d+/gu, '#'));
    if (pages !== undefined && pages.size >= 3 && hasLetters(t)) drop.add(line);
  }
  return drop;
}

/**
 * 块级的页眉页脚兜底剔除（行级已经判过一轮；这里收两行以上的书眉、或调用方直接给块流的场合）。
 *
 * 安全护栏（这一条是必须的）：**单行以上、或正文长度的块一律不动** ——
 * 页脚被并进正文段落时，删块就是删正文。行级那一步（`markFurnitureLines`）才是主防线。
 */
export function dropFurniture(stream: import('./types.ts').BlockStream): import('./types.ts').BlockStream {
  const lineH = estimateLineHeight(stream.blocks);
  const isSingleLine = (b: Block): boolean =>
    b.parts.length === 1 && b.parts[0]!.bbox[3] - b.parts[0]!.bbox[1] <= Math.max(2.2 * lineH, 0.02);
  const canDrop = (b: Block): boolean => {
    const t = b.text.trim();
    if (t.length === 0 || t.length > 60) return false;
    if (!isSingleLine(b)) return false;
    const part = b.parts[0]!;
    return part.bbox[1] < 0.08 || part.bbox[3] > 0.9;
  };
  const signature = (b: Block): string | null => (canDrop(b) ? b.text.trim().replace(/\d+/gu, '#') : null);
  const pagesOf = new Map<string, Set<number>>();
  for (const b of stream.blocks) {
    const sig = signature(b);
    if (sig === null) continue;
    const pages = pagesOf.get(sig) ?? new Set<number>();
    pages.add(b.parts[0]!.page);
    pagesOf.set(sig, pages);
  }
  const drop = new Set<number>();
  stream.blocks.forEach((b, i) => {
    const sig = signature(b);
    if (sig === null) return;
    if ((pagesOf.get(sig)?.size ?? 0) >= 3) drop.add(i);
  });
  if (drop.size === 0) return stream;
  return { ...stream, blocks: stream.blocks.filter((_, i) => !drop.has(i)) };
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
 *
 * @anchor 段落边界用**三条判据**，不是一条 —— 单靠"空隙大于阈值"在真实版面上必然错：
 *   - **ACM/IEEE 双栏论文的段间距 ≈ 0**（段落靠首行缩进区分），空隙判据永远不触发，
 *     于是一整栏被并成一块（实测 6019 字）；反过来在稀疏版面里它又会把每一行都切开。
 *   所以三条一起用：
 *     1. **首行缩进**：行左边缘比这一栏的基准左边缘明显右移 → 新段落（最可靠的信号）；
 *     2. **空隙**：间隙 > max(1.4 × 中位行距, 1.35 × 字高) → 新段落（间距式版面）；
 *     3. **末行短**：上一行明显不满行（< 85% 的栏宽）且以句末标点收尾 → 段落到此结束
 *        （两端对齐的正文里，段落最后一行的"短"是最稳的信号）。
 */
export function blocksOfColumn(docId: string | undefined, lines: readonly Line[]): Block[] {
  const kept = lines.filter((l) => !isPageFurniture(l));
  if (kept.length === 0) return [];

  const medianHeight = median(kept.map((l) => l.h));
  const gaps: number[] = [];
  for (let i = 1; i < kept.length; i += 1) gaps.push(kept[i]!.y - (kept[i - 1]!.y + kept[i - 1]!.h));
  /**
   * 段距阈值 = 字高项（排版学尺度）+ 统计项（这一栏自己的行距）。
   * 统计项**只在行间距样本足够时**才算进来：只有一两个空隙时，"行距中位数"就是那个段距本身，
   * 于是阈值被抬高到永远触发不了（两行页的经典退化）。样本少就只信字高。
   * 加上统计项是为了双倍行距的手稿/作业 —— 那里的行距本身就很大，只按字高判会把每行都切开。
   */
  const gapsSorted = gaps.slice().sort((a, b) => a - b);
  const p10Gap = gapsSorted[Math.floor(gapsSorted.length * 0.1)] ?? 0;
  const statistical = gaps.length >= 6 ? p10Gap * 1.4 : 0;
  const paragraphGap = Math.max(medianHeight * 1.35, statistical, MIN_PARAGRAPH_GAP);
  /** 这一栏的基准左边缘 = 各行左边缘的众数（正文行都从栏边界开始；缩进行偏离它） */
  const leftEdges = kept.map((l) => l.x).sort((a, b) => a - b);
  const columnLeft = leftEdges[Math.floor(leftEdges.length * 0.15)] ?? kept[0]!.x;
  const columnWidth = Math.max(...kept.map((l) => l.x + l.w)) - columnLeft;

  const groups: Line[][] = [[kept[0]!]];
  for (let i = 1; i < kept.length; i += 1) {
    const line = kept[i]!;
    const prev = groups[groups.length - 1]!.at(-1)!;
    const gap = line.y - (prev.y + prev.h);
    const headingStart = isHeadingLike(line, medianHeight);
    const bulletStart = BULLET_START.test(line.text);
    const indented = line.x - columnLeft > 0.6 * medianHeight;
    const prevShort =
      columnWidth > 0 && prev.w < columnWidth * 0.85 && TERMINAL.test(prev.text.trim());
    if (gap > paragraphGap || headingStart || bulletStart || indented || prevShort) {
      groups.push([line]);
    } else {
      groups[groups.length - 1]!.push(line);
    }
  }

  return groups.map((group) => {
    const first = group[0]!;
    if (isHeadingLike(first, medianHeight)) {
      return makeBlock(docId, group, 'heading', headingLevelOf(first, medianHeight));
    }
    return makeBlock(docId, group, 'text');
  });
}

/**
 * 连续短行归并：**表格、清单、代码段**在块流里都长一个样 —— 一长串"单行、很短、
 * 挤在一个紧凑矩形里"的块。它们在版面上是**一个整体**（一张表/一个列表/一段代码），
 * 切成几十张卡片既难读也难用（实测 TraceMonkey 那张结果表被切成 104 张卡片，
 * 占全文块数的 48%，而它只承载 0.9% 的字）。
 *
 * 所以这里把它们聚回一块。行内按 y 聚簇、簇内按 x 排序 —— 表格因此是可读的
 * "第一列 | 第二列"形式，而不是一串乱序格子。
 *
 * 判据（都要满足）：同页连续、每块都是**单行**（高度 ≤ 1.5×行高）、块数 ≥ 4、
 * 落在一个紧凑矩形里（宽 ≥ 25% 页宽、高 ≤ 55% 页高）、且短块占多数（≤ 60 字）。
 */
export function groupRuns(docId: string | undefined, blocks: readonly Block[], lineH: number): Block[] {
  const isTinyText = (b: Block): boolean =>
    b.kind === 'text' &&
    b.text.trim() !== '' &&
    b.text.trim().length <= 60 &&
    b.parts.length === 1 &&
    b.parts[0]!.bbox[3] - b.parts[0]!.bbox[1] <= Math.max(1.6 * lineH, 0.012);

  const out: Block[] = [];
  let i = 0;
  while (i < blocks.length) {
    const head = blocks[i]!;
    if (!isTinyText(head)) {
      out.push(head);
      i += 1;
      continue;
    }
    let j = i;
    while (j < blocks.length && isTinyText(blocks[j]!) && blocks[j]!.parts[0]!.page === head.parts[0]!.page) j += 1;
    const run = blocks.slice(i, j);
    const x1 = Math.min(...run.map((b) => b.parts[0]!.bbox[0]));
    const x2 = Math.max(...run.map((b) => b.parts[0]!.bbox[2]));
    const y1 = Math.min(...run.map((b) => b.parts[0]!.bbox[1]));
    const y2 = Math.max(...run.map((b) => b.parts[0]!.bbox[3]));
    const compact = run.length >= 4 && x2 - x1 >= 0.25 && y2 - y1 <= 0.55;
    if (!compact) {
      out.push(...run);
      i = j;
      continue;
    }
    // 行内按 y 聚簇（容差取行高的中位数），簇内按 x 排 —— 表格的可读顺序
    const tol = Math.max(
      median(run.map((b) => b.parts[0]!.bbox[3] - b.parts[0]!.bbox[1])),
      0.004,
    );
    const rows: { y: number; cells: Block[] }[] = [];
    for (const b of [...run].sort((a, b2) => a.parts[0]!.bbox[1] - b2.parts[0]!.bbox[1])) {
      const row = rows.at(-1);
      if (row && Math.abs(b.parts[0]!.bbox[1] - row.y) <= tol) row.cells.push(b);
      else rows.push({ y: b.parts[0]!.bbox[1], cells: [b] });
    }
    const text = rows
      .map((row) =>
        row.cells
          .sort((a, b2) => a.parts[0]!.bbox[0] - b2.parts[0]!.bbox[0])
          .map((c) => c.text.trim())
          .join(' | '),
      )
      .join('\n');
    const parts = [{ page: head.parts[0]!.page, bbox: [x1, y1, x2, y2] as [number, number, number, number] }];
    out.push({ id: blockId(docId, parts, text), kind: 'text', text, parts, partTexts: [text], grouped: true });
    i = j;
  }
  return out;
}

/** 行高的文档级估计（文本块高度的 20 分位）：单行块在任何工具的产物里都是最矮的一批。 */
export function estimateLineHeight(blocks: readonly Block[]): number {
  const hs = blocks
    .filter((b) => b.kind !== 'image' && b.text.trim() !== '')
    .map((b) => b.parts[0]!.bbox[3] - b.parts[0]!.bbox[1])
    .sort((a, b) => a - b);
  return Math.max(hs[Math.floor(hs.length * 0.2)] ?? 0.01, 0.004);
}
