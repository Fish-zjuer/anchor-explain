/**
 * 问答线程的纯操作（D99 定版）。
 *
 * @anchor 「解答附着在块上」的全部状态就是 ThreadStore。落盘（globalStorage / 工作室
 *         的存储）是调用方的事，这里只提供**纯**的增删改查 —— node --test 直测，
 *         三个消费方（活页、工作室、导出）不必各写一份。线程 ID 按内容算：
 *         同一块问同一句话，两次的 ID 不同（带时间戳），但同一份存档里唯一。
 *
 * 本文件零依赖。
 */

import { fnv1a } from './ids.ts';
import type { FollowUp, Thread, ThreadStore } from './types.ts';

export function makeThread(
  blockIds: readonly string[],
  question: string,
  answer: string,
  createdAt: number,
  model?: string,
): Thread {
  const id = `t-${fnv1a([...blockIds].sort().join('|') + '\u0000' + question + '\u0000' + String(createdAt))}`;
  return {
    id,
    blockIds: [...blockIds],
    question: question.trim(),
    answer: answer.trim(),
    createdAt,
    ...(model !== undefined ? { model } : {}),
    followUps: [],
  };
}

export function attachThread(store: ThreadStore, thread: Thread): ThreadStore {
  return { ...store, threads: [...store.threads, thread] };
}

export function removeThread(store: ThreadStore, threadId: string): ThreadStore {
  return { ...store, threads: store.threads.filter((t) => t.id !== threadId) };
}

/** 挂在某一块上的全部线程（单块的 + 组线程里引用它的） */
export function threadsForBlock(store: ThreadStore, blockId: string): readonly Thread[] {
  return store.threads.filter((t) => t.blockIds.includes(blockId));
}

/** 组线程（挂在多块上）显示在末块之后 —— 取"块流里最后一轮"的归属 */
export function threadsEndingAtBlock(store: ThreadStore, blockId: string): readonly Thread[] {
  return store.threads.filter((t) => t.blockIds.length > 1 && t.blockIds.at(-1) === blockId);
}

export function addFollowUp(store: ThreadStore, threadId: string, followUp: FollowUp): ThreadStore {
  return {
    ...store,
    threads: store.threads.map((t) =>
      t.id === threadId ? { ...t, followUps: [...t.followUps, followUp] } : t,
    ),
  };
}

/** 追问的上下文拼装（D102 的追问链用；有界 —— 只带块原文与线程本身） */
export function threadContext(store: ThreadStore, threadId: string, blockTexts: readonly string[]): string {
  const thread = store.threads.find((t) => t.id === threadId);
  if (thread === undefined) return blockTexts.join('\n\n');
  const round = (q: string, a: string): string => `问：${q}\n答：${a}`;
  const history = [round(thread.question, thread.answer), ...thread.followUps.map((f) => round(f.question, f.answer))].join('\n\n');
  return `${blockTexts.join('\n\n')}\n\n── 之前的问答 ──\n${history}`;
}

/** 一个新追问（挂在所属线程的 `followUps` 里，按下标寻址，不需要自己的 ID） */
export function makeFollowUp(question: string, answer: string, createdAt: number): FollowUp {
  return { question: question.trim(), answer: answer.trim(), createdAt };
}
