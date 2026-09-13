# CONTRACTS.md — 接口契约（单一事实源）

> **改任何 type / 接口签名，必须同步本文件。** 源码与本文件不一致 = 未完成。
> 只写签名 / 路径 / 语义，不贴大段实现。

## 状态词汇

| 状态 | 含义 |
|---|---|
| `待落地` | F1 要写成真实代码的条目 |
| `已冻结` | 类型与接口，改动需用户确认 |
| `已冻结（可调）` | 键位、文案、默认值，改动成本低，可直接调 |

---

## §1 核心类型

目标路径：`packages/core/src/types.ts` — 状态：`已冻结` — 落地行号见 §9.1

### 1.1 规范原文部分（声明与规范逐字一致；仅补注释，未增删任何字段）

```ts
type SourceType = 'pdf' | 'web' | 'code';

interface PDFLocation {
  page: number;                              // 1-based
  bbox: [number, number, number, number];     // 归一化 0-1: x1,y1,x2,y2
}

interface WebLocation {
  url: string;
  selector: string;
  scrollY: number;
}

interface CodeLocation {
  filePath: string;
  lineStart: number;                         // 1-based, inclusive
  lineEnd: number;                           // 1-based, inclusive
}

type Location = PDFLocation | WebLocation | CodeLocation;

interface Anchor {
  sourceType: SourceType;
  sourceId: string;          // 文档指纹，用于会话记忆
  sourceName: string;        // 显示名
  location: Location;
  capturedImage?: string;    // base64，第二层才用
  extractedText?: string;    // 第一层优先
  neighborHint?: string;     // 如 "第 23 页附近"
}

interface ContextRequest {
  type: 'page_range' | 'dom_subtree' | 'file';
  params: Record<string, any>;
  reason: string;
}

interface WalkthroughStep {
  location: Location;
  text: string;
  color?: string;
}

interface ExplanationResult {
  steps: WalkthroughStep[];
  summary: string;
  confidence: number;
}
```

> ⚠ 上表是**规范原版**，勿直接照抄成实现。`WalkthroughStep` 与 `ExplanationResult` 的
> **最终形态在 §1.2**（含新增的可选字段）。

### 1.2 加法扩展【以下全部为新增，非规范原文】

理由：对齐 MCP Walkthrough 已验证的**两层 step 模型**（step 级引入语 + 内部子高亮序列），
使 teleprompter 式逐条高亮成为可能。详见 `PRIOR-ART.md` §1。

```ts
type HighlightEmphasis = 'primary' | 'context' | 'definition' | 'caveat';

interface SubHighlight {
  location: Location;
  narration: string;
  emphasis?: HighlightEmphasis;     // 映射到主题感知配色，见 §4.3
}

interface WalkthroughStep {
  location: Location;               // 原字段，不变：本步的主定位
  text: string;                     // 原字段，不变：本步讲解正文
  color?: string;                   // 原字段，不变
  title?: string;                   // 新增：步标题
  intro?: string;                   // 新增：步级引入语（对应 MCPW 的 explanation）
  highlights?: SubHighlight[];      // 新增：子高亮序列
}

interface ExplanationResult {
  steps: WalkthroughStep[];         // 原字段，不变
  summary: string;                  // 原字段，不变
  confidence: number;               // 原字段，不变，0-1
  title?: string;                   // 新增：整段讲解标题
}
```

### 1.3 联合类型收窄（已确认）

实际接入的来源只有 code 与 pdf。**不另建专用 union**——需要收窄时直接用 `Location`。

- orchestrator **只认 `Location`**，不关心来源
- `WebLocation` 保留声明以备后续，本次不实现、不接入
- `WebAdapter` 本次不实现；`ContextRequest.type === 'dom_subtree'` 无适配器受理，一律拒绝

### 1.4 类型守卫（F1 落地）

```ts
function isPDFLocation(loc: Location): loc is PDFLocation;
function isCodeLocation(loc: Location): loc is CodeLocation;
function isWebLocation(loc: Location): loc is WebLocation;
```

---

## §2 Ports（保证 core/adapters 零 vscode 依赖）

目标路径：`packages/core/src/ports.ts` — 状态：`已冻结` — 落地行号见 §9.1

> **本节全部为新增，非规范原文。** 规范未定义 ports 层，这是我们为"核心零 vscode 依赖"
> 加的抽象（`DECISIONS.md` D19）。

`adapters/` 只依赖以下接口；真实现在 `packages/extension-anchor/src/vscode/ports/`。

```ts
interface EditorSelection {
  filePath: string;
  lineStart: number;      // 1-based, inclusive
  lineEnd: number;        // 1-based, inclusive
  text: string;           // 选中行原文（含行尾换行）
}

interface EditorPort {
  getSelection(): Promise<EditorSelection | null>;
  getActiveFilePath(): Promise<string | null>;
  revealLocation(loc: CodeLocation, opts?: { inCenter?: boolean }): Promise<void>;
  documentTextHash(filePath: string): Promise<string | null>;   // 用于 staleness 检测
}

interface FileSystemPort {
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
}

interface ImageRendererPort {
  // 第二层视觉兜底；未注入时 PDFAdapter 退化为纯文本
  renderRegion(sourceId: string, location: Location): Promise<string | null>;  // 返回 dataURL
}
```

---

## §3 适配器接口

目标路径：`packages/core/src/types.ts` — 状态：`已冻结` — 落地行号见 §9.1
（本节原先还写了 `adapters/SourceAdapter.ts`：该路径不存在，也不在任何切片范围内，已删除。）

```ts
// 【新增，非规范原文】能力声明，用于取件校验（CONTRACTS §3.2）
interface AdapterCapabilities {
  contextTypes: ContextRequest['type'][];   // pdf → ['page_range']；code → ['file']
  maxSpan: number;                          // page_range 的最大页跨度，默认 5
}

// 【规范原文】四个字段的名称、类型、顺序均不得改；detect 保持同步，不要改成 Promise。
// 依据：CodeAdapter 的判据是 window.activeTextEditor（属性，同步）；
//       PDFAdapter 的判据是宿主内存中的已打开 PDF 会话集合（同步）。
//       若未来确需异步，属契约变更，须经用户确认。
interface SourceAdapter {
  type: SourceType;
  detect(): boolean;                        // 当前环境是否适用
  capture(): Promise<Anchor>;               // 截图 + 产出 Anchor
  fetchContext(req: ContextRequest): Promise<string>;   // 取件
  capabilities: AdapterCapabilities;        // 【新增，非规范原文】置于末尾以保规范顺序
}
```

### §3.1 能力矩阵（冻结）

| adapter | `contextTypes` | `detect()` 依据 | `capture()` 产出 |
|---|---|---|---|
| `CodeAdapter` | `['file']` | `window.activeTextEditor` 存在且有选区 | `CodeLocation` + `extractedText` = 选中行原文 |
| `PDFAdapter` | `['page_range']` | 存在已打开的 PDF 会话 | `PDFLocation` + `capturedImage`（拖拽裁出的截图） |
| `WebAdapter` | — | **本次不实现** | — |

### §3.2 取件校验规则（冻结）

`validateContextRequest(req, anchor, state)` 必须全部满足，否则**拒绝**：

1. `req.type` ∈ `adapter.capabilities.contextTypes`
2. `page_range`：`start`/`end` 为整数，`1 ≤ start ≤ end ≤ pageCount`，`end - start + 1 ≤ maxSpan`
3. `file`：`params.path` 必须等于 `anchor.location.filePath`（不允许模型漫游到别的文件）
4. 去重：与已取件区间重叠 → 不重复取，回灌「该区间已取过」+ 已有内容
5. 频率：总取件次数 `≤ maxFetchRounds`（默认 3）

**拒绝不抛错**：回灌一条工具结果「请求被拒绝：<reason>，请基于现有信息作答」，让模型自我纠正。
**每次取件必须落日志**（见 §7）。

### §3.3 输出校验规则（冻结）

`validateExplanation(raw, anchor, ctx)`：

1. 能容忍 ```json 围栏与前后散文，抽出 JSON 并解析
2. `steps.length ≥ 1`；`confidence ∈ [0,1]`；`summary` 非空字符串
3. 每个 `step.location`（及 `step.highlights[].location`）必须：
   - `sourceType` 与 `anchor.sourceType` 一致
   - `code`：`filePath === anchor.location.filePath`；`1 ≤ lineStart ≤ lineEnd ≤ 文档总行数`
   - `pdf`：`1 ≤ page ≤ pageCount`；`bbox` 四项 ∈ `[0,1]` 且 `x1 < x2`、`y1 < y2`
4. **不做覆盖度校验**（已砍，见 `DECISIONS.md` D16）
5. 校验失败 → 带修复提示（`prompts/repair.ts`）重试一次；仍失败 → **报错给用户，不渲染**

---

## §4 命令、键位、context key、配色

### §4.1 命令（冻结）

| 命令 ID | 作用 | 默认键 | `when` |
|---|---|---|---|
| `anchorExplain.capture` | 捕获当前选区并请求讲解 | `ctrl+shift+a` / `cmd+shift+a` | `editorTextFocus` |
| `anchorExplain.next` | 下一步 | `alt+]` | `anchorExplain.walkthroughActive` |
| `anchorExplain.prev` | 上一步 | `alt+[` | `anchorExplain.walkthroughActive` |
| `anchorExplain.stop` | 退出并清除高亮 | `escape` | `anchorExplain.walkthroughActive && !inputFocus` |
| `anchorExplain.goto` | 跳到指定步 | `ctrl+alt+w` | `anchorExplain.walkthroughActive` |
| `anchorExplain.playPause` | 播放 / 暂停 | `ctrl+shift+space` | `anchorExplain.walkthroughActive` |
| `anchorExplain.explainAnchor` | 接受外部 Anchor 并起讲解（跨扩展入口） | — | — |
| `anchorExplain.showState` | 显示当前状态（F2 的骨架验证命令） | — | — |
| `anchorPdf.openInAnchorViewer` | 用 Anchor 的 PDF 视图打开 | — | — |
| `anchorPdf.revealPage` | 滚动 PDF 到指定页（跨扩展调用） | — | — |

**默认不绑 `Space`**（避免抢打字）。状态：默认键位为 `已冻结（可调）`。

### §4.2 context key（冻结）

| key | 类型 | 置位时机 |
|---|---|---|
| `anchorExplain.walkthroughActive` | boolean | 讲解开始置 `true`；`stop` / 讲完 / 编辑器关闭时置 `false` |
| `anchorPdf.selectMode` | boolean | PDF 进入框选模式置 `true` |

### §4.3 `emphasis` → 配色（`已冻结（可调）`）

| emphasis | 语义 | 视觉 |
|---|---|---|
| `primary` | 本步重点 | 半透明强调背景 + border 描边 |
| `context` | 上下文 | 更淡的中性背景，无描边 |
| `definition` | 定义/声明处 | 半透明背景 + 左侧边线 |
| `caveat` | 注意/坑 | 半透明警示背景 + 虚线描边 |

全部走主题色变量（不写死十六进制），`isWholeLine: true`，纯视觉不改文件。

---

## §5 跨扩展与 webview 消息协议（冻结）

### §5.1 跨扩展（`executeCommand`，单向、无返回值依赖）

```ts
// ext-B(PDF) → ext-A：交出一个 Anchor，请求讲解
vscode.commands.executeCommand('anchorExplain.explainAnchor', anchor: Anchor);

// ext-A(侧边栏) → ext-B：滚动 PDF 到指定页
vscode.commands.executeCommand('anchorPdf.revealPage', page: number);
```

未安装对端时**明确提示，不静默失败**。

### §5.2 ext-B 内部：宿主 ↔ 注入脚本

```ts
// 宿主 → 注入脚本
type HostToSelect =
  | { type: 'anchor:enterSelectMode' }
  | { type: 'anchor:exitSelectMode' }
  | { type: 'anchor:gotoPage'; page: number };

// 注入脚本 → 宿主
type SelectToHost =
  | { type: 'anchor:ready' }
  | { type: 'anchor:captured'; page: number; bbox: [number,number,number,number];
      capturedImage?: string; extractedText?: string }
  | { type: 'anchor:cancelled' };
```

### §5.3 ext-A 内部：宿主 ↔ 侧边栏 webview

```ts
// 宿主 → webview
type HostToSidebar =
  | { type: 'session:update'; result: ExplanationResult; index: number; state: WalkthroughState }
  | { type: 'session:end' }
  | { type: 'tooltrace:append'; entry: ContextRequestLogEntry };

// webview → 宿主
type SidebarToHost =
  | { type: 'ui:next' } | { type: 'ui:prev' } | { type: 'ui:goto'; index: number }
  | { type: 'ui:stop' } | { type: 'ui:revealStep'; index: number };
```

`WalkthroughState = 'idle' | 'running' | 'playing' | 'paused' | 'done' | 'error'`

### §5.4 状态栏提示

必须**读取用户实际绑定**后渲染（如 `讲解中 · Alt+] 下一步 · Esc 退出`），
读取失败才回退默认文案。实现方式见 `DECISIONS.md` D10（含其脆弱性说明）。

---

## §6 配置项（冻结）

| 配置 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `anchorExplain.providers` | object | `{}` | `{ [id]: { baseUrl, apiKey?, tier1Model, tier2Model?, extraHeaders?, extraBody? } }` |
| `anchorExplain.activeProvider` | string | `"default"` | 选中的 provider id |
| `anchorExplain.maxFetchRounds` | number | `3` | 取件轮数上限 |
| `anchorExplain.preferSecretStorage` | boolean | `true` | `apiKey` 优先从 `SecretStorage` 读，取不到再回落配置里的 `apiKey` |
| `anchorPdf.*` | — | — | 沿用 fork 原有配置项，仅改命名空间前缀 |

`extraHeaders` / `extraBody` 原样透传进请求，用于兼容任意 OpenAI 兼容端点（OpenAI / DeepSeek / 通义 / Ollama）。

---

## §7 日志（`ContextRequest` 必须记录）

目标路径：`packages/core/src/logging.ts` — 状态：`已冻结` — 落地行号见 §9.1

```ts
interface ContextRequestLogEntry {
  at: number;                              // epoch ms
  round: number;                           // 第几轮（1-based）
  request: ContextRequest;
  accepted: boolean;
  rejectReason?: string;                   // accepted=false 时必有
  resultChars?: number;                    // 返回内容长度
  durationMs?: number;
}
```

```ts
export const CONTEXT_LOG_LIMIT = 100;

interface ContextRequestLogger {
  record(entry: ContextRequestLogEntry): void;
  entries(): readonly ContextRequestLogEntry[];
  clear(): void;
}

function createContextRequestLogger(opts?: {
  limit?: number;
  sink?: (entry: ContextRequestLogEntry) => void;   // 额外落点，如 OutputChannel / ToolTrace
}): ContextRequestLogger;
```

所有条目进环形缓冲（上限 `CONTEXT_LOG_LIMIT`），并在侧边栏 `ToolTrace` 面板可视。

---

## §8 工具定义（给 LLM，冻结）

```json
{
  "name": "fetch_context",
  "description": "当截图区域信息不足、无法准确讲解时，请求获取当前文档的额外上下文。",
  "parameters": {
    "type": "object",
    "properties": {
      "request_type": { "enum": ["page_range", "dom_subtree", "file"] },
      "start": { "type": "number", "description": "起始页/行" },
      "end": { "type": "number", "description": "结束页/行" },
      "reason": { "type": "string", "description": "为什么需要这段上下文" }
    },
    "required": ["request_type", "reason"]
  }
}
```

---

## §9 模块路径映射与落地行号

### 9.1 已冻结（F1 已落地）——行号 = 实体定义所在行

| 路径 | 职责 | 关键实体行号 |
|---|---|---|
| `packages/core/src/types.ts` | §1 全部类型 + 守卫 + §3 适配器接口 | `SourceType`:14 `PDFLocation`:16 `WebLocation`:21 `CodeLocation`:27 `Location`:33 `Anchor`:35 `ContextRequest`:45 `WalkthroughStep`:51 `ExplanationResult`:61 `HighlightEmphasis`:75 `SubHighlight`:78 `AdapterCapabilities`:95 `SourceAdapter`:106 `isPDFLocation`:119 `isCodeLocation`:124 `isWebLocation`:133 |
| `packages/core/src/ports.ts` | §2 ports（**全部为新增**） | `EditorSelection`:13 `EditorPort`:20 `FileSystemPort`:28 `ImageRendererPort`:34 |
| `packages/core/src/normalizeBBox.ts` | §10.1 bbox 数学（**唯一实现，fork 也复用**） | `BBox`:8 `clamp01`:16 `normalizeBBox`:27 `coerceBBox`:42 `isValidBBox`:50 `bboxArea`:55 |
| `packages/core/src/locationLabel.ts` | §10.2 位置标签 | `formatLineRange`:12 `locationLabel`:24 |
| `packages/core/src/errors.ts` | §10.3 类型化错误 | `AnchorErrorCode`:8 `AnchorError`:16 `isAnchorError`:28 `describeError`:33 |
| `packages/core/src/logging.ts` | §7 结构化日志 | `ContextRequestLogEntry`:10 `CONTEXT_LOG_LIMIT`:20 `ContextRequestLogger`:22 `createContextRequestLogger`:28 |
| `packages/core/src/index.ts` | barrel 入口。**外部一律从 `@anchor/core` 导入，不深链 `src/`** | — |
| `packages/core/package.json` / `tsconfig.json` | 包声明与类型检查配置 | — |
| `packages/core/test/{types,locationLabel,normalizeBBox}.test.ts` | 单测（`node --test`） | — |

### 9.2 未落地（按切片）

| 路径 | 职责 | 落地切片 |
|---|---|---|
| `packages/core/src/fakes/fakeProvider.ts` | 脚本化 `ExplanationResult` | F2 |
| `packages/core/src/fakes/fakeEditorPort.ts` | 写死 40-48 行的假选区 | F2 |
| `packages/extension-anchor/src/extension.ts` | activate / 装配四层 | F2 |
| `packages/extension-anchor/src/commands.ts` | §4.1 全部命令 | S1 |
| `packages/extension-anchor/src/protocol.ts` | **§5 消息协议类型**（`WalkthroughState` / `HostToSidebar` / `SidebarToHost` / `HostToSelect` / `SelectToHost`） | S1 |
| `packages/extension-anchor/src/vscode/ports/*` | §2 ports 的 vscode 真实现 | S1 / S2 |
| `packages/extension-anchor/src/playback/*` | decoration 渲染与流转 | S1 |
| `packages/extension-anchor/src/sidebar/*` | 侧边栏（原生 DOM）+ 状态栏 + 键位解析 | S1 |
| `packages/extension-anchor/src/orchestrator/validateExplanation.ts` | §3.3 输出校验 | S1 |
| `packages/extension-anchor/src/orchestrator/*`（其余） | §3.2 取件校验、编排循环、ModelRouter | S3 |
| `packages/extension-anchor/src/prompts/*` | 所有 prompt | S3 |
| `packages/extension-anchor/src/config.ts` | §6 配置读取 + SecretStorage 覆盖 | S3 |
| `packages/extension-anchor/src/adapters/CodeAdapter.ts` | 代码来源适配器 | S2 / S3 |
| `packages/extension-anchor/src/adapters/PDFAdapter.ts` + `adapters/pdf/*` | PDF 无头取件 | S7 |
| `packages/extension-anchor-pdf/`（整树） | 线2 fork | S4 |
| `packages/extension-anchor-pdf/media/anchor-select.js` | 注入式框选 overlay | S5 |
| `packages/extension-anchor-pdf/src/anchor/*` | bbox 换算 / Anchor 组装 / 消息桥 | S5 / S6 |

### 9.3 已知结构债（F2 必须处理）

`pnpm install` 目前是在 `packages/core/` **内**跑的，因此 `pnpm-lock.yaml` 落在该目录。
按 D26，lockfile 应归**仓库根**。F2 建根 `package.json` + `pnpm-workspace.yaml` 时，
必须删掉 `packages/core/pnpm-lock.yaml` 并在根重装，否则 core 与扩展包的依赖解析会不一致。

---

## §10 纯函数与错误码契约

F1 落地的三个模块对外 API。行号见 §9.1。

### 10.1 bbox 数学（`normalizeBBox.ts`）

```ts
type BBox = [number, number, number, number];

function clamp01(n: number): number;
// 非有限数（NaN / ±Infinity）→ 0

function normalizeBBox(raw: readonly [number, number, number, number]): BBox;
// 裁剪到 [0,1] + 排序保证 x1<=x2、y1<=y2。面向"本来就该是数字"的输入（UI 像素换算）。

function coerceBBox(raw: unknown): BBox | null;
// 面向不可信输入（LLM 返回的 JSON）。形状或数值不合法返回 null。
// 与 normalizeBBox 的差异**是有意的**：这里非有限数判无效，
// 因为模型吐出 NaN 属输出损坏，必须走 §3.3 的拒绝/重试，不能静默变成零面积框。

function isValidBBox(b: BBox): boolean;
// 非退化（面积 > 0）且四个分量全在 [0,1]

function bboxArea(b: BBox): number;
```

### 10.2 位置标签（`locationLabel.ts`）

```ts
function formatLineRange(lineStart: number, lineEnd: number): string;
// 单行不加区间："第 40 行"；多行："第 40-48 行"

function locationLabel(loc: Location): string;
// code → "第 40-48 行" ｜ pdf → "第 23 页"
// web  → 主机名 + selector（截断 40 字符）。web 本次不接入，仅保证不崩。
```

### 10.3 类型化错误（`errors.ts`）

```ts
type AnchorErrorCode =
  | 'CONTEXT_REJECTED'        // 保留：适配器内部确实无法完成取件时使用
  | 'SCHEMA_VIOLATION'        // §3.3 输出校验失败且重试一次仍失败
  | 'MAX_ROUNDS_EXCEEDED'     // 取件轮数超过 maxFetchRounds
  | 'PROVIDER_ERROR'          // LLM 调用失败
  | 'ADAPTER_UNAVAILABLE'     // 当前环境没有可用适配器
  | 'PEER_EXTENSION_MISSING'; // 未安装对端扩展（如未装 anchor-pdf）

class AnchorError extends Error {
  readonly code: AnchorErrorCode;
  readonly detail: Record<string, unknown> | undefined;
}

function isAnchorError(e: unknown): e is AnchorError;
function describeError(e: unknown): string;   // 给用户看的一行，不含堆栈
```

> 注意：`ContextRequest` 被拒**不走这里**——非法取件请求回灌成工具结果让模型自我纠正
> （`DECISIONS.md` D29）。`AnchorError` 只承载真正中断流程的错误。
