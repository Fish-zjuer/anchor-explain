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

/**
 * 读字节的端口。**注入**而不是在这里 `import 'node:fs'`：`adapters/` 零 vscode 依赖（D19），
 * 真实现是 `vscode/ports/fileSystemPort.ts`（走 `workspace.fs`，对 remote / 虚拟文件系统同样成立 ——
 * 拿 `node:fs` 在那类工作区里会**静默读到空**，那条理由见该文件顶部的 @anchor）。
 */
export interface PdfBytesPort {
  readBytes(path: string): Promise<Uint8Array>;
}

/**
 * 造一个"按路径打开 PDF"的实现。
 *
 * @anchor **为什么喂字节（`data`）而不是给路径（`url`）**（D75，用户实测逼出来的）：
 *         pdf.js 的 `url:` 那条路**只在浏览器环境成立** —— `getDocument` 会先调 `getUrlProp`
 *         去拿 `window.location` 解析相对地址，在宿主里直接 `ReferenceError: window is not defined`。
 *         而 pdf.js 判断"我是不是在 Node 里"的那一句是：
 *
 *           const isNodeJS = typeof process === "object" && ... && !process.versions.nw &&
 *             !(process.versions.electron && process.type && process.type !== "browser");
 *
 *         最后那半句是为 **Electron 的渲染进程**写的，而 VS Code 的扩展宿主现在是
 *         **Electron 的 utility 进程**（`process.versions.electron` 有值、`process.type === "utility"`）
 *         —— 于是 pdf.js 误判成"浏览器"，走上那条需要 `window` 的路。
 *         喂字节就绕开了整条 URL/环境判断：数据是我们从自己的端口读来的，与 pdf.js 觉得
 *         自己在哪儿无关。这条比"想办法把 isNodeJS 掰成 true"稳得多（那要么去动
 *         `process.versions`，要么依赖 pdf.js 的内部判定，两个都不该由我们改）。
 */
/**
 * 把读到的字节统一成**真正的 `Uint8Array`**，并且**永远复制一份**。
 *
 * @anchor pdf.js 会明确拒绝 Node 的 `Buffer`：`Please provide binary data as Uint8Array,
 *         rather than Buffer.` —— 而 `node:fs` 读出来的正好就是 Buffer 的子类。
 *         真实现（`vscode.workspace.fs`）给的是普通 `Uint8Array`，但端口是**注入**的，
 *         下一个实现（从压缩包/网络里读）完全可能给 Buffer —— 与其让每个调用方记着这件事，
 *         不如在入口一次性摆平。
 *
 *         **无条件复制**（不是"只在是 Buffer 时才复制"）：`getDocument` 会把这块缓冲
 *         **transfer 走**，于是**调用方手里那个数组会当场变成空的**（byteLength 0）。
 *         原实现只在身份不对时复制，于是"端口把同一块缓冲复用了返回"时就会踩到 ——
 *         S-P2 的指纹正好是"读完字节算 sha1"，实测拿到的是空串的 sha1
 *         （`da39a3ee…`）—— 那是**静默算错**，而且错得毫无痕迹。
 *         一份 PDF 复制一次的代价（几 MB）远小于"指纹错了但没人知道"。
 *         （同时 `pdf-blocks` 侧的 `readSplitInput` 也改成了**先算指纹再打开**，两道都上。）
 */
function toPlainUint8(data: Uint8Array): Uint8Array {
  return Uint8Array.from(data);
}

export function createPdfJsSource(deps: { bytes: PdfBytesPort }): OpenPDFSource {
  return async (filePath: string): Promise<PDFSource> => {
    let task: PdfJsLoadingTask;
    let doc: PdfJsDocument;
    try {
      // 必须在 getDocument 之前（D74）：它一建立 fake worker 就会去找 worker 代码
      await ensureFakeWorker();
      // 每次都现读：pdf.js 可能把这块缓冲**转移**（transfer）走，缓存复用的只是文档句柄
      const data = await deps.bytes.readBytes(filePath);
      task = getDocument({
        data: toPlainUint8(data),
        // 取文字不需要字体数据；不关掉的话 pdf.js 会去 fetch 标准字体，
        // 在宿主里表现为一条无意义的告警（实测过）。
        useSystemFonts: false,
        // 宿主里没有 worker 线程：关掉它，pdf.js 走"假 worker"路径（那条路径由 ensureFakeWorker 兜着）
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
}
