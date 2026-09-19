/**
 * 配置的**纯映射**。事实源：docs/CONTRACTS.md §6（**冻结**）。
 *
 * @anchor 为什么把"读 vscode 设置"和"算出配置"分开：
 *         前者只能按 F5 验，后者能被 `node --test` 全量验。
 *         往这里塞一行 `import * as vscode`，那几条"字段缺失怎么办"的分支就永远只有肉眼覆盖。
 *         真实的 vscode 读取在 `vscode/configSource.ts`。
 *
 * 本文件**禁止 import 'vscode'**（D19）。
 */

import { DEFAULT_LANGUAGE, DEFAULT_STYLE, coerceLanguage, coerceStyle, describeLanguage, describeStyle } from './prompts/index.ts';
import type { ExplainLanguage, ExplainStyle } from './prompts/index.ts';
import { MAX_FETCH_LINES_CEILING, DEFAULT_MAX_FETCH_LINES } from './orchestrator/validateContextRequest.ts';
import type { FetchScope } from './orchestrator/validateContextRequest.ts';

/** §6 的 `providers[id]`。`apiKey` 允许留空 —— 那表示"去 SecretStorage 取"。 */
export interface ProviderSettings {
  baseUrl: string;
  apiKey?: string;
  tier1Model: string;
  tier2Model?: string;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
}

export interface AnchorConfig {
  providerId: string;
  /** 没有可用配置时是 null（此时讲解应当明确报"还没配置"，而不是悄悄什么都不做） */
  provider: ProviderSettings | null;
  maxFetchRounds: number;
  /**
   * 单次取件最多几行（D71）。默认 400。
   *
   * @anchor 原来是适配器里写死的 60，用户在真工程上实测"60 太少了，200 都不一定够"：
   *         一个嵌入式头文件一两百行，60 行连结构体的字段都列不全，而每轮被拒还白烧一次预算。
   */
  maxFetchLines: number;
  preferSecretStorage: boolean;
  /** 讲解风格（D65）。默认 `concise`（简约）：用户第一版的反馈是"不要那么多名词什么的" */
  style: ExplainStyle;
  /**
   * 讲解语言（D97）。默认 `zh`；`en` 时 prompt/示范/侧边栏讲解面板/导出全换成英文面。
   * 扩展自身的按钮与通知不跟随（见 prompts/index.ts 里 ExplainLanguage 的注释）。
   */
  language: ExplainLanguage;
  /**
   * 跨文件取件的范围（S9a）。默认 `related`：嵌入式里宏/结构体/调用者散在各文件，
   * 只看锚点文件讲不出"数据从哪来、给谁用"（用户的原话）。
   */
  fetchScope: FetchScope;
  temperature?: number;
}

export const DEFAULT_MAX_FETCH_ROUNDS = 3;
/** §6 的默认值 */
export const DEFAULT_ACTIVE_PROVIDER = 'default';
export const MAX_FETCH_ROUNDS_CEILING = 20;

/** SecretStorage 的键名约定。**集中在这里**，因为读写两侧（设置命令 / 读取）必须一致。 */
export function apiKeySecretName(providerId: string): string {
  return `anchorExplain.apiKey.${providerId}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

function asStringMap(v: unknown): Record<string, string> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) if (typeof val === 'string') out[k] = val;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 把一个 provider 的原始配置解析成可用配置。
 *
 * **`baseUrl` 与 `tier1Model` 缺任意一个就返回 null**：这两个字段没法给默认值
 * （给一个默认端点等于替用户选厂商，给一个默认模型名等于替他花钱）。
 * 其余字段缺了就退化 —— 缺 `tier2Model` 只是"不升级到视觉档"，不该让整个讲解不可用。
 */
export function resolveProvider(id: string, raw: unknown): ProviderSettings | null {
  if (!isRecord(raw)) return null;
  const baseUrl = asString(raw.baseUrl);
  const tier1Model = asString(raw.tier1Model);
  if (!baseUrl || !tier1Model) return null;

  const out: ProviderSettings = { baseUrl, tier1Model };

  const apiKey = asString(raw.apiKey);
  if (apiKey) out.apiKey = apiKey;

  const tier2Model = asString(raw.tier2Model);
  if (tier2Model) out.tier2Model = tier2Model;

  const extraHeaders = asStringMap(raw.extraHeaders);
  if (extraHeaders) out.extraHeaders = extraHeaders;

  if (isRecord(raw.extraBody)) out.extraBody = raw.extraBody;

  // id 不进 settings（它是键名），但留着便于排查"到底用了哪个 provider"
  void id;
  return out;
}

/** 取件轮数的边界。用户填 0 或 99 都不该炸，也不该让模型无限取件。 */
export function clampRounds(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_MAX_FETCH_ROUNDS;
  const n = Math.trunc(raw);
  if (n < 0) return 0;
  return Math.min(n, MAX_FETCH_ROUNDS_CEILING);
}

/**
 * 单次取件的行数边界。**与闸门的默认值、硬上限同一个来源**（都在 `validateContextRequest.ts`）——
 * 这两个数一旦分成两处写，就会变成"提示词说 400、闸门按 60 拒"这种自相矛盾（D71）。
 */
export function clampFetchLines(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_MAX_FETCH_LINES;
  const n = Math.trunc(raw);
  if (n < 1) return 1;
  return Math.min(n, MAX_FETCH_LINES_CEILING);
}

export interface RawConfigInputs {
  /** `anchorExplain.providers` 的原始值 */
  providers: unknown;
  /** `anchorExplain.activeProvider` 的原始值 */
  activeProvider: unknown;
  /** `anchorExplain.maxFetchRounds` 的原始值 */
  maxFetchRounds: unknown;
  /** `anchorExplain.maxFetchLines` 的原始值（可空） */
  maxFetchLines?: unknown;
  /** `anchorExplain.preferSecretStorage` 的原始值 */
  preferSecretStorage: unknown;
  /** `anchorExplain.temperature` 的原始值（可空） */
  temperature?: unknown;
  /** `anchorExplain.style` 的原始值（可空） */
  style?: unknown;
  /** `anchorExplain.language` 的原始值（可空，D97） */
  language?: unknown;
  /** `anchorExplain.fetchScope` 的原始值（可空） */
  fetchScope?: unknown;
}

export function resolveConfig(raw: RawConfigInputs): AnchorConfig {
  const providerId = asString(raw.activeProvider) ?? DEFAULT_ACTIVE_PROVIDER;
  const providers = isRecord(raw.providers) ? raw.providers : {};
  const provider = resolveProvider(providerId, providers[providerId]);

  const temperature =
    typeof raw.temperature === 'number' && Number.isFinite(raw.temperature) ? raw.temperature : undefined;

  const config: AnchorConfig = {
    providerId,
    provider,
    maxFetchRounds: clampRounds(raw.maxFetchRounds),
    maxFetchLines: clampFetchLines(raw.maxFetchLines),
    // §6 默认 true：只有在用户明确关掉时才回落配置里的明文 key
    preferSecretStorage: raw.preferSecretStorage !== false,
    // 风格非法值退化成默认档，不报错：设置里写错一个词不该让讲解不可用
    style: coerceStyle(raw.style),
    // 语言同理（D97）：写错一个词回落中文，而不是让讲解不可用
    language: coerceLanguage(raw.language),
    fetchScope: coerceFetchScope(raw.fetchScope),
  };
  if (temperature !== undefined) config.temperature = temperature;
  return config;
}

export const DEFAULT_FETCH_SCOPE: FetchScope = 'related';

/** 只有三个合法值；写错一个词不该让讲解不可用，一律退化成默认档。 */
export function coerceFetchScope(raw: unknown): FetchScope {
  return raw === 'off' || raw === 'same-dir' || raw === 'related' ? raw : DEFAULT_FETCH_SCOPE;
}

/** 配置齐不齐，一句话说清。`Anchor: 显示状态` 与"未配置"的报错共用这句。 */
export function describeConfig(config: AnchorConfig): string {
  if (!config.provider) {
    return `没有可用的 provider（activeProvider = "${config.providerId}"）。请在设置里填 anchorExplain.providers。`;
  }
  const vision = config.provider.tier2Model ? `，视觉档 ${config.provider.tier2Model}` : '';
  // 风格用 describeStyle 的人话名（D93）：档位 id 是英文，"一眼看出当前是哪档"靠的是中文。
  // 语言只在非默认时出现（D97）：默认中文是常态，每一行状态都带"输出语言 中文"反而是噪音。
  const language = config.language === 'en' ? `；输出语言 ${describeLanguage(config.language)}` : '';
  return `${config.providerId}：${config.provider.tier1Model} @ ${config.provider.baseUrl}${vision}；最多取件 ${config.maxFetchRounds} 次（每次 ≤${config.maxFetchLines} 行）；风格 ${describeStyle(config.style)}；取件范围 ${config.fetchScope}${language}`;
}

/**
 * `baseUrl` 的形状检查。返回 `null` 表示通过，否则返回给用户看的一句话。
 *
 * @anchor **只挡明确的错**，不挡"我猜你不知道"的东西：少了协议头、或者把完整端点
 *         （`/chat/completions`）一起写进来 —— 这两个是真实发生过的错误，而且报出来的症状
 *         离原因很远（前者是"连不上 https://xxx"，后者是 404）。其余一律放行：
 *         端点长什么样是端点那边决定的，我们没资格替他判。
 */
export function checkBaseUrl(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return '不能为空';
  if (!/^https?:\/\//iu.test(value)) return '要带上协议头，例如 https://api.deepseek.com';
  if (/\/chat\/completions\/?$/iu.test(value)) return '不要带 /chat/completions —— 我们自己在后面拼它';
  return null;
}

/** 结尾的斜杠要收掉：我们拼的是 `${baseUrl}/chat/completions`，多一个斜杠会变成 `//`。 */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/u, '');
}

/**
 * `providers` 这个对象**少了一层**吗（D63）。
 *
 * 正确形状是"每个 provider 是一个对象"：`{ default: { baseUrl, tier1Model } }`。
 * 手写时很容易写成 `{ baseUrl, tier1Model }` —— 少了 provider 那一层。
 * 判据用**这两个字段是不是字符串**（而不是"有没有非对象的值"）：`extraHeaders` 之类
 * 本身就是对象，用它判会误报。
 *
 * 为什么值得专门认出来：这种形状下 `resolveProvider` 拿到的是一位字符串，
 * 于是永远"没有可用的 provider"，而**用户看着自己填的 baseUrl 明明在文件里** ——
 * 这是最难自查的一类错（真实发生过，D63）。
 */
export function looksFlattened(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  return typeof raw.baseUrl === 'string' || typeof raw.tier1Model === 'string';
}

/** provider 自己的字段。修"少一层"时只搬这几个键，其余键当成真 provider 原样留着。 */
const PROVIDER_FIELDS = ['baseUrl', 'tier1Model', 'tier2Model', 'apiKey', 'extraHeaders', 'extraBody'] as const;

/**
 * 把"少了一层"的 `providers` 整理成正确形状：`{ baseUrl, tier1Model }` → `{ <id>: { baseUrl, tier1Model } }`。
 *
 * 只搬那几个**provider 字段**，其余键（真 provider）原样保留；目标 id 下**已经写对的字段优先**
 * （零散字段只补空缺，不许覆盖一个本来正确的 provider）。整理完的形状 `resolveProvider` 一定能吃。
 */
export function promoteFlattenedProviders(raw: unknown, id: string): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  const out: Record<string, unknown> = {};
  const moved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    if ((PROVIDER_FIELDS as readonly string[]).includes(key)) moved[key] = value;
    else out[key] = value;
  }

  // 顺序是刻意的：**已有的字段赢**。那几行零散字段是"写错层"的残留，
  // 它们只补空缺，不许覆盖一个本来就已经写对了的 provider。
  const existing = out[id];
  out[id] = { ...moved, ...(isRecord(existing) ? existing : {}) };
  return out;
}

/**
 * 把一个新配的 provider 并进已有的 `providers` 对象（`Anchor: 配置模型端点` 的纯逻辑）。
 *
 * 三条刻意的地方：
 *   1. **只动这一个 id** —— 别的 provider、以及同一个 id 下的别的字段（`tier2Model`、
 *      `extraHeaders`…）一律原样保留。配置命令不该变成"清空重写"。
 *   2. **原值不是对象时从空对象开始** —— 用户手写坏过（把整段 JSON 填进 `activeProvider`、
 *      或者对象里多一层 `{`），那种情况下 `providers` 读出来是 undefined 或垃圾；
 *      这时候要的是"还能救回来"，不是"永远配不上"。
 *   3. `replaced` 如实返回，好让提示说"更新了"还是"写入了一个新的"。
 */
export function mergeProvider(
  raw: unknown,
  id: string,
  baseUrl: string,
  tier1Model: string,
): { providers: Record<string, unknown>; replaced: boolean } {
  const current: Record<string, unknown> = isRecord(raw) ? { ...raw } : {};
  const existing = current[id];
  const replaced = isRecord(existing);

  current[id] = {
    ...(isRecord(existing) ? existing : {}),
    baseUrl: normalizeBaseUrl(baseUrl),
    tier1Model: tier1Model.trim(),
  };

  return { providers: current, replaced };
}
