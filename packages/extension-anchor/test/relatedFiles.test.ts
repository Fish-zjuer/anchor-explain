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
import {
  MAX_CANDIDATES,
  buildCandidateFiles,
  candidateDisplayName,
  describeCandidates,
  findCandidate,
  includeNamesIn,
  orderRelatedFiles,
} from '../src/relatedFiles.ts';

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

// ─────────────────────────────────────────────────────────────
// S9a-fix10（D119）+ S9a-fix12（D124）：清单 = 可取范围，**只给名字**（假名已去掉）
// ─────────────────────────────────────────────────────────────

test('orderRelatedFiles：limit 可配（S9a-fix10 起它由设置 `maxCandidateFiles` 给）', () => {
  const pool = ['dir/a.h', 'dir/b.h', 'dir/c.h'];
  assert.deepEqual(orderRelatedFiles(pool, [], 2), ['dir/a.h', 'dir/b.h']);
  // 非法值（0 / 负数 / NaN）回落默认上限 —— 一个写坏的设置不该让清单变成空的
  assert.equal(orderRelatedFiles(pool, [], 0).length, pool.length);
  assert.equal(orderRelatedFiles(pool, [], Number.NaN).length, pool.length);
});

test('buildCandidateFiles：**只留本次允许的根里**的文件（清单与闸门同一判据）', () => {
  const files = [
    'C:/repo/Core/Inc/main.h',
    'C:/repo/Core/Src/main.c',
    'C:/repo/Drivers/hal.h', // 在根之外（这次只许 Core）
    'D:/elsewhere/x.h', // 别的盘，更在根之外
  ];
  const list = buildCandidateFiles({
    files,
    anchorFile: 'C:/repo/Core/Src/main.c',
    workspaceRoot: 'C:/repo',
    roots: ['C:/repo/Core'],
    includeNames: ['main.h'],
    limit: 40,
  });
  const paths = list.map((c) => c.path);
  assert.deepEqual(paths, ['C:/repo/Core/Inc/main.h'], '根之外的一律不进清单');
  // 锚点自己也不进（它不用取件）
  assert.ok(!paths.includes('C:/repo/Core/Src/main.c'));
});

test('buildCandidateFiles：roots 为空 = 清单为空（`off` 档的语义）', () => {
  const list = buildCandidateFiles({
    files: ['C:/repo/a.h'],
    anchorFile: 'C:/repo/main.c',
    workspaceRoot: 'C:/repo',
    roots: [],
    includeNames: [],
    limit: 40,
  });
  assert.deepEqual(list, []);
});

test('buildCandidateFiles：密钥/依赖/构建产物**根本不进清单**（不然就是"列了却取不到"）', () => {
  const list = buildCandidateFiles({
    files: [
      'C:/repo/.env',
      'C:/repo/node_modules/x/index.js',
      'C:/repo/build/gen.h',
      'C:/repo/keys/id_rsa',
      'C:/repo/a.h',
    ],
    anchorFile: 'C:/repo/main.c',
    workspaceRoot: 'C:/repo',
    roots: ['C:/repo'],
    includeNames: [],
    limit: 40,
  });
  assert.deepEqual(list.map((c) => c.path), ['C:/repo/a.h']);
});

test('buildCandidateFiles：标签优先"相对工作区根"（它就是模型要照抄的那串）', () => {
  const list = buildCandidateFiles({
    files: ['C:/repo/App/Inc/esc.h', 'C:/repo/Core/Src/main.c'],
    anchorFile: 'C:/repo/Core/Src/main.c',
    workspaceRoot: 'C:/repo',
    roots: ['C:/repo'],
    includeNames: [],
    limit: 40,
  });
  assert.deepEqual(
    list.map((c) => c.label),
    ['App/Inc/esc.h'],
    '标签是可读的唯一写法（相对工作区根）—— 它就是模型要照抄的那串',
  );
});

test('buildCandidateFiles：锚点不在工作区里时，标签退化成"相对锚点目录"的写法', () => {
  const list = buildCandidateFiles({
    files: ['C:/fw/Driver/dshot/Inc/dshot_dma.h'],
    anchorFile: 'C:/fw/Driver/dshot/Src/dshot_dma.c',
    workspaceRoot: 'C:/other-project', // 工作区跟锚点毫无关系
    roots: ['C:/fw/Driver/dshot'],
    includeNames: [],
    limit: 40,
  });
  assert.equal(list[0]?.label, '../Inc/dshot_dma.h', '这种写法仍按锚点目录解析，`findCandidate` 与闸门都认');
});

test('findCandidate：名字照抄是正路；写短了（唯一后缀）也认；多义就让它抄完整', () => {
  const list = buildCandidateFiles({
    files: ['C:/repo/App/Inc/esc.h', 'C:/repo/Driver/transport/Inc/transport.h'],
    anchorFile: 'C:/repo/Core/Src/main.c',
    workspaceRoot: 'C:/repo',
    roots: ['C:/repo'],
    includeNames: [],
    limit: 40,
  });
  const at = (written: string) => findCandidate(list, written);

  assert.deepEqual(at('App/Inc/esc.h'), { entry: list[0] }, '照抄清单里那一行 —— 这是正路');
  assert.deepEqual(at('app/inc/ESC.H'), { entry: list[0] }, '大小写不敏感');
  assert.deepEqual(at('Inc/esc.h'), { entry: list[0] }, '唯一后缀命中就认（写短了不算白烧一轮）');
  assert.equal(at('C:/repo/App/Inc/esc.h'), undefined, '绝对路径不在这个函数的职责里（闸门另有一路解析）');
  assert.equal(at('f1'), undefined, 'D124：没有假名了 —— 写 f1 不算命中');
  assert.equal(at('nope.h'), undefined);
});

test('findCandidate：后缀命中多条时返回 ambiguous（把选择权还给模型）', () => {
  const list = buildCandidateFiles({
    files: ['C:/repo/A/Inc/uart.h', 'C:/repo/B/Inc/uart.h'],
    anchorFile: 'C:/repo/main.c',
    workspaceRoot: 'C:/repo',
    roots: ['C:/repo'],
    includeNames: [],
    limit: 40,
  });
  const hit = findCandidate(list, 'uart.h');
  assert.ok(hit !== undefined && 'ambiguous' in hit, '两条都以 uart.h 结尾，不该替它挑一个');
  assert.equal(hit !== undefined && 'ambiguous' in hit ? hit.ambiguous.length : 0, 2);
  // 写全标签就唯一了
  assert.deepEqual(findCandidate(list, 'A/Inc/uart.h'), { entry: list[0] });
});

test('describeCandidates：一行一个名字，模型照抄它（D124 起没有假名那一列）', () => {
  const lines = describeCandidates([
    { path: 'C:/repo/a.h', label: 'a.h' },
    { path: 'C:/repo/b.h', label: 'sub/b.h' },
  ]);
  assert.deepEqual(lines, ['- a.h', '- sub/b.h']);
});
