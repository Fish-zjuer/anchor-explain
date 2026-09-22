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

## D22 docs 六个文件 + 根 AGENTS.md，现在一次写满

**决策**：`docs/` 下六个文件（`STATE / SLICES / CONTRACTS / DECISIONS / PRIOR-ART / ARCHITECTURE`）
加根目录 `AGENTS.md`，一次全部写满，不留空骨架。
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

## D30 测试直接跑 `.ts`，不引入构建步骤

**决策**：`packages/core` 的源码与测试都是 `.ts`，直接 `node --test` 运行，**不加 tsup/tsx/编译步骤**。
**落地细节（踩过的坑，别重犯）**：
- Node 24 的类型剥离（type stripping）默认可用，实测 `node --test` 跑 `.test.ts` 通过。import 说明符**必须带 `.ts` 扩展名**（`from './types.ts'`），配合 tsconfig 的 `allowImportingTsExtensions` + `noEmit`。
- 测试脚本必须写成 `node --test "test/*.test.ts"`。**传目录（`node --test test/`）会失败**，Node 会把目录当入口模块解析；Windows 下 shell 也不展开通配符，所以要靠 Node 自带的 glob（已实测可用）。
**理由**：零构建步骤，任何一次改动后"跑测试"的成本降到最低；`tsc --noEmit` 只做类型检查不产出。
**状态**：生效。

## D31 `SourceAdapter.detect()` 保持同步（曾偏离，已纠正）

**决策**：`detect()` 是**同步** `boolean`，与规范原文一字一致。**不要改成 `Promise<boolean>`。**
**经过**：F1 落地时我一度写成 `Promise<boolean>`——这是对规范的**静默偏离**，在核对规范原文时发现并改回。已在 `CONTRACTS.md` §3 与 `types.ts` 内注明原因。
**依据**：`CodeAdapter` 的判据是 `window.activeTextEditor`（属性，同步）；`PDFAdapter` 的判据是宿主内存中的已打开 PDF 会话集合（同步）。两者都不需要异步。
**若未来确需异步**：属**契约变更**，须经用户确认，不得自行改。
**教训**：把契约写进 docs 时要逐字对照规范原文，新增的东西必须显式标注「新增」——否则偏离会静默传播到下游实现。
**状态**：生效。

## D32 每片收尾跑一次独立只读校验

**决策**：每个切片实现完成后、打 tag 之前，用一个**独立的只读 subagent** 对照契约与规范原文复核一遍。
校验 agent 必须**只读**，且必须拿到**规范原文**——只给契约是不够的，
否则它无法判断"契约本身是否已经偏离规范"。
**理由**：F1 这次校验抓出 7 条阻塞级问题，全部是我自己写的、自己没看见的：
- `CONTRACTS.md` §3.3 把"砍掉覆盖度校验"的依据引成 `D14`（实为 `D16`）——依据链错会误导后续实现
- `ActiveLocation` 是死类型且同节语义自相矛盾
- `AnchorErrorCode`、`normalizeBBox`/`locationLabel` 的函数契约、日志 API 面完全没进契约，
  而这三个文件头还写着"事实源 §9"（§9 其实只是路径表）
- 我宣称 §1.1「一字不改」但实际补了注释——**这是个假声明**
- F1 未提交、未打 tag，却在 `STATE.md` 里提前记账
- `SourceAdapter.capabilities` 插在规范字段中间，破坏了规范字段的绝对顺序
**状态**：生效。

## D33 删除 `ActiveLocation`，收窄 `types.ts` 的"全项目类型"声明

**决策**：
- **删掉 `ActiveLocation`**（`CodeLocation | PDFLocation`）。它没有任何消费者，且 §1.3 同一节
  既称它"实际接入的 union"又称"orchestrator 只认 `Location`"，自相矛盾。需要收窄时直接用 `Location`。
- `types.ts` 头部声明从"全项目类型的事实源"**收窄**为"§1/§3 类型的事实源"；
  §5 的消息协议类型（`WalkthroughState` / `HostToSidebar` 等）按 `CONTRACTS.md` §9.2 在 S1 落地到 `protocol.ts`。
**理由**：死类型与过度声明都会在 S1 被误当成"已冻结但没人用"的遗留物。宁可现在删掉，需要时再加一行。
**状态**：生效。

---

## D34 打包用 esbuild，产物是 `.cjs`，`tsc` 永不产出 JS

**决策**：根 `esbuild.mjs` 是唯一打包入口；两个扩展的 `main` 都指向 `dist/extension.cjs`；
各包 `tsconfig.json` 一律 `extends` 根 `tsconfig.base.json` 且开 `noEmit`。
**理由**：
- 扩展宿主的入口是 `require()`，**不支持 ESM 入口**，所以产物必须是 CommonJS；包内是 `type: module`，故用 `.cjs` 后缀明确告诉 Node。
- 所有依赖 bundle 进产物 ⇒ `.vscodeignore` 可整体排除 `node_modules`（pnpm 的符号链接还会让 `vsce` 报错，排除掉正好）。
- `tsc` 只做类型检查这条路已经在 F1 走通（`allowImportingTsExtensions` + `noEmit`），继续沿用以避免"编译产物"和"打包产物"两套东西打架。
**状态**：生效。

## D35 pnpm 11 的构建脚本放行键是 `allowBuilds`，且是映射

**决策**：`pnpm-workspace.yaml` 写 `allowBuilds: { esbuild: true }`。
**理由**：pnpm 10 的 `onlyBuiltDependencies`（列表）在 11 上不再生效——`pnpm install` 会直接把
`allowBuilds:\n  esbuild: set this to true or false` 这个占位符写回 `pnpm-workspace.yaml`。
写错不报错，只留一条 `ERR_PNPM_IGNORED_BUILDS` 噪音。
补充事实：esbuild 的平台二进制走 optional dependency（`@esbuild/win32-x64`），**不靠 postinstall**，
所以即便被拦也能用；放行只是为了消噪音。
**状态**：生效。

## D36 产物冒烟脚本 `scripts/smoke-extension.mjs`，只对 `vscode` 打桩

**决策**：F2 起加一条自动防线：不启动 VS Code，直接 `require` 打包产物，把 `vscode` 模块换成假的，
断言产物可加载、`activate` 注册了命令、命令回调能跑通且 `@anchor/core` 真的被 bundle 进去
（用 `locationLabel` 输出 `第 40-48 行` 来证明，而不是"编译通过"）。`pnpm check` 里排在 `build` 之后。
**理由**："F5 能起调试宿主"只能靠肉眼，一旦某天产物格式或 workspace 链接断了，要等到手动 F5 才发现。
把桩**只**打在 `vscode` 这一层，正好符合 D17「假货只允许出现在最外层边界」——
脚本本身不引入任何中间层替身。
**状态**：生效。

## D37 新增接缝 `ExplainProvider`（core/ports.ts）

**决策**：在 `ports.ts` 追加 `type ExplainProvider = (anchor: Anchor) => Promise<ExplanationResult>`，
标注【新增，非规范原文】；它是"AI 从哪来"的边界。
**理由**：假 provider 与真 orchestrator 必须**签名一致**，S3 才可能只改调用点一行。
若在 S1 让 `commands.ts` 直接调 `fakeProvider`，S3 就得在命令层做适配，链路中间会多出一层形状转换。
**注意**：这是**加法**，未改动任何已冻结签名（同 §1.2 的处理方式）。
**状态**：生效。

## D38 `fakes/` 不进 barrel，用子路径显式引入

**决策**：`packages/core/src/index.ts` **不导出** `fakes/*`；导入写法是 `@anchor/core/fakes/fakeProvider`。
**理由**：替身必须显眼。若能从 barrel 一把导入，正式链路里很容易悄悄依赖上测试替身，
而这类依赖在 S3 换真实现时才会暴露。多打一截路径就是一道自觉的闸门。
**状态**：生效。

## D39 `@types/vscode` 用精确版本，跟 `engines.vscode` 严格对齐

**决策**：`packages/extension-anchor` 里 `engines.vscode` 与 `@types/vscode` 都写 `1.90.0`，**不带 `^`**。
**理由**（F2 独立校验抓出来的阻塞级问题）：两处都写 `^1.90.0` 时看起来一致，实则不然 ——
`vsce` 那条 `@types/vscode ≤ engines.vscode` 的守卫只比字符串、不会报错，但 pnpm 会把类型解析到**最新版**
（实测装成了 `1.137.0`）。于是 `tsc` 会静默放行 1.90 上根本不存在的 API，
而 `engines.vscode` 又向用户承诺了 1.90 —— 这类错误只在运行时崩。
**状态**：生效。详见 `CONTRACTS.md` §9.5。

## D40 加 `.gitattributes` 钉 LF，并把 `.gitignore` 的 `dist/` 收窄

**决策**：新增根 `.gitattributes`（`* text=auto eol=lf`；`*.pdf`/`*.png`/`*.vsix` 标 `binary`；`*.bat`/`*.cmd` 保持 CRLF）。
`.gitignore` 的 `dist/` 改成 `packages/*/dist/`。
**理由**（同样是校验抓出来的）：本机 `core.autocrlf=true` 而仓库原先没有任何换行符约定，
`test/fixtures/main.c` 一被 git 接手就会变 CRLF，直接打红 `fakes.test.ts` 里那条新加的耦合锁。
测试侧也一并改成按 `/\r?\n/` 切分兜底，但换行符不该靠测试去兜。
`.gitignore` 那条泛匹配则会误伤 `packages/extension-anchor-pdf/assets/pdf.js/` 下的同名目录 —— 那是必须提交的 vendored 源码。
**状态**：生效。

---

## D41 步级底色与 emphasis 配色分层（S1）

**决策**：一个 step 的**整体范围**只画一层中性底色（`editor.selectionHighlightBackground`、无描边），
§4.3 的四档 `emphasis` 配色**只作用于 `highlights[]` 子高亮**。两者用**各自独立的
`TextEditorDecorationType`**，不用同一个 type 的两份 range。

**理由**：步级范围（如 40-42）与子高亮（如 40、42）几乎总是重叠。若两者都用 emphasis 配色，
两套半透明底色叠在一起会糊成一团，"哪几行是这一步、哪一行是重点"反而看不清。
independent type 的另一个好处：清框时不会有"同 type 的 range 被覆盖掉"的错觉。
**代价**：`WalkthroughStep.color` 在 S1 没有消费者（类型保留，值不用）。接受。

**状态**：生效。配色表见 `CONTRACTS.md` §4.3。

---

## D42 侧边栏资源内联进 bundle + `ui:ready` 握手（S1）

**决策**：两件事合在一起解决"侧边栏重开是一片空白"这个隐患。

1. **资源内联**：侧边栏的 CSS 与客户端脚本写成三个 TS 模块（`ui/styles.ts` / `ui/clientScript.ts` /
   `ui/html.ts`）导出字符串常量，由宿主在设置 `webview.html` 时拼进去。**不做 `asWebviewUri`、
   不做静态资源拷贝、不加构建步骤**。CSP 取最严一档：`default-src 'none'` + 只放行带 nonce 的内联 script/style。
2. **`ui:ready` 握手**：`SidebarToHost` 追加一个消息类型（§5.3 冻结表里唯一的新增）。
   webview 一启动就发它，宿主收到后把最近的若干条消息（环形，上限 50）原样重放。

**理由**：webview 的 DOM 生命周期与宿主无关 —— 面板被关掉再打开时，新 webview 的脚本才刚
`acquireVsCodeApi()`，宿主在 `webview.html = ...` 之后立刻 post 的消息会丢在它订阅之前。
没有握手就只能让 webview 自己持久化状态（`vscode.setState`），那是第二份状态源，与
"会话状态只有 `WalkthroughSession` 一份"冲突。**重放把这个问题降级成零状态。**
**代价**：客户端脚本是字符串常量，**不参与类型检查**（已在该文件头写明）；webview 侧因此
不能 import `@anchor/core`，`locationLabel` 的显示规则在 `ui/clientScript.ts` 里有一份 4 行的副本，
两处注释互相指向。这是内联方案的固有限制，已记录。

**状态**：生效。

---

## D43 新增 `scripts/smoke-walkthrough.mjs`：S1 链路的自动化验收（S1）

**决策**：在 `smoke-extension.mjs`（结构冒烟：产物可加载、命令已注册）之外，再加一个**链路冒烟**：
同样只桩 `vscode` 模块，但把 `anchorExplain.capture` 从选区一路跑到 decoration ——
真读磁盘上的 `main.c`、真 `fakeProvider`、真 `validateExplanation`、真会话、真玩家决策
（只记下 `setDecorations` 的入参），并断言每一步画在哪几行、用的是哪一档配色。

**理由**：S1 的验收标准是"用户实操确认手感"，而**手感的前置条件是链路不崩**。
若 F5 一按就报错，用户的时间就白花了；而"画对了行、用对了档、退出清干净、文件字节没变"
这些是脚本能判的，不该占用用户的一次 F5。这也补上了 `STATE.md` 约束 16 说的
"`extension-anchor` 没有测试"的空白。
**代价**：桩会随真实 API 增长（本例加了 6 个成员）。**但桩只加在 `vscode` 这一个边界上**，
与 D17「假货只允许出现在最外层边界」一致：桩之外全是真代码。
**它不替代 F5**：配色好不好看、流转顺不顺、`borderWidth: '0 0 0 3px'` 在真实主题下渲染成什么样，
只有肉眼看才算数。

**状态**：生效。`pnpm smoke:chain`，已进 `pnpm check`。

---

## D44 输出校验比 §3.3 严一格：`step.text` 必须非空（S1）

**决策**：§3.3 逐条列举了 `steps.length ≥ 1`、`confidence ∈ [0,1]`、`summary` 非空，
但没有要求 `step.text` 非空。`validateExplanation` **补上这一条**：空 `text` 判失败。

**理由**：`text` 是侧边栏里那段主体讲解，空字符串在 UI 上就是一片空白 ——
用户看到"第 2 步"却什么都没读到，比报错更糟。宁可让模型重试一次。
**代价**：它是一个不在冻结清单里的判据。所以写在这里，且 `CONTRACTS.md` §3.3 末尾同步标注了
"这是比 §3.3 严一格的规则"。**不是密谋加严**：任何未来的模型适配都要知道这条。

**状态**：生效。

---

## D45 mac 默认键位用 `cmd` 替换 `ctrl`；修饰键显示顺序 Cmd 在前（S1）

**决策**：`contributes.keybindings` 每一条都同时给 `key`（win/linux）与 `mac`；
mac 上 `ctrl` → `cmd`，`alt+[`/`alt+]`/`escape` 两侧相同。
`formatChord` 的修饰键归一顺序为 **Cmd/Win → Ctrl → Shift → Alt**，
于是 mac 显示 `Cmd+Alt+W`、Windows 显示 `Ctrl+Shift+A`，两边都符合各自习惯。

**理由**：§4.1 的默认键位表只写了 ctrl 形式，mac 用户按 `ctrl+alt+w` 是很别扭的；
`keybindings` 的 `mac` 字段本来就是为这件事存在的。
顺序问题：用户写 `shift+ctrl+a` 也得显示成同一种读法，否则状态栏提示会随用户写法漂移。
**状态**：生效。耦合锁在 `test/keybindingResolve.test.ts`。

---

## D46 `done` 之后 ESC 必须仍然可用 —— 新增 context key `sessionOpen`

**决策**：新增 context key `anchorExplain.sessionOpen`（S1 第二条、也是最后一条契约新增）。分工：

| key | 语义 | 绑在它上面的命令 |
|---|---|---|
| `anchorExplain.walkthroughActive` | running / playing / paused 为 true；**`done` 与 `idle` 都落 false** | `next` / `prev` / `goto` / `playPause` |
| `anchorExplain.sessionOpen` | 从开会话起 true，**只到 `stop` / 编辑器关闭才落 false**（`done` 不落） | `stop` |

**理由**（独立校验抓出来的阻塞级问题）：原设计把 `stop` 也绑在 `walkthroughActive` 上，
于是产生一条用户必然踩到的死路 —— `alt+]` 走到最后一步 → `done` → §4.2 要求
`walkthroughActive` 落 false → **`escape` 的 `when` 不再匹配 → 屏幕上的荧光笔再也清不掉**，
而状态栏还在向用户展示这三个"按不动"的键。两条各自合规的冻结条款合起来产生了这个洞，
只能靠把"该不该吃推进键"与"还有没有东西要收尾"拆成两个 key 来解。

**代价**：`contexts` 多一个 key（`Contributes` 里不需要声明，`setContext` 动态置位即可）；
`CONTRACTS` §4.2 与 `stop` 那一行同步改了。**用户 F5 时要专门验这条**（STATE.md 检查项 3/4）。

**状态**：生效。

---

## D47 宿主把用户键位内联进侧边栏 HTML，让 webview 自己派发按键

**决策**：`renderSidebarHtml(cspSource, chords)` 多收一份**已解析的用户键位**，
内联成 webview 里的 `ANCHOR_CHORDS` 常量；客户端在 `keydown` 上按这份表匹配
`next` / `prev` / `stop` 三条，匹配上就 `postMessage` 转成已有的 `ui:*` 消息。
**不加协议消息类型**，`ui:next` / `ui:prev` / `ui:stop` 早就在 §5.3 里了。

**理由**：**webview 里的按键不会冒泡到工作台** —— iframe 内的键盘事件到不了父文档，
所以一旦焦点落在侧边栏面板上（`createWebviewPanel` 默认会把焦点给它），
`contributes.keybindings` 里那几条就全哑了。而"按 `alt+]` 往下走"正是 S1 的核心交互。
用工作台键位 + 面板内转发**两层**覆盖：编辑器有焦点时走前者，面板有焦点时走后者，两者用的
是同一份解析结果（和状态栏提示同源），不会显示一套、响应另一套。

**为什么用内联 HTML 而不是新协议消息**：键位在一次会话里是常量，编译进 HTML 比再加一条
消息类型便宜，而且顺着 D42 已经建好的重放/握手通道走，不引入新的时序问题。
**代价**：键位来自用户的 `keybindings.json`，属不可信文本，所以 JSON 里的 `<` 一律转义成
`\u003c`（否则一个形如 `</script>` 的键名就能跳出 script 标签）。
**顺带修掉**：状态栏原先"第一次要显示时才读键位"，会让第一帧用默认键、之后跳变；现在激活时就读一次。

**未验证项**：本机无法验证"面板有焦点时转发是否真的生效"（需要 F5）。
若 F5 时发现按键在面板里不灵，先查 `ANCHOR_CHORDS` 是否内联成功（`pnpm smoke:chain` 已断言它在 HTML 里）。

**状态**：生效。

---

## D50 侧边栏排版：固定列宽对齐 + 非当前步一律压暗 + 本地排版预览

**决策**：三件事，都是用户看过 F5 截图之后提的"布局不够鲜明、没有突出点、有点没对齐"。

1. **两条对齐纪律**（`styles.ts` 顶部写明了）：
   - **标签列固定宽**（`--anchor-tag-w: 4.6em`）。`上下文` 是 3 个字、`定义`/`注意` 是 2 个，
     各按内容撑开的话，后面那截讲解文字的左边缘会逐行错开。
   - **标记槽固定宽**（`--anchor-gutter-w`）。`▸` 只出现在被扫描的那一行，
     若它只占那一行的宽度，整行会被顶右 3–4px，上下两行的标签就对不齐了。
     现在每行都占同样宽的槽，`▸` 只是往槽里填内容。
2. **非当前步一律压暗**（`.step:not(.current) { opacity: 0.62 }`）。
   第一版只压暗"已讲过的"，于是**还没讲到的步骤和当前步一样亮** —— 走到第 1 步时整屏都在喊，
   这就是"没有突出点"的真正原因。这条是逻辑错误，不是审美问题。
3. **`scripts/preview-sidebar.mjs`**：把**真实生成**的侧边栏 HTML 落到本地文件并起一个
   只读静态服务，用浏览器打开就能看排版。它把 `acquireVsCodeApi` 换成桩、喂一条假的
   `session:update`，复用的是产物里同一份 `renderSidebarHtml` + `styles.ts` + `clientScript.ts`，
   所以看到的排版就是真排版。

**为什么值得加预览脚本**：排版的取舍**只能靠眼睛判**，而每次改完都让用户按 F5 看一眼，
代价太高（用户的时间是这条链上最贵的资源）。有了它，改完先自己看一遍再交出去 ——
本轮就是靠它发现并修掉三处的：标签列错开、扫描行被顶右、以及**窄面板下的横向溢出**
（最后那条其实是我预览脚本自己的 bug：给 `body` 定了死宽度。但正是那一次渲染暴露了它）。

**顺带**：扫描行加了 `scroll-margin-bottom: 64px` —— 底部工具条是 sticky 的，
不留这段边距，客户端那句 `scrollIntoView` 会把扫描行刚好停在工具条底下。

**代价**：多一个脚本 + 一个 `.tmp-preview/` 忽略项。脚本只读源码、不参与 `pnpm check`，
所以它坏掉也不会拦住构建（代价是它可能悄悄过期，届时用 `pnpm preview:sidebar` 一看就知道）。

**状态**：生效。

---

## D51 S2：真选区接线 + 捕获确认 UI + `capture` 搬进适配器

**决策**：五件事。

1. **删掉假选区**。`commands.ts` 里 `createFakeEditorPort(...)` 那行覆盖与 `resolveS1FixturePath()`
   整体删除，`editorPort` 就是 `createEditorPort()` 的原样。**判据不是"行为看起来对"**：
   `fakes/fakeEditorPort.ts` 的独有字面量（`fake-hash-0000`、整份文档的替身正文）已从产物里
   tree-shake 掉 —— `smoke-extension.mjs` 有一条断言守这件事，它比"这次没走到那条分支"硬。
2. **`EditorPort` 加 `getDocumentSelection()`**（§2）。「整个文件」需要一个"整份文档的行区间 + 全文"，
   而 `getSelection()` 在只放光标时按设计返回 `null`。**复用 `EditorSelection` 而不是新开一个
   `getDocumentText()`**：`capture()` 的产出只认"一个行区间 + 一段原文"，两种范围在它眼里是同一件事；
   多一个形状就多一条分支，而这条分支的差别只在"谁来定这个区间"。
   实现**优先取内存里的文档**（同 `documentTextHash` 的理由：用户在编辑器里改了还没保存，
   要讲的是他眼前那一份）。
3. **`CodeAdapter.capture(scope?)` 带一个可选参数**（§3.1）。冻结的 `SourceAdapter.capture()`
   是零参的 —— 可选参数在 TS 里仍可赋值给零参签名（有单测
   `capture 的形状仍满足 §3 的 SourceAdapter` 钉住），所以**接口本身没有变**。
   这样"范围从哪来"（由确认 UI 拍板）不必污染契约，也不必让适配器去读 UI。
4. **确认 UI 四条分支**（§4.1.1）：无编辑器 → 提示去打开；只有光标 → 提示未选中 + 一个
   「讲解整个文件」按钮；有选区 → QuickPick「讲解这段 / 整个文件」；取消 → 什么都不做。
   **不替用户决定"只放光标就讲整份"**：整份往往几百行，命中率低得多，与其猜不如摆出来让他拍板。
   **两种"没得讲"分开提示**，因为要用户做的事不同（一个去打开、一个去选）——
   一句笼统的"请先选中内容"会让人在没有编辑器时反复去选。
5. **`showState` 增报「上次捕获：<文件> 第 a-b 行（选区 / 整个文件）」**。真选区接上之后，
   "我刚才那一按到底讲了哪一段"**在屏幕上再也看不出来**（高亮画在哪由讲解内容决定，
   不由选区决定）。这条纯粹是为了让用户能自己复核，也是 `smoke:chain` 第 9 节能验真选区的唯一观测点。

**顺带落地**：`CodeAdapter` 从 `commands.ts` 的 `buildAnchor()` 搬进 `adapters/CodeAdapter.ts`。
搬家的实际收益不是洁癖，而是**它第一次变得可断言** —— `adapters/` 零 vscode 依赖（D19），
于是"选区 → Anchor"这件事现在有 7 条 `node --test` 覆盖，不必按 F5。
`sourceName` 从 `vscode.workspace.asRelativePath(...)` 改成 `paths.ts` 新增的 `basenameOf()`
（§3.1 记的形状就是 `'main.c'`；且 `node:path.basename` 按平台变行为，Linux 上切不动 `C:\` 开头的路径）。

**为什么 `detect()` / `fetchContext()` 没一起落**：它们的调用方（适配器注册表、§3.2 取件校验）
S3 才存在，现在写出来就是没有消费者的死码。这是**分期兑现**冻结接口，不是接口变更；
`SLICES.md` 的 S3 范围里本就列着 `CodeAdapter` 的 `fetchContext`。

**验证**：`pnpm check` 全绿 —— 100 测（core 28 + ext 72，本轮 +7）→ `pnpm smoke` 23 项
（+4，其中两条是"假选区已从产物退出"）→ `pnpm smoke:chain` 82 项（+15，第 9 节专门验真选区：
把桩的选区改成一个替身绝不会给的值 `第 10-14 行`，再看锚点跟不跟着走 ——
**替身给不出这个值，所以这一节不可能被替身蒙过**）。

**状态**：生效。

---

## D52 S3：接真 AI —— 编排循环、取件闸门、配置与 SecretStorage

**决策**：八件事。前四件是必须做的，后四件是做的过程中被迫拍板的。

1. **`fakeProvider` 从正式链路彻底退出**。`commands.ts` 里那行
   `const provider: ExplainProvider = fakeProvider;` 换成**现读配置、现建编排器**。
   至此产物里两个替身都没有了 —— `smoke-extension.mjs` 用"替身独有的字面量不见了"来断言这件事，
   比"这次没走到那条分支"硬。
2. **配置现读现建，不在激活时建一次留着用**。用户改完设置应该立刻生效，
   而不是"改设置 → 重载窗口 → 再试"。`ExplainProvider` 就是"一个函数"，
   重建的成本只有两次对象字面量。没有可用配置时**明确报错并说清该改哪个设置键**，
   不静默退化成"什么都不发生"（后者让人以为扩展坏了）。
3. **配置拆成"读"与"算"两个文件**：`config.ts` 是纯映射（`node --test` 全量覆盖），
   `vscode/configSource.ts` 才是 `import 'vscode'` 的那一侧。
   理由与 ports 层同源：往纯映射里塞一行 `import * as vscode`，
   "字段缺失怎么办"那几条分支就永远只有肉眼覆盖。
4. **新增 `Anchor: 设置 API Key` 命令**。§6 规定 apiKey 优先从 `SecretStorage` 读，
   但如果没有一条**写入**的路，用户就只能把它填进 settings.json 的明文里 ——
   那份文件会被同步、被截图、被提交。所以这条命令不是"顺手加的便利"，
   而是"默认走安全路径"的必要条件。
5. **§8 的工具 schema 里没有 `path`，而 §3.2 规则 3 要检查 `params.path`。**
   两边是我在 S3 接起来时才发现的：解析侧原来只挑 `start`/`end`，把 `path` 丢了，
   于是**每一个 `file` 取件请求都被判成"只允许取锚点所在的文件"**（全部被拒，取件功能形同不存在）。
   处置：解析侧把**自定义键原样带过去**；校验侧把"没给 `path`"当成"就要锚点这个文件"并放行，
   放行时把路径补进返回的请求里，好让适配器拿到的 `params` 一定是完整的。
   **不给 §8 的 schema 加 `path`**：它是冻结原文，且模型本来也没有别的文件可选。
6. **去重（规则 4）排在频率（规则 5）前面**。两条同时命中时按去重处理 ——
   把已取内容再回灌一次比回一句"已达上限"对模型有用得多，且**不花任何额外成本**
   （不发起新的读取）。§3.2 的编号顺序是"规则"，不是"执行顺序"。
7. **输出校验有两道闸门**（编排层一道、命令层一道）。不是不信任编排层，
   而是"渲染层只消费校验过的数据"这条规矩不该有例外 ——
   编排层将来多一条产出路径（比如缓存命中），命令层那道仍然拦得住。
   代价是同一份数据被校验两遍（纯函数，微秒级）。
8. **取件日志落到 OutputChannel「Anchor」**，而不是等侧边栏的 `ToolTrace` 面板（它不在任何切片范围内）。
   排查"模型为什么讲歪了"时这是唯一能看的东西，所以它落在用户能打开的地方，
   而不是只在内存环形缓冲里。§7 的 `sink` 就是为这种落点准备的。

**顺带落地**：`prompts/` 合成**一个**模块（`prompts/index.ts`）而不是 SLICES 里写的三个文件。
理由：输出契约那一段必须在 system 与 repair 两处**逐字一致**，
拆成两个文件就迟早会出现"repair 里少写了一条规则"。声明在 `SLICES.md`。

**验证**：`pnpm check` 全绿 —— 141 测（core 28 + ext 113，本轮 +41）→ `pnpm smoke` 30 项
→ `pnpm smoke:chain` 105 项。链路的 S3 一节跑的是真编排循环，只有 `fetch` 是桩，
所以"取件轮数 / 拒绝回灌 / repair 一次 / 上限收场 / 没配 provider / 连不上端点"
六条路径都在冒烟里真的走过一遍。

**状态**：生效。

---

## D53 S4：fork `mathematic-inc/vscode-pdf`（改什么、删什么、为什么）

**fork 基线**：`1153346694f457bc7b4c73c9b0e95b629f02dc03`（2026-09-05，上游 `0.2.5`）。
**只 `git clone --depth 1` 下来看，没有跑上游任何 `setup` / `prepare` 脚本**（用户明确要求）。
逐条改动清单在本包 `MODIFICATIONS.md`（那也是 Apache-2.0 §4(b) 的义务），这里只记**判断**。

1. **`customEditors` 加 `"priority": "option"` —— 这就是"不劫持"的全部内容。**
   不写它，我们的视图会与用户的默认 PDF 打开方式抢；写了它，我们只是候选项之一。
   **代价是"用户根本进不来"**，所以必须同时给一个命令：`anchorPdf.openInAnchorViewer`
   （走 `vscode.openWith`，与用户从"打开方式"里选我们**同一条路**，不会出现两套行为）。
   这两个决定是一件事的两半，只做一个都是错的。
2. **删掉上游的"赞助提示"弹窗。** 上游每次安装后第一次激活都会弹一次，把用户引向它的捐赠页。
   删的理由两条，都不是审美：它是上游**品牌推广**（我们来承担署名与许可，但不承接推广）；
   而且它**替用户做了主** —— 这是个 PDF 阅读器，不该在用户第一次打开 PDF 时弹募捐入口。
3. **改三处命名**：`viewType` `pdf.view` → `anchorPdf.view`；配置命名空间 `pdf` → `anchorPdf`；
   包身份 `publisher: mathematic` / `displayName: PDF Viewer` → `anchor` / `Anchor PDF 视图`。
   前两处是**技术必要**（同一个 `viewType` 谁先激活谁生效，那是劫持的另一种写法；
   同一个配置命名空间会让两个扩展抢同一份设置），第三处是**商标要求**。
   顺带删掉 `author` / `repository` / `icon`：**署名在 `LICENSE` 与 fork 基线里，不在这些字段里**。
4. **`engines.vscode` 从上游的 `^1.134.0` 降到 `^1.90.0`。** 上游用的是更新的类型面，
   但**实际用到的 API 都是 1.90 就有的**（`registerCustomEditorProvider` / `asWebviewUri` /
   `openWith`）。与线1 保持一致，省掉两份 `@types/vscode`。
5. **许可分层是刻意的**：仓库根是 MIT，本包是 **Apache-2.0**（fork 的部分受上游许可约束）。
   上游**没有 `NOTICE` 文件**，所以没有需要一并保留的 NOTICE ——
   §4(d) 的前提是"原作品包含 NOTICE"，这一条写进了 `MODIFICATIONS.md` §三，将来上游补上时要跟着加。
6. **`tools/check_pdfjs.mjs`（上游自己的不变式守卫）原样保留，并接成了本包的 `test` 脚本。**
   它检查的是"pdf.js 被正确打补丁"：`viewer.html` 里不能有 CSP、我们注入的那份必须恰好出现一次、
   必须带 `'wasm-unsafe-eval'` / `base-uri 'none'` / `form-action 'none'`。
   **这些不变式坏掉的表现是"PDF 打不开"或"安全策略被绕过"**，两者都不该等用户发现。
   代价是 `pnpm test` 会多跑一个脚本，收益是将来升级 pdf.js 时有一条硬判据。
7. **`tsconfig.json` 用 `moduleResolution: "Bundler"`**，与其它包的 `NodeNext` 不同。
   上游源码的相对导入不带扩展名，改成 `NodeNext` 要逐文件加 `.ts` ——
   那是把一次 fork 变成一次重写，而 fork 的全部价值就在于"改动可以逐条列出来"。
   例外写在 fork 的 tsconfig `$comment` 里，也记在 `CONTRACTS` §9.4。
8. **删掉上游的工程设施**（`.github/`、`tsup.config.ts`、`pnpm-workspace.yaml`、oxlint/oxfmt、
   `hk.pkl`、`mise.toml`、release-please…）。理由两条：
   一个仓库一套工具链；以及 **`hk.pkl` 会让 `pnpm install` 触发上游的 `prepare` 脚本** ——
   我们明确不跑上游的 setup。逐条列在 `MODIFICATIONS.md`。
9. **新增本包的 `.gitattributes`**（`*.bcmap` / `*.pfb` / `*.wasm` / `*.ttf` 标 `binary`）。
   根 `.gitattributes` 的 `* text=auto eol=lf` 靠内容探测通常会放过这些二进制，
   但"通常会"不够：**这 23MB 里有 168 个 `.bcmap`、10 个 `.pfb`、4 个 `.wasm`，
   它们的字节偏移是被算出来的**，被换行转换动一个字节就会在某类 PDF 上炸。

**验证**：`pnpm check` 全绿（新增 `smoke:pdf`）—— 141 测 + `pnpm smoke` 30 项 +
`pnpm smoke:chain` 105 项 + **`pnpm smoke:pdf` 35 项**。
线2 的冒烟不只查结构，还真的调了一次命令，断言它打到 `vscode.openWith` 且用的是 `anchorPdf.view`；
以及断言 `.vscodeignore` **没有**排除 `assets/`（排掉的话视图打开是一片空白，而这条在打包前发现不了）。

**状态**：生效。

---

## D54 S5：框选 —— 注入而不是打补丁，业务数学不留在注入脚本里

**决策**：六件事。

1. **注入式 overlay，`assets/pdf.js/` 一个字节都不动。**
   注入点是 `getHtmlForWebview` 末尾追加一个 `<script src="media/anchor-select.js">`。
   代价是**要动上游文件**（`pdf-viewer-provider.ts`，已在 `MODIFICATIONS.md` 记一条）；
   换来的是**将来升级 pdf.js 时这条注入不用重做** —— 反过来，如果往 pdf.js 的 `viewer.mjs`
   里塞代码，每次升级都要重新打一遍补丁，而那个补丁是我们最不想自己维护的东西。
2. **注入脚本一行业务数学都不做。** 它只做"跟手的事"：画橡皮筋、报像素矩形、报"哪些页在哪"。
   "落在第几页、占那一页的百分之几"全部压在 `src/anchor/rectToNormalizedBBox.ts` 里（11 条单测）。
   理由：注入脚本是**字符串常量、不参与类型检查、也没法被单测**，
   而换算里唯一有对错的东西（页容器有 padding、有缩放、有滚动偏移）肉眼判不出算错两三个像素。
3. **`anchor:captured` 追加一个可选字段 `geometry`**（原始像素几何），§5.2 的冻结字段一个没动。
   宿主**优先用 geometry 重算**，页号与 bbox 都以重算结果为准；只给 `page`+`bbox` 的"老式"脚本
   仍然能用（退回 `coerceBBox` 校验）。这样"谁来定案"这件事不依赖注入脚本的正确性。
   冒烟里专门有一条断言：脚本给一个**错的** bbox，宿主交出去的仍是重算出来的那个。
4. **握手（`anchor:ready`）是必需的，不是装饰。** 用户点「框选」时页面可能还在加载，
   那时推 `enterSelectMode` 会石沉大海。宿主记着"哪些面板还没准备好"，等它 ready 了补发。
   没有这道握手，表现是**"第一次点框选没反应，再点一次才行"** —— 这种 bug 不会被自动测抓到，
   只会被用户抱怨"时灵时不灵"。冒烟两条断言分别钉住"未握手不推"与"握手后补推"。
5. **"PDF 上不出现任何高亮框"从自觉升级为结构性保证**：冒烟直接查产物里
   **有没有 `TextEditorDecorationType` 这个 API** —— 没有，就是没有可画的东西。
   橡皮筋只在按住指针期间存在，抬手/取消/退出/窗口失焦四条出口都走同一个 `clearBand()`。
6. **`normPath` / `samePath` / `basenameOf` / `countTextLines` 从线1 的 `paths.ts` 搬进 `@anchor/core`。**
   线2 现在也要比较 `fsPath`（跨扩展定位时匹配文档）与取显示名。与其复制一份，
   不如让两条线共用同一个立场。线1 的 `paths.ts` 保留为**转发**，不动的导入路径一行没改。

**一处刻意的"不统一"**：`anchorPdf.revealPage` 同时是跨扩展入口与命令面板项。
命令面板调用时没有参数，所以它会**问一句页号**而不是默默什么都不做 ——
一个点了没反应的面板项比没有这一项更糟。冒烟里"声明 == 注册"这条规则因此没有例外。

**验证**：`pnpm check` 全绿 —— 152 测（core 28 + ext 113 + pdf 11）→ `pnpm smoke` 30 项
→ `pnpm smoke:chain` 105 项 → **`pnpm smoke:pdf` 66 项**（S4 时 35 项）。
线2 的冒烟现在真的开了一个面板、灌了一条 `anchor:captured` 进去，
所以验的是"框选结果能不能变成锚点并交出去"，而不只是"代码里有没有这些字符串"。

**状态**：生效。

---

## D55 S6：PDF 锚点走线1 —— 两条线的定位方式必须是两套

**决策**：四件事。

1. **`revealStep` 按位置类型分岔**（`commands.ts`）：`primaryLocationOf(step)` 有值（只可能是
   `CodeLocation`）→ 播放器高亮 + 滚；否则 `isPDFLocation` → `anchorPdf.revealPage`（**只滚，不画**）。
   这是约束 1 在代码里的落点：**PDF 那句话根本不经过播放器**。
   两头都不画（另一头是 `decorationPlan` 过滤非 `CodeLocation`），所以"PDF 上不出现任何高亮框"
   是结构性的，不是靠调用方自觉。
2. **§5.1 只传 `page`，不传文件**：`PDFLocation` 里没有路径字段。线2 的处置是落到
   **当前聚焦的面板**上（`lastFocusedPanel`），而不是"所有打开的 PDF"——
   后者在同时开两份 PDF 时会一起滚，那不是用户按下那一条时想看到的事。
3. **侧边栏的位置标签提示词也跟着位置类型变**：对 PDF 说"在编辑器里定位到这一段"是句假话，
   用户会以为是它坏了。现在 PDF 那一条写"把 PDF 滚到这一页"。
   （webview 里 import 不到 core，所以客户端脚本里那 4 行 `isPdfLoc` 是一份**副本** ——
   与 `locText` 的副本同一个已知代价，见 STATE 约束 19。）
4. **`pageCount` 仍然传不进去，这是刻意留的缺口**：线1 不知道 PDF 有多少页，而 §5.1 是
   "单向、不依赖返回值"，没有一条干净的通道把页数递给线1。后果是 §3.3 里
   `1 ≤ page ≤ pageCount` 这条上界被跳过（`pageCount: null` → 跳过该项检查）。
   用户可见的后果有限：AI 报一个越界的页号，线2 那边 `pdfViewer.currentPageNumber` 会被 pdf.js 自己夹住。
   **要真正补上它得改契约**（给 `Anchor` 加字段，或让 §5.1 破例带返回值）—— 两件都不该顺手做，
   记在已知缺口里等用户发话。

**验证**：`pnpm check` 全绿 —— 154 测（core 28 + ext 115 + pdf 11）→ `pnpm smoke` 30 项
→ `pnpm smoke:chain` **115 项**（S5 时 105）→ `pnpm smoke:pdf` 66 项。
链路冒烟的第 11 节把**线2 交出来的那种锚点**灌进线1 的跨扩展入口，验三件事：
PDF 锚点也能出讲解、**编辑器里一个框都不画**、点位置标签走的是 `anchorPdf.revealPage`
（并且没装线2 时明确提示、代码锚点**不**去调线2）。

**状态**：生效。

---

## D56 S7：PDF 取件 —— 先补上一个缺不了的字段，再谈取文字

**决策**：七件事。第 1 件不是 S7 的计划内容，而是开工时撞上的前提。

1. **给 `PDFLocation` 加可选字段 `filePath`**（`CONTRACTS` §1 的加法扩展）。
   **不加就做不了**：`page` + `bbox` 只说得清"页面上的哪一块"，说不清"**哪一份**文档"，
   而线1 要按路径去读文件取件、判页数也得打开它 —— 它手里的 `Anchor` 只有
   `sourceId`（内容指纹）与 `sourceName`（basename），**都定位不到文件**。
   `CodeLocation` 从一开始就有 `filePath`，这条对称本来就不该缺。
   选**可选**而不是必填：S5/S6 造出来的锚点没有它，所以读它的地方都要能退化。
   **顺带的收获**：这个字段一加，`tsc` 立刻指出一处把 `'filePath' in loc`
   当作"是不是代码位置"的旧写法不再成立 —— 那个判断从此只有 `isCodeLocation` 说了算
   （仓库里只有一处这么写，已改）。
2. **取件用 npm 的 `pdfjs-dist/legacy`，不复用线2 那份 vendored `assets/pdf.js/`**。
   那份是**打过补丁的浏览器构建**（补丁只为拆掉 pdf.js 自带的 CSP），对"读文字"没有任何增益，
   却把两个包的升级节奏绑在一起。分开的代价是两边的 pdf.js 版本可能不同 ——
   对文字层没有影响（格式多年未变），页序与页数更不会因版本而异。
3. **取件在**线1**做，不在线2**：编排循环在线1，而线2 是个阅读器、不参与讲解流程。
   `PDFAdapter` 因此住在 `extension-anchor/src/adapters/`。
4. **有界 LRU 缓存，淘汰时必须 `dispose()`**。一次讲解里同一份 PDF 会被取件两三轮，
   而打开一份 30 页 PDF 要读盘 + 解析交叉引用表。上限 4 份：不设上限是内存泄漏，
   上限太小等于没缓存。**淘汰不释放句柄是这类缓存最经典的漏**，单测专门钉了这条。
5. **`bbox → 文本`的命中判据是"交叠面积占文字块自身的比例"（阈值 50%），不是"框的面积"**。
   框可大可小；按框算的话，用户框一大段会把轻轻擦到的邻行也吸进来 ——
   那正是"命中到隔壁段落"这类错误的来源。
6. **PDF 锚点在进模型之前先补 `extractedText`**（`withPdfText`）。`bbox` 是**地址**，
   那一块里的文字才是模型第一批该看到的东西（`Anchor.extractedText` 的注释就是"第一层优先"）。
   不补的话模型只知道"第 23 页的一小块"，还得先请求取件才看得到内容 —— 白花一轮，
   而且它对"该取哪一页"也只能猜。**失败一律静默忽略**（扫描件没有文字层是正常情况）。
7. **S6 那个 `pageCount` 缺口在这里关掉**：线1 现在能无头打开 PDF，页数顺手就有，
   于是 `ctx.pageCount` 不再是 null，§3.3 的 `1 ≤ page ≤ pageCount` 那条上界开始真的生效。
   没有 `filePath` 的老锚点仍然只能跳过（这就是选"可选"字段的代价，明写在代码里）。

**顺手做掉的一件合规事**：打包 `pdfjs-dist`（**Apache-2.0**，比本包的 MIT 更严）会**丢掉它的署名** ——
esbuild 默认只保留 `/*!` 开头的注释，而 pdf.js 的构建产物里没有这种注释。
所以 `pdfjsSource.ts` 顶部显式写了一条 `/*! ... */`（说明打包了什么、许可是什么、全文在哪），
并新增 `packages/extension-anchor/THIRD_PARTY_NOTICES.md`。
`smoke` 有一条断言守着"署名还在产物里"——**打包了别人的代码却不带署名**是这类问题里
最难在事后发现的一种。代价是线1 的产物从 468KB 涨到 **4.36MB**（pdf.js 本身就是这么大；
替代方案是不打包、改为随 `.vsix` 带 `node_modules`，但 `pdfjs-dist` 是 ESM-only、
CommonJS 产物里没法 `require` 外部加载，所以打包是实际可行的选择）。

**关于 `detect()`：从"延期两次"改成"明确不做"。** 它问的是"当前环境适不适用"，
而用户同时开着代码编辑器和 PDF 是常态 —— 那个问题没有唯一答案。
"该用哪个适配器"由**锚点自己的 `sourceType`** 决定（`commands.ts` 的 `adapterFor`），那是确定的依据。
真正读适配器的地方只有两处，两处都不需要问环境。写一个没人调用、答案还有歧义的 `detect()`
是对契约的不诚实。§3.1 表里那一列判据**降级为文档**（说明这两个适配器"什么时候适用"），
不再是待实现的方法 —— 这一条写在 `CONTRACTS` §3.1 上方那张表里。

**验证**：`pnpm check` 全绿 —— **173 测**（core 28 + ext 133 + pdf 12，本轮 +19）
→ `pnpm smoke` 33 项 → `pnpm smoke:chain` 115 项 → `pnpm smoke:pdf` 66 项。
S7 的测试分两层：**逻辑层**喂手搓的 `PDFSource`（页码区间、页头、越界、空白页、
缓存淘汰与并发去重、bbox 命中比例），**真解析层一条**真读 30 页 fixture ——
`transform` 的 y 轴方向、点单位、viewport 尺寸只有真数据说了算。
那一条还抓出一个真 bug：pdfjs v6 里 `destroy()` 在 loading task 上、不在 document 上，
打在 document 上会 `is not a function`，而它只在"缓存淘汰/停用"时触发 ——
表现是"用久了内存涨"，不是"一用就崩"。

**状态**：生效。

---

## D57 S8：固定按钮 + 开始界面 —— 入口有三个，实现只有一处

**起因**：用户要一个"固定按钮，点一下呼出一个界面"，并且明说"先做一个开始界面，
把交互逻辑放在里面，**快捷键还是要的**"。这句话同时定了三件事：入口要显眼、内容要成体系、
原来的键位一个都不能丢。

**决策**：十一件事。

1. **固定按钮 = 活动栏容器 + 一个 webview 视图**（`viewsContainers.activitybar` 的 `anchor`
   + `views.anchor[0] = { type: "webview", id: "anchorExplain.start" }`），不是状态栏按钮、
   也不是又一个编辑器面板。理由：活动栏图标是**一直挂在那儿**的那个东西（"固定"的直译）；
   webview 视图贴边显示、跟着主题走、不占编辑区，且它的生命周期由用户决定 ——
   而"用户从不点它"正是这一片最需要正视的状态（见第 4 条）。
   图标是 `assets/anchor.svg`（24×24，单色）。**路径写错时 VS Code 只是不显示，不报错**，
   所以 `smoke` 去查文件在不在、是不是 24×24。
2. **三处入口通向同一批命令**：活动栏视图、`anchorExplain.showStart`（`ctrl+alt+a`）、
   欢迎页的「演练」卡片。**没有一处自己实现东西** —— 面板上的每个按钮最终都是
   `executeCommand(<§4.1 里已声明的命令>)`。这是"把逻辑组织起来而不是糊在一起"的落点：
   面板里**没有可糊的地方**，因为它的内容模型（`start/startModel.ts`）是纯函数，
   UI（`start/ui/startClientScript.ts`）只渲染与派发。
3. **`start:run` 只回传动作 id，不回传命令 ID**（`CONTRACTS` §5.5）。webview 是不可信输入；
   若它能指定"执行哪个命令"，它就能执行任意命令。宿主用 `findStartAction(id)` 查表，查不到就丢。
   配套的约定是：`parseStartMessage` **只查形状、不查成员资格** —— 守卫管"能不能读"，
   业务管"能不能做"。若有人把成员资格塞进守卫，宿主那侧的查表就变成永远为真的死代码
   （单测里有一条专门钉这件事）。
4. **面板推的是快照，不是事件流；视图没被打开过就是空操作**。侧边栏（`SidebarPanel`）有重放缓冲，
   因为它的 DOM 由宿主建、消息比 DOM 早；开始面板是**用户建**的，可能整个会话都没被点开过，
   而它显示的是"现在是什么情况"—— 后一份天然覆盖前一份。给这儿也加重放缓冲只会多一份没人读的缓冲。
5. **灰掉是提示，执行前再判一次**（两层，不是重复）。第一层在模型里（让用户不必点下去才知道缺什么，
   并且**说清缺的是哪一件事**）；第二层在 `runStartAction` 里（面板看到的状态可能已经过去了）。
   第二层只判两件命令自己**没法**判的事：`peer`（线2 没装时那条命令根本不存在，`executeCommand`
   会抛"命令未找到"，用户看到的是 VS Code 的报错框而不是"你没装线2"）与 `session`（`goto` 在没有会话时
   是**静默返回**的，违反"不静默失败"）。**`provider` 不需要第二层**：`Anchor: 设置 API Key` 自己会讲清缺什么。
6. **键位表分成两张**（`WALKTHROUGH_CHORDS` 线1 / `LINE2_CHORDS` 线2，后者镜像线2 的 `package.json`）。
   面板上「框选 PDF 区域」显示的是线2 的键（`ctrl+alt+s`，且只在 `activeCustomEditorId == 'anchorPdf.view'`
   时生效）。显示一个写死的默认键，就是**替用户断言一件我们并不知道的事**（D10 的立场对线2 同样成立）。
   两张表各有各的镜像锁：合成一张会让"哪一行对不上"变成需要二次判断的问题。
7. **`STATE_WORD` 从 `statusBar.ts` 上移到 `protocol.ts`**（贴着 `WalkthroughState` 放）。
   状态栏与开始面板要说同一句"已暂停 / 播放中"，两处各写一张表早晚分家。
   上移后有一条锁遍历六个状态断言都有词 —— 加状态时漏词会红，而不是在 UI 上少一个词。
8. **`captureSummary` 抽到 `describe.ts`**。`Anchor: 显示状态` 里原本内联着"上次捕获：X 第 a-b 行（选区）"，
   面板也要说这句。抽出后**这句话只有一处格式化**，两个消费者。顺带修掉一处不对称：
   原来只有代码锚点会报"上次捕获"，PDF 锚点被 `isCodeLocation` 挡掉了，而 `locationLabel` 本来就会说"第 N 页"。
9. **`peer()` 收敛成一个问法**。`revealStep` / `showState` / `runStartAction` 三处都在问"线2 装没装"，
   原来各写一遍 `vscode.extensions.getExtension(...)` —— 第一次改扩展 ID 时就会漏掉一处。
10. **顺手做一张「演练」卡片**（`contributes.walkthroughs`，四步，正文在 `media/walkthrough/*.md`）。
    它就是"欢迎页上的开始界面"：VS Code 自己的「开始使用 VS Code」也是这么一个东西。
    步骤里的按钮用 markdown 的 `command:` 链接，进度用 `completionEvents: ["onCommand:..."]` 跟真实命令绑定。
    **风险如实记着**：`command:` 链接的形状是文档约定（不是类型系统能保证的），若某一版不生效，
    表现是"点了那行字没反应" —— 不影响另外两个入口，也不影响命令本身。
    `smoke` 只能查到"每一步的 markdown 文件都在"这一层。
11. **不给这一片加任何替身**。面板的宿主侧（握手、推模型、id 转命令、两条守卫）在 `pnpm smoke` 里
    **真跑一遍**（拿 provider 自己造一个假视图驱动它）；客户端脚本的 DOM 行为仍只能靠 F5，
    但至少"字符串常量被反引号/`${` 破坏导致白屏"这一类问题变成了断言（`test/startUi.test.ts`）。

**刷新时机（容易被忽略但会变成"面板说的是旧话"）**：`emit`（会话每拍）、`stop`、
捕获后（`lastCapture`）、`onDidChangeConfiguration('anchorExplain')`、`extensions.onDidChange`。
其中**只有会话维度需要去重**：游标是"拍"不是"步"（D48），一个 5 步的讲解会走十几二十拍，
而推一次面板要重读设置与 SecretStorage（后者是异步 IPC）——不去重会为了一个没变过的
「第 2/5 步」反复问 20 次密钥存储。

**明确不做**：不做 `ToolTrace` 面板（那是 §7 的事，取件日志仍在 OutputChannel）、
不做"面板里显示讲解步骤"（那是侧边栏的活）、不给开始面板做排版预览（已知缺口 12）。

**验证**：`pnpm check` 全绿 —— **201 测**（core 28 + ext 161 + pdf 12，本轮 +28）
→ `pnpm smoke` **58** 项（+25）→ `pnpm smoke:chain` 115 项 → `pnpm smoke:pdf` 67 项。
本轮新增的两条耦合锁值得点名：动作表里的每条命令都必须**在它所属扩展的** `contributes.commands` 里
声明过（查错文件本身就是我们要拦的错），以及演练四步的 markdown 必须都在磁盘上。

**状态**：生效。

---

## D58 F5 起宿主的就绪信号必须**聚合**（S8 修）

**症状**：用户按 F5「没反应」，或宿主窗口起来了但**活动栏里没有那个图标、命令也搜不到**。
**这不是用户操作问题，是构建脚本的隐患。** 两处，都出在 `esbuild.mjs` 的 watch 标记上：

1. **就绪信号早于线1 产物写完**。标记原本是**每个 target 各报一次**
   （`[anchor] build finished: extension-anchor-pdf`）。VS Code 的 `background` 匹配器
   一看到 endsPattern 就认为任务就绪、**随即启动调试宿主**。而两个目标里线2 先好（307KB），
   线1 的 4.2MB 还在写 —— 于是宿主可能读到**没写完或过期的** `dist/extension.cjs`，
   表现是"宿主窗口起来了，但活动栏里没有那个图标、命令也搜不到"。
   S7 把线1 产物从 468KB 涨到 4.36MB 之后，这个窗口从"理论存在"变成"真的会撞上"。
   修法：标记聚合成**一批** —— 第一个目标开始时报 `[anchor] build started`，
   **全部**结束后才报 `[anchor] build finished`。
2. **构建出错时可能永远等不到就绪信号**。若 endsPattern 不再出现，VS Code 会一直等 ——
   症状是「按 F5 完全没反应」（连报错框都没有，因为任务被当成"还在跑"）。
   修法：**出错也报 finished**，把错误数写进同一条日志（`[anchor] build finished（2 个错误）`），
   终端上照样看得见，但不让就绪信号消失。

**顺带**：`.vscode/launch.json` 从一条配置变两条。第二条
「扩展开发宿主（改完先构建一次，不监视）」的 `preLaunchTask` 是普通任务 `anchor: build`，
**不依赖后台任务的就绪信号**。F5 那条路万一还有问题（键位被别的扩展抢了、有残留的调试会话、
后台任务匹配器认不出来），这条配置能把"是配置的问题"和"是键位/环境的问题"分开 ——
诊断时先走它。

**为什么写进 DECISIONS 而不是悄悄改掉**：这两个症状都长得像"用户按错了"，
而下一次遇到的人（可能是我）会先怀疑键位、焦点、扩展没装，最后才怀疑构建脚本。
把"就绪信号是谁在什么时候报的"记在这里，能省掉那一圈。

**状态**：生效。

---

## D59 起宿主必须用**绝对路径**（CLI 不把你的 CWD 传过去）

**症状**：新窗口**起来了、也很稳定**，但**没有活动栏图标、命令面板搜不到 `Anchor:`**，
而且**不弹任何错**。看起来像"扩展没做出来"，实际是**它根本没被载入**。

**根因**：`code --extensionDevelopmentPath=packages/extension-anchor test/fixtures`（相对路径）。
`code` CLI 只是把参数**转交给已经在跑的那个 VS Code 实例**（IPC），而**它不传 CWD** ——
相对路径在对面按对方的工作目录解析。VS Code 的 `renderer.log` 里留下的就是这一行：

```
Error scanning extensions at /packages/extension-anchor: 无法解析不存在的文件 '\packages\extension-anchor'
```

这条已经真实发生过（15:16 起每次手敲都是这个结果），而排查它花了整整一轮来回：
用户看到的是"窗口弹出来了"，我看到的是"应该没问题"——**两边都没错，错的是那条命令**。

**修法**（都是"让失败无处藏身"这一条思路）：

1. 新增 `scripts/devhost.mjs`：从 `import.meta.url` 算出**绝对路径**，把要执行的命令**打印出来**，
   并且在起之前**先查**扩展目录、产物、样本目录在不在（缺了就直接报错退出）。
   `pnpm devhost`（线1）/ `pnpm devhost:pdf`（线2）都走它。
2. 文档里**所有**手敲相对路径的地方一并改掉（根 README、两个包 README、STATE、SLICES 里
   S4/S5 的验收步骤 —— 那两片用户还没实操，不改就等于埋着同一个坑）。

**为什么记这么细**：这是本项目里**最贵的一类失败** —— 没有错误、没有提示，
症状（"起来了但没有图标"）与原因（"路径没解析对"）之间隔着一个 VS Code 的日志文件。
下次再遇到，先去看 `%APPDATA%\Code\logs\<最新时间戳>\window*\renderer.log`，
搜 `Error scanning extensions`，而不是怀疑自己的代码。
（F5 那条路用的是 `${workspaceFolder}` 展开出的绝对路径，本来没有这个问题 —— D58 修的是另一件事。）

**状态**：生效。

---

## D60 让它"常驻"：用目录联接装进 VS Code，而不是每次起开发宿主

**用户的原话**："这个稳固吗？应该像别的插件一样不用什么操作，常驻才对。"

**先把"稳固"拆成两半答**（分开答才不会互相掩盖）：

- **面板这一层是稳的**：它只依赖"已声明的命令 + 一个纯函数模型"，有 201 条测试与五条耦合锁守着
  （动作表里的命令必须在所属扩展里声明过、键位表与两份 package.json 逐字一致……）。
- **不稳的是"怎么进到它"**：开发宿主每次都要手动起一个窗口（`pnpm devhost` 或 F5），
  而且今天在这条路上连踩两个坑（D58 的就绪信号、D59 的相对路径）。
  **那不是产品的稳定性问题，是开发态的问题** —— 开发态本来就该是"我知道我在起一个临时环境"。

**要"常驻"，只有两条路**：

| 做法 | 代价 | 何时用 |
|---|---|---|
| **目录联接**（本片采用）：`pnpm link:ext` 在 `~/.vscode/extensions/` 下建一个指向仓库的联接 | 仓库不能挪走；改完代码要 `pnpm build` + 重载窗口 | 自己用（要的就是"每次打开都在，改一行就能生效"） |
| 打 `.vsix` 再 `--install-extension` | 要装 `@vscode/vsce`（联网）；每改一次要重打重装 | 要发给别人 / 要在没有仓库的机器上装 |

**为什么选联接**：零新依赖（只用 `node:fs`），而且**改一次代码的成本最低** ——
`.vsix` 每次都要重打重装，联接只要 `pnpm build`。Windows 上用 **junction 而不是 symlink**：
symlink 要管理员权限（或开发者模式），junction 不要。

**三条不许改回去的守卫**（都是"别把用户的东西弄坏"）：

1. **目标已存在且不是我们建的联接 → 拒绝 + 说清楚**，`--uninstall` 时也一样。
   绝不删不是自己建的东西（那可能是用户真装过的同名扩展）。
2. **删除只删联接本身**（`unlink`，不递归）：写错一个参数就删掉仓库源码的事不该有机会发生。
3. **目录名用 VS Code 的约定**（`<publisher>.<name>-<version>`，版本从各自 package.json 读）
   —— 不按约定命名时 VS Code 会把它当成"版本未知"。

**装完之后的行为**（这才是用户要的那件事）：活动栏那个图标**每次打开 VS Code 都在**，
不需要任何命令、不需要 F5、不需要开发宿主。**因为它现在是一个"已安装的扩展"。**

**状态**：生效。已在本机装好（`anchor.anchor-explain-0.0.0` / `anchor.anchor-pdf-0.0.0` 两个联接，
指向仓库里的两个扩展目录，经联接读到的清单与产物都验过）。

---

## D61 门厅不许是死路：灰按钮必须指出下一步按哪颗（S8 补）

**用户先看出来的是这个**：面板上「设置 API Key」是灰的，理由是"还没有配 `anchorExplain.providers`" ——
**而面板没有任何一条路能把用户带到那个设置上去**。说清了缺什么，却一步也走不动。

**这不是美观问题，是流程缺陷**，而且是我自己在 D57 里埋的：我给 `setApiKey` 加了
`requires: 'provider'`（理由是"命令自己也要求先配端点"），却忘了**门厅的义务不只是说明缺什么，
还要给一条去补齐的路**。命令层的判断没错，错的是面板把这条判断变成了单行道。

**改法三件**：

1. **新增 `anchorExplain.openSettings`**：打开设置并筛到 `anchorExplain`。
   它包住 VS Code 的内置命令 `workbench.action.openSettings`（参数写**在命令里**，
   因为 §5.5 的 `start:run` 只回传 id、说不出"带什么参数"）。
   包一层而不是让面板直接指向内置命令，是为了让"**动作表里的命令必须在所属扩展里声明过**"
   那条锁继续守得住 —— 内置命令没法声明。
2. **灰按钮的理由换成"下一步动作"**：`还没有配 anchorExplain.providers —— 先用上面那颗「打开设置」填 …`。
   一条锁断言这句话里必须出现「打开设置」（理由不能只描述症状）。
3. **顺带收掉用户可见文案里的错误码**：通知里原本是 `Anchor：PROVIDER_ERROR: 没有可用的 provider（…）`。
   `describeError` 给的是给**我们**排查用的（`码: 人话`），所以加了 `userFacing()`：
   `isAnchorError(err) ? err.message : describeError(err)` —— 通知只讲人话，
   判断成败仍然一律用码（状态机 / 校验 / 日志全部照旧）。

**顺带**：演练卡片第一步的正文加了 `[打开设置](command:anchorExplain.openSettings)` ——
那条"去配端点"的路现在在四个入口里都有。

**状态**：生效。验证：`pnpm check` 全绿 —— **202 测**（core 28 + ext 162 + pdf 12）
→ `pnpm smoke` **61** 项（+3：面板里「打开设置」可点、点它真的执行了那条命令、
那条命令落到内置设置命令且带筛选词）。

---



## D62 同一台阶卡两次就不再靠"讲清楚"：把配端点做成命令（S8 补）

**用户第二次卡在同一步**：他把整段 JSON 填进了 `anchorExplain.activeProvider`
（那是个**字符串**设置，该填 `"default"`），又在 `providers` 对象里多写了一层 `{` ——
整个 `settings.json` 语法坏了，VS Code 报"预期为文件结尾"。

**第一次**是 D61：面板让他去配 `anchorExplain.providers`，而面板上没有入口。
**两次都不是他不看文档，是这一步本身不该让人手写**：`providers` 是**嵌套对象**，
在设置界面里只能手写 JSON，而"对象里再套对象、还要放对键名"对任何人不算友好。

**决定**：新增 `anchorExplain.configure` —— 三个输入框（provider id、baseUrl、模型名），
带校验与预填，写进用户设置后立刻可用。面板上「配置模型端点」放在「设置 API Key」**前面**，
「打开设置」退到这一组最后，给"要改取件轮数/温度/多个 provider"的人。

**这件事允许写用户设置，边界在哪**（别处我们一律不碰用户的东西）：

| 允许 | 不允许 |
|---|---|
| 走官方 API 写**扩展自己的配置节**（等价于他在设置界面里手改） | 写文档（整仓有一条"产物里没有任何写入 API"的断言守着，那条不变） |
| 只写 `baseUrl` / `tier1Model`（+ 必要时 `activeProvider`） | **写 `apiKey`** —— 密钥只有 SecretStorage 一条路 |
| 合并时读 `inspect().globalValue` | 用 `get()` 把工作区级的值复制进用户设置（那是污染） |

**两条护栏**（都用单测钉住，因为这段代码要替用户改配置文件）：
`mergeProvider` **只动这一个 id**（别的 provider、同 id 下的别的字段一律原样保留）、
原值是垃圾时**从空对象开始**（用户已经写坏过一次，这时要的是"能救回来"，不是"永远配不上"）；
`checkBaseUrl` **只挡明确的错**（少协议头 → 症状是"连不上 xxx"；把 `/chat/completions`
一起写进来 → 症状是 404），其余一律放行 —— 端点长什么样是端点那边决定的。

**状态**：生效。验证：`pnpm check` 全绿 —— **208 测**（core 28 + ext 168 + pdf 12，本轮 +6）
→ `pnpm smoke` **63** 项（+2：面板里「配置模型端点」/「打开设置」都可点、点前者真的调到那条命令）。

---



## D63 写设置的命令必须**验读**，且"少一层"的 providers 要能救回来（S8 补）

**用户的原话**："这样填完不记忆，没用。" 三个输入框都填了、都按了回车，**什么都没发生**。

**两个原因，一个是我的锅，一个是他手写的坑，两个都要修**：

1. **`workspace.getConfiguration().update()` 会抛，而我没接住**。`settings.json` 有语法错误时
   VS Code 拒绝写入，`update` 返回 rejected promise；第一版 `configure` 直接 `await` 它，
   异常逃到命令边界 —— 用户看到的仍是"点了没反应"（连报错框都没有）。
   而且**写完没验读**：即使写失败，我也照样打印"已写入 xxx"。
   → 修法：`writeSettings()` 统一接住异常并**给一颗「打开 settings.json」的按钮**；
   写完**回读一遍**，读不回来就抛错（宁可明说失败，也不许打印成功文案）。
2. **他的 `providers` 少了一层**：写成 `{ baseUrl, tier1Model }` 而不是 `{ default: { … } }`。
   这种形状下 `resolveProvider` 永远返回 null —— 而**用户看着自己填的 baseUrl 明明就在文件里**。
   更糟的是 `configuredProviderIds()` 当时直接把 `Object.keys` 交出去，于是命令还在问他
   "已有的：**tier1Model**（直接回车就改当前在用的那个）" —— 把一个**字段名当成了 provider id**。
   → 修法：`looksFlattened()` 认出来（判据是"baseUrl/tier1Model 是不是字符串"，
   不能拿"有没有非对象的值"判 —— `extraHeaders` 本身就是对象）；命令**先问一句
   "要我整理成 `providers.default` 吗"**，点「整理好它」就搬过去（值一个不丢，
   已经写对的字段优先），点「我自己改」一行都不动；provider id 只认**值是对象**的键。
   另外**配完还要复读一次配置**：写进去了却依然读不到 provider 时不许报成功。

**顺带**：面板点任何命令失败也会**说出来**了（`runStartAction` 接了 try/catch）。
静默的命令失败与"点了没反应"在用户眼里是同一件事 —— 这个切片的主题就是"别让失败无声"。

**验证**：`pnpm check` 全绿 —— **210 测**（core 28 + ext 170 + pdf 12，本轮 +2）
→ `pnpm smoke` **73** 项（+10：三个输入框的答案真的写进 `providers.default`、`activeProvider`
被指过去、**永不写 apiKey**、配完面板当场变亮、"少一层"能被整理回来、「我自己改」一行不动）。
冒烟在这一轮**又抓到一个真的**：桩里少了 `ConfigurationTarget`，于是 `update` 抛 TypeError ——
而那正好又是一次"点了没反应"。

**状态**：生效。

---

## D64 讲解期间屏幕上必须有东西在动（S8 补）

**用户的两句反馈**："貌似是需要点击执行两次才能出现讲解界面" + "应该出一个进度，
AI 的操作在背后看不到会有焦虑感"。**这两句是同一个病。**

**根因**：侧边栏面板只在讲解**做完**之后才弹出来（`startSession` 才 `reveal()`），
而这之前要经历"准备锚点 → 读配置 → 请求模型 → 若干轮取件 → 校验（可能重试一次）"，
几秒到几十秒。这期间屏幕上**唯一**的变化是状态栏那一行 —— 而用户把状态栏关了
（`workbench.statusBar.visible: false`，我在他的 `settings.json` 里看到的那一行）。
于是"第一次点没反应"是真的；"第二次才行"不是第二次的功劳，是**第一次的请求那时刚好回来了**。

**修法（三处一起给，因为用户看的地方不止一处）**：

| 落点 | 为什么 |
|---|---|
| 状态栏（原有） | 有人看得到 |
| **通知进度**（`withProgress(Notification, cancellable)`） | 一定看得见，且能取消 —— 状态栏可以被关掉，通知不会 |
| **开始面板那一行** | 他就是在这块面板上点的按钮；"讲解：正在请求模型…"就在按钮旁边 |

**取件记录同时变成进度**（`loggerOf` 的 sink 兼喂 `onPhase`）：AI 的"背后操作"里最该被看见的
就是取件 —— 它在等磁盘、等解析，是最像"卡住了"的时刻。取件被拒也照样报（
"第 1 轮取件被拒（…）—— 让它基于现有信息作答"），因为**沉默的拒绝**同样让人焦虑。

**没有做的两件事，都是刻意的**：

1. **没有加任何"照症状猜"的补丁**（比如"延迟一拍再弹 QuickPick"）。症状有两种可能解释，
   而我只认了能自证的那一种（状态栏不可见 + 面板晚弹 = 屏幕上确实什么都没有）。
   如果加完进度**仍然要点两次**，那说明是另一种原因，届时需要的证据是
   "两次点击之间屏幕上出现了什么"，而不是再猜一次。
2. **没有做"边跑边流式显示解释文字"**：我们的输出是**一个 JSON**（§3.3 要过校验才敢渲染），
   流式显示等于把没校验的东西画到屏幕上。进度说明"在做什么"就够了。

**状态**：生效。验证：`pnpm check` 全绿 —— **211 测**（+1：面板那一行显示阶段、
且阶段压过上一轮的会话状态）→ `pnpm smoke` 73 项 → `pnpm smoke:chain` **118** 项
（+3：进度挂在通知上且可取消、"正在请求模型…"被报告、取件那一段也变成进度）。

---

## D65 讲解风格：术语要少、按数据怎么流、两档可选（S8 补）

**用户的原话**（三条一次给全）："不要那么多名词什么的，要不还不如读代码本身了。
就简单的描述这一块的逻辑就好了（但是设为可选风格：简约、严谨），
还有太从上到下了，我希望能表达出数据流转的感觉。"

**第一版 prompt 的问题**：它只说了"步骤要有推进关系（先判断再取值、先定义再使用）"——
**那正是"从上到下"**。而且**一条风格约束都没有**，模型于是默认走进教科书体：
开场白（"这段代码实现了一个环形队列……"）+ 术语堆砌（"非原子"、"生产者/消费者"）。
用户那句话点得准：**如果讲解只是用更花的名词复述代码，那不如直接读代码。**

**改法（三条，都在 `prompts/index.ts`）**：

1. **风格成了设置项**：`anchorExplain.style` = `concise`（默认）/ `rigorous`。
   默认**简约** —— 用户嫌的就是名词多，那就不该把"讲话花哨"当默认。
   非法值退化成默认档（设置里写错一个词不该让讲解不可用），`显示状态` 会报出当前是哪档。
2. **步骤按"数据怎么流"切，不按行序**。每一步回答三件事：数据**从哪来** → 在这里**被怎么改**
   → 出去**给谁用**。并明确写了反面："不要从上到下一行一行地讲 —— 那等于把代码念一遍"。
   步骤顺序因此可能与行号顺序不同，**但每一步的 `location` 仍指向真实行/页**（契约不变）。
3. **两档共享"少讲废话"**：不写开场白、不复述代码已经写出来的东西（"这里调用了一个函数"）。
   两档的差别只有术语与粒度：简约**禁用代码里没出现过的名词**，并要求一句话 ≤ 40 字
   （这是防名词堆砌的具体手段，不是修辞）；严谨可以用术语，但每个都要落到这段代码的
   具体位置/字段上，并说清依据（不变量、边界、返回值）。

**为什么不把风格做成"自由文本框"**：那样每次讲解的效果取决于用户怎么写那句话，
而我们的验收（§3.3）不看风格 —— 一个没边界的旋钮等于没有旋钮。两档都写死在 prompt 里，
有单测钉住"两档确实不一样、且都含数据流转与反行序那两句"。

**状态**：生效。验证：`pnpm check` 全绿 —— **222 测**（+11：`prompts.test.ts` 九条 + 配置两条）。

---

## D66 S9a：跨文件取件 —— 边界按"逻辑相关"，规则从"不许出去"变成"出去过才许写"

**起因**：用户实测后的一句话 —— "没有跨文件的理解啊，像是嵌入式等等，很多分散的代码"。
嵌入式里宏在 `config.h`、结构体在 `ring_buffer.h`、真正的调用者在 ISR 里，
只看锚点文件那个选区，AI **讲不出"数据从哪来、给谁用"** —— 而这正是我们在 D65 里刚要求它做的事。

**决策：四条。**

1. **放开的不是"目录"，是"相关性"**。相关性**由模型判断**（提示词教它判据：宏、结构体、调用者），
   我们只负责**边界**：`anchorExplain.fetchScope` 三档（`related` 默认 / `same-dir` / `off`），
   加上黑名单（密钥、依赖、构建产物）、单次 60 行、以及原有的 `maxFetchRounds`。
   **"防漫游"的初衷没有丢，改的是它的形式** —— 见第 2 条。
2. **规则从"不许出去"改成"出去过才许写"**。§3.3 现在放行 `filePath ∈ 锚点文件 ∪ 本次真取过件的文件`。
   一字之差，但性质完全不同：模型**读了才能引用**，读什么由闸门批、由日志记。
   两次判断都不靠自觉：编排层从 `FetchedSpan` 收集，命令层（第二道闸门）从**取件日志**收集
   —— 后者不必改编排器的接口，因为日志里本来就有"这次读了哪个文件"。
3. **闸门分两道，各自守擅长的那半边**：名字与范围（纯字符串）在 `validateContextRequest`（可单测）；
   体积与二进制（要字节）在适配器。**路径解析也是纯函数**（`resolveCandidatePaths`），
   而且**落在允许范围之外的候选直接丢掉** —— 闸门批准的就是适配器会读的，不留第二条路。
4. **规则 3 收口时踩了自己的坑，如实记一笔**：第一版给"锚点文件"那条分支加了提前 `return`，
   于是**去重（规则 4）与频率（规则 5）被整个跳过** —— 一次讲解可以无限重复取同一个区间。
   被单测当场抓住（`规则 4/5/轮数用尽` 三条同时红）。现在两种来源都走到底部的公共判定。

**候选文件清单**（写进 user prompt）：跨文件时模型最大的障碍不是"不许读"，而是**不知道该问哪个文件**。
清单排序规则：**`#include` 提到过的排最前**（那是代码自己声明的依赖，比目录猜测更强）→
**同目录的** → 其余；同目录给裸文件名，其余给工作区相对路径（模型照抄即可）；封顶 40 条。

> **更正（D67）**：上面这句"写进 user prompt"当时**没有兑现** —— `buildUserPrompt` 的
> `candidates` 参数只是个签名，函数体没读过它，清单一次都没进过 prompt。
> 冒烟只断言了"取件内容里有兄弟文件"，所以全绿。D67 第 4 条已把它真正接上并加了回归。

**取件日志**（截图问题 3.4）：现有那行本来就有轮次/类型/参数/拒绝原因，
S9a 起它在跨文件时**必然带上文件与行范围**（`第 1 轮 取件 file {"start":10,"end":20,"path":"ring_buffer.h"} …`），
并在链路冒烟里加了断言钉住。

**没做的（诚实记着）**：① 大文件仍然**读进内存一次**才判的大小（`FileSystemPort` 没有 stat，
为这一条加端口方法会牵动 core + 两个实现 + 假端口；一次讲解最多读 3 次，代价可接受）；
② 不解析 `-I` 路径、不建索引、不做符号跳转 —— 那是 IDE 的活。

**验证**：`pnpm check` 全绿 —— **245 测**（core 40 + ext 193 + pdf 12）
→ `pnpm smoke` 73 项 → `pnpm smoke:chain` **122** 项（+4：跨文件读兄弟文件真的取回了内容与行号、
工作区外拒绝、密钥类拒绝、取件日志里有文件与行范围）→ `pnpm smoke:pdf` 67 项。
新增样本 `test/fixtures/ring_buffer.h`（宏 + 结构体就在那儿，正是用户说的那种形状）。

**状态**：生效（`slice-S9a`）。

---

## D67 S9a 的实测返工：许可写在文档里、模型看不见 —— 三个根因都在我们自己这边

**起因**：用户按 S9a 的验收步骤实测，回来的是一句话 ——
"第一轮我看到了一个报错，第二轮没有往外读的想法（3 改 5 之后）"。
S9a 的验收标准是「**能读到**」，这条实测等于**没通过**。查下来**根因全在实现侧，不在模型**：

1. **§8 的工具 schema 里没有 `path`**（"许可"只写在 `CONTRACTS` 与系统提示里）。
   工具 schema 是模型唯一能看见的能力清单，主流端点按它生成参数 —— 未声明的项模型基本不会给。
   于是"可以读别的文件"这条许可**不可执行**：模型不给 `path`，我们把它当年锚点文件读，
   它拿回来的还是自己那份文件；而系统提示里那个"`path` 参数"在它眼里根本不存在。
   **这是"没有往外读的想法"的主因。**
2. **输出契约与 S9a 直接冲突**：`explainOutputContract()` 里那句
   "`filePath` 必须与锚点**同一个文件**"是 S1 时代的口径，S9a 忘了改，而且是**无条件**发出去的
   —— 包括 **repair 那一轮**。于是模型引用兄弟文件被判失败后，我们拿**同一条错规则**让它再写一遍，
   第二次注定还是失败，最后以 `SCHEMA_VIOLATION` 收场。**这条让失败不可恢复。**
3. **两道闸门各用一套坐标**（那个报错的真凶，也解释了"报错说我没读过我刚读过的文件"）：
   编排层内部闸门的允许集合来自 `FetchedSpan` = **归一化后的绝对路径**；
   命令层第二道闸门从取件日志收集 `entry.request.params.path` = **模型原样写的相对路径**
   （`commands.ts` 的 logger sink）。模型只要用相对路径取件、再在讲解里引用那个文件，
   就**必然**被其中一道拦下：写相对 location 过不了内部闸门，写绝对 location 过不了第二道。
   **这不是概率问题，是机械的。**
4. **顺带一处"文档说了、代码没做"**：D66 声称候选文件清单"写进 user prompt"，
   而 `buildUserPrompt(anchor, { candidates })` 的 `candidates`/`focus` **只出现在签名上**，
   函数体从没读过它们（TypeScript 不会为"没用的属性"报错，`pnpm check` 因此全绿）。
   **清单一次都没进过 prompt。** 这条已回填进 D66 的更正。

**决策（四处改动）**：

1. **§8 声明 `path`**（`required` 补 `start`/`end`），`description` 里删掉"当前文档"那句 ——
   它一直在告诉模型"只有这份文档"。**契约改动，先改 `CONTRACTS.md` 再改代码**（本次就是这样做的）。
2. **输出契约按 `crossFile` 走**：`explainOutputContract(crossFile)` 与
   `buildRepairPrompt(raw, issues, { crossFile })` —— 跨文件时那句变成
   "必须是**你这次真的有过**的文件：锚点文件或你取件读过的文件；没读过的文件出现在 location 里，
   整次讲解会被判失败"。**repair 与初次必须说同一句话**，否则修不回来。
3. **允许集合统一到绝对路径**：编排层日志记**归一化后的请求**（`decision.request`），
   §3.3 比对前把相对 `filePath` 按锚点文件所在目录解析、并**返回解析后的路径**
   （下游要拿它开编辑器）。取件日志因此也更能复核 —— 它显示的是**真的读了哪个文件**（截图问题 3.4）。
4. **候选清单真的进 prompt**：`buildUserPrompt` 渲染「## 可能相关的文件」，并给出
   **锚点文件所在目录**（相对路径的基准），配一句"要引用就先取件读一次，一次一个文件"。
   纯函数守卫（`prompts.test.ts`）钉住这件事，防止再退化成签名上的装饰。

**轮数用尽的报错也一并说实话**：原来是"取件 N 次之后模型仍未给出讲解"，而实际上可能
**一次都没取成**（每次都被拒，`roundsUsed` 不涨，循环却照样烧完）—— 那样这句话是假的。
现在会带上"被拒 M 次，最后一次的原因是…"。**失败必须发声，还得说得准**（D61~D65 一路下来的一条线）。

**代价与教训**：S9a 的 245 条测试全绿而功能不可用 —— 因为冒烟的 `related` 场景只断言了
"取件内容里有 `ring_buffer.h`"，**从没有一条断言让讲解真的落在那个文件里**。
"我想到的"被挡住了，"我没想到的"没人挡。已补：冒烟新增
「讲解的某一步落在取过的兄弟文件里」场景（相对与绝对两种写法各一条），
以及"候选清单出现在 user prompt 里"的回归。

**状态**：生效（`slice-S9a-fix`）。

---

## D68 侧边栏那块「取件日志」一直是假话 + 重复按下会开出第二份讲解

**起因**：用户截图回报 S9a 重跑结果。**好消息先说**：跨文件这次真的成了 ——
讲解里写着「% RB_CAPACITY（RB_CAPACITY 是 **12 行**定义的 **16**）」，那是它读了兄弟文件才可能知道的事。
同一张截图里另有 **三处是坏的**，都不是新功能的问题，而是**已经在屏幕上的东西在说假话**：

1. **面板底部「取件日志」写着"本次讲解没有请求额外上下文。"，而那一轮明明读了 2 次**
   （一次成功、一次被拒）。查下来：`tooltrace:append` 在 `CONTRACTS §5.3` 里定义着、
   `clientScript.ts` 里渲染着、`SidebarPanel.post()` 也早就支持 —— **只有宿主从来没发过**。
   那句"空"的占位文案因此在任何一轮里都成立。这就是 D61~D67 一路那条线（失败/事实必须发声）的
   另一面：**屏幕上的东西在说反话，比不说更坏** —— 用户会据此判断"它没读"，进而怀疑整个跨文件功能。
2. **那条日志连"读了哪个文件、哪几行"都不显示**（只显示 `file` 这个类型），
   而"读了哪些文件、每个文件的哪几行"正是截图问题 3.4 的**验收标准原文**。
3. **用户看到的进度通知是上一份的**：「Anchor：正在讲解: 第 2 轮取件被拒（1-60 这个区间已经取过了）」
   —— 而面板里讲解已经出全了。成因是**重复按下**：他按了两次（D64 说的那个习惯），
   第二次的结果先出来并画上面板，第一次还在跑（它的通知因此继续挂着），
   等它跑完 `gen !== generation` 被判过期丢掉 —— **一份完整的讲解白烧了**。
4. 顺带：那句拒绝文案「1-60 这个区间已经取过了」在跨文件之后是**有歧义的**（哪个文件的 1-60？），
   它既回灌给模型也显示给用户，含糊会把两边一起带偏。

**决策（四处，都是"把已经在屏幕上的东西说真"）**：

1. **`tooltrace:reset` 追加进 `HostToSidebar`**（§5.3 的加法扩展，同 D42 的性质）：客户端清空 trace 数组。
   非有不可的理由有两层：`append` 是追加而 trace 数组**活得比一轮讲解长**；
   更要紧的是**时序** —— 面板是讲解完才建的（用户是在开始面板上按的按钮），
   取件那几条发生在面板存在之前，所以宿主把本轮记录暂存（`traceThisRun`），
   面板一建好就 `reset` + 逐条 `append`（走的是已有的重放缓冲，不必关心 webview 起来没有）。
2. **日志显示"文件名 + 行范围"**（PDF 显示页码）：`describeEntry()` 逐字段防御地拼出
   `第 1 轮 ring_buffer.h 10-20 行 接受 · 355 字`。完整路径仍在输出面板「Anchor」里（那里地方够）。
3. **一次只许讲一份**：`explain` 前加 `running` 护栏，正在跑时**明说一句然后不做**
   （`已经在讲解这一处了 —— 这一次重复的按下了，等它出来就好`，写在开始面板那一行里），
   不采用"新的覆盖旧的"——那样同一处还要再花一份 token。它会顺带治好那个滞留通知。
4. **去重文案指认得清**（`describeFetched`）：`ring_buffer.h 的 1-20 行 已经取过了，不要重复请求，直接用它给结论`。

**验证**：`pnpm check` 全绿 —— **262 测**（core 40 + ext 210 + pdf 12）
→ 冒烟 73 → 链式 **132**（+4：取件记录真的推给了侧边栏、那条记录带着文件与行范围、
新一轮先清空、讲解进行中重复按下不产生第二次）。

**教训**：这一片的两处问题都是"**两端都写好了，中间那一步没人做**"——
`tooltrace:append` 有类型、有渲染、有重放，唯独没有发送方；冒烟也只断言了输出通道那一路。
**一条消息的"发"和"收"要有一条端到端断言盯着，只测一端等于没测。**（已写进 STATE 约束）

**D68 补记（同一天，第二次实测）**：用户贴来一行通知
「Anchor：正在讲解: 第 2 轮取件被拒（**main.c 的 1-60 行** 已经取过了，不要重复请求，直接用它给结论）
—— 让它基于现有信息作答」——文案已经是新的，说明改动生效了。这次顺手把**那句话本身**再改好两处：

1. **通知里的话要指向"正在发生的事"**。取到件之后紧接着就是"等它给结论"（十几秒量级），
   停在一句取件记录上像卡住了；被拒之后同理 —— 而"被拒"两个字很容易被读成"出错了"。
   现在写成：`已读 ring_buffer.h 10-20 行（355 字），正在等它的结论…` /
   `第 N 轮取件被拒（…）—— 正在等它基于现有信息作答…`。
   拒绝原因**只取第一句**：那些话是**写给模型**的（教它怎么写相对路径），整段塞进一个转瞬即逝的
   通知里就是一堵墙 —— 全文在输出通道与侧边栏那块日志里，一个字不少。
2. **让"到底开了几份"从日志里就能看出来**：`讲解开始（第 N 次）`、
   `讲解的等待结束（第 N 次）—— 进度通知在此时关闭`、以及重复按下时的 `重复按下被忽略 —— 上一份还在跑`，
   都写进输出通道「Anchor」。上一轮那条滞留通知我只能**从代码推断**成因（重复按下），
   因为我看不见用户的屏幕 —— 现在这个问题变成可回答的了：日志里"开始"几次、"结束"几次，一对就知道。

**状态**：生效（`slice-S9a-fix3`）。

---

## D69 跨文件的落点必须**画对**、**标清**：一拍只画一个文件 + 不在锚点文件里的位置带文件名

**起因**：用户在**自己的嵌入式工程**上实测（12 路双向 DShot 固件），回报两件事：
① 好消息 —— 它自己读了 `esc.h` 与 `protocol.h`（取件日志两行都在），讲出了 `DSHOT_BOOT_MODE`、
`unlock_done`、双缓冲换帧这些跨文件的东西；② 但他的两个问题暴露了一个更严重的问题：
**12 步全部落在 main.c**，而讲解里有「[第 16 行]」「[第 41-44 行]」这种**行号根本不落在该步区间内**的子高亮。

查下来两处都错，而且**第二处是"画错"而不只是"没说清"**：

1. **播放器把别的文件的行号画到了锚点文件上**。`render()` 拿 `specs[0].location.filePath` 当唯一目标打开编辑器，
   然后把**所有** spec（含子高亮）都用这个编辑器的行数去 `toRange` 并 `setDecorations` ——
   也就是说 `protocol.h:16` 变成了 **main.c 第 16 行**上的一个框。屏幕上出现一个**看起来很确定的假框**，
   比不画更坏（用户会以为那行代码就是它说的东西）。
   根因是一句从 S1 起就成立的假设：**一拍 = 一个文件**。S9a 的契约（location 可以落在取过的别的文件里）
   让它不再成立，但没人回来动播放器 —— 这正是 D67/D68 那条线的第三张脸：
   **契约松了，消费它的人必须跟着松**。
2. **侧边栏的行号标签不带文件名**：`[第 16 行]` 看起来就是锚点文件的第 16 行。用户就是这么被绕住的。
   （顺带把取件日志的路径从"只显示文件名"改成**末两段**：`Inc/esc.h` —— 两个同名文件正是这里会出问题的地方。）

**决策（四处）**：

1. **一拍只画一个文件**：焦点 = 这一拍里**最具体**的那个位置（有子高亮就跟子高亮，否则跟步骤），
   只画落在焦点文件里的框，其余文件这一拍不画。滚动目标优先取"落在焦点文件里的那一步"——
   单文件时与从前**一字不差**。决策提成纯函数（`focusFileOf` / `specsInFile`）所以能直测。
2. **打开目标文件用预览标签**：`ViewColumn.One` + `preview: true` + `preserveFocus: true`
   （S9c 已批准的落地约束：同组、不分屏、不堆积、不抢焦点）。跨文件讲解会经过好几个文件，
   每个都开常驻标签很快就把标签栏堆满。
3. **不在锚点文件里的位置，标签一律带文件名**（步骤头与子高亮行都带）。
   为此 `session:update` 追加 `anchorPath`（§5.3 的加法扩展）—— 客户端没有别的地方能知道"锚点是哪个文件"。
   旧宿主不发这个字段时退化成 `null`（一律不标）：**少说是可以的，标错不行**。
4. **提示词补一句**（输出契约的跨文件档）：讲的其实是另一个文件里的东西（宏怎么定义、结构体长什么样、
   协议状态机在哪），就把那一步的 `location` **落在那个文件里**，别为了"不越界"塞回锚点文件凑一个不相干的位置；
   反过来也**不许为了显得跨文件而硬拆**。这是对用户"12 步全在 main.c"那条观察的直接回应 ——
   它读了的两个文件只被"提及"，没被"讲"。

**这一片与 S9c 的关系**：这里落的是 S9c 的**前两项**（按文件分组渲染、讲到自动切换、标签带文件名），
它们因为 S9a 的契约而从"手感优化"变成**正确性问题**，所以提前落地。
S9c 剩下的（折叠已完成步骤、面板上的「下一步」按钮、斜体/配色语义等）仍按原计划等确认。

**验证**：`pnpm check` 全绿 —— **266 测**（core 40 + ext 214 + pdf 12）
→ 冒烟 73 → 链式 **138**（+1：`session:update` 带着锚点文件）。
新增/改动：`decorationPlan.test.ts` 两条（焦点文件、只留焦点文件的框；单文件行为不变）、
`prompts.test.ts` 一条（那句跨文件落点规则，且单文件档不许出现）、`startUi.test.ts` 一条（标签与末两段）。

**D69 补记：面板全白 —— 我自己在模板字符串里少写了一个反斜杠**

改完标签逻辑之后用户实测「不出字了」，截图是一整块空白面板。查下来是**我这一轮写的代码**：
`normLoc` 里的 `.replace(/\/+$/, "")` —— 这份脚本是**一个模板字符串**，`\/` 在源码里
等于运行时的一个 `\`… 而 `\/` 等于 `/`：**少写一个反斜杠，运行时就成了 `replace(//+$/, "")`**，
空正则字面量 = **语法错误 → 整块面板一片空白**。用户屏幕上不会有任何报错（脚本死了，
连"我死了"都印不出来），这正是"面板一片空白"的老问题（约束 27 一直是注释级的提醒）。

**所以这次不只修，还补了两道锁**：

1. **单元级**（`test/sidebarClient.test.ts`，新增）：① 把两份内联脚本 `new Function(code)` **真的解析一遍**
   （不需要 DOM）；② 用一个 ~40 行的**最小 DOM** 把侧边栏脚本跑起来，喂它 `session:update` /
   `tooltrace:append` / `tooltrace:reset`，断言渲染出来的文字里有 `esc.h 第 41-44 行`、
   锚点文件的位置**不带**文件名、两种斜杠写法算同一个文件、日志显示末两段路径。
   **这是这块客户端脚本第一次有行为断言** —— 在此之前它只能靠 F5 手测（`startUi.test.ts` 只查过反引号）。
   已按项目规矩验过"改会先红"：把坏写法放回去，解析那条与四条行为全红。
2. **产物级**（链式冒烟）：从**最终 HTML**（产物 → `renderSidebarHtml` → webview 的 `webview.html`）
   里抠出内联脚本再解析一遍 —— 模板、esbuild、HTML 三层里任何一层吃掉一个字符都能被抓住。

**约定（写进 STATE 约束 78）**：内联客户端脚本里**一个反斜杠都不写** ——
去尾斜杠用字符类（`/[/]+$/`），反斜杠本身用 `String.fromCharCode(92)`。
这个文件里注释也不许出现反引号（那是把字符串提前截断，同样是整块白）。

**验证**：`pnpm check` 全绿 —— **271 测**（core 40 + ext 219 + pdf 12）/ 冒烟 73 + **140** + 67。

**状态**：生效（`slice-S9a-fix5`）。

---

## D70 跨文件跳转：标签里印出整条路径 + "右侧卡死"

**起因**：用户在真工程上再跑一次。跨文件、自动跳转、带文件名的标签**都生效了**（截图为证：
侧边栏写着「protocol.h 第 16 行」「esc.h 第 11-14 行」，编辑器切到了 protocol.h），但他报了两件事：
**① 标签里印的是整条绝对路径**（`c:\Users\...\_build_tmp\fw\App\Inc\protocol.h 第 16 行`）；
**② 跳转文件之后，右侧讲解面板完全卡死**。

**① 是真 bug，已复现并修掉**：`split(/[\/]/)` 在这个模板字符串里的**运行时值只按正斜杠切**
（`\/` 被吃掉一层，剩下的 `\/` 在字符类里就是 `/`）—— 之前一直没暴露，是因为宿主给的路径
都是归一化的正斜杠（core 的 `joinPath` 输出 `/`）；而**模型写 location 时用的是反斜杠**
（`c:\Users\...`，小写盘符），于是切不开、整条路径都印上去。
修法：新增 `pathParts()`，**一个反斜杠都不写**（`String.fromCharCode(92)` + 字符类），
标签用末段、取件日志用末两段。复现与回归都在 `test/sidebarClient.test.ts` 里，
用的是**照实测现场抄下来的数据形状**（反斜杠路径 + 两个外部文件 + 多条取件记录）。

**② 我没能复现，所以改用"让它可诊断 + 消除可疑的抖动"** —— 诚实记下来：

- **先看证据，不猜**：VS Code 的日志里**没有任何异常**（exthost 无我们扩展的错、renderer 无 webview 警告、
  无 unresponsive），输出面板「Anchor」停在 `22:56:05 讲解的等待结束（第 1 次）` 之后就再无一行。
  也就是说：**不是崩，是"卡在某个不再推进的状态"**。
- **把实测数据喂进 DOM 夹具**：客户端脚本**没有抛异常**（若抛了，会是"每次重放都抛 → 面板不再更新"。
  这条路径值得单独说：webview 里的异常**扩展侧完全收不到**，屏幕上也不显示 —— 用户只能看到"卡死"）。
- **两处真改**（都可测、都减少可疑抖动）：
  1. **面板脚本出错要看得见**：消息处理包一层 try/catch，把第一行错因写进面板顶部（红条）。
     从此"卡死"会变成"看得见的错"，一句话就能定位。
  2. **播放器：同一文件不重复打开 + 渲染不并发堆积**。跨文件讲解时焦点文件来回跳，
     原来**每一拍**都会 `showTextDocument`（预览标签反复重建、编辑器反复滚 —— 屏幕上就是持续抖动）；
     现在同一个文件且它已经是活动编辑器就直接复用，且**同一时刻只跑一次渲染**（堆积只保留最后一拍）。
- **顺手发现一条假绿**：冒烟里「caveat 档点亮在第 46 行」原来是在**上一拍的残留渲染**上通过的
  （会话已经走到下一拍，屏幕上还是上一拍的框）。把 `flush()` 改成让渲染真的落定之后，它才红。
  已按真实节拍重写，并且**多验一条**："换点之后上一拍的框必须清掉"（一次只点亮一个点）。
  **教训与 D67 同一条：断言必须落在链路真的走完之后。**

**约定（写进 STATE 约束）**：内联脚本里**零反斜杠**（这条现在有断言钉着，两次栽跟头换来的）；
面板脚本的异常必须显示在面板上；异步渲染的断言必须先 `flush`。

**验证**：`pnpm check` 全绿 —— **274 测**（core 40 + ext 222 + pdf 12）/ 冒烟 73 + **143** + 67。

**状态**：生效（`slice-S9a-fix6`）。

---

## D71 单次取件从 60 行放开到 400 行（可调）+ 超上限改成"截断"而不是"拒绝"

**起因**：用户看了那轮真机日志之后的一句 —— "60太少了，200都不一定够"。
日志里明摆着：它想读 `esc.h` 1-80、`dshot_dma.h` 1-80、`transport.h` 1-70，
**三轮全被"一次最多取 60 行"整条挡掉**（5 轮预算只剩 2 轮给真正的读取），而它下一轮还是想读同一段。

**决策（四处，都是一个道理：把界限说准、别让它白烧预算）**：

1. **默认 400 行**（硬上限 2000），并新增 `anchorExplain.maxFetchLines` 可调。
   一个嵌入式头文件动辄一两百行 —— 60 行连一个结构体的字段都列不全，跨文件讲解就成了"读了一眼就猜"。
2. **超上限 → 截到上限照常给**，不再整条拒绝。截断不误导：适配器回灌的内容头部写着**真实行范围**
   （`行 1-400（共 900 行）`），真想要后面那段可以再要（区间不同，去重不挡）。
   **放行的请求、日志、去重比的都是截断后的区间**（否则"截到 400"会被当成"你刚读过 1-900"）。
   **两种情形仍然是拒绝**，因为它们是"关于这份文件的事实错误"而不是我们的政策：
   `end` 超出锚点文件的文档总行数（说清"共 75 行"更有用）、以及 PDF 的 `maxSpan`（另一种量纲）。
3. **这个数只有一个来源**：`DEFAULT_MAX_FETCH_LINES` / `MAX_FETCH_LINES_CEILING` 在闸门模块里，
   配置层的夹取、适配器声明的能力上限、**提示词里那句"单次最多 N 行"**全部指向它。
   改之前提示词里写死"≤60 行"、闸门读 `capabilities.maxSpan` —— 两个地方各写一个数，
   迟早会出现"提示词说 400、闸门按 60 拒"。
4. **顺带修掉一个静默失效**：`readAnchorConfig` 里**没读 `style` 与 `fetchScope`** ——
   它们在 `package.json` 里声明得好好的，`resolveConfig` 又都把"没给"当默认档，
   于是**用户改这两个设置什么都不会发生**（S8/S9a 就这么一直过来的）。
   这类 bug 的共同点是"不报错、屏幕上没迹象"，所以补了一条**镜像锁**（见下）。

**新锁（链式冒烟）**：`package.json` 的 `contributes.configuration.properties` 里**每一个**
`anchorExplain.*`，读取侧都必须真的 `get` 过一次；漏读就报出漏了哪几个。
已按规矩验过"改会先红"：把 `style` 的读取删掉 → 那条立刻红并指名 `anchorExplain.style`。

**验证**：`pnpm check` 全绿 —— **278 测**（core 40 + ext 226 + pdf 12）/ 冒烟 73 + **146** + 67。
新增：`clampFetchLines` 与 `resolveConfig` 的单测、规则 3 的截断用例（含"去重比截断后的区间"
与"PDF 仍拒绝"）、提示词里那个数与策略同源的断言、以及端到端的"设置写 3 就真给 3 行"。

**状态**：生效（`slice-S9a-fix7`）。

---

## D72 "面板卡死" = 讲完之后的面板是**死路**：三个按钮全禁，而键盘还好使

**起因**：用户第二次报"卡死"，这次带了截图与"界面还在前台"。照例先看证据：

- 这一轮的 `Anchor` 输出通道**干净得像样张**：5 轮取件全"接受"（`esc.h` 1-120、`transport.h` 1-60、
  `dshot_dma.h` 1-80、`dshot.h` 1-120、`transport_uart.c` 1-160），零拒绝 —— **D71 的放宽完全生效**，
  "5 轮里 3 轮被 60 行白烧"这件事没有了。
- 扩展宿主日志里**一行我们的报错都没有**，渲染进程也没有 webview 警告。
- 截图里那三样新东西都在工作：标签只剩文件名（`esc.h 第 124 行`、`transport.h 第 22-25 行`）、
  编辑器自动切到了 `transport.h`、假框没有出现。

**而截图里真正的"卡死"是**：面板处于 **ended** 状态，底部 `上一步 / 下一步 / 退出` **三个全灰**，
只有一行"讲解已结束"的说明。查代码：`buildToolbar` 里 `prev.disabled = ended || atStart`、
`next.disabled = ended || done`、`stop.disabled = ended` —— **`ended` 把三个都禁了**。

**这不是"保守"，是自相矛盾**：同一个时刻，键盘那边 `ESC` / `Alt+[` / `Alt+]` **仍然是好的**
（D46 明确要求"done 之后 ESC 必须仍然可用"）。按键盘能回看、点按钮不能，用户当然读成"面板死了"。
而且**"讲完想回看一步"恰恰是这时候最常想做的事** —— 这正是 D61 那条规矩（门厅不许是死路）
在面板末态上的复现。

**决策（三处）**：

1. `上一步`：只要不在开头就能按（**结束后也允许**）。回看是把讲解用完，不是越界。
2. `下一步`：讲完/结束就禁（确实没东西可推进）。
3. `退出`：**永远能按**（明写 `stop.disabled = false` 而不是"不赋值"）—— 它与 ESC 是同一个出口，
   而且是"收掉高亮"的唯一按钮出口。
   那句话也改成说清**现在还能做什么**：「讲解已结束 —— 可以按「上一步」回看，或按「退出」收掉高亮；
   重新选中一段再发起即可。」
4. **顺带**：面板有焦点时按住 `Alt+]` 不放会以每秒几十次重复触发键盘事件（每一次都是一条 `ui:next`
   + 一次换拍 + 一次"打开文件"），那是把面板与编辑器一起压住。`ev.repeat` 一律忽略。

**验证**：`pnpm check` 全绿 —— **280 测**（core 40 + ext 228 + pdf 12）/ 冒烟 73 + **146** + 67。
新增两条：讲完之后的按钮状态（`上一步`/`退出` 可点、`下一步` 禁）、自动重复不转发。
后者用夹具直接派发 `keydown`（`repeat: true` 不发消息、真按键仍发）——
**这块客户端脚本的行为现在能在 `node --test` 里验了**，不必再等 F5。

**D72 补记：另一半在键位上 —— "全都不管用"是**同一个死路**

用户补了一句更准的话：「按键、快捷键、按钮全不管用，**进入最后一条**就卡死」。
照例先看证据：这一轮（22:24）的 `Anchor` 输出通道**干净得像样张**（6 轮取件、5 轮接受，
第一次出现了"取件次数已达上限（5 次）"的拒绝），扩展宿主日志里**一行我们的报错都没有**；
宿主最后那行是 `Extension host terminating: received terminate message from renderer`
（= 窗口重载把宿主收掉了，那是**用户的动作**，不是崩）。所以宿主是好的。

于是回去看"最后一条"那一刻**我们主动禁掉了什么**：

- `walkthroughActive` 在状态变成 `done` 时落成 `false`，而 `anchorExplain.prev` 与
  `anchorExplain.goto` 的 `when` 正是 `anchorExplain.walkthroughActive`
  → **走进最后一步，`Alt+[`（回看）与 `Ctrl+Alt+W`（跳回某步）当场变哑**。
- 面板那三个按钮的 `ended` 全禁（上一轮已修）。
- 两件事叠起来，正好是"按键、快捷键、按钮全都不管用"。

**决策：`prev` / `goto` 改绑 `sessionOpen`**（与面板上的「上一步」一致）——
讲完那一刻唯一还想做的两件事就是**回看**与**跳回某一步**，把它们禁掉不是保守，是把面板变成死路
（D61 的同一条规矩）。`next` / `playPause` 仍然绑 `walkthroughActive`（确实没有可推进的东西）。
`stop` 本来就绑 `sessionOpen`（D46），不变。

**代价与同步**：这条改动撞上了两条**已经存在的锁** ——
① `package.json` ↔ `WALKTHROUGH_CHORDS` 的逐字镜像锁；
② 一条写着旧意图的锁：「推进类键绑 walkthroughActive：讲完（done）之后它们必须失效」。
两条都红了，**这是它们该做的事**。第 ② 条我**改了意图并写明理由**（而不是绕开它）：
原意是"讲完就别让键还能推进"，但 `prev`/`goto` 不是"推进"，是"回看" —— 用户实测把这件事说清楚了。
新锁按新意图写，并把"为什么不能绑回 walkthroughActive"写在断言里，免得下一个人（可能是我）改回去。

**验证**：`pnpm check` 全绿 —— **280 测**（core 40 + ext 228 + pdf 12）/ 冒烟 73 + 146 + 67。


---

## D73 「框选PDF，并没有反应」= `acquireVsCodeApi()` 只能成功一次，而 pdf.js 先取走了

**起因**：用户八个字：「框选PDF，并没有反应。」没有截图、没有报错。照例先找证据，这次能拿到的
只有两样：**代码**与 **VS Code 自己的源码**（不猜）。

**证据链（三步，都落在文件上）**：

1. 页面里**不止我们一个脚本要这个 API**。`assets/main.mjs:18` 一开头就
   `import ... from "./pdf.js/web/viewer.mjs"`，而 `viewer.mjs:24094` 在
   `_initializeViewerComponents()` 里有一句 `const vscode = acquireVsCodeApi();`，
   交给 `VSCodeLinkService`（把 PDF 里的链接交回宿主）。**它必然跑在我们前面。**
2. 这个 API **一个 webview 只能成功调用一次**。VS Code 1.137.0 的 webview 预加载
   （`resources/app/out/vs/workbench/contrib/webview/browser/pre/index.html:209`，`getVsCodeApiScript`）
   就是这么写的：`let acquired = false;` + 第二次 `throw new Error('An instance of the VS Code API
   has already been acquired')`；`allowMultipleAPIAcquire` 只在 notebook renderer 与 chat 输出里为
   `true`，自定义编辑器没有。
3. 于是我们的脚本（`media/anchor-select.js`）那次调用**抛了**，而第一版把它包在
   `try { ... } catch { vscode = null }` 里 —— 注释还写着"退化成功能不可用，而不是整个页面报错"。
   结果 `postMessage` 全变成静默空操作：`anchor:ready` 发不出去 → 宿主 `readyPanels` 永远空 →
   `Ctrl+Alt+S` 只把面板记进 `pendingSelect` 而不推消息 → **连十字光标都不出现**。

**用户那八个字本身就佐证了第 1 步**：他看到的是 PDF 正常渲染（能框选），说明 pdf.js 的初始化
跑通了；若反过来是我们先取成功，`_initializeViewerComponents` 会当场抛，`load()` 不会执行，
**PDF 根本渲染不出来**。

**决策（四处）**：

1. **注入脚本接管 `globalThis.acquireVsCodeApi`，把"只准调一次"换成"谁都拿到同一个"**：
   自己先取一次、把实例记下来，之后 pdf.js 来取就拿到同一个。装壳之后要**验一下装上了没有**
   —— 没装上就**不取**（取了会把 pdf.js 那一次变成"第二次"，等于用"我们能用"换"页面链接全坏"）。
2. **注入位置改到 `pdf.mjs` / `main.mjs` 之前**（这是修法的另一半，光改脚本不够）。
   module 脚本不带 `async` 时按文档顺序执行，所以"我们在前"是**结构性保证**，不靠时序运气。
   冒烟里那条写着"框选脚本排在上游脚本之后"的断言**改了意图并写明理由**（它原本的理由是
   "要靠 pdf.js 的 DOM 才能算位置" —— 那件事发生在拖拽时，与加载顺序无关）。
3. **失败必须发声（这次是双通道）**：脚本拿不到 API 时，在页面上贴一句故障说明
   （`#anchor-select-fault`，约束 1 的唯一例外 —— 那种情况下它是唯一还能说话的通道）；
   宿主那边 `selectRegion` **不管有没有握手都先推一次**，没握手时还要说一句人话
   （第一次："页面还在加载"；再来一次还是没握手："一直没有回应"+怎么查）。
   原来的"未握手就先不推、也不出声"是把静默当保守。
4. **顺带**：注入脚本那份"兜底副本" `pickDominantPageInScript` 里，交叠面积是 `NaN` 时
   不再能赢下比较（原判据 `if (x2 <= x1 || y2 <= y1) continue` 对 `NaN` 不成立），
   改成 `if (!Number.isFinite(overlap) || overlap <= 0) continue` —— 与 `intersectRects`
   的语义对齐：**算不出来就当没相交**。少了这一条，一个 `[0,0,0,0]` 的框会发出去、
   被宿主守卫静默丢掉，又是一次"拖了、没反应"。

**这一片最大的教训（比 bug 本身重要）**：第一版**想到了**这个风险，还把它写进了注释，
然后选择了"优雅退化成静默"。项目的规矩（D61~D72）一直是"失败必须发声"，
而这里是我自己破的例 —— **一行 `catch { vscode = null }` 让整条链路哑了一整轮**。
凡是"降级"，都要在用户能找到的地方留一句话；没有通道，就造一个（哪怕是在 PDF 页面上贴一句）。

**验证**：新增 `packages/extension-anchor-pdf/test/anchorSelectClient.test.ts`（**9 条**）——
线2 的注入脚本头一次有了行为夹具：最小 DOM + **逐字复刻 VS Code 预加载语义**的
`acquireVsCodeApi`（含那条报错原文），把"宿主推 `enterSelectMode` → 拖一个框 → 发回来的消息
能被宿主守卫收下、并算得出是第几页的哪一块"整条**跑一遍**。写测试时它当场抓出两个真问题：
① `DOMRect` 同时有 `x/left`，脚本量的是 `left/top`（夹具少写一套就等于测了别的东西）；
② 上面第 4 条那个 `NaN` 判据 —— 夹具喂进去的坏几何，让 `[0,0,0,0]` 原样发了出去。
**顺序**这件事由冒烟守着（注入标签早于 `pdf.mjs`/`main.mjs`，且只认 script 标签本身 ——
按裸文件名找会找到注释里的那个词，这条也踩过一次）。

**验证数字**：`pnpm check` 全绿 —— **289 测**（core 40 + ext 228 + pdf **21**）/
冒烟 73 + 146 + **74**。


---

## D74 「PDF 取件全被拒」= pdf.js 的 worker 在产物里找不到，而 `node --test` 一直是绿的

**起因**：D73 修完，用户重测 —— 框选那条链路**活了**（面板出了讲解、定位标签对、取件日志在动），
但新的卡点很明确：模型两次按页取件都被拒，屏幕上写着「无法确定这份文档的总页数，拒绝按页取件」，
面板于是只剩一段"我没拿到原文"的空讲。

**证据（这次是自己动手复现，没停在读代码上）**：先看 `Anchor` 输出通道，两行拒绝原因一模一样；
再看实现 —— `PDFAdapter.pageCount` 把异常**吞成 null**，闸门于是拒绝。手上一点原因都没有，
所以直接造复现：把 `openPdfJsSource` 用**与真实构建同一套 esbuild 选项**打成一个 cjs 再跑 ——

```
[probe] 打开失败： 打不开这份 PDF（Setting up fake worker failed:
  "Cannot find module '…\dist\pdf.worker.mjs' imported from …\dist\extension.cjs"）
```

同一份代码**源码直跑**则成功（fixture 30 页、用户那份 arXiv 论文 26 页）。

**机制**：`disableWorker: true` 只是"不用线程"，pdf.js 仍然要把 worker 那份代码**加载进主线程**，
方式是 `import(GlobalWorkerOptions.workerSrc)`，而那个默认值是从 pdf.js 自己的 `import.meta.url`
推出来的。**源码直跑**时它正好指到 `node_modules/pdfjs-dist/legacy/build/`；
**打成 cjs 之后 `import.meta.url` 被改写成产物自己的位置** —— 于是它去 `dist/pdf.worker.mjs`
找一个不存在的文件。差别只有一个字：打包。

**四件事合起来让它藏了整整一片（S7 → 现在）**：

1. `pageCount` 的 `catch` 把它吞成 `null`，**一句日志都没留**（"降级=静默"的老毛病）；
2. 闸门那句「无法确定这份文档的总页数」把线索**全部指向那份 PDF 本身**（用户就是这么被引偏的，
   他大概会以为是自己那份论文有什么特殊之处）；
3. `node --test` 跑的是**源码**，`node_modules` 就在旁边 —— 全绿；
4. 冒烟叫"产物冒烟"，但它从来没有真的**打开过一份 PDF**（它查的是字符串、命令、消息、HTML）。

**修法（四处）**：

1. **挂 pdf.js 官方留的钩子**：`globalThis.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')`
   （`legacy/build/pdf.mjs:22948` 读的就是它）。说明符是**字面量**，所以 esbuild 会把它一起打进
   产物（cjs 不分包 = 内联成惰性求值的一段）—— 产物因此自洽，不依赖 `node_modules` 在旁边。
2. **不再静默**：`PDFAdapter` 加一个注入的 `onError`（本文件零 vscode 依赖，所以是注入），
   在 `commands.ts` 里接到输出通道；`withPdfText` 的 catch 也记一行
   （"框选那块取不到字"过去和"这份 PDF 打不开"在屏幕上是同一副样子）。
3. **闸门那句话说成两句**：「无法确定这份文档的总页数，拒绝按页取件**。**线1 读不到这份 PDF ——
   输出面板「Anchor」里有一行原因。」第一句以句号收尾不是文风 —— 进度通知只取第一句
   （`briefReason`），不分句就会被截成半截。
4. **补上跑掉的那条锁**：冒烟里用同一套打包选项把 `scripts/pdf-open-probe.mjs` 打成一个 cjs 再跑，
   断言"打包之后仍能打开 `test/fixtures/sample-30p.pdf`（30 页）"。**并验证过这条新锁能红**：
   把 `ensureFakeWorker()` 拿掉，它报的正是上面那句 `Setting up fake worker failed`。

**一处连带**：把 worker 打进产物之后，那条"产物里没有任何文档写入 API"的锁（按**裸名字**扫
`\bTextEdit\b`）当场误报 —— pdf.js 里有一串 XFA 的枚举名（`… Text, TextEdit, Time …`）
和一个 `_FreeTextEditor`。要守的其实是"**我们的代码**调用过写入 API"，所以模式改成按**调用形状**
扫（`\b\w+\.(TextEdit|WorkspaceEdit)\b` 一类）。**锁红了先想清楚它守的是什么**，别顺手把它删了。

**代价**：dev 产物从 4.5MB 涨到 13.4MB（worker 源 2.4MB + inline sourcemap；生产构建无 sourcemap）。
它是**惰性求值**的（不进那条路就不会执行），本扩展也只本地安装，可接受。

**这一片最该记住的一条（比 bug 本身重要）**：**测试绿不等于用户能用，当两边跑的不是同一份代码时。**
`node --test` 跑源码、用户跑产物 —— 凡是"打包之后才可能出现"的差异（`import.meta.url`、
动态 import、tree-shaking、charset、相对路径），锁就必须打在打包**之后**。
这也是 D73 那条教训的另一半：那次是"我以为它会说话，其实它哑了"，
这次是"我以为测过了，其实测的不是它"。

**验证数字**：`pnpm check` 全绿 —— **289 测**（core 40 + ext 228 + pdf 21）/
冒烟 **74** + 146 + 74（线1 冒烟 +1：那条真打开 PDF 的锁）。

---

## D75 「还是被拒」的下一层：pdf.js 在扩展宿主里被误判成浏览器，`url:` 那条路走不通

**起因**：D74 修完（worker 挂上官方钩子 + 不再静默），用户重测 —— 框选、面板、日志都好，
取件**还是被拒**，而且拒绝文案已经是我新写的那句（说明新产物生效）。这一回屏幕上有了线索：
`Anchor` 输出通道里写着

```
框选那块取不到文字（打不开这份 PDF（window is not defined））—— 交给模型自己去取件
取不到这份 PDF 的页数（打不开这份 PDF（window is not defined））—— 无法按页取件
```

**D74 那句"不再静默"当场回收了成本** —— 上一版这里一个字的线索都不会有。

**证据（两步，都在本机复现）**：

1. 先排除环境版本：`ELECTRON_RUN_AS_NODE=1 "<VS Code 的 Code.exe>"` 跑同一个探针 ——
   **成功**（30 页）。所以不是"Electron 的 Node 不行"。
2. 再看 pdf.js 的判定：

   ```js
   const isNodeJS = typeof process === "object" && process + "" === "[object process]" &&
     !process.versions.nw &&
     !(process.versions.electron && process.type && process.type !== "browser");
   ```

   最后半句是为 **Electron 的渲染进程**写的。而 VS Code 的扩展宿主现在是 **Electron 的
   utility 进程**（`process.versions.electron` 有值、`process.type === "utility"`）——
   于是 pdf.js 判定"我不是 Node"，走浏览器那条路。给它补上这个形状（`process.type = 'utility'`
   且 `process.versions.electron` 有值）后，探针**一字不差地复现**了 `window is not defined`。
3. 调用栈把最后一块拼上：`at getUrlProp … at getDocument` —— **`url:` 这个参数只有浏览器环境
   支持**（pdf.js 要拿 `window.location` 去解析相对地址）。

**修法（两处，都在 `createPdfJsSource` 里）**：

1. **喂字节（`data`）而不是给路径（`url`）**，字节由注入的端口读 —— 真实现是
   `fileSystemPort`（`workspace.fs`），顺带对 remote / 虚拟文件系统成立（`node:fs` 在那类
   工作区里会**静默读到空**，这是 `fileSystemPort` 顶部早就写下的理由）。
   端口是注入的，所以 `adapters/` 仍然零 vscode 依赖（D19）。
   **不去掰 `isNodeJS`**：那要么去动 `process.versions`（影响整个宿主），要么依赖 pdf.js 的内部
   判定 —— 两个都不该由我们改。喂字节绕开了整条环境判断：数据是我们读来的，
   与 pdf.js 觉得自己在哪儿无关。
2. **入口把那块字节归一化成真正的 `Uint8Array`**：pdf.js 明确拒绝 Node 的 `Buffer`
   （`Please provide binary data as Uint8Array, rather than Buffer.`），
   而 `node:fs` 读出来正好就是 Buffer —— 这条是**改完第一处之后测试当场红出来的**
   （`真 fixture：fixture 是 30 页` 失败）。用 `Uint8Array.from` 复制一份：既换掉 Buffer 的身份，
   也避开 Node 小块内存池（小 Buffer 共享同一块 ArrayBuffer，而 pdf.js 会 transfer 它）。

**探针也跟着升级了（这是这一片最重要的部分）**：`scripts/pdf-open-probe.mjs` 现在**先把这个
进程伪装成扩展宿主**（`process.type = 'utility'` + `process.versions.electron`，再动态 import
pdf.js —— 它的判定是模块级常量，必须晚于伪装）。上一版的锁之所以"在我这儿是绿的"，
就是因为它跑在**干净的 CLI Node** 里，而宿主是另一个形状。
**并且验证过升级后的锁能红**：把 `data` 改回 `url:`，它报的正是 `window is not defined`。

**这一片连着 D73/D74，凑成同一条教训的三层**：D73「我以为它会说话，其实它哑了」→
D74「我以为测过了，其实测的不是产物」→ **D75「我以为环境一样，其实形状不一样」**。
凡是"在我这儿是对的"，都要问一句：**我这儿是什么形状？**

**验证数字**：`pnpm check` 全绿 —— **289 测**（core 40 + ext 228 + pdf 21）/
冒烟 74 + 146 + 74。另外手工验过：真 fixture（30 页）、用户那份 arXiv
（`2509.06342v1 (1).pdf`，26 页、第 1 页 4009 字）在**宿主形状**下都能打开。

---

## D76 约束 1 收窄：不许常驻/自动的框，允许"用户点了某一步时闪一下那块"

**起因**：取件通了之后，用户原话 ——「能讲了，但是图里没有对应位置的指示的跳转，根本不知道讲的哪里。」
D13 当年定的是"不做高亮框，但讲到第几页要能看到对应位置，滚动不是高亮框，符合约束"。
实测说明**只滚到页不够**：模型的几步常常落在同一页上，点下去页数没变、画面上什么都不动，
既像没反应，也仍然不知道讲的是页内哪一块。

**这是改一条冻结的约束，所以先问再动**：给了三条路（在 PDF 上闪一下 / 完全不碰 PDF、改成面板里
显示那一块的截图 / 只把位置说成人话），用户选了**第一条**。于是约束 1 从
「PDF 上不出现任何高亮框」收窄为「**不许有常驻的框，也不许有任何框自己冒出来**」——
唯一允许的位置指示是：**用户点了某一步时出现的、会自动消失的那个框**。

**落地（四处）**：

1. **新消息 `anchor:flashRegion {page, bbox}`**（§5.2 加法扩展）+ **新跨扩展命令
   `anchorPdf.flashRegion(page, bbox)`**（§5.1）。**没有**往 `revealPage` 上加参数 ——
   那条命令的契约是"只滚不画"（D13），混进去会让两条契约都定不下来。两条并存，各说各的。
2. **只有用户点击会触发**：线1 的 `revealStep` 是唯一发这条消息的地方（自动播放/推进不走它）。
   链式冒烟里专门有一条断言"按「下一步」/播放时一个 `anchorPdf.*` 都不调"。
3. **会自己消失**：`FLASH_MS = 2000`（下限 300ms、上限 10s）。位置**每帧重算** ——
   pdf.js 的滚动是平滑的，用户也可能在闪的这一两秒里自己滚，画一次不管的话框会留在原地骗人。
   页还没渲染出来就干脆不画（"看起来很确定的假框"比没有框更坏，D69）。
4. **逆换算（归一化 → 像素）留在注入脚本里，但正确性由夹具往返校验**：
   脚本里那门"一行业务数学都不做"的纪律不是教条，是"唯一有对错的部分必须能测"。
   这一门逆运算正好**有**可测的对照物 —— 用有单测的 `rectToNormalizedBBox` 正向把一块像素算成
   bbox，再让脚本画回来，必须画成当初那块像素（`anchorSelectClient.test.ts` 的"往返校验"那条）。
   没有这条，就是又一处"靠拖一百次找感觉"。

**顺带修掉一个"看起来像没反应"**：以前点那一步，若目标就在当前页，画面上什么都不动。
现在两条路都在状态栏回执一句「已定位到第 N 页…」——**动作没有可见结果时必须说一句**，
这是 D61~D73 那条规矩在"成功路径"上的第一次应用（以前只用在失败路径）。

**兼容性（两条线各自安装，D27）**：装了旧版线2 的机器上没有 `anchorPdf.flashRegion`，
直接调会抛 `command ... not found`（对用户毫无意义）。所以线1 先查对端**自己声明的**能力清单
（`packageJSON.contributes.commands`）：有就闪，没有就退回 `revealPage` 的老行为。
两条路都有冒烟断言。

**验证数字**：`pnpm check` 全绿 —— **294 测**（core 40 + ext 228 + pdf **26**）/
冒烟 74 + **151** + **80**。新增的锁：注入脚本 4 条（往返校验 / 到点消失 / 只在收到消息时出现 /
坏页号与坏 bbox 不画）、线2 冒烟 6 条（新命令推的消息与 bbox、坏输入不推且发声、
闪现框有到点收场、脚本里没有 `setInterval`）、线1 链式冒烟 5 条（去 flashRegion 且带 bbox、
回执、旧版线2 回退、回退也回执、自动推进不碰 PDF）。

---

## D77 「讲解中途切换文件就卡死」= 目标文件已在别的标签里时没被切到前台

**起因**：用户一句话 —— 「在讲解时，如果过程中遭遇切换文件，会直接造成讲解卡死。」

**证据（这次是先复现，再改）**：照例先看代码，`CodeWalkthroughPlayer.#ensureEditor`
里有一条分支很可疑：

```ts
const visible = vscode.window.visibleTextEditors.find((e) => normPath(e.document.uri.fsPath) === want);
if (visible) {
  this.#editors.set(want, visible);
  return visible;          // ← 直接返回，**没有把它切到前台**
}
```

于是写了一个夹具把它跑出来：真的 `WalkthroughSession` + 真的 `CodeWalkthroughPlayer`，
只对 `vscode` 打桩，并**补上冒烟里没有的两件事** —— `activeTextEditor` 会被"用户"切走、
`showTextDocument` 是异步的（真实 API 就是 async）。夹具里每次 `revealRange` 都记下
"当时它是不是活动编辑器"，那就是判据。**当场红了**：

```
FAIL  reveal 作用在**活动**编辑器上 —— wasActive=false
FAIL  视图被带回了讲解所在的文件 main.c —— 现在停在 App\Inc\protocol.h
      main.c: reveals=4（其中作用在非活动编辑器上：1）
      protocol.h: reveals=3（其中作用在非活动编辑器上：1）
```

**根因**：`#ensureEditor` 返回的那个编辑器**不是活动编辑器**，而调用方紧接着做的两件事
都只在活动编辑器上才有效：

- `editor.setDecorations(...)` —— 框画在用户**没在看**的标签上
- `editor.revealRange(...)` —— 对非活动编辑器**什么都不做**（不滚、也不切过去）

所以"切走一次"就等于"从此再也跟不上"：会话状态机一直在正常推进（输出通道干净、
零异常、状态栏数字在动），但屏幕上不再有任何变化 —— 用户看到的就是"讲解卡死了"。
这与 D70 那次"我没能复现"是**同一类观感**，但这次抓到了确定的机制。

**修法（一处，分两层）**：`#ensureEditor` 的那条分支现在会**把目标切到前台**，
但不重建标签：

1. 新增 `#focus(editor)`：已打开但不在前台的编辑器，调 `showTextDocument(editor.document, …)`
   把它带上来 —— **复用已有的 document 对象**，所以不会重新解析、也不会把预览标签换成新的
   （正是 D70 要消除的那种抖动）。
2. 仍然保留"同一文件且已是活动编辑器 → 什么都不做"这条捷径：切前台是**有代价**的
   （抢一次可见焦点），不该每一拍都做。
3. 切前台失败一律吞掉（编辑器正在关闭 / 该组被锁）：降级为"只画框、不抢前台"，
   与 `#renderOnce` 里"打不开目标文件就静默退化"同一种立场 ——
   框仍然画在那个编辑器上，用户切回来就看得到。

**为什么不能"每拍都 `showTextDocument`"**：那正是 D70 花力气消掉的东西
（预览标签反复重建 → 屏幕持续抖动）。这次修的是"该切而没切"，不是"切得太频繁"，
所以判据落在**"它是不是活动编辑器"**上，而不是"要不要调 `showTextDocument`"。

**新锁**：`scripts/smoke-file-switch.mjs`（进 `pnpm check`，脚本名 `smoke:fileswitch`）。
它跑的是那套夹具，断言 9 条，其中最关键的一条是**整条链路的不变量**：

> **没有任何一次 `revealRange` 落在非活动编辑器上。**

这条比逐条断言更难糊弄 —— 它挡住的是"以后又在某条新路径上把框画到背景标签里"。
**并且按规矩验过它能红**：把 `await this.#focus(visible)` 拿掉 → 3 条立刻红，
指名 "wasActive=false" 与 "视图被带回了 main.c"；加回去 → 全绿。

**这一片最该记住的一条**：**"渲染成功"不等于"用户看得见"**。异步 API 里有一整类
"操作生效了，但生效在一个用户没在看的地方" —— `visibleTextEditors` 里的编辑器
**不是**一个可以随便往里画的画布。凡是"我要让用户看到 X"的代码，
先问一句：**它此刻在前台吗？**（D70 的"同一文件不重复打开"是同一件事的另一面：
那时是"别乱切"，这次是"该切就得切"。）

**验证数字**：`pnpm check` 全绿 —— **294 测**（core 40 + ext 228 + pdf 26）/
冒烟 74 + 151 + **80** + **9**（新增的 `smoke:fileswitch`）。

---

## D78 「讲进第二个文件就不能点下一步」= 把「文件被关」当成了「用户要结束」

**起因**：D77 修完之后用户回来说**还是卡**，而且给了更准的坐标 ——
「当前讲解第 2 段，从 `main.c` 进入 `main.h`，但是不能点击下一步，不能点击卡片。」
「点不动」+「面板变已结束」这两件事一起出现，指向的是**会话被 `stop()` 了**，不是渲染问题
（渲染坏了的话文字还在、按钮也还能点）。于是直接去搜谁会 `stop()` 一个活着的会话，
落点是 `commands.ts` 里那条 `onDidCloseTextDocument` 订阅。

**根因（一层套一层，第一次修错了方向）**：

真凶是这个组合：

1. 播放器用**预览标签**打开跨文件的目标（D69/D77 的 `preview: true`）。
   VS Code 的预览标签会被**下一个预览替换掉** —— 这是它存在的意义（"标签栏不会堆满"）。
   于是**「讲进第二个文件」这个动作本身**就会触发 `onDidCloseTextDocument(第一个文件)`。
2. 那条订阅的判据是「**关掉当前这一步所在的文件**就 `stop()`」。跨文件之后，
   当前步已经在新文件里了、被关掉的是**上一步**的文件 —— 判据**不成立**，
   所以第一版按这个方向排查时它其实没抓到人。

第一次修的时候把它收窄成「**关掉锚点文件**才 `stop()`」，以为这样"播放器临时打开的那些文件"
（`protocol.h`、`esc.h`…）就不会误杀了。**但这个修法是错的，而且错得很有教育意义**：

> 锚点文件通常**就是用户一开始在看的那一个**。预览轮换关掉的恰恰**常常就是它自己**。
> 收窄之后照样每讲进一个新文件就被顶掉一次 —— 症状一模一样。

**真正的判据不是「哪个文件被关了」，而是「关完之后还有没有得讲」。**

`onDidCloseTextDocument` 在**预览替换**和**用户主动关标签**这两种情况下的回调
**长得完全一样**（都是"这个 document 被关了"），唯一的区别是**下一刻那个文件还在不在可见编辑器里**：

- 预览替换 → 播放器马上又把锚点文件在别的标签里打开了 → **它仍然可见** → 讲解继续
- 用户主动关 → 它确实不在任何可见编辑器里了 → **停**

所以修法是**推迟一拍再决定**，触发器用 `onDidChangeVisibleTextEditors`：

```
onDidCloseTextDocument(main.c)      → 只记 pendingAnchorClose = true，不当场动手
onDidChangeVisibleTextEditors(…)    → 看一眼锚点文件还在不在：
                                        在 → 什么都不做（讲解继续）
                                        不在 → stop()（用户真的关掉了）
```

**为什么用「可见编辑器变了」而不是 `setTimeout`**：预览替换是 VS Code 在**一次**编辑器切换里
连着做的（关旧的、开新的），`onDidChangeVisibleTextEditors` 正好落在这件事**做完之后**，
是语义上的"切换结束了"；定时器等的是一个**猜出来的毫秒数**，慢机器上会早退（判早了）、
快机器上会白等。凡是"等某个异步动作做完"的需求，都要找**它自己的完成信号**，不要拿时间来代替。

**顺带修的一处**：`pendingAnchorClose` 必须随 `stop()` / 换会话一起清掉，否则上一轮的
"待定"会飘到下一轮去。这条和 D78 主体一起写进了护栏。

**新锁**（`scripts/smoke-walkthrough.mjs` 第 8、8b 节，不新开文件 —— 它测的就是这条订阅本身）：

- 第 8 节改成**新语义**：关完标签**再**触发一次"可见编辑器变了"，才期待 `session:end`。
- 第 8b 节真的复现用户那一幕：跨文件会话（锚点 `main.c`、步骤落在 `ring_buffer.h`）→
  模拟 `main.c` 被预览替换掉 → 断言**三种结局**：
  1. 关标签那一刻**不**当场结束（此时还分不出来）；
  2. 锚点文件仍然可见 → **会话继续**（这一条就是真凶）；
  3. 锚点文件真的不再可见 → **结束会话**（没有这一条的话，把 ② 写成"永远不停"也能过）。

**按规矩验过它能红**：把判据换回「收窄到锚点」那一版 → 第 8b 节立刻红 3 条，
指名 `session:end 次数 8 → 9` 与 `walkthroughActive` 被落成 `false`；
换成修好的判据 → 全绿。

**这次最该记住的一条**：**护栏必须朝「会红」的那个方向写。**
第 8b 节的**第一版**写的是"关掉 `protocol.h`（当前步所在文件）不许停" ——
那条旧判据**也不** stop，于是它恒绿、什么都没测出来，白写了一遍。
写回归测时要先问：**"如果 bug 还在，这条断言会不会红？"** 答不上来就是没写对。
（另一个近亲：D77 那次是"`revealRange` 生效了，但生效在没人看的地方" ——
这次是"回调收到了，但**收到的原因**不是我以为的那个"。两者都是**看着在动、其实没懂**。）

**连带发现**：`scripts/smoke-extension.mjs` 的 vscode 桩缺
`window.onDidChangeVisibleTextEditors`，而**它在 `activate` 期间就被订阅** ——
桩一缺，`activate` 直接抛，整份扩展根本没装上。这说明那份桩**漏掉过一次新订阅**
（D77 加 `#focus` 时没补，因为 `#focus` 用的是已经有的 API）。已补齐，并写了注释说明
"新订阅必须在 activate 期间存在"这条对桩的要求。

**验证数字**：`pnpm check` 全绿 —— 全部门（typecheck ×3、core/ext/pdf 单测、build ×2、
四个冒烟）逐一通过。冒烟从 80 条涨到 **93** 条（walkthrough 一节新增 13 条）。

---

---

## D79 「这段想重点讲什么」：选完范围之后问一句，那句话要真的进 prompt

**起因**（用户原话）：「设计一个环节，在上传选中的代码之前，让用户可以写一段话，这段话应该要使 AI
可以讲解特定的线 —— 因为一个文件可能做很多事，用户可能不想都听，只想快速定位某功能。」

问过他时机：**选完段之后再问**（而不是一上来就问）。他的场景是"我知道我要哪一段"，
早点问等于在范围还没定的时候就逼他说清范围里的重点。

**决策**：`capture` 的顺序改成 **确认范围 → 问重点 → 取件 → 讲解**。
`buildUserPrompt` 早就支持 `options.focus`，但从没人传进去 —— **一段死代码**，而单元测试全绿。

**四个刻意不做的地方**：

- **可以跳过**。回车 / Esc 都跳过，且跳过时 prompt **一字不能改**（那一节整个不出现，不留空壳）。
  这是可选项与必答题的区别：想整段听一遍的用户会凭空多一步，而他想说的正是"没什么特别想听的"。
- **Esc 在这里不取消讲解**。取消的入口是上一步那个范围确认框。相邻两个框里同一个键两种含义，
  用户按错一次就丢掉刚选好的段 —— 那种失败的代价太大。
- **提示语不写"请输入"**。占位符给一个例子（"比如：只关心空/满的边界判断"），
  第一次用的人并不知道该写多细。
- **首尾空白要清掉**。用户粘贴常常带空格，而 prompt 里一个前导空格会让那一节看起来像排版坏了。

**屏幕必须留得下痕迹**（这是这条决策真正的洞察）：那句话只进了 prompt，用户写完之后**再也看不到它**，
于是他会怀疑"到底生效没"。所以把它写进 `captureSummary()` —— 它是"说给用户听的一句话"的唯一
格式化处，于是面板与「显示状态」两处自动一致（D19："两处各写一遍会分家"）。

**新锁**（`scripts/smoke-walkthrough.mjs` 第 9b 节，11 条）：断言的是**发给模型的那条 user message**
里有没有那句话 —— 只测到"Anchor 上有 focus"是不够的，那段死代码当年就是这么蒙过去的。
跳过（`undefined`）与空串（`''`）两条都断言"那一节不在"。

**按规矩验过它能红**：把最后一跳（`focus: anchor.focus`）改回 `focus: undefined` →
恰好那 2 条关键断言红，其余全绿 —— 这才说明"最后一跳真的被锁住了"。

**状态**：生效。

---

## D80 多段选择：队列 + 合成**一份**讲解（用户选了「合成整体」）

**起因**（用户原话）：「现在只能上传连续的一段，没法分开上传多端。可以设计一个队列，一次一次选择。
我认为可以在左侧实时增减选择段。」

问过他语义：**合成整体**（多段属于同一个功能时，要讲出数据怎么在其中流动），
**不是**逐段各讲一遍 —— 后者会把一个功能切成 N 份互不相干的说明，那还不如分别多选几次。

**决策**：

- 四条命令：`addSegment`（加入）/ `removeSegment`（移除某一段，走 QuickPick）/ `clearSegments`（清空）/
  `explainSegments`（讲）。讲的路径是：**问重点 → `mergeSegments` → 走原有的 `explain`**。
- 开始面板多一组「多段选择（队列）」+ 一条状态行；每加一段、每删一段都 `refreshStart()`，
  于是"左侧实时增减"这一句**看得见** —— 那一行的文案就是 `describeQueue()`。
- **加了当场按行号排**（`compareSegments`，全仓只此一个比较器）。为什么要这么做，见下面那一节。
- 换文件时给「清空 / 取消」二选一，而不是攒到四五段之后在最后一步报错。
- 给模型看的原文**标号**，并明写"段与段之间的行没被选中"。

### 这条之所以值得单独记：同一个「第 1 段」在三处指三段代码

它是写端到端冒烟时**自己红的**，不是我推理出来的：

- 队列按**加入顺序**排：用户先选 rb_pop（40-48）、再选 rb_init（21-25） → 清单里「第 1 段」= 40-48；
- `mergeSegments` 按**行号**排 → 发给模型的「第 1 段」= 21-25；
- 于是用户点掉"第 1 段"，删掉的是他以为的第 2 段。**不报错、不崩，只是讲错了地方。**

修法是**在队列里就排**（加完当场排），而且比较器只有一个 —— 不是"merge 时排一遍、显示时再排一遍"。
它与 D78 是同一类错：**看着在动、其实没懂**（回调收到了，但收到的原因不是我以为的那个）。

### 另外三个定下来的地方

- **`Anchor` 加 `segments?: CodeLocation[]`**：多段的 `location` 只能是**并集的外框**（那些行本来
  就是文件的真实内容），但"哪些是用户选的"必须用字段说出来 —— 否则模型会把中间的空隙当代码讲。
  顺着同一条道理，显示那句也要同时给出外框与那几段：只显示外框等于替用户改写了他选的范围。
- **一次讲解只有一个锚点文件**（`sameFileAsFirst`）：锚点文件那一整套语义（D78 的收尾判据、
  "这次讲解到头了"的判据）都是按一个文件写的；跨文件那条路已经由取件那一跳在做，不为队列破例。
- **默认键 `ctrl+shift+q`（`when: editorTextFocus`）**：攒队列是一条**要连按好几次**的路
  （选中 → 按 → 再选 → 再按），手不该回到面板上去找按钮。给了默认键，就要在 `WALKTHROUGH_CHORDS`
  里登记 —— 那条逐字比对 `package.json` 的锁当场就红了（键位 8 条 vs 表里 7 条）。

**新锁**：core 的 `segments.ts` 单测（合并、排序、标号、空队列、跨文件拒绝、`segmentsOf` 守卫）；
`startModel` 的队列组与状态行；`describe` 的多段显示；链式冒烟第 9c 节 9 条端到端断言
（加完有回执、两段原文都真进了 prompt、标号且按行号排、明写"不必讲它们"、多段也能接 D79 的重点、
「显示状态」能复核、待移除清单的顺序、移除后队列变短并且说出来）。

**验证数字**：`pnpm check` 全绿 —— typecheck ×3、三份单测、build ×2、四个冒烟 43 / 90 / 8 / 52 条。

**状态**：生效。

---

## D81 「加入队列有反应但没有任何提示」= 提示长在用户没看的地方

**起因**（用户原话）：「加入队列，虽然下面的按钮有反应，但是没有文本什么的提示，感觉不妥，
要么持续性图形显示加入了多少，要么每加一次给一个成功提示。」

**病根不是"没提示"**。回执一直有（状态栏那句 3 秒的临时消息），问题是它长在三处用户都不会看的地方：

| 提示 | 它在哪 | 为什么用户看不到 |
|---|---|---|
| 状态栏临时消息 | 屏幕最下面 | 3 秒后就没了；而且他刚点完按钮，视线在**按钮**那一片 |
| 面板上「多段队列」那一行 | 面板**最下面**（要滚动） | 那颗按钮在面板上部，中间隔着五组动作 |
| 开始面板的按钮反馈 | —— | 按钮按下去**本来就**有视觉反馈（这是用户的原话"按钮有反应"） |

他连着按了两次（第二次是因为"第一次没反应"），于是队列里多了两段同样的范围。
**"点了没反应"和"提示在别处"在用户眼里是同一件事**（D63/D64 的同一条）。

**决策**（两条一起做，缺一不可）：

- **持续可见**：新增一个**常驻**的状态栏计数项（`$(list-ordered) 队列 N 段`，优先级 99，
  在讲解那一项下面），队列空时**隐藏**。点它 = 打开开始面板（顺着它就能去讲）。
- **一次性的回执**改成说清三件事：**进了哪一段**（行区间）、**现在共几段**、**接下来会怎样**
  （"讲的时候会合成一份"）。只写"已加入"是不够的 —— 用户此刻真正想知道的是"我攒的这些最后会怎样"。
- 分组标题也带上数量（`多段选择（队列） · 已有 2 段`）：它就在**他刚点的那颗按钮正上方**，
  滚都不用滚。

**为什么计数要单独做成一个状态栏项，而不是复用"上次捕获"那一行**：那一行说的是别的事，
两件事挤一行就变成一句话里两个数，用户得先分辨哪个是哪个（D19："两处各写一遍会分家"的翻版）。

**这条护栏自己先红过一次（值得记）**：写完冒烟后 9 条断言全红，而**返回值看起来全是对的**
（`已加入第 40-48 行 —— 队列里现在有 1 段`）。查下去发现是我在冒烟里**插重了一段 ②**：
第一段的期望写成了 `/已加入第 1 段/`（回执里根本没有"第 1 段"这个词），后面那段却还在断言第一段的期望值。
于是队列被加了 3 段（21-25 重复两次），后面 7 条连锁失败。
**教训**：断言红的时候先看"返回值对不对"，再怀疑产品 —— 这一条正好演示了
"红的不一定是产品，也可能是我自己的测试"。它顺带暴露了一个真问题：**同一段连按两次会静默变成两段**
（见下面「刻意不做」）。

**刻意不做**：**没有**给重复加入去重。用户按两次就是两次（`addSegment` 里那句话是有意写的），
替他"聪明地"丢掉一次反而让他怀疑队列没生效 —— 而现在计数是常驻可见的，
"队列里现在有 2 段"这句话本身就能让他看出重复（**失败看得见**之后，去重就不是必需的了）。
这一条留给用户的判断：如果实测下来重复加入更常是误操作，就该反过来改成"这一段已经在队列里了"。

**新锁**：`startModel` 的队列计数标题；冒烟第 9c 节的常驻计数断言（`statusItems[1]` 从 1 段变到 2 段）；
`smoke-extension` 的"队列那一项开局必须是隐藏的"。

**状态**：生效。

---

## D82 跳转文件后仍显示「讲解已结束」= D78 的判据假设了一个不成立的前提

**起因**（用户原话）：「我发现，跳转文件讲解，下面也显示讲解已结束。」

这条比 D78 那次更隐蔽：**D78 的护栏在替身里是绿的，在真 VS Code 里却是红的**。原因不是判据写错，
而是**它依赖了一个不存在的事实**。

D78 的判据是：关标签那一刻不确定，**推迟一拍**再看"锚点文件还在不在可见编辑器里"——
在就继续，不在就停。那段注释里写着理由：「锚点文件重新可见了（播放器把它又打开了）」。
**而播放器只开当前这一拍的焦点文件**，没有任何理由把落单的锚点文件再打开一次。于是：

1. 用户在 `main.c` 里选中一段发起讲解（`main.c` 是他单击打开的 → **预览标签**）
2. 讲到第 2 步，这一步落在 `main.h`，播放器用**预览标签**打开 `main.h`
3. VS Code 的预览替换**关掉了 `main.c` 的标签** → `onDidCloseTextDocument(main.c)`
4. 推迟一拍后回头看：`main.c` 不在任何可见编辑器里（`main.h` 顶了它），**而且它不会回来**
5. → 判定"用户关了锚点文件" → `stop()` → 面板底下出现"讲解已结束"

**决策**：把问题换掉。不再问"锚点文件还在不在"，而问 **"这次讲解还有没有落脚点"** ——
锚点文件、**以及当前这一拍要讲的那个文件**（`location` 与每个子高亮的 `location`），
**全都不可见时才停**。

**为什么这条判据不会再错**：预览轮换**必然**把新文件留在屏幕上，所以"这一拍的文件可见"对轮换免疫。
这不是"更小心地猜同一件事"，而是**不再依赖"锚点会回来"这个假设**（假设没了，那类 bug 就没了）。
副产品是它**更贴合契约 §4.2 的原话**（"正在讲的那个文件被关掉"）：用户在当前讲 `main.h` 时
手动关掉 `main.c`，现在不收工 —— 因为正在讲的是 `main.h`。

**怎么验它真的会红**（这条很关键）：改完之后第一次跑冒烟时**忘了重新打包**，
跑的还是旧 `dist` —— 那一次恰好就是 `FAIL D82：… session:end 次数 8 → 9`。
换上新的 `dist` 才转绿。**"旧代码 → 红 / 新代码 → 绿"这一对实测值就是这条护栏的效力证明**，
比任何"我觉得它应该能测出来"都硬。这也是 STATE 里那条操作注意的由来：**改完源码必须 `pnpm build` 再跑冒烟**。

**刻意不做**：**没有**改成"永远不停"。原行为（关掉正在讲的文件 → 主动结束会话）是契约 §4.2 的一部分，
所以新护栏写成了**三向**的：① 锚点仍可见 → 继续（在自己文件里换步）② 锚点没了但这一拍的文件还在 → 继续
③ 两个都没了 → 停。只写前两条等于把真行为删掉，只写第三条就是原来那个 bug。

**新锁**：冒烟第 8b 节的三向断言（含"护身符"式的 ③：会话真的没了才算停）。

---

## D83 「讲完能重讲」+「保存 / 重放之前的内容」

**起因**（用户原话）：「讲解结束时，需要能重新讲，并且应该能保存/重放之前的内容。」

在这之前，一份讲解是**一次性的**：讲完（`done`）或按了退出（`idle`）之后，那份 `ExplanationResult`
只活在 webview 的 DOM 里 —— 面板一关、VS Code 一退，几十秒的等待连同花掉的 token 一起没了，
想再看一遍只能重新问一次模型。而且 `done` 之后「下一步」按不动了，**面板上一个出口都没有**：
只能回编辑器重新选一段再按快捷键，而用户正看着面板（D61/D72 同一条规矩：讲完不许是死路）。

**决策**：两条**分开**的能力，别合成一个按钮 —— 它们的代价差一个数量级：

| | 做什么 | 花不花钱 | 结果 |
|---|---|---|---|
| **重放上次讲解**（`anchorExplain.replayLast`） | 把存档原样从第 1 步再走一遍 | **不碰网络** | 与上次**逐字相同** |
| **重新讲一遍**（`anchorExplain.reExplain`） | 同一个锚点再问一次模型 | 再花一次钱 | 会得到另一种讲法 |

用户说的"重新讲"两件事都可能指，**所以我不替他选**（合成一颗按钮 = 替他决定要不要再花一次钱）。

**落地**：

- 存档 = `{ result, anchor, savedAt }`，写进 `context.workspaceState`（**跨 VS Code 重启活着**）——
  用户重启之后按「重放」还放得出来。`session/lastRun.ts` 是纯函数（不 import 'vscode'），
  Memento 由调用方读好再传进来，于是能被 `node --test` 直测（D19）。
- **只在 `runExplain` 成功那一刻写**：这份数据的意义是"我能不花钱再放一遍刚才那一份"，
  所以它必须是**用户真正看过的那一份**，不是某个中间态。写失败（工作区只读 / Memento 满了）
  只少一个功能，**绝不许影响讲解本身**，所以整段包在 try 里。
- 入口三处：讲解面板底部两颗按钮（`done` **与** `ended` **都**给 —— `done` 是最常见的那个时刻，
  而当时面板上确实什么都没有）、开始面板「这次讲解」组两颗动作、
  以及两条真命令（命令面板 / 将来绑键位）。
- **存档的形状版本**（`version: 1`）对不上就**丢掉**，不尽力兼容：它可能是**上一个版本的我们**
  写的，硬读的话最先炸的是渲染层，而那里离"存档是旧的"这个真因很远。
  坏掉**一个子高亮**只丢那一个（配色是装饰性字段，§3.3 同一条）；**一个 step 都不剩**才整份作废。

**为什么加了一个协议消息而不是偷偷复用 `ui:next`**：面板是外部输入。让面板能带参数指定"放什么"
等于让外部输入决定渲染内容（§5.5「只回传动作 id」是同一条立场），
所以 `ui:replay` / `ui:reExplain` 都是**无参**消息 —— 要重放哪一份、要重新问谁，全由宿主按存档决定。

**新锁**：`lastRun.test.ts`（10 条：往返逐字相同、版本不符 / 形状坏 / 锚点坏 / 空 steps 一律丢弃、
坏子高亮只丢一个、emphasis 非法不作废、PDF 锚点也存得下、键名钉死）；
`startModel` 的"没有存档时两颗按钮灰掉且说清先去讲一次"；`protocol` 的无参消息放行；
`sidebarClient` 的两颗按钮与 act↔消息的配对锁；冒烟第 8d 节 10 条端到端断言。

**那条"不花钱"的断言是这一节的重点**：它断的是**模型调用次数为 0**，
而不是"面板上出现了文字" —— 后者在"其实是又问了模型一遍"时同样成立（D79 死代码那条教训的同一形状）。
反面同样钉住（`ui:reExplain` 必须真的产生模型调用），否则把两颗按钮都实现成重放也能过。

**验证数字**：`pnpm check` 全绿 —— typecheck ×3、三份单测 48 / 244 / 26、build ×2、
四个冒烟 43 / 90 / 8 / 52 条（其中链式冒烟新增 D82 三向 + D83 十条）。

**状态**：生效。

---

## D84 「切回锚点文件又死了」= 拿屏幕某一瞬间的样子下了判断，而那一瞬间是**我们自己造成的**

**起因**（用户原话）：「还是有问题，现在是有些文件可以切，但是切回 main.c（我第一次上传的文件），又死了。」

D82 把判据从"锚点文件还在吗"换成"**这次讲解还有没有落脚点**"之后，**换成别的文件**不再误判收工了。
但"**切回来**"这条路上还留着两个彼此独立的坑，都能让同一条判据在错误的时刻开火：

1. **窗口期**：VS Code 的一次预览轮换是"**先关旧的、再开新的**"两件异步的事，中间有一帧**两个文件都不可见**
   （关标签的回调先到，可见性变化的回调后到）。判据若正好落在这一帧上，看到的画面与"用户把两个文件都关了"
   **长得一模一样** —— 于是把"**我们自己换文件**"读成了"用户收工了"。
2. **误立案**：`onDidCloseTextDocument` 对**任何**文档关闭都记 `pendingAnchorClose = true`。用户随手关一个
   与本次讲解毫不相干的标签，之后**任意一次**可见性变化（很可能是播放器自己在换文件）都会去判一次 ——
   这次无关的关闭就此**迟到地、在别处**引爆。

两件事叠起来正好是用户看到的那一幕：能切出去（D82 已修），切回来时踩到窗口期或误立案 → 面板底下又冒出"讲解已结束"。

**决策**：判据本身（D82 的"有没有落脚点"）不动，改的是**什么时候允许它开火**：

- **问一句"这件事是不是我们自己造成的"**：`CodeWalkthroughPlayer` 把自己的换文件状态暴露出来 ——
  `get switching(): boolean`（正在开/关文件时为 `true`）。宿主只要看到 `player.switching` 就**推迟**判定，
  **且不消费掉立案标记**（消费了就再也没机会判了 —— 这是写这段时最容易犯的错），等屏幕落定再判。
  预览轮换是预览标签的固有行为，但"轮换**中间**那一帧"是**我们**造成的，所以该由**我们**来宣告"这期间别下结论"。
- **落定是一个明确的信号，不是猜时间**：`render()` 在**启动下一次 render 之后**才调 `#markSettled()`
  （顺序是刻意的：先让 `#switching` 归位、再通知），`revealStep` 在 `finally` 里也调一次；对外是
  `onDidSettle(listener): () => void`。宿主订阅它来补判一次。这与 D78 的立场一致 —— 找**语义上**的完成信号，
  不拿毫秒数代替（约束 102）。
- **只在"与本次讲解有关的文件"上立案**：新增 `sessionFiles()` = 锚点文件 + 每一步的 `location`
  + 每个子高亮的 `location`。`onDidCloseTextDocument` 里先问"这个被关掉的文件值不值得立案"，
  不值得就记一行日志走人（`关文件：X —— 与这次讲解无关，不立案`）。
- **判定只剩一处**：`evaluateSessionEnd()` 是本扩展里**唯一**决定"这次讲解要不要收掉"的地方；
  `onDidChangeVisibleTextEditors` 与 `onDidSettle` 都只是它的触发源。这样"谁在什么时候判"是可枚举、可日志复核的，
  而不是散在几个回调里的隐式约定。

**为什么不是"把 timeout 调大一点"**：窗口期的长度取决于预览标签何时真正换完，是个**我们控制不了、也不该猜**的量
（约束 102 的同一句话）。把它换成"**我们换完了**"这个**我们自己发得出**的信号，才不依赖时序运气。

**顺带修掉的一个"假的绿"**：写这次护栏时发现 `smoke-walkthrough.mjs` 的 vscode 桩把 `openTextDocument`
放在了 `window` 命名空间下，而**真实 API 是 `workspace.openTextDocument`**。播放器那句
`try { openTextDocument() … } catch { return undefined }` 于是**静默降级**了 —— 跨文件"把目标文件开到屏幕上"
这条路**在桩里根本没跑过**，之前那个版本的冒烟是"**比真实情况更绿**"的（D82 的同一类陷阱，见约束 111 / 112）。
挪到 `workspace` 之后，这条路才第一次真的被测到。

**新锁**（护栏必须"会红"才算存在，约束 103）：

- **链式冒烟第 8b-2 节（9 条）**：⑤ 前置（播放器确实卡在"正在打开文件"那一刻，`showTextDocument` 被挂住没返回）；
  中间态关掉正在讲的文件 → **不收工**；**日志里留下"播放器正在换文件 → 推迟"的痕迹**（证明走的是对的那条分支，
  而不是"碰巧没判"）；释放之后 → 照旧继续；与讲解无关的文件被关 → **不立案**；**切回锚点文件 → 讲解继续**
  （这正是用户报的那一幕）；关闭与可见变化**反序**到达 → 也不收工；锚点与这一拍的文件**真的都不在了** → **仍然收工**。
- **换文件冒烟第 7 节（4 条）**：换文件期间 `switching === true`、换完落回 `false`、换完有"落定"回调、
  并且这一跳确实把 `protocol.h` 切到了前台。
- **反面同样钉住**：`⑦-negative` 断言"两个文件真没了就结束会话"，否则"**永远不收工**"这种退化实现也能过（约束 103）。

**红→绿实测**（约束 112 要的那一对）：临时把 D84 的两个分支注释掉
（`player.switching === true && false` 与 `false && !sessionFiles()…`），**重新打包**后跑链式冒烟 →
首跑 6 条 FAIL（`session:end 次数 10 → 11`，正是"旧代码在这里会 +1"）；恢复后全绿。
这一对的"红"不是推理出来的，是跑出来的。

**验证数字**：`pnpm check` 全绿 —— typecheck ×3、三份单测 48 / 244 / 26、build ×2、
四个冒烟 **48 / 111 / 11 / 52** 条（链式冒烟新增 D84 九条 + 换文件冒烟新增 D84 四条）。
（说明：前面几节记的冒烟条数是照着**换行被合并过的**日志数的，偏低；这一节起按干净重定向的输出重数，
所以总数比 43 / 90 / 8 / 52 高，差额不是新加的断言。）

**状态**：生效。

---

## D85 分发形态：`.vsix` 本地安装 + 线1 专有许可 / 线2 Apache-2.0

**起因**（用户原话）：「把这个插件变成可分发的形式，注意不要带我的key等信息……最好是类似一个安装程序，然后分发权在我手里，别人不能二次分发。不带源码。」

**决策**：

1. 分发形态 = **`.vsix`**（VS Code 的安装包，双击即装），**不上架 Marketplace**。操作手册见 `docs/DISTRIBUTION.md`。
2. **包里不带源码**：两份 `.vscodeignore` 收紧，且打包脚本会把产物读回来核"禁带"清单。
3. **包里不带任何 key**：key 的正道是 `SecretStorage`（每台机器装完后由使用者自己存），打包脚本再把每个 entry 解压出来扫一遍密钥特征。
4. 许可分层：线1 改**专有**（`LICENSE.txt`，禁止再分发）；线2 **必须**留在 Apache-2.0。

**为什么线2 做不到"别人不能二次分发"**：它是 `mathematic-inc/vscode-pdf` 的 fork（Apache-2.0），
Apache-2.0 §4 本来就授予**拿到的人**复制与再分发的权利；把 Apache-2.0 的衍生物改成
"All rights reserved" 等于违反上游许可。把 Apache-2.0 组件**打进**专有产品是允许的
（线1 打包了 `pdfjs-dist` 就是这么做的），但前提是保留它的许可与署名。
所以"只有我能分发"能做到的程度是：**线1 可以；线2 只能靠"不发它"来做到**。

**为什么许可条款不等于技术锁**：LICENSE 约束的是愿意守约的人和争议时的意思表示，
不阻止任何人复制一个文件。真正降低被转发的手段是**私下给、不放到公开下载页**。
这不是缺陷陈述，是必须写清楚的现实 —— 把"许可"说成"防分发"就是又一次"假话"（D73 同类）。

**落地**：

- 两份 `.vscodeignore` 收紧。**线2 此前漏了 `test/**`** —— 测试代码差一步进包，这次一并堵上。
- 线1 新增 `LICENSE.txt`（专有 EULA，内含"第三方组件不受本协议约束"一节），
  `license: "SEE LICENSE IN LICENSE.txt"`；两线版本 `0.0.0` → **`0.1.0`**（分发出去的包得有像样的版本号）。
- 新增 `scripts/package-vsix.mjs`：调 vsce 打包 → **读回 `.vsix`** 核结构 / 必带 / 禁带 → 解压扫密钥。
  四道门任一红则退出码 1。判据读**产物本身**而不是排除表 —— 排除表写错的症状是"包里悄悄多了源码"，
  那种事事后最难发现（同 D82 的"不读中间态、读事实"）。
- `pnpm package:vsix`（/ `line1` / `line2`）；`pnpm-workspace.yaml` 放行 `@vscode/vsce-sign`；
  `@vscode/vsce` 进根 `devDependencies`。

**vsce 的两个改名**：`README.md` → `readme.md`、`LICENSE` → `LICENSE.txt`。
**必带清单必须按包里的名字写**，不是按盘上的名字写 —— 这是这次实跑出来的，不是猜的。

**vsce 的一个真报错**：README 里有相对链接而 `package.json` 没有 `repository` → 打包失败。
处理：把那条链接改成代码块，**不塞假 repository**（D53 删 `repository` 的理由不变：
写在那里会让"这是谁的仓库"变成误导）。

**pnpm 11 的一个新坑**：`@vscode/vsce-sign` 有构建脚本，pnpm 11 只要发现"有未批准的构建脚本"
就让 `pnpm install` 以 1 退出 —— 于是 `pnpm exec` 全线报错。放行它（`allowBuilds`）即可。
`pnpm-workspace.yaml` 里那行占位 `set this to true or false` 就是 pnpm 自己插的，
这次才算真正填掉。

**验证**：`pnpm package:vsix` 全绿 —— 线1 12 个 entry / 3.09 MB，线2 415 个 entry / 4.62 MB；
禁带零命中、密钥扫描零命中、必带与 manifest（Id/Version/Publisher）全对。

**状态**：生效。

---

## D86 publisher 换成作者本人 + 安装包里的 README 换成用户版

**起因**（用户原话）：「把作者改成我的 github 名称：Fish-zjuer」「你的插件界面，漏的信息有点太多了」
—— 后者指的是扩展详情页渲染出来的 README：**源码入口表、`src/...` 路径、pnpm 命令、切片编号全带出去了**。
不带源码 ≠ 不带"源码的说明书"；这份 README 等于把仓库的地图交了出去。

**决策**：

1. **publisher `anchor` → `Fish-zjuer`**（两个包都改）。扩展 ID 随之变为
   `Fish-zjuer.anchor-explain` / `Fish-zjuer.anchor-pdf`。**命令与设置命名空间
   `anchorExplain.*` / `anchorPdf.*` 不变** —— 用户设置不受影响。
2. **安装包里的 README 换成用户版**（`README.dist.md`，每个包一份，打包时
   `vsce package --readme-path` 指过去；`README.dist.md` 本身进 `.vscodeignore` 不随包重复出现）。
   仓库里的 `README.md` 仍是开发文档，一行不动。
3. 顺带把 `THIRD_PARTY_NOTICES.md` 里唯一一处源码路径改成了"产物末尾的 `/*!` 注释"
   —— 这份文件随包分发，不该指着自己的源码文件说话。

**为什么 publisher 一改就牵连三处源码**：两条线互查对方装没装用的是**硬编码的扩展 ID**
（`commands.ts` 的 `PDF_EXTENSION_ID`、`pdf-viewer-provider.ts` 的 `PEER_EXTENSION_ID`），
对端提示语里也印着旧 ID。ID 是跨扩展协议的一部分 —— 这正是 D68 说的
"两处各写一遍会分家"的又一形态：改 ID 不改对端查法，功能会静默变成"永远提示未安装"。
所以这次连测试与三份冒烟里的 ID 一起改（`startModel.test.ts` 断言提示里带新 ID，
`smoke-pdf-extension.mjs` 断言 publisher === 'Fish-zjuer'）。

**换 ID 的实际代价（写给将来）**：

- **SecretStorage 按扩展 ID 隔离** —— 换 ID 后要在新扩展里**重新存一次 API Key**；
- `anchorExplain.*` 设置是全局的，不受影响；
- 旧 ID 的目录联接（`~/.vscode/extensions/anchor.*-0.0.0`）不会被 `pnpm unlink:ext` 认出
  （它按当前 manifest 算目录名），要手动 `cmd /c rmdir` 删掉联接（只删联接，不碰源码）；
- 步骤都写在 `docs/DISTRIBUTION.md` §3。

**为什么不改命令命名空间**：`anchorExplain.*` 出现在键位、设置、文档与用户肌肉记忆里，
改它一次的代价是所有用户的所有配置作废，换来的只是"名字更统一" —— 不值。

**验证**：`pnpm check` 全绿（ID 改动后冒烟与新断言全过）；`pnpm package:vsix` 全绿，
详情页 readme 来自 `README.dist.md`。

**状态**：生效。

---

## D39 的更正：`engines.vscode` 应当是**范围**，`@types/vscode` 才是精确值

原 D39 写的是"`engines.vscode` 与 `@types/vscode` 必须写成同一个具体版本（不带 `^`）"。
**后半句对，前半句错**，三份文档（D39 / CONTRACTS §9.5 / STATE 约束 14）都照着错的写了，
而 `packages/extension-anchor/package.json` 一直是 `engines.vscode: "^1.90.0"` —— 它是对的。

正确的规则：

| 字段 | 应当写成 | 为什么 |
|---|---|---|
| `engines.vscode` | `"^1.90.0"`（**范围**，下界 = 我们实际支持的最低版本） | 它是给**使用者**看的兼容范围。钉成 `"1.90.0"` 等于宣布"只在恰好 1.90.0 上能装"，用户升到 1.91 就装不上 |
| `devDependencies.@types/vscode` | `"1.90.0"`（**精确值，无 caret**） | 它是给 `tsc` 看的 API 面。写 `^` 会让类型漂到最新版，`tsc` 静默放行 1.90 上不存在的 API |

不变式是：**`@types/vscode` 必须精确等于 `engines.vscode` 的下界**，
而不是"两个字段的字符串相同"。`vsce` 那条 `@types/vscode ≤ engines.vscode 下界` 的守卫
在两个值相等时通过，所以这套写法既过守卫又不骗用户。

**这次是谁发现的**：独立只读校验（D32）按文档去核对源码，报了"M1：`engines.vscode` 带 caret，
违反冻结约束"。**核对下来是文档错了，不是源码错了** —— 所以改的是文档。
这正是 D32 想要的效果：一个外部视角按你写的规则逐条验，错了就是错了，不管错在哪一侧。

**状态**：生效（原 D39 前半句作废，后半句继续有效）。

---

## D48 游标改成「拍」：整块底色 + 一个荧光在块内逐点扫描

**决策**：`WalkthroughSession` 的游标从"第几步"换成线性的**拍**。一个 step（n 个子高亮）占
n+1 拍：**第 1 拍只铺块级底色**，之后每拍点亮一个子高亮；`next()` 推进一拍。
`planForStep(step)` 随之换成 `planForBeat(step, pointIndex)`，`pointIndex = -1` 表示"只有整块"。

**理由**（用户看过第一版之后的原话）："荧光不够统一，隔行就变颜色，按理说不应该。
应该浅色荧光包住整个块，然后再来一个荧光扫描内部逐一小逻辑点。"

第一版把**同一个 step 的所有子高亮同时点亮**，于是 40/41/42 三行出现三种混合色
（40 = 块底 + 上下文底，41 = 只有块底，42 = 块底 + 定义底 + 描边），看起来就是"隔行乱变"。
改成一次只点亮一个点之后，块级底色**恒为均匀**，那唯一一行亮色就是"扫描位置"而不是噪声 ——
用户提的诉求本身就是这个 bug 的修法：不是调色，是改点亮策略。

**连带的三处**：

- `PLAY_INTERVAL_MS` 2600 → **1600**：现在一拍 = 一个扫描点，间隔太长会显得拖。
  按播放键就能看到荧光在块内自动扫过去 —— 这才是"扫描"的字面形态。
- **`session:update` 追加 `pointIndex`**（§5.3 的第二个附加字段，也是 S1 的第三个契约新增）。
  非加不可：侧边栏原来自己用 `index >= total - 1` 判断"是不是最后一步"来决定禁用「下一步」，
  改拍之后这个判断会在最后一步的**第一拍**就把按钮按死，而后面还有几个扫描点没走完 ——
  这是写单测时顺出来的真 bug。拍总数客户端能用 `result` 自己算，所以只传 `pointIndex` 一个字段。
- 侧边栏把"正在扫的那个点"标出来（`▸` + 高亮行 + 「第 1/2 个逻辑点」徽章），
  这样面板文字与编辑器里的亮色对得上。

**代价**：同样的内容按键次数变多（fixture 的 3 步共 9 拍）。但"更细"正是用户要的，
而且 `Ctrl+Shift+Space` 播放可以自动扫完。

**状态**：生效。

---

## D49 「讲解失败」与「渲染失败」必须分开；状态先置、渲染面各自隔离

**决策**：四处结构调整，都是用户报的"按 Esc 没反应、后面都没法测了"逼出来的。

1. **`stop()` 先收状态、再清视觉**：`unsubscribe` / `dispose` / 两个 context key / 状态栏
   全部先落定，最后才 `player.clear()`，且清框这一步被 try/catch 包住。
2. **`emit()` 先置 context key，三个渲染面各自 try/catch**（`isolated()` 只记日志，不向上抛）。
3. **`explain()` 里 `startSession` 移到 try 之外**：只有 provider / 校验的失败才算"讲解失败"；
   一旦拿到合法的 `ExplanationResult`，渲染面的异常不许把它当失败丢掉、更不许顺手把
   `sessionOpen` 落成 false。
4. **`CodeWalkthroughPlayer.clear()` 逐编辑器兜异常**，并跳过 `document.isClosed` 的编辑器。

**理由**：用户"做了很多别的操作"之后按 Esc 没反应、后续都没法测 —— 最可能的路径是
**编辑器在讲解期间被关掉/切走，`setDecorations` 抛异常，异常从 `clear()` 逃到 `stop()`，
把后面的收尾全跳过了**：框还在、状态栏还说"讲解中"、context key 却没落回，
会话卡在"谁都清不掉"的半死状态。更阴的是第 3 条：渲染面一抛，`explain` 的 catch 会把
刚拿到的讲解当成失败丢掉，**并把 `sessionOpen` 关掉** —— 于是 ESC 从此失效。
这两条叠起来正好解释"状态栏找不到 + ESC 没反应"同时出现。

**为什么这不是"把异常吞掉"**：`isolated()` 与 try/catch **都记日志**（`console.error`），
而且顺序被安排成"状态永远先落定、视觉失败不影响状态"。它限制的是爆炸半径，不是掩盖问题。
回归测在 `scripts/smoke-walkthrough.mjs` 第 7、8 节（模拟编辑器已释放、`setDecorations` 直接抛、
以及真的触发 `onDidCloseTextDocument`）。

**状态**：生效。

---

## D87 开源到 GitHub：整仓 Apache-2.0（D85 的"专有分发"作废）

**起因**（用户原话）：「我改了想法了，开源到github上吧。挂到我的号上。」

**决策**：

1. **整个仓库以 Apache-2.0 开源**，挂到 `github.com/Fish-zjuer/anchor-explain`。
2. **线1 的许可从专有 EULA 改回 Apache-2.0**：根目录新增 `LICENSE`（原文）与 `NOTICE`
   （第三方组件与派生来源），`packages/extension-anchor/LICENSE.txt` 换成 Apache-2.0 原文
   （它随 `.vsix` 分发，包里那份也必须是正确的许可），`package.json` 的
   `license` 从 `SEE LICENSE IN LICENSE.txt` 改回 `Apache-2.0`。
3. **D85 里"别人不能二次分发"的目标作废** —— 源码公开之后这条在事实上不成立，
   继续写在文档里就是从"现实"变成"假话"（D73 同类）。现在保留的是署名权、商标，
   以及再分发时必须带 `LICENSE` / `NOTICE` 与署名的义务。
4. **两线统一 Apache-2.0**，不是"随便挑一个"：线2 是 Apache-2.0 的 fork，把 Apache-2.0 的
   派生作品再套一个更严或更松的许可都会产生条款冲突（MIT 缺 Apache 的专利授权与
   "声明改动"要求）；统一最省事，也最诚实。

**开源前做的清理（都是"别把不该公开的东西公开"这一类）**：

- `packages/extension-anchor/README.md` 里 **4 处 `C:\Users\<本机用户名>`**（本机用户名）
  换成 `<仓库根目录>` / `code .`。开发文档照常公开，但本机路径不是给别人看的。
- **密钥扫描**：扫全部已跟踪文件，命中的只有冒烟脚本里的**假值** `sk-from-secret-storage`；
  再查全部历史提交的路径，`.env` / 凭据类文件**从未进过库** → 历史是干净的，
  可以直接公开（不需要重写历史来洗掉密钥）。
- `.gitignore` 补 `.tmp-*.py` / `.tmp-*.bin`（原先只有 `.txt` / `.json`，
  临时脚本会冒出来污染 `git status`）。
- `release/` 与 `*.vsix` 本来就被忽略，不会上传；`packages/*/dist/` 同理。
- 两线 `package.json` 补 `repository`（指向 GitHub），顺带**根治**了 D85 时遇到的
  vsce 报错 `Couldn't detect the repository…`（当时只能把 README 的相对链接改成代码块绕过）。

**刻意保留的部分**：`docs/` 下的 DECISIONS / STATE / CONTRACTS 全部公开 ——
它们就是这个项目的过程记录，藏着反而让仓库变得不可理解；D85 / D86 原文不改，
只在"已被取代"表里标注，历史决策就是历史决策。

**状态**：生效。

---

## D88 对外英文入口：`README.en.md` + `CONTRIBUTING.md`

**起因**：D87 把仓库公开到了 GitHub，但**全部文档是中文** —— 中文读者照 `README.md` 上手没问题，
英文读者（以及想提 PR 的人）面对的是一份读不懂的决策日志。开源不只是"把代码放上去"。

**决策**：

1. 新增 **`README.en.md`**（英文版，与中文 README 内容对齐：命题、两线分工、从源码起环境、
   首次配置三步、键位表、仓库结构、命令表、文档地图、许可与第三方署名），
   中文 `README.md` **仍是主入口**，只在顶部加一行互链 —— **不把主 README 换成英文**
   （这个项目的使用者、作者、决策记录都是中文，主入口换了等于把主场让出去）。
2. 新增 **`CONTRIBUTING.md`**：起环境、`pnpm check` 这道门、**冒烟为什么读产物不读源码**、
   "单独跑冒烟前必须先 `pnpm build`"（约束 112）、`core` 不许 import `vscode`、
   替身只许在最外层、改类型必须同改 CONTRACTS、线2 不许改 `assets/pdf.js/`。
   这些条条**全是从踩过的坑里长出来的**，不写给外人看就只在我们脑子里。
3. 两份文档都**如实说明仓库是中文工程日志**（含踩过的错），不粉饰成"整洁的开源项目"。

**状态**：生效。

---

## 已被取代 / 已废弃（保留记录，勿重蹈）

| 原计划 | 取代者 | 说明 |
|---|---|---|
| 线1 专有许可（`LICENSE.txt` EULA，禁止再分发） | D87 | 改主意开源：整仓 Apache-2.0，"只有我能分发"不再成立 |
| MCP server 双出口 + `SocketBridge` + `RenderBridge` | D14 | 单机单进程场景的过度设计 |
| React + Tailwind 做侧边栏 | D12 | 唯一 UI 只剩一段文字 |
| `CustomReadonlyEditorProvider` 接管 `*.pdf` | D23 | 会劫持默认 PDF 打开 |
| webview 内键盘监听（`useKeyboardNav`） | D10 | 流转全部走命令，交给 VS Code 键位层 |
| 覆盖度校验（"每步必须覆盖全部 diff hunk"） | D16 | 用户砍掉 |
| `Space` 作为默认主键 | D10 | 会抢打字 |
| 默认不 git 提交 | D21 | 逐片回退需要逐片 tag |
| 会话记忆用 SQLite | D5 | 先用 `Memento` |

---

## D100 块身份冻结：ID 分配一次，只增不减

**起因**：D99 的块 ID 是**内容指纹**（首 part 页码+bbox+文字长度+前 24 字）。当时的理由是
"同一份 PDF 拆两次 ID 不变"，所以问答挂上去就稳。这个理由在**块的内容会被陆续补出来**
这件事上不成立 —— 实测代码里已经具备四条断裂路径：

1. `manual.fillImageText`（OCR 回填）重算 ID → 用户在回填前问的那条**静默**失去落点；
2. `stitchPages` 缝合生成新块、两个旧 ID 一起消失 → 逐页处理时问的问题成了孤儿；
3. `manual.mergeBlocks` / `unstitch` 改内容就换 ID，而注释里写着"引用由调用方决定要不要迁移"
   —— **而没有任何调用方**，所以用户的修正重算一次就没了；
4. 引擎版本一变缝合决策就变，"重拆一次块还回到同一块"这个承诺在事实上不成立。

**决策**：ID 与内容分家。新增 `packages/pdf-blocks/src/registry.ts`（纯数据 + 纯操作）：

1. **ID 分配一次**，存进 `BlockRegistry`（落盘是调用方的事）。之后内容怎么变都不动它。
   `blockId` 从"块的最终身份"**降级为内容指纹**，只用来当别名（迁移升级前的存档）。
2. **匹配优先级**：近邻精确（容差 `PART_EPS = 0.002`，抽取抖动实测 < 0.0005）→ 长大了
   （本块 parts 包含某些项 = 缝合，复用**最靠前**那一个的 ID）→ 变小了（被包含 = 取消缝合，
   **先去 `retired` 墓园里把原块认回来**）→ 铸新 ID。
3. **退休的 ID 不消失，只改嫁**：被吞并的项进 `retired`，它的 ID 与别名都变成赢家的别名，
   `resolveAlias` 一路查得回去。
4. **取消缝合要把原块认回来**：所以 `retired` 是必须留的墓园 —— 碎片拿回的是它**自己的**
   历史 ID，而不是新铸一个。认不回来时（那块从没单独登记过）退而求其次：
   **第一个碎片继承容器的身份**（容器项收缩成它），问在缝合块上的问答原地落在第一片。
5. **ID 只增不减**；`resolveIds` 幂等（同一份输入跑两遍逐字相同）；不认识的 ID **原样返回、绝不抛**
   （与 D83 的存档纪律同类：它可能是命令的第一跳）。

**为什么不用"几何地址 + 包含关系"那套**：用户明确否掉了（"不要地址了，块本身就是定位"）。
注册表这条路更简单 —— 没有第二套身份，块自带 `parts[].bbox`，定位能力一点没少。

**状态**：生效。`test/registry.test.ts` 9 项锁住（含"OCR 回填不换 ID""取消缝合认回原 ID"
"幂等""不认识的 ID 不抛"）。

> **编号冲突说明（2026-09-20）**：同一台机器上**另一个会话**今早（08:59/09:00）留了一份
> **未提交的在制品**（"拆块活页"，见 D104），它在 5 处代码注释里也把这个号写成了 `D100`。
> 本号（身份冻结）已全链交叉引用（CONTRACTS §12.1 / STATE / SLICES / 三个源文件），
> 所以**它留在 D100**；活页那件记成 **D104**，落地时把那 5 处注释改号即可 ——
> 清单见 D104 末尾。两件是**互补**的（一件管"块是谁"，一件管"块画在哪"），不是重复。

---

## D101 块流 → 问出去：队列编号与重排稿（兼"挂载能力"）

**起因**：D98/D99 定的产品方向是"块是主角，解答附着在块上"，但**块流建好了却没有一个消费方**
（`splitDocument` 当时只有测试在调）。这一片补的是"块流怎么变成一次提问、答案怎么挂回去"。

**决策**：

1. **编号是跨界面唯一的引用**（落到约束 107 上，这次承重更大）：卡片徽标上的数字、队列面板的
   第 N 项、发出去的稿子里的 `[N]`，全部由 `queue.ts` 的 `orderedIds()` 一条路算出来。
   重排器只接受"已排好序的块流"并按 1..N 标号，不自己排。
2. **队列存点选先后，发送顺序算出来**（`BlockQueue.picked` 永远是加入顺序）。理由：用户随时
   可切"按阅读序 / 按点选先后"，存的时候就排好就再也还原不出另一种了 —— 原始意图丢掉就是丢了。
3. **排序键是 `(页码, y)`，不是数组下标**（`orderKeyOf` 用 `topOf()`）。下标会随增量精修
   （缝合/手修）移位，已入队的顺序不该在用户脚下悄悄变。
4. **阅读序排不了就退回点选先后，并且说出来**：队列里有块不在当前索引里（另一份文档、
   或还没处理出来）时 `effectiveMode` 退回 `pick`，`describeOrder` 明确说"阅读序排不了"。
   选了 A 却用了 B 而不吭声，就是屏幕上在说反话（D68 的同类）。
5. **徽标数字是"当前的发送位次"**，不是入队序号：按阅读序排时后加的块可能插到前面，
   号码会变。这是诚实的（它要回答"第几个发出去"），也符合 D80 的教训（可见性比编号稳定重要）。
6. **新块 `reflow.ts`：N 个块 → 一份可以直接发出去的稿子**。要点：
   - **分列彻底消失**：块流本身就是单列阅读序（页内分栏由 `order.ts` 解决、跨页由 `stitch` 解决）；
   - **图文就位**：文字用文字发（**绝不发截图** —— 那是花钱把精确信息变成有损像素），
     图块只发**那一块的裁剪**（`images` 只出清单，栅格是调用方的事）；
   - **图注并进图块**（`unitsOf` / `CAPTION_START`），只做紧邻的一种，不做更远的猜测；
   - **密集**：去行尾空白、收连续空行、去页眉页脚（引擎已剔）、去连字符（引擎已做）；
   - **省 token 开关** `includeImages: false`：只留图注文字，于是本地可以退化成**纯文本小模**
     （不发图的请求不需要 VLM，这直接缓解"不是所有用户都是游戏本"）；
   - **超预算必须说出来**：`truncated` + `droppedBlockIds` + 抬头写明"预算到顶"，
     绝不静默截断（D79/D81：进了 prompt 的东西必须在屏幕上留下痕迹）；截断以**块**为单位，
     不发半块。
   - `askForRefs`（默认开）在结尾加一句"请按块号引用依据" —— 这是**答案自动附着**的前提：
     模型点名了块号，程序才能把答案挂上去。这就是原先计划的"挂载能力"的地基。
7. **`threadContext` 那条追问链不动**：Thread/ThreadStore 已经能用，本片不重做。

**状态**：生效。`test/queue.test.ts` 8 项 + `test/reflow.test.ts` 10 项。

---

## D102 PDF 侧后续设计定案（跨页渲染 / 预取 / 图块检测 / 约束 1 再收窄）

**起因**：用户在设计阶段把 PDF 侧的形态讲定了（"PDF 完全可以推到重来，基础功能别乱动"）。
这一条把**已定但尚未实施**的四件事记下来，免得下次会话重新讨论。

1. **块的渲染以 `parts` 为单位，选择是一个集合**。一段话被分页截断时合成**一个**块，
   它一次选中要在**两个页上**渲染（`parts: [{page:12,…},{page:13,…}]`）。
   所以 `anchorPdf.flashRegion(page, bbox)`（CONTRACTS §5.2）要扩成吃一组 part。
   查看器现在是 pdf.js 原版（连排滚动，没有打过单页/双页补丁），跨页块的两部分**同屏可同时高亮**；
   若将来收成点击切页，退化成"高亮在本次选择期间存活"。
2. **增量处理用"长出一个 part"表达缝合**：预取相邻页时块是陆续产出的，而页眉页脚掩码与
   跨页缝合现在都是**文档级**判定。所以缝合不重造块，而是**后页首块并进前页末块**
   （ID 保留、多一个 part），被吞并的 ID 进别名表 —— 与 D100 的注册表是同一套机制。
3. **预取做成可选设置**（深度 + 开关）：当前页永远优先，跳页时可取消可重排，
   预取只把工作提前、**不影响正确性**。
4. **约束 1 第三次收窄**（前两次见 D76）：从"PDF 上不许常驻框，只允许点击闪 2 秒"改为
   **"不许自动的、与当前选择无关的框；与当前选择绑定的 part 高亮，在本次选择期间常驻，
   选择结束即消失"**。理由：跨页块两半对照看、预取后翻页复查都需要它。**尚未落地**。
5. **图块区域检测（仍未做）**：`PageImageIn` 这个入口至今只有测试在喂，图内文字各自成块
   （实测占块数 8.6% / 20.2% / 35.0%）。它是零模型成本的一刀 —— 数字型 PDF 的光栅图 bbox
   可以从 pdf.js 算子表直接拿到（`paintImageXObject` 的变换矩阵），只需过滤规则线与遮罩。
   这一条**排在"卡片的图能显示"之后**，因为卡片视图已经把图块当作一等公民了。

**状态**：第 1~3、5 条为**设计定案，代码未落**；第 4 条是**已冻结约束的变更，需要用户确认后落地**。

---

## D103 反哺 PDF：注释写回（直写原稿做成可选）

**起因**：用户要求"分块还能反哺 PDF，弄个注释"，并在"另存副本"与"直写原稿"之间选了
**直写原稿，但设计成可选**。

**决策**：

1. **两级开关**：全局设置（`关` / `另存副本` / `直写原稿`，默认**另存副本**）+
   单次导出时还能改这一处 —— 重要文献想另存、草稿想直写，是两个不同的心理。
2. **幂等靠 `/NM`（注释名字键，ISO 32000 里就是"在该页内唯一标识这一个注释"）**：
   写入前按 `/NM = 块 ID` 找，找到就更新，不重复追加。附带三个能力：
   重复写不出重复注释、**可撤销**（"移除本工具写入的注释"= 清掉带我们前缀的全部）、
   换台机器打开这份 PDF 还能靠 `/NM` 把注释与我们的存档重新对上。
   —— "可撤销"是直写敢开的**真正前提**：它把不可逆降级成可逆。
3. **中文注释的字体坑：不要把讲解画在页面上**。页面上画文字要嵌入 CJK 字体（pdf-lib 内置
   标准字体不含中文），不嵌就是乱码。做法是**高亮负责视觉、`/Contents` 负责文字**：
   `/Subtype /Highlight` + `/Rect` + `/QuadPoints` + 半透明色（**画矩形不需要字体**），
   讲解文字写进 `/Contents`（UTF-16BE）——这是纯字符串，任何阅读器的注释面板都能读到
   （悬停提示因阅读器而异，不指望）。`/T` 写作者名。
4. **拒绝清单**（即使开关打开也拒绝，且**必须出声**，D73）：
   ① 有数字签名的 PDF（写进去会破坏签名有效性，而 pdf-lib 的保存是重建 xref 而非增量追加）；
   ② 加密 PDF；③ 只读；④ 开写前 mtime/size 与记录不符（**别人动过，不要覆盖**）。
   另：工作区里被 git 跟踪的 PDF 要提示一句"这会改动你的工作区文件"。
5. **原子替换**：写临时文件 → 落盘 → 同卷 rename 覆盖。**不原地截断** —— 崩在中间就是一个坏 PDF。
6. **攒批写**：注释先在内存/侧挂存档里攒着，退出或显式"写入 PDF"时一次落盘。
   既少写盘，也让"撤销"在落盘前零成本。侧挂存档继续做**可编辑的源**（D89 的 history 路数），
   PDF 里的注释是**可携带的形态**，两者靠 `/NM` 对齐。
7. 顺带解开一个老紧张：常驻的东西进了**文件**（成了真实注释，在 VS Code 之外也在），
   屏幕上的叠加层仍然只负责当前选择与闪一下 —— 与约束 1 的收窄（D102 第 4 条）正好配套。

**依赖**：需要引入 `pdf-lib` 这类**纯 JS 写入库**（`pdf.js` 只读）。这是新依赖，进产物前要按
"禁带清单"的习惯核一遍。**尚未落地**。

**状态**：设计定案，代码未落。

---

## D104 拆块活页：页模式 + 停稳观测 + 覆盖层（**已接手，部分落地**）

**起因**：这条对应**用户的理想效果第 2 条** —— "直接打开一个未处理的 PDF：后台观测当前停留的界面
（我的插件不允许滚动，只允许点击切），如果稳定下来，那就开始处理…空白部分暗下去，块有一个圆角矩形
细框包着…不持久"。它由**另一个会话**在 2026-09-20 早上做到一半（未提交），
**用户明确要求接手**（"我不是说让你接受吗，接的就是它的手"）—— 所以这份决策是**我们的**，
按它的代码注释把设计如实定下来，并标明还剩什么。

**已进代码的部分**（`packages/extension-anchor-pdf/src/anchor/bridge.ts`、`packages/core/src/types.ts`）：

| 消息 / 字段 | 方向 | 语义 |
|---|---|---|
| `anchor:pageMode` | 宿主 → 注入 | pdf.js 切成"整页翻看"（**不许连续滚动**），并开始观测停稳的页 |
| `anchor:requestPageText {page}` | 宿主 → 注入 | 让注入脚本抽某一页的文字项（归一化坐标）—— 拆块的原料 |
| `anchor:showBlocks {page, blocks[]}` | 宿主 → 注入 | 在该页画块覆盖层（空白暗下去 + 圆角细框）。**收到后先清旧块再画新的 → 翻页即散、不持久** |
| `anchor:clearBlocks` | 宿主 → 注入 | 撤掉覆盖层 |
| `anchor:pageSettled {page}` | 注入 → 宿主 | 某页停稳（切页后约 0.9s 没有新的翻页动作）→ 宿主据此开始处理该页 |
| `anchor:pageText {page, items[]}` | 注入 → 宿主 | 上一条请求的回答（可能为空 = 无文字层） |
| `anchor:blockClick {id}` | 注入 → 宿主 | 用户点了覆盖层里的某一块（**脚本只报事实**，选中态由宿主维护） |
| `Anchor.blockIds?: string[]` | core 类型 | 加法扩展：这根锚点由哪些**块**组成（喂给"问答附着在块上"）。**可选**，框选兜底的锚点没有它，所有读它的地方都要能退化 |

**设计要点（从注释里读出来的）**：覆盖层**不持久**（翻页即散），是约束 1 的"**D104 版**"——
即"显式、瞬时、绝不改文档"；与 D103 的注释写入正好构成一对（屏幕上的瞬时 vs 文件里的常驻）。

**未完成（下一次接手这件的人从这里开始）**：

1. **注入脚本侧还没写**：`media/anchor-select.js` 里没有 `showBlocks/clearBlocks/pageMode`
   的处理分支，也没有"停稳 0.9s → `pageSettled`"的计时逻辑；`requestPageText` 的抽取也没实现。
2. **宿主侧没有消费者**：`packages/extension-anchor` 里没有 `pageSettled` / `pageText` / `blockClick`
   的处理，也没有"抽文字项 → `splitDocument` → `resolveIds` → `showBlocks`"那条接线。
3. **与 D102 第 4 条（约束 1 再收窄）的先后**：覆盖层现在是"翻页即散"，而跨页块要"两页都亮"，
   两件事会碰在同一个约束上 —— 落地前先把 D102 第 4 条让用户确认。

**已接手时顺手做完的**（2026-09-20，S-P2 的前置）：

- **编号统一到 D104**：5 处注释原写 `D100`，已全部改号 ——
  `packages/core/src/types.ts:87`；`packages/extension-anchor-pdf/src/anchor/bridge.ts` 的
  四条注释（含文件头说明）。`D100` 归"块身份冻结"（见 D100 末尾的冲突说明）。
- **CONTRACTS §5.2 已同步**：四条下行 + 三条上行写进冻结消息集合，并补了四条边界约定
  （覆盖层不持久 / 脚本只报事实 / 停稳由脚本观测、宿主处置 / 三条上行逐条守卫）；
  §1 的 `Anchor` 也补上 `blockIds?: string[]`。
- `parseSelectMessage` 的三条守卫（`pageSettled` / `blockClick` / `pageText`）**本来就是好的**：
  与 `anchor:captured` 同一立场（注入脚本的输出对宿主而言和 AI 的输出一样不可信），
  坏输入一律返回 null 让调用方忽略。这部分不用动。

**与 S-P1 的关系**：S-P1 做的是**块流视图（相册）**，这条做的是**页面上就地覆盖层**，
两者是同一个块流的两个消费方，共用 `registry` / `queue` / `reflow`，不重复。

**状态**：**部分落地**（类型 + 守卫 + 契约已就位；注入脚本侧与宿主消费者未做）。

---

## D105 手感纪律：静止是默认，动只能"整屏、缓慢、大幅"

**起因**：相册第一版给选中的块加了一条 3.2s 的呼吸（`box-shadow` 偏移 1px），并在悬停时
`translateY(-1px)`。用户看完预览的原话：

> "我不动的时候，块和块内元素不要动了，要么就缓缓、整体动，做一个视锥、光锥效果，
> 要么就大幅缓慢动，**不要一个像素这样动，很吸引视线，又让人很难受**"

这是他第二次对动效明确表态（第一次是"框有微微运动效果，像是悬浮了一样"，那次要的是**有**动效）。
两次不矛盾：他要的不是"没有动"，而是**动的形式必须对**。

**决策**：

1. **静止是默认**：块与块内元素在任何"用户没在操作"的状态下**没有任何动画** ——
   没有呼吸、没有脉动、没有位移。选中完全靠静态表达：边框变色 + 底色 + 那个数字。
   → 撤掉 `anchor-breathe`，`.card.selected` 不再带 `animation`。
2. **悬停不许位移**：密集网格里鼠标划过就是"格子逐个上蹿一个像素"，比呼吸更难受。
   悬停改成**加一圈内阴影**（`inset 0 0 0 1px` 强调色）——视觉上更亮，**一个像素都不动**。
   卡片的 `transition` 里也**不许出现 `transform`**（从属性列表上就断掉这条路）。
3. **唯一允许的"自走"动效是整屏的光锥**（`.cone`）：一层覆盖全屏的斜向带状高光，
   6.3s 扫过、再停 7.7s（`@keyframes` 的 45%→100% 停在屏外，**有一段真正的安静**）。
   它满足用户给的三条"可以动的形式"：**整体动**（一个元素，不是每块各自动）、
   **缓慢**（14s 一轮）、**大幅**（带宽 45vw，跨越整屏），且对比极低（alpha 0.045–0.075）。
   开关：`BlockStreamView.lightCone: false`（关了就一个会动的元素都没有）；
   `prefers-reduced-motion` 下整层 `display: none`（是"没有"，不是"变慢"）。
4. **按住的那一下弹，可以留**：`.pop` 是**用户主动动作的回执**，只动被按的那一块，
   幅度 3%（不是 1px）且带回弹过冲。它与"自走的动画"是两回事，
   也正是用户第一次要的那个"像在水里按下去"。

**怎么防复发**：`test/blockView.test.ts` 里两条断言把这个规矩钉住 ——
① CSS 文本里不许再出现 `anchor-breathe`、`.card.selected` 不许带 `animation`、
`.card:hover`/`.card:active` 不许带 `transform`；② `lightCone: false` 时 HTML 里
`<div class="cone">` **一个都不该有**（是"不渲染"，不是"渲染了再隐藏"）。
观感侧另有一条运行期审计：整页 `document.getAnimations()` 只应有 **1** 个（光锥），
块上应为 **0** 个。

**状态**：生效（S-P1 内落地）。

---

## D106 块的立体：一个浅箱 —— 顶面是块、内容在箱底、箱壁暖色

**起因**：D105 里我把用户那句"要么就缓缓、整体动，做一个视锥、光锥效果"读成了**整屏扫光**，
做了一版 `.cone`。用户看了直接否掉并给出真正的意图：

> "**不要后面一道光在这扫**。可能我的表述不准。我希望你将块想象成一个矩形立方体的顶面，
> 内容在底面，有一个视觉效果、暖色、鼠标移上去，给一个倾斜效果，这样就看出 3D 效果了"

教训写在这里：**"光锥"不是扫光，是"这块是个立体"**。表述不准的是他，但读错的是我 ——
遇到这种"效果类"描述，先问一句比先做一版便宜。

**决策**：

1. **每块是一个浅箱**，三层（`html.ts` 的 `.tilt` 内）：
   - `.floor`（**底面**）——**内容在这一层**，它平时就是"那个带边框的方块"；
   - `.wall ×4`（四面箱壁）——绕各自那条边立起来，带宽 = 厚度 `--anchor-depth`；
   - `.edge ×4`（**四条竖棱**）——从箱底四角一直站到箱口的那四条线；
   - `.rim`（**顶面轮廓**）——一块只有边框的框，`translateZ(--anchor-depth)` 抬到箱口。
   `perspective: 700px` 放在**格子**（`.card`）上：整块一个视点，倾斜才像同一个房间里的东西。
2. **厚度 20px、棱线要画**（用户看了第一版之后的追加："有点太浅了。最好把立方体的框线也展示出来"）。
   第一版只有半透明的箱壁，形状是**含糊**的 —— 添上四条竖棱之后，箱底边框 + 竖棱 + 箱口框线
   才构成一副完整的线框，立方体才读得出来。同时把箱壁提到 0.5、箱口提到 0.9 的不透明度。
2. **静止时 `.box` 整层 `opacity: 0`** —— 不悬停就完全看不出是个箱子。密集网格里浏览时
   和纯平面一模一样（这是 D105"静止是默认"的直接结果，也让相册在扫描时保持干净）。
3. **暖色取自主题**：`--anchor-warm: var(--vscode-editorWarning-foreground, #cca700)`
   （暗色主题里就是琥珀色）。**不许写死色值** —— 与"只用 `--vscode-*`"是同一条纪律，
   换主题时"暖"也跟着变。
4. **倾斜跟手**：角度由客户端按指针在这块里的**方位**算（最大 8°，写成 `--tx`/`--ty`），
   不是每块一个固定角。两档过渡是关键：**指针移动时零过渡**（`.card.tilting .tilt`），
   **离开时才 200ms 缓回** —— 否则每次 `mousemove` 都重启一次过渡，倾斜会"追着指针跑"、
   带拖影；3D 要的是跟手。
5. **减少动效下整层摘掉**：`prefers-reduced-motion` 里 `.tilt` 不转、`.box` 不显示，
   悬停只剩那一圈内阴影。是"没有"，不是"变慢"。
6. **不做整屏扫光**（`.cone` 已删）。文档里留着这条，是因为它是被明确否掉的东西。
7. **悬停时底面自己收一圈暗影**（`inset 0 0 12px rgba(0,0,0,.42)`）：这是"内容在底面"
   这句话在视觉上的落点 —— 内容落在凹进去的箱底，不是贴在最表面。不是装饰。

**验收（运行期量到的，不是"我觉得"）**：静止时 `.box` 的 `opacity` = `0`、`.tilt` 的
`transform` 是单位矩阵、整页 `document.getAnimations().length` = **0**；悬停时
`--tx`/`--ty` 跟着指针走（在角上接近 ±7°）、`.tilt` 的计算值是真实的 `matrix3d` 旋转、
箱壁颜色 = `rgb(204, 167, 0)`（主题给的琥珀）、箱口 = `translateZ(10px)`。
钉在 `test/blockView.test.ts` 四条断言上（含"暖色不许写死""跟手时不许有过渡""扫光不许回来"）。

**一个环境坑（写给下一次做预览的人）**：预览是 webview，CSP 是 `style-src <cspSource> 'nonce-…'` ——
**从控制台注入 `<style>` 会被拦掉**（没有 nonce），`element.style` 这类 CSSOM 改动才不受限。
另外无头/后台标签页里**过渡不推进**，读计算样式会一直读到过渡的起点值 ——
想定格看一个过渡后的状态，得先把 `transition` 置 `none` 再改值。

**状态**：生效（S-P1 内落地）。

---

## D107 箱体朝**里**去，不是朝外鼓：只能透过顶面往里看

**起因**：D106 把箱子做成了**朝观察者鼓出来**的一只托盘（箱壁绕箱口朝 +z 立起、箱口在近处）。
用户看了之后的正话：

> "**不对，只能从顶部那个面往里看**，然后**内容再深一点**，这样通过倾斜可以看到更多信息。"

方向做反了。这是同一个效果上的**第二次读错**（第一次是"光锥"，见 D106 起因），
两次都出在"我把描述里的方向按自己的直觉补全了"。**下次遇到立体/空间的描述，先问一句朝向。**

**决策**：

1. **箱口 = 那块砖自己的矩形（z=0）**，`--anchor-depth: 32px`，**箱体朝屏幕里边去**，
   底面（内容）落在 `translateZ(-depth)`。所以：
   - `.lid`（**箱口**）：一圈框，静止时它就是那块砖的细框；里面是空的（**看得进去**）；
   - `.wall ×4`（**内**壁）：从箱口四条边朝里折（`rotateY(∓90°)` / `rotateX(±90°)`，
     正负号与 D106 版**全部相反**）；
   - `.edge ×4`（竖棱）：从箱口四角朝里站到箱底（`rotateX(-90deg)`）；
   - `.floor`（箱底）：内容在它上面，`-depth` + 深度的透视补偿。
   **不存在"外面那四面壁"** —— 能看见的只有箱内，这就是"只能从顶部那个面往里看"。
2. **深度的透视补偿**（`--anchor-floor-scale: 1.046`）：平面推到 -depth 之后透视会把它
   投影得比箱口小（P/(P+depth) = 700/732 ≈ 0.956），乘 1/0.956 才让它**静止时正好铺满箱口**。
   没有这个补偿，静止时砖中间会露出一圈底色 —— 而"静止时与平面时一模一样"是 D105 的规矩。
   **这是一个会随 `--anchor-depth` 变化的数**（公式写在 styles.ts 的 .floor 注释里）。
3. **悬停强调框移到箱口（`.lid`）**：强调框属于"表面"，而表面就是箱口。箱底那圈暖色线
   单独在悬停时显出来（它在 -depth 上，倾斜时才看得见它是箱底）。
4. **防"方向再翻回去"的断言**（这条是这次的直接产物）：`test/blockView.test.ts` 里
   既断言"底面必须是**负** z"、也断言"**不许**再有 `translateZ(var(--anchor-depth))` 那一层"，
   再加四条内壁与竖棱的旋转方向。方向错了是**静默的视觉错**，只有断言盯得住。

**"通过倾斜可以看到更多信息"这一条，一半落地、一半留给你定**：

- **已落地**：深箱 + 内壁 + 竖棱，倾斜时箱口与箱底的**错位**看得出来（视差随箱深增大）。
- **还差一步才"真的看到更多"**：底面要**比箱口大**才行。现在底面按精确补偿缩放
  （静止时正好齐平、一滴不溢），所以倾斜看到的是同一片内容在错位，**不会多露出内容**。
  真要多露出内容，需要两件事：① `--anchor-floor-scale` 从 1.046 提到 1.10 左右
  （代价：静止时内容会往外压约 3px，正好吃掉 4px 的格间距）；② **内容管线给一块更大的
  裁剪**（比如比块本身大 15% 的页面区域），否则放大出来的还是同一片字。
  这两件等你说一声再做 —— 它是个肉眼可见的取舍，不该我替你定。

**状态**：生效（方向 + 箱深 + 内壁/竖棱 + 补偿已落地；"露出更多内容"那一步待确认）。

---

## D108 是一个**坑**，不是一只箱子：深度全部交给阴影

**起因**：D107 把方向掉过来了（箱体朝里凹），但仍然是**一只箱子**：有四面内壁、四条竖棱、
一圈箱口。用户看了之后一句：

> "**没改好，理想情况应该像一个坑一样的。**"

"坑"这个字把差别说透了：**箱子是有板的，"坑"没有**。我一直在做"几何体"，而用户要的是
"表面上的一个凹陷"。**这是我在这一个效果上的第三次返工**（光锥 → 朝外鼓 → 朝里凹 → 坑），
三次都出在同一件事上：**把描述里的名词按最字面的几何去实现，而没有问"你看到的那张画面是什么样"**。
下次遇到"效果/画面"类的描述，先把"你希望看到什么"问清楚，再动手。

**决策**：

1. **撤掉所有面片与棱线**（D107 的 `.wall ×4` / `.edge ×4` / `.box` 整层全删）。
   真实的坑没有"面"，只有**阴影与错位**。DOM 里只剩两层：
   - `.floor`（**坑底**）：内容在它上面，`translateZ(-depth)`，并且**比坑口小一圈**；
   - `.lid`（**坑口**）：那块砖的矩形，只有一圈边，里面是空的（看得进去）。
2. **坑底比坑口小一圈**：`--anchor-floor-scale` 从 D107 的"精确补偿 1.046"改成 **0.99**
   （静止时每边内缩约 3px）。这一圈差是"坑"在静止时**唯一的形状线索**。
   **要更深就把这个数调小**（代价：内容整体变小一点）—— 这是"坑深"的手感旋钮。
3. **深度由两层阴影承担**（各管一件事）：
   - `.lid` 的 `inset 0 4px 16px rgba(0,0,0,.5)` = **坑口往里的那圈暗影**，
     带一点向下偏移（光从上方来，上沿最暗）。"凹下去"主要靠它读出来；
   - `.floor` 的 `inset var(--sx,0) var(--sy,0) 16px rgba(0,0,0,.5)` = **坑底自己的遮蔽**。
4. **阴影偏移随倾斜方向变**（`--sx`/`--sy` 由客户端按指针位置给，每度 0.75px，8° ≈ 6px）：
   倾斜时"远处那一面"更暗。**这一条是"坑"与"一张画"的全部区别** ——
   没有它，倾斜只是把同一张图转了个角度而已。
5. **悬停强调框留在坑口（`.lid`）**：表面就是坑口。悬停时遮蔽略加深（0.5 → 0.62），静态、不位移。
6. **减少动效下**：不倾斜（`.tilt` 不转）、阴影整层摘掉（`.floor, .lid { box-shadow: none }）。
   **坑本身留着** —— 它是静态的，靠阴影读出来，不需要动。

**验收（运行期量到的）**：静止时坑底比坑口每边内缩 **3.06px**、坑底 `matrix3d(0.99, …, z=-32)`、
坑底遮蔽 `inset 0 0 16px rgba(0,0,0,.5)`、坑口遮蔽 `inset 0 4px 16px rgba(0,0,0,.5)`、
无指针时 `--sx/--sy` 为空（不倾斜）、整页运行中动画 **0** 个。
钉在 `test/blockView.test.ts` 两条断言上：不许再出现 `class="wall|edge|box|rim"`、
坑底必须比坑口小（`--anchor-floor-scale: 0.99`）、两层阴影各就各位、偏移吃 `--sx/--sy`。

**状态**：生效（S-P1 内落地）。

---

## D109 坑底比坑口大、无边框、倾斜真的露出更多、加一圈折射

**起因**：用户看完 D108 那版（坑底比坑口**小**一圈、带一圈暖色线）之后的原话：

> "**底面应该更大一点，无边框**。现在不能起到倾斜看到更多内容效果。加个折射效果。"
> （"价格"＝"加个"，拼音一样，输入法滑了 —— 按"加个折射效果"理解。）

四件事，逐条落：

1. **坑底比坑口大**：坑底（.plate）从"小一圈（1.046 精确补偿）"改成 **1.18**（每边多出 9%）。
   于是坑口（.window，overflow: hidden）**把它裁住**，静止时只看得到中间那块。
2. **倾斜真的露出更多内容**（D108 里我列成"待你定"的那一步，现在做了）：
   坑底随指针**反向平移**（--px / --py，最大 PLATE_SHIFT_PCT = 7%）——
   就像你偏头往一个凹陷里看，可见的窗口跟着挪。量到的效果：坑口 115px、坑底 134px、
   **每边藏起来 9.56px，而位移能把其中约 8.3px 露出来**。
   **视差必须反向**（指针在左 → 坑底右移），否则不是"往里看"而是"贴纸跟着手走"。
3. **无边框**：D108 给坑底加的那圈暖色线撤掉（用户原话）。坑口的 1px 边**留着** ——
   那是"块与块的边界"，不是他说的"边框"；去掉它相册会糊成一片。
4. **折射**：.glass 一层"玻璃唇"，用**双层 mask 相减**做出一个环（mask-composite: exclude），
   环上一条暖色高光 + 一条淡冷光，方向吃 --shade（光从远处那面折进来）。
   **为什么不用 backdrop-filter 做真模糊**：mask 能不能裁住 backdrop-filter 的输出，
   我在这个环境里**无法可靠验证**（沙箱截图拿不到像素）；万一裁不住就是**整块内容都糊**，
   比"少一点折射"严重得多。所以先用形状边界明确的做法 —— 错了只会少一点折射，不会毁内容。

**顺手补的两处**：

- **暗影方向的退化**：atan2(0, 0) 在正中是个随机角，会让正中的暗影方位乱跳 ——
  加了下限（dx²+dy² < 0.02 时退回 180deg = 光从上方来）。
- **一个守卫脚本** scripts/check-inline-strings.mjs（挂在 pnpm check 最前面）：
  内联进 webview 的字符串常量里**不许出现反引号**。为什么必须是脚本而不是断言：
  反引号会把模板字符串**当场截断**，于是整个模块语法错，那条断言根本没机会跑。
  我已经在 styles.ts 栽过三次、clientScript.ts 一次（都是在 CSS/JS 注释里给属性名加反引号）。
  源码级**不查 \${**（\${TILT_MAX_DEG} 是有意插值，分不出手滑），
  未求值的 \${ 由渲染结果那条断言管（test/blockView.test.ts）。

**状态**：生效（S-P1 内落地）。折射的"真模糊"版本待用户在两种做法之间选（见上面第 4 条）。

---

## D110 悬停改成一个**固定姿势**：角度开大、不再跟随指针、去掉黄光

**起因**：用户看完 D109 那版之后的三句：

> "**角度变化不够大，晃动很累，然后有一个异常的黄光，这不是我想要的效果。**"

三件事各自对应一个具体的机制，都不是"参数没调好"：

1. **"晃动很累"的根是"跟随指针"本身**。D106 起，悬停的倾角是 `mousemove` 一路算出来的
   （`--tx/--ty`、视差 `--px/--py`、暗影方向 `--shade`）。两个死结：
   ① 角度不敢开大（一大就晃得厉害）；② 密集网格里鼠标划过，十几块轮流改角度 = 一路晃。
   **决策：把跟随整块删掉**。悬停 = **一个固定姿势**（`.card:hover .tilt { rotateX(-15deg) }`，
   220ms 一次缓动），坑底固定往下挪 `--anchor-plate-shift: 6%` 露出被裁掉的上边缘，
   暗影固定"光从上方来"。
   → 角度能开到 **15deg**（原来 8deg 并且要留余量给晃动），而且**每次悬停都是同一个姿势**。
   客户端脚本里现在**没有 `mousemove`、没有 `getBoundingClientRect`**，只剩点选/滑选/弹。
2. **"异常的黄光"**是 D109 那圈折射里的暖色高光（`rgba(255,209,128,…)`）与 `--anchor-warm`
   （主题的 amber）。**两者都删掉**：`.glass` 只剩一条极淡的中性反光（白 10%）。
   折射感靠"环 + 一层薄光"，不靠染色。
3. 三条一起看，教训是同一句：**我连着四轮都在"加机制"，而用户要的是"一个稳定的画面"**。
   D105 他说别自走、D110 他说别跟随 —— 两次都是在砍"活的机制"。下次做视觉，先问一句
   **"你要的是一个动作，还是一个状态？"**

**验收**：断言全部反过来了 —— 不再断言"跟随变量存在"，而是断言
**`--tx/--ty/--px/--py/--shade` 一个都不许回来**、`mousemove` 与 `getBoundingClientRect`
不许出现在客户端脚本里、`rgba(255,209,128)` 与 `--anchor-warm` 不许出现、
悬停必须是固定 `rotateX(-15deg)`、不悬停必须 `transform: none`。

**状态**：生效（S-P1 内落地）。

---

## D111 不用真立方体了：**砖不动，眼睛动**（投影的闭式解 + 玻璃 + 对焦）

**起因**：D110 那版（固定姿势 `rotateX(-15deg)`）用户看完直接否掉：

> "视觉上很奇怪，应该离得远，空间类似一个正方体，现在你做的只能向下歪，没法四处看。
> 还有底部的内容还没有适配，应该铺在一个平面。最后的效果像透过玻璃看下面。
> **要不你就别做成真立方体**，弄一些那种光锥卡，用别的方法实现视觉效果，加点对焦？反正现在很丑。"

三句判词否掉的不是参数，是**前四轮共同的前提**：

1. **"只能向下歪，没法四处看"** —— 砖自己转（固定姿势也好、跟随指针也好）都不是他要的。
   他要的是**视线能四处看**；砖一动就是"晃得累"（D110 实测过）。
2. **"应该离得远"** —— 透视要平。D109 那套"底面 1.18 + perspective 700px"是夸张的近景畸变。
3. **"底部的内容…应该铺在一个平面"** —— 内容得是**坑底那块平面上的东西**，不是一张被裁的大图。

用户同时给了出路："**要不你就别做成真立方体**…用别的方法实现视觉效果"。

**决策：一个 3D 变换都不用**（没有 perspective、没有 preserve-3d、没有 rotate/matrix）。
几何改成**投影的闭式解**，砖的外框在任何状态下都不动、不转、不缩放；"四处看"靠**眼睛**
（虚拟视点）在坑口上移动：

世界单位取"格子半宽 = 1"，坑口 ±1，**坑深 d = 2 = 砖的边长**（"空间类似一个正方体"），
眼睛在坑口上方 P = 18（9 条边长，"离得远"）→ `--anchor-slack = d / (P + d) = 1/10`。于是：

    坑底成像   = 坑底 × (1 - slack) + 眼睛 × slack      ← 矩形：均匀缩放 + 平移（无畸变）
    某面壁的宽 = slack × (1 ± 眼睛)                     ← 眼睛偏向哪边，对面板就宽

- **坑底** `.floor`：内容就在这一层，`transform: translate(眼睛 × slack × 50%) scale(1 - slack)`。
  平行平面的透视**就是**均匀缩放加平移 —— 这正是"离得远"的样子（D109 那种梯形畸变没有了），
  所以内容确实是"铺在那个平面上"。
- **四壁** `.wall-t/-b/-l/-r`：坑底成像之外的那四条带子，宽度是第二条式子；与坑底**正好铺满
  坑口**（无缝、不重叠、不出格）。竖壁排在横壁之后（DOM 顺序），角上归竖壁 —— 真实箱子的角
  就是这么转过去的。
- **眼睛** `--eye-x` / `--eye-y`（±1.4）：客户端按**指针在砖里的位置**写这两个数，CSS 用 calc
  算成坑底的位移与四壁的宽窄。**JS 只给两个数，不碰 transform** —— 这是 D111 画的边界，
  也是"砖不动"的保证。
- **玻璃** `.glass`：坑口那一层的极淡反光 + 上下唇线（上亮下暗 = 一块玻璃的边缘）。
  无暖色、无黄光（D110 的教训继续守）。
- **对焦**（用户："加点对焦？"）：静止时坑底内容 `blur(0.5px)`（差一点点没对准），
  悬停 = 眼睛凑上去 → 对准，240ms 一次过渡，不是循环动效。
- **光锥**（用户提的那个词）：落进坑口、打在坑底上的那片光斑 —— 它是**画在坑底上的**静态光，
  跟着坑底一起动；光本身不扫、不闪（D105 第 2 条：整屏扫光被明确否过）。

**技术上两件事**（都是这一轮才用上的）：

1. **自定义属性可以插值**：`@property --eye-x { syntax: "<number>" }` 注册过之后，`.card` 上的
   `transition: --eye-x 240ms` 才真的会缓动，而且**子元素继承到的是插值中的值** ——
   所以"视线跟过去"是浏览器插出来的，一行 rAF 都不用自己写（客户端只用 rAF 把一帧内的
   多次移动合并成一次）。
2. **不写几何第二份**：JS 里不许出现 transform / rotate / matrix；CSS 里也不许出现第二套
   "我觉得"的系数 —— 观感要改就改 `--anchor-slack`（深浅远近）或 `EYE_MAX`（视力范围）。

**验收（运行期量到的，不是"我觉得"）**：预览页上 16 张卡各 4 壁 + 玻璃，静止时
`matrix(0.9, 0, 0, 0.9, 0, 0)`、四壁各 5%、`blur(0.5px)`；写 `--eye-x: 1.4` 后四壁变成
13.64 / 0 / 5.68 / 5.68 px（眼睛在右 → 露左壁、右壁归零）；坑底渲染出来的边与四壁的缝在
0.33px 以内（**没有缝**，只是分数像素的重叠侧）；`transitionrun/start/end` 都能拿到
`--eye-x`，且过渡途中读到的仍是起始值（说明真的在插值）；指针事件走完"变量 → 几何"，
离开时两个变量都被摘掉（**任何时刻只有一张卡持有眼睛**）。
另外 `test/blockView.test.ts` 里加了一条**几何不变量**：把渲染出来的 CSS 公式求值，
在 10 个眼睛位置上核对"四壁 + 可见坑底 = 100%，且每面壁正好填上坑底到那条边的空当"。
**这条测试当场抓出一个真错**：我第一版把上下两壁的符号写反了（"眼睛偏上"露出来的其实是**下壁**）。
这正是它存在的理由 —— 符号靠直觉记不住。

**可见性说明**：这个沙箱里**看不了像素**（截图 surface 3s 超时，D106 就记过这个坑），
所以"好不好看"仍由用户看预览判；这里只保证几何与层级是量过的。

**状态**：生效（S-P1 内落地，推翻 D106→D110 的立体部分；D105 的手感纪律继续有效）。

---

## D112 底面比顶面大 + 分区域对焦：**倾斜要真的看到新东西**

**起因**：用户看完 D111 的两句，都是结构性的：

> "1. **倾斜没有起到扩大观察内容的目的，因为底面和顶面一样大。**
> 2. 视觉应该每个格都有，但是**只有中心附近清楚，通过倾斜对别处对焦**"

D111 的地基是对的（一个 3D 变换都不用：砖不动、眼睛动，几何是投影的闭式解），
但它把"孔底"做成了**和孔口一样大** —— 于是倾斜只是把同一块内容挪了 8px、边上露出的是孔壁，
**没有新内容进来**。这条不修，"四处看"就是空转。

**决策两条**：

### 1. 底面比顶面大（`--anchor-plane: 1.26`），倾斜 = 视线在平面上平移

- 平面（`.plane`）比孔口大 26%，静止时只看得见它中间的一块；
- 视线偏移时**内容在画面里平移** `slack × 眼睛 × 50%`（`--anchor-slack: 0.14` → 挪到头 11.1px），
  于是原本被孔沿挡在外面的那圈内容**被带进来**（静止时每边藏 15.1px，挪到头能看见 11.1px）；
- **平面的尺寸有一个硬下界**：`plane ≥ 1 + 2 × slack × EYE_MAX × 50%` ——
  视线挪到头时平面还得盖满整个孔，否则会看见"平面的边"（一片空）。
  1.26 对这个下界（1.196）留了余量；这条下界**由测试算**，不是靠记性。
- **版面要按 1/(1 - slack) 预放大**（盒子与字号一起）：平面在深度上会被缩 k = 0.86 倍，
  不补这一下的话 1.26 会被缩成 1.08，"做大"等于白做 —— D111 就是这么白做的。
  （缩略图的内边距还是原来的 px，没跟着补 —— 它会一起缩 0.86 倍，约 1px 的差别，忽略不计。）
- 孔壁（`.wall`）改用 `--anchor-rim: 0.052`（板厚/眼距，与被挡住的平面无关），
  而且**改成不透明的**：孔沿后面是板子，既然底面比孔大，孔壁就必须真的挡住它。
  静止时四周各 2.95px，视线偏过去时对面那面最宽 7.1px（"这块板有厚度"的证据，量过）。

### 2. 分区域对焦（每格都有，中心清楚）

- **两层同一个内容**：`.focus-sharp`（原样）+ `.focus-soft`（`filter: blur(1.3px)`），
  遮罩**互补**（同一段 `radial-gradient(58% 58%)` 取反 → 交叉淡化，没有重影也没有缝）；
- **遮罩挂在这两个不动的层上**，所以"清楚的那块"永远钉在格子中心 ——
  内容从它下面平移过去，**倾斜时别处就进了焦平面**（用户那句的原样实现）；
- 为什么不用 `backdrop-filter` 一层搞定：它和 `mask` 的裁剪关系在各家实现里不一样，
  裁不住就是**整块都糊**（D109 为同一个理由放弃过它）。两层互补遮罩没有这个风险 ——
  遮罩要是失灵，最坏也只是"全都清楚"。
- 糊挂在**平面**上（不是外层），这样模糊的边界落在格子之外，格子四边不会各糊掉一圈。
- D111 那条"静止时整块差一点没对准、悬停对准"（`.card:hover .floor { filter: none }`）**撤掉** ——
  对焦现在是分区域的，不是整块的。

**验收（运行期量到的）**：预览页上 16 张卡 × 2 层内容；平面渲染出来 143.2px 对 115px 的格子
（= 1.245 倍，与 1.26 的设计值一致 —— 百分比基准是孔口的 padding box）；
**视线挪到两个极端时，平面的四边都还在格子之外**（最近的一边还差 3.96px）；
孔壁静止 2.95px、极端时对面 7.08px 而近侧归 0；内容平移 11.14px（= slack × 1.4 × 50%）；
**两层内容的 transform 在每个眼睛位置上完全一致**（不一致就会重影——这是双层结构的头号风险）；
过渡仍由 `@property --eye-x` 插值（动画列表里拿到 `--eye-x`，途中两层读到的都是同一个起始值）。
另有三组测试盯着：变量与公式（文本）、脚本只写两个数（文本）、以及
**几何不变量**（把渲染出来的 CSS 求值：孔壁封边 ①②、平面盖满孔 ②、平移够得着留边 ③⑤、
对面板更宽 ④ —— slack/plane/rim/EYE_MAX 任何一个被改坏都会红）。
**画面仍然看不到像素**（老坑），"好不好看"由用户看预览判。

**教训**：D111 我把"底面和顶面一样大"当成了干净的几何，却忘了**用户要的是"能多看一点东西"**，
不是"几何自洽"。做视觉时，"这个效果让人多看到/多做到什么"要写在验收里 ——
D112 起那条硬指标（平移 ≥ 5%）就写在测试里了。

**状态**：生效（S-P1 内落地；D111 的"孔 + 视线"地基保持不变）。

---

## D113 底面**真的转**（不用 D112 的平移）+ 对焦整块删掉 + 静止时信息必须完整

**起因**：用户看完 D112 的三句：

> "**信息获取不全，你的对焦不好用。**我终于知道为什么感觉不好了：
> **你的底面应该真的绕着一个球面在转。然后对焦去掉吧，做得太差**"

三句对应三件事，全照做：

### 1. "对焦去掉吧，做得太差" → 删光

D112 那套（两层同一内容 + 互补遮罩 + `blur` + 中心钉在格子中央）**整块删掉**：
没有 `.focus`、没有 `--anchor-soft`、没有第二份内容（DOM 回到一层 `.plane > .thumb`）。
测试里立了反向断言：`blur(` 不许出现、底面上不许挂遮罩、一块砖只有一份 `.thumb`。

### 2. "信息获取不全" → 静止时底面**正好铺满孔口**

D112 让底面比孔大 26% 并且平移，静止时就裁掉一圈（用户说的"信息获取不全"）。
D113 改成：底面按 `1 + depth/far` 预放大（1.125），在深度上缩 `far/(far+depth)`（0.889），
**两者相乘正好 1 —— 静止时底面铺满孔口，一个字都不裁**。
（量过：格子 113px、底面投影出来 127px，多出来的 12% 是给"转"留的余量；
缩略图的内边距从 7px 加到 10px，保证内容不被孔沿压住 —— 这是算出来的，不是试出来的。）

### 3. "底面应该真的绕着一个球面在转" → 用浏览器自己的透视

D112 的底面是"算好的平移 + 均匀缩放"，看着像一张画在滑 ✗。D113 换成**真的 3D 旋转**：

- `.window` 上给 `perspective: 4 × 格子边长`（"视点在孔口正前方 4 格"）；
- `.plane` 上 `translateZ(-0.5 格) rotateX(眼睛 y × 10.5°) rotateY(−眼睛 x × 10.5°) scale(1.26)`；
- 于是它的**每个点都在绕自己的中心画一个球面**（用户要的那个词），
  视线在哪边、哪条边就鼓起来 —— 投影出来是**近大远小**，不是平移。
  量过：挪到头时近边的投影比例比远边大 7.4%（测试里的门槛是 5%）。

**两个符号我第一版都写反了**（看起来像"从对面看过来"，孔口的角还会盖不住），
是那条几何不变量当场算出来的 —— 这正是它存在的理由（D111 抓过一次同样的错）。

### 顺带定下来的两条几何关系（都写进测试）

- **底面转到底时，远角缩得最多**（两只轴同时往远推）：
  `plane ≥ (far + depth) / (cos θ × far − sin θ) = 1.2446`（θ = 1.4 × 10.5° = 14.7°）→ 取 **1.26**。
  测试不背这条式子，它把底面投影出来的四边形与孔口的**八个探针点**逐个验一遍。
- **孔沿那圈是固定的 4%**，不随视线变（D112 那种"眼睛偏哪边哪面宽"的活法没了）：
  它盖住斜看时远角那 2.75% 的缺口（`rim ≥ 缺口` 也写进测试），也是"板有厚度"的唯一静态证据。

**验收（运行期量到的）**：静止时 `matrix3d(1.26, …)`、底面 127.3px 对 113px 的格子（多 12.7%）；
挪到四角极端时，底面投影出来的**四边形每个角都还在孔口之外**（最近的一个 1.0005），
斜看时远角缩到 0.9344 而缺口 6.6% × 半宽 = 3.7px < 孔沿的 4.54px ✓；
悬停时 `--eye-x/--eye-y` 被写进来（0.832 / 0.682）、`transitionrun` 拿到两条自定义属性、
底面是真正的 `matrix3d(1.2599, …, -49.4)`（含旋转项与 translateZ）、离开即还原、
任何时刻只有一张卡持有眼睛；`perspective` 量到 395.2px = 4 × 98.8px（格子边长）。
画面仍然看不到像素，"好不好看"由用户看预览判。

**教训（第三次同一条）**：连续三轮我都把"几何上更讲究"当成进展，而用户的判据一直是
**"看起来像不像个真东西"**。三次都是被"这不真"否掉（D111 平移 → D112 平移+裁 → D113 真转）。
**能交给浏览器算的（真透视、真变换）就别自己手算** —— 手算的那两版都被看出来"像画的"。

**状态**：生效（S-P1 内落地；D111 的"孔 + 视线"地基、D105 的手感纪律继续有效）。

---

## D114 为什么"总是看着离得这么近"：底面被补成了跟孔口一样大 + 近侧往外鼓 + 坑壁太薄

**起因**：用户一句问话 —— "**为什么总是看着离得这么近？**"

**诊断（三条，都是 D113 自己埋的）**：

1. **底面成像被我自己补成了跟孔口一样大**：D113 为了"停止裁内容"，用
   `plane = 1 + depth/far` 把深度上的缩**抵消**掉了 —— 于是孔下面那片底面在画面里
   *正好*铺满孔口（1.12 倍）。一个跟洞口一样大的底面，看起来不是"在下面"，是"贴在洞口上"。
2. **转起来时近侧往外鼓**：底面比孔口大 12%，转的时候近侧还被放大 7% —— 净效果是那一侧
   **顶着孔口往外涨**，"贴着洞口 + 往外鼓"两下合起来 = 近。
3. **坑壁太薄**：`--anchor-rim` 只有 4%（4.5px）。真实的坑，看到的"深"主要来自**坑壁的高度**
   （一个立方体深的坑、从 4 格远看下去，坑壁在画面里约占边长的 12%）—— 4.5px 那圈薄边读起来
   就是"贴在洞口上"。

**决策**：

- **坑挖深**：`--anchor-depth: 1`（坑深 = 洞口边长，就是用户最早那句"空间类似一个正方体"）；
- **底面不再补满**：`--anchor-plane: 1.10` → 静止时成像 `1.10 × 0.8 = 0.88`
  —— **比孔口小一成二**，那一圈就是"它在下面"的那一眼；字号按同一比例补回来，字不会跟着变小；
- **坑壁加厚**：`--anchor-rim: 12%`（约 13.6px）；
- **转的幅度收到 10°**（挪到头 14°）：它和上面两个数是一组绳。

**这一轮算出来的一条硬边界（写进注释与测试）**：底面成像**最多只能比孔口小 ~13%** ——
它转到底时"远角"（两只轴同时往远推）缩得最多，再小斜着看时角上就露洞。
**想让"深"更明显只能加厚坑壁，不能继续缩底面**（要更深的观感就调 `--anchor-rim`）。
求解时试过的几组：tilt 10°/rim 12% → 成像 0.87；tilt 10°/rim 13% → 0.85（坑壁 14.7px，开始压内容）；
tilt 9°/rim 13% → 0.83。取的是中间那组偏保守的。

**顺手抓出的一个实装 bug（浏览器量出来的，单元测试看不出）**：透视写在 `.window` 上
（按**正文的 em** 算 = 4 × 98.8px = 395.2px），而深度写在 `.plane` 上
（按**字号补偿之后的 em** 算 = 1 × 112.3px）—— 两者单位不同，实际比例是 3.5 而不是 4。
症状：斜看时角上露 1.4px 的洞，而单元测试说"盖住了"。
**修法**：卡片上 `container-type: size`，深度与透视都改用 `cqh`（`100cqh` = 一格），
于是两者**都以格子的实际尺寸为准**，与模型完全一致。实测：透视 460px = 4 × 115px（格子）✓。

**验收（运行期量到的）**：静止时底面成像 **0.876**（D113 是 1.127 —— 一个在洞口里面，
一个顶到外面，整整差了两成半）、坑壁 13.64px、透视 460px；
挪到四角极端时底面的四边形仍然**盖住"孔口去掉孔沿那圈"的八个探针点**
（最近的一个 0.7597 对 0.7586）；近边/远边的投影比 5.4%（"真的在转"还在）。
测试里加了三条反向断言：**静止时底面要比孔口小 8% 以上**、**转到底时近边与远边都待在孔口之内**
（不往外鼓）、**字号要按成像比例补回来**。全量 `pnpm check` 绿。

**教训（第四次同一条，这次是"我自己给自己加戏"）**：D113 我为了"一个字都不裁"把底面补满，
把用户要的"深"给补没了 —— **修一个问题时不要顺手把另一条既有的观感抹掉**。
D114 的写法是两者都保住：底面小一圈（深），但字号补回来（读得清）。

---

## D115 立体那七轮全部删掉，只留相册

**起因**：D114 交出去之后用户又指出一处 —— "**有一个固定遮罩在影响我看底面。**"
（那两片确实存在，而且就是我画的：底面上的暗角 `radial-gradient(122% 108%)` 与玻璃那道
反光 `linear-gradient(146deg)`，两片都画在内容**之上**。）
还没等我动手，用户就给了最终判词：

> "**去掉后面的所有设计吧，你根本实现不了我的想法，那都去掉吧，只留相册设计**"

**决策：删，不是调。** D106~D114 那七轮的产物一个字都不留：

| 删掉的 | 它原来是干什么的 |
|---|---|
| `.window`（孔口）/ `.plane`（底面）/ `.wall-*`（孔沿）/ `.glass`（玻璃） | 四层嵌套的"板上的方孔" |
| `--eye-x` / `--eye-y` + `@property` + 240ms 插值 | 悬停时"视线"跟着指针在孔口上走 |
| `--anchor-depth / --anchor-far / --anchor-tilt / --anchor-plane / --anchor-rim` | 五个几何旋钮（坑深 / 视距 / 倾角 / 底面尺寸 / 坑壁厚） |
| `container-type: size` 与全部 `cqh` | 让深度与透视都以格子实际尺寸为单位（D114 修那个单位 bug 用的） |
| `.plane::after` 暗角、`.glass` 反光、`.plane` 的字号补偿 | 压在内容之上的那两片（用户说的"固定遮罩"）+ 跟着底面缩放的补偿 |
| `clientScript.ts` 里的 `EYE_MAX`、量 rect、rAF 合帧、减少动效早退 | "视线"的客户端那一半 |

**为什么删得这么干净**：留着就会有人（下一次的我）再去调它 —— 七轮都是这么来的。
D111 那轮已经写过"方向类反馈出现两次以上，就该整体换方案"；这次是用户直接点名"去掉"，
所以连"以后也许用得上"的念头都不留。

**留下的（相册，D101 的骨架一条没动）**：等大的砖（`aspect-ratio: 1/1`）、密集的网格（4px 缝）、
方一点的圆角（3px）、缩略图 + 底部渐隐（不完整，但 `title` 有全文）、悬停才显的页码条、
右上角那颗灰半透明粗体数字、按下去弹一下（`.pop`）—— D105 手感纪律的第 1、3、4 条继续有效。

**验收（预览页运行期量到的，格子 = 115px）**：16 块**全部 115×115**、横竖缝都正好 4px；
`.window / .plane / .wall / .glass / .focus` 各 **0 个**；`.thumb` 16 个（一块一份内容，
占满卡片的 98.8%，差的那 1.3px 就是那圈 1px 边框）；卡片上 `transform: none`、
`perspective: none`、`filter: none`（**一个 3D 都没有**）；
`elementFromPoint` 打在格子正中拿到的是 `.thumb` **本身** —— 内容之上没有任何一层；
静止时 `document.getAnimations()` 是空的；按下去 `.pop` 照旧；未选中的块底栏与那颗数字
`opacity: 0`（悬停/选中才显）。全量 `pnpm check` 绿（extension-anchor 312 例，
其中 blockView 那 15 条换成了相册的断言：等大/密集/方、DOM 只有一层、
孔口那四层与视线旋钮"不许回来"、客户端只剩指针那四件事）。

**教训（这一条是写给自己的）**：我连着七轮越做越"讲究"，而用户要的其实是一张**安静的相册**。
那七轮不是白花（几何不变量、真透视、单位一致性这些手艺留下了），但
**"能不能做得更真"从来不是这个项目的判据** —— 判据是用户那句"无感操作，又快又准"。
下次再碰视觉：**先给一个安静的版本，再问要不要加**；要加也只加一处，加完立刻问。

**状态**：生效（用户明确要求删）。相册版面 = D101，手感纪律 = D105 剩下的两条。

---

## D116 块流接真的宿主：问出去仍然走 `Anchor`，面板每次变化重画整页

**起因**：S-P1 交出去的是**纯函数 + 能预览的排版** —— `splitDocument` 有了两个消费者
（`preview-blocks.mjs` 与测试），但**宿主侧一处接线都没有**：没有面板、没有命令、
`blocks:*` 五条消息没有宿主侧解析、`blocks:ask` 是个声明。也就是说：用户到这一刻
**一次也没真的用过这块流**（预览页不算产品）。S-P2 的头一件就是这个。

**三个定下来的决定（都不动既有链路）**：

1. **问出去的载体是 `Anchor`，不是给编排加新入口**。`ExplainProvider` 是
   `(anchor) => Promise<ExplanationResult>` 这条"两侧签名一致"的接缝（ports.ts 里写着理由：
   换实现只动调用点上一行）。而 `Anchor` 上已经有三个字段正好是块流要说的全部：
   `extractedText`（第一层上下文 = 重排稿）、`segments`（选中每一块的位置）、
   `blockIds`（D104 的块身份，问答要挂回块上）。于是**编排、校验、侧边栏、播放、状态栏
   一行不改** —— `blocks:ask` 落到的就是既有的 `explain(anchor)`。
   代价：一根锚点的 `location` 只能是一个位置（PDF 的并集外框跨页时没有意义），
   所以取**第一块的第一段**，真相交给 `segments`。
2. **宿主侧状态机是纯函数**（`blocks/streamHost.ts`），vscode 那一层只搬运。
   "点一下会变成第几个""发出去的顺序"正是一堆号（约束 107 盯的那批），
   放在纯函数里 `node --test` 才盯得住 —— 与 `WalkthroughSession` 同一条理由。
3. **面板每次变化重设整个 HTML**，不做增量 DOM。真相只有一份（宿主），
   客户端永远只画宿主给的那一份 —— §12.4.2 于是**结构上成立**，不是靠自觉。
   唯一要保住的客户端的数是滚动位置（`setState({ scrollTop })`，加载后校正一次）。

**顺手修掉的一个真 bug（只有接真宿主才会撞到）**：
`getDocument` 会把喂进去的字节**transfer 走** —— 而 S-P2 的文档指纹（sha1）正好是
"读完字节算一个 hash"。测试里用了一个**缓存式**的字节端口（复用同一块缓冲），
于是第二次读拿到的是**已经被 transfer 走的空数组**，指纹静默变成**空串的 sha1**
（`da39a3ee…`）。这块指纹是块身份（D100）的文档维度 —— 错了不会报错，只会让"重开
同一份文档、块 ID 认不回来"。
两处都修：`pdfjsSource` 改成**无条件复制**（不再只在"不是 Uint8Array"时才复制），
`readSplitInput` 改成**先算指纹再打开**（顺序无关地安全）。测试里那条断言
现在比的是**文件内容的 sha1 本身**，并额外断言"调用方那块缓冲没被吃掉"。

**没做（留给 S-P2b，已写进 `SLICES.md` 的"明确不做"）**：`PageImageIn`（图块从 pdf.js
算子表拿 bbox）、卡片裁剪图的栅格路径、D104 尾巴（注入脚本侧四个分支 + 0.9s 停稳计时 + 
宿主侧 `pageSettled`/`pageText`/`blockClick` 消费者）。

**状态**：生效（S-P2a 落地；`pnpm check` 绿，新增 10 条宿主侧测试，含真 30 页样张）。

## D117 取件范围的两处算错：锚点不在工作区里 = 什么都读不到；再加一个"不限"档

**决策**：
1. `related` 档的允许范围改成**按"锚点在工作区里吗"分两种**（`relatedRoots`，
   落在 `orchestrator/validateContextRequest.ts`，纯函数可单测）：
   - **在**（工作区根覆盖锚点）→ 范围就是工作区根，**不多加任何东西**；
   - **不在**（用「打开文件」打开的、或开发宿主窗口开在别的目录）→ 退化成
     **锚点所在的这一层** = 锚点目录 + 它的上一层。
2. 新增第四档 **`any`（不限）**：不按根判范围，写绝对路径就能读工作区之外的文件。
   密钥/依赖/构建产物那道黑名单**照挡** —— 它与"范围"是两件事。
3. 候选文件清单里"不同目录"的写法，基准从**工作区根**改成**锚点目录**
   （`candidateDisplayName` → `../Inc/dshot_dma.h`）。
4. 拒绝文案必须说清**当前档位**与**实际生效的根**，并给出"改成 `any`"这条出路；
   第一句以句号收尾（进度通知只取第一句）。

**理由（用户实测那条报错：`"../Inc/dshot_dma.h" 不在允许的范围内`）**：
那个头文件**就在锚点文件的兄弟目录里**（源在 `Driver/dshot/Src/`、头在 `Driver/dshot/Inc/`，
嵌入式最常见的形状），而锚点在窗口中打开的文件夹**之外**。于是链条是这样塌的：
`related` 的范围只有工作区根 → 锚点目录从来不是根 → `../Inc/...` 算出来的绝对路径不在任何根里，
**连它旁边同目录的文件也一样被拒**。而提示词与拒绝文案都在教模型"相对路径按锚点文件所在目录算"
—— 那条规则在这一刻**根本不生效**，照它改写法只会一次次被拒。
换句话说：不是解析写错了，是**范围的定义漏了一种前提**（"锚点在工作区里"被当成了必然）。

**为什么上一层是必要的，而不是顺手放开**：`Src/` 与 `Inc/` 是兄弟目录，这就是嵌入式工程的形状。
只给锚点目录一个根，`../Inc/x.h` 永远过不去；而给到上一层，跨目录的写法当场成立。
**为什么不无条件加**：锚点恰好在工作区根直下时，它的上一层就是工作区根的外面（那是整个盘）——
所以"在"与"不在"两种前提必须分开算，各自的边界都要能说清。

**为什么清单的基准也要改**：取件闸门解析相对路径先按**锚点目录**算，而清单原来给的是
**工作区相对路径**（`Drivers/hal_gpio.h`）→ 模型照抄，解析成 `<锚点目录>/Drivers/hal_gpio.h`，
**一个不存在的路径**。用户实测的 `ENOENT: … transport_uart.c` 就是这个形状（D96 接住了它，
但那一轮白烧）。改成相对锚点目录之后，清单里的名字**按构造**指向那个文件
（`relatedFiles.test.ts` 里有一条断言把它钉死：名字解析回来必须就是那个绝对路径）。

**没做，以及为什么**（诚实交代，免得下次重新踩）：
闸门只取 `candidates[0]`，而"同一个相对写法按锚点目录算还是按工作区根算"本身有歧义
（`include/ring_buffer.h` 两种都讲得通）。真正的解法是**把批准的候选都交给适配器逐个试**
（谁存在读谁），但 `params.path` 是单值：日志、去重、"读过的文件"允许集合都建在它上面，
改它要动 §3.2 的契约与四处消费者 —— 不属于这次的范围。当前用"清单基准统一"绕开了最常见的歧义。

**状态**：生效。单测 333（线1）+ 50（core）；链式冒烟新增 4 条（拒绝文案报档位与根、
`any` 档真读到工作区外的文件、锚点不在工作区里时 `ring_buffer.h` 与 `../fixtures/ring_buffer.h` 都取得到）。
