/**
 * Ports：保证 adapters/ 与 orchestrator/ 零 vscode 依赖。
 * 事实源：docs/CONTRACTS.md §2。
 *
 * @anchor 【本文件全部为新增，非规范原文】——规范未定义 ports 层，
 *         这是我们为"核心零 vscode 依赖"加的抽象（DECISIONS.md D19）。
 *         真实现在 packages/extension-anchor/src/vscode/ports/。
 *         adapters 只依赖这里的接口，因此可在 Node 里直接测。
 */

import type { CodeLocation, Location } from './types.ts';

export interface EditorSelection {
  filePath: string;
  lineStart: number;      // 1-based, inclusive
  lineEnd: number;        // 1-based, inclusive
  text: string;           // 选中行原文（含行尾换行）
}

export interface EditorPort {
  getSelection(): Promise<EditorSelection | null>;
  getActiveFilePath(): Promise<string | null>;
  revealLocation(loc: CodeLocation, opts?: { inCenter?: boolean }): Promise<void>;
  /** 用于 staleness 检测：讲解期间文件被改则标记该步失效，而不是高亮错行 */
  documentTextHash(filePath: string): Promise<string | null>;
}

export interface FileSystemPort {
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
}

export interface ImageRendererPort {
  /** 第二层视觉兜底；未注入时 PDFAdapter 退化为纯文本 */
  renderRegion(sourceId: string, location: Location): Promise<string | null>;   // 返回 dataURL
}
