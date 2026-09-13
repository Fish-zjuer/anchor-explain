/**
 * 一次性工具：算出关键实体的定义行号，填进 docs/CONTRACTS.md §9.1。
 * 不进 CI，也不进 pnpm scripts —— 它只在写 docs 时手跑一次。
 * 用法：node scripts/def-lines.mjs
 */

import { readFileSync } from 'node:fs';

const TARGETS = {
  'packages/extension-anchor/src/paths.ts': ['normPath', 'samePath', 'basenameOf', 'countTextLines'],
  'packages/extension-anchor/src/adapters/CodeAdapter.ts': [
    'CaptureScope',
    'CodeAdapter',
    'CodeAdapterDeps',
    'createCodeAdapter',
    'fetchContext',
  ],
  'packages/extension-anchor/src/orchestrator/Orchestrator.ts': [
    'REJECT_PREFIX',
    'OrchestratorAdapter',
    'OrchestratorDeps',
    'createOrchestrator',
  ],
  'packages/extension-anchor/src/orchestrator/validateContextRequest.ts': [
    'FetchedSpan',
    'ContextFetchState',
    'ContextDecision',
    'validateContextRequest',
  ],
  'packages/extension-anchor/src/orchestrator/ModelRouter.ts': [
    'ModelTier',
    'ModelRouteInput',
    'ModelChoice',
    'ModelRouterConfig',
    'createModelRouter',
  ],
  'packages/extension-anchor/src/orchestrator/toolSchema.ts': [
    'FETCH_CONTEXT_TOOL',
    'EXPLANATION_JSON_SHAPE',
    'openAITools',
    'parseContextRequest',
  ],
  'packages/extension-anchor/src/orchestrator/providers/types.ts': [
    'ChatMessage',
    'ToolCall',
    'AssistantTurn',
    'ChatRequest',
    'ChatProvider',
  ],
  'packages/extension-anchor/src/orchestrator/providers/openAICompatible.ts': [
    'OpenAICompatibleOptions',
    'createOpenAICompatibleProvider',
  ],
  'packages/extension-anchor/src/prompts/index.ts': [
    'explainOutputContract',
    'buildSystemPrompt',
    'describeAnchor',
    'buildUserPrompt',
    'buildRepairPrompt',
  ],
  'packages/extension-anchor/src/config.ts': [
    'ProviderSettings',
    'AnchorConfig',
    'DEFAULT_MAX_FETCH_ROUNDS',
    'apiKeySecretName',
    'resolveProvider',
    'clampRounds',
    'resolveConfig',
    'describeConfig',
  ],
  'packages/extension-anchor/src/vscode/configSource.ts': [
    'readAnchorConfig',
    'storeApiKey',
    'configuredProviderIds',
  ],
  'packages/core/src/fakes/fakeFileSystemPort.ts': [
    'FakeFileSystemPortOptions',
    'FakeFileSystemPort',
    'createFakeFileSystemPort',
  ],
  'packages/extension-anchor-pdf/src/extension.ts': ['openInAnchorViewer', 'activate', 'deactivate'],
  'packages/extension-anchor-pdf/src/pdf-viewer-provider.ts': ['PDFViewerProvider'],
  'packages/extension-anchor-pdf/src/anchor/rectToNormalizedBBox.ts': [
    'PixelRect',
    'PageRect',
    'intersectRects',
    'pickDominantPage',
    'rectToNormalizedBBox',
    'resolveSelection',
  ],
  'packages/extension-anchor-pdf/src/anchor/bridge.ts': [
    'HostToSelect',
    'CapturedGeometry',
    'SelectToHost',
    'parseSelectMessage',
  ],
  'packages/extension-anchor-pdf/src/anchor/captureAnchor.ts': [
    'CaptureInput',
    'buildPdfAnchor',
    'describePdfAnchor',
  ],
  'packages/extension-anchor/src/protocol.ts': [
    'WalkthroughState',
    'HostToSidebar',
    'SidebarToHost',
    'HostToSelect',
    'SelectToHost',
    'isAnchorLike',
    'parseSidebarMessage',
  ],
  'packages/extension-anchor/src/orchestrator/validateExplanation.ts': [
    'ValidationIssue',
    'ExplanationOutline',
    'ExplanationValidation',
    'coerceEmphasis',
    'parseMaybeJson',
    'validateExplanation',
    'describeIssues',
  ],
  'packages/extension-anchor/src/playback/WalkthroughSession.ts': [
    'WalkthroughSnapshot',
    'SnapshotListener',
    'PLAY_INTERVAL_MS',
    'beatsPerStep',
    'totalBeats',
    'locateBeat',
    'firstBeatOfStep',
    'WalkthroughSession',
  ],
  'packages/extension-anchor/src/playback/decorationPlan.ts': [
    'DecorationSpec',
    'EMPHASES',
    'FALLBACK_EMPHASIS',
    'planForBeat',
    'primaryLocationOf',
  ],
  'packages/extension-anchor/src/playback/CodeWalkthroughPlayer.ts': ['CodeWalkthroughPlayer'],
  'packages/extension-anchor/src/sidebar/SidebarPanel.ts': ['SidebarHandlers', 'SidebarPanel'],
  'packages/extension-anchor/src/sidebar/statusBar.ts': ['StatusBarHandle', 'createStatusBar'],
  'packages/extension-anchor/src/sidebar/keybindingResolve.ts': [
    'ChordId',
    'WalkthroughChordSpec',
    'WALKTHROUGH_CHORDS',
    'ResolvedChord',
    'ResolvedChords',
    'KeyBindingEntry',
    'defaultChords',
    'keybindingsPathFrom',
    'stripJsonc',
    'parseKeybindings',
    'resolveChords',
    'formatChord',
  ],
  'packages/extension-anchor/src/sidebar/ui/styles.ts': ['SIDEBAR_STYLES'],
  'packages/extension-anchor/src/sidebar/ui/clientScript.ts': ['SIDEBAR_CLIENT_SCRIPT'],
  'packages/extension-anchor/src/sidebar/ui/html.ts': ['renderSidebarHtml'],
  'packages/extension-anchor/src/adapters/PDFAdapter.ts': [
    'PDFAdapter',
    'PDFAdapterDeps',
    'pageHeader',
    'createPdfAdapter',
  ],
  'packages/extension-anchor/src/adapters/pdf/PDFSource.ts': [
    'PDFPageText',
    'PDFSource',
    'OpenPDFSource',
  ],
  'packages/extension-anchor/src/adapters/pdf/pageTextIndex.ts': [
    'RawTextItem',
    'TextItem',
    'SAME_LINE_TOLERANCE',
    'normalizeItems',
    'readingOrder',
    'joinLines',
  ],
  'packages/extension-anchor/src/adapters/pdf/textSearch.ts': [
    'HIT_RATIO',
    'itemsInBBox',
    'textInBBox',
  ],
  'packages/extension-anchor/src/adapters/pdf/pdfDocumentCache.ts': [
    'DEFAULT_CACHE_LIMIT',
    'PdfDocumentCache',
    'createPdfDocumentCache',
  ],
  'packages/extension-anchor/src/adapters/pdf/pdfjsSource.ts': ['openPdfJsSource'],
  'packages/core/src/rect.ts': ['Rect', 'rectArea', 'intersectRects'],
  'packages/core/src/paths.ts': ['normPath', 'samePath', 'basenameOf', 'countTextLines'],
  'packages/extension-anchor/src/vscode/ports/editorPort.ts': ['createEditorPort'],
  'packages/extension-anchor/src/vscode/ports/fileSystemPort.ts': ['createFileSystemPort', 'countLines'],
  'packages/extension-anchor/src/commands.ts': ['registerCommands', 'askWhatToExplain', 'capture'],
  'packages/extension-anchor/src/extension.ts': ['activate', 'deactivate'],
  'packages/core/src/ports.ts': [
    'EditorSelection',
    'EditorPort',
    'FileSystemPort',
    'ImageRendererPort',
    'ExplainProvider',
  ],
  'packages/core/src/fakes/fakeEditorPort.ts': [
    'FAKE_FILE_PATH',
    'FAKE_LINE_START',
    'FAKE_LINE_END',
    'FAKE_SELECTION_TEXT',
    'FAKE_DOCUMENT_HASH',
    'FAKE_DOCUMENT_LINE_COUNT',
    'FAKE_DOCUMENT_TEXT',
    'createFakeEditorPort',
  ],
  'packages/core/src/fakes/fakeProvider.ts': [
    'FAKE_TARGET_LINE_START',
    'FAKE_TARGET_LINE_END',
    'FALLBACK_FILE_PATH',
    'createFakeProvider',
    'fakeProvider',
  ],
};

const PREFIXES = [
  'async ',
  'export type ',
  'export interface ',
  'export const ',
  'export function ',
  'export async function ',
  'async function ',
  'export class ',
  'export abstract class ',
  'export enum ',
  'type ',
  'interface ',
  'const ',
  'function ',
  'class ',
];

const isWordChar = (ch) => ch !== undefined && /[A-Za-z0-9_$]/.test(ch);

function defLine(lines, name) {
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i].trim();
    for (const prefix of PREFIXES) {
      if (!text.startsWith(prefix)) continue;
      const rest = text.slice(prefix.length);
      if (!rest.startsWith(name)) continue;
      if (isWordChar(rest[name.length])) continue;
      return i + 1;
    }
  }
  return null;
}

let missing = 0;
for (const [file, names] of Object.entries(TARGETS)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const parts = names.map((name) => {
    const line = defLine(lines, name);
    if (line === null) missing += 1;
    return `${name}:${line ?? '??'}`;
  });
  const short = file.replace('packages/extension-anchor/src/', '').replace('packages/core/src/', 'core/');
  console.log(`${short}  ||  ${parts.join(' ')}`);
}
if (missing > 0) {
  console.error(`\n[def-lines] 有 ${missing} 个名字没找到定义行`);
  process.exit(1);
}
