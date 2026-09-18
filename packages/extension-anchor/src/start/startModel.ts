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
  | 'addSegment'
  | 'explainSegments'
  | 'clearSegments'
  | 'configure'
  | 'openSettings'
  | 'setApiKey'
  | 'showState'
  | 'openPdf'
  | 'selectRegion'
  | 'replayLast'
  | 'reExplain'
  | 'goto';

export type StartGroupId = 'start' | 'segments' | 'line2' | 'session';

/** 前置条件。缺了就不给点，并且**说清缺什么** —— 灰按钮不说理由是最气人的一种 UI。 */
export type StartRequirement = 'provider' | 'peer' | 'session' | 'queue' | 'lastRun';

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
  segments: '多段选择（队列）',
  line2: '线2（PDF）',
  session: '这次讲解',
};

/** 组在面板上的固定顺序。`start` 在最上面 —— 门厅第一眼要看到的是"从哪儿开始"。 */
const GROUP_ORDER: readonly StartGroupId[] = ['start', 'segments', 'line2', 'session'];

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
    // **门厅不许是死路**（D61），而且**能一步做完的就别让人去别处做**（D62）。
    // 用户在这个台阶上连续卡了两次（找不到入口 → 手写 JSON 把 settings.json 写坏），
    // 所以"配端点"从"带你去看设置"升级成"点三下配好"。
    id: 'configure',
    group: 'start',
    title: '配置模型端点',
    detail: '三个输入框：provider id、baseUrl、模型名 —— 直接写进设置，写完就能用',
    command: 'anchorExplain.configure',
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
    // 放在这一组的**最后**：前四条是"把事做完"，这条是"我要自己改"。
    id: 'openSettings',
    group: 'start',
    title: '打开设置',
    detail: '要改别的项（取件轮数、温度、多个 provider）时用这个',
    command: 'anchorExplain.openSettings',
  },
  /**
   * D80：多段选择。**这三颗按钮就是"左侧实时增减"的全部入口**。
   *
   * 为什么做成"三个动作 + 一个状态行"，而不是在面板里画一棵可编辑的清单：
   * 开始面板的成员两张表就够。而"移除第 3 段"这类操作需要一个**可变参数**
   * （移哪个），webview 只回传动作 id（§5.5 的安全约定：面板不许指定命令参数）。
   * 所以移除走 `addSegment`/`clearSegments` 之外的第三条路 —— 见 `anchorExplain.goto`
   * 那种"需要开一个选择 UI"的既有做法，队列的移除同理用 QuickPick 完成。
   */
  {
    id: 'addSegment',
    group: 'segments',
    title: '把选中的一段加入队列',
    detail: '先在编辑器里选中一段，再按下面这个键 —— 一次一段，可以反复加。换文件时会问你要不要清空',
    command: 'anchorExplain.addSegment',
    chordId: 'addSegment',
  },
  {
    id: 'explainSegments',
    group: 'segments',
    title: '讲队列里的全部段',
    detail: '合成一份讲解：多段属于同一个功能时，能讲出数据怎么在其中流动',
    command: 'anchorExplain.explainSegments',
    requires: 'queue',
  },
  {
    id: 'clearSegments',
    group: 'segments',
    title: '清空队列',
    detail: '把攒下来的几段一次丢掉',
    command: 'anchorExplain.clearSegments',
    requires: 'queue',
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
  /**
   * D83：讲完之后的两个出口。用户的原话是「讲解结束时，需要能重新讲，
   * 并且应该能保存/重放之前的内容」。
   *
   * @anchor 为什么这两条**也**要出现在开始面板（面板上明明已经有了）：它们要在
   *         **讲解根本不存在**的时候可达 —— 用户关掉讲解面板、重开 VS Code 之后
   *         想再看一遍上次那份，此时屏幕上没有任何"结束"的痕迹，只有这个门厅。
   *         两颗按钮**分开**是刻意的，代价差一个数量级（见 `session/lastRun.ts`）：
   *         重放不花钱、结果逐字相同；重新讲要再问一次模型、会得到另一种讲法。
   *         把选择权留给用户，我们不替他决定要不要再花一次钱。
   */
  {
    id: 'replayLast',
    group: 'session',
    title: '重放上次讲解',
    detail: '不再问模型：把上次那份讲解从第 1 步重新走一遍，结果与上次一模一样',
    command: 'anchorExplain.replayLast',
    requires: 'lastRun',
  },
  {
    id: 'reExplain',
    group: 'session',
    title: '重新讲一遍',
    detail: '用同一个锚点再问一次模型 —— 想要另一种讲法时用这个（会再花一次钱）',
    command: 'anchorExplain.reExplain',
    requires: 'lastRun',
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
  /**
   * 多段选择队列（D80）。**没有第五张表**：队列的行就在 `commands.ts` 手里，
   * 这里只收"该显示什么"（`null` = 队列是空的，那一组按钮整体灰掉）。
   */
  readonly queueSummary: string | null;
  /**
   * 队列里有几段（D81）。`0` = 空。
   *
   * @anchor 为什么明明有 `queueSummary` 还要一个数字：那句话是给"读"的
   *         （"2 段（main.c 第 21-25 + 40-48 行）"，一长串），而用户点完「加入队列」
   *         最想确认的是**数字变了没有**。分组标题就写在他刚点的那颗按钮正上方，
   *         比任何别处的提示都近 —— 滚都不用滚。
   */
  readonly queueCount: number;
  /**
   * 存下过至少一份讲解（D83）。`false` = 「重放上次讲解」「重新讲一遍」两颗按钮灰掉。
   *
   * @anchor 传布尔而不是把 `LastRun` 本身递进来（明明那样信息更全）：面板要显示的是
   *         **"能不能重放"**这一件事，`LastRun` 里的 steps 有几十 KB ——
   *         让一个纯函数（每拍都可能被调一次，见 `refreshStartOn`）去拿着它，
   *         等于把一个"渲染不用"的大对象挂进了每拍的热路径。要显示"存的是哪一段"
   *         由 `显示状态` 那条命令负责，它本来就在做这件事。
   */
  readonly hasLastRun: boolean;
  /**
   * 正在进行的阶段（D64），例如"正在请求模型…"。有值就压过会话那一行 ——
   * **模型在背后跑的时候，屏幕上必须有东西在动**，否则用户会以为没反应而再点一次。
   */
  readonly busy?: string;
  readonly session: {
    readonly index: number;
    readonly total: number;
    readonly state: WalkthroughState;
    readonly stale: boolean;
  } | null;
}

const REQUIREMENT_REASON: Record<StartRequirement, string> = {
  // 说清缺什么，并**指出下一步按哪颗按钮**（D61）：灰按钮只写"缺钱"不写"去哪儿取"，
  // 就是把这句提示变成一句废话。名字必须写全 —— 面板上的顺序会变，"上面那颗"会过期。
  provider: '还没有配 anchorExplain.providers —— 先用「配置模型端点」填一下（三个输入框）',
  peer: '没有安装线2（Fish-zjuer.anchor-pdf）',
  session: '现在没有进行中的讲解',
  queue: '队列是空的 —— 先选中一段，按「把选中的一段加入队列」',
  // D83：还没有任何存档时的理由。同样要**指出下一步按哪颗按钮**（D61）——
  // 用户看的正是"这两颗灰按钮"，而解药就在同一个面板的第一组里。
  lastRun: '还没有讲过任何一段 —— 先用「讲解选中的代码」讲一次，之后就能重放或重新讲',
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
    queue: input.queueSummary !== null,
    lastRun: input.hasLastRun,
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
    if (actions.length > 0) {
      // 队列那一组的标题带上数量（D81）：用户点完「加入队列」抬头就能看见"已有 2 段"，
      // 不必滚到面板最下面去找那一行状态。
      const title =
        group === 'segments' && input.queueCount > 0
          ? `${START_GROUP_TITLES[group]} · 已有 ${input.queueCount} 段`
          : START_GROUP_TITLES[group];
      sections.push({ id: group, title, actions });
    }
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
      label: '多段队列',
      // 队列空的那一句要**指出下一步**（D61）：只写"空"等于让用户猜下一步去哪。
      value: input.queueSummary ?? '空 —— 选中一段，再按「把选中的一段加入队列」',
      tone: input.queueSummary === null ? 'muted' : 'ok',
    },
    {
      label: '讲解',
      value: input.busy
        ? input.busy
        : session
          ? `第 ${session.index + 1}/${session.total} 步 · ${STATE_WORD[session.state]}${session.stale ? ' · 文件已改动' : ''}`
          : '没有进行中的讲解',
      tone: input.busy ? 'ok' : session ? 'ok' : 'muted',
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
