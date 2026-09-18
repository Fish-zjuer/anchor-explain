/**
 * 核心类型契约。事实源：docs/CONTRACTS.md §1 与 §3。
 * 改动任何类型签名，必须同步 docs/CONTRACTS.md。
 *
 * @anchor 本文件是 §1/§3 类型的事实源，且不得 import 'vscode'。
 *         §5 的消息协议类型（WalkthroughState / HostToSidebar 等）**不在**这里，
 *         按 CONTRACTS §9 的路由，于 S1 落地到 extension-anchor 的 protocol.ts。
 */

// ─────────────────────────────────────────────────────────────
// §1.1 规范原文部分（声明与规范逐字一致；仅补注释，未增删任何字段）
// ─────────────────────────────────────────────────────────────

export type SourceType = 'pdf' | 'web' | 'code';

export interface PDFLocation {
  page: number;                              // 1-based
  bbox: [number, number, number, number];     // 归一化 0-1: x1,y1,x2,y2
  // 【S7 加法扩展，非规范原文，可选】文档在哪。
  // 为什么必须有：`bbox`/`page` 只说得清"页面上的哪一块"，说不清"哪一份文档" ——
  // 而取件（S7）要按路径去读文件、判页数也要打开它。线1 拿到的 `Anchor` 里
  // 只有 `sourceId`（内容指纹）与 `sourceName`（basename），都定位不到文件。
  // 与 `CodeLocation.filePath` 对称：那条线从一开始就有。
  // **可选**：老的锚点（S5 之前造出来的）没有它，于是所有读它的地方都必须能退化。
  filePath?: string;
}

export interface WebLocation {
  url: string;
  selector: string;
  scrollY: number;
}

export interface CodeLocation {
  filePath: string;
  lineStart: number;                         // 1-based, inclusive
  lineEnd: number;                           // 1-based, inclusive
}

export type Location = PDFLocation | WebLocation | CodeLocation;

export interface Anchor {
  sourceType: SourceType;
  sourceId: string;          // 文档指纹，用于会话记忆
  sourceName: string;        // 显示名
  location: Location;
  capturedImage?: string;    // base64，第二层才用
  extractedText?: string;    // 第一层优先
  neighborHint?: string;     // 如 "第 23 页附近"
  /**
   * 【新增，非规范原文】用户想追的那条线（D79）。
   *
   * @anchor 为什么放在 `Anchor` 上，而不是给 `ExplainProvider` 加第二个参数：
   *         `ExplainProvider` 的签名是"两侧完全一致"的接缝（见 ports.ts 那段），
   *         加参数要同时改替身、orchestrator、命令层与**所有既有测试的调用点**。
   *         而"用户想讲哪条线"与 `neighborHint` / `extractedText` 是**同一类东西**：
   *         都是"这一份锚点自带的、影响讲解怎么写的附加信息"，都随锚点一起流动。
   *         放这里之后，`ExplainProvider` 一行不动。
   *
   *         语义：用户自己写的一句话，说明"这段代码里我只关心什么"。
   *         一个文件往往做很多事，用户可能只想快速定位某一个功能 ——
   *         没有它，模型会把整段从头讲一遍，用户得听一堆他不要的东西。
   *         **可选**：不写就是老行为（整段讲），所有读它的地方都必须能退化。
   */
  focus?: string;
  /**
   * 【新增，非规范原文】多段选择时，**每一段**的行区间（D80）。
   *
   * @anchor 为什么 `location` 之外还要它：`location` 是各段的**并集外框**，
   *         合并之后模型已经看不出"中间那 20 行其实没被选中"，于是会去讲它们。
   *         这一段列表是唯一能说清"用户选的就是这几块"的东西。
   *
   *         顺序**按行号升序**（由 `mergeSegments` 保证）——
   *         模型从上往下读，读者也从上往下读，两边一致才对得上。
   *
   *         **可选**：老锚点（只有一段）没有它 —— 那时 `location` 本身就是那一段，
   *         两者等价，不值得再造一个长度为 1 的数组。
   */
  segments?: CodeLocation[];
}

export interface ContextRequest {
  type: 'page_range' | 'dom_subtree' | 'file';
  params: Record<string, any>;
  reason: string;
}

export interface WalkthroughStep {
  location: Location;
  text: string;
  color?: string;
  // ↓ 【新增，非规范原文】§1.2 加法扩展
  title?: string;              // 步标题
  intro?: string;              // 步级引入语（对应 MCP Walkthrough 的 explanation）
  highlights?: SubHighlight[]; // 子高亮序列
}

export interface ExplanationResult {
  steps: WalkthroughStep[];
  summary: string;
  confidence: number;        // 0-1
  // ↓ 【新增，非规范原文】§1.2 加法扩展
  title?: string;            // 整段讲解标题
}

// ─────────────────────────────────────────────────────────────
// §1.2 加法扩展【以下全部为新增，非规范原文】
// 理由见 docs/PRIOR-ART.md §1.1
// ─────────────────────────────────────────────────────────────

/** 【新增，非规范原文】 */
export type HighlightEmphasis = 'primary' | 'context' | 'definition' | 'caveat';

/** 【新增，非规范原文】 */
export interface SubHighlight {
  location: Location;
  narration: string;
  emphasis?: HighlightEmphasis;   // 映射到主题感知配色，见 CONTRACTS §4.3
}

// ─────────────────────────────────────────────────────────────
// §1.3 联合类型收窄（仅说明，无新增类型）
// 实际接入的来源只有 code 与 pdf。WebLocation 保留声明以备后续，
// 本次不实现、不接入；也不为它另建专用 union——需要时直接用 Location。
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// §3 适配器接口
// ─────────────────────────────────────────────────────────────

/** 【新增，非规范原文】能力声明，用于取件校验 */
export interface AdapterCapabilities {
  contextTypes: ContextRequest['type'][];   // pdf → ['page_range']；code → ['file']
  maxSpan: number;                          // page_range 的最大页跨度，默认 5
}

/**
 * 【规范原文】detect 保持同步，与规范一字一致，不要改成 Promise。
 * 依据：CodeAdapter 判据是 activeTextEditor（属性，同步）；
 *       PDFAdapter 判据是宿主内存中的已打开 PDF 会话集合（同步）。
 *       若未来确需异步，属契约变更，须经用户确认。
 */
export interface SourceAdapter {
  type: SourceType;
  detect(): boolean;                        // 当前环境是否适用
  capture(): Promise<Anchor>;               // 截图 + 产出 Anchor
  fetchContext(req: ContextRequest): Promise<string>;   // 取件
  // 【新增，非规范原文】挪到末尾，以保持规范四个字段的绝对顺序不变
  capabilities: AdapterCapabilities;
}

// ─────────────────────────────────────────────────────────────
// §1.4 类型守卫
// ─────────────────────────────────────────────────────────────

export function isPDFLocation(loc: Location): loc is PDFLocation {
  const c = loc as Partial<PDFLocation>;
  return typeof c.page === 'number' && Array.isArray(c.bbox) && c.bbox.length === 4;
}

export function isCodeLocation(loc: Location): loc is CodeLocation {
  const c = loc as Partial<CodeLocation>;
  return (
    typeof c.filePath === 'string' &&
    typeof c.lineStart === 'number' &&
    typeof c.lineEnd === 'number'
  );
}

export function isWebLocation(loc: Location): loc is WebLocation {
  const c = loc as Partial<WebLocation>;
  return typeof c.url === 'string' && typeof c.selector === 'string';
}
