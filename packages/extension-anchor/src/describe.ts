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

import { locationLabel, segmentsOf } from '@anchor/core';
import type { Anchor } from '@anchor/core';
import type { CaptureScope } from './adapters/CodeAdapter.ts';

/**
 * 「上次捕获」的一句话。
 *
 * 之所以非要有这句：真选区接上之后，**"我刚才那一按到底讲了哪一段"屏幕上再也看不出来**
 * —— 高亮画在哪由讲解内容决定，不由选区决定。所以它是唯一能复核锚点区间的观测点（D51）。
 *
 * D79 起把 `focus` 也带上（有才带）：用户写的那句话**是这次讲解的一部分**，
 * 但它只进了 prompt、屏幕上没有任何痕迹。不显示的话，用户会怀疑"我写的那句到底生效没"——
 * 而这正是他自己会去复核的一件事。写在这里同时也让开始面板与「显示状态」两处自动带上。
 *
 * D80 起再把**那几段**也带上（多于一段时才带）。原因同上，而且更硬：
 * 多段锚点的 `location` 只是**并集的外框**（里面夹着没被选中的行）。
 * 只显示外框等于告诉用户"讲了第 10-48 行"，而他明明精挑细选过其中两块 ——
 * 这一句也就成了他唯一能复核"我选的那几段是不是全进去了"的地方。
 */
export function captureSummary(anchor: Anchor, scope: CaptureScope): string {
  const how = scope === 'whole-file' ? '整个文件' : '选区';
  const base = `${anchor.sourceName} ${locationLabel(anchor.location)}（${how}）`;

  const selected = segmentsOf(anchor);
  const multi =
    selected !== undefined && selected.length > 1
      ? ` · ${selected.length} 段（${selected.map((s) => `${s.lineStart}-${s.lineEnd}`).join(' + ')}）`
      : '';

  const focus = typeof anchor.focus === 'string' && anchor.focus.trim() !== '' ? anchor.focus.trim() : undefined;
  return `${base}${multi}${focus !== undefined ? ` · 重点：${focus}` : ''}`;
}
