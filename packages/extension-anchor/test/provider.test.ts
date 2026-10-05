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

// ── D135：DeepSeek 思考模式的 reasoning_content 必须原样往返 ────────────────

/**
 * @anchor 这一组守的是用户实测的那个"稳定复现"：DeepSeek 思考模式**默认开**，
 *         而它要求带 `tools` 的请求把每一轮的 `reasoning_content` 完整回传，漏一轮就 400。
 *         我们原来只读 `message.content` → `reasoning_content` 当场丢掉 →
 *         第二条请求必然 400 → 整次讲解失败。
 *         两个方向都要钉住：**取回来**（否则没得回传）、**发出去**（否则端点拒）。
 */
test('D135：端点在 reasoning_content 里给思维链 → 要取回来，不能丢', async () => {
  const { impl } = fakeFetch({
    text: JSON.stringify({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: '',                                        // 停下来要工具的那一轮，content 本来就是空的
            reasoning_content: '先把锚点那一段读了。',
            tool_calls: [{ id: 'c1', function: { name: 'fetch_context', arguments: '{}' } }],
          },
        },
      ],
    }),
  });
  const turn = await createOpenAICompatibleProvider({ baseUrl: 'https://x/v1', fetchImpl: impl }).chat({ model: 'm', messages });

  assert.equal(turn.content, '', 'content 是空串，这不代表出错 —— 它是在要工具');
  assert.equal(turn.reasoningContent, '先把锚点那一段读了。', '思维链必须取回来，否则下一轮没得回传');
});

test('D135：reasoning_content 是空串或没给 → `undefined`，不写成空串', async () => {
  const missing = await createOpenAICompatibleProvider({
    baseUrl: 'https://x/v1',
    fetchImpl: fakeFetch({ text: '{"choices":[{"message":{"content":"hi"}}]}' }).impl,
  }).chat({ model: 'm', messages });
  assert.equal(missing.reasoningContent, undefined);

  const blank = await createOpenAICompatibleProvider({
    baseUrl: 'https://x/v1',
    fetchImpl: fakeFetch({ text: '{"choices":[{"message":{"content":"hi","reasoning_content":""}}]}' }).impl,
  }).chat({ model: 'm', messages });
  assert.equal(blank.reasoningContent, undefined, '空串等于"没有"，写成空串会让下游分不清"没有"与"有但空"');
});

test('D135：assistant 消息带 reasoningContent → 原样上线（DeepSeek 靠它才不 400）', async () => {
  const { impl, calls } = fakeFetch({});
  const history: ChatMessage[] = [
    { role: 'user', content: 'u' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'c1', name: 'fetch_context', arguments: '{}' }],
      reasoningContent: '我读了一下，决定去要文件。',
    },
    { role: 'tool', toolCallId: 'c1', content: '文件内容' },
  ];

  await createOpenAICompatibleProvider({ baseUrl: 'https://x/v1', fetchImpl: impl }).chat({
    model: 'm',
    messages: history,
    tools: [{}],
  });

  const onWire = (calls[0]?.body['messages'] ?? []) as Record<string, unknown>[];
  const assistant = onWire.find((m) => m['role'] === 'assistant');
  assert.equal(assistant?.['reasoning_content'], '我读了一下，决定去要文件。');
  assert.ok(assistant?.['tool_calls'], 'tool_calls 不能因为加了思维链就丢');
});

test('D135：没给 reasoningContent 时，线路上**不出现**这个键（不是空串占位）', async () => {
  const { impl, calls } = fakeFetch({});
  await createOpenAICompatibleProvider({ baseUrl: 'https://x/v1', fetchImpl: impl }).chat({
    model: 'm',
    messages: [
      { role: 'user', content: 'u' },
      { role: 'assistant', content: '我在想' }, // 普通一轮，没有思维链（大多数端点都这样）
    ],
  });

  const onWire = (calls[0]?.body['messages'] ?? []) as Record<string, unknown>[];
  const assistant = onWire.find((m) => m['role'] === 'assistant');
  assert.ok(assistant);
  assert.equal('reasoning_content' in assistant, false, '不要塞空串：空串会让"本来没有"和"有但为空"分不开');
  assert.equal(assistant['content'], '我在想', '普通 assistant 消息的 content 照旧要发');
});

// ── D135：端点自检的读法（纯函数，不联网）─────────────────────────────────

test('D135 自检：正文在 reasoning_content 里 → 指出是思考模式，并给出关掉它的写法', async () => {
  const { describeEndpointProbe } = await import('../src/orchestrator/providers/openAICompatible.ts');
  const text = describeEndpointProbe({
    choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: '我先想了想。' } }],
  });

  assert.match(text, /正文放进了 reasoning_content/, '要点出真正的原因');
  assert.match(text, /thinking.*disabled/s, '要给出**可照做**的关法');
  assert.match(text, /"我先想了想。"/, '把端点原样回的东西摆出来');
});

test('D137 自检：最小请求成功不能断定队列失败是偶发', async () => {
  const { describeEndpointProbe } = await import('../src/orchestrator/providers/openAICompatible.ts');
  const text = describeEndpointProbe({
    choices: [{ finish_reason: 'stop', message: { content: '端点正常。' } }],
  });

  assert.match(text, /正常返回了正文/);
  assert.match(text, /偶发/);
  assert.match(text, /不能据此判断/);
  assert.doesNotMatch(text, /thinking/, '正常时不该教人去关思考模式 —— 那是没事找事');
});

test('D137：原始诊断保留响应与 finish_reason，不暴露请求鉴权头', async () => {
  const raw = JSON.stringify({choices:[{finish_reason:'length',message:{content:'',reasoning_content:'thinking'}}]});
  const {impl} = fakeFetch({text:raw});
  const diagnostics: unknown[] = [];
  const reply = await createOpenAICompatibleProvider({baseUrl:'https://x',apiKey:'sk-private',fetchImpl:impl,
    onResponse:r => diagnostics.push(r)}).chat({model:'m',messages});
  assert.equal(reply.finishReason, 'length');
  assert.deepEqual(diagnostics, [{model:'m',status:200,raw}]);
  assert.doesNotMatch(JSON.stringify(diagnostics), /sk-private/);
});

test('D135 自检：连 choices[0].message 都没有 → 说"baseUrl 指的不是对话端点"', async () => {
  const { describeEndpointProbe } = await import('../src/orchestrator/providers/openAICompatible.ts');
  const text = describeEndpointProbe({ error: { message: 'model not found' } });

  assert.match(text, /不是 OpenAI 格式|不是一个对话端点/);
  assert.match(text, /model not found/, '原始响应要带上，那里面写着端点自己的话');
});
