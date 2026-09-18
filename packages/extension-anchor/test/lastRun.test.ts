/**
 * 「上次讲解」存档的读写（D83）。事实源：docs/CONTRACTS.md §4.1.4。
 *
 * @anchor 这个文件守的是一件事：**存下来的东西必须能安全地交回渲染层**。
 *         这份数据跨 VS Code 重启活着，所以它可能是**上一个版本的我们**写的、
 *         也可能被别的东西改坏（用户手改 `workspaceState` 的 JSON）。
 *         读的时候若硬读，最先炸的地方是渲染层（`step.highlights.map(...)`），
 *         而那里离"存档是旧的/坏的"这个真因很远 —— 于是用户看到的是"面板白屏"。
 *
 *         所以每条测例的立场都一样：**读不出来就返回 undefined，绝不抛、绝不半读**。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAST_RUN_KEY, readLastRun, toStoredRun } from '../src/session/lastRun.ts';
import type { LastRun } from '../src/session/lastRun.ts';

const ANCHOR = {
  sourceType: 'code',
  sourceId: 'sha1-deadbeef',
  sourceName: 'main.c',
  location: { filePath: 'C:/work/main.c', lineStart: 40, lineEnd: 48 },
};

function run(patch: Partial<LastRun> = {}): LastRun {
  return {
    anchor: ANCHOR as unknown as LastRun['anchor'],
    savedAt: 1_700_000_000_000,
    result: {
      summary: '这段在把桶位打成 16bit 帧字。',
      confidence: 0.82,
      title: '一帧 DShot 是怎么从油门值变成 GPIO 上的脉冲的',
      steps: [
        {
          location: { filePath: 'C:/work/main.c', lineStart: 40, lineEnd: 42 },
          title: '油门从哪来',
          intro: '先落进 esc 层。',
          text: '油门值先进缓冲区。',
          highlights: [
            {
              location: { filePath: 'C:/work/main.c', lineStart: 41, lineEnd: 41 },
              narration: '先截断到 0.2047。',
              emphasis: 'primary',
            },
          ],
        },
      ],
    },
    ...patch,
  };
}

test('D83：存了再读，逐字回来（重放要的就是"一模一样"）', () => {
  const saved = run();
  const back = readLastRun(toStoredRun(saved));

  assert.ok(back, '自己写的存档必须读得回来');
  assert.equal(back.result.summary, saved.result.summary);
  assert.equal(back.result.title, saved.result.title);
  assert.equal(back.result.confidence, saved.result.confidence);
  assert.equal(back.result.steps.length, 1);
  assert.deepEqual(back.result.steps[0]!.highlights, saved.result.steps[0]!.highlights);
  assert.equal(back.savedAt, saved.savedAt);
  // 锚点也要原样 —— 重放时 `startSession` 靠它决定 `session:update` 要不要给位置标文件名
  assert.deepEqual(back.anchor, saved.anchor);
});

test('D83：版本对不上的存档一律丢掉（宁可说"读不出来"，也不拿旧形状去渲染）', () => {
  const stored = toStoredRun(run()) as Record<string, unknown>;
  assert.equal(readLastRun({ ...stored, version: 0 }), undefined);
  assert.equal(readLastRun({ ...stored, version: '1' }), undefined);
  assert.equal(readLastRun({ ...stored, version: undefined }), undefined);
});

test('D83：非对象 / 空 / 缺字段一律 undefined（不抛）', () => {
  for (const raw of [null, undefined, 7, 'x', [], {}, { version: 1 }]) {
    assert.equal(readLastRun(raw), undefined, JSON.stringify(raw) ?? 'undefined');
  }
});

test('D83：锚点坏掉的存档作废 —— 重放要用它，坏锚点等于重放不出东西', () => {
  const stored = toStoredRun(run()) as Record<string, unknown>;
  // 行区间反了 / 页码为 0 / 来源不认识：三种都属于"这个锚点不合法"
  for (const anchor of [
    { ...ANCHOR, location: { filePath: 'C:/work/main.c', lineStart: 48, lineEnd: 40 } },
    { ...ANCHOR, location: { filePath: 'C:/work/main.c', lineStart: 0, lineEnd: 3 } },
    { ...ANCHOR, sourceType: 'web' },
    null,
  ]) {
    assert.equal(readLastRun({ ...stored, anchor }), undefined, JSON.stringify(anchor));
  }
});

test('D83：**一个 step 都不剩**的存档作废 —— 会话状态机在门口就要求 steps ≥ 1', () => {
  const stored = toStoredRun(run()) as Record<string, unknown>;
  const base = stored.result as Record<string, unknown>;

  assert.equal(readLastRun({ ...stored, result: { ...base, steps: [] } }), undefined);
  // steps 里全是坏元素 → 清完一个不剩 → 同样作废（而不是返回一个"0 步的讲解"）
  assert.equal(
    readLastRun({ ...stored, result: { ...base, steps: [{ title: '没有位置' }, 3, null] } }),
    undefined,
  );
});

test('D83：坏掉**一个子高亮**不许让整份存档作废（丢掉它，其余照常画）', () => {
  const stored = toStoredRun(run()) as Record<string, unknown>;
  const base = stored.result as Record<string, unknown>;
  const steps = base.steps as Record<string, unknown>[];
  const step = steps[0]!;
  const highlights = step.highlights as unknown[];

  const mixed = [
    ...highlights,
    { location: { filePath: 'C:/work/main.c', lineStart: 42, lineEnd: 42 } }, // 少了 narration
    { narration: '只有一句话，没有位置' },
  ];
  const back = readLastRun({
    ...stored,
    result: { ...base, steps: [{ ...step, highlights: mixed }] },
  });

  assert.ok(back, '整份存档必须还在');
  assert.equal(back.result.steps[0]?.highlights?.length, 1, '只留下合法的那一个');
  assert.equal(back.result.steps[0]?.highlights?.[0]?.narration, '先截断到 0.2047。');
});

test('D83：emphasis 非法**不**让存档作废（配色是装饰性字段，渲染层本来就会降级）', () => {
  const stored = toStoredRun(run()) as Record<string, unknown>;
  const base = stored.result as Record<string, unknown>;
  const steps = base.steps as Record<string, unknown>[];
  const step = steps[0]!;
  const highlights = step.highlights as Record<string, unknown>[];

  const back = readLastRun({
    ...stored,
    result: {
      ...base,
      steps: [{ ...step, highlights: [{ ...highlights[0]!, emphasis: '荧光绿' }] }],
    },
  });

  assert.ok(back);
  assert.equal(back.result.steps[0]?.highlights?.length, 1);
});

test('D83：PDF 锚点也存得下（两条线共用这一份存档）', () => {
  const pdf = run({
    anchor: {
      sourceType: 'pdf',
      sourceId: 'sha1-pdf',
      sourceName: 'dshot.pdf',
      location: { filePath: 'C:/work/dshot.pdf', page: 23, bbox: [0.1, 0.1, 0.6, 0.4] },
    } as unknown as LastRun['anchor'],
    result: {
      summary: '这一页在讲帧结构。',
      confidence: 0.5,
      steps: [
        {
          location: { filePath: 'C:/work/dshot.pdf', page: 23, bbox: [0.1, 0.1, 0.6, 0.4] },
          text: '一页。',
        },
      ],
    },
  });

  const back = readLastRun(toStoredRun(pdf));
  assert.ok(back, 'PDF 锚点同样是合法存档');
  assert.equal(back.result.steps.length, 1);
});

test('D83：存档的键名是钉住的 —— 改了它所有人的存档会静默失效', () => {
  // 这条锁很笨，但正是它要防的那种改动：把 key 改成 `anchorExplain.lastRun.v2` 看起来很合理，
  // 后果却是每个用户点「重放上次讲解」都说"还没有讲过任何一段" —— 而我们会以为是别的地方坏了。
  assert.equal(LAST_RUN_KEY, 'anchorExplain.lastRun');
});
