/**
 * 四层装配 + §4.1 全部命令。事实源：docs/CONTRACTS.md §4.1。
 *
 * @anchor **本文件已经没有任何替身**（S3 收掉了最后一个）。
 *
 *         S1 有两处（假选区 / 假 AI），S2 删掉假选区，S3 删掉假 AI ——
 *         两次删除都只动了"来源"，中间链路
 *         （校验 → 会话 → decoration → 侧边栏 → 状态栏）一行没改。
 *         这就是把假货关在最外层边界想要的结果（D17/D18）。
 *
 * 装配顺序（STATE.md 里写死的）：commands → sidebar → playback → statusbar。
 */

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import {
  AnchorError,
  basenameOf,
  compareSegments,
  createContextRequestLogger,
  describeError,
  dirnameOf,
  isAnchorError,
  isCodeLocation,
  isPDFLocation,
  describeSegments,
  locationLabel,
  mergeSegments,
  samePath,
  segmentsOf,
} from '@anchor/core';
import type { AnchorSegment } from '@anchor/core';
import type {
  Anchor,
  CodeLocation,
  ContextRequest,
  ContextRequestLogEntry,
  ContextRequestLogger,
  EditorPort,
  ExplanationResult,
  FileSystemPort,
  WalkthroughStep,
} from '@anchor/core';
import { createCodeAdapter } from './adapters/CodeAdapter.ts';
import { createPdfAdapter } from './adapters/PDFAdapter.ts';
import { createPdfDocumentCache } from './adapters/pdf/pdfDocumentCache.ts';
import { createPdfJsSource } from './adapters/pdf/pdfjsSource.ts';
import { splitDocument } from '@anchor/pdf-blocks';
import { readSplitInput } from './blocks/blockSource.ts';
import { BlockStreamPanel } from './blocks/BlockStreamPanel.ts';
import type { BlockStreamHandlers } from './blocks/BlockStreamPanel.ts';
import { reconciled, streamStateOf } from './blocks/streamHost.ts';
import type { StreamState } from './blocks/streamHost.ts';
import { primaryLocationOf } from './playback/decorationPlan.ts';
import type { CaptureScope } from './adapters/CodeAdapter.ts';
import { coerceLanguage, describeLanguage } from './prompts/index.ts';
import type { ExplainLanguage } from './prompts/index.ts';
import {
  DEFAULT_ACTIVE_PROVIDER,
  checkBaseUrl,
  describeConfig,
  describeFetchScope,
  coerceFetchScope,
  coerceSidebarStyle,
  looksFlattened,
  normalizeBaseUrl,
  promoteFlattenedProviders,
} from './config.ts';
import type { SidebarStyle } from './config.ts';
import { captureSummary } from './describe.ts';
import { buildCandidateFiles, includeNamesIn } from './relatedFiles.ts';
import { scanCodeFiles } from './vscode/relatedFiles.ts';
import { createOrchestrator } from './orchestrator/Orchestrator.ts';
import { createModelRouter } from './orchestrator/ModelRouter.ts';
import { createOpenAICompatibleProvider, describeEndpointProbe } from './orchestrator/providers/openAICompatible.ts';
import { addUsage } from './orchestrator/providers/types.ts';
import type { TokenUsage } from './orchestrator/providers/types.ts';
import { describeIssues, validateExplanation } from './orchestrator/validateExplanation.ts';
import { describeFetched } from './orchestrator/validateContextRequest.ts';
import { isAnchorLike } from './protocol.ts';
import { LAST_RUN_KEY, readLastRun, toStoredRun } from './session/lastRun.ts';
import type { LastRun } from './session/lastRun.ts';
import { createArchiveStore } from './session/archive.ts';
import { HistoryPanel } from './sidebar/HistoryPanel.ts';
import { LAST_FOCUS_KEY, readLastFocus } from './session/lastFocus.ts';
import { CodeWalkthroughPlayer } from './playback/CodeWalkthroughPlayer.ts';
import { WalkthroughSession } from './playback/WalkthroughSession.ts';
import type { WalkthroughSnapshot } from './playback/WalkthroughSession.ts';
import { SidebarPanel } from './sidebar/SidebarPanel.ts';
import type { SidebarHandlers } from './sidebar/SidebarPanel.ts';
import { createQueueStatusBar, createStatusBar } from './sidebar/statusBar.ts';
import { StartViewProvider } from './start/StartViewProvider.ts';
import { buildStartModel, findStartAction } from './start/startModel.ts';
import type { StartModel } from './start/startModel.ts';
import { buildHandoff, HandoffError } from './external/handoffBuild.ts';
// D132：提示词本体在宿主手里 —— 面板只说"复制"，由这里取常量写剪贴板。
import { HANDOFF_PROMPT, parseHandoff } from './external/handoffParse.ts';
import { readSourceSegments, snapshotHandoffSelection, sourceSegmentsAnchor } from './external/queueSegments.ts';
import {
  buildHandoffDoc,
  describeMapped,
  HANDOFF_SCHEME,
  mapSelection,
} from './external/handoffDoc.ts';
import type { HandoffDoc } from './external/handoffDoc.ts';
import {
  createHandoffDocumentProvider,
  openHandoffDocument,
} from './vscode/handoffDocumentProvider.ts';
import type { HandoffDocumentProvider } from './vscode/handoffDocumentProvider.ts';
import { relatedRoots } from './orchestrator/validateContextRequest.ts';
import type { ContextFetchPolicy, FetchScope } from './orchestrator/validateContextRequest.ts';
import {
  configuredProviderIds,
  rawProvider,
  rawProviders,
  readAnchorConfig,
  storeApiKey,
  writeProviderSettings,
} from './vscode/configSource.ts';
import { createEditorPort } from './vscode/ports/editorPort.ts';
import { countLines, createFileSystemPort } from './vscode/ports/fileSystemPort.ts';
import { createProblemsVeil } from './vscode/problemsVeil.ts';
import { explanationMarkdown, exportFileStem } from './session/exportNotes.ts';
import { FONT_SCALE_KEY, clampFontScale, stepFontScale } from './sidebar/fontScale.ts';

/** 线2 的扩展 ID（D27 定名，D86 起挂到作者自己的 publisher 下）。对端缺失时必须明确提示，不静默失败。 */
const PDF_EXTENSION_ID = 'Fish-zjuer.anchor-pdf';

/**
 * 线2 装没装。三处问的是同一个问题（`revealStep` / `runStartAction` / `showState`），
 * 所以只留一个问法 —— 三处各写一遍 `vscode.extensions.getExtension(...)` 的那种写法，
 * 第一次改 ID 时就会漏掉一处。
 */
function peer(): vscode.Extension<unknown> | undefined {
  return vscode.extensions.getExtension(PDF_EXTENSION_ID);
}

/**
 * 对端**有没有**这条命令。
 *
 * @anchor 为什么需要它（D76）：两条线是**各自安装**的（D27），"装了线2"不等于"线2 是新版"。
 *         对着旧版线2 直接 `executeCommand('anchorPdf.flashRegion', …)` 会抛
 *         "command 'anchorPdf.flashRegion' not found" —— 那句话对用户毫无意义，
 *         而他其实只想要"滚到那一页"。查一下声明，能闪就闪、不能闪就退回老行为。
 *         判据用 `packageJSON.contributes.commands`（那是**对端自己声明的**能力清单，
 *         与我们这边的 `peer()` 用同一个来源，不另发明探测方式）。
 */
function peerHasCommand(id: string): boolean {
  const declared = peer()?.packageJSON?.contributes?.commands as { command?: string }[] | undefined;
  return Array.isArray(declared) && declared.some((entry) => entry.command === id);
}

/**
 * 弹给用户的那句话：**不带错误码**。
 *
 * @anchor 为什么专门写一个：`describeError` 给的是 `PROVIDER_ERROR: 没有可用的 provider（…）` ——
 *         那个码是**给我们排查用的**，用户看到它只会以为是"报错编号"，还会以为是扩展坏了。
 *         真正需要码的时候：错误里的中文说明已经说清该怎么办，而取件/调用记录在输出面板「Anchor」通道。
 *         （判断成败仍然靠码，所以状态机、校验、日志一律继续用 `describeError`。）
 */
function userFacing(err: unknown): string {
  return isAnchorError(err) ? err.message : describeError(err);
}

/**
 * 跨文件取件的边界（S9a）：按档位与工作区根构造策略，**并把清单一起算出来**。
 *
 * @anchor 四个值对应四种边界，**`off` 时 roots 为空**（连锚点目录都不给）——
 *         那是 S1~S8 的行为，也是回退档。四个档位的边界出处是两处：
 *         `same-dir` 只给锚点目录一个 root；`related` 的范围算法**不在这里**，
 *         在 `relatedRoots`（D117）—— 它要判"锚点在工作区里吗"，那是纯逻辑，
 *         得能被 `node --test` 钉住；`any` 的 roots 只当**额外候选**用（不过滤）。
 *
 * @anchor S9a-fix10（D119）起这份 `roots` **也用来筛清单**：清单与闸门从此共用一份判据，
 *         "清单里点得到、取件却读不到"不再可能出现。`any` 档**不给清单**
 *         （整个文件系统列不完），改由 `find_files` 工具让模型自己查。
 *
 * @anchor 第 7 个参数是**这次讲解涉及的其他文件**（D130 第六节）：多段锚点时，
 *         队列里的每一段都该享受和主段一样的邻域。传空数组就是原来的形状。
 */
async function buildFetchBoundary(
  scope: FetchScope,
  anchorFile: string,
  anchorText: string,
  maxLines: number,
  maxCandidates: number,
  onScanError?: (err: unknown) => void,
  otherFiles: readonly string[] = [],
): Promise<{ policy: ContextFetchPolicy; pool: readonly string[] }> {
  const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
  const roots =
    scope === 'off'
      ? []
      : scope === 'same-dir'
        ? [dirnameOf(anchorFile), ...otherFiles.map(dirnameOf).filter((d) => d !== '')]
        : [...relatedRoots(anchorFile, workspaceRoots, otherFiles)];

  const pool = await scanCodeFiles({
    // S9a-fix11（D123）：把本次允许的根一并交给扫描器 —— 工作区文件夹盖不住的那些根
    // （**只打开了一个文件**是最常见的形状）必须自己去走一遍，否则范围里有、池子里没有，
    // 清单就是空的，而清单即范围 ⇒ 一个别的文件都读不到（用户实测的那次失败）。
    roots,
    // 「不限」档的 `find_files` 拿池子当"文件系统地图"，所以那一档要多扫一些
    unbounded: scope === 'any',
    ...(onScanError !== undefined ? { onError: onScanError } : {}),
  });

  // 「不限」档**不给清单** —— 它的范围是整个文件系统，列不完；改由 `find_files` 让模型自己查
  if (scope === 'any') return { policy: { scope, roots, maxLines }, pool };

  const candidates = buildCandidateFiles({
    files: pool,
    anchorFile,
    workspaceRoot: workspaceRoots[0] ?? '',
    roots,
    includeNames: includeNamesIn(anchorText),
    limit: maxCandidates,
  });
  return { policy: { scope, roots, maxLines, candidates }, pool };
}

/**
 * 一段原文的第一行，截到 60 字符 —— 给"队列里第 N 段是哪一行"这类清单当附注。
 *
 * @anchor 为什么要有这一行附注：只有行号时，用户看到的是"第 1 段：第 21-25 行"，
 *         而他脑子里记的是**内容**（"那个初始化那段"）。带上一行原文，他不用回去翻代码
 *         就知道哪一段是哪一段 —— 而"选错了要移除哪一段"正是最容易选错的一步。
 */
function firstLineOf(text: string): string {
  return (text.split(/\r?\n/)[0] ?? '').trim().slice(0, 60);
}

/**
 * 存档时间的人话（D83）。**不走 `toLocaleString`**：那会随系统区域变，
 * 于是同一份存档在不同机器上印出不同形状的字符串 —— 而这句话是要被断言、被复述的。
 */
function stampOf(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '时间未知';
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function registerCommands(context: vscode.ExtensionContext): void {
  const fsPort: FileSystemPort = createFileSystemPort();

  // 真选区（S2）。这里不再有任何覆盖：命令层拿到的就是编辑器里那个选区，
  // 以及（「整个文件」分支要的）当前文档的全文与行数。
  const editorPort: EditorPort = createEditorPort();
  const codeAdapter = createCodeAdapter({ editor: editorPort, fs: fsPort });

  // S7：PDF 侧。缓存是有界 LRU（打开一份 30 页 PDF 要读盘 + 解析，同一轮讲解会问好几次），
  // 淘汰时释放句柄 —— 见 pdfDocumentCache.ts 的注释。
  // 读字节走 `fsPort`（= `workspace.fs`）注入进去，而不是让适配器自己去 `node:fs`：
  // remote / 虚拟文件系统只有前者读得到，而后者会**静默读到空**（D75）。
  // `onError` 接到输出通道（D74）：拿不到页数就会导致"按页取件全被拒"，
  // 而这条路上过去没有任何痕迹 —— 用户只看到闸门说"无法确定总页数"。
  const pdfCache = createPdfDocumentCache(createPdfJsSource({ bytes: fsPort }));
  const pdfAdapter = createPdfAdapter({
    cache: pdfCache,
    onError: (message) => note(message),
  });

  /**
   * 按锚点选适配器。
   *
   * @anchor **为什么不是用 §3 的 `detect()`**：`detect()` 问的是"当前环境适不适用"，
   *         而我们的环境里同时可能开着代码编辑器和 PDF —— 那个问题没有唯一答案。
   *         锚点自己带着 `sourceType`，那是**确定的**依据。
   *         `detect()` 因此在我们的架构里一直没有消费者（`CONTRACTS` §9.2 记着这条判断）。
   */
  function adapterFor(anchor: Anchor) {
    return anchor.sourceType === 'pdf' ? pdfAdapter : codeAdapter;
  }

  const status = createStatusBar(context);
  // 队列的常驻计数（D81）。与 `status` 分开：讲解结束后那一项要收掉，队列不空就得一直挂着。
  const queueBar = createQueueStatusBar();

  /**
   * 取件日志的落点（§7 要求每个 `ContextRequest` 都记录，含被拒的）。
   * 侧边栏的 ToolTrace 面板还没做（不在任何切片范围内），所以先落到输出通道 ——
   * 排查"模型为什么讲歪了"时，这张表是唯一能看的东西。
   *
   * **同一份记录还要喂给进度**（D64）：用户的原话是"AI 的操作在背后看不到会有焦虑感"，
   * 而取件正是最该被看见的那一段 —— 它在等磁盘/等解析，屏幕上却毫无动静。
   */
  let output: vscode.OutputChannel | undefined;
  /** 当前这次讲解的进度回调。`explain` 期间有值，结束就清掉（避免下一轮误用）。 */
  let onPhase: ((message: string) => void) | undefined;
  /**
   * 往输出通道写一行**不打断讲解**的诊断信息。与取件日志共用通道 —— 排查时只看一个地方。
   * 用它的人都是"降级但不该静默"的情形（如候选清单扫不出来），见 D67。
   */
  const note = (message: string): void => {
    output ??= vscode.window.createOutputChannel('Anchor');
    output.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
  };
  /** 从请求里取"读的是哪一段"，交给 `describeFetched` 说成人话（进度通知与拒绝原因共用一套说法） */
  const spanOfRequest = (
    req: ContextRequest,
  ): { type: ContextRequest['type']; path: string | null; start: number; end: number } => {
    const { start, end } = req.params;
    return {
      type: req.type,
      path: typeof req.params.path === 'string' ? req.params.path : null,
      start: typeof start === 'number' ? start : 0,
      end: typeof end === 'number' ? end : 0,
    };
  };
  /**
   * 拒绝原因只取第一句（给进度通知用；日志里仍是全文）。
   * 那些原因很多是**写给模型的**（"写相对路径时按锚点文件所在目录算，例如…"），
   * 整段出现在一个转瞬即逝的通知里，人只会看到一堵墙（D68）。
   */
  const briefReason = (reason: string): string => {
    const cut = reason.indexOf('。');
    const first = cut >= 0 ? reason.slice(0, cut) : reason;
    return first.length > 48 ? `${first.slice(0, 47)}…` : first;
  };
  const loggerOf = (): ContextRequestLogger => {
    output ??= vscode.window.createOutputChannel('Anchor');
    return createContextRequestLogger({
      sink: (entry) => {
        const verdict = entry.accepted ? '取件' : `拒绝（${entry.rejectReason ?? ''}）`;
        output?.appendLine(
          `[${new Date(entry.at).toLocaleTimeString()}] 第 ${entry.round} 轮 ${verdict} ` +
            `${entry.request.type} ${JSON.stringify(entry.request.params)} — ${entry.request.reason}` +
            (entry.resultChars !== undefined ? `（${entry.resultChars} 字）` : ''),
        );
        if (entry.accepted && typeof entry.request.params.path === 'string') {
          // 第二道闸门（§3.3）的允许集合就靠这几行 —— 见 explain 里的 fetchedThisRun
          if (!fetchedThisRun.some((p) => samePath(p, entry.request.params.path as string))) {
            fetchedThisRun.push(entry.request.params.path);
          }
        }
        // 侧边栏那块「取件日志」（D68）。记进本轮，等面板存在时再灌 —— 取件发生在建面板之前
        traceThisRun.push(entry);
        onPhase?.(
          entry.accepted
            ? // 说人话，并且**指向正在发生的事**：取到之后紧接着就是"等它给结论"，
              // 而那一步可能要十几秒 —— 通知里停在一句取件记录上会让人以为卡住了（D68）
              `已读 ${describeFetched(spanOfRequest(entry.request))}（${entry.resultChars ?? 0} 字），正在等它的结论…`
            : // 拒绝不是错误：模型拿到这句就会改用现有信息作答，所以尾巴要朝向"正在等它作答"，
              // 而不是留在"被拒"两个字上 —— 用户会把它读成"出错了"（D68）。
              // 原因被截到第一句：那些话是**写给模型**的（教它怎么写路径），整段塞进通知就是一堵墙；
              // 全文在输出通道与侧边栏那块日志里，一个字都不少
              `第 ${entry.round} 轮取件被拒（${briefReason(entry.rejectReason ?? '')}）—— 正在等它基于现有信息作答…`,
        );
      },
    });
  };

  let player: CodeWalkthroughPlayer | undefined;
  let sidebar: SidebarPanel | undefined;
  let sidebarLanguage: ExplainLanguage | undefined;
  let playbackLanguage: ExplainLanguage | undefined;
  let start: StartViewProvider | undefined;
  let session: WalkthroughSession | undefined;
  /** 当前会话的锚点文件（D69）。`session:update` 带着它，面板据此决定要不要标文件名。 */
  let sessionAnchorPath: string | null = null;
  /**
   * 当前会话的那个锚点（D126）。追问要用它当底子 —— 追问锚点是从它派生的
   * （换 location / extractedText / focus，其余字段照抄：sourceId / sourceName）。
   *
   * @anchor 与 `session` 同生共死（`stop()` 一起清）—— 理由与 `sessionAnchorPath` 一样（D78）：
   *         留着一个上一轮的锚点，下一轮（可能是完全不相干的文件、甚至是 PDF）的追问
   *         就会拿旧锚点的 sourceName 去讲新东西。
   */
  let sessionAnchor: Anchor | undefined;
  /**
   * 有一问正在跑（D126）。与 `running` 分开：两者可以同时为真吗？不可以（追问只在讲解结束后发起），
   * 但它们是两件事 —— 一个是"模型在讲整段"，一个是"模型在答这一问"，
   * 合成一个变量的话，被挡住时说不清挡的是哪一次。
   */
  let asking = false;
  /**
   * 本次讲解累计的 token 用量（D120）。**只在内存里** —— 不落盘、不进讲解历史、
   * 不进 `workspaceState`（用户原话："程序处理，不保存"）。每次讲解开始时清空。
   */
  let usageThisRun: TokenUsage | undefined;
  /**
   * 用户在这次 VS Code 会话里**临时指定**的取件范围（D119）。`undefined` = 用设置里的值。
   *
   * @anchor 为什么是"临时"而不是直接改设置：用户的原话是"再加一个用户自己选给它什么范围的操作"——
   *         他要的是"**给这一次**什么范围"。直接写进 settings 会留下一个他不知道什么时候被改过、
   *         也不知道怎么回去的全局状态；而按档位给的四种范围本来就该跟着场合走
   *         （讲自己的模块用 `related`，读别人的 SDK 用 `any`）。
   *         所以它活在内存里：重载窗口即回到设置里的值，状态行随时说得出当前是哪一档。
   */
  let scopeOverride: FetchScope | undefined;
  /**
   * 锚点文件刚被关掉、结果**还没定**（D78）。见 `onDidCloseTextDocument` 那段：
   * 预览替换与用户主动关标签在回调里长得一模一样，要等下一次"可见编辑器变了"才能分辨。
   */
  let pendingAnchorClose = false;
  let unsubscribe: (() => void) | undefined;
  /** 每次 explain() 领一个号：慢的那次回来时若号已过期，就丢弃它的结果（见 explain） */
  let generation = 0;
  /**
   * 开始面板上一次推到 webview 的"会话维度"的指纹（见 refreshStartOn）。
   * 面板显示的是快照，而快照的其余维度（模型/对端/上次捕获）变化都走**低频**路径，
   * 只有会话维度是逐点扫描时每拍都变的 —— 只有它需要去重。
   */
  let startKey: string | undefined;
  /**
   * 这次讲解走到哪一步了（D64）。**只在与用户在的地方显示**：开始面板上那一行
   * "讲解：正在请求模型…"。没有它，模型在背后跑十几秒，屏幕上毫无动静 ——
   * 用户就会再点一次（看起来像"要点两次"）。
   */
  let busyPhase: string | undefined;
  /** 有一份讲解正在跑（D68）。用它挡住重复按下 —— 详情见 `explain` 开头那段。 */
  let running = false;
  /**
   * **本次**取件真读过的文件（S9a）。第二道 §3.3 闸门用它当"允许集合"——
   * 跨文件之后"不许漫游"的规则变成了"**你读过的文件才许引用**"。
   */
  let fetchedThisRun: string[] = [];
  /**
   * **本次**的取件记录（D68）。两条去向：输出通道（一直都在）与侧边栏那块「取件日志」。
   *
   * @anchor 为什么要暂存：`tooltrace:append` 早就定义好了、客户端也早就渲染了，
   *         **只有宿主从来没发过** —— 于是侧边栏那块永远写着"本次讲解没有请求额外上下文"，
   *         而它明明刚读了两个文件。用户就是拿着这句假话来的。
   *         暂存的另一个原因：面板是**讲解完才建**的（他是在开始面板上按的按钮），
   *         取件那几条发生在面板存在之前，只能先记下来、面板一建好再灌进去。
   */
  let traceThisRun: ContextRequestLogEntry[] = [];
  /**
   * 最近一次捕获的锚点与范围。**只为 `Anchor: 显示状态` 而留**：
   * 真选区接上之后，"我选的是不是我以为的那段"变成了唯一无法从屏幕上直接看出来的事
   * （高亮画在哪由讲解内容决定，不由选区决定）。留着它，用户按一下命令就能核对。
   */
  let lastCapture: { anchor: Anchor; scope: CaptureScope } | undefined;

  /**
   * **多段选择队列**（D80）。
   *
   * @anchor 用户要的是"一次只能选一段 → 一段段往队列里加 → 左侧能实时增减"。
   *         所以队列存的是**每一次选择当时**的完整身信息（文件 + 行区间 + 当时的原文），
   *         而不是只存行号：**用户不会一直保持选中状态** ——
   *         加完一段他就要去别的地方选下一段，那时选区已经变了。
   *         只在最后"讲这些"的那一刻才 `mergeSegments` 合成一个锚点。
   *
   *         这是它和拉一片连续选区最大的区别：**选择 → 加入 → 再选择**是三轮操作，
   *         中间隔着任意长的时间；每一步都要能单独失败、单独撤销。
   */
  let segmentQueue: AnchorSegment[] = [];
  /** 队列的选择来源。临时文档可映射出多个源文件，不能按第一个源文件判换文档。 */
  let queueOrigin: string | undefined;

  // ───────────────────────────────────────────────────────────
  // 外部 Agent 的位置交接（D130）
  // ───────────────────────────────────────────────────────────

  /**
   * 临时文档的内容提供者。**懒建**（第一次要用时才建）：
   * 它的注册是同步的、开销很小，但"激活时一个 vscode 取值都不多"是 S1 起的老规矩。
   * 已经建过就复用 —— 它内部持有着"临时文档的 URI"这个身份，
   * 而"再呼出置顶原本那份"与"下次输入原地覆盖"都依赖**同一个 URI**（D130 第十节）。
   */
  let handoffProvider: HandoffDocumentProvider | undefined;
  function handoffDocProvider(): HandoffDocumentProvider {
    if (!handoffProvider) {
      handoffProvider = createHandoffDocumentProvider();
      context.subscriptions.push(handoffProvider);
    }
    return handoffProvider;
  }

  /**
   * 那一份临时文档的**来源表**（D130）。
   *
   * @anchor 为什么它是这一片最关键的一处状态：用户二次选择时，我们手上只有
   *         "他在临时文档里选了第 3-9 行"这个信息，而**唯一**能把它翻回源文件坐标的
   *         就是这张表。它必须与 `handoffProvider` 里的内容**同生共死** ——
   *         内容换了而表没换（或反过来），映射就会指到错误的代码上，
   *         而那种错**不报错**，只会讲错东西。
   *         所以两者**只在同一个函数里一起更新**（见 `applyHandoff`）。
   */
  let handoffDoc: HandoffDoc | undefined;

  /**
   * 输入框里的草稿（D130）。
   *
   * @anchor 与侧边栏的 `askDrafts`（D126）同一条理由，只是多跨了一道 webview 边界：
   *         `startClientScript.ts` 的 `render()` 每次都 `root.textContent = ''`，
   *         面板一重画（"现在"那一栏变了就会重画），输入框里的字就全没了。
   *         草稿活在宿主手里，重画时由模型带回去。
   */
  let handoffDraft = '';

  /**
   * 临时文档里"一共多少行 / 涉及几个文件"。状态栏那一行要用（D61：空的时候也要指出下一步）。
   * `undefined` = 还没有过任何一份。
   */
  let handoffSummary: string | undefined;

  // ───────────────────────────────────────────────────────────
  // 讲解期间的「报错遮罩」（D89）
  // ───────────────────────────────────────────────────────────

  /**
   * 讲解时只留我们自己的高亮：会话开始把官方的错误/警告/提示藏起来，退出时精确还原。
   * 为什么必须是"切设置开关 + 原值还原"而不是画一层盖上去、为什么有崩溃恢复，
   * 见 `vscode/problemsVeil.ts` 的文件头。activate（即本函数）先清一次残留 ——
   * 上一个会话可能没走到 restore 就被杀了。
   */
  const veil = createProblemsVeil(context.workspaceState, (message) => note(message));
  void veil.recover();

  /**
   * **上次讲解**的那一份存档（D83）。
   *
   * @anchor 用户的原话：「讲解结束时，需要能重新讲，并且应该能保存/重放之前的内容」。
   *         在这之前，一份讲解是**一次性**的：`done` / `idle` 之后它就只活在 webview 的 DOM 里，
   *         面板一关、VS Code 一退，几十秒的等待连同花掉的 token 一起没了 ——
   *         想再看一遍只能重新问一次模型。
   *
   *         **懒加载 + try/catch**：`workspaceState` 只有真正要用它时才读，
   *         这样激活阶段一个 `vscode` 取值都不多（S1 起的老规矩），
   *         也让 `smoke-extension.mjs` 那种"只验激活"的桩不必覆盖 Memento。
   */
  let lastRun: LastRun | undefined;
  let lastRunLoaded = false;

  /**
   * 上一次真正**问了模型并成功**的那一份（D83）。读不出来就是 `undefined` —— 绝不抛：
   * 调用方是命令与面板，一个坏存档不该让整条链路炸掉。
   *
   * 存档可能来自**上一个版本的我们**（它跨 VS Code 重启活着），所以形状校验交给
   * `readLastRun`，这里只负责"读一次、记住"。
   */
  function lastRunOf(): LastRun | undefined {
    if (!lastRunLoaded) {
      lastRunLoaded = true;
      try {
        lastRun = readLastRun(context.workspaceState.get(LAST_RUN_KEY));
      } catch (err) {
        lastRun = undefined;
        note(`上次讲解存档读不出来：${describeError(err)}`);
      }
    }
    return lastRun;
  }

  /**
   * 把一份**已经过了 §3.3 闸门**的讲解记下来（D83）。
   *
   * @anchor 只在 `runExplain` 成功那一刻调用，别的地方一律不写：这份数据的意义是
   *         "我能不花钱再放一遍刚才那一份"，所以它必须是**用户真正看过的那一份**，
   *         而不是某个中间态。写失败也只是少一个功能，绝不许影响讲解本身
   *         （工作区只读、Memento 满了都可能失败），因此整段包在 try 里。
   */
  function rememberRun(
    result: ExplanationResult,
    anchor: Anchor,
    /**
     * `autoSave: false` = 更新存档但**不另写一份历史 Markdown**（D126）。
     * 追问会调用它来把"补进队列的那几步"并进存档（用户的选择：一次讲解 = 一份留档，
     * 追问**改写**它），但 history 文件夹那一份是**按时间戳命名**的 ——
     * 再写一次只会多出一个几乎相同的文件，而旧的那份仍然缺着补充讲解。
     * S13 的完整 JSON 同 ID 覆盖；旧 Markdown 保留为首次讲解的导出副本。
     */
    opts: { autoSave?: boolean } = {},
  ): void {
    // 语言跟着这一份存档走（D97）：英文讲解导出的历史文件不该顶着中文标题
    const previous = opts.autoSave === false ? lastRunOf() : undefined;
    const now = Date.now();
    const run: LastRun = { result, anchor, id: previous?.id ?? randomUUID(),
      savedAt: previous?.savedAt ?? now, updatedAt: now, language: previous?.language ?? playbackLanguage ?? languageOf(),
      ...(usageThisRun ? { usage: { ...usageThisRun } } : {}) };
    lastRun = run;
    lastRunLoaded = true;
    try {
      void Promise.resolve(context.workspaceState.update(LAST_RUN_KEY, toStoredRun(run)))
        .catch(err => note(`上次讲解没能持久保存：${userFacing(err)}`));
    } catch (err) {
      note(`上次讲解没能存下来（${describeError(err)}）—— 这一次仍然能重放，只是重启之后会丢`);
    }
    // D89：同一份存档**自动**落一份 Markdown 进历史文件夹（扩展私有目录，不进工作区）。
    // 异步、失败只进日志 —— 存历史是"多给一份"的事，没有资格拖住或弄坏讲解本身。
    if (opts.autoSave !== false) void autoSaveRun(run);
    void archive.save(run).then(refreshHistory).catch(err => {
      const message = `完整历史没能存下来：${userFacing(err)}。当前讲解仍可重放。`;
      note(message);
      historyPanel?.setError(message);
      void vscode.window.showWarningMessage(`Anchor：${message}`);
    });
    refreshStart();
  }

  // ───────────────────────────────────────────────────────────
  // 讲解历史与导出（D89）
  // ───────────────────────────────────────────────────────────

  /**
   * 历史文件夹：`globalStorage/history`。**刻意不放工作区里**：用户的选择是
   * "扩展私有目录 + 自动存" —— 每次讲解都写文件，放进工作区会让 git status
   * 被讲解记录刷屏；扩展私有目录不碰用户的东西，「打开历史文件夹」一条命令就能翻。
   */
  function historyDir(): vscode.Uri {
    return vscode.Uri.joinPath(context.globalStorageUri, 'history');
  }

  /** 自动存档。与 `rememberRun` 里对 workspaceState 的态度一致：失败说明原因，绝不抛。 */
  async function autoSaveRun(run: LastRun): Promise<void> {
    try {
      const dir = historyDir();
      await vscode.workspace.fs.createDirectory(dir);
      const file = vscode.Uri.joinPath(dir, `${exportFileStem(run.savedAt, run.anchor)}.md`);
      await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(explanationMarkdown(run)));
    } catch (err) {
      note(`讲解历史没能存下来（${describeError(err)}）—— 讲解本身不受影响`);
    }
  }

  /**
   * 「导出上次讲解为 Markdown」（D89）。**另存为**而不是悄悄写死一个位置：
   * 导出的文件用户是要拿去用的（发给同学、贴进笔记），落点该由他定 ——
   * 默认路径给到历史文件夹，想存别处直接改。
   */
  async function exportLast(): Promise<void> {
    const run = lastRunOf();
    if (!run) {
      void vscode.window.showWarningMessage('Anchor：还没有存下任何讲解 —— 先讲一次，之后就能导出。');
      return;
    }
    try {
      await vscode.workspace.fs.createDirectory(historyDir());
    } catch (err) {
      // 历史目录建不出来只影响默认路径，不该挡住另存为
      note(`历史目录建不出来（${describeError(err)}）—— 另存为仍然可用`);
    }
    const suggested = vscode.Uri.joinPath(historyDir(), `${exportFileStem(run.savedAt, run.anchor)}.md`);
    const target = await vscode.window.showSaveDialog({
      title: 'Anchor：把上次讲解导出为 Markdown',
      defaultUri: suggested,
      filters: { Markdown: ['md'] },
    });
    if (!target) return; // 用户取消：不是失败，什么也不说
    try {
      await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(explanationMarkdown(run)));
      note(`导出讲解：${target.fsPath}`);
      const picked = await vscode.window.showInformationMessage(
        `Anchor：已导出 ${basenameOf(target.fsPath)}`,
        '打开文件夹',
      );
      if (picked) await openHistoryFolder();
    } catch (err) {
      void vscode.window.showErrorMessage(`Anchor：导出失败 —— ${userFacing(err)}`);
    }
  }

  /**
   * 用**操作系统的文件管理器**打开一个本地文件夹（Windows 资源管理器 / macOS Finder / Linux xdg-open）。
   *
   * @anchor 为什么不走 `vscode.env.openExternal`（D90）：globalStorage 在 VS Code 的
   * 用户数据目录里，`openExternal` 会把这种路径改写成 `vscode-userdata:` 协议 ——
   * 用户实测弹出「获取打开此 vscode-userdata 链接的应用」，Windows 上没有任何应用认它。
   * 直接叫系统文件管理器就没有这层改写。explorer.exe 成功时退出码也可能是 1，
   * 所以**不能拿退出码当成败判据**：spawn 没抛 error 就当成功。
   */
  function revealInFileManager(dir: vscode.Uri): Promise<boolean> {
    const command =
      process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    return new Promise((resolve) => {
      try {
        const child = spawn(command, [dir.fsPath], { detached: true, stdio: 'ignore' });
        child.on('error', () => resolve(false));
        child.unref();
        resolve(true);
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * 「打开讲解历史文件夹」（D89）。目录不存在就先建 —— "打开一个空文件夹"
   * 也好过"报错说文件夹不存在"；第一次使用时历史里本来就是空的。
   */
  async function openHistoryFolder(): Promise<void> {
    const dir = historyDir();
    try {
      await vscode.workspace.fs.createDirectory(dir);
    } catch (err) {
      void vscode.window.showErrorMessage(`Anchor：历史文件夹建不出来 —— ${userFacing(err)}`);
      return;
    }
    const opened = await revealInFileManager(dir);
    if (opened) {
      note(`打开历史文件夹：${dir.fsPath}`);
    } else {
      void vscode.window.showWarningMessage(`Anchor：没能打开历史文件夹，路径是 ${dir.fsPath}`);
    }
  }

  // @anchor S13：完整 JSON 历史与旧 Markdown history/ 分开，所有写/删都串行。
  let historyPanel: HistoryPanel | undefined;
  let damagedArchives = 0;
  const archiveDir = (): vscode.Uri => vscode.Uri.joinPath(context.globalStorageUri, 'archive');
  const archive = createArchiveStore({
    async list() {
      try { return (await vscode.workspace.fs.readDirectory(archiveDir())).map(([name]) => name); }
      catch (err) {
        const code = (err as {code?:string}).code;
        if (code === 'FileNotFound' || code === 'ENOENT') return [];
        throw err;
      }
    },
    async read(name) { return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(archiveDir(), name))); },
    async writeAtomic(name, text) {
      const dir = archiveDir();
      await vscode.workspace.fs.createDirectory(dir);
      const temp = vscode.Uri.joinPath(dir, `${name}.tmp`);
      try {
        await vscode.workspace.fs.writeFile(temp, new TextEncoder().encode(text));
        await vscode.workspace.fs.rename(temp, vscode.Uri.joinPath(dir, name), { overwrite: true });
      } catch (err) {
        try { await vscode.workspace.fs.delete(temp); } catch { /* 旧 JSON 不受失败影响。 */ }
        throw err;
      }
    },
    async remove(name) { await vscode.workspace.fs.delete(vscode.Uri.joinPath(archiveDir(), name)); },
  }, (name, reason) => { damagedArchives++; note(`历史记录 ${name} 无法读取：${reason}`); });

  async function refreshHistory(): Promise<void> {
    if (!historyPanel || historyPanel.disposed) return;
    damagedArchives = 0;
    const entries = await archive.list();
    historyPanel.setEntries(entries, damagedArchives > 0 ? `${damagedArchives} 份损坏或无法读取的记录已跳过；其余记录仍可使用。` : '重新打开使用已有讲解，不再请求模型。', damagedArchives > 0);
  }

  async function importLastRun(): Promise<void> {
    const previous = lastRunOf();
    if (!previous || previous.id) return;
    const id = `legacy-${createHash('sha256').update(JSON.stringify(toStoredRun(previous))).digest('hex').slice(0, 32)}`;
    const existing = (await archive.list()).some(entry => entry.id === id);
    const run: LastRun = existing ? await archive.read(id) : { ...previous, id, updatedAt: previous.savedAt, language: previous.language ?? 'zh' };
    if (!existing) await archive.save(run);
    if (lastRun !== previous) return;
    lastRun = run;
    await context.workspaceState.update(LAST_RUN_KEY, toStoredRun(run));
  }

  async function openArchived(id: string): Promise<void> {
    if (running || asking) throw new Error('当前模型请求还在进行，请结束后再打开历史讲解。');
    const run = await archive.read(id);
    stop();
    generation += 1;
    lastRun = run;
    lastRunLoaded = true;
    usageThisRun = run.usage;
    playbackLanguage = run.language ?? 'zh';
    await context.workspaceState.update(LAST_RUN_KEY, toStoredRun(run));
    sidebar?.setUsage(run.usage ?? null);
    startSession(run.result, run.anchor);
    refreshStart();
    note(`打开历史讲解：${id}（没有请求模型）`);
  }

  async function forgetLastArchive(ids?: readonly string[]): Promise<void> {
    const run = lastRunOf();
    if (!run?.id || (ids && !ids.includes(run.id))) return;
    stop();
    lastRun = undefined;
    lastRunLoaded = true;
    usageThisRun = undefined;
    sidebar?.setUsage(null);
    await context.workspaceState.update(LAST_RUN_KEY, undefined);
    refreshStart();
  }

  async function showHistory(): Promise<void> {
    if (!historyPanel || historyPanel.disposed) {
      historyPanel = new HistoryPanel({
        onRefresh: refreshHistory,
        onOpen: openArchived,
        async onDelete(id) {
          const run = await archive.read(id);
          const answer = await vscode.window.showWarningMessage(`删除讲解「${run.result.title || run.anchor.sourceName}」？Markdown 文件夹中的文件会保留。`, {modal:true}, '删除');
          if (answer !== '删除') return;
          await archive.remove(id);
          await forgetLastArchive([id]);
          await refreshHistory();
        },
        async onClear() {
          const answer = await vscode.window.showWarningMessage('清空所有完整讲解留档？Markdown 文件夹中的文件会保留。', {modal:true}, '清空');
          if (answer !== '清空') return;
          await archive.clear();
          await forgetLastArchive();
          await refreshHistory();
        },
        onFolder: openHistoryFolder,
      });
      context.subscriptions.push(historyPanel);
    }
    historyPanel.reveal();
    try { await importLastRun(); await refreshHistory(); }
    catch (err) { historyPanel.setError(`历史读取失败：${userFacing(err)}`); note(`历史读取失败：${userFacing(err)}`); }
  }

  // ───────────────────────────────────────────────────────────
  // 外部 Agent 的位置交接（D130）—— 用户自己给的隐喻是"投币机"
  // ───────────────────────────────────────────────────────────

  /**
   * 把外部 Agent 给的一个路径**解析成绝对路径**。
   *
   * @anchor 这是宿主侧的政策（依赖 `vscode.workspace` 的状态），所以它留在这里、
   *         由 `buildHandoff` 以注入的形式拿（那样纯逻辑部分能直测）。
   *         三条规则，按顺序：
   *           1. **已经是绝对路径** → 原样用（外部 Agent 常给绝对路径）
   *           2. **工作区里能对上** → 用工作区的
   *           3. 否则 → 拼到第一个工作区根下（"相对路径"最自然的解释）
   *         对不上时**不抛** —— 让 `readText` 去抛 ENOENT，
   *         那里的错误信息带完整路径，比在这里编一句更好用。
   */
  function resolveHandoffPath(raw: string): string {
    const path = raw;
    // 绝对路径：`/` 开头（POSIX）或 `X:\` / `X:/`（Windows）
    if (path.startsWith('/') || /^[A-Za-z]:[/\\]/u.test(path)) return path;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return path;
    return vscode.Uri.joinPath(vscode.Uri.file(root), path).fsPath;
  }

  /**
   * 读一个**源文件**的全文（D130）。
   *
   * @anchor 为什么抽出来而不是两处各写一遍：这一片有**两处**要读源文件 ——
   *         `loadHandoff` 拼临时文档时读一次、`explainRanges` 取件时再读一次。
   *         两处的读法必须**完全一致**（都用 `workspace.fs` 而不是 `node:fs`：
   *         走前者能读虚拟文件系统与远程工作区，走后者只能读本机磁盘 ——
   *         在远程工作区里会**静默读不到而当成本地路径不存在**）。
   */
  async function readHandoffFile(path: string): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(path));
    return new TextDecoder('utf-8').decode(bytes);
  }

  /**
   * 把那段提示词写进系统剪贴板（D132）。
   *
   * @anchor 为什么这件事归宿主、不归面板：
   *         1. webview 里 `navigator.clipboard` 要 secure context 且权限不保证给，
   *            **失败时不抛错、只静默无效** —— 用户看到的是"点了没反应"，最难查的一类问题；
   *            `vscode.env.clipboard.writeText` 是官方 API，稳定可用。
   *         2. 提示词是宿主的常量（`HANDOFF_PROMPT`）。让面板拿一份副本的话，
   *            日后改文案就会有两处，而**面板那份改了看不出、宿主那份才是真的** ——
   *            用户复制到的会是旧句子。
   *
   * 回执走状态栏而不是弹窗：复制是个高频小动作，弹一个要按"确定"的框很烦。
   */
  async function copyHandoffPrompt(): Promise<void> {
    await vscode.env.clipboard.writeText(HANDOFF_PROMPT);
    vscode.window.setStatusBarMessage('Anchor：提示词已复制 —— 粘给外部 Agent 就行', 4000);
  }

  /**
   * 生成 / 覆盖临时文档（D130 的主流程）。
   *
   * 用户原话：「**我需要一个输入框，将对方输出的位置进行定位，讲解。最好是能形成一个临时文件，
   * 将被包括的部分从上到下列出来**」。
   *
   * 五步：
   *   1. 解析（`buildHandoff`：解析 → 读文件 → 扩到函数 → 拼文档）
   *   2. **把内容与来源表一起换掉**（`applyHandoff` —— 两者必须同生共死）
   *   3. 打开（或置顶）那一份文档
   *   4. 回执：几段、几个文件、几条没认出来、几个读不到
   *
   * @anchor 为什么失败路径都这么啰嗦：这一步**没有任何自动纠错的机会** ——
   *         用户粘完就去二次选择了，如果少了一段而屏幕上不说，
   *         他会以为是"外部 Agent 又漏改了"，方向完全错了。
   */
  async function loadHandoff(text: string): Promise<void> {
    const raw = typeof text === 'string' ? text.trim() : '';
    if (raw === '') {
      void vscode.window.showWarningMessage('Anchor：输入框里还没有位置 —— 把外部 Agent 给的那一列粘进来。');
      return;
    }

    const resolvedPaths = new Map<string, string>();
    const unresolved: string[] = [];
    for (const { filePath } of parseHandoff(raw).ranges) {
      if (resolvedPaths.has(filePath)) continue;
      let resolved = resolveHandoffPath(filePath);
      if (!filePath.startsWith('/') && !/^[A-Za-z]:[/\\]/u.test(filePath)) {
        let found = false;
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
          const candidate = vscode.Uri.joinPath(folder.uri, filePath);
          try {
            await vscode.workspace.fs.stat(candidate);
            resolved = candidate.fsPath;
            found = true;
            break;
          } catch { /* 检查下一个工作区根；不猜外部仓库的位置。 */ }
        }
        if (!found) unresolved.push(filePath);
      }
      resolvedPaths.set(filePath, resolved);
    }
    const paths = [...resolvedPaths.values()];
    const roots = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()) ?? [];
    const external = paths.filter(p => {
      const normalized = p.replace(/\\/g, '/').toLowerCase();
      return roots.length === 0 || !roots.some(root => normalized === root || normalized.startsWith(`${root}/`));
    });
    if (external.length > 0 || unresolved.length > 0) {
      const picked = await vscode.window.showWarningMessage(
        unresolved.length > 0
          ? `Anchor：工作区里找不到相对路径 ${unresolved[0]}。请取消并改用源文件的绝对路径；继续会按当前工作区解析，读不到的文件会明确列出。`
          : `Anchor：位置清单包含工作区外的文件（${external[0]}${external.length > 1 ? ` 等 ${external.length} 处` : ''}）。继续生成后，取件仍按当前范围执行。`,
        '继续生成', '取消',
      );
      if (picked !== '继续生成') return;
    }
    let built: Awaited<ReturnType<typeof buildHandoff>>;
    try {
      built = await buildHandoff(raw, {
        readText: readHandoffFile,
        resolvePath: path => resolvedPaths.get(path) ?? resolveHandoffPath(path),
      });
    } catch (err) {
      // `HandoffError` 自己带的是一句写好的人话；别的错误走通用的那层
      void vscode.window.showErrorMessage(
        `Anchor：${err instanceof HandoffError ? err.message : userFacing(err)}`,
      );
      return;
    }

    handoffDraft = raw;
    await applyHandoff(built.doc, built);
    refreshStart();
    note(
      `位置交接：${built.segmentCount} 段 / ${built.doc.files.length} 个文件` +
        (built.rejected.length > 0 ? `，${built.rejected.length} 行没认出来` : '') +
        (built.missing.length > 0 ? `，${built.missing.length} 个文件读不到` : ''),
    );
  }

  /**
   * **内容与来源表一起换**（D130）。
   *
   * @anchor 为什么把它们合成一个函数：这两样东西必须**永远一致** ——
   *         内容换了而表没换（或反过来），二次选择的映射就会指到错误的代码上，
   *         而那种错**不报错**，只会在讲解里表现为"它讲的不是我选的那段"。
   *         让它们只有一个更新入口，"忘了同步"这件事就不可能发生。
   */
  async function applyHandoff(
    doc: HandoffDoc,
    info: { segmentCount: number; rejected: { length: number }; missing: unknown[]; unexpandedCount: number },
  ): Promise<void> {
    handoffDoc = doc;
    const provider = handoffDocProvider();
    provider.host.set(doc.text);
    provider.refresh();
    handoffSummary =
      `${doc.lines.length} 行 · ${doc.files.length} 个文件 · ${info.segmentCount} 段` +
      (info.unexpandedCount > 0 ? `（${info.unexpandedCount} 段未扩到函数边界）` : '');

    await openHandoffDocument(provider);

    // 回执要把"少了什么"说在脸上（D130 第二节那条"不猜"的延伸）。
    const notes: string[] = [];
    if (info.rejected.length > 0) notes.push(`${info.rejected.length} 行没认出来`);
    if (info.missing.length > 0) notes.push(`${info.missing.length} 个文件读不到`);
    void vscode.window.setStatusBarMessage(
      `Anchor：临时文件已生成 —— ${info.segmentCount} 段、${doc.files.length} 个文件` +
        (notes.length > 0 ? `（${notes.join('，')}）` : ''),
      6000,
    );
  }

  /**
   * 「重新打开临时文件」（D130）。用户原话：「**这个文件是我们的一个按钮可以再次呼出
   * （防止讲解切换文件丢掉路径）**」。
   *
   * @anchor 为什么"置顶"而不是"重新生成"（用户选的是"原本那个"）：
   *         重新生成要**再读一遍文件**，而用户此刻想做的只是"把我刚才那份拿回来看看" ——
   *         读一遍会让内容跟着磁盘变，与他记忆里的那份不一样。
   *         而且重新生成会换一个标签页（每次 URI 都是新的），标签就越堆越多。
   */
  async function reopenHandoff(): Promise<void> {
    if (!handoffSummary) {
      void vscode.window.showWarningMessage(
        'Anchor：还没有生成过临时文件 —— 先把位置粘进开始面板那个框，再点「我粘的位置 → 生成临时文件」。',
      );
      return;
    }
    await openHandoffDocument(handoffDocProvider());
  }

  /**
   * 当前编辑器是不是**我们那份临时文档**（D130）。
   *
   * @anchor 判据是 scheme，不是"路径像不像"。用 `HANDOFF_SCHEME` 那个常量而不是字面量：
   *         provider 注册用的也是它，两处共用一处定义 ——
   *         分开写就会出现"provider 注册了 A、这里判的是 B"，
   *         而那种错的表现是**功能完全没生效但不报错**（点下去走的是普通文件那条路）。
   */
  function isHandoffEditor(editor: vscode.TextEditor): boolean {
    return editor.document.uri.scheme === HANDOFF_SCHEME;
  }

  /**
   * 从临时文档里的一次选择出发去讲解（D130）。
   *
   * 四步：
   *   1. **映射**：文档行号 → 源文件区间（`mapSelection`，核心算法）
   *   2. **确认**：让用户看一眼"要讲的是哪几个文件的哪几行"（源文件的行号，不是文档的）
   *   3. **问重点**：与平常同一句（`askFocus`）
   *   4. **取件 + 讲解**：走**现成的多段链路**（D80 的 `explainSegments` 那条）
   *
   * @anchor 为什么第 2 步看到的必须是**源文件行号**：用户此刻在判断的是
   *         "我要讲的对不对"，而"第 3-9 行"在临时文档里指的东西与他心里的那段代码
   *         不是同一个坐标 —— 给他文档行号等于让他自己换算，那正是这一片要替他做的事。
   */
  async function captureFromHandoff(editor: vscode.TextEditor): Promise<void> {
    const doc = handoffDoc;
    if (!doc) {
      // provider 的 URI 还是我们的，但来源表没了 —— 只可能是"宿主重启过、面板还开着"
      void vscode.window.showWarningMessage(
        'Anchor：这份临时文件的内容已经不在手上了 —— 回开始面板重新粘一次位置。',
      );
      return;
    }

    const sel = editor.selection;
    const startLine = Math.min(sel.start.line, sel.end.line) + 1;
    const endLine = Math.max(sel.start.line, sel.end.line) + 1;

    const mapped = mapSelection(doc.origin, startLine, endLine);
    if (mapped.length === 0) {
      // **不是错误**，是用户划到了标注行/分割线 —— 说清楚他划到什么了（D67 同一条：不静默）
      void vscode.window.showWarningMessage(
        'Anchor：你选中的是标注行或分割线，不是代码 —— 在代码那几行上选一段。',
      );
      return;
    }

    // 确认（D130 第五节）：显示**源文件**的行号，并说清"几个文件几段"。
    const files = new Set(mapped.map((r) => r.filePath));
    const picked = await vscode.window.showQuickPick(
      [
        {
          label: '讲解这段',
          description: describeMapped(mapped),
          detail: `${files.size} 个文件里的 ${mapped.length} 段`,
          value: true,
        },
        { label: '取消', description: '这次什么也不做', value: false },
      ],
      {
        title: 'Anchor 讲解（外部 Agent 的位置）',
        placeHolder: '要讲解的就是这几段吗？',
      },
    );
    if (!picked || !picked.value) return;

    const focus = await askFocus();

    // 走**多段队列那条现成的路**（D80/D130 第六节）：按一份讲，几段之间的数据怎么流动
    // 正是"多段属于同一个功能"时最值得讲的东西。
    await explainRanges(mapped, focus);
  }

  /**
   * 把映射出来的几段**合成一份**讲解（D130 第六节）。
   *
   * @anchor 为什么不复用 `explainSegments`（那条也是"合成一份"）：那条读的是面板上的
   *         `segmentQueue`，会**清空用户的队列**。而这个场景下用户根本没动过那个队列 ——
   *         拿它当输入会把队列里攒着的东西一起讲进来、还会把它们清掉。
   *         所以这里用同一个 `mergeSegments`（core 的比较器），但队列不动。
   *
   *         用户明确说过这一片「**不能影响实际功能**」—— 队列是他的东西，不能顺手清。
   */
  async function explainRanges(
    ranges: { filePath: string; lineStart: number; lineEnd: number }[],
    focus: string | undefined,
  ): Promise<void> {
    let anchor: Anchor;
    try {
      anchor = sourceSegmentsAnchor(await readSourceSegments(ranges, readHandoffFile), focus);
    } catch (err) {
      void vscode.window.showErrorMessage(`Anchor：${userFacing(err)}`);
      return;
    }

    lastCapture = { anchor, scope: 'selection' };
    refreshStart();
    await explain(anchor);
  }

  /**
   * 从**文件**读入位置清单（命令面板那条路，D130 第七节）。
   *
   * @anchor 为什么不直接复用面板那个输入框：**命令面板没有输入框** ——
   *         从那里触发时，用户手上最自然的东西是一个**文件**（外部 Agent 写的那个），
   *         所以这条走"选文件"。面板那条走"粘进框"。
   *         两条通向同一个 `loadHandoff`，区别只在"文本从哪来"。
   *
   *         这也正是"点击选文件"与"拖拽"不是冗余的那个理由（D130 第七节）：
   *         拖拽在**面板里**方便，而命令面板这条路**根本拖不了**。
   */
  async function pickHandoffFile(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      title: 'Anchor：挑一个装着位置的文本文件',
      canSelectMany: false,
      filters: { 位置清单: ['txt', 'json', 'md'], 全部文件: ['*'] },
    });
    const file = picked?.[0];
    if (!file) return;
    try {
      await loadHandoff(await readHandoffFile(file.fsPath));
    } catch (err) {
      void vscode.window.showErrorMessage(`Anchor：读不了那个文件 —— ${userFacing(err)}`);
    }
  }

  // ───────────────────────────────────────────────────────────
  // 讲解语言（D97）—— 影响讲解内容链（prompt/示范/面板文案/导出），默认中文
  // ───────────────────────────────────────────────────────────

  /**
   * 当前的讲解语言。**同步读**：建面板与记存档的时刻拿不到 async 的完整配置，
   * 而这一个字段的读取便宜且无副作用（与 `readAnchorConfig` 的完整解析是两回事）。
   */
  function languageOf(): ExplainLanguage {
    return coerceLanguage(vscode.workspace.getConfiguration('anchorExplain').get('language'));
  }

  /**
   * 侧边栏排版风格（D129）。与 `languageOf` 同一条约定：**建面板那一刻读一次**，
   * 之后不再跟着设置变 —— 它要内联进 webview 的 HTML（`<body data-anchor-style>` 与
   * `ANCHOR_SIDEBAR_STYLE`），而那两样是建面板时一次性写死的。改设置下一次讲解生效。
   */
  function sidebarStyleOf(): SidebarStyle {
    return coerceSidebarStyle(vscode.workspace.getConfiguration('anchorExplain').get('sidebarStyle'));
  }

  /** 「切换讲解语言」—— 一键：中文 ↔ English。设置落 Global（与 style 同一落点），下一次讲解生效。 */
  async function toggleLanguage(): Promise<void> {
    const next: ExplainLanguage = languageOf() === 'en' ? 'zh' : 'en';
    const settings = vscode.workspace.getConfiguration('anchorExplain');
    try {
      await settings.update('language', next, vscode.ConfigurationTarget.Global);
    } catch (err) {
      void vscode.window.showErrorMessage(`Anchor：讲解语言没能写进设置（${describeError(err)}）。`);
      return;
    }
    // 写完立刻回读（D63 的纪律）：update 静默失败（settings.json 有语法错）时，
    // 用户看到的不能是一句"已切换"的假话
    if (languageOf() !== next) {
      void vscode.window.showErrorMessage('Anchor：讲解语言没能写进设置 —— 请检查 settings.json 是否有语法错误。');
      return;
    }
    void vscode.window.showInformationMessage(
      `Anchor：讲解语言已切换为 ${describeLanguage(next)} —— 下一次讲解生效。`,
    );
  }

  // ───────────────────────────────────────────────────────────
  // 取件范围（D119）—— 用户自己给"这一次"定范围
  // ───────────────────────────────────────────────────────────

  /**
   * 「Anchor: 选择这次的取件范围」。
   *
   * @anchor 为什么要它：四种范围的**合适的场合不一样**，而设置里那个值是给"平时"用的 ——
   *         讲自己模块时用 `related`，去读一份外部 SDK / 参考实现时用 `any`，
   *         想只看这一个文件时用 `off`。让用户为了这一次去改一个全局设置、
   *         再记得改回来，是把选择成本推给了他（而且他会忘）。
   *
   *         每一项都把**后果**写在标题里（能读到什么 / 读不到什么），
   *         因为档位 id（`related` / `any`）本身不说明任何事 —— 用户要判断的是
   *         "这次它能不能读到那个文件"，不是"我选了哪个词"。
   *
   *         它**只影响本次会话**（内存里覆盖设置），所以每一项后面都标了当前生效值、
   *         还留了一条"用设置里的"能退回去。
   */
  async function pickFetchScope(): Promise<void> {
    const fromSettings = coerceFetchScope(vscode.workspace.getConfiguration('anchorExplain').get('fetchScope'));
    const now = scopeOverride ?? fromSettings;
    const label = (scope: FetchScope): string =>
      `${describeFetchScope(scope)}（${scope}）${scope === now ? '　← 当前' : ''}`;

    const picked = await vscode.window.showQuickPick(
      [
        {
          scope: 'related' as const,
          label: label('related'),
          description: '可以读这次列出来的相关文件（清单即范围）',
        },
        { scope: 'same-dir' as const, label: label('same-dir'), description: '只读锚点文件所在目录里的文件' },
        { scope: 'off' as const, label: label('off'), description: '只读锚点所在的这一个文件（跨文件全关）' },
        {
          scope: 'any' as const,
          label: label('any'),
          description: '不按工作区判范围：写绝对路径就能读工作区外，并多给一个列文件工具',
        },
        {
          scope: undefined,
          label: `用设置里的（当前是 ${describeFetchScope(fromSettings)}）${scopeOverride === undefined ? '　← 当前' : ''}`,
          description: '清掉这一次的临时选择',
        },
      ],
      {
        title: 'Anchor：这次的取件范围',
        placeHolder: '只影响这次会话；重载窗口就回到设置里的值',
      },
    );
    if (picked === undefined) return; // Esc = 不改

    scopeOverride = picked.scope;
    void vscode.window.showInformationMessage(
      picked.scope === undefined
        ? `Anchor：已回到设置里的取件范围（${describeFetchScope(fromSettings)}）—— 下一次讲解生效。`
        : `Anchor：这次会话的取件范围 = ${describeFetchScope(picked.scope)}（${picked.scope}）—— 下一次讲解生效，重载窗口即还原。`,
    );
  }

  // ───────────────────────────────────────────────────────────
  // 讲解面板的字号（D89）—— 独立于 VS Code 的 Ctrl+= / Ctrl+-
  // ───────────────────────────────────────────────────────────

  /** 缓存一份系数：`fontScaleOf` 在建面板与每次调整时都要读，Memento 的读也省就省。 */
  let fontScale: number | undefined;

  function fontScaleOf(): number {
    if (fontScale === undefined) {
      fontScale = clampFontScale(context.workspaceState.get(FONT_SCALE_KEY));
    }
    return fontScale;
  }

  function changeFontScale(direction: 'larger' | 'smaller' | 'reset'): void {
    const next = stepFontScale(fontScaleOf(), direction);
    fontScale = next;
    try {
      void context.workspaceState.update(FONT_SCALE_KEY, next);
    } catch (err) {
      note(`字号没能记住（${describeError(err)}）—— 本次会话内仍然生效`);
    }
    // 面板开着就立即生效；没开则下次建面板时从 workspaceState 拿到（内联进 HTML）
    sidebar?.setFontScale(next);
    refreshStart();
    void vscode.window.setStatusBarMessage(`Anchor：讲解文字 ${Math.round(next * 100)}%`, 1500);
  }

  // 播放器与侧边栏都延迟构造：激活阶段不做任何 vscode 取值/建面板，启动开销为零，
  // 也让 scripts/smoke-extension.mjs 的桩不必覆盖一堆用不到的 API。
  /**
   * 播放器"屏幕落定"的退订（D84）。
   *
   * @anchor 收工判定必须在**我们自己换完文件之后**再判一次：VS Code 的一次预览轮换里，
   *         "旧标签关了"与"新文件可见了"是两个先后到达的信号，中间那一帧我们这边什么文件
   *         都还不可见。判定若落在那一帧上就会误收工 —— 详见 `evaluateSessionEnd`。
   */
  let settleSub: (() => void) | undefined;
  const playerOf = (): CodeWalkthroughPlayer => {
    if (!player) {
      player = new CodeWalkthroughPlayer();
      settleSub = player.onDidSettle(() => evaluateSessionEnd());
    }
    return player;
  };

  const handlers: SidebarHandlers = {
    onNext: () => next(),
    onPrev: () => prev(),
    onGoto: (index) => {
      session?.goto(index);
    },
    onStop: () => stop(),
    onRevealStep: (index) => {
      const step = session?.snapshot.result.steps[index];
      if (step) void revealStep(step);
    },
    // D83：讲完之后面板上那两颗按钮。**两条路各走各的**：
    // 重放是本地的事（不碰网络），重新讲要走完整条链路（会再花一次钱）——
    // 所以在面板上也是两颗按钮，我们不替用户选。
    onReplay: () => replayLast(),
    onReExplain: () => void reExplainLast(),
    // D89：字号、导出与历史文件夹。面板只回传动作 id，全部实现在命令那一侧（§5.5 同构）
    onFontLarger: () => changeFontScale('larger'),
    onFontSmaller: () => changeFontScale('smaller'),
    onExport: () => void exportLast(),
    onHistoryPanel: () => void showHistory(),
    onOpenHistory: () => void openHistoryFolder(),
    // D126：追问。面板只回传"哪一步 + 问什么"，能问不能问由宿主判（§5.5 同构）
    onAsk: (index, question) => void askFollowUp(index, question),
  };

  /**
   * 「定位到这一步」的点击（侧边栏每条 step 上的位置标签）。
   *
   * @anchor 两条线的定位方式**必须是两套**（约束 1）：
   *   - 线1（代码）：在编辑器里高亮 + 滚过去（`CodeWalkthroughPlayer.revealStep`）
   *   - 线2（PDF）：滚到那一页 + **闪现一下那一块**（S6 补 / D76）—— 只滚到页不够用，
   *     用户的原话是「图里没有对应位置的指示的跳转，根本不知道讲的哪里」。
   *     约束 1 因此收窄为：**不许常驻/自动的框，只允许"用户点击触发、会自动消失"的位置提示** ——
   *     这条路只在用户点某一步时走，自动播放/推进永远不发（`smoke-walkthrough` 有断言）。
   *
   * 顺带：这一下**必须有回执**。以前点下去若目标就在当前页，画面上什么都不动，
   * 看起来就像没反应；现在状态栏会说一句"已定位到第 N 页那一块"，日志里也留一行。
   */
  async function revealStep(step: WalkthroughStep): Promise<void> {
    if (primaryLocationOf(step)) {
      await playerOf().revealStep(step);
      return;
    }

    if (isPDFLocation(step.location)) {
      const { page, bbox } = step.location;
      if (peer() === undefined) {
        // §5.1：对端缺失时明确提示，不静默失败
        void vscode.window.showWarningMessage(
          'Anchor：没有安装线2（Fish-zjuer.anchor-pdf），无法把 PDF 滚到这一页。',
        );
        return;
      }
      // 装了**旧版**线2 的机器上没有 flashRegion（两条线各自安装，D27）——
      // 直接调会抛"命令未找到"，那句话对用户毫无意义。有就闪，没有就退回"只滚页"（D13 的老行为）。
      if (peerHasCommand('anchorPdf.flashRegion')) {
        await vscode.commands.executeCommand('anchorPdf.flashRegion', page, bbox);
        note(`定位：第 ${page} 页（闪一下那一块）`);
        void vscode.window.setStatusBarMessage(`Anchor：已定位到第 ${page} 页那一块`, 2000);
      } else {
        await vscode.commands.executeCommand('anchorPdf.revealPage', page);
        note(`定位：第 ${page} 页（只滚页 —— 对端线2 没有 anchorPdf.flashRegion 命令）`);
        void vscode.window.setStatusBarMessage(`Anchor：已定位到第 ${page} 页`, 2000);
      }
      return;
    }

    // web：本次不接入（D7）。什么都不做，而不是抛错。
  }

  function sidebarOf(): SidebarPanel {
    const language = playbackLanguage ?? languageOf();
    if (sidebar && !sidebar.disposed && sidebarLanguage !== language) sidebar.dispose();
    if (!sidebar || sidebar.disposed) {
      // 把用户实际键位一并交给面板：webview 里的按键到不了工作台，得它自己派发（D47）。
      // 字号系数同理内联（D89）：建面板那一刻的系数就是初值，之后的变更走消息。
      // 语言同理内联（D97）：面板文案（按钮/徽章/取件日志）跟着讲解语言走。
      sidebar = SidebarPanel.create(handlers, status.chords(), fontScaleOf(), language, sidebarStyleOf());
      sidebarLanguage = language;
      // token 那一行（D120）：**取件与模型调用都发生在建面板之前**（用户是在开始面板上按的按钮，
      // 面板是结果出来才建的），所以这里要把已经记下的那份补进去，否则新建的面板永远是空的。
      // 面板重建（折叠再展开）同理 —— `SidebarPanel` 自己也存一份并在 `ui:ready` 时补发。
      sidebar.setUsage(usageThisRun ?? null);
    }
    return sidebar;
  }

  function setContextKey(key: string, value: boolean): void {
    void vscode.commands.executeCommand('setContext', key, value);
  }

  /** 单个渲染面失败只记日志，不向上抛（D49：一个面坏了不该把会话一起带走）。 */
  function isolated(what: string, run: () => void): void {
    try {
      run();
    } catch (err) {
      console.error(`[anchor] ${what}更新失败：`, err);
    }
  }

  /**
   * §4.2 的两个 key 分工（D46）：
   *   - `walkthroughActive`：running / playing / paused 为 true，**done 与 idle 都落 false**。
   *     `next` / `prev` / `goto` / `playPause` 绑在它上面 —— 讲完了就不该再吃这些键。
   *   - `sessionOpen`：从开会话起为 true，**只到 stop / 编辑器关闭才落 false**。
   *     `stop` 绑在它上面 —— 否则 `alt+]` 走到最后一步之后，屏幕上的框就再没人能清掉。
   */
  function setActive(active: boolean): void {
    setContextKey('anchorExplain.walkthroughActive', active);
  }

  /**
   * 三个渲染方读的是同一份快照，所以"侧边栏说第 2 步、编辑器高亮第 3 步"不可能发生。
   *
   * **顺序与隔离都是刻意的**（D49）：
   *   1. 先把 context key 落定 —— 三个渲染面各自都可能失败（编辑器被关掉、webview 已释放…），
   *      但"会话现在算不算活着"不能因为其中一个失败而错位。第一版把 `setActive` 放在最后，
   *      结果状态栏一抛异常就会跳过它，用户就卡在"讲完了 alt+] 还在响应"的状态里。
   *   2. 三个渲染面各自 try/catch：一个面失败不该把另外两个拖下水，更不该让异常逃回会话内部
   *      （`emit` 同时是会话变更的监听器，异常逃出去会污染状态机）。
   */
  function emit(snapshot: WalkthroughSnapshot): void {
    setActive(snapshot.state !== 'idle' && snapshot.state !== 'done');

    isolated('decoration', () => {
      void playerOf()
        .render(snapshot)
        .catch((err: unknown) => console.error('[anchor] decoration 渲染失败：', err));
    });
    isolated('侧边栏', () => {
      sidebar?.post({
        type: 'session:update',
        result: snapshot.result,
        index: snapshot.index,
        state: snapshot.state,
        pointIndex: snapshot.pointIndex,
        // 面板靠它判断"这个位置要不要标文件名"（S9a 起 location 可能在别的文件里，D69）
        anchorPath: sessionAnchorPath,
      });
    });
    isolated('状态栏', () => {
      status.update(snapshot);
    });
    // 开始面板也吃这条快照，但它只显示"第几步"，所以按会话维度去重（见 refreshStartOn）
    refreshStartOn(`${snapshot.state}|${snapshot.index}/${snapshot.total}|${snapshot.stale}`);
  }

  function startSession(result: ExplanationResult, anchor: Anchor): void {
    // 先彻底收掉上一轮（正常情况下 explain() 已经 stop 过，这里是二次保险）：
    // 只覆盖 unsubscribe 而不退订，旧会话的监听器就会继续把 UI 拽回它那一步。
    unsubscribe?.();
    unsubscribe = undefined;
    session?.dispose();
    // 面板要拿它判断"这个位置要不要标文件名"（D69）：PDF 锚点没有文件，给 null
    sessionAnchorPath = isCodeLocation(anchor.location) ? anchor.location.filePath : null;
    // 追问的底子（D126）：它与 `session` 同生共死，理由见 `sessionAnchor` 的声明处
    sessionAnchor = anchor;

    const fresh = new WalkthroughSession(result);
    session = fresh;
    sidebarOf().reveal();
    unsubscribe = fresh.onDidChange(emit);
    setContextKey('anchorExplain.sessionOpen', true);
    // D89：从这一刻起屏幕上只该有我们的高亮 —— 官方的错误/警告/提示先藏起来
    //（退出讲解时 restore；若本机本来就看不见 problems，hide 是空操作、也不会还原任何东西）
    void veil.hide();
    emit(fresh.snapshot);
  }

  function stop(): void {
    // 顺序同样是刻意的：**先收状态，再清视觉**（D49）。
    // 清框要碰编辑器，而编辑器可能在讲解期间被关掉（`setDecorations` 会抛）。
    // 第一版是"先清框"，于是一次异常就能让后面的收尾全部跳过 ——
    // 用户看到的就是"按 Esc 没反应、框还在、后面都没法测了"。
    unsubscribe?.();
    unsubscribe = undefined;
    session?.dispose();
    session = undefined;
    /**
     * 锚点文件必须**随会话一起消失**（D78）。
     *
     * @anchor 它和 `session` 是一对：`session` 死了，"哪个文件被关掉算结束"这个问题就不再有主。
     *         不清掉的话，下一次会话（比如 PDF 锚点，那时 `sessionAnchorPath` 本该是 null）
     *         会继承上一个会话的文件名 —— 于是关掉**上一轮**选过的那个 .c 文件，
     *         就能把**这一轮**毫不相干的 PDF 讲解一并杀掉。这正是我们要修的那类误杀的翻版。
     */
    sessionAnchorPath = null;
    // 追问的底子也跟着走（D126）：留着一个上一轮的锚点，
    // 下一轮（可能是不相干的文件、甚至是 PDF）的追问就会拿旧锚点的 sourceName 去讲新东西
    sessionAnchor = undefined;
    playbackLanguage = undefined;
    pendingAnchorClose = false;
    setActive(false);
    setContextKey('anchorExplain.sessionOpen', false);
    status.hide();
    // D89：官方的错误/警告/提示在这里回来。放在清框之前/之后无所谓 ——
    // 它是设置写入，不依赖编辑器；失败只在日志里说话，不许把后面的收尾顶掉
    void veil.restore();

    isolated('清框', () => player?.clear());
    isolated('侧边栏', () => {
      // 面板不清空：讲解文字留着，用户还能回看。侧边栏据此显示"已结束"。
      sidebar?.post({ type: 'session:end' });
    });
    refreshStartOn('idle');
  }

  /**
   * 当前这一拍**讲的是哪些文件**（D82）。判据见 `onDidChangeVisibleTextEditors` 那一段。
   *
   * @anchor 为什么连子高亮一起收：一步的框可能同时落在两处（`location` 在 A 文件、
   *         某个子高亮在 B 文件），而播放器只把**焦点文件**打开（D69）——
   *         所以"这一拍还有落脚点"这件事必须按"涉及的文件里有任意一个还可见"来判，
   *         只判 `step.location` 会在那种跨文件的一拍上判错。
   */
  function currentStepFiles(): string[] {
    const step = session?.snapshot.step;
    if (!step) return [];
    const paths: string[] = [];
    if (isCodeLocation(step.location)) paths.push(step.location.filePath);
    for (const highlight of step.highlights ?? []) {
      if (isCodeLocation(highlight.location)) paths.push(highlight.location.filePath);
    }
    return paths;
  }

  /**
   * 这次讲解**住在**哪些文件里（D84）：锚点文件 + **所有**步骤与子高亮的位置。
   *
   * @anchor 它与 `currentStepFiles()` 看着像，问的是两件事，所以都必须单独存在：
   *         - `currentStepFiles()`：**"这一刻还有落脚点吗"** —— 收工判定的内容
   *         - `sessionFiles()`：**"这个被关掉的文件，值不值得立案"** —— 收工判定的入口
   *
   *         入口这一层是补上一个真实的误杀：`onDidCloseTextDocument` 是**任何**文档关闭都会触发的，
   *         而 VS Code 在正常使用中一直在关文档（预览替换、关别的组、删掉的文件…）。
   *         旧代码把它们一律记成"待定"，于是**与本次讲解毫不相干的一次关闭**也会给收工判定上膛 ——
   *         等下一次"可见编辑器变了"（可能是用户随手点开另一个文件）时，判定拿到的正是
   *         "锚点与这一拍的文件都不可见"，于是讲解被一次莫名其妙的操作收掉。
   *         用户报的「切回 main.c 又死了」就在这条路上：屏幕那一刻长什么样取决于 VS Code
   *         发事件的时机，而不是取决于用户想干什么。
   *
   *         取**所有步骤**而不是当前这一步：预览轮换顶掉的恰恰通常是**上一步**的文件
   *         （D78 踩过的那一脚），只收当前步会把真正相关的那次关闭漏掉。
   */
  function sessionFiles(): string[] {
    const steps = session?.snapshot.result.steps ?? [];
    const paths: string[] = [];
    if (sessionAnchorPath) paths.push(sessionAnchorPath);
    const add = (loc: WalkthroughStep['location'] | undefined): void => {
      if (loc && isCodeLocation(loc)) paths.push(loc.filePath);
    };
    for (const step of steps) {
      add(step.location);
      for (const highlight of step.highlights ?? []) add(highlight.location);
    }
    return paths;
  }

  /**
   * 收工判定 —— **本扩展里唯一一处**决定"这次讲解要不要收掉"的地方（D84）。
   *
   * @anchor 从 D78 到 D84，这条判据被改过三次，而三次错在同一个地方：
   *         **它读的是"屏幕某一瞬间的样子"，而那一瞬间是不是用户造成的，它从来没问过。**
   *         VS Code 的一次预览轮换不是一个原子动作：它先报"被顶掉的标签关了"，
   *         之后才让新文件出现在 `visibleTextEditors` 里。夹在中间的那一帧，
   *         我们这边一个文件都还不可见 —— 判定若落在那一帧上，就会把
   *         "播放器正把用户带到某个文件"读成"用户把讲解的东西全关了"。
   *         于是症状随"哪个文件、哪台机器、哪一次"而变：有的文件能切，切回来就死。
   *
   *         所以现在多问一句**这件事是不是我们自己造成的**（`player.switching`），
   *         并且**推迟到屏幕落定之后再判**（`onDidSettle` 会再调一次本函数）。
   *         这不是"更小心地猜时机"，而是换了个判据：不再看某一帧，
   *         只看"尘埃落定之后，这次讲解还站得住吗"。
   *
   *         **每一次判定都写一行日志**：这条路上过去没有任何痕迹，用户只能说"又死了"，
   *         而我们无从知道是哪一条分支、当时屏幕长什么样。日志里那句"因为…所以…"
   *         就是下一次排查的全部线索（与 D71「失败必须可见」同一条规矩）。
   */
  function evaluateSessionEnd(): void {
    if (!pendingAnchorClose) return;
    if (!session) {
      pendingAnchorClose = false;
      return;
    }

    const visible = (path: string): boolean =>
      vscode.window.visibleTextEditors.some((e) => samePath(e.document.uri.fsPath, path));

    // 我们自己正在打开/切前台某个文件：这一刻的"看不见"是我们造成的，等它落定再说。
    // 注意这里**不消费** pendingAnchorClose —— 消费了就再也不会被判了。
    if (player?.switching === true) {
      note('收工判定：播放器正在换文件 —— 推迟到屏幕落定之后再判');
      return;
    }

    pendingAnchorClose = false;

    // 没有锚点文件（PDF 锚点 / 老锚点）时**一律不 stop**（D78 的立场）：那种情形下我们拿不到
    // "哪个文件的关闭意味着结束"这个信息，宁可什么都不做，也不要再制造一次误杀。
    if (!sessionAnchorPath) {
      note('收工判定：这次讲解没有锚点文件（PDF / 老锚点）→ 不自动收工');
      return;
    }

    // 锚点文件又可见了（我们自己的预览轮换把它换回来了 / 用户切回来了）→ 讲解继续
    if (visible(sessionAnchorPath)) {
      note(`收工判定：锚点文件（${basenameOf(sessionAnchorPath)}）还在屏幕上 → 讲解继续`);
      return;
    }

    // 【D82】锚点没了不等于到头了：这一拍要讲的那个文件还在屏幕上，讲解显然正在被看着
    if (currentStepFiles().some(visible)) {
      note('收工判定：这一拍讲的文件还在屏幕上 → 讲解继续');
      return;
    }

    // 锚点没了、这一拍落脚的文件也没了 → 是真的一条路都没有了，这才收工
    note('收工判定：锚点与这一拍的文件都不在屏幕上了 → 结束讲解');
    stop();
  }

  // ───────────────────────────────────────────────────────────
  // 开始面板（活动栏那个固定按钮，S8）
  // ───────────────────────────────────────────────────────────

  /**
   * 面板要显示的一切（§5.5）。**现算**，不缓存：模型配置、对端有没有装、
   * 上次捕获的是哪一段、讲解走到第几步 —— 这四件事随时会变，缓存一份就得回答
   * "谁负责让它失效"，而现算的代价只是读一次设置。
   */
  async function makeStartModel(): Promise<StartModel> {
    const cfg = await readAnchorConfig(context);
    const snapshot = session?.snapshot;
    const lastLine = lastCapture ? captureSummary(lastCapture.anchor, lastCapture.scope) : null;

    return buildStartModel({
      chords: status.chords(),
      // D89：开始面板跟随讲解面板的字号系数（模型每拍都会重推，系数变化自然跟过去）
      fontScale: fontScaleOf(),
      providerReady: cfg.provider !== null,
      providerSummary: describeConfig(cfg),
      peerInstalled: peer() !== undefined,
      captureSummary: lastLine,
      queueSummary: describeQueue(),
      queueCount: segmentQueue.length,
      // D83：只回答"能不能重放"（`lastRunOf` 内部只读一次存档，见那段注释）
      hasLastRun: lastRunOf() !== undefined,
      // D130：草稿要**每一份模型都带上**（面板重画时靠它回填），
      //"有没有生成过"决定「重新打开临时文件」那颗按钮的灰亮
      handoffDraft,
      hasHandoff: handoffSummary !== undefined,
      handoffSummary: handoffSummary ?? null,
      busy: busyPhase,
      session: snapshot
        ? { index: snapshot.index, total: snapshot.total, state: snapshot.state, stale: snapshot.stale }
        : null,
    });
  }

  /** 状态变了就推一份。**视图没开过是空操作**，所以可以随便调。 */
  function refreshStart(): void {
    void start?.refresh();
  }

  /**
   * 只在"面板显示的东西真的变了"时推。
   *
   * @anchor 为什么非要有这个去重：会话游标是**拍**不是**步**（D48）——
   *         一个 5 步的讲解会走十几二十拍，每拍都会 `emit`。而推一次面板要重读设置
   *         与 SecretStorage（后者是异步 IPC）。不去重的话，讲解过程中会为了
   *         一个没变过的「第 2/5 步」反复问 20 次密钥存储。
   */
  function refreshStartOn(key: string): void {
    if (key === startKey) return;
    startKey = key;
    refreshStart();
  }

  /**
   * 开始面板上的一次点击。**id → 命令的唯一解析处**（§5.5）。
   *
   * @anchor 面板里灰掉一个按钮与这里再判一次**不是重复**，是两层不同的东西：
   *   - 前者是**提示**：让用户不必点下去才知道缺什么
   *   - 后者是**执行前的判断**：webview 是不可信输入，它喊"我要跑 goto"的时候，
   *     会话可能刚好结束了 —— 它看到的那个状态已经是上一刻的
   *
   * 另外两条守卫是命令自己**没法**提供的：
   *   - `peer`：线2 没装时那条命令**根本不存在**，`executeCommand` 会抛"命令未找到"，
   *     用户看到的是一个 VS Code 的报错框，而不是"你没装线2"
   *   - `session`：`goto` 在没有会话时是**静默返回**的，那违反"不静默失败"
   * （`provider` 那条不需要额外守卫：`Anchor: 设置 API Key` 自己会讲清缺什么。）
   */
  async function runStartAction(id: string): Promise<void> {
    const action = findStartAction(id);
    if (!action) return; // 表里没有的 id：不是我们的按钮，丢掉

    if (action.requires === 'peer' && peer() === undefined) {
      void vscode.window.showWarningMessage('Anchor：没有安装线2（Fish-zjuer.anchor-pdf），这条命令用不了。');
      return;
    }
    if (action.requires === 'session' && !session) {
      void vscode.window.showWarningMessage('Anchor：现在没有进行中的讲解。');
      return;
    }

    // 命中失败（比如配端点那条命令写设置被拒）也**必须说话**：静默的命令失败
    // 与"点了没反应"在用户眼里是同一件事（D63）。
    try {
      await vscode.commands.executeCommand(action.command);
    } catch (err) {
      void vscode.window.showErrorMessage(`Anchor：执行「${action.title}」失败 —— ${userFacing(err)}`);
    }
  }

  /**
   * 固定按钮的"快捷键那一份"：把活动栏里那个容器聚焦出来。
   *
   * `<viewId>.focus` 是 VS Code 按视图 id 自动生成的命令 —— 但那是**约定**，
   * 所以留一条退路：退回聚焦整个容器（容器 id 是我们自己在 package.json 里声明的）。
   * 退路只是为了"按了没反应"不至于成为唯一结果，不是我们在赌哪个能用。
   */
  async function showStart(): Promise<void> {
    try {
      await vscode.commands.executeCommand(`${StartViewProvider.viewId}.focus`);
    } catch {
      await vscode.commands.executeCommand('workbench.view.extension.anchor');
    }
  }

  /**
   * 捕获 → 请求 → 校验 → 开会话。
   *
   * **「讲解失败」与「渲染失败」在这里被分开**（D49）：只有 provider / 校验的失败才算讲解失败；
   * 一旦有了合法的 `ExplanationResult`，`startSession` 就在 try 之外调用 ——
   * 否则渲染面的一次异常会走进下面这个 catch，把好不容易拿到的讲解当成失败丢掉，
   * 还顺手把 context key 落成 false（用户按 Esc 就真没反应了）。
   */
  /**
   * §3.3 的 `ctx`：文档总行数（代码）或总页数（PDF）。取不到返回 null，
   * 校验会**跳过那一项上界**而不是跳过整条 location 校验。
   */
  async function makeOutline(anchor: Anchor): Promise<{ documentLineCount: number | null; pageCount: number | null }> {
    if (isCodeLocation(anchor.location)) {
      return { documentLineCount: await countLines(fsPort, anchor.location.filePath), pageCount: null };
    }
    // S7：PDF 的总页数终于有了来源（无头打开一次就有），
    // 于是 §3.3 里 `1 ≤ page ≤ pageCount` 那条上界不再被跳过 —— 这是 S6 留下的缺口（D55 第 4 条）。
    // 没有 filePath 的老锚点（S5 之前造的）仍然只能跳过。
    if (isPDFLocation(anchor.location) && anchor.location.filePath) {
      return { documentLineCount: null, pageCount: await pdfAdapter.pageCount(anchor.location.filePath) };
    }
    return { documentLineCount: null, pageCount: null };
  }

  /**
   * 给 PDF 锚点补上 `extractedText`（**第一层优先**，`Anchor.extractedText` 的注释就是这个意思）。
   *
   * @anchor 为什么要做这一件事：框选出来的 bbox 是**地址**，而那一块里的文字才是模型第一批
   *         该看到的东西。不填的话，模型只知道"第 23 页的一小块"，还得先请求取件才看得到内容 ——
   *         白花一轮网络往返，而且它对"该取哪一页"也只能猜。
   *
   * 失败一律**静默忽略**（扫描件没有文字层是正常情况）：锚点照原样交出去，
   * 模型自己会去取件。填充失败不该让讲解不可用。
   */
  async function withPdfText(anchor: Anchor): Promise<Anchor> {
    const loc = anchor.location;
    if (anchor.sourceType !== 'pdf' || anchor.extractedText) return anchor;
    if (!isPDFLocation(loc) || !loc.filePath) return anchor;

    try {
      const text = await pdfAdapter.textInBBox(loc.filePath, loc.page, loc.bbox);
      return text ? { ...anchor, extractedText: text } : anchor;
    } catch (err) {
      // 这里仍然只降级（扫描件没有文字层是正常情况），但**原因留一行**（D74）——
      // "框选那块取不到字"过去和"这份 PDF 打不开"在屏幕上是同一副样子，谁也分不出来。
      note(`框选那块取不到文字（${(err as Error).message}）—— 交给模型自己去取件`);
      return anchor;
    }
  }

  /* ── S-P2：块流窗口（相册）──────────────────────────────────────
     把一份 PDF 拆成卡片流，在一个真窗口里点选、滑选、问出去。
     面板不存状态（§12.4.2）：真相在这两个变量上 —— `lastBlocks` 留着上次拆出来的
     块流与队列，所以"关掉面板再打开"不必重拆一次，"重拆同一份文档"时块 ID 还能认回来（D100）。 */

  let lastBlocks: StreamState | undefined;

  /**
   * 让用户挑一份 PDF。
   *
   * @anchor 为什么不是"当前打开的那个 PDF"：线2 的视图是 custom editor，
   *         宿主这边**拿不到它的文件路径**（它不在 `window.visibleTextEditors` 里，
   *         而 webview/custom editor 的 URI 也不在 activeTextEditor 上）。
   *         硬猜一个"当前 PDF"只会造成"我明明开着它，它却说没找到" —— 找文件是确定的。
   */
  async function pickPdfFile(): Promise<string | undefined> {
    const found = await vscode.workspace.findFiles('**/*.pdf', '**/node_modules/**', 30);
    if (found.length === 0) {
      void vscode.window.showInformationMessage('Anchor：这个工作区里没有找到 PDF 文件。');
      return undefined;
    }
    if (found.length === 1) return found[0]!.fsPath;
    const picked = await vscode.window.showQuickPick(
      found.map((uri) => ({
        label: basenameOf(uri.fsPath),
        description: vscode.workspace.asRelativePath(uri),
        detail: uri.fsPath,
      })),
      { title: 'Anchor 块流', placeHolder: '把哪一份 PDF 拆成卡片流？' },
    );
    return picked?.detail;
  }

  /** 面板交回来的三件事：问出去、队列对齐了、状态变了 */
  function blockStreamHandlers(): BlockStreamHandlers {
    return {
      onAsk: (payload) => {
        // 发出去多少、话费大概多少，先留一行日志：这一轮之后屏幕上全是侧边栏的事，
        // 事后要回答"刚才那一下发的是什么"只能靠它（同 D68 的取件日志）
        note(
          `块流问出去：${payload.blockIds.length} 块 / 约 ${payload.approxTokens} tokens` +
            (payload.truncated ? '（超预算，末尾的块没发出去）' : ''),
        );
        // **走既有的编排链路**（`explain`）：块流只是"选得准"的入口，
        // 讲解、取件、校验、侧边栏、播放全部一行不改（这正是 Anchor 上那三个字段的用处）
        void explain(payload.anchor);
      },
      onAligned: (info) => {
        if (info.folded.length > 0) note(`块流：${info.folded.length} 个图注块并进了图卡（队列里的编号跟着改了）`);
        if (info.orphans.length > 0) note(`块流：清掉 ${info.orphans.length} 个不在本文档里的块`);
      },
    };
  }

  /**
   * S-P2：把一份 PDF 拆成卡片流并打开窗口。
   *
   * 两条入口（命令面板 / 传一个 uri 的调用方）走同一条路 —— 与 S8「入口有四处、实现只有一处」同一条规矩。
   */
  async function showBlocks(uri?: unknown): Promise<void> {
    const fromArg = uri instanceof vscode.Uri ? uri.fsPath : undefined;
    const filePath = fromArg ?? (await pickPdfFile());
    if (filePath === undefined) return;

    const existing = BlockStreamPanel.current?.state ?? lastBlocks;
    // 同一份文档、命令再点一次 = "把那个窗口拿到前面来"，不重拆（拆一份 30 页 PDF 要几秒）
    if (fromArg === undefined && existing !== undefined && samePath(existing.doc.filePath, filePath)) {
      BlockStreamPanel.show(existing, blockStreamHandlers(), { fontScale: fontScaleOf(), language: languageOf() });
      return;
    }

    let read: Awaited<ReturnType<typeof readSplitInput>>;
    try {
      read = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Anchor 正在读这份 PDF…', cancellable: false },
        (progress) =>
          readSplitInput(
            { acquire: (path) => pdfCache.acquire(path), readBytes: (path) => fsPort.readBytes(path) },
            filePath,
            (done, total) => progress.report({ message: `第 ${done}/${total} 页`, increment: total === 0 ? 0 : 100 / total }),
          ),
      );
    } catch (err) {
      // 打不开就说打不开 —— 这是外部输入（用户的文件），不能让面板停在"什么都没发生"
      void vscode.window.showErrorMessage(`Anchor：这份 PDF 读不了 —— ${(err as Error).message}`);
      note(`块流：读 ${filePath} 失败（${(err as Error).message}）`);
      return;
    }

    const stream = splitDocument(read.input);
    const prev = existing !== undefined && existing.doc.sourceId === read.sourceId ? existing : undefined;
    const started = streamStateOf(
      {
        filePath,
        sourceId: read.sourceId,
        sourceName: basenameOf(filePath),
        label: `${basenameOf(filePath)} · 共 ${stream.pageCount} 页`,
      },
      stream,
      prev === undefined ? {} : { registry: prev.registry, queue: prev.queue },
    );
    // 重拆之后块的构成可能变了（新块出现、旧块被并）：队列要跟着对齐，不能留一批对不上的号
    const aligned = reconciled(started);
    lastBlocks = aligned.state;
    note(`块流：${basenameOf(filePath)} → ${aligned.state.stream.blocks.length} 块（${stream.pageCount} 页）`);
    if (aligned.orphans.length > 0) note(`块流：清掉 ${aligned.orphans.length} 个不在本文档里的块`);
    if (aligned.folded.length > 0) note(`块流：${aligned.folded.length} 个图注块并进了图卡`);

    BlockStreamPanel.show(aligned.state, blockStreamHandlers(), { fontScale: fontScaleOf(), language: languageOf() });
  }

  /**
   * 现读配置、现建编排器。
   *
   * @anchor 为什么**不是**在激活时建一次留着用：用户改完设置应该立刻生效，
   *         而不是"改设置 → 重载窗口 → 再试"。`ExplainProvider` 就是"一个函数"，
   *         重建它的成本只有两次对象字面量。
   *
   * 没有可用配置时**明确报错**，不静默退化成"什么都不发生" ——
   * 后者让人以为是扩展坏了，而不是"我还没填 baseUrl"。
   */
  async function makeProvider(
    anchor: Anchor,
    /**
     * 追问那一轮（D126）。给了它，编排层会把 prompt 换成"只回答这一问"的口径，
     * 且 token 用量**累加**到这一整次讲解上（见下面 `onUsage` 的注释）。
     */
    opts: { followUp?: { step: WalkthroughStep; index: number; question: string } } = {},
  ): Promise<ReturnType<typeof createOrchestrator>> {
    const read = await readAnchorConfig(context);
    const provider = read.provider;
    if (!provider) throw new AnchorError('PROVIDER_ERROR', describeConfig(read));
    // 本次会话的临时档位（D119）：只覆盖**范围**这一个字段，其余照旧
    const baseCfg = scopeOverride === undefined ? read : { ...read, fetchScope: scopeOverride };
    const cfg = opts.followUp !== undefined && playbackLanguage ? { ...baseCfg, language: playbackLanguage } : baseCfg;

    // 取件边界与清单**一起**算（S9a-fix10）：两者必须同源，分两处建迟早各说各话。
    // 扫描失败「降级但不静默」—— 清单没了跨文件取件仍在（`any` 档模型可以自己写路径），
    // 但它多半**不知道该问哪个文件**，这句话是唯一能解释"它怎么不往外读"的线索（D67）。
    /**
     * 追问那一轮**不扫工作区、不给清单**（D126）。
     *
     * @anchor 用户的原话是"追问时，**只**提供给AI当前代码块（或一函数等）和当前讲解"。
     *         不扫之后有两样好处，而且都不只是省事：
     *           1. **口径一致**：没有清单 → `candidateModeOf` 判成 `'none'` →
     *              提示词改说"就基于锚点处的原文作答"。清单与提示词仍然同源，不会出现
     *              "教它照抄一份不存在的清单"那种自相矛盾（D123 修过的那一类）。
     *           2. **追问立刻开始**：`buildFetchBoundary` 要遍历目录树，
     *              而"这一步没讲到的部分"那种问题本来就不需要它 —— 让用户为一次提问
     *              先等一次全工作区扫描，是白等。
     *
     *         代价（已与用户确认过口径）：追问**读不到锚点文件之外的文件**。
     *         要放开的话，把下面这个条件去掉、并把 `fetchPolicy` 那一行接回来即可 ——
     *         是"接一个开关"，不是"改一套机制"。
     */
    /**
     * 锚点文件的绝对路径（收窄过一次）。**落在常量上是必需的**：下面那个箭头函数体里
     * TS 的控制流分析拿不到外层 `isCodeLocation` 的收窄结果 —— 不是绕开类型，
     * 而是"锚点文件路径"这个概念本来该有个名字，它在下面的注释里要出现好几次。
     */
    const anchorFile = isCodeLocation(anchor.location) ? anchor.location.filePath : '';

    const boundary =
      opts.followUp === undefined && isCodeLocation(anchor.location)
        ? await buildFetchBoundary(
            cfg.fetchScope,
            anchorFile,
            anchor.extractedText ?? '',
            cfg.maxFetchLines,
            cfg.maxCandidateFiles,
            (err) =>
              note(
                `候选文件清单取不到（${describeError(err)}）—— 不影响讲解，但模型不会知道有哪些相关文件`,
              ),
            /**
             * 这次讲解涉及的其他文件（D130 第六节）：多段锚点时，`segments` 里那几段所在的
             * 目录也要算进 `related` 范围 —— 用户的原话是「队列涉及的**必输入**，按照一份来讲」。
             *
             * @anchor 为什么放在这个分支里（而不是提到三元外面）：`anchor.location` 在这里
             *         才被 `isCodeLocation` 收窄成 `CodeLocation`，外面那个类型上没有 `filePath`。
             *         这不是给类型系统让路 —— 语义上也对：只有代码锚点才谈得上"旁边的文件"。
             *
             * @anchor 为什么 `filter` 掉与锚点同一个的：锚点自己已经在第 2 个参数里了，
             *         重复传不会算错（`relatedRoots` 会去重），但 `same-dir` 档下 roots 里
             *         会出现两个相同的目录，而那份 roots 会被写进拒绝文案（"允许的根：A、A"）。
             *
             * @anchor 用 `segmentsOf` 而不是直接读 `anchor.segments`：契约里那个字段是
             *         `Location[]`（D98 起 PDF 拆块器也走它），自己 `map` 会撞上联合类型。
             *         那个取值函数就是为"集中一处收窄"而存在的（见 `core/segments.ts`）。
             */
            (segmentsOf(anchor) ?? []).map((seg) => seg.filePath).filter((p) => p !== '' && p !== anchorFile),
          )
        : undefined;

    return createOrchestrator({
      chat: createOpenAICompatibleProvider({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        extraHeaders: provider.extraHeaders,
        extraBody: provider.extraBody,
        onResponse: ({ status, raw }) => note(`端点原始响应（HTTP ${status}）：${raw.slice(0, 16000)}${raw.length > 16000 ? '（截到 16000 字）' : ''}`),
      }),
      routeModel: createModelRouter({
        tier1Model: provider.tier1Model,
        tier2Model: provider.tier2Model,
      }),
      adapter: adapterFor(anchor),
      makeOutline,
      maxFetchRounds: cfg.maxFetchRounds,
      temperature: cfg.temperature,
      style: cfg.style,
      language: cfg.language,
      fetchPolicy: boundary?.policy,
      candidateFiles: boundary?.policy.candidates,
      workspaceFiles: boundary?.pool,
      // token 用量（D120）：**只活在内存里**，边跑边刷面板最下面那一行。
      // 面板可能还没建（结果出来才建）—— 那时先记着，建面板时用它当初值。
      onUsage: (total) => {
        /**
         * 追问那一轮要**累加**（D126）。面板那一行的标题是「本次用量」，而"本次"
         * = 从第一次讲解开始到现在 —— 不累加的话，追问一跑，那一行会从"整段的用量"
         * 掉成"只这一问的用量"，数字**变小**，看起来像退款。
         *
         * 注意"累计"这个词在两侧的含义不同：编排器内部的 `total` 是**它自己那一次调用**
         * 的累计（每建一个 provider 就重新计账），所以跨 prompt 的累加只能在这里做。
         */
        const merged =
          opts.followUp === undefined || usageThisRun === undefined ? total : addUsage(usageThisRun, total);
        usageThisRun = merged;
        sidebar?.setUsage(merged);
      },
      followUp: opts.followUp,
      logger: loggerOf(),
      onDiagnostic: note,
    });
  }

  async function explain(anchor: Anchor): Promise<void> {
    /**
     * **一次只许讲一份**（D68）。用户第二次按下的原因通常是"看不见进度"（D64 已经治了这个），
     * 但真按下去时会发生一件坏事：第二次照常发请求、第一次的结果白拿、两次的进度通知
     * 同时挂在屏幕上 —— 用户看到的可能是**第一次那份已经作废的通知**（第二次早已出结果），
     * 于屏幕上既有讲解又有"正在讲解…"，像卡住了。已经有一份在跑时，这一次就是重复的，
     * 明说一句然后不做（比"新的一次覆盖旧的"更省：不为同一处再花一次 token）。
     */
    if (running) {
      busyPhase = '已经在讲解这一处了 —— 这一次重复的按下了，等它出来就好';
      refreshStart();
      status.showBusy('正在讲解…');
      // 这一行是给排查用的：屏幕上那条"正在讲解…"通知滞留时，光看屏幕分不清
      // 是"两份在跑"还是别的 —— 有了它，日志里能一眼看出第二次被挡下了（D68）
      note('重复按下被忽略 —— 上一份还在跑');
      return;
    }
    running = true;
    try {
      await runExplain(anchor);
    } finally {
      running = false;
    }
  }

  async function runExplain(anchor: Anchor): Promise<void> {
    stop();
    playbackLanguage = languageOf();
    const gen = (generation += 1);
    fetchedThisRun = [];
    traceThisRun = [];
    // 新的一轮讲解从零开始计账（D120）。不清的话上一段的 token 会被算到这一段头上 ——
    // 那种数字比不显示更糟。面板那一行也一起清掉（它此刻挂的是上一轮的值）。
    usageThisRun = undefined;
    sidebar?.setUsage(null);
    // 「开始/结束」各留一行（D68）：进度通知与这份日志是同一段时间轴，
    // 屏幕上出现滞留通知时，第一件要回答的事就是"到底开了几份" —— 看这两行即可
    note(`讲解开始（第 ${gen} 次）`);
    // 面板存在的话先清空（不存在就等下面灌的时候一起给）—— 它不该显示上一轮读了什么
    sidebar?.post({ type: 'tooltrace:reset' });
    status.showBusy('正在讲解…');

    /**
     * 进度**必须挂在通知上**，不能只挂状态栏（D64）。
     *
     * @anchor 用户的原话："AI 的操作在背后看不到会有焦虑感"，而且他的 VS Code 把状态栏关了
     *         （`workbench.statusBar.visible: false`）—— 我们唯一的进度提示因此**根本不可见**。
     *         于是"点一次没反应、点第二次才行"：他没在点第二次，他是在**再点一次碰运气**，
     *         而那个时候第一次的请求刚好回来了。
     *
     * 三处一起给：状态栏（有人看）/ 通知（一定看得见，还能取消）/ 开始面板（他就是在那儿点的）。
     */
    let cancelled = false;
    let result: ExplanationResult | undefined;

    const setPhase = (message: string): void => {
      busyPhase = message;
      refreshStart(); // 他就是在这块面板上点的按钮 —— 进度必须在那儿看得见
    };

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Anchor：正在讲解', cancellable: true },
      async (progress, token) => {
        token.onCancellationRequested(() => {
          cancelled = true;
        });
        const report = (message: string): void => {
          progress.report({ message });
          setPhase(message);
        };

        try {
          report('正在准备锚点…');
          const prepared = await withPdfText(anchor);

          report('正在读模型配置…');
          onPhase = report; // 取件记录也变成进度（第 N 轮取件 / 被拒）
          const provider = await makeProvider(prepared);

          report('正在请求模型…');
          const produced = await provider(prepared);
          onPhase = undefined;

          // 期间用户又发起了一次：这次的结果已经过期，直接丢掉。
          // 没有这道闸，先发后到的那次会把 UI 拽回旧讲解（真 AI 下必然遇到）。
          if (gen !== generation) return;
          if (cancelled) {
            void vscode.window.showInformationMessage('Anchor：已取消。');
            return;
          }

          report('模型已回，正在校验输出…');
          // 第二道闸：编排层内部已经过了一次 §3.3，这里再查一次。
          // 不是不信任它，而是"渲染层只消费校验过的数据"这条规矩不该有例外 ——
          // 编排层将来多一条产出路径（比如缓存命中），这里仍然拦得住。
          const verdict = validateExplanation(produced, prepared, await makeOutline(prepared), {
            // 第二道闸门也得知道"这次读过哪些别的文件"（S9a）。集合从**取件日志**里收
            // —— 那是唯一一处把"哪次取件被接受、读的是哪个文件"记下来的地方，
            // 而且不必为了这件事去改编排器的接口。
            allowedPaths: fetchedThisRun,
          });
          if (!verdict.ok) {
            throw new AnchorError('SCHEMA_VIOLATION', `AI 输出未通过校验：${describeIssues(verdict.issues)}`, {
              issues: verdict.issues,
            });
          }
          result = verdict.result;
        } catch (err) {
          if (gen !== generation) return;
          status.hide();
          setActive(false);
          setContextKey('anchorExplain.sessionOpen', false);
          note(`讲解失败：${isAnchorError(err) ? err.code : 'ERROR'}；${userFacing(err)}`);
          void vscode.window.showErrorMessage(`Anchor：${userFacing(err)}`);
        } finally {
          onPhase = undefined;
        }
      },
    );

    // **「讲解失败」与「渲染失败」在这里被分开**（D49）：只有 provider / 校验的失败才算讲解失败；
    // 一旦有了合法的 `ExplanationResult`，`startSession` 就在 try **之外**调用 ——
    // 否则渲染面的一次异常会走进 catch，把好不容易拿到的讲解当成失败丢掉。
    note(`讲解的等待结束（第 ${gen} 次）—— 进度通知在此时关闭`);
    if (!result) {
      busyPhase = undefined;
      refreshStart();
      return;
    }
    busyPhase = undefined;
    /**
     * 把本轮的取件记录灌进侧边栏那块「取件日志」（D68）。
     * 顺序：先 reset（清掉上一轮的）再逐条 append —— 面板刚建好时这些消息会进它的重放缓冲，
     * webview 一 `ui:ready` 就照单收到，所以这里不必关心"面板的脚本起来没有"。
     */
    const panel = sidebarOf();
    panel.post({ type: 'tooltrace:reset' });
    for (const entry of traceThisRun) panel.post({ type: 'tooltrace:append', entry });
    // 先落存档再开会话（D83）：存档是"这一份讲解"的属性，与渲染成功与否无关 ——
    // 万一 `startSession` 里的某个渲染面抛了，用户至少还能重放这一份。
    rememberRun(result, anchor);
    startSession(result, anchor);
  }

  /**
   * 追问（D126）——「这一步没讲到的部分，再问一句」。
   *
   * 用户的原话："然后可以追问，追问时，只提供给AI当前代码块（或一函数等）和当前讲解，
   * 补充讲解可以插入讲解队列。"
   *
   * @anchor 这一条**不新开链路**：它把追问包成一个新的 `Anchor`，走 `makeProvider` 那一套
   *         （取件闸门、§3.3 校验、repair、取件日志、token 记账一个不少），
   *         只是多带一个 `followUp` 口径。理由：另起一条就是把这五件事各抄一遍，
   *         抄漏一件的表现是"追问比正式讲解松" —— 而那正是最不该松的地方。
   *
   *         "只给当前代码块 + 当前讲解"是**结构上**做到的：追问锚点的 `extractedText`
   *         = 这一步那一块代码（现从文件里读），prompt 里根本没有整份讲解，
   *         模型想重讲也无从讲起。要不要让它还能取件，用的是**既有的**取件范围开关
   *         （设置 `anchorExplain.fetchScope` / 本次会话的「选择这次的取件范围」命令）——
   *         没有为它单开第三个旋钮。
   */
  async function askFollowUp(index: number, question: string): Promise<void> {
    if (asking) {
      note('上一问还在跑 —— 这一次追问被忽略');
      return;
    }
    const live = session;
    const base = sessionAnchor;
    if (!live || !base) {
      void vscode.window.showWarningMessage('Anchor：讲解已经结束了 —— 先重新讲一次，再追问。');
      return;
    }
    const step = live.snapshot.result.steps[index];
    if (!step) {
      // 面板报的下标越界（webview 是外部输入）：明说，不猜它想问哪一步
      void vscode.window.showWarningMessage('Anchor：找不到要追问的那一步（列表可能已经变了）。');
      return;
    }

    asking = true;
    const panel = sidebarOf();
    panel.setAskState(index, 'running');
    note(`追问第 ${index + 1} 步：${question.slice(0, 80)}`);
    try {
      const followAnchor = await buildFollowUpAnchor(base, step);
      const provider = await makeProvider(followAnchor, { followUp: { step, index, question } });
      const produced = await provider(followAnchor);
      const verdict = validateExplanation(produced, followAnchor, await makeOutline(followAnchor), {
        /**
         * 追问只许引用"它读过的文件"。这里传空数组 —— 与"只给当前代码块"是同一条约束的
         * 两种说法：取件走的是同一条闸门，模型没读过任何别的文件，于是也就没资格引用它们。
         * （即使它真的取到了锚点文件里的别的行，那些行本来就允许引用 —— 规则是一致的那一套。）
         */
        allowedPaths: [],
      });
      if (!verdict.ok) {
        throw new AnchorError('SCHEMA_VIOLATION', `AI 输出未通过校验：${describeIssues(verdict.issues)}`, {
          issues: verdict.issues,
        });
      }


      if (session !== live) return; // 历史删除/切换或退出后，旧追问不能复活旧档。
      if (!live.insertStepsAfter(index, verdict.result.steps)) {
        // 模型给了空 steps（校验通常已经拦掉，这里是第二道）：如实说，不改队列
        throw new AnchorError('SCHEMA_VIOLATION', '这一次没有产出一条可以插入的补充讲解。');
      }
      panel.setAskState(index, 'idle');
      // 存档：追问**改写**它（用户的选择）—— 于是「重放上次讲解」放出来的是含补充的那一版。
      // 不另写历史 Markdown：理由见 `rememberRun` 的 `autoSave` 注释。
      rememberRun(live.snapshot.result, base, { autoSave: false });
      note(`追问完成：插入 ${verdict.result.steps.length} 步（现在共 ${live.snapshot.total} 步）`);
    } catch (err) {
      // 失败显示在**那一块下面**（不是弹通知）：三块之后，通知已经说不清是哪一次失败了
      panel.setAskState(index, 'error', userFacing(err));
      note(`追问失败：${userFacing(err)}`);
    } finally {
      asking = false;
    }
  }

  /**
   * 追问用的锚点（D126）：把"这一步"包成一个既有链路能消化的 `Anchor`。
   *
   * 换掉的是 `location`（这一步在哪）与 `extractedText`（那一段原文 —— "当前代码块"就是它），
   * 其余（`sourceType` / `sourceId` / `sourceName`）照抄底子锚点。
   *
   * @anchor 读原文失败**不中止**：只给这一步的讲解文字，模型仍然答得了
   *         "刚才那句话是什么意思"—— 那类追问根本不需要代码。
   *         少给一样，比整条路走不通好（与 `withPdfText` 同一条立场）。
   */
  async function buildFollowUpAnchor(base: Anchor, step: WalkthroughStep): Promise<Anchor> {
    const location = step.location;
    let blockText = '';
    try {
      if (isCodeLocation(location)) {
        blockText = await codeAdapter.fetchContext({
          type: 'file',
          params: { path: location.filePath, start: location.lineStart, end: location.lineEnd },
          reason: '追问：当前这一步的代码块',
        });
      } else if (isPDFLocation(location) && typeof location.filePath === 'string') {
        // `textInBBox` 取不到文字层时返回 null（扫描件是正常情况）—— 归一成空串，
        // 交给下面那条"没读到就只按讲解回答"的路（与 `withPdfText` 同一条立场）
        blockText = (await pdfAdapter.textInBBox(location.filePath, location.page, location.bbox)) ?? '';
      }
    } catch (err) {
      note(`追问：这一步的原文没读到（${describeError(err)}）—— 只按这一步的讲解回答`);
    }
    return {
      sourceType: base.sourceType,
      sourceId: base.sourceId,
      sourceName: base.sourceName,
      location,
      ...(blockText.trim() !== '' ? { extractedText: blockText } : {}),
    };
  }

  /**
   * 「重放上次讲解」（D83）—— 把存下来的那份从第 1 步再走一遍。
   *
   * @anchor 它与「重新讲一遍」**只差一个字，代价差一个数量级**：这一条不碰网络 ——
   *         `startSession` 拿的是存下来的 `ExplanationResult`，所以结果与刚才那一遍
   *         **逐字相同**（高亮的位置也一模一样），也不会再花一次 token。
   *         用户说"想再看一遍"时，想要的几乎都是这个。
   */
  function replayLast(): void {
    const run = lastRunOf();
    if (!run) {
      void vscode.window.showWarningMessage(
        'Anchor：还没有存下任何讲解 —— 先选中一段讲一次，之后就能重放了。',
      );
      return;
    }
    note('重放上次讲解（没有请求模型）');
    usageThisRun = run.usage;
    playbackLanguage = run.language ?? 'zh';
    sidebar?.setUsage(run.usage ?? null);
    startSession(run.result, run.anchor);
    void vscode.window.setStatusBarMessage('Anchor：正在重放上次那份讲解 —— 从第 1 步开始', 2500);
  }

  /**
   * 「重新讲一遍」（D83）—— 同一个锚点，**再问一次模型**。
   *
   * @anchor 走的是 `explain` 那条完整链路（进度、取件日志、§3.3 闸门、失败提示全都在里面），
   *         所以它不需要另写一套；多的只是那行日志 —— 用户连点两次时，
   *         屏幕上与日志里都要看得出**这是新的一次**，而不是重放（D68 同一条规矩）。
   */
  async function reExplainLast(): Promise<void> {
    const run = lastRunOf();
    if (!run) {
      void vscode.window.showWarningMessage(
        'Anchor：还没有讲过任何一段 —— 先选中一段，按「讲解选中的代码」。',
      );
      return;
    }
    note(`重新讲一遍：${locationLabel(run.anchor.location)}（会再问一次模型）`);
    await explain(run.anchor);
  }

  /**
   * 「讲解什么」的确认 —— S2 新增的唯一交互。
   *
   * 两种"没得讲"分开提示，因为要用户做的事不一样：没打开文件要去打开，只放了光标要去选内容。
   * 只放光标那一路**不直接开始讲整个文件**：整份文件往往是几百行，命中率通常比一段低得多，
   * 与其猜，不如把「要讲整份吗」摆出来让用户拍板（他也可以直接按 Esc 走开）。
   */
  async function askWhatToExplain(editor: vscode.TextEditor): Promise<CaptureScope | undefined> {
    const relative = vscode.workspace.asRelativePath(editor.document.uri);

    if (editor.selection.isEmpty) {
      const picked = await vscode.window.showWarningMessage(
        `Anchor：${relative} 里只放了光标，没有选中内容。`,
        '讲解整个文件',
      );
      return picked ? 'whole-file' : undefined;
    }

    const start = Math.min(editor.selection.start.line, editor.selection.end.line) + 1;
    const end = Math.max(editor.selection.start.line, editor.selection.end.line) + 1;
    const items: { label: string; description: string; scope: CaptureScope }[] = [
      { label: '讲解这段', description: `第 ${start}-${end} 行`, scope: 'selection' },
      { label: '讲解整个文件', description: `共 ${editor.document.lineCount} 行`, scope: 'whole-file' },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Anchor 讲解',
      placeHolder: '要讲解哪一段？',
    });
    return picked?.scope;
  }

  /**
   * 「这段想重点讲什么？」—— 选完范围之后、取件之前问一句（D79）。
   *
   * @anchor 为什么非有不可：一个文件往往做很多事，用户可能只想快速定位某**一个**功能。
   *         没有这一问，模型会把整段从头讲一遍，用户得听一堆他不要的东西 ——
   *         他的原话是"一个文件可能做很多事，用户可能不想都听，只想快速定位某功能"。
   *
   *         为什么**可以跳过**（回车 / Esc 都返回 undefined，不是取消整次讲解）：
   *         这句话是**可选**的补充信息，不是必填项。把它做成必答题会让"就想整段听一遍"
   *         的常见用法凭空多一步 —— 那种情况下用户想说的就是"没什么特别想听的"。
   *         Esc 在这里**不取消讲解**：取消的入口是上一步那个确认框（按 Esc 就整个走开了），
   *         这里再让 Esc 有"取消"的含义，用户按错一次就丢掉刚选好的段，代价太大。
   *
   *         提示语与占位符都**举一个例子**（"比如：只关心边界判断"）：
   *         用户第一次看到这个框时并不知道该写多细，一个例子比一句"请输入"有用得多。
   *
   * @anchor **记忆上一次**（D121）：用户的原话是"可能误操作、对上一次回答不满意，
   *         但可能给了很多的提示词，没了，再写又烦又不能完全一样。"
   *         所以上一次写的内容会被**预填**回来 —— 直接回车就是用它的原话，
   *         全选删掉就是不用它。关掉窗口也还在（存在 `workspaceState`，按工作区隔离）。
   *
   *         **他建议的"全空时按方向键上键自动填充"做不到**：`showInputBox` 是工作台自己的
   *         控件，扩展拿不到它的按键事件（没有这个 API），而注册一个全局"上箭头"键位
   *         会把编辑器里的光标移动一起吃掉（那是不能接受的代价）。
   *         能控制的是它的**初值** —— 那正好比按上键更省事：不用按任何键，内容已经在那儿。
   *
   *         预填**不覆盖**用户的判断：`value` 是可编辑的初值，不是只读提示。
   */
  async function askFocus(): Promise<string | undefined> {
    const remembered = readLastFocus(context.workspaceState);
    const typed = await vscode.window.showInputBox({
      title: 'Anchor 讲解',
      prompt:
        remembered === undefined
          ? '这段想重点讲什么？（可留空 —— 直接回车就是整段都讲）'
          : '这段想重点讲什么？（已填上一次那句 —— 回车就用它，全选删掉就不用）',
      value: remembered ?? '',
      placeHolder: '比如：只关心空/满的边界判断，别讲那些常规读写',
    });
    // 用户按 Esc → undefined（跳过）；回车但没打字 → `''`（也跳过）。
    // 两者在这里合成同一个结果，因为对下游而言它们是同一件事：没有额外要求。
    const focus = typeof typed === 'string' && typed.trim() !== '' ? typed.trim() : undefined;
    // 这一句的**正事**是把它记住（D121）。`undefined`（Esc）**不清记忆** ——
    // 那多半是"这次不想说"，而不是"把上次那句作废"；真要作废，把框清空回车一次即可。
    if (focus !== undefined) void context.workspaceState.update(LAST_FOCUS_KEY, focus);
    return focus;
  }

  async function capture(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showWarningMessage('Anchor：先打开一个文件，再选中要讲解的代码。');
      return;
    }

    /*
     * D130 的第一层分支：**当前编辑的是我们的临时文档**。
     *
     * @anchor 这一层分支存在的理由：临时文档里"选中的那几行"**不是源文件的行号** ——
     *         它需要经过来源表翻译回源文件坐标。而翻译之后的事（确认 → 问重点 → 取件 → 讲解）
     *         与平常**完全一样** —— 用户的原话是「二次选择后就和我们平时选择一样，
     *         先确认一下，再输入一段提示词，再根据这些，取件」。
     *         所以这里只翻译、不另起链路。
     */
    if (isHandoffEditor(editor)) {
      await captureFromHandoff(editor);
      return;
    }

    const scope = await askWhatToExplain(editor);
    if (!scope) return; // 用户取消：什么也不做，比默默讲一段他没点过头的内容好

    // 选完范围再问"重点讲什么"（D79）。放在取件**之前**：这句话要进 prompt，
    // 也影响模型要不要取件（比如"只关心边界判断"它就会去读宏定义）——
    // 取完件再问就晚了。
    const focus = await askFocus();

    let anchor: Anchor;
    try {
      anchor = await codeAdapter.capture(scope, focus);
    } catch (err) {
      // 确认之后、取件之前环境变了（文件被关掉）。这不是"讲解失败"，所以不走 explain 的提示。
      void vscode.window.showErrorMessage(`Anchor：${userFacing(err)}`);
      return;
    }

    lastCapture = { anchor, scope };
    refreshStart();
    await explain(anchor);
  }

  // ───────────────────────────────────────────────────────────
  // 多段选择队列（D80）
  // ───────────────────────────────────────────────────────────

  /**
   * 把**当前选区**加进队列。一次一段，可以反复加 —— 这就是"一次一次选择"那一句。
   *
   * @anchor 与 `capture` 的关键区别：`capture` 是"选 → 立刻讲"，这里是"选 → 存起来"。
   *         存完之后用户可以**继续去别处选下一段**（选区会变），最后再统一讲。
   *         所以这里必须把当时的原文一并存下（`snapshotSelection`），
   *         不能只记行号回头再读 —— 中间文件可能被改、文件甚至可能被关掉。
   */
  async function addSegment(): Promise<void> {
    try {
      const editor = vscode.window.activeTextEditor;
      const handoff = editor !== undefined && isHandoffEditor(editor);
      let additions: AnchorSegment[];
      if (handoff) {
        if (!handoffDoc) throw new Error('临时文件的来源表已失效，请重新生成临时文件。');
        if (editor.selection.isEmpty) additions = [];
        else additions = await snapshotHandoffSelection(handoffDoc,
          Math.min(editor.selection.start.line, editor.selection.end.line) + 1,
          Math.max(editor.selection.start.line, editor.selection.end.line) + 1, readHandoffFile);
      } else {
        const picked = await snapshotSelection();
        additions = picked ? [picked] : [];
      }
      const seg = additions[0];
      if (!seg) {
        if (handoff && !editor.selection.isEmpty) {
          void vscode.window.showWarningMessage('Anchor：选中的是标注行或分割线，请在代码行上选一段。');
          return;
        }
        void vscode.window.showWarningMessage('Anchor：先在编辑器里选中一段，再按「加入选择队列」。');
        return;
      }

      /**
       * 换文件时**清空**队列，而不是拒绝加入。
       *
       * 为什么：一次讲解只有一个锚点文件（`mergeSegments` 也会因此报错），
       * 而用户此刻的意图几乎肯定是"我改盯另一个文件了" ——
       * 一个空招待弄清楚，一个混着两个文件的队列则会在最后一步突然报错，
       * 那时他已经选了四五段，损失太大。**早点说清楚比晚点报错好**。
       */
      const origin = handoff ? `${HANDOFF_SCHEME}:handoff` : seg.filePath;
      if (segmentQueue.length > 0 && !samePath(queueOrigin ?? segmentQueue[0]!.filePath, origin)) {
        const keep = await vscode.window.showQuickPick(
          [
            { label: '清空，只讲新文件里的这段', description: '刚才那几段会被丢掉', value: 'reset' },
            { label: '取消，回到刚才的队列', description: '这次什么都不改', value: 'cancel' },
          ],
          { title: 'Anchor 多段选择', placeHolder: '这段不在队列现在那个文件里' },
        );
        if (!keep || keep.value === 'cancel') return;
        segmentQueue = [];
      }

      // 同一段重复加入：老实加进去，而不是悄悄去重 ——
      // 用户按了两次就是按了两次，替他"聪明地"丢掉一次反而让他怀疑队列没生效。
      queueOrigin = origin;
      segmentQueue.push(...additions);

      // 加完**当场按行号排**（D80）：用户选的顺序常常是"想到哪选到哪"，
      // 而"第 1 段"这句话会在三处出现（队列那一行、可以点掉的那个列表、发给模型时标的号）。
      // 若不在这里排，用户点掉"第 1 段"移除的其实是模型眼里的第 2 段 —— 不报错、不崩，
      // 只是讲的内容与他想的不一样。排序用 core 那**唯一一个**比较器，三处才不会各排各的。
      segmentQueue.sort(compareSegments);
      syncQueue();
      refreshStart();
      // 回执要说三件事（D81）：**进了**、**现在共几段**、**接下来会发生什么**。
      // 只写"已加入第 2 段"是不够的 —— 用户此刻真正想知道的是"我攒的这些最后会怎样"。
      void vscode.window.setStatusBarMessage(
        handoff
          ? `Anchor：已加入 ${additions.length} 段源代码（${describeMapped(additions)}）—— 队列里现在有 ${segmentQueue.length} 段`
          : `Anchor：已加入第 ${seg.lineStart}-${seg.lineEnd} 行 —— 队列里现在有 ${segmentQueue.length} 段（讲的时候会合成一份）`,
        4000,
      );
    } catch (err) {
      void vscode.window.showErrorMessage(`Anchor：${userFacing(err)}`);
    }
  }

  /** 当前选区的一份**独立快照**（连原文一起）。没有选区或没有活动编辑器 → null。 */
  async function snapshotSelection(): Promise<AnchorSegment | undefined> {
    const picked = await editorPort.getSelection();
    if (!picked) return undefined;
    return {
      filePath: picked.filePath,
      lineStart: picked.lineStart,
      lineEnd: picked.lineEnd,
      text: picked.text,
    };
  }

  /**
   * 队列里每一段的"一行描述"。**三处共用**：状态栏提示、移除用的 QuickPick、「显示状态」。
   *
   * @anchor 为什么非收成一处（与 `describe.ts` 同一条理由）：这三处说的是同一件事
   *         （"队列里第 N 段是哪一行"），各写一遍的第一个后果不是重复，而是**它们会分家** ——
   *         用户按状态栏记着"第 2 段是 40-48"，点开移除清单却看到另一个行号，
   *         那一刻他会怀疑整个队列是坏的（而真正错的可能只是措辞）。
   */
  function queueLines(): { label: string; description: string; index: number }[] {
    const multiFile = new Set(segmentQueue.map(s => s.filePath)).size > 1;
    return segmentQueue.map((seg, i) => ({
      label: `第 ${i + 1} 段：${multiFile ? `${basenameOf(seg.filePath)} ` : ''}第 ${seg.lineStart}-${seg.lineEnd} 行`,
      description: firstLineOf(seg.text),
      index: i,
    }));
  }

  /**
   * 队列变了就同步那个**常驻的**计数（D81）。
   *
   * 只在这三处调用（加 / 移除 / 清空）—— 不挂在 `refreshStart()` 上：
   * 那个函数被设置变更、会话推进等一堆路径调用，而队列只在**这三件事**里变。
   */
  function syncQueue(): void {
    queueBar.update({
      count: segmentQueue.length,
      lines: queueLines().map(({ label, description }) => ({ label, description })),
      summary: describeQueue(),
    });
  }

  /** 队列里移除一段。**不重排剩下的**，只把它拿掉 —— 索引就是用户看到的那一行的序号。 */
  function removeSegmentAt(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= segmentQueue.length) return;
    segmentQueue.splice(index, 1);
    syncQueue();
    refreshStart();
  }

  function clearSegments(): void {
    segmentQueue = [];
    queueOrigin = undefined;
    syncQueue();
    refreshStart();
  }

  /**
   * 讲队列里的全部段 —— **合成一段讲**（这是用户选的语义：多段同属一个功能，要连起来讲）。
   *
   * @anchor 为什么合并而不是逐段各讲一遍：用户的场景是"一个功能分散在几处"
   *         （比如写操作和读操作分开在两个地方），他要的是"那这个功能到底怎么跑的"，
   *         而逐段各讲一遍会把这个功能切碎成 N 份互不相干的说明 —— 那还不如分别多选几次。
   */
  async function explainSegments(): Promise<void> {
    if (segmentQueue.length === 0) {
      void vscode.window.showWarningMessage('Anchor：选择队列是空的 —— 先选中一段，按「加入选择队列」。');
      return;
    }
    const focus = await askFocus();
    try {
      const merged = await buildMergedAnchor(focus);
      lastCapture = { anchor: merged, scope: 'selection' };
      refreshStart();
      await explain(merged);
    } catch (err) {
      void vscode.window.showErrorMessage(`Anchor：${userFacing(err)}`);
    }
  }

  /**
   * 把队列合成一个锚点。`sourceId` 现算（此刻的文件指纹）：
   * 队列可能攒了很久，中间文件被改过 —— staleness 要能如实反映"讲的是哪一版"。
   */
  async function buildMergedAnchor(focus: string | undefined): Promise<Anchor> {
    const first = segmentQueue[0]!;
    // 取不到指纹（文件被删/无权限）就退化成路径 —— 与 `CodeAdapter.capture` 同一条立场
    const hash = await editorPort.documentTextHash(first.filePath);
    if (queueOrigin?.startsWith(`${HANDOFF_SCHEME}:`)) return sourceSegmentsAnchor(segmentQueue, focus, hash ?? first.filePath);
    return mergeSegments(segmentQueue, {
      sourceId: hash ?? first.filePath,
      sourceName: basenameOf(first.filePath),
      focus,
    });
  }

  /**
   * 队列的现状一句话。开始面板那一行显示的**就是这句** —— 于是"左侧实时增减"看得见：
   * 每加一段、每删一段，这一句都会变（`refreshStart()` 由 `addSegment` / `removeSegmentAt` 触发）。
   *
   * `null` = 空队列（那一组按钮据此灰掉）。
   */
  function describeQueue(): string | null {
    if (segmentQueue.length === 0) return null;
    if (new Set(segmentQueue.map(s => s.filePath)).size > 1) return `${segmentQueue.length} 段（${describeMapped(segmentQueue)}）`;
    const name = basenameOf(segmentQueue[0]!.filePath);
    const lines = describeSegments(segmentQueue);
    return `${segmentQueue.length} 段（${name} 第 ${lines} 行）`;
  }

  /**
   * 从队列里挑一段移除。**用 QuickPick 而不是给面板加带参数的按钮**：
   * §5.5 的安全约定是"webview 只回传动作 id，不许指定命令参数"，
   * 而"移第 3 段"必须带参数。这条规矩不必为它破例 —— 走 QuickPick 也一样是一次点击。
   */
  async function removeSegment(): Promise<void> {
    if (segmentQueue.length === 0) {
      void vscode.window.showWarningMessage('Anchor：选择队列是空的，没有可移除的段。');
      return;
    }
    // 清单与状态栏用的是**同一份** `queueLines()`：用户在状态栏看到的是"第 2 段 40-48"，
    // 点进来移除时看到的必须一字不差是同一行（否则他会怀疑自己点错了段）。
    const picked = await vscode.window.showQuickPick(queueLines(), {
      title: 'Anchor 多段选择',
      placeHolder: `要移除哪一段？（共 ${segmentQueue.length} 段）`,
    });
    if (!picked) return;
    removeSegmentAt(picked.index);
    void vscode.window.setStatusBarMessage(
      `Anchor：已移除第 ${picked.index + 1} 段 —— 队列里还有 ${segmentQueue.length} 段`,
      3000,
    );
  }

  /** 跨扩展入口（§5.1）。参数来自别的扩展，属于外部输入，必须先过形状守卫。 */
  async function explainAnchor(rawAnchor: unknown): Promise<void> {
    if (!isAnchorLike(rawAnchor)) {
      void vscode.window.showErrorMessage('Anchor：收到的锚点格式不合法（来自其他扩展），已忽略。');
      return;
    }
    await explain(rawAnchor);
  }

  function next(): void {
    session?.next();
  }

  function prev(): void {
    session?.prev();
  }

  function playPause(): void {
    session?.togglePlay();
  }

  async function goto(): Promise<void> {
    const current = session;
    if (!current) return;

    const items = current.snapshot.result.steps.map((step, index) => ({
      label: `第 ${index + 1} 步：${step.title ?? '（无标题）'}`,
      description: locationLabel(step.location),
      index,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Anchor 讲解',
      placeHolder: '跳到哪一步？',
    });
    if (!picked) return;
    current.goto(picked.index);
  }

  /**
   * 写设置这件事的**唯一出口**：失败一律明确报出来，并给一个"打开 settings.json"的按钮（D63）。
   *
   * @anchor 为什么必须有它：`workspace.getConfiguration().update()` 在 `settings.json`
   *         **有语法错误**时会抛（VS Code 拒绝改一个坏掉的文件）。第一版 `configure` 没接住这个异常，
   *         于是用户点完三个输入框**什么都没发生**、也没有任何提示 —— 他的原话是"填完不记忆，没用"。
   *         静默失败在这一步的代价特别大：用户会以为是扩展坏了，然后再也不试。
   */
  async function writeSettings<T>(run: () => Promise<T>): Promise<T | undefined> {
    try {
      return await run();
    } catch (err) {
      const picked = await vscode.window.showErrorMessage(`Anchor：${userFacing(err)}`, '打开 settings.json');
      if (picked) await vscode.commands.executeCommand('workbench.action.openSettingsJson');
      return undefined;
    }
  }

  /**
   * `Anchor: 配置模型端点` —— 点三下把端点配好（D62）。
   *
   * @anchor 为什么值得一条专门命令，而不是让用户去设置里手写：
   *         `providers` 是**嵌套对象**，在设置界面里不好改，用户于是手写 JSON ——
   *         而这一步连续翻过三次车：找不到入口、把整段对象填进 `activeProvider`、
   *         以及**少写了一层**（`providers.baseUrl = "…"`，于是永远"没有可用的 provider"，
   *         而他看着那个 baseUrl 就在文件里）。**一件事讲清楚三次还是做不对，就不该再靠讲。**
   *
   * 所以这条命令做三件事：**先认出坏形状并修好**（D63）→ 三个输入框 → **写完验读**。
   * 全程**永不碰 apiKey**（那个走 SecretStorage）。
   */
  async function configure(): Promise<void> {
    // ① 坏形状：providers 少了 provider 那一层。先救回来，否则新配的也读不到。
    const raw = rawProviders();
    if (looksFlattened(raw)) {
      const target = configuredProviderIds()[0] ?? DEFAULT_ACTIVE_PROVIDER;
      const answer = await vscode.window.showWarningMessage(
        `Anchor：anchorExplain.providers 少了一层 —— baseUrl / tier1Model 被直接写在 providers 下面了。` +
          `正确形状是 providers.<id> = { baseUrl, tier1Model }。要我整理成 providers.${target} 吗？`,
        '整理好它',
        '我自己改',
      );
      if (answer !== '整理好它') return;

      const fixed = await writeSettings(async () => {
        await vscode.workspace
          .getConfiguration('anchorExplain')
          .update('providers', promoteFlattenedProviders(raw, target), vscode.ConfigurationTarget.Global);
        return promoteFlattenedProviders(raw, target);
      });
      if (fixed === undefined) return;

      refreshStart();
      const after = await readAnchorConfig(context);
      void vscode.window.showInformationMessage(
        after.provider
          ? `Anchor：已整理成 providers.${target}（${describeConfig(after)}）。下一步：设置 API Key。`
          : `Anchor：已整理成 providers.${target}，但仍读不到可用的 provider —— ${describeConfig(after)}`,
      );
      return;
    }

    // ② 三个输入框
    const ids = configuredProviderIds();
    let id = DEFAULT_ACTIVE_PROVIDER;
    if (ids.length > 0) {
      const picked = await vscode.window.showInputBox({
        title: 'Anchor：给哪个 provider 配端点？',
        prompt: `已有的：${ids.join(' / ')}（直接回车就改当前在用的那个）`,
        value: (await readAnchorConfig(context)).providerId,
        ignoreFocusOut: true,
      });
      if (picked === undefined) return; // Esc = 什么都不做
      id = picked.trim() || DEFAULT_ACTIVE_PROVIDER;
    }

    // 预填已有的值：改一个字段不该重打整行
    const before = rawProvider(id);
    const baseUrl = await vscode.window.showInputBox({
      title: `Anchor：providers.${id}.baseUrl`,
      // 这里写的是**知识**，不是校验：`checkBaseUrl` 只管形状（协议头、有没有带 /chat/completions），
      // 而"Anthropic 兼容端点不通"是厂商事实 —— 放在看得见的地方，比悄悄拒绝好（真实踩过）。
      prompt: 'OpenAI 兼容端点，例如 https://api.deepseek.com（DeepSeek 官方文档的 base_url，不带 /v1）—— 不是 Anthropic 兼容那一个',
      value: typeof before?.baseUrl === 'string' ? before.baseUrl : '',
      placeHolder: 'https://api.deepseek.com',
      validateInput: (value) => checkBaseUrl(value),
      ignoreFocusOut: true,
    });
    if (baseUrl === undefined) return;

    const model = await vscode.window.showInputBox({
      title: `Anchor：providers.${id}.tier1Model`,
      prompt: '端点那边认的模型 id',
      value: typeof before?.tier1Model === 'string' ? before.tier1Model : '',
      placeHolder: 'deepseek-flash',
      validateInput: (value) => (value.trim() === '' ? '模型名不能为空' : null),
      ignoreFocusOut: true,
    });
    if (model === undefined) return;

    // ③ 写 + 验读
    const written = await writeSettings(() => writeProviderSettings(id, baseUrl, model));
    if (written === undefined) return;

    refreshStart();
    const after = await readAnchorConfig(context);
    if (!after.provider) {
      // 写进去了却依然用不上：**不许报成功**（那正是上一版"不记忆"的观感来源）
      void vscode.window.showWarningMessage(`Anchor：设置写了，但还是读不到可用的 provider —— ${describeConfig(after)}`);
      return;
    }

    void vscode.window.showInformationMessage(
      `Anchor：已${written.replaced ? '更新' : '写入'}用户设置 anchorExplain.providers.${id}` +
        `（${model.trim()} @ ${normalizeBaseUrl(baseUrl)}）` +
        `${written.activeChanged ? `，并把 activeProvider 指到 ${id}` : ''}。下一步：设置 API Key。`,
    );
  }

  /**
   * 存 API Key 进 `SecretStorage`（D25）。
   *
   * @anchor 这条命令不是为了方便，而是**默认走安全路径的必要条件**：
   *         §6 规定 apiKey 优先从 SecretStorage 读，但如果没有一条写入的路，
   *         用户就只能把它填进 settings.json 的明文里 —— 那份文件会被同步、被截图、被提交。
   */
  async function setApiKey(): Promise<void> {
    const ids = configuredProviderIds();
    const providerId =
      ids.length > 1
        ? await vscode.window.showQuickPick(ids, { title: 'Anchor：给哪个 provider 存 key？' })
        : (ids[0] ?? (await readAnchorConfig(context)).providerId);

    if (!providerId) {
      void vscode.window.showWarningMessage(
        'Anchor：先在设置里配置 anchorExplain.providers（至少要有 baseUrl 与 tier1Model），再存 key。',
      );
      return;
    }
    await storeApiKey(context, providerId);
  }

  /**
   * 骨架自检命令（F2 遗留）。它同时是一次**接线验证**：
   * `locationLabel` 来自 `@anchor/core`，能正常输出就说明 workspace 链接与打包都通了。
   *
   * 它还报三件"只有肉眼可见、脚本判不了"的东西：
   *   - 讲解当前是否活着、扫到第几步第几点（用来核对 UI 有没有跟上状态机）
   *   - 状态栏项实际显示成什么（用来分辨"提示没显示"与"提示显示了但没找到"）
   *   - **上次捕获的范围**（真选区接上后，这是唯一能复核锚点区间的观测点，D51）
   *   - **模型配置**（配错了要能一眼看出来，而不是等讲解失败）
   */
  async function showState(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const selection = editor?.selection;

    const parts: string[] = ['骨架就绪', 'core 已接入'];

    if (editor && selection) {
      const loc: CodeLocation = {
        filePath: editor.document.uri.fsPath,
        lineStart: selection.start.line + 1,
        lineEnd: selection.end.line + 1,
      };
      parts.push(vscode.workspace.asRelativePath(editor.document.uri));
      parts.push(selection.isEmpty ? `光标在 ${locationLabel(loc)}` : `选中 ${locationLabel(loc)}`);
    } else {
      parts.push('没有活动的代码编辑器');
    }

    const peerInstalled = peer() !== undefined;
    parts.push(`对端 anchor-pdf：${peerInstalled ? '已安装' : '未安装'}`);

    // 真选区接上之后，"我刚才那一按到底讲了哪一段"屏幕上再也看不出来
    // （高亮画在哪由讲解内容决定，不由选区决定）。所以这里单独报一次。
    // 这句与开始面板显示的是**同一句** —— 格式化在 `describe.ts` 里只有一处。
    parts.push(
      lastCapture ? `上次捕获：${captureSummary(lastCapture.anchor, lastCapture.scope)}` : '还没有捕获过',
    );

    // 多段队列（D81）：用户报过"加入了但屏幕上没有任何提示"，
    // 所以除状态栏那个常驻计数之外，自检里也要能一眼看到队列里**到底有什么**（连每段的首行）。
    parts.push(
      segmentQueue.length === 0
        ? '多段队列：空'
        : `多段队列：${describeQueue()} ｜ ${queueLines().map((l) => `${l.label}${l.description ? ` ${l.description}` : ''}`).join('；')}`,
    );

    parts.push(`模型：${describeConfig(await readAnchorConfig(context))}`);

    // 上次讲解那份存档（D83）。**它是"看不见的手"最容易出问题的地方**：
    // 用户按了「重放上次讲解」，屏幕上是另一份讲解 —— 而那一份其实可能来自几天前。
    // 报一句"存的是哪一段、什么时候存的"，是他唯一能核对的入口。
    //
    // 位置必须**带上文件名**：S9a 起 location 可以落在别的文件里，
    // 只写「第 40-48 行」等于替他把它读成锚点文件的行号（D69 踩过的同一个坑）。
    // 文件名取 `anchor.sourceName` 而不是 `location.filePath`：后者在 `Location` 联合里
    // 不是每个成员都有（WebLocation 就没有），而且 sourceName 本来就是给人看的那个名字。
    const run = lastRunOf();
    parts.push(
      run
        ? `上次讲解：${run.anchor.sourceName} ${locationLabel(run.anchor.location)}（存于 ${stampOf(run.savedAt)}）`
        : '上次讲解：还没有存下任何讲解',
    );

    const step = session?.snapshot;
    parts.push(
      step
        ? `讲解中：第 ${step.index + 1}/${step.total} 步${step.pointIndex >= 0 ? ` · 第 ${step.pointIndex + 1}/${step.pointTotal} 点` : '（整块）'}`
        : '没有进行中的讲解',
    );

    const bar = status.probe();
    parts.push(`状态栏：${bar.shown ? bar.text : '未显示'}`);
    // 队列那一个状态栏项也报一次（D81）：用户看不到它时，要能分辨"没显示"与"被别的项挤掉"。
    const queueProbe = queueBar.probe();
    parts.push(`状态栏（队列）：${queueProbe.shown ? queueProbe.text : '未显示'}`);

    const line = parts.join(' · ');
    console.log('[anchor] showState:', line);
    void vscode.window.showInformationMessage(`Anchor：${line}`);
  }

  // 固定按钮（活动栏容器 + 里面的「开始」视图）。注册本身只是"挂个号"，
  // 视图要等用户点开才存在 —— 所以 `start` 是懒的（见 refreshStart）。
  start = StartViewProvider.register(
    context,
    {
      onRun: (id) => void runStartAction(id),
      // D130：投币（用户按了「生成临时文件」）。**这里才做实事** —— 解析、读文件、开文档。
      onHandoff: (text) => void loadHandoff(text),
      // D130：打字时的草稿。**只存不动** —— 这条路径上不能有任何 IO，
      // 否则"打个字"就会触发读文件（见协议里那两条消息为什么分开）。
      onHandoffDraft: (text) => {
        handoffDraft = text;
      },
      // D132：复制提示词。由**宿主**写剪贴板（webview 的 navigator.clipboard 不保证可用，
      // 失败时静默无效），而且提示词本身就在宿主手里（HANDOFF_PROMPT），不用面板传副本。
      onCopyPrompt: () => void copyHandoffPrompt(),
    },
    makeStartModel,
  );

  /**
   * 打开设置，并筛到我们的配置项（D61）。
   *
   * @anchor 这是开始面板里**唯一**一条不指向我们自己功能的动作（它落到 VS Code 的内置命令
   *         `workbench.action.openSettings` 上）。之所以包成一条我们自己的命令，而不是让面板
   *         直接指向内置命令，是因为有一条锁断言"动作表里的每条命令都在所属扩展里声明过" ——
   *         内置命令没法声明，那条锁就守不住了。包一层，规则不变，而且用户也能从命令面板
   *         （或在键盘快捷方式里给它绑一个键）用到它。
   *
   * **参数放在这里，不放面板**：面板只会说"执行哪条命令"，说不出"带什么参数"
   * （§5.5 的 `start:run` 只回传 id，这是刻意的）。所以命令自己带着它要的参数。
   */
  async function openSettings(): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'anchorExplain');
  }

  /**
   * 端点自检（D135）——「模型没说话」那条报错**指着它**。
   *
   * @anchor 为什么必须有这条命令：报错只能告诉我们"我们没拿到正文"，但正文为什么没来
   *         有好几种完全不同的原因（模型名错 / 端点把正文放进 `reasoning_content` /
   *         限流 / 400）。这些**发一次最小请求就看得出来**，而用户手里只有一个报错框。
   *         我们能在扩展里做的事就到此为止 —— 把事实摆出来，判断留给用户。
   *
   * @anchor 为什么**不**顺手替他改配置（例如猜一个模型名写回 settings）：
   *         猜错了就是把他从一个看不懂的报错换成另一个看不懂的报错，而且这次
   *         连"是谁改的"都不知道。宁可让他自己看见 `content: ""` 与
   *         `reasoning_content: "..."` 并排摆在那 —— 那一眼比任何猜测都确定。
   *
   * @anchor 为什么**走真 provider**（而不是自己组一个 fetch）：这样它验的是
   *         "我们平时发的那套东西"（同一个 baseUrl、同一套鉴权头、同一份 extraBody）。
   *         自己另写一份，测出来的成功对真实链路没有保证。
   */
  async function checkEndpoint(): Promise<void> {
    const read = await readAnchorConfig(context);
    const provider = read.provider;
    if (!provider) {
      void vscode.window.showErrorMessage(`Anchor：${describeConfig(read)}`);
      return;
    }

    const channel = vscode.window.createOutputChannel('Anchor');
    channel.appendLine('');
    channel.appendLine(`===== 端点自检（${new Date().toLocaleString()}）=====`);
    channel.appendLine(`baseUrl ：${provider.baseUrl}`);
    channel.appendLine(`model   ：${provider.tier1Model}`);
    channel.appendLine(`extraBody：${JSON.stringify(provider.extraBody ?? {})}`);

    /**
     * 用**最朴素的一句提问**，不带 tools。
     * @anchor 为什么不带 tools：目的正是要复现"我们有没有拿到 content"这一件事。
     *         带上 tools 会让端点可能选择"只要工具、不说话"，那反而是**正常**的一轮，
     *         会把自检的结论搅浑。这一问只求一句人话。
     */
    const probe = createOpenAICompatibleProvider({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      extraHeaders: provider.extraHeaders,
      extraBody: provider.extraBody,
      onResponse: ({ status, raw }) => {
        channel.appendLine(`HTTP ${status}`);
        try {
          const payload: unknown = JSON.parse(raw);
          if (payload && typeof payload === 'object' && !Array.isArray(payload)) channel.appendLine(describeEndpointProbe(payload as Record<string, unknown>));
        } catch { /* 错误正文可能不是 JSON，下面仍给原文。 */ }
        channel.appendLine(`原始响应：${raw}`);
      },
    });

    try {
      const reply = await probe.chat({
        model: provider.tier1Model,
        messages: [{ role: 'user', content: '请只回四个字：端点正常。' }],
      });
      channel.appendLine('');
      channel.appendLine('—— 端点的回复（我们读出来的）——');
      channel.appendLine(`content         ：${JSON.stringify(reply.content)}`);
      channel.appendLine(`reasoningContent：${reply.reasoningContent === undefined ? '（端点没给）' : JSON.stringify(reply.reasoningContent)}`);
      channel.appendLine('');
      channel.appendLine(
        reply.content.trim() !== ''
          ? '✅ 本次最小请求正常返回正文。队列、取件与修复轮仍需看对应讲解日志。'
          : reply.reasoningContent !== undefined
            ? '⚠ 正文缺失：端点只回了思考内容。这是**思考模式**的行为 —— 见下面「怎么办」。'
            : '⚠ 正文缺失：端点确实回了个空的 content，且没有思考内容可用。',
      );
      channel.appendLine('');
      channel.appendLine('—— 怎么办 ——');
      channel.appendLine(
        '若上一步的结论是「正文缺失」，先确认 `tier1Model` 是当前可用的模型名（写错会 400，不会空回）；',
      );
      channel.appendLine(
        '再尝试通过 `extraBody` 关掉思考模式。DeepSeek 的写法是：{"thinking":{"type":"disabled"}}。',
      );
      channel.appendLine('settings.json 里长这样（providers.default.extraBody）：');
      channel.appendLine('  "anchorExplain.providers": {');
      channel.appendLine('    "default": { "baseUrl": "https://api.deepseek.com", "tier1Model": "deepseek-flash",');
      channel.appendLine('                 "extraBody": { "thinking": { "type": "disabled" } } }');
      channel.appendLine('  }');
      channel.show(true);
      void vscode.window.showInformationMessage('Anchor：端点自检完成 —— 结论在「Anchor」输出面板里。');
    } catch (err) {
      channel.appendLine('');
      channel.appendLine('❌ 请求本身失败了（这比"空回复"更明确 —— 不是模型不说话，是这一跳没通）：');
      channel.appendLine(userFacing(err));
      channel.appendLine('');
      channel.appendLine('—— 怎么办 ——');
      channel.appendLine('上面这条是端点原样返回的。常见三类：');
      channel.appendLine('  · 400 / model not found → `tier1Model` 不是当前可用的模型名，去查该厂商的文档');
      channel.appendLine('  · 401 / invalid api key → 跑一次命令「Anchor: 设置 API Key」重填');
      channel.appendLine('  · 连不上 / ENOTFOUND   → `baseUrl` 写错了，或网络/代理不通');
      channel.show(true);
      void vscode.window.showErrorMessage(`Anchor：端点自检失败 —— 原文在「Anchor」输出面板里。`);
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('anchorExplain.capture', capture),
    vscode.commands.registerCommand('anchorExplain.explainAnchor', explainAnchor),
    // D80：多段选择队列
    vscode.commands.registerCommand('anchorExplain.addSegment', addSegment),
    vscode.commands.registerCommand('anchorExplain.explainSegments', explainSegments),
    vscode.commands.registerCommand('anchorExplain.clearSegments', clearSegments),
    vscode.commands.registerCommand('anchorExplain.removeSegment', removeSegment),
    vscode.commands.registerCommand('anchorExplain.next', next),
    vscode.commands.registerCommand('anchorExplain.prev', prev),
    vscode.commands.registerCommand('anchorExplain.stop', stop),
    vscode.commands.registerCommand('anchorExplain.goto', goto),
    vscode.commands.registerCommand('anchorExplain.playPause', playPause),
    vscode.commands.registerCommand('anchorExplain.showStart', showStart),
    // S-P2：块流窗口（相册）。传一个 pdf 的 uri 也能用（未来的右键入口走这条）
    vscode.commands.registerCommand('anchorExplain.showBlocks', (uri?: unknown) => void showBlocks(uri)),
    vscode.commands.registerCommand('anchorExplain.openSettings', openSettings),
    vscode.commands.registerCommand('anchorExplain.configure', configure),
    vscode.commands.registerCommand('anchorExplain.showState', showState),
    vscode.commands.registerCommand('anchorExplain.setApiKey', setApiKey),
    // D135：端点自检 —— 「模型没说话」那条报错指着它，是用户唯一能自己走完的一步
    vscode.commands.registerCommand('anchorExplain.checkEndpoint', () => void checkEndpoint()),
    // D83：讲完之后的两个出口。**命令与面板按钮同源** —— 面板点「重放上次讲解」与
    // 在命令面板里执行这条命令走的是同一条路（S8「面板没有可糊的地方」同一条规矩）。
    vscode.commands.registerCommand('anchorExplain.replayLast', replayLast),
    vscode.commands.registerCommand('anchorExplain.reExplain', reExplainLast),
    // D89：讲解面板的字号（与 VS Code 的窗口缩放互不相干）、导出与历史文件夹
    vscode.commands.registerCommand('anchorExplain.fontLarger', () => changeFontScale('larger')),
    vscode.commands.registerCommand('anchorExplain.fontSmaller', () => changeFontScale('smaller')),
    vscode.commands.registerCommand('anchorExplain.fontReset', () => changeFontScale('reset')),
    vscode.commands.registerCommand('anchorExplain.exportLast', () => void exportLast()),
    vscode.commands.registerCommand('anchorExplain.openHistoryFolder', () => void openHistoryFolder()),
    vscode.commands.registerCommand('anchorExplain.showHistory', () => void showHistory()),
    // D97：讲解语言一键切换（中文 ↔ English）
    vscode.commands.registerCommand('anchorExplain.toggleLanguage', () => toggleLanguage()),
    // D119：让用户自己给"这一次"定取件范围（只影响本次会话）
    vscode.commands.registerCommand('anchorExplain.pickFetchScope', () => void pickFetchScope()),
    // D130：外部 Agent 的位置交接。两条命令各自对应面板上那一组的两条动作 ——
    // 于是"面板上点"与"命令面板里找"走的是同一条路（S8 的"多处入口、一处实现"）。
    vscode.commands.registerCommand('anchorExplain.loadHandoff', () => void pickHandoffFile()),
    vscode.commands.registerCommand('anchorExplain.reopenHandoff', () => void reopenHandoff()),

    // 开始面板显示的四件事里，有两件不经过 emit：模型配置（改设置）与对端（装/卸线2）。
    // 不订阅它们的话，面板会一直显示打开那一刻的旧话。
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('anchorExplain')) refreshStart();
    }),
    vscode.extensions.onDidChange(() => refreshStart()),

    // staleness：讲解期间文档被改动 → 标记失效，由状态栏如实告诉用户，而不是继续画错位的框
    vscode.workspace.onDidChangeTextDocument((e) => {
      const stale = session?.snapshot.step;
      if (stale && isCodeLocation(stale.location) && samePath(stale.location.filePath, e.document.uri.fsPath)) {
        session?.markStale();
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      /**
       * 关掉**锚点文件**才可能是"这次讲解到头了"（D78）。
       *
       * @anchor 这里曾经是"关掉任何一步所在的文件就 stop()"，而那是一条**必然踩到的死路**：
       *         播放器用**预览标签**打开跨文件的目标（D69/D77），而 VS Code 的预览标签会被
       *         下一个预览**替换掉** —— 于是"从 main.c 讲进 main.h"这件事本身就会
       *         **关掉 main.c 的标签**（`onDidCloseTextDocument(main.c)`）。
       *         用户看到的是：刚讲进第二个文件，面板就变成"已结束"，
       *         「下一步」和每一张卡片全部点不动。
       *         （原话：「当前讲解第2段，从 main.c 进入 main.h，但是不能点击下一步，不能点击卡片」。）
       *
       *         **第一版修错了方向**：只把判据收窄成"锚点文件被关也停"。但预览替换关掉的
       *         恰恰**常常就是锚点文件自己**（锚点文件通常就是用户一开始在看的那一个）——
       *         所以收窄之后照样卡死。这也是为什么护栏必须真的复现"锚点文件被预览替换掉"
       *         这一幕，而不是随便拿一个别的文件来试（拿错方向写的护栏会恒绿、测不出东西）。
       *
       *         真正的判据不是"哪个文件被关了"，而是**"关完之后还有没有得讲"**：
       *         `onDidCloseTextDocument` 在**预览替换**和**用户主动关标签**下都会触发，
       *         两者在回调里长得一模一样，唯一的区别是**下一刻锚点文件还在不在可见编辑器里**。
       *         所以这里不当场决定，而是推迟到下一次 `onDidChangeVisibleTextEditors` 再看一眼：
       *         锚点文件重新可见了（播放器把它又打开了）→ 什么都没发生，讲解继续；
       *         锚点文件确实不在任何可见编辑器里了 → 那才是用户真的关掉了它，这时才停。
       *
       *         没有锚点文件时（PDF 锚点 / 老锚点）**一律不 stop**：那种情形下我们拿不到
       *         "哪个文件的关闭意味着结束"这个信息，宁可什么都不做，也不要再制造一次误杀。
       *
       *         **D82 补正**：上面这套推理里有一句是不成立的 ——「锚点文件重新可见了
       *         （播放器把它又打开了）」并不会发生：播放器**只开当前这一拍的焦点文件**，
       *         没有任何理由把落单的锚点文件再打开一次。所以真正决定收不收工的判据
       *         搬到了下面那个 handler 里（"这一拍还有落脚点吗"），请看那一段的长注释。
       *
       *         **D84 补正**：这一条还多做了一件事 —— **只给"与本次讲解有关的关闭"立案**。
       *         它是任何文档关闭都会触发的，而"待定"这个状态只该由**我们关心的那次关闭**产生；
       *         详见 `sessionFiles()` 与 `evaluateSessionEnd()` 的长注释。
       */
      if (!session) return;
      if (!sessionFiles().some((path) => samePath(path, doc.uri.fsPath))) {
        note(`关文件：${basenameOf(doc.uri.fsPath)} —— 与这次讲解无关，不立案`);
        return;
      }
      note(`关文件：${basenameOf(doc.uri.fsPath)} —— 是这次讲解的文件，先记下（等屏幕落定再判）`);
      pendingAnchorClose = true;
    }),
    /**
     * 与上面那一条配对：**推迟一拍再看结果**（D78）。
     *
     * @anchor 为什么用"可见编辑器变了"当触发器，而不是 `setTimeout`：
     *         预览替换是 VS Code 在一次编辑器切换里**连着**做的（关旧的、开新的），
     *         `onDidChangeVisibleTextEditors` 是**语义上的**"编辑器切换有动静了"信号；
     *         定时器等的是一个猜出来的毫秒数，慢机器上会早退、快机器上会白等。
     *
     *         **D84：它只是判定的入口之一，不再自己判。** 真正的判据（以及它为什么
     *         必须在"我们自己的换文件"结束之后才能做）全在 `evaluateSessionEnd()` 里 ——
     *         这里与播放器的"落定"回调都只是叫它一声。
     */
    vscode.window.onDidChangeVisibleTextEditors(() => {
      evaluateSessionEnd();
    }),

    {
      dispose: () => {
        unsubscribe?.();
        settleSub?.();
        session?.dispose();
        player?.dispose();
        status.dispose();
        sidebar?.dispose();
        output?.dispose();
        // D89：扩展被卸载/禁用也算"讲解结束" —— 官方的报错提示必须还回来
        void veil.restore();
      },
    },
  );
}
