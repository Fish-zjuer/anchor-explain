/**
 * PDF 来源适配器 —— 线2 的那一半在线1 里的落地。
 * 事实源：docs/CONTRACTS.md §3 / §3.1 / §3.2。
 *
 * @anchor 为什么它住在**线1**而不是线2：编排循环在线1（`Orchestrator` 调
 *         `adapter.fetchContext`），而线2 是个 PDF 阅读器、不参与讲解流程。
 *         分工是"S5/S6 把位置交过来，S7 由线1 自己按路径去读文件"。
 *
 * 于是 `PDFLocation.filePath`（S7 的加法扩展）成了这个文件的前提：
 * 没有它，`bbox`/`page` 只说得出"第 23 页的哪一块"，说不出"哪一份文档"。
 *
 * **禁止 import 'vscode'**（D19）—— 它只认 `PDFSource` 与那一层缓存。
 */

import { AnchorError } from '@anchor/core';
import type { AdapterCapabilities, BBox, ContextRequest } from '@anchor/core';
import type { PdfDocumentCache } from './pdf/pdfDocumentCache.ts';
import type { PDFPageText } from './pdf/PDFSource.ts';
import { textInBBox } from './pdf/textSearch.ts';

export interface PDFAdapter {
  readonly type: 'pdf';
  readonly capabilities: AdapterCapabilities;
  /**
   * §3 的第四个方法：按页取文字。
   * **调用前已经过 §3.2 校验**，所以这里不再重复判越界与漫游。
   */
  fetchContext(req: ContextRequest): Promise<string>;
  /**
   * 这份 PDF 共几页。**不在冻结的 `SourceAdapter` 里，是 S7 的追加方法。**
   *
   * 为什么必须有：§3.3 的 pdf 分支要检查 `1 ≤ page ≤ pageCount`，而 `ctx.pageCount`
   * 一直传不进去（S6 留下的缺口，D55 第 4 条）。线1 现在既然能无头打开 PDF，
   * 页数就顺手有了 —— 于是那个缺口在这里补上，不必去动 §5.1 的单向约定。
   */
  pageCount(filePath: string): Promise<number | null>;
  /**
   * 框选那一块里的文字，也就是 `Anchor.extractedText` 该填什么。
   *
   * 命中不到返回 null（扫描件没有文字层 / 框在图上），由调用方决定怎么退化 ——
   * 不抛错，因为"这块没字"是正常情况，不是故障。
   */
  textInBBox(filePath: string, page: number, bbox: BBox): Promise<string | null>;
}

export interface PDFAdapterDeps {
  cache: PdfDocumentCache;
  /**
   * 打不开 PDF 时的落点（D74）。**注入而不是 import vscode**：本文件零 vscode 依赖（D19）。
   *
   * @anchor 为什么必须有它：`pageCount` 失败要被吞成 `null`（§3.3 靠这个跳过页数上界），
   *         而"吞成 null"在过去是**彻底静默**的 —— 闸门只会说"无法确定这份文档的总页数，
   *         拒绝按页取件"。那句话把所有线索都引向**那份 PDF 本身**（用户就是这么被引偏的），
   *         而我们这边一句原因都没留下：没有日志、没有报错、`node --test` 还是全绿。
   *         真实原因（产物里 pdf.js 找不到 worker）因此藏了整整一片（S7 → D74）。
   */
  onError?: (message: string) => void;
}

/** 取件结果的页头。**这个格式是 S7 验收里点名的**，别随手改。 */
export function pageHeader(page: number): string {
  return `--- 第 ${page} 页 ---`;
}

/**
 * 单次取件的字符上限（D98，与 `CodeAdapter` 的 `MAX_TEXT_CHARS` 同一条纪律）。
 *
 * @anchor 为什么必须有：闸门只拦"超过 5 页"，不拦"5 页里塞了多少字"——
 *         教材一页正文轻松上万字符，5 页就是十几万，一次取件就能把上下文撑爆
 *         （或把用户的账单撑爆）。截断不会误导模型：截断说明就写在结果末尾，
 *         它知道该改取更小的页范围。
 */
export const MAX_FETCH_CHARS = 64 * 1024;

/** 一页的文字；空页给一句明确的话，而不是一片空白 */
function pageBody(page: PDFPageText | null): string {
  if (!page || page.text.trim() === '') return '（这一页没有文字层）';
  return page.text;
}

export function createPdfAdapter(deps: PDFAdapterDeps): PDFAdapter {
  return {
    type: 'pdf',
    capabilities: { contextTypes: ['page_range'], maxSpan: 5 },

    async fetchContext(req: ContextRequest): Promise<string> {
      const filePath = req.params.path;
      const start = req.params.start;
      const end = req.params.end;
      if (typeof filePath !== 'string' || typeof start !== 'number' || typeof end !== 'number') {
        // 编排层过了 §3.2 还走到这里，说明两边对契约的理解不一致 —— 明说，不静默返回空串
        throw new AnchorError('CONTEXT_REJECTED', '取件参数不完整（需要 path / start / end）');
      }

      const source = await deps.cache.acquire(filePath);
      const from = Math.max(1, Math.trunc(start));
      const to = Math.min(Math.trunc(end), source.pageCount);
      if (to < from) return `（这个区间没有内容：这份 PDF 共 ${source.pageCount} 页）`;

      const blocks: string[] = [`文件：${filePath}（共 ${source.pageCount} 页）`];
      for (let page = from; page <= to; page += 1) {
        // 空白页也给出页头：模型要靠页头对齐页号，缺一页会让它把后面的内容整体错位
        blocks.push(pageHeader(page), pageBody(await source.page(page)));
      }
      const text = blocks.join('\n');
      // 字符护栏（D98）：截断说明写在末尾，模型看得见自己拿到的是哪一段
      if (text.length > MAX_FETCH_CHARS) {
        return (
          text.slice(0, MAX_FETCH_CHARS) +
          `\n……（取件内容过长，已截断到前 ${MAX_FETCH_CHARS} 字符。要读后面的部分，请改取更小的页范围。）`
        );
      }
      return text;
    },

    async pageCount(filePath: string): Promise<number | null> {
      try {
        return (await deps.cache.acquire(filePath)).pageCount;
      } catch (err) {
        // 打不开就当"不知道页数" → §3.3 跳过那条上界检查，而不是让讲解失败。
        // **但原因必须留下**（D74）：这条 catch 静默过一次，代价是排查时手上什么都没有。
        deps.onError?.(`取不到这份 PDF 的页数（${(err as Error).message}）—— 无法按页取件`);
        return null;
      }
    },

    async textInBBox(filePath: string, page: number, bbox: BBox): Promise<string | null> {
      const source = await deps.cache.acquire(filePath);
      const text = await source.page(page);
      if (!text) return null;
      const extracted = textInBBox(text.items, bbox);
      return extracted.trim() === '' ? null : extracted;
    },
  };
}
