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
  isInsidePath,
  isPDFLocation,
  resolveCandidatePaths,
  resolveUnrestrictedPaths,
  samePath,
} from '@anchor/core';
import { isDeniedPath } from '../fetchDeny.ts';
import { findCandidate, type CandidateFile } from '../relatedFiles.ts';

/**
 * 跨文件取件的范围（`anchorExplain.fetchScope`，S9a）。
 *
 * @anchor 用户的原话是"没有跨文件的理解啊，像是嵌入式等等，很多分散的代码" —— 而嵌入式里
 *         宏在 `config.h`、结构体在 `ring_buffer.h`、调用者在别的 `.c`，只看锚点文件讲不出
 *         "数据从哪来、给谁用"。所以规则从"只许锚点文件"松成"**逻辑相关**"。
 *         **相关性由模型判断（我们教它判据），这里只管边界。**
 *
 *         `any` 是 D117 加的第四档：前三档都要求"路径得先落在某个根里"，而**锚点不在工作区里**
 *         是常态（用「打开文件」打开、或开发宿主窗口开在别的目录）—— 那时连锚点旁边的
 *         `../Inc/dshot_dma.h` 都读不到，用户实测就是这么被拒的。`any` 把范围交给路径本身：
 *         写绝对路径就按绝对路径读。
 */
export type FetchScope = 'related' | 'same-dir' | 'off' | 'any';

export interface ContextFetchPolicy {
  /**
   * `related` = 工作区内的文本文件（锚点不在工作区里时退化成"锚点所在的这一层"，见 `relatedRoots`）；
   * `same-dir` = 只允许锚点文件所在目录；`off` = 只允许锚点文件；`any` = 不按根过滤（黑名单仍在）
   */
  scope: FetchScope;
  /** 允许的根（工作区目录，`related` 时还含锚点邻域）。空数组 = 跨文件关闭（任何别的文件都拒） */
  roots: readonly string[];
  /** 单次取件最多几行（防"把这个文件整个给我"）。**由配置给**（`anchorExplain.maxFetchLines`） */
  maxLines: number;
  /**
   * 本次给模型的候选清单（S9a-fix10）。**它就是"可取范围"本身**：
   * `related` / `same-dir` 档下，只有清单里的文件取得动，清单外的写法一律拒。
   *
   * @anchor 为什么把清单塞进 policy 而不是另开一个 dep：它是**边界的一部分**。
   *         边界写在两处（闸门一处、prompt 一处）时，"清单里点得到、取件却读不到"
   *         迟早会出现 —— 用户实测里白烧 5 轮就是这个形状。
   *         `any` 档不给清单（整个文件系统列不完）：那一档走"自己查"的接口。
   */
  candidates?: readonly CandidateFile[];
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

/**
 * `related` 档的允许根：工作区根 ∪（必要时）**锚点邻域**。
 *
 * @anchor 这一条是 D117 的核心，也是用户实测那条报错的根因，值得写清楚：
 *
 *         `related` 原来是"工作区根"，一步都没错 —— 前提是**锚点文件在工作区里**。
 *         用户实测时那个前提不成立（锚点在 `…/Driver/dshot/Src/dshot_dma.c`，而窗口里
 *         打开的文件夹是别的目录）：于是模型写 `../Inc/dshot_dma.h` 算出来的
 *         `…/Driver/dshot/Inc/dshot_dma.h` 不在任何根里，被拒；
 *         **而它旁边同目录的 `dshot_dma.h` 同样被拒** —— 因为候选还要在根里才算数，
 *         锚点目录本身从来不是根。提示词与拒绝文案都在教模型"相对路径按锚点文件所在目录算"，
 *         这一条却让那句话在锚点不在工作区时完全落空。
 *
 *         所以判定按"锚点在工作区里吗"分两种（不是拍脑袋加根，而是**把两种前提各自的边界说清**）：
 *           - 在（工作区根覆盖锚点）：范围就是工作区根。锚点目录本来就在里面，不多加任何东西，
 *             否则"锚点恰好在工作区根直下"时会把**工作区根的外面**也放开（那是整个盘）。
 *           - 不在，或压根没打开文件夹：范围退化成**锚点所在的这一层** —— 锚点目录 + 它的上一层。
 *             上一层是必要的，不是凑数：嵌入式工程的形状就是 `Src/` 与 `Inc/` 是兄弟目录，
 *             `../Inc/dshot_dma.h` 是这个行业最常见的写法，只给锚点目录一个根它永远过不去。
 *
 *         回退档都在：想更严用 `same-dir` / `off`，想完全放开用 `any`。
 */
export function relatedRoots(anchorFile: string, workspaceRoots: readonly string[]): readonly string[] {
  const roots = workspaceRoots.filter((root) => root !== '');
  const dir = dirnameOf(anchorFile);
  if (dir === '' || roots.some((root) => isInsidePath(root, anchorFile))) return roots;

  const out = [...roots];
  for (const extra of [dir, dirnameOf(dir)]) {
    if (extra === '' || out.some((existing) => samePath(existing, extra))) continue;
    out.push(extra);
  }
  return out;
}

/**
 * 黑名单（密钥 / 依赖 / 构建产物）搬到了 `../fetchDeny.ts`（S9a-fix10）——
 * 因为**候选清单也要用它**，而两边各写一份早晚会差一条，差的那一条就是
 * "清单里列着、取件时被拒"（或更糟的反向）。判据只有一处，见那个文件。
 */

/**
 * "写的不是清单里的东西"该怎么说（S9a-fix10）。**这是模型最容易撞到的一句**，
 * 所以它得同时说清四件事：边界在哪、正确写法是什么、这次一共有几个可选、以及真不够用时往哪调。
 *
 * @anchor 第一句以句号收尾：进度通知只取第一句（`commands.ts` 的 `briefReason`），
 *         边界信息必须落在第一句里。剩下的部分是给模型看的（它读全文）。
 *         措辞刻意不提"相对哪个目录算" —— 那正是上一版把模型引偏的地方
 *         （它照着例子把文件名换掉，写了一串不存在的路径）。
 */
function notInListReason(
  written: string,
  scope: FetchScope,
  list: readonly CandidateFile[],
  roots: readonly string[],
): string {
  const head = `${JSON.stringify(written)} 不在这次可取的清单里（当前取件范围 ${JSON.stringify(scope)}）。`;
  if (list.length === 0) {
    // 清单为空时**必须把根写出来**：这是"为什么一个文件都没有"的唯一线索。
    // 有清单的时候不写 —— 那时模型的正确动作是照清单写假名，根在它那儿不是可操作的信息。
    return (
      head +
      `这次**一个别的文件都取不到**（允许的根：${roots.length === 0 ? '（无）' : roots.join('、')}）—— ` +
      '「可能相关的文件」清单是空的（多半是没打开文件夹、或工作区里没有可读的代码文件）。' +
      '请基于锚点自身的原文作答；要放开范围，把设置 `anchorExplain.fetchScope` 改成 `"any"`。'
    );
  }
  // 只有一个候选时不举两个例子（`例如 \`f1\`、\`f1\`` 读起来像出了 bug）
  const example =
    list.length === 1 ? `\`${list[0]!.alias}\`` : `\`${list[0]!.alias}\`、\`${list[1]!.alias}\``;
  return (
    head +
    `这次能取的只有清单里那 ${list.length} 个文件，\`path\` 请写它们的**假名**（例如 ${example}）。` +
    '不要自己拼路径 —— 拼出来的多半不存在，白费一轮。' +
    '要读清单之外的文件：把设置 `anchorExplain.fetchScope` 改成 `"any"`（不限，写绝对路径即可），' +
    '或把 `anchorExplain.maxCandidateFiles` 调大（清单能列更多）。'
  );
}


/** 已经取过的区间。用于规则 4 的去重 —— 连同**内容**一起存，好回灌给模型。 */
export interface FetchedSpan {
  type: ContextRequest['type'];
  /**
   * `file` 用路径；`page_range` D98 起也带（闸门兜底成的锚点 PDF 路径）——
   * 去重与 `describeFetched` 的指认都要靠它。极老代码路径上仍可能为 null。
   */
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
  // D98：page_range 现在也带路径（闸门兜底的锚点 PDF），指认必须**先看类型**再看路径 ——
  // 否则"sample.pdf 的 23-25 行"会把页码说成行码，模型和看日志的人一起被带偏。
  if (span.type === 'page_range') {
    const pages = `第 ${span.start}-${span.end} 页`;
    return span.path !== null ? `${basenameOf(span.path)} 的${pages}` : pages;
  }
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
    /**
     * path 的兜底与校验（D98）。与 file 分支的规则 3 同构，但口径相反：
     * PDF **只认锚点这一份文档**（没有"相关文件"一说），所以：
     *   - 省略 = 最常见的正确写法（§8 的 schema 也这么教），兜底成锚点文档；
     *   - 写了 = 必须与锚点文档路径相同（samePath 后归一成绝对路径）；
     *   - 锚点自己都没有 filePath（S5 之前的老锚点）= 没有可兜底的东西，明说拒绝 ——
     *     过去这一路会漏到适配器再以"取件参数不完整"炸出来，模型和用户都拿不到方向。
     */
    const anchorPdf = anchor.location.filePath;
    if (typeof anchorPdf !== 'string') {
      return reject(
        '这根锚点没有携带 PDF 的文件路径（老版本锚点），无法按页取件 —— 请基于现有信息直接作答。',
      );
    }
    if (span.path === null) {
      resolvedFile = anchorPdf;
    } else if (samePath(span.path, anchorPdf)) {
      resolvedFile = anchorPdf;
    } else {
      return reject(
        `PDF 取件只认锚点这一份文档（${basenameOf(anchorPdf)}），收到 ${JSON.stringify(span.path)}。` +
          '`path` 省略即可，或照抄「锚点」一节里的文件路径。',
      );
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
    } else if (policy.scope === 'any') {
      /**
       * 不限档：走**真实路径**（这是它存在的唯一理由），黑名单照挡。
       * 这一档**不给清单** —— 整个文件系统列不完，改为让模型用 `find_files` 自己查（S9a-fix10）。
       */
      const resolved = resolveUnrestrictedPaths(span.path, anchorFile, policy.roots);
      const denied = resolved.find((candidate) => isDeniedPath(candidate));
      if (denied !== undefined) {
        // 密钥/依赖/构建产物：不读，并说清是哪一类，免得模型反复试
        return reject(`${basenameOf(denied)} 按约定不读（密钥、依赖或构建产物）`);
      }
      if (resolved.length === 0) {
        return reject(`${JSON.stringify(span.path)} 解析不出可读的路径。`);
      }
      resolvedFile = resolved[0]!;
    } else {
      /**
       * `related` / `same-dir`：**清单即范围**（S9a-fix10，D119）。
       *
       * @anchor 为什么改成"只认清单"：用户实测里模型连写 5 个不存在的路径（`../Inc/transport.h`、
       *         `../Src/esc.h` …），而它想要的那几个文件**清单里全都写着**（第 1/2/3/5 条）。
       *         根因不是范围太窄，是"清单"与"能取的集合"**本来是两套东西** ——
       *         清单是提示、闸门按根判，两者交集之外的写法都能过闸门，模型自然一直猜。
       *         现在把两者合成一件事：**闸门批准的就是清单里那几条**，
       *         清单外的写法一律拒，并且回灌里明说"这次只有这几个"。
       *
       *         三种写法都认，前提都是**落回清单里的某一条**：
       *         假名（`f3`，正路）／标签照抄／按锚点目录算的相对写法（解析回清单即可）。
       *         这样既不奖励猜路径，也不至于"抄错一个字符就白烧一轮"。
       */
      const list = policy.candidates ?? [];

      /**
       * 两种写法都认，前提都是**落回清单里的某一条**。
       *
       * 顺序是刻意的：**先确定性解析，再用模糊匹配兜底**。
       * `resolveCandidatePaths` 给出的答案是确定的（同一个写法任何时候都解析到同一个绝对路径），
       * 而"清单里的标签"可能带 `..`、也可能与别的条目末尾重名 ——
       * 让一个模糊匹配抢先决定"读哪个文件"，是这个闸门最不该有的行为。
       */
      let target: string | undefined;
      for (const candidate of resolveCandidatePaths(span.path, anchorFile, policy.roots)) {
        const found = list.find((c) => samePath(c.path, candidate));
        if (found !== undefined) {
          target = found.path;
          break;
        }
      }

      if (target === undefined) {
        // 假名（`f3`）或把清单里的标签照抄回来 —— 抄对了也认，不让"抄错一个字符"变成一次白烧
        const hit = findCandidate(list, span.path);
        if (hit !== undefined && 'ambiguous' in hit) {
          return reject(
            `${JSON.stringify(span.path)} 在清单里对上了多条（${hit.ambiguous.map((c) => `\`${c.alias}\``).join('、')}）。` +
              `请直接写假名，例如 \`${hit.ambiguous[0]!.alias}\`。`,
          );
        }
        if (hit !== undefined) target = hit.entry.path;
      }

      if (target === undefined) return reject(notInListReason(span.path, policy.scope, list, policy.roots));
      if (isDeniedPath(target)) {
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
  const sameFile = (f: FetchedSpan): boolean => {
    if (resolvedFile !== undefined) {
      // D98 起 page_range 的记录也带路径；但**旧记录**（D98 之前写下的）path 为 null ——
      // 那时 page_range 只有一种来源（锚点文档），与现在兜底出的锚点文档必然同一份，按同源处理。
      // `file` 的记录 path 从来不为 null，不受影响。
      if (f.path === null) return f.type === 'page_range';
      return samePath(f.path, resolvedFile);
    }
    return f.path === span.path;
  };
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
