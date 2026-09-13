/**
 * 「开始」面板的内容模型。事实源：docs/CONTRACTS.md §5.5。
 *
 * @anchor 为什么面板的内容在**这里**算，而不是在 UI 文件里拼：
 *         面板要显示的东西全是**状态** —— 用户实际绑了什么键、模型配上没有、线2 在不在、
 *         上次捕获的是哪一段。状态在 `commands.ts` 手里，UI 只该拿到"该显示什么"。
 *         把"状态 → 该显示什么"做成一个纯函数，于是三件事同时成立：
 *           1. 面板 UI（`ui/startClientScript.ts`）里**一条业务判断都没有**，只有渲染与派发
 *           2. 这段映射能 `node --test` 直测，不必起 F5 肉眼看（`test/startModel.test.ts`）
 *           3. 每个动作指向一个**已声明**的命令 ID，有耦合锁守着（同上的测试文件）
 *
 * 本文件**禁止 import 'vscode'**（D19）。它只借 `protocol.ts` 的状态词与状态类型。
 */

import { formatChord } from '../sidebar/keybindingResolve.ts';
import type { ChordId, ResolvedChords } from '../sidebar/keybindingResolve.ts';
import { STATE_WORD } from '../protocol.ts';
import type { WalkthroughState } from '../protocol.ts';

export type StartActionId =
  | 'capture'
  | 'openSettings'
  | 'setApiKey'
  | 'showState'
  | 'openPdf'
  | 'selectRegion'
  | 'goto';

export type StartGroupId = 'start' | 'line2' | 'session';

/** 前置条件。缺了就不给点，并且**说清缺什么** —— 灰按钮不说理由是最气人的一种 UI。 */
export type StartRequirement = 'provider' | 'peer' | 'session';

export interface StartActionSpec {
  readonly id: StartActionId;
  readonly group: StartGroupId;
  readonly title: string;
  readonly detail: string;
  /** **必须**是 `contributes.commands` 里声明过的命令 ID（测试里那条锁会去查 package.json） */
  readonly command: string;
  /** 有键位就显示**用户实际绑的**那个键（D10）；没绑就显示命令面板那条路 */
  readonly chordId?: ChordId;
  readonly requires?: StartRequirement;
}

export const START_GROUP_TITLES: Record<StartGroupId, string> = {
  start: '开始',
  line2: '线2（PDF）',
  session: '这次讲解',
};

/** 组在面板上的固定顺序。`start` 在最上面 —— 门厅第一眼要看到的是"从哪儿开始"。 */
const GROUP_ORDER: readonly StartGroupId[] = ['start', 'line2', 'session'];

/**
 * 面板上的全部动作。
 *
 * @anchor 这张表是"固定按钮"之所以成立的全部内容：**按钮不实现任何东西，它只指向命令**。
 *         命令是唯一的实现处（`commands.ts`），所以：
 *           - 面板里点「讲解选中的代码」与按 Ctrl+Shift+A 走的是**同一条**路径
 *           - 将来加一个动作 = 这里加一行 + `package.json` 里声明那条命令（锁会提醒你漏了哪个）
 *         这也正是"把逻辑组织起来而不是糊在一起"的判据：面板本身**没有可糊的地方**。
 *         唯一不属于"调用命令"的动作是 `goto`（它需要开会话游标）——它调的也是命令。
 */
export const START_ACTIONS: readonly StartActionSpec[] = [
  {
    id: 'capture',
    group: 'start',
    title: '讲解选中的代码',
    detail: '在编辑器里选中一段，然后按下面这个键（也可以在命令面板里找「Anchor：捕获选区并讲解」）',
    command: 'anchorExplain.capture',
    chordId: 'capture',
  },
  {
    // **门厅不许是死路**（D61）。用户第一眼看到的常常是"设置 API Key 不可用 + 说你还缺 providers"，
    // 那就必须有一条去配 providers 的路 —— 否则面板把该做什么说清楚了，却一步也走不动。
    // 放在「设置 API Key」**上面**：顺序本身就是那句"先配端点、再存 key"。
    id: 'openSettings',
    group: 'start',
    title: '打开设置（配模型端点）',
    detail: '填 anchorExplain.providers：baseUrl 与一个模型名就够（端点由你选，一个 OpenAI 兼容实现覆盖多家）',
    command: 'anchorExplain.openSettings',
  },
  {
    id: 'setApiKey',
    group: 'start',
    title: '设置 API Key',
    detail: '存进 SecretStorage —— 不进 settings.json，也就不会被同步、被截图、被提交',
    command: 'anchorExplain.setApiKey',
    requires: 'provider',
  },
  {
    id: 'showState',
    group: 'start',
    title: '显示状态（自检）',
    detail: '模型配置、上次捕获的范围、状态栏此刻的文案',
    command: 'anchorExplain.showState',
  },
  {
    id: 'openPdf',
    group: 'line2',
    title: '用 Anchor 打开 PDF',
    detail: '不改变你原来的默认打开方式（我们的视图只是「打开方式」里的一个候选）',
    command: 'anchorPdf.openInAnchorViewer',
    requires: 'peer',
  },
  {
    id: 'selectRegion',
    group: 'line2',
    title: '框选 PDF 区域',
    detail: '在 Anchor 的 PDF 视图里框一块，交回线1 讲解（线2 只负责定位，不在 PDF 上画框）',
    command: 'anchorPdf.selectRegion',
    chordId: 'selectRegion',
    requires: 'peer',
  },
  {
    id: 'goto',
    group: 'session',
    title: '跳到指定步',
    detail: '讲解进行中才可用',
    command: 'anchorExplain.goto',
    chordId: 'goto',
    requires: 'session',
  },
];

/** 唯一的 id → 动作查表。**宿主只用这一个入口**决定"能不能执行、执行什么"（见 `StartToHost`）。 */
export function findStartAction(id: string): StartActionSpec | undefined {
  return START_ACTIONS.find((action) => action.id === id);
}

export interface StartActionView {
  readonly id: StartActionId;
  readonly title: string;
  /** 正常时是 `detail`，被禁用时换成**缺什么**（"灰按钮为什么灰"必须写在脸上） */
  readonly note: string;
  /** 用户实际绑的键，格式化好的；`null` = 没绑（面板改说"命令面板里找"） */
  readonly chord: string | null;
  readonly enabled: boolean;
}

export interface StartSection {
  readonly id: StartGroupId;
  readonly title: string;
  readonly actions: StartActionView[];
}

export type StartTone = 'ok' | 'warn' | 'muted';

export interface StartStatusItem {
  readonly label: string;
  readonly value: string;
  readonly tone: StartTone;
}

export interface StartModel {
  /** 面板顶部那句「随时按 X 打开这里」用的键；没绑就是 null */
  readonly openChord: string | null;
  readonly sections: StartSection[];
  readonly status: StartStatusItem[];
}

export interface StartModelInput {
  /** 用户实际绑定（`statusBar.chords()` 的同一份） */
  readonly chords: ResolvedChords;
  readonly providerReady: boolean;
  /** `describeConfig(...)` 的结果，原样显示 —— 配置好不好只有用户自己能判 */
  readonly providerSummary: string;
  readonly peerInstalled: boolean;
  /** `captureSummary(...)` 的结果；`null` = 还没捕获过 */
  readonly captureSummary: string | null;
  readonly session: {
    readonly index: number;
    readonly total: number;
    readonly state: WalkthroughState;
    readonly stale: boolean;
  } | null;
}

const REQUIREMENT_REASON: Record<StartRequirement, string> = {
  // 说清缺什么，并**指出下一步按哪个按钮**（D61）：灰按钮只写"缺钱"不写"去哪儿取"，
  // 就是把这句提示变成一句废话。
  provider: '还没有配 anchorExplain.providers —— 先用上面那颗「打开设置」填 baseUrl 与 tier1Model',
  peer: '没有安装线2（anchor.anchor-pdf）',
  session: '现在没有进行中的讲解',
};

/**
 * 状态 → 面板。**无副作用、无 IO**：调用方把状态读好了丢进来。
 *
 * 状态项与动作的**排序都是固定的**（不按状态重排）：门厅每次打开都长一个样，
 * 用户第二次进来时手不用重新找按钮。禁用只是灰掉，不隐藏。
 */
export function buildStartModel(input: StartModelInput): StartModel {
  const ready: Record<StartRequirement, boolean> = {
    provider: input.providerReady,
    peer: input.peerInstalled,
    session: input.session !== null,
  };

  const sections: StartSection[] = [];
  for (const group of GROUP_ORDER) {
    const actions = START_ACTIONS.filter((action) => action.group === group).map((action) => {
      // 缺什么就说什么：`missing` 有值 = 这个动作现在按不动，`note` 换成**缺的那件事**。
      const missing = action.requires !== undefined && !ready[action.requires] ? action.requires : undefined;
      const chord = action.chordId ? formatOf(input.chords, action.chordId) : null;
      return {
        id: action.id,
        title: action.title,
        note: missing === undefined ? action.detail : REQUIREMENT_REASON[missing],
        chord,
        enabled: missing === undefined,
      };
    });
    if (actions.length > 0) sections.push({ id: group, title: START_GROUP_TITLES[group], actions });
  }

  const session = input.session;
  const status: StartStatusItem[] = [
    {
      label: '模型',
      value: input.providerSummary,
      tone: input.providerReady ? 'ok' : 'warn',
    },
    {
      label: '线2',
      value: input.peerInstalled ? 'anchor-pdf 已安装' : 'anchor-pdf 未安装（PDF 那条线用不了）',
      tone: input.peerInstalled ? 'ok' : 'warn',
    },
    {
      label: '上次捕获',
      value: input.captureSummary ?? '还没有捕获过',
      tone: 'muted',
    },
    {
      label: '讲解',
      value: session
        ? `第 ${session.index + 1}/${session.total} 步 · ${STATE_WORD[session.state]}${session.stale ? ' · 文件已改动' : ''}`
        : '没有进行中的讲解',
      tone: session ? 'ok' : 'muted',
    },
  ];

  return {
    openChord: formatOf(input.chords, 'showStart'),
    sections,
    status,
  };
}

/**
 * 用户解绑（`null`）与空串统一收成 `null`：面板只说"没绑"，不说"绑了个空的"。
 *
 * 判据写成"不是非空字符串"而不是 `=== null || === ''`：**面板白屏**是这个切片最该防的一类失败，
 * 而这里一旦漏进 `undefined`，`formatChord` 会去 `split` 一个不是字符串的东西并抛在渲染路径上。
 */
function formatOf(chords: ResolvedChords, id: ChordId): string | null {
  const chord = chords[id];
  if (typeof chord !== 'string' || chord === '') return null;
  return formatChord(chord);
}
