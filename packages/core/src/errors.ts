/**
 * 类型化错误。事实源：docs/CONTRACTS.md §9。
 *
 * @anchor 注意：ContextRequest 被拒**不走这里**——非法取件请求回灌成工具结果让模型自我纠正
 *         （DECISIONS.md D29）。这里只承载真正中断流程的错误。
 */

export type AnchorErrorCode =
  | 'CONTEXT_REJECTED'        // 保留：适配器内部确实无法完成取件时使用
  | 'SCHEMA_VIOLATION'        // 输出校验失败且重试一次仍失败（CONTRACTS §3.3）
  | 'MAX_ROUNDS_EXCEEDED'     // 取件轮数超过 maxFetchRounds
  | 'PROVIDER_ERROR'          // LLM 调用失败
  | 'ADAPTER_UNAVAILABLE'     // 当前环境没有可用适配器
  | 'PEER_EXTENSION_MISSING'; // 未安装对端扩展（如未装 anchor-pdf）

export class AnchorError extends Error {
  readonly code: AnchorErrorCode;
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: AnchorErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'AnchorError';
    this.code = code;
    this.detail = detail;
  }
}

export function isAnchorError(e: unknown): e is AnchorError {
  return e instanceof AnchorError;
}

/** 给用户看的一行说明；不泄露堆栈。 */
export function describeError(e: unknown): string {
  if (isAnchorError(e)) return `${e.code}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
