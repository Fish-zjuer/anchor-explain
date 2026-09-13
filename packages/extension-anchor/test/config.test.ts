/**
 * 配置映射的单测（`config.ts` 的纯函数部分）。
 *
 * @anchor 这些分支看起来琐碎，但它们决定的是"用户填错一个字段之后，
 *         是收到一句人话，还是收到一个莫名其妙的行为"。
 *         比如 tier2Model 少填：只该损失"升级到视觉档"，不该让整个讲解不可用。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MAX_FETCH_ROUNDS,
  apiKeySecretName,
  checkBaseUrl,
  clampRounds,
  describeConfig,
  looksFlattened,
  mergeProvider,
  normalizeBaseUrl,
  promoteFlattenedProviders,
  resolveConfig,
  resolveProvider,
} from '../src/config.ts';

test('resolveProvider：baseUrl 与 tier1Model 缺任意一个就视为不可用', () => {
  assert.equal(resolveProvider('default', {}), null);
  assert.equal(resolveProvider('default', { baseUrl: 'https://x' }), null, '缺 tier1Model');
  assert.equal(resolveProvider('default', { tier1Model: 'm' }), null, '缺 baseUrl');
  assert.equal(resolveProvider('default', undefined), null);
  assert.equal(resolveProvider('default', 'not-an-object'), null);
  assert.equal(resolveProvider('default', { baseUrl: '   ', tier1Model: 'm' }), null, '只有空白不算填了');

  const ok = resolveProvider('default', { baseUrl: 'https://x/v1', tier1Model: 'm' });
  assert.deepEqual(ok, { baseUrl: 'https://x/v1', tier1Model: 'm' });
});

test('resolveProvider：可选字段缺了就退化，不牵连可用性', () => {
  const p = resolveProvider('p', {
    baseUrl: 'https://x/v1',
    tier1Model: 'm1',
    tier2Model: 'm2',
    apiKey: 'sk',
    extraHeaders: { a: 'b', bad: 1 },
    extraBody: { top_p: 0.5 },
  });
  assert.ok(p);
  assert.equal(p.tier2Model, 'm2');
  assert.equal(p.apiKey, 'sk');
  assert.deepEqual(p.extraHeaders, { a: 'b' }, '非字符串的值丢掉，而不是让整个配置作废');
  assert.deepEqual(p.extraBody, { top_p: 0.5 });
});

test('resolveConfig：activeProvider 指向不存在的 id → provider 为 null（而不是悄悄用别的）', () => {
  const cfg = resolveConfig({
    providers: { default: { baseUrl: 'https://x/v1', tier1Model: 'm' } },
    activeProvider: 'typo',
    maxFetchRounds: 3,
    preferSecretStorage: true,
  });
  assert.equal(cfg.providerId, 'typo');
  assert.equal(cfg.provider, null);
  assert.match(describeConfig(cfg), /没有可用的 provider/);
});

test('resolveConfig：providers 整个没配时也是 null + 一句能照做的说明', () => {
  const cfg = resolveConfig({ providers: undefined, activeProvider: undefined, maxFetchRounds: undefined, preferSecretStorage: undefined });
  assert.equal(cfg.providerId, 'default', '退回 §6 的默认 id');
  assert.equal(cfg.provider, null);
  assert.equal(cfg.maxFetchRounds, DEFAULT_MAX_FETCH_ROUNDS);
  assert.equal(cfg.preferSecretStorage, true, '§6 默认 true');
  assert.match(describeConfig(cfg), /anchorExplain\.providers/, '要说清该改哪个设置键');
});

test('clampRounds：填 0 合法，填 99 夹到上限，填非数字回默认', () => {
  assert.equal(clampRounds(0), 0);
  assert.equal(clampRounds(3), 3);
  assert.equal(clampRounds(2.7), 2);
  assert.equal(clampRounds(-5), 0);
  assert.equal(clampRounds(99), 20, '不能让用户把取件上限开到无限');
  assert.equal(clampRounds('3'), DEFAULT_MAX_FETCH_ROUNDS);
  assert.equal(clampRounds(Number.NaN), DEFAULT_MAX_FETCH_ROUNDS);
});

test('describeConfig：配好了就说清用了哪个模型、上限多少', () => {
  const cfg = resolveConfig({
    providers: { p: { baseUrl: 'https://x/v1', tier1Model: 'm1', tier2Model: 'm2' } },
    activeProvider: 'p',
    maxFetchRounds: 2,
    preferSecretStorage: true,
  });
  const line = describeConfig(cfg);
  assert.match(line, /m1 @ https:\/\/x\/v1/);
  assert.match(line, /视觉档 m2/);
  assert.match(line, /最多取件 2 次/);
});

test('apiKeySecretName：读写两侧共用同一个键名约定', () => {
  assert.equal(apiKeySecretName('default'), 'anchorExplain.apiKey.default');
});

// ─────────────────────────────────────────────────────────────
// `Anchor: 配置模型端点` 的纯逻辑（D62）—— 它要**替用户写 settings.json**，
// 所以"写坏了怎么办""会不会把别的 provider 冲掉"必须有单测，不能靠手感。
// ─────────────────────────────────────────────────────────────

test('mergeProvider：只动这一个 id，别的 provider 原样保留', () => {
  const raw = {
    default: { baseUrl: 'https://a.test/v1', tier1Model: 'm1', tier2Model: 'vision' },
    work: { baseUrl: 'https://b.test/v1', tier1Model: 'm2' },
  };
  const { providers, replaced } = mergeProvider(raw, 'default', 'https://c.test/v1', 'm3');

  assert.equal(replaced, true);
  assert.deepEqual(providers.work, { baseUrl: 'https://b.test/v1', tier1Model: 'm2' }, '别的 provider 被改动了');
  assert.equal((providers.default as Record<string, unknown>).baseUrl, 'https://c.test/v1');
  assert.equal((providers.default as Record<string, unknown>).tier1Model, 'm3');
  // 同一个 id 下的**别的字段**也要留着：用户手填的视觉档不该被我们的两个输入框抹掉
  assert.equal((providers.default as Record<string, unknown>).tier2Model, 'vision');
});

test('mergeProvider：新增一个 id 时 replaced=false（提示要如实说"写入"还是"更新"）', () => {
  const { providers, replaced } = mergeProvider({ default: { baseUrl: 'https://a.test/v1', tier1Model: 'm' } }, 'work', 'https://b.test/v1', 'm2');
  assert.equal(replaced, false);
  assert.deepEqual(Object.keys(providers).sort(), ['default', 'work']);
});

test('mergeProvider：原值坏掉时从空对象开始（用户手写坏过 —— 要能救回来，不是永远配不上）', () => {
  for (const broken of [undefined, null, '一整段字符串', 42, []]) {
    const { providers } = mergeProvider(broken, 'default', 'https://a.test/v1', 'm');
    assert.deepEqual(providers, { default: { baseUrl: 'https://a.test/v1', tier1Model: 'm' } }, JSON.stringify(broken));
  }
  // 同一个 id 的值是垃圾时也照样覆盖
  const { providers } = mergeProvider({ default: '垃圾' }, 'default', 'https://a.test/v1', 'm');
  assert.deepEqual(providers.default, { baseUrl: 'https://a.test/v1', tier1Model: 'm' });
});

test('mergeProvider：顺手把多余的首尾空白与结尾斜杠收掉', () => {
  const { providers } = mergeProvider({}, 'default', '  https://a.test/v1///  ', '  m  ');
  assert.deepEqual(providers.default, { baseUrl: 'https://a.test/v1', tier1Model: 'm' });
});

test('checkBaseUrl：只挡"明确的错"，其余一律放行', () => {
  // 两个真实发生过的错：少了协议头（症状是"连不上 xxx"）、把完整端点写进来（症状是 404）
  assert.ok(checkBaseUrl('api.deepseek.com/v1')?.includes('协议头'));
  assert.ok(checkBaseUrl('https://api.deepseek.com/v1/chat/completions')?.includes('/chat/completions'));
  assert.ok(checkBaseUrl('') !== null);

  // 端点长什么样是端点那边决定的，我们没资格替他判
  for (const ok of [
    'https://api.deepseek.com/v1',
    'http://localhost:11434/v1',
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'https://gw.test/anthropic',
  ]) {
    assert.equal(checkBaseUrl(ok), null, ok);
  }
});

test('normalizeBaseUrl：去掉结尾斜杠（我们拼的是 ${baseUrl}/chat/completions）', () => {
  assert.equal(normalizeBaseUrl(' https://a.test/v1/ '), 'https://a.test/v1');
  assert.equal(normalizeBaseUrl('https://a.test/v1'), 'https://a.test/v1');
  assert.equal(normalizeBaseUrl('https://a.test///'), 'https://a.test');
});

test('looksFlattened：认出"少了一层"的 providers（D63）', () => {
  // 正确形状：每个 provider 是一个对象
  assert.equal(looksFlattened({ default: { baseUrl: 'https://a/v1', tier1Model: 'm' } }), false);
  // 少了一层：baseUrl / tier1Model 被直接写在 providers 下面 —— 用户真的这么写过
  assert.equal(looksFlattened({ baseUrl: 'https://a/v1', tier1Model: 'm' }), true);
  assert.equal(looksFlattened({ baseUrl: 'https://a/v1' }), true);
  // extraHeaders 本身就是对象，不能拿"有没有非对象的值"当判据
  assert.equal(looksFlattened({ default: { baseUrl: 'https://a/v1', tier1Model: 'm', extraHeaders: {} } }), false);
  assert.equal(looksFlattened(undefined), false);
  assert.equal(looksFlattened('一整段字符串'), false);
});

test('promoteFlattenedProviders：整理成正确形状，且**已经写对的字段优先**', () => {
  // 纯扁平：两个字段直接搬进目标 id
  assert.deepEqual(promoteFlattenedProviders({ baseUrl: 'https://a/v1', tier1Model: 'm' }, 'default'), {
    default: { baseUrl: 'https://a/v1', tier1Model: 'm' },
  });

  // 混着真 provider：真 provider 原样留着，零散字段补进目标 id
  assert.deepEqual(
    promoteFlattenedProviders({ baseUrl: 'https://a/v1', tier1Model: 'm', work: { baseUrl: 'https://w/v1', tier1Model: 'w' } }, 'default'),
    {
      work: { baseUrl: 'https://w/v1', tier1Model: 'w' },
      default: { baseUrl: 'https://a/v1', tier1Model: 'm' },
    },
  );

  // 目标 id 本来就有正确字段：**不许被那几行零散字段盖掉**
  assert.deepEqual(
    promoteFlattenedProviders({ baseUrl: '垃圾', tier1Model: '垃圾', work: { baseUrl: 'https://w/v1', tier1Model: 'w' } }, 'work'),
    { work: { baseUrl: 'https://w/v1', tier1Model: 'w' } },
  );

  assert.deepEqual(promoteFlattenedProviders('坏东西', 'default'), {});
});

test('style：认两档、非法值退化成默认（写错一个词不该让讲解不可用）', () => {
  const base = { providers: {}, activeProvider: 'default', maxFetchRounds: 3, preferSecretStorage: true };
  assert.equal(resolveConfig({ ...base, style: 'rigorous' }).style, 'rigorous');
  assert.equal(resolveConfig({ ...base, style: 'concise' }).style, 'concise');
  assert.equal(resolveConfig(base).style, 'concise', '不配就是简约（D65 的默认档）');
  for (const bad of ['严谨', 'Concise ', 42, null]) {
    assert.equal(resolveConfig({ ...base, style: bad }).style, 'concise', JSON.stringify(bad));
  }
});

test('describeConfig：把风格也报出来（显示状态里能一眼看出当前是哪档）', () => {
  const cfg = resolveConfig({
    providers: { default: { baseUrl: 'https://a.test/v1', tier1Model: 'm' } },
    activeProvider: 'default',
    maxFetchRounds: 2,
    preferSecretStorage: true,
    style: 'rigorous',
  });
  const line = describeConfig(cfg);
  assert.match(line, /最多取件 2 次/);
  assert.match(line, /风格 rigorous/);
});
