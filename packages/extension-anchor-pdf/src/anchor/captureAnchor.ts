/**
 * 把一次框选组装成 `Anchor`。事实源：docs/CONTRACTS.md §1（`Anchor` / `PDFLocation`）。
 *
 * @anchor 它和线1 的 `CodeAdapter.capture()` 是同一个角色：**把"用户指了哪里"变成带地址的锚点**。
 *         线1 那边 `location` 是 `{filePath, lineStart, lineEnd}`，这边是 `{page, bbox}` ——
 *         下游（校验 / 会话 / 侧边栏）看不出区别，那正是 `Location` 联合类型的价值。
 *
 * **禁止 import 'vscode'**：它要能在 Node 里直测。
 */

import { isPDFLocation } from '@anchor/core';
import type { Anchor, PDFLocation } from '@anchor/core';
import type { BBox } from '@anchor/core';

export interface CaptureInput {
  /** 文档的绝对路径（`document.uri.fsPath`）。既是 `location` 的一部分，也是留给线1 的回取依据 */
  filePath: string;
  /** 显示名（`basenameOf` 那一套） */
  sourceName: string;
  /** 文档指纹（内容哈希）。取不到传 null，退化成路径（与线1 同一条理由） */
  sourceId: string | null;
  page: number;
  bbox: BBox;
  /** 第二层视觉兜底才用；S5 不产图，字段留着 */
  capturedImage?: string;
}

export function buildPdfAnchor(input: CaptureInput): Anchor {
  const location: PDFLocation = { page: input.page, bbox: input.bbox };

  const anchor: Anchor = {
    sourceType: 'pdf',
    sourceId: input.sourceId ?? input.filePath,
    sourceName: input.sourceName,
    location,
  };
  if (input.capturedImage) anchor.capturedImage = input.capturedImage;
  return anchor;
}

/**
 * 一句话描述框选结果，用于 S5 的即时反馈与 S6 的确认。
 *
 * **为什么要有它**：框选是一次"手感"动作，用户拖完最想知道的是"它认成了哪一块"。
 * bbox 是四个小数，对人没有意义；"第 23 页 · 左边 12%~48%、上边 8%~22%"才是有意义的。
 * 这正是 `locationLabel` 不覆盖的部分（它给 PDF 只报"第 23 页"）——
 * 因为线2 **不画框**（约束 1），所以位置必须用文字说清楚。
 */
export function describePdfAnchor(anchor: Anchor): string {
  if (!isPDFLocation(anchor.location)) return anchor.sourceName;
  const [x1, y1, x2, y2] = anchor.location.bbox;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    `${anchor.sourceName} 第 ${anchor.location.page} 页 · ` +
    `横向 ${pct(x1)}–${pct(x2)}、纵向 ${pct(y1)}–${pct(y2)}`
  );
}
