import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatLineRange, locationLabel } from '../src/locationLabel.ts';
import type { CodeLocation, PDFLocation, WebLocation } from '../src/types.ts';

const code = (lineStart: number, lineEnd: number): CodeLocation => ({
  filePath: '/ws/main.c',
  lineStart,
  lineEnd,
});

const pdf = (page: number): PDFLocation => ({
  page,
  bbox: [0.1, 0.2, 0.3, 0.4],
});

test('formatLineRange: 单行不加区间', () => {
  assert.equal(formatLineRange(40, 40), '第 40 行');
});

test('formatLineRange: 多行给区间', () => {
  assert.equal(formatLineRange(40, 48), '第 40-48 行');
  assert.equal(formatLineRange(40, 41), '第 40-41 行');
});

test('locationLabel: code 来源（两种形态）', () => {
  assert.equal(locationLabel(code(40, 48)), '第 40-48 行');
  assert.equal(locationLabel(code(23, 23)), '第 23 行');
});

test('locationLabel: pdf 来源', () => {
  assert.equal(locationLabel(pdf(23)), '第 23 页');
  assert.equal(locationLabel(pdf(1)), '第 1 页');
});

test('locationLabel: web 来源不崩且带主机名（本次不接入，仅兜底）', () => {
  const web: WebLocation = {
    url: 'https://example.com/docs/intro',
    selector: '#main > p:nth-child(2)',
    scrollY: 320,
  };
  const label = locationLabel(web);
  assert.match(label, /example\.com/);
  assert.ok(label.length <= 40);
});

test('locationLabel: 非法 URL 兜底不打崩', () => {
  const web: WebLocation = { url: 'not a url', selector: 'p', scrollY: 0 };
  assert.equal(locationLabel(web), 'not a url p');
});
