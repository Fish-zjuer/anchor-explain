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
  text: string;           // 选中行原文，多行以 \n 连接，**不含末尾换行**
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

// F2 追加【新增，非规范原文】：讲解来源的接缝，即"AI 从哪来"这一问的边界。
// S1/S2 由 fakes/fakeProvider.ts 实现；S3 由 orchestrator 循环实现，签名刻意一致。
type ExplainProvider = (anchor: Anchor) => Promise<ExplanationResult>;
```

### §2.1 假货隔离点（冻结）

| 边界 | 假的实现 | 真的实现 | 替换时机 |
|---|---|---|---|
| AI 从哪来 | `fakes/fakeProvider.ts`（写死 3 个合法 step） | orchestrator 循环 + `openAICompatible` | S3 |
| 选区从哪来 | `fakes/fakeEditorPort.ts`（写死第 40-48 行） | `vscode/ports/` 下的真 `EditorPort` | S2 |

**中间链路永远是真的**：`ExplanationResult → 输出校验 → 会话状态 → decoration → 侧边栏 → 状态栏 → 键位`。
不允许把假数据写进播放器（见 `DECISIONS.md` D17）。

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
   - **路径比较忽略大小写与斜杠方向**（Windows 本身不区分大小写；严格比较会把同一个文件判成两个）
   - 文档总行数/总页数**取不到时传 `null` → 跳过该上界检查**，不是跳过整条 location 校验
4. **不做覆盖度校验**（已砍，见 `DECISIONS.md` D16）
5. 校验失败 → 带修复提示（`prompts/repair.ts`）重试一次；仍失败 → **报错给用户，不渲染**

**S1 增补两条实现约定**（都不改上表的判据，只是把边界说清楚）：

- `step.text` 必须是**非空字符串**。§3.3 原文没逐字要求，但空 text 的 step 在侧边栏里是一片空白 ——
  与其渲染一个说不出话的步骤，不如让模型重来一次。这是**比 §3.3 严一格**的规则（D44）。
- `emphasis` 不在 §4.3 的四档里时**降级为 undefined，不判失败**：它只影响颜色，
  为一个装饰性字段把整段讲解判死，代价大于收益（D41）。

**返回的是重建对象，不是原对象**：`validateExplanation` 逐字段重新组装 `ExplanationResult`，
模型多塞的键（包括 `__proto__` 之类）不可能流到渲染层。所以所有渲染方只消费它的返回值。

---

## §4 命令、键位、context key、配色

### §4.1 命令（冻结）

| 命令 ID | 作用 | 默认键 | `when` |
|---|---|---|---|
| `anchorExplain.capture` | 捕获当前选区并请求讲解 | `ctrl+shift+a` / `cmd+shift+a` | `editorTextFocus` |
| `anchorExplain.next` | 下一步 | `alt+]` | `anchorExplain.walkthroughActive` |
| `anchorExplain.prev` | 上一步 | `alt+[` | `anchorExplain.walkthroughActive` |
| `anchorExplain.stop` | 退出并清除高亮 | `escape` | `anchorExplain.sessionOpen && !inputFocus` |
| `anchorExplain.goto` | 跳到指定步 | `ctrl+alt+w` | `anchorExplain.walkthroughActive` |
| `anchorExplain.playPause` | 播放 / 暂停 | `ctrl+shift+space` | `anchorExplain.walkthroughActive` |
| `anchorExplain.explainAnchor` | 接受外部 Anchor 并起讲解（跨扩展入口） | — | — |
| `anchorExplain.showState` | 显示当前状态（F2 的骨架验证命令） | — | — |
| `anchorPdf.openInAnchorViewer` | 用 Anchor 的 PDF 视图打开 | — | — |
| `anchorPdf.revealPage` | 滚动 PDF 到指定页（跨扩展调用） | — | — |

**`stop` 的 `when` 自 S1 起是 `sessionOpen`，不是 `walkthroughActive`（D46）。** 原表写的是后者，
但两者合起来会产生一个用户可见的死键：`alt+]` 走到最后一步 → `done` → §4.2 要求
`walkthroughActive` 落 false → `escape` 的 `when` 不再匹配 → **屏幕上的荧光笔再也清不掉**，
而状态栏还在展示这三个"按不动"的键。改绑 `sessionOpen` 后：
推进类键照旧在 `done` 时失效，`stop` 一直有效到用户主动退出。

**默认不绑 `Space`**（避免抢打字）。状态：默认键位为 `已冻结（可调）`。

**mac 变体（S1 落地）**：上表只给了 win/linux 形式；mac 上一律把 `ctrl` 换成 `cmd`
（`cmd+shift+a` / `cmd+alt+w` / `cmd+shift+space`），`alt+[`、`alt+]`、`escape` 三键两侧相同。
两侧的值都写在 `contributes.keybindings` 的 `key` / `mac` 里，并由
`test/keybindingResolve.test.ts` 的耦合锁与 `WALKTHROUGH_CHORDS` 逐字比对。

**命令回调与上表的对应**：`commands.ts` 的 `registerCommands` 注册全部 8 个 ext-A 命令；
`scripts/smoke-extension.mjs` 有一条锁断言「`package.json` 声明的命令 == 实际注册的命令」。

**`title` / `category` 约定（F2 冻结）**：命令的 `title` **只写动作**（如 `显示状态`），
分类统一由 `category: "Anchor"` 提供，命令面板里显示为 `Anchor: 显示状态`。
**不要在 `title` 里再写一遍 `Anchor:`** —— `category` 会被面板拼在前面，会显示成 `Anchor: Anchor: 显示状态`。

### §4.2 context key（冻结）

| key | 类型 | 置位时机 |
|---|---|---|
| `anchorExplain.walkthroughActive` | boolean | 讲解开始置 `true`；`stop` / 讲完（`done`）/ 编辑器关闭时置 `false` |
| `anchorExplain.sessionOpen` | boolean | **S1 新增（D46）**。从开会话起置 `true`，**只到 `stop` / 编辑器关闭才置 `false`**（`done` 不落） |
| `anchorPdf.selectMode` | boolean | PDF 进入框选模式置 `true` |

两个 key 的分工不重叠：`walkthroughActive` 管"要不要吃推进键"（`next`/`prev`/`goto`/`playPause`），
`sessionOpen` 管"还有没有东西需要收尾"（`stop`）。合成一个 key 会让 `done` 之后的界面变成死局
（详见 §4.1 里 `stop` 那一行）。

### §4.3 `emphasis` → 配色（`已冻结（可调）`）

| emphasis | 语义 | 视觉 |
|---|---|---|
| `primary` | 本步重点 | 半透明强调背景 + border 描边 |
| `context` | 上下文 | 更淡的中性背景，无描边 |
| `definition` | 定义/声明处 | 半透明背景 + 左侧边线 |
| `caveat` | 注意/坑 | 半透明警示背景 + 虚线描边 |

全部走主题色变量（不写死十六进制），`isWholeLine: true`，纯视觉不改文件。

**步级底色与 emphasis 分层（S1 冻结，D41 / D48）**：一个 step 的**整体范围**只画一层中性底色
（就是上表 `context` 那档的视觉：`editor.selectionHighlightBackground`、无描边），
`emphasis` 四档配色**只作用于 `highlights[]` 子高亮**。原因：步级范围与子高亮几乎总是重叠，
两套半透明底色叠在一起会糊成一团，反而看不清"这一步在讲哪几行、重点是哪一行"。

**而且一次只点亮一个子高亮（D48）**：会话的游标是"拍"，一个 step（n 个子高亮）占 n+1 拍 ——
第 1 拍只铺块级底色，之后每拍点亮一个点。第一版把同一 step 的所有子高亮同时画上，
结果 40/41/42 三行出现三种混合色，用户看到的是"隔行乱变颜色"。
所以"块级底色恒为均匀"是**结构性**保证，靠的是点亮策略，不是靠调色。

实测映射（`scripts/smoke-walkthrough.mjs` 按这些 id 反查 decoration type，所以它们**就是**断言）：

| 用途 | 背景 | 描边 |
|---|---|---|
| 步级底色 | `editor.selectionHighlightBackground` | 无 |
| `primary` | `editor.findMatchHighlightBackground` | 左 2px `editor.findMatchBorder` + 概览尺 |
| `context` | `editor.wordHighlightBackground` | 无 |
| `definition` | `editor.findMatchHighlightBackground` | 左 3px `editorInfo.foreground` |
| `caveat` | `editor.wordHighlightStrongBackground` | 1px 虚线 `editorWarning.foreground` |

`rangeBehavior` 一律 `ClosedClosed`：编辑时不要把框自动撑到新行，否则高亮会追着光标跑。
**非代码位置不产出任何框** —— 线2 的硬约束「PDF 上不出现任何高亮框」写在
`decorationPlan.ts` 里（过滤非 `CodeLocation`），不靠调用方自觉。

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
  | { type: 'ui:ready' }
  | { type: 'ui:next' } | { type: 'ui:prev' } | { type: 'ui:goto'; index: number }
  | { type: 'ui:stop' } | { type: 'ui:revealStep'; index: number };
```

**`ui:ready` 是 S1 追加的第一条消息（D42）**，非加不可：webview 的 DOM 生命周期与宿主无关 ——
用户关掉面板再触发一次讲解时，新 webview 的脚本才刚 `acquireVsCodeApi()`，
宿主在 `webview.html = ...` 之后立刻 post 的消息会丢在它订阅之前，表现为"重开面板一片空白"。
有了握手，宿主收到 `ui:ready` 就把最近的若干条消息（环形，上限 50）原样重放，
webview 因此**不需要自己持久化任何状态**。

**`session:update` 上的 `pointIndex` 是第二条（D48）**：`-1` = 正在铺整块底色，
`0..n-1` = 正在扫该步的第几个逻辑点。非加不可：面板原来自己按 `index >= total - 1`
判断"是不是最后一步"，改拍之后这个判断会在最后一步的**第一拍**就把「下一步」按死，
而后面还有几个扫描点没走完。拍总数客户端能用 `result` 自己算，所以只传这一个字段。

**`ui:goto` / `ui:revealStep` 的分工**：点侧边栏里某条的**正文** = `ui:goto`（把那条变成当前步）；
点那条的**位置标签** = `ui:revealStep`（只把视图滚过去，不改变当前步）。
S6 的 PDF 侧边栏是同一套语义（点击滚动到该页）。

**两个方向都过守卫**：宿主侧用 `parseSidebarMessage()` 校验 webview 发来的东西（非法丢静默），
跨扩展入口用 `isAnchorLike()` 校验 `explainAnchor` 的参数（非法明确报错不静默）。
两处守卫都在 `protocol.ts`，都有单测。`isAnchorLike` 只放行 code / pdf 且**数值也查**
（`NaN`、`1e400`、越界 bbox 一律拒），`web` 直接拒绝 —— 放行一个注定失败的锚点，
只会在一次模型往返之后把"锚点不合法"报成"AI 输出不合法"。

**webview 里怎么按 next / prev / stop（D47）**：宿主把**已解析的用户键位**内联进 HTML
（`ANCHOR_CHORDS`），客户端自己匹配 keydown 后转成上面已有的 `ui:*` 消息。
**没有新增消息类型**。原因：webview 内的按键不会冒泡到工作台，
`contributes.keybindings` 在面板有焦点时是哑的；编辑器有焦点时走工作台键位，
两层的键位来自同一份解析结果（与状态栏提示同源）。

`WalkthroughState` 的 `done` / `idle` 都会让 `anchorExplain.walkthroughActive` 落回 false（§4.2）：
`done` 是"讲完了"，`idle` 是"用户按了退出"，两者都不该再吃 `alt+]`。
但 `done` **不落** `anchorExplain.sessionOpen` —— 否则 `escape` 会跟着变哑（D46）。

### §5.4 状态栏提示

必须**读取用户实际绑定**后渲染（如 `讲解中 · Alt+] 下一步 · Esc 退出`），
读取失败才回退默认文案。实现方式见 `DECISIONS.md` D10（含其脆弱性说明）。

S1 落地的行为（`sidebar/statusBar.ts`）：

- 提示形如 `$(book) 1/3 步 · 第 2/2 点 · 讲解中 · Alt+] 下一步 · Alt+[ 上一步 · Esc 退出`；
  `playing` / `paused` 换成对应措辞，`done` 用 `$(check)` 且**只留「退出」**（推进键已失效）。
- 用户的键位**在激活时读一次** `keybindings.json`（同一次解析结果也交给侧边栏内联，D47），
  读不到/解析失败一律静默保留默认键位 —— 状态栏宁可保守，也不能因为读不到键位而骗人。
- 用户把某个键解绑（`-anchorExplain.next`）时，提示里**只显示动作、不显示键**。
- 状态栏是 **staleness 唯一如实告诉用户的地方**：讲解期间文件被改动 → 前缀换成
  `$(warning) 文件已改动`（§5.3 的 `session:update` 里没有这个字段，而这句话必须有人说）。
- 点击状态栏项 = `anchorExplain.goto`（跳转面板）。
- `probe()` 暴露"此刻是否显示 + 文本"，`Anchor: 显示状态` 会打印它 ——
  用户报过"找不到状态栏提示"，而"看不见"有两种可能（没显示 / 显示了但没找到），
  只有把这两个值读出来才能分辨。

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

### 9.1 已落地（F1 契约类 / F2 骨架与替身 / S1 线1 最小可视）——行号 = 实体定义所在行

| 路径 | 职责 | 关键实体行号 |
|---|---|---|
| `packages/core/src/types.ts` | §1 全部类型 + 守卫 + §3 适配器接口 | `SourceType`:14 `PDFLocation`:16 `WebLocation`:21 `CodeLocation`:27 `Location`:33 `Anchor`:35 `ContextRequest`:45 `WalkthroughStep`:51 `ExplanationResult`:61 `HighlightEmphasis`:75 `SubHighlight`:78 `AdapterCapabilities`:95 `SourceAdapter`:106 `isPDFLocation`:119 `isCodeLocation`:124 `isWebLocation`:133 |
| `packages/core/src/ports.ts` | §2 ports（**全部为新增**） | `EditorSelection`:13 `EditorPort`:20 `FileSystemPort`:28 `ImageRendererPort`:34 `ExplainProvider`:48 |
| `packages/core/src/normalizeBBox.ts` | §10.1 bbox 数学（**唯一实现，fork 也复用**） | `BBox`:8 `clamp01`:16 `normalizeBBox`:27 `coerceBBox`:42 `isValidBBox`:50 `bboxArea`:55 |
| `packages/core/src/locationLabel.ts` | §10.2 位置标签 | `formatLineRange`:12 `locationLabel`:24 |
| `packages/core/src/errors.ts` | §10.3 类型化错误 | `AnchorErrorCode`:8 `AnchorError`:16 `isAnchorError`:28 `describeError`:33 |
| `packages/core/src/logging.ts` | §7 结构化日志 | `ContextRequestLogEntry`:10 `CONTEXT_LOG_LIMIT`:20 `ContextRequestLogger`:22 `createContextRequestLogger`:28 |
| `packages/core/src/index.ts` | barrel 入口。**外部一律从 `@anchor/core` 导入，不深链 `src/`**。`fakes/*` 刻意不在 barrel 里 | — |
| `packages/core/package.json` / `tsconfig.json` | 包声明与类型检查配置（tsconfig `extends` 根 `tsconfig.base.json`） | — |
| `packages/core/test/{types,locationLabel,normalizeBBox,fakes}.test.ts` | 单测（`node --test`） | — |
| `packages/core/src/fakes/fakeProvider.ts` | 假 AI。S3 被 orchestrator 替换 | `FAKE_TARGET_LINE_START`:29 `FAKE_TARGET_LINE_END`:30 `FALLBACK_FILE_PATH`:33 `createFakeProvider`:161 `fakeProvider`:176 |
| `packages/core/src/fakes/fakeEditorPort.ts` | 假选区（写死 40-48 行）。S2 被真实现替换 | `FAKE_FILE_PATH`:18 `FAKE_LINE_START`:19 `FAKE_LINE_END`:20 `FAKE_SELECTION_TEXT`:27 `FAKE_DOCUMENT_HASH`:39 `createFakeEditorPort`:63 |
| `packages/extension-anchor/src/extension.ts` | activate → `registerCommands`（入口保持极薄） | `activate`:11 `deactivate`:16 |
| `packages/extension-anchor/src/paths.ts` | 路径归一 / 比较 / 行数（vscode-free，四条链路共用一份） | `normPath`:11 `samePath`:15 `countTextLines`:25 |
| `packages/extension-anchor/src/commands.ts` | §4.1 八个命令 + 四层装配。**全项目唯一的假货接线点**（见 §2.1） | `registerCommands`:41 `resolveS1FixturePath`:382（S1 脚手架，S2 删除） |
| `packages/extension-anchor/src/protocol.ts` | §5 全部消息协议 + 两处边界守卫 | `WalkthroughState`:19 `HostToSidebar`:35 `SidebarToHost`:54 `HostToSelect`:66 `SelectToHost`:71 `isAnchorLike`:102 `parseSidebarMessage`:131 |
| `packages/extension-anchor/src/orchestrator/validateExplanation.ts` | §3.3 输出校验闸门（**AI 输出不可信的唯一入口**） | `ValidationIssue`:35 `ExplanationOutline`:42 `ExplanationValidation`:49 `coerceEmphasis`:66 `parseMaybeJson`:76 `validateExplanation`:299 `describeIssues`:336 |
| `packages/extension-anchor/src/playback/WalkthroughSession.ts` | 会话状态机（游标是「拍」，vscode-free） | `WalkthroughSnapshot`:34 `SnapshotListener`:54 `PLAY_INTERVAL_MS`:60 `beatsPerStep`:67 `totalBeats`:71 `locateBeat`:78 `firstBeatOfStep`:93 `WalkthroughSession`:100 |
| `packages/extension-anchor/src/playback/decorationPlan.ts` | 「这一拍该画哪些框」的纯决策 | `DecorationSpec`:25 `EMPHASES`:32 `FALLBACK_EMPHASIS`:34 `planForBeat`:40 `primaryLocationOf`:60 |
| `packages/extension-anchor/src/playback/CodeWalkthroughPlayer.ts` | decoration 渲染 + `revealRange(InCenter)`；**只读不写文档** | `CodeWalkthroughPlayer`:83 |
| `packages/extension-anchor/src/sidebar/SidebarPanel.ts` | 侧边栏宿主侧：建面板 / 发消息 / 收消息 / 重放 | `SidebarHandlers`:17 `SidebarPanel`:28 |
| `packages/extension-anchor/src/sidebar/statusBar.ts` | §5.4 状态栏提示（读用户实际绑定，并**交给侧边栏复用**）+ `probe()` 自检 | `StatusBarHandle`:23 `createStatusBar`:65 |
| `packages/extension-anchor/src/sidebar/keybindingResolve.ts` | 键位表 + JSONC 解析 + 显示格式化（vscode-free） | `ChordId`:13 `WalkthroughChordSpec`:15 `WALKTHROUGH_CHORDS`:27 `ResolvedChord`:76 `ResolvedChords`:77 `KeyBindingEntry`:79 `defaultChords`:86 `keybindingsPathFrom`:99 `stripJsonc`:116 `parseKeybindings`:175 `resolveChords`:191 `formatChord`:258 |
| `packages/extension-anchor/src/sidebar/ui/{styles,clientScript,html}.ts` | 侧边栏 webview 资源，**全部内联进产物**（D42）；客户端自己派发按键（D47） | `SIDEBAR_STYLES`:9 `SIDEBAR_CLIENT_SCRIPT`:15 `renderSidebarHtml`:25 |
| `packages/extension-anchor/src/vscode/ports/editorPort.ts` | §2 `EditorPort` 真实现（`getSelection` 当前被替身顶掉） | `createEditorPort`:24 |
| `packages/extension-anchor/src/vscode/ports/fileSystemPort.ts` | §2 `FileSystemPort` 真实现 + `countLines` | `createFileSystemPort`:12 `countLines`:38 |
| `packages/extension-anchor/test/{validateExplanation,WalkthroughSession,decorationPlan,keybindingResolve,protocol}.test.ts` | 线1 单测（58 条，`node --test`，全部 vscode-free） | — |
| `packages/extension-anchor/{package.json,tsconfig.json,.vscodeignore}` | 扩展清单 / 类型检查 / 打包排除（`node_modules` 靠它整体排除） | — |
| `esbuild.mjs`（根） | 唯一打包入口，产物 `dist/extension.cjs`（见 §9.4） | — |
| `scripts/{make-fixture-pdf.mjs, smoke-extension.mjs, smoke-walkthrough.mjs, preview-sidebar.mjs, def-lines.mjs}`（根） | 生成 30 页 fixture；**产物冒烟**与**链路冒烟**（见 §9.4）；侧边栏排版预览（D50）；行号表的一次性生成器 | — |
| `test/fixtures/{main.c, sample-30p.pdf}`（根） | `main.c` 第 40-48 行是假选区目标；PDF 是 S5~S7 的样本 | — |
| `package.json` / `pnpm-workspace.yaml` / `tsconfig.base.json`（根） | workspace 与依赖声明、共用 TS 基线、pnpm 11 的 `allowBuilds` 放行（见 §9.3） | — |
| `.gitignore` / `.gitattributes`（根） | 忽略规则与**换行符纪律**（后者是 `fakes.test.ts` 耦合锁的前提，见 §9.3） | — |
| `.vscode/{launch.json, tasks.json}` | F5 起调试宿主；`preLaunchTask` 跑 `anchor: watch`，默认工作区是 `test/fixtures/` | — |
| `README.md`（根）/ `packages/*/README.md` | 人类视角的入口与职责说明（`AGENTS.md` 是给 agent 的协议，不是安装说明） | — |

### 9.2 未落地（按切片）

| 路径 | 职责 | 落地切片 |
|---|---|---|
| `packages/extension-anchor/src/vscode/ports/editorPort.ts` 的 `getSelection` | **真选区**（其余三个方法 S1 起已是真的） | S2 |
| `packages/extension-anchor/src/adapters/CodeAdapter.ts` | 代码来源适配器（`capture` 现在临时住在 `commands.ts` 的 `buildAnchor`） | S2 / S3 |
| `packages/extension-anchor/src/orchestrator/*`（其余） | §3.2 取件校验、编排循环、ModelRouter | S3 |
| `packages/extension-anchor/src/prompts/*` | 所有 prompt（含 §3.3 第 5 条的 repair） | S3 |
| `packages/extension-anchor/src/config.ts` | §6 配置读取 + SecretStorage 覆盖 | S3 |
| `packages/extension-anchor/src/adapters/PDFAdapter.ts` + `adapters/pdf/*` | PDF 无头取件 | S7 |
| `packages/extension-anchor-pdf/`（整树） | 线2 fork | S4 |
| `packages/extension-anchor-pdf/media/anchor-select.js` | 注入式框选 overlay | S5 |
| `packages/extension-anchor-pdf/src/anchor/*` | bbox 换算 / Anchor 组装 / 消息桥 | S5 / S6 |

### 9.3 已知结构债

**已清（F2）**：`pnpm-lock.yaml` 曾在 `packages/core/` 内。F2 建了根 `package.json` +
`pnpm-workspace.yaml` 后，已删除该文件并在根重装，lockfile 现归仓库根（D26）。

**待留意**：`pnpm-workspace.yaml` 的构建脚本放行键在 pnpm 11 里是 `allowBuilds`，
且值是「包名 → true/false」的映射（旧的 `onlyBuiltDependencies` 收列表，在此版本不生效）。
写错不会报错，只会让每次 install 都刷一条 `ERR_PNPM_IGNORED_BUILDS`。

**已加护栏（F2）**：本机 `core.autocrlf=true`，仓库内又没有任何换行符约定。
后果是 `test/fixtures/main.c` 一旦被 git 接手就会变 CRLF，
而 `packages/core/test/fakes.test.ts` 的耦合锁按 LF 逐字比对 —— 任何一次重新 checkout 都会变红。
已加根 `.gitattributes`（`* text=auto eol=lf`，PDF 标 `binary`），测试侧也改成按 `/\r?\n/` 切分做二次兜底。

**已收窄（F2）**：`.gitignore` 原写 `dist/`（泛匹配），会连
`packages/extension-anchor-pdf/assets/pdf.js/` 下任何同名目录一起忽略 —— 那是必须提交的上游 vendored 源码。
已改写成 `packages/*/dist/`。

### 9.5 类型版本：`@types/vscode` 精确，`engines.vscode` 是范围

| 字段 | 应当写成 | 为什么 |
|---|---|---|
| `engines.vscode` | `"^1.90.0"`（**范围**，下界 = 实际支持的最低版本） | 给**使用者**看的兼容范围。钉成 `"1.90.0"` 等于宣布"只在恰好 1.90.0 上能装" |
| `devDependencies.@types/vscode` | `"1.90.0"`（**精确值，无 caret**） | 给 `tsc` 看的 API 面。写 `^` 会让 pnpm 解析到最新版（实测 `^1.90.0` → 装了 `1.137.0`），`tsc` 就静默放行 1.90 上不存在的 API，而 `engines` 又向用户承诺了 1.90 —— 只有运行时才崩 |

不变式是 **`@types/vscode` 精确等于 `engines.vscode` 的下界**，不是"两个字段字符串相同"。
`vsce` 的 `@types/vscode ≤ engines.vscode 下界` 守卫在两者相等时通过。
（本文件早期版本把不变式写成了"两个都写 1.90.0 不带 `^`"，那是错的：`engines.vscode` 钉死会让
用户升级 VS Code 后装不上。更正见 `DECISIONS.md` D39 的更正。）

### 9.4 构建与产物（F2 冻结）

| 项 | 约定 |
|---|---|
| 打包器 | 根 `esbuild.mjs`，**唯一入口**；`tsc` 只做类型检查（`noEmit`），从不产出 JS |
| 产物路径 | `packages/<扩展包>/dist/extension.cjs` |
| 模块格式 | **CommonJS**。扩展宿主的入口是 `require()`，不吃 ESM 入口；包内 `type: module` 故用 `.cjs` 后缀 |
| `external` | 仅 `vscode`（宿主注入，不能打包） |
| 依赖处理 | 一律 bundle 进产物，因此 `.vscodeignore` 可整体排除 `node_modules` |
| 共用配置 | 各包 `tsconfig.json` 一律 `extends` 根 `tsconfig.base.json` |
| 新增扩展 | 往 `esbuild.mjs` 的 `TARGETS` 加一行，不另写打包脚本 |

**产物冒烟**：`pnpm smoke`（`scripts/smoke-extension.mjs`）在不启动 VS Code 的前提下
`require` 产物，只对最外层边界（`vscode` 模块）打桩，断言：产物可加载、`activate` 注册了命令、
**`package.json` 声明的命令与注册的命令逐一对齐**（声明了没注册 → 用户点了报"命令未找到"；
注册了没声明 → 命令面板里看不见）、命令回调能跑通且 `@anchor/core` 的 `locationLabel` 确实被 bundle 进去、
webview 的 HTML/客户端脚本活到了产物里。

**链路冒烟**：`pnpm smoke:chain`（`scripts/smoke-walkthrough.mjs`，S1 新增）同样只桩 `vscode`，
但把 `anchorExplain.capture` **从选区一路跑到 decoration**：真读磁盘上的 `main.c`（所以行数上界
用的是真数据）→ 真 `fakeProvider` → 真 `validateExplanation` → 真会话 → 真玩家决策（只记下
`setDecorations`）。它断言三件用户在 F5 才会发现的事：

1. 每一步画在**哪几行**、用的是**哪一档配色**（即 §4.3 映射本身）
2. 退出时所有 decoration type 都被清空（不留残影）、`ui:ready` 会触发全量重放
3. **`main.c` 字节未变**、`workspace.applyEdit` 从未被调用（"纯视觉"的硬要求）

`pnpm check` 把它们排在 `build` 之后。**F5 仍然不可省**：配色好不好看、流转顺不顺是手感评审，
`pnpm smoke:chain` 只能保证"画对了行、用对了档、退出清干净"。

**排版预览**：`pnpm preview:sidebar`（`scripts/preview-sidebar.mjs`，D50）把**真实生成**的侧边栏
HTML 落到 `.tmp-preview/` 并起一个只读静态服务，浏览器打开即可看排版 ——
它复用产物里同一份 `renderSidebarHtml` + `styles.ts` + `clientScript.ts`，
只把 `acquireVsCodeApi` 换成桩。**它不验行为**（交互仍靠 F5），但把"改完先自己看一眼"
这件事从"按一次 F5"降成"刷一下浏览器"，是本项目里唯一能自查 UI 排版的手段。

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
