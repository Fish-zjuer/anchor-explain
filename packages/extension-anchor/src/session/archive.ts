/** S13 完整讲解历史：存储串行，文件名由安全 ID 决定，损坏单档不阻塞其余记录。 */
import { isRunId, readLastRun, toStoredRun } from './lastRun.ts';
import type { LastRun } from './lastRun.ts';
import type { TokenUsage } from '../orchestrator/providers/types.ts';

export interface ArchiveIO {
  list(): Promise<readonly string[]>;
  read(name: string): Promise<string>;
  /** 宿主以临时文件 + rename 实现；失败时旧档仍完整。 */
  writeAtomic(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export interface ArchiveSummary {
  id: string;
  title: string;
  sourceName: string;
  savedAt: number;
  updatedAt: number;
  steps: number;
  language: 'zh' | 'en';
  usage?: TokenUsage;
}

export type HistoryMessage =
  | { type: 'history:ready' | 'history:refresh' | 'history:clear' | 'history:folder' }
  | { type: 'history:open' | 'history:delete'; id: string };

export function parseHistoryMessage(raw: unknown): HistoryMessage | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  if (value.type === 'history:open' || value.type === 'history:delete') {
    return isRunId(value.id) ? { type: value.type, id: value.id } : undefined;
  }
  if (value.type === 'history:ready' || value.type === 'history:refresh' || value.type === 'history:clear' || value.type === 'history:folder') return { type: value.type };
  return undefined;
}

export function archiveSummary(run: LastRun & { id: string }): ArchiveSummary {
  return { id: run.id, title: run.result.title || run.anchor.sourceName || '讲解', sourceName: run.anchor.sourceName,
    savedAt: run.savedAt, updatedAt: run.updatedAt ?? run.savedAt, steps: run.result.steps.length,
    language: run.language ?? 'zh', ...(run.usage ? { usage: run.usage } : {}) };
}

export function createArchiveStore(io: ArchiveIO, onInvalid?: (name: string, reason: string) => void) {
  let pending: Promise<unknown> = Promise.resolve();
  // @anchor 保存、追问覆盖、读取和删除共用队列，删除后不能被早先的异步保存复活。
  function ordered<T>(operation: () => Promise<T>): Promise<T> {
    const job = pending.then(operation);
    pending = job.catch(() => undefined);
    return job;
  }
  function filename(id: string): string {
    if (!isRunId(id)) throw new Error('历史记录 ID 无效。');
    return `${id}.json`;
  }
  async function read(id: string): Promise<LastRun & { id: string }> {
    const name = filename(id);
    const run = readLastRun(JSON.parse(await io.read(name)) as unknown);
    if (!run || run.id !== id) throw new Error('历史记录损坏或 ID 不匹配。');
    return { ...run, id };
  }
  return {
    save(run: LastRun): Promise<void> {
      if (!isRunId(run.id)) return Promise.reject(new Error('历史记录缺少安全 ID。'));
      const name = filename(run.id);
      const text = JSON.stringify(toStoredRun(run)); // 在入队前冻结，避免追问修改排队中的快照。
      return ordered(() => io.writeAtomic(name, text));
    },
    read(id: string) { return ordered(() => read(id)); },
    list(): Promise<ArchiveSummary[]> {
      return ordered(async () => {
        const result: ArchiveSummary[] = [];
        for (const name of await io.list()) {
          if (!name.endsWith('.json') || !isRunId(name.slice(0, -5))) continue;
          try { result.push(archiveSummary(await read(name.slice(0, -5)))); }
          catch (err) { onInvalid?.(name, (err as Error).message); }
        }
        return result.sort((a, b) => b.savedAt - a.savedAt || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
      });
    },
    remove(id: string) { const name = filename(id); return ordered(() => io.remove(name)); },
    clear(): Promise<void> {
      return ordered(async () => {
        for (const name of await io.list()) {
          if (name.endsWith('.json') && isRunId(name.slice(0, -5))) await io.remove(name);
        }
      });
    },
    settled() { return pending; },
  };
}
