/**
 * 「说给用户听的一句话」的**唯一格式化处**。
 *
 * @anchor 为什么值得单独一个文件：同一句「上次捕获：main.c 第 40-48 行（选区）」
 *         本来在两个地方各写了一遍 —— `Anchor: 显示状态`（自检）与开始面板（门厅）。
 *         两处各写一遍的第一个后果不是重复，而是**它们会分家**：
 *         改了一处的措辞，另一处还是旧的，用户看到两个说法的同一件事。
 *
 * 本文件**禁止 import 'vscode'**（D19），因此 `node --test` 能直接测它。
 */

import { locationLabel } from '@anchor/core';
import type { Anchor } from '@anchor/core';
import type { CaptureScope } from './adapters/CodeAdapter.ts';

/**
 * 「上次捕获」的一句话。
 *
 * 之所以非要有这句：真选区接上之后，**"我刚才那一按到底讲了哪一段"屏幕上再也看不出来**
 * —— 高亮画在哪由讲解内容决定，不由选区决定。所以它是唯一能复核锚点区间的观测点（D51）。
 */
export function captureSummary(anchor: Anchor, scope: CaptureScope): string {
  const how = scope === 'whole-file' ? '整个文件' : '选区';
  return `${anchor.sourceName} ${locationLabel(anchor.location)}（${how}）`;
}
