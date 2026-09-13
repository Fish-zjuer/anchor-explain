import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isCodeLocation,
  isPDFLocation,
  isWebLocation,
} from '../src/types.ts';
import type { CodeLocation, PDFLocation, WebLocation } from '../src/types.ts';

const code: CodeLocation = { filePath: '/ws/main.c', lineStart: 40, lineEnd: 48 };
const pdf: PDFLocation = { page: 23, bbox: [0.1, 0.2, 0.3, 0.4] };
const web: WebLocation = { url: 'https://x.test', selector: '#a', scrollY: 0 };

test('守卫能互相区分（union 判别的正确性直接决定下游渲染安全）', () => {
  assert.equal(isCodeLocation(code), true);
  assert.equal(isCodeLocation(pdf), false);
  assert.equal(isCodeLocation(web), false);

  assert.equal(isPDFLocation(pdf), true);
  assert.equal(isPDFLocation(code), false);
  assert.equal(isPDFLocation(web), false);

  assert.equal(isWebLocation(web), true);
  assert.equal(isWebLocation(code), false);
  assert.equal(isWebLocation(pdf), false);
});

test('bbox 长度不是 4 时 isPDFLocation 判否（防止下游解构越界）', () => {
  const bad = { page: 1, bbox: [0, 0, 1] } as unknown as PDFLocation;
  assert.equal(isPDFLocation(bad), false);
});
