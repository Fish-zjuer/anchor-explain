/**
 * 编排循环的单测。**全部不联网**：`ChatProvider` 换成一段可编排的假脚本。
 *
 * @anchor 这个文件守住的是 S3 里最容易出错、又最难靠手测发现的东西：
 *   1. 取件循环会不会**重复**取、会不会**超轮数**
 *   2. 被拒的取件请求是不是**回灌**成了工具结果（而不是抛错）
 *   3. §3.3 闸门不过时是不是**只重试一次**
 * 这三件事靠真 key 手测要构造很麻烦（得让模型故意犯错），而在这里就是一个数组。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnchorError, createContextRequestLogger, isCodeLocation } from '@anchor/core';
import type { Anchor, ContextRequest, ExplanationResult } from '@anchor/core';
import { createModelRouter } from '../src/orchestrator/ModelRouter.ts';
import { parseContextRequest } from '../src/orchestrator/toolSchema.ts';
import { createOrchestrator } from '../src/orchestrator/Orchestrator.ts';
import type { OrchestratorAdapter } from '../src/orchestrator/Orchestrator.ts';
import type { ContextFetchPolicy } from '../src/orchestrator/validateContextRequest.ts';
import type { AssistantTurn, ChatMessage, ChatProvider, ChatRequest } from '../src/orchestrator/providers/types.ts';

const FILE = 'C:\\repo\\test\\fixtures\\main.c';
const DOC_LINES = 75;

function anchorWith(over: Partial<Anchor> = {}): Anchor {
  return {
    sourceType: 'code',
    sourceId: 'sha1:x',
    sourceName: 'main.c',
    location: { filePath: FILE, lineStart: 40, lineEnd: 48 },
    extractedText: 'static int rb_pop(...)',
    ...over,
  };
}

/** 合法的讲解输出（能过 §3.3） */
function validJson(over: Partial<ExplanationResult> = {}): string {
  return JSON.stringify({
    summary: '这是一段出队逻辑。',
    confidence: 0.8,
    steps: [
      {
        location: { filePath: FILE, lineStart: 40, lineEnd: 42 },
        text: '先挡住空队列。',
        highlights: [
          { location: { filePath: FILE, lineStart: 40, lineEnd: 40 }, narration: '签名', emphasis: 'context' },
        ],
      },
    ],
    ...over,
  });
}

function toolTurn(req: Record<string, unknown>, id = 'call_1'): AssistantTurn {
  return {
    content: '',
    toolCalls: [{ id, name: 'fetch_context', arguments: JSON.stringify(req) }],
  };
}

interface Harness {
  provider: ChatProvider;
  requests: ChatRequest[];
  fetches: ContextRequest[];
  adapter: OrchestratorAdapter;
  run: (anchor?: Anchor) => Promise<ExplanationResult>;
  logger: ReturnType<typeof createContextRequestLogger>;
}

/** 把一个 turn 列表变成 ChatProvider；用完之后再被调用就抛（能抓住"多问了一轮"） */
function harness(
  turns: readonly AssistantTurn[],
  opts: {
    maxFetchRounds?: number;
    fetchPolicy?: ContextFetchPolicy;
    candidates?: readonly string[];
  } = {},
): Harness {
  const requests: ChatRequest[] = [];
  const fetches: ContextRequest[] = [];
  const logger = createContextRequestLogger();

  const provider: ChatProvider = {
    chat(req) {
      requests.push(req);
      const turn = turns[requests.length - 1];
      if (!turn) throw new Error(`模型被多调了一轮（第 ${requests.length} 次）`);
      return Promise.resolve(turn);
    },
  };

  const adapter: OrchestratorAdapter = {
    capabilities: { contextTypes: ['file'], maxSpan: 5 },
    fetchContext(req) {
      fetches.push(req);
      return Promise.resolve(`文件：${FILE}\n行 1-10：\n 1\t#include <stdio.h>`);
    },
  };

  const run = (anchor = anchorWith()) =>
    createOrchestrator({
      chat: provider,
      routeModel: createModelRouter({ tier1Model: 'cheap' }),
      adapter,
      makeOutline: () => Promise.resolve({ documentLineCount: DOC_LINES, pageCount: null }),
      maxFetchRounds: opts.maxFetchRounds ?? 3,
      logger,
      ...(opts.fetchPolicy ? { fetchPolicy: opts.fetchPolicy } : {}),
      ...(opts.candidates ? { candidateFiles: opts.candidates } : {}),
    })(anchor);

  return { provider, requests, fetches, adapter, run, logger };
}

// ── 主路径 ────────────────────────────────────────────────────────────────

test('不需要取件时：一次调用就拿到结果', async () => {
  const h = harness([{ content: validJson(), toolCalls: [] }]);
  const result = await h.run();

  assert.equal(h.requests.length, 1);
  assert.equal(result.steps.length, 1);
  assert.equal(result.summary, '这是一段出队逻辑。');

  // 第一轮就该把工具定义给出去，否则模型永远没法请求上下文
  assert.ok(h.requests[0]?.tools, '请求里必须带 tools');
  assert.match(JSON.stringify(h.requests[0]?.messages[0]), /讲解助手/, 'system prompt 在第一位');
});

test('取件一轮：请求合法 → 读到内容 → 内容作为工具结果回到对话里', async () => {
  const h = harness([
    toolTurn({ request_type: 'file', start: 1, end: 10, reason: '不知道 ring_buffer_t 是什么', path: FILE }),
    { content: validJson(), toolCalls: [] },
  ]);
  const result = await h.run();

  assert.equal(h.fetches.length, 1, '应该真的取了一次');
  assert.equal(result.steps.length, 1);

  const second = h.requests[1]?.messages ?? [];
  const toolMsg = second.find((m: ChatMessage) => m.role === 'tool');
  assert.ok(toolMsg, '取件结果必须以 role=tool 回灌');
  assert.equal(toolMsg.toolCallId, 'call_1', 'tool 结果必须归属到那次 tool_call');
  assert.match(toolMsg.content, /include <stdio.h>/, '回灌的是真实内容');

  // 助手那条带 tool_calls 的消息也必须在，否则端点会以"tool 没有对应的调用"报错
  const assistant = second.filter((m: ChatMessage) => m.role === 'assistant');
  assert.equal(assistant.length, 1);
  assert.equal(assistant[0]?.toolCalls?.[0]?.name, 'fetch_context');
});

test('取件被拒（漫游到别的文件）：**不抛错**，回灌拒绝原因，然后照常拿到讲解', async () => {
  const h = harness([
    toolTurn({ request_type: 'file', start: 1, end: 10, reason: '想看看别处', path: 'C:\\Windows\\system.ini' }),
    { content: validJson(), toolCalls: [] },
  ]);
  const result = await h.run();

  assert.equal(h.fetches.length, 0, '越界的取件一次都不许真读');
  assert.equal(result.steps.length, 1, '被拒之后整次讲解仍然要继续，不是整段失败');

  const toolMsg = (h.requests[1]?.messages ?? []).find((m: ChatMessage) => m.role === 'tool');
  assert.match(toolMsg?.content ?? '', /请求被拒绝/, '回灌的文案带固定前缀（§3.2）');
  assert.match(toolMsg?.content ?? '', /只允许取锚点所在的文件/);
  assert.match(toolMsg?.content ?? '', /请基于现有信息作答/);
});

test('重复取件：第二次命中去重，不再读文件，并把上次内容再给一遍', async () => {
  const h = harness([
    toolTurn({ request_type: 'file', start: 1, end: 10, reason: '先看头部', path: FILE }, 'call_1'),
    toolTurn({ request_type: 'file', start: 5, end: 15, reason: '再确认一下', path: FILE }, 'call_2'),
    { content: validJson(), toolCalls: [] },
  ]);
  await h.run();

  assert.equal(h.fetches.length, 1, '重叠区间只许真读一次');
  const toolMsgs = (h.requests[2]?.messages ?? []).filter((m: ChatMessage) => m.role === 'tool');
  assert.equal(toolMsgs.length, 2);
  assert.match(toolMsgs[1]?.content ?? '', /请求被拒绝/);
  assert.match(toolMsgs[1]?.content ?? '', /include <stdio.h>/, '去重命中要把上次的内容一并回灌');
});

test('取件参数不是合法 JSON：当拒绝处理，不抛错', async () => {
  const h = harness([
    { content: '', toolCalls: [{ id: 'call_1', name: 'fetch_context', arguments: '{不是 json' }] },
    { content: validJson(), toolCalls: [] },
  ]);
  const result = await h.run();

  assert.equal(h.fetches.length, 0);
  assert.equal(result.steps.length, 1);
  const toolMsg = (h.requests[1]?.messages ?? []).find((m: ChatMessage) => m.role === 'tool');
  assert.match(toolMsg?.content ?? '', /不是合法 JSON/);
});

test('模型点了一个没声明的工具：当普通拒绝，不抛错', async () => {
  const h = harness([
    { content: '', toolCalls: [{ id: 'c', name: 'read_whole_disk', arguments: '{}' }] },
    { content: validJson(), toolCalls: [] },
  ]);
  await h.run();
  const toolMsg = (h.requests[1]?.messages ?? []).find((m: ChatMessage) => m.role === 'tool');
  assert.match(toolMsg?.content ?? '', /没有名为 read_whole_disk 的工具/);
});

test('轮数用尽仍在请求取件 → MAX_ROUNDS_EXCEEDED（不无限循环）', async () => {
  const forever = Array.from({ length: 8 }, (_, i) =>
    toolTurn({ request_type: 'file', start: i * 10 + 1, end: i * 10 + 5, reason: '还不够', path: FILE }, `call_${i}`),
  );
  const h = harness(forever, { maxFetchRounds: 1 });

  await assert.rejects(
    () => h.run(),
    (err: unknown) => err instanceof AnchorError && err.code === 'MAX_ROUNDS_EXCEEDED',
  );
  assert.equal(h.fetches.length, 1, '上限是 1，就只许真读一次');
  assert.ok(h.requests.length <= 4, `调用次数必须有界，实际 ${h.requests.length}`);
});

// ── 输出闸门与修复 ────────────────────────────────────────────────────────

test('输出不合规 → 带问题清单重试**一次** → 第二次合规就采用', async () => {
  const h = harness([
    { content: JSON.stringify({ summary: '', confidence: 2, steps: [] }), toolCalls: [] },
    { content: validJson(), toolCalls: [] },
  ]);
  const result = await h.run();

  assert.equal(h.requests.length, 2, '恰好重试一次');
  const repairMsg = h.requests[1]?.messages.at(-1);
  assert.equal(repairMsg?.role, 'user');
  assert.match(repairMsg?.content ?? '', /没有通过校验/, '修复提示要说明上一次失败了');
  assert.match(repairMsg?.content ?? '', /summary/, '要指出具体哪个字段有问题');
  assert.equal(result.summary, '这是一段出队逻辑。');
});

test('重试一次仍不合规 → SCHEMA_VIOLATION，且不把脏数据交给渲染层', async () => {
  const bad = JSON.stringify({ summary: '', confidence: 2, steps: [] });
  const h = harness([
    { content: bad, toolCalls: [] },
    { content: bad, toolCalls: [] },
  ]);

  await assert.rejects(
    () => h.run(),
    (err: unknown) => err instanceof AnchorError && err.code === 'SCHEMA_VIOLATION',
  );
  assert.equal(h.requests.length, 2, '只重试一次，不是反复磨');
});

test('行号越界的输出被判掉（§3.3 的上界用的是真文档行数）', async () => {
  const h = harness([
    { content: validJson({ steps: [{ location: { filePath: FILE, lineStart: 10, lineEnd: 9999 }, text: 'x' }] }), toolCalls: [] },
    { content: validJson(), toolCalls: [] },
  ]);
  const result = await h.run();
  assert.equal(h.requests.length, 2, '第一份越界 → 走修复');
  assert.deepEqual(result.steps[0]?.location, { filePath: FILE, lineStart: 40, lineEnd: 42 });
});

// ── 日志（§7） ────────────────────────────────────────────────────────────

test('每个 ContextRequest 都落日志，含被拒的（被拒原因是调试时最需要看的）', async () => {
  const h = harness([
    toolTurn({ request_type: 'file', start: 1, end: 10, reason: '合法', path: FILE }, 'c1'),
    toolTurn({ request_type: 'file', start: 20, end: 30, reason: '越界', path: 'D:\\other.c' }, 'c2'),
    { content: validJson(), toolCalls: [] },
  ]);
  await h.run();

  const entries = h.logger.entries();
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.accepted, true);
  assert.equal(entries[0]?.round, 1);
  assert.ok((entries[0]?.resultChars ?? 0) > 0, '成功的取件要记结果长度');
  assert.equal(entries[1]?.accepted, false);
  assert.match(entries[1]?.rejectReason ?? '', /只允许取锚点所在的文件/);
});

// ── 取件参数解析（§8 的形状） ──────────────────────────────────────────────

test('parseContextRequest：只做形状解析，合法性留给 §3.2', () => {
  const ok = parseContextRequest('{"request_type":"file","start":1,"end":9,"reason":"为什么","path":"a.c"}');
  assert.ok(ok);
  assert.equal(ok.type, 'file');
  assert.equal(ok.params.start, 1);

  assert.equal(parseContextRequest('不是 json'), null);
  assert.equal(parseContextRequest('{"request_type":"nope","reason":"x"}'), null, '未知类型');
  assert.equal(parseContextRequest('{"request_type":"file"}'), null, '缺 reason');
  assert.equal(parseContextRequest('{"request_type":"file","reason":"  "}'), null, 'reason 只有空白等于没说');
  assert.equal(parseContextRequest('[]'), null, '数组不是对象');
});

// ── 选模型 ────────────────────────────────────────────────────────────────

test('ModelRouter：没配 tier2 就永远走 tier1（宁可糙，不能不ran）', () => {
  const route = createModelRouter({ tier1Model: 'cheap' });
  assert.equal(route({ turn: 1, hasExtractedText: true, wantsImage: false }).tier, 'text');
  assert.equal(
    route({ turn: 1, hasExtractedText: false, wantsImage: true }).model,
    'cheap',
    '少配一个字段不该让功能不可用',
  );
});

test('ModelRouter：没有原文 / 要看图 → 升级，并说明理由', () => {
  const route = createModelRouter({ tier1Model: 'cheap', tier2Model: 'vision' });

  assert.equal(route({ turn: 1, hasExtractedText: true, wantsImage: false }).tier, 'text');
  assert.equal(route({ turn: 1, hasExtractedText: true, wantsImage: true }).tier, 'vision');
  assert.equal(route({ turn: 1, hasExtractedText: false, wantsImage: false }).tier, 'vision');
  assert.match(route({ turn: 1, hasExtractedText: false, wantsImage: false }).reason ?? '', /没有原文/);
});

// ── S9a 修复（D67）：两道闸门的坐标、三处口径、诚实的报错 ──────────────────
//
// 这一节是**用户实测的返工**：S9a 交付时 245 条测试全绿而功能不可用。
// 三个根因当时都没有测试盯着，所以全绿：工具 schema 没有 `path`（模型没法点名文件）、
// 输出契约仍写死"必须与锚点同一个文件"（连 repair 也说这句）、
// 内部闸门收绝对路径而第二道闸门收模型原样写的相对路径（必然互相打架）。

const RELATED: ContextFetchPolicy = { scope: 'related', roots: ['C:\\repo'], maxLines: 60 };
/**
 * 锚点文件同目录的兄弟文件（`ring_buffer.h` 解析出来的绝对路径）。
 * **分隔符是 `/`**：core 的路径函数（`joinPath`/`dirnameOf`）刻意统一输出 `/` —— 与 `samePath`
 * 同一个立场（路径的写法不该改变语义），也因此这些解析结果在 Windows 与 POSIX 上完全一致。
 * 消费端不受影响：`vscode.Uri.file` 两种分隔符都收。
 */
const SIBLING = 'C:/repo/test/fixtures/ring_buffer.h';

/** 讲解里那一步落在**指定文件**（相对/绝对都可以，用来验 §3.3 的允许集合） */
function jsonStepIn(filePath: string): string {
  return JSON.stringify({
    summary: '容量宏在另一个文件里，它决定回绕位置。',
    confidence: 0.7,
    steps: [{ location: { filePath, lineStart: 12, lineEnd: 14 }, text: '容量宏是 16，取模时靠它回绕。' }],
  });
}

test('S9a 修复：模型用**相对路径**取件 → 归一化成绝对路径；讲解引用该文件时闸门放行', async () => {
  const h = harness(
    [
      toolTurn({ request_type: 'file', start: 10, end: 20, reason: '看看容量宏', path: 'ring_buffer.h' }),
      // 模型引用兄弟文件时写的是**它请求时用的那个相对写法** —— 这正是被误判的那个形状
      { content: jsonStepIn('ring_buffer.h'), toolCalls: [] },
    ],
    { fetchPolicy: RELATED },
  );

  const result = await h.run();

  assert.equal(h.fetches.length, 1, '取件应该被批准（related 允许读相关文件）');
  assert.equal(h.fetches[0]?.params.path, SIBLING, '适配器拿到的一定是归一化后的绝对路径');
  // 用真守门函数取字段，不用 `'filePath' in loc`：PDF/Web location 也可能带可选的 filePath
  const stepLoc = result.steps[0]?.location;
  assert.ok(stepLoc !== undefined && isCodeLocation(stepLoc), '这一步应当落在代码文件里');
  assert.equal(
    stepLoc !== undefined && isCodeLocation(stepLoc) ? stepLoc.filePath : null,
    SIBLING,
    '交出去的 location 必须是**解析后**的路径：下游要拿它开编辑器，相对路径开不出来',
  );
});

test('S9a 修复：取件日志记的是归一化后的请求（日志要能复核"读了哪个文件"）', async () => {
  const h = harness(
    [
      toolTurn({ request_type: 'file', start: 10, end: 20, reason: '看看容量宏', path: 'ring_buffer.h' }),
      { content: validJson(), toolCalls: [] },
    ],
    { fetchPolicy: RELATED },
  );
  await h.run();

  const accepted = h.logger.entries().find((e) => e.accepted);
  assert.equal(
    accepted?.request.params.path,
    SIBLING,
    '记原样的相对路径，命令层第二道闸门收的允许集合就与 §3.3 的绝对路径对不上（D67 的真凶）',
  );
});

test('S9a 修复：没读过的文件仍然不许引用（相对路径不是后门）', async () => {
  const h = harness(
    [
      toolTurn({ request_type: 'file', start: 10, end: 20, reason: '看看容量宏', path: 'ring_buffer.h' }),
      { content: jsonStepIn('other.h'), toolCalls: [] },
      { content: jsonStepIn('other.h'), toolCalls: [] }, // repair 之后还是错 → 该报错
    ],
    { fetchPolicy: RELATED },
  );

  await assert.rejects(
    () => h.run(),
    (err: unknown) => err instanceof AnchorError && err.code === 'SCHEMA_VIOLATION',
  );
});

test('S9a 修复：跨文件时 system / user / repair 三处口径一致（不能把模型往反方向推）', async () => {
  const h = harness(
    [
      { content: JSON.stringify({ summary: '', confidence: 2, steps: [] }), toolCalls: [] },
      { content: validJson(), toolCalls: [] },
    ],
    { fetchPolicy: RELATED, candidates: ['ring_buffer.h', 'config.h'] },
  );
  await h.run();

  const system = String(h.requests[0]?.messages[0]?.content ?? '');
  const user = String(h.requests[0]?.messages[1]?.content ?? '');
  const repair = String(h.requests[1]?.messages.at(-1)?.content ?? '');

  assert.match(system, /可以读锚点文件之外的相关文件/, 'system 要给出"可以往外读"的许可');
  assert.doesNotMatch(system, /必须与锚点/, '这句是 S1 时代的口径，跨文件时会自相矛盾');
  assert.match(system, /你这次真的有过的东西/, '输出契约要说清"只有读过的才许引用"');
  assert.match(repair, /你这次真的有过的东西/, 'repair 必须与初次同口径，否则模型修不回来');
  assert.doesNotMatch(repair, /必须与锚点/, 'repair 里那句会让第二次注定失败（这就是用户看到的报错）');

  assert.match(user, /可能相关的文件/, '候选清单必须真的进 prompt（第一版只是个死参数）');
  assert.match(user, /ring_buffer\.h/);
  assert.match(user, /config\.h/);
});

test('S9a 修复：候选清单只在跨文件时给（不然等于邀请它去撞拒绝）', async () => {
  const h = harness([{ content: validJson(), toolCalls: [] }], { candidates: ['ring_buffer.h'] });
  await h.run();

  const user = String(h.requests[0]?.messages[1]?.content ?? '');
  assert.doesNotMatch(user, /可能相关的文件/);
  assert.doesNotMatch(String(h.requests[0]?.messages[0]?.content ?? ''), /可以读锚点文件之外/);
});

test('S9a 修复：轮数用尽的报错要说实话（被拒次数 + 最后一次原因 + 该调什么）', async () => {
  const forever = Array.from({ length: 8 }, (_, i) =>
    toolTurn({ request_type: 'file', start: i * 10 + 1, end: i * 10 + 5, reason: '还不够', path: FILE }, `call_${i}`),
  );
  const h = harness(forever, { maxFetchRounds: 1 });

  await assert.rejects(
    () => h.run(),
    (err: unknown) => {
      assert.ok(err instanceof AnchorError);
      assert.equal(err.code, 'MAX_ROUNDS_EXCEEDED');
      assert.match(err.message, /被拒 \d+ 次/, '笼统说"取件 N 次之后"是假话：可能一次都没取成');
      assert.match(err.message, /最后一次被拒的原因/);
      assert.match(err.message, /maxFetchRounds/, '要告诉用户该调哪个设置');
      return true;
    },
  );
});
