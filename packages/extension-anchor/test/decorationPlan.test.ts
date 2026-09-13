/**
 * 「这一拍该画哪些框」的单测。播放器本身依赖 vscode，但**决策**在这一层，所以可以直测。
 *
 * 重点锁住两件事（都是用户看过第一版之后提的）：
 *   - 块级底色在每一拍**都在**（浅色荧光包住整个块）
 *   - 一次只点亮**一个**子高亮（"隔行乱变颜色"就是这么来的）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WalkthroughStep } from '@anchor/core';
import { EMPHASES, FALLBACK_EMPHASIS, planForBeat, primaryLocationOf } from '../src/playback/decorationPlan.ts';

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

test('整块那一拍：只有块级底色，一个子高亮都不亮', () => {
  const specs = planForBeat(codeStep(), -1);
  assert.equal(specs.length, 1);
  assert.equal(specs[0]!.kind, 'step');
  assert.deepEqual(specs[0]!.location, { filePath: FILE, lineStart: 40, lineEnd: 42 });
});

test('扫描第 1 个点：块级底色 + 恰好一个子高亮（不是两个）', () => {
  const specs = planForBeat(codeStep(), 0);
  assert.equal(specs.length, 2, '块 + 一个点，多一个都会导致"隔行变颜色"');
  assert.equal(specs[0]!.kind, 'step');
  assert.equal(specs[1]!.kind, 'highlight');
  assert.equal(specs[1]!.emphasis, 'context');
  assert.equal(specs[1]!.location.lineStart, 40);
});

test('扫描第 2 个点：仍然只有块 + 那一个点', () => {
  const specs = planForBeat(codeStep(), 1);
  assert.equal(specs.length, 2);
  assert.equal(specs[1]!.emphasis, 'caveat');
  assert.equal(specs[1]!.location.lineStart, 42);
});

test('块级底色在每一拍都是同一个范围（这就是"统一"的含义）', () => {
  const ranges = [-1, 0, 1].map((p) => JSON.stringify(planForBeat(codeStep(), p)[0]!.location));
  assert.equal(new Set(ranges).size, 1, `块级范围在各拍之间变了：${ranges.join(' / ')}`);
});

test('越界的扫描位置：退化成"只有整块"，不抛错', () => {
  for (const pointIndex of [2, 99, 1.5]) {
    const specs = planForBeat(codeStep(), pointIndex);
    assert.equal(specs.length, 1, `pointIndex=${pointIndex}`);
    assert.equal(specs[0]!.kind, 'step');
  }
});

test('没有 highlights 的 step：每一拍都只有整块', () => {
  const step = codeStep();
  step.highlights = undefined;
  for (const pointIndex of [-1, 0, 1]) {
    assert.equal(planForBeat(step, pointIndex).length, 1);
  }
});

test('子高亮缺 emphasis 时回落到默认档，而不是留 undefined', () => {
  const step = codeStep();
  step.highlights = [{ location: { filePath: FILE, lineStart: 41, lineEnd: 41 }, narration: 'a' }];
  assert.equal(planForBeat(step, 0)[1]!.emphasis, FALLBACK_EMPHASIS);
});

test('PDF 位置一个框都不产出（线2 硬约束：PDF 上不出现任何高亮框）', () => {
  const pdfStep: WalkthroughStep = {
    location: { page: 23, bbox: [0.1, 0.1, 0.4, 0.3] },
    text: '这一页在讲什么',
    highlights: [{ location: { page: 23, bbox: [0.1, 0.1, 0.2, 0.2] }, narration: 'x', emphasis: 'primary' }],
  };
  assert.deepEqual(planForBeat(pdfStep, -1), []);
  assert.deepEqual(planForBeat(pdfStep, 0), []);
  assert.equal(primaryLocationOf(pdfStep), undefined);
});

test('混来源：代码步里夹一个 PDF 子高亮，扫到它时不产出框，但块级底色还在', () => {
  const step: WalkthroughStep = {
    location: { filePath: FILE, lineStart: 44, lineEnd: 45 },
    text: 'x',
    highlights: [
      { location: { page: 3, bbox: [0.1, 0.1, 0.2, 0.2] }, narration: 'pdf', emphasis: 'primary' },
      { location: { filePath: FILE, lineStart: 45, lineEnd: 45 }, narration: 'code', emphasis: 'definition' },
    ],
  };
  assert.equal(planForBeat(step, 0).length, 1, '扫到 PDF 点时只剩块级底色');
  assert.equal(planForBeat(step, 1).length, 2);
  assert.equal(planForBeat(step, 1)[1]!.emphasis, 'definition');
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
    EMPHASES.map((_, i) => planForBeat(step, i)[1]!.emphasis),
    [...EMPHASES],
  );
});

// ── 约束 1 的结构性保证（S6） ──────────────────────────────────────────────

/** 一个 PDF 步骤：`location` 里没有 filePath/lineStart，只有 page/bbox */
function pdfStep(): WalkthroughStep {
  return {
    location: { page: 23, bbox: [0.1, 0.1, 0.5, 0.5] },
    text: 'PDF 上的一段',
    color: 'primary',
    highlights: [
      { location: { page: 23, bbox: [0.1, 0.1, 0.2, 0.2] }, narration: 'a', emphasis: 'context' },
    ],
  };
}

test('PDF 步骤：**一拍都不画**（"PDF 上不出现任何高亮框"的结构性保证）', () => {
  // 这一条不靠调用方自觉：decorationPlan 把非 CodeLocation 全部过滤掉。
  // 线2 的框选位置只用来"滚到那一页"，从来不该变成编辑器里的框。
  for (let beat = -1; beat <= 4; beat += 1) {
    assert.deepEqual(planForBeat(pdfStep(), beat), [], `第 ${beat} 拍不该有任何 decoration`);
  }
  assert.equal(primaryLocationOf(pdfStep()), undefined, 'PDF 步骤拿不到"主位置"，所以走不到播放器');
});

test('混着一个 PDF 步骤时：只有代码步骤被画', () => {
  // 校验闸门允许 steps 里有别的来源吗？不允许（§3.3 要求与锚点同源）。
  // 但"结构上画不出来"这件事必须由这一层保证，而不是靠上游不传进来。
  assert.ok(planForBeat(codeStep(), -1).length > 0);
  assert.deepEqual(planForBeat({ ...pdfStep(), location: { url: 'https://x', selector: '#a', scrollY: 0 } }, 0), []);
});
