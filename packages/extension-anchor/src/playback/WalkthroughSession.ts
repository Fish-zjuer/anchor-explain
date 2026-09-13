/**
 * 会话状态机 —— 「当前讲到第几步、是播放还是暂停、文档是否已经变了」的唯一事实源。
 *
 * @anchor 它**不 import 'vscode'**，也不碰任何渲染：宿主（commands.ts）订阅它的变化，
 *         再分别推给 decoration 渲染器、侧边栏、状态栏。三者读的是同一份快照，
 *         所以「侧边栏说第 2 步、编辑器高亮第 3 步」这类错位在结构上不可能发生。
 *
 * 说明它为什么不是"多一层没用"：staleness（讲解期间文件被改）必须由一个中心点判定，
 * 否则三个渲染方各自判断，就会各自给出不同的结论。
 */

import { AnchorError } from '@anchor/core';
import type { ExplanationResult, WalkthroughStep } from '@anchor/core';
import type { WalkthroughState } from '../protocol.ts';

export interface WalkthroughSnapshot {
  readonly state: WalkthroughState;
  readonly result: ExplanationResult;
  readonly index: number;          // 0-based
  readonly step: WalkthroughStep;  // 恒存在：构造时已保证 steps 非空
  readonly total: number;
  /** 讲解开始后文档被改动过：高亮可能已错行，UI 必须如实提示而不是装作没事 */
  readonly stale: boolean;
  readonly atStart: boolean;
  readonly atEnd: boolean;
}

export type SnapshotListener = (snapshot: WalkthroughSnapshot) => void;

/** 自动播放的默认步间隔。**不做成配置项**（§6 配置表已冻结）；需要时改这里。 */
export const PLAY_INTERVAL_MS = 2600;

export interface WalkthroughSessionOptions {
  playIntervalMs?: number;
}

export class WalkthroughSession {
  readonly #result: ExplanationResult;
  readonly #steps: readonly WalkthroughStep[];
  readonly #intervalMs: number;
  readonly #listeners = new Set<SnapshotListener>();

  #index = 0;
  #state: WalkthroughState = 'running';
  #stale = false;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(result: ExplanationResult, opts: WalkthroughSessionOptions = {}) {
    // 校验闸门（validateExplanation §3.3 第 2 条）已经保证 steps ≥ 1；
    // 这里再断言一次，是因为"至少有一个 step"是下面 `#steps[#index]!` 成立的前提 ——
    // 与其用可选类型把 undefined 扩散到所有渲染方，不如在门口挡住。
    if (result.steps.length === 0) {
      throw new AnchorError('SCHEMA_VIOLATION', '讲解结果没有任何步骤，拒绝开启会话');
    }
    this.#result = result;
    this.#steps = result.steps;
    this.#intervalMs = opts.playIntervalMs ?? PLAY_INTERVAL_MS;
  }

  get snapshot(): WalkthroughSnapshot {
    return {
      state: this.#state,
      result: this.#result,
      index: this.#index,
      step: this.#steps[this.#index]!,
      total: this.#steps.length,
      stale: this.#stale,
      atStart: this.#index === 0,
      atEnd: this.#index === this.#steps.length - 1,
    };
  }

  /** §4.2：`walkthroughActive` 该不该为 true。`idle` 与 `done` 都算已结束。 */
  get isActive(): boolean {
    return this.#state !== 'idle' && this.#state !== 'done';
  }

  get total(): number {
    return this.#steps.length;
  }

  /** 推进到下一步；已在最后一步则收尾（`done`）并返回 false。 */
  next(): boolean {
    if (this.#index >= this.#steps.length - 1) {
      this.#clearTimer();
      this.#state = 'done';
      this.#emit();
      return false;
    }
    this.#index += 1;
    this.#emit();
    return true;
  }

  prev(): boolean {
    if (this.#index <= 0) return false;
    this.#index -= 1;
    if (this.#state === 'done') this.#state = 'running';
    this.#emit();
    return true;
  }

  /** 跳到指定步（0-based）。越界一律忽略，不抛错。 */
  goto(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= this.#steps.length) return false;
    if (index === this.#index && this.#state !== 'done') return false;
    this.#index = index;
    if (this.#state === 'done') this.#state = 'running';
    this.#emit();
    return true;
  }

  /** 播放 / 暂停。返回切换后的状态，便于调用方决定状态栏图标。 */
  togglePlay(): WalkthroughState {
    if (this.#state === 'playing') this.pause();
    else this.play();
    return this.#state;
  }

  play(): void {
    if (this.#state !== 'running' && this.#state !== 'paused') return;
    this.#state = 'playing';
    this.#schedule();
    this.#emit();
  }

  pause(): void {
    if (this.#state !== 'playing') return;
    this.#clearTimer();
    this.#state = 'paused';
    this.#emit();
  }

  /** 用户主动退出：清理定时器并落到 `idle`（§4.2 的 stop）。 */
  stop(): void {
    this.#clearTimer();
    this.#state = 'idle';
    this.#emit();
  }

  /**
   * 标记文档已改动。不是"把高亮挪一挪"，而是如实告诉用户高亮可能已经错行 ——
   * 见 `core/src/ports.ts` 里 EditorPort.documentTextHash 的注释。
   */
  markStale(): void {
    if (this.#stale) return;
    this.#stale = true;
    this.#emit();
  }

  onDidChange(listener: SnapshotListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  dispose(): void {
    this.#clearTimer();
    this.#listeners.clear();
  }

  #schedule(): void {
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#tick();
    }, this.#intervalMs);
  }

  #tick(): void {
    if (this.#state !== 'playing') return;
    // next() 在最后一步会自己落成 done 并清掉定时器，所以这里只需处理"还能继续"的情况
    if (this.next()) this.#schedule();
  }

  #clearTimer(): void {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
  }

  #emit(): void {
    const snap = this.snapshot;
    for (const l of [...this.#listeners]) l(snap);
  }
}
