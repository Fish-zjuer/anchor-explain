/**
 * 「改了几行」→「它所在的整个块」（S14 / D130 第三节）。
 *
 * 这是**启发式**，所以测试钉的不是"完美"，而是三件事：
 *   1. 常见的 C 风格函数能扩对
 *   2. 缩进语言（Python）靠空白行能停对
 *   3. **扩不了就如实说**（`expanded: false`），绝不假装
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandToBlock } from '../src/external/expandToBlock.ts';

const C_FILE = [
  '#include "dshot.h"', // 1
  '', // 2
  '// 初始化 DMA', // 3
  'static void dshot_dma_init(void) {', // 4
  '  DMA_Init();', // 5
  '  DMA_Config();', // 6
  '}', // 7
  '', // 8
  'void dshot_send(uint16_t value) {', // 9
  '  if (value > 2047) {', // 10
  '    value = 2047;', // 11
  '  }', // 12
  '  DMA_Send(value);', // 13
  '}', // 14
  '', // 15
  'int main(void) {', // 16
  '  dshot_dma_init();', // 17
  '  dshot_send(1024);', // 18
  '  return 0;', // 19
  '}', // 20
].join('\n');

test('改了函数中间两行 → 扩到整个函数（4-7）', () => {
  const r = expandToBlock(C_FILE, 5, 6);
  assert.equal(r.lineStart, 4);
  assert.equal(r.lineEnd, 7);
  assert.equal(r.expanded, true);
  assert.match(r.note, /扩到/);
});

test('只改了一行，在嵌套块里 → 向下配平到函数尾', () => {
  const r = expandToBlock(C_FILE, 11, 11);
  // 第 11 行在 if 里面；向上停到函数签名（第 9 行），向下配平到第 14 行
  assert.equal(r.lineStart, 9);
  assert.equal(r.lineEnd, 14);
});

test('区间恰好是整个函数 → 不扩，但也不说"扩了"', () => {
  const r = expandToBlock(C_FILE, 4, 7);
  assert.equal(r.lineStart, 4);
  assert.equal(r.lineEnd, 7);
  assert.equal(r.expanded, false);
});

test('函数体单行（{ 与 } 同一行）也能收尾', () => {
  const one = ['int add(int a, int b) { return a + b; }', '', 'int sub(int a, int b) { return a - b; }'].join('\n');
  const r = expandToBlock(one, 1, 1);
  assert.equal(r.lineStart, 1);
  assert.equal(r.lineEnd, 1);
});

test('字符串里的括号不算括号（否则整个文件都会被扩进来）', () => {
  const f = [
    'void f(void) {', // 1
    '  printf("}{ {}");', // 2 —— 全是字符串里的括号
    '  g();', // 3
    '}', // 4
    '', // 5
    'void h(void) {', // 6
    '}', // 7
  ].join('\n');
  const r = expandToBlock(f, 2, 3);
  assert.equal(r.lineStart, 1);
  assert.equal(r.lineEnd, 4);
});

test('行内注释里的括号不算括号', () => {
  const f = ['void f(void) {', '  g(); // 结束 }', '}'].join('\n');
  const r = expandToBlock(f, 2, 2);
  assert.equal(r.lineStart, 1);
  assert.equal(r.lineEnd, 3);
});

test('Python：靠空白行停靠', () => {
  const py = [
    'import os', // 1
    '', // 2
    'def dshot_init():', // 3
    '    setup()', // 4
    '    return True', // 5
    '', // 6
    'def dshot_send(v):', // 7
    '    send(v)', // 8
  ].join('\n');
  const r = expandToBlock(py, 5, 5);
  // 向上：第 5 行的上一行是第 4 行（不是边界）→ 继续；再上一行第 3 行 → 继续；
  // 再上一行第 2 行是空行 → 停。所以起点是第 3 行（def 那一行）。
  assert.equal(r.lineStart, 3);
});

test('行号超过文件长度会被夹住（外部 Agent 记错了）', () => {
  const r = expandToBlock('int main() {\n}\n', 1, 999);
  assert.ok(r.lineEnd <= 2, `行号要被夹到文件长度内，现在是 ${r.lineEnd}`);
});

test('空文件不炸', () => {
  const r = expandToBlock('', 1, 5);
  assert.equal(r.expanded, false);
});

test('区间内没有任何块：如实说未能扩展', () => {
  const r = expandToBlock(['int a = 1;', 'int b = 2;', 'int c = 3;'].join('\n'), 2, 2);
  assert.equal(r.expanded, false);
  assert.match(r.note, /未能扩到/);
});

test('预处理指令会挡住向上扩展', () => {
  const f = ['#define X 1', 'void f(void) {', '  g();', '}'].join('\n');
  const r = expandToBlock(f, 3, 3);
  assert.equal(r.lineStart, 2, '不该把 #define 那一行吃掉');
});

test('函数上方的注释不挡扩展（用户要的"完整结构"包括注释吗？——不包括，停在紧邻的注释前）', () => {
  const f = ['// 说明', 'void f(void) {', '  g();', '}'].join('\n');
  const r = expandToBlock(f, 3, 3);
  // 向上：第 2 行（void f）不是边界 → 收；再往上是第 1 行注释 → 停。
  // 所以结果是 2-4，注释留在外面 —— 这是刻意的：D130 说"不引语法分析器"，
  // 而"注释属不属于这个函数"是判断题，不做。
  assert.equal(r.lineStart, 2);
});
