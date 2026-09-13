/**
 * 键位解析的单测（D10：VS Code 没有公开 API 能查"最终生效的键位"，只能自己读 keybindings.json）。
 *
 * 最后一条是**耦合锁**：`package.json` 的 `contributes.keybindings` 与
 * `keybindingResolve.ts` 的 `WALKTHROUGH_CHORDS` 必须逐字一致 —— 否则状态栏会显示一个
 * 用户按下去没反应的键，而且不会报任何错。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WALKTHROUGH_CHORDS,
  defaultChords,
  formatChord,
  keybindingsPathFrom,
  parseKeybindings,
  resolveChords,
  stripJsonc,
} from '../src/sidebar/keybindingResolve.ts';

test('stripJsonc：行注释 / 块注释 / 尾随逗号', () => {
  const jsonc = `{
  // 这是行注释
  "a": 1, /* 块注释 */
  "b": [1, 2, 3,],
}`;
  assert.deepEqual(JSON.parse(stripJsonc(jsonc)), { a: 1, b: [1, 2, 3] });
});

test('stripJsonc：字符串里的 // 和 /* 不能被当成注释', () => {
  const jsonc = '{ "key": "ctrl+//", "other": "a/*b*/c", "n": ",}" }';
  assert.deepEqual(JSON.parse(stripJsonc(jsonc)), { key: 'ctrl+//', other: 'a/*b*/c', n: ',}' });
});

test('parseKeybindings：坏 JSON 返回空数组而不是抛错', () => {
  assert.deepEqual(parseKeybindings('这不是 JSON'), []);
  assert.deepEqual(parseKeybindings('{"不是":"数组"}'), []);
  assert.deepEqual(parseKeybindings(''), []);
});

test('parseKeybindings：数组里夹非对象元素时只丢那一个', () => {
  const entries = parseKeybindings('[{"command":"a"}, 42, "x", {"command":"b"}]');
  assert.deepEqual(
    entries.map((e) => e.command),
    ['a', 'b'],
  );
});

test('resolveChords：没有用户绑定时等于默认键位', () => {
  assert.deepEqual(resolveChords([], false), defaultChords(false));
});

test('resolveChords：用户覆盖优先，且后面的条目优先', () => {
  const chords = resolveChords(
    [
      { command: 'anchorExplain.next', key: 'ctrl+n' },
      { command: 'anchorExplain.next', key: 'ctrl+m' },
    ],
    false,
  );
  assert.equal(chords.next, 'ctrl+m');
});

test('resolveChords：`-command` 视为解绑，返回 null', () => {
  const chords = resolveChords([{ command: '-anchorExplain.next' }], false);
  assert.equal(chords.next, null);
  assert.equal(chords.prev, defaultChords(false).prev, '其它键不受影响');
});

test('resolveChords：带 when 的绑定不参与判定（判不出最终生效键，就不猜）', () => {
  const chords = resolveChords([{ command: 'anchorExplain.next', key: 'ctrl+n', when: 'editorTextFocus' }], false);
  assert.equal(chords.next, defaultChords(false).next);
});

test('resolveChords：空串键视为解绑', () => {
  assert.equal(resolveChords([{ command: 'anchorExplain.stop', key: '  ' }], false).stop, null);
});

test('resolveChords：mac 上优先取 mac 字段', () => {
  const chords = resolveChords([{ command: 'anchorExplain.next', key: 'ctrl+n', mac: 'cmd+n' }], true);
  assert.equal(chords.next, 'cmd+n');
});

test('formatChord：escape / alt+] / ctrl+shift+a 的显示形式', () => {
  assert.equal(formatChord('escape'), 'Esc');
  assert.equal(formatChord('alt+]'), 'Alt+]');
  assert.equal(formatChord('alt+['), 'Alt+[');
  assert.equal(formatChord('ctrl+shift+space'), 'Ctrl+Shift+Space');
  assert.equal(formatChord('cmd+alt+w'), 'Cmd+Alt+W');
});

test('formatChord：修饰键顺序归一（不按用户书写顺序）', () => {
  assert.equal(formatChord('shift+ctrl+a'), 'Ctrl+Shift+A');
});

test('keybindingsPathFrom：Windows 与 POSIX 路径都向上三级', () => {
  assert.equal(
    keybindingsPathFrom('C:\\Users\\me\\AppData\\Roaming\\Code\\User\\globalStorage\\anchor.anchor-explain'),
    'C:\\Users\\me\\AppData\\Roaming\\Code\\User\\keybindings.json',
  );
  assert.equal(
    keybindingsPathFrom('/home/me/.config/Code/User/globalStorage/anchor.anchor-explain'),
    '/home/me/.config/Code/User/keybindings.json',
  );
});

test('耦合锁：package.json 的 contributes.keybindings 与 WALKTHROUGH_CHORDS 逐字一致', () => {
  const pkg = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { contributes: { keybindings: { command: string; key: string; mac?: string; when?: string }[] } };

  const declared = pkg.contributes.keybindings;
  assert.equal(declared.length, WALKTHROUGH_CHORDS.length, '键位条数不一致');

  for (const spec of WALKTHROUGH_CHORDS) {
    const found = declared.find((k) => k.command === spec.command);
    assert.ok(found, `package.json 里缺 ${spec.command} 的默认键位`);
    assert.equal(found.key, spec.key, `${spec.command} 的 key 不一致`);
    assert.equal(found.mac, spec.mac, `${spec.command} 的 mac 不一致`);
    assert.equal(found.when, spec.when, `${spec.command} 的 when 不一致`);
  }
});

test('耦合锁：状态栏用的默认键位与 §4.1 冻结值一致', () => {
  // §4.1 的 `默认键` 列：ctrl+shift+a / alt+] / alt+[ / escape / ctrl+alt+w / ctrl+shift+space
  assert.deepEqual(defaultChords(false), {
    capture: 'ctrl+shift+a',
    next: 'alt+]',
    prev: 'alt+[',
    stop: 'escape',
    goto: 'ctrl+alt+w',
    playPause: 'ctrl+shift+space',
  });
});

test('耦合锁：`when` 的语义分工（改错会让某个键变哑）', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    contributes: { keybindings: { command: string; when?: string }[] };
  };
  const whenOf = (command: string) => pkg.contributes.keybindings.find((k) => k.command === command)?.when ?? '';

  // 推进类键绑 walkthroughActive：讲完（done）之后它们必须失效
  for (const command of ['anchorExplain.next', 'anchorExplain.prev', 'anchorExplain.goto', 'anchorExplain.playPause']) {
    assert.ok(
      whenOf(command).includes('anchorExplain.walkthroughActive'),
      `${command} 的 when 应当含 walkthroughActive，实际是 "${whenOf(command)}"`,
    );
  }

  // stop 绑 sessionOpen：done 之后 walkthroughActive 已落 false，
  // 若 stop 也绑在它上面，最后一步的框就再也清不掉了（D46）
  assert.ok(whenOf('anchorExplain.stop').includes('anchorExplain.sessionOpen'), 'stop 的 when 必须含 sessionOpen');
  assert.ok(whenOf('anchorExplain.stop').includes('!inputFocus'), 'stop 不能抢输入框里的 Escape（D11）');
  assert.ok(
    !whenOf('anchorExplain.stop').includes('walkthroughActive'),
    'stop 一旦绑 walkthroughActive，讲完就没人能清框了',
  );

  // capture 只在编辑器有焦点时抢键
  assert.equal(whenOf('anchorExplain.capture'), 'editorTextFocus');
});

test('耦合锁：契约 §4.2 声明的连接器 key 名与这里用的一致', () => {
  const contracts = readFileSync(new URL('../../../docs/CONTRACTS.md', import.meta.url), 'utf8');
  const declaredKeys = [...contracts.matchAll(/`(anchorExplain\.[a-zA-Z]+)`/g)].map((m) => m[1]);
  for (const key of ['anchorExplain.walkthroughActive', 'anchorExplain.sessionOpen']) {
    assert.ok(declaredKeys.includes(key), `CONTRACTS.md 里没有声明 context key ${key}`);
  }
});
