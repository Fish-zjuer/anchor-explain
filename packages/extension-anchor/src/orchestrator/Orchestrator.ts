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
 *   2. **输出闸门**：拿到候答后过 §3.3。
 *   3. **修复重试**：闸门不过 → 带问题清单重试**一次**；仍不过 → `SCHEMA_VIOLATION`。
 *
 * 本文件属 orchestrator/，**禁止 import 'vscode'**。
 */

import { AnchorError, createContextRequestLogger } from '@anchor/core';
import type {
  AdapterCapabilities,
  Anchor,
  ContextRequest,
  ContextRequestLogger,
  ExplainProvider,
  ExplanationResult,
} from '@anchor/core';
import { buildRepairPrompt, buildSystemPrompt, buildUserPrompt } from '../prompts/index.ts';
import type { ExplainStyle } from '../prompts/index.ts';
import { describeIssues, validateExplanation } from './validateExplanation.ts';
import type { ExplanationOutline } from './validateExplanation.ts';
import type { ModelChoice, ModelRouteInput } from './ModelRouter.ts';
import { openAITools, parseContextRequest } from './toolSchema.ts';
import { RESTRICTED_POLICY, validateContextRequest } from './validateContextRequest.ts';
import type { ContextFetchPolicy } from './validateContextRequest.ts';
import type { ContextFetchState, FetchedSpan } from './validateContextRequest.ts';
import type { ChatMessage, ChatProvider, ToolCall } from './providers/types.ts';

/** 工具被拒时回灌的固定前缀（§3.2 明确要求这条文案的形状）。 */
const REJECT_PREFIX = '请求被拒绝：';

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
  /** 给模型的"可能相关的文件"清单（S9a）。只是提示，不影响取件的合法性判断 */
  candidateFiles?: readonly string[];
  temperature?: number;
  /** 讲解风格（D65）。缺省 = `prompts` 的默认档 */
  style?: ExplainStyle;
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
   * 一次模型调用。**这一层不做业务校验**：走到这里失败一定是端点/网络/key 的问题，
   * 一律 `PROVIDER_ERROR`。业务层面的"不合规"全部走回灌，不让它变成异常。
   */
  function say(model: string, messages: readonly ChatMessage[]) {
    return deps.chat.chat({
      model,
      messages: [...messages],
      tools: openAITools(),
      ...(deps.temperature !== undefined ? { temperature: deps.temperature } : {}),
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
    const outline = await deps.makeOutline(anchor);
    const messages: ChatMessage[] = [
      // 跨文件开关由**策略**推出（不另开一个 deps 字段，免得两处说法可能不一致）
      {
        role: 'system',
        content: buildSystemPrompt(deps.style, { crossFile: (deps.fetchPolicy?.scope ?? 'off') !== 'off' }),
      },
      { role: 'user', content: buildUserPrompt(anchor, { candidates: deps.candidateFiles }) },
    ];

    const fetched: FetchedSpan[] = [];
    let roundsUsed = 0;
    // 初次 + 每轮取件后都还要有一次机会给答案，所以是 取件上限 + 1；
    // 再多留一轮，是为了让"被拒之后模型仍然只想着取件"这种情况也能收场（届时抛 MAX_ROUNDS_EXCEEDED）
    const turnLimit = deps.maxFetchRounds + 2;

    /** §3.3 闸门 + 规则 5 的一次修复重试 */
    async function validateOrRepair(model: string, candidate: string): Promise<ExplanationResult> {
      const first = validateExplanation(candidate, anchor, outline, {
        allowedPaths: fetchedPaths(fetched),
      });
      if (first.ok) return first.result;

      const repaired = await say(model, [
        ...messages,
        { role: 'assistant', content: candidate },
        { role: 'user', content: buildRepairPrompt(candidate, describeIssues(first.issues)) },
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

    /** 处理单次 `fetch_context`。**永远返回一段文本**，绝不抛（§3.2 的"拒绝不抛错"）。 */
    async function handleToolCall(call: ToolCall, state: ContextFetchState): Promise<{ accepted: boolean; text: string }> {
      const started = now();
      const rejected = (request: ContextRequest, reason: string): { accepted: false; text: string } => {
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

      const content = await deps.adapter.fetchContext(decision.request);
      const span = spanOf(decision.request);
      if (span) fetched.push({ ...span, content });
      logger.record({
        at: started,
        round: state.roundsUsed + 1,
        request: req,
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

    throw new AnchorError(
      'MAX_ROUNDS_EXCEEDED',
      `取件 ${deps.maxFetchRounds} 次之后模型仍未给出讲解（它可能一直在请求上下文）。`,
    );
  };
}
