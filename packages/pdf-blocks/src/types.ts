/**
 * 拆块引擎的输入/输出形状（D99）。
 *
 * @anchor 为什么输入是"归一化坐标的纯数据"而不是 pdf.js 的对象：引擎的三个消费方
 *         （线2 的注入脚本、线1 的无头 pdf.js、拆块工作室）各自从自己的 pdf.js 实例
 *         抽出文字项，**喂给引擎的必须是同一个形状** —— 引擎不依赖任何 pdfjs 运行时。
 *         坐标约定与 `@anchor/core` 的 bbox 一致：x/y 是文字项**左上角**，y 向下，
 *         全部归一化到 [0,1]（线1 的 `pageTextIndex.normalizeItems` 已是这个约定）。
 *
 * 本文件零依赖，node --test 直测。
 */

/** 一页里的一个文字项（pdf.js `getTextContent` 的 item，坐标已归一化） */
export interface TextItemIn {
  str: string;
  /** 左上角 x（归一化 0-1） */
  x: number;
  /** 左上角 y（归一化 0-1，向下为正） */
  y: number;
  w: number;
  h: number;
}

/** 一页的文字项（调用方按页喂进来） */
export interface PageTextIn {
  page: number; // 1-based
  items: readonly TextItemIn[];
}

/** 一页里检测到的图片区域（调用方用 pdf.js 算子表得到，引擎只管排进阅读序） */
export interface PageImageIn {
  page: number; // 1-based
  bbox: [number, number, number, number]; // 归一化 0-1: x1,y1,x2,y2
}

/** 拆块输入：整个文档一次喂进来（跨页缝合需要全文档视野） */
export interface SplitInput {
  /** 文档指纹（线2 的内容 sha1）。给了块 ID 才带上文档维度；不给则块 ID 只由几何+文字决定 */
  docId?: string;
  pages: readonly PageTextIn[];
  images?: readonly PageImageIn[];
}

/** 块的一"部分"：跨页缝合的块可以有多个 part（甚至不同页） */
export interface BlockPart {
  page: number;
  bbox: [number, number, number, number];
}

export type BlockKind = 'text' | 'heading' | 'image';

/** 一个逻辑块：相册里的一张"卡片" */
export interface Block {
  /** 稳定 ID（见 ids.ts）：重开、重处理后不变，问答线程挂在它上面 */
  id: string;
  kind: BlockKind;
  /** `text`/`heading` 才有正文；`image` 块没有（OCR 的产出由调用方回填成 text 块） */
  text: string;
  parts: BlockPart[];
  /**
   * 每个 part 对应的正文（与 `parts` 等长对齐）。
   * 跨页缝合把两块合成一块时，**只有它能还原"哪段字来自哪一页"** ——
   * `unstitch`（取消缝合）全靠它。普通块也带上（单 part 时 = text）。
   */
  partTexts?: readonly string[];
  /** 由跨页缝合而来（`unstitch` 可拆开） */
  stitched?: boolean;
  /** 标题层级猜测（1 最大）；只对 `heading` 有意义 */
  headingLevel?: number;
}

/** 拆块结果：一个文档的有序块流（阅读序） */
export interface BlockStream {
  docId?: string;
  pageCount: number;
  blocks: readonly Block[];
}

/** ── 问答线程模型（D99 定版；挂载能力的地基，见 STATE D101） ───────────────── */

/** 一次按块提问的完整线程。`followUps` 是同一块上的追问（多轮累积） */
export interface Thread {
  id: string;
  /** 这一次问答挂在哪（几）块上 —— 单块直接挂那块，多块是组线程 */
  blockIds: readonly string[];
  /** 组线程展示在末块之后；单块线程 = blockIds[0] */
  question: string;
  answer: string;
  createdAt: number;
  /** 用的哪个模型/端点（人话名即可，如 "deepseek-flash"） */
  model?: string;
  followUps: readonly FollowUp[];
}

export interface FollowUp {
  question: string;
  answer: string;
  createdAt: number;
}

/** 一份文档的线程存档（调用方负责按内容指纹落盘；这里只定形状与纯操作） */
export interface ThreadStore {
  docId?: string;
  threads: readonly Thread[];
}
