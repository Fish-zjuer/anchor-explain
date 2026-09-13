# DECISIONS.md — 决策记录（只追加，不删除）

> 规则：**只追加，不删旧条目。** 决策被推翻时，把旧条目标注为「已被 Dxx 取代」，新决策另起一条。
> 理由：压缩上下文后，"为什么当初不这么做"最容易丢失，而重复踩同一个坑的代价最高。
> 只写结论与理由，不贴实现。

---

## D1 交付形态 = VS Code 扩展

**决策**：做 VS Code 扩展，不做 Tauri / Electron / 浏览器应用。
**理由**：VS Code 自带 keybindings（等价全局快捷键）、自带 `CodeAdapter` 需要的活动编辑器选区 API、自带存储与密钥管理（`SecretStorage`），且**省掉 Tauri/Electron 的打包与原生工具链风险**（Windows 上 MSVC 构建工具链是否可用当时无法探测）。
**状态**：生效。

## D2 「截图」= 扩展内 PDF 画布上的框选

**决策**：PDF 由扩展自己渲染并框选，而非对屏幕/外部阅读器截图。
**理由**：对**外部** PDF 阅读器截图拿不到 `{page, bbox}`——无法知道是第几页、页内什么位置，锚点退化成纯图片，**产品命题不成立**。自己渲染则 `{page, bbox}` 免费且精确。被框选区域的像素仍抓进 `capturedImage` 供第二层视觉用，符合规范"base64，第二层才用"。
**状态**：生效。

## D3 「全局快捷键」 → VS Code 键绑定

**决策**：`Cmd/Ctrl+Shift+A` 是 VS Code 键绑定，不是操作系统级全局热键。
**理由**：VS Code 扩展 API **不提供 OS 级全局热键**，键绑定只在 VS Code 有焦点时生效。PDF 本就在 VS Code 内打开，够用。
**状态**：生效（平台约束，非取舍）。

## D4 PDF 文字层在扩展宿主无头抽取，渲染在 webview

**决策**：`PDFAdapter` 在 Node 侧用 `pdfjs-dist` **legacy 无头**跑文字层；渲染由 fork 自带的 webview viewer 负责。两个实例、两种职责。
**理由**：`fetchContext()` 因此是纯宿主调用、**无 webview 往返**，且 **Adapter 层可在 Node 里直接测**——这是自动化验收的前提。
**状态**：生效。

## D5 会话记忆用 Memento，不用 SQLite

**决策**：用 VS Code `Memento` 存会话，不用 SQLite。保留 `SessionStore` 接口。
**理由**：MVP 阶段 SQLite 是额外依赖与打包负担；接口留好，将来换实现不动调用方。
**状态**：生效。

## D6 两条线分工

**决策**：
- 线1 代码编辑器：VS Code 原生 `TextEditorDecorationType` 高亮 + 完整流转。**不用 webview 做高亮。**
- 线2 PDF：fork 一个 PDF 扩展，**只做框选定位，不做高亮流转**。

**理由**：代码行高亮是 VS Code 的原生强项（零渲染成本、自动跟随主题、不碰文件）；PDF 上的矩形高亮与流转导航代价高、收益低，且用户明确砍掉。
**状态**：生效。

## D7 location 联合类型收窄为 `CodeLocation | PDFLocation`

**决策**：实际接入的 union 只含 code 与 pdf；`WebLocation` **保留类型声明但不接入**，`WebAdapter` 不实现。
**理由**：两条线只需两种来源。保留声明是为了后续扩展不改契约；不接入是为了不在 F1 冻结死未验证的形状。
**状态**：生效。

## D8 fork base = `mathematic-inc/vscode-pdf`

**决策**：fork `mathematic-inc/vscode-pdf`（publisher `mathematic`，v0.2.5，**Apache-2.0**，`tsup` 构建，pnpm）。
**理由**：现代工具链、结构干净。**代价与注意**：Apache-2.0 要求保留 `LICENSE`/`NOTICE` 且声明修改（→ `MODIFICATIONS.md`）；`engines.vscode` 是 `^1.134.0`（README 却说 1.95，**以 package.json 为准**），因此 S4 开工前必须先测 `code --version`，不够高则改 fork 旧 tag 或换 `tomoki1207/vscode-pdf`（其默认分支不是 `main`）。
**状态**：生效（含前置检查条件）。

## D9 注入式 overlay，不打补丁到 `assets/pdf.js/`

**决策**：框选 overlay 由扩展宿主在运行时**注入脚本**到 webview，脚本自己找页面容器挂监听。**不修改 `assets/pdf.js/` 任何文件。**
**理由**：fork base 的 pdf.js 是 **vendored + 打补丁**的（`pdfjs_version.txt` + `tools/prepare_pdfjs.sh` + `patches/`），走 `patches/` 工作流会让我们的 diff 埋进一大片 vendored 代码、并破坏上游同步。注入式把 diff 缩到几个新增文件。viewer 的页面元素带 `data-page-number`、`window.PDFViewerApplication` 可取，**页码和页面矩形都能直接读**。
**状态**：生效（S5 需先验证 viewer DOM 确实暴露这些）。

## D10 键位：只提供命令 + 默认键位，用户自选

**决策**：扩展只提供命令（`anchorExplain.next/prev/stop/playPause/goto`），在 `contributes.keybindings` 声明默认键位并全部带 `when`。**默认不绑 `Space`**（避免抢打字）。**不造 preset 配置项**，用户改 `keybindings.json`。README 附"空格派"示例片段。
**状态栏提示必须读取用户实际绑定**后渲染，读取失败才回退默认文案。
**理由**：`Space` 在 VS Code 里是打字键，绑上等于讲解期间抢走编辑器空格；把选择权给用户。
**已知脆弱性**：VS Code **没有公开 API 能查询命令最终生效的键位**。实现方式是推导 `<userData>/User/keybindings.json`（由 `context.globalStorageUri` 向上三级）后自行解析 JSONC，与默认键位合并（用户覆盖优先）。这依赖内部路径而非公开 API，**可能随 VS Code 版本变化**。接受此风险，否则状态栏文案会骗人。
**状态**：生效。

## D11 `stop` 的 `Escape` 加 `!inputFocus`

**决策**：`anchorExplain.stop` 的 `when` 为 `anchorExplain.walkthroughActive && !inputFocus`。
**理由**：`Escape` 是 VS Code 的高频复用键（关闭 QuickPick、取消输入等）。加了 `!inputFocus` 才不会在讲解期间抢走这些行为。与 D10"不抢键"的一贯立场一致。
**状态**：生效。

## D12 侧边栏用原生 DOM，取消 React / Tailwind / 前端构建链

**决策**：侧边栏唯一形态是"一段文字 + 位置标签 + 取件日志"，用原生 TS + 少量 CSS。**不引入 React、Tailwind、前端打包。**
**理由**：原技术栈里的 React + Tailwind 是"自建 PDF 渲染 + 自建绝对定位高亮层"才需要的。新范围里 PDF 渲染交给 fork 自带 viewer、线1 高亮交给 `TextEditorDecorationType`，两条线唯一剩下的 UI 就是侧边栏文字。省掉一整套 webview 打包配置。
**状态**：生效。

## D13 PDF 侧边栏：点击 step 滚动定位

**决策**：侧边栏每条 step 显示位置标签（「第 23 页」）；**点击该条滚动 PDF 到对应页**。`next` 只推进侧边栏文字，**不动 PDF**。
**理由**：不做 PDF 高亮框，但"讲到第几页"必须能让用户看到对应位置，否则讲解不可用。滚动不是高亮框，符合约束。
**实现**：跨扩展命令 `anchorPdf.revealPage(page)`（侧边栏在 ext-A、viewer 在 ext-B）；对端未装时明确提示。
**状态**：生效。

## D14 砍掉 MCP 双出口 / `SocketBridge` / `RenderBridge`

**决策**：不做 MCP server，不做 socket 桥。
**理由**：MCP server 是独立进程、碰不到 webview 的 `postMessage`，要驱动高亮必须再加一层 socket 桥，属于单机单进程场景的过度设计。**曾计划过**「扩展 + MCP 双出口 + `RenderBridge` 抽象」，全部砍掉。
**状态**：生效。（被取代的旧计划：MCP 双出口、`SocketBridge`、`RenderBridge`）

## D15 砍掉 TTS / 语音讲解

**决策**：不做语音。
**理由**：用户未要求；且先例 code-explainer 的 TTS 依赖 macOS + Apple Silicon，**在 Windows 上是纯累赘**（330MB 模型装了也用不上）。
**状态**：生效。

## D16 砍掉覆盖度校验，只保留边界校验

**决策**：`validateExplanation` 只做边界校验（location 落在 sourceId 内、页码/bbox/行号不越界）。**不做**先例 agent-codewalk 那种"每一步必须覆盖全部 diff hunk"的覆盖度校验。
**理由**：用户明确砍掉。边界校验已能防止"坐标越界"，这是渲染安全的下限。
**状态**：生效。

## D17 假货只允许出现在最外层边界

**决策**：S1 阶段假的东西**只有两处**——AI 从哪来（`FakeProvider` 返回写死的 `ExplanationResult`）、选区从哪来（`EditorPort` 的假实现）。`ExplanationResult → 校验 → 会话状态 → decoration → 侧边栏 → 状态栏 → 键位` **必须全真**。
**理由**：这是防返工的核心。若把 step 写死在**播放器**里，S1 只验证了"播放器能画框"，真实链路形状到 S3 才第一次暴露，上层就得重写（用户原话："各个之间的联动不好实现"）。放在边界上则 S2/S3 各只换一个件，**上层零改动**。
**状态**：生效（所有切片共用约定）。

## D18 基础先行：F1 契约冻结 + F2 走通骨架与测试台

**决策**：在 S1 之前插入两层基础。F1 = `packages/core` 类型与 ports 落地（**此后接口不再变，除非用户确认**）；F2 = 能装能编能跑能测的空骨架 + `FakeProvider` + fixtures。
**理由**：用户提出"先建基础/测试环境，上层在其上构建，最后把基础改成成熟版本"。契约先行才能让各切片之间"联动"稳定。
**状态**：生效。

## D19 `/core` `/prompts` `/orchestrator` `/adapters` 零 `vscode` 依赖

**决策**：这四个目录**不允许 `import 'vscode'`**，靠 `core/src/ports.ts` 抽象；真实现在 `extension-anchor/src/vscode/ports/`。
**理由**：这条同时服务三件事——两个 adapter 都能在 **Node 里直接测**、MCP 之类的其他外壳将来能复用、换桌面外壳不用改编排层。
**状态**：生效。

## D20 fork 复用 core 的 bbox 归一化

**决策**：fork 通过 `import type` 引 core 的类型，但 bbox 归一化**用 core 的实现，不在 fork 里另写一份**。
**理由**：坐标数学重复两份必然漂移（裁剪规则、边界处理），风险高于"fork 多一个 workspace 依赖"的代价。代价在 `MODIFICATIONS.md` 里写明。
**状态**：生效。

## D21 每片 git 提交 + `git tag slice-<编号>`

**决策**：每个切片完成后提交并打 tag。
**理由**：切片要求"不符合就回退，不叠加"，逐片 tag 是回退的必要条件。
**注**：这**改变了此前"不提交除非用户要求"的默认**。
**状态**：生效。

## D22 docs 六件套现在写满，不留空骨架

**决策**：`AGENTS / STATE / SLICES / CONTRACTS / DECISIONS / PRIOR-ART / ARCHITECTURE` 一次写满。
**理由**：这几轮攒下的调研成果（MCP Walkthrough 已核实 schema、fork base 的 Apache-2.0 与 vendored pdf.js、`engines.vscode` 与 README 矛盾等）**正是最怕被上下文压缩掉、重新获取代价最高的东西**。写进 docs 成本近乎零。
**状态**：生效。

## D23 PDF 不劫持默认打开：`priority: "option"` + 显式命令

**决策**：fork 的 `contributes.customEditors` 加 `"priority": "option"`（上游没有，等于默认 PDF 打开器），另加显式命令 `anchorPdf.openInAnchorViewer`（"用 Anchor 打开 PDF"）+ 资源管理器右键菜单。
**理由**：用户要求"不劫持原版，用户主动执行命令时才用"。加 `priority: option` 保证**永不抢默认 PDF 打开**。**曾计划过**用 `CustomReadonlyEditorProvider` 接管 `*.pdf`，已否决。
**状态**：生效。

## D24 S1 硬门：必须用户实操确认后才进 S2

**决策**：S1 完成后**必须由用户实操确认**，才允许开始 S2。**不允许"先做完再一起看"。**
**理由**：S1 决定的是"荧光笔手感"这类只能靠眼睛判断的东西；一旦错误被后续切片固化，返工面涉及播放器、侧边栏、键位三层。
**状态**：生效（硬约束）。

## D25 测试运行器用 Node 内置 `node --test`

**决策**：单元测试用 `node --test`，不引入 Jest/Vitest。VS Code 集成测试用 `@vscode/test-electron`。
**理由**：Node 24 内置，零依赖，符合"最小依赖"。集成测试只用于必须真编辑器的部分（如"文件未修改"断言）。
**状态**：生效。

## D26 pnpm workspace：单仓库两扩展 + 一共享包

**决策**：`packages/core`（`@anchor/core`，私有库）+ `packages/extension-anchor`（线1）+ `packages/extension-anchor-pdf`（线2 fork）。
**理由**：fork 必须独立 package（有自己的 `package.json` 与 `tsup` 构建）；core 需被两边共享。两个扩展可独立安装，PDF 侧在对端缺失时优雅降级。
**状态**：生效。

## D27 扩展命名

**决策**：publisher 统一 `anchor`；`anchor-explain`（线1，ID `anchor.anchor-explain`）与 `anchor-pdf`（线2，ID `anchor.anchor-pdf`）；命令与配置命名空间 `anchorExplain.*` / `anchorPdf.*`。
**理由**：本地 `.vsix` 安装不需要 Marketplace 唯一性；`anchorPdf.*` 与上游 `pdf.*` 分离，避免与真 `vscode-pdf` 冲突。
**状态**：`已冻结（可调）`。

## D28 `AGENTS.md` 作为工作协议 + 上下文与压缩纪律

**决策**：项目根 `AGENTS.md` 承载工作协议，并追加"上下文与压缩纪律"节（固定读取顺序、读文件预算、docs 唯一事实源、收工必写、续接自检四问）。
**理由**：用户会定期压缩上下文，且明确不希望"重复读取某些文件使缓存命中率很低"。固定读取顺序可保持上下文前缀稳定从而提高缓存命中；读文件预算禁止同文件读两遍。
**状态**：生效。

## D29 `ContextRequest` 非法时回灌拒绝原因，不抛错

**决策**：取件请求校验不通过时**不抛异常**，而是回灌一条工具结果「请求被拒绝：<reason>，请基于现有信息作答」，让模型自我纠正。
**理由**：抛错会打断循环、浪费一轮；回灌让模型有机会用现有信息作答或换一个合法请求。同时**每次请求（含被拒）都必须落日志**，便于调试 AI 取件行为。
**状态**：生效。

---

## 已被取代 / 已废弃（保留记录，勿重蹈）

| 原计划 | 取代者 | 说明 |
|---|---|---|
| MCP server 双出口 + `SocketBridge` + `RenderBridge` | D14 | 单机单进程场景的过度设计 |
| React + Tailwind 做侧边栏 | D12 | 唯一 UI 只剩一段文字 |
| `CustomReadonlyEditorProvider` 接管 `*.pdf` | D23 | 会劫持默认 PDF 打开 |
| webview 内键盘监听（`useKeyboardNav`） | D10 | 流转全部走命令，交给 VS Code 键位层 |
| 覆盖度校验（"每步必须覆盖全部 diff hunk"） | D16 | 用户砍掉 |
| `Space` 作为默认主键 | D10 | 会抢打字 |
| 默认不 git 提交 | D21 | 逐片回退需要逐片 tag |
| 会话记忆用 SQLite | D5 | 先用 `Memento` |
