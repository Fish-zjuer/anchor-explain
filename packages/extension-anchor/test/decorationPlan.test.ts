/**
 * 「该画哪些框」的单测。播放器本身依赖 vscode，但**决策**在这一层，所以配色分支可以直测。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WalkthroughStep } from '@anchor/core';
import { EMPHASES, FALLBACK_EMPHASIS, planForStep, primaryLocationOf } from '../src/playback/decorationPlan.ts';

const FILE = 'C:\\repo\\test\\fixtures\\main.c';

function codeStep(): WalkthroughStep {
  return {
    location: { filePath: FILE, lineStart: 40, lineEnd: 42 },
    text: '这一段',
    color: 'primary',
    highlights: [
      { location: { filePath: FILE, lineStart: 40, lineEnd: 40 }, narration: 'a', emphasis: 'context' },
      { location: { filePath: FILE, lineStart: 42, lineEnd: 42 }, narration: 'b', emphasis: 'caveat' },
    ],
  };
}

test('一个步级底色 + 每个子高亮一个框，顺序是先铺底再点重点', () => {
  const specs = planForStep(codeStep());
  assert.equal(specs.length, 3);

  assert.equal(specs[0]!.kind, 'step');
  assert.deepEqual(specs[0]!.location, { filePath: FILE, lineStart: 40, lineEnd: 42 });

  assert.deepEqual(
    specs.slice(1).map((s) => [s.kind, s.emphasis, s.location.lineStart]),
    [
      ['highlight', 'context', 40],
      ['highlight', 'caveat', 42],
    ],
  );
});

test('子高亮缺 emphasis 时回落到默认档，而不是留 undefined', () => {
  const step = codeStep();
  step.highlights = [{ location: { filePath: FILE, lineStart: 41, lineEnd: 41 }, narration: 'a' }];
  assert.equal(planForStep(step)[1]!.emphasis, FALLBACK_EMPHASIS);
});

test('没有 highlights 的 step 只有底色', () => {
  const step = codeStep();
  step.highlights = undefined;
  const specs = planForStep(step);
  assert.equal(specs.length, 1);
  assert.equal(specs[0]!.kind, 'step');
});

test('PDF 位置一个框都不产出（线2 硬约束：PDF 上不出现任何高亮框）', () => {
  const pdfStep: WalkthroughStep = {
    location: { page: 23, bbox: [0.1, 0.1, 0.4, 0.3] },
    text: '这一页在讲什么',
    highlights: [{ location: { page: 23, bbox: [0.1, 0.1, 0.2, 0.2] }, narration: 'x', emphasis: 'primary' }],
  };
  assert.deepEqual(planForStep(pdfStep), []);
  assert.equal(primaryLocationOf(pdfStep), undefined);
});

test('混来源：代码步里夹一个 PDF 子高亮，只画代码那个', () => {
  const step: WalkthroughStep = {
    location: { filePath: FILE, lineStart: 44, lineEnd: 45 },
    text: 'x',
    highlights: [
      { location: { page: 3, bbox: [0.1, 0.1, 0.2, 0.2] }, narration: 'pdf', emphasis: 'primary' },
      { location: { filePath: FILE, lineStart: 45, lineEnd: 45 }, narration: 'code', emphasis: 'definition' },
    ],
  };
  const specs = planForStep(step);
  assert.equal(specs.length, 2);
  assert.equal(specs[1]!.emphasis, 'definition');
});

test('四档 emphasis 都能被原样带出来（S1 必须验到全部分支）', () => {
  const step: WalkthroughStep = {
    location: { filePath: FILE, lineStart: 1, lineEnd: 1 },
    text: 'x',
    highlights: EMPHASES.map((emphasis, i) => ({
      location: { filePath: FILE, lineStart: i + 1, lineEnd: i + 1 },
      narration: emphasis,
      emphasis,
    })),
  };
  assert.deepEqual(
    planForStep(step).slice(1).map((s) => s.emphasis),
    [...EMPHASES],
  );
});
