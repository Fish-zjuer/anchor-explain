/**
 * 一页 PDF 的**文字层**。事实源：docs/CONTRACTS.md §1（`PDFLocation`）。
 *
 * @anchor 这个接口存在的唯一理由是**可测**：`PDFAdapter` 的取件逻辑（页码范围、
 *         页头、越界处理）不该依赖一个真的 30 页 PDF，更不该依赖 pdf.js。
 *         把"一页能给我什么"抽成这个形状之后：
 *           - 单测喂一个手搓的 `PDFSource`，把逻辑覆盖干净
 *           - 真实现（`pdfjsSource.ts`）只负责把 pdf.js 的返回搬过来
 *           - 将来换 pdf.js 版本或换别的解析器，只动那一个文件
 *
 * **禁止 import 'vscode'**，也**不 import pdf.js**。
 */

import type { BBox } from '@anchor/core';
import type { TextItem } from './pageTextIndex.ts';

/** 一页：归一化后的文字块 + 按阅读顺序拼好的文本 */
export interface PDFPageText {
  /** 1-based，与 `PDFLocation.page` 同口径 */
  page: number;
  /** 这一页的文字，行与行之间**已补换行**（`joinLines` 的产物） */
  text: string;
  /** 归一化坐标下的文字块，供 `bbox → 文本` 用（S7 的第二层） */
  items: readonly TextItem[];
  /** 页面尺寸（点）。取件时不必用，但排查"bbox 为什么命不中"时是唯一线索 */
  viewport: { width: number; height: number };
}

export interface PDFSource {
  readonly pageCount: number;
  /** 取第 `page` 页。越界返回 null（不抛 —— 越界是调用方该判的事） */
  page(page: number): Promise<PDFPageText | null>;
  /** 释放底层句柄。缓存淘汰与扩展停用时调 */
  dispose(): void;
}

/** 打开一份 PDF。真实现见 `pdfjsSource.ts`；单测注入假实现 */
export type OpenPDFSource = (filePath: string) => Promise<PDFSource>;

/** 给 `textInBBox` 用的入参，避免它去依赖整个 PDFPageText */
export interface PageTextLike {
  items: readonly TextItem[];
}

export type { BBox };
