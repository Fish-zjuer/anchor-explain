/**
 * 两处边界的守卫单测（§5）：跨扩展入口的 Anchor、webview 发来的消息。
 * 两处都是不可信输入，坏形状必须在门口就被丢掉。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ASK_CHARS,
  MAX_HANDOFF_TEXT_CHARS,
  STATE_WORD,
  isAnchorLike,
  parseSidebarMessage,
  parseStartMessage,
} from '../src/protocol.ts';

test('isAnchorLike：合法的代码锚点放行', () => {
  assert.equal(
    isAnchorLike({
      sourceType: 'code',
      sourceId: 'sha1',
      sourceName: 'main.c',
      location: { filePath: 'C:\\repo\\main.c', lineStart: 40, lineEnd: 48 },
      extractedText: '...',
    }),
    true,
  );
});

test('isAnchorLike：合法的 PDF 锚点放行', () => {
  assert.equal(
    isAnchorLike({
      sourceType: 'pdf',
      sourceId: 'pdf-1',
      sourceName: 'sample.pdf',
      location: { page: 23, bbox: [0.1, 0.1, 0.5, 0.2] },
    }),
    true,
  );
});

test('isAnchorLike：缺字段 / 类型不对 / 非对象一律拒绝', () => {
  const bad: unknown[] = [
    null,
    undefined,
    'anchor',
    42,
    [],
    {},
    { sourceType: 'code', sourceId: 'x', sourceName: 'y' },
    { sourceType: 'code', sourceId: 'x', sourceName: 'y', location: {} },
    { sourceType: 'code', sourceId: 1, sourceName: 'y', location: { filePath: 'a', lineStart: 1, lineEnd: 2 } },
    { sourceType: 'pdf', sourceId: 'x', sourceName: 'y', location: { page: 1 } },
    { sourceType: 'video', sourceId: 'x', sourceName: 'y', location: {} },
  ];
  for (const raw of bad) {
    assert.equal(isAnchorLike(raw), false, JSON.stringify(raw));
  }
});

test('isAnchorLike：形状对但数值坏的一律拒绝（不能靠下游兜）', () => {
  const bad: unknown[] = [
    // NaN / Infinity / 1e400：`typeof` 都是 number，core 的宽松守卫拦不住
    { sourceType: 'code', sourceId: 'x', sourceName: 'y', location: { filePath: 'a', lineStart: Number.NaN, lineEnd: 2 } },
    { sourceType: 'code', sourceId: 'x', sourceName: 'y', location: { filePath: 'a', lineStart: 1, lineEnd: Number.POSITIVE_INFINITY } },
    { sourceType: 'code', sourceId: 'x', sourceName: 'y', location: { filePath: 'a', lineStart: 1.5, lineEnd: 2 } },
    { sourceType: 'code', sourceId: 'x', sourceName: 'y', location: { filePath: 'a', lineStart: 0, lineEnd: 2 } },
    { sourceType: 'code', sourceId: 'x', sourceName: 'y', location: { filePath: 'a', lineStart: 9, lineEnd: 2 } },
    { sourceType: 'pdf', sourceId: 'x', sourceName: 'y', location: { page: 1e400, bbox: [0.1, 0.1, 0.2, 0.2] } },
    { sourceType: 'pdf', sourceId: 'x', sourceName: 'y', location: { page: 0, bbox: [0.1, 0.1, 0.2, 0.2] } },
    { sourceType: 'pdf', sourceId: 'x', sourceName: 'y', location: { page: 1, bbox: ['a', 'b', 'c', 'd'] } },
    { sourceType: 'pdf', sourceId: 'x', sourceName: 'y', location: { page: 1, bbox: [0.5, 0.1, 0.5, 0.2] } },
  ];
  for (const raw of bad) {
    assert.equal(isAnchorLike(raw), false, JSON.stringify(raw));
  }
});

test('isAnchorLike：`web` 一律拒绝（本次不接入，放行只会把错报成"AI 输出不合法"）', () => {
  assert.equal(
    isAnchorLike({ sourceType: 'web', sourceId: 'x', sourceName: 'y', location: {} }),
    false,
  );
  assert.equal(
    isAnchorLike({ sourceType: 'web', sourceId: 'x', sourceName: 'y', location: { url: 'https://a', selector: '#b', scrollY: 0 } }),
    false,
  );
});

test('parseSidebarMessage：无参消息放行', () => {
  // D83 把 ui:replay / ui:reExplain 也归进"无参"这一类：它们**只表达意图**，
  // 不带任何参数 —— 要重放哪一份、要重新问谁，全由宿主按存档决定。
  // 让面板能带参数（比如自己指定一份讲解）等于让外部输入能指定要放什么，
  // 与 §5.5「只回传动作 id」是同一条立场。
  // D89 的四个（字号×2 / 导出 / 历史）同理：系数调到多少、导到哪儿，都是宿主的事。
  for (const type of [
    'ui:ready',
    'ui:next',
    'ui:prev',
    'ui:stop',
    'ui:replay',
    'ui:reExplain',
    'ui:fontLarger',
    'ui:fontSmaller',
    'ui:export',
    'ui:openHistory',
  ]) {
    assert.deepEqual(parseSidebarMessage({ type }), { type });
  }
});

test('parseSidebarMessage：带下标的消息要求非负整数', () => {
  assert.deepEqual(parseSidebarMessage({ type: 'ui:goto', index: 2 }), { type: 'ui:goto', index: 2 });
  assert.deepEqual(parseSidebarMessage({ type: 'ui:revealStep', index: 0 }), { type: 'ui:revealStep', index: 0 });

  for (const index of [-1, 1.5, '2', null, undefined, Number.NaN]) {
    assert.equal(parseSidebarMessage({ type: 'ui:goto', index }), null, `index=${String(index)}`);
  }
});

test('parseSidebarMessage：未知类型与非对象一律返回 null', () => {
  for (const raw of [null, 'ui:next', 7, [], {}, { type: 'ui:evil' }, { noType: true }]) {
    assert.equal(parseSidebarMessage(raw), null, JSON.stringify(raw));
  }
});

test('parseStartMessage：ready 放行，run 要非空 id', () => {
  assert.deepEqual(parseStartMessage({ type: 'start:ready' }), { type: 'start:ready' });
  assert.deepEqual(parseStartMessage({ type: 'start:run', id: 'capture' }), {
    type: 'start:run',
    id: 'capture',
  });

  for (const id of ['', null, undefined, 7, {}, []]) {
    assert.equal(parseStartMessage({ type: 'start:run', id }), null, `id=${JSON.stringify(id)}`);
  }
});

test('parseStartMessage：未知类型与非对象一律返回 null', () => {
  for (const raw of [null, 'start:run', 7, [], {}, { type: 'start:evil' }, { noType: true }]) {
    assert.equal(parseStartMessage(raw), null, JSON.stringify(raw));
  }
});

test('parseStartMessage：**只查形状，不查 id 认不认识**（成员资格是宿主查表的活）', () => {
  // 这条是"守卫管能不能读、业务管能不能做"这条分工的锁：
  // 若有人把"id 必须在 START_ACTIONS 里"塞进守卫，这里会红 —— 而那会让
  // 宿主那侧的 `findStartAction` 变成一段永远为真的死代码。
  assert.deepEqual(parseStartMessage({ type: 'start:run', id: '并不是我们的动作' }), {
    type: 'start:run',
    id: '并不是我们的动作',
  });
});

test('parseStartMessage：`start:handoff` 的两端去空白，空的一律丢（D130）', () => {
  // 去空白是因为用户从终端/网页复制时前后带空格或换行是常态，
  // 而**空文本必须丢**：那是误触（在空框里按了按钮），不该让宿主跑一次读文件。
  assert.deepEqual(parseStartMessage({ type: 'start:handoff', text: '  {"filePath":"a.c"} \n' }), {
    type: 'start:handoff',
    text: '{"filePath":"a.c"}',
  });

  for (const text of ['', '   ', '\n\t ', null, undefined, 7, {}, []]) {
    assert.equal(parseStartMessage({ type: 'start:handoff', text }), null, JSON.stringify(text));
  }
});

test('parseStartMessage：`start:handoffDraft` **不去空白也不丢空**（D130）', () => {
  // 这一条是它与 `start:handoff` 的分界线，值得单独钉住：
  // 草稿是"用户此刻框里有什么"，**正在打一个空行**是合法状态，
  // 清空输入框也是合法动作（宿主据此把草稿记得为空）。
  // 若有人顺手把去空白抄过来，用户打字打到换行时草稿就会被悄悄改掉。
  assert.deepEqual(parseStartMessage({ type: 'start:handoffDraft', text: '  {"a":1}\n\n' }), {
    type: 'start:handoffDraft',
    text: '  {"a":1}\n\n',
  });
  assert.deepEqual(parseStartMessage({ type: 'start:handoffDraft', text: '' }), {
    type: 'start:handoffDraft',
    text: '',
  });
  assert.deepEqual(parseStartMessage({ type: 'start:handoffDraft', text: '   ' }), {
    type: 'start:handoffDraft',
    text: '   ',
  });

  for (const text of [null, undefined, 7, {}, []]) {
    assert.equal(parseStartMessage({ type: 'start:handoffDraft', text }), null, JSON.stringify(text));
  }
});

test('parseStartMessage：两条 handoff 消息都**夹断而不拒**（D130）', () => {
  // 夹而不是拒：用户粘一大段是完全正当的用法（外部 Agent 输出又长又啰嗦），
  // 整条丢掉等于让他对着一个没反应的按钮发呆。
  // 真正的业务上限在 `buildHandoff` 的 64KB 那里，它会说一句带数字的人话。
  const long = 'x'.repeat(MAX_HANDOFF_TEXT_CHARS + 5000);

  const coin = parseStartMessage({ type: 'start:handoff', text: long });
  assert.equal(coin?.type, 'start:handoff');
  assert.equal(coin?.text.length, MAX_HANDOFF_TEXT_CHARS);

  const draft = parseStartMessage({ type: 'start:handoffDraft', text: long });
  assert.equal(draft?.type, 'start:handoffDraft');
  assert.equal(draft?.text.length, MAX_HANDOFF_TEXT_CHARS);
});

test('STATE_WORD 是 WalkthroughState 的满射（加状态时漏了词会在这里红）', () => {
  const states = ['idle', 'running', 'playing', 'paused', 'done', 'error'] as const;
  for (const state of states) {
    assert.equal(typeof STATE_WORD[state], 'string', state);
    assert.notEqual(STATE_WORD[state], '', state);
  }
  assert.equal(Object.keys(STATE_WORD).length, states.length, '状态词表与状态联合类型的条数不一致');
});

// ── 追问（D126）：`ui:ask` 是 webview 发来的，所以它必须当成外部输入 ──────────
//
// 三条判据各有代价，所以逐条钉住：空问题放行 = 白花一次模型调用；
// 负下标放行 = 宿主那边找不到那一步（而"找不到"只能报错，用户看不懂）；
// 不截断 = 面板可以把任意长的东西塞进 prompt。

test('parseSidebarMessage：合法的一句追问放行', () => {
  assert.deepEqual(parseSidebarMessage({ type: 'ui:ask', index: 2, question: '为什么先判断再取值？' }), {
    type: 'ui:ask',
    index: 2,
    question: '为什么先判断再取值？',
  });
});

test('parseSidebarMessage：追问的问题**两端去空白**（用户手滑多敲的空格不该进 prompt）', () => {
  assert.deepEqual(parseSidebarMessage({ type: 'ui:ask', index: 0, question: '  这里有锁吗？  ' }), {
    type: 'ui:ask',
    index: 0,
    question: '这里有锁吗？',
  });
});

test('parseSidebarMessage：空问题 / 纯空白一律丢（那是误触，不是"追问了个空"）', () => {
  assert.equal(parseSidebarMessage({ type: 'ui:ask', index: 0, question: '' }), null);
  assert.equal(parseSidebarMessage({ type: 'ui:ask', index: 0, question: '   \n\t ' }), null);
  assert.equal(parseSidebarMessage({ type: 'ui:ask', index: 0 }), null);
  assert.equal(parseSidebarMessage({ type: 'ui:ask', index: 0, question: 42 }), null);
});

test('parseSidebarMessage：下标必须是**非负整数**（面板可以报越界，但形状得先像话）', () => {
  assert.equal(parseSidebarMessage({ type: 'ui:ask', index: -1, question: 'x' }), null);
  assert.equal(parseSidebarMessage({ type: 'ui:ask', index: 1.5, question: 'x' }), null);
  assert.equal(parseSidebarMessage({ type: 'ui:ask', index: '2', question: 'x' }), null);
});

test('parseSidebarMessage：超长的问题**夹断**而不是丢掉（粘一大段代码进来说"这里怎么理解"是正当用法）', () => {
  const long = 'あ'.repeat(MAX_ASK_CHARS + 500);
  const parsed = parseSidebarMessage({ type: 'ui:ask', index: 0, question: long });
  assert.equal(parsed?.type, 'ui:ask');
  assert.equal((parsed as { question: string }).question.length, MAX_ASK_CHARS, '夹到上限，不是拒收');
});
