/**
 * 外部 Agent 交来的「位置清单」解析器。事实源：docs/DECISIONS.md D130。
 *
 * @anchor 这一片在解决什么：讲解流程假设"用户自己选了一段代码"。但当活是**外部 Agent 干的**时，
 *         用户手上只有"它改了哪几个地方"这个**坐标** —— 而坐标不能讲解，得先回到文件里取内容。
 *         本文件负责那段路的第一步：**把坐标从一段人写的文本里读出来**。
 *
 * 格式定成 `CodeLocation` 的形状（`{filePath, lineStart, lineEnd}`），理由是它**就是我们的内部类型**，
 * 不需要再造一套映射。为什么不收完整的 `Anchor`：里面的 `sourceId` 是文档指纹（要 hash 整个文件），
 * 外部 Agent 根本算不出来；`sourceName` 是 basename，我们自己能算。**它能给的只有路径与行区间。**
 *
 * **本文件不 import 'vscode'**：解析是纯文本的事，`node --test` 直测（与 `exportNotes.ts` 同一条理由）。
 */

/** 一条位置。字段与 `core` 的 `CodeLocation` 一致，但**故意不复用那个类型** —— 见文件头。 */
export interface HandoffRange {
  readonly filePath: string;
  readonly lineStart: number;
  readonly lineEnd: number;
}

export interface HandoffParseResult {
  readonly ranges: HandoffRange[];
  /**
   * 认不出的行（原文 + 行号）。**必须回给用户**：用户看不到它，就只会疑惑
   * "我明明粘了 5 条，怎么只出来 3 条" —— 而原因可能只是某一行少了个逗号。
   */
  readonly rejected: { line: number; text: string; reason: string }[];
  /** 解析后**去重合并**过的条数（小于 `ranges` 长度时说明有重复） */
  readonly mergedCount: number;
}

/** 粘进来的东西大小上限。与 §3.2「太大就只回一句太大」同一条立场（D130 第七节）。 */
export const MAX_HANDOFF_CHARS = 64 * 1024;

/**
 * 一段文本里能不能找到 JSON。**宽容**：外部 Agent 的输出常常带前言后语
 * （"好的，我改动了以下文件："），也可能包在 Markdown 围栏里。
 *
 * 所以不要求"整段是合法 JSON"，而是**找到其中看起来是位置对象的片段**。
 * 判据是"含 filePath 且含 lineStart" —— 只认这一个形状，不猜别的（见文件头"为什么不收 Anchor"）。
 */

/** 从一行里抠出 `"key": value` 的字符串值。不引 JSON.parse，因为单行可能是坏 JSON 的一部分。 */
function pickString(text: string, key: string): string | undefined {
  // "filePath" : "xxx"  /  filePath: "xxx"  /  'filePath': 'xxx'
  const re = new RegExp(`["']?${key}["']?\\s*[:=]\\s*["']([^"']+)["']`, 'u');
  const m = re.exec(text);
  return m?.[1];
}

/** 从一行里抠出 `"key": 数字`。 */
function pickNumber(text: string, key: string): number | undefined {
  const re = new RegExp(`["']?${key}["']?\\s*[:=]\\s*(-?\\d+)`, 'u');
  const m = re.exec(text);
  if (!m) return undefined;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isSafeInteger(n) ? n : undefined;
}

/**
 * 单行是不是一个"位置对象"。抽出来是因为两种输入形状都要用它：
 * 一行一个对象（`{...}`），以及一个对象被格式化成了**多行**（每个字段一行）。
 */
function lineToRange(line: string): HandoffRange | undefined {
  const filePath = pickString(line, 'filePath');
  if (filePath === undefined || filePath.trim() === '') return undefined;
  const lineStart = pickNumber(line, 'lineStart');
  const lineEnd = pickNumber(line, 'lineEnd') ?? lineStart;
  if (lineStart === undefined) return undefined;
  return normalizeRange({ filePath: filePath.trim(), lineStart, lineEnd: lineEnd! });
}

/**
 * 收窄一条区间，收不了返回 `undefined`。
 *
 * 三条规矩：
 *   1. **行号必须是正整数**（0 与负数不是行号，是别的什么东西）
 *   2. **start > end 时交换**：模型偶尔会把区间写反，而"写反了"和"位置不对"不同 ——
 *      前者我们**能确定**它的意图，就该救（与 §3.3 那条"能修就修"同一条立场）
 *   3. **end 缺省时等于 start**（只改了一行是常见情形）
 */
export function normalizeRange(range: HandoffRange): HandoffRange | undefined {
  const { filePath } = range;
  let { lineStart, lineEnd } = range;
  if (typeof filePath !== 'string' || filePath.trim() === '') return undefined;
  if (!Number.isSafeInteger(lineStart) || !Number.isSafeInteger(lineEnd)) return undefined;
  if (lineStart < 1 || lineEnd < 1) return undefined;
  if (lineStart > lineEnd) [lineStart, lineEnd] = [lineEnd, lineStart];
  return { filePath: filePath.trim(), lineStart, lineEnd };
}

/**
 * **去重合并**：同一文件里**相邻或重叠**的区间合成一条。
 *
 * @anchor 为什么必须做：外部 Agent 常常把一次改动拆成好几条报（改了 120-130 与 128-140），
 *         而 `segments` 的语义是"用户选的就是这几块" —— 带着重叠的段发出去，
 *         模型会以为那是两处不同的代码，讲两遍。
 *         **注意与 D128 的区别**：那条讲的是"取件去重"，这条讲的是"输入去重"，两回事。
 */
export function mergeRanges(ranges: HandoffRange[]): HandoffRange[] {
  if (ranges.length === 0) return [];
  // 按文件分组 → 组内按起点排序 → 扫一遍合并
  const byFile = new Map<string, HandoffRange[]>();
  for (const r of ranges) {
    const list = byFile.get(r.filePath);
    if (list) list.push(r);
    else byFile.set(r.filePath, [r]);
  }
  const out: HandoffRange[] = [];
  for (const [filePath, list] of byFile) {
    list.sort((a, b) => a.lineStart - b.lineStart || a.lineEnd - b.lineEnd);
    let cur = { ...list[0]! };
    for (let i = 1; i < list.length; i++) {
      const next = list[i]!;
      // 相邻（`+1`）也算连着 —— 120-130 与 131-140 是同一段
      if (next.lineStart <= cur.lineEnd + 1) {
        cur.lineEnd = Math.max(cur.lineEnd, next.lineEnd);
      } else {
        out.push(cur);
        cur = { ...next };
      }
    }
    out.push(cur);
  }
  // 输出顺序：**按文件名的稳定顺序**，同文件内按行号 —— 这样"从上到下"的排版
  // 在不同次粘贴之间是一致的（用户在临时文档里找东西找的是位置，不是"第几次"）
  out.sort((a, b) => (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : a.lineStart - b.lineStart));
  return out;
}

/**
 * 主入口：一段文本 → 位置清单。
 *
 * **宽容但不猜**：三种写法都认（JSON 数组 / 一行一个对象 / 一个对象跨多行），
 * 认不出的行如实列进 `rejected`，绝不静默丢弃。
 *
 * @anchor 为什么"不猜"这一条这么重要：用户粘贴的东西**没有二次确认的机会** ——
 *         我们直接拿它去读文件了。如果某一行没认出来而我们不说，
 *         临时文档里就会**少一段**，而用户以为自己粘全了。
 *         到那时他会以为是"外部 Agent 又漏改了"，方向完全错了。
 */
export function parseHandoff(raw: string): HandoffParseResult {
  const text = typeof raw === 'string' ? raw : '';
  const lines = text.split(/\r?\n/);

  const parsed: HandoffRange[] = [];
  const rejected: { line: number; text: string; reason: string }[] = [];

  /**
   * 跨行对象的状态：外部 Agent 把 JSON 格式化之后，
   * `{` / `"filePath": "..."` / `"lineStart": 1,` / `}` 会各占一行。
   * 用一个"攒够了就收"的缓冲区处理它 —— 这是唯一需要状态的地方。
   */
  let buffer: { text: string; firstLine: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;
    const trimmed = line.trim();

    // 空行 / Markdown 围栏 / 明显的装饰行：跳过，**不算错误**
    if (trimmed === '' || trimmed.startsWith('```') || /^[-=*_]{3,}$/u.test(trimmed)) continue;

    if (buffer) {
      // 攒多行对象：遇到收尾的 `}` 就结算
      buffer.text += ` ${trimmed}`;
      if (trimmed.includes('}')) {
        const range = lineToRange(buffer.text);
        if (range) parsed.push(range);
        else rejected.push({ line: buffer.firstLine, text: buffer.text.trim(), reason: '不完整的位置对象' });
        buffer = null;
      }
      continue;
    }

    const single = lineToRange(trimmed);
    if (single) {
      parsed.push(single);
      continue;
    }

    // 开了个 `{` 但这一行没写完 → 开始攒
    if (trimmed.includes('{') && !trimmed.includes('}')) {
      buffer = { text: trimmed, firstLine: lineNo };
      continue;
    }

    // 剩下的都是**认不出的行**。带 `filePath` 字样的多半是形状写错了（值得回给用户），
    // 其余（前言、"改动如下："这类）也一并列出 —— 用户扫一眼就知道哪些没被用上。
    rejected.push({
      line: lineNo,
      text: trimmed.slice(0, 200),
      reason: trimmed.includes('filePath') || trimmed.includes('lineStart') ? '位置对象形状不对' : '不是位置对象',
    });
  }

  // 收尾：缓冲区里还剩一个没闭合的对象（文件被截断 / 漏了 `}`）。
  // **先试着收下**：字段如果齐了（路径 + 行号都有），括号不全不影响我们消费信息；
  // 真不齐才进 rejected —— 与上面"能修就修"同一条立场。
  if (buffer) {
    const range = lineToRange(buffer.text);
    if (range) parsed.push(range);
    else rejected.push({ line: buffer.firstLine, text: buffer.text.trim().slice(0, 200), reason: '位置对象没有闭合' });
  }

  const merged = mergeRanges(parsed);
  return { ranges: merged, rejected, mergedCount: merged.length };
}

/**
 * 给外部 Agent 抄的那段短 prompt（用户要的"足够短的 prompt"）。
 *
 * @anchor 放在**代码里**而不是只放文档里：用户是拿它复制去用的，藏在 docs 里他要翻半天。
 *         措辞刻意只有三句：要求越少，对方写错的机会越少（D130 第二节）。
 */
export const HANDOFF_PROMPT = [
  '请把你本轮改动涉及的代码位置列出来，一个区域一行，按这个格式：',
  '{"filePath": "相对或绝对路径", "lineStart": 起始行, "lineEnd": 结束行}',
  '只给位置，不要解释，不要代码块围栏。行号从 1 开始。',
].join('\n');
