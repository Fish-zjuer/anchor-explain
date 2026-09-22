/**
 * 拆块的**真实调用方**（S-P2）：把一份 PDF 读成引擎要的 `SplitInput`。
 *
 * @anchor 为什么单独一层：`@anchor/pdf-blocks` 刻意不依赖 pdfjs（它的三个消费方
 *         各自从自己的 pdf.js 实例抽文字项，喂给引擎的必须是同一个形状，见引擎 types.ts）。
 *         所以"pdf.js 的 item → 引擎的 item"这一步映射必须有人做，而且**只做一次** ——
 *         两处各写一遍字段名，早晚有一处会把 `w` 写成 `width` 而整页变成空块。
 *
 * 两处失败必须发声（不做静默兜底）：
 *   - 打不开文件 → 抛（调用方接住并告诉用户"这份 PDF 打不开"）；
 *   - 某页取不到文字（挂扫描件）→ **照常成块**，只是那一页没有块，页数照报。
 *     悄悄跳过整页是可以接受的，假装它有文字不行。
 *
 * 本文件不 import 'vscode'（字节与句柄都是注入进来的），node --test 直测。
 */

import { createHash } from 'node:crypto';
import type { PageTextIn, SplitInput } from '@anchor/pdf-blocks';
import type { PDFPageText, PDFSource } from '../adapters/pdf/PDFSource.ts';

/** 一页 pdf.js 的文字项 → 引擎的文字项（**字段名不同，只有这里能改**） */
export function itemsOfPage(page: PDFPageText): PageTextIn['items'] {
  return page.items.map((item) => ({ str: item.text, x: item.x, y: item.y, w: item.width, h: item.height }));
}

export interface SplitReadDeps {
  /**
   * 取一份**已打开**的 PDF。实现是 `pdfDocumentCache.acquire`（有界 LRU）——
   * ⚠ 拿到之后**不要 dispose**（缓存还在用它；放掉句柄是缓存淘汰或扩展停用的事）。
   */
  acquire(filePath: string): Promise<PDFSource>;
  /** 读原始字节：文档指纹（`sourceId`）就是它的 sha1，与线2 的口径一致 */
  readBytes(filePath: string): Promise<Uint8Array>;
}

export interface SplitReadResult {
  /** 喂给 `splitDocument` 的输入（`docId` = 指纹） */
  input: SplitInput;
  /** 文档指纹：会话记忆与块 ID 的文档维度都用它 */
  sourceId: string;
  pageCount: number;
}

/**
 * 读一份 PDF 的全部文字项。**失败就抛**，由调用方决定怎么报（面板/状态栏/输出通道）。
 *
 * 进度回调是给"30 页的 PDF 要几秒"用的：面板打开时那段等待必须有东西在动（D64 同一条理由）。
 */
export async function readSplitInput(
  deps: SplitReadDeps,
  filePath: string,
  onProgress?: (done: number, total: number) => void,
): Promise<SplitReadResult> {
  // ⚠ **先算指纹，再打开**。顺序反过来的话：pdf.js 会把喂给它的那块缓冲 transfer 走，
  // 于是"再读一次拿到的"可能已经是空数组（S-P2 实测：拿到的是空串的 sha1，静默算错）。
  // 这是外部输入（文件内容）变成**块身份**的那一步（D100 的地基），错一次就全对不上。
  const raw = await deps.readBytes(filePath);
  const sourceId = createHash('sha1').update(raw).digest('hex');

  const source = await deps.acquire(filePath);
  const total = source.pageCount;
  const pages: PageTextIn[] = [];
  for (let page = 1; page <= total; page += 1) {
    const text = await source.page(page);
    if (text !== null) pages.push({ page, items: itemsOfPage(text) });
    onProgress?.(page, total);
  }
  return { input: { docId: sourceId, pages }, sourceId, pageCount: total };
}
