/**
 * 「说给用户听的一句话」的格式化。`Anchor: 显示状态` 与开始面板用的是**同一句**，
 * 所以这一句的行为值得单独钉住 —— 它错了，两个地方会一起错。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureSummary } from '../src/describe.ts';
import type { Anchor } from '@anchor/core';

const codeAnchor: Anchor = {
  sourceType: 'code',
  sourceId: 'sha1',
  sourceName: 'main.c',
  location: { filePath: '/repo/test/fixtures/main.c', lineStart: 40, lineEnd: 48 },
};

const pdfAnchor: Anchor = {
  sourceType: 'pdf',
  sourceId: 'pdf-1',
  sourceName: 'sample.pdf',
  location: { page: 23, bbox: [0.1, 0.1, 0.5, 0.2] },
};

test('代码锚点：文件名 + 行区间 + 是选区还是整个文件', () => {
  assert.equal(captureSummary(codeAnchor, 'selection'), 'main.c 第 40-48 行（选区）');
  assert.equal(captureSummary(codeAnchor, 'whole-file'), 'main.c 第 40-48 行（整个文件）');
});

test('单行不加区间（复用 core 的 formatLineRange）', () => {
  const oneLine: Anchor = { ...codeAnchor, location: { filePath: '/repo/main.c', lineStart: 7, lineEnd: 7 } };
  assert.equal(captureSummary(oneLine, 'selection'), 'main.c 第 7 行（选区）');
});

test('PDF 锚点说"第 N 页"（两条线共用同一个位置标签）', () => {
  assert.equal(captureSummary(pdfAnchor, 'selection'), 'sample.pdf 第 23 页（选区）');
});

test('D80 多段锚点：外框之外**再列出那几段**（只说外框等于替用户改写了他选的范围）', () => {
  // location 是并集（10-48），被选中的只有两块 —— 这两件事必须同时看得见，
  // 否则用户看到"第 10-48 行"会以为中间那些他没选的行也被讲了。
  const merged: Anchor = {
    ...codeAnchor,
    location: { filePath: '/repo/test/fixtures/main.c', lineStart: 10, lineEnd: 48 },
    segments: [
      { filePath: '/repo/test/fixtures/main.c', lineStart: 10, lineEnd: 14 },
      { filePath: '/repo/test/fixtures/main.c', lineStart: 40, lineEnd: 48 },
    ],
  };
  assert.equal(
    captureSummary(merged, 'selection'),
    'main.c 第 10-48 行（选区） · 2 段（10-14 + 40-48）',
  );
});

test('D80：只有一段时不重复说"1 段"（那句会变成没信息量的噪声）', () => {
  const single: Anchor = {
    ...codeAnchor,
    segments: [{ filePath: '/repo/test/fixtures/main.c', lineStart: 40, lineEnd: 48 }],
  };
  assert.equal(captureSummary(single, 'selection'), 'main.c 第 40-48 行（选区）');
});

test('D80：多段 + 重点，两件事都带上（它们各自都可以复核）', () => {
  const both: Anchor = {
    ...codeAnchor,
    location: { filePath: '/repo/test/fixtures/main.c', lineStart: 10, lineEnd: 48 },
    segments: [
      { filePath: '/repo/test/fixtures/main.c', lineStart: 10, lineEnd: 14 },
      { filePath: '/repo/test/fixtures/main.c', lineStart: 40, lineEnd: 48 },
    ],
    focus: '只关心空/满的边界判断',
  };
  assert.equal(
    captureSummary(both, 'selection'),
    'main.c 第 10-48 行（选区） · 2 段（10-14 + 40-48） · 重点：只关心空/满的边界判断',
  );
});
