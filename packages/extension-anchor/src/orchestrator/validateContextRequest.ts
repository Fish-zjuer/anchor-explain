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
  /** 单次取件最多几行（防"把这个文件整个给我"）。**由配置给**（`anchorExplain.maxFetchLines`） */
  maxLines: number;
}

/**
 * 单次取件的行数上限：默认值与硬上限。
 *
 * @anchor 为什么默认从 60 改成 400（D71）：用户在**真工程**上实测，5 轮取件里有 3 轮被
 *         "一次最多取 60 行"挡掉（它想读 `esc.h` 1-80、`dshot_dma.h` 1-80、`transport.h` 1-70）——
 *         一个嵌入式头文件动辄一两百行，60 行连一个结构体的字段都列不全，而**每一轮被拒都白烧一次
 *         预算**（轮数上限默认 3~5）。用户的原话是"60 太少了，200 都不一定够"。
 *         硬上限 2000 行是"别把两万行的文件整个塞进上下文"的兜底（字符护栏在适配器里另有一道）。
 */
export const DEFAULT_MAX_FETCH_LINES = 400;
export const MAX_FETCH_LINES_CEILING = 2000;

/** 缺省策略：**只允许锚点文件**。产品默认是 `related`（在 `commands.ts` 里按配置构造）。 */
export const RESTRICTED_POLICY: ContextFetchPolicy = {
  scope: 'off',
  roots: [],
  maxLines: DEFAULT_MAX_FETCH_LINES,
};

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
 *         也是用户在输出面板/侧边栏/进度通知里看到的那句。含糊的指认会把两件事同时毁掉：
 *         模型可能以为"这份文件读过了"而不再申请，看日志的人也复核不了它到底读了哪儿（D68）。
 *         **导出给命令层复用**：进度通知要说同一句话，两处各写一遍早晚会说得不一样。
 */
export function describeFetched(span: { type: ContextRequest['type']; path: string | null; start: number; end: number }): string {
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
 *
 * `endOverride` 是"超上限被截断"时真正要读的末行（D71）—— 放行的请求里必须写**截断后**的值，
 * 否则日志、去重、适配器读的区间三者会跟模型要的那个对不上。
 */
function acceptNormalized(req: ContextRequest, filePath: string, endOverride?: number): ContextDecision {
  return {
    accepted: true,
    request: {
      ...req,
      params: { ...req.params, path: filePath, ...(endOverride !== undefined ? { end: endOverride } : {}) },
    },
  };
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

  /**
   * 真正要读的末行。**只有 `file` 会因超出单次上限而变小**（截断，见下面规则 3 的收尾）；
   * `page_range` 超出上限仍是拒绝（页跨度是另一种量纲，且 §3.1 的能力矩阵就是那么定的）。
   * 去重与放行都用它 —— 否则"截到 400 行"会被当成"你刚读过 1-900"。
   */
  let endForRead = span.end;

  if (req.type === 'page_range') {
    // 规则 2
    if (!isPDFLocation(anchor.location)) {
      return reject('锚点不是 PDF 位置，不能按页取件');
    }
    if (state.pageCount === null) {
      // 第二句是留给"读不到页数"这条路的（D74）：它过去只说前半句，而那半句把线索全引向
      // **那份 PDF 本身**（用户就是这么被引偏的）—— 真正的原因在线1 自己的输出通道里
      // （pdf.js 在产物里找不到它的 worker）。第一句以句号收尾：进度通知只取第一句
      // （`briefReason`），不这么写的话那句长的会被截成半截。
      return reject(
        '无法确定这份文档的总页数，拒绝按页取件。线1 读不到这份 PDF —— 输出面板「Anchor」里有一行原因。',
      );
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

    /**
     * 超出单次上限时**截到上限、照常给**，不再整条拒绝（D71）。
     *
     * @anchor 改这一条的直接理由：用户在真工程上实测，5 轮里有 3 轮被"一次最多取 60 行"整条挡掉
     *         （它想读 1-80 / 1-70），而**被拒的每一轮都白烧一次预算** —— 它下一轮还是想读同一段。
     *         截断不会误导它：适配器回灌的内容头部就写着**真实行范围**（`行 1-400（共 900 行）`），
     *         它看得见自己拿到的是哪一段；真想要后面那段可以再要（区间不同，不会被去重挡）。
     *         注意与"end 超出文档总行数"区分：那是**关于这份文件的事实错误**，
     *         说清"文档共 75 行"比默默给它 1-75 更有用（上面那条仍然是拒绝）。
     */
    const asked = span.end - span.start + 1;
    if (asked > policy.maxLines) endForRead = span.start + policy.maxLines - 1;
    // 这里**不 return**：去重（规则 4）与频率（规则 5）对两种来源都要跑。
    // （第一版在这里提前放行了，于是"轮数用尽"和"重复取件"两条规则被整个跳过 —— 被单测抓住。）
  } else {
    // dom_subtree：web 本次不接入（D7）。走到这里说明 capabilities 被改过，明说而不是静默。
    return reject(`${req.type} 本次不实现`);
  }

  // 规则 4：去重。区间重叠就不重复取，改把已有内容回灌。
  // 比对用**解析后的文件**（`resolvedFile`），否则同一个文件换个写法就绕过去重了。
  // 区间用**真正要读的那个**（截断后的）—— 否则"截到 400 行"会被当成"你刚读过 1-900"。
  const sameFile = (f: FetchedSpan): boolean =>
    resolvedFile !== undefined ? f.path !== null && samePath(f.path, resolvedFile) : f.path === span.path;
  const overlap = state.fetched.find(
    (f) => f.type === req.type && sameFile(f) && f.start <= endForRead && span.start <= f.end,
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
  // 截断过就把截断后的 end 写进放行的请求（file 分支一定会 resolvedFile）
  if (endForRead !== span.end && resolvedFile !== undefined) {
    return acceptNormalized(req, resolvedFile, endForRead);
  }
  return resolvedFile === undefined ? { accepted: true, request: req } : acceptNormalized(req, resolvedFile);
}
