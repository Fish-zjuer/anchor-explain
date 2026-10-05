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
  /** 原始响应诊断。不包含请求头/密钥；由命令层决定本地日志落点。 */
  onResponse?: (response: { model: string; status: number; raw: string }) => void;
  baseUrl: string;
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  /** 测试注入点；缺省用全局 `fetch` */
  fetchImpl?: typeof fetch;
  temperature?: number;
}

/**
 * 发出去的消息形状（OpenAI 兼容）。`toolCallId` 在这一层才变成 `tool_call_id`。
 *
 * @anchor `reasoning_content` 为什么由我们自己带（D135）：DeepSeek 的思考模式**默认开着**，
 *         而它的文档要求在带 `tools` 的请求里把**每一轮**的 `reasoning_content` 原样回传
 *         （包括没发起工具调用的那些轮次），否则返回 400。它官方示例里
 *         `messages.append(response.choices[0].message)` 之所以能过，
 *         正是因为那个对象**自带**这个字段。所以我们这一层只做翻译，不做过滤：
 *         编排层给了就上线，没给（大多数端点）就不写这一行 —— 不塞空串，
 *         空串会让"这轮本来就没有思维链"和"有思维链但内容为空"分不开。
 */
function toWireMessage(m: ChatMessage): Record<string, unknown> {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content };
  if (m.role === 'assistant') {
    const wire: Record<string, unknown> = { role: 'assistant', content: m.content };
    if (m.toolCalls?.length) {
      wire.tool_calls = m.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: c.arguments },
      }));
    }
    if (m.reasoningContent !== undefined) wire.reasoning_content = m.reasoningContent;
    return wire;
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
      opts.onResponse?.({ model: req.model, status: res.status, raw: text });
      if (!res.ok) {
        throw new AnchorError('PROVIDER_ERROR', `模型端点返回 ${res.status}：${snippet(text)}`);
      }

      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new AnchorError('PROVIDER_ERROR', `模型端点返回的不是 JSON：${snippet(text)}`);
      }

      const choices = payload !== null && typeof payload === 'object' ? (payload as { choices?: unknown }).choices : undefined;
      const first = Array.isArray(choices) ? (choices[0] as Record<string, unknown> | undefined) : undefined;
      const message = first?.message as Record<string, unknown> | undefined;
      if (!message) {
        throw new AnchorError('PROVIDER_ERROR', `模型端点的返回里没有 choices[0].message：${snippet(text)}`);
      }

      const usage = readUsage((payload as { usage?: unknown }).usage);
      /**
       * 思维链（D135）：DeepSeek 在 `message.reasoning_content` 给，与 `content` **平级**。
       * 只在是字符串且非空时带上 —— 空串等于"没有"，写成 `undefined` 让下游能 `!== undefined` 判断。
       */
      const reasoning = message['reasoning_content'];
      return {
        ...(typeof first?.finish_reason === 'string' ? { finishReason: first.finish_reason } : {}),
        content: typeof message.content === 'string' ? message.content : '',
        toolCalls: readToolCalls(message.tool_calls),
        ...(typeof reasoning === 'string' && reasoning !== '' ? { reasoningContent: reasoning } : {}),
        ...(usage !== undefined ? { usage } : {}),
      };
    },
  };
}

/**
 * 自检（D135）：**拿真请求去问端点，把它原样回了什么摊开给用户看**。
 *
 * @anchor 为什么非做不可：从 `EMPTY_COMPLETION` 到"该怎么办"之间缺一座桥。
 *         我们能确定的只是"我们没拿到正文"，但正文为什么没来有很多种可能 ——
 *         模型名错、端点把正文放进了 `reasoning_content`、限流、400。
 *         这些**在扩展里看一眼响应就该知道**，可是用户手里只有一个报错框。
 *         与其让他去翻输出面板、猜模型名，不如点一下，发一次最小请求，
 *         把 `choices[0].message` 原样打出来。
 *
 * @anchor 为什么放在 provider 而不是命令层：它读的是**线路上那个形状**
 *         （`choices[0].message` / `reasoning_content` / `finish_reason`），
 *         而这正是本文件唯一拥有的知识。命令层只负责把这段文本塞进输出面板 ——
 *         把"怎么读响应"写进命令层，等于同一件事有两处说法，迟早只有一处对。
 *
 * @anchor 为什么**不**在这里替用户改配置：猜一个模型名写回去，失败时他更摸不着头脑；
 *         而"把事实摆出来"我们不会做错。判断留给读这段输出的人。
 *
 * **纯函数**，`node --test` 直测（不需要联网 —— 它只整理一段已经拿到的 JSON）。
 */
export function describeEndpointProbe(payload: Record<string, unknown>): string {
  const raw = JSON.stringify(payload);
  const choices = payload.choices;
  const first = Array.isArray(choices) ? (choices[0] as Record<string, unknown> | undefined) : undefined;
  const message = first?.['message'] as Record<string, unknown> | undefined;

  if (!message) {
    return [
      '端点没按 OpenAI 格式返回 choices[0].message —— 这本身就说明 baseUrl 指向的不是一个对话端点。',
      `原始响应：${snippet(raw, 500)}`,
    ].join('\n');
  }

  const content = message['content'];
  const reasoning = message['reasoning_content'];
  const toolCalls = message['tool_calls'];
  const lines: string[] = [
    `finish_reason：${String(first?.['finish_reason'] ?? '（没给）')}`,
    `content：${typeof content === 'string' ? JSON.stringify(content) : `（不是字符串：${JSON.stringify(content)}）`}`,
  ];
  if (reasoning !== undefined) lines.push(`reasoning_content：${JSON.stringify(reasoning)}`);
  if (toolCalls !== undefined) lines.push(`tool_calls：${JSON.stringify(toolCalls)}`);

  lines.push('', `结论：${probeVerdict(content, reasoning)}`);
  lines.push(`原始响应：${snippet(raw, 800)}`);
  return lines.join('\n');
}

/** 自检的结论那一句。**照事实给方向**，不猜、不替他改配置。 */
function probeVerdict(content: unknown, reasoning: unknown): string {
  const contentEmpty = typeof content !== 'string' || content.trim() === '';
  const hasReasoning = typeof reasoning === 'string' && reasoning.trim() !== '';

  if (contentEmpty && hasReasoning) {
    return (
      '端点把正文放进了 reasoning_content —— 它开着思考模式，而我们要的正文不在 content 里。' +
      '解决办法是关掉思考模式（DeepSeek 是 `{"thinking":{"type":"disabled"}}`，走 extraBody），' +
      '或者换一个不支持思考模式的模型名。'
    );
  }
  if (contentEmpty) {
    return '这次最小请求没有读到正文，请结合 finish_reason 和原始响应定位。';
  }
  return '这次最小请求正常返回了正文。它不带工具和队列上下文，不能据此判断此前失败是否偶发。';
}
