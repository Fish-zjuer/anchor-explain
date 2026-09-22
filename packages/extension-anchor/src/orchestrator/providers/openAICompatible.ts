/**
 * OpenAI 兼容的 Chat 实现。事实源：docs/CONTRACTS.md §6。
 *
 * @anchor 一个实现覆盖 OpenAI / DeepSeek / 通义 / Ollama —— 它们都吃
 *         `POST {baseUrl}/chat/completions` 这一套。所以这里**只认这一套**，
 *         换厂商靠用户改 `baseUrl` + `tier1Model`，不靠加分支。
 *
 * 为什么不用 `openai` 这个包：多一个依赖就多一份"它偷偷做了什么"的可能，
 * 而这里要的只是两次 `fetch`（发请求、读 JSON）。Node 20 自带 `fetch`。
 *
 * `fetchImpl` 可注入是刻意的：编排层的行为（取件轮数、拒绝回灌、repair）
 * 必须能在**不联网**的情况下全量验完，否则那些逻辑就只能靠手动试。
 *
 * 本文件属 orchestrator/，**禁止 import 'vscode'**。
 */

import { AnchorError } from '@anchor/core';
import type { AssistantTurn, ChatMessage, ChatProvider, ChatRequest, TokenUsage, ToolCall } from './types.ts';

export interface OpenAICompatibleOptions {
  baseUrl: string;
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  /** 测试注入点；缺省用全局 `fetch` */
  fetchImpl?: typeof fetch;
  temperature?: number;
}

/** 发出去的消息形状（OpenAI 兼容）。`toolCallId` 在这一层才变成 `tool_call_id`。 */
function toWireMessage(m: ChatMessage): Record<string, unknown> {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content };
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: m.content,
      tool_calls: m.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: c.arguments },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

function readToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolCall[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const call = item as Record<string, unknown>;
    const fn = call.function as Record<string, unknown> | undefined;
    if (!fn || typeof fn.name !== 'string') continue;
    out.push({
      id: typeof call.id === 'string' ? call.id : `call_${out.length}`,
      name: fn.name,
      // 有的端点这里给对象而不是字符串（容错：统一成字符串再交给解析侧）
      arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
    });
  }
  return out;
}

/** 端点的错误正文里常有关键信息（模型名写错、key 过期）。截一段带上，别只说"请求失败"。 */
function snippet(text: string, max = 300): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

/** 只认数字；端点偶尔把 token 数写成字符串或 null，那种一律当"没给"。 */
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * 读 `usage`（D120）。**只读，不猜**：端点没给就返回 `undefined`。
 *
 * @anchor 两种缓存字段形状都要认 —— 实测里各家不一样：
 *   - DeepSeek：`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`（两个都给）
 *   - OpenAI：  `prompt_tokens_details.cached_tokens`（只给命中），未命中 = 输入 − 命中
 * 都拿不到时 `cachedInput` / `uncachedInput` 留 `undefined`，由展示层写"未提供"。
 * 把"不知道"写成 0 会编出一个看起来很确定的数（D67 的同一条纪律）。
 */
function readUsage(raw: unknown): TokenUsage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const u = raw as Record<string, unknown>;
  const input = num(u.prompt_tokens);
  const output = num(u.completion_tokens);
  const hit = num(u.prompt_cache_hit_tokens);
  const miss = num(u.prompt_cache_miss_tokens);
  const details = u.prompt_tokens_details as Record<string, unknown> | undefined;
  const cached = hit ?? num(details?.cached_tokens);
  const uncached = miss ?? (cached !== undefined && input !== undefined ? input - cached : undefined);

  if (input === undefined && output === undefined && cached === undefined) return undefined;
  return {
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(cached !== undefined ? { cachedInput: cached } : {}),
    ...(uncached !== undefined ? { uncachedInput: uncached } : {}),
  };
}

export function createOpenAICompatibleProvider(opts: OpenAICompatibleOptions): ChatProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  return {
    async chat(req: ChatRequest): Promise<AssistantTurn> {
      // 请求级优先于 provider 级：编排层可能想对某一轮单独降温，而 provider 实例是长命的
      const temperature = req.temperature ?? opts.temperature;
      const body: Record<string, unknown> = {
        model: req.model,
        messages: req.messages.map(toWireMessage),
        ...(req.tools?.length ? { tools: req.tools, tool_choice: 'auto' } : {}),
        // 请求级优先于 provider 级：编排层可能想对某一轮单独降温，而 provider 是长命的
        ...(temperature !== undefined ? { temperature } : {}),
        // 用户自填的额外字段**原样透传**（有的端点要 top_p、有的要 enable_thinking…）
        ...opts.extraBody,
        ...req.extraBody,
      };

      let res: Response;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
            ...opts.extraHeaders,
            ...req.extraHeaders,
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        // 网络层失败（DNS、连不上、超时）。给的是 baseUrl，因为九成是它填错了。
        throw new AnchorError('PROVIDER_ERROR', `连不上 ${url}（${(err as Error).message}）`);
      }

      const text = await res.text();
      if (!res.ok) {
        throw new AnchorError('PROVIDER_ERROR', `模型端点返回 ${res.status}：${snippet(text)}`);
      }

      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new AnchorError('PROVIDER_ERROR', `模型端点返回的不是 JSON：${snippet(text)}`);
      }

      const choices = (payload as { choices?: unknown }).choices;
      const first = Array.isArray(choices) ? (choices[0] as Record<string, unknown> | undefined) : undefined;
      const message = first?.message as Record<string, unknown> | undefined;
      if (!message) {
        throw new AnchorError('PROVIDER_ERROR', `模型端点的返回里没有 choices[0].message：${snippet(text)}`);
      }

      const usage = readUsage((payload as { usage?: unknown }).usage);
      return {
        content: typeof message.content === 'string' ? message.content : '',
        toolCalls: readToolCalls(message.tool_calls),
        ...(usage !== undefined ? { usage } : {}),
      };
    },
  };
}
