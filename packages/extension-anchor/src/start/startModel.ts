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
import { HANDOFF_PROMPT } from '../external/handoffParse.ts';

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
  | 'showHistory'
  | 'reExplain'
  | 'loadHandoff'
  | 'reopenHandoff'
  | 'goto';

export type StartGroupId = 'start' | 'handoff' | 'segments' | 'line2' | 'session';

/** 前置条件。缺了就不给点，并且**说清缺什么** —— 灰按钮不说理由是最气人的一种 UI。 */
export type StartRequirement = 'provider' | 'peer' | 'session' | 'queue' | 'lastRun' | 'handoff';

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
  handoff: '外部 Agent 改的地方',
  segments: '多段选择（队列）',
  line2: '线2（PDF）',
  session: '这次讲解',
};

/** 组在面板上的固定顺序。`start` 在最上面 —— 门厅第一眼要看到的是"从哪儿开始"。 */
const GROUP_ORDER: readonly StartGroupId[] = ['start', 'handoff', 'segments', 'line2', 'session'];

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
    id: 'showHistory', group: 'session', title: '讲解历史',
    detail: '查看完整留档，重新打开以前的讲解，或删除、清空历史',
    command: 'anchorExplain.showHistory',
  },
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
    /*
     * D130：**外部 Agent 的位置交接**（用户要的"投币机"）。
     *
     * @anchor 为什么它是**一条动作**而不是像 `askFocus` 那样弹一个输入框：
     *         用户明确说"开始界面放一个输入框，然后添加一个按钮，类似投币机的逻辑"——
     *         也就是输入框**常驻在面板上**，投什么由他决定，按下去才动。
     *         而 `anchorExplain.capture` 那条路（选中 → 点按钮）是"投币机"之外的常规路径，
     *         两条并列摆着，用户按场合挑。
     *
     *         它**不需要 provider**（生成临时文件不联网、不花 token），
     *         所以不像 `capture` 那样有前置条件 —— 没配 API Key 也能用，
     *         只是点下去之后不能立刻讲（那一步才需要 provider）。
     */
    id: 'loadHandoff',
    group: 'handoff',
    title: '我粘的位置 → 生成临时文件',
    detail: '把外部 Agent 给的位置清单粘进上面的框（也可以把那个文件拖进来），点这里把涉及的代码列成一份临时文件',
    command: 'anchorExplain.loadHandoff',
  },
  {
    /*
     * "再呼出"（用户原话：「这个文件是我们的一个按钮可以再次呼出（防止讲解切换文件丢掉路径）」）。
     *
     * @anchor 为什么非有不可：临时文档是**固定标签**，但用户还是可能手滑关掉它，
     *         或者被别的操作顶走。没有这颗按钮，他就要**重新粘一遍** ——
     *         而粘贴的内容可能已经不在剪贴板里了（他当时是从 Agent 的对话里复制的）。
     *         有它，草稿与内容都还在宿主手里，一键拿回来。
     */
    id: 'reopenHandoff',
    group: 'handoff',
    title: '重新打开临时文件',
    detail: '讲解跳到别的文件之后，临时文件被顶掉了 —— 点这里把它拿回来（内容还在）',
    command: 'anchorExplain.reopenHandoff',
    requires: 'handoff',
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
  /**
   * 讲解面板的字号缩放系数（D89）。开始面板跟随同一个系数（`startStyles.ts` 的同一
   * 条 calc）—— 两个面板的字一起变大变小，比各调各的更符合"字号"这个词的直觉。
   * 客户端每次收到模型就应用一次，所以系数变了不需要专门的推送通道。
   */
  readonly fontScale: number;
  /**
   * 【D130】输入框里的草稿。面板每次重画都从这里回填 ——
   * 不然面板一刷新（"现在"那一栏变了就会刷新），用户粘进去的字**全没了**。
   */
  readonly handoffDraft: string;
  /**
   * 【D130】给外部 Agent 抄的那段要求（`handoffParse.ts` 的 `HANDOFF_PROMPT`）。
   *
   * @anchor 为什么让**模型**带着它上一趟而不是写死在客户端脚本里：那段文字要与
   *         `parseHandoff` 认的形状**始终一致** —— 写死两处，改一处忘一处就会出现
   *         "面板教对方写一种、解析器只认另一种"，而表现是"用户照做了却解析不出"。
   *         从同一个常量来，就不可能分家。
   *
   * **可选**：同 `fontScale` 那条理由（缺了就按 `HANDOFF_PROMPT` 的当前值填）。
   */
  readonly handoffPrompt?: string;
  readonly sections: StartSection[];
  readonly status: StartStatusItem[];
}

export interface StartModelInput {
  /** 用户实际绑定（`statusBar.chords()` 的同一份） */
  readonly chords: ResolvedChords;
  /**
   * 讲解面板的字号缩放系数（D89）。**可选**：调用方忘了给就按 1 走 ——
   * 这份模型是纯函数的输出，缺一个系数不该让它的既有调用点（含测试）全部跟着改。
   */
  readonly fontScale?: number;
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
   * 【D130】位置交接：**输入框里的草稿**（用户粘进去的那段位置清单）。
   *
   * @anchor 为什么要**由宿主**把它传回来，而不是让 webview 自己记着：
   *         `startClientScript.ts` 的 `render()` 每次都 `root.textContent = ''` ——
   *         面板一重画（比如"现在"那一栏变了），输入框里的字就**全没了**。
   *         用户的输入必须活在**面板之外**（与侧边栏的 `askDrafts` 同一条套路，D126）。
   *
   * **可选**：与 `fontScale` 同一条理由 —— 这份输入是纯函数的入参，
   * 缺了它按"没有草稿"走，不该让既有调用点（含测试）全跟着改。
   */
  readonly handoffDraft?: string;
  /**
   * 【D130】已经有一份临时文件了（内容还在宿主手里）。
   * `false` = 「重新打开临时文件」那颗按钮灰掉（还没有东西可打开）。
   *
   * **可选**，同上：缺了按 `false` 走（那是默认的"还没生成过"）。
   */
  readonly hasHandoff?: boolean;
  /** 【D130】那份临时文件里有多长 / 涉及几个文件 —— 显示在状态栏那一行。可选，缺了当没有。 */
  readonly handoffSummary?: string | null;
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
  // D130：还没有生成过临时文件。出路就在同一组的上一颗按钮。
  handoff: '还没有生成过临时文件 —— 先把位置粘进上面的框，按「我粘的位置 → 生成临时文件」',
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
    // 可选字段缺省按"还没有"走 —— 见 `StartModelInput.hasHandoff` 那段注释
    handoff: input.hasHandoff === true,
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
      // D130：那一份临时文件现在是什么样。**空的时候也要指出下一步**（D61 同一条）。
      label: '临时文件',
      value: input.handoffSummary ?? '还没有 —— 把位置粘进上面的框，再点「生成临时文件」',
      tone: input.handoffSummary === null ? 'muted' : 'ok',
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
    fontScale:
      typeof input.fontScale === 'number' && Number.isFinite(input.fontScale) && input.fontScale > 0
        ? input.fontScale
        : 1,
    // D130：草稿原样带回去 —— 面板重画之后要把它填回输入框（见 `StartModelInput` 那段注释）。
    // **夹一下长度**：这条模型每拍都可能被重建并整份推给 webview，
    // 一个几十 KB 的草稿挂在热路径上不值得（真正的上限判据在 `handoffParse` 那里）。
    handoffDraft: typeof input.handoffDraft === 'string' ? input.handoffDraft.slice(0, MAX_HANDOFF_DRAFT_CHARS) : '',
    handoffPrompt: HANDOFF_PROMPT,
    sections,
    status,
  };
}

/**
 * 草稿在模型里最多带这么长（D130）。**与 `handoffParse` 的 64KB 上限是两回事**：
 * 那个判"粘进来的东西能不能处理"，这个判"每拍推给面板的模型能有多大"。
 * 粘超长内容时用户会看到明确的拒绝（带数字），所以这里悄悄截断不会有信息损失。
 */
const MAX_HANDOFF_DRAFT_CHARS = 8 * 1024;

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
