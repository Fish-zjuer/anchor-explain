/**
 * 「候选文件清单」的纯逻辑（S9a）。
 *
 * @anchor 这份清单是**模型唯一的线索来源**：跨文件时它最大的障碍不是"不许读"，
 *         而是"不知道该问哪个文件"。所以排序规则要能被钉住 ——
 *         嵌入式里相关的东西，八成就是同目录的、或者它 `#include` 过的。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCandidatePaths } from '@anchor/core';
import { MAX_CANDIDATES, candidateDisplayName, includeNamesIn, orderRelatedFiles } from '../src/relatedFiles.ts';

// ── D117：清单里的名字怎么写 ────────────────────────────────────────────────

test('candidateDisplayName：三种写法，**基准一律是锚点文件所在目录**', () => {
  const anchorDir = 'C:/fw/Driver/dshot/Src';
  // ① 同目录 → 裸文件名（模型照抄，闸门按锚点目录解析 → 就是它）
  assert.equal(candidateDisplayName(anchorDir, 'C:\\fw\\Driver\\dshot\\Src\\dshot_dma.h'), 'dshot_dma.h');
  // ② 锚点目录更深处 → 下去的相对写法
  assert.equal(candidateDisplayName(anchorDir, 'C:/fw/Driver/dshot/Src/impl/regs.h'), 'impl/regs.h');
  // ③ 别处（兄弟目录、别的模块）→ `..` 写法
  assert.equal(candidateDisplayName(anchorDir, 'C:/fw/Driver/dshot/Inc/dshot_dma.h'), '../Inc/dshot_dma.h');
  assert.equal(candidateDisplayName(anchorDir, 'C:/fw/main.c'), '../../../main.c');
  // 不同盘符表达不出相对写法 → 原样给绝对路径（同样是合法写法）
  assert.equal(candidateDisplayName(anchorDir, 'D:/sdk/hal.h'), 'D:/sdk/hal.h');
});

test('candidateDisplayName：清单里的名字**按构造**能解析回那个文件（D96 那轮 ENOENT 的根因）', () => {
  // 这一条是这次修的核心承诺：名字的基准 = 闸门解析相对路径的基准。
  // 原来"不同目录"那一类写的是工作区相对路径（`Drivers/hal.h`），闸门却按锚点目录解析
  // → `<锚点目录>/Drivers/hal.h`，一个不存在的路径，白烧一轮取件。
  const anchorFile = 'C:/fw/Driver/dshot/Src/dshot_dma.c';
  for (const target of [
    'C:/fw/Driver/dshot/Src/dshot_dma.h',
    'C:/fw/Driver/dshot/Src/impl/regs.h',
    'C:/fw/Driver/dshot/Inc/dshot_dma.h',
    'C:/fw/main.c',
  ]) {
    const name = candidateDisplayName('C:/fw/Driver/dshot/Src', target);
    // 闸门只读 `candidates[0]`（适配器读的就是那一个）—— 所以要看的是"首选候选"
    assert.equal(
      resolveCandidatePaths(name, anchorFile, ['C:/fw'])[0],
      target,
      `${name} 的首选候选应当是 ${target}`,
    );
  }
});

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
