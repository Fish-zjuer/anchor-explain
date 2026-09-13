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
import {
  basenameOf,
  dirnameOf,
  isCodeLocation,
  isPDFLocation,
  normPath,
  resolveCandidatePaths,
  samePath,
} from '@anchor/core';

/**
 * 跨文件取件的范围（`anchorExplain.fetchScope`，S9a）。
 *
 * @anchor 用户的原话是"没有跨文件的理解啊，像是嵌入式等等，很多分散的代码" —— 而嵌入式里
 *         宏在 `config.h`、结构体在 `ring_buffer.h`、调用者在别的 `.c`，只看锚点文件讲不出
 *         "数据从哪来、给谁用"。所以规则从"只许锚点文件"松成"**逻辑相关**"。
 *         **相关性由模型判断（我们教它判据），这里只管边界。**
 */
export type FetchScope = 'related' | 'same-dir' | 'off';

export interface ContextFetchPolicy {
  /** `related` = 工作区内任意文本文件；`same-dir` = 只允许锚点文件所在目录；`off` = 只允许锚点文件 */
  scope: FetchScope;
  /** 允许的根（工作区目录）。空数组 = 跨文件关闭（任何别的文件都拒） */
  roots: readonly string[];
  /** 单次取件最多几行（防"把这个文件整个给我"） */
  maxLines: number;
}

/** 缺省策略：**只允许锚点文件**。产品默认是 `related`（在 `commands.ts` 里按配置构造）。 */
export const RESTRICTED_POLICY: ContextFetchPolicy = { scope: 'off', roots: [], maxLines: 60 };

/** 依赖、构建产物、版本控制目录：不读。它们是噪音，且常常巨大。 */
const DENIED_DIR_SEGMENTS = ['.git', 'node_modules', 'dist', 'build', 'out', '.vscode-test', '.tmp-preview'];

/**
 * 按文件名不读的：密钥与凭据。
 *
 * @anchor 这一条不是"洁癖"，是这个功能**必须有**的：模型能读工作区里的任意文件之后，
 *         `.env`、私钥、`.npmrc` 里的 token 都在它的射程内。宁可少读一个文件，
 *         也不要让一次讲解把密钥发到远端模型去。
 */
const DENIED_FILE_PATTERNS: readonly RegExp[] = [
  /^\.env/i,
  /\.pem$/iu,
  /\.key$/iu,
  /\.p12$/iu,
  /\.pfx$/iu,
  /\.jks$/iu,
  /^id_(rsa|dsa|ecdsa|ed25519)/iu,
  /^\.npmrc$/iu,
  /^\.netrc$/iu,
  /^credentials(\.|$)/iu,
];

function isDeniedPath(filePath: string): boolean {
  const segments = normPath(filePath).split('/');
  if (segments.some((segment) => DENIED_DIR_SEGMENTS.includes(segment))) return true;
  const name = basenameOf(filePath);
  return DENIED_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

/** 已经取过的区间。用于规则 4 的去重 —— 连同**内容**一起存，好回灌给模型。 */
export interface FetchedSpan {
  type: ContextRequest['type'];
  /** `file` 用路径；`page_range` 为 null */
  path: string | null;
  start: number;
  end: number;
  content: string;
}

/**
 * 一句人话指认"取过的是哪一段"：文件用**文件名 + 行范围**，PDF 用页码。
 *
 * @anchor 跨文件之后"1-60"是有歧义的（哪个文件的 1-60？）—— 而这条文案既回灌给模型，
 *         也是用户在输出面板/侧边栏里看到的那句。含糊的指认会把两件事同时毁掉：
 *         模型可能以为"这份文件读过了"而不再申请，看日志的人也复核不了它到底读了哪儿（D68）。
 */
function describeFetched(span: Omit<FetchedSpan, 'content'>): string {
  if (span.path !== null) return `${basenameOf(span.path)} 的 ${span.start}-${span.end} 行`;
  return `第 ${span.start}-${span.end} 页`;
}

export interface ContextFetchState {
  /** 规则 1 的依据：`req.type` 必须在这里面（§3.1 的能力矩阵） */
  capabilities: AdapterCapabilities;
  /** 跨文件取件的边界（S9a）。不传 = `RESTRICTED_POLICY`（只允许锚点文件） */
  policy?: ContextFetchPolicy;
  /** 规则 2 的上界。取不到传 null（此时 `page_range` 一律拒绝，见下） */
  pageCount: number | null;
  /** 规则 3 的行上界。取不到传 null 则跳过该上界检查。**只对锚点文件成立**（别的文件由适配器夹住） */
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

/**
 * 放行：把 `file` 请求的 `path` **归一成绝对路径**（S9a 起它可能是别的文件）。
 * 适配器因此不必猜"没给 path 是什么意思"，也不必再解析一次相对路径。
 */
function acceptNormalized(req: ContextRequest, filePath: string): ContextDecision {
  return { accepted: true, request: { ...req, params: { ...req.params, path: filePath } } };
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

  /** `file` 请求最终指向的**绝对路径**（S9a：可能不是锚点文件）。别的类型保持 undefined */
  let resolvedFile: string | undefined;

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
    // 规则 3（S9a 改写）：允许"锚点文件 ∪ 逻辑相关的其他文件"，边界由 policy 给。
    if (!isCodeLocation(anchor.location)) {
      return reject('锚点不是代码位置，不能按文件取件');
    }
    const policy = state.policy ?? RESTRICTED_POLICY;
    const anchorFile = anchor.location.filePath;

    // 没给 path = "就要锚点这个文件"（§8 的 schema 里 path 是可选，模型也就不必给）
    if (span.path === null || samePath(span.path, anchorFile)) {
      // 行上界只对锚点文件成立：别的文件的行数校验层拿不到（那是同步纯函数），
      // 由适配器夹住 —— 它本来就会把 end 夹到文件末尾（见 CodeAdapter.fetchContext）
      if (state.documentLineCount != null && span.end > state.documentLineCount) {
        return reject(`行号越界：end=${span.end}，文档共 ${state.documentLineCount} 行`);
      }
      resolvedFile = anchorFile;
    } else if (policy.scope === 'off') {
      return reject(`只允许取锚点所在的文件（${anchorFile}），收到 ${JSON.stringify(span.path)}`);
    } else {
      // 解析成绝对路径，并且**只用闸门批准过的那一个**（候选里剩下的同样都在允许范围内）
      const candidates = resolveCandidatePaths(span.path, anchorFile, policy.roots);
      if (candidates.length === 0) {
        return reject(
          `${JSON.stringify(span.path)} 不在允许的范围内。只能取锚点所在的文件，或者工作区里的其他文件 —— ` +
            '写相对路径时按锚点文件所在目录算，例如 "ring_buffer.h" 或 "include/ring_buffer.h"。',
        );
      }
      const target = candidates[0]!;

      if (policy.scope === 'same-dir' && !samePath(dirnameOf(target), dirnameOf(anchorFile))) {
        return reject(
          `当前设置下只允许取锚点所在目录（${dirnameOf(anchorFile)}）里的文件，收到 ${target}`,
        );
      }
      if (isDeniedPath(target)) {
        // 密钥/依赖/构建产物：不读，并说清是哪一类，免得模型反复试
        return reject(`${basenameOf(target)} 按约定不读（密钥、依赖或构建产物）`);
      }
      resolvedFile = target;
    }

    // 行数上限放在**路径判定之后**：要了别的文件时该先说"文件不对"，
    // 而不是先抱怨"要的行数太多"（那会把模型的注意力引到错的方向）
    if (span.end - span.start + 1 > policy.maxLines) {
      return reject(`一次最多取 ${policy.maxLines} 行，这次要了 ${span.end - span.start + 1} 行`);
    }
    // 这里**不 return**：去重（规则 4）与频率（规则 5）对两种来源都要跑。
    // （第一版在这里提前放行了，于是"轮数用尽"和"重复取件"两条规则被整个跳过 —— 被单测抓住。）
  } else {
    // dom_subtree：web 本次不接入（D7）。走到这里说明 capabilities 被改过，明说而不是静默。
    return reject(`${req.type} 本次不实现`);
  }

  // 规则 4：去重。区间重叠就不重复取，改把已有内容回灌。
  // 比对用**解析后的文件**（`resolvedFile`），否则同一个文件换个写法就绕过去重了。
  const sameFile = (f: FetchedSpan): boolean =>
    resolvedFile !== undefined ? f.path !== null && samePath(f.path, resolvedFile) : f.path === span.path;
  const overlap = state.fetched.find(
    (f) => f.type === req.type && sameFile(f) && f.start <= span.end && span.start <= f.end,
  );
  if (overlap) {
    return {
      accepted: false,
      // 跨文件之后**必须带上文件名**：光说"1-60 这个区间已经取过了"，模型（以及看日志的人）
      // 分不清是哪个文件的 1-60 —— 用户的截图里就是这一句，读起来像在说同一份文件（D68）
      reason: `${describeFetched(overlap)} 已经取过了，不要重复请求，直接用它给结论`,
      content: overlap.content,
    };
  }

  // 规则 5：频率
  if (state.roundsUsed >= state.maxFetchRounds) {
    return reject(`取件次数已达上限（${state.maxFetchRounds} 次），请基于现有信息作答`);
  }

  // 放行时返回**归一化**过的请求（file 的 path 一定是绝对路径），
  // 这样适配器拿到的 params 一定是完整的 —— 它不必再猜"没给 path 是什么意思"，
  // 也不必再解析一次相对路径。
  return resolvedFile === undefined ? { accepted: true, request: req } : acceptNormalized(req, resolvedFile);
}
