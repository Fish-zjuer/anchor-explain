/**
 * @anchor/pdf-blocks —— PDF 拆块引擎（D99）。
 *
 * 五步管线：文字项 → 行（lines）→ 分栏判定（columns）→ 成块（blocks）→ 页内阅读序（order）
 * → 跨页缝合（stitch）。手修（manual）与问答线程（threads）是同一包里的纯操作。
 *
 * D100/D101 加的三件（**块流 → 问出去** 的那条链）：
 * 身份冻结（registry：ID 分配一次、只增不减、旧 ID 改嫁）→ 队列与编号
 * （queue：顺序/位次/徽标数字的唯一来源）→ 重排稿（reflow：图文混排、密集、有序）。
 *
 * 消费方三处：线2 的活页覆盖层（页级处理）、拆块工作室（整本处理）、框选兜底的精化。
 * 输入是归一化坐标的纯数据 —— 引擎不依赖 pdfjs 运行时，node --test 直测。
 */

export type {
  TextItemIn,
  PageTextIn,
  PageImageIn,
  SplitInput,
  BlockPart,
  BlockKind,
  Block,
  BlockStream,
  Thread,
  FollowUp,
  ThreadStore,
} from './types.ts';

export { formLines, linesOf, isCjkChar, COLUMN_GAP_FACTOR, LINE_GAP_FACTOR } from './lines.ts';
export type { Line } from './lines.ts';

export { detectColumns, partitionItems } from './columns.ts';
export type { PageLayout, ItemColumns } from './columns.ts';

export {
  blocksOfColumn,
  makeBlock,
  joinBlockText,
  isPageFurniture,
  markFurnitureLines,
  dropFurniture,
  groupRuns,
  estimateLineHeight,
  TERMINAL,
  BULLET_START,
} from './blocks.ts';

export { orderPage, topOf } from './order.ts';
export { canStitch, stitchPages, stitchPair } from './stitch.ts';
export { splitDocument } from './split.ts';
export { blockId, fnv1a, coord } from './ids.ts';

export {
  resolveIds,
  registryFrom,
  emptyRegistry,
  resolveAlias,
  isKnownId,
  aliasesOf,
  partsKeyOf,
  partKeyOf,
  partsNearlyEqual,
  isSubset,
  PART_EPS,
} from './registry.ts';
export type { BlockRegistry, RegistryEntry, ResolveResult } from './registry.ts';

export {
  EMPTY_QUEUE,
  enqueue,
  dequeue,
  clearQueue,
  hasBlock,
  setMode,
  toggleMode,
  readingComparable,
  effectiveMode,
  orderedIds,
  orderedBlocks,
  badgeNumbers,
  positionOf,
  previewPosition,
  describeOrder,
  orderKeyOf,
} from './queue.ts';
export type { BlockQueue, OrderMode, BlockIndex, EnqueueResult } from './queue.ts';

export { reflow, densify, approxTokens, unitsOf, captionTextOf, CAPTION_START } from './reflow.ts';
export type { Reflow, ReflowImage, ReflowBlockRef, ReflowOptions, BlockUnit } from './reflow.ts';

export { mergeBlocks, unstitch, setKind, fillImageText } from './manual.ts';

export {
  makeThread,
  attachThread,
  removeThread,
  threadsForBlock,
  threadsEndingAtBlock,
  addFollowUp,
  makeFollowUp,
  threadContext,
} from './threads.ts';
