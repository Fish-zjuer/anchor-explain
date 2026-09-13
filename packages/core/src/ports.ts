/**
 * Ports：保证 adapters/ 与 orchestrator/ 零 vscode 依赖。
 * 事实源：docs/CONTRACTS.md §2。
 *
 * @anchor 【本文件全部为新增，非规范原文】——规范未定义 ports 层，
 *         这是我们为"核心零 vscode 依赖"加的抽象（DECISIONS.md D19）。
 *         真实现在 packages/extension-anchor/src/vscode/ports/。
 *         adapters 只依赖这里的接口，因此可在 Node 里直接测。
 */

import type { Anchor, CodeLocation, ExplanationResult, Location } from './types.ts';

export interface EditorSelection {
  filePath: string;
  lineStart: number;      // 1-based, inclusive
  lineEnd: number;        // 1-based, inclusive
  text: string;           // 选中行原文，多行以 \n 连接，不含末尾换行（与 CONTRACTS §2 一致）
}

export interface EditorPort {
  getSelection(): Promise<EditorSelection | null>;
  /**
   * 【新增，非规范原文】把**整份文档**也表达成一个 `EditorSelection`
   * （`lineStart: 1`、`lineEnd: 总行数`、`text: 全文`），供确认里的「整个文件」用。
   *
   * 为什么复用一个类型而不是新开一个 `getDocumentText()`：`capture()` 的产出
   * （`Anchor`）只认「一个行区间 + 一段原文」，两种范围在它眼里是同一件事。
   * 多一个形状就多一条分支，而这条分支的差别只在"谁来定这个区间"。
   *
   * 没有活动编辑器（或编辑器不是文本编辑器）→ null。
   * 实现**必须优先取内存里的文档**（与 `documentTextHash` 同一条理由）：
   * 用户改了还没保存时，要讲的是他眼前那一份，不是磁盘上那一份。
   */
  getDocumentSelection(): Promise<EditorSelection | null>;
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

/**
 * 【新增，非规范原文】讲解来源的边界 —— 也就是"AI 从哪来"这一问的接缝。
 *
 * S1/S2 由 `fakes/fakeProvider.ts` 实现（返回写死的 ExplanationResult）；
 * S3 由 orchestrator 循环实现（真实 AI + fetch_context 取件）。
 *
 * 之所以让两侧签名完全一致：这样 S3 只替换**调用点上的一行**，
 * 中间的 校验 → 会话 → decoration → 侧边栏 → 状态栏 全链路不动（SLICES.md 防返工约定）。
 */
export type ExplainProvider = (anchor: Anchor) => Promise<ExplanationResult>;
