/**
 * ContextRequest 结构化日志。事实源：docs/CONTRACTS.md §7。
 *
 * @anchor 规范要求「每个 ContextRequest 必须记录日志」。含被拒的请求——
 *         被拒原因正是调试 AI 取件行为时最需要看到的东西（DECISIONS.md D29）。
 */

import type { ContextRequest } from './types.ts';

export interface ContextRequestLogEntry {
  at: number;                              // epoch ms
  round: number;                           // 第几轮（1-based）
  request: ContextRequest;
  accepted: boolean;
  rejectReason?: string;                   // accepted=false 时必有
  resultChars?: number;                    // 返回内容长度
  durationMs?: number;
}

export const CONTEXT_LOG_LIMIT = 100;

export interface ContextRequestLogger {
  record(entry: ContextRequestLogEntry): void;
  entries(): readonly ContextRequestLogEntry[];
  clear(): void;
}

export function createContextRequestLogger(opts?: {
  limit?: number;
  /** 额外落点，如 VS Code OutputChannel 或侧边栏 ToolTrace 面板 */
  sink?: (entry: ContextRequestLogEntry) => void;
}): ContextRequestLogger {
  const limit = opts?.limit ?? CONTEXT_LOG_LIMIT;
  const buffer: ContextRequestLogEntry[] = [];

  return {
    record(entry) {
      buffer.push(entry);
      // 环形：超出上限丢最旧的
      while (buffer.length > limit) buffer.shift();
      opts?.sink?.(entry);
    },
    entries() {
      return buffer.slice();
    },
    clear() {
      buffer.length = 0;
    },
  };
}
