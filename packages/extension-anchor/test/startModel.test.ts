/**
 * 开始面板的内容模型（§5.5）。这个文件守的是**面板说的每一句话**：
 * 键位是不是用户实际绑的、缺东西时有没有说清缺什么、动作指向的命令是不是真的存在。
 *
 * 这里能测，是因为 `startModel.ts` 是纯函数（D19：不 import 'vscode'）。
 * 面板的 DOM 行为不在这里 —— 那只能靠 F5（约束 27）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { START_ACTIONS, buildStartModel, findStartAction } from '../src/start/startModel.ts';
import type { StartModelInput } from '../src/start/startModel.ts';
import { defaultChords } from '../src/sidebar/keybindingResolve.ts';

/** 一切就绪的一份输入：各条测例只改自己关心的那几项。 */
function input(patch: Partial<StartModelInput> = {}): StartModelInput {
  return {
    chords: defaultChords(false),
    providerReady: true,
    providerSummary: 'default：test-model @ https://example.test/v1；最多取件 3 次',
    peerInstalled: true,
    captureSummary: 'main.c 第 40-48 行（选区）',
    // D80：默认给一个**空队列**（null）—— 那组按钮此时该是灰的
    queueSummary: null,
    queueCount: 0,
    // D83：默认**有**存档 —— "一切就绪"那条测例要的是"每颗按钮都可点"，
    // 而"还没有讲过任何一段"那种状态有自己的测例（下面那条）。
    hasLastRun: true,
    session: null,
    ...patch,
  };
}

function actionOf(model: ReturnType<typeof buildStartModel>, id: string) {
  for (const section of model.sections) {
    const found = section.actions.find((action) => action.id === id);
    if (found) return found;
  }
  throw new Error(`面板里没有动作 ${id}`);
}

test('耦合锁：每个动作指向的命令都真的被声明过（线2 的要去线2 那份声明里找）', () => {
  // 漏了声明的后果是"点了没反应"：`executeCommand` 抛"命令未找到"，
  // 而用户看到的是一个来自 VS Code 的报错框，找不到是哪个按钮干的。
  //
  // 这里必须读**两份** package.json：线2 的动作（`anchorPdf.*`）声明在线2 那边，
  // 只查线1 会让这条锁把两个合法动作判成坏的。哪条命令归谁，就是跨扩展调用（§5.1）
  // 的方向 —— 所以"找错了文件"本身就是我们要拦的错。
  const read = (relative: string) =>
    JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8')) as {
      contributes: { commands: { command: string }[] };
    };

  const line1 = read('../package.json').contributes.commands.map((c) => c.command);
  const line2 = read('../../extension-anchor-pdf/package.json').contributes.commands.map((c) => c.command);

  for (const action of START_ACTIONS) {
    const owner = action.group === 'line2' ? line2 : line1;
    assert.ok(
      owner.includes(action.command),
      `开始面板的动作 ${action.id} 指向 ${action.command}，但它没在所属扩展的 contributes.commands 里声明`,
    );
  }
});

test('耦合锁：线2 的两个动作指向的是线2 的命令（前缀即归属）', () => {
  // 跨扩展调用只有一条路（§5.1 的单向 executeCommand）。把归属写成前缀，
  // 于是"这个按钮到底调谁"在表里一眼可见，而不是靠读 commands.ts 才知道。
  for (const action of START_ACTIONS) {
    const expected = action.group === 'line2' ? 'anchorPdf.' : 'anchorExplain.';
    assert.ok(action.command.startsWith(expected), `${action.id} → ${action.command} 归属不对`);
  }
});

test('动作 id 唯一（id 是面板回传的唯一凭据）', () => {
  const ids = START_ACTIONS.map((action) => action.id);
  assert.equal(new Set(ids).size, ids.length, ids.join(', '));
});

test('顺序固定：开始 → 队列 → 线2 → 这次讲解（每次打开都长一个样）', () => {
  // 「多段选择（队列）」插在**开始**与**线2**之间：它是"下一步选什么"的一部分，
  // 排在退路（线2 / 会话）之前。加组就要改这里 —— 这条锁存在的意义就是提醒你：
  // 面板上多了一块东西，用户第二次进来手要重新找按钮了。
  const model = buildStartModel(input({ session: { index: 1, total: 5, state: 'paused', stale: false } }));
  assert.deepEqual(
    model.sections.map((section) => section.id),
    ['start', 'segments', 'line2', 'session'],
  );
});

test('键位显示的是**用户实际绑的**（D10），不是默认值', () => {
  const chords = defaultChords(false);
  chords.capture = 'ctrl+alt+1';
  const model = buildStartModel(input({ chords }));

  assert.equal(actionOf(model, 'capture').chord, 'Ctrl+Alt+1');
  assert.equal(model.openChord, 'Ctrl+Alt+A', '默认没改时显示默认键');
});

test('解绑（null）时 chord 是 null —— 面板改说"命令面板里找"，而不是显示一个按不动的键', () => {
  const chords = defaultChords(false);
  chords.capture = null;
  chords.showStart = '';
  const model = buildStartModel(input({ chords }));

  assert.equal(actionOf(model, 'capture').chord, null);
  assert.equal(model.openChord, null);
});

test('一切就绪：每个动作都可点，note 是它自己的说明', () => {
  // 这条测的是"什么都不缺"那一档，所以**队列里必须真的有段** ——
  // 空队列时「讲队列 / 清空队列」本来就该是灰的（那是 D80 那条测的职责）。
  // 名字要对得起事实：带着一个空队列断言全部可点，等于把这条测改成假的。
  const model = buildStartModel(input({ queueSummary: '2 段（main.c 第 10-14 + 40-48 行）' }));
  for (const section of model.sections) {
    for (const action of section.actions) {
      // goto 需要会话，这一条单独测
      if (action.id === 'goto') continue;
      assert.equal(action.enabled, true, action.id);
      assert.ok(action.note.length > 0, action.id);
    }
  }
});

test('没配模型：「设置 API Key」灰掉，但**「配置模型端点」必须可点**（门厅不许是死路，D61/D62）', () => {
  const model = buildStartModel(input({ providerReady: false, providerSummary: '没有可用的 provider' }));

  const key = actionOf(model, 'setApiKey');
  assert.equal(key.enabled, false);
  assert.ok(key.note.includes('anchorExplain.providers'), key.note);
  assert.ok(key.note.includes('配置模型端点'), `灰按钮的理由要指出下一步按哪颗：${key.note}`);

  // 这条是这一测的重点：面板说"你还缺 providers"，那就必须有一步去配它 ——
  // 而且那一步要**真的能配**（不是"带你去看设置"），否则用户面对的仍是"所有事都做不了"。
  const configure = actionOf(model, 'configure');
  assert.equal(configure.enabled, true, '「配置模型端点」不该受 provider / 对端 / 会话任何条件限制');
  // 命令在**表**里，不在模型里（模型只带 id，命令由宿主查表 —— §5.5 的刻意的分工）
  assert.equal(START_ACTIONS.find((a) => a.id === 'configure')?.command, 'anchorExplain.configure');

  // 想自己改设置的人也该有条路，同样不受条件限制
  assert.equal(actionOf(model, 'openSettings').enabled, true);

  assert.equal(actionOf(model, 'showState').enabled, true, '自检命令不需要模型');
  assert.equal(actionOf(model, 'capture').enabled, true, '捕获不预设前提：缺模型时它自己会报错');

  assert.equal(model.status[0]?.label, '模型');
  assert.equal(model.status[0]?.tone, 'warn');
});

test('「配置模型端点」排在「设置 API Key」前面（顺序即"先配端点、再存 key"）', () => {
  const ids = buildStartModel(input()).sections[0]?.actions.map((a) => a.id) ?? [];
  assert.ok(ids.indexOf('configure') < ids.indexOf('setApiKey'), `实际顺序：${ids.join(' → ')}`);
  assert.equal(ids.at(-1), 'openSettings', `「打开设置」是这一组最后的退路，实际：${ids.join(' → ')}`);
});

test('没装线2：两个线2 动作灰掉并且理由是同一句（不静默：说清是哪一半缺）', () => {
  const model = buildStartModel(input({ peerInstalled: false }));

  for (const id of ['openPdf', 'selectRegion']) {
    const action = actionOf(model, id);
    assert.equal(action.enabled, false, id);
    assert.ok(action.note.includes('Fish-zjuer.anchor-pdf'), action.note);
  }
  assert.equal(model.status[1]?.tone, 'warn');
  assert.ok(model.status[1]?.value.includes('未安装'));
});

test('没有会话：「跳到指定步」灰掉；有会话时它可点且状态行报第几步 + 状态词', () => {
  assert.equal(actionOf(buildStartModel(input()), 'goto').enabled, false);

  const model = buildStartModel(input({ session: { index: 1, total: 5, state: 'paused', stale: true } }));
  const goto = actionOf(model, 'goto');
  assert.equal(goto.enabled, true);
  assert.ok(goto.chord, '有会话时也该显示用户绑的键');

  const line = model.status.find((item) => item.label === '讲解');
  assert.equal(line?.value, '第 2/5 步 · 已暂停 · 文件已改动');
  assert.equal(line?.tone, 'ok');
});

test('没捕获过时说"还没有捕获过"，而不是留空', () => {
  const model = buildStartModel(input({ captureSummary: null }));
  const line = model.status.find((item) => item.label === '上次捕获');
  assert.equal(line?.value, '还没有捕获过');
  assert.equal(line?.tone, 'muted');
});

test('五个状态项的顺序固定（模型 / 线2 / 上次捕获 / 多段队列 / 讲解）', () => {
  const model = buildStartModel(input());
  assert.deepEqual(
    model.status.map((item) => item.label),
    ['模型', '线2', '上次捕获', '多段队列', '讲解'],
  );
});

test('D80 多段队列：为空时按钮灰掉且**说清下一步去哪**；有段时就绪', () => {
  // 空队列 = 那三个动作的两个下线理由都一样 —— 灰按钮不说理由是最气人的一种 UI。
  const empty = buildStartModel(input({ queueSummary: null }));
  for (const id of ['explainSegments', 'clearSegments']) {
    const action = actionOf(empty, id);
    assert.equal(action.enabled, false, id);
    assert.ok(action.note.includes('加入队列'), `${id} 的理由要指出下一步：${action.note}`);
  }
  const line = empty.status.find((item) => item.label === '多段队列');
  assert.equal(line?.tone, 'muted');
  assert.ok(line?.value.includes('加入队列'), line?.value ?? '');

  // 「加入」永远可用（它不需要队列里有东西），「讲/清空」要队列里有段
  assert.equal(actionOf(empty, 'addSegment').enabled, true);

  const loaded = buildStartModel(input({ queueSummary: '3 段（main.c 第 10-14 + 40-48 + 80-90 行）' }));
  assert.equal(actionOf(loaded, 'explainSegments').enabled, true);
  assert.equal(actionOf(loaded, 'clearSegments').enabled, true);
  assert.equal(loaded.status.find((item) => item.label === '多段队列')?.tone, 'ok');
  assert.ok(loaded.status.find((item) => item.label === '多段队列')?.value.includes('3 段'));
});

test('D83 上次讲解：没有存档时那两颗按钮灰掉，且**说清先去讲一次**', () => {
  // 用户的原话：「讲解结束时，需要能重新讲，并且应该能保存/重放之前的内容」。
  // 这条守的是"还没有任何存档"那一档：两颗按钮必须灰，而且理由要指出下一步按哪颗按钮
  // （D61 的老规矩：灰按钮只写"缺东西"不写"去哪儿拿"，那句提示就是一句废话）。
  const none = buildStartModel(input({ hasLastRun: false }));
  for (const id of ['replayLast', 'reExplain']) {
    const action = actionOf(none, id);
    assert.equal(action.enabled, false, id);
    assert.ok(action.note.includes('讲解选中的代码'), `${id} 的理由要指出下一步：${action.note}`);
  }

  // 有存档时两颗都可点，且各自说明**代价**（一颗不花钱、一颗要再问一次模型）——
  // 这正是它们必须分成两颗按钮的原因，所以那句话是规格的一部分，不是文案。
  const has = buildStartModel(input({ hasLastRun: true }));
  assert.equal(actionOf(has, 'replayLast').enabled, true);
  assert.equal(actionOf(has, 'reExplain').enabled, true);
  assert.match(actionOf(has, 'replayLast').note, /不再问模型/);
  assert.match(actionOf(has, 'reExplain').note, /再问一次模型/);
});

test('D81 队列那一组的标题带上数量（反馈要落在刚点的那颗按钮正上方）', () => {
  // 用户报的原话：「加入队列，虽然下面的按钮有反应，但是没有文本什么的提示，感觉不妥」。
  // 病根不是"没提示"，而是提示长在**他没看的地方**：面板上那颗按钮在上面，
  // 队列那一行状态在面板最下面（要滚动），临时状态栏消息 3 秒就没了。
  // 所以数量挂到**分组标题**上 —— 抬头就看得见，滚都不用滚。
  const empty = buildStartModel(input({ queueSummary: null, queueCount: 0 }));
  assert.equal(empty.sections.find((s) => s.id === 'segments')?.title, '多段选择（队列）');

  const loaded = buildStartModel(input({ queueSummary: '2 段（main.c 第 21-25 + 40-48 行）', queueCount: 2 }));
  assert.equal(loaded.sections.find((s) => s.id === 'segments')?.title, '多段选择（队列） · 已有 2 段');

  // 别的组的标题不受影响（数量只属于队列那一组）
  assert.equal(loaded.sections.find((s) => s.id === 'start')?.title, '开始');
});

test('findStartAction：表里有就有、没有就是 undefined（宿主据此拒绝）', () => {
  assert.equal(findStartAction('capture')?.command, 'anchorExplain.capture');
  assert.equal(findStartAction('随便什么东西'), undefined);
  assert.equal(findStartAction(''), undefined);
});

test('讲解进行中时，面板那一行显示**阶段**而不是"没有进行中的讲解"（D64）', () => {
  // 用户报的两件事其实是同一个病：模型在背后跑十几秒，屏幕上毫无动静 → 他以为没反应，又点了一次。
  const model = buildStartModel(input({ busy: '正在请求模型…' }));
  const line = model.status.find((item) => item.label === '讲解');
  assert.equal(line?.value, '正在请求模型…');
  assert.equal(line?.tone, 'ok');

  // 阶段压过旧的会话状态：正在跑新的讲解时，别显示上一轮的"第 2/5 步"
  const both = buildStartModel(
    input({ busy: '第 1 轮取件：{"type":"file"} → 12 字', session: { index: 1, total: 5, state: 'done', stale: false } }),
  );
  assert.equal(both.status.find((i) => i.label === '讲解')?.value, '第 1 轮取件：{"type":"file"} → 12 字');
});
