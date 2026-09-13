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
