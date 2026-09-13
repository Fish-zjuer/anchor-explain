# SLICES.md — 切片计划

> 切片是**唯一的工作单位**。一次只做一个切片，独立验收、独立回退（`git tag slice-<编号>`）。
> 用户说不符合就**回退**，不在上面叠加修补。
> 开工前把当前切片的「目标 / 范围 / 验收标准 / 回退点」写全；收工后标记完成。

## 编号说明

- `F*` = 基础层（Foundation）：契约与测试台。**先建基础，上层在其上构建。**
- `S*` = 功能切片（Slice）：按体感优先排序，线1 先于线2。

## 总览

| 编号 | 目标 | 验收 | 状态 |
|---|---|---|---|
| F1 | 契约冻结：`packages/core` 类型与 ports 落地 | 自动化 | 完成 `slice-F1` |
| F2 | 走通骨架 + 测试台（能装能编能跑能测 + 假货 + fixture） | 自动化 | 完成 `slice-F2` |
| S1 | 线1 最小可视：F5 → main.c → FakeProvider 写死 3 step → 高亮流转 → ESC 清除 | **用户实操确认** | 完成 `slice-S1`（用户四轮实测反馈后通过） |
| S2 | 线1 触发与确认 UI（选区 → QuickPick → 发送） | 用户实操 | 完成 `slice-S2` |
| S3 | 线1 接真实 AI（openAICompatible） | 自动化 + 用户实操 | 代码与自动化完成 `slice-S3`，**待用户配 key 实操** |
| S4 | PDF fork 骨架：改名 / 不劫持 / 能打开 | 用户实操 | 代码与自动化完成 `slice-S4`，**待用户实操** |
| S5 | PDF 注入 overlay 框选 | 用户实操（拖拽手感必须本人确认） | 代码与自动化完成 `slice-S5`，**待用户实操** |
| S6 | PDF 框选 → Anchor → 侧边栏讲解（含点击滚动定位） | 自动化 + 用户实操 | 代码与自动化完成 `slice-S6`，**待用户实操** |
| S7 | PDF 取件（page_range 取附近页文字） | 自动化 | 完成 `slice-S7` |
| S8 | 固定按钮（活动栏）+ 开始界面（面板与演练卡片），**快捷键一个都不动** | 自动化 + 用户实操 | 代码与自动化完成 `slice-S8`，**待用户实操** |

## 硬性约束

> **S1 必须用户实操确认后，才允许进入 S2。不允许"先做完再一起看"。**

原因：S1 决定的是"荧光笔手感"这类只能靠眼睛判断的东西，一旦错误被后续切片固化，返工面会涉及播放器、侧边栏、键位三层。

## 防返工的关键约定（所有切片共用）

**假货只允许出现在最外层边界，中间链路必须全真。**

| 切片 | 假的东西 | 真的东西 |
|---|---|---|
| S1 | AI 从哪来（`FakeProvider` 返回写死的 `ExplanationResult`）、选区从哪来（`EditorPort` 的假实现返回写死 40-48 行） | `ExplanationResult → 校验 → 会话状态 → decoration 渲染 → 侧边栏 → 状态栏 → 键位` **全真** |
| S2 | 仅 AI（`FakeProvider`） | 以上全部 + **真实选区捕获**（`EditorPort` 无任何覆盖层，`fakes/fakeEditorPort.ts` 已从产物退出） |
| S3 | 无 | 全部真实 |

因此 S2 = 换掉"选区来源"一个件；S3 = 换掉 `FakeProvider` 一个文件。**上层零改动。**

反面对照（已否决的做法）：把 3 个 step 写死在**播放器**里。那样 S1 只验证了"播放器能画框"，真实链路的形状到 S3 才第一次暴露，上层就得重写。

---

## F1 契约冻结

**状态：实现与自动化验收完成（2026-09-13）**

- **目标**：把规范里的 6 个接口 + ports + 命令 ID 与默认键位 + 跨扩展消息协议落成真实代码。**此后接口不再变，除非用户确认。**
- **范围**：
  - `packages/core/package.json`、`packages/core/tsconfig.json`
  - `packages/core/src/types.ts`、`ports.ts`、`normalizeBBox.ts`、`locationLabel.ts`、`errors.ts`、`logging.ts`
  - 同步 `docs/CONTRACTS.md`：条目状态从「待落地」改为「已冻结」，补 `path:line`
- **不做**：任何行为逻辑。只有类型、接口、纯函数。
- **验收标准**：自动化 —— `tsc --noEmit` 通过；`node --test` 覆盖 `normalizeBBox`（0、1、越界、反向、退化零面积）与 `locationLabel`（两种来源）；`CONTRACTS.md` 所有条目状态为「已冻结」。
- **回退点**：`slice-F0`

### 实际落地（比声明范围多出 3 个文件，均为机械必需）

| 文件 | 说明 |
|---|---|
| `packages/core/src/index.ts` | barrel 入口，外部一律从 `@anchor/core` 导入，不深链 `src/` |
| `packages/core/test/*.test.ts` | 3 个文件，F1 验收标准要求 |
| `.gitignore` | 原声明在 F2，但 F1 执行 `pnpm install` 会产生 `node_modules`，不建会误提交 |

`packages/core/README.md` 按声明**留到 F2**（F2 范围含"各 package README"）。

### F1 期间修正的一处偏离

`SourceAdapter.detect()` 一度被写成 `Promise<boolean>`，与规范原文（同步 `boolean`）不符。
已改回同步并在 `CONTRACTS.md` §3 与 `types.ts` 内注明"不要改成 Promise"。属纠正而非契约变更。

## F2 走通骨架 + 测试台

**状态：实现与自动化验收完成（2026-09-13）**

- **目标**：能装能编能跑能测的空骨架，且测试替身与 fixture 就位。**这就是用户要的"基础 / 测试环境"。**
- **范围**：
  - 根 `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`.vscodeignore`、`esbuild.mjs`
  - **删掉 `packages/core/pnpm-lock.yaml` 并在根重装**：F1 的 `pnpm install` 是在 `packages/core/` 内跑的，
    lockfile 位置与 D26 不符（见 `CONTRACTS.md` §9.3）
  - `.gitignore` **已于 F1 落地**（F1 需要它来挡住 `node_modules`），本片不再创建
  - `packages/extension-anchor/{package.json, src/extension.ts}` 最小可激活（一个 `Anchor: 显示状态` 命令弹通知）
  - `.vscode/launch.json`、`tasks.json`（F5 起调试宿主）
  - `packages/core/src/fakes/{fakeProvider.ts, fakeEditorPort.ts}`
  - `scripts/make-fixture-pdf.mjs` → 生成 30 页 `test/fixtures/sample-30p.pdf`
  - `test/fixtures/main.c`（≥48 行，供 S1/S2 选 40-48 行）
  - 各 package README（入口 + 职责）
- **验收标准**：自动化 —— `pnpm install && pnpm build` 通过；`node --test` 绿；F5 能起调试宿主、命令面板出现 `Anchor: 显示状态` 并弹出通知。**无视觉产出，不需用户实操。**
- **回退点**：`slice-F1`

### 实际落地（比声明范围多的部分，均为机械必需或强化验收）

| 文件 | 为什么多出来 |
|---|---|
| `packages/extension-anchor/.vscodeignore` | 声明里写作"根 `.vscodeignore`"，但该文件是 `vsce` 的**per-extension** 配置，放根上不起作用。改放扩展包内 |
| `packages/core/test/fakes.test.ts` | 替身是本片新增的可执行代码，不给它单测等于"新增行为零覆盖"。其中一条是**耦合锁**：断言 `FAKE_SELECTION_TEXT` 与 `main.c` 第 40-48 行逐字一致 |
| `scripts/smoke-extension.mjs` | 把"F5 能起调试宿主"从纯肉眼验收变成自动化：不启动 VS Code，只对 `vscode` 打桩，断言产物可加载 + core 真被 bundle。见 `DECISIONS.md` D36 |
| 根 `README.md` | 人类视角的"怎么装怎么跑"入口；`AGENTS.md` 是给 agent 的，不适合当安装说明 |
| `packages/core/tsconfig.json`（**修改**） | 原为内联全部 compilerOptions。声明要求建 `tsconfig.base.json`，一个没人 `extends` 的 base 是死配置，所以改为 `extends` |
| `packages/core/src/ports.ts`（**修改**） | 追加 `ExplainProvider` 接缝，让"假 provider → 真 orchestrator"的替换只改调用点一行。见 D37 |
| `.gitattributes`（根） | 独立校验抓出来的：本机 `core.autocrlf=true` 而仓库无换行符约定，`main.c` 一落盘就变 CRLF，直接打红本片新加的耦合锁。见 D40 |
| `.gitignore`（**修改**） | 同上轮校验：`dist/` 是泛匹配，会误伤 S4 要提交的 `assets/pdf.js/` 下同名目录。收窄为 `packages/*/dist/` |

### F2 期间修正的三处问题（均由独立只读校验抓出）

| 问题 | 修正 |
|---|---|
| `@types/vscode: ^1.90.0` 实际解析到 **1.137.0**，而 `engines.vscode` 承诺 `^1.90.0` —— `tsc` 会静默放行 1.90 上不存在的 API。**阻塞级** | 改为精确版本 `1.90.0`，并写入 `CONTRACTS.md` §9.5 / D39 |
| 无 `.gitattributes` + `core.autocrlf=true` → `main.c` 重新 checkout 后变 CRLF，耦合锁必红 | 加根 `.gitattributes` 钉 LF；测试侧改按 `/\r?\n/` 切分兜底。见 D40 |
| `title: "Anchor: 显示状态"` + `category: "Anchor"` → 面板显示成 `Anchor: Anchor: 显示状态` | `title` 改回纯动作 `显示状态`，并把这个约定写进 `CONTRACTS.md` §4.1 |

另外三份 README 里"打包两个扩展""check 是三件事""漏写 `pnpm smoke`""包内相对路径写错"也已一并更正。

### F2 期间修正的一处失败

`pnpm-workspace.yaml` 最初按 pnpm 10 的写法用了 `onlyBuiltDependencies:`（列表）。pnpm 11 不认，
`pnpm install` 直接把 `allowBuilds:\n  esbuild: set this to true or false` 占位符写回了该文件。
改为 `allowBuilds: { esbuild: true }` 后警告消失。见 D35。
（附带确认：esbuild 平台二进制走 optional dependency，**即使被拦也能用**，放行只为消噪音。）

## S1 线1 最小可视

- **目标**：F5 → 打开 `main.c` → **`FakeProvider` 返回写死的 3 个合法 step** → 真实链路（校验 → 会话状态 → decoration → 侧边栏 → 状态栏）→ 流转 → ESC 清除。
- **范围**：
  - `packages/extension-anchor/src/playback/{CodeWalkthroughPlayer.ts, WalkthroughSession.ts}`
  - `packages/extension-anchor/src/sidebar/{SidebarPanel.ts, ui/*}`（原生 DOM，不用 React）
  - `packages/extension-anchor/src/sidebar/{statusBar.ts, keybindingResolve.ts}`
  - `packages/extension-anchor/src/commands.ts`
  - `packages/extension-anchor/src/vscode/ports/{editorPort.ts, fileSystemPort.ts}`（此处为 S1 的**假选区**实现）
  - `packages/extension-anchor/src/orchestrator/validateExplanation.ts`（首次落地）
  - `packages/extension-anchor/package.json` 的 `contributes.commands` / `contributes.keybindings`
- **验收标准**：**用户实操确认**（高亮像不像荧光笔、扫描顺不顺）。补充硬指标：
  - 高亮为**半透明背景 + `isWholeLine` + border**，纯视觉
  - 文件 `isDirty === false` 且**字节未变**
  - 键位走 `contributes.keybindings` 默认声明，**不硬编码 Space**
  - 状态栏提示**反映用户实际绑定**
  - **块级底色在各拍之间必须完全一致**，且任意一拍最多只有一行被单独点亮（D48）
- **回退点**：`slice-F2`
- **状态**：实现与自动化验收完成（2026-09-13）。**硬门未过：等用户 F5 实操确认后才进 S2。**

### S1 实际落地

声明范围全部落地，另有几处**声明外的新增**（都是把"最小可视"补成一条能自动验的链路，逐条说明理由）：

| 文件 | 说明 |
|---|---|
| `src/orchestrator/validateExplanation.ts` | 声明内。§3.3 全条 + 两条实现约定（D44 严一格；emphasis 未知值降级） |
| `src/protocol.ts` | 声明内。§5 全部消息类型 + 两处边界守卫（`isAnchorLike` / `parseSidebarMessage`） |
| `src/playback/{WalkthroughSession,CodeWalkthroughPlayer}.ts` | 声明内 |
| `src/playback/decorationPlan.ts` | **新增**。「该画哪些框」的纯决策。理由：播放器的决策若和 vscode 调用混在一起，配色分支就没法在 `node --test` 里验，只能靠肉眼看 |
| `src/sidebar/{SidebarPanel,statusBar,keybindingResolve}.ts` + `ui/*` | 声明内。`ui/` 是三个 TS 模块（内联进 webview，D42），不是静态资源目录 |
| `src/vscode/ports/{editorPort,fileSystemPort}.ts` | 声明内。四个方法里只有 `getSelection` 被替身顶掉，其余 S1 起就是真实现 |
| `src/paths.ts` | **新增**。路径归一/比较/行数。理由：`"同一个文件"`这个判断出现在四处（校验闸门、播放器、端口、staleness），各写一遍早晚有一处写成严格比较，表现为"高亮跑到另一个标签页" |
| `src/commands.ts` | 声明内。8 个命令 + 四层装配 + **唯一的假货接线点** |
| `test/*.test.ts`（5 个，54 条） | **新增**。补上约束 16 说的空格 |
| `scripts/smoke-walkthrough.mjs` | **新增**（D43）。`capture` 从选区跑到 decoration 的链路冒烟 |
| `scripts/def-lines.mjs` | **新增**。`CONTRACTS §9.1` 行号表的一次性生成器，防手写行号漂移 |

**两处偏离，均已声明**：

1. `adapters/CodeAdapter.ts` **没有落地** —— `capture()` 的等价逻辑（选区 → `Anchor`）
   临时住在 `commands.ts` 的 `buildAnchor()` 里，S2 搬走。理由：S1 手里只有一条来源线，
   提前抽 `SourceAdapter` 接口等于凭空猜第二个消费者的形状。
2. `contributes.keybindings` 额外给了 mac 变体（`key` + `mac` 两个字段）。§4.1 只写了 ctrl 形式，
   但 `keybindings` 的 `mac` 字段本来就是为这件事存在的（D45）。

### S1 第二轮（用户实测反馈后）

用户 F5 实测通过，但报了三件事，都已改完（`DECISIONS.md` D48 / D49）：

| 反馈 | 真因 | 处置 |
|---|---|---|
| "荧光不够统一，隔行就变颜色" | 同一 step 的**所有**子高亮被同时点亮 → 三行三种混合色 | 游标改成「**拍**」：整块 1 拍 + 每个逻辑点 1 拍，一次只亮一个点 |
| "讲解不够细？应该浅色荧光包住整块 + 一个荧光扫描内部逐个小逻辑点" | 一拍 = 一整步，粒度太粗 | 同上；`Ctrl+Shift+Space` 可自动扫 |
| "ESC 好像没有，后面都没法测了" | 编辑器被释放后 `setDecorations` 抛异常，把 `stop()` 的收尾整段跳过；渲染面一抛还会被误判成"讲解失败"并落掉 `sessionOpen` | 状态先置、渲染面各自隔离、清框兜异常、`startSession` 移出 try |
| "状态栏没找到"（用户说"小事，后面固定到一个地方就行"） | 未定论 | `Anchor: 显示状态` 增报状态栏项的 `shown`/`text`；落点待用户决定 |

新增/改动的文件：`WalkthroughSession.ts`（拍游标 + 4 个纯函数）、`decorationPlan.ts`
（`planForStep` → `planForBeat`）、`CodeWalkthroughPlayer.ts`（清框兜异常）、`commands.ts`
（`stop`/`emit`/`explain` 的顺序与隔离）、`statusBar.ts`（扫描位置 + `probe()`）、
`protocol.ts`（`session:update` + `pointIndex`）、`ui/clientScript.ts`（`▸` 标记、
按 `state` 而非步骤下标禁用按钮）、`ui/styles.ts`、两个 smoke 脚本、单测。

### S1 自动化验收结果

`pnpm check`：typecheck 0 错 → **93 测**（core 28 + ext 65）全过 → build → `pnpm smoke` **19 项**
→ `pnpm smoke:chain` **67 项**（数字都是运行时实际执行到的断言数，不是 `grep` 出来的调用点数）。
链路冒烟的硬断言包括「整块那一拍一个子高亮都不亮」「扫描时只亮一个点、上一个点已灭」
「扫完两个点才进第 2 步」「5 个 decoration type 全部 `isWholeLine` + `ClosedClosed` + 主题色、无写死颜色」
「done 时状态栏是「已讲完」且不再展示已失效的 next/prev」「`sessionOpen` 在 done 时仍为 true」
「stop 后所有 decoration type 清空」「**编辑器已释放 / `setDecorations` 直接抛时 `stop()` 仍要收完尾**」
「`main.c` 字节未变」「`applyEdit` 从未被调用」，外加 `pnpm smoke` 的结构性断言：
**产物里根本不存在写文件的 API**。

**独立只读校验（D32）第一轮抓到并已修的 2 个阻塞级 + 6 项需修正**见上表与 `DECISIONS.md` D46/D47。

**未被自动化覆盖、必须靠 F5 的**：配色好不好看、扫描顺不顺、`borderWidth: '0 0 0 3px'`
在真实主题下渲染成什么样、焦点落在侧边栏面板里时键位还灵不灵（D47 的转发逻辑），
以及**侧边栏客户端脚本的 DOM 行为**（已知缺口，见 `STATE.md`）。

## S2 线1 触发与确认 UI

- **目标**：把假选区换成真选区，加 QuickPick 确认（「讲解这段 / 整个文件」）。
- **范围**：`src/vscode/ports/editorPort.ts`（接 `window.activeTextEditor`）、`src/commands.ts`（确认流程）、`src/adapters/CodeAdapter.ts`（首次落地 `capture`）
- **验收标准**：**用户实操** —— 选中 40-48 行 → 快捷键 → 出现确认 → 确认后结果与 S1 一致。
- **回退点**：`slice-S1`

### S2 落地结果（2026-09-13，tag `slice-S2`）

| 声明范围内 | 落地 |
|---|---|
| `src/vscode/ports/editorPort.ts` | 新增 `getDocumentSelection()`（真实现，优先取内存文档）；`getSelection` 的替身覆盖已删 |
| `src/commands.ts` | 删 `resolveS1FixturePath()` + 假选区覆盖；新增 `askWhatToExplain()`（§4.1.1 四条分支）；`capture()` 改走确认 → `codeAdapter.capture(scope)` → `explain()`；`showState` 增报「上次捕获」 |
| `src/adapters/CodeAdapter.ts` | **首次落地**：`type` / `capabilities` / `capture(scope?)` |
| `packages/core/src/ports.ts` | `EditorPort` 加 `getDocumentSelection()`（**契约追加，非规范原文，已在 CONTRACTS §2 同步**） |
| `packages/core/src/fakes/fakeEditorPort.ts` | 兑现新方法 + `FAKE_DOCUMENT_LINE_COUNT` / `FAKE_DOCUMENT_TEXT` |
| `src/paths.ts` | 新增 `basenameOf()`（显示名，跨平台一致） |
| **新增** `test/CodeAdapter.test.ts` | 7 条：真选区 / 整文件 / 缺省 / 指纹退化 / 两种缺件抛错 / capabilities / 形状仍满足 `SourceAdapter` |
| `scripts/smoke-walkthrough.mjs` | 桩补 `editor.selection`（可改）+ Range 感知的 `getText` + 可回答的 `showQuickPick`/`showWarningMessage`；新增第 9 节 15 项 |
| `scripts/smoke-extension.mjs` | 新增 4 项，含两条「假选区已从产物里 tree-shake 掉」；`bundleText` 现在会先做 `\uXXXX` 反解（esbuild 默认 `charset=ascii`，否则中文断言永远假红） |

**两处偏离，均已声明**：

1. **`detect()` / `fetchContext()` 没落**。它们的调用方（适配器注册表、§3.2 取件校验）S3 才存在。
   属**分期兑现**冻结接口，不是接口变更（CONTRACTS §3.1 已写明）。
   也因此 S2 的 `CodeAdapter` 还不满足 `SourceAdapter` 的完整形状 —— 它满足的是"落地的那部分 + 不违背签名"。
2. **`capture()` 多一个可选参数**（§3.1）。可选参数仍可赋值给零参签名，接口没变，有单测钉住。

**自动化验收结果**：`pnpm check` 全绿 —— 100 测（core 28 + ext 72）→ `pnpm smoke` 23 项
→ `pnpm smoke:chain` 82 项。第 9 节把桩选区改成 `第 10-14 行`（**替身写死 40-48，给不出这个值**），
再断言锚点跟着走 —— 这是"真选区确实接上了"的硬证据，不是"看起来一样"。

**验收靠**：**用户实操**。选中一段 → `Ctrl+Shift+A` → 出现确认 → 选「讲解这段」→ 结果与 S1 一致；
再试「整个文件」与「只放光标」两条分支，并按 `Anchor: 显示状态` 核对「上次捕获」。


## S3 线1 接真实 AI

- **目标**：把 `FakeProvider` 换成 `openAICompatible`，接上 orchestrator 的 `fetch_context` 循环（≤3 轮）。
- **范围**：`src/orchestrator/{Orchestrator.ts, ModelRouter.ts, toolSchema.ts, validateContextRequest.ts, providers/{types.ts, openAICompatible.ts}}`、`src/prompts/*`、`src/adapters/CodeAdapter.ts` 的 `fetchContext`、`src/config.ts`
- **验收标准**：自动化（mock 驱动的编排循环测试：≤3 轮、取件命中、非法请求走拒绝路径）+ **用户实操**（真 key 下走通一次）
- **回退点**：`slice-S2`

### S3 落地结果（2026-09-13，tag `slice-S3`）

| 声明范围内 | 落地 |
|---|---|
| `src/orchestrator/Orchestrator.ts` | **新增**。取件循环（≤maxFetchRounds）→ §3.3 闸门 → repair 一次。**它就是 `fakeProvider` 的真身** |
| `src/orchestrator/validateContextRequest.ts` | **新增**。§3.2 五条规则的实现 |
| `src/orchestrator/ModelRouter.ts` | **新增**。tier1/tier2 成本分层 |
| `src/orchestrator/toolSchema.ts` | **新增**。§8 工具定义 + 参数解析 |
| `src/orchestrator/providers/{types,openAICompatible}.ts` | **新增**。LLM 调用面抽象 + OpenAI 兼容实现（`fetchImpl` 可注入） |
| `src/prompts/index.ts` | **新增**。system / user / repair 三段指令 + 输出契约 |
| `src/config.ts` | **新增**。§6 配置的纯映射 |
| `src/vscode/configSource.ts` | **新增**（未在范围内，见偏离 3）。设置 + SecretStorage 的读取侧 |
| `src/adapters/CodeAdapter.ts` | 补 `fetchContext()`（带行号）；`detect()` 归 S7 |
| `src/commands.ts` | 删掉最后一行替身；`explain()` 改成现读配置现建编排器；取件日志落 OutputChannel；`showState` 增报模型配置；新增 `setApiKey` 命令 |
| `packages/core/src/fakes/fakeFileSystemPort.ts` | **新增**（未在范围内，见偏离 4）。让 `fetchContext` 的决策可单测 |
| `package.json` | `contributes.configuration`（§6 的五项）+ `setApiKey` 命令 + 激活事件 |
| **新增测试 4 个文件 41 条** | `validateContextRequest`（§3.2 五条规则各一条 + 两个顺序约定）、`orchestrator`（14 条，含 repair 一次、MAX_ROUNDS、拒绝回灌）、`provider`（6 条，含四种失败路径）、`config`（7 条） |
| `scripts/smoke-walkthrough.mjs` | 桩补 `getConfiguration` / `secrets` / `createOutputChannel` + `globalThis.fetch`；新增第 10 节 20 项 |
| `scripts/smoke-extension.mjs` | 桩补配置；`showState` 改成 await（它现在是异步的）；新增 7 项（**两个替身都已退出产物** + 真编排循环在产物里） |

**四处偏离，均已声明**：

1. **`prompts/` 合成一个模块**（`prompts/index.ts`）而不是三个文件。理由：输出契约那一段必须在
   system 与 repair 两处**逐字一致**，拆成两个文件迟早会出现"repair 里少写了一条规则"。
2. **`CodeAdapter.detect()` 仍未落**，改归 S7：一个适配器的时候"谁适用"是句废话，
   等出现 `PDFAdapter` 才第一次有真假之别。属分期兑现，不是接口变更。
3. **新增 `src/vscode/configSource.ts`**（原范围只写了 `src/config.ts`）。
   拆开的理由是"读 vscode"与"算配置"必须分层，否则配置映射的几条分支永远只有肉眼覆盖。
4. **新增 `packages/core/src/fakes/fakeFileSystemPort.ts`**：`fetchContext` 要读文件，
   没有替身就只能靠真 fixture，那会让"取哪几行"这件事变成不可单测的。

**自动化验收结果**：`pnpm check` 全绿 —— 141 测（core 28 + ext 113）→ `pnpm smoke` 30 项
→ `pnpm smoke:chain` 105 项。**链路的 S3 一节跑的是真编排循环**，
只有 `globalThis.fetch` 是桩，所以六条路径（取件一轮 / 越界被拒 / 一直要上下文 / 没配 provider /
连不上端点 / 取消确认不发请求）都在冒烟里真的走过。

**验收靠**：**用户实操**，需要一把真 key：
`Anchor: 设置 API Key` 存 key → 在设置里填 `anchorExplain.providers`（`baseUrl` + `tier1Model`）
→ 选中一段 → `Ctrl+Shift+A`。`Anchor: 显示状态` 会报当前用的是哪个模型。

## S4 PDF fork 骨架

- **目标**：fork 进 `packages/extension-anchor-pdf`，改名 / 不劫持 / 能打开。
- **范围**：整个 fork 树 + `MODIFICATIONS.md`（记录上游 commit SHA 作 diff 基线）；改 `publisher` / `name` / `viewType`（`pdf.view` → `anchorPdf.view`）/ 命令与配置命名空间（`pdf.*` → `anchorPdf.*`）/ `displayName`，**移除一切上游品牌字样**；`customEditors` 加 `"priority": "option"`
- **验收标准**：**用户实操** —— 命令面板 `用 Anchor 打开 PDF` 能打开；**默认 PDF 打开仍是原扩展**（不劫持）；`anchorPdf.*` 配置节出现。
- **回退点**：`slice-S3`

### S4 落地结果（2026-09-13，tag `slice-S4`）

fork 基线：`1153346694f457bc7b4c73c9b0e95b629f02dc03`（上游 `0.2.5`，2026-09-05）。
**只 clone 下来看，没有跑上游任何 setup 脚本。**

| 声明范围内 | 落地 |
|---|---|
| 整个 fork 树 | `packages/extension-anchor-pdf/`：`src/`（7 个文件）`assets/`（23MB，含 vendored pdf.js）`patches/` `pdfjs_version.txt` `tools/check_pdfjs.mjs` `LICENSE` |
| `MODIFICATIONS.md` | **新增**。fork 基线 SHA + 「保留原样 / 改动清单 / 删掉的设施 / 许可与署名 / 将来怎么升 pdf.js」五节 |
| 改名 / 移除品牌 | `publisher` → `anchor`、`name` → `anchor-pdf`、`displayName` → `Anchor PDF 视图`、`viewType` → `anchorPdf.view`、配置命名空间 → `anchorPdf.*`；删 `author` / `repository` / `icon` |
| 不劫持 | `customEditors[0].priority = "option"` **＋** 新增命令 `anchorPdf.openInAnchorViewer`（只做一半等于"用户进不来"） |
| 上游捐赠弹窗 | **删除**（品牌推广 + 替用户做主，见 D53 第 2 条） |
| **新增** `README.md` | 本包的入口表、怎么跑、怎么验"没有劫持"、边界（不碰 `assets/pdf.js`、不画高亮框） |
| **新增** `.gitattributes` | 字节敏感资源标 `binary`（168 个 `.bcmap` / 10 个 `.pfb` / 4 个 `.wasm`） |
| **新增** `scripts/smoke-pdf-extension.mjs` + `pnpm smoke:pdf` | 35 项。不只查结构：真调一次命令，断言它打到 `vscode.openWith` 且用 `anchorPdf.view` |
| `esbuild.mjs` | `TARGETS` 加第二个目标（含 `.html` 的 text loader），**没有另写打包脚本** |
| `tsconfig.json` | `extends` 根基线，唯一例外是 `moduleResolution: "Bundler"`（理由见 D53 第 7 条） |

**一处偏离，已声明**：`engines.vscode` 从上游的 `^1.134.0` **降到 `^1.90.0`**（与线1 一致；
实际用到的 API 都是 1.90 就有的）。属范围外的一处主动改动，记在 `MODIFICATIONS.md` 的字段表里。

**自动化验收结果**：`pnpm check` 全绿 —— 141 测（core 28 + ext 113）+ `pnpm smoke` 30 项
+ `pnpm smoke:chain` 105 项 + `pnpm smoke:pdf` 35 项 + `pnpm --filter anchor-pdf test`
（上游的 pdf.js 不变式守卫：`PDF.js assets verified (113 locales)`）。

**验收靠**：**用户实操**，三条都要看：
1. 起宿主 → 命令面板 `Anchor: 用 Anchor 打开 PDF` → 选 `sample-30p.pdf` → 能用我们的视图打开
   （当时写的是 `code --extensionDevelopmentPath=packages/extension-anchor-pdf test/fixtures`；
   **现在一律用 `pnpm devhost:pdf`** —— 手敲相对路径是个静默坑，见 D59）
2. **直接双击**一个 `.pdf`（不装/不卸载都试）→ 应由别的扩展或内置打开（**不劫持**）
3. 设置里搜 `anchorPdf` → 两个配置项都在（证明命名空间改对了）

## S5 PDF 注入 overlay 框选

- **目标**：注入式 overlay，能拖拽画矩形，**不碰 `assets/pdf.js/`**。
- **范围**：`packages/extension-anchor-pdf/media/anchor-select.js`、`src/anchor/{rectToNormalizedBBox.ts, captureAnchor.ts, bridge.ts}`
- **验收标准**：**用户实操（拖拽手感必须本人确认）** + 自动化（`rectToNormalizedBBox` 纯函数单测）。
- **回退点**：`slice-S4`

### S5 落地结果（2026-09-13，tag `slice-S5`）

| 声明范围内 | 落地 |
|---|---|
| `packages/extension-anchor-pdf/media/anchor-select.js` | **新增**。注入式 overlay：橡皮筋、四个退出口、§5.2 三个消息名。**一行业务数学都不做** |
| `src/anchor/rectToNormalizedBBox.ts` | **新增**。像素矩形 → 「第几页 + 归一化 bbox」的全部换算（`intersectRects` / `pickDominantPage` / `rectToNormalizedBBox` / `resolveSelection`） |
| `src/anchor/captureAnchor.ts` | **新增**。框选 → `Anchor`（线2 版的 `capture()`）+ `describePdfAnchor`（线2 不画框，位置只能用文字交代） |
| `src/anchor/bridge.ts` | **新增**。§5.2 两个联合类型的 TS 落地 + 边界守卫 |
| `pdf-viewer-provider.ts` | 注入脚本（**追加**，不是替换）；多接一类消息；宿主自己记一份"面板 → uri" |
| `extension.ts` + `package.json` | 新增 `anchorPdf.selectRegion`（含 `ctrl+alt+s`）与 `anchorPdf.revealPage`（S6 的入口，同时也进命令面板） |
| **新增** `test/anchor.test.ts` | 11 条：几何（跨页判定 / 裁剪 / 退化 / 平局）、§5.2 消息守卫（15 种坏输入）、Anchor 组装 |
| `scripts/smoke-pdf-extension.mjs` | 35 → **66 项**。真的开了一个面板、灌了一条 `anchor:captured` 进去 |
| `packages/core/src/paths.ts` | **新增**（未在范围内，见偏离 2）。路径工具从线1 搬上来，两条线共用 |

**两处偏离，均已声明**：

1. **`anchor:captured` 追加了可选字段 `geometry`。** §5.2 的冻结字段一个没动（旧式脚本仍可用），
   加它是为了让"归一化由谁定案"不依赖注入脚本的正确性。见 D54 第 3 条。
2. **`packages/core/src/paths.ts` 是新增文件**（原范围只管线2）。
   线2 要用 `samePath` / `basenameOf`，与其复制一份不如搬进 core；线1 的 `paths.ts` 保留为转发。

**自动化验收结果**：`pnpm check` 全绿 —— **152 测**（core 28 + ext 113 + pdf 11）
+ `pnpm smoke` 30 项 + `pnpm smoke:chain` 105 项 + `pnpm smoke:pdf` **66 项**。
其中三条是 S5 的硬判据：「脚本给一个**错的** bbox，宿主交出去的仍是 geometry 重算的结果」、
「未握手不推 / 握手后补推」、「产物里**根本没有** decoration API（不画框不是靠自觉）」。

**验收靠**：**用户实操**，手感只能本人确认：
`pnpm devhost:pdf`（当时写的是手敲 `code --extensionDevelopmentPath=...` 相对路径 —— 现在一律用脚本，见 D59）
→ 打开 `sample-30p.pdf` → `Ctrl+Alt+S`（或命令面板 `Anchor: 框选一块并讲解（PDF）`）→ 拖一个矩形。要看四件事：
1. 拖的时候跟手；**抬手之后屏幕上不留任何东西**（没有残留的框）
2. 拖到页缝/页外 → 提示"没有落在任何一页上"，不留垃圾状态
3. **跨页拖**（从第 1 页底部拖到第 2 页）→ 交给线1 的锚点应是"盖得多的那一页"
4. 装不装线1 都试：没装线1 时应明确提示"没有安装线1"，而不是静默失败
（`sample-30p.pdf` 是 30 页，够跨页试。）

## S6 PDF 框选 → Anchor → 侧边栏讲解（含点击滚动定位）

- **目标**：框选 → Anchor → `executeCommand` 交给 ext-A → 侧边栏出讲解；侧边栏每条 step 显示位置标签（「第 N 页」），**点击该条滚动 PDF 到对应页**（滚动，不是高亮框）。空格/next 只推进侧边栏文字，**不动 PDF**。
- **范围**：`bridge.ts` 的 `executeCommand('anchorExplain.explainAnchor', anchor)` 通路；ext-A 的 `explainAnchor` 命令；`SidebarPanel` 加位置标签与点击；ext-B 的 `anchorPdf.revealPage` 命令 + 注入脚本 `gotoPage`（`PDFViewerApplication.page = N`）
- **验收标准**：自动化 + **用户实操**。**PDF 上不出现任何高亮框。** 未装 ext-B 时明确提示而非静默失败。
- **回退点**：`slice-S5`

### S6 落地结果（2026-09-13，tag `slice-S6`）

线2 → 线1 那半在 S5 已经接通（`anchor:captured` → `anchorExplain.explainAnchor`），
S6 补的是另一半：**线1 拿到 PDF 锚点之后**。

| 声明范围内 | 落地 |
|---|---|
| 侧边栏显示「第 N 页」 | **本来就支持**（`clientScript.ts` 的 `locText` 认 `loc.page`）。S6 只补了提示词：PDF 那条写"把 PDF 滚到这一页"，代码那条写"在编辑器里定位到这一段"（对 PDF 说"在编辑器里定位"是句假话，用户会以为是它坏了） |
| 点击该条滚动 PDF | `commands.ts` 新增 `revealStep()`：按位置类型分岔 —— 代码走播放器（高亮+滚），PDF 走 `anchorPdf.revealPage`（**只滚不画**）。对端缺失时明确提示 |
| 空格/next 只推进文字、不动 PDF | 天然成立：`decorationPlan` 过滤非 `CodeLocation`（约束 20），播放器对 PDF 步骤什么都不做 |
| `anchorPdf.revealPage` | S5 已注册；S6 改成**落到当前聚焦的面板**（不是所有打开的 PDF —— 开两份对比时会一起滚） |
| 线1 的 `test` | 113 → **115 条**（`decorationPlan.test.ts` 加 2 条：PDF 步骤**一拍都不画**、混着 PDF 步骤时只有代码步骤被画） |
| `scripts/smoke-walkthrough.mjs` | 105 → **115 项**：新增第 11 节，把线2 交出来的锚点灌进线1 |

**自动化验收结果**：`pnpm check` 全绿 —— **154 测**（core 28 + ext 115 + pdf 11）
+ `pnpm smoke` 30 项 + `pnpm smoke:chain` **115 项** + `pnpm smoke:pdf` 66 项。
第 11 节的硬断言：「**PDF 会话一拍都不画框**（逐个 decoration type 数框数）」
「点 PDF 那一步走的是 `anchorPdf.revealPage` 且带对页码」
「代码锚点**不**去调线2」「没装线2 时明确提示而不是 executeCommand」。

**一处刻意留的缺口，已声明**：线1 拿不到 `pageCount`（§5.1 单向、`PDFLocation` 里也没有路径），
所以 §3.3 的 `1 ≤ page ≤ pageCount` 那条上界被跳过。补它要改契约，见 D55 第 4 条。

**验收靠**：**用户实操** —— 框选一块 → 侧边栏出讲解 → 点某一步上的「第 N 页」→
PDF 应**滚到那一页**（不是画框，编辑器里也不该出现任何框）；
没装线1 或没装线2 两种缺件情况各试一次，都应看到明确提示。

### S7 落地结果（2026-09-13，tag `slice-S7`）

**开工时先撞上一个前提**：`PDFLocation` 里没有 `filePath`，所以线1 拿到的锚点
只说得出"第 23 页的哪一块"，说不出"哪一份 PDF" —— 取件要按路径读文件，做不了。
先补上这个**可选字段**（`CONTRACTS` §1 的加法扩展），再谈取文字。

| 声明范围内 | 落地 |
|---|---|
| `src/adapters/PDFAdapter.ts` | **新增**。`capabilities = ['page_range']`、`fetchContext` 按页取件（带 `--- 第 N 页 ---` 页头）、两个追加方法 `pageCount` / `textInBBox` |
| `src/adapters/pdf/PDFSource.ts` | **新增**。"一页能给我什么"的抽象 —— 有了它，取件逻辑可以用手搓的假源穷举边界，不必背着 30 页 fixture |
| `src/adapters/pdf/pageTextIndex.ts` | **新增**。PDF 用户空间 → 归一化（**y 要翻过来**）、按阅读顺序排序、行间补换行（英文补空格、中文不补） |
| `src/adapters/pdf/textSearch.ts` | **新增**。`bbox → 文本`，命中判据是"交叠占文字块自身的比例" |
| `src/adapters/pdf/pdfDocumentCache.ts` | **新增**。有界 LRU + 并发去重；**淘汰时释放句柄** |
| `src/adapters/pdf/pdfjsSource.ts` | **新增**。`pdfjs-dist/legacy` 无头真实现 |
| `scripts/smoke-extension.mjs` | 30 → **33 项**：加了"打包进来的 pdfjs-dist 署名还在产物里"等 3 条 |
| `packages/extension-anchor/test/pdfAdapter.test.ts` | **新增 19 条**（逻辑层 17 + 真解析 1 + 页头格式 1） |
| **未在范围内但必须做的** | ① `core` 加 `PDFLocation.filePath`（见上）；② `core` 加 `rect.ts`（`intersectRects`/`rectArea` 现在有三个消费者，线2 那份改成复用）；③ `core` 加 `paths.ts`（S5 已做）；④ 新增 `THIRD_PARTY_NOTICES.md`；⑤ `commands.ts` 的 `adapterFor(anchor)`、`makeOutline` 补 PDF 页数、`withPdfText` 填 `extractedText` |

**自动化验收结果**：`pnpm check` 全绿 —— **173 测**（core 28 + ext 133 + pdf 12）
+ `pnpm smoke` 33 项 + `pnpm smoke:chain` 115 项 + `pnpm smoke:pdf` 66 项
+ 上游的 pdf.js 不变式守卫。
S7 点名的两条验收都在：`fetchContext({type:'page_range', start:22, end:24})` 返回带
`--- 第 N 页 ---` 页头的文本；`bbox → 文本` 在真 fixture 的第 23 页命中且跨行补了换行。

**`detect()` 的处置（从"延期"改成"明确不做"）**：用户同时开着编辑器和 PDF 是常态，
"当前环境适不适用"没有唯一答案；选适配器的依据是锚点自己的 `sourceType`。
见 D56 与 `CONTRACTS` §3.1。

**验收靠**：**自动化**（这是唯一一片不需要用户动手的）。但用户仍可以看一眼：
拿框选出来的那一块，讲解里第一步的内容应该就是那一块的字（`extractedText` 生效），
而不是模型"凭空猜"出来的。

## S7 PDF 取件

- **目标**：`page_range` 取附近页文字（`pdfjs-dist` legacy 无头，**不依赖 webview**）。
- **范围**：`src/adapters/PDFAdapter.ts`、`src/adapters/pdf/{PDFSource.ts, pdfDocumentCache.ts, pageTextIndex.ts, textSearch.ts}`
- **验收标准**：自动化 —— 30 页 fixture 上 `bbox → 文本` 命中第 23 页且跨行补换行；`fetchContext({type:'page_range', start:22, end:24})` 返回带 `--- 第 N 页 ---` 页头的文本。
- **回退点**：`slice-S6`
- **状态**：完成（`slice-S7`）。

### S8 落地结果（2026-09-13，tag `slice-S8`）

**这一片的来由与上一轮不同**：不是计划里的，是用户看了欢迎页之后点名要的
（"做一个固定按钮，点一下呼出一个界面，先做一个开始界面，把逻辑放在里面，快捷键还是要的"）。
用户同时给了一句评判标准："做切片就是为了这个，把逻辑组织起来，而不是糊在一起"。**那就照着这句做。**

| 声明范围内 | 落地 |
|---|---|
| `package.json` | 新增 `viewsContainers.activitybar`（容器 `anchor`）+ `views`（`anchorExplain.start`，`type: webview`）+ 命令 `anchorExplain.showStart` + 键位 `ctrl+alt+a` + **`contributes.walkthroughs`（四步）** |
| `assets/anchor.svg` | **新增**。固定按钮的图标（24×24 单色）。**路径写错 VS Code 只是不显示**，所以冒烟去查文件 |
| `media/walkthrough/*.md` | **新增四份**。演练四步的正文（`command:` 链接直接调命令） |
| `src/start/startModel.ts` | **新增**。面板的内容模型：动作表 + 状态→面板的纯映射。**面板里没有一条业务判断** |
| `src/start/StartViewProvider.ts` | **新增**。视图的宿主侧（握手 / 推快照 / 收 id / 转命令）。**视图没开过 = 空操作** |
| `src/start/ui/start{Styles,ClientScript,Html}.ts` | **新增**。内联的样式与客户端脚本（只渲染与派发，与侧边栏同一套做法） |
| `src/protocol.ts` | §5.5 三个消息 + `parseStartMessage`；**`STATE_WORD` 从 `statusBar.ts` 上移到这里** |
| `src/describe.ts` | **新增**。`captureSummary` —— "上次捕获"那句人话的唯一格式化处 |
| `src/sidebar/keybindingResolve.ts` | 加 `showStart`；**线2 的键位单独一张 `LINE2_CHORDS`**（面板要显示线2 的框选键） |
| `src/commands.ts` | 装配面板 + `showStart` + `runStartAction`（**id → 命令的唯一解析处**）+ 五处刷新时机；`peer()` 收敛三处调用 |
| **未在范围内但顺手做掉的** | ① `Anchor: 显示状态` 的"上次捕获"改用 `describe.ts`（并修掉 PDF 锚点被 `isCodeLocation` 挡掉那处不对称）；② `smoke-walkthrough.mjs` 的桩补三个方法（面板注册不炸即可，驱动放在产物冒烟里） |

**"不糊在一起"是怎么被验的**（这是这一片真正的交付物）：

1. **面板里没有可糊的地方** —— 内容全在纯函数 `buildStartModel` 里算（13 条单测），
   客户端脚本只把模型画成 DOM 并回传 `start:run`
2. **按钮不实现任何东西** —— 每个动作只指向一条命令，且有一条耦合锁断言那条命令
   **在它所属扩展的** `contributes.commands` 里声明过
3. **webview 说不清"要执行什么"** —— 它只回传 id，宿主查表决定能不能执行；
   守卫只查形状（有一条锁专门钉"成员资格不在守卫里"）
4. **同一句话只有一处** —— 状态词（`STATE_WORD`）与"上次捕获"（`captureSummary`）都是这样
5. **宿主侧真跑过一遍** —— `pnpm smoke` 里造一个假视图驱动 `resolveWebviewView`，
   走完 `start:ready → 模型 → start:run`，含"表里没有的 id 不执行""没装线2 时明确提示"

**自动化验收结果**：`pnpm check` 全绿 —— **201 测**（core 28 + ext 161 + pdf 12）
+ `pnpm smoke` **58 项** + `pnpm smoke:chain` 115 项 + `pnpm smoke:pdf` 67 项
+ 上游的 pdf.js 不变式守卫。

**验收靠**：自动化 + **用户实操**（面板长什么样、按钮点下去什么反应，只有人能判）。
另外**演练卡片那一步需要用户特别看一眼**：`command:` 链接是文档约定而不是类型保证，
若点了没反应，请如实反馈 —— 另外两个入口不受影响。

## S8 固定按钮与开始界面

- **目标**：给整个产品一个**固定的门厅** —— 活动栏一个图标，点开是「开始」面板
  （能开始什么、缺什么、现在到哪一步），欢迎页再放一张「演练」卡片。
  **键位一个都不动**：面板是第三条入口，不是替代品。
- **范围**：`package.json`（视图容器 / 视图 / 命令 / 键位 / 演练）、`assets/anchor.svg`、
  `media/walkthrough/*.md`、`src/start/*`、`src/protocol.ts`（§5.5）、`src/describe.ts`、
  `src/sidebar/keybindingResolve.ts`（线2 键位）、`src/commands.ts`（装配与刷新）
- **验收标准**：自动化（201 测 + 三个冒烟）+ 用户实操 ——
  点活动栏图标能出面板；面板上「讲解选中的代码」显示的是**你自己绑的键**；
  点「显示状态」有反应；`Ctrl+Alt+A` 能把它呼出来；没配模型/没装线2 时对应按钮是灰的**且说清缺什么**；
  欢迎页的「演练」里有「开始使用 Anchor」这张卡。
- **回退点**：`slice-S7`（这一片是纯加法：删掉 `viewsContainers`/`views`/`walkthroughs` 三段声明
  与 `showStart` 那条命令/键位，产物即回到 S7 的行为）
- **状态**：完成（`slice-S8`）。
