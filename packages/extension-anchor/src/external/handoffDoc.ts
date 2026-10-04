/**
 * 临时只读文档：拼装、逐行来源表、选区映射。事实源：docs/DECISIONS.md D130 第四/五节。
 *
 * @anchor 这一片的核心风险**全在这个文件的映射函数上**：拼起来的文档里，第 N 行到底来自
 *         哪个文件的哪一行？一旦错位，**不会报错、不会崩**，只会讲错东西 ——
 *         而"讲错东西"是用户最难发现的失败（他会以为模型讲得不好）。
 *         所以这段算法**在写 UI 之前就用探针单独验证过**（`.tmp-probe/mapping-probe.mjs`，8 条全过）。
 *
 * **本文件不 import 'vscode'**：拼装与映射都是纯计算，`node --test` 直测。
 * 文档内容的提供（`TextDocumentContentProvider`）在 `vscode/handoffDocumentProvider.ts`。
 */

/** 拼进文档的一段：来源文件 + 行区间 + 原文。 */
export interface HandoffSegment {
  readonly filePath: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  /** 这一段的原文（不含末尾换行） */
  readonly text: string;
  /** 是否扩到过函数边界（D130 第三节）；`false` 时在标注里如实写出来 */
  readonly expanded: boolean;
}

/**
 * 文档里每一行的来源。
 *   - `source`：正文行，能映射回源文件
 *   - `filler`：分割线 / 段首标注 / 空行 —— **选中了也不该映射成代码**
 */
export type HandoffOrigin =
  | { readonly kind: 'source'; readonly filePath: string; readonly line: number }
  | { readonly kind: 'filler'; readonly label: string };

export interface HandoffDoc {
  /** 文档正文（给 `TextDocumentContentProvider` 用） */
  readonly text: string;
  /** 逐行来源表。`origin[i]` 对应文档第 `i + 1` 行 */
  readonly origin: readonly HandoffOrigin[];
  /** 按行拆开的正文（省得调用方各自 split 一次，也能保证与 origin 对齐） */
  readonly lines: readonly string[];
  /** 只在文档里出现过的文件（按出现顺序，去重）—— 取件范围要用（D130 第六节） */
  readonly files: readonly string[];
}

/** 跨文件/跨段之间的分割线宽度。72 是常用终端宽度的 80 减去两侧余量。 */
const BAR_WIDTH = 72;

/** 段首标注的两种形状（扩成功了 / 没扩成功）。**不在标注里加装饰**，它要被用户读、也要被映射认。 */
function headerOf(seg: HandoffSegment): string {
  const range =
    seg.lineEnd > seg.lineStart ? `第 ${seg.lineStart}-${seg.lineEnd} 行` : `第 ${seg.lineStart} 行`;
  const tail = seg.expanded ? '' : '  （未能扩到函数边界）';
  return `// ${seg.filePath}  ${range}${tail}`;
}

/**
 * 把几段拼成一份文档，并产出**逐行**来源表。
 *
 * @anchor 段首标注与分割线**也必须占一行、也必须进来源表**（标成 `filler`）：
 *         少了这一步，用户拖选跨过它们时，映射会把这些行当成代码，
 *         切出一段"文件名恰好长得很像代码"的假区间 —— 而它不会报错，只会发一段假位置出去。
 */
export function buildHandoffDoc(segments: readonly HandoffSegment[]): HandoffDoc {
  const lines: string[] = [];
  const origin: HandoffOrigin[] = [];
  const files: string[] = [];

  const push = (text: string, entry: HandoffOrigin): void => {
    lines.push(text);
    origin.push(entry);
  };

  segments.forEach((seg, i) => {
    if (!files.includes(seg.filePath)) files.push(seg.filePath);
    if (i > 0) {
      push('='.repeat(BAR_WIDTH), { kind: 'filler', label: '分割线' });
      push('', { kind: 'filler', label: '空行' });
    }
    push(headerOf(seg), { kind: 'filler', label: '段首标注' });
    push('', { kind: 'filler', label: '空行' });
    seg.text.split('\n').forEach((line, offset) => {
      push(line, { kind: 'source', filePath: seg.filePath, line: seg.lineStart + offset });
    });
  });

  return { text: lines.join('\n'), origin, lines, files };
}

/** 映射出来的一段（源文件坐标）。与 `core` 的 `CodeLocation` 同形状。 */
export interface MappedRange {
  filePath: string;
  lineStart: number;
  lineEnd: number;
}

/**
 * 把一次选区（**文档行号**，1-based inclusive）映射成源文件区间列表。
 *
 * **这是本片最重要的函数。** 三条纪律（D130 第五节，探针逐条验过）：
 *
 *   1. **跨文件必须断开**：用户的原话是"连续选择时你要在后台将其自动分开，按队列处理"。
 *   2. **`filler` 是断点**：分割线/标注/空行落在选区里时，它们两侧属于不同的段。
 *   3. **行号不连续也必须断开**：同一文件的两处（10-12 与 50-51）**绝不能合成 10-51** ——
 *      那会把中间 40 行**没被取出来**的代码一起讲出去，而用户以为他选的就是那两小段。
 *
 * 返回空数组是**正常结果**（用户选中的全是标注行），上层据此给一句人话，不是错误。
 */
export function mapSelection(
  origin: readonly HandoffOrigin[],
  startDocLine: number,
  endDocLine: number,
): MappedRange[] {
  const out: MappedRange[] = [];
  let cur: MappedRange | null = null;

  const from = Math.max(1, Math.trunc(startDocLine));
  const to = Math.min(Math.trunc(endDocLine), origin.length);

  for (let docLine = from; docLine <= to; docLine++) {
    const entry = origin[docLine - 1];
    if (!entry || entry.kind !== 'source') {
      if (cur) {
        out.push(cur);
        cur = null;
      }
      continue;
    }
    if (cur && cur.filePath === entry.filePath && entry.line === cur.lineEnd + 1) {
      cur.lineEnd = entry.line;
      continue;
    }
    if (cur) out.push(cur);
    cur = { filePath: entry.filePath, lineStart: entry.line, lineEnd: entry.line };
  }
  if (cur) out.push(cur);
  return out;
}

/** 给用户看的一句话摘要（确认框、状态栏回执都用它）。 */
export function describeMapped(ranges: readonly MappedRange[]): string {
  if (ranges.length === 0) return '（没有选中代码）';
  return ranges
    .map((r) => {
      const name = r.filePath.split(/[/\\]/u).pop() ?? r.filePath;
      return r.lineEnd > r.lineStart ? `${name} 第 ${r.lineStart}-${r.lineEnd} 行` : `${name} 第 ${r.lineStart} 行`;
    })
    .join(' + ');
}

/**
 * 临时文档的 URI 契约（scheme + path 的约定）。
 *
 * @anchor 放在这里而不是 provider 里：`commands.ts` 要**判断"当前编辑器是不是我们的临时文档"**
 *         （D130 第五节那条分支），判据就是这个 scheme。两处用同一个常量，才不会
 *         "provider 注册的是 A、判断写的是 B"，那种错会表现为"功能完全没生效但不报错"。
 */
export const HANDOFF_SCHEME = 'anchor-handoff';

/** 文档 URI 的固定路径部分。内容由宿主持有，URI 只当身份用。 */
export const HANDOFF_URI_PATH = 'handoff';
