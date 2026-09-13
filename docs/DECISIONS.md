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
