/**
 * OpenAI 兼容端点的单测。**不联网**：`fetchImpl` 注入一个记账用的假 fetch。
 *
 * @anchor 这一层要守的是"发出去的东西长什么样"：端点、请求头、消息映射、错误转译。
 *         这些东西在真网络下反而不容易看清（端点自己会宽容一些奇怪字段），
 *         而一旦映射错了（比如 tool 结果没带 `tool_call_id`），
 *         表现是"模型莫名其妙答非所问"，很难往回追。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnchorError } from '@anchor/core';
import { createOpenAICompatibleProvider } from '../src/orchestrator/providers/openAICompatible.ts';
import type { ChatMessage } from '../src/orchestrator/providers/types.ts';
import { openAITools } from '../src/orchestrator/toolSchema.ts';

interface Captured {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

/** 造一个假 fetch：记下请求，按 `reply` 返回 */
function fakeFetch(reply: { ok?: boolean; status?: number; text?: string; throw?: Error }) {
  const calls: Captured[] = [];
  const impl = ((url: string, init: RequestInit) => {
    calls.push({
      url,
      init,
      body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>,
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    if (reply.throw) return Promise.reject(reply.throw);
    return Promise.resolve({
      ok: reply.ok ?? true,
      status: reply.status ?? 200,
      text: () => Promise.resolve(reply.text ?? '{"choices":[{"message":{"content":"hi"}}]}'),
    } as Response);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const messages: ChatMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'usr' },
];

test('请求：端点、鉴权头、tools、extra 透传', async () => {
  const { impl, calls } = fakeFetch({});
  const provider = createOpenAICompatibleProvider({
    baseUrl: 'https://api.example.com/v1/',
    apiKey: 'sk-test',
    extraHeaders: { 'x-tenant': 't1' },
    extraBody: { top_p: 0.9 },
    fetchImpl: impl,
  });

  await provider.chat({ model: 'm1', messages, tools: openAITools(), temperature: 0.2 });

  const call = calls[0];
  assert.equal(call?.url, 'https://api.example.com/v1/chat/completions', 'baseUrl 末尾多余的斜杠要去掉');
  assert.equal(call?.headers.authorization, 'Bearer sk-test');
  assert.equal(call?.headers['x-tenant'], 't1', 'extraHeaders 要合并进去');
  assert.equal(call?.body.model, 'm1');
  assert.equal(call?.body.temperature, 0.2);
  assert.equal(call?.body.top_p, 0.9, 'extraBody 要原样透传（兼容非标准端点靠它）');
  assert.equal(call?.body.tool_choice, 'auto');

  const tools = call?.body.tools as { function: { name: string } }[];
  assert.equal(tools[0]?.function.name, 'fetch_context', '§8 的工具定义要在请求里');
});

test('请求：没有 apiKey 就不发 authorization 头（本地 Ollama 不需要）', async () => {
  const { impl, calls } = fakeFetch({});
  await createOpenAICompatibleProvider({ baseUrl: 'http://localhost:11434/v1', fetchImpl: impl }).chat({
    model: 'llama',
    messages,
  });
  assert.equal(calls[0]?.headers.authorization, undefined);
  assert.equal(calls[0]?.body.tools, undefined, '没给 tools 就不该出现 tools 字段');
});

test('消息映射：tool 结果带 tool_call_id；助手的 tool_calls 变成 wire 形状', async () => {
  const { impl, calls } = fakeFetch({});
  const withTools: ChatMessage[] = [
    ...messages,
    { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'fetch_context', arguments: '{"a":1}' }] },
    { role: 'tool', toolCallId: 'c1', content: '结果' },
  ];

  await createOpenAICompatibleProvider({ baseUrl: 'https://x/v1', fetchImpl: impl }).chat({ model: 'm', messages: withTools });

  const sent = calls[0]?.body.messages as Record<string, unknown>[];
  assert.equal(sent.length, 4);
  const toolMsg = sent[3];
  assert.equal(toolMsg?.role, 'tool');
  assert.equal(toolMsg?.tool_call_id, 'c1', '少了这个字段端点会直接报错');

  const assistant = sent[2] as { tool_calls: { id: string; function: { name: string; arguments: string } }[] };
  assert.equal(assistant.tool_calls[0]?.id, 'c1');
  assert.equal(assistant.tool_calls[0]?.function.name, 'fetch_context');
  assert.equal(assistant.tool_calls[0]?.function.arguments, '{"a":1}');
});

test('应答：内容与 tool_calls 都取出来', async () => {
  const { impl } = fakeFetch({
    text: JSON.stringify({
      choices: [
        {
          message: {
            content: '让我看看',
            tool_calls: [{ id: 'c9', function: { name: 'fetch_context', arguments: '{"request_type":"file","reason":"x"}' } }],
          },
        },
      ],
    }),
  });
  const turn = await createOpenAICompatibleProvider({ baseUrl: 'https://x/v1', fetchImpl: impl }).chat({ model: 'm', messages });

  assert.equal(turn.content, '让我看看');
  assert.equal(turn.toolCalls.length, 1);
  assert.equal(turn.toolCalls[0]?.id, 'c9');
});

test('应答容错：缺 id、arguments 是对象、content 是 null', async () => {
  const { impl } = fakeFetch({
    text: JSON.stringify({
      choices: [{ message: { content: null, tool_calls: [{ function: { name: 'fetch_context', arguments: { a: 1 } } }] } }],
    }),
  });
  const turn = await createOpenAICompatibleProvider({ baseUrl: 'https://x/v1', fetchImpl: impl }).chat({ model: 'm', messages });

  assert.equal(turn.content, '', 'content=null 要归一成空串');
  assert.equal(turn.toolCalls[0]?.id, 'call_0', '缺 id 要补一个，否则工具结果没有归属');
  assert.equal(turn.toolCalls[0]?.arguments, '{"a":1}', '对象形式的 arguments 要序列化成字符串');
});

test('失败路径一律 PROVIDER_ERROR，且带上可排查的信息', async () => {
  const cases: { reply: Parameters<typeof fakeFetch>[0]; match: RegExp; what: string }[] = [
    { reply: { ok: false, status: 401, text: '{"error":{"message":"invalid api key"}}' }, match: /401.*invalid api key/s, what: '带状态码与端点给的原因' },
    { reply: { text: 'internal server error' }, match: /不是 JSON/, what: '非 JSON 响应' },
    { reply: { text: '{"choices":[]}' }, match: /没有 choices/, what: '没有 choices' },
    { reply: { throw: new Error('getaddrinfo ENOTFOUND') }, match: /连不上.*ENOTFOUND/s, what: '网络层失败' },
  ];

  for (const c of cases) {
    const { impl } = fakeFetch(c.reply);
    await assert.rejects(
      () => createOpenAICompatibleProvider({ baseUrl: 'https://x/v1', fetchImpl: impl }).chat({ model: 'm', messages }),
      (err: unknown) => err instanceof AnchorError && err.code === 'PROVIDER_ERROR' && c.match.test(err.message),
      c.what,
    );
  }
});

// ─────────────────────────────────────────────────────────────
// D120：token 用量（输入 / 输出 / 缓存命中与未命中）
// ─────────────────────────────────────────────────────────────

/** 造一个只回一段 JSON 的假端点。 */
function usageImpl(usage: unknown): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage }), { status: 200 }),
    );
}

test('D120：DeepSeek 形状的 usage（prompt_cache_hit_tokens / miss）原样读出来', async () => {
  const turn = await createOpenAICompatibleProvider({
    baseUrl: 'https://x/v1',
    fetchImpl: usageImpl({
      prompt_tokens: 1000,
      completion_tokens: 200,
      prompt_cache_hit_tokens: 800,
      prompt_cache_miss_tokens: 200,
    }),
  }).chat({ model: 'm', messages: [] });

  assert.deepEqual(turn.usage, { input: 1000, output: 200, cachedInput: 800, uncachedInput: 200 });
});

test('D120：OpenAI 形状的 usage（prompt_tokens_details.cached_tokens）也认，未命中 = 输入 − 命中', async () => {
  const turn = await createOpenAICompatibleProvider({
    baseUrl: 'https://x/v1',
    fetchImpl: usageImpl({ prompt_tokens: 500, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 300 } }),
  }).chat({ model: 'm', messages: [] });

  assert.deepEqual(turn.usage, { input: 500, output: 50, cachedInput: 300, uncachedInput: 200 });
});

test('D120：端点没给 usage 时 `usage` 是 undefined —— 不猜、不补 0', async () => {
  const turn = await createOpenAICompatibleProvider({
    baseUrl: 'https://x/v1',
    fetchImpl: usageImpl(undefined),
  }).chat({ model: 'm', messages: [] });

  assert.equal(turn.usage, undefined, '把"不知道"写成 0 是编一个看起来很确定的数');
});

test('D120：usage 字段形状不对（字符串/null）时当"没给"，不让它变成 NaN', async () => {
  const turn = await createOpenAICompatibleProvider({
    baseUrl: 'https://x/v1',
    fetchImpl: usageImpl({ prompt_tokens: '1000', completion_tokens: null }),
  }).chat({ model: 'm', messages: [] });

  assert.equal(turn.usage, undefined);
});

test('D120：addUsage 逐项累加，undefined 不参与（全 undefined 仍是 undefined）', async () => {
  const { addUsage } = await import('../src/orchestrator/providers/types.ts');
  const u = (over: Record<string, number | undefined>) => ({
    input: undefined as number | undefined,
    output: undefined as number | undefined,
    cachedInput: undefined as number | undefined,
    uncachedInput: undefined as number | undefined,
    ...over,
  });
  assert.deepEqual(addUsage({ input: 10, output: 2 }, { input: 5, output: 1 }), u({ input: 15, output: 3 }));
  // 一边有一边没有：有的那项照加，没有的留 undefined（不是 0 —— 0 是"端点说了是 0"）
  assert.deepEqual(addUsage({ input: 10, cachedInput: 8 }, { output: 3 }), u({ input: 10, output: 3, cachedInput: 8 }));
  assert.deepEqual(addUsage({}, {}), u({}));
});
