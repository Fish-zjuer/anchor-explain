/**
 * 讲解 → Markdown 的**唯一**格式化处。事实源：docs/CONTRACTS.md §4.1（导出与历史）。
 *
 * @anchor 用户的原话是"需要能够导出讲解文件，能打开文件夹查看历史文件"。落点有两处：
 *         每次讲解成功**自动**存进历史文件夹（`commands.ts` 的 `rememberRun`），
 *         以及「导出讲解」的另存为 —— 两条路写的是**同一个函数**的产物，
 *         否则"导出的"和"历史里躺着的"早晚长成两种格式。
 *
 * 本文件**不 import 'vscode'**：格式化是纯文本的事，`node --test` 直测。
 * 文件写入由调用方走 `workspace.fs`（remote / 虚拟文件系统只有它读得到，D75）。
 */

import { basenameOf, isCodeLocation, isPDFLocation, locationLabel, samePath } from '@anchor/core';
import type { Anchor, Location } from '@anchor/core';
import type { LastRun } from './lastRun.ts';

/**
 * 子高亮的 emphasis → 人话。**与侧边栏客户端那张表说同样的话**
 * （`sidebar/ui/clientScript.ts` 的 `EMPHASIS_LABEL`）—— 那边 import 不到这边
 * （webview 脚本是字符串常量），所以两张表各管各的渲染面，改词时两边一起改。
 * D97 起有中英两张：英文讲解的存档导出英文标签。
 */
const EMPHASIS_LABEL: { zh: Record<string, string>; en: Record<string, string> } = {
  zh: {
    primary: '重点',
    context: '上下文',
    definition: '定义',
    caveat: '注意',
  },
  en: {
    primary: 'Key point',
    context: 'Context',
    definition: 'Definition',
    caveat: 'Caveat',
  },
};

/**
 * 导出 Markdown 的固定标签（D97）。位置格式也在这里分叉：core 的 `locationLabel`
 * 是「第 16-23 行」，英文讲解的导出里混进这一句会很刺眼，所以英文面用 "lines 16-23"。
 */
const LABELS = {
  zh: {
    fallbackTitle: 'Anchor 讲解',
    source: '来源',
    explainedAt: '讲解时间',
    confidence: '可信度',
    focus: '想追的线',
    segments: '多段选择',
    summary: '## 摘要',
    steps: '## 步骤',
    location: '位置',
    untitled: '（无标题）',
    footer: '由 Anchor Explain 导出（Fish-zjuer.anchor-explain）。',
    lines: (start: number, end: number) => (end > start ? `第 ${start}-${end} 行` : `第 ${start} 行`),
    page: (page: number) => `第 ${page} 页`,
    sep: '：',
    listSep: '、',
    wrap: (s: string) => `（${s}）`,
  },
  en: {
    fallbackTitle: 'Anchor Explanation',
    source: 'Source',
    explainedAt: 'Explained at',
    confidence: 'Confidence',
    focus: 'Focus',
    segments: 'Segments',
    summary: '## Summary',
    steps: '## Steps',
    location: 'Location',
    untitled: '(untitled)',
    footer: 'Exported by Anchor Explain (Fish-zjuer.anchor-explain).',
    lines: (start: number, end: number) => (end > start ? `lines ${start}-${end}` : `line ${start}`),
    page: (page: number) => `page ${page}`,
    sep: ': ',
    listSep: ', ',
    // 半角括号没有全角那种间隔感，前面补一个空格
    wrap: (s: string) => ` (${s})`,
  },
} as const;

type ExportLabels = (typeof LABELS)['zh' | 'en'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** `2026-09-19 14:25:30`。文件名用 `exportFileStem`（它不带空格与冒号）。 */
export function fullStamp(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '时间未知';
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Windows 文件名的禁用字符（保留字不管 —— sourceName 是现成的文件名，几乎不会撞上）。 */
const INVALID_NAME_CHARS = /[/\\:*?"<>|]/gu;

/**
 * 存档文件名的主体部分：`20260919-142530-main.c.md`（调用方补扩展名）。
 *
 * @anchor 时间戳到**秒**并放在最前：历史文件夹按名字排序就是按时间排序，
 *         用户"翻历史"的动作就是打开文件夹往下扫。同名锚点同秒导出会撞名 ——
 *         让调用方处理（VS Code 的另存为对话框自己会问；自动存档撞上就丢这次，
 *         重放和 workspaceState 里都还有）。
 */
export function exportFileStem(savedAt: number, anchor: Anchor): string {
  const d = Number.isFinite(savedAt) && savedAt > 0 ? new Date(savedAt) : new Date(0);
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const name = anchor.sourceName.replace(INVALID_NAME_CHARS, '-').trim();
  return `${stamp}-${name || 'anchor'}`;
}

/**
 * 位置的人话标签。**不在锚点文件里的位置必须带上文件名** —— 与侧边栏同一条纪律（D69）：
 * 只写「第 16 行」会让读者把它读成锚点文件的第 16 行。语言跟着讲解走（D97）。
 */
function labelOf(loc: Location, anchorPath: string | null, labels: ExportLabels): string {
  let label: string;
  if (isCodeLocation(loc)) label = labels.lines(loc.lineStart, loc.lineEnd);
  else if (isPDFLocation(loc)) label = labels.page(loc.page);
  else label = locationLabel(loc);
  if (isCodeLocation(loc) && anchorPath && !samePath(loc.filePath, anchorPath)) {
    return `${basenameOf(loc.filePath)} ${label}`;
  }
  return label;
}

/**
 * 一份讲解的完整 Markdown。**只消费 `LastRun`**：导出与自动存档拿到的是同一份存档
 * （重放用的也是它），所以导出的内容与屏幕上走过的一字不差。
 * 固定标签跟着讲解的语言走（D97）—— 英文讲解导出的文件不该顶着中文标题。
 */
export function explanationMarkdown(run: LastRun): string {
  const { result, anchor, savedAt } = run;
  const lang = run.language === 'en' ? 'en' : 'zh';
  const labels = LABELS[lang];
  // 与旧版同一套降级：能映射就映射，映射不上（未知值）原样给出，没给就用默认档
  const emphasisLabel = (name: string | undefined): string => {
    const table = EMPHASIS_LABEL[lang];
    if (name !== undefined && table[name] !== undefined) return table[name]!;
    return name ?? table.primary!;
  };
  const anchorPath = isCodeLocation(anchor.location) ? anchor.location.filePath : null;

  const confidence = Number.isFinite(result.confidence) ? Math.min(Math.max(result.confidence, 0), 1) : 0;

  const lines: string[] = [];
  lines.push(`# ${result.title?.trim() || labels.fallbackTitle}`);
  lines.push('');
  // 头部的位置也走本文件的分语言格式化（en 用 "lines 40-48"）：导出的整份文件不该混两种语言
  lines.push(`- ${labels.source}${labels.sep}${anchor.sourceName} ${labelOf(anchor.location, null, labels)}`);
  lines.push(`- ${labels.explainedAt}${labels.sep}${fullStamp(savedAt)}`);
  lines.push(`- ${labels.confidence}${labels.sep}${Math.round(confidence * 100)}%`);
  if (anchor.focus && anchor.focus.trim() !== '') lines.push(`- ${labels.focus}${labels.sep}${anchor.focus.trim()}`);
  // 多段选择（D80）：外框行号会让人以为"中间的全讲了"，必须把每一段列出来。
  // D98 起 segments 放宽为 Location[]；导出的行号列表只对代码锚点成立（PDF 走 labels.page）
  if (isCodeLocation(anchor.location) && anchor.segments !== undefined && anchor.segments.length > 1) {
    const codeSegs = anchor.segments.filter(isCodeLocation);
    if (codeSegs.length > 1) {
      lines.push(`- ${labels.segments}${labels.sep}${codeSegs.map((s) => labels.lines(s.lineStart, s.lineEnd)).join(labels.listSep)}`);
    }
  }
  lines.push('');
  lines.push(labels.summary);
  lines.push('');
  lines.push(result.summary);
  lines.push('');
  lines.push(labels.steps);

  result.steps.forEach((step, i) => {
    lines.push('');
    lines.push(`### ${i + 1}. ${step.title?.trim() || labels.untitled}`);
    lines.push('');
    lines.push(`${labels.location}${labels.sep}${labelOf(step.location, anchorPath, labels)}`);
    if (step.intro && step.intro.trim() !== '') {
      lines.push('');
      lines.push(step.intro.trim());
    }
    lines.push('');
    lines.push(step.text);

    const subs = step.highlights ?? [];
    if (subs.length > 0) {
      lines.push('');
      for (const h of subs) {
        lines.push(`- **${emphasisLabel(h.emphasis)}** ${h.narration}${labels.wrap(labelOf(h.location, anchorPath, labels))}`);
      }
    }
  });

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(labels.footer);
  return `${lines.join('\n')}\n`;
}
