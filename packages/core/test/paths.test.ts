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
  resolveCandidatePaths,
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
