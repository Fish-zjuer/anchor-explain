/**
 * 假 AI —— 「AI 从哪来」这个**最外层边界**上的替身（SLICES.md 防返工约定）。
 *
 * 它不是"写死的假播放数据"：返回的是一个**货真价实的 ExplanationResult**，
 * 因此 S1 跑的是完整真链路 —— `ExplanationResult → 输出校验 → 会话状态 →
 * decoration 渲染 → 侧边栏 → 状态栏 → 键位`。
 * S3 接真 AI 时只换本文件（换成 orchestrator 循环），上层一行不动。
 *
 * 步骤里的 `title` / `intro` / `highlights` 是刻意填满的：§1.2 的两层 step 模型
 * 只有被真实数据走过一遍，S1 的侧边栏渲染路径才算验过，否则会拖到 S3 才第一次暴露形状。
 *
 * 本文件属 core，**禁止 import 'vscode'**。
 *
 * 内容对应样本 `test/fixtures/main.c` 第 40-48 行的 `rb_pop`。
 * 改那个文件的行号，必须同步改下面 SCRIPT 里的行号与 `fakes/fakeEditorPort.ts` 的选区。
 */

import type {
  Anchor,
  ExplanationResult,
  HighlightEmphasis,
  SubHighlight,
  WalkthroughStep,
} from '../types.ts';
import { isCodeLocation } from '../types.ts';
import type { ExplainProvider } from '../ports.ts';

/** 与 `test/fixtures/main.c` 第 40-48 行对齐 */
export const FAKE_TARGET_LINE_START = 40;
export const FAKE_TARGET_LINE_END = 48;

/** anchor 不是 CodeLocation 时的兜底路径（相对仓库根） */
export const FALLBACK_FILE_PATH = 'test/fixtures/main.c';

export const DEFAULT_SUMMARY =
  '这 9 行是一个标准的环形队列出队：先挡住空队列，再从 head 取值并把指针往前推，最后维护 count。' +
  '三个动作的顺序不能换 —— 先判断、后取值、再改状态。';

export const DEFAULT_CONFIDENCE = 0.9;

export const DEFAULT_TITLE = '环形队列的出队路径';

interface HighlightScript {
  range: readonly [number, number];
  narration: string;
  emphasis: HighlightEmphasis;
}

interface StepScript {
  range: readonly [number, number];
  title: string;
  intro: string;
  text: string;
  highlights: readonly HighlightScript[];
}

/**
 * 三个步骤的完整脚本，行号直接写死、一眼可核对。
 * 刻意用满四种 `emphasis`：S1 必须验到全部配色分支，而不是只验 primary。
 */
const SCRIPT: readonly StepScript[] = [
  {
    range: [40, 42],
    title: '出队前先挡住空队列',
    intro: 'rb_pop 要先回答一个问题：队列里还有东西吗？没有就当场认输，一个指针都不碰。',
    text:
      '第 40 行是函数签名，两个参数分别是要操作的环形队列，以及接住结果的出参指针。' +
      '第 42 行是提前返回：count 为 0 时直接返回 -1，调用方据此知道这次出队没拿到数据。' +
      '注意这里把「空」当成正常返回值而不是异常，所以 main 里的 while 循环可以写得很干净。',
    highlights: [
      {
        range: [40, 40],
        narration: 'out 是出参指针，用来把取到的值带回调用方 —— 因为返回值已经被 -1 / 0 占满了。',
        emphasis: 'context',
      },
      {
        range: [42, 42],
        narration: '空队列返回 -1：这是本函数的失败信号，也是 main 里 while 的终止条件。',
        emphasis: 'definition',
      },
    ],
  },
  {
    range: [44, 45],
    title: '取值，并把 head 往前推',
    intro: '数据在 head 指向的位置。取走之后 head 必须跟着走，否则下次会重复取到同一个元素。',
    text:
      '第 44 行把 head 位置的元素写进 out 指向的内存。第 45 行推进 head，并对 RB_CAPACITY 取模：' +
      '取模是环形队列的全部关键 —— head 走到数组末尾时会自动折回 0，不需要额外的分支判断。' +
      '注意 tail 在这里完全不参与，它只在入队时移动。',
    highlights: [
      {
        range: [44, 44],
        narration: '*out 是解引用赋值，改的是调用方栈上的变量，不是本地副本。',
        emphasis: 'primary',
      },
      {
        range: [45, 45],
        narration: '对容量取模实现了回绕：这就是「环形」二字的全部实现成本。',
        emphasis: 'definition',
      },
    ],
  },
  {
    range: [46, 48],
    title: '维护计数并报告成功',
    intro: '指针动了，count 也得动。否则下一次的空队列判断就会出错。',
    text:
      '第 46 行把 count 减一：它是本结构里「现在有多少元素」的唯一真相来源。' +
      'head 和 tail 相等并不代表队列为空 —— 满和空两种情况都会让两者相等，只有 count 说了算。' +
      '第 47 行返回 0 表示成功，回到 main：返回 0 就继续循环，返回 -1 就结束。',
    highlights: [
      {
        range: [46, 46],
        narration: 'count 是唯一权威：head == tail 在「满」和「空」时都成立，单看指针会误判。',
        emphasis: 'caveat',
      },
      {
        range: [47, 47],
        narration: '返回 0 表示成功，与上面的 -1 共同构成这对函数的约定。',
        emphasis: 'context',
      },
    ],
  },
];

/** 把脚本的相对行号实体化到具体文件上 */
function materialize(filePath: string): ExplanationResult {
  const steps: WalkthroughStep[] = SCRIPT.map((s) => ({
    location: { filePath, lineStart: s.range[0], lineEnd: s.range[1] },
    text: s.text,
    color: 'primary',
    title: s.title,
    intro: s.intro,
    highlights: s.highlights.map((h): SubHighlight => ({
      location: { filePath, lineStart: h.range[0], lineEnd: h.range[1] },
      narration: h.narration,
      emphasis: h.emphasis,
    })),
  }));

  return {
    steps,
    summary: DEFAULT_SUMMARY,
    confidence: DEFAULT_CONFIDENCE,
    title: DEFAULT_TITLE,
  };
}

function targetPath(anchor: Anchor): string {
  return isCodeLocation(anchor.location) ? anchor.location.filePath : FALLBACK_FILE_PATH;
}

export interface FakeProviderOptions {
  /** 模拟网络往返耗时，用来验「请求中」态的 UI。默认 0（立即返回）。 */
  delayMs?: number;
  summary?: string;
  confidence?: number;
}

export function createFakeProvider(opts: FakeProviderOptions = {}): ExplainProvider {
  return async (anchor: Anchor): Promise<ExplanationResult> => {
    if (opts.delayMs && opts.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
    }
    const result = materialize(targetPath(anchor));
    return {
      ...result,
      summary: opts.summary ?? result.summary,
      confidence: opts.confidence ?? result.confidence,
    };
  };
}

/** 默认替身：立即返回写死的三个合法步骤 */
export const fakeProvider: ExplainProvider = createFakeProvider();
