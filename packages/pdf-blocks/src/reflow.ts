/**
 * 重排器（D101）：**N 个块 → 一份可以直接发出去的稿子**。
 *
 * @anchor 这一件是"问 AI"那一步的全部价值所在。为什么不能把 PDF 的原文直接发出去：
 *
 *   - **分栏**：双栏论文的抽取顺序是左一句右一句交错的，模型读到的因果是乱的；
 *   - **页码/书眉**：噪声进 prompt 既花钱又干扰；
 *   - **图**：截图整页发出去是"花钱把精确的文字变成有损的像素"，
 *     而图块只该发**那一块**的裁剪；
 *   - **密度**：页面留白、空行、连字符都是白花的 token。
 *
 *   所以这里把块流压成一条**单列、有序、图文就位、尽量密**的线：文字用文字发，
 *   图用图发，图注并进图块 —— 这就是用户要的"既有文本又有图片、又密集又按顺序"。
 *
 * ## 一条纪律：块编号是**跨界面唯一**的引用
 *
 * 稿子里的 `[3]`、卡片徽标上的 `3`、队列面板里的第 3 项，必须是同一个东西
 * （对应约束 107）。所以编号不在这里生成 —— 由 `queue.ts` 按**发送位次**算好，
 * 本模块只接受"已经排好序的块流"并按 1..N 标号。
 *
 * ## 另一条纪律：超预算要说出来
 *
 * 选了 200 块而预算只够 60 块时，**不能静默截断**（对应 D79/D81：进了 prompt 的东西
 * 必须在屏幕上留得下痕迹）。所以结果里带 `truncated` 与 `droppedBlockIds`，
 * 稿子抬头也把"只发了前 N 块"写进去 —— 用户和模型都看得见。
 *
 * 本文件零依赖，node --test 直测。
 */

import type { Block, BlockKind, BlockPart } from './types.ts';

/** 图注起头：`图 3.4`、`Fig. 2`、`表 1`、`Table 4-2` …（中英都要） */
export const CAPTION_START = /^(?:图|表|插图|附图|Figure|Fig\.?|Table|Tab\.?)\s*[\d一二三四五六七八九十]/iu;

/** 一个要随稿子一起发出去的图（裁图是调用方的事：这里只出清单，不做栅格） */
export interface ReflowImage {
  /** 稿子里的块编号（1-based）—— 与卡片徽标、队列面板同一个号 */
  index: number;
  blockId: string;
  /** 图注（紧跟其后的图表注块被并进来时才有） */
  caption?: string;
  /** 图片本体在图块里的位置（图注单独占块时要它自己的位置，所以这里给整体 parts） */
  parts: readonly BlockPart[];
  /** 图注所在的位置（`caption` 有值时才有）—— 高亮/注释要分两处画 */
  captionParts?: readonly BlockPart[];
}

export interface ReflowBlockRef {
  index: number;
  blockId: string;
  kind: BlockKind;
  /** 这一块在图里出现（图块），还是在文字里出现 */
  as: 'text' | 'image';
}

export interface ReflowOptions {
  /** 抬头里那份文档的名字（文件名 / 书名都行）。不给就不写抬头 */
  docLabel?: string;
  /** 字数预算。超了就截断**并如实汇报**；不给就是不设上限 */
  maxChars?: number;
  /**
   * 图块是否带上裁剪图。`false` = 只留图注文字（省 token / 纯文本小模也能答），
   * 这时 `images` 为空但图注仍在正文里 —— 模型不至于完全看不见那里有张图。
   */
  includeImages?: boolean;
  /**
   * 是否在结尾加一句"请按块号引用依据"。这是"解答附着回块"的前提：
   * 模型点名了块号，程序才能把答案挂上去。默认开。
   */
  askForRefs?: boolean;
}

export interface Reflow {
  /** 发出去的那份稿子 */
  text: string;
  /** 要随稿子附上的图（`includeImages: false` 时为空） */
  images: readonly ReflowImage[];
  /** 稿子里每一块的来处（编号 ↔ 块 ID 的对照表，附件与高亮都靠它） */
  blocks: readonly ReflowBlockRef[];
  chars: number;
  /** **估算**的 token 量，只用于预算提示（CJK 按 1、其余按 0.28 个字符折算） */
  approxTokens: number;
  truncated: boolean;
  /** 因为预算被丢掉的块（用户要能看见"哪些没发出去"） */
  droppedBlockIds: readonly string[];
}

/** 粗略的 token 估算：只用于"这次大概要花多少"的提示，不做精确计量 */
export function approxTokens(text: string): number {
  let cjk = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x2e80 && c <= 0x9fff) cjk += 1;
  }
  const rest = [...text].length - cjk;
  return Math.round(cjk + rest * 0.28);
}

/** 正文压密：去行尾空白、把连续空行收成一个、CJK 之间不补空格（引擎已拼好） */
export function densify(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+$/u, ''))
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n')
    .trim();
}

function headingPrefix(block: Block): string {
  if (block.kind !== 'heading') return '';
  const level = Math.min(Math.max(block.headingLevel ?? 3, 1), 6);
  return `${'#'.repeat(level)} `;
}

/**
 * 一个"展示单元"：块本体 + 并进来的图注（若有）。
 *
 * @anchor 为什么单独抽出来：图注该并进图块这件事**有两个消费方** ——
 *         重排稿（发出去的那份）与块流视图（相册卡片）。各写一份判据必然会分家，
 *         而分家的后果就是"卡片上是 3 号、发出去的 3 号却是另一段"（约束 107 的死法）。
 *         所以判据只有这一处，两边都吃它。
 */
export interface BlockUnit {
  block: Block;
  /** 紧跟其后的图表注块（`block` 是图块且下一块像图注时才有） */
  caption?: Block;
}

/** 把块流切成展示单元（只做**紧邻**的图注归并，不做更远的猜测） */
export function unitsOf(blocks: readonly Block[]): BlockUnit[] {
  const units: BlockUnit[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i]!;
    const next = blocks[i + 1];
    if (
      block.kind === 'image' &&
      next !== undefined &&
      next.kind !== 'image' &&
      next.text.trim() !== '' &&
      CAPTION_START.test(next.text.trim())
    ) {
      units.push({ block, caption: next });
      i += 2;
      continue;
    }
    units.push({ block });
    i += 1;
  }
  return units;
}

/** 图块的正文（图注）—— 卡片与稿子都从这里取，别处不许再判一次 */
export function captionTextOf(unit: BlockUnit): string | undefined {
  const raw = unit.caption?.text.trim();
  return raw === undefined || raw === '' ? undefined : densify(raw);
}

/**
 * 一份稿子。`blocks` 必须是**已经排好序的发送序**（`queue.ts` 的 `orderedBlocks` 给的就是）。
 */
export function reflow(blocks: readonly Block[], opts: ReflowOptions = {}): Reflow {
  const includeImages = opts.includeImages ?? true;
  const askForRefs = opts.askForRefs ?? true;
  const maxChars = opts.maxChars;

  const images: ReflowImage[] = [];
  const refs: ReflowBlockRef[] = [];
  const sections: string[] = [];
  const dropped: string[] = [];
  let used = 0;
  let truncated = false;
  let index = 0;

  const units = unitsOf(blocks);
  /** 每个单元贡献的块 ID（含被并进来的图注）—— 截断时按它如实汇报丢了什么 */
  const idsOfUnit = (u: BlockUnit): string[] => [u.block.id, ...(u.caption !== undefined ? [u.caption.id] : [])];

  for (let u = 0; u < units.length; u += 1) {
    const unit = units[u]!;
    const block = unit.block;
    // 纯空块（图块被 OCR 回填后文字为空、或引擎产出的空壳）不进稿子：它不承载信息
    const isEmptyText = block.kind !== 'image' && block.text.trim() === '';
    if (isEmptyText) continue;

    const caption = captionTextOf(unit);
    index += 1;
    let body: string;
    let image: ReflowImage | undefined;
    if (block.kind === 'image') {
      body = caption === undefined ? '〔图〕' : `〔图〕${caption}`;
      if (includeImages) {
        image = {
          index,
          blockId: block.id,
          ...(caption !== undefined ? { caption } : {}),
          parts: block.parts,
          ...(unit.caption !== undefined ? { captionParts: unit.caption.parts } : {}),
        };
      }
    } else {
      body = `${headingPrefix(block)}${densify(block.text)}`;
    }

    const piece = `[${index}] ${body}`;
    if (maxChars !== undefined && used + piece.length > maxChars && sections.length > 0) {
      // 预算到顶：这一块**整个**不发（正文、图、编号对照表一起退），绝不发半块
      truncated = true;
      for (const rest of units.slice(u)) dropped.push(...idsOfUnit(rest));
      index -= 1;
      break;
    }
    sections.push(piece);
    used += piece.length;
    if (image !== undefined) images.push(image);
    refs.push({
      index,
      blockId: block.id,
      kind: block.kind,
      as: block.kind === 'image' ? 'image' : 'text',
    });
  }

  const head: string[] = [];
  if (opts.docLabel !== undefined && opts.docLabel !== '') head.push(`文档：${opts.docLabel}`);
  if (sections.length > 0) {
    head.push(`本次选送 ${refs.length} 块${truncated ? '（预算到顶，后面的块没发出）' : ''}`);
  }
  const tail = askForRefs
    ? ['', '请按上面的块号引用你依据的块（例如 [#3][#7]），我会把解答挂回对应的块上。']
    : [];
  const text = [...head, '', ...sections, ...tail].join('\n');

  return {
    text,
    images,
    blocks: refs,
    chars: text.length,
    approxTokens: approxTokens(text),
    truncated,
    droppedBlockIds: dropped,
  };
}
