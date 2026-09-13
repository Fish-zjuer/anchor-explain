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
