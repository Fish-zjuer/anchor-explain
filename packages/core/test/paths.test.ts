/**
 * 路径与行数。事实源见 `CONTRACTS` §9.1 与 D20/D29 的立场。
 *
 * @anchor 这个文件以前**没有单测**（四年的"同一个文件"判断全靠间接覆盖），S9a 加跨文件取件时补上：
 *         接下来"这条路径在不在允许范围内"要直接决定**模型能不能读到那个文件**，
 *         靠间接覆盖不够。立场有两条，两个平台都必须一致：
 *           1. **两种斜杠等价、大小写不敏感**（Windows 上严格比较会把同一个文件判成两个）
 *           2. **不用 `node:path`**（平台相关），所以这些函数在任何平台上给出同一个结果
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  basenameOf,
  countTextLines,
  dirnameOf,
  isAbsolutePath,
  isInsidePath,
  joinPath,
  normPath,
  relativePathFrom,
  resolveCandidatePaths,
  resolveUnrestrictedPaths,
  samePath,
} from '../src/paths.ts';

test('normPath：两种斜杠等价、去末尾斜杠、大小写不敏感', () => {
  assert.equal(normPath('C:\\Repo\\Main.c'), 'c:/repo/main.c');
  assert.equal(normPath('/a/b///'), '/a/b');
  assert.equal(normPath('a/b'), 'a/b');
});

test('samePath：同一个文件的四种写法都判等（这条错了高亮会跑到别的标签页）', () => {
  assert.equal(samePath('C:\\repo\\main.c', 'c:/repo/main.c'), true);
  assert.equal(samePath('C:/repo/main.c/', 'C:/repo/main.c'), true);
  assert.equal(samePath('C:/repo/main.c', 'C:/repo/other.c'), false);
});

test('basenameOf：两种斜杠都当分隔符（不按平台变行为）', () => {
  assert.equal(basenameOf('C:\\repo\\src\\main.c'), 'main.c');
  assert.equal(basenameOf('/repo/main.c'), 'main.c');
  assert.equal(basenameOf('main.c'), 'main.c');
});

test('countTextLines：末尾换行不算一行（否则最后一行会平白多出来）', () => {
  assert.equal(countTextLines(''), 0);
  assert.equal(countTextLines('a'), 1);
  assert.equal(countTextLines('a\n'), 1);
  assert.equal(countTextLines('a\nb'), 2);
  assert.equal(countTextLines('a\r\nb\r\n'), 2);
});

test('isAbsolutePath：盘符 / UNC / POSIX 根，三种都算绝对', () => {
  for (const yes of ['C:/x', 'c:\\x', '\\\\server\\share', '/x']) {
    assert.equal(isAbsolutePath(yes), true, yes);
  }
  for (const no of ['a/b.c', './a', '../a', '']) {
    assert.equal(isAbsolutePath(no), false, no);
  }
});

test('dirnameOf：保留盘符与根，不再往上切', () => {
  assert.equal(dirnameOf('C:/proj/src/main.c'), 'C:/proj/src');
  assert.equal(dirnameOf('C:\\proj\\src\\main.c'), 'C:/proj/src');
  assert.equal(dirnameOf('/a/b.c'), '/a');
  assert.equal(dirnameOf('/a'), '/');
  assert.equal(dirnameOf('a.c'), '');
});

test('joinPath：处理 . 与 ..；走到根以外就停在根上', () => {
  assert.equal(joinPath('C:/proj/src', '../inc/rb.h'), 'C:/proj/inc/rb.h');
  assert.equal(joinPath('C:/proj/src', './rb.h'), 'C:/proj/src/rb.h');
  assert.equal(joinPath('C:/proj/src', 'sub/./x/y.h'), 'C:/proj/src/sub/x/y.h');
  assert.equal(joinPath('/a', '../../x'), '/x', '越过根之后停在根');
  assert.equal(joinPath('', '/a/b'), '/a/b');
});

test('isInsidePath：归一化后按段比较（大小写与斜杠都不影响结论）', () => {
  assert.equal(isInsidePath('C:/proj', 'c:/proj/src/main.c'), true);
  assert.equal(isInsidePath('C:/proj', 'C:/proj'), true);
  assert.equal(isInsidePath('C:/proj', 'C:/proj-other/main.c'), false, '前缀相同但不是子目录');
  assert.equal(isInsidePath('C:/proj', 'C:/other/main.c'), false);
  assert.equal(isInsidePath('', 'C:/proj/main.c'), false, 'root 为空时一律不认');
});

test('resolveCandidatePaths：相对路径**先按锚点文件所在目录**，再按各个 root', () => {
  const anchor = 'C:/proj/src/main.c';
  assert.deepEqual(resolveCandidatePaths('ring_buffer.h', anchor, ['C:/proj']), [
    'C:/proj/src/ring_buffer.h',
    'C:/proj/ring_buffer.h',
  ]);
  assert.deepEqual(resolveCandidatePaths('../inc/rb.h', anchor, ['C:/proj']), [
    'C:/proj/inc/rb.h',
  ]);
});

test('resolveCandidatePaths：绝对路径归一到允许范围内，空串给空数组', () => {
  assert.deepEqual(resolveCandidatePaths('C:/proj/inc/rb.h', 'C:/proj/src/main.c', ['C:/proj']), [
    'C:/proj/inc/rb.h',
  ]);
  assert.deepEqual(resolveCandidatePaths('  ', 'C:/proj/src/main.c', ['C:/proj']), []);
});

test('resolveCandidatePaths：**落在 root 之外的候选一律丢掉**（闸门批的就是适配器读的）', () => {
  // `../inc/rb.h` 按工作区根拼出来是 `C:/inc/rb.h`，在工作区外 —— 不许留在候选里
  assert.deepEqual(resolveCandidatePaths('../inc/rb.h', 'C:/proj/src/main.c', ['C:/proj']), [
    'C:/proj/inc/rb.h',
  ]);
  // 绝对路径指向工作区外：直接没有候选（= 这次取件不成立）
  assert.deepEqual(resolveCandidatePaths('/etc/passwd', 'C:/proj/src/main.c', ['C:/proj']), []);
  assert.deepEqual(resolveCandidatePaths('C:/other/x.h', 'C:/proj/src/main.c', ['C:/proj']), []);
});

test('resolveCandidatePaths：roots 为空 = 跨文件关闭（锚点目录下那个也不算数）', () => {
  assert.deepEqual(resolveCandidatePaths('rb.h', 'C:/proj/src/main.c', []), []);
});

test('resolveUnrestrictedPaths：`any` 档的展开 —— 同一个写法，但**不过滤根**（D117）', () => {
  const anchor = 'C:/fw/Driver/dshot/Src/dshot_dma.c';
  // 与过滤版比：写法完全一样，锚点目录仍是相对路径的基准
  assert.deepEqual(resolveUnrestrictedPaths('dshot_dma.h', anchor, ['C:/other/proj']), [
    'C:/fw/Driver/dshot/Src/dshot_dma.h',
    'C:/other/proj/dshot_dma.h',
  ]);
  // `../Inc/...`：锚点目录算出来那一个是对的（兄弟目录），根算出来那一个只是"也试一下"
  assert.deepEqual(resolveUnrestrictedPaths('../Inc/dshot_dma.h', anchor, ['C:/other/proj']), [
    'C:/fw/Driver/dshot/Inc/dshot_dma.h',
    'C:/other/Inc/dshot_dma.h',
  ]);
  // 差别就在这三条：过滤版把它们丢光，不过滤版照单接受
  assert.deepEqual(resolveCandidatePaths('C:/elsewhere/x.h', anchor, ['C:/proj']), []);
  assert.deepEqual(resolveUnrestrictedPaths('C:/elsewhere/x.h', anchor, ['C:/proj']), [
    'C:/elsewhere/x.h',
  ]);
  assert.deepEqual(resolveUnrestrictedPaths('/etc/passwd', anchor), ['/etc/passwd']);
  assert.deepEqual(resolveUnrestrictedPaths('rb.h', anchor, []), ['C:/fw/Driver/dshot/Src/rb.h']);
  // 空串仍给空数组（那一档也不接受"没给路径"）
  assert.deepEqual(resolveUnrestrictedPaths('  ', anchor), []);
});

test('relativePathFrom：允许 `..` 的相对写法（清单给模型看的就是它，D117）', () => {
  assert.equal(relativePathFrom('C:/fw/Driver/dshot/Src', 'C:/fw/Driver/dshot/Inc/dshot_dma.h'), '../Inc/dshot_dma.h');
  assert.equal(relativePathFrom('C:/fw/Driver/dshot/Src', 'C:/fw/main.c'), '../../../main.c');
  assert.equal(relativePathFrom('C:/fw/Driver/dshot/Src', 'C:/fw/Driver/dshot/Src/impl/regs.h'), 'impl/regs.h');
  assert.equal(relativePathFrom('C:\\fw\\Src', 'C:\\fw\\Src\\a.h'), 'a.h', '两种斜杠都当分隔符');
  assert.equal(relativePathFrom('C:/fw/src', 'c:/FW/SRC/a.h'), 'a.h', '大小写不影响结论（与 samePath 同一立场）');
  assert.equal(relativePathFrom('/a/b', '/a/c/d.h'), '../c/d.h', 'POSIX 根下同理');
  // 不同盘符/UNC 表达不出相对写法 → 原样返回绝对路径（那也是合法写法）
  assert.equal(relativePathFrom('C:/fw/src', 'D:/sdk/hal.h'), 'D:/sdk/hal.h');
  assert.equal(relativePathFrom('C:/fw/src', '\\\\server\\share\\x.h'), '\\\\server\\share\\x.h');
  assert.equal(relativePathFrom('C:/fw/src', 'C:/fw/src'), '.');
});
