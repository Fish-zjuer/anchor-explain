# ARCHITECTURE.md — 架构与数据流

> 契约细节见 `CONTRACTS.md`；决策理由见 `DECISIONS.md`；先例对照见 `PRIOR-ART.md`。
> 本文只讲**分层、依赖方向、数据怎么流**。

---

## 1. 四层（规范要求，必须解耦）

| 层 | 职责 | 目录 |
|---|---|---|
| **触发层** | 快捷键 / 选区 → 产出 Anchor 的入口 | 线1：`extension-anchor/src/commands.ts`；线2：`extension-anchor-pdf/src/anchor/*` + `media/anchor-select.js` |
| **适配器层** | 每个来源实现统一 `SourceAdapter`；`capture()` 产出 Anchor，`fetchContext()` 取件 | `extension-anchor/src/adapters/*` + `core/src/types.ts` 的接口 |
| **编排层**（核心） | 可终止的 AI 循环、取件校验、输出校验、成本分层 | `extension-anchor/src/orchestrator/*`、`prompts/*` |
| **渲染层** | 按 `WalkthroughStep[]` 逐步播放 | 线1：`playback/*`（decoration）；线2：侧边栏文字 + 跨扩展滚动定位 |

规范原文的四层映射：**触发层 → 适配器层 → 编排层 → 渲染层**，层间只通过明确接口通信，不允许跨层直接调用。

---

## 2. 双 package 拓扑

```
┌──────────────────────────┐         ┌──────────────────────────────┐
│ ext-B  anchor-pdf        │         │ ext-A  anchor-explain        │
│ (mathematic/vscode-pdf   │         │ (线1 + 编排 + 侧边栏)         │
│  fork, Apache-2.0)       │         │                              │
│                          │         │                              │
│  webview (pdf.js viewer) │         │  commands / playback         │
│   └ 注入 anchor-select.js│         │  sidebar (原生 DOM)          │
│         │ postMessage    │         │  orchestrator / prompts      │
│         ▼                │         │  adapters                    │
│  host (tsup 构建)        │         │  vscode/ports (真实现)        │
└──────────┬───────────────┘         └──────────┬───────────────────┘
           │  executeCommand                    │
           │  'anchorExplain.explainAnchor'     │  executeCommand
           └───────────────────────────────────►│  'anchorPdf.revealPage'
                       ◄────────────────────────┘
                                ┌────────────────────────┐
                                │  @anchor/core          │
                                │  types / ports / 纯函数 │
                                └────────────────────────┘
```

- **两个扩展可独立安装。** 只装 ext-A → 线1 全功能可用。ext-B 在对端缺失时**明确提示，不静默失败**。
- **跨扩展只走 `executeCommand`**（单向、不依赖返回值）：ext-B → ext-A 交 Anchor；ext-A 侧边栏 → ext-B 请求滚动定位。
- 为什么 fork 必须独立 package：它有**自己的 `package.json` 与 `tsup` 构建**，还要保留上游的 `patches/`、`assets/pdf.js/` 工作流。
- 为什么 core 是独立 package：两个扩展都要用它，且 fork 复用 `normalizeBBox`（`DECISIONS.md` D20）。

---

## 3. 依赖方向（铁律）

```
        ┌──────────────────────────────────────────┐
        │            core/                         │
        │  types · ports · normalizeBBox ·         │
        │  locationLabel · errors · logging        │
        │  ← 不依赖任何人，零 vscode 依赖           │
        └──────────────────────────────────────────┘
                 ▲            ▲              ▲
                 │            │              │
        ┌────────┴──┐  ┌──────┴──────┐  ┌────┴─────────┐
        │ adapters/ │  │orchestrator/│  │  prompts/    │
        └───────────┘  └─────────────┘  └──────────────┘
                 ▲            ▲
                 └─────┬──────┘
                       │
        ┌──────────────┴──────────────────────────┐
        │ extension-anchor/src/vscode/ports/       │  ← 全项目唯一 import 'vscode' 的 adapter 支撑
        │ playback/ · sidebar/ · commands.ts       │  ← 渲染层（也是 VS Code 专属）
        └──────────────────────────────────────────┘
```

**`core/` `prompts/` `orchestrator/` `adapters/` 一律不得 `import 'vscode'`**（`DECISIONS.md` D19）。
`adapters/CodeAdapter` 依赖 `core/src/ports.ts` 的 `EditorPort`，真实现在 `extension-anchor/src/vscode/ports/editorPort.ts`。

这条铁律同时服务三件事：
1. `CodeAdapter` 与 `PDFAdapter` 都能在 **Node 里直接测**（自动验收的前提）
2. 将来任何其他外壳都能复用编排层
3. 换桌面外壳不用改编排层与适配器层

---

## 4. 数据流

### 4.1 线1：代码编辑器

```
用户选区 (main.c 第 40-48 行)
   │
   ▼ EditorPort.getSelection()
CodeAdapter.capture()
   └─► Anchor { sourceType:'code',
                sourceId: filePath+内容哈希,
                sourceName: 'main.c',
                location: {filePath, lineStart:40, lineEnd:48},
                extractedText: 选中行原文,
                neighborHint: '第 40-48 行附近' }
   │
   ▼ Orchestrator.run(anchor)                    ← 编排层
   ├─ ModelRouter 选 tier1（文本模型）
   ├─ ChatProvider.chat(messages, tools=[fetch_context])
   ├─ 若 tool_call：
   │    validateContextRequest → 合法? CodeAdapter.fetchContext({type:'file'}) : 回灌拒绝原因
   │    → 结果追加进对话 → 回到 chat   （最多 3 轮）
   └─ 得到 ExplanationResult
   │
   ▼ validateExplanation(raw, anchor, ctx)       ← 边界校验，越界报错不渲染
   │
   ▼ WalkthroughSession                          ← 状态机 + 行内容哈希（staleness）
   ├─► CodeWalkthroughPlayer                     ← 渲染层
   │     showTextDocument(uri, {preview:false, preserveFocus:true})
   │     revealRange(range, InCenter)
   │     setDecorations(type, ranges)            ← 半透明背景 + isWholeLine + border
   ├─► SidebarPanel.webview.postMessage(session:update)
   └─► statusBar 提示（读用户实际键位绑定）
   │
   ▼ 用户按键 → 命令 anchorExplain.next / prev / goto / playPause / stop
```

**关键点**：第 40-48 行这个选区来源，在 S1 由 `EditorPort` 的**假实现**返回、**S2 已换成真实现**；
**下游一行不动**（`DECISIONS.md` D17）。这就是"假货只放在最外层边界"的兑现方式 ——
换掉的是**一个来源**，不是一条链路。

**S3 之后的实际形态与上图的一处差异**（尚未落地，不是改了架构）：

`Orchestrator.run(anchor)` 现在**存在**（`src/orchestrator/Orchestrator.ts` 的 `createOrchestrator`），
它兑现 `ExplainProvider`（`(anchor) => Promise<ExplanationResult>`）。
与上图不同的一点：它不是在激活时建一次留着用，而是**每次讲解现读配置、现建**
（`commands.ts` 的 `makeProvider()`）—— 这样改完设置立刻生效，不必重载窗口。

于是现在的命令回调实际读作：
`askWhatToExplain → CodeAdapter.capture(scope) → Orchestrator.run → §3.3 → WalkthroughSession → {player, sidebar, statusBar}`，
**每一环都是真的**。`fakeProvider` 只在 `test/` 与 `scripts/` 里作为"模型的替身"存在。

三处细节与上图不同（都不影响架构）：

1. **确认那一步**：上图从"用户选区"直接进 `capture()`。实际多一个 `askWhatToExplain()`
   （QuickPick「讲解这段 / 整个文件」），它决定 `scope`；只有光标时改为提示 + 按钮（§4.1.1）。
2. **取件那一环多一道闸门**：上图只画了 `validateContextRequest`。实际是"校验不过就**回灌拒绝原因**，
   不抛错"（D29/D52）—— 模型的一次越界不该等于整次讲解失败。
3. **`Anchor.neighborHint` 目前不填**：它是可选字段，目前没有消费者。
   填一个没人读的字符串属凭空猜形状。

### 4.2 线2：PDF

```
用户在 PDF 第 23 页拖拽
   │
   ▼ 注入脚本 media/anchor-select.js（不碰 assets/pdf.js/）
   ├─ 命中 .page[data-page-number] 拿页码
   ├─ 画 marquee（绝对定位 div + mousedown/mousemove/mouseup）
   └─ postMessage { anchor:captured, page:23, bbox, capturedImage }
   │
   ▼ ext-B host
   ├─ rectToNormalizedBBox(pageRect, selRect) → [x1,y1,x2,y2] 归一化并裁剪
   ├─ 离屏 canvas drawImage 裁出选中像素 → capturedImage (dataURL)
   └─ 组装 Anchor { sourceType:'pdf', sourceId: 字节 sha256 前 16, location: PDFLocation }
   │
   ▼ executeCommand('anchorExplain.explainAnchor', anchor)     ← 跨扩展
   │
   ▼ ext-A 走 4.1 同一套 Orchestrator / 校验 / 侧边栏
   │
   ▼ 侧边栏：文字讲解；每条 step 显示位置标签「第 23 页」
   │
   ▼ 用户点击某条 step
   executeCommand('anchorPdf.revealPage', 23)                  ← 跨扩展
     → ext-B 找到 webview panel → postMessage {anchor:gotoPage, page:23}
     → 注入脚本 → PDFViewerApplication.page = 23
```

**PDF 上不出现任何高亮框。** `next` 只推进侧边栏文字，不动 PDF。滚动定位是点击触发的、唯一的 PDF 侧视觉联动（`DECISIONS.md` D13）。

### 4.3 取件（两条线共用）

`PDFAdapter.fetchContext({type:'page_range', start:22, end:24})` 在**扩展宿主 Node 侧**用 `pdfjs-dist` legacy **无头**读取附近页文字层，**不依赖 webview**。
→ 返回带 `--- 第 N 页 ---` 页头的文本，超长按预算截断；文字层为空（扫描件）时走注入的 `ImageRendererPort` 兜底，未注入则纯文本降级。
（`DECISIONS.md` D4）

---

## 5. 成本分层（`ModelRouter`）

| 层 | 何时用 | 模型 | 成本 |
|---|---|---|---|
| tier1 文本 | 默认。`extractedText` 可用时 | `tier1Model`（便宜） | 低 |
| tier2 视觉 | `extractedText` 为空，**或**模型明确要求看图 | `tier2Model`（多模态） | 高 |
| tier3 取件 | **按需**，不预加载，总次数 ≤ `maxFetchRounds`（默认 3） | — | 中 |

在循环中**可升级**：第 1 轮用 tier1 不够 → 后续轮次切 tier2。`ModelRouter.forTurn(ctx)` 按轮次决定用哪个 provider/model。
provider 配置由用户在 settings JSON 自填（`baseUrl` / `apiKey` / `tier1Model` / `tier2Model` / `extraHeaders` / `extraBody`），一个 `openAICompatible` 实现覆盖 OpenAI / DeepSeek / 通义 / Ollama。

---

## 6. 防返工的装配差异（S1 / S2 / S3）

同一张图，只换边界上的一个件：

```
S1:  [假选区] → CodeAdapter → Orchestrator([FakeProvider]) → 校验 → Session → 渲染
S2:  [真选区] → CodeAdapter → Orchestrator([FakeProvider]) → 校验 → Session → 渲染
S3:  [真选区] → CodeAdapter → Orchestrator([openAICompatible]) → 校验 → Session → 渲染
      ↑ S2 换掉了这个           ↑ S3 换掉这个 —— 到此没有任何替身
```

**渲染层在 S1~S3 完全不变。** 这就是"先建基础、上层构建、最后把基础换成成熟版本"的具体形态（`DECISIONS.md` D17/D18）。

**S2 的观感**：把假选区换成真选区，只动了两处来源（`EditorPort` 的真实现、`commands.ts` 的确认流程），
外加把 `capture()` 从装配层搬进 `adapters/CodeAdapter.ts`（第一次可被 `node --test` 覆盖）。

**S3 的观感**：把假 AI 换成真编排循环。**`commands.ts` 里删掉的仍然只有一行**，
但这一行后面长出了一整层（`orchestrator/` + `prompts/` + `config.ts`）——
这些是**新增**的，不是把已有的东西改掉。播放器、会话、侧边栏、状态栏、键位**一行都没改**：
S1 那次"把假货关在最外层边界"的决定，到 S3 才真正兑现出它的价值。

---

## 7. 与先例的架构对照

| | 先例（MCP Walkthrough / Agent CodeWalk） | 我们 |
|---|---|---|
| 位置模型 | `(file, line, endLine)`，仅代码 | `Location` 联合类型：`CodeLocation` / `PDFLocation` |
| 渲染器角色 | 哑渲染器，状态在服务端 | 同：渲染层只负责画与导航，决策在编排层 |
| 谁来讲 | **客户端自己的模型**（零 API key） | **自带编排器** + 用户自填 base_url（这是规范要求） |
| 传输 | 本地 socket + 健康检查 | 同进程 `postMessage` + 跨扩展 `executeCommand`（更简单） |
| 覆盖度校验 | 拒绝未覆盖全部 hunk 的讲解 | 只做边界校验（用户砍掉覆盖度） |
| 语音 | TTS 朗读 | 无 |
