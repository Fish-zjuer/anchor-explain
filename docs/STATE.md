# STATE.md — 当前状态

> 这是**续接锚点**。压缩上下文后，读完本文件 + `SLICES.md` 当前切片那一节，就应当能直接开工。
> 每次收工必须更新，尤其「下次第一件事」必须具体到文件。

## 项目一句话

跨场景 AI 截图讲解系统：用户在文档上截取一块区域，系统捕获**带地址的结构化坐标**（不只是像素），AI 先尝试讲解，不够时按地址回取上下文，最终输出**带定位的讲解步骤**并逐步高亮流转。

核心命题：**截图 = 带地址的锚点，不是像素包。**

## 当前切片

**S2（线1 触发与确认 UI）— 代码与自动化验收完成，tag `slice-S2`。等用户按一次 F5 确认。**

## 已完成切片

| 切片 | 内容 | tag | 日期 |
|---|---|---|---|
| F0 | 规划定稿 + docs 六件套基线 | `slice-F0` | 2026-09-13 |
| F1 | 契约冻结：core 类型 + ports + 纯函数 | `slice-F1` | 2026-09-13 |
| F2 | 走通骨架 + 测试台：workspace / 最小可激活扩展 / F5 / 两个替身 / fixtures | `slice-F2` | 2026-09-13 |
| S1 | 线1 最小可视：8 个命令 + 真链路（校验 → 会话 → decoration → 侧边栏 → 状态栏）+ 键位 + 「整块 + 逐点扫描」 | `slice-S1` | 2026-09-13 |
| S2 | 线1 触发与确认 UI：真选区 + QuickPick 确认 + `capture` 搬进 `adapters/CodeAdapter.ts` | `slice-S2` | 2026-09-13 |

## 下次第一件事

**等用户 F5 确认 S2**（真选区跟手吗 / 确认框好不好用 / 「整个文件」与「只放光标」两条分支对不对）。
确认之前不进 S3 —— 与 S1 同一条硬门：**验收是用户实操，不是自动化绿灯**。

**逐步操作与故障对照表在 `packages/extension-anchor/README.md` 的「怎么跑（第一次：从零到看见荧光笔）」**
（前提 → 开哪个目录 → 起宿主的两种方式 → 新窗口里的操作 → 症状对照表 → 怎么收）。
**F5 起不来就用 `pnpm devhost`**。S2 的操作与 S1 只差**第一步**：现在要**真的选中一段代码**（选区跟手了）。

### S2 这次改了什么（用户视角）

1. **选区是真的了**。以前不管选哪，讲的都是写死的 40-48；现在讲的就是你选的那段。
   想核对 → 命令面板 `Anchor: 显示状态`，里面有一项 **「上次捕获：main.c 第 a-b 行（选区 / 整个文件）」**。
2. **按 `Ctrl+Shift+A` 后多一步确认**：有选区时弹「讲解这段 / 整个文件」二选一（描述里带真实行区间与行数）。
   Esc 取消 = 什么也不做。
3. **只放了光标（没选内容）**会提示一句「只放了光标，没有选中内容。」+ 一个「讲解整个文件」按钮 ——
   不会自作主张讲整份（整份往往几百行，命中率低得多）。
4. **没打开文件**是另一句提示「先打开一个文件，再选中要讲解的代码。」（与第 3 条分开，因为要你做的事不一样）。

### S2 为什么这些改动值得信

第 9 节链路冒烟把桩的选区改成一个**替身绝不会给的值**（`第 10-14 行`；替身写死 40-48），
再断言锚点跟着走 —— 替身给不出这个值，所以这一节不可能被替身蒙过。
另外 `pnpm smoke` 有两条断言直接查产物：`fake-hash-0000` 与假文档正文都已 tree-shake 掉，
即**真选区这条路已经把假货挤出了产物**（不是"这次没走到那条分支"）。

### S1 期间的四轮实测反馈（历史，理由在 D48/D49/D50）

用户 F5 实测后一共提了四轮，都已改完：荧光不统一 + 讲解太粗（→ 游标改「拍」，D48）；
ESC 清不掉高亮、后续没法测（→ 状态先置 + 渲染面隔离 + 清框兜异常，D49）；
排版没重点、没对齐（→ 固定列宽 + 非当前步压暗 + 本地预览，D50）。

## F5 时重点看这几件事（S2）

1. **选中 `main.c` 第 40-48 行** → `Ctrl+Shift+A` → 确认框里应写「讲解这段 · 第 40-48 行」；
   确认后第 40-42 行有**均匀**淡底色，且**一个子高亮都不亮**（第一拍只铺整块）
2. `alt+]` → 40 行亮起「上下文」，块级底色不变；再 `alt+]` → 40 行灭、42 行亮起「定义」。
   **任何一拍都只应有一行亮色**
3. 扫完两个点才进第 2 步（44-45）；最后一步的问题标**第 9 拍**再按 `alt+]` 才落「已讲完」
4. **落到「已讲完」之后接着按 `escape` → 框必须全清、状态栏收起**（D46 修的就是这一步）
5. **把焦点点进侧边栏面板，再按 `alt+]` / `escape`** —— 验 D47 的按键转发
6. **换一段选区再试**（比如第 44-48 行）→ 确认框里的区间应跟着变；这就是 S2 的全部意义
7. **试一次「整个文件」**：确认框第二项 / 或"只放光标"时的那个按钮 → `Anchor: 显示状态` 应显示
   「第 1-N 行（整个文件）」

**按 Esc 前先确认焦点**：如果焦点停在**终端**面板里，Esc 会进 PowerShell 而不是触发命令 ——
这不是 bug。三条退出路径都可用：`Esc`、侧边栏里的「退出」按钮、命令面板 `Anchor: 退出讲解`。

**看到"高亮画在 40-48 行附近"**：那是 `fakeProvider` 的脚本（S1 的写死内容，S3 才换真 AI）。
但**锚点区间现在是你选的那段**，两者是两件事，别再混着看。

**确认后第一件事 = S3 线1 接真实 AI**：

- `commands.ts` 里**只剩一处替身**：`const provider: ExplainProvider = fakeProvider;`（带 `★` 注释）
- 换成 `src/orchestrator/` 的编排循环（`Orchestrator` / `ModelRouter` / `toolSchema` /
  `validateContextRequest` / `providers/openAICompatible`）+ `src/prompts/*` + `src/config.ts`
- 顺手补齐 `CodeAdapter` 的 `detect()` 与 `fetchContext()`（S2 分期未落，见 CONTRACTS §3.1）

## 未完成待办

- S3~S7（见 `SLICES.md`）
- **S2 偏离两处（已在 SLICES.md / CONTRACTS §3.1 声明）**：
  1. `CodeAdapter.detect()` 与 `fetchContext()` 未落 —— 调用方 S3 才存在，属分期兑现而非接口变更
  2. `capture()` 比冻结的零参形式多一个**可选**参数（仍可赋值给零参签名，有单测钉住）
- **未开始也未规划**：PDF 高亮渲染、PDF 流转导航、MCP 出口、TTS —— 均已明确砍掉，非待办

## 关键约束速览（细节见 `CONTRACTS.md` / `DECISIONS.md`）

1. 两条线分工：线1 代码编辑器走 VS Code 原生高亮 + 流转；线2 PDF **只做框选定位，不做高亮流转**
2. `core/ prompts/ orchestrator/ adapters/` **零 `vscode` 依赖**，靠 `core/src/ports.ts` 抽象，保证可在 Node 里直接测
3. fork 是 `mathematic-inc/vscode-pdf`（**Apache-2.0**），须保留 LICENSE/NOTICE、写 `MODIFICATIONS.md`、**移除上游品牌字样**
4. PDF 框选用**注入式 overlay**，**不碰 `assets/pdf.js/`**（上游 pdf.js 是 vendored + 打补丁的）
5. 假货只允许出现在**最外层边界**，中间链路全真。**S2 起只剩 `provider` 一处**
6. 键位**只提供命令 + 默认键位**，默认不绑 Space，用户自选；状态栏提示读**用户实际绑定**
7. **验收是用户实操**：S1 / S2 各自确认后才进下一片，不允许"先做完再一起看"
8. **`SourceAdapter.detect()` 是同步 `boolean`**（规范原文如此）。改成 `Promise` 属契约变更，须经用户确认。
9. **`node --test` 直接跑 `.ts`**（Node 24 类型剥离已可用，无需构建步骤）。测试脚本必须写成 `node --test "test/*.test.ts"`——传目录不行，Windows 下 shell 不展开通配符。
10. **产物一律 `dist/extension.cjs`**（CommonJS：宿主的 `require` 不吃 ESM 入口；包内 `type: module`，故用 `.cjs` 后缀）。`tsc` **只做类型检查、从不产 JS**。新增扩展往 `esbuild.mjs` 的 `TARGETS` 加一行，不另写打包脚本。
11. **提交前跑 `pnpm check`**（typecheck → test → build → smoke → smoke:chain）。
12. **`fakes/*` 不进 `@anchor/core` 的 barrel**，导入必须写成 `@anchor/core/fakes/fakeProvider`——多打一截路径就是防止正式链路悄悄依赖替身。
13. **改 `test/fixtures/main.c` 第 40-48 行** → 必须同步 `fakes/fakeEditorPort.ts` 的 `FAKE_SELECTION_TEXT` 与 `fakes/fakeProvider.ts` 的脚本行号；`test/fakes.test.ts` 里有一条耦合锁会拦住漏改。**S2 后这条锁只保 fixture 与替身、替身与 fakeProvider 的一致性，不再约束正式链路**。
14. **`@types/vscode` 必须精确等于 `engines.vscode` 的**下界**（现为 `1.90.0`，不带 `^`）；`engines.vscode` 本身是范围 `^1.90.0`。** 不变式是"类型版本 = 范围下界"，**不是"两个字段字符串相同"** —— 把 `engines` 也钉成 `1.90.0` 会让用户升到 1.91 就装不上。见 `CONTRACTS.md` §9.5 / D39（D39 的前半句已更正）。
15. **仓库内文本一律 LF**（根 `.gitattributes` 钉死）。本机 `core.autocrlf=true`，没有它就等着耦合锁变红。见 D40。
16. **`extension-anchor` 自 S1 起有 `test` 脚本**（S2 后 72 条，**6 个文件、全部 vscode-free**）。全仓测试数：core 28 + ext 72 = **100**。
17. **两个冒烟脚本分工不同，别混着看**：`pnpm smoke`（产物能不能加载、命令注册与声明是否对齐、webview 资源在不在产物里、**产物里根本没有写文件的 API**、**假选区已从产物退出**）与 `pnpm smoke:chain`（`capture` 从**真选区**跑到 decoration，断言**每一拍只亮一个点**、块底均匀、done 时状态栏文案、退出清干净、**文件字节未变**，外加"编辑器被关掉后 `stop()` 仍要收完尾"的回归测、以及第 9 节的六条确认分支）。两者都进 `pnpm check`，都**不替代 F5**。断言条数（运行时实际执行）：**23 + 82**。
18. **假货接线点只剩 `commands.ts` 里一行**（`const provider: ExplainProvider = fakeProvider;`，带 `★`）。S3 换掉它即可。除此之外任何地方都不许出现替身。
19. **侧边栏 CSS/客户端脚本是 TS 里的字符串常量**（内联进 webview，见 D42）。改 UI 必须同时想到：客户端脚本**不参与类型检查**，且 `ui/clientScript.ts` 里有一份 4 行的 `locationLabel` 副本（webview 不能 import `@anchor/core`）。
20. **`decorationPlan.ts` 会过滤掉所有非 `CodeLocation`** —— 这是"PDF 上不出现任何高亮框"的结构性保证，不是靠调用方自觉。
21. **步级底色与 emphasis 配色是两个独立 decoration type**（D41）。改配色时两者都要想到，否则编辑时会"两套半透明叠一起"。
22. **会话游标是「拍」不是「步」**（D48）：一个 step（n 个子高亮）占 n+1 拍，第 1 拍只铺整块底色，之后每拍点亮**一个**子高亮。`next()` 推进一拍；`goto(stepIndex)` 跳到该步的第一拍。**一次只亮一个点是"块底均匀"的结构性保证**，别改回"一次全亮"。拍数换算的纯函数（`beatsPerStep`/`totalBeats`/`locateBeat`/`firstBeatOfStep`）都在 `WalkthroughSession.ts` 里，有单测。
23. **`stop()` 必须先收状态、再清视觉**；`emit()` 必须先置 context key、三个渲染面各自 `isolated()`（D49）。清框要碰编辑器，而编辑器随时可能已被释放 —— 异常一旦逃出去，`stop()` 的收尾会整段跳过，会话卡在"谁都清不掉"的半死状态（用户实测踩过）。回归测在 `smoke-walkthrough.mjs` 第 7、8 节。
24. **"讲解失败"与"渲染失败"不许混**（D49）：`startSession` 在 `explain()` 的 try **之外**。渲染面抛异常不得把会话判死、更不得落 `sessionOpen`。
25. **两个 context key 分工不许合并**（D46）：`walkthroughActive` 管推进键（`done` 时落 false），`sessionOpen` 管收尾（只在 `stop` / 编辑器关闭时落 false）。`escape` 绑在后者上 —— 合并回去就会复现"讲完按不动 ESC、框清不掉"那个阻塞级问题。
26. **webview 里的按键不会冒泡到工作台**（D47）：宿主把**已解析的用户键位**内联进 HTML（`ANCHOR_CHORDS`），客户端自己派发 `next`/`prev`/`stop`。改键位相关的展示或行为时，状态栏提示与这份内联表必须同源（都来自 `keybindingResolve`）。
27. **侧边栏客户端脚本是字符串常量，不参与类型检查**，而且**里面不能出现反引号**（那是外层模板字符串的结束符，写一个就把文件切断了——S1 真踩过）。它的自动覆盖只有 `smoke:chain` 对**消息内容**的断言，DOM 行为仍靠 F5 肉眼看（已知缺口，记在下面）。
28. **「整个文件」与「选区」是同一个形状**（D51）：`EditorPort.getDocumentSelection()` 返回的也是 `EditorSelection`（`lineStart: 1`、`lineEnd: 总行数`、`text: 全文`），`CodeAdapter.capture(scope?)` 只按 `scope` 选一个来源。**别为整文件另开一个类型或另一条产出路径** —— 下游（校验/会话/渲染）看不出区别，正是靠这一点才只需要一个可选参数。
29. **`sourceName` 走 `paths.ts` 的 `basenameOf()`**（D51），不要用 `node:path.basename`（按平台变行为，Linux 上切不动 `C:\`），也不要用 `workspace.asRelativePath`（那会把 vscode 拽进 `adapters/`）。
30. **`showState` 里的「上次捕获」不是调试残留**：真选区接上之后，"我这一按讲了哪一段"在屏幕上再也看不出来（高亮由讲解内容决定，不由选区决定）。它同时是 `smoke:chain` 第 9 节唯一的观测点，**不要删**。
31. **写 `smoke-extension.mjs` 里的中文断言前先做 `\uXXXX` 反解**：esbuild 默认 `charset='ascii'`，产物里的中文是转义形式，直接 `includes('中文')` 会永远假红（`bundleText` 已在读取时就解回来了）。

## 待补 docs

（空。若发现 docs 缺失导致不得不读源码，记在这里，并在同一会话内补齐。）

## 已知缺口（不算 docs 缺失，但要记着）

1. **侧边栏客户端脚本没有自动化覆盖**：`ui/clientScript.ts` 是字符串常量，不参与类型检查，
   单测碰不到它；`smoke:chain` 只能断言宿主发出去的**消息内容**。
   **排版部分**现在可以用 `pnpm preview:sidebar` 自己看（D50），**交互部分**（按钮禁用、
   `▸` 跟随、事件委托）仍只能靠 F5。要补齐得写一个最小 DOM 桩在 `node:vm` 里跑它。
2. **状态栏提示的落点未定**：用户没找到它，暂定"后面固定到一个地方"。`Anchor: 显示状态`
   会打印它的 `shown` 与 `text`，先据此判断是"没显示"还是"显示了没找到"。
3. **`primary` 与 `definition` 两档底色相同**，只差边线颜色/粗细（`editor.findMatchBorder` vs
   `editorInfo.foreground`），区分度是待评审的手感项。
4. **`playPause` 只有键位、侧边栏里没有按钮**：§5.3 的 `SidebarToHost` 里没有 `ui:playPause`，
   不为一个按钮加协议消息。要加时连协议一起改。
5. **`fakeProvider` 的脚本仍写死 40-48 行**：S2 换的是选区，不是讲解内容 —— 所以**换一段选区后，
   高亮仍画在 40-48 行附近**。这不是 bug，是 S3 才换掉的那一处替身。

## 最后更新

2026-09-13，S2 收工（等用户 F5 确认）。
