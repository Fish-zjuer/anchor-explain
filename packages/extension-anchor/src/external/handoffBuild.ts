/**
 * 位置清单 → 临时文档的编排。事实源：docs/DECISIONS.md D130。
 *
 * @anchor 这个文件把三个纯函数模块串起来（解析 → 读文件 → 扩到函数 → 拼文档），
 *         并且**只做编排**：不碰 `vscode`（读文件通过注入的 `readText`），
 *         于是整条链路能被 `node --test` 直测 —— 用户看预览之前，我们先把"内容对不对"钉住。
 *
 *         它对应 `commands.ts` 里那一步：用户点了"生成临时文件"，我们**当场**把代码读出来
 *         （用户问过"什么叫读出来"—— 就是这一步：外部 Agent 给的只是**坐标**，
 *         要回到硬盘上把那个坐标对应的**内容**取出来，才能拼成能选中、能讲解的文档）。
 */

import { parseHandoff, MAX_HANDOFF_CHARS } from './handoffParse.ts';
import type { HandoffRange } from './handoffParse.ts';
import { expandToBlock } from './expandToBlock.ts';
import { buildHandoffDoc } from './handoffDoc.ts';
import type { HandoffDoc, HandoffSegment } from './handoffDoc.ts';

export interface BuildHandoffDeps {
  /** 读一个文件。失败时抛错（调用方转成人话）。 */
  readText: (path: string) => Promise<string>;
  /**
   * 把外部 Agent 给的路径**解析成绝对路径**。
   *
   * @anchor 为什么这也要注入：解析规则（相对工作区根？相对锚点目录？绝对路径直接认？）
   *         是宿主侧的政策，而且依赖 `vscode.workspace` 的状态。纯逻辑部分留在这里，
   *         环境相关的部分由调用方给 —— 这样测试可以喂一个确定性的实现。
   */
  resolvePath: (raw: string) => string;
}

export interface BuildHandoffResult {
  /** 拼好的文档（含逐行来源表） */
  readonly doc: HandoffDoc;
  /** 解析阶段认不出的行（必须回给用户 —— 见 `handoffParse` 的注释） */
  readonly rejected: { line: number; text: string; reason: string }[];
  /** 读不到的文件：路径 + 原因。**不静默跳过** —— 用户要知道少了什么。 */
  readonly missing: { filePath: string; reason: string }[];
  /** 一共几段（扩充之后的） */
  readonly segmentCount: number;
  /** 有几段没能扩到函数边界（在文档里也标了，这里给回执用） */
  readonly unexpandedCount: number;
}

export class HandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandoffError';
  }
}

/**
 * 主流程。
 *
 * 四步（D130）：
 *   1. **解析**：文本 → 位置清单（认不出的行如实收集）
 *   2. **读文件**：每个不同的文件只读一次（同一文件的多段共用）
 *   3. **扩到函数边界**：`expandToBlock`（扩不了就如实标注）
 *   4. **拼文档**：`buildHandoffDoc`（段首标注 + 分割线 + 逐行来源表）
 *
 * 出错的地方**都不是异常**，而是结果里的 `rejected` / `missing` —— 因为"部分成功"
 * 是常态（一个文件读不到不该让其余几段也作废）。
 * 只有"一条都没解析出来"才抛 `HandoffError`：那时没有任何东西可展示。
 */
export async function buildHandoff(
  raw: string,
  deps: BuildHandoffDeps,
): Promise<BuildHandoffResult> {
  if (raw.length > MAX_HANDOFF_CHARS) {
    throw new HandoffError(
      `粘进来的内容太长（${Math.round(raw.length / 1024)}KB，上限 ${MAX_HANDOFF_CHARS / 1024}KB）—— 是不是把整个文件贴进来了？`,
    );
  }

  const { ranges, rejected } = parseHandoff(raw);
  if (ranges.length === 0) {
    throw new HandoffError(
      rejected.length > 0
        ? `没能从里面认出任何位置（第 ${rejected[0]!.line} 行开始就不对）—— 要不要看看给外部 Agent 的那段格式要求？`
        : '里面没有任何位置。把外部 Agent 输出的那一列位置粘进来。',
    );
  }

  // 每个文件读一次（同一文件的多段共用一份内容）
  const cache = new Map<string, string | null>();
  const missing: { filePath: string; reason: string }[] = [];

  async function contentOf(rawPath: string): Promise<string | null> {
    const key = rawPath;
    if (cache.has(key)) return cache.get(key)!;
    let text: string | null = null;
    try {
      const abs = deps.resolvePath(rawPath);
      text = await deps.readText(abs);
    } catch (err) {
      text = null;
      missing.push({ filePath: rawPath, reason: err instanceof Error ? err.message : String(err) });
    }
    cache.set(key, text);
    return text;
  }

  const segments: HandoffSegment[] = [];
  for (const range of ranges as HandoffRange[]) {
    const content = await contentOf(range.filePath);
    if (content === null) continue; // 已经记进 missing 了

    const expanded = expandToBlock(content, range.lineStart, range.lineEnd);
    const lines = content.split(/\r?\n/);
    const text = lines.slice(expanded.lineStart - 1, expanded.lineEnd).join('\n');
    segments.push({
      filePath: range.filePath,
      lineStart: expanded.lineStart,
      lineEnd: expanded.lineEnd,
      text,
      expanded: expanded.expanded,
    });
  }

  if (segments.length === 0) {
    throw new HandoffError(
      `认出了 ${ranges.length} 处位置，但一个文件都没读到 —— 第一个：${missing[0]?.filePath ?? '？'}（${missing[0]?.reason ?? '原因未知'}）`,
    );
  }

  return {
    doc: buildHandoffDoc(segments),
    rejected,
    missing,
    segmentCount: segments.length,
    unexpandedCount: segments.filter((s) => !s.expanded).length,
  };
}
