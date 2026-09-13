/**
 * 已打开的 PDF 文档缓存。
 *
 * @anchor 为什么需要它：一次讲解里模型可能取件两三轮，**每一轮都是同一份文件**；
 *         而打开一个 30 页 PDF 要读盘 + 解析交叉引用表（实测数十毫秒）。
 *         没有缓存，用户会在"请求中"的转圈里白等两三倍时间。
 *
 * 为什么是**有界 LRU** 而不是一个 Map：用户会在一节课里翻十几份 PDF。
 * 不设上限就是内存泄漏（每份都攥着一个 pdf.js 句柄）；上限太小又等于没缓存。
 * 淘汰时必须 `dispose()`，否则句柄不释放 —— 这是这类缓存最经典的漏。
 *
 * **禁止 import 'vscode'**，也**不 import pdf.js**（loader 是注入的）。
 */

import { normPath } from '@anchor/core';
import type { OpenPDFSource, PDFSource } from './PDFSource.ts';

export const DEFAULT_CACHE_LIMIT = 4;

export interface PdfDocumentCache {
  /** 取一份已打开的 PDF；同一路径复用同一句柄 */
  acquire(filePath: string): Promise<PDFSource>;
  /** 当前缓存的份数，供单测断言淘汰行为 */
  size(): number;
  /** 主动放掉某一份（文件被改/删时） */
  evict(filePath: string): void;
  /** 全部放掉（扩展停用） */
  disposeAll(): void;
}

export function createPdfDocumentCache(
  open: OpenPDFSource,
  opts: { limit?: number } = {},
): PdfDocumentCache {
  const limit = Math.max(1, opts.limit ?? DEFAULT_CACHE_LIMIT);
  /** 按使用顺序排列：Map 的插入序 + "命中就重插"= LRU */
  const entries = new Map<string, PDFSource>();
  /** 并发去重：两份面板同时要同一份 PDF 时不该打开两次 */
  const opening = new Map<string, Promise<PDFSource>>();

  function touch(key: string, source: PDFSource): void {
    entries.delete(key);
    entries.set(key, source);
  }

  function evictOldestIfNeeded(): void {
    while (entries.size > limit) {
      const oldest = entries.keys().next();
      if (oldest.done) return;
      const key = oldest.value;
      const source = entries.get(key);
      entries.delete(key);
      // 淘汰**必须**释放句柄。漏掉这一句就是内存泄漏，而且只在大文件上才看得出来。
      source?.dispose();
    }
  }

  return {
    async acquire(filePath: string): Promise<PDFSource> {
      const key = normPath(filePath);

      const cached = entries.get(key);
      if (cached) {
        touch(key, cached);
        return cached;
      }

      const inFlight = opening.get(key);
      if (inFlight) return inFlight;

      const pending = open(filePath)
        .then((source) => {
          touch(key, source);
          evictOldestIfNeeded();
          return source;
        })
        .finally(() => {
          opening.delete(key);
        });

      opening.set(key, pending);
      return pending;
    },

    size: () => entries.size,

    evict(filePath: string): void {
      const key = normPath(filePath);
      const source = entries.get(key);
      entries.delete(key);
      source?.dispose();
    },

    disposeAll(): void {
      for (const source of entries.values()) source.dispose();
      entries.clear();
    },
  };
}
