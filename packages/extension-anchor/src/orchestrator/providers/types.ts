/**
 * LLM 调用面的最小抽象。事实源：docs/CONTRACTS.md §6。
 *
 * @anchor 为什么要有这一层：`Orchestrator` 的循环逻辑（取件轮数、拒绝回灌、repair 重试）
 *         是**与具体厂商无关**的，而"怎么发 HTTP"是厂商相关的。把两者分开，
 *         编排逻辑就能用 `node --test` 全量验完，不必联网、也不必有 key。
 *
 * 本文件属 orchestrator/，**禁止 import 'vscode'**（DECISIONS.md D19）。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** role='tool' 时必填：对应哪一次 tool_call 的结果 */
  toolCallId?: string;
  /** role='assistant' 且这一轮要求了取件时必填 */
  toolCalls?: readonly ToolCall[];
  /**
   * 这一轮的**思维链**（D135）。只在 `role='assistant'` 上有意义。
   *
   * @anchor 为什么必须由我们保管并原样送回：DeepSeek 的思考模式**默认开着**，
   *         而它的文档明写 ——「请求带 `tools` 时，`reasoning_content` 必须在后续每一次请求里
   *         **完整回传**，**包括那些模型没有发起工具调用的轮次**；不回传 API 直接返回 400」。
   *         官方给的 Python 示例里那句 `messages.append(response.choices[0].message)`
   *         之所以对，就是因为那个 message 对象**自带** `reasoning_content`。
   *         我们这一层的 `ChatMessage` 原本只有 `content`/`toolCalls`，
   *         等于把 `reasoning_content` 当场丢掉 —— 于是第二条请求必然 400
   *         （用户实测的"稳定复现"就是它；见 D135）。
   *
   * @anchor 为什么让编排层**原样持有**而不是让 provider 偷偷存：provider 实例是长命的，
   *         一次讲解却可能跑好几轮、还可能中途换模型（`routeModel` 按轮挑档）。
   *         "这轮属于哪次对话"只有编排层知道 —— 状态挂在 provider 上迟早串味。
   *         provider 的职责收窄成"把消息翻译上线、把回复翻译下线"。
   */
  reasoningContent?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  /** **原始 JSON 字符串**。模型输出不可信，解析与校验都在调用侧（§3.2） */
  arguments: string;
}

export interface AssistantTurn {
  /** 模型这一轮的自然语言部分；只要了工具、没说话时是空串 */
  content: string;
  toolCalls: readonly ToolCall[];
  /**
   * 这一轮的思维链（D135）。端点没给（大多数端点、以及关掉思考模式时）就是 `undefined`。
   *
   * @anchor 为什么要**取回来**而不是丢掉：它必须跟着这条 assistant 消息一起进后续请求，
   *         否则开着 `tools` 的 DeepSeek 会以 400 拒绝（见 `ChatMessage.reasoningContent`）。
   *         注意它**不是**给用户看的讲解内容 —— 渲染、校验、留档一律不看它。
   */
  reasoningContent?: string;
  /**
   * 这一轮的 token 用量（D120）。**端点给什么就记什么**：能拿到 `usage` 的端点才填，
   * 拿不到的（有的本地端点、有的代理会吞掉）就是 `undefined` —— 不猜、不估。
   */
  usage?: TokenUsage;
}

/**
 * 一次调用的 token 用量。缓存命中单独记，因为它**价钱差着倍数**（DeepSeek 的命中价是未命中的 1/10），
 * 只报一个总数等于把"这次贵在哪"掩掉了。
 *
 * @anchor 两种字段形状都要认（实测里各家不一样）：
 *   - DeepSeek：`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`
 *   - OpenAI：  `prompt_tokens_details.cached_tokens`（命中），其余算未命中
 * 拿不到细分时 `cached` 留 `undefined`，由展示层写成"未提供"而不是 0 —— 把"不知道"写成 0
 * 是在编一个看起来很确定的数（D67「报错要说实话」的同一条纪律）。
 */
export interface TokenUsage {
  /** 输入（提示）token。`undefined` = 端点没给 */
  input?: number;
  /** 输出（补全）token */
  output?: number;
  /** 输入里**命中缓存**的部分 */
  cachedInput?: number;
  /** 输入里**未命中缓存**的部分 */
  uncachedInput?: number;
}

/** 累计（并集）—— 累加时跳过 `undefined`，全为 `undefined` 就返回 `undefined`。 */
export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  const plus = (x?: number, y?: number): number | undefined =>
    x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0);
  return {
    input: plus(a.input, b.input),
    output: plus(a.output, b.output),
    cachedInput: plus(a.cachedInput, b.cachedInput),
    uncachedInput: plus(a.uncachedInput, b.uncachedInput),
  };
}

export interface ChatRequest {
  model: string;
  messages: readonly ChatMessage[];
  /** §8 的工具定义，原样透传 */
  tools?: readonly unknown[];
  temperature?: number;
  extraHeaders?: Record<string, string>;
  /** 原样透传进请求体，用于兼容任意 OpenAI 兼容端点（§6） */
  extraBody?: Record<string, unknown>;
}

export interface ChatProvider {
  chat(req: ChatRequest): Promise<AssistantTurn>;
}
