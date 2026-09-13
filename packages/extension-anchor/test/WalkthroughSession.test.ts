/**
 * 会话状态机的单测。**不碰 vscode** —— 这正是不把状态塞进命令回调的收益。
 *
 * 自动播放的定时器不在这里验：断言"等 2.6 秒后确实推进了"会让测试变慢且不稳。
 * 这里只验状态迁移，定时器只验"play 之后立刻 pause 不会自己往前跑"。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnchorError } from '@anchor/core';
import type { ExplanationResult } from '@anchor/core';
import { WalkthroughSession } from '../src/playback/WalkthroughSession.ts';

function makeResult(count = 3): ExplanationResult {
  return {
    steps: Array.from({ length: count }, (_, i) => ({
      location: { filePath: 'C:\\repo\\main.c', lineStart: 40 + i, lineEnd: 40 + i },
      text: `第 ${i + 1} 步的讲解`,
      title: `步骤 ${i + 1}`,
    })),
    summary: '整段讲解',
    confidence: 0.8,
  };
}

test('初始态：running、第 0 步、非 stale', () => {
  const s = new WalkthroughSession(makeResult());
  const snap = s.snapshot;
  assert.equal(snap.state, 'running');
  assert.equal(snap.index, 0);
  assert.equal(snap.total, 3);
  assert.equal(snap.stale, false);
  assert.equal(snap.atStart, true);
  assert.equal(snap.atEnd, false);
  assert.equal(s.isActive, true);
});

test('next 推进；最后一步 next 落成 done 并返回 false', () => {
  const s = new WalkthroughSession(makeResult());
  assert.equal(s.next(), true);
  assert.equal(s.snapshot.index, 1);
  assert.equal(s.next(), true);
  assert.equal(s.snapshot.index, 2);
  assert.equal(s.snapshot.atEnd, true);

  assert.equal(s.next(), false);
  assert.equal(s.snapshot.state, 'done');
  assert.equal(s.snapshot.index, 2, 'done 之后不应越界');
  assert.equal(s.isActive, false);
});

test('prev 到底就停住；done 之后 prev 会退回 running', () => {
  const s = new WalkthroughSession(makeResult());
  assert.equal(s.prev(), false);
  assert.equal(s.snapshot.index, 0);

  s.next();
  s.next();
  s.next();
  assert.equal(s.snapshot.state, 'done');

  assert.equal(s.prev(), true);
  assert.equal(s.snapshot.state, 'running');
  assert.equal(s.isActive, true);
});

test('goto 只接受合法下标，越界一律忽略', () => {
  const s = new WalkthroughSession(makeResult());
  assert.equal(s.goto(2), true);
  assert.equal(s.snapshot.index, 2);

  for (const bad of [-1, 3, 1.5, Number.NaN]) {
    assert.equal(s.goto(bad), false, `index=${bad}`);
    assert.equal(s.snapshot.index, 2);
  }
});

test('单个 step 时 next 立刻收尾', () => {
  const s = new WalkthroughSession(makeResult(1));
  assert.equal(s.snapshot.atStart, true);
  assert.equal(s.snapshot.atEnd, true);
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

  // 立刻暂停：定时器还没到点，index 必须原封不动
  assert.equal(s.togglePlay(), 'paused');
  assert.equal(s.snapshot.index, 0);

  // done 之后 play 不再生效
  s.stop();
  assert.equal(s.togglePlay(), 'idle');
  assert.equal(s.snapshot.state, 'idle');
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

test('onDidChange 返回的退订函数真的能退订', () => {
  const s = new WalkthroughSession(makeResult());
  let calls = 0;
  const off = s.onDidChange(() => {
    calls += 1;
  });

  s.next();
  assert.equal(calls, 1);
  off();
  s.next();
  assert.equal(calls, 1);
});

test('dispose 之后不再通知（定时器也清掉）', () => {
  const s = new WalkthroughSession(makeResult(), { playIntervalMs: 5 });
  let calls = 0;
  s.onDidChange(() => {
    calls += 1;
  });

  s.play();
  const beforeDispose = calls;
  assert.ok(beforeDispose > 0, 'play 本身应当通知一次');

  s.dispose();
  s.next();
  assert.equal(calls, beforeDispose, 'dispose 之后不应再有通知');
});
