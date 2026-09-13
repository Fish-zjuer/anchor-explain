/**
 * 一次性工具：算出关键实体的定义行号，填进 docs/CONTRACTS.md §9.1。
 * 不进 CI，也不进 pnpm scripts —— 它只在写 docs 时手跑一次。
 * 用法：node scripts/def-lines.mjs
 */

import { readFileSync } from 'node:fs';

const TARGETS = {
  'packages/extension-anchor/src/paths.ts': ['normPath', 'samePath', 'countTextLines'],
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
    'WalkthroughSession',
  ],
  'packages/extension-anchor/src/playback/decorationPlan.ts': [
    'DecorationSpec',
    'EMPHASES',
    'FALLBACK_EMPHASIS',
    'planForStep',
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
  'packages/extension-anchor/src/vscode/ports/editorPort.ts': ['createEditorPort'],
  'packages/extension-anchor/src/vscode/ports/fileSystemPort.ts': ['createFileSystemPort', 'countLines'],
  'packages/extension-anchor/src/commands.ts': ['registerCommands', 'resolveS1FixturePath'],
  'packages/extension-anchor/src/extension.ts': ['activate', 'deactivate'],
  'packages/core/src/ports.ts': ['ExplainProvider'],
};

const PREFIXES = [
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
