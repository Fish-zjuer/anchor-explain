/**
 * PDF 文字层：归一化坐标 + 按行拼文本。
 * 事实源：docs/CONTRACTS.md §1（`PDFLocation.bbox` 是归一化的 `[x1,y1,x2,y2]`）。
 *
 * @anchor 为什么单独一个文件：pdf.js 给的是 **PDF 用户空间**的坐标
 *         （`transform = [a,b,c,d,e,f]`，单位是点，y 从**下**往上），
 *         而我们的 `bbox` 是**归一化的、y 从上往下**。两个坐标系之间的换算是这门功能里
 *         唯一有对错的部分，而且错了以后的表现极度隐晦：
 *         "命中不到文字"和"命中到隔壁段落"看起来都像"这个 PDF 没文字层"。
 *         所以它被压成一个**纯函数**（`normalizeItems` / `joinLines`），不碰 pdf.js、可直测。
 *
 * **禁止 import 'vscode'**，也**不 import pdf.js** —— 输入形状由下面这个 `RawTextItem` 定死，
 * 这样单测可以手搓 items，不必背着一个 30 页的 fixture。
 */

import { clamp01 } from '@anchor/core';

/** pdf.js `getTextContent()` 里每一项的形状（只取我们用得到的字段） */
export interface RawTextItem {
  str: string;
  /** `[a, b, c, d, e, f]`，e/f 是原位（PDF 用户空间，点在左下角） */
  transform: readonly number[];
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

/** 归一化到 `[0,1]`、**y 从上往下**的文字块 */
export interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 空白项要丢掉：pdf.js 会给每一行末尾/换行处塞一个 `str: ""` 的项（`hasEOL` 的载体），
 * 留着它们会让行数统计与"跨行补换行"多出一堆空行。
 */
export function normalizeItems(raw: readonly RawTextItem[], viewport: ViewportSize): TextItem[] {
  if (viewport.width <= 0 || viewport.height <= 0) return [];

  const out: TextItem[] = [];
  for (const item of raw) {
    if (typeof item.str !== 'string' || item.str.trim() === '') continue;
    const e = item.transform[4] ?? 0;
    const f = item.transform[5] ?? 0;
    if (!Number.isFinite(e) || !Number.isFinite(f)) continue;

    const width = Number.isFinite(item.width) ? item.width : 0;
    const height = Number.isFinite(item.height) ? item.height : 0;

    // PDF 用户空间 → 归一化：x 直接除宽；y 要**翻过来**（PDF 的原点在左下角，
    // 而 bbox 的 y 是从上往下量），并且用**这一项的底边**当上边界。
    out.push({
      text: item.str,
      x: clamp01(e / viewport.width),
      y: clamp01((viewport.height - (f + height)) / viewport.height),
      width: clamp01(width / viewport.width),
      height: clamp01(height / viewport.height),
    });
  }
  return out;
}

/**
 * 一行之内两块文字的 y 差小于这个比例，就算同一行。
 * 0.008 ≈ A4 上 6.7pt —— 比正常行距小一个量级，又足够容忍同一行里不同字号带来的基线漂移。
 */
export const SAME_LINE_TOLERANCE = 0.008;

/** 按阅读顺序（先上后下、再左到右）排序 */
export function readingOrder(items: readonly TextItem[]): TextItem[] {
  return [...items].sort((a, b) => {
    if (Math.abs(a.y - b.y) > SAME_LINE_TOLERANCE) return a.y - b.y;
    return a.x - b.x;
  });
}

/**
 * 把文字块拼成文本，**行与行之间补换行**。
 *
 * "跨行补换行"不是美化：模型拿到的取件结果如果是一整坨没有换行的字，
 * 它给出的 `lineStart/lineEnd` 只能靠猜；而页内的换行是它唯一能对齐的锚。
 * （这也是 `S7` 验收标准里点名的那一条。）
 */
export function joinLines(items: readonly TextItem[]): string {
  const ordered = readingOrder(items);
  const lines: string[] = [];
  let currentLineY: number | null = null;
  let buffer = '';

  for (const item of ordered) {
    if (currentLineY === null || Math.abs(item.y - currentLineY) > SAME_LINE_TOLERANCE) {
      if (buffer !== '') lines.push(buffer);
      buffer = item.text;
      currentLineY = item.y;
      continue;
    }
    // 同一行：中文之间不该补空格，英文单词之间该补。判据是"前一个字符与后一个字符
    // 都不是 CJK"，这样 "This paragraph" 拼得对，"这一段话" 也不会被切开。
    buffer += needsSpace(buffer, item.text) ? ` ${item.text}` : item.text;
  }
  if (buffer !== '') lines.push(buffer);
  return lines.join('\n');
}

const CJK = /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;

function needsSpace(prev: string, next: string): boolean {
  const a = prev.slice(-1);
  const b = next.slice(0, 1);
  if (a === '' || b === '') return false;
  if (CJK.test(a) || CJK.test(b)) return false;
  // PDF 里同一行的两块文字本来就带空格时别再叠一个
  if (/\s$/.test(prev) || /^\s/.test(next)) return false;
  return true;
}
