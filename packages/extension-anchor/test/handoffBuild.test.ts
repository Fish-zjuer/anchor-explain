/**
 * 位置清单 → 临时文档的编排（S14 / D130）。
 *
 * 这里钉住的是"**部分成功**"这条语义：一个文件读不到，不该让其余几段也作废；
 * 但少了什么必须**说出来**（用户会以为外部 Agent 漏改了，方向就错了）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHandoff, HandoffError } from '../src/external/handoffBuild.ts';

const MAIN_C = [
  '#include "dshot.h"', // 1
  '', // 2
  'void dshot_send(uint16_t value) {', // 3
  '  if (value > 2047) {', // 4
  '    value = 2047;', // 5
  '  }', // 6
  '  DMA_Send(value);', // 7
  '}', // 8
].join('\n');

const UTIL_H = ['#pragma once', '', 'int util_one(void);', 'int util_two(void);'].join('\n');

/** 一个确定性的假文件系统：路径 → 内容；不在表里就是读不到。 */
function fakeDeps(files: Record<string, string>) {
  return {
    async readText(path: string): Promise<string> {
      const hit = files[path];
      if (hit === undefined) throw new Error(`ENOENT: ${path}`);
      return hit;
    },
    resolvePath: (raw: string) => raw,
  };
}

test('单文件单段：扩到函数 → 文档里有段首标注与正文', async () => {
  const r = await buildHandoff(
    '{"filePath": "main.c", "lineStart": 5, "lineEnd": 5}',
    fakeDeps({ 'main.c': MAIN_C }),
  );
  assert.equal(r.segmentCount, 1);
  assert.equal(r.unexpandedCount, 0);
  // 第 5 行扩到整个函数（3-8）
  assert.match(r.doc.lines[0]!, /main\.c  第 3-8 行/);
  assert.ok(r.doc.lines.includes('  DMA_Send(value);'));
});

test('同一文件的多段只读一次（缓存）', async () => {
  let reads = 0;
  const deps = {
    async readText(path: string): Promise<string> {
      reads++;
      return MAIN_C;
    },
    resolvePath: (raw: string) => raw,
  };
  await buildHandoff(
    ['{"filePath": "main.c", "lineStart": 4, "lineEnd": 4}', '{"filePath": "main.c", "lineStart": 7, "lineEnd": 7}'].join('\n'),
    deps,
  );
  assert.equal(reads, 1, '同一个文件不该读两次');
});

test('读不到的文件进 missing，其余照常出（部分成功）', async () => {
  const r = await buildHandoff(
    [
      '{"filePath": "main.c", "lineStart": 5, "lineEnd": 5}',
      '{"filePath": "nope.h", "lineStart": 1, "lineEnd": 2}',
    ].join('\n'),
    fakeDeps({ 'main.c': MAIN_C }),
  );
  assert.equal(r.segmentCount, 1);
  assert.equal(r.missing.length, 1);
  assert.equal(r.missing[0]!.filePath, 'nope.h');
});

test('扩不到函数边界的段会被数出来（回执要用）', async () => {
  const r = await buildHandoff(
    '{"filePath": "util.h", "lineStart": 1, "lineEnd": 1}',
    fakeDeps({ 'util.h': UTIL_H }),
  );
  assert.equal(r.unexpandedCount, 1);
  assert.match(r.doc.lines[0]!, /未能扩到函数边界/);
});

test('认不出的行会进 rejected，且不影响认得出的那些', async () => {
  const r = await buildHandoff(
    ['{"filePath": "main.c", "lineStart": 5, "lineEnd": 5}', '随便一句话'].join('\n'),
    fakeDeps({ 'main.c': MAIN_C }),
  );
  assert.equal(r.segmentCount, 1);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0]!.line, 2);
});

test('一段都认不出 → 抛 HandoffError，并给一句人话', async () => {
  await assert.rejects(
    () => buildHandoff('这句话里没有任何位置', fakeDeps({})),
    (err: unknown) => {
      assert.ok(err instanceof HandoffError);
      assert.match(err.message, /没能从里面认出任何位置/);
      return true;
    },
  );
});

test('空输入 → 抛 HandoffError，说"里面没有任何位置"', async () => {
  await assert.rejects(
    () => buildHandoff('', fakeDeps({})),
    (err: unknown) => {
      assert.ok(err instanceof HandoffError);
      assert.match(err.message, /没有任何位置/);
      return true;
    },
  );
});

test('全部文件都读不到 → 抛 HandoffError，并点名第一个', async () => {
  await assert.rejects(
    () => buildHandoff('{"filePath": "gone.c", "lineStart": 1, "lineEnd": 2}', fakeDeps({})),
    (err: unknown) => {
      assert.ok(err instanceof HandoffError);
      assert.match(err.message, /gone\.c/);
      return true;
    },
  );
});

test('超长输入 → 明确说数字，不静默截断', async () => {
  const huge = 'x'.repeat(70 * 1024);
  await assert.rejects(
    () => buildHandoff(huge, fakeDeps({})),
    (err: unknown) => {
      assert.ok(err instanceof HandoffError);
      assert.match(err.message, /太长/);
      assert.match(err.message, /上限 64KB/);
      return true;
    },
  );
});

test('resolvePath 被真的用上（相对路径要先解析）', async () => {
  const seen: string[] = [];
  await buildHandoff('{"filePath": "src/main.c", "lineStart": 5, "lineEnd": 5}', {
    async readText(path: string): Promise<string> {
      seen.push(path);
      return MAIN_C;
    },
    resolvePath: (raw: string) => `/repo/${raw}`,
  });
  assert.deepEqual(seen, ['/repo/src/main.c']);
});
