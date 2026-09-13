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
