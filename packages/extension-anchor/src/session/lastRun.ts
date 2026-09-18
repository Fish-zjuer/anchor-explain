/**
 * 「上次讲解」—— 一份讲解的**存档**（D83）。事实源：docs/CONTRACTS.md §4.1.4 / §5.3。
 *
 * @anchor 为什么要有这个东西：用户的原话是「讲解结束时，需要能重新讲，并且应该能保存/重放之前的内容」。
 *         在那之前，一次讲解是**一次性的**：讲完（`done`）或按了退出（`idle`）之后，
 *         那份 `ExplanationResult` 就只活在 webview 的 DOM 里 —— 面板一关、VS Code 一退，
 *         几十秒的等待（以及为此花掉的 token）就再也没有了，想再看一遍只能**重新问一次模型**。
 *
 *         所以这里有两条**分开**的能力，别把它们合成一个按钮：
 *           - **重放**：把存档原样从第 1 步再走一遍 —— 不碰网络、不再花钱，结果一模一样
 *           - **重新讲**：拿同一个锚点再问一次模型 —— 会得到另一种讲法，也会再花一次钱
 *         用户说的"重新讲"两件事都可能指，而它们的代价差一个数量级，
 *         所以面板上是两颗按钮、两个命令，绝不由我们替他选。
 *
 * 本文件**不 import 'vscode'**：`Memento`（`context.workspaceState`）由调用方读好再传进来，
 * 于是这段能被 `node --test` 直测（与 `start/startModel.ts` 同一条理由，D19）。
 */

import { isCodeLocation, isPDFLocation } from '@anchor/core';
import type { Anchor, ExplanationResult, Location, SubHighlight, WalkthroughStep } from '@anchor/core';
import { isAnchorLike } from '../protocol.ts';

export interface LastRun {
  readonly result: ExplanationResult;
  readonly anchor: Anchor;
  /** 存下来的时刻（`Date.now()`）。只为"这是什么时候讲的"这句话，不参与任何判据。 */
  readonly savedAt: number;
}

/**
 * 存档在 `Memento` 里的键。
 *
 * **不要改这个键**：改了等于让所有人已有的存档静默失效 —— 而失效的表现是
 * 「重放上次讲解」说"还没有讲过任何一段"，用户会以为那个功能是坏的，
 * 而真正的原因是我们换了个 key。要改形状就靠 `readLastRun` 的版本判断（见下）。
 */
export const LAST_RUN_KEY = 'anchorExplain.lastRun';

/**
 * 存档的形状版本。**加进存档里、并在读的时候对不上就丢掉**（而不是尽力兼容）。
 *
 * @anchor 与「不读坏数据」同一条立场：这份数据跨 VS Code 重启活着，
 *         它可能是**上一个版本的我们**写的。形状不对时若硬读，最先炸的地方是渲染层
 *         （`step.highlights.map(...)` 一类），而那里离"存档是旧的"这个真因很远。
 *         宁可说一句"上次那份存档读不出来了"，也不要拿半截数据去画框。
 */
const STORED_VERSION = 1;

/** 上限一律**夹**而不是拒：一份超大的存档仍然能重放，没必要因为标题长就整份丢掉。 */
const MAX_TITLE_CHARS = 400;
const MAX_TEXT_CHARS = 20_000;
const MAX_HIGHLIGHTS_PER_STEP = 200;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, max: number): string | undefined {
  return typeof v === 'string' ? v.slice(0, max) : undefined;
}

/**
 * 把一个来路不明的值收成一个**渲染层敢用**的位置，收不了就 `undefined`。
 *
 * 为什么单独收一处：`isCodeLocation` / `isPDFLocation` 的签名收窄的是 `Location`，
 * 而这里手上的东西是 `unknown`（存档是外部输入）—— 直接传进去在类型上就不成立
 * （TS 会拦住，而绕过它的办法是到处写 `as`）。写成这一个函数之后，
 * "形状不对就丢掉"这条判据在文件里只有一处，两个调用点不可能各自漏判一半。
 */
function locationOf(raw: unknown): Location | undefined {
  if (!isRecord(raw)) return undefined;
  const loc = raw as unknown as Location;
  if (!isCodeLocation(loc) && !isPDFLocation(loc)) return undefined;
  return loc;
}

/**
 * 一个子高亮能不能画。**只查渲染层真正会碰的字段**：
 * `location` 必须是个合法来源（代码行区间 / PDF 页码 + bbox），`narration` 必须是字符串。
 * `emphasis` 非法是允许的 —— 它在渲染层本来就会降级（配色是装饰性字段，§3.3 同一条）。
 */
function coerceHighlight(raw: unknown): SubHighlight | undefined {
  if (!isRecord(raw)) return undefined;
  const location = locationOf(raw.location);
  if (!location) return undefined;
  const narration = str(raw.narration, MAX_TEXT_CHARS);
  if (narration === undefined) return undefined;
  return { location, narration, emphasis: raw.emphasis } as unknown as SubHighlight;
}

function coerceStep(raw: unknown): WalkthroughStep | undefined {
  if (!isRecord(raw)) return undefined;
  const location = locationOf(raw.location);
  if (!location) return undefined;
  const text = str(raw.text, MAX_TEXT_CHARS);
  if (text === undefined) return undefined;

  const rawHighlights = Array.isArray(raw.highlights) ? raw.highlights : [];
  const highlights: SubHighlight[] = [];
  for (const item of rawHighlights.slice(0, MAX_HIGHLIGHTS_PER_STEP)) {
    const highlight = coerceHighlight(item);
    // 子高亮坏一个不该让整份存档作废：丢掉它，其余照常画
    if (highlight) highlights.push(highlight);
  }

  return {
    location,
    text,
    title: str(raw.title, MAX_TITLE_CHARS),
    intro: str(raw.intro, MAX_TEXT_CHARS),
    highlights,
  } as WalkthroughStep;
}

/**
 * 读存档。**读不出来一律返回 `undefined`**（调用方据此说"还没有讲过任何一段"或"这份存档读不出来"），
 * 绝不抛 —— 它的调用方是命令与面板，一个坏档不该让整条链路炸掉。
 */
export function readLastRun(raw: unknown): LastRun | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.version !== STORED_VERSION) return undefined;
  if (!isAnchorLike(raw.anchor)) return undefined;

  const result = raw.result;
  if (!isRecord(result)) return undefined;
  if (typeof result.summary !== 'string') return undefined;
  if (typeof result.confidence !== 'number' || !Number.isFinite(result.confidence)) return undefined;
  if (!Array.isArray(result.steps)) return undefined;

  const steps: WalkthroughStep[] = [];
  for (const item of result.steps) {
    const step = coerceStep(item);
    if (step) steps.push(step);
  }
  // 一个 step 都不剩 = 这份存档没有可讲的东西。会话状态机也会在门口拒掉它
  // （`WalkthroughSession` 构造器要求 steps ≥ 1），与其让它在别处抛，不如在这里就认输。
  if (steps.length === 0) return undefined;

  const savedAt = typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? raw.savedAt : 0;

  return {
    anchor: raw.anchor,
    result: {
      steps,
      summary: result.summary.slice(0, MAX_TEXT_CHARS),
      confidence: result.confidence,
      title: str(result.title, MAX_TITLE_CHARS),
    },
    savedAt,
  };
}

/** 写存档。形状与 `readLastRun` 一一对应 —— 两边同时改，别只改一处。 */
export function toStoredRun(run: LastRun): unknown {
  return {
    version: STORED_VERSION,
    savedAt: run.savedAt,
    anchor: run.anchor,
    result: run.result,
  };
}
