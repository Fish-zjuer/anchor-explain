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

目标路径：`packages/core/src/types.ts` — 状态：`待落地`

### 1.1 规范原文部分（一字不改）

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

### 1.2 加法扩展（在原字段语义不变的前提下新增）

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

```ts
// 实际接入的 union。WebLocation 保留声明以备后续，但本次不实现、不进 union 使用面。
type ActiveLocation = CodeLocation | PDFLocation;
```

- orchestrator **只认 `Location`**，不关心来源
- `WebAdapter` 本次不实现；`ContextRequest.type === 'dom_subtree'` 无适配器受理，一律拒绝

### 1.4 类型守卫（F1 落地）

```ts
function isPDFLocation(loc: Location): loc is PDFLocation;
function isCodeLocation(loc: Location): loc is CodeLocation;
function isWebLocation(loc: Location): loc is WebLocation;
```

---

## §2 Ports（保证 core/adapters 零 vscode 依赖）

目标路径：`packages/core/src/ports.ts` — 状态：`待落地`

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

目标路径：`packages/core/src/types.ts`（接口）/ `adapters/SourceAdapter.ts` — 状态：`待落地`

```ts
interface AdapterCapabilities {
  contextTypes: ContextRequest['type'][];   // pdf → ['page_range']；code → ['file']
  maxSpan: number;                          // page_range 的最大页跨度，默认 5
}

interface SourceAdapter {
  type: SourceType;
  capabilities: AdapterCapabilities;
  detect(): Promise<boolean>;               // 当前环境是否适用
  capture(): Promise<Anchor>;               // 截图 + 产出 Anchor
  fetchContext(req: ContextRequest): Promise<string>;   // 取件
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
4. **不做覆盖度校验**（已砍，见 `DECISIONS.md` D14）
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

目标路径：`packages/core/src/logging.ts` — 状态：`待落地`

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

所有条目进环形缓冲（上限 100），并在侧边栏 `ToolTrace` 面板可视。

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

## §9 模块路径映射（目标，F1/F2/S* 逐步落地）

| 路径 | 职责 | 落地切片 |
|---|---|---|
| `packages/core/src/types.ts` | §1 全部类型 + 守卫 | F1 |
| `packages/core/src/ports.ts` | §2 ports | F1 |
| `packages/core/src/normalizeBBox.ts` | bbox 归一化（**唯一实现，fork 也复用**） | F1 |
| `packages/core/src/locationLabel.ts` | 位置标签（`第 40-48 行` / `第 23 页`） | F1 |
| `packages/core/src/errors.ts` | 类型化错误 | F1 |
| `packages/core/src/logging.ts` | §7 结构化日志 | F1 |
| `packages/core/src/fakes/fakeProvider.ts` | 脚本化 `ExplanationResult` | F2 |
| `packages/core/src/fakes/fakeEditorPort.ts` | 写死 40-48 行的假选区 | F2 |
| `packages/extension-anchor/src/vscode/ports/*` | ports 的 vscode 真实现 | S1 / S2 |
| `packages/extension-anchor/src/playback/*` | decoration 渲染与流转 | S1 |
| `packages/extension-anchor/src/sidebar/*` | 侧边栏（原生 DOM）+ 状态栏 + 键位解析 | S1 |
| `packages/extension-anchor/src/orchestrator/*` | 编排循环、校验、ModelRouter | S1(校验) / S3(循环) |
| `packages/extension-anchor/src/prompts/*` | 所有 prompt | S3 |
| `packages/extension-anchor/src/adapters/CodeAdapter.ts` | 代码来源适配器 | S2 / S3 |
| `packages/extension-anchor-pdf/media/anchor-select.js` | 注入式框选 overlay | S5 |
| `packages/extension-anchor-pdf/src/anchor/*` | bbox 换算 / Anchor 组装 / 消息桥 | S5 / S6 |
| `packages/extension-anchor/src/adapters/PDFAdapter.ts` + `adapters/pdf/*` | PDF 无头取件 | S7 |
