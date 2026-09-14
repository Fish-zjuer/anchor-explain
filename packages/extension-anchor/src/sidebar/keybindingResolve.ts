/**
 * 键位解析 —— 「用户实际绑了什么键」这一问的答案。事实源：docs/CONTRACTS.md §4.1 / §5.4，D10。
 *
 * @anchor 本文件**不 import 'vscode'**：VS Code 没有任何公开 API 能查询"命令最终生效的键位"
 *         （D10 已记录此脆弱性），只能去读用户的 `keybindings.json`。
 *         于是把"读文件"留在宿主侧（statusBar.ts），把"纯字符串处理"全放在这里，可直测。
 *
 * **明确不承诺的事**：本模块只看直接覆盖与显式解绑（`-command`）。
 * 用户若用 `when` 条件另加一条绑定、或把我们的默认键让给了别的命令，
 * 这里判不出来 —— 那就如实回退到默认键位，而不是瞎猜。状态栏文案宁可保守也不骗人。
 */

/**
 * 全仓所有"我们给了默认键"的动作。线1 六个 + 开始界面 + 线2 的框选（S8）。
 *
 * `selectRegion` 是**线2 的键位**，默认键写在线2 的 `package.json` 里，
 * 但它也是用户可能改掉的东西，所以走同一套解析 —— 面板显示的键位因此不许和线2 的声明分家。
 */
export type ChordId = 'capture' | 'next' | 'prev' | 'stop' | 'goto' | 'playPause' | 'showStart' | 'selectRegion';

export interface WalkthroughChordSpec {
  id: ChordId;
  command: string;
  /** Windows / Linux 默认键，与 `contributes.keybindings` 的 `key` 一字不差 */
  key: string;
  /** macOS 默认键（§4.1 的默认键列只给了 ctrl 形式，mac 把 ctrl 换成 cmd） */
  mac: string;
  /** §4.1 的 `when`，与 `contributes.keybindings` 一字不差 */
  when: string;
}

/**
 * **线1** 的键位表。它是 `packages/extension-anchor/package.json` 里 `contributes.keybindings`
 * 的镜像；`test/keybindingResolve.test.ts` 有一条锁逐字比对两者。
 */
export const WALKTHROUGH_CHORDS: readonly WalkthroughChordSpec[] = [
  {
    id: 'capture',
    command: 'anchorExplain.capture',
    key: 'ctrl+shift+a',
    mac: 'cmd+shift+a',
    when: 'editorTextFocus',
  },
  {
    // S8：固定按钮对应的那条键。`!inputFocus` 与 stop 同一个立场 ——
    // 打开开始界面这件事没有急到要在一个输入框里抢下 Ctrl+Alt+A（D11）。
    id: 'showStart',
    command: 'anchorExplain.showStart',
    key: 'ctrl+alt+a',
    mac: 'cmd+alt+a',
    when: '!inputFocus',
  },
  {
    id: 'next',
    command: 'anchorExplain.next',
    key: 'alt+]',
    mac: 'alt+]',
    when: 'anchorExplain.walkthroughActive',
  },
  {
    id: 'prev',
    command: 'anchorExplain.prev',
    key: 'alt+[',
    mac: 'alt+[',
    when: 'anchorExplain.sessionOpen',
  },
  {
    id: 'stop',
    command: 'anchorExplain.stop',
    key: 'escape',
    mac: 'escape',
    // §4.1 / D11：Escape 是高频复用键（取消输入、关 QuickPick），加 !inputFocus 才不抢。
    // 用 sessionOpen 而**不是** walkthroughActive：讲完（done）时 walkthroughActive 已落 false，
    // 若 stop 也绑在它上面，`alt+]` 走到最后一步之后屏幕上的框就再没人能清掉了（D46）。
    when: 'anchorExplain.sessionOpen && !inputFocus',
  },
  {
    id: 'goto',
    command: 'anchorExplain.goto',
    key: 'ctrl+alt+w',
    mac: 'cmd+alt+w',
    when: 'anchorExplain.sessionOpen',
  },
  {
    id: 'playPause',
    command: 'anchorExplain.playPause',
    key: 'ctrl+shift+space',
    mac: 'cmd+shift+space',
    when: 'anchorExplain.walkthroughActive',
  },
];

/**
 * **线2** 的键位表（S8）。镜像对象是 `packages/extension-anchor-pdf/package.json`。
 *
 * @anchor 为什么线1 要去读线2 的键位：开始面板是**整个产品**的门厅，上面写着
 *         「框选 PDF 区域」这个动作 —— 而线2 的默认键（`ctrl+alt+s`，且只在
 *         `activeCustomEditorId == 'anchorPdf.view'` 时生效）和线1 一样可能被用户改掉。
 *         面板要么显示用户实际绑的键，要么什么都不显示；显示一个写死的默认键
 *         就是**替用户断言一件我们并不知道的事**（D10 的立场对线2 同样成立）。
 *
 * 两张表**分开**而不是合成一张：它们各有各的镜像锁，合成一张会让"哪一行对不上"
 * 变成一个需要二次判断的问题（`test/keybindingResolve.test.ts` 两条锁分别断言）。
 */
export const LINE2_CHORDS: readonly WalkthroughChordSpec[] = [
  {
    id: 'selectRegion',
    command: 'anchorPdf.selectRegion',
    key: 'ctrl+alt+s',
    mac: 'cmd+alt+s',
    when: "activeCustomEditorId == 'anchorPdf.view'",
  },
];

/** 解析时两张表一起走：用户改的是"哪个键"，与它属于线1 还是线2 无关。 */
const ALL_CHORDS: readonly WalkthroughChordSpec[] = [...WALKTHROUGH_CHORDS, ...LINE2_CHORDS];

/** `null` = 用户已解绑（或绑成了空串）。状态栏遇到 `null` 就只显示动作、不显示键。 */
export type ResolvedChord = string | null;
export type ResolvedChords = Record<ChordId, ResolvedChord>;

export interface KeyBindingEntry {
  command?: unknown;
  key?: unknown;
  mac?: unknown;
  when?: unknown;
}

export function defaultChords(isMac: boolean): ResolvedChords {
  const out = {} as Record<ChordId, ResolvedChord>;
  for (const spec of ALL_CHORDS) out[spec.id] = isMac ? spec.mac : spec.key;
  return out;
}

/**
 * 由 `context.globalStorageUri.fsPath` 推出用户 `keybindings.json` 的路径。
 *
 * globalStorageUri = `<userData>/User/globalStorage/<publisher>.<name>`，向上三级即 `<userData>`。
 * **这是内部目录结构，不是公开 API**（D10 已记录并接受该风险）；形状不符时返回一个
 * 明显不存在的路径，让上层读取失败并回退默认键位，而不是抛错。
 */
export function keybindingsPathFrom(globalStorageFsPath: string): string {
  const sep = globalStorageFsPath.includes('\\') ? '\\' : '/';
  const parts = globalStorageFsPath.split(/[\\/]+/).filter((p) => p.length > 0);
  if (parts.length < 3) return `${globalStorageFsPath}${sep}keybindings.json`;

  const root = parts.slice(0, parts.length - 3).join(sep);
  const withPrefix = globalStorageFsPath.startsWith('/') ? `/${root}` : root;
  return [withPrefix, 'User', 'keybindings.json'].join(sep);
}

/**
 * 去注释与尾随逗号，让 JSONC 能被 `JSON.parse` 吃下。
 *
 * **逐字符扫，字符串字面量内部一律不碰** —— 两种做法都是错的：
 * 正则去注释会把 `"ctrl+//"` 切坏；正则去尾随逗号会把 `"n": ",}"` 里的逗号吃掉
 * （两种情况各有单测钉住）。所以尾随逗号也在同一个扫描循环里判定，不在事后替换。
 */
export function stripJsonc(text: string): string {
  let out = '';
  let i = 0;
  let inString = false;

  while (i < text.length) {
    const ch = text[i]!;

    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += text[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === ',') {
      // 往后看第一个非空白字符：是 } 或 ] 就说明这是尾随逗号，丢掉它
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j]!)) j += 1;
      const next = text[j];
      if (next === '}' || next === ']') {
        i += 1;
        continue;
      }
    }

    out += ch;
    i += 1;
  }

  return out;
}

function isEntry(v: unknown): v is KeyBindingEntry {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 读取失败/格式坏掉一律返回空数组：状态栏宁可回退默认文案，也不能因此报错。 */
export function parseKeybindings(text: string): readonly KeyBindingEntry[] {
  for (const attempt of [text, stripJsonc(text)]) {
    try {
      const parsed: unknown = JSON.parse(attempt);
      if (Array.isArray(parsed)) return parsed.filter(isEntry);
    } catch {
      // 换下一种解析方式
    }
  }
  return [];
}

/**
 * 把用户绑定合并进默认键位。用户覆盖优先；`-command` 视为解绑（`null`）。
 * 从后往前找第一条匹配 —— `keybindings.json` 里后面的条目优先，与 VS Code 一致。
 */
export function resolveChords(entries: readonly KeyBindingEntry[], isMac: boolean): ResolvedChords {
  const out = defaultChords(isMac);

  for (const spec of ALL_CHORDS) {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i]!;
      const command = entry.command;
      if (typeof command !== 'string') continue;

      if (command === `-${spec.command}`) {
        out[spec.id] = null;
        break;
      }
      if (command !== spec.command) continue;

      // 带 when 的绑定只在特定上下文生效，判不出"最终生效键"，跳过而不是猜
      if (typeof entry.when === 'string' && entry.when.trim() !== '') continue;

      const key = isMac ? (entry.mac ?? entry.key) : entry.key;
      if (typeof key !== 'string' || key.trim() === '') {
        out[spec.id] = null;
        break;
      }
      out[spec.id] = key.trim();
      break;
    }
  }

  return out;
}

const MOD_LABEL: Record<string, string> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  option: 'Alt',
  cmd: 'Cmd',
  meta: 'Cmd',
  super: 'Win',
  win: 'Win',
};

// 顺序：Cmd/Win 系在前，再 Ctrl / Shift / Alt —— 于是 mac 上是 `Cmd+Alt+W`、Windows 上是
// `Ctrl+Shift+A`，两边都符合各自习惯；用户写 `shift+ctrl+a` 也会被归一成同一种读法。
const MOD_ORDER: readonly string[] = ['cmd', 'meta', 'super', 'win', 'ctrl', 'control', 'shift', 'alt', 'option'];

const KEY_LABEL: Record<string, string> = {
  escape: 'Esc',
  esc: 'Esc',
  space: 'Space',
  tab: 'Tab',
  enter: 'Enter',
  return: 'Enter',
  backspace: 'Backspace',
  delete: 'Del',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  home: 'Home',
  end: 'End',
  pageup: 'PgUp',
  pagedown: 'PgDn',
};

/** `alt+]` → `Alt+]`；`escape` → `Esc`。修饰键按固定顺序排，短名按 VS Code 习惯首字母大写。 */
export function formatChord(chord: string): string {
  const parts = chord.split('+').map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return chord;

  const mods = new Set<string>();
  const keys: string[] = [];
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower in MOD_LABEL) mods.add(lower);
    else keys.push(part);
  }

  const modLabels = [...mods]
    .sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b))
    .map((m) => MOD_LABEL[m]!);

  const keyLabels = keys.map((k) => {
    const lower = k.toLowerCase();
    if (lower in KEY_LABEL) return KEY_LABEL[lower]!;
    return k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1);
  });

  return [...modLabels, ...keyLabels].join('+') || chord;
}
