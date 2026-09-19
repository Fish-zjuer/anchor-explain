/**
 * 讲解 → Markdown 的格式化与文件名（D89）。导出与自动存档共用 `explanationMarkdown`，
 * 所以这里钉住的形状就是用户在历史文件夹里看到的形状。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explanationMarkdown, exportFileStem, fullStamp } from '../src/session/exportNotes.ts';
import type { Anchor, ExplanationResult } from '@anchor/core';
import type { LastRun } from '../src/session/lastRun.ts';

const ANCHOR: Anchor = {
  sourceType: 'code',
  sourceId: 'sha1',
  sourceName: 'main.c',
  location: { filePath: 'C:\\repo\\Core\\Src\\main.c', lineStart: 40, lineEnd: 48 },
  focus: '只关心边界判断',
};

function runOf(result: Partial<ExplanationResult>, anchor: Anchor = ANCHOR): LastRun {
  return {
    anchor,
    savedAt: new Date(2026, 8, 19, 14, 25, 30).getTime(),
    result: {
      steps: [],
      summary: '总述',
      confidence: 0.8,
      ...result,
    },
  };
}

test('explanationMarkdown：头部有标题、来源、时间、可信度与 focus', () => {
  const md = explanationMarkdown(
    runOf({ title: '主控命令', steps: [{ location: ANCHOR.location, text: '正文' }] }),
  );
  assert.match(md, /^# 主控命令/);
  assert.match(md, /来源：main\.c 第 40-48 行/);
  assert.match(md, /讲解时间：2026-09-19 14:25:30/);
  assert.match(md, /可信度：80%/);
  assert.match(md, /想追的线：只关心边界判断/);
  assert.match(md, /## 摘要/, 'summary 有自己的小节');
  assert.match(md, /## 步骤/);
});

test('explanationMarkdown：步骤的子高亮带 emphasis 标签；外部文件的位置带文件名（D69 同一条纪律）', () => {
  const md = explanationMarkdown(
    runOf({
      steps: [
        {
          location: ANCHOR.location,
          title: '放行油门',
          text: '正文',
          highlights: [
            { location: { filePath: 'C:\\repo\\Core\\Inc\\esc.h', lineStart: 41, lineEnd: 44 }, narration: '放行开关', emphasis: 'definition' },
            { location: ANCHOR.location, narration: '没有标签时按重点处理' },
          ],
        },
      ],
    }),
  );
  assert.match(md, /### 1\. 放行油门/);
  assert.match(md, /位置：第 40-48 行/, '锚点文件自己的位置不标文件名');
  assert.match(md, /- \*\*定义\*\* 放行开关（esc\.h 第 41-44 行）/);
  assert.match(md, /- \*\*重点\*\* 没有标签时按重点处理（第 40-48 行）/);
});

test('explanationMarkdown：多段选择要把每段列出来（外框行号会让人误会中间也选了）', () => {
  const md = explanationMarkdown(
    runOf(
      { steps: [{ location: ANCHOR.location, text: 'x' }] },
      {
        ...ANCHOR,
        segments: [
          { filePath: 'C:\\repo\\Core\\Src\\main.c', lineStart: 10, lineEnd: 14 },
          { filePath: 'C:\\repo\\Core\\Src\\main.c', lineStart: 40, lineEnd: 48 },
        ],
      },
    ),
  );
  assert.match(md, /多段选择：第 10-14 行、第 40-48 行/);
});

test('exportFileStem：时间戳到秒在前（按名排序即按时间排序），坏字符清洗掉', () => {
  const at = new Date(2026, 8, 19, 14, 25, 30).getTime();
  assert.equal(exportFileStem(at, ANCHOR), '20260919-142530-main.c');
  assert.equal(
    exportFileStem(at, { ...ANCHOR, sourceName: 'weird:name*.c' }),
    '20260919-142530-weird-name-.c',
  );
  assert.equal(
    exportFileStem(at, { ...ANCHOR, sourceName: '///' }),
    '20260919-142530----',
    '坏字符逐个换成连字符（不是删掉）',
  );
  assert.equal(exportFileStem(at, { ...ANCHOR, sourceName: '' }), '20260919-142530-anchor', '空名给兜底名');
});

test('fullStamp：0 / 非法值不猜时间，明说"时间未知"', () => {
  assert.equal(fullStamp(0), '时间未知');
  assert.equal(fullStamp(Number.NaN), '时间未知');
  assert.equal(fullStamp(new Date(2026, 0, 2, 3, 4, 5).getTime()), '2026-01-02 03:04:05');
});

// ── D97：英文讲解的导出面 ─────────────────────────────────────────────────

test('explanationMarkdown（en）：标签、行号格式与 emphasis 全部换英文；旧存档（无 language）仍按中文', async () => {
  const { DETAILED_EXEMPLAR_EN } = await import('../src/prompts/exemplars.ts');
  void DETAILED_EXEMPLAR_EN; // 确保英文面加载（与常量锁同一个文件源）

  const enRun: LastRun = {
    ...runOf({
      steps: [
        {
          location: ANCHOR.location,
          title: 'Write — check full first',
          text: 'Body text.',
          highlights: [
            // 路径用正斜杠写（samePath / basenameOf 两种斜杠都认）—— 字面量里写反斜杠会被转义
            { location: { filePath: 'C:/repo/Core/Inc/esc.h', lineStart: 41, lineEnd: 44 }, narration: 'the full condition', emphasis: 'definition' },
            { location: ANCHOR.location, narration: 'no emphasis given' },
          ],
        },
      ],
    }),
    language: 'en',
  };
  const md = explanationMarkdown(enRun);
  assert.match(md, /^# /);
  assert.match(md, /- Source: main\.c lines 40-48/, '头部的位置也走本文件的英文格式化，整份导出不混两种语言');
  assert.match(md, /- Explained at: 2026-09-19 14:25:30/);
  assert.match(md, /- Confidence: 80%/);
  assert.match(md, /- Focus: 只关心边界判断/);
  assert.match(md, /## Summary/);
  assert.match(md, /## Steps/);
  assert.match(md, /Location: lines 40-48/);
  assert.match(md, /\*\*Definition\*\* the full condition \(esc\.h lines 41-44\)/);
  assert.match(md, /\*\*Key point\*\* no emphasis given \(lines 40-48\)/);
  assert.match(md, /Exported by Anchor Explain \(Fish-zjuer\.anchor-explain\)\./);
  assert.doesNotMatch(md, /由 Anchor Explain 导出/);

  // 旧存档（D97 之前写的，没有 language 字段）→ 中文面，一个字都不变
  const zhMd = explanationMarkdown(runOf({ steps: [{ location: ANCHOR.location, text: '正文' }] }));
  assert.match(zhMd, /## 摘要/);
  assert.match(zhMd, /位置：第 40-48 行/);
  assert.match(zhMd, /由 Anchor Explain 导出/);
});
