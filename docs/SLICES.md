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
| S9a | 跨文件取件：契约松开 + 边界护栏（`fetchScope` 三档）+ 候选文件清单 + 取件日志带文件与行范围 | 自动化 + 用户实操 | 完成 `slice-S9a`；**实测返工修复完成（`slice-S9a-fix`，D67）**，待用户重跑验收 |
| S9b | **可选的**追问入口：`Ctrl+Alt+L` 才问"要讲哪条线"（默认不弹） | 自动化 + 用户实操 | **计划中（待实施）** |
| S9c | 多文件渲染 + 讲到自动切换（**单组多标签**，不分屏） | **用户实操（手感）** | **计划中（待实施）** |

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

### S5/S6 补（D73，2026-09-14）：**用户实测"框选PDF没有任何反应"** —— 链路第一颗螺丝是断的

**用户原话**：「框选PDF，并没有反应。」没有报错、没有截图。查下来根因**不在几何、不在守卫、
不在宿主**，而在页面加载：

- `acquireVsCodeApi()` 在**一个 webview 里只能成功调用一次**（VS Code 1.137.0 的 webview 预加载
  `pre/index.html:209` 就是 `let acquired = false` + 第二次 throw；只有 notebook renderer 与
  chat 输出开了 `allowMultipleAPIAcquire`）。
- 而这份 PDF 页面里 **pdf.js 自己先调了一次**：`assets/main.mjs:18` 一开头就 `import` 了
  `viewer.mjs`，而 `viewer.mjs:24094` 在初始化时把实例交给 `VSCodeLinkService`
  （PDF 里的链接要交回宿主）。它天然跑在我们前面。
- 我们那次调用因此**抛了**，而第一版包了个 `try/catch { vscode = null }` 就完事 ——
  `postMessage` 全变静默空操作：`anchor:ready` 发不出去 → 宿主永远不补发 `enterSelectMode`
  → **连十字光标都不出现**，屏幕上也没有任何字。

**修法（四处）**：① 注入脚本先接管 `globalThis.acquireVsCodeApi`、把实例**共享**出去
（自己取一次，之后 pdf.js 来取给同一个；装壳没验过**就不取**，宁可我哑也不把页面链接搞坏）；
② 注入位置提到 `pdf.mjs`/`main.mjs` **之前**（module 不带 `async` 时按文档顺序执行，
这是结构性保证，不是时序运气）；③ **失败必须发声**：脚本拿不到 API 就在页面上贴一句故障说明，
宿主 `selectRegion` 不管有没有握手都先推一次、没握手时给一句人话；
④ 脚本那份兜底副本的交叠判据补 `Number.isFinite`（NaN 不许赢下比较 —— 否则会发出一个
`[0,0,0,0]` 的框，被宿主守卫静默丢掉，又是一次"拖了、没反应"）。

**这一片的头等收获**：线2 的注入脚本**头一次有了行为夹具**
（`test/anchorSelectClient.test.ts`：最小 DOM + 逐字复刻 VS Code 预加载语义的 `acquireVsCodeApi`），
把"推 `enterSelectMode` → 拖框 → 消息过宿主守卫 → 算得出第几页哪一块"整条跑一遍。
写它的时候当场抓出两个真问题（DOMRect 的 `left/top`、上面第 ④ 条）。

**验收标准（待用户实操）**：`Ctrl+Alt+S` 之后**十字光标要出来**；拖一个矩形 →
侧边栏出讲解、编辑器里一个框都不该出现（约束 1）；**抬手之后 PDF 上不留任何东西**；
**若没有十字光标**：第一次按会说"页面还在加载"，再按一次会说"一直没有回应"+ 怎么查
（这时候把 Console 的报错发我，别只是"没反应"）。

**自动化验收结果**：`pnpm check` 全绿 —— **289 测**（core 40 + ext 228 + pdf **21**，
其中 pdf 从 12 → 21）/ `pnpm smoke` 73 + `pnpm smoke:chain` 146 + `pnpm smoke:pdf` **74**。
冒烟里那条"框选脚本排在上游脚本之后"的断言**改了意图并写明理由**（它原本的理由
"要靠 pdf.js 的 DOM 才能算位置"是错的：那件事发生在拖拽时，与加载顺序无关）。

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

### S7 补（D74，2026-09-14）：**PDF 取件在用户手上从来没成功过** —— pdf.js 的 worker 在产物里找不到

**用户实测报出来的形状**（D73 修完框选之后）：面板说「无法定位内容：第 2 页取件被拒」，
取件日志两行都是「无法确定这份文档的总页数，拒绝按页取件」。**不是 PDF 的问题，是打包的问题。**

- 复现方式：把 `openPdfJsSource` 用**与真实构建同一套 esbuild 选项**打成一个 cjs 再跑 ——
  报 `Setting up fake worker failed: Cannot find module '…\dist\pdf.worker.mjs'`；
  同一份代码**源码直跑**成功（fixture 30 页 / 用户那份 arXiv 26 页）。
- 机制：`disableWorker: true` 只是不用线程，pdf.js 仍要把 worker 代码加载进主线程，靠
  `import(GlobalWorkerOptions.workerSrc)`；那个默认值由 pdf.js 自己的 `import.meta.url` 推出，
  而 **esbuild 把它改写成了产物路径**。
- 为什么全绿还漏了一整片：① `pageCount` 的 catch 吞成 null（零日志）；② 闸门那句把线索全指向 PDF；
  ③ `node --test` 跑**源码**；④ 冒烟从没真的**打开过一份 PDF**。

**修法**：① 挂官方钩子 `globalThis.pdfjsWorker`（`legacy/build/pdf.mjs:22948` 认它），
worker 用字面量动态 import 让 esbuild 一起打包（产物自洽、不依赖 node_modules）；
② 不再静默：`PDFAdapter` 加注入的 `onError` → 输出通道；`withPdfText` 的 catch 记一行；
闸门那条拒绝改成两句（第二句指去看哪）；③ **补锁**：冒烟里用同一套打包选项把
`scripts/pdf-open-probe.mjs` 打成 cjs 再跑，断言真能打开 fixture（**并验证过这条锁能红**）；
④ 连带：产物那条"没有文档写入 API"的锁改成按**调用形状**扫（worker 进来后，pdf.js 里的
XFA 枚举名 `TextEdit` 让裸名字扫描误报）。

**代价**：dev 产物 4.5MB → 13.4MB（worker 2.4MB + inline sourcemap；惰性求值，本地扩展可接受）。

**验收靠**：**用户实操** —— 重新 `pnpm build` + 重载窗口，框选同一处再讲一次：
**取件日志里那两行应该从"拒绝"变成"接受"**，讲解第一步应该引到那一页的原文。

**自动化验收结果**：`pnpm check` 全绿 —— **289 测**（core 40 + ext 228 + pdf 21）/
冒烟 **74** + 146 + 74。**注意口径**：这一片之前的所有"自动化验收结果"都是绿着报的，
而用户那边一次都没成功过 —— 差别只在"测试跑源码、用户跑产物"（D74 末段）。

### S7 补 2（D75，2026-09-14）：**还是被拒** —— pdf.js 把扩展宿主误判成了浏览器

D74 修完用户重测，取件**仍被拒**，但这次屏幕上有线索（D74 那条"不再静默"当场回收了成本）：
`Anchor` 输出通道写着 `打不开这份 PDF（window is not defined）`。

- **不是 Electron 的 Node 不行**：`ELECTRON_RUN_AS_NODE=1 Code.exe` 跑同一探针是成功的。
- **是 pdf.js 的 `isNodeJS` 判定**：最后半句 `!(process.versions.electron && process.type && process.type !== "browser")`
  是为 Electron **渲染进程**写的，而 VS Code 的扩展宿主是 Electron 的 **utility** 进程 ——
  于是 pdf.js 认为"我不是 Node"。给它补上这个形状后，探针**一字不差复现**。
- **栈顶是 `getUrlProp`**：`url:` 这个参数**只有浏览器环境支持**（要拿 `window.location`）。
- 修法：① **喂字节而不是给 `url:`**（字节由注入的 `PdfBytesPort` 读，真实现是 `workspace.fs` ——
  顺带对 remote/虚拟工作区成立，`node:fs` 在那种工作区里会静默读到空）；② 入口把字节归一化成
  **真正的 `Uint8Array`**（pdf.js 明确拒绝 Node 的 `Buffer`，而 `node:fs` 给的就是 Buffer ——
  这条是**改完①之后测试当场红出来的**）。
- **探针也升级**：`scripts/pdf-open-probe.mjs` 现在先把自己伪装成宿主（`process.type='utility'`
  + `process.versions.electron`），再动态 import pdf.js。上一版的锁"在我这儿是绿的"，
  就是因为它跑在干净的 CLI Node 里。**并验证过升级后的锁能红**（把 `data` 改回 `url:`，
  它报的正是 `window is not defined`）。

**验收靠**：**用户实操**，同 S7 补 —— 重载后取件日志那两行应当变成"接受"。

**自动化验收结果**：`pnpm check` 全绿 —— **289 测** / 冒烟 74 + 146 + 74。
手工另验：真 fixture（30 页）与用户那份 arXiv（26 页、第 1 页 4009 字）在**宿主形状**下都能打开。

### S6 补 2（D76，2026-09-14）：**"根本不知道讲的哪里"** —— 约束 1 收窄，允许"点一下闪一帧"

用户原话：「能讲了，但是图里没有对应位置的指示的跳转，根本不知道讲的哪里。」
D13 定的是"不做高亮框，滚动不是高亮框，符合约束"——实测证明**只滚到页不够**：
模型的几步常落在同一页，点下去画面上什么都不动，页内那一块仍然不知道在哪。

**这是改一条冻结的约束，所以先问再动**：给了三条路（在 PDF 上闪一下 / 完全不碰 PDF 改成面板里看
那一块的截图 / 只把位置说成人话），用户选**第一条**。约束 1 因此收窄为
「不许常驻/自动的框，只允许用户点击触发、会自动消失的位置提示」。

| 落地 | 说明 |
|---|---|
| `anchor:flashRegion {page, bbox}`（§5.2 加法扩展） | 滚到那一页 + 在那块区域闪现一个框 |
| `anchorPdf.flashRegion(page, bbox)`（§5.1 新命令） | **没有**往 `revealPage` 加参数：那条是"只滚不画"（D13），混进去两条契约都定不下来 |
| `revealStep` 只对 PDF 步发这条消息 | 自动播放/推进一个框都不发（链式冒烟有断言） |
| 闪现框 2 秒后自动摘掉、位置每帧重算 | 滚动是平滑的、用户也可能在闪的期间自己滚；页没渲染出来就干脆不画（假框比没框更坏，D69） |
| 逆换算的信任来源 | 用**有单测的正向函数**做**往返校验**（注入脚本 4 条新锁之一） |
| 状态栏回执「已定位到第 N 页…」 | 修掉"目标就在当前页时看着像没反应"——动作没有可见结果时必须说一句 |
| 旧版线2 的退路 | 先查对端声明的能力清单：没有 `flashRegion` 就退回 `revealPage`，不抛"命令未找到" |

**验收标准（待用户实操）**：侧边栏点某一步上的「第 N 页」→ PDF **滚到那一页、并在那一块上闪一下**
（约 2 秒后消失）；**按「下一步」/播放时 PDF 上一个框都不出现**；状态栏有「已定位到第 N 页…」。

**自动化验收结果**：`pnpm check` 全绿 —— **294 测**（core 40 + ext 228 + pdf 26）/
冒烟 74 + **151** + **80**。

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

### S8 的补丁（用户当场发现的流程缺陷，2026-09-13）

用户看面板时指出：「设置 API Key」是灰的、理由是"还没有配 `anchorExplain.providers`"，
**而面板上没有任何一条路能去配它** —— 说清了缺什么，却一步也走不动。

- 新增命令 `anchorExplain.openSettings`（打开设置并筛到 `anchorExplain`），
  面板上加「打开设置（配模型端点）」，排在「设置 API Key」上面
- 灰按钮的理由改成"指出下一步按哪颗"，并加锁断言这句话里必须出现「打开设置」
- 顺带：用户可见的通知不再带错误码（`userFacing()`；码仍是判断成败与日志的依据）
- 演练卡片第一步的正文也加了同一个链接

详见 D61 与 `CONTRACTS` §5.5。数字：202 测 / `pnpm smoke` 61 项。

### S8 的第二处补丁（同一个台阶卡了第二次，2026-09-13）

用户接着手写 `settings.json` 配端点，把整段 JSON 填进了 `activeProvider`（那是个**字符串**设置），
`settings.json` 语法坏了（"预期为文件结尾"）。

**同一件事讲清楚两次还是做不对，说明它不该靠讲** —— `providers` 是嵌套对象，
在设置界面里只能手写。于是新增命令 `anchorExplain.configure`：
三个输入框（provider id、baseUrl、模型名）+ 校验 + 预填，直接写进用户设置。
面板上「配置模型端点」放在「设置 API Key」前面，「打开设置」退到这一组最后。

详见 D62、`CONTRACTS` §5.5 / §6。数字：208 测 / `pnpm smoke` 63 项。

### S8 的第三处补丁（"填完不记忆"，2026-09-13）

用户填完三个输入框**什么都没发生**（原话"这样填完不记忆，没用"）。两个原因：
① `update()` 在 `settings.json` 有语法错时会抛，而 `configure` **没接住**，写完也**没验读**；
② 他的 `providers` **少了一层**（`{ baseUrl, tier1Model }`），而当时的 `configuredProviderIds()`
把 `tier1Model` 当成 provider id 显示出来 —— 提示本身就在骗人。

修法：`writeSettings()` 接住异常 + 给「打开 settings.json」按钮；写完**回读**；
`looksFlattened()` + 一步"整理好它"；provider id 只认值是对象的键；面板点命令失败也说话。

详见 D63。数字：210 测 / `pnpm smoke` 73 项。

### S8 的第四处补丁（"点两次才出讲解界面" + "AI 背后操作看不见"，2026-09-13）

用户实测反馈两条，其实是同一个病：侧边栏只在讲解**做完**才弹，而这之前几秒到几十秒里
屏幕上唯一的变化是状态栏 —— 而他的状态栏是关着的（`workbench.statusBar.visible: false`）。
于是"第一次点没反应"为真，"第二次才行"只是第一次的请求那时刚好回来了。

修法：进度挂三处（状态栏 / **通知，可取消** / 开始面板那一行），取件记录同时变成进度。
**没有加任何"照症状猜"的补丁** —— 如果加完进度仍要点两次，那是另一种原因，
需要的证据是"两次点击之间屏幕上出现了什么"。

详见 D64。数字：211 测 / `pnpm smoke` 73 项 / `pnpm smoke:chain` 118 项。

### S8 的第五处补丁（讲解风格，2026-09-13）

用户："不要那么多名词什么的，要不还不如读代码本身了。就简单的描述这一块的逻辑就好了
（但是设为可选风格：简约、严谨），还有太从上到下了，我希望能表达出数据流转的感觉。"

第一版 prompt 只写了"步骤要有推进关系（先判断再取值）"——**那正是从上到下**，而且一条风格约束都没有。
改法：① 新增设置 `anchorExplain.style`（默认**简约**）；② 两档**都**改成"按数据怎么流组织步骤"
（数据从哪来 → 在这里怎么改 → 出去给谁用），并明写反例"不要从上到下一行行讲"；
③ 两档共享"不写开场白、不复述代码"；差别只在术语与粒度（简约禁用代码外的名词、一句话 ≤40 字）。

详见 D65。数字：222 测 / `pnpm smoke` 73 项 / `pnpm smoke:chain` 118 项。

## S8 固定按钮与开始界面

- **目标**：给整个产品一个**固定的门厅** —— 活动栏一个图标，点开是「开始」面板
  （能开始什么、缺什么、现在到哪一步），欢迎页再放一张「演练」卡片。
  **键位一个都不动**：面板是第三条入口，不是替代品。
- **范围**：`package.json`（视图容器 / 视图 / 命令 / 键位 / 演练）、`assets/anchor.svg`、
  `media/walkthrough/*.md`、`src/start/*`、`src/protocol.ts`（§5.5）、`src/describe.ts`、
  `src/sidebar/keybindingResolve.ts`（线2 键位）、`src/commands.ts`（装配与刷新）
- **验收标准**：自动化（当时 201 测 + 三个冒烟；两处补丁后是 **208 测 + 63 冒烟**）+ 用户实操 ——
  点活动栏图标能出面板；面板上「讲解选中的代码」显示的是**你自己绑的键**；
  点「显示状态」有反应；`Ctrl+Alt+A` 能把它呼出来；没配模型/没装线2 时对应按钮是灰的**且说清缺什么**；
  欢迎页的「演练」里有「开始使用 Anchor」这张卡。
- **回退点**：`slice-S7`（这一片是纯加法：删掉 `viewsContainers`/`views`/`walkthroughs` 三段声明
  与 `showStart` 那条命令/键位，产物即回到 S7 的行为）
- **状态**：完成（`slice-S8`）。

## S9 跨文件讲解（按"逻辑线"取件 + 多文件自动切换）

> **状态**：**计划已确认（2026-09-13）**，分 S9a / S9b / S9c 三段，各自独立验收、独立回退、独立 tag。
> 起因：用户实测后的一句话 —— "没有跨文件的理解啊，像是嵌入式等等，很多分散的代码"，
> 以及随后的四条要求：**边界按逻辑相关（不按目录）**、**先问"要讲哪条线"**、
> **读到的要讲的自动打开**、**同时只显示一个文件界面、讲到哪一步自动切过去**。

### 背景（调查结论，改之前先看这个）

四层各自假定"只有一个文件"，缺的不是"放开一行判断"：

| 层 | 现状 | 位置 |
|---|---|---|
| 播放/渲染 | 用 `specs[0]` 的文件与行数渲染**全部** spec | `playback/CodeWalkthroughPlayer.ts:104-117` |
| 会话 | 没有"当前文件"概念；`stale` 是单布尔 | `playback/WalkthroughSession.ts:34-52` |
| 侧边栏标签 | 只显示"第 40-48 行"，跨文件全都一样 | `sidebar/ui/clientScript.ts:50-59` |
| 取件闸门 | `params.path` 必须等于锚点文件 | `orchestrator/validateContextRequest.ts:116-120` |
| 输出闸门 | `filePath` 必须等于锚点文件；行上界只按锚点文件算 | `orchestrator/validateExplanation.ts:167-173`、`:183-187` |
| 工具 schema | 没有 `path` 参数；输出契约写着"必须与锚点同一个文件" | `orchestrator/toolSchema.ts:14`、`:41/:47` |

### S9a 跨文件取件（契约 + 边界 + 候选清单）

- **目标**：让模型能读到**逻辑相关**的其他文件（宏在 `config.h`、结构体在 `ring_buffer.h`、调用者在别的 `.c`）。
  **相关性由模型判断（我们教它判据），我们只管边界。**
- **范围**：
  - `packages/core/src/paths.ts`：新增纯函数（路径解析 / 是否在某目录下）——现在**完全不存在**这两个工具
  - `orchestrator/validateContextRequest.ts`：规则 3 改按 policy；行上界按"被读的那个文件"
  - `orchestrator/validateExplanation.ts`：`filePath` ∈ **允许集合**（锚点 ∪ 真取过件的文件）
  - `orchestrator/toolSchema.ts`：schema 加可选 `path`；输出契约改口径
  - `adapters/CodeAdapter.ts`：单次行数上限（`capabilities.maxSpan` 现在对 `file` 根本没被用）+ 大小/二进制护栏 + 读不到时给人话
  - `prompts/index.ts`：教它什么时候值得读别的文件 + **候选文件清单**（宿主侧生成）
  - `package.json` + `config.ts`：新配置项 `anchorExplain.fetchScope`
- **边界护栏（三档，默认 `related`）**：

  | 值 | 允许取的文件 |
  |---|---|
  | **`related`（默认）** | 工作区内的文本文件；**排除** `.git/`、`node_modules/`、构建产物目录、`.env*`、`*.pem/*.key/*.p12/id_rsa*`，以及适配器判定的"太大/含 NUL 的二进制" |
  | `same-dir` | 只允许锚点文件所在目录 |
  | `off` | 只允许锚点文件（= S1~S8 的行为，回退档） |

  路径解析（纯函数、可单测）：绝对路径直接判是否在工作区内；相对路径**先按锚点文件所在目录**解析，再按工作区根解析；`..` 逃出允许范围的直接拒。
  **闸门分两道**：名字/范围这类**形状**判断在 `validateContextRequest`（纯、可单测）；大小与二进制这类**内容**判断在适配器（那里才有字节）。
- **验收标准**：自动化（`pnpm check` 全绿 + 冒烟断言"合法跨文件放行"与"真越界拒绝"）
  **＋ 用户实操**（拿嵌入式样本 `main.c` + `ring_buffer.h` + 一个调用它的 `.c` 看它是否主动去读）
  **＋ 取件日志必须显式列出：读了哪些文件、每个文件的哪几行（start-end）、第几轮、被拒的请求（含原因）**（截图问题 3.4）
  **＋ 模型读了某个文件之后，**能把它写进讲解的 `location``**（两道闸门同一套坐标；这条是 S9a 交付时漏掉的验收项，
  漏了它导致 245 条测试全绿而功能不可用 —— 见 D67 与下面「S9a 修」）
- **回退点**：`slice-S8`
- **状态**：**完成（`slice-S9a`）**。落地与偏差见 D66；新增样本 `test/fixtures/ring_buffer.h`；
  数字：245 测 / 73 + 122 + 67 项冒烟。

### S9a 修（D67）：用户实测返工 —— 许可必须可执行

- **起因**：用户实测回报"第一轮我看到了一个报错，第二轮没有往外读的想法（3 改 5 之后）"。
  S9a 的验收标准是「能读到」，这条等于**没通过**。三个根因**全在实现侧**：
  ① §8 的工具 schema 里没有 `path`（许可只写在文档与提示里，模型看不见 ⇒ 没有"点名文件"这个动作）；
  ② 输出契约仍写死"`filePath` 必须与锚点同一个文件"，**连 repair 那一轮也说这句**（失败不可恢复）；
  ③ 内部闸门收绝对路径、命令层第二道闸门收模型原样写的相对路径（"读过又引用"必然被拦 ⇒ 那个报错）。
  **另有一处"文档说了、代码没做"**：候选文件清单只出现在 `buildUserPrompt` 的签名上，从没进过 prompt。
- **范围**：`toolSchema.ts`（声明 `path`、`required` 补 `start`/`end`、描述去掉"当前文档"）、
  `prompts/index.ts`（契约按 `crossFile` 换口径、repair 同口径、候选清单真的渲染、锚点给所在目录）、
  `validateExplanation.ts`（相对路径按锚点目录解析、返回解析后的路径）、
  `Orchestrator.ts`（日志记归一化请求；`MAX_ROUNDS_EXCEEDED` 报错说实话）、
  `vscode/relatedFiles.ts`（扫不出候选时**降级但不静默**）、`commands.ts`（onError → 输出通道）。
- **验收标准**：`pnpm check` 全绿 + 冒烟新增「讲解的某一步**落在读过的兄弟文件里**」（相对与绝对两种写法）
  + 单测新增 14 条盯着三处口径与坐标；**＋ 用户实操重跑 S9a 的那两步**（默认档、`Ctrl+Shift+A`）。
- **回退点**：`slice-S9a`
- **状态**：**完成（`slice-S9a-fix`）**。完整复现与决策见 `DECISIONS.md` D67（含"为什么 245 条测试全绿
  而功能不可用"的诚实交代：冒烟只断言了取件内容，**从没有一条断言让讲解真的落在那个文件里**）；
  数字：**259 测**（core 40 + ext 207 + pdf 12）/ 冒烟 73 + **128** + 67。

### S9a 修 2（D68）：屏幕上的东西在说反话

- **起因**：用户重跑 S9a 的截图。**跨文件这次成了**（讲解里写着 `RB_CAPACITY` 是 12 行定义的 16），
  但同一张截图里三处在说假话：① 面板底部「取件日志」写着"本次讲解没有请求额外上下文"，
  而那一轮读了 2 次（`tooltrace:append` 协议有、客户端渲染有、**宿主从来没发过**）；
  ② 那条日志不显示"哪个文件的哪几行"（截图问题 3.4 的验收原文）；
  ③ 用户看到的进度通知是**上一份**的（重复按下 → 第二次先出结果，第一次还在跑，白烧一份）。
  另加一句有歧义的文案：「1-60 这个区间已经取过了」（跨文件后不知是哪个文件）。
- **范围**：`protocol.ts`（追加 `tooltrace:reset`）、`sidebar/ui/clientScript.ts`（处理 reset；
  `describeEntry` 显示文件名 + 行范围/页码）、`commands.ts`（`traceThisRun` 暂存 + 面板建好后灌进去；
  `running` 护栏）、`validateContextRequest.ts`（`describeFetched` 指认得清）。
- **验收标准**：`pnpm check` 全绿 + 冒烟断言「取件记录真的推给了侧边栏、带着文件与行范围、
  新一轮先清空、重复按下不产生第二次」；**＋ 用户实操**：讲一次，看面板底部那块是不是真的列出了读过的文件。
- **回退点**：`slice-S9a-fix`
- **状态**：**完成（`slice-S9a-fix2`）**。数字：**262 测**（core 40 + ext 210 + pdf 12）/ 冒烟 73 + **137** + 67。
  教训已写进 STATE 约束 72~74：**一条消息的"发"和"收"要有一条端到端断言**（只测一端等于没测）。

### S9a 修 4（D69）：跨文件的落点必须画对、标清（S9c 的前两项因此提前落地）

- **起因**：用户在**自己的嵌入式工程**上实测（12 路双向 DShot 固件）。跨文件这次真的成了 ——
  它自己读了 `esc.h` 与 `protocol.h`，讲出了 `DSHOT_BOOT_MODE`、`unlock_done`、双缓冲换帧。
  但他的两个问题暴露了两处缺陷：**12 步全落在 main.c**（读了的两个文件只被"提及"，没被"讲"），
  以及子高亮显示成「[第 16 行]」这种**不属于该步区间**的行号。
- **两处都是真的错**：① **播放器把别的文件的行号画到了锚点文件上** —— 它拿 `specs[0]` 的文件当唯一目标，
  却把所有 spec 都画进去，于是 `protocol.h:16` 变成 `main.c` 第 16 行上的一个框（**看起来很确定的假框**）。
  根因是一句从 S1 起就成立的假设"一拍 = 一个文件"：S9a 松了契约，**消费它的人没跟着松**。
  ② 侧边栏的行号标签不带文件名，`[第 16 行]` 看起来就是锚点文件的第 16 行（用户就是这么被绕住的）。
- **范围**：`playback/decorationPlan.ts`（新增纯函数 `focusFileOf` / `specsInFile`）、
  `playback/CodeWalkthroughPlayer.ts`（一拍只画焦点文件；`preview: true` + `ViewColumn.One` + `preserveFocus`）、
  `protocol.ts` + `commands.ts`（`session:update` 带 `anchorPath`）、
  `sidebar/ui/clientScript.ts`（标签带文件名；取件日志的路径改成末两段）、
  `prompts/index.ts`（跨文件档补一条"讲的其实是别的文件就落在那个文件里，也不许为了显得跨文件而硬拆"）。
- **验收标准**：`pnpm check` 全绿 + 单测钉住"焦点文件 / 只留焦点文件的框 / 单文件行为一字不变"
  **＋ 用户实操**：再讲一次那段固件，看（a）侧边栏里别处的行号是否带上了文件名，
  （b）讲到别的文件时编辑器是否自动切过去（同组、预览标签、不分屏），（c）假框是否不再出现。
- **回退点**：`slice-S9a-fix3`
- **状态**：**完成（`slice-S9a-fix4`）**。数字：**266 测**（core 40 + ext 214 + pdf 12）/ 冒烟 73 + **138** + 67。
- **补 4b（D72 补记，`slice-S9a-fix8`）**：用户补了更准的一句 ——「按键、快捷键、按钮全不管用，
  进入最后一条就卡死」。证据显示宿主**完全正常**（6 轮取件 5 接受、零报错；最后那行
  `received terminate message from renderer` 是窗口重载收掉宿主，是用户的动作）。
  真凶是**"到最后一拍"时我们主动禁掉的东西**：`walkthroughActive` 落 false 之后
  `Alt+[`（回看）与 `Ctrl+Alt+W`（跳回）当场变哑 —— 加上面板按钮全禁（上一轮已修），
  就成了"全都不管用"。已把 `prev` / `goto` 改绑 `sessionOpen`（与面板的「上一步」一致），
  `next` / `playPause` 仍绑 `walkthroughActive`。**同时改了一条写着旧意图的锁**
  （原意"讲完推进类键必须失效"）并写明理由 —— 两条锁先红后绿，正是它们该做的事。

- **补 4（D72，`slice-S9a-fix8`）**：用户第二次报"卡死"。证据显示**宿主完全正常**（5 轮取件全接受、
  零报错）、三样新东西都在工作（标签只剩文件名、自动切文件、无假框）—— 真正的"卡死"是
  **面板末态是死路**：`ended` 把 `上一步/下一步/退出` 三个按钮全禁，而键盘 ESC / Alt+[ 仍然是好的。
  已修：上一步结束也能回看、退出永远能按、那句话改成说清"现在还能做什么"；
  顺带忽略键盘自动重复（按住 Alt+] 不放会每秒发几十条 `ui:next`）。
  数字：**280 测**（core 40 + ext 228 + pdf 12）/ 冒烟 73 + **146** + 67。

- **补 3（D71，`slice-S9a-fix7`）**：用户看了真机日志之后说"60 太少了，200 都不一定够" ——
  日志里 5 轮取件有 3 轮被"一次最多取 60 行"整条挡掉，预算白烧。**默认放到 400 行**（上限 2000）
  并新增 `anchorExplain.maxFetchLines`；**超上限改成截到上限照常给**（回灌内容头部写着真实行范围，
  放行的请求/日志/去重都按截断后的区间算），只有"关于这份文件的事实错误"（超出文档总行数、PDF maxSpan）
  仍是拒绝。顺带修掉一个静默失效：`readAnchorConfig` **没读 `style` 与 `fetchScope`** ——
  声明了但改了不生效（S8/S9a 一直如此），现在有一条镜像锁盯着"声明的每个设置都必须被读过"。
  数字：**278 测**（core 40 + ext 226 + pdf 12）/ 冒烟 73 + **146** + 67。

- **补 2（D70，`slice-S9a-fix6`）**：用户再跑一次 —— 跨文件、自动跳转、带文件名的标签都生效了，
  但报了两件事：**标签里印的是整条绝对路径**（反斜杠路径切不开，已复现并修：新增 `pathParts()`，
  内联脚本零反斜杠，标签末段 / 日志末两段）、以及**跳转之后右侧面板卡死**。
  卡死**没能复现**（VS Code 日志里没有任何异常，输出面板也停在"等待结束"之后就再无一行），
  所以改成"让它可诊断 + 消除可疑抖动"：面板脚本异常写进面板（红条）、播放器同一文件不重复打开 +
  渲染不并发堆积（堆积只留最后一拍）。顺带发现冒烟里那条 caveat 断言是在**上一拍的残留渲染**上
  通过的假绿，已按真实节拍重写并补一条"换点要清掉上一拍的框"。
  数字：**274 测**（core 40 + ext 222 + pdf 12）/ 冒烟 73 + **143** + 67。

- **补（D69 补记，`slice-S9a-fix5`）**：改完标签之后用户实测「不出字了」= 面板全白 —— 是我在 `normLoc` 里
  少写了一个反斜杠（模板字符串把 `\/` 吃成 `/`，运行时成了 `replace(//+$/, "")` = 语法错误）。
  已修，并补两道锁：**单元级**（新增 `test/sidebarClient.test.ts`：把内联脚本真的解析一遍 + 用最小 DOM
  跑渲染，断言标签带文件名、同文件两种斜杠写法不标、日志末两段路径 —— 这块客户端脚本第一次有行为断言）、
  **产物级**（链式冒烟从最终 HTML 里抠出内联脚本再解析一遍）。已验"改会先红"。
  数字：**271 测**（core 40 + ext 219 + pdf 12）/ 冒烟 73 + **140** + 67。
  S9c 的剩余项（折叠已完成步骤、面板上的「下一步」按钮、配色语义写进 README）仍等确认。

### S9a 修 5（D117）：取件范围算错了 —— 锚点不在工作区里的时候，**什么都读不到**

- **起因**：用户报"桌面的 anchor_explain 有一个 bug"，给的证据是输出通道那一行：
  `第 1 轮 拒绝（"../Inc/dshot_dma.h" 不在允许的范围内。…）`。
  而 `Inc/dshot_dma.h` **就在锚点文件的兄弟目录里**（源在 `Driver/dshot/Src/`、头在 `Driver/dshot/Inc/`），
  用户的原话是「**按理说是应该取的**」。
- **根因（不是解析写错，是"范围"的定义漏了一种前提）**：`related` 的范围原来只有**工作区根**，
  而**锚点不在工作区里是常态**（用「打开文件」打开的、或 F5 起的开发宿主窗口开在别的目录）。
  那时：① `../Inc/dshot_dma.h` 算出来的绝对路径不在任何根里 → 拒；② **锚点目录自己从来不是根**，
  所以连它旁边同目录的文件也一起被拒（`roots` 为空时是"全部拒"，一条不剩）。
  而提示词与拒绝文案都在教模型"相对路径按锚点文件所在目录算"—— 那条规则在这一刻**根本不生效**，
  用户照着它改写法只会一次次被拒。**顺带查出第二处同类缺陷**：候选清单里"不同目录"的名字写的是
  **工作区相对路径**，与闸门解析相对路径的基准（锚点目录）不一致 —— 模型照抄清单里的名字，
  解析出来是个不存在的路径，白烧一轮（用户早前实测的 `ENOENT: … transport_uart.c` 就是这个形状）。
- **范围**：
  - `core/src/paths.ts`：`resolveUnrestrictedPaths`（不过滤根的展开，与过滤版共用一个 `expandCandidates`）、
    `relativePathFrom`（允许 `..` 的相对写法）
  - `orchestrator/validateContextRequest.ts`：`FetchScope` 加第四档 `any`；**新增 `relatedRoots`** ——
    范围怎么算收在这一处（锚点在工作区里 → 工作区根，不多加；不在 → 锚点目录 + 上一层）；
    拒绝文案补"当前档位 + 实际生效的根 + 出路（改成 `any`）"
  - `relatedFiles.ts`：新增纯函数 `candidateDisplayName`（清单里的名字**基准一律是锚点目录**）；
    `vscode/relatedFiles.ts` 改用它
  - `config.ts`（`coerceFetchScope` 四档 + `describeFetchScope`）、`package.json`（enum/描述）、
    `commands.ts`（`fetchPolicyFor` 交给 `relatedRoots`）、`prompts/index.ts`（清单那一节的说口径）
- **验收标准**：`pnpm check` 全绿 + 单测钉住三件事：① 锚点不在工作区里时 `../Inc/...` 与同目录名字都放行、
  再往上一层是拒；② `any` 档放行工作区外的绝对路径、但密钥/依赖/构建产物照挡、去重与频率照跑；
  ③ 清单里的名字**解析回来必须就是那个绝对路径**（基准同源）。
  **＋ 用户实操**：在他那个工程上重跑，看第 1 轮是否已经能读 `Inc/dshot_dma.h`。
- **回退点**：`slice-S9a-fix8`
- **状态**：**完成（`slice-S9a-fix9`）**。数字：**383 测**（core 50 + ext 333）/ 链式冒烟 **207** 条断言全过
  （另有 fileswitch 18、pdf 80 全过；`smoke-extension` 里那条"打包之后 pdf.js 真打开一份 PDF"在本机沙箱跑不了 ——
  它要 spawn 一个 node 子进程，而沙箱里 spawn 一律 `EBUSY`，与本次改动无关）。
  链式冒烟新增 4 条：拒绝文案报档位与根、`any` 档**真的读到**工作区外的文件（用本仓库的 `docs/STATE.md` 做证据）、
  锚点不在工作区里时 `ring_buffer.h` 与 `../fixtures/ring_buffer.h` 都取得到。

### S9b 可选的追问入口（"要讲哪条线"）

- **目标**：**可选的追问入口**。文件多、逻辑散，但线只有几条，用户心里往往已经有目标 —— 但**默认不打扰**。
- **行为**：
  - **默认不问**：`capture` 保持 S1~S8 现状（`§4.1.1` 的四条分支**一个字不改**）
  - 想追跨文件逻辑线时：按 **`Ctrl+Alt+L`** 或点**侧边栏按钮**进入追问模式
  - 追问模式才弹 QuickPick：① 就讲这一块（默认，回车）② 跟 `<symbol1>` 这条线 ③ 跟 `<symbol2>` 这条线 ④ 我自己说一句 → InputBox
  - 候选派生：**纯函数、零模型调用**，且**只在追问模式触发**；过滤规则两条 ——
    ① 黑名单：`if / for / while / return / main` 等常见关键字；
    ② **优先保留"含下划线"或"首字母大写"的标识符**（覆盖 `ring_buffer_t`、`DSHOT_BOOT_MODE` 这类嵌入式命名）
  - 落进 prompt：`OrchestratorDeps.focus` → `buildUserPrompt(anchor, focus)` 加一段「## 用户想追的那条线」
- **范围**：`commands.ts`（新命令 + 只在这里问）、`start/symbols.ts`（候选派生，纯）、`prompts/index.ts`（可选参）、
  `orchestrator/Orchestrator.ts`（deps 加 `focus`）、`package.json` + `keybindingResolve.ts`（**镜像锁要同步**）、
  `sidebar`（按钮）、`CONTRACTS §4.1` 加命令行
- **为什么做成独立命令而不是往 `capture` 里塞第五问**：`§4.1.1` 那条冻结的交互表与 `smoke-walkthrough.mjs` 里
  "按 label 查表"的 `showQuickPick` 桩**都不用动**；代价只是一条新命令要按规矩同步三处（命令 / 键位 / 键位表镜像锁）。
- **验收标准**：**默认 capture 不弹窗**（回归）；按 `Ctrl+Alt+L` 才弹；候选列表合理（嵌入式样本上看）；
  选了某条线后，讲解确实围着那条线走（用户实操判断）
- **回退点**：`slice-S9a`
- **状态**：计划中

### S9c 多文件渲染 + 讲到自动切换

- **目标**：步骤落在不同文件时，编辑器**自动切到那一步所在的文件**并高亮；同时**只有一个文件可见**。
- **视图列（明确约束）**：
  - 所有被讲解文件一律 `viewColumn: vscode.ViewColumn.One`
  - **不用 `ViewColumn.Beside`、不开右侧列**（侧边栏讲解面板本来就占 Beside，两者互不干扰）
  - 打开方式统一：`showTextDocument(uri, { viewColumn: One, preview: true, preserveFocus: true })`
  - 推进到某文件步骤时，若该文件不在前台，`#ensureEditor` 切到它 —— **标签仍在同一组**
  - 读到的文件以**预览标签**出现：不堆积（下一个预览会替换它）、不抢焦点
- **范围**：`playback/CodeWalkthroughPlayer.ts`（按文件分组渲染 + `#ensureEditor` 提升为可复用入口）、
  `playback/decorationPlan.ts`（新增 `groupByFile` / `filesOfStep` 纯函数）、`commands.ts`（staleness 与"关文件即收工"
  从单文件扩到**当前拍涉及的文件集合**）、`sidebar/ui/clientScript.ts` + `core/locationLabel.ts`（标签带文件名消歧：
  文件 ≠ 锚点文件时显示 `ring_buffer.h 第 12-18 行`）
- **验收标准**：
  1. 讲解某一步时，编辑器自动切到该文件（**同组标签切换，不是分屏**）
  2. 同时只有**一个**文件可见
  3. 切走时上一个文件的框被清掉（不留残影）
- **回退点**：`slice-S9b`
- **状态**：计划中

### 截图里的 6 个问题 → 修正内容与落点

| # | 问题 | 修正 | 落点 |
|---|---|---|---|
| 3.1 | 触发入口分散：左侧「开始」卡片与右侧讲解面板距离远 | capture 的触发（**按钮 + 快捷键提示**）放到**讲解面板顶部**；配置类（模型端点 / API Key / 打开设置）折叠进「设置」分组、**默认收起** | S2 或 S9b |
| 3.2 | 高亮配色语义不清（截图里 420-430 蓝、431-446 黄） | 明确三类：**当前步** = 半透明黄 + 实线 border；**已完成步** = 半透明灰 + 无 border；**emphasis（SubHighlight）** 用**不同饱和度或左边框色**区分，**不用完全不同的色相** | S1 验收标准补「配色语义在 README 写明」 |
| 3.3 | 讲解面板导航按钮不对称：只有「上一步/讲完了/退出」，缺「下一步」 | 加「下一步」按钮，与键盘 `Alt+]` **等价**（**不需改协议**：`ui:next` 与 `onNext` 都已存在） | S1 或 S9c |
| 3.4 | 取件日志可见性：现在只显示"本次讲解没有请求额外上下文" | 日志**显式列出**：读了哪些文件、每个文件的哪几行（start-end）、第几轮、被拒的请求（含原因） | **S9a** |
| 3.5 | 讲解面板过长（编号到 10，侧边栏可能溢出） | **折叠已完成步骤**，只展开**当前 ±1 步**；提供「全部展开」开关（客户端 DOM 行为，不需协议） | S9c 或后续独立切片 |
| 3.6 | 触发入口一致性：「开始」卡片写了 `Ctrl+Alt+A`，按钮也要能点且行为一致 | 按钮与快捷键走**同一个命令** `anchorExplain.capture`，**不写两套逻辑** | S2 |

**两处工程注记**：3.1 / 3.6 要把 capture（与追问）放进讲解面板，需要 `SidebarToHost` **新增成员**
（如 `ui:capture` / `ui:trace`）—— 属 `§5.3` 的**加法扩展**（同 D46 先例：只加类型与守卫分支，
不动已有消息与 `ui:ready` 的重放语义）。

### 对 S1 / S2 验收标准的补充（来自截图反馈）

- **S1 追加**：① 配色语义写进 README（三类：当前步 / 已完成步 / emphasis，见上表 3.2）；
  ② 讲解面板有「下一步」按钮，与 `Alt+]` 等价（3.3）
- **S2 追加**：① 讲解面板顶部有 capture 触发（按钮 + 用户实际键位提示），与快捷键走**同一个命令**（3.1 / 3.6）；
  ② 「开始」面板里的配置类动作折叠进「设置」分组、默认收起（3.1）

---

# PDF 大改（S-P 系列）

> **为什么另起一个系列**：D98/D99 的 PDF 工作是**在会话中定版**的（"块是主角，解答附着在块上"），
> 当时按决策走而没有写切片号 —— 于是 STATE 的续接锚点和 SLICES 的总览都落在了后面。
> D102 起补上：**PDF 侧也按切片推进**。编号用 `S-P*`，与线1 的 `S*` 分开。
>
> 用户的边界：**PDF 侧可以推倒重来，基础功能（线1 的讲解链路、线2 的 fork）别乱动。**
> 目标一句话：**无感操作，又快又准**。

## S-P0 PDF 侧既有工作（D98 / D99，补齐编号）

| 内容 | 决策 | 状态 |
|---|---|---|
| PDF 讲解地基：契约/取件/释义人格（`EXPLANATION_JSON_SHAPE_PDF`、page_range 取件、64K 上限） | D98 | 完成 |
| 拆块引擎 `@anchor/pdf-blocks`：文字项 → 行 → 分栏 → 成块 → 阅读序 → 跨页缝合 + 手修 + 线程模型 | D99 | 完成 |
| 分栏/段落/表格修正（切栏提到成行之前、段落三判据、连续短行归并、修 dropFurniture 空签名事故） | D99 补 | 完成 |

## S-P1 块流 → 问出去：身份冻结 + 队列编号 + 重排稿

**目标**：把"块流"接到"一次提问"上 —— 这是"块是主角、解答附着在块上"的最小可用形态。
（在此之前 `splitDocument` **零产品消费者**，引擎建好了却没有一处能看见它。）

**范围**：

- `packages/pdf-blocks/src/registry.ts`（新）—— 块身份冻结：ID 分配一次、只增不减、旧 ID 改嫁（D100）
- `packages/pdf-blocks/src/queue.ts`（新）—— 顺序（阅读序/点选序）、位次、徽标数字的唯一来源（D101）
- `packages/pdf-blocks/src/reflow.ts`（新）—— N 块 → 图文混排、密集、有序、不分列的稿子（D101）
- `packages/extension-anchor/src/blocks/ui/`（新）—— 卡片流视图：`model.ts`（纯视图模型）+
  `styles.ts` + `html.ts` + `clientScript.ts`（VS Code 主题变量、严 CSP + nonce）
- `scripts/preview-blocks.mjs`（新）—— 卡片排版预览（复用真渲染函数，同 D50 的 `preview-sidebar` 思路）
- `extension-anchor` 的 `package.json` 加 `@anchor/pdf-blocks` 依赖（`workspace:*`）

**验收标准**：

| 验收 | 靠什么 |
|---|---|
| 身份冻结的六条承诺（幂等 / OCR 回填不换 ID / 抖动容忍 / 缝合改嫁 / 取消缝合认回原 ID / 认不回时继承容器） | 自动化：`test/registry.test.ts` 9 项 |
| 顺序与编号（阅读序按 (页,y) 而非下标、退回点选序并说出来、预览位次是纯计算、全序稳定） | 自动化：`test/queue.test.ts` 8 项 |
| 重排稿（图文就位、图注并进图块、省 token 模式、超预算如实汇报、编号与徽标同源） | 自动化：`test/reflow.test.ts` 10 项 |
| 卡片号码（页码标签含跨页、徽标/预览位次、图注折进图卡、孤儿 ID 报出、尖括号转义、CSP 放行 data:） | 自动化：`test/blockView.test.ts` 10 项 |
| **卡片的手感**（圆角细框、悬浮、按下去的弹、徽标灰半透明粗体、跨页接缝、图占位） | **用户实操**：`pnpm preview:blocks` 看排版；点选/滑选要 F5 |

**回退点**：**丢弃本片的新增文件即可**（本片没改任何已有文件的行为，只加了新文件、
一个 workspace 依赖、一个 `preview:blocks` 脚本，以及 docs）。`slice-S-P1` 这个 tag
**待提交之后打** —— 本片的成果目前**在工作区里未提交**（与 D104 那份在制品同时存在）。

**明确不做**（留给后面的切片）：

- 宿主接线（把卡片流接成真的 webview 面板、`blocks:*` 消息的宿主侧、拆块的真实调用方）
- `blocks:ask` 的实际提问（按钮与消息类型已声明）
- 跨页多 part 的**页面上**渲染（`anchorPdf.flashRegion` 扩成吃一组 part —— D102 第 1 条）
- 图块区域检测（D102 第 5 条）、预取（D102 第 3 条）、约束 1 的再收窄（D102 第 4 条）
- 注释回写（D103，需要引入 `pdf-lib`，单独一片）

**⚠ 接手了一件在制品：拆块活页（D104）。** 用户点明"我不是说让你接受吗，接的就是它的手" ——
所以 `core/src/types.ts` 的 `Anchor.blockIds` 与 `anchor-pdf/src/anchor/bridge.ts` 的七条
`anchor:*` 消息（页模式 / 抽页文字 / 画块 / 清块 / 页停稳 / 页文字 / 块被点）**已并入我们的契约**：
5 处注释的编号从 `D100` 统一到 **`D104`**（`D100` 归"块身份冻结"），CONTRACTS §5.2 的冻结消息集合
与 §1 的 `Anchor` 都已同步，四条边界约定也写进去了。
**还缺两件**（S-P2 的范围）：① 注入脚本侧（四个分支 + 停稳 0.9s 计时）；
② 宿主侧的消费者（`pageSettled`/`pageText`/`blockClick` → 拆块 → 回画覆盖层）。
它的三条上行守卫（`parseSelectMessage`）本来就是对的，没动。

### S-P1 落地结果（2026-09-20，已提交，tag `slice-S-P1`）

**改了哪些文件**：

| 文件 | 性质 |
|---|---|
| `packages/pdf-blocks/src/registry.ts` | 新增（身份冻结） |
| `packages/pdf-blocks/src/queue.ts` | 新增（顺序与编号） |
| `packages/pdf-blocks/src/reflow.ts` | 新增（重排稿） |
| `packages/pdf-blocks/src/ids.ts` | 改：`coord` 导出；文件头说明"指纹降级为别名" |
| `packages/pdf-blocks/src/index.ts` | 改：导出上面三件 |
| `packages/core/src/types.ts` | 改：`Anchor.blockIds`（D104，接手在制品；注释改号为 D104） |
| `packages/extension-anchor-pdf/src/anchor/bridge.ts` | 改：七条 `anchor:*` 消息（D104，接手在制品；4 处注释改号） |
| `packages/pdf-blocks/test/{registry,queue,reflow}.test.ts` | 新增 27 项 |
| `packages/extension-anchor/src/blocks/ui/{model,styles,html,clientScript}.ts` | 新增（卡片流视图） |
| `packages/extension-anchor/test/blockView.test.ts` | 新增 10 项 |
| `packages/extension-anchor/package.json` + `pnpm-lock.yaml` | 改：加 `@anchor/pdf-blocks` 依赖 |
| `scripts/preview-blocks.mjs` | 新增（排版预览） |
| `package.json` | 改：加 `preview:blocks` 脚本 |
| `docs/CONTRACTS.md` | 改：§11 的身份段改写 + 新增 §12 |
| `docs/DECISIONS.md` | 改：新增 D100 / D101 / D102 / D103 |
| `docs/SLICES.md` | 改：新增本系列与本片 |
| `docs/STATE.md` | 改：当前切片 + 最后更新 + 已知缺口 |

**验收结果**：自动化全绿 —— `pnpm check` 的每一段都过：
typecheck 4 个包；测试 **439 项**（core 48 / pdf-blocks 58 / ext-A 307 / ext-pdf 26）；
四个冒烟 24 + 链式 + 文件切换 + PDF 全通过；打包两个产物正常。
**观感部分已用浏览器截图核验**（窄面板 430px 下：卡片圆角/边框、`第 12–13 页` + `跨页` 标签、
跨页块的「接页」接缝、图卡的裁剪图与图注、图占位斜纹、表格等宽渲染、徽标灰色的粗体数字）；
**点选/滑选/按下去的弹**仍**需要用户 F5 实操**（DOM 行为这个仓库没有自动化覆盖，已知缺口 1）。

**一处按用户原话校正**：徽标在"已选"状态下也曾把按钮染成活动选中色，于是数字不再是"灰色"。
改成选中态**只动卡片边框与底色**，按钮保持中性 —— 数字在哪都保持"灰、半透明、粗体"。

**视图是返工过的：从"列表"改成"相册"。** 第一版做成上下堆叠的宽卡片（一行一张，正文全文），
用户看了截图回了一句原话：**"块，应该是像相册的…每个块等大、密集。每个块里有一个缩略图，
不一定展示完全内容。你设计时不一定完全紧贴，但也应该稍微密一点，方一点"**，并给了一张手机相册的
截图（四列等大方块、小间隙、缩略图上带角标）。于是改成：

- **等大**：`aspect-ratio: 1/1` + 网格行高一致，每块都是同一块砖（预览里 115×115、四列）；
- **密集**：`gap: 4px`；**方一点**：圆角 4px → 3px，内边距压到 6px；
- **缩略图，不必完整**：文字块渲染**提取好的正文**（不是截图）并底部渐隐，
  图块渲染那一块的裁剪（`object-fit: cover`）；**悬停给 `title` 全文** ——
  "不一定展示完全内容"不等于"看不到完整内容"；
- **那个数字平时不显**（悬停显预览位次、选中显发送位次）：密集的网格里不该到处是按钮，
  而点击热区是**整块**，那颗数字是状态指示、不是唯一入口；
- 跨页块在砖里是"两片正文 + 一道虚线接缝"，底部那条写「第 12–13 页 跨页」。

预览也一起修了两处**看得不方便**的地方：样本从 8 块加到 24 块（**相册这件事只有在格子够多时
才看得出来**）、说明文字从页首挪到**页尾**（第一屏应该全是相册），并把相册框在一个 480px 宽的
"面板"里居中显示。

**动效被用户连骂两次，规矩立成 D105 / D106。** 第一版给选中的块加了 3.2s 的呼吸
（阴影偏移 1px），悬停还有 `translateY(-1px)`。用户看完预览的原话：

> "我不动的时候，块和块内元素不要动了…**不要一个像素这样动，很吸引视线，又让人很难受**"

我去做了"整屏光锥"，又读错了他的意思，他再次明确：

> "**不要后面一道光在这扫**。可能我的表述不准。我希望你将块想象成一个**矩形立方体的顶面**，
> 内容在底面，有一个视觉效果、**暖色**、鼠标移上去，给一个**倾斜**效果，这样就看出 3D 效果了"

最终形态（D105 + D106）：

- **块完全静止**：撤呼吸、悬停不位移（改成一圈内阴影）、卡片 `transition` 里断掉 `transform`；
- **每块是一个浅箱**：`.floor` 底面装内容、四面**暖色** `.wall`、`.rim` 抬到箱口（`translateZ(10px)`），
  格子给 `perspective: 700px`；**静止时箱体整层不可见**（不悬停看不出是个箱子）；
- **倾斜跟手**：角度按指针方位算（最大 8°，`--tx`/`--ty`），**移动时零过渡、离开才缓回** ——
  否则每次 `mousemove` 重启过渡，倾斜会追着指针跑、带拖影；
- **暖色取主题变量** `--vscode-editorWarning-foreground`（暗色主题即琥珀），不许写死色值；
- **不做整屏扫光**（`.cone` 已删，文档里留着这条是因为它被明确否掉过）。

**运行期审计**（我在浏览器里量的，不是"我觉得"）：静止时整页 `document.getAnimations()` = **0**、
箱体 `opacity` = 0、`.tilt` 是单位矩阵；悬停时 `--tx/--ty` 到 ±7°、`.tilt` 是真实 `matrix3d`、
箱壁 `rgb(204, 167, 0)`、箱口 `translateZ(10px)`。四条断言钉住（含"暖色不许写死"
"跟手时不许有过渡""扫光不许回来"）。

**两个环境坑（写给下次做预览的人）**：预览是 webview，CSP 是 `style-src <cspSource> 'nonce-…'` ——
控制台里注入 `<style>` 会被**静默拦掉**（没 nonce），只有 `element.style` 这类 CSSOM 改动不受限；
后台/无头标签页里**过渡不推进**，读计算样式会一直读到过渡起点值，要定格得先把 `transition` 置 `none`。

**顺手报出的三条文档红点（本片一并修掉）**：STATE 的「当前切片」还停在 S9a（已过期）；
SLICES 总览里没有 PDF 大改的切片号（D98/D99 无编号）；`packages/pdf-blocks` 缺 package README
（AGENTS.md 要求每个 package 一份）。

### 立体效果返工了七轮，最后**全删了**（D106 → D115）

这段值得单独记，因为它是这个项目里**最贵的一条弯路**：前四轮都在"给砖加三维机制"，
而用户要的其实是一个**稳定的画面**（D110 自己总结的那句："我连着四轮都在'加机制'"）。
七轮之后，用户把整件事收了尾："**去掉后面的所有设计吧，你根本实现不了我的想法，
那都去掉吧，只留相册设计**"（D115）—— 那七轮的代码现在一行都不剩。

| 轮 | 做了什么 | 用户看完的原话 | 结论 |
|---|---|---|---|
| D106 | 浅箱：底面 + 四面暖色箱壁 + 箱口框，跟随指针倾斜（8°） | "**有点太浅了**。最好把立方体的框线也展示出来" | 加深度、加线 |
| D107 | 箱体往里凹（`translateZ(-depth)`），只看得到箱口 | "**不对，只能从顶部那个面往里看**，然后内容再深一点" | 改成"向内看的箱" |
| D108 | 撤掉所有面片与棱线，只留阴影与错位（"真实的坑没有面"） | "**没改好，理想情况应该像一个坑一样的。**" | 继续改坑 |
| D109 | 坑底比坑口大 18%、无边框、悬停露出被裁的边缘、加折射环 | "**底面应该更大一点，无边框**。现在不能起到倾斜看到更多内容效果。加个折射效果" | 前两句照做（就是下一轮的输入），黄光埋下祸根 |
| D110 | 不再跟随指针 → **固定姿势** `rotateX(-15deg)`；删掉暖黄高光 | "**角度变化不够大，晃动很累，然后有一个异常的黄光**，这不是我想要的效果" | 固定姿势 + 无暖色 |
| D111 | **不用真立方体**：砖不动、眼睛动（投影的闭式解）；玻璃 + 整块对焦 | "只能向下歪，没法四处看…要不你就别做成真立方体" | 地基对了，但坑底做成了和坑口一样大 |
| D112 | **底面比顶面大**（倾斜才真的看到新内容）+ **分区域对焦**（中心清楚、倾斜对别处对焦） | "**倾斜没有起到扩大观察内容的目的，因为底面和顶面一样大**""只有中心附近清楚，通过倾斜对别处对焦" | 本轮 |
| D113 | **底面真的转**（浏览器自己的透视，不用算好的平移）+ 对焦整块删掉 + 静止时铺满孔口 | "**信息获取不全，你的对焦不好用**…**你的底面应该真的绕着一个球面在转。然后对焦去掉吧，做得太差**" | 本轮 |
| D114 | 坑挖到一格深、底面成像**缩到 0.88**（不再补满）、坑壁从 4% 加到 12%、转幅收到 10° | "**为什么总是看着离得这么近？**" | 本轮 |
| D115 | **那七轮全部删掉，只留相册**（四层结构/视线/五个旋钮/暗角与玻璃反光，一行不留） | "有一个固定遮罩在影响我看底面。""**去掉后面的所有设计吧，你根本实现不了我的想法，那都去掉吧，只留相册设计**" | 收尾：相册 = 等大、密集、方 + 缩略图 |

D111 的落地要点（细节见 `DECISIONS.md` D111）：

- **一个 3D 变换都不用**：删掉 `.tilt` / `.plate` / `.shade` / 旧的 `.glass`（遮罩环），
  换成 `.window > .floor + .wall × 4 + .glass`；
- 几何全在 CSS 的 calc 里，由两个数驱动（`--eye-x/--eye-y`，客户端只在悬停时写）；
- **新增一条几何不变量测试**：求值渲染出来的 CSS，在 10 个眼睛位置上核对几何。
  **它当场抓出一个真错**：第一版把上下两壁的符号写反了。

D112 的落地要点（细节见 `DECISIONS.md` D112）：

- **底面比顶面大**（`--anchor-plane: 1.26`）：静止时平面每边藏 15.1px，视线挪到头带进来 11.1px
  —— 这条直接对着用户那句"倾斜没有起到扩大观察内容的目的"；
- 平面有一个**硬下界**（`≥ 1 + 2 × slack × EYE_MAX × 50%`，视线挪到头平面仍要盖满孔），
  以及一条**硬指标**（"挪到头内容至少挪 5%"）—— 两条都写进测试，改了 slack/plane/EYE_MAX 就会红；
- **版面按 1/(1-slack) 预放大**（尺寸 + 字号）：不补这一下，1.26 会被深度缩放吃成 1.08，
  "做大"等于白做（D111 就是这么白做的）；
- **孔壁改用 `--anchor-rim` 且不透明**：孔沿后面是板子；
- **对焦分区域**：两层同一内容（清 / `blur(1.3px)`）+ 互补遮罩，遮罩挂在**不动的**层上，
  于是"清楚的那块"钉在格子中心、内容从下面平移过去 = 倾斜对别处对焦；
- **运行期验证**：平面渲染 143.2px 对 115px 的格子；两个极端下平面的四边都还在格子之外
  （最近的一边差 3.96px，**没有空洞**）；孔壁静止 2.95px、极端时对面 7.08px；
  内容平移 11.14px；**两层内容的 transform 完全一致**（不一致就重影 —— 双层结构的头号风险）；
  过渡仍由 `@property --eye-x` 插值。画面仍看不到像素，"好不好看"留给用户。

D113 的落地要点（细节见 `DECISIONS.md` D113）：

- **对焦整块删掉**：`.focus` 两层、互补遮罩、`blur`、`--anchor-soft` 全没了（用户："做得太差"）；
- **底面真的转**：`.window` 上 `perspective: 4 × 格子边长`，`.plane` 上
  `translateZ(-0.5 格) rotateX(眼睛y × 10.5°) rotateY(−眼睛x × 10.5°) scale(1.26)` ——
  每个点都在绕自己的中心画球面（用户要的那个词），投影出来是真的近大远小；
- **静止时铺满孔口**：`1.26 × far/(far+depth) = 1.12`，多出来的 12% 是给"转"的余量；
  缩略图内边距从 7px 加到 10px，保证内容不被那圈孔沿压住；
- **两条硬关系**（都写进测试，改任何一项都会重算）：静止时 `plane × far/(far+depth) ≥ 1`；
  转到底时远角缩得最多，`plane ≥ (far+depth)/(cosθ×far − sinθ)`，缺口 ≤ 孔沿的 4%；
- **运行期验证**：静止 `matrix3d(1.26, …)`、底面 127.3px 对 113px 的格子；
  四角极端下底面投影出来的四边形每个角都还在孔口之外（最近的 1.0005）；
  斜看时远角缩到 0.9344、缺口 3.7px < 孔沿 4.54px；悬停写入 `--eye-x/--eye-y`（0.832/0.682）、
  `transitionrun` 拿到两条自定义属性、底面是含旋转项的 `matrix3d(…, -49.4)`、离开即还原；
  一块砖只有一份内容、整张卡上没有任何 `blur`。画面仍看不到像素。

D114 的落地要点（细节见 `DECISIONS.md` D114）：

- **诊断**：D113 为了"一个字都不裁"把底面在投影上的缩**补掉了**（`plane = 1 + depth/far`），
  于是底面成像正好铺满孔口 = "贴在洞口上"；转起来近侧还被放大 7% = **往外鼓**；
  坑壁只有 4.5px = 太薄（真实的坑，"深"主要来自坑壁的高度）。
- **改**：`--anchor-depth: 1`（坑深 = 洞口边长）、`--anchor-plane: 1.10`（成像 0.88，小一成二）、
  `--anchor-rim: 12%`（13.6px）、`--anchor-tilt: 10deg`；字号按成像比例补回来（字不变小）。
- **一条硬边界**：底面成像最多只能比孔口小 ~13%（转到底时远角缩得最多，再小角上就露洞）
  —— **要更深的观感只能加厚坑壁**。求解过程（tilt/rim/plane 三档）记在决策里。
- **实装量到一个单元测试看不见的 bug**：透视按 `.window` 的 em 算、深度按 `.plane`
  （字号补偿后）的 em 算，**两个单位不一致**，实际比例 3.5 而非 4 → 斜看时角上露 1.4px 的洞。
  修法：卡片上 `container-type: size`，两者都用 `cqh`（`100cqh` = 一格）。
- **运行期验证**：静止时底面成像 **0.876**（D113 是 1.127，整整差两成半）、坑壁 13.64px、
  透视 460px = 4 × 115px；四角极端下仍盖住八个探针点（最近 0.7597 对 0.7586）；
  近边/远边投影比 5.4%。测试加了三条反向断言（要小 8%、不许顶出孔口、字号要补）。

D115 的落地要点（细节见 `DECISIONS.md` D115）—— **用户把前面七轮全否了**：

- 起因是用户又发现一处："**有一个固定遮罩在影响我看底面**"（那两片是我画的：底面上的暗角
  与玻璃反光，都压在内容之上）；还没动手，用户就给了最终判词："**去掉后面的所有设计吧，
  你根本实现不了我的想法，那都去掉吧，只留相册设计**"。
- **删干净**（不是调参）：`.window/.plane/.wall-*/.glass` 四层、`--eye-x/--eye-y` 与 `@property`、
  五个几何旋钮（depth/far/tilt/plane/rim）、`container-type` 与全部 `cqh`、暗角与玻璃反光、
  底面的字号补偿，以及客户端那半段视线代码（`EYE_MAX`、量 rect、rAF 合帧、减少动效早退）。
- **留下的就是相册**：等大的砖、4px 密的网格、3px 圆角、缩略图 + 底部渐隐（`title` 有全文）、
  悬停才显的页码条、右上角那颗灰半透明粗体数字、按下去弹一下（`.pop`）。
- **测试跟着换向**：孔的那两条（DOM 结构 / 几何不变量）删掉，改成
  "相册：等大/密集/方 + 一层内容"、"缩略图不必完整但 title 有全文"、
  "立体那七轮一个字都不留（四层/两个变量/@property/五个旋钮/透视与旋转/暗角与反光）"、
  "客户端只剩指针那四件事"。
- **运行期验证**：16 块**全部 115×115**、缝正好 4px；那四层与 `.focus` 各 0 个；
  卡片上 `transform/perspective/filter` 都是 `none`；格子正中 `elementFromPoint` 拿到的是
  `.thumb` 本身（**内容之上没有任何一层**）；静止时没有任何动画在跑。全量 `pnpm check` 绿。

**教训（写给下一次做视觉）**：① 视觉是"状态"还是"动作"，开工前先问一句；
② 参数类反馈（更深、更大、角度更大）与**方向类**反馈（"不是这样"）要分开对待 ——
后者出现两次以上，就该整体换方案，而不是继续调参；
③ **把"这个效果让人多看到/多做到什么"写进验收**（D112 那条"至少挪 5%"）——
D111 的几何是自洽的，但用户要的是"能多看一点东西"，自洽不等于有用；
④ **能交给浏览器算的（真透视、真变换）就别自己手算**：D111/D112 两版都是"我算好的位移"，
用户两次都用"这不真"否掉（"像一张画在滑"）；D113 把 translateZ + rotate + perspective 直接
交给渲染引擎，才有了"真的在转"。
⑤ **修一个问题时别顺手把另一条既有的观感抹掉**：D113 为了"一个字都不裁"把底面的深度缩补没了，
于是"深"变成了"贴"（D114 用户那句）。D114 的写法是两者都保住 —— 底面小一圈，字号补回来。
⑥ **单位一致性要在实装里量**：同一个几何量写在两个元素上（透视在 .window、深度在 .plane），
很容易变成两套 em。D114 就是靠浏览器量出来才发现差 3%（单元测试与模型自洽，看不出来）。
⑦ **视觉上"越做越讲究"不等于在交付**：七轮的判据始终应该是用户那句"无感操作，又快又准"，
不是"能不能做得更真"。**先给一个安静的版本，再问要不要加**；要加也只加一处，加完立刻问
（D115 是用户替我把这个决定做了 —— 那七轮连带前面的成本都不该发生）。

---

## S-P2 把块流接成一个真的看得到、点得动的窗口

**目标**：S-P1 交出去的是**纯函数 + 能预览的排版** —— 也就是说，用户到这一刻
**一次也没真的用过卡片流**。本片把它接成真窗口：打开、点选、滑选、问出去。

**范围**（分两片；S-P2a 本轮落地，S-P2b 见"明确不做"）：

- `packages/extension-anchor/src/blocks/blockSource.ts`（新）—— 拆块的**真实调用方**：
  pdf.js 的 `PDFSource` → 引擎的 `SplitInput`（**字段名映射只此一处**）+ 文档指纹（内容 sha1）
- `packages/extension-anchor/src/blocks/streamHost.ts`（新）—— 宿主侧**状态机**（纯函数）：
  点/滑选/清空/顺序模式、队列与块流对齐、队列 → 重排稿 → 锚点（`askPayloadOf`）
- `packages/extension-anchor/src/blocks/BlockStreamPanel.ts`（新）—— 真 `WebviewPanel`
  （照 `SidebarPanel` 的路子：单例、`retainContextWhenHidden`、全内联资源）
- `src/protocol.ts` —— `BlockToHost` 五条 + `parseBlockMessage` 守卫
- `src/commands.ts` —— 命令 `anchorExplain.showBlocks`（挑 PDF → 拆块 → 开窗）；
  `blocks:ask` 接到既有的 `explain(anchor)`；`pdfCache` 提出来复用（原来是内联建的）
- `src/blocks/ui/clientScript.ts` —— 重画时保住滚动位置（`setState`）
- `package.json` —— 声明新命令（`smoke` 会查"声明了必注册、注册了必声明"）
- `src/adapters/pdf/pdfjsSource.ts` —— **无条件复制**字节（修 transfer 造成指纹静默变空串的 bug）

**验收标准**：

| 验收 | 靠什么 |
|---|---|
| 点/滑选落在**卡片**上（图注那张在屏幕上不存在，不许被拉进队列） | 自动化：`test/blockStream.test.ts` 10 项 |
| 队列与块流对齐：图注 ID 折到图卡、孤儿清掉**并报出来**（D81） | 同上 |
| 问出去：稿子 = 重排稿、顺序 = 发送顺序、锚点带 `segments`/`blockIds`、超预算如实汇报 | 同上 |
| **真 PDF**：30 页样张 → 文字项归一化 → 拆出成规模的块流、阅读序不倒退、指纹 = 文件内容的 sha1 | 同上（真件那一项） |
| 命令接线完整（声明 ↔ 注册） | 自动化：`pnpm smoke`（25 条） |
| **看得见、点得动、问得出**：命令开窗 → 选块 → 徽标 → 滑选 → 问 AI → 侧边栏出讲解 | **用户实操**（F5；工作区里要有一份 PDF） |

**回退点**：删掉 `src/blocks/` 那三件 + `protocol.ts`/`commands.ts`/`package.json` 的四处改动即可
（`streamHost.ts` 是纯函数、面板与命令都是新增入口，都不动既有链路）。

**明确不做**（留给 **S-P2b**）：

- **图块进得来**（`PageImageIn`：从 pdf.js 算子表拿图片 bbox）—— 现在只有文字层，
  纯图页会被拆成碎字块；这是"卡片流好不好用"的第二大来源（第一大是 S-P2a 做的接线）
- **卡片裁剪图的栅格路径**（按卡片尺寸渲染 + 按页缓存）—— 图卡现在走"本次未带像素"的占位（不假装有）
- **D104 的尾巴**：注入脚本侧四个分支 + 0.9s 停稳计时；宿主侧 `pageSettled`/`pageText`/`blockClick` 的消费者
- 跨页多 part 的**页面上**渲染（D102 第 1 条）、预取（第 3 条）、约束 1 再收窄（第 4 条，需用户确认）

### S-P2a 落地结果（2026-09-20）

**改了哪些文件**：`src/blocks/blockSource.ts`（新）、`src/blocks/streamHost.ts`（新）、
`src/blocks/BlockStreamPanel.ts`（新）、`src/protocol.ts`、`src/commands.ts`、
`src/blocks/ui/clientScript.ts`、`src/adapters/pdf/pdfjsSource.ts`、`package.json`（声明命令）、
`test/blockStream.test.ts`（新，10 项）、`test/blockView.test.ts`（客户端那条断言跟着改）；
docs：STATE / SLICES / DECISIONS（D116）/ CONTRACTS（§12.4.5）。

**验收结果**：

- **自动化**：`pnpm check` 退出码 0 —— core 48 / pdf-blocks 58 / extension-anchor 321 /
  extension-anchor-pdf 26（共 453 例）；`smoke` 的"声明 ↔ 注册"两条都过（25 条命令）。
  其中**真件**那两条：`test/fixtures/sample-30p.pdf`（30 页、90 个文字项）→ 拆出 30 块、
  阅读序不倒退、指纹 = 该文件内容的 sha1（此前静默算成了空串的 sha1，见 D116 的那个 bug）。
- **需用户实操**：F5 之后在命令面板里执行「Anchor: 把 PDF 拆成卡片流（块流窗口）」 →
  挑一份 PDF → 窗口里点几张卡（徽标应当出现 1、2、3）→ 按住拖过几块 → 按「问 AI」→
  侧边栏应当照常出讲解（这一步走的正是既有的讲解链路）。

---

## 发布记录

### v0.1.1（2026-09-22）——跨文件取件修复，块流窗口搭车

**内容**：主因是 **D117**（取件范围算错：锚点不在工作区里时什么都读不到 + 新增"不限"档 `any`）。
同一次提交里的 **S-P1 / S-P2a**（块流窗口 `anchorExplain.showBlocks`）**一起进包**，
按 **D118** 在 Release 说明里**如实标注为预览、尚未经实际使用验证**。

**改了哪些文件**（版本号一处不漏）：`packages/extension-anchor/package.json`、
`packages/extension-anchor-pdf/package.json`（`0.1.0` → `0.1.1`）；
`docs/DISTRIBUTION.md`（产物名 / 大小 / 版本号说明 / 安装命令行）；
两个 `README.dist.md` 的安装命令行（这两个文件进包后会变成包内 `README.md`）。

**产物**：`release/anchor-explain-0.1.1.vsix`（3.31 MB，26 entry）、
`release/anchor-pdf-0.1.1.vsix`（4.62 MB，415 entry）—— 四道校验全过，
manifest `Version` 均 = `0.1.1`。（`release/` 被 `.gitignore` 忽略，分发靠 GitHub Release 附件。）

**验收证据**：

| 门 | 结果 |
|---|---|
| `pnpm typecheck` | 4 个包全 Done |
| `pnpm test` | **467 例全过**：core 50 / pdf-blocks 58 / extension-anchor 333 / anchor-pdf 26 |
| `pnpm build` | 产出 `packages/extension-anchor/dist/extension.cjs` |
| `pnpm smoke` | 83 条断言，**82 ok / 1 FAIL** —— 唯一那条要 spawn 一个 node 子进程（`EBUSY`，见上文 S9a 那段） |
| `pnpm smoke:chain` | 207 条全过 |
| `pnpm smoke:fileswitch` | 18 条全过 |
| `pnpm smoke:pdf` | 80 条全过 |
| `pnpm package:vsix` | 两个包：结构 / 必带 / 禁带 / 密钥扫描全过 |

**注意**：`pnpm check` 在这台机器的沙箱里**退出码永远是 1** —— 它用 `&&` 串起四组冒烟，
而 `smoke` 里那条 spawn 断言在沙箱里必挂，后面的 `smoke:chain` / `smoke:fileswitch` /
`smoke:pdf` 就**根本不会跑**。所以这里是把四组冒烟**逐个跑**过的（上面的数字即来源于此）。
以后在本沙箱里验收，别只看 `check` 的退出码。

**对外文案**：`release/RELEASE_NOTES-v0.1.1.md`（GitHub Release 用的正式说明）+
`release/论坛公告-跨文件取件修复.md`（论坛版，更口语）。两份都留在 `release/`（不进 git）。
