// 替身的单测。除了常规断言，有一条是**耦合锁**：
// FAKE_SELECTION_TEXT 必须与 test/fixtures/main.c 第 40-48 行逐字一致。
// 没有它，改 main.c 会让假选区悄悄对不上，而 S1 的手感评审是在真播放器上做的，未必看得出。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createFakeEditorPort,
  FAKE_FILE_PATH,
  FAKE_LINE_START,
  FAKE_LINE_END,
  FAKE_SELECTION_TEXT,
} from '../src/fakes/fakeEditorPort.ts';
import {
  createFakeProvider,
  fakeProvider,
  FAKE_TARGET_LINE_START,
  FAKE_TARGET_LINE_END,
} from '../src/fakes/fakeProvider.ts';
import { isCodeLocation, type Anchor, type CodeLocation, type ExplanationResult } from '../src/types.ts';

const MAIN_C = fileURLToPath(new URL('../../../test/fixtures/main.c', import.meta.url));

function anchorAt(filePath: string): Anchor {
  return {
    sourceType: 'code',
    sourceId: 'fixture:main.c',
    sourceName: 'main.c',
    location: { filePath, lineStart: FAKE_LINE_START, lineEnd: FAKE_LINE_END },
  };
}

test('fakeEditorPort: 返回写死的 40-48 行', async () => {
  const port = createFakeEditorPort();
  const sel = await port.getSelection();
  assert.ok(sel);
  assert.equal(sel.filePath, FAKE_FILE_PATH);
  assert.equal(sel.lineStart, 40);
  assert.equal(sel.lineEnd, 48);
  assert.equal(FAKE_LINE_START, FAKE_TARGET_LINE_START);
  assert.equal(FAKE_LINE_END, FAKE_TARGET_LINE_END);
});

test('耦合锁: 假选区文本与 main.c 第 40-48 行逐字一致', () => {
  // 按 /\r?\n/ 切分：本机 core.autocrlf=true，靠 .gitattributes 把仓库内文本钉成 LF，
  // 但这里再兜一层，避免换行符差异把这条锁变成假警报（它要抓的是行号漂移）。
  const lines = readFileSync(MAIN_C, 'utf8').split(/\r?\n/);
  // 切片是 1-based 闭区间，数组是 0-based
  const actual = lines.slice(FAKE_LINE_START - 1, FAKE_LINE_END).join('\n');
  assert.equal(
    actual,
    FAKE_SELECTION_TEXT,
    'main.c 第 40-48 行变了。要么改回去，要么同步 fakeEditorPort.ts 的 FAKE_SELECTION_TEXT 与 fakeProvider.ts 的行号。',
  );
});

test('fakeEditorPort: 记录 reveal 与 documentTextHash 的调用', async () => {
  const port = createFakeEditorPort();
  assert.deepEqual(port.revealCalls, []);

  await port.revealLocation({ filePath: 'x.c', lineStart: 41, lineEnd: 41 });
  await port.documentTextHash('x.c');

  assert.deepEqual(port.revealCalls, [{ filePath: 'x.c', lineStart: 41, lineEnd: 41 }]);
  assert.deepEqual(port.hashRequests, ['x.c']);
  assert.equal(await port.documentTextHash('x.c'), 'fake-hash-0000');
});

test('fakeEditorPort: noSelection / noActiveFile 两条提示分支', async () => {
  const noSel = createFakeEditorPort({ noSelection: true });
  assert.equal(await noSel.getSelection(), null);
  assert.equal(await noSel.getActiveFilePath(), FAKE_FILE_PATH);

  const noFile = createFakeEditorPort({ noActiveFile: true });
  assert.equal(await noFile.getActiveFilePath(), null);

  const noHash = createFakeEditorPort({ documentHash: null });
  assert.equal(await noHash.documentTextHash('x.c'), null);
});

test('fakeEditorPort: 可覆盖选区与文件路径（S2 换成真选区时靠它试边界）', async () => {
  const port = createFakeEditorPort({ filePath: 'C:\\tmp\\other.c', lineStart: 1, lineEnd: 3 });
  const sel = await port.getSelection();
  assert.ok(sel);
  assert.equal(sel.filePath, 'C:\\tmp\\other.c');
  assert.equal(sel.lineStart, 1);
  assert.equal(sel.lineEnd, 3);
});

test('fakeProvider: 步骤全部落在 anchor 指向的文件与 40-48 行区间内', async () => {
  const filePath = 'C:\\repo\\test\\fixtures\\main.c';
  const result = await fakeProvider(anchorAt(filePath));

  assert.equal(result.steps.length, 3);
  assert.ok(result.confidence >= 0 && result.confidence <= 1, 'confidence 必须在 0-1');
  assert.ok(result.summary.length > 0);

  for (const [i, step] of result.steps.entries()) {
    assert.ok(isCodeLocation(step.location), `第 ${i} 步的定位应是 CodeLocation`);
    const loc = step.location as CodeLocation;
    assert.equal(loc.filePath, filePath, `第 ${i} 步必须指向 anchor 的文件，否则 decoration 会画到别的文件上`);
    assert.ok(loc.lineStart >= FAKE_TARGET_LINE_START, `第 ${i} 步起点越出选区下界`);
    assert.ok(loc.lineEnd <= FAKE_TARGET_LINE_END, `第 ${i} 步终点越出选区上界`);
    assert.ok(loc.lineStart <= loc.lineEnd, `第 ${i} 步行区间反了`);
    assert.ok(step.text.length > 0, `第 ${i} 步正文不能为空`);
  }
});

test('fakeProvider: 两层 step 模型被真实填满（title / intro / highlights）', async () => {
  const result: ExplanationResult = await fakeProvider(anchorAt('m.c'));
  const emphases = new Set<string>();

  for (const [i, step] of result.steps.entries()) {
    assert.ok(step.title, `第 ${i} 步缺 title`);
    assert.ok(step.intro, `第 ${i} 步缺 intro —— 侧边栏的两层渲染就验不到了`);
    assert.ok(step.highlights && step.highlights.length > 0, `第 ${i} 步缺子高亮`);
    for (const h of step.highlights ?? []) {
      assert.ok(isCodeLocation(h.location), '子高亮也必须是 CodeLocation');
      assert.ok(h.narration.length > 0, '子高亮缺 narration');
      if (h.emphasis) emphases.add(h.emphasis);
    }
  }

  assert.deepEqual(
    [...emphases].sort(),
    ['caveat', 'context', 'definition', 'primary'],
    '四种 emphasis 都要出现，否则 §4.3 的配色分支在 S1 只验到一部分',
  );
});

test('fakeProvider: delayMs 用于验「请求中」态；不传则立即返回', async () => {
  const slow = createFakeProvider({ delayMs: 30 });
  const started = Date.now();
  await slow(anchorAt('m.c'));
  assert.ok(Date.now() - started >= 25, 'delayMs 应真的等待');

  const instant = createFakeProvider();
  const t0 = Date.now();
  await instant(anchorAt('m.c'));
  assert.ok(Date.now() - t0 < 25, '默认不应有等待');
});
