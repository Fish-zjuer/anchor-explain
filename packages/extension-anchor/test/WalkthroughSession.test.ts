/**
 * 会话状态机的单测。**不碰 vscode** —— 这正是不把状态塞进命令回调的收益。
 *
 * 游标是「拍」不是「步」（D48）：一个 step（n 个子高亮）占 n+1 拍。这里上半部分测拍的换算，
 * 下半部分测状态迁移。自动播放的定时器只验"play 之后立刻 pause 不会自己往前跑"，
 * 断言"等 1.6 秒后确实推进了"会让测试变慢且不稳。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnchorError } from '@anchor/core';
import type { ExplanationResult } from '@anchor/core';
import {
  WalkthroughSession,
  beatsPerStep,
  firstBeatOfStep,
  locateBeat,
  totalBeats,
} from '../src/playback/WalkthroughSession.ts';

/** 3 步，子高亮数分别是 2 / 2 / 1 → 拍数 3 / 3 / 2，共 8 拍 */
function makeResult(): ExplanationResult {
  const highlightsPerStep = [2, 2, 1];
  return {
    steps: highlightsPerStep.map((n, i) => ({
      location: { filePath: 'C:\\repo\\main.c', lineStart: 40 + i, lineEnd: 40 + i },
      text: `第 ${i + 1} 步的讲解`,
      title: `步骤 ${i + 1}`,
      highlights: Array.from({ length: n }, (_, k) => ({
        location: { filePath: 'C:\\repo\\main.c', lineStart: 40 + i, lineEnd: 40 + i },
        narration: `点 ${k + 1}`,
        emphasis: 'primary' as const,
      })),
    })),
    summary: '整段讲解',
    confidence: 0.8,
  };
}

test('拍的换算：beatsPerStep / totalBeats / locateBeat / firstBeatOfStep 自洽', () => {
  const steps = makeResult().steps;
  assert.deepEqual(steps.map(beatsPerStep), [3, 3, 2]);
  assert.equal(totalBeats(steps), 8);

  assert.deepEqual(locateBeat(steps, 0), { index: 0, pointIndex: -1 });
  assert.deepEqual(locateBeat(steps, 1), { index: 0, pointIndex: 0 });
  assert.deepEqual(locateBeat(steps, 2), { index: 0, pointIndex: 1 });
  assert.deepEqual(locateBeat(steps, 3), { index: 1, pointIndex: -1 });
  // 第 3 步只有 1 个子高亮 → 它只占 2 拍（第 6、7 拍），第 7 拍是它的第 1 个点
  assert.deepEqual(locateBeat(steps, 6), { index: 2, pointIndex: -1 });
  assert.deepEqual(locateBeat(steps, 7), { index: 2, pointIndex: 0 });
  assert.equal(locateBeat(steps, 8), undefined);
  assert.equal(locateBeat(steps, -1), undefined);

  assert.deepEqual([0, 1, 2].map((i) => firstBeatOfStep(steps, i)), [0, 3, 6]);
  assert.equal(firstBeatOfStep(steps, 99), 6, '越界的步骤下标夹到最后一步');
});

test('初始态：第 0 步、整块那一拍、非 stale', () => {
  const s = new WalkthroughSession(makeResult());
  const snap = s.snapshot;
  assert.equal(snap.state, 'running');
  assert.equal(snap.index, 0);
  assert.equal(snap.pointIndex, -1, '第一拍是"整块"，不是"扫第一个点"');
  assert.equal(snap.point, undefined);
  assert.equal(snap.pointTotal, 2);
  assert.equal(snap.total, 3);
  assert.equal(snap.beat, 1);
  assert.equal(snap.beatTotal, 8);
  assert.equal(snap.atStart, true);
  assert.equal(snap.stale, false);
  assert.equal(s.isActive, true);
});

test('next 先在步内扫点，扫完才进下一步', () => {
  const s = new WalkthroughSession(makeResult());
  const seen: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    s.next();
    const snap = s.snapshot;
    seen.push(`${snap.index}/${snap.pointIndex}`);
  }
  assert.deepEqual(seen, ['0/0', '0/1', '1/-1'], '第 3 拍应当进入第 2 步的整块拍');
});

test('每一步的第一拍 pointIndex = -1，且 point 为 undefined', () => {
  const s = new WalkthroughSession(makeResult());
  for (const stepIndex of [0, 1, 2]) {
    s.goto(stepIndex);
    const snap = s.snapshot;
    assert.equal(snap.index, stepIndex);
    assert.equal(snap.pointIndex, -1, `第 ${stepIndex + 1} 步的第一拍应当是整块`);
    assert.equal(snap.point, undefined);
  }
});

test('扫描中 point 就是当前那个子高亮', () => {
  const s = new WalkthroughSession(makeResult());
  s.goto(1);
  s.next();
  assert.equal(s.snapshot.pointIndex, 0);
  assert.equal(s.snapshot.point?.narration, '点 1');
  s.next();
  assert.equal(s.snapshot.point?.narration, '点 2');
});

test('走到最后一拍：next 落成 done 并返回 false', () => {
  const s = new WalkthroughSession(makeResult());
  for (let i = 0; i < 7; i += 1) s.next();
  assert.equal(s.snapshot.beat, 8);
  assert.equal(s.snapshot.atEnd, true);
  assert.equal(s.snapshot.index, 2);
  assert.equal(s.snapshot.pointIndex, 0);

  assert.equal(s.next(), false);
  assert.equal(s.snapshot.state, 'done');
  assert.equal(s.snapshot.beat, 8, 'done 之后不应越界');
  assert.equal(s.isActive, false);
});

test('prev 一拍一拍往回退；done 之后 prev 会退回 running', () => {
  const s = new WalkthroughSession(makeResult());
  assert.equal(s.prev(), false);
  assert.equal(s.snapshot.beat, 1);

  s.next();
  s.next();
  assert.equal(s.snapshot.pointIndex, 1);
  s.prev();
  assert.equal(s.snapshot.pointIndex, 0, 'prev 退的是"拍"，所以会从第 2 个点回到第 1 个点');

  // 走到最后一拍**不等于** done：`atEnd` 只是"到头了"，落 done 需要再按一次 next（§4.2）。
  // 此刻在 #beat=1，再推 6 次到 #beat=7（最后一拍）
  for (let i = 0; i < 6; i += 1) s.next();
  assert.equal(s.snapshot.atEnd, true);
  assert.equal(s.snapshot.state, 'running');
  assert.equal(s.next(), false);
  assert.equal(s.snapshot.state, 'done');

  assert.equal(s.prev(), true);
  assert.equal(s.snapshot.state, 'running');
  // 最后一拍是"第 3 步的第 1 个点"，往回退一拍就是第 3 步的**整块**那一拍
  assert.equal(s.snapshot.index, 2);
  assert.equal(s.snapshot.pointIndex, -1);
});

test('goto 跳到某一步的第一拍，越界一律忽略', () => {
  const s = new WalkthroughSession(makeResult());
  s.next();
  s.next();
  assert.equal(s.goto(2), true);
  assert.equal(s.snapshot.index, 2);
  assert.equal(s.snapshot.pointIndex, -1);
  assert.equal(s.snapshot.beat, 7);

  for (const bad of [-1, 3, 1.5, Number.NaN]) {
    assert.equal(s.goto(bad), false, `index=${bad}`);
    assert.equal(s.snapshot.index, 2);
  }
});

test('单个 step、无子高亮：一拍就到底', () => {
  const s = new WalkthroughSession({
    steps: [{ location: { filePath: 'a.c', lineStart: 1, lineEnd: 1 }, text: 'x' }],
    summary: 's',
    confidence: 1,
  });
  assert.equal(s.snapshot.atStart, true);
  assert.equal(s.snapshot.atEnd, true);
  assert.equal(s.snapshot.beatTotal, 1);
  assert.equal(s.next(), false);
  assert.equal(s.snapshot.state, 'done');
});

test('没有 step 的结果直接被拒（校验闸门本应拦下，这里是第二道）', () => {
  assert.throws(
    () => new WalkthroughSession({ steps: [], summary: '空', confidence: 1 }),
    (err: unknown) => err instanceof AnchorError && err.code === 'SCHEMA_VIOLATION',
  );
});

test('stop 落到 idle，且 isActive 为 false', () => {
  const s = new WalkthroughSession(makeResult());
  s.stop();
  assert.equal(s.snapshot.state, 'idle');
  assert.equal(s.isActive, false);
});

test('播放 / 暂停：状态迁移正确，暂停后不会自己往前跑', () => {
  const s = new WalkthroughSession(makeResult(), { playIntervalMs: 5 });
  assert.equal(s.togglePlay(), 'playing');
  assert.equal(s.snapshot.state, 'playing');

  // 立刻暂停：定时器还没到点，拍数必须原封不动
  assert.equal(s.togglePlay(), 'paused');
  assert.equal(s.snapshot.beat, 1);

  s.stop();
  assert.equal(s.togglePlay(), 'idle');
});

test('markStale 只通知一次，且此后一直保持', () => {
  const s = new WalkthroughSession(makeResult());
  let calls = 0;
  s.onDidChange((snap) => {
    if (snap.stale) calls += 1;
  });

  s.markStale();
  s.markStale();
  s.markStale();

  assert.equal(calls, 1);
  assert.equal(s.snapshot.stale, true);
});

test('onDidChange 返回的退订函数真的能退订；dispose 之后不再通知', () => {
  const s = new WalkthroughSession(makeResult(), { playIntervalMs: 5 });
  let calls = 0;
  const off = s.onDidChange(() => {
    calls += 1;
  });

  s.next();
  assert.equal(calls, 1);
  off();
  s.next();
  assert.equal(calls, 1);

  s.play();
  const beforeDispose = calls;
  assert.ok(beforeDispose > 0, 'play 本身应当通知一次');
  s.dispose();
  s.next();
  assert.equal(calls, beforeDispose, 'dispose 之后不应再有通知');
});

// ── 追问：往队列中间插一步（D126）─────────────────────────────────────────
//
// 用户的原话："比如这个块，有如下结构：【总结】【1】【2】【3（我在这里追问）】【4】……，
// 那解释完变为【总结】【1】【2】【3】【补充】【4】……"
//
// 这一段锁的是"插入"这件事本身：位置对不对、总数有没有涨、游标跟没跟过去。
// 播放器/状态栏/导出/重放四个面读的都是同一份 steps，所以它们一行都不用改 ——
// 前提正是"插入只改这一个数组"，而这条锁守的就是那个前提。

/** 第 3 个位置之后的补充步骤（位置落在原第 3 步那一行上，形状与真产出一致） */
function supplementStep(): ExplanationResult['steps'][number] {
  return {
    location: { filePath: 'C://repo//main.c', lineStart: 42, lineEnd: 42 },
    text: '补充：这一行之所以先判断再取值，是因为……',
    title: '补充',
    highlights: [],
  };
}

test('D126：insertStepsAfter 把补充插在指定步之后，总数 +1', () => {
  const s = new WalkthroughSession(makeResult());
  assert.equal(s.total, 3, '开头是 3 步');

  assert.equal(s.insertStepsAfter(2, [supplementStep()]), true);

  assert.equal(s.total, 4, '插入之后总共 4 步');
  const steps = s.snapshot.result.steps;
  assert.equal(steps[2]!.title, '步骤 3', '第 3 步还在原来的位置上');
  assert.equal(steps[3]!.title, '补充', '补充插在它后面');
  assert.equal(steps[3]!.text, '补充：这一行之所以先判断再取值，是因为……');
});

test('D126：插在中间不许把后面的步骤顶掉（【3】【补充】【4】，不是【3】【补充】）', () => {
  const s = new WalkthroughSession(makeResult());
  s.insertStepsAfter(0, [supplementStep()]);

  const titles = s.snapshot.result.steps.map((step) => step.title);
  assert.deepEqual(titles, ['步骤 1', '补充', '步骤 2', '步骤 3'], '后两步必须原样跟在后面');
});

test('D126：游标跟着落到**新插入的那一步**上（否则看起来像追问没反应）', () => {
  const s = new WalkthroughSession(makeResult());
  s.goto(0);
  assert.equal(s.snapshot.index, 0);

  s.insertStepsAfter(0, [supplementStep()]);

  assert.equal(s.snapshot.index, 1, '插入之后当前步应当是那一步补充');
  assert.equal(s.snapshot.step.title, '补充');
  assert.equal(s.snapshot.pointIndex, -1, '落在它的第一拍（先铺整块底色）');
});

test('D126：连续追问是同一条规则（第二个补充跟在第一个后面）', () => {
  const s = new WalkthroughSession(makeResult());
  s.insertStepsAfter(0, [supplementStep()]);
  s.insertStepsAfter(1, [{ ...supplementStep(), title: '补充二' }]);

  assert.deepEqual(
    s.snapshot.result.steps.map((step) => step.title),
    ['步骤 1', '补充', '补充二', '步骤 2', '步骤 3'],
  );
});

test('D126：越界下标与空数组都不改队列（外部输入不许把 result 弄坏）', () => {
  const s = new WalkthroughSession(makeResult());

  assert.equal(s.insertStepsAfter(3, [supplementStep()]), false, '下标等于 length 是越界');
  assert.equal(s.insertStepsAfter(-1, [supplementStep()]), false);
  assert.equal(s.insertStepsAfter(1.5, [supplementStep()]), false);
  assert.equal(s.insertStepsAfter(1, []), false, '模型给了空数组 = 这次没有补充，不该悄悄改队列');

  assert.equal(s.total, 3, '以上四种都不该动到 steps');
});

test('D126：讲完之后追问，会话要重新回到 running（不然面板按不动下一步）', () => {
  const s = new WalkthroughSession(makeResult());
  // 推到最后一拍，让它自己落成 done
  while (s.next()) {
    /* 一直推到收尾 */
  }
  assert.equal(s.snapshot.state, 'done');

  s.insertStepsAfter(2, [supplementStep()]);
  assert.equal(s.snapshot.state, 'running', '有了新内容就该能继续往前推');
  assert.equal(s.snapshot.beatTotal, totalBeats(s.snapshot.result.steps), '总拍数要跟上新队列');
});
