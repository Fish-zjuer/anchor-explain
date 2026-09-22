/**
 * 编排循环。事实源：docs/CONTRACTS.md §3.2（取件校验）+ §3.3（输出校验）+ §7（日志）。
 *
 * @anchor 这个文件就是 S1/S2 里那行 `const provider = fakeProvider` 的真身。
 *         它兑现 `ExplainProvider`（`(anchor) => Promise<ExplanationResult>`），
 *         所以 `commands.ts` 换掉那一行之后，下游
 *         （校验 → 会话 → decoration → 侧边栏 → 状态栏）**一行都不用动**（D17/D18）。
 *
 * 三段结构，各自的"错"性质不同，所以分开处理：
 *   1. **取件循环**：模型要上下文 → 校验（§3.2）→ 合法就取、不合法就回灌拒绝原因。
 *      **拒绝不抛错**（D29）—— 模型的一次越界不该等于整次讲解失败。
 *      D96 补上了这条纪律漏掉的半边：**读取失败也不抛**。闸门只做字符串解析
 *      （`resolveCandidatePaths` 解析得出 ≠ 文件存在），模型把构建目录当前缀拼进 path 时
 *      `fetchContext` 会以 ENOENT 炸穿整个循环 —— 用户实测的
 *      `Anchor：Error: ENOENT: … transport_uart.c` 就是这么来的。现在读取失败回灌
 *      一条「取件失败」+ 候选清单的工具结果，模型还有机会改用正确的名字。
 *   2. **输出闸门**：拿到候答后过 §3.3。
 *   3. **修复重试**：闸门不过 → 带问题清单重试**一次**；仍不过 → `SCHEMA_VIOLATION`。
 *
 * 本文件属 orchestrator/，**禁止 import 'vscode'**。
 */

import { AnchorError, createContextRequestLogger, isCodeLocation, isPDFLocation } from '@anchor/core';
import type {
  AdapterCapabilities,
  Anchor,
  ContextRequest,
  ContextRequestLogger,
  ExplainProvider,
  ExplanationResult,
} from '@anchor/core';
import { buildRepairPrompt, buildSystemPrompt, buildUserPrompt } from '../prompts/index.ts';
import type { ExplainLanguage, ExplainStyle } from '../prompts/index.ts';
import { describeCandidates, type CandidateFile } from '../relatedFiles.ts';
import { isDeniedPath } from '../fetchDeny.ts';
import { describeIssues, validateExplanation } from './validateExplanation.ts';
import type { ExplanationOutline } from './validateExplanation.ts';
import type { ModelChoice, ModelRouteInput } from './ModelRouter.ts';
import { FIND_FILES_MAX_HITS, FIND_FILES_TOOL, openAITools, parseContextRequest } from './toolSchema.ts';
import { RESTRICTED_POLICY, validateContextRequest } from './validateContextRequest.ts';
import type { ContextFetchPolicy } from './validateContextRequest.ts';
import type { ContextFetchState, FetchedSpan } from './validateContextRequest.ts';
import { addUsage } from './providers/types.ts';
import type { ChatMessage, ChatProvider, TokenUsage, ToolCall } from './providers/types.ts';

/**
 * `find_files` 的参数解析（S9a-fix10）。与 `parseContextRequest` 同一个立场：
 * **只做形状解析，不做业务校验** —— 档位判断在 `handleToolCall` 里。
 */
function parseFindFilesArguments(rawArguments: string): { keyword: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  if (typeof raw.reason !== 'string' || raw.reason.trim() === '') return null;
  return { keyword: typeof raw.keyword === 'string' ? raw.keyword.trim().toLowerCase() : '' };
}

/**
 * 关键词过滤（S9a-fix10）。空关键词 = 全都要（由调用方截断），否则按**整条路径**
 * 大小写不敏感包含匹配 —— 按整条路径而不是只按文件名，是因为嵌入式里
 * `Drivers/.../Inc/` 这种目录层级本身常常就是最有用的那个关键词。
 */
export function filterWorkspaceFiles(pool: readonly string[], keyword: string): string[] {
  if (keyword === '') return [...pool];
  return pool.filter((p) => p.toLowerCase().includes(keyword));
}

/** 工具被拒时回灌的固定前缀（§3.2 明确要求这条文案的形状）。 */
const REJECT_PREFIX = '请求被拒绝：';

/**
 * 被拒之后**额外**给几轮（S9a-fix11，D123）。
 *
 * @anchor 用户的原话："读到一个不允许的文件就死了，有点问题，建议给2次机会？"
 *         —— 这个诊断是对的。被拒**不消耗取件预算**（规则 5 只管放行的那些），但它**消耗轮次**：
 *         一次写错就把剩下的轮数挤掉，最后以 `MAX_ROUNDS_EXCEEDED` 收场，
 *         用户**什么都拿不到** —— 而那份讲解本来可以基于锚点自身的原文给出来。
 *         "写错了 → 看回灌 → 改对"这条自纠路径是我们自己设计的（§3.2「拒绝不抛错」），
 *         那就得让它在轮数上真的走得完。
 *
 *         为什么是 2：给一次改写法、再给一次"算了，就按现有信息作答"。
 *         再多的边际收益很小，而每一轮都是真金白银的模型调用。
 *         上限仍然是死的（`maxFetchRounds + 2 + 本值`），不会变成无限循环。
 */
const REJECTED_GRACE_TURNS = 2;

/**
 * `path` 该怎么写 —— **由档位与清单一起决定**，system prompt 与闸门必须是同一套事实（D123）。
 *
 * @anchor `'none'` 这一档非有不可：跨文件开着、可清单是空的（没有工作区文件夹、锚点邻域也扫不到），
 *         这种情况上一版仍然在教模型"写清单里第一列的假名"，而清单根本不存在 ——
 *         于是它**编了一个 `f1`**，被拒、再编、把轮数烧完。提示词只要和闸门说的不是同一件事，
 *         模型就会按提示词去试，而闸门一定拒它。
 */
function candidateModeOf(deps: OrchestratorDeps): 'alias' | 'path' | 'none' {
  const scope = deps.fetchPolicy?.scope ?? 'off';
  if (scope === 'any') return 'path';
  if (scope === 'off') return 'none';
  return (deps.candidateFiles ?? []).length > 0 ? 'alias' : 'none';
}

/**
 * 取件读取失败时回灌给模型的说明（D96）。
 *
 * @anchor 要点不是道歉，是**给活路**：光说"打不开"，模型只会再猜一个路径，猜一次烧一轮。
 *         把候选清单原样列进来（名字照抄即可），它才能一步走到正确的取件；
 *         清单为空（扫描失败/没有工作区）时也把"别猜路径"说死，并给它"基于现有信息作答"的台阶。
 *
 * `anchorDoc` 是锚点文档的路径（D98）：代码锚点 = `location.filePath`；PDF 锚点 = `filePath`（老锚点为 null）。
 * 两种来源的"活路"不一样：代码给候选清单，PDF 告诉它 path 用锚点文档（或干脆省略）。
 */
export function fetchFailureText(
  req: ContextRequest,
  detail: string,
  candidates: readonly CandidateFile[],
  anchorDoc: string | null,
): string {
  if (req.type === 'page_range') {
    const gone = /ENOENT|FileNotFound|no such file/iu.test(detail);
    const lines = [
      `取件失败：这份 PDF 打不开（${gone ? '文件不存在或路径不对 —— 不要猜路径' : '读不出来'}）。`,
      '',
      anchorDoc === null
        ? '这根锚点没有携带 PDF 的文件路径，无法按页取件。'
        : `\`path\` 的正确写法只有一种：照抄锚点文档的路径 \`${anchorDoc}\`，或者干脆**省略**（我们会自动用锚点文档）。`,
    ];
    lines.push('', '改用上面的写法重新取件，或者基于现有信息直接作答。');
    return lines.join('\n');
  }
  if (req.type !== 'file' || typeof req.params.path !== 'string') {
    return `取件失败：这份文档读不出来（${detail.slice(0, 200)}）。请基于现有信息直接作答。`;
  }
  // ENOENT / FileNotFound 是"路径不存在"，值得单独点破 —— 与"读不出来"（权限/编码）的下一步动作不同
  const gone = /ENOENT|FileNotFound|no such file/iu.test(detail);
  const lines = [
    `取件失败：${req.params.path} 打不开（${gone ? '这个文件不存在 —— 不要猜路径' : '读不出来'}）。`,
    '',
    '`path` 的可靠写法：**照抄「可能相关的文件」清单里第一列的假名**（`f1`、`f2`…）。清单就是这次能取的全部文件，不要自己拼路径。',
  ];
  if (candidates.length > 0) {
    lines.push('', '可以取的文件（`path` 写假名）：', ...describeCandidates(candidates));
  }
  if (anchorDoc !== null) {
    lines.push('', `（锚点文件 ${anchorDoc} 本身不用取件。）`);
  }
  lines.push('', '改用上面的名字重新取件，或者基于现有信息直接作答。');
  return lines.join('\n');
}

export interface OrchestratorAdapter {
  readonly capabilities: AdapterCapabilities;
  fetchContext(req: ContextRequest): Promise<string>;
}

export interface OrchestratorDeps {
  chat: ChatProvider;
  routeModel: (input: ModelRouteInput) => ModelChoice;
  adapter: OrchestratorAdapter;
  /** §3.3 的 `ctx`（文档总行数 / 总页数）。取不到就返回 `{}`，校验会跳过对应上界 */
  makeOutline: (anchor: Anchor) => Promise<ExplanationOutline>;
  maxFetchRounds: number;
  /**
   * 跨文件取件的边界（S9a）。**不传 = 只允许锚点文件**（`RESTRICTED_POLICY`）——
   * 产品默认是 `related`，由命令层按 `anchorExplain.fetchScope` 构造。
   */
  fetchPolicy?: ContextFetchPolicy;
  /**
   * 给模型的「可能相关的文件」清单（S9a）。**从 S9a-fix10 起它不只是提示**：
   * `related` / `same-dir` 档下闸门只认这份清单里的文件（见 `ContextFetchPolicy.candidates`），
   * 两处用的是同一个数组 —— 清单即范围。
   */
  candidateFiles?: readonly CandidateFile[];
  /**
   * `find_files` 工具的回话池（S9a-fix10）：工作区里扫到的代码文件（绝对路径）。
   * 只在取件范围为 `any` 时用到 —— 那一档没有清单，给模型一个查询口自己找。
   */
  workspaceFiles?: readonly string[];
  /**
   * 每轮模型调用的 token 用量（D120）。**累计值**，调用方拿它刷面板底部那一行。
   * 做成回调而不是塞进 `ExplanationResult`：那个类型是冻结契约，而这是**展示**信息，
   * 且它应当**边跑边更新**（讲解要跑几十秒，用户盯着面板时就能看见在涨）。
   */
  onUsage?: (total: TokenUsage) => void;
  temperature?: number;
  /** 讲解风格（D65）。缺省 = `prompts` 的默认档 */
  style?: ExplainStyle;
  /** 讲解语言（D97）。缺省中文；`en` 时三个 prompt 换英文面 */
  language?: ExplainLanguage;
  logger?: ContextRequestLogger;
  /** 注入时钟，便于测试断言 `durationMs` */
  now?: () => number;
}

/** 一次取件在 `fetched` 里留下的痕迹（去重用，也要能回灌内容） */
function spanOf(req: ContextRequest): Omit<FetchedSpan, 'content'> | null {
  const { start, end } = req.params;
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  return {
    type: req.type,
    path: typeof req.params.path === 'string' ? req.params.path : null,
    start,
    end,
  };
}

export function createOrchestrator(deps: OrchestratorDeps): ExplainProvider {
  const logger = deps.logger ?? createContextRequestLogger();
  const now = deps.now ?? (() => Date.now());

  /**
   * 本次讲解累计的 token 用量（D120）。**谁都不存它** —— 它是"这一眼想看的东西"，
   * 不是要留下的记录：讲解历史里没有它，`workspaceState` 里也没有，窗口一关就没了。
   *
   * @anchor 每次讲解开始时清空（见下面 `run` 的开头）：同一个扩展实例会连着讲很多段，
   *         不清空就会把上一段的账记到这一段头上 —— 那种数字比不显示更糟。
   */
  let usageTotal: TokenUsage | undefined;

  /**
   * 一次模型调用。**这一层不做业务校验**：走到这里失败一定是端点/网络/key 的问题，
   * 一律 `PROVIDER_ERROR`。业务层面的"不合规"全部走回灌，不让它变成异常。
   *
   * @anchor `tools` 按档位给（S9a-fix10）：`any` 档多一个 `find_files`（那一档没有清单，
   *         得让模型自己查有什么文件）；清单驱动的档位**不给** —— 给了它就会绕开清单去列文件，
   *         而"清单即范围"正是这次要立的东西。
   */
  function say(model: string, messages: readonly ChatMessage[]) {
    return deps.chat
      .chat({
        model,
        messages: [...messages],
        tools: openAITools({ withFindFiles: deps.fetchPolicy?.scope === 'any' }),
        ...(deps.temperature !== undefined ? { temperature: deps.temperature } : {}),
      })
      .then((turn) => {
        if (turn.usage !== undefined) {
          usageTotal = usageTotal === undefined ? turn.usage : addUsage(usageTotal, turn.usage);
          deps.onUsage?.(usageTotal);
        }
        return turn;
      });
  }

  /**
   * 本次**真取过件**的文件（S9a）。§3.3 用它放行"步骤落在别的文件"——
   * 允许集合 = 锚点文件 ∪ 这个集合，**模型没读过的文件它不许引用**。
   * （这就是"不许漫游"在跨文件时代的样子：不是不许出去，是**出去过的地方才许写**。）
   */
  const fetchedPaths = (fetched: readonly FetchedSpan[]): string[] =>
    [...new Set(fetched.map((f) => f.path).filter((p): p is string => p !== null))];

  return async (anchor: Anchor): Promise<ExplanationResult> => {
    usageTotal = undefined; // 每次讲解重新计账（见 `usageTotal` 的说明）
    const outline = await deps.makeOutline(anchor);
    /**
     * 跨文件开关由**策略**推出（不另开一个 deps 字段，免得两处说法可能不一致）。
     * 它同时决定三处文本：system 的取件规则、输出契约里 `filePath` 的口径、**repair 那一轮**
     * —— 三处必须同口径，否则模型被判失败后拿到的修复提示会把它往反方向推（D67）。
     */
    const crossFile = (deps.fetchPolicy?.scope ?? 'off') !== 'off';
    const messages: ChatMessage[] = [
      {
        role: 'system',
        // 行数上限跟着**策略**走（同一个数既管闸门也管这句提示，避免两处说法不一致 —— D71）。
        // sourceType（D98）决定整套人格：pdf 走释义面，code 走代码面。
        content: buildSystemPrompt(deps.style, {
          language: deps.language,
          crossFile,
          maxFetchLines: deps.fetchPolicy?.maxLines,
          sourceType: anchor.sourceType === 'pdf' ? 'pdf' : 'code',
          // `any` 档写真实路径、可以自己查（`find_files`）；清单驱动的档位只写假名；
          // **清单为空时要明说"这次一个别的文件都读不到"**（D123，见 `candidateModeOf`）
          candidateMode: candidateModeOf(deps),
        }),
      },
      {
        role: 'user',
        // `focus`（D79）跟着锚点走：用户写的那句话要进 prompt，否则它只是个被存起来没人读的字段
        // （`buildUserPrompt` 早就支持 `focus`，但一直没人传 —— 见 prompts/index.ts 那段注释）。
        content: buildUserPrompt(anchor, {
          language: deps.language,
          candidates: deps.candidateFiles,
          crossFile,
          focus: anchor.focus,
        }),
      },
    ];

    const fetched: FetchedSpan[] = [];
    let roundsUsed = 0;
    /** 被拒的取件次数与最后一次的原因。**报错时要说实话**：见下面 MAX_ROUNDS_EXCEEDED */
    let rejectedCount = 0;
    /** 取件轮数之外的一类失败：放行了但文件读不出来（D96）。报错时同样要说实话 */
    let failedFetchCount = 0;
    /** "最后一次"是哪种账（被拒 / 打不开）—— 收场报错的措辞跟着它走 */
    let lastFeedbackWasFailure = false;
    let lastRejectReason: string | undefined;
    // 初次 + 每轮取件后都还要有一次机会给答案，所以是 取件上限 + 1；
    // 再多留一轮，是为了让"被拒之后模型仍然只想着取件"这种情况也能收场（届时抛 MAX_ROUNDS_EXCEEDED）；
    // D123 起再加"被拒的宽限"——被拒不消耗取件预算，但消耗轮次，不额外给就会"写错一次就什么都拿不到"
    const turnLimit = deps.maxFetchRounds + 2 + REJECTED_GRACE_TURNS;

    /** §3.3 闸门 + 规则 5 的一次修复重试 */
    async function validateOrRepair(model: string, candidate: string): Promise<ExplanationResult> {
      const first = validateExplanation(candidate, anchor, outline, {
        allowedPaths: fetchedPaths(fetched),
      });
      if (first.ok) return first.result;

      const repaired = await say(model, [
        ...messages,
        { role: 'assistant', content: candidate },
        {
          role: 'user',
          content: buildRepairPrompt(candidate, describeIssues(first.issues), {
            language: deps.language,
            crossFile,
            sourceType: anchor.sourceType === 'pdf' ? 'pdf' : 'code',
          }),
        },
      ]);

      // 修复那一轮如果又要工具，直接按"仍不合规"处理：§3.3 只给一次重试机会，
      // 而这里要的是一份能渲染的 JSON，不是再来一轮取件。
      const second = validateExplanation(repaired.content, anchor, outline, {
        allowedPaths: fetchedPaths(fetched),
      });
      if (second.ok) return second.result;

      throw new AnchorError(
        'SCHEMA_VIOLATION',
        `AI 输出未通过校验（重试一次后仍失败）：${describeIssues(second.issues)}`,
        { issues: second.issues },
      );
    }

    /** 处理单次 `fetch_context`。**永远返回一段文本**，绝不抛（§3.2 的"拒绝不抛错"；
     *  D96 起连适配器的读取失败也在这里被接住 —— 放行过的请求同样可能读不出来）。 */
    async function handleToolCall(call: ToolCall, state: ContextFetchState): Promise<{ accepted: boolean; text: string }> {
      const started = now();
      const rejected = (request: ContextRequest, reason: string): { accepted: false; text: string } => {
        rejectedCount += 1;
        lastRejectReason = reason;
        lastFeedbackWasFailure = false;
        logger.record({
          at: started,
          round: state.roundsUsed + 1,
          request,
          accepted: false,
          rejectReason: reason,
          durationMs: now() - started,
        });
        return { accepted: false, text: `${REJECT_PREFIX}${reason}` };
      };

      /**
       * `find_files`：只列文件、不读内容（S9a-fix10，D119）。**只在不限档可用**。
       *
       * @anchor 它是"清单"的替代品，不是补充：`related` / `same-dir` 档已经有清单了，
       *         再给一个列文件的工具等于把"清单即范围"这条规矩拆掉（模型会拿它绕过清单）。
       *         所以非 `any` 档直接拒，并把该走的路说清。
       *
       *         回话**只列池子里扫到的代码文件**（`deps.workspaceFiles`），
       *         不去现场遍历文件系统 —— 池子是宿主侧一次扫描的结果，
       *         把它当唯一事实源，就没有"扫两次得到两套结果"的可能。
       */
      if (call.name === FIND_FILES_TOOL.name) {
        if ((deps.fetchPolicy?.scope ?? 'off') !== 'any') {
          return rejected(
            { type: 'file', params: {}, reason: '' },
            `工具 ${FIND_FILES_TOOL.name} 只在取件范围为 "any" 时可用。` +
              '当前档位下请直接从「可能相关的文件」清单里写假名（`f1`、`f2`…）。',
          );
        }
        const raw = parseFindFilesArguments(call.arguments);
        if (raw === null) {
          return rejected(
            { type: 'file', params: {}, reason: '' },
            `${FIND_FILES_TOOL.name} 的参数不是合法 JSON，或缺了必填的 reason。`,
          );
        }
        const pool = (deps.workspaceFiles ?? []).filter((p) => !isDeniedPath(p));
        const hits = filterWorkspaceFiles(pool, raw.keyword);
        // 列文件**不占取件轮次、也不进取件日志**：它不是"读了哪个文件的哪几段"，
        // 计进去会把"取件 N 次"这个数字说岔（那个数字是要给用户看的账）。
        if (hits.length === 0) {
          return {
            accepted: false,
            text:
              `没有匹配 ${JSON.stringify(raw.keyword)} 的文件（可读的代码文件共 ${pool.length} 个）。` +
              '换个关键词，或者基于现有信息作答。',
          };
        }
        const shown = hits.slice(0, FIND_FILES_MAX_HITS);
        return {
          accepted: false,
          text:
            `匹配到 ${hits.length} 个文件${hits.length > shown.length ? `（只列出前 ${shown.length} 个，请换更窄的关键词）` : ''}：\n` +
            shown.map((p) => `- ${p}`).join('\n') +
            '\n读其中某个时，`path` 写它**完整的绝对路径**。',
        };
      }

      if (call.name !== 'fetch_context') {
        return rejected({ type: 'file', params: {}, reason: '' }, `没有名为 ${call.name} 的工具。`);
      }

      const req = parseContextRequest(call.arguments);
      if (!req) {
        return rejected(
          { type: 'file', params: {}, reason: '' },
          'fetch_context 的参数不是合法 JSON，或缺了必填的 request_type / reason。',
        );
      }

      const decision = validateContextRequest(req, anchor, state);
      if (!decision.accepted) {
        // 去重命中时把上次的内容再回灌一次 —— 那比一句"已达上限/已取过"对模型有用得多，且不花成本
        const base = rejected(req, decision.reason);
        return decision.content
          ? { accepted: false, text: `${base.text}。这是上次取到的内容：\n${decision.content}` }
          : { accepted: false, text: `${base.text}，请基于现有信息作答。` };
      }

      // 放行 ≠ 读得到：路径是**字符串解析**出来的，文件可能根本不存在（模型把构建目录
      // 拼进 path 时就是这么炸的，D96）。失败必须留在这个函数里变成一条工具结果，
      // 否则它一路炸穿编排循环，整次讲解以 `Anchor：Error: ENOENT…` 收场。
      let content: string;
      try {
        content = await deps.adapter.fetchContext(decision.request);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        failedFetchCount += 1;
        lastRejectReason = detail;
        lastFeedbackWasFailure = true;
        logger.record({
          at: started,
          round: state.roundsUsed + 1,
          request: decision.request,
          accepted: false,
          rejectReason: `文件打不开：${detail}`,
          durationMs: now() - started,
        });
        return {
          accepted: false,
          text: fetchFailureText(
            decision.request,
            detail,
            deps.candidateFiles ?? [],
            // 锚点文档路径（D98）：代码与 PDF 两种来源都给 —— 各自的失败文案都靠它指路
            isCodeLocation(anchor.location)
              ? anchor.location.filePath
              : isPDFLocation(anchor.location)
                ? (anchor.location.filePath ?? null)
                : null,
          ),
        };
      }
      const span = spanOf(decision.request);
      if (span) fetched.push({ ...span, content });
      logger.record({
        at: started,
        round: state.roundsUsed + 1,
        // 记**归一化后**的请求：日志要能复核"到底读了哪个文件"（截图问题 3.4），
        // 而模型写的是相对路径 —— 记原样的话，命令层据此收的允许集合会与 §3.3 的绝对路径对不上（D67）
        request: decision.request,
        accepted: true,
        resultChars: content.length,
        durationMs: now() - started,
      });
      return { accepted: true, text: content };
    }

    for (let turn = 1; turn <= turnLimit; turn += 1) {
      const choice = deps.routeModel({
        turn,
        hasExtractedText: Boolean(anchor.extractedText && anchor.extractedText.trim() !== ''),
        // 锚点自带截图 ⇒ 有图可看 ⇒ 值得升级到多模态那一档（ARCHITECTURE §5 的第二条）
        wantsImage: Boolean(anchor.capturedImage),
      });

      const reply = await say(choice.model, messages);

      // 不要工具 ⇒ 这就是候答，交给输出闸门
      if (reply.toolCalls.length === 0) return await validateOrRepair(choice.model, reply.content);

      // 把这一轮助手消息（含工具调用）记进对话，否则紧随其后的 tool 结果没有归属
      messages.push({ role: 'assistant', content: reply.content, toolCalls: reply.toolCalls });

      for (const call of reply.toolCalls) {
        const result = await handleToolCall(call, {
          capabilities: deps.adapter.capabilities,
          policy: deps.fetchPolicy ?? RESTRICTED_POLICY,
          pageCount: outline.pageCount ?? null,
          documentLineCount: outline.documentLineCount ?? null,
          fetched,
          roundsUsed,
          maxFetchRounds: deps.maxFetchRounds,
        });
        if (result.accepted) roundsUsed += 1;
        messages.push({ role: 'tool', toolCallId: call.id, content: result.text });
      }
    }

    // 报错要说实话（D67）：原来无论发生什么都说"取件 N 次之后模型仍未给出讲解"，
    // 而实际上可能**一次都没取成**（每次都当场被拒，`roundsUsed` 不涨，循环却照样烧完）。
    // 那样这句话是假的，用户拿着它没法判断该调什么。D96 起失败统计里还有第三类：
    // 放行了但文件打不开 —— 它不该被算进"被拒"，也不该被算进"成功"。
    const reasonTail =
      rejectedCount === 0 && failedFetchCount === 0
        ? '它可能一直在请求上下文'
        : `其中取件成功 ${roundsUsed} 次` +
          (rejectedCount > 0 ? `、被拒 ${rejectedCount} 次` : '') +
          (failedFetchCount > 0 ? `、打不开 ${failedFetchCount} 次` : '') +
          // "最后一次"是哪种账，措辞就跟着是哪种：被拒后又打不开时，"被拒的原因"就成了假话
          (lastFeedbackWasFailure
            ? ` —— 最后一次的失败说明是：${lastRejectReason ?? '（没记下来）'}`
            : ` —— 最后一次被拒的原因是：${lastRejectReason ?? '（没记下来）'}`);
    throw new AnchorError(
      'MAX_ROUNDS_EXCEEDED',
      `模型连续 ${turnLimit} 轮都在请求上下文：${reasonTail}。` +
        '试试把「一次最多取几轮」（`anchorExplain.maxFetchRounds`）调大，或者把一个更大的选区作为锚点。',
      { roundsUsed, rejectedCount, turnLimit, lastRejectReason: lastRejectReason ?? null },
    );
  };
}
