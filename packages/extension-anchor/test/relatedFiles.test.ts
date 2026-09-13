/**
 * 「候选文件清单」的纯逻辑（S9a）。
 *
 * @anchor 这份清单是**模型唯一的线索来源**：跨文件时它最大的障碍不是"不许读"，
 *         而是"不知道该问哪个文件"。所以排序规则要能被钉住 ——
 *         嵌入式里相关的东西，八成就是同目录的、或者它 `#include` 过的。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CANDIDATES, includeNamesIn, orderRelatedFiles } from '../src/relatedFiles.ts';

test('includeNamesIn：双引号与尖括号都认，注释里的也算', () => {
  const text = [
    '#include "ring_buffer.h"',
    '#include <stdint.h>',
    '// #include "被注释掉的.h"',
    '#  include   "spaced.h"',
    'int x = 1;',
  ].join('\n');
  assert.deepEqual(includeNamesIn(text).sort(), ['ring_buffer.h', 'spaced.h', 'stdint.h', '被注释掉的.h'].sort());
});

test('includeNamesIn：没有 include 时给空数组（不是报错）', () => {
  assert.deepEqual(includeNamesIn('int main(void) { return 0; }'), []);
});

test('orderRelatedFiles：**#include 过的排最前**，其次同目录，最后其余', () => {
  // 规则的取舍：`#include` 是**代码自己声明的依赖**，比"它恰好在同一个目录里"这个猜测更强，
  // 所以哪怕它在别的目录，也排在没被 include 的同目录文件前面。
  const ordered = orderRelatedFiles(
    ['Drivers/hal.h', 'ring_buffer.h', 'inc/other.h', 'spi.c'],
    ['inc/other.h'],
  );
  assert.deepEqual(ordered, ['inc/other.h', 'ring_buffer.h', 'spi.c', 'Drivers/hal.h']);
});

test('orderRelatedFiles：没被 include 时，同目录优先于别的目录', () => {
  assert.deepEqual(orderRelatedFiles(['inc/x.h', 'local.c'], []), ['local.c', 'inc/x.h']);
});

test('orderRelatedFiles：去重、按路径稳定排序、封顶', () => {
  const many = Array.from({ length: MAX_CANDIDATES + 10 }, (_, i) => `dir/f${String(i).padStart(2, '0')}.h`);
  const ordered = orderRelatedFiles([...many, 'dir/f00.h'], []);
  assert.equal(ordered.length, MAX_CANDIDATES);
  assert.equal(ordered[0], 'dir/f00.h');
  assert.equal(new Set(ordered).size, ordered.length);
});
