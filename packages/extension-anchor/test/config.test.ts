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
  clampRounds,
  describeConfig,
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
