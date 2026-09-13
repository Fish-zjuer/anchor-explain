/**
 * 会话状态机 —— 「现在讲到哪、是播放还是暂停、文档是否已经变了」的唯一事实源。
 *
 * @anchor 它**不 import 'vscode'**，也不碰任何渲染：宿主（commands.ts）订阅它的变化，
 *         再分别推给 decoration 渲染器、侧边栏、状态栏。三者读的是同一份快照，
 *         所以「侧边栏说第 2 步、编辑器高亮第 3 步」这类错位在结构上不可能发生。
 *
 * ## 游标是「拍」，不是「步」（D48）
 *
 * 用户给的观感要求是：**浅色荧光包住整个块，再用一个荧光在块内部逐个小逻辑点扫过去**。
 * 于是游标设计的不是"第几步"，而是线性的**拍**：
 *
 * ```
 * 第 1 步： [整块底色] → [扫第 1 个点] → [扫第 2 个点]
 * 第 2 步： [整块底色] → [扫第 1 个点] → …
 * ```
 *
 * 一个 step（有 n 个子高亮）占 n+1 拍：第 1 拍只铺块级底色（"先看清这一段整体"），
 * 之后每拍点亮一个子高亮。`next()` 推进一拍，所以"更细"这件事不需要新的按键。
 *
 * 这也顺带修掉了 S1 第一版的观感事故：那版把**所有**子高亮同时点亮，
 * 于是 40/41/42 三行出现三种不同混合色，看起来像"隔行乱变颜色"。
 * 一次只点亮一个点，块级底色就永远是均匀的，那一行亮色是"扫描位置"而不是噪声。
 *
 * 为什么用扁平下标而不是 (stepIndex, pointIndex) 两个字段：`next`/`prev`/`atEnd`/
 * 播放定时器全都要"往后挪一格"，扁平下标让这件事只有一个地方会算错。
 * 对外仍然暴露 `index`（步骤下标）—— §5.3 的 `session:update` 用的就是它。
 */

import { AnchorError } from '@anchor/core';
import type { ExplanationResult, SubHighlight, WalkthroughStep } from '@anchor/core';
import type { WalkthroughState } from '../protocol.ts';

export interface WalkthroughSnapshot {
  readonly state: WalkthroughState;
  readonly result: ExplanationResult;
  /** 步骤下标（0-based）。名字保持 `index`：`session:update` 用的就是它 */
  readonly index: number;
  readonly step: WalkthroughStep;
  readonly total: number;              // 共几步
  /** 步内扫描位置：`-1` = 这一拍只铺整块底色；`0..n-1` = 正在扫第几个子高亮 */
  readonly pointIndex: number;
  readonly pointTotal: number;         // 当前步有几个子高亮
  readonly point: SubHighlight | undefined;
  /** 跨整段讲解的第几拍（1-based），一拍 = 按一次「下一步」 */
  readonly beat: number;
  readonly beatTotal: number;
  /** 讲解开始后文档被改动过：高亮可能已错行，UI 必须如实提示而不是装作没事 */
  readonly stale: boolean;
  readonly atStart: boolean;
  readonly atEnd: boolean;
}

export type SnapshotListener = (snapshot: WalkthroughSnapshot) => void;

/**
 * 自动播放每一拍的间隔。**不做成配置项**（§6 配置表已冻结）。
 * 比 S1 第一版短：那时候一拍 = 一整步，现在一拍 = 一个扫描点，太长会显得拖。
 */
export const PLAY_INTERVAL_MS = 1600;

export interface WalkthroughSessionOptions {
  playIntervalMs?: number;
}

/** 一个 step 占几拍：1 拍铺整块 + 每个子高亮 1 拍 */
export function beatsPerStep(step: WalkthroughStep): number {
  return 1 + (step.highlights?.length ?? 0);
}

export function totalBeats(steps: readonly WalkthroughStep[]): number {
  let n = 0;
  for (const step of steps) n += beatsPerStep(step);
  return n;
}

/** 把扁平的"拍"换算成 (步骤下标, 步内扫描位置)；越界返回 undefined */
export function locateBeat(
  steps: readonly WalkthroughStep[],
  beat: number,
): { index: number; pointIndex: number } | undefined {
  if (!Number.isInteger(beat) || beat < 0) return undefined;
  let rest = beat;
  for (let i = 0; i < steps.length; i += 1) {
    const n = beatsPerStep(steps[i]!);
    if (rest < n) return { index: i, pointIndex: rest - 1 };
    rest -= n;
  }
  return undefined;
}

/** 某一步的第一拍（只铺底色那一拍）；越界返回最后一步的第一拍 */
export function firstBeatOfStep(steps: readonly WalkthroughStep[], index: number): number {
  const clamped = Math.min(Math.max(Math.trunc(index), 0), Math.max(steps.length - 1, 0));
  let beat = 0;
  for (let i = 0; i < clamped; i += 1) beat += beatsPerStep(steps[i]!);
  return beat;
}

export class WalkthroughSession {
  readonly #result: ExplanationResult;
  readonly #steps: readonly WalkthroughStep[];
  readonly #intervalMs: number;
  readonly #listeners = new Set<SnapshotListener>();

  #beat = 0;
  #state: WalkthroughState = 'running';
  #stale = false;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(result: ExplanationResult, opts: WalkthroughSessionOptions = {}) {
    // 校验闸门（validateExplanation §3.3 第 2 条）已经保证 steps ≥ 1；
    // 这里再断言一次，是因为"至少有一个 step"是下面 `#steps[...]!` 成立的前提 ——
    // 与其用可选类型把 undefined 扩散到所有渲染方，不如在门口挡住。
    if (result.steps.length === 0) {
      throw new AnchorError('SCHEMA_VIOLATION', '讲解结果没有任何步骤，拒绝开启会话');
    }
    this.#result = result;
    this.#steps = result.steps;
    this.#intervalMs = opts.playIntervalMs ?? PLAY_INTERVAL_MS;
  }

  get snapshot(): WalkthroughSnapshot {
    const cursor = locateBeat(this.#steps, this.#beat) ?? { index: 0, pointIndex: -1 };
    const step = this.#steps[cursor.index]!;
    const pointTotal = step.highlights?.length ?? 0;

    return {
      state: this.#state,
      result: this.#result,
      index: cursor.index,
      step,
      total: this.#steps.length,
      pointIndex: cursor.pointIndex,
      pointTotal,
      point: cursor.pointIndex >= 0 ? step.highlights?.[cursor.pointIndex] : undefined,
      beat: this.#beat + 1,
      beatTotal: totalBeats(this.#steps),
      stale: this.#stale,
      atStart: this.#beat === 0,
      atEnd: this.#beat >= totalBeats(this.#steps) - 1,
    };
  }

  /** §4.2：`walkthroughActive` 该不该为 true。`idle` 与 `done` 都算已结束。 */
  get isActive(): boolean {
    return this.#state !== 'idle' && this.#state !== 'done';
  }

  get total(): number {
    return this.#steps.length;
  }

  /** 推进一步；已在最后一拍则收尾（`done`）并返回 false。 */
  next(): boolean {
    if (this.#beat >= totalBeats(this.#steps) - 1) {
      this.#clearTimer();
      this.#state = 'done';
      this.#emit();
      return false;
    }
    this.#beat += 1;
    this.#emit();
    return true;
  }

  prev(): boolean {
    if (this.#beat <= 0) return false;
    this.#beat -= 1;
    if (this.#state === 'done') this.#state = 'running';
    this.#emit();
    return true;
  }

  /** 跳到某一步的**第一拍**（只铺底色那拍）。越界一律忽略，不抛错。 */
  goto(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= this.#steps.length) return false;
    const target = firstBeatOfStep(this.#steps, index);
    if (target === this.#beat && this.#state !== 'done') return false;
    this.#beat = target;
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
    // next() 在最后一拍会自己落成 done 并清掉定时器，所以这里只需处理"还能继续"的情况
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
