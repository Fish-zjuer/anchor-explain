/**
 * @anchor @anchor/core 的唯一入口。外部一律从 '@anchor/core' 导入，不深链 src/。
 */

export type {
  SourceType,
  PDFLocation,
  WebLocation,
  CodeLocation,
  Location,
  Anchor,
  ContextRequest,
  HighlightEmphasis,
  SubHighlight,
  WalkthroughStep,
  ExplanationResult,
  AdapterCapabilities,
  SourceAdapter,
} from './types.ts';

export { isPDFLocation, isCodeLocation, isWebLocation } from './types.ts';

export type {
  EditorSelection,
  EditorPort,
  FileSystemPort,
  ImageRendererPort,
  ExplainProvider,
} from './ports.ts';

export type { BBox } from './normalizeBBox.ts';
export { clamp01, normalizeBBox, coerceBBox, isValidBBox, bboxArea } from './normalizeBBox.ts';

export { formatLineRange, locationLabel } from './locationLabel.ts';

export {
  basenameOf,
  countTextLines,
  dirnameOf,
  isAbsolutePath,
  isInsidePath,
  joinPath,
  normPath,
  relativeToPath,
  relativePathFrom,
  resolveCandidatePaths,
  resolveUnrestrictedPaths,
  samePath,
} from './paths.ts';

export type { Rect } from './rect.ts';
export { intersectRects, rectArea } from './rect.ts';

export type { AnchorErrorCode } from './errors.ts';
export { AnchorError, isAnchorError, describeError } from './errors.ts';

// 多段锚点（D80）：把一次一次选出来的几段合成一个去讲
// D98：segments 放宽到 PDF（拆块器），pdfSegmentsOf 与 segmentsOf 同一立场
export type { AnchorSegment } from './segments.ts';
export {
  EmptyQueueError,
  sameFileAsFirst,
  compareSegments,
  mergeSegments,
  segmentsOf,
  pdfSegmentsOf,
  describeSegments,
} from './segments.ts';

export type { ContextRequestLogEntry, ContextRequestLogger } from './logging.ts';
export { createContextRequestLogger, CONTEXT_LOG_LIMIT } from './logging.ts';
