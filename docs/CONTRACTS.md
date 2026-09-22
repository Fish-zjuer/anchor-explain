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
  focus?: string;            // D79：用户写的"这段想重点讲什么"（可选）
  segments?: Location[];     // D80：多段锚点 —— 用户实际选中的那几段；D98 起放宽为 Location[]（PDF 拆块器的多块锚点也走它），**必须与 location 同源**（代码锚点配代码段 / PDF 锚点配 PDF 段）
  blockIds?: string[];       // D104：这根锚点由哪些**块**组成（拆块器的挂载模型）。**可选** —— 框选兜底的锚点没有它，读它的地方一律要能退化
}

> **D80：多段时 `location` 只是「并集的外框」，不是用户选了什么。**
> 它必须保持单个 `CodeLocation` 的形状（decoration、§3.3 校验、`locationLabel`、D78 的锚点文件判据
> 都按一个位置写的）。段之间那些没被选中的行**确实在框里**，所以"哪些是用户选的"由 `segments`
> 说出来。模型据此不会去讲那些空隙 —— 给模型的原文同样不能含糊：每一段都标了号，
> 并写明"段与段之间的行没有被选中"（见 `core/src/segments.ts` 的 `composeText`）。
>
> **D98：`segments` 放宽为 `Location[]`**，PDF 拆块器（多块锚点）走同一字段：
> 一个锚点里的段必须与 `location` **同一种来源**；PDF 锚点的 `location` 是**第 1 块**（阅读序最前），
> 全部块在 `segments` 里（取值用 `pdfSegmentsOf`，代码用 `segmentsOf` —— 两者都做收窄）。
> 多块披露的口径与 D80 同构：describeAnchor（zh/en）列出每一块，并说明步骤的 location 要落在
> 内容对应的那一块上。
>
> **D79：`focus` 是用户额外写的那句话**，不是从代码里算出来的。

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

**S7 的一处加法扩展**：`PDFLocation` 多一个**可选**字段 `filePath?: string`。

```ts
interface PDFLocation {
  page: number;
  bbox: [number, number, number, number];
  filePath?: string;        // ← S7 新增，可选
}
```

**为什么非加不可**：`page` + `bbox` 只说得清"页面上的哪一块"，说不清"**哪一份**文档"。
S7 的取件要按路径去读文件、判页数也得打开它，而线1 手里的 `Anchor`
只有 `sourceId`（内容指纹）与 `sourceName`（basename）—— **都定位不到文件**。
`CodeLocation` 从一开始就有 `filePath`，这条对称本来就不该缺。

**选可选而不是必填**：S5/S6 期间造出来的锚点没有它，
于是所有读它的地方都要能退化（现在只有 `revealPage` 与取件两处读，两处都退化）。
规范原文那两个字段一字未动。

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
  // S2 追加【新增，非规范原文】：把**整份文档**也表达成一个 EditorSelection
  // （lineStart=1、lineEnd=总行数、text=全文），供确认 UI 的「整个文件」用。
  // 复用同一个类型是刻意的 —— 两种范围在 capture() 眼里就是"一个行区间 + 那段原文"。
  // 没有活动编辑器 → null；实现必须优先取内存里的文档（与 documentTextHash 同一条理由）。
  getDocumentSelection(): Promise<EditorSelection | null>;
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
| 选区从哪来 | ~~`fakes/fakeEditorPort.ts`（写死第 40-48 行）~~ | `vscode/ports/` 下的真 `EditorPort` | **S2 已完成** |

**S2 之后的实际接线**：`commands.ts` 里只剩一处替身（`provider`），还带 `★` 注释。
假选区的覆盖已删除，`fakes/fakeEditorPort.ts` 仅被单测引用（**已从产物里 tree-shake 掉**，
`smoke-extension.mjs` 有两条断言守这件事）。

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

**`SourceAdapter` 的兑现情况（S2→S7）**：

| 方法 | 状态 |
|---|---|
| `capture` | `CodeAdapter` 已落（带可选 `scope`）；`PDFAdapter` 无（线2 的框选在 webview 里，不走这条） |
| `fetchContext` | 两条线都落了：`CodeAdapter`（按行）/ `PDFAdapter`（按页） |
| `capabilities` | 两条线都落了，且**被 §3.2 规则 1 真的读了**（挑选件类型） |
| `detect()` | **两条线都没落，而且不打算落** —— 见下 |

**`detect()` 为什么不落（S7 的判断，不是又一次延期）**：它问的是"当前环境适不适用"，
而在我们的架构里那个问题**没有唯一答案** —— 用户同时开着代码编辑器和 PDF 是常态，
而"该用哪个适配器"这件事由**锚点自己的 `sourceType`** 决定，那是确定的依据。
真正读适配器的地方只有两处（`commands.ts` 的 `adapterFor(anchor)`、§3.2 规则 1），
两处都不需要问环境。写一个没人调用、且答案有歧义的 `detect()` 才是对契约的不诚实。
§3.1 表里那一列的判据（`window.activeTextEditor` / 已打开的 PDF 会话）因此**保留为文档**，
它是这两个适配器"什么时候适用"的说明，而不是一个待实现的方法。

接口本身是冻结的，上面这些是**分期落地 + 一处明确的取舍**，不是接口变更。

`capture()` 比冻结的零参形式多一个**可选**参数：

```ts
capture(scope?: 'selection' | 'whole-file'): Promise<Anchor>   // 缺省 'selection'
```

可选参数在 TS 里仍可赋值给零参签名（有单测 `capture 的形状仍满足 §3 的 SourceAdapter` 钉住），
所以 `CodeAdapter` 照样满足 `SourceAdapter`。这样"范围从哪来"（由确认 UI 拍板）
不必污染冻结的接口，也不必让适配器去读 UI（`adapters/` 不许 import 'vscode'）。

**`fetchContext` 的产出形状（S3 定）**：纯文本，且**每一行前面带 1-based 行号**，
形如 `文件：<path>\n行 1-5（共 75 行）：\n 1\t<源码>`。
行号不是装饰：模型要靠它算出 `location`，而 §3.3 的越界检查只在超出文件范围时才拦得住 ——
不给行号，模型给的区间就全靠猜。

### §3.2 取件校验规则（冻结）

`validateContextRequest(req, anchor, state)` 必须全部满足，否则**拒绝**：

1. `req.type` ∈ `adapter.capabilities.contextTypes`
2. `page_range`：`start`/`end` 为整数，`1 ≤ start ≤ end ≤ pageCount`，`end - start + 1 ≤ maxSpan`；
   **`params.path` 缺省 = 锚点这份 PDF（D98 兜底，放行请求里 materialize 成绝对路径）**；
   写了则必须与锚点文档的路径一致（samePath），指向别的文档一律拒 —— PDF 没有"相关文件"一说；
   锚点自己没有 `filePath`（S5 之前的老锚点）→ 明说拒绝，不再漏到适配器炸"取件参数不完整"
3. `file`：`params.path` **缺省 = 锚点文件**；给了路径则必须落在**允许范围**内（S9a 改写，见下），
   且 `end - start + 1 ≤ maxLines`（S9a 新增，默认 60 行）
4. 去重：与已取件区间重叠 → 不重复取，回灌「该区间已取过」+ 已有内容（D98 起 page_range 也带路径，
   比对用解析后的路径；D98 前的记录 path 为 null，按同源处理）
5. 频率：总取件次数 `≤ maxFetchRounds`（默认 3）

**单次行数超上限 → 截断，不拒绝（D71 修订）**：`end - start + 1 > maxFetchLines` 时把 `end` 收到
`start + maxFetchLines - 1` 照常放行。原来整条拒绝（"一次最多取 60 行"）的代价是**白烧一轮预算**：
用户在真工程上实测，5 轮里 3 轮就这么没了，而它下一轮还是想读同一段。截断不误导模型 ——
适配器回灌的内容头部就写着**真实行范围**（`行 1-400（共 900 行）`），且放行的请求、日志、
去重比的都是**截断后**那个区间。
**例外（仍然是拒绝）**：`end` 超出**锚点文件的文档总行数** —— 那是关于这份文件的事实错误，
说清"文档共 75 行"比默默给它前 75 行有用得多。`page_range` 的 `maxSpan` 也是拒绝（另一种量纲）。

**拒绝不抛错**：回灌一条工具结果「请求被拒绝：<reason>，请基于现有信息作答」，让模型自我纠正。
**读取失败同样不抛（D96）**：闸门放行的路径是**字符串解析**出来的，文件可能根本不存在 ——
适配器抛错（ENOENT 等）由编排层接住，回灌「取件失败：<路径> 打不开 + 候选清单」的工具结果
（`fetchFailureText`），模型改用清单里的正确名字重取或基于现有信息作答；失败的取件不消耗轮数预算，
但照落日志、并计入收场报错的「打不开 N 次」统计。**每次取件必须落日志**（见 §7，包括没读成的）。

**`page_range` 的前提：线1 必须能读到那份 PDF（S7 补 / D74）**。`pageCount` 拿不到时**拒绝**
（不能盲放：`1 ≤ page ≤ pageCount` 那条上界就是这个字段唯一的作用），但**拒绝的话必须说两件事**：
给模型的（"别请求了"）与给人的（"往哪看"）。为此：

- `PDFAdapter` 的 `onError` 是**注入**的（本文件零 vscode 依赖，D19），接到线1 的输出通道；
  打开失败的**原因**必须出现在那里，不能像 D74 之前那样被 `catch` 吞成 `null` 就完事
  （那次一整片都没人知道真实原因是"产物里 pdf.js 找不到 worker"）。
- 拒绝文本第一句以句号收尾：进度通知只取第一句（`briefReason`），不分句会被截成半截。

**pdf.js 在产物里的前置条件（D74/D75）**：

- **worker 要自己挂**：`disableWorker: true` 并不等于"不需要 worker 代码" —— pdf.js 仍要把它
  加载进主线程，而默认路径由 pdf.js 自己的 `import.meta.url` 推出，**打包后那个路径指向产物旁边**。
  所以 `pdfjsSource.ts` 必须挂官方钩子
  （`globalThis.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')`，
  `legacy/build/pdf.mjs:22948` 读的就是它）。
- **喂字节，不要给 `url:`**：pdf.js 的 `url:` 只在浏览器环境成立（`getUrlProp` 要拿
  `window.location`），而 pdf.js 那句 `isNodeJS` 判定里有一个为 Electron **渲染进程**写的条件 ——
  VS Code 的扩展宿主是 Electron 的 **utility** 进程，会被它误判成"浏览器"，
  于是 `ReferenceError: window is not defined`。字节由注入的 `PdfBytesPort` 读
  （真实现是 `fileSystemPort` = `workspace.fs`，对 remote / 虚拟文件系统成立）。
- **字节要归一化成 `Uint8Array`**：pdf.js 拒绝 Node 的 `Buffer`
  （`Please provide binary data as Uint8Array, rather than Buffer.`）。
- 这几条**只能靠打包之后 + 宿主形状的锁守住** —— `node --test` 跑源码、且跑在干净的 CLI Node 里，
  两个差异都看不到（S7 的 PDF 取件因此在用户手上从没成功过）。落点是
  `scripts/pdf-open-probe.mjs`（自己伪装成宿主）+ `smoke-extension.mjs` 第 9 节。

#### §3.2 的实现约定（S3 定，都不改上表五条判据，只把边界说清楚）

**S9a：规则 3 的"允许范围"（`anchorExplain.fetchScope`，D117 加第四档）**

| `fetchScope` | 允许取的文件 |
|---|---|
| `related`（默认） | 工作区根之内任意文本文件；**锚点不在工作区里时**（用「打开文件」打开、或开发宿主窗口开在别的目录）范围退化成**锚点所在的这一层** = 锚点目录 + 它的上一层（`relatedRoots`）—— 嵌入式里 `Src/` 与 `Inc/` 是兄弟目录，只给锚点目录一个根，`../Inc/x.h` 永远过不去。**排除** `.git/`、`node_modules/`、构建产物目录、`.env*`、`*.pem/*.key/*.p12/id_rsa*` 等（名字判断在闸门，体积/二进制判断在适配器） |
| `same-dir` | 只允许锚点文件所在目录 |
| `off` | 只允许锚点文件（= S1~S8 的行为，回退档） |
| `any`（D117） | **不按根判范围** —— 写绝对路径就能读工作区之外的任何文件（跨仓库、共享 SDK）。相对路径仍按锚点目录算。上面那串密钥/依赖/构建产物**照挡**：那是"不许发到远端模型"的底线，与范围是两件事 |

**D117 的两条不变量**（用户实测那条报错的根因，别再退回去）：

1. **锚点目录永远是可读范围的基准**：`related` 的范围判定必须先看"锚点在工作区里吗" ——
   在（工作区根覆盖锚点）→ 范围就是工作区根，**不多加**锚点目录的上一层
   （否则锚点恰好在工作区根直下时会把工作区根的外面也放开，那是整个盘）；
   不在或没有工作区 → 锚点目录 + 上一层。两种前提各自的边界都要说清，不能只写一句"工作区根"。
2. **候选清单里的名字与实际解析基准必须同源**：清单里"不同目录"的写法一律是**相对锚点目录**
   （`../Inc/dshot_dma.h`，`candidateDisplayName`），不是工作区相对路径 ——
   后者被闸门按锚点目录解析会得到一个不存在的路径，白烧一轮（D96 的 ENOENT 就是这个形状）。

**S9a-fix10（D119）：清单即范围 + 假名。**
> ⚠ **其中"假名"一节已被 S9a-fix12（D124）推翻并移除**，见下面第 4 条。
> 这一段保留是因为它是历史记录：当时为什么那么做、后来为什么收回。

用户拿自己的 CubeMX 工程实测：6 次取件只成 1 次，
另外 5 次 `ENOENT`，**而它想要的那几个文件清单里全都写着**（第 1/2/3/5 条）——
它在套 CubeMX 惯例（先试 `../Inc/` 再试 `../Src/`），不是在抄清单。
根因是"清单"与"能取的集合"**本来是两套东西**：清单是提示、闸门按根判，
交集之外的写法都能过闸门，模型自然一直猜。现在合成一件事：

3. **清单就是可取范围，一条不差**。`ContextFetchPolicy.candidates` 与 **prompt 里那份清单是同一个数组**；
   它的过滤判据（`roots` + 黑名单）与闸门**同一份**（`isDeniedPath` 因此搬到 `fetchDeny.ts` 共用）。
   `related` / `same-dir` 档下，只有清单里的文件取得动；清单外的一律拒。
   清单位置在 `relatedFiles.ts` 的 `buildCandidateFiles`（纯函数）。
4. **清单只给名字**（S9a-fix12，D124；曾给过假名 `f1`，已去掉）。清单里的名字是
   "相对工作区根"的写法（锚点不在工作区里时退化成"相对锚点目录"），**它就是模型要照抄的那串**。
   两种写法都认，**前提都是落回清单里某一条**：① 名字原样照抄（正路）；
   ② 名字的唯一后缀（模型爱写尾巴，不让"写短了"变成一次白烧）。
   **顺序是先确定性解析（锚点目录 / 各 root），再用后缀模糊匹配兜底** ——
   模糊匹配不许抢先决定"读哪个文件"；后缀命中多条时返回"对上了多条"，让它照抄完整那一行。
   @anchor **为什么去掉假名**：它原本的名义是"真实路径不进 prompt"，但 `describeAnchor`
   早就把锚点的**绝对路径与所在目录**写进去了，这条理由不成立；名字本身带信息、假名不带，
   去掉之后 prompt 少一层映射。用户原话："文件名也是有信息的，你改成 f1、f2 什么的是多此一举。
5. **`any` 档不给清单**（整个文件系统列不完），改为多给一个工具 `find_files`（见 §8）让模型自己查。
6. **清单的取材范围必须跟上范围的取材范围**（D123）。范围能算到工作区之外
   （`relatedRoots` 的"锚点所在的这一层"），**池子就必须也能扫到工作区之外** ——
   否则"没有工作区文件夹"（只打开一个文件）这个常见形状上，范围里有文件、池子里没有，
   清单为空 ⇒ 一个别的文件都读不到。所以 `scanCodeFiles` 收 `roots`：
   工作区文件夹盖不住的那些根**直接走目录树**（文件数上限 `SCAN_LIMIT`、最多 6 层、跳过黑名单目录）。
   **不要再给"空清单"开一条兜底路径** —— "清单即范围"的全部价值就在于只有一条路（D119 的教训）。
7. **提示词与闸门必须同一套事实**（D123）：清单为空时，system prompt **不许再说"照抄清单"**
   （`candidateMode = 'none'`，明说"这次读不到锚点文件之外的任何文件"）——
   上一版这种情况仍教它照抄清单，模型的反应是**编一个名字**，然后被拒、再编、把轮数烧完。

**被拒的宽限轮数（D123）**：`turnLimit = maxFetchRounds + 2 + 2`。被拒**不消耗取件预算**
（规则 5 只管放行的），但它消耗轮次 —— 不给宽限时一次写错就把剩下的轮数挤掉，
最后以 `MAX_ROUNDS_EXCEEDED` 收场而**用户什么都拿不到**。上限是死的（`+4`），不会变成无限循环。

**路径解析**：相对路径**先按锚点文件所在目录**解析，再按各个 root；绝对路径只做归一化；
**落在所有 root 之外的候选一律丢掉**（闸门批准的就是适配器会读的 —— 不给自己留第二条路）；
`any` 档是唯一不过滤的档（它存在的全部理由）。S9a-fix10 起 `related` / `same-dir` 还多一道：
解析出来的路径**必须命中清单里的某一条**，否则照样拒。

**拒绝文案（D117 → D119 改写）**：范围不足时必须说清四件事 —— **当前档位**、
**这次一共有几个可选**、**正确写法（假名）**、以及**真不够用时往哪调**
（`anchorExplain.fetchScope` = `any`，或把 `anchorExplain.maxCandidateFiles` 调大）。
**清单为空时**改报「一个别的文件都取不到 + 允许的根」—— 那一刻根是"为什么一个都没有"的唯一线索。
**第一句以句号收尾且带上档位**：进度通知只取第一句（`briefReason`）。
**两道闸门的分工**：名字与范围这类**形状**判断在 `validateContextRequest`（同步纯函数，可单测）；
大小与二进制这类**内容**判断在适配器（那里才有字节）。

**跨文件落点怎么画（D69）**：`location` 允许落在别的文件，但**一拍只画一个文件** ——
焦点 = 这一拍里最具体的那一个位置（有子高亮就跟子高亮，否则跟步骤），只画落在焦点文件里的框。
理由：旧代码把 `specs[0]` 的文件当唯一目标、又把所有 spec 都画进去，于是 `protocol.h:16` 被画到
`main.c:16` 上 —— **一个看起来很确定的假框**。别的文件的框这一拍不画（它们在侧边栏的标签里带着文件名）。
打开目标文件一律 `ViewColumn.One` + `preview: true` + `preserveFocus: true`：同组、预览标签、不堆积、不抢焦点。

**§3.3 的允许集合（S9a）**：`steps[].location.filePath` 可以是**锚点文件**或**本次真取过件的文件**
（编排层从 `FetchedSpan` 收集，命令层从取件日志收集）—— 口径从"不许出去"变成
"**出去过的地方才许写**"。别的文件的行号上界不由校验层判（它拿不到那些文件的行数），
由渲染端夹住。
**比对的坐标是绝对路径**：location 里写了相对路径时，先按锚点文件所在目录解析再比，
并且**把解析后的路径交出去**（渲染端要用它开编辑器）。允许集合那一边也一律是解析后的绝对路径 ——
两边同一套坐标，见 §8 的 `path` 那节（D67）。

| 情形 | 处置 | 为什么 |
|---|---|---|
| `file` 请求**没给** `params.path` | 视为"就要锚点这个文件"，**放行**，并在返回的请求里补上路径 | §8 的工具 schema 里 `path` 是**可选**的（S9a 起声明了它，见 §8 那两条修订），模型不给就是"只看这份文件"。若把"没给"当成不匹配，`file` 取件就永远走不通（S3 踩过：全部请求被判"只允许取锚点所在的文件"，因为 path 在参数解析那一步就丢了 —— 解析侧也已经改成把自定义键一并带过去） |
| `path` 给了，但大小写/斜杠方向与锚点不同 | **算同一个文件**，放行 | 与 §3.3 规则 3 同一个立场：Windows 上严格比较会把同一个文件判成两个（实现用 `paths.ts` 的 `samePath`） |
| `path` 是相对路径（`ring_buffer.h`） | 按**锚点文件所在目录**解析，再按工作区根兜底；闸门批准的就是适配器读的那个绝对路径 | 与 §3.3 规则 3 必须**同一套坐标**：允许集合里放绝对路径、模型写相对路径，两边就永远对不上（D67 那个报错） |
| `file` 的 `end` 超过文档总行数 | 拒绝 | 上表规则 3 只冻结了 `path` 一项；行上界是本条补的。总行数取不到（`null`）时**跳过这一项**检查，不是跳过整条校验 |
| `start > end` | 拒绝 | 上表规则 2 原文就有 `start ≤ end`；这里把它提到两种类型共用的形状检查里，`file` 也一并管住 |
| 去重（规则 4）与频率（规则 5）**同时命中** | **按去重处理**，把已取内容回灌 | 回灌内容比一句"已达上限"对模型有用得多，且**不花任何额外成本**（不发起新的读取）。所以执行顺序是 类型 → 形状/边界 → 去重 → 频率 |
| 请求里的类型不在能力矩阵内 | 拒绝，理由里列出支持哪些 | §3.1 就是这张表，不另找地方声明 |

**`validateContextRequest` 放行时返回的是归一化过的请求**（`file` 补上锚点路径），
好让 `fetchContext` 拿到的 `params` 一定是完整的 —— 适配器不必再猜"没给 path 是什么意思"。

### §3.3 输出校验规则（冻结）

`validateExplanation(raw, anchor, ctx)`：

1. 能容忍 ```json 围栏与前后散文，抽出 JSON 并解析
2. `steps.length ≥ 1`；`confidence ∈ [0,1]`；`summary` 非空字符串
3. 每个 `step.location`（及 `step.highlights[].location`）必须：
   - `sourceType` 与 `anchor.sourceType` 一致
   - `code`：`filePath` **∈ 允许集合**（锚点文件 ∪ 本次取过件的文件；S9a 前只有前者）；
     `1 ≤ lineStart ≤ lineEnd ≤ 文档总行数`（行上界**只对锚点文件成立**，别的文件拿不到行数）
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
| `anchorExplain.addSegment` | 把当前选区**加进多段队列**（一次一段，可反复加；**D80 新增**） | `ctrl+shift+q` / `cmd+shift+q` | `editorTextFocus` |
| `anchorExplain.explainSegments` | 把队列里的全部段**合成一份**讲解（**D80 新增**） | — | — |
| `anchorExplain.removeSegment` | 从队列里挑一段移除（QuickPick；**D80 新增**） | — | — |
| `anchorExplain.clearSegments` | 清空队列（**D80 新增**） | — | — |
| `anchorExplain.replayLast` | **重放**上次那份讲解（从第 1 步再走一遍，**不碰网络**；**D83 新增**） | — | — |
| `anchorExplain.reExplain` | 拿同一个锚点**再问一次模型**（**D83 新增**） | — | — |
| `anchorExplain.fontLarger` | 调大讲解面板字号（独立于 VS Code 的窗口缩放；**D89 新增**） | `ctrl+alt+=` / `cmd+alt+=` | — |
| `anchorExplain.fontSmaller` | 调小讲解面板字号（**D89 新增**） | `ctrl+alt+-` / `cmd+alt+-` | — |
| `anchorExplain.fontReset` | 重置讲解面板字号（**D89 新增**） | — | — |
| `anchorExplain.exportLast` | 把上次讲解导出为 Markdown（另存为，默认落历史文件夹；**D89 新增**） | — | — |
| `anchorExplain.openHistoryFolder` | 打开讲解历史文件夹（`globalStorage/history`，**D89 新增**） | — | — |
| `anchorExplain.showStart` | 打开开始界面（把活动栏的「开始」视图聚焦出来，**S8 新增**） | `ctrl+alt+a` / `cmd+alt+a` | `!inputFocus` |
| `anchorExplain.showState` | 显示当前状态（F2 的骨架验证命令） | — | — |
| `anchorExplain.openSettings` | 打开设置并筛到 `anchorExplain`（**D61**：开始面板里那条"去配端点"的路） | — | — |
| `anchorExplain.configure` | 三个输入框配好模型端点，写进用户设置（**D62**）。**只写 `providers[id]` 的 baseUrl 与 tier1Model，永不写 apiKey** | — | — |
| `anchorExplain.setApiKey` | 把某个 provider 的 API Key 存进 `SecretStorage`（**S3 新增**） | — | — |
| `anchorPdf.openInAnchorViewer` | 用 Anchor 的 PDF 视图打开 | — | — |
| `anchorPdf.selectRegion` | 让当前 PDF 面板进入框选模式（**S5 新增**） | `ctrl+alt+s` / `cmd+alt+s` | `activeCustomEditorId == 'anchorPdf.view'` |
| `anchorPdf.revealPage` | 滚动 PDF 到指定页（跨扩展调用，**S6**） | — | — |

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

**多段队列那四条命令（D80）**：它们都不参与下面的"先问范围" —— 每段就是用户在编辑器里选出来的，
范围这一问已经答过了。`addSegment` 给默认键是因为攒队列是**要连按好几次**的路
（选中 → 按 → 再选 → 再按）。同一段重复加入不去重（用户按了两次就是按了两次），
队列加完**当场按行号排**（`compareSegments`）—— 否则「第 1 段」在清单里与在模型眼里不是同一段。

**命令回调与上表的对应**：`commands.ts` 的 `registerCommands` 注册全部 18 个 ext-A 命令；
`scripts/smoke-extension.mjs` 有一条锁断言「`package.json` 声明的命令 == 实际注册的命令」。

**`showStart` 的 `when: !inputFocus`（S8）**：与 `stop` 同一个立场（D11）——"打开开始界面"
这件事没有急到要在一个输入框里抢下 `Ctrl+Alt+A`。

**`title` / `category` 约定（F2 冻结）**：命令的 `title` **只写动作**（如 `显示状态`），
分类统一由 `category: "Anchor"` 提供，命令面板里显示为 `Anchor: 显示状态`。
**不要在 `title` 里再写一遍 `Anchor:`** —— `category` 会被面板拼在前面，会显示成 `Anchor: Anchor: 显示状态`。

### §4.1.1 捕获确认 UI（S2 新增，非规范原文）

`anchorExplain.capture` 从"按下就讲"改成"先问一句再讲"。四条分支（`commands.ts` 的
`askWhatToExplain` + `capture`）：

| 场景 | 行为 |
|---|---|
| 没有活动编辑器 | 警告「先打开一个文件，再选中要讲解的代码。」**不弹确认** |
| 有编辑器、无选区（只放光标） | 警告「<文件> 里只放了光标，没有选中内容。」+ 一个按钮「讲解整个文件」 |
| 有编辑器、有选区 | QuickPick 二选一：「讲解这段」（描述是真实行区间）/「讲解整个文件」（描述是真实行数） |
| 用户在确认里取消（Esc） | 什么也不做：不起会话、不建 decoration type、不弹通知 |

**为什么"只放光标"不直接讲整个文件**：整份文件往往几百行，命中率通常比一段低得多。
与其替用户猜，不如把「要讲整份吗」摆出来让他拍板 —— 他也可以直接按 Esc 走开。

**为什么"没打开文件"和"没选内容"要分开提示**：两者要用户做的事不一样（一个去打开、一个去选），
一句笼统的"请先选中内容"会让人在没有编辑器时反复去选。

**「整个文件」也是 `Anchor`**：它的 `location` 是 `{ filePath, lineStart: 1, lineEnd: 总行数 }`，
`extractedText` 是全文。下游（校验 / 会话 / 渲染 / 侧边栏）完全看不出这两种范围的区别 ——
这正是 §3.1 里 `capture(scope?)` 用一个可选参数就够了的理由。

### §4.1.2 「这段想重点讲什么」（D79 新增，非规范原文）

确认范围之后、取件之前再问一句（`commands.ts` 的 `askFocus`）。它是**可选项**：

| 用户的动作 | 结果 |
|---|---|
| 按 Esc | `undefined` → 跳过，**老行为一字不改**（prompt 里那一节整个不出现） |
| 回车但没打字 | `''` → 与 Esc 等价（许多人以为这两者不同，所以对下游必须合成一件事） |
| 写了一句 | 去首尾空白后写进 `Anchor.focus`，排在原文**之前**进 user prompt，并说明它优先 |

放在取件**之前**是有意的：这句话会影响模型要不要去读别处（"只关心边界判断" → 它很可能去读宏定义），
取完件再问就晚了。**它同时出现在 `captureSummary()` 里**（「显示状态」与开始面板共用同一句）——
用户写完之后，屏幕上必须有东西能让他复核那句话生效没。

**§4.1.3 多段队列（D80 新增，非规范原文）**

一次讲解只支持**同一个文件内**的多段（`sameFileAsFirst`）：锚点文件那一整套语义
（D82 的收尾判据、"这次讲解到头了"的判据）都按一个锚点文件写的，不为它破例；
用户在别的文件里选新一段时给「清空 / 取消」二选一 —— 现在就说清，比攒了四五段之后
在最后一步报错损失小得多。

**队列为空时那一组要说清楚**（D80）：「讲队列 / 清空队列」两颗按钮的理由、以及状态行那一句，
都必须**指出下一步去哪** —— 灰按钮不说理由是最气人的一种 UI（D61）。

**为什么 `captureSummary()` 也要把那几段列出来**：多段的 `location` 只是并集的外框，
只显示"第 21-48 行"等于告诉用户"讲了这 28 行"，而他明明只选了其中两块 ——
那一句是他唯一能复核"我选的那几段有没有全进去"的地方。

**§4.1.4 「上次讲解」的存档（D83 新增，非规范原文）**

一份讲解成功之后写进 `context.workspaceState`（**跨 VS Code 重启活着**），键名
`anchorExplain.lastRun`（**不要改这个键**：改了等于让所有人已有的存档静默失效，
而失效的表现是「重放上次讲解」说"还没有讲过任何一段" —— 我们会以为是别的地方坏了）。形状：

| 字段 | 说明 |
|---|---|
| `version` | 形状版本，现在是 `1`。**对不上就丢掉**，不尽力兼容 |
| `savedAt` | `Date.now()`。只为"这是什么时候讲的"这句话，不参与任何判据 |
| `anchor` | 原锚点（过 §5.1 的 `isAnchorLike`） |
| `result` | 那份 `ExplanationResult` **本身** —— 重放要的是内容，只存锚点等于还得再问一次模型 |

两条能力的差异是**规格的一部分**，不是实现细节（它们的代价差一个数量级）：

| 命令 | 做什么 | 模型调用 | 结果 |
|---|---|---|---|
| `replayLast` | 把存档原样从第 1 步再走一遍 | **0 次** | 与上次逐字相同 |
| `reExplain` | 同一个锚点再问一次模型 | ≥1 次 | 会得到另一种讲法 |

**读不出来一律当"没有存档"**（`readLastRun` 返回 `undefined`，**绝不抛**）：这份数据可能是
**上一个版本的我们**写的，也可能被用户手改坏；硬读的话最先炸的是渲染层，
而那里离"存档是旧的"这个真因很远。坏掉**一个子高亮**只丢那一个（配色是装饰性字段，与 §3.3 同一条）；
**一个 step 都不剩**才整份作废（会话状态机也要求 `steps ≥ 1`）。

### §4.2 context key（冻结）

| key | 类型 | 置位时机 |
|---|---|---|
| `anchorExplain.walkthroughActive` | boolean | 讲解开始置 `true`；`stop` / 讲完（`done`）/ 编辑器关闭时置 `false` |
| `anchorExplain.sessionOpen` | boolean | **S1 新增（D46）**。从开会话起置 `true`，**只到 `stop` / 编辑器关闭才置 `false`**（`done` 不落） |
| `anchorPdf.selectMode` | boolean | PDF 进入框选模式置 `true`；框选完成 / 取消 / 退出置 `false` |


**关于 `anchorPdf.selectMode`（S5 补，说实话）**：它**目前没有任何 `when` 在读** ——
线2 那条键位（`anchorPdf.selectRegion`）绑的是 `activeCustomEditorId == 'anchorPdf.view'`。
留着它是给"用户自己绑一个取消键"留入口，也方便在
`Developer: Inspect Context Keys` 里看当前状态；宿主侧仍然会在进入/退出框选时如实置位。
**不要在文档或注释里写"键位靠它"** —— 那是假话（同 D73 那一类：说了、代码里没有）。

两个 key 的分工不重叠：`walkthroughActive` 管"要不要吃推进键"（`next`/`prev`/`goto`/`playPause`），
`sessionOpen` 管"还有没有东西需要收尾"（`stop`）。合成一个 key 会让 `done` 之后的界面变成死局
（详见 §4.1 里 `stop` 那一行）。

**"编辑器关闭"到底指哪一个文件（D82 补正，覆盖 D78 的说法）**：不是"锚点文件被关"，
而是 **"这次讲解已经没有落脚点了"** —— 锚点文件、**以及当前这一拍要讲的那个文件**
（`location` 与每个子高亮的 `location`）**全都不可见**时才收工（`stop()`）。

为什么必须这么写：播放器用**预览标签**打开跨文件的目标（D69/D77），而预览标签会被下一个预览
**顶掉**，且**不会被换回来**（播放器只开当前这一拍的焦点文件）。所以"讲进第二个文件"这件事本身
就会关掉锚点文件的标签，随后去问"锚点文件还在吗"必然得到"不在" ——
于是讲解刚跨过文件边界就被判成"用户收工了"，面板底下出现"讲解已结束"（用户原话）。
反过来，预览轮换**必然**把新文件留在屏幕上，所以"这一拍的文件可见"对轮换免疫。
副作用往对的方向：用户在当前讲 `main.h` 时关掉 `main.c` 不再收工 —— 契约的原话本就是
"**正在讲的那个文件**被关掉"。

**判据「什么时候允许开火」（D84 补正，判据本身不动）**：上面那条判据**不读屏幕某一瞬间的样子就下结论**。
预览轮换是"先关旧的、再开新的"两件异步的事，中间有一帧**两个文件都不可见** —— 那一帧与"用户把文件都关了"
长得一样，而它是**播放器自己造成的**。所以：

1. 播放器把"正在换文件"暴露成 `switching`（`get switching(): boolean`），并给出"落定"信号
   `onDidSettle(listener)`；宿主在看到 `switching` 时**推迟**判定（并且**不消费**立案标记，等落定后由
   `onDidSettle` 补判）。
2. "关过文件"这个立案标记**只在被关掉的文件与本次讲解有关时**才立 —— `sessionFiles()` = 锚点文件
   + 各步 `location` + 各子高亮 `location`。用户随手关一个无关标签，不再为后续任意一次可见性变化"上膛"。
3. 判定只剩一处：`commands.ts` 的 `evaluateSessionEnd()` 是唯一决定收工的地方，
   `onDidChangeVisibleTextEditors` 与播放器的 `onDidSettle` 都只是它的触发源。

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
**非代码位置不产出任何框** —— PDF 那一侧因此在编辑器里画不出任何东西（`decorationPlan.ts`
过滤非 `CodeLocation`，不靠调用方自觉）。**注意**：这条说的是**VS Code 的 decoration**；
PDF 页面上的位置指示（闪现框）走的是注入脚本的 DOM，不在这条线上（见 §5.2 的"约束 1 的边界"）。

---

## §5 跨扩展与 webview 消息协议（冻结）

### §5.1 跨扩展（`executeCommand`，单向、无返回值依赖）

```ts
// ext-B(PDF) → ext-A：交出一个 Anchor，请求讲解
vscode.commands.executeCommand('anchorExplain.explainAnchor', anchor: Anchor);

// ext-A(侧边栏) → ext-B：滚动 PDF 到指定页
vscode.commands.executeCommand('anchorPdf.revealPage', page: number);

// ext-A(侧边栏) → ext-B：滚到指定页 + 闪现一下那一块（S6 补 / D76）
vscode.commands.executeCommand('anchorPdf.flashRegion', page: number, bbox: BBox);
```

未安装对端时**明确提示，不静默失败**。

**D76 的两条实现约定**：

1. **`flashRegion` 是加法扩展，不是 `revealPage` 加参数**：`revealPage` 的契约是"只滚不画"
   （D13），把它改成"顺手画个框"会让那条契约定不下来。两条命令并存，各有各的说法。
2. **调之前先查对端声明**：两条线是**各自安装**的（D27），装了旧版线2 的机器上
   `anchorPdf.flashRegion` 不存在 —— 直接调会抛 `command ... not found`，那句话对用户毫无意义。
   判据用对端 `packageJSON.contributes.commands`（它自己声明的能力清单）。有就闪，没有就退回
   `revealPage`（老行为），两条路都**在状态栏回执一句**「已定位到第 N 页…」——
   目标就在当前页时，那句回执是唯一说明"刚才那一下成功了"的东西。

**S6 落地时的两点实现约定**：

1. **只传 `page`，不传文件。** `PDFLocation` 里没有路径字段（只有 `page`/`bbox`），
   所以线1 报不出"该滚哪一份"。线2 那边的处置是：落到**当前聚焦的那个面板**上
   （同时开着两份 PDF 对比着看时，用户按下侧边栏那一条，想动的显然是他刚才在看的那一份）。
2. **两条线的定位走两套**：`commands.ts` 的 `revealStep` 先看 `primaryLocationOf(step)`
   （只对 `CodeLocation` 有值）→ 走播放器；否则看 `isPDFLocation` → 走 `anchorPdf.flashRegion`
   （线2 旧版没有这条命令时退回 `anchorPdf.revealPage`，见上面 D76 第 2 条）。
   `decorationPlan` 会过滤掉所有非 `CodeLocation`（约束 20），所以 PDF 那一侧在**编辑器里**
   天然画不出框 —— 那是结构性的，不是靠自觉。至于 PDF **页面**上的那个闪现框，
   走的是注入脚本的 DOM，边界写在 §5.2 的"约束 1 的边界"里。

### §5.2 ext-B 内部：宿主 ↔ 注入脚本

```ts
// 宿主 → 注入脚本
type HostToSelect =
  | { type: 'anchor:enterSelectMode' }
  | { type: 'anchor:exitSelectMode' }
  | { type: 'anchor:gotoPage'; page: number }
  | { type: 'anchor:flashRegion'; page: number; bbox: [number,number,number,number] }  // ← S6 补（D76）
  // ── D104 拆块活页：加法扩展（四条）────────────────────────────────────────
  | { type: 'anchor:pageMode' }                       // pdf.js 切成"整页翻看"（不许连续滚动）+ 开始观测停稳的页
  | { type: 'anchor:requestPageText'; page: number }  // 抽某一页的文字项（归一化坐标）—— 拆块的原料
  | { type: 'anchor:showBlocks'; page: number;        // 画块覆盖层（空白暗下去 + 圆角细框）
      blocks: { id: string; bbox: [number,number,number,number];
                kind: 'text' | 'heading' | 'image'; selected: boolean }[] }
  | { type: 'anchor:clearBlocks' };                   // 撤掉覆盖层

// 注入脚本 → 宿主
type SelectToHost =
  | { type: 'anchor:ready' }
  | { type: 'anchor:captured'; page: number; bbox: [number,number,number,number];
      capturedImage?: string; extractedText?: string;
      geometry?: CapturedGeometry }          // ← S5 追加，可选
  | { type: 'anchor:cancelled' }
  // ── D104 拆块活页：加法扩展（三条）────────────────────────────────────────
  | { type: 'anchor:pageSettled'; page: number }      // 某页停稳（切页后约 0.9s 无新的翻页动作）→ 宿主开始处理该页
  | { type: 'anchor:pageText'; page: number;          // requestPageText 的回答；items 可能为空（无文字层）
      items: { str: string; x: number; y: number; w: number; h: number }[] }
  | { type: 'anchor:blockClick'; id: string };        // 用户点了覆盖层里的某一块（脚本只报事实，选中态归宿主）
```

**D104 的四条边界约定**（这四条是"加法"而不是"改已有"，理由同 D76 第 1 条）：

1. **覆盖层不持久**：注入脚本收到 `showBlocks` **先清旧块再画新的**，翻页即散，绝不改文档。
   这是约束 1 在 D104 下的形态（"显式、瞬时、绝不改文档"），与 D103 的注释写入正好成一对：
   屏幕上的瞬时 vs 文件里的常驻。
2. **脚本只报事实**：`blockClick` 只说"哪一块被点了"，选中/取消由宿主维护 ——
   与 §5.3 同一条纪律（"谁发命令谁承担能不能发的判断"）。
3. **停稳是脚本观测、宿主处置**：`pageSettled` 的 0.9s 只写在脚本里（它是唯一知道用户翻页动作的地方），
   宿主不重复计时，也不把"没收到停稳"当成"这一页没问题"。
4. **三条上行消息逐条守卫**（`parseSelectMessage`）：与 `anchor:captured` 同一立场 ——
   注入脚本的输出对宿主而言和 AI 的输出一样不可信，坏的**一律返回 null 让调用方忽略**，
   绝不让一个 `page: "三"` 流进 `PDFLocation`。

**⚠ 未完成**（做"页面上就地显示块"之前先读 `DECISIONS.md` D104）：注入脚本侧的四条处理分支
与停稳计时、宿主侧的消费者（`pageSettled`/`pageText`/`blockClick` → 拆块 → `showBlocks`）尚未实现。

// 【S5 追加，非规范原文】原始像素几何。加它是为了让"归一化"这件事由**有单测的宿主代码**定案：
// 注入脚本不参与类型检查、也没法被单测，让它独自承担唯一有对错的那门换算等于让它失去覆盖。
// 只给 page+bbox 的"老式"脚本仍然能用（宿主退回用 coerceBBox 校验它）。
interface CapturedGeometry {
  dragged: { x: number; y: number; width: number; height: number };   // 屏幕坐标
  pages: { page: number; rect: { x: number; y: number; width: number; height: number } }[];
}
```

**宿主对 `anchor:captured` 的处置（S5 定）**：`geometry` 在就用 `resolveSelection` **重算**
（页号与 bbox 都以重算结果为准，脚本给的那两个值被覆盖）；不在就退回它给的 `page`/`bbox`。
两条路都要过 `parseSelectMessage` 的守卫：`coerceBBox` + `isValidBBox` ——
**一个零面积的框进不了 `PDFLocation`**（它会卡在 §3.3 的 bbox 校验上，或变成一个谁也看不见的锚点）。

**注入脚本必须与 pdf.js 共用同一个 `acquireVsCodeApi` 实例（S5 补 / D73，硬约束）**：

- `acquireVsCodeApi()` 在一个 webview 里**只能成功调用一次**（第二次抛
  `An instance of the VS Code API has already been acquired`）。VS Code 只对 notebook renderer
  与 chat 输出开 `allowMultipleAPIAcquire`，自定义编辑器没有这个口子。
- 而这份 PDF 页面里**上游的 pdf.js 自己就要用**它（`viewer.mjs` 的 `VSCodeLinkService`
  把 PDF 里的链接交回宿主），且 `assets/main.mjs` 一开头就 `import` 了 viewer.mjs
  —— 它**天然跑在我们前面**。
- 所以契约是两条：① 注入脚本先接管 `globalThis.acquireVsCodeApi`、把实例**共享**出去
  （自己取一次，之后谁来取都给同一个）；② 它的 `<script>` 必须排在 `pdf.mjs` / `main.mjs`
  **之前**（module 脚本不带 `async` 时按文档顺序执行，"我们在前"是结构性保证）。
- **违反的后果是静默的**：拿不到实例 → `postMessage` 全变空操作 → `anchor:ready` 发不出去
  → 宿主永远不补发 `enterSelectMode` → 用户看到"框选毫无反应"，**屏幕上没有任何报错**。

**宿主侧的兜底（S5 补 / D73）**：`anchorPdf.selectRegion` **不管有没有握手都先推一次**
`enterSelectMode`（推早了无害：监听器还没注册，消息落地即消失）。
握手只说明"页面还没说它准备好了"，不能说明"脚本一定是死的" —— 脚本活着而拿不到 API 时，
这条消息是它**唯一**的入口，进去之后它会在页面上把故障说出来。

**约束 1 的边界（S5 补 / D73、S6 补 / D76）**：PDF 页面上允许出现的东西只有三样，
其余一律不许 —— 尤其**不许有常驻的框，也不许有任何框自己冒出来**（播放/推进时一个框都没有）：

| 允许 | 何时出现 | 何时消失 |
|---|---|---|
| 框选模式的橡皮筋 | 按住指针期间 | 抬手 / Esc / 退出（D69 那条"退出后不留东西"） |
| 故障说明（`#anchor-select-fault`） | 拿不到 VS Code API、用户又按了框选 | 不退隐（会自己消失的报错等于没报错） |
| **闪现框（`#anchor-select-flash`）** | **用户点了某一步**（`anchorPdf.flashRegion`） | 约 2 秒后自动摘掉（下限 300ms，见 `FLASH_MS`） |

闪现框的位置**每帧重算**（滚动是平滑的、用户也可能正在滚），页还没渲染出来就干脆不画 ——
"屏幕上一个看起来很确定的假框"比没有框更坏（D69）。它的逆换算（归一化 → 像素）留在注入脚本里，
但**正确性由夹具往返校验**：用有单测的 `rectToNormalizedBBox` 正向算出 bbox，再让脚本画回来，
必须画成当初那块像素（`packages/extension-anchor-pdf/test/anchorSelectClient.test.ts`）。

### §5.3 ext-A 内部：宿主 ↔ 侧边栏 webview

```ts
// 宿主 → webview
type HostToSidebar =
  | { type: 'session:update'; result: ExplanationResult; index: number; state: WalkthroughState
      anchorPath: string | null }   // ← D69 追加：锚点文件（PDF 为 null），面板据此给别处的行号标文件名
  | { type: 'session:end' }
  | { type: 'tooltrace:reset' }                       // ← D68 追加
  | { type: 'tooltrace:append'; entry: ContextRequestLogEntry }
  | { type: 'ui:fontScale'; scale: number };          // ← D89 追加：当前字号系数（面板收到即改 CSS 变量）

// webview → 宿主
type SidebarToHost =
  | { type: 'ui:ready' }
  | { type: 'ui:next' } | { type: 'ui:prev' } | { type: 'ui:goto'; index: number }
  | { type: 'ui:stop' } | { type: 'ui:revealStep'; index: number }
  | { type: 'ui:replay' } | { type: 'ui:reExplain' }   // ← D83 追加：讲完之后那两颗按钮
  | { type: 'ui:fontLarger' } | { type: 'ui:fontSmaller' }   // ← D89 追加：字号（只回传动作，系数在宿主）
  | { type: 'ui:export' } | { type: 'ui:openHistory' };      // ← D89 追加：导出与历史文件夹
```

**D89 追加的四条（字号×2 / 导出 / 历史）都是无参动作消息**，与 §5.5「只回传动作 id」同一条立场：
合法范围、当前值、存档在哪儿，全由宿主决定。`ui:fontScale`（宿主→webview）是唯一带值的新消息；
`ui:ready` 重放之后宿主**总是补发一条**当前的 `ui:fontScale` —— 重放缓冲只有 50 条，
字号那条可能被挤出去，重建的面板才不丢样式（`scripts/smoke-walkthrough.mjs` 的重放计数锁钉住了这个 +1）。

**`ui:replay` / `ui:reExplain` 是 D83 追加的**（同样是**追加**，不动已有消息）。
`done` 之后「下一步」按不动了，而面板上就此**没有任何出口** —— 用户的原话是
「讲解结束时，需要能重新讲，并且应该能保存/重放之前的内容」。

两条**刻意分成两个消息**，不合成一个带参数的消息：它们的代价差一个数量级 ——
`ui:replay` 是本地重放（不碰网络、不花钱），`ui:reExplain` 要再问一次模型。
合成一个的话面板就得回传"要哪一种"，而 webview 是外部输入；**能指定行为的面板就多一个能指错的地方**
（与 §5.5「只回传动作 id」同一条立场）。所以两条都是**无参**消息：
要重放哪一份、要重新问谁，全由宿主按存档决定（见 §4.1.4）。
反过来，客户端那边的一层对应关系（`data-act` ↔ 消息类型）没有编译器看着，
由 `test/sidebarClient.test.ts` 的一条文本锁钉住。

**`tooltrace:reset` 是 D68 追加的**，与 `ui:ready` 同一种性质（都是**追加**，不动已有消息）：
`tooltrace:append` 是"追加"，而 webview 的 trace 数组**活得比一轮讲解长**（同一个面板接着讲第二次是常态），
没有 reset 第二轮会把上一轮留在下面，用户看到的是两次讲解混在一起的日志。
它同时解决一个时序问题：宿主侧的取件记录是**逐轮多份**的，但面板是**讲解完才建**的
（用户是在开始面板上按的按钮）—— 所以宿主把本轮的记录暂存下来，面板一建好就 `reset` + 逐条 `append` 灌进去。
**取件日志必须显示"哪个文件的哪几行"**（截图问题 3.4 的验收），不是只显示 `file` 这个类型。

**`ui:ready` 是 S1 追加的第一条消息（D42）**，非加不可：webview 的 DOM 生命周期与宿主无关 ——
用户关掉面板再触发一次讲解时，新 webview 的脚本才刚 `acquireVsCodeApi()`，
宿主在 `webview.html = ...` 之后立刻 post 的消息会丢在它订阅之前，表现为"重开面板一片空白"。
有了握手，宿主收到 `ui:ready` 就把最近的若干条消息（环形，上限 50）原样重放，
webview 因此**不需要自己持久化任何状态**。

**`anchorPath` 是 D69 追加的**：S9a 起 `location` 可以落在**别的文件**里，而面板一直把行号裸着显示成
「[第 16 行]」—— 用户看到的就像"main.c 的第 16 行"，而它其实是 `protocol.h` 的第 16 行（他实测就是这么被绕住的）。
客户端没有别的地方能拿到"锚点是哪个文件"，于是无从判断"这个位置要不要标文件名"。
**不在锚点文件里的位置，标签一律带文件名**（步骤头与子高亮行都是）。

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

### §5.5 ext-A 内部：宿主 ↔ 开始面板 webview（S8）

**入口有三处，通向同一批命令**（这也是"固定按钮"的全部内容）：

| 入口 | 形态 | 声明处 |
|---|---|---|
| 活动栏图标 | `viewsContainers.activitybar` 的 `anchor` 容器，图标 `assets/anchor.svg` | `package.json` |
| 面板本身 | 容器里的 `views` → `{ type: "webview", id: "anchorExplain.start", name: "开始" }` | `package.json` + `start/StartViewProvider.ts` |
| 欢迎页「演练」卡片 | `contributes.walkthroughs` 的 `start`（四步，正文在 `media/walkthrough/*.md`） | `package.json` + `media/` |

再加一条快捷键 `anchorExplain.showStart`（`ctrl+alt+a` / `cmd+alt+a`，见 §4.1）。
**四处都不实现任何东西**：面板与演练里的按钮最终都走 §4.1 的命令。

**消息（冻结）**：

| 方向 | 消息 | 说明 |
|---|---|---|
| 面板 → 宿主 | `{ type: 'start:ready' }` | 握手。宿主收到才推第一份模型（面板可能比宿主晚很多才被打开） |
| 面板 → 宿主 | `{ type: 'start:run', id }` | **只回传动作 id，不回传命令 ID** |
| 宿主 → 面板 | `{ type: 'start:model', model }` | 整份快照，见 `start/startModel.ts` 的 `StartModel` |

**四条不许改回去的约定**：
1. **`start:run` 只带 id**。webview 是不可信输入；若它能指定"执行哪个命令"，它就能执行任意命令。
   宿主用 `findStartAction(id)` 查 `START_ACTIONS`，查不到就丢 —— **能执行什么由宿主决定**。
   `parseStartMessage` 因此**只查形状、不查成员资格**（守卫管"能不能读"，业务管"能不能做"）。
2. **推的是快照，不是事件流**。侧边栏要重放缓冲（§5.3），开始面板不要：它显示"现在是什么情况"，
   后一份天然覆盖前一份。视图没被打开过时 `refresh()` 是**空操作**，下次 `ready` 现算一份。
3. **面板里的业务判断为零**。`start/startModel.ts` 把"状态 → 该显示什么"算完（含"灰掉时说什么"），
   客户端脚本只渲染与派发。灰掉是**提示**，宿主执行前还会**再判一次**（两层，不是重复）。

4. **面板的一组 + 一行 = 一个状态**（D80）：多段队列在面板上是一个分组（加入 / 讲全部 / 清空）
   加一条状态行。**"移除第 3 段"这类带参数的操作不在面板上做** —— 它需要的那个参数
   （移哪一段）正好是 `start:run` 刻意不带的东西（见第 1 条），所以走 QuickPick
   （`anchorExplain.removeSegment`），对用户一样是一次选择，规矩不必为它破例。
   队列每变一次（`addSegment` / `removeSegmentAt`）宿主就重推一份模型 ——
   "左侧实时增减"看得见，靠的就是这一推。

5. **代价不同的两件事必须是两颗按钮**（D83）。「这次讲解」那一组里同时有
   「重放上次讲解」（不花钱）与「重新讲一遍」（要再问一次模型）——
   **合成一颗就等于替用户决定要不要再花一次钱**，而"重新讲"这三个字两件事都指得上。
   两者的前置条件是同一个 `hasLastRun`（存档存在吗，见 §4.1.4）：缺的时候两颗一起灰，
   `note` 要说清"先去按「讲解选中的代码」" —— 解药就在同一个面板的第一组里（D61）。
   传 `hasLastRun` 布尔而不是把 `LastRun` 本身递给面板：面板要的是"能不能重放"这一件事，
   而那份存档有几十 KB，`buildStartModel` 是**每拍都会被调**的纯函数。

**为什么键位表要分两张（S8）**：面板上「框选 PDF 区域」显示的是**线2 的键**
（`ctrl+alt+s`，声明在线2 的 `package.json` 里，且只在 `activeCustomEditorId == 'anchorPdf.view'` 时生效）。
它和线1 的键一样可能被用户改掉，所以走同一套解析 —— `LINE2_CHORDS` +
`test/keybindingResolve.test.ts` 里那条对线2 `package.json` 的镜像锁。
**显示一个写死的默认键，就是替用户断言一件我们并不知道的事**（D10 对线2 同样成立）。

**门厅不许是死路（D61/D62）**：面板上每个灰按钮的 `note` 必须**指出下一步按哪颗按钮**，
而且那颗按钮必须真的存在、真的能把事办完。目前唯一的缺口是"还没配 `anchorExplain.providers`"，
对应两颗：

| 动作 | 命令 | 谁更适合 |
|---|---|---|
| 「配置模型端点」 | `anchorExplain.configure` | 绝大多数人：三个输入框（provider id、baseUrl、模型名），带校验与预填，**直接写进用户设置** |
| 「打开设置」 | `anchorExplain.openSettings` | 要改别的项（取件轮数、温度、多个 provider）的人 |

`configure` 会调 VS Code 的 `workbench.action.openSettings` 吗？不会 —— 它走
`workspace.getConfiguration().update(..., Global)`，**只写扩展自己的配置节**。
`openSettings` 才落到内置命令 `workbench.action.openSettings`（带筛选词 `anchorExplain`）：
**参数放在命令里面，不放面板**（`start:run` 只回传 id，说不出"带什么参数"，这是刻意的）。
包一层还有个好处 —— "动作表里的命令必须在所属扩展里声明过"那条锁继续守得住
（内置命令没法声明）。

---

## §6 配置项（冻结）

**写入侧（D62）**：`anchorExplain.configure` 是唯一会写这些设置的地方，它
**只写 `providers[id]` 的 `baseUrl` 与 `tier1Model`**（同 id 下的别的字段原样保留），
必要时把 `activeProvider` 指到刚配的那个 id。**它永不写 `apiKey`** ——
密钥只有一条路：`Anchor: 设置 API Key` → `SecretStorage`。
合并用 `inspect().globalValue` 而不是 `get()`：后者会把工作区级的值一起捞进来。

| 配置 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `anchorExplain.providers` | object | `{}` | `{ [id]: { baseUrl, apiKey?, tier1Model, tier2Model?, extraHeaders?, extraBody? } }` |
| `anchorExplain.activeProvider` | string | `"default"` | 选中的 provider id |
| `anchorExplain.maxFetchRounds` | number | `3` | 取件轮数上限 |
| `anchorExplain.preferSecretStorage` | boolean | `true` | `apiKey` 优先从 `SecretStorage` 读，取不到再回落配置里的 `apiKey` |
| `anchorPdf.*` | — | — | **S4 落地**：`anchorPdf.defaultZoomValue`（string，默认 `auto`）与 `anchorPdf.sidebarViewOnLoad`（number，默认 0），由上游的 `pdf.*` 改名而来（`MODIFICATIONS.md`） |

**S3 新增一项（非规范原文）**：

| 配置 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `anchorExplain.maxFetchLines` | number | `400` | **S9a 修新增（D71）**。单次取件最多几行。**超出不会拒绝，只会截到这个数**（回灌内容头部写着真实行范围）。上限 2000；与 `DEFAULT_MAX_FETCH_LINES`（闸门侧的默认值）**同一个来源**，提示词里那句也用它 |
| `anchorExplain.fetchScope` | `"related"` \| `"same-dir"` \| `"off"` \| `"any"` | `"related"` | **S9a 新增（D66），`"any"` 由 D117 加**。允许读锚点文件之外哪些文件（四档的边界见 §3.2 那张表）。密钥（`.env*`/`*.pem`/`id_rsa*`）、依赖、构建产物目录**始终不读**（`"any"` 也挡）。**S9a-fix10（D119）起它同时决定 prompt 里那份清单**（清单即范围）；命令 `Anchor: 选择这次的取件范围` 可以只给本次会话换一档（内存覆盖，重载窗口还原） |
| `anchorExplain.maxCandidateFiles` | number | `40` | **S9a-fix10 新增（D119）**。一次给模型列几条候选文件。它同时是**这次能读到几个别的文件**的上限（清单即范围）。CubeMX / STM32 这类工程里官方库会吃掉大半名额，那就把它调大。下限 1（0 条等于跨文件全关，那是 `off` 档的语义，不该由一个数字顺手达成）、上限 400；默认值与 `relatedFiles.ts` 的 `MAX_CANDIDATES` 同源 |
| `anchorExplain.style` | `"standard"` \| `"concise"` \| `"detailed"` | `"standard"` | **S8 新增（D65），D93 起三档全部示范驱动，D94 起按用户模板组织 system prompt**：# 角色 → # 输出形状 → # 通用规则 → # 档位规则（只进当前档一节）→ # 取件（工具循环必需）→ # 示例（few-shot，只进当前档示范；正文 `scripts/style-lab/exemplar/<档位名>.md`，线上常量有同步锁）。标准（默认）：数据流视角、每步讲清因果 / 精简：几句话讲清目标与边界 / 详细：逐行讲解 + 具体推演。旧值 `rigorous` 自动按 `detailed` 处理 |
| `anchorExplain.language` | `"zh"` \| `"en"` | `"zh"` | **D97 新增**。讲解语言：影响**讲解内容链** —— prompt 与示范（`en.ts` 的英文面 + `exemplar/<档位>.en.md`，同样有同步锁）、侧边栏讲解面板文案、导出的 Markdown（存档 `LastRun.language` 跟着那一次讲解走，旧存档按中文）。命令 `Anchor: 切换讲解语言` 一键翻转（Global 落点、写后验读）；扩展的命令与通知不跟随，取件工具层的回灌文案保持中文（模型侧指令，见 `prompts/index.ts` 的 `ExplainLanguage` 注释） |
| `anchorExplain.temperature` | number | 未设置 | 透传给端点。留空就用端点的默认值 —— 不给默认值是刻意的：不同端点对 temperature 的合理取值不一样 |

以上全部声明在 `packages/extension-anchor/package.json` 的 `contributes.configuration` 里
（S3 落地），所以它们在设置界面里可见可改，而不是只能手写 JSON。

**`providers` 的形状**（`package.json` 里带了 schema，写错会有提示）：

```jsonc
{
  "anchorExplain.providers": {
    "default": { "baseUrl": "https://api.deepseek.com", "tier1Model": "deepseek-flash" }
  },
  "anchorExplain.activeProvider": "default"
}
```

`apiKey` **建议留空**，改用命令 `Anchor: 设置 API Key` 存进 `SecretStorage`
（键名 `anchorExplain.apiKey.<providerId>`，由 `config.ts` 的 `apiKeySecretName` 统一给出）。
`providers[id].apiKey` 是明文，留着只是为了"我就想一个文件管全部"的人。

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

**S3 落地的落点**：`ToolTrace` 面板**还没做**（不在任何切片范围内），所以现在走 `sink`：
命令层传一个写到 **OutputChannel「Anchor」** 的回调（`outputLines`）。
格式：`[时间] 第 N 轮 取件/拒绝（原因） <type> <params> — <reason>（<字数>）`。
排查"模型为什么讲歪了"时这是唯一能看的东西，所以它落在最容易看到的地方，而不是只在内存环形缓冲里。

---

## §8 工具定义（给 LLM，冻结）

```json
{
  "name": "fetch_context",
  "description": "当手里的信息不足、无法准确讲解时，请求额外上下文：当前文档的一段（按页/行），或者与它逻辑相关的另一个文件的一小段。",
  "parameters": {
    "type": "object",
    "properties": {
      "request_type": {
        "enum": ["page_range", "dom_subtree", "file"],
        "description": "page_range = PDF 页码；file = 代码文件的行范围（也可以是别的文件）"
      },
      "start": { "type": "number", "description": "起始页/行（1-based，必须给）" },
      "end": { "type": "number", "description": "结束页/行（1-based，必须给）" },
      "path": { "type": "string", "description": "request_type 为 file 时要读的文件；省略 = 锚点所在的文件。默认档（相关文件/同目录）下只能写「可能相关的文件」清单里第一列的假名（f1、f2…）—— 那个清单就是这次能取的全部文件，写清单之外的任何东西都会被拒。范围设为「不限」时改为写真实路径（可以用 find_files 先查），工作区外也能读。page_range 时可省略（默认就是锚点这份 PDF）；写了必须与锚点文档的路径逐字相同" },
      "reason": { "type": "string", "description": "为什么需要这段上下文" }
    },
    "required": ["request_type", "start", "end", "reason"]
  }
}
```

**S9a-fix10 新增的第二个工具**（`FIND_FILES_TOOL`，D119）——**只在 `any` 档给**：

```json
{
  "name": "find_files",
  "description": "列出当前可读的文件路径（按文件名/路径里的关键词过滤）。不知道有哪些文件可读时先用它查，再挑要读的去 fetch_context。只在取件范围为「不限」时可用。",
  "parameters": {
    "type": "object",
    "properties": {
      "keyword": { "type": "string", "description": "关键词，按文件名或路径的大小写不敏感匹配（例如 transport、dshot、.h）。留空则列出前若干个。" },
      "reason": { "type": "string", "description": "为什么需要知道有哪些文件" }
    },
    "required": ["reason"]
  }
}
```

@anchor **为什么它是一个独立工具、而且只在 `any` 档出现**（用户提的第 1 条要求里那句
"any 给一个接口让它自己查"）：不限档的取件范围是整个文件系统，**列不成一份清单**
（那正是它不能走假名的原因）；但把模型扔进一个没有地图的空间里，它的行为就是瞎拼路径 ——
用户实测里 5 次 `ENOENT` 就是这么来的。所以这一档不发明细、改发一个**查询口**。
反向同样重要：**清单驱动的档位不给它** —— 给了模型一个列文件的工具，它就会绕开清单，
而"清单即范围"正是这次要立的东西（工具清单是模型能看见的能力全集，
不该有的许可不要发）。回话**只列池子**（`deps.workspaceFiles`，宿主侧一次扫描的结果），
黑名单照滤；列文件**不占取件轮次、也不进取件日志**（它不是"读了哪个文件的哪几段"）。

**S9a 修订（这一节的两处改动都记在 `DECISIONS.md` D67）**：

1. **`path` 必须真的声明在 schema 里**。S9a 的第一版把"可以读别的文件"只写进了**文档与系统提示**，
   schema 里没有这一项 —— 而 schema 才是模型唯一能看见的能力清单：主流端点按 schema 生成参数，
   未声明的项模型基本不会给。结果就是"许可存在但不可执行"：模型要么不给 `path`（我们按锚点文件读，
   它拿到的还是自己那份文件），要么给了也被我们当成锚点文件。**用户实测的"它就是没有往外读的想法"，
   根因在这里，不在模型。**
2. **`description` 里那句"当前文档"删掉**，`required` 补上 `start`/`end`。
   前者一直在告诉模型"只有这份文档"，与跨文件直接冲突；后者是因为 `start`/`end` 一旦缺失，
   §3.2 的规则 3 只会回一句"start / end 必须是 ≥1 的整数"，白烧一轮取件预算，
   而这两个参数**每一次取件都必然要有**（`dom_subtree` 本次不实现，不受影响）。

**D98 修订**：`path` 的 description 补 page_range 的口径（可省略 = 锚点这份 PDF；写了必须逐字一致）——
同一份 schema 服务两种来源，两种来源的 `path` 语义都在 schema 里说清，不靠模型猜。

实现侧两条约定（S3 起就有，没变）：解析侧把自定义键**原样带过去**（不丢 `path`），
校验侧把"没给 `path`"当成"就要锚点这个文件"（file）。见 §3.2 的实现约定表。

**PDF 来源的输出契约（D98）**：`steps[].location` 是 `{page, bbox}`（照抄锚点信息，不发明坐标），
`EXPLANATION_JSON_SHAPE_PDF`（zh/en 两份，`toolSchema.ts`）。system（`buildSystemPrompt` 的
`sourceType: 'pdf'`）与 repair（`buildRepairPrompt` 的 `sourceType`）在 PDF 锚点时都贴这份契约 ——
初学与修复必须同口径（D67）。PDF 的 system prompt 是**释义面**（角色/输出形状/通用规则/取件四节全换；
档位规则与代码示范不进 —— 它们是代码特有的纪律）。

---

## §9 模块路径映射与落地行号

### §8 的 `path`（S9a 加法扩展）

§8 的 `properties` 原有 `request_type` / `start` / `end` / `reason` 四项。S9a 起工具**声明**一个必填之外的
可选 `path`（字符串）：写相对路径时按**锚点文件所在目录**解析，例如 `ring_buffer.h` 或 `include/ring_buffer.h`；
不写 = 锚点文件本身。`required` 是 `['request_type', 'start', 'end', 'reason']`（S9a 补进 `start`/`end`，
理由见 §8 那两条修订）。
解析与边界判定全在 §3.2 的规则 3（纯函数，可单测）；适配器拿到的一定是**已归一化的绝对路径**。
**D117 起相对写法也是"能读工作区之外"的写法**（`../Inc/dshot_dma.h`）：解析基准是锚点目录，
而锚点可能在别处 —— 范围的四档与两条不变量见 §3.2。

**两道闸门的坐标必须对齐（S9a 修订）**：允许集合里放的是**解析后的绝对路径**，
而模型写 location 时可能照抄它请求时用的**相对路径**。所以：

- 编排层内部闸门与命令层第二道闸门，收的都是**归一化后的**路径
  （编排层取 `decision.request`；命令层从取件日志收 —— 日志记的也是归一化后的请求，
  这同时满足"日志要能复核**读了哪个文件**"）。
- §3.3 的规则 3 在比对前**先把相对 `filePath` 按锚点文件所在目录解析**，并且**返回解析后的路径**
  （下游要拿它去开编辑器，相对路径开不出来）。

@anchor 这三条是同一个 bug 的三张脸：S9a 的第一版里，内部闸门拿绝对路径、第二道闸门拿模型原样写的
相对路径，于是"模型读了兄弟文件并在讲解里引用它"这件事**必然**被其中一道拦下 —— 报错内容还是
"这个文件没读过，不能引用"，指的却是它刚读过的文件。用户实测的第一轮报错就是它（D67）。

### 9.1 已落地（F1 契约 / F2 骨架与替身 / S1 最小可视 / S2 真选区与确认 UI / S3 真 AI / S4~S7 线2 / S8 固定按钮与开始面板）——行号 = 实体定义所在行

| 路径 | 职责 | 关键实体行号 |
|---|---|---|
| `packages/core/src/types.ts` | §1 全部类型 + 守卫 + §3 适配器接口 | `SourceType`:14 `PDFLocation`:16 `WebLocation`:21 `CodeLocation`:27 `Location`:33 `Anchor`:35 `ContextRequest`:45 `WalkthroughStep`:51 `ExplanationResult`:61 `HighlightEmphasis`:75 `SubHighlight`:78 `AdapterCapabilities`:95 `SourceAdapter`:106 `isPDFLocation`:119 `isCodeLocation`:124 `isWebLocation`:133 |
| `packages/core/src/ports.ts` | §2 ports（**全部为新增，S2 加了 `getDocumentSelection`**） | `EditorSelection`:13 `EditorPort`:20 `FileSystemPort`:41 `ImageRendererPort`:47 `ExplainProvider`:61 |
| `packages/core/src/normalizeBBox.ts` | §10.1 bbox 数学（**唯一实现，fork 也复用**） | `BBox`:8 `clamp01`:16 `normalizeBBox`:27 `coerceBBox`:42 `isValidBBox`:50 `bboxArea`:55 |
| `packages/core/src/locationLabel.ts` | §10.2 位置标签 | `formatLineRange`:12 `locationLabel`:24 |
| `packages/core/src/errors.ts` | §10.3 类型化错误 | `AnchorErrorCode`:8 `AnchorError`:16 `isAnchorError`:28 `describeError`:33 |
| `packages/core/src/logging.ts` | §7 结构化日志 | `ContextRequestLogEntry`:10 `CONTEXT_LOG_LIMIT`:20 `ContextRequestLogger`:22 `createContextRequestLogger`:28 |
| `packages/core/src/index.ts` | barrel 入口。**外部一律从 `@anchor/core` 导入，不深链 `src/`**。`fakes/*` 刻意不在 barrel 里 | — |
| `packages/core/package.json` / `tsconfig.json` | 包声明与类型检查配置（tsconfig `extends` 根 `tsconfig.base.json`） | — |
| `packages/core/test/{types,locationLabel,normalizeBBox,paths,fakes}.test.ts` | 单测（`node --test`）；`paths` 是 S9a 补的（此前那四个函数一直没有直接覆盖） | — |
| `packages/core/src/fakes/fakeProvider.ts` | 假 AI。S3 被 orchestrator 替换 | `FAKE_TARGET_LINE_START`:29 `FAKE_TARGET_LINE_END`:30 `FALLBACK_FILE_PATH`:33 `createFakeProvider`:161 `fakeProvider`:176 |
| `packages/core/src/fakes/fakeEditorPort.ts` | 假选区（写死 40-48 行）。**S2 已从产物里退出**，现在只被单测引用 | `FAKE_FILE_PATH`:18 `FAKE_LINE_START`:19 `FAKE_LINE_END`:20 `FAKE_SELECTION_TEXT`:27 `FAKE_DOCUMENT_HASH`:39 `FAKE_DOCUMENT_LINE_COUNT`:47 `FAKE_DOCUMENT_TEXT`:48 `createFakeEditorPort`:77 |
| `packages/core/src/fakes/fakeFileSystemPort.ts` | 假文件系统（**S3 新增**）。让 `fetchContext` 的决策可单测，且测试不依赖 fixture 内容 | `FakeFileSystemPortOptions`:14 `FakeFileSystemPort`:21 `createFakeFileSystemPort`:31 |
| `packages/extension-anchor/src/extension.ts` | activate → `registerCommands`（入口保持极薄） | `activate`:11 `deactivate`:16 |
| `packages/extension-anchor/src/paths.ts` | **只是转发**（S5 起实现在 `@anchor/core`）：让线1 内部的 `from '../paths.ts'` 继续成立。**新增代码直接从 `@anchor/core` 导入** | — |
| `packages/extension-anchor/src/adapters/CodeAdapter.ts` | **S2 落 `capture`，S3 落 `fetchContext`，S9a 加内容护栏**（大小/二进制、读不到给人话）。代码来源适配器：把「选区 / 整文件」变成 `Anchor`、按行取件。零 vscode 依赖 | `CaptureScope`:34 `CodeAdapter`:46 `CodeAdapterDeps`:64 `createCodeAdapter`:69 `fetchContext`:116 |
| `packages/extension-anchor/src/orchestrator/Orchestrator.ts` | **S3 落地，S9a 修 D67**。编排循环：取件循环（≤maxFetchRounds）→ §3.3 闸门 → repair 一次。**它就是 S1/S2 里那个 `fakeProvider` 的真身** | `REJECT_PREFIX`:39 `OrchestratorAdapter`:41 `OrchestratorDeps`:46 `createOrchestrator`:80 |
| `packages/extension-anchor/src/orchestrator/validateContextRequest.ts` | **S3 落地，S9a 改写规则 3，D117 加 `any` 档与 `relatedRoots`，S9a-fix10 改成"清单即范围"**。§3.2 五条规则的实现 + 跨文件边界（`ContextFetchPolicy`，缺省 `RESTRICTED_POLICY` = 只允许锚点文件）；"范围"怎么算收在 `relatedRoots` 一处（锚点在工作区里吗 → 两种边界）；`related` / `same-dir` 档下**闸门只认清单里的文件**（`policy.candidates`，解析优先、后缀兜底，见 `findCandidate`） | `FetchScope`:41 `ContextFetchPolicy`:43 `DEFAULT_MAX_FETCH_LINES`:74 `MAX_FETCH_LINES_CEILING`:75 `RESTRICTED_POLICY`:78 `relatedRoots`:106 `FetchedSpan`:165 `describeFetched`:185 `ContextFetchState`:196 `ContextDecision`:212 `validateContextRequest`:252 |
| `packages/extension-anchor/src/orchestrator/ModelRouter.ts` | **S3 落地**。tier1/tier2 的成本分层（ARCHITECTURE §5） | `ModelTier`:11 `ModelRouteInput`:13 `ModelChoice`:22 `ModelRouterConfig`:29 `createModelRouter`:35 |
| `packages/extension-anchor/src/orchestrator/toolSchema.ts` | **S3 落地，S9a 修订（D67），S9a-fix10 加 `find_files`（D119）**。§8 的工具定义 + 参数解析（自定义键一并带过）。`openAITools({ withFindFiles })` 按**档位**决定给几个工具 —— 只有 `any` 给 `find_files`（不该有的许可不要发） | `FETCH_CONTEXT_TOOL`:19 `FIND_FILES_TOOL`:61 `openAITools`:85 `FIND_FILES_MAX_HITS`:92 `EXPLANATION_JSON_SHAPE`:95 `parseContextRequest`:207 |
| `packages/extension-anchor/src/orchestrator/providers/{types,openAICompatible}.ts` | **S3 落地**。LLM 调用面的抽象 + OpenAI 兼容实现（一个实现覆盖 OpenAI/DeepSeek/通义/Ollama） | `ChatMessage`:11 `ToolCall`:20 `AssistantTurn`:27 `ChatRequest`:33 `ChatProvider`:44；`OpenAICompatibleOptions`:20 `createOpenAICompatibleProvider`:71 |
| `packages/extension-anchor/src/prompts/index.ts` | **S3 落地，S8 加风格、S9a 加跨文件（D67 修：契约按 `crossFile` 换口径、候选清单真的进 prompt）**。system / user / repair 三段指令 + 输出契约（**prompt 是产品的一部分**） | `explainOutputContract`:56 `buildSystemPrompt`:81 `describeAnchor`:191 `buildUserPrompt`:214 `buildRepairPrompt`:262 |
| `packages/extension-anchor/src/config.ts` | **S3 落地，S8 加 `style`、S9a 加 `fetchScope`、S9a 修加 `maxFetchLines`（D71）**。§6 配置的**纯映射**（可单测），vscode 读取在 `vscode/configSource.ts` | `ProviderSettings`:18 `AnchorConfig`:27 `DEFAULT_MAX_FETCH_ROUNDS`:50 `apiKeySecretName`:56 `resolveProvider`:82 `clampRounds`:107 `clampFetchLines`:118 `resolveConfig`:144 `describeConfig`:175 |
| `packages/extension-anchor/src/vscode/configSource.ts` | **S3 落地**。设置 + `SecretStorage` 的读取侧，以及存 key 的服务端 | `readAnchorConfig`:21 `storeApiKey`:60 `configuredProviderIds`:88 |
| `packages/extension-anchor/src/commands.ts` | §4.1 十个命令 + 四层装配 + 捕获确认（§4.1.1）+ 取件日志落 OutputChannel + **S8 的开始面板装配与 `showStart`** + **S9a 的 `fetchPolicyFor` 与第二道闸门**。**S3 起没有任何替身**。D78：`onDidCloseTextDocument` 只记 `pendingAnchorClose`（不当场 `stop()`），由配对的 `onDidChangeVisibleTextEditors` 看锚点文件是否仍可见来定夺 —— 预览标签替换与用户主动关标签在 close 回调里长得一样。**D84：收工判定收拢为唯一一处 `evaluateSessionEnd()`，只在 `sessionFiles()`（锚点 + 各步 / 各子高亮 `location`）里的文件被关时才立案，且 `player.switching` 期间推迟不判** | `registerCommands`:120 `askWhatToExplain`:754 `capture`:779（S8 新增的 `makeStartModel` / `runStartAction` / `showStart` 在文件后段） |
| `packages/extension-anchor/src/protocol.ts` | §5 全部消息协议 + 三处边界守卫 + **S8 起状态词表（`STATE_WORD`）也在这里**（贴着 `WalkthroughState` 放，状态栏与开始面板共说一句话） | `WalkthroughState`:20 `STATE_WORD`:30 `HostToSidebar`:53 `SidebarToHost`:92 `HostToSelect`:104 `SelectToHost`:109 `HostToStart`:133 `StartToHost`:143 `isAnchorLike`:165 `parseSidebarMessage`:194 `parseStartMessage`:220 |
| `packages/extension-anchor/src/orchestrator/validateExplanation.ts` | §3.3 输出校验闸门（**AI 输出不可信的唯一入口**）。S9a 起 `filePath` 允许落在**取过件的文件**里（`allowedPaths`），并在比对前把相对路径解析成绝对路径（D67） | `ValidationIssue`:52 `ExplanationOutline`:71 `ExplanationValidation`:78 `coerceEmphasis`:95 `parseMaybeJson`:105 `validateExplanation`:350 `describeIssues`:389 || `packages/extension-anchor/src/playback/WalkthroughSession.ts` | 会话状态机（游标是「拍」，vscode-free） | `WalkthroughSnapshot`:34 `SnapshotListener`:54 `PLAY_INTERVAL_MS`:60 `beatsPerStep`:67 `totalBeats`:71 `locateBeat`:78 `firstBeatOfStep`:93 `WalkthroughSession`:100 |
| `packages/extension-anchor/src/playback/decorationPlan.ts` | 「这一拍该画哪些框」的纯决策 | `DecorationSpec`:25 `EMPHASES`:32 `FALLBACK_EMPHASIS`:34 `planForBeat`:40 `primaryLocationOf`:60 `focusFileOf`:83 `specsInFile`:95 |
| `packages/extension-anchor/src/playback/CodeWalkthroughPlayer.ts` | decoration 渲染 + `revealRange(InCenter)`；**只读不写文档**。S9a 修（D69）：**一拍只画焦点文件**（`focusFileOf`/`specsInFile`），打开目标文件用 `ViewColumn.One` + 预览标签；D70：同一文件不重复打开、渲染不并发堆积（只留最后一拍）；D77：目标文件已打开但**不在前台**时 `#focus` 把它切上来（复用 document，不重建标签）—— 否则框画在背景标签上、`revealRange` 静默失效；**D84：暴露 `switching`（正在开/关文件）与 `onDidSettle`（屏幕落定），宿主据此在"我们自己换文件"的窗口期里推迟收工判定** | `CodeWalkthroughPlayer`:83 || `packages/extension-anchor/src/sidebar/SidebarPanel.ts` | 侧边栏宿主侧：建面板 / 发消息 / 收消息 / 重放 | `SidebarHandlers`:17 `SidebarPanel`:28 |
| `packages/extension-anchor/src/sidebar/statusBar.ts` | §5.4 状态栏提示（读用户实际绑定，并**交给侧边栏复用**）+ `probe()` 自检。**S8 起状态词来自 `protocol.ts`**，这里只剩图标表 | `StatusBarHandle`:24 `createStatusBar`:61 |
| `packages/extension-anchor/src/sidebar/keybindingResolve.ts` | 键位表（**S8 起两张：线1 的 `WALKTHROUGH_CHORDS` + 线2 的 `LINE2_CHORDS`，各有各的镜像锁**）+ JSONC 解析 + 显示格式化（vscode-free） | `ChordId`:19 `WalkthroughChordSpec`:21 `WALKTHROUGH_CHORDS`:36 `LINE2_CHORDS`:105 `ResolvedChord`:119 `ResolvedChords`:120 `KeyBindingEntry`:122 `defaultChords`:129 `keybindingsPathFrom`:142 `stripJsonc`:159 `parseKeybindings`:218 `resolveChords`:234 `formatChord`:301 |
| `packages/extension-anchor/src/sidebar/ui/{styles,clientScript,html}.ts` | 侧边栏 webview 资源，**全部内联进产物**（D42）；客户端自己派发按键（D47） | `SIDEBAR_STYLES`:9 `SIDEBAR_CLIENT_SCRIPT`:15 `renderSidebarHtml`:25 |
| `packages/extension-anchor/src/relatedFiles.ts` | **S9a 新增，D117 加 `candidateDisplayName`，S9a-fix10 加"清单即范围 + 假名"**。清单的**纯逻辑**：过滤（与闸门同一份 `roots` 与黑名单）→ 排序（`#include` 优先、同目录次之、封顶 `limit` 条）→ 编假名 `f1`…；`findCandidate` 认出三种写法（假名 / 标签照抄 / 唯一后缀），多义时把选择权还给模型。宿主侧只扫文件（`vscode/relatedFiles.ts`） | `MAX_CANDIDATES`:34 `includeNamesIn`:46 `orderRelatedFiles`:60 `candidateDisplayName`:88 `CandidateFile`:96 `CandidateInput`:105 `buildCandidateFiles`:127 `findCandidate`:174 `describeCandidates`:199 |
| `packages/extension-anchor/src/vscode/relatedFiles.ts` | **S9a 新增，S9a-fix10 退成“只扫文件”**。`scanCodeFiles({ unbounded, onError })`：在工作区里找出代码类文件（绝对路径）交给纯逻辑 —— **过滤 / 排序 / 编假名一概不在这里**：那样纯逻辑才测得完，而“清单与闸门同一份判据”也才守得住。扫不出来时**降级但不静默**（D67：写一行输出通道，否则“空清单”与“真没有相关文件”分不出来） | `scanCodeFiles`:33 |
| `packages/extension-anchor/src/fetchDeny.ts` | **S9a-fix10 新增（D119）**。取件的**黑名单**（密钥 / 依赖 / 构建产物）：闸门与候选清单**共用这一份** —— 两处各写一份早晚会差一条，差的那条就是“清单里列着、取件时被拒”（或更糟的反向） | `DENIED_DIR_SEGMENTS`:19 `DENIED_FILE_PATTERNS`:30 `isDeniedPath`:44 |
| `packages/extension-anchor/src/session/lastFocus.ts` | **D121 新增**。上一次那句额外提示词的存与读（`workspaceState`，**按工作区隔离**、不进 settings）。用户在输入框里会看到它被**预填**，直接回车就是用它的原话 | `LAST_FOCUS_KEY`:21 `coerceStoredFocus`:24 `readLastFocus`:29 |
| `packages/extension-anchor/src/orchestrator/providers/types.ts` | **S3 落地，D120 加 `TokenUsage` / `addUsage`**。LLM 调用面的最小抽象；`AssistantTurn.usage` 是**可选**的 —— 端点给什么就记什么，不给就 `undefined`（不猜、不补 0） | `AssistantTurn`:27 `TokenUsage`:48 `addUsage`:60 |
| `packages/extension-anchor/src/describe.ts` | **S8 新增**。「说给用户听的一句话」的唯一格式化处：`Anchor: 显示状态` 与开始面板共用，两处不许各写一份 | `captureSummary`:22 |
| `packages/extension-anchor/src/start/startModel.ts` | **S8 新增**。开始面板的内容模型：动作表（**每个动作只指向一条已声明的命令**）+ 状态→面板的纯映射。零 vscode 依赖，因此面板里没有一条业务判断 | `StartActionSpec`:27 `START_ACTIONS`:58 `findStartAction`:111 `StartModel`:139 `buildStartModel`:175 |
| `packages/extension-anchor/src/start/StartViewProvider.ts` | **S8 新增**。活动栏里「开始」视图的宿主侧：握手 / 推模型 / 收 `start:run` / 转给命令层。**视图没被打开过就是空操作** | `StartViewHandlers`:23 `StartViewProvider`:30 |
| `packages/extension-anchor/src/start/ui/start{Styles,ClientScript,Html}.ts` | **S8 新增**。开始面板的 webview 资源，同样全部内联；客户端脚本**只渲染与派发** | `START_STYLES`:10 `START_CLIENT_SCRIPT`:18 `renderStartHtml`:15 |
| `packages/extension-anchor/assets/anchor.svg` | **S8 新增**。活动栏那个固定按钮的图标（24×24）。路径写错时 VS Code 只是不显示，所以 `smoke` 会去查文件在不在 | — |
| `packages/extension-anchor/media/walkthrough/*.md` | **S8 新增**。欢迎页「演练」卡片四步的正文（`contributes.walkthroughs` 的 `media.markdown`） | `setup.md` / `capture.md` / `flow.md` / `pdf.md` |
| `packages/extension-anchor/src/vscode/ports/editorPort.ts` | §2 `EditorPort` 真实现（**S2 起五个方法全部是真的**，没有覆盖层） | `createEditorPort`:25 |
| `packages/extension-anchor/src/vscode/ports/fileSystemPort.ts` | §2 `FileSystemPort` 真实现 + `countLines` | `createFileSystemPort`:12 `countLines`:38 |
| `packages/extension-anchor/test/*.test.ts`（18 个，222 条） | 线1 单测（`node --test`，全部 vscode-free）。S2 加 `CodeAdapter`，S3 加 `validateContextRequest` / `orchestrator` / `provider` / `config`，S7 加 `pdfAdapter`，**S8 加 `startModel` / `startUi` / `describe` / `prompts`，S9a 加 `relatedFiles`，S9a 修（D67）加 14 条盯着"两道闸门同一套坐标"，D68 加 2 条盯着侧边栏那块取件日志，D69 加 3 条盯着"一拍只画一个文件"，D69 补记加 `sidebarClient`（内联脚本的解析 + 最小 DOM 渲染，7 条）** | — |
| `packages/extension-anchor/{package.json,tsconfig.json,.vscodeignore}` | 扩展清单 / 类型检查 / 打包排除（`node_modules` 靠它整体排除） | — |
| `esbuild.mjs`（根） | 唯一打包入口，产物 `dist/extension.cjs`（见 §9.4） | — |
| `scripts/{make-fixture-pdf.mjs, devhost.mjs, link-extension.mjs, smoke-extension.mjs, smoke-walkthrough.mjs, preview-sidebar.mjs, def-lines.mjs}`（根） | 生成 30 页 fixture；**起开发宿主（绝对路径 + 先查产物，D59）**；**装成常驻扩展（目录联接，D60）**；**产物冒烟**与**链路冒烟**（见 §9.4）；侧边栏排版预览（D50）；行号表的一次性生成器。**S8 起产物冒烟也真跑一遍开始面板的宿主侧**（拿到 provider 驱动它） | — |
| `packages/extension-anchor-pdf/`（整树） | 线2：`mathematic-inc/vscode-pdf` 的 fork（**Apache-2.0**）。改动逐条见本包 `MODIFICATIONS.md` | `src/extension.ts`：`openInAnchorViewer`:45 `activate`:75 `deactivate`:85；`src/pdf-viewer-provider.ts`：`PDFViewerProvider`:99（`viewType = "anchorPdf.view"`） |
| `packages/extension-anchor-pdf/src/anchor/rectToNormalizedBBox.ts` | **S5 新增**。像素矩形 → 「第几页 + 归一化 bbox」的**全部**换算（注入脚本一行业务数学都不做，就是为了让这门换算有单测） | `PixelRect`:17 `PageRect`:24 `intersectRects`:35 `pickDominantPage`:52 `rectToNormalizedBBox`:77 `resolveSelection`:91 |
| `packages/extension-anchor-pdf/src/anchor/bridge.ts` | **S5 新增**。§5.2 两个联合类型的 TS 落地 + 边界守卫（注入脚本的输出和 AI 输出一样不可信） | `HostToSelect`:17 `CapturedGeometry`:33 `SelectToHost`:40 `parseSelectMessage`:92 |
| `packages/extension-anchor-pdf/src/anchor/captureAnchor.ts` | **S5 新增**。框选 → `Anchor`（线2 版的 `CodeAdapter.capture()`） | `CaptureInput`:15 `buildPdfAnchor`:28 `describePdfAnchor`:52 |
| `packages/extension-anchor-pdf/media/anchor-select.js` | **S5 新增**。注入式框选 overlay。**不是 TS、不参与类型检查、不进 bundle**（运行时从扩展目录读）。只做"跟手的事"：画橡皮筋、报像素几何 | — |
| `packages/core/src/paths.ts` | **S5 新增，S9a 扩，D117 加两件**。路径归一/比较/显示名/行数 + **解析与边界**（`isAbsolutePath` / `dirnameOf` / `joinPath` / `isInsidePath` / `resolveCandidatePaths` / `resolveUnrestrictedPaths` / `relativeToPath` / `relativePathFrom`）。两条线共用；线1 的 `src/paths.ts` 现在只是转发（已从行号表移除） | `normPath`:14 `samePath`:18 `basenameOf`:29 `countTextLines`:40 `isAbsolutePath`:57 `dirnameOf`:62 `joinPath`:75 `isInsidePath`:102 `expandCandidates`:115 `resolveCandidatePaths`:152 `resolveUnrestrictedPaths`:169 `relativeToPath`:188 `relativePathFrom`:219 |
| `packages/extension-anchor-pdf/{assets,patches}/` | **上游 vendored 源码，必须提交、绝不 ignore**（根 `.gitignore` 里有专门注释；`dist/` 也因此写成 `packages/*/dist/`） | `assets/pdf.js/`（23MB）、`patches/pdf.js.patch` |
| `packages/extension-anchor-pdf/tools/check_pdfjs.mjs` | 上游的不变式守卫（CSP 恰好一次、pdf.js 补丁在位）。**S4 接成了本包的 `test` 脚本** | — |
| `packages/extension-anchor-pdf/{MODIFICATIONS.md,LICENSE,README.md}` | fork 的义务件：改动声明 / 上游 Apache-2.0 原文 / 本包入口与边界 | — |
| `scripts/smoke-pdf-extension.mjs`（根） | **S4 新增，S5 扩到 66 项**。线2 的产物冒烟：不劫持（`priority: "option"`）、改名改干净、命令真能打开、assets 没被排除、**框选整条链路**（真的开面板灌消息） | — |
| `packages/extension-anchor/src/adapters/PDFAdapter.ts` + `adapters/pdf/{PDFSource,pageTextIndex,textSearch,pdfDocumentCache,pdfjsSource}.ts` | **S7 新增**。PDF 无头取件：像素无关的文字层归一化、`bbox→文本`、有界 LRU 文档缓存、pdf.js legacy 真实现。零 vscode 依赖 | `PDFAdapter`:21 `createPdfAdapter`:61 `pageHeader`:51；`PDFSource`:29；`PDFPageText`:18；`RawTextItem`:19 `TextItem`:33 `SAME_LINE_TOLERANCE`:75 `normalizeItems`:45 `readingOrder`:78 `joinLines`:92；`HIT_RATIO`:32 `itemsInBBox`:34 `textInBBox`:53；`DEFAULT_CACHE_LIMIT`:18 `PdfDocumentCache`:20 `createPdfDocumentCache`:31；`openPdfJsSource`:55 |
| `packages/extension-anchor/THIRD_PARTY_NOTICES.md` | **S7 新增**。打包 `pdfjs-dist`（**Apache-2.0**）的声明 —— 产物里那条 `/*!` 注释是唯一还留着的署名 | — |
| `test/fixtures/{main.c, sample-30p.pdf}`（根） | `main.c` 第 40-48 行是 S1/S2 的样本（S3 起 AI 自己选行）；PDF 是 S5~S7 的样本 | — |
| `package.json` / `pnpm-workspace.yaml` / `tsconfig.base.json`（根） | workspace 与依赖声明、共用 TS 基线、pnpm 11 的 `allowBuilds` 放行（见 §9.3） | — |
| `.gitignore` / `.gitattributes`（根） | 忽略规则与**换行符纪律**（后者是 `fakes.test.ts` 耦合锁的前提，见 §9.3） | — |
| `.vscode/{launch.json, tasks.json}` | F5 起调试宿主；`preLaunchTask` 跑 `anchor: watch`，默认工作区是 `test/fixtures/` | — |
| `README.md`（根）/ `packages/*/README.md` | 人类视角的入口与职责说明（`AGENTS.md` 是给 agent 的协议，不是安装说明） | — |

### 9.2 未落地（按切片）

| 路径 | 职责 | 落地切片 |
|---|---|---|
| `detect()`（两条线的适配器） | **不打算落**，理由见 §3.1 上方那张表 | 不做 |

（S4 起线2 整树已落在 §9.1 里；S7 之后计划内的切片只剩"没有"——**S8 又把开始界面加了进来**，
它也已在 §9.1。）

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
| watch 的就绪信号 | `esbuild.mjs` 在 watch 模式下打 `[anchor] build started` / `[anchor] build finished` 两条**聚合**标记，`.vscode/tasks.json` 的 `background` 匹配器认它们（D58）。**必须聚合**：一看到 endsPattern，VS Code 就会启动调试宿主 —— 每个 target 各报一次的话，线2 先好而线1 的 4.2MB 还在写，宿主会读到没写完的产物。**出错也要报 finished**，否则 VS Code 永远等不到就绪（症状是"按 F5 完全没反应"） |

**两个目标（S4 起）**：

| 目标 | 入口 | 各自的额外配置 |
|---|---|---|
| `extension-anchor`（线1） | `packages/extension-anchor/src/extension.ts` | — |
| `extension-anchor-pdf`（线2，fork） | `packages/extension-anchor-pdf/src/extension.ts` | `loader: { '.html': 'text' }` —— 上游把 `assets/pdf.js/web/viewer.html` 当字符串导入。**assets 不进 bundle**：视图运行时用 `webview.asWebviewUri` 从扩展目录读它 |

**唯一一处 tsconfig 例外**：fork 的 `tsconfig.json` 用 `moduleResolution: "Bundler"`，
而不是各包统一的 `NodeNext`。原因见该文件的 `$comment`：上游源码的相对导入不带扩展名，
改成 `NodeNext` 要逐文件加 `.ts` —— 那是把一次 fork 变成一次重写。

**产物冒烟**：`pnpm smoke`（`scripts/smoke-extension.mjs`）在不启动 VS Code 的前提下
`require` 产物，只对最外层边界（`vscode` 模块）打桩，断言：产物可加载、`activate` 注册了命令、
**`package.json` 声明的命令与注册的命令逐一对齐**（声明了没注册 → 用户点了报"命令未找到"；
注册了没声明 → 命令面板里看不见）、命令回调能跑通且 `@anchor/core` 的 `locationLabel` 确实被 bundle 进去、
webview 的 HTML/客户端脚本活到了产物里。

**链路冒烟**：`pnpm smoke:chain`（`scripts/smoke-walkthrough.mjs`，S1 新增）同样只桩 `vscode`，
但把 `anchorExplain.capture` **从选区一路跑到 decoration**：真读磁盘上的 `main.c`（所以行数上界
用的是真数据）→ 真 `validateExplanation` → 真会话 → 真玩家决策（只记下 `setDecorations`）。
**S3 起它还跑真的编排循环**：真的 `Orchestrator`、真的 §3.2 校验、真的 OpenAI 兼容实现，
唯一被换掉的是最外面那一跳 `fetch`（`globalThis.fetch` 换成桩）。
它断言三件用户在 F5 才会发现的事：

1. 每一步画在**哪几行**、用的是**哪一档配色**（即 §4.3 映射本身）
2. 退出时所有 decoration type 都被清空（不留残影）、`ui:ready` 会触发全量重放
3. **`main.c` 字节未变**、`workspace.applyEdit` 从未被调用（"纯视觉"的硬要求）

S3 之后还多守四件：apiKey 确实取自 SecretStorage、§8 的工具定义确实发出去了、
取件内容以 `role=tool` 回灌且带行号、越界的取件被拒之后**整次讲解仍然继续**。

**S8 起产物冒烟还会把开始面板的宿主侧真跑一遍**：它拿 `registerWebviewViewProvider` 收到的
provider，自己造一个假视图调 `resolveWebviewView`，然后走 `start:ready` → 模型 →
`start:run` 的完整来回（含"表里没有的 id 不执行""缺线2 时明确提示而不是抛命令未找到"）。
面板的宿主侧逻辑因此不是靠 F5 才发现问题的。

**断言条数（当前）**：`pnpm smoke` **58** 项、`pnpm smoke:chain` **115** 项、`pnpm smoke:pdf` **67** 项。

`pnpm check` 把它们排在 `build` 之后。**F5 仍然不可省**：配色好不好看、流转顺不顺是手感评审，
`pnpm smoke:chain` 只能保证"画对了行、用对了档、退出清干净"。

**排版预览**：`pnpm preview:sidebar`（`scripts/preview-sidebar.mjs`，D50）把**真实生成**的侧边栏
HTML 落到 `.tmp-preview/` 并起一个只读静态服务，浏览器打开即可看排版 ——
它复用产物里同一份 `renderSidebarHtml` + `styles.ts` + `clientScript.ts`，
只把 `acquireVsCodeApi` 换成桩。**它不验行为**（交互仍靠 F5），但把"改完先自己看一眼"
这件事从"按一次 F5"降成"刷一下浏览器"，是本项目里唯一能自查 UI 排版的手段。
**开始面板没有预览**（S8）：要看它长什么样，起 F5 点活动栏那个图标 ——
已知缺口 12 记着这件事。

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

---

## §11 PDF 拆块引擎（D99；D99 补：分栏/段落/表格修正）

**包**：`packages/pdf-blocks`（`@anchor/pdf-blocks`）—— **零 vscode / pdfjs 运行时依赖**的纯函数引擎，
node --test 直测。谁抽文字项、怎么抽（webview 里的 pdf.js、线1 的无头 pdfjs-dist），引擎不关心：
输入是**归一化坐标的纯数据**（与 core 的 bbox 同一约定：x/y 左上角、y 向下、[0,1]）。

**管线**（D99 补之后的顺序，**顺序本身就是实测返工的结果**）：

1. **文字项 → 按 item 左边缘切栏**（`partitionItems`）—— **必须最先做**。栏沟可能比栏内某个
   间隙还窄：ACM 双栏论文实测沟宽 0.02（≈1.7×行高），而"把一行拼完整"的容差是 2.5×行高。
   第一版是"先成行、再从行投影找栏沟"（`detectColumns`），于是两栏被并进一行、
   **75% 的正文变成两栏交错的乱序**（TraceMonkey 第 5 页那个 6019 字的块，左栏一句右栏一句）。
   切栏后 TraceMonkey 14 页有 13 页正确判双栏（修前 6 页里只有 1 页）、跨栏文字 75.3% → 3.9%。
   `detectColumns`（行级投影）保留为**单栏与判不出栏时的兜底**，不再是主路径。
2. **各栏分别成行**（`formLines`；栏内用 `LINE_GAP_FACTOR` 2.5 的宽松容差 —— 跨栏的项已不在
   同一集合里，宽松不会造成交错）。
3. **全文档行级页眉页脚掩码**（`markFurnitureLines`）—— 必须在成块**之前**：页脚就在段落下方，
   段落归并会把它们并进同一块，之后不删则页脚混进正文、删掉则正文一起没了（单测里 4 块全被删光）。
   判据：整行页码/URL；或同一签名（数字掩成 `#`）**跨 ≥3 个不同页**的边缘重复且含字母。
4. **各栏成块**（`blocksOfColumn`）：段落边界用**三条判据**——① 首行缩进（行左边缘比这一栏的
   基准左边缘明显右移；中文段落最可靠的信号）；② 空隙 > max(1.35×字高, 1.4×p10 行距, 0.014)
   （统计项只在行距样本 ≥6 时才算进来，否则"中位行距"就是那个段距本身，阈值永远触发不了）；
   ③ **末行短且以句末标点收尾**（两端对齐正文里最稳的信号 —— ACM 双栏的段间距≈0，只靠空隙判会把
   整栏并成一块）。字高 > 1.25×中位数且无句末标点 → 标题块。
5. **页内阅读序**（`orderPage`）：左栏 → 通栏（按 y 插入）→ 右栏。
6. **连续短行归并**（`groupRuns`）：成片的单行短块（≤60 字、高度 ≤1.6×行高）挤在紧凑矩形里
   （≥4 块、宽 ≥25% 页宽、高 ≤55% 页高）→ 归成**一块**，行内按 x 聚簇拼成"第一列 | 第二列"、
   行间按 y 排序。这是"表格/清单/代码段在版面上本来是一个整体"的落地 ——
   实测 TraceMonkey 那张结果表被切成 104 张卡片（占全文块数 48%、只承载 0.9% 的字），
   归并后是 1 张可读的卡片。
7. **跨页缝合**（`stitchPages`）：前块末尾无句末标点 + 后块以小写/CJK 开头 + 都不是标题/列表
   → 合并，保守优先，`unstitch` 一键拆回。

**块身份（解答附着在块上的地基）**：**D100 起身份由 `registry.ts` 冻结**（见 §12.1）。
`blockId` 降级为**内容指纹**，只当别名用。D99 那版"ID 由内容算出来"在"块的内容会被陆续补出来"
这件事上不成立 —— OCR 回填（`fillImageText`）、缝合（`stitchPages`）、手修（`mergeBlocks`/`unstitch`）、
引擎升级都会换掉它，用户问过的问答就**静默**失去落点。

**页眉页脚**：主防线是第 3 步的行级掩码；`dropFurniture`（块级）保留为兜底，带**安全护栏**：
只动单行且 ≤60 字的边缘块 —— 页脚被并进正文段落时，删块就是删正文。
（D99 潜伏 bug：块级那版用 `signature(b) ?? ''` 回查，页边空文字的图块签名是 `''`，
一旦 `''` 进了重复集合，**所有正文块被一起删光** —— arXiv 496 → 6 块、Cadence 986 → 11 块。）

**问答线程**：`Thread { blockIds, question, answer, createdAt, model?, followUps[] }` +
`ThreadStore`，纯操作在 `threads.ts`（挂块/按块查/组线程归末块/追问/上下文拼装 ——
追问上下文 = 块原文 + 线程本身，有界）。落盘是调用方的事。

**诚实边界**：对**有文字层**的教材/论文（单栏/双栏）好用；启发式不承诺 100% 准 ——
手修（`mergeBlocks`/`unstitch`/`setKind`/`fillImageText`）与框选兜底是设计的一部分。
扫描件（无文字层）V1 不进块流；公式/复杂表格按普通文本块处理，不保证语义完整。
**已知未做**：图内文字（坐标轴标签、图例、代码标识符，多为 1–8 字）目前各自成块 ——
它们是**图的一部分**，要等图块/图注区域检测（D102 第 5 条）把它们归到图那一块里；
实测这类块占块数 8.6%（TraceMonkey）/ 20.2%（arXiv）/ 35.0%（Cadence），占字数 ≤4.9%。

---

## §12 块流 → 问出去（D100/D101）

三件：**身份冻结**（`registry.ts`）→ **队列与编号**（`queue.ts`）→ **重排稿**（`reflow.ts`）。
都在 `@anchor/pdf-blocks` 里，零依赖、node --test 直测。视图侧（卡片流）在 `extension-anchor`
的 `src/blocks/ui/`。

### §12.1 身份冻结 `registry.ts`（D100）

```ts
interface RegistryEntry { id: string; partsKey: string; parts: BlockPart[]; aliases: string[] }
interface BlockRegistry {
  version: 1; docId?: string; nextSeq: number;
  entries: RegistryEntry[];   // 当前有效
  retired: RegistryEntry[];   // 被并掉的（墓园）—— 取消缝合要把原块认回来，所以必须留
}

emptyRegistry(docId?): BlockRegistry
registryFrom(blocks, docId?): ResolveResult          // 首次处理一份文档
resolveIds(registry, blocks): ResolveResult          // 幂等；只动 block.id，不动顺序/内容/parts
resolveAlias(registry, id): string                   // 历史 ID → 当前 ID；查不到**原样返回、绝不抛**
isKnownId(registry, id): boolean
aliasesOf(registry, id): readonly string[]           // 迁移问答时把旧键一起搬过去

interface ResolveResult { registry; blocks; minted: readonly string[]; reclaimed: readonly string[] }
PART_EPS = 0.002      // parts 视为"同一块"的坐标容差（抽取抖动实测 < 0.0005）
partKeyOf / partsKeyOf / partsNearlyEqual / isSubset
```

**匹配优先级**：近邻精确 → 长大了（本块 parts 包含某些项 = 缝合，复用最靠前那一个的 ID，
其余退休并改嫁）→ 变小了（被包含 = 取消缝合，**先去 `retired` 认回原块**；认不回来则
**第一个碎片继承容器的身份**）→ 铸新 ID。每次都把传入的 `block.id`（内容指纹）记成别名。

**ID 只增不减**；退休的 ID 进 `aliases`，`resolveAlias` 一路查得回去。

### §12.2 队列与编号 `queue.ts`（D101）

```ts
type OrderMode = 'reading' | 'pick'
interface BlockQueue { mode: OrderMode; picked: readonly string[] }   // picked 永远是**点选先后**
type BlockIndex = ReadonlyMap<string, Block>

EMPTY_QUEUE
enqueue(queue, id): { queue; added: boolean }   // 幂等；**必须**回报"这次加没加进去"（D81）
dequeue / clearQueue / hasBlock / setMode / toggleMode
orderKeyOf(block): [page, y]                    // 排序键 = (页码, y)，**不用数组下标**
readingComparable(queue, index): boolean        // 每一块都在索引里才排得了阅读序
effectiveMode(queue, index): OrderMode          // 选了 reading 但排不了 → 实际用 pick
orderedIds(queue, index): readonly string[]     // **位次的唯一来源**
orderedBlocks(queue, index): readonly Block[]   // 重排器吃这个
badgeNumbers(queue, index): ReadonlyMap<string, number>   // 块 ID → 发送位次（1-based）
positionOf(queue, index, id): number            // 不在队列给 0
previewPosition(queue, index, candidateId): number        // 悬停预览，纯计算，不改队列
describeOrder(queue, index): string             // 说**实际生效**的那一种（D68：不许说反话）
```

**不变量**：`badgeNumbers` 的位次 ≡ `orderedIds` 的序号 ≡ 重排稿里的 `[N]`（约束 107）。

### §12.3 重排稿 `reflow.ts`（D101）

```ts
interface BlockUnit { block: Block; caption?: Block }
unitsOf(blocks): BlockUnit[]              // 图注归并**唯一判据**（视图与稿子共用）
captionTextOf(unit): string | undefined

interface ReflowImage { index; blockId; caption?; parts; captionParts? }
interface ReflowBlockRef { index; blockId; kind; as: 'text' | 'image' }
interface Reflow {
  text: string; images: readonly ReflowImage[]; blocks: readonly ReflowBlockRef[];
  chars: number; approxTokens: number; truncated: boolean; droppedBlockIds: readonly string[];
}
reflow(blocks, opts?): Reflow
// opts: { docLabel?, maxChars?, includeImages?=true, askForRefs?=true }
densify(text) / approxTokens(text) / CAPTION_START
```

**纪律**：① 文字用文字发、图只发**那一块的裁剪**（`images` 只出清单，栅格是调用方的事）；
② 超预算**如实汇报**（`truncated` + `droppedBlockIds` + 抬头写明），截断以**块**为单位，不发半块；
③ `includeImages: false` 时图注仍在正文里（模型不至于看不见那里有张图），本地可退化成纯文本小模；
④ `askForRefs` 是**答案自动附着**的前提（模型按块号引用，程序才能挂回去）。

### §12.4 卡片视图 `extension-anchor/src/blocks/ui/`（D101）

```ts
// model.ts —— 纯函数，不 import 'vscode'
interface BlockCard { blockId; kind; text; partTexts; imageUrl?; empty; pageLabel;
                      multiPage; badge?; preview?; grouped; stitched; captionId? }
interface BlockView { cards: readonly BlockCard[]; folded: ReadonlyMap<string,string>; orphans: readonly string[] }
blockViewOf(blocks, queue, index, opts?: { images?: ReadonlyMap<string,string> }): BlockView
cardsSummary(view, queued, orderText): string

// html.ts —— 纯函数（cspSource 由调用方传）
interface BlockStreamView { docLabel; summary; view: BlockView; orderText; queued }
renderBlockStreamHtml(cspSource, view: BlockStreamView, fontScale?, language?): string
esc(text): string                         // 块正文是不可信内容，一律转义

// 每块的 DOM（D115：**相册** —— 一层内容 + 一条底栏 + 一颗数字，砖上没有任何 3D）：
//   .card[data-block]  >  .thumb       （缩略图：文字块是正文片段 + 底部渐隐；图块是裁剪图）
//                      >  .card-bar    （页码 / 属性，悬停或选中才显）
//                      >  .card-action （右上角那颗灰半透明粗体数字）
//   版面三条（用户给的相册参照："每个块等大、密集…应该稍微密一点，方一点"）：
//     等大 aspect-ratio: 1/1 + 网格列宽一致 / 密集 --anchor-gap: 4px / 方 --anchor-radius: 3px
//   **缩略图不必完整，但全文拿得到**：.thumb-text 底部渐隐（mask-image 到 100%），
//   整块卡的 title 是"页码 + 位次 + 正文（截 600 字）"——"不完整"不等于"看不到"。
//   ⚠ D106~D114 那七轮立体**在 D115 全删了**：`.window`（孔口）/ `.plane`（会转的底面）/
//     `.wall-*`（孔沿）/ `.glass`（玻璃）四层、视线 `--eye-x/--eye-y` 与它的 `@property`、
//     五个几何旋钮（depth/far/tilt/plane/rim）、`cqh` 与 `container-type`。
//     用户的原话："去掉后面的所有设计吧，你根本实现不了我的想法，那都去掉吧，只留相册设计"。
//     **删干净比留着调参重要** —— 留着就会有人再去调它（七轮都是这么来的）。
//   ⚠ 那七轮里压在内容之上的那两片（底面暗角 `.plane::after`、玻璃反光 `.glass`）
//     就是用户说的"有一个固定遮罩在影响我看底面"；它们跟着一起没了。
//     现在一格的最上面永远是 `.thumb` 本身（实装里用 elementFromPoint 量过）。
//
// styles.ts / clientScript.ts —— 字符串常量，内联进 HTML（同 sidebar 的做法）
//
// ⚠ styles.ts / clientScript.ts 是**模板字符串的子串**：内部一个字都不许出现反引号
//   （会当场把 CSS 截断），也不许出现未求值的 ${（会**静默**留在产物里，
//   只有 test/blockView.test.ts 那条断言挡得住）。踩过三次，都记在案
//   （D112 那次是 check-inline-strings.mjs 当场拦下的）。
```

**§12.4.0 手感纪律（D105 立、D115 收敛到两条，用户实测骂出来的）**：**静止是默认** —— 块与块内元素在
任何"用户没在操作"的状态下没有动画；**外框绝对不动**：砖的位置、角度、大小在任何状态下都不许变
（悬停位移被骂过"很吸引视线，又让人很难受"；整块砖转也被骂过"晃动很累、只能向下歪"）。
整份 CSS 里**不许出现 `perspective` / `rotate` / `matrix3d` / `preserve-3d` / `cqh`**
（D115：一个 3D 都没有），卡片 `transition` 里不许出现 `transform`（`.pop` 那一下是 keyframes，不是 transition）。
**不许整屏扫光**（做过一版 `.cone`，被否）；**不许有暖黄光**（`rgba(255,209,128)` 与 `--anchor-warm` 已删）；
**模糊与遮罩不许回来**（D113 删掉对焦那两层，D115 删掉暗角与玻璃反光）；`--tx/--ty/--px/--py/--shade`
那套跟随变量不许回来。唯一会动的是**指针的回执**，而且只动指针正指着的那一块：
① **按下去弹一下**（`.pop`，过冲，幅度 3%）；② **悬停只换边框色**（`--vscode-focusBorder`）——
不位移、不缩放、不倾斜。`prefers-reduced-motion` 下过渡与那一下弹都摘掉（去掉的是"动"，版面一条都不动）。
锁在 `test/blockView.test.ts` 的断言里（含"砖上没有变换""孔口/底面/孔沿/玻璃四层不许回来"
"视线那两个变量与 @property 不许回来""五个几何旋钮不许回来""暗角与玻璃反光不许回来"
"模糊与第二层内容不许回来""跟随变量不许回来""不许有黄光""扫光不许回来"），
另有相册那条"等大、密集、方"与"缩略图不必完整但 title 里有全文"。
另有 `scripts/check-inline-strings.mjs` 守着"内联字符串里不许有反引号"（挂在 `pnpm check` 最前）。

**§12.4.1 CSP（与侧边栏的唯一差别）**：多放行 `img-src ${cspSource} data:`。
**不放行的话所有图块会静默变空白**（CSP 违规不抛错，只在控制台里躺着）。

**§12.4.2 面板纪律**：面板只做两件事 —— 把模型画出来 + 把用户动作发回去。
**不维护任何选中状态**，真相只在宿主那边（同侧边栏："谁发命令谁承担能不能发的判断"）。

**§12.4.3 徽标的两个取值渲染进 DOM、由 CSS 切换**：
`data-pos`（已入队 = 发送位次）/ `data-preview`（未入队 = 加进去会是第几），
CSS `content: attr()` 在"悬停 / 选中"下切显。**不给徽标留第二份真相**。
数字样式照用户原话：**灰色、半透明、粗体**（选中态也不把按钮染蓝，否则它就不灰了）。

**§12.4.4 三种鼠标动作**（`blocks:range` 的语义）：

| 动作 | 消息 |
|---|---|
| 点一下 | `blocks:toggle`（再点移出） |
| Shift + 点 | `blocks:range {from, to}`（从上一次点到的连选到这块） |
| 按住拖过几块 | `blocks:range {from, to}`（起点到当前，滑选） |

底部按钮：`blocks:mode` / `blocks:clear` / `blocks:ask`。

**§12.4.5 宿主侧（S-P2 接线）**：

```ts
// src/protocol.ts —— 面板 → 宿主。**五条全是动作，没有一条是状态**（§12.4.2）
type BlockToHost = { type: 'blocks:toggle'; blockId: string }
                 | { type: 'blocks:range'; from: string; to: string }
                 | { type: 'blocks:mode' } | { type: 'blocks:clear' } | { type: 'blocks:ask' }
parseBlockMessage(raw: unknown): BlockToHost | null   // 只查形状；id 认不认识由业务查

// src/blocks/streamHost.ts —— 宿主侧状态机（纯函数，不 import 'vscode'）
StreamState { doc: BlockDoc; stream: BlockStream; index: BlockIndex; registry: BlockRegistry; queue: BlockQueue }
streamStateOf(doc, stream, prev?) / viewOf / summaryOf / orderTextOf
toggled(state, blockId) / ranged(state, from, to) / cleared(state) / cycledMode(state)
reconciled(state) → { state, folded, orphans }        // 队列与块流对齐（D81）
askPayloadOf(state, opts?) → AskPayload | null        // 队列 → 重排稿 → 锚点

// src/blocks/blockSource.ts —— 拆块的真实调用方
readSplitInput({ acquire, readBytes }, filePath, onProgress?) → { input: SplitInput; sourceId; pageCount }
itemsOfPage(page: PDFPageText): TextItemIn[]          // pdf.js 字段名 ↔ 引擎字段名，只此一处

// src/blocks/BlockStreamPanel.ts —— 真 WebviewPanel（单例，照 SidebarPanel 的路子）
BlockStreamPanel.show(state, handlers, { fontScale, language }) / setState / reveal / dispose
```

三条**必须保持**的语义（都有测试盯着）：

1. **区间选择落在卡片上，不落在块上** —— 卡片数与块数可能不同（图注并进图卡），
   所以 `ranged` 的成员来自 `blockViewOf(...).cards`：屏幕上拉过哪几张就选哪几张。
2. **队列与块流对齐**（`reconciled`）：图注被并掉时把队列里的图注 ID 改写成图卡 ID、
   别的文档的 ID 清掉，并**报出来**（D81）。每一条变更消息之后都跑一次。
3. **问出去的载体是 `Anchor`**：`extractedText` = 重排稿（第一层上下文）、
   `segments` = 选中的每一块的位置（按发送顺序）、`blockIds` = 块的身份证（D104）。
   于是 `explain(anchor)` 一行不动 —— 编排/校验/侧边栏/播放全链路复用。
   超预算截断时 `droppedBlockIds` 要说出来（不许假装都发了）。

**重画策略**：面板每次变化都**重设整个 HTML**（不是增量 DOM）——真相只有一份，
客户端永远只画宿主给的那一份；唯一要保住的客户端的数是**滚动位置**
（`vscode.setState({ scrollTop })`，加载后校正一次，见 `clientScript.ts`）。

⚠ **两个坑（都实测踩过，别再踩）**：① `getDocument` 会把喂进去的字节**transfer 走** ——
`pdfjsSource` 现在**无条件复制**，`readSplitInput` 也改成**先算指纹再打开**
（否则文档指纹会静默变成空串的 sha1）；② 命令不带参数时**不能猜"当前打开的 PDF"** ——
线2 是 custom editor，宿主拿不到它的路径，只能让用户挑一份（`pickPdfFile`）。

