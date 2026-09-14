/*!
 * 本文件会通过 esbuild 把 pdfjs-dist（**Apache-2.0**）打进产物。
 * 上游许可全文见 node_modules/pdfjs-dist/LICENSE，本仓库的声明见
 * packages/extension-anchor/THIRD_PARTY_NOTICES.md —— **别删这个注释**：
 * esbuild 的 legalComments 会把 `/*!` 开头的注释保留在产物末尾，
 * 那是打包 Apache-2.0 依赖时唯一还留在产物里的署名（smoke 有一条断言守着它）。
 */

/**
 * `PDFSource` 的真实现：用 **pdf.js 的 legacy 无头构建**读文字层。
 *
 * @anchor 为什么是"无头"而不是复用线2 的 webview：取件发生在**线1**（编排循环在那边），
 *         而线1 根本没有 PDF 视图 —— 它只有磁盘上的一个文件路径。
 *         `pdfjs-dist/legacy` 是官方为 Node 准备的入口，专门吃这件事。
 *
 * 为什么用 npm 的 `pdfjs-dist` 而不是线2 里那份 vendored `assets/pdf.js/`：
 *   - 那份是**打过补丁的浏览器构建**（补丁的目的是拆掉 pdf.js 自带的 CSP，见 `MODIFICATIONS.md`），
 *     它对我们这种"只要文字"的用法没有任何增益，却把两个包的升级节奏绑在一起；
 *   - 线1 直接依赖一个 npm 包，线2 那边升级 pdf.js 不会波及取件。
 *   代价是两边的 pdf.js 版本可能不同 —— 对"取文字"这件事没有影响（文字层格式多年未变），
 *   而 `pageCount` 与页序不会因版本而异。
 *
 * **禁止 import 'vscode'**。
 */

import { pathToFileURL } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { AnchorError } from '@anchor/core';
import type { PDFPageText, PDFSource, OpenPDFSource } from './PDFSource.ts';
import { joinLines, normalizeItems } from './pageTextIndex.ts';

/**
 * pdf.js 的 `getDocument` 参数（只列我们用到的；`data` 与 `url` 二选一）。
 *
 * **`dispose()` 必须打在 loading task 上，不是 document 上** ——
 * pdfjs v6 里 `PDFDocumentProxy` 只有 `cleanup()`，`destroy()` 在 task 上。
 * 打在 document 上会 `is not a function`，而它只在"缓存淘汰/停用"时触发，
 * 于是表现是"用久了内存涨"而不是"一用就崩"（这条是单测抓出来的）。
 */
interface PdfJsDocument {
  numPages: number;
  getPage(page: number): Promise<PdfJsPage>;
}

interface PdfJsLoadingTask {
  promise: Promise<PdfJsDocument>;
  destroy(): Promise<void>;
}

interface PdfJsPage {
  getViewport(params: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: unknown[] }>;
}

/**
 * 把 worker 那份代码**挂到 pdf.js 官方的钩子上**，而不是让它自己去动态 import（D74）。
 *
 * @anchor 为什么非有这一句不可（这是 S7 的取件在用户手上从来没成功过的原因）：
 *         `disableWorker: true` 只是"不用线程"，pdf.js 仍然要把 worker 的代码**加载进主线程**，
 *         方式是 `import(GlobalWorkerOptions.workerSrc)`，而那个默认值是从 pdf.js 自己的
 *         `import.meta.url` 推出来的。**源码直跑**时它正好指到
 *         `node_modules/pdfjs-dist/legacy/build/`（所以 `node --test` 一直是绿的）；
 *         但**打成一个 cjs 之后，`import.meta.url` 被改写成产物自己的位置** —— 于是它去
 *         `dist/pdf.worker.mjs` 找一个不存在的文件，报
 *         `Setting up fake worker failed: Cannot find module '…\dist\pdf.worker.mjs'`。
 *
 *         更坏的是**它是静默的**：`PDFAdapter.pageCount` 的 catch 把它变成 null，闸门于是报
 *         "无法确定这份文档的总页数，拒绝按页取件" —— 一句话把所有线索都指向那份 PDF，
 *         指向不了我们的打包方式。用户看到的正是这一句。
 *
 *         pdf.js 留了官方出口：`globalThis.pdfjsWorker?.WorkerMessageHandler`
 *         （`legacy/build/pdf.mjs:22948`）。挂上去它就不走动态 import 了。
 *         下面的 `import()` 说明符是**字面量**，所以 esbuild 会把它一起打进产物
 *         （cjs 不分包 = 内联成惰性求值的一段），产物因此自洽，不依赖 node_modules 在旁边。
 */
let workerReady: Promise<void> | null = null;

async function ensureFakeWorker(): Promise<void> {
  workerReady ??= (async () => {
    // 类型来自隔壁的 `pdfjsWorkerTypes.d.ts`（pdfjs-dist 没给 worker 配类型）
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
  })();
  return workerReady;
}

function isRawItem(v: unknown): v is { str: string; transform: number[]; width: number; height: number } {
  if (typeof v !== 'object' || v === null) return false;
  const item = v as Record<string, unknown>;
  return (
    typeof item.str === 'string' && Array.isArray(item.transform) && typeof item.width === 'number'
  );
}

export const openPdfJsSource: OpenPDFSource = async (filePath: string): Promise<PDFSource> => {
  let task: PdfJsLoadingTask;
  let doc: PdfJsDocument;
  try {
    // 必须在 getDocument 之前（D74）：它一建立 fake worker 就会去找 worker 代码
    await ensureFakeWorker();
    // `pathToFileURL` 是必需的：Windows 上裸路径会被当成相对路径，
    // 而 pdf.js 那边只接受 URL 或字节。
    task = getDocument({
      url: pathToFileURL(filePath).href,
      // 取文字不需要字体数据；不关掉的话 pdf.js 会去 fetch 标准字体，
      // 在宿主里表现为一条无意义的告警（实测过）。
      useSystemFonts: false,
      // Node 里没有 worker：关掉它，pdf.js 走"假 worker"路径（那条路径要 ensureFakeWorker 兜着）
      disableWorker: true,
    } as Parameters<typeof getDocument>[0]) as unknown as PdfJsLoadingTask;
    doc = await task.promise;
  } catch (err) {
    throw new AnchorError('CONTEXT_REJECTED', `打不开这份 PDF（${(err as Error).message}）`);
  }

  return {
    pageCount: doc.numPages,

    async page(page: number): Promise<PDFPageText | null> {
      if (!Number.isInteger(page) || page < 1 || page > doc.numPages) return null;
      const pdfPage = await doc.getPage(page);
      const viewport = pdfPage.getViewport({ scale: 1 });
      const content = await pdfPage.getTextContent();
      const items = normalizeItems(content.items.filter(isRawItem), viewport);
      return { page, text: joinLines(items), items, viewport };
    },

    dispose(): void {
      // 打在 task 上（见上面 PdfJsLoadingTask 的注释）。
      // `destroy()` 是异步的，但缓存淘汰不等它 —— 我们只需要"句柄被交还"，
      // 而 pdf.js 自己会在这个 promise 里收干净。
      void task.destroy();
    },
  };
};
