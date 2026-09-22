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
import type { CandidateFile } from '../src/relatedFiles.ts';
import type { AssistantTurn, ChatMessage, ChatProvider, ChatRequest, TokenUsage } from '../src/orchestrator/providers/types.ts';

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

/** 清单里的一条（S9a-fix10）。假名是给模型写的，`path` 是真身，`label` 只用于辨认。 */
function cand(alias: string, path: string, label?: string): CandidateFile {
  return { alias, path, label: label ?? path.split('/').slice(-2).join('/') };
}

/** 把一个 turn 列表变成 ChatProvider；用完之后再被调用就抛（能抓住"多问了一轮"） */
function harness(
  turns: readonly AssistantTurn[],
  opts: {
    maxFetchRounds?: number;
    fetchPolicy?: ContextFetchPolicy;
    /** 清单（S9a-fix10 起它是**范围本身**，不只是提示） */
    candidates?: readonly CandidateFile[];
    /** 换掉适配器的取件实现（D96：模拟"文件不存在"这类读取失败） */
    fetchImpl?: (req: ContextRequest) => Promise<string>;
    /** PDF 形态（D98）：能力矩阵换 page_range、outline 给 pageCount、PDF 位置才合法 */
    pdf?: boolean;
    /** `find_files` 的回话池（D119）：只在 `any` 档有用 */
    workspaceFiles?: readonly string[];
    /** token 用量的落点（D120） */
    onUsage?: (total: TokenUsage) => void;
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
    capabilities: opts.pdf ? { contextTypes: ['page_range'], maxSpan: 5 } : { contextTypes: ['file'], maxSpan: 5 },
    fetchContext(req) {
      fetches.push(req);
      return opts.fetchImpl
        ? opts.fetchImpl(req)
        : Promise.resolve(`文件：${FILE}\n行 1-10：\n 1\t#include <stdio.h>`);
    },
  };

  const run = (anchor = anchorWith()) =>
    createOrchestrator({
      chat: provider,
      routeModel: createModelRouter({ tier1Model: 'cheap' }),
      adapter,
      makeOutline: () =>
        Promise.resolve(
          opts.pdf ? { documentLineCount: null, pageCount: 30 } : { documentLineCount: DOC_LINES, pageCount: null },
        ),
      maxFetchRounds: opts.maxFetchRounds ?? 3,
      logger,
      ...(opts.fetchPolicy ? { fetchPolicy: opts.fetchPolicy } : {}),
      ...(opts.candidates ? { candidateFiles: opts.candidates } : {}),
      // 生产里 `candidateFiles` 就是 `policy.candidates` 那**同一个数组**（D119：清单即范围）。
      // 测试若只给 policy 不给这个 dep，测到的组合是**产品里不存在的**（提示词与闸门各说各话）。
      ...(opts.candidates === undefined && opts.fetchPolicy?.candidates !== undefined
        ? { candidateFiles: opts.fetchPolicy.candidates }
        : {}),
      ...(opts.workspaceFiles ? { workspaceFiles: opts.workspaceFiles } : {}),
      ...(opts.onUsage ? { onUsage: opts.onUsage } : {}),
    })(anchor);

  return { provider, requests, fetches, adapter, run, logger };
}

// ── D98：PDF 锚点的取件链路（path 兜底 / 只认锚点文档 / 打不开的回灌 / 释义面） ──

const PDF_FILE = 'C:/repo/docs/sample.pdf';

function pdfAnchorWith(over: Partial<Anchor> = {}): Anchor {
  return {
    sourceType: 'pdf',
    sourceId: 'sha1:pdf',
    sourceName: 'sample.pdf',
    location: { page: 23, bbox: [0.1, 0.2, 0.9, 0.35], filePath: PDF_FILE },
    extractedText: '第 23 页框选区域的文字。',
    ...over,
  };
}

function validPdfJson(): string {
  return JSON.stringify({
    summary: '这一块讲的是采样保持电路的作用。',
    confidence: 0.8,
    steps: [
      {
        location: { page: 23, bbox: [0.1, 0.2, 0.9, 0.35] },
        text: '先说这段文字的主张：采样保持是量化之前的关键环节。',
        highlights: [{ location: { page: 23, bbox: [0.1, 0.2, 0.9, 0.35] }, narration: '核心论点', emphasis: 'primary' }],
      },
    ],
  });
}

function toolMessageOf(req: ChatRequest): string {
  const tool = req.messages.find((m) => m.role === 'tool');
  return tool && 'content' in tool ? String(tool.content) : '';
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
  assert.match(JSON.stringify(h.requests[0]?.messages[0]), /代码讲解生成器/, 'system prompt 在第一位（D94 用户模板的角色段）');
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

test('D119：写在清单外的路径（构建目录那种）→ 在闸门就被拒，回灌里给出清单与正确写法', async () => {
  // 用户实测的形状：模型把构建目录当前缀拼进 path。S9a-fix10 之前它会**过闸门**，
  // 然后在适配器里以 ENOENT 炸出来（D96 才没让它炸穿）。现在它在闸门就停下 ——
  // 那一轮仍然算白烧，但代价从"一次真实读取 + 一段失败说明"降到一句拒绝，
  // 而且回灌里直接写着**正确的写法**（照清单写假名），它下一轮不必再猜。
  const MISSING = 'C:\\repo\\test\\_build_tmp\\transport_uart.c';
  const h = harness(
    [
      toolTurn({ request_type: 'file', start: 1, end: 30, reason: '看发送函数', path: MISSING }, 'call_bad'),
      toolTurn({ request_type: 'file', start: 1, end: 10, reason: '再看头文件', path: 'uart.h' }, 'call_good'),
      { content: validJson(), toolCalls: [] },
    ],
    {
      fetchPolicy: {
        scope: 'related',
        roots: ['C:\\repo\\test'],
        maxLines: 400,
        candidates: [
          cand('f1', 'C:/repo/test/fixtures/ring_buffer.h', 'ring_buffer.h'),
          cand('f2', 'C:/repo/test/fixtures/uart.h', 'uart.h'),
        ],
      },
      fetchImpl: (req) => Promise.resolve(`文件：${req.params.path}\n行 1-10：\n 1\tvoid uart_send(uint8_t b);`),
    },
  );
  const result = await h.run();

  assert.equal(result.summary, '这是一段出队逻辑。', '被拒不等于整次讲解失败（拒绝不抛错，§3.2）');
  const feedback = (h.requests[1]?.messages ?? []).find((m: ChatMessage) => m.role === 'tool');
  assert.ok(feedback, '拒绝也要以 role=tool 回灌，不能抛出循环');
  assert.match(feedback?.content ?? '', /请求被拒绝/);
  assert.match(feedback?.content ?? '', /_build_tmp/, '要点名它写的那个路径（形状 `C:\\repo\\…\\…`）');
  assert.match(feedback?.content ?? '', /transport_uart\.c/, '要点名它写的那个文件');
  assert.match(feedback?.content ?? '', /清单里那 2 个文件/, '要说清这次一共几个可选');
  assert.match(feedback?.content ?? '', /假名/);
  assert.match(feedback?.content ?? '', /anchorExplain\.fetchScope/, '给出路：改档位或调大清单');
  assert.equal(h.fetches.length, 1, '被拒的那次**不该**走到适配器（这是"清单即范围"的直接体现）');
});

test('D96：清单里的文件在扫描之后读不到（放行 ≠ 读得到）→ 不中止，回灌失败说明 + 清单', async () => {
  // 清单是**扫描时**的结果，而文件可能在扫描之后被删掉、或根本没有读权限 ——
  // 那道缝隙依然存在，这一条守着它。（另外：清单可能来自一份过期的缓存，
  // 所以"放行 ≠ 读得到"这条纪律不因为闸门收紧而失效。）
  let call = 0;
  const h = harness(
    [
      toolTurn({ request_type: 'file', start: 1, end: 30, reason: '看发送函数', path: 'uart.h' }, 'call_bad'),
      toolTurn({ request_type: 'file', start: 1, end: 10, reason: '看另一个', path: 'ring_buffer.h' }, 'call_good'),
      { content: validJson(), toolCalls: [] },
    ],
    {
      fetchPolicy: {
        scope: 'related',
        roots: ['C:\\repo\\test'],
        maxLines: 400,
        candidates: [
          cand('f1', 'C:/repo/test/fixtures/uart.h', 'uart.h'),
          cand('f2', 'C:/repo/test/fixtures/ring_buffer.h', 'ring_buffer.h'),
        ],
      },
      fetchImpl: (req) => {
        call += 1;
        if (call === 1) {
          return Promise.reject(new Error(`ENOENT: no such file or directory, open '${req.params.path}'`));
        }
        return Promise.resolve(`文件：${req.params.path}\n行 1-10：\n 1\tvoid uart_send(uint8_t b);`);
      },
    },
  );
  const result = await h.run();

  assert.equal(result.summary, '这是一段出队逻辑。', '读取失败绝不等于整次讲解失败（D96 之前就是 ENOENT 炸穿）');
  const feedback = (h.requests[1]?.messages ?? []).find((m: ChatMessage) => m.role === 'tool');
  assert.ok(feedback, '失败也要以 role=tool 回灌，不能抛出循环');
  assert.match(feedback?.content ?? '', /取件失败/);
  assert.match(feedback?.content ?? '', /fixtures\\\\uart\.h|fixtures\/uart\.h/, '要点名解析出来的那个路径');
  assert.match(feedback?.content ?? '', /不要猜路径/);
  assert.match(feedback?.content ?? '', /`f1`/, '清单要再给一遍（写假名），模型才有活路');
  assert.match(feedback?.content ?? '', /`f2`/);

  // 失败的那次**不消耗**取件预算：第二次取件照常放行（失败没有内容可回灌，不该罚它）
  assert.equal(h.fetches.length, 2, '两次都真的走到适配器了');
  // 日志里必须留得住这次失败（§7：每次取件都要落日志，包括没读成的）
  const failed = h.logger.entries().find((e) => e.accepted === false && (e.rejectReason ?? '').includes('文件打不开'));
  assert.ok(failed, '读取失败要进取件日志');
});

test('D96：取件连续打不开也会收场，报错里说清"打不开 N 次"（不是假话）', async () => {
  const forever = Array.from({ length: 8 }, (_, i) =>
    toolTurn({ request_type: 'file', start: 1, end: 5, reason: '再试一次', path: `nope_${i}.h` }, `call_${i}`),
  );
  const h = harness(forever, {
    maxFetchRounds: 1,
    // 清单是**扫描时**的结果，而"放行 ≠ 读得到"（D96）：文件可能在扫描之后被删掉、
    // 或者根本没有读权限。所以这里刻意给一份"指向不存在文件"的清单来模拟那个缝隙。
    fetchPolicy: {
      scope: 'related',
      roots: ['C:\\repo\\test'],
      maxLines: 400,
      candidates: Array.from({ length: 8 }, (_, i) => cand(`f${i + 1}`, `C:/repo/test/nope_${i}.h`, `nope_${i}.h`)),
    },
    fetchImpl: () => Promise.reject(new Error('ENOENT: no such file or directory, open \'C:\\repo\\test\\nope.h\'')),
  });

  await assert.rejects(
    () => h.run(),
    (err: unknown) => {
      assert.ok(err instanceof AnchorError);
      assert.equal(err.code, 'MAX_ROUNDS_EXCEEDED');
      assert.match(err.message, /打不开 \d+ 次/, '失败的取件既不是"成功"也不是"被拒"，报错里要有它自己的账');
      return true;
    },
  );
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
  // 上限 = maxFetchRounds + 2 + 被拒宽限 2（D123）= 5。宽限是**死的**：多给两轮，不等于不封顶。
  assert.ok(h.requests.length <= 5, `调用次数必须有界，实际 ${h.requests.length}`);
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

const RELATED: ContextFetchPolicy = {
  scope: 'related',
  roots: ['C:\\repo'],
  maxLines: 60,
  // S9a-fix10（D119）：`related` 档下**清单就是范围** —— 策略里没有清单，就等于"一个别的文件都取不到"。
  // `ring_buffer.h` 按锚点目录解析成 `C:/repo/test/fixtures/ring_buffer.h`，所以清单里要有这一条。
  candidates: [
    cand('f1', 'C:/repo/test/fixtures/ring_buffer.h', 'ring_buffer.h'),
    cand('f2', 'C:/repo/test/fixtures/config.h', 'config.h'),
  ],
};
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
    {
      fetchPolicy: RELATED,
      candidates: [
        cand('f1', 'C:/repo/test/fixtures/ring_buffer.h', 'ring_buffer.h'),
        cand('f2', 'C:/repo/test/fixtures/config.h', 'config.h'),
      ],
    },
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
  const h = harness([{ content: validJson(), toolCalls: [] }], {
    candidates: [cand('f1', 'C:/repo/test/fixtures/ring_buffer.h', 'ring_buffer.h')],
  });
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

// ── D97：讲解语言透传 ─────────────────────────────────────────────────────

test('deps.language = en：system / user prompt 都换英文面（中文一个字都不该出现在指令里）', async () => {
  // harness 不收 language —— 单独建一个带语言的编排器（其余依赖与 harness 相同）
  const provider: ChatProvider = { chat(req) { requests.push(req); return Promise.resolve({ content: validJson(), toolCalls: [] }); } };
  const requests: ChatRequest[] = [];
  await createOrchestrator({
    chat: provider,
    routeModel: createModelRouter({ tier1Model: 'cheap' }),
    adapter: {
      capabilities: { contextTypes: ['file'], maxSpan: 5 },
      fetchContext: () => Promise.resolve(''),
    },
    makeOutline: () => Promise.resolve({ documentLineCount: DOC_LINES, pageCount: null }),
    maxFetchRounds: 3,
    language: 'en',
  })(anchorWith());

  const system = String(requests[0]?.messages[0]?.content ?? '');
  const user = String(requests[0]?.messages[1]?.content ?? '');
  assert.match(system, /^# Role/m);
  assert.match(system, /You write the explanation\s+in English/);
  assert.match(user, /^## Anchor/m);
  assert.doesNotMatch(system, /代码讲解生成器/);
  assert.doesNotMatch(user, /锚点/);
});

// ── D98：PDF 锚点的取件链路 ───────────────────────────────────────────────

test('D98 PDF：page_range 不带 path → 闸门兜底成锚点文档，适配器拿到绝对路径', async () => {
  const h = harness(
    [
      toolTurn({ request_type: 'page_range', start: 22, end: 24, reason: '前因后果不完整' }),
      { content: validPdfJson(), toolCalls: [] },
    ],
    { pdf: true },
  );
  const result = await h.run(pdfAnchorWith());

  assert.equal(result.summary, '这一块讲的是采样保持电路的作用。');
  assert.equal(h.fetches.length, 1);
  // 关键断言：模型根本没给 path，适配器拿到的却是完整的锚点文档路径 ——
  // 过去这一路会以"取件参数不完整"炸出来，PDF 的"多读几页"实际上不可用
  assert.equal(h.fetches[0]?.params.path, PDF_FILE);
  assert.equal(h.fetches[0]?.type, 'page_range');
  // 取件结果回灌给模型（页头格式由适配器负责，这里只验内容到了）
  assert.match(toolMessageOf(h.requests[1]!), /22-24|第 2[234] 页|文件：/);
});

test('D98 PDF：path 指向别的文档 → 拒绝回灌"只认锚点这一份文档"', async () => {
  const h = harness(
    [
      toolTurn({ request_type: 'page_range', path: 'C:/elsewhere/other.pdf', start: 1, end: 2, reason: 'x' }),
      { content: validPdfJson(), toolCalls: [] },
    ],
    { pdf: true },
  );
  await h.run(pdfAnchorWith());

  const toolText = toolMessageOf(h.requests[1]!);
  assert.match(toolText, /请求被拒绝：/);
  assert.match(toolText, /只认锚点这一份文档/);
  assert.match(toolText, /sample\.pdf/, '拒绝文案要指出正确的文档名');
  assert.equal(h.fetches.length, 0, '被拒的请求不许到适配器');
});

test('D98 PDF：老锚点没有 filePath → 拒绝并明说，不再漏成"取件参数不完整"', async () => {
  const h = harness(
    [
      toolTurn({ request_type: 'page_range', start: 1, end: 2, reason: 'x' }),
      { content: validPdfJson(), toolCalls: [] },
    ],
    { pdf: true },
  );
  await h.run(pdfAnchorWith({ location: { page: 23, bbox: [0.1, 0.2, 0.9, 0.35] } }));

  const toolText = toolMessageOf(h.requests[1]!);
  assert.match(toolText, /没有携带 PDF 的文件路径/);
  assert.equal(h.fetches.length, 0);
});

test('D98 PDF：取件打不开 → 回灌失败说明（给 path 的正确写法），不中止', async () => {
  const h = harness(
    [
      toolTurn({ request_type: 'page_range', path: PDF_FILE, start: 22, end: 24, reason: 'x' }),
      { content: validPdfJson(), toolCalls: [] },
    ],
    {
      pdf: true,
      fetchImpl: () => Promise.reject(new Error(`ENOENT: no such file or directory, open '${PDF_FILE}'`)),
    },
  );
  const result = await h.run(pdfAnchorWith());

  assert.equal(result.summary, '这一块讲的是采样保持电路的作用。', '读取失败不中止整次讲解（D96 纪律在 PDF 下同样成立）');
  const toolText = toolMessageOf(h.requests[1]!);
  assert.match(toolText, /取件失败/);
  assert.match(toolText, /不要猜路径/);
  assert.match(toolText, /省略/, 'PDF 的活路是"path 省略"，与代码线的候选清单不同');
});

test('D98 PDF：system prompt 换释义面（文档讲解生成器），user prompt 带文件路径', async () => {
  const h = harness([{ content: validPdfJson(), toolCalls: [] }], { pdf: true });
  await h.run(pdfAnchorWith());

  const system = String(h.requests[0]?.messages[0]?.content ?? '');
  const user = String(h.requests[0]?.messages[1]?.content ?? '');
  assert.match(system, /文档讲解生成器/);
  assert.doesNotMatch(system, /代码讲解生成器/, 'PDF 不该再收到代码人格');
  assert.doesNotMatch(system, /写入方 \/ 读取方/, '代码通用规则不进 PDF prompt');
  assert.doesNotMatch(system, /档位规则/, '档位是代码特有的，PDF 不进');
  assert.doesNotMatch(system, /# 示例/, '代码示范不进 PDF prompt');
  assert.match(system, /"page"/, '输出契约教的是 PDF 位置形状');
  assert.match(system, /照抄/);
  assert.match(user, /文件路径：C:\/repo\/docs\/sample\.pdf/, 'page_range 的 path 只有这里能抄');
});

// ─────────────────────────────────────────────────────────────
// D119：`find_files`（only in `any`）+ D120：token 累计
// ─────────────────────────────────────────────────────────────

test('D119 any：`find_files` 只列文件、不占取件轮次，回话里给的是**真实路径**', async () => {
  const h = harness(
    [
      { content: '', toolCalls: [{ id: 'call_find', name: 'find_files', arguments: JSON.stringify({ keyword: 'transport', reason: '找找有哪些相关文件' }) }] },
      { content: validJson(), toolCalls: [] },
    ],
    {
      fetchPolicy: { scope: 'any', roots: [], maxLines: 400 },
      workspaceFiles: [
        'C:/fw/Driver/transport/Inc/transport.h',
        'C:/fw/Driver/transport/Src/transport_uart.c',
        'C:/fw/Core/Src/main.c',
        'C:/fw/.env', // 黑名单：列表里也不给
      ],
    },
  );
  await h.run();

  const toolMsg = (h.requests[1]?.messages ?? []).find((m: ChatMessage) => m.role === 'tool');
  assert.match(toolMsg?.content ?? '', /transport\.h/);
  assert.match(toolMsg?.content ?? '', /transport_uart\.c/);
  assert.doesNotMatch(toolMsg?.content ?? '', /main\.c/, '关键词没命中的不列');
  assert.doesNotMatch(toolMsg?.content ?? '', /\.env/, '黑名单文件不进列表（`any` 档也照挡）');
  assert.equal(h.logger.entries().length, 0, '列文件不是"读了哪个文件"，不该进取件日志');
});

test('D119：非 any 档调用 `find_files` 会被拒，并告诉它该走清单', async () => {
  const h = harness(
    [
      { content: '', toolCalls: [{ id: 'call_find', name: 'find_files', arguments: JSON.stringify({ keyword: 'x', reason: '找文件' }) }] },
      { content: validJson(), toolCalls: [] },
    ],
    {
      fetchPolicy: RELATED,
      workspaceFiles: ['C:/repo/test/fixtures/ring_buffer.h'],
    },
  );
  await h.run();

  const toolMsg = (h.requests[1]?.messages ?? []).find((m: ChatMessage) => m.role === 'tool');
  assert.match(toolMsg?.content ?? '', /只在取件范围为 "any" 时可用/, '清单驱动的档位不该能绕过清单去列文件');
  assert.match(toolMsg?.content ?? '', /假名/);
});

test('D119 any：`find_files` 缺 reason 时当拒绝处理，不抛', async () => {
  const h = harness(
    [
      { content: '', toolCalls: [{ id: 'call_find', name: 'find_files', arguments: JSON.stringify({ keyword: 'x' }) }] },
      { content: validJson(), toolCalls: [] },
    ],
    { fetchPolicy: { scope: 'any', roots: [], maxLines: 400 }, workspaceFiles: ['C:/fw/a.c'] },
  );
  await h.run();
  const toolMsg = (h.requests[1]?.messages ?? []).find((m: ChatMessage) => m.role === 'tool');
  assert.match(toolMsg?.content ?? '', /合法 JSON|reason/);
});

test('D120：onUsage 收到的是**累计值**（每轮模型调用都加进来）', async () => {
  const seen: TokenUsage[] = [];
  const h = harness(
    [
      {
        content: '',
        toolCalls: [{ id: 'call_1', name: 'fetch_context', arguments: JSON.stringify({ request_type: 'file', start: 1, end: 10, reason: '看头部' }) }],
        usage: { input: 100, output: 10, cachedInput: 80, uncachedInput: 20 },
      },
      { content: validJson(), toolCalls: [], usage: { input: 300, output: 40, cachedInput: 100, uncachedInput: 200 } },
    ],
    { onUsage: (t) => seen.push(t) },
  );
  await h.run();

  assert.equal(seen.length, 2, '两次模型调用各报一次');
  assert.deepEqual(seen[0], { input: 100, output: 10, cachedInput: 80, uncachedInput: 20 });
  assert.deepEqual(seen[1], { input: 400, output: 50, cachedInput: 180, uncachedInput: 220 }, '第二次是累计，不是单轮');
});

test('D120：端点不给 usage 时 onUsage 一次都不被调用（面板会说"未提供"）', async () => {
  const seen: TokenUsage[] = [];
  const h = harness([{ content: validJson(), toolCalls: [] }], { onUsage: (t) => seen.push(t) });
  await h.run();
  assert.equal(seen.length, 0);
});

test('D123：清单为空时，system prompt 必须说"这次读不到别的文件"，且**不再教假名**', async () => {
  // 用户实测的形状：跨文件开着、但清单是空的，提示词仍在教"写清单里的假名" ——
  // 模型的反应是**编一个 `f1`**，然后被拒、再编、把轮数烧完。
  const h = harness([{ content: validJson(), toolCalls: [] }], {
    fetchPolicy: { scope: 'related', roots: ['C:/repo'], maxLines: 400, candidates: [] },
  });
  await h.run();

  const system = String(h.requests[0]?.messages[0]?.content ?? '');
  assert.doesNotMatch(system, /假名/, '清单为空时不该再提假名 —— 提了它就会编一个出来');
  assert.match(system, /这次读不到锚点文件之外的任何文件/);
  assert.match(system, /不要请求别的文件/);
});

test('D123：清单非空时仍然教假名（两种口径按事实切换）', async () => {
  const h = harness([{ content: validJson(), toolCalls: [] }], { fetchPolicy: RELATED });
  await h.run();
  const system = String(h.requests[0]?.messages[0]?.content ?? '');
  assert.match(system, /假名/);
  assert.doesNotMatch(system, /这次读不到锚点文件之外的任何文件/);
});

test('D123：被拒之后额外给 2 轮 —— 写错几次仍然能拿到讲解，不会"就死了"', async () => {
  // 用户的原话："读到一个不允许的文件就死了，有点问题，建议给2次机会？"
  // 被拒**不消耗取件预算**，但消耗轮次：不给宽限的话，一次写错就把剩下的轮数挤掉，
  // 最后以 MAX_ROUNDS_EXCEEDED 收场，用户什么都拿不到。
  // maxFetchRounds 默认 3 ⇒ 老口径 turnLimit = 5。这里准备 6 次被拒 + 1 次作答 = 7 轮：
  // 宽限没生效的话第 6 轮就抛 MAX_ROUNDS_EXCEEDED 了。
  const bad = (i: number): AssistantTurn => ({
    content: '',
    toolCalls: [
      { id: `bad_${i}`, name: 'fetch_context', arguments: JSON.stringify({ request_type: 'file', start: 1, end: 5, reason: '再试', path: `nope_${i}.h` }) },
    ],
  });
  const h = harness([...Array.from({ length: 6 }, (_, i) => bad(i)), { content: validJson(), toolCalls: [] }], {
    fetchPolicy: RELATED,
  });

  const result = await h.run();
  assert.equal(result.summary, '这是一段出队逻辑。', '被拒 6 次之后仍然拿到了讲解');
  assert.equal(h.logger.entries().filter((e) => e.accepted).length, 0, '一次都没取件成功（全是拒绝）');
  assert.equal(h.requests.length, 7, '6 轮被拒 + 1 轮作答');
});

test('D123：宽限是**死的上限**，不是无限循环（一直取件仍然会收场）', async () => {
  const forever = Array.from({ length: 20 }, (_, i) => ({
    content: '',
    toolCalls: [
      { id: `c${i}`, name: 'fetch_context', arguments: JSON.stringify({ request_type: 'file', start: i * 10 + 1, end: i * 10 + 5, reason: '还不够', path: FILE }) },
    ],
  }));
  const h = harness(forever, { fetchPolicy: RELATED, maxFetchRounds: 1 });
  await assert.rejects(
    () => h.run(),
    (err: unknown) => err instanceof AnchorError && err.code === 'MAX_ROUNDS_EXCEEDED',
  );
});

test('D123：没有工作区文件夹时，`find_files` 依然能用（池子来自"走了锚点邻域"）', async () => {
  // `scanCodeFiles` 的两块：工作区文件夹里（findFiles）+ 盖不住的根（直接走目录树）。
  // 这里只测编排层拿到的池子能被 `find_files` 用起来（走树的实现在冒烟里验）。
  const h = harness(
    [
      { content: '', toolCalls: [{ id: 'find', name: 'find_files', arguments: JSON.stringify({ keyword: 'ring', reason: '找找' }) }] },
      { content: validJson(), toolCalls: [] },
    ],
    {
      fetchPolicy: { scope: 'any', roots: [], maxLines: 400 },
      workspaceFiles: ['C:/fw/Core/Src/main.c', 'C:/fw/Core/Inc/ring_buffer.h'],
    },
  );
  await h.run();
  const toolMsg = (h.requests[1]?.messages ?? []).find((m: ChatMessage) => m.role === 'tool');
  assert.match(toolMsg?.content ?? '', /ring_buffer\.h/);
  assert.doesNotMatch(toolMsg?.content ?? '', /main\.c/);
});
