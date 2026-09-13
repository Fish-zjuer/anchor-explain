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

export type { EditorSelection, EditorPort, FileSystemPort, ImageRendererPort } from './ports.ts';

export type { BBox } from './normalizeBBox.ts';
export { clamp01, normalizeBBox, coerceBBox, isValidBBox, bboxArea } from './normalizeBBox.ts';

export { formatLineRange, locationLabel } from './locationLabel.ts';

export type { AnchorErrorCode } from './errors.ts';
export { AnchorError, isAnchorError, describeError } from './errors.ts';

export type { ContextRequestLogEntry, ContextRequestLogger } from './logging.ts';
export { createContextRequestLogger, CONTEXT_LOG_LIMIT } from './logging.ts';
