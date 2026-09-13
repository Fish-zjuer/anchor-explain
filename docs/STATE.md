# STATE.md — 当前状态

> 这是**续接锚点**。压缩上下文后，读完本文件 + `SLICES.md` 当前切片那一节，就应当能直接开工。
> 每次收工必须更新，尤其「下次第一件事」必须具体到文件。

## 项目一句话

跨场景 AI 截图讲解系统：用户在文档上截取一块区域，系统捕获**带地址的结构化坐标**（不只是像素），AI 先尝试讲解，不够时按地址回取上下文，最终输出**带定位的讲解步骤**并逐步高亮流转。

核心命题：**截图 = 带地址的锚点，不是像素包。**

## 当前切片

**S1（线1 最小可视）— 代码与自动化验收完成，tag `slice-S1`。等用户按一次 F5 确认手感。**

## 已完成切片

| 切片 | 内容 | tag | 日期 |
|---|---|---|---|
| F0 | 规划定稿 + docs 六件套基线 | `slice-F0` | 2026-09-13 |
| F1 | 契约冻结：core 类型 + ports + 纯函数 | `slice-F1` | 2026-09-13 |
| F2 | 走通骨架 + 测试台：workspace / 最小可激活扩展 / F5 / 两个替身 / fixtures | `slice-F2` | 2026-09-13 |
| S1 | 线1 最小可视：8 个命令 + 真链路（校验 → 会话 → decoration → 侧边栏 → 状态栏）+ 键位 + 「整块 + 逐点扫描」 | `slice-S1` | 2026-09-13 |

## 下次第一件事

**等用户 F5 确认 S1**（荧光笔手感 + 扫描顺序 + ESC 是否顺手）。**硬门**：确认之前不进 S2。

**逐步操作与故障对照表已写进 `packages/extension-anchor/README.md` 的「怎么跑（第一次：从零到看见荧光笔）」**
（前提 → 开哪个目录 → 起宿主的两种方式 → 新窗口里的操作 → 症状对照表 → 怎么收）。
**F5 起不来就用 `pnpm devhost`**（等价于 `code --extensionDevelopmentPath=packages/extension-anchor test/fixtures`，
不用 F5、不用调试器）。

### 第二轮反馈已处理（2026-09-13）

用户实测后报了三件事，都已改完（见 D48 / D49）：

| 反馈 | 真因 | 处置 |
|---|---|---|
| "荧光不够统一，隔行就变颜色" | 同一 step 的**所有**子高亮被同时点亮，三行三种混合色 | 游标改成「拍」，一次只亮一个点；块级底色恒为均匀（D48） |
| "讲解不够细？应该浅色荧光包住整块 + 一个荧光扫描内部逐个小逻辑点" | 一拍 = 一整步，粒度太粗 | 同上：整块 1 拍 + 每个逻辑点 1 拍，`Ctrl+Shift+Space` 可自动扫（D48） |
| "ESC 好像没有，后面都没法测了" | 编辑器被释放后 `setDecorations` 抛异常，把 `stop()` 的收尾全跳过（D49）；另外渲染面一抛会把会话误判成失败并关掉 `sessionOpen` | 状态先置、渲染面各自隔离、清框兜异常、`startSession` 移出 try（D49） |
| "状态栏没找到" | 未定论 | `Anchor: 显示状态` 现在会打印状态栏项的 `shown` 与 `text`；**放置位置等用户决定**（用户原话"后面固定到一个地方就行了"） |

### F5 时重点看这五件事

1. `main.c` 第 40-42 行有**均匀**的淡底色，且**一个子高亮都不亮**（第一拍只铺整块）
2. `alt+]` → 40 行亮起「上下文」，块级底色不变；再 `alt+]` → 40 行灭、42 行亮起「定义」。
   **任何一拍都只应有一行亮色**（这就是"统一"）
3. 扫完两个点才进第 2 步（44-45）；最后一步的问题标**第 9 拍**再按 `alt+]` 才落「已讲完」
4. **落到「已讲完」之后接着按 `escape` → 框必须全清、状态栏收起**（D46 修的就是这一步）
5. **把焦点点进侧边栏面板，再按 `alt+]` / `escape`** —— 验 D47 的按键转发；面板里那行
   「▸」标记应与编辑器里的亮色同步移动

**按 Esc 前先确认焦点**：如果焦点停在**终端**面板里，Esc 会进 PowerShell 而不是触发命令 ——
这不是 bug。三条退出路径都可用：`Esc`、侧边栏里的「退出」按钮、命令面板 `Anchor: 退出讲解`。

**看到"我选的不是 40-48 行，但它讲的就是 40-48"是正常的**：S1 的选区是 `fakeEditorPort` 写死的，
与你的实际选区无关（S2 才接真选区）。想看你实际选了什么 → `Anchor: 显示状态`。

**确认后第一件事 = S2 线1 触发与确认 UI**：

- 先删 `commands.ts` 里 `resolveS1FixturePath()` 与那段 `createFakeEditorPort(...)` 覆盖
  （S1 脚手架，文件内已标注"── S1 脚手架（S2 删除）──"）
- 再把 `getSelection` 未覆盖的真实现接上（`vscode/ports/editorPort.ts` 已写好，不用改）
- 再加 QuickPick 确认（「讲解这段 / 整个文件」）与"只放光标没选内容"的提示分支
- `buildAnchor` 从 `commands.ts` 搬进 `adapters/CodeAdapter.ts` 的 `capture()`（见下）

## 未完成待办

- S2~S7（见 `SLICES.md`）
- **S1 偏离一处（已在 SLICES.md 声明）**：`adapters/CodeAdapter.ts` 仍是空的，
  `capture()` 的等价逻辑临时住在 `commands.ts` 的 `buildAnchor()` 里，S2 搬走。
- **F2 遗留的 F5 项**：与 S1 的 F5 是同一个动作，一并确认即可。
- **未开始也未规划**：PDF 高亮渲染、PDF 流转导航、MCP 出口、TTS —— 均已明确砍掉，非待办

## 关键约束速览（细节见 `CONTRACTS.md` / `DECISIONS.md`）

1. 两条线分工：线1 代码编辑器走 VS Code 原生高亮 + 流转；线2 PDF **只做框选定位，不做高亮流转**
2. `core/ prompts/ orchestrator/ adapters/` **零 `vscode` 依赖**，靠 `core/src/ports.ts` 抽象，保证可在 Node 里直接测
3. fork 是 `mathematic-inc/vscode-pdf`（**Apache-2.0**），须保留 LICENSE/NOTICE、写 `MODIFICATIONS.md`、**移除上游品牌字样**
4. PDF 框选用**注入式 overlay**，**不碰 `assets/pdf.js/`**（上游 pdf.js 是 vendored + 打补丁的）
5. 假货只允许出现在**最外层边界**（`FakeProvider`、`EditorPort` 后的假选区），中间链路全真
6. 键位**只提供命令 + 默认键位**，默认不绑 Space，用户自选；状态栏提示读**用户实际绑定**
7. **S1 必须用户实操确认后才进 S2**，不允许"先做完再一起看"
8. **`SourceAdapter.detect()` 是同步 `boolean`**（规范原文如此）。改成 `Promise` 属契约变更，须经用户确认。
9. **`node --test` 直接跑 `.ts`**（Node 24 类型剥离已可用，无需构建步骤）。测试脚本必须写成 `node --test "test/*.test.ts"`——传目录不行，Windows 下 shell 不展开通配符。
10. **产物一律 `dist/extension.cjs`**（CommonJS：宿主的 `require` 不吃 ESM 入口；包内 `type: module`，故用 `.cjs` 后缀）。`tsc` **只做类型检查、从不产 JS**。新增扩展往 `esbuild.mjs` 的 `TARGETS` 加一行，不另写打包脚本。
11. **提交前跑 `pnpm check`**（typecheck → test → build → smoke → smoke:chain）。
12. **`fakes/*` 不进 `@anchor/core` 的 barrel**，导入必须写成 `@anchor/core/fakes/fakeProvider`——多打一截路径就是防止正式链路悄悄依赖替身。
13. **改 `test/fixtures/main.c` 第 40-48 行** → 必须同步 `fakes/fakeEditorPort.ts` 的 `FAKE_SELECTION_TEXT` 与 `fakes/fakeProvider.ts` 的脚本行号；`test/fakes.test.ts` 里有一条耦合锁会拦住漏改。
14. **`@types/vscode` 必须精确等于 `engines.vscode` 的**下界**（现为 `1.90.0`，不带 `^`）；`engines.vscode` 本身是范围 `^1.90.0`。** 不变式是"类型版本 = 范围下界"，**不是"两个字段字符串相同"** —— 把 `engines` 也钉成 `1.90.0` 会让用户升到 1.91 就装不上。见 `CONTRACTS.md` §9.5 / D39（D39 的前半句已更正）。
15. **仓库内文本一律 LF**（根 `.gitattributes` 钉死）。本机 `core.autocrlf=true`，没有它就等着耦合锁变红。见 D40。
16. **`extension-anchor` 自 S1 起有 `test` 脚本**（65 条，全部 vscode-free）。全仓测试数：core 28 + ext 65 = 93。
17. **两个冒烟脚本分工不同，别混着看**：`pnpm smoke`（产物能不能加载、命令注册与声明是否对齐、webview 资源在不在产物里、**产物里根本没有写文件的 API**）与 `pnpm smoke:chain`（`capture` 命令从选区跑到 decoration，断言**每一拍只亮一个点**、块底均匀、done 时状态栏文案、退出清干净、**文件字节未变**，外加"编辑器被关掉后 `stop()` 仍要收完尾"的回归测）。两者都进 `pnpm check`，都**不替代 F5**。断言条数（运行时实际执行）：19 + 64。
18. **假货接线点只有 `commands.ts` 里两行**，都带 `★` 注释：S2 删假选区那一行、S3 换 `provider` 那一行。除此之外任何地方都不许出现替身。
19. **侧边栏 CSS/客户端脚本是 TS 里的字符串常量**（内联进 webview，见 D42）。改 UI 必须同时想到：客户端脚本**不参与类型检查**，且 `ui/clientScript.ts` 里有一份 4 行的 `locationLabel` 副本（webview 不能 import `@anchor/core`）。
20. **`decorationPlan.ts` 会过滤掉所有非 `CodeLocation`** —— 这是"PDF 上不出现任何高亮框"的结构性保证，不是靠调用方自觉。
21. **步级底色与 emphasis 配色是两个独立 decoration type**（D41）。改配色时两者都要想到，否则编辑时会"两套半透明叠一起"。
22. **会话游标是「拍」不是「步」**（D48）：一个 step（n 个子高亮）占 n+1 拍，第 1 拍只铺整块底色，之后每拍点亮**一个**子高亮。`next()` 推进一拍；`goto(stepIndex)` 跳到该步的第一拍。**一次只亮一个点是"块底均匀"的结构性保证**，别改回"一次全亮"。拍数换算的纯函数（`beatsPerStep`/`totalBeats`/`locateBeat`/`firstBeatOfStep`）都在 `WalkthroughSession.ts` 里，有单测。
23. **`stop()` 必须先收状态、再清视觉**；`emit()` 必须先置 context key、三个渲染面各自 `isolated()`（D49）。清框要碰编辑器，而编辑器随时可能已被释放 —— 异常一旦逃出去，`stop()` 的收尾会整段跳过，会话卡在"谁都清不掉"的半死状态（用户实测踩过）。回归测在 `smoke-walkthrough.mjs` 第 7、8 节。
24. **"讲解失败"与"渲染失败"不许混**（D49）：`startSession` 在 `explain()` 的 try **之外**。渲染面抛异常不得把会话判死、更不得落 `sessionOpen`。
25. **两个 context key 分工不许合并**（D46）：`walkthroughActive` 管推进键（`done` 时落 false），`sessionOpen` 管收尾（只在 `stop` / 编辑器关闭时落 false）。`escape` 绑在后者上 —— 合并回去就会复现"讲完按不动 ESC、框清不掉"那个阻塞级问题。
26. **webview 里的按键不会冒泡到工作台**（D47）：宿主把**已解析的用户键位**内联进 HTML（`ANCHOR_CHORDS`），客户端自己派发 `next`/`prev`/`stop`。改键位相关的展示或行为时，状态栏提示与这份内联表必须同源（都来自 `keybindingResolve`）。
27. **侧边栏客户端脚本是字符串常量，不参与类型检查**，而且**里面不能出现反引号**（那是外层模板字符串的结束符，写一个就把文件切断了——本轮真踩过）。它的自动覆盖只有 `smoke:chain` 对**消息内容**的断言，DOM 行为仍靠 F5 肉眼看（已知缺口，记在下面）。

## 待补 docs

（空。若发现 docs 缺失导致不得不读源码，记在这里，并在同一会话内补齐。）

## 已知缺口（不算 docs 缺失，但要记着）

1. **侧边栏客户端脚本没有自动化覆盖**：`ui/clientScript.ts` 是字符串常量，不参与类型检查，
   单测碰不到它；`smoke:chain` 只能断言宿主发出去的**消息内容**。DOM 行为（按钮禁用、
   `▸` 标记、布局）目前全靠 F5 肉眼看。要补的话得写一个最小 DOM 桩在 `node:vm` 里跑它。
2. **状态栏提示的落点未定**：用户没找到它，暂定"后面固定到一个地方"。`Anchor: 显示状态`
   会打印它的 `shown` 与 `text`，先据此判断是"没显示"还是"显示了没找到"。
3. **`primary` 与 `definition` 两档底色相同**，只差边线颜色/粗细（`editor.findMatchBorder` vs
   `editorInfo.foreground`），区分度是待评审的手感项。
4. **`playPause` 只有键位、侧边栏里没有按钮**：§5.3 的 `SidebarToHost` 里没有 `ui:playPause`，
   不为一个按钮加协议消息。要加时连协议一起改。

## 最后更新

2026-09-13，S1 收工（等用户 F5 确认）。
