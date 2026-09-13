/**
 * 取件校验。事实源：docs/CONTRACTS.md §3.2（**冻结**）。
 *
 * @anchor 五条规则的实现，**一条都不许松**：这是"模型不许漫游"的唯一闸门。
 *         尤其规则 3（`params.path` 必须等于锚点文件）—— 松掉它，模型就能
 *         顺着一次 tool_call 读到仓库里的任意文件。
 *
 * **拒绝不抛错**（D29）：返回 `{ accepted: false, reason }`，由编排层回灌成一条工具结果，
 * 让模型自我纠正。这条路径必须能走通，否则模型的一次越界就等于整次讲解失败。
 *
 * 本文件属 orchestrator/，**禁止 import 'vscode'**。
 */

import type { AdapterCapabilities, Anchor, ContextRequest } from '@anchor/core';
import { isCodeLocation, isPDFLocation } from '@anchor/core';
import { samePath } from '../paths.ts';

/** 已经取过的区间。用于规则 4 的去重 —— 连同**内容**一起存，好回灌给模型。 */
export interface FetchedSpan {
  type: ContextRequest['type'];
  /** `file` 用路径；`page_range` 为 null */
  path: string | null;
  start: number;
  end: number;
  content: string;
}

export interface ContextFetchState {
  /** 规则 1 的依据：`req.type` 必须在这里面（§3.1 的能力矩阵） */
  capabilities: AdapterCapabilities;
  /** 规则 2 的上界。取不到传 null（此时 `page_range` 一律拒绝，见下） */
  pageCount: number | null;
  /** 规则 3 的行上界。取不到传 null 则跳过该上界检查 */
  documentLineCount?: number | null;
  fetched: readonly FetchedSpan[];
  /** 已经用掉的取件轮数（1-based 计数，即"下一轮是第几轮"减一） */
  roundsUsed: number;
  /** 规则 5 的上限，来自 `anchorExplain.maxFetchRounds` */
  maxFetchRounds: number;
}

export type ContextDecision =
  | { accepted: true; request: ContextRequest }
  /** `content` 只在去重命中时给：不重复取，但把上次的内容原样再回灌一次 */
  | { accepted: false; reason: string; content?: string };

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1;
}

/** `file` 且没给 path 时补上锚点文件 —— §8 的 schema 里没有 path 这一项，见下面的规则 3 */
function withImplicitPath(req: ContextRequest, anchor: Anchor): ContextRequest {
  if (req.type !== 'file' || typeof req.params.path === 'string') return req;
  if (!isCodeLocation(anchor.location)) return req;
  return { ...req, params: { ...req.params, path: anchor.location.filePath } };
}

function spanOf(req: ContextRequest): { path: string | null; start: number; end: number } | null {
  const start = req.params.start;
  const end = req.params.end;
  if (!isPositiveInt(start) || !isPositiveInt(end)) return null;
  const path = typeof req.params.path === 'string' ? req.params.path : null;
  return { path, start, end };
}

/**
 * 五条规则的执行顺序是**刻意排的**：类型 → 形状/边界 → 去重 → 频率。
 *
 * 去重排在频率**前面**：已经取过的区间即使此刻轮数用尽，也应该把上次的内容再回灌一次 ——
 * 那比回一句"已达上限"对模型有用得多，且不花任何额外成本（不发起新的读取）。
 */
export function validateContextRequest(
  req: ContextRequest,
  anchor: Anchor,
  state: ContextFetchState,
): ContextDecision {
  const reject = (reason: string): ContextDecision => ({ accepted: false, reason });

  // 规则 1：类型必须在这个适配器声明的能力里（§3.1）
  if (!state.capabilities.contextTypes.includes(req.type)) {
    return reject(
      `这个来源只支持 ${state.capabilities.contextTypes.join(' / ')}，不支持 ${req.type}`,
    );
  }

  const span = spanOf(req);
  if (!span) {
    return reject(`start / end 必须是 ≥1 的整数，收到 start=${JSON.stringify(req.params.start)}、end=${JSON.stringify(req.params.end)}`);
  }
  if (span.start > span.end) {
    return reject(`区间反了：start=${span.start} 大于 end=${span.end}`);
  }

  if (req.type === 'page_range') {
    // 规则 2
    if (!isPDFLocation(anchor.location)) {
      return reject('锚点不是 PDF 位置，不能按页取件');
    }
    if (state.pageCount === null) {
      return reject('无法确定这份文档的总页数，拒绝按页取件');
    }
    if (span.end > state.pageCount) {
      return reject(`页码范围越界：end=${span.end}，总页数 ${state.pageCount}`);
    }
    if (span.end - span.start + 1 > state.capabilities.maxSpan) {
      return reject(`一次最多取 ${state.capabilities.maxSpan} 页，这次要了 ${span.end - span.start + 1} 页`);
    }
  } else if (req.type === 'file') {
    // 规则 3：**不许漫游到别的文件**。这是本文件存在的主要理由。
    if (!isCodeLocation(anchor.location)) {
      return reject('锚点不是代码位置，不能按文件取件');
    }
    // 没给 path = "就要锚点这个文件"（§8 的 schema 里没声明 path，模型也就不必给）。
    // 给了 path 就必须逐字等于锚点文件 —— 否则就是漫游。
    // 大小写与斜杠方向按 `samePath` 的立场忽略（Windows 上严格比较会把同一个文件判成两个）。
    if (span.path !== null && !samePath(span.path, anchor.location.filePath)) {
      return reject(
        `只允许取锚点所在的文件（${anchor.location.filePath}），收到 ${JSON.stringify(span.path)}`,
      );
    }
    // §3.2 规则 3 只冻结了 path 一项；行上界是 S3 补的实现约定（见 CONTRACTS §3.2 注）
    if (state.documentLineCount != null && span.end > state.documentLineCount) {
      return reject(`行号越界：end=${span.end}，文档共 ${state.documentLineCount} 行`);
    }
  } else {
    // dom_subtree：web 本次不接入（D7）。走到这里说明 capabilities 被改过，明说而不是静默。
    return reject(`${req.type} 本次不实现`);
  }

  // 规则 4：去重。区间重叠就不重复取，改把已有内容回灌。
  const overlap = state.fetched.find(
    (f) => f.type === req.type && f.path === span.path && f.start <= span.end && span.start <= f.end,
  );
  if (overlap) {
    return {
      accepted: false,
      reason: `${overlap.start}-${overlap.end} 这个区间已经取过了，不要重复请求`,
      content: overlap.content,
    };
  }

  // 规则 5：频率
  if (state.roundsUsed >= state.maxFetchRounds) {
    return reject(`取件次数已达上限（${state.maxFetchRounds} 次），请基于现有信息作答`);
  }

  // 放行时返回**归一化**过的请求（file 补上锚点路径），
  // 这样适配器拿到的 params 一定是完整的 —— 它不必再猜"没给 path 是什么意思"
  return { accepted: true, request: withImplicitPath(req, anchor) };
}
