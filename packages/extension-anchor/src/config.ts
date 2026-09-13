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
  preferSecretStorage: boolean;
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

export interface RawConfigInputs {
  /** `anchorExplain.providers` 的原始值 */
  providers: unknown;
  /** `anchorExplain.activeProvider` 的原始值 */
  activeProvider: unknown;
  /** `anchorExplain.maxFetchRounds` 的原始值 */
  maxFetchRounds: unknown;
  /** `anchorExplain.preferSecretStorage` 的原始值 */
  preferSecretStorage: unknown;
  /** `anchorExplain.temperature` 的原始值（可空） */
  temperature?: unknown;
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
    // §6 默认 true：只有在用户明确关掉时才回落配置里的明文 key
    preferSecretStorage: raw.preferSecretStorage !== false,
  };
  if (temperature !== undefined) config.temperature = temperature;
  return config;
}

/** 配置齐不齐，一句话说清。`Anchor: 显示状态` 与"未配置"的报错共用这句。 */
export function describeConfig(config: AnchorConfig): string {
  if (!config.provider) {
    return `没有可用的 provider（activeProvider = "${config.providerId}"）。请在设置里填 anchorExplain.providers。`;
  }
  const vision = config.provider.tier2Model ? `，视觉档 ${config.provider.tier2Model}` : '';
  return `${config.providerId}：${config.provider.tier1Model} @ ${config.provider.baseUrl}${vision}；最多取件 ${config.maxFetchRounds} 次`;
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
  if (!/^https?:\/\//iu.test(value)) return '要带上协议头，例如 https://api.deepseek.com/v1';
  if (/\/chat\/completions\/?$/iu.test(value)) return '不要带 /chat/completions —— 我们自己在后面拼它';
  return null;
}

/** 结尾的斜杠要收掉：我们拼的是 `${baseUrl}/chat/completions`，多一个斜杠会变成 `//`。 */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/u, '');
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
