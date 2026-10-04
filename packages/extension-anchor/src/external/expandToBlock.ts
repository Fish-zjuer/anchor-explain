/**
 * 把"改了几行"扩到"它所在的整个函数块"。事实源：docs/DECISIONS.md D130 第三节。
 *
 * @anchor 为什么需要它（用户的原话）：「**按符号或空白行来，反正得是一个较为完整的结构，算法你来**」。
 *         外部 Agent 常常只报"我改了 120-123 行"，而那四行单独拿出来看不出任何东西 ——
 *         用户二次选择时需要一个**能读懂的单位**，也就是函数（或至少一个完整的块）。
 *         所以对方给行号，**上下文我们自己补**。
 *
 * **这是启发式，不是解析器**（要写进调用方的提示里，不许假装精确）：
 *   - 不引语法分析器：那只对特定语言有效，而用户的工程是 STM32 C / 前端 TS / Python 混着的
 *   - 缩进语言（Python）靠空白行与缩进停靠；一行里写多个函数、大括号在字符串里，都可能判错
 *   - **判错的代价是"多带或少带几行"，不是崩溃**，而且上层会在段首标注里写出实际范围
 *
 * **本文件不 import 'vscode'**：纯计算，`node --test` 直测。
 */

/** 一段文本按行拆开的结果，以及"这一行在不在块里"的判断依据。 */
interface LineInfo {
  /** 去掉行尾注释之后的代码部分（判括号用） */
  code: string;
  /** 原行（含注释），判注释行用 */
  raw: string;
  trimmed: string;
}

function analyze(lines: string[]): LineInfo[] {
  return lines.map((raw) => ({
    raw,
    trimmed: raw.trim(),
    code: stripComments(raw),
  }));
}

/**
 * 去掉行内注释，**保留字符串字面量里的内容**。
 *
 * @anchor 为什么要分两步而不是一个正则：`printf("// not a comment")` 里那两个斜杠
 *         不是注释开头。先把字符串整段挖出来，再找注释，顺序反了就会把字符串里的
 *         `}` 当成真的括号（那会让配平算错，而配平算错的后果是**扩出来一整个文件**）。
 */
function stripComments(line: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < line.length) {
    const ch = line[i]!;

    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < line.length) {
        out += line[i + 1]!;
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      i++;
      continue;
    }

    // 行注释：后面全不要（但字符串已经保住了）
    if (ch === '/' && line[i + 1] === '/') break;
    out += ch;
    i++;
  }
  return out;
}

/** 一行是不是"空白 / 注释 / 预处理指令"——向上停靠的三类边界。 */
function isBoundaryLine(info: LineInfo): boolean {
  const t = info.trimmed;
  if (t === '') return true;
  // 注释行（C 系与 Python 的 `#`）
  if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('#')) return true;
  return false;
}

/**
 * 从某个位置往上先探一下：**这一段到底有没有"块"**。
 *
 * @anchor 为什么需要这个预判：`int a = 1;` / `int b = 2;` 这种连续语句**没有大括号**，
 *         既不是函数也不是块。如果不管三七二十一就往上找入口，会一路吃到文件开头 ——
 *         把三条无关的全局变量当成"一个块"发出去。
 *         正确做法是**先确认有块**（区间内或紧邻处存在 `{`），再谈扩；
 *         没有块就原样返回 + `expanded: false`，让上层如实告诉用户"这不是一个函数"。
 *
 * **缩进块也算**（Python）：`def f():` 下面跟着缩进的两行就是一个块。
 * 判法是"区间内某一行比它下面的一行缩进更少"（说明有从属关系）。
 */
function hasBraceNearby(info: LineInfo[], lines: string[], start: number, end: number, total: number): boolean {
  // 区间内
  for (let i = start - 1; i < Math.min(end, total); i++) {
    if (info[i]!.code.includes('{')) return true;
  }
  // 紧邻的上一行（函数签名常在区间外面）
  if (start >= 2 && info[start - 2]!.code.includes('{')) return true;
  // 区间往下不远处（改的是签名上方的注释、或者只报了第一行）
  for (let i = end; i < Math.min(end + 2, total); i++) {
    if (info[i]!.code.includes('{')) return true;
  }
  return hasIndentBlock(lines, start, end);
}

/** 缩进层级（空格数；Tab 算 4）。空行返回 -1（不参与比较）。 */
function indentOf(line: string): number {
  const m = /^[ \t]*/u.exec(line);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[0]) n += ch === '\t' ? 4 : 1;
  return n;
}

/**
 * 这一段是不是一个**缩进块**（Python 那类）。
 *
 * @anchor 判据刻意简单：往上找**第一行有内容、且缩进比区间首行更少**的行 ——
 *         它就是块的头部（`def f():` / `if x:`）。找到了就算有块。
 *         不解析冒号、不解析语法 —— 那条路要么引语法分析器，要么写个半吊子。
 */
function hasIndentBlock(lines: string[], start: number, end: number): boolean {
  const base = indentOf(lines[start - 1] ?? '');
  if (base === 0) return false; // 已经在最外层，没有"更外"的头部
  for (let i = start - 2; i >= 0; i--) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    if (indentOf(line) < base) return true;
  }
  // 区间内的行自身有从属关系也算（比如报的就是整个 def 体）
  if (end > start) {
    for (let i = start; i < end; i++) {
      const line = lines[i]!;
      if (line.trim() === '') continue;
      if (indentOf(line) > base) return true;
    }
  }
  return false;
}

/** 一行里大括号的净增量（已去注释与字符串）。 */
function braceDelta(info: LineInfo): number {
  let delta = 0;
  for (const ch of info.code) {
    if (ch === '{') delta++;
    else if (ch === '}') delta--;
  }
  return delta;
}

export interface ExpandResult {
  readonly lineStart: number;
  readonly lineEnd: number;
  /**
   * 是否真的扩到了"看起来完整"的块。
   * `false` 时上层要在段首标注里**如实写出来** —— 不假装扩成功了（D130 第三节）。
   */
  readonly expanded: boolean;
  /** 给日志/调试看的一句话（不上面板） */
  readonly note: string;
}

/**
 * 把行区间扩到所在的函数块。
 *
 * 两步（D130 第三节）：
 *   1. **向下找收尾**：从末行往下数大括号，回到 0 的那一行就是块结尾
 *   2. **向上找开头**：从首行往上，遇到空白行 / 注释 / 预处理指令就停
 *
 * @param content 整个文件的内容
 * @param lineStart 1-based inclusive
 * @param lineEnd 1-based inclusive
 *
 * **越界一律夹住**（不是拒）：外部 Agent 给的行号可能超过文件长度（它记错了、
 * 或者文件在它改完之后又被人动过），那时**取能取到的部分**比整条作废有用。
 */
export function expandToBlock(content: string, lineStart: number, lineEnd: number): ExpandResult {
  const lines = content.split(/\r?\n/);
  const total = lines.length;
  if (total === 0) return { lineStart, lineEnd, expanded: false, note: '空文件' };

  // 夹到文件范围内
  let start = Math.max(1, Math.min(Math.trunc(lineStart), total));
  let end = Math.max(1, Math.min(Math.trunc(lineEnd), total));
  if (end < start) [start, end] = [end, start];

  const info = analyze(lines);
  const originalStart = start;

  // ── 0. 先确认这一段到底有没有"块" ────────────────────────────
  //
  // 没有块（比如外部 Agent 报的是几个全局变量、或者一堆 `#include`）就别扩 ——
  // 硬扩只会把无关的东西吃进来。**如实说"这不是一个函数"比假装扩成功有用**。
  if (!hasBraceNearby(info, lines, start, end, total)) {
    return {
      lineStart: start,
      lineEnd: end,
      expanded: false,
      note: '未能扩到函数边界（这一段里没有块结构）',
    };
  }

  // ── 1. 向上找开头 ────────────────────────────────────────────
  //
  // **先做向上**：找到这一段的"入口"（多半是函数签名那一行），
  // 再从这个入口向下配平 —— 顺序反过来会在"区间从函数中间开始"时多带走半截。
  let startFixed = start;
  let up = start - 2; // 上一行的下标（0-based）
  while (up >= 0) {
    const prev = info[up]!;
    if (isBoundaryLine(prev)) break; // 空行 / 注释 / 预处理指令：停
    if (prev.code.trim() === '}') break; // 上一个块结束了：停
    startFixed = up + 1;
    up--;
  }

  // ── 2. 从入口向下配平 ────────────────────────────────────────
  //
  // 从 `startFixed` 往下扫，把大括号数到归零。**必须从入口扫起**（而不是从区间中段），
  // 否则"区间落在嵌套块里"时（if 内部）永远数不到 0。
  let endFixed = end;
  let depth = 0;
  let opened = false;
  let closed = false;

  for (let i = startFixed - 1; i < total; i++) {
    const delta = braceDelta(info[i]!);
    if (delta > 0) opened = true;
    depth += delta;
    if (opened && depth <= 0) {
      endFixed = i + 1;
      closed = true;
      break;
    }
  }

  // 没找到配平的收尾（没有 `{`，或者括号不配平）：维持原区间，如实标注
  if (!closed) {
    const expanded = startFixed < originalStart;
    return {
      lineStart: startFixed,
      lineEnd: Math.max(end, startFixed),
      expanded,
      note: expanded ? `扩到第 ${startFixed}-${Math.max(end, startFixed)} 行` : '未能扩到函数边界（区间内找不到完整的块）',
    };
  }

  const expanded = endFixed > end || startFixed < originalStart;
  const note = expanded
    ? `扩到第 ${startFixed}-${endFixed} 行`
    : `区间本身就是完整的块（第 ${startFixed}-${endFixed} 行）`;

  return { lineStart: startFixed, lineEnd: endFixed, expanded, note };
}
