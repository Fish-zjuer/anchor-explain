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

test('顺序固定：开始 → 线2 → 这次讲解（每次打开都长一个样）', () => {
  const model = buildStartModel(input({ session: { index: 1, total: 5, state: 'paused', stale: false } }));
  assert.deepEqual(
    model.sections.map((section) => section.id),
    ['start', 'line2', 'session'],
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
  const model = buildStartModel(input());
  for (const section of model.sections) {
    for (const action of section.actions) {
      // goto 需要会话，这一条单独测
      if (action.id === 'goto') continue;
      assert.equal(action.enabled, true, action.id);
      assert.ok(action.note.length > 0, action.id);
    }
  }
});

test('没配模型：只有「设置 API Key」灰掉，且说清缺什么', () => {
  const model = buildStartModel(input({ providerReady: false, providerSummary: '没有可用的 provider' }));

  const key = actionOf(model, 'setApiKey');
  assert.equal(key.enabled, false);
  assert.ok(key.note.includes('anchorExplain.providers'), key.note);
  assert.equal(actionOf(model, 'showState').enabled, true, '自检命令不需要模型');
  assert.equal(actionOf(model, 'capture').enabled, true, '捕获不预设前提：缺模型时它自己会报错');

  assert.equal(model.status[0]?.label, '模型');
  assert.equal(model.status[0]?.tone, 'warn');
});

test('没装线2：两个线2 动作灰掉并且理由是同一句（不静默：说清是哪一半缺）', () => {
  const model = buildStartModel(input({ peerInstalled: false }));

  for (const id of ['openPdf', 'selectRegion']) {
    const action = actionOf(model, id);
    assert.equal(action.enabled, false, id);
    assert.ok(action.note.includes('anchor.anchor-pdf'), action.note);
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

test('四个状态项的顺序固定（模型 / 线2 / 上次捕获 / 讲解）', () => {
  const model = buildStartModel(input());
  assert.deepEqual(
    model.status.map((item) => item.label),
    ['模型', '线2', '上次捕获', '讲解'],
  );
});

test('findStartAction：表里有就有、没有就是 undefined（宿主据此拒绝）', () => {
  assert.equal(findStartAction('capture')?.command, 'anchorExplain.capture');
  assert.equal(findStartAction('随便什么东西'), undefined);
  assert.equal(findStartAction(''), undefined);
});
