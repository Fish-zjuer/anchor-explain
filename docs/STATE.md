# STATE.md — 当前状态

> 这是**续接锚点**。压缩上下文后，读完本文件 + `SLICES.md` 当前切片那一节，就应当能直接开工。
> 每次收工必须更新，尤其「下次第一件事」必须具体到文件。

## 项目一句话

跨场景 AI 截图讲解系统：用户在文档上截取一块区域，系统捕获**带地址的结构化坐标**（不只是像素），AI 先尝试讲解，不够时按地址回取上下文，最终输出**带定位的讲解步骤**并逐步高亮流转。

核心命题：**截图 = 带地址的锚点，不是像素包。**

## 当前切片

**S3（线1 接真实 AI）— 代码与自动化验收完成，tag `slice-S3`。等用户配一把真 key 走通一次。**

## 已完成切片

| 切片 | 内容 | tag | 日期 |
|---|---|---|---|
| F0 | 规划定稿 + docs 六件套基线 | `slice-F0` | 2026-09-13 |
| F1 | 契约冻结：core 类型 + ports + 纯函数 | `slice-F1` | 2026-09-13 |
| F2 | 走通骨架 + 测试台：workspace / 最小可激活扩展 / F5 / 两个替身 / fixtures | `slice-F2` | 2026-09-13 |
| S1 | 线1 最小可视：8 个命令 + 真链路 + 键位 + 「整块 + 逐点扫描」 | `slice-S1` | 2026-09-13 |
| S2 | 线1 触发与确认 UI：真选区 + QuickPick 确认 + `capture` 搬进 `adapters/CodeAdapter.ts` | `slice-S2` | 2026-09-13 |
| S3 | 线1 接真实 AI：编排循环 + §3.2 取件闸门 + §3.3 双闸门 + repair + §6 配置 + SecretStorage | `slice-S3` | 2026-09-13 |

**线1（代码编辑器）的功能面到此完整**：真选区 → 真适配器 → 真 AI（带取件）→ 真校验 → 真渲染。
**产物里已经没有任何替身。**

## 下次第一件事

**等用户配 key 走通一次 S3**（下面第 1 步是唯一的新增前提）。确认之前不进 S4。

用户没确认就想继续时，S4 的第一件事是：`git clone https://github.com/mathematic-inc/vscode-pdf`
到临时目录，核对该 commit 的 LICENSE / NOTICE / `package.json`，然后按 `SLICES.md` 的 S4 范围把它 fork 进
`packages/extension-anchor-pdf/`（**改名 / 不劫持 / 移除上游品牌 / 写 `MODIFICATIONS.md`**）。
注意：**磁盘上目前没有上游 clone**，这一步需要联网。

### S3 的验收怎么走（多了一步配置，只做一次）

1. 起宿主（F5 或 `pnpm devhost`；**`devhost` 不会自动构建，改完代码先 `pnpm build`**）
2. `Ctrl+Shift+P` → `Anchor: 设置 API Key` → 选 provider → 粘贴 key（存进 SecretStorage，**不进 settings.json**）
3. 设置里填 `anchorExplain.providers`：
   `{ "default": { "baseUrl": "https://api.deepseek.com/v1", "tier1Model": "deepseek-chat" } }`
   （端点 + 模型名由你选；一个 OpenAI 兼容实现覆盖 OpenAI / DeepSeek / 通义 / Ollama）
4. `Anchor: 显示状态` → 应看到「模型：default：deepseek-chat @ https://api.deepseek.com/v1；最多取件 3 次」
5. 选中 `main.c` 一段 → `Ctrl+Shift+A` → 确认 → **这次的讲解内容是真的了**
   （不再是 `rb_pop` 那段写死文本；高亮位置也应落在你选的那段附近）
6. 想看 AI 有没有取件、取件被拒的理由 → 输出面板选「Anchor」通道

### 两个已知的"看起来像 bug"的现象

1. **高亮仍可能落在别的行**：现在 AI 自己决定 location，它可能讲错行——
   这是**模型质量问题**，不是接线问题。要看它有没有越界 → `smoke:chain` 里 §3.3 的越界会被判掉并重试一次。
2. **状态栏提示的落点仍未定**（用户说"后面固定到一个地方就行"）：`Anchor: 显示状态` 会报它的 `shown` 与 `text`。

## 关键约束速览（细节见 `CONTRACTS.md` / `DECISIONS.md`）

1. 两条线分工：线1 代码编辑器走 VS Code 原生高亮 + 流转；线2 PDF **只做框选定位，不做高亮流转**
2. `core/ prompts/ orchestrator/ adapters/` **零 `vscode` 依赖**，靠 `core/src/ports.ts` 抽象，保证可在 Node 里直接测
3. fork 是 `mathematic-inc/vscode-pdf`（**Apache-2.0**），须保留 LICENSE/NOTICE、写 `MODIFICATIONS.md`、**移除上游品牌字样**
4. PDF 框选用**注入式 overlay**，**不碰 `assets/pdf.js/`**（上游 pdf.js 是 vendored + 打补丁的）
5. 假货只允许出现在**最外层边界**，中间链路全真。**S3 起产物里已没有替身**（替身只在 `test/` 里）
6. 键位**只提供命令 + 默认键位**，默认不绑 Space，用户自选；状态栏提示读**用户实际绑定**
7. **验收是用户实操**：S1 / S2 / S3 各自确认后才进下一片
8. **`SourceAdapter.detect()` 是同步 `boolean`**（规范原文如此）。改成 `Promise` 属契约变更，须经用户确认。
9. **`node --test` 直接跑 `.ts`**（Node 24 类型剥离已可用，无需构建步骤）。测试脚本必须写成 `node --test "test/*.test.ts"`——传目录不行，Windows 下 shell 不展开通配符。
10. **产物一律 `dist/extension.cjs`**（CommonJS：宿主的 `require` 不吃 ESM 入口；包内 `type: module`，故用 `.cjs` 后缀）。`tsc` **只做类型检查、从不产 JS**。新增扩展往 `esbuild.mjs` 的 `TARGETS` 加一行，不另写打包脚本。
11. **提交前跑 `pnpm check`**（typecheck → test → build → smoke → smoke:chain）。
12. **`fakes/*` 不进 `@anchor/core` 的 barrel**，导入必须写成 `@anchor/core/fakes/fakeProvider`——多打一截路径就是防止正式链路悄悄依赖替身。**新增替身要同时加到 `packages/core/package.json` 的 `exports`**（漏了会报"找不到模块"，S3 踩过）。
13. **改 `test/fixtures/main.c` 第 40-48 行** → 必须同步 `fakes/fakeEditorPort.ts` 的 `FAKE_SELECTION_TEXT`、`fakes/fakeProvider.ts` 的脚本行号，**以及 `scripts/smoke-walkthrough.mjs` 里的 `EXPLANATION_JSON`**（S3 起链路冒烟的"模型输出"是它）。`test/fakes.test.ts` 有耦合锁拦前两个。
14. **`@types/vscode` 必须精确等于 `engines.vscode` 的**下界**（现为 `1.90.0`，不带 `^`）；`engines.vscode` 本身是范围 `^1.90.0`。** 不变式是"类型版本 = 范围下界"，不是"两个字段字符串相同"。见 `CONTRACTS.md` §9.5 / D39。
15. **仓库内文本一律 LF**（根 `.gitattributes` 钉死）。本机 `core.autocrlf=true`。见 D40。
16. **全仓测试数**：core 28 + ext 113 = **141**（9 个测试文件，全部 vscode-free）。
17. **两个冒烟脚本分工不同**：`pnpm smoke`（**结构**：产物能加载、声明与注册对齐、webview 资源在不在、没有写文件的 API、**两个替身都已退出产物**）与 `pnpm smoke:chain`（**行为**：`capture` 从真选区跑到 decoration，**S3 起跑真编排循环**——只有 `globalThis.fetch` 是桩）。断言条数：**30 + 105**。两者都**不替代 F5**。
18. **`commands.ts` 里没有任何替身了**（S1 有两处，S2 删假选区，S3 删假 AI）。新加替身要能说清"为什么只能在最外层边界"。
19. **侧边栏 CSS/客户端脚本是 TS 里的字符串常量**（内联进 webview，见 D42）。改 UI 必须同时想到：客户端脚本**不参与类型检查**，且 `ui/clientScript.ts` 里有一份 4 行的 `locationLabel` 副本。
20. **`decorationPlan.ts` 会过滤掉所有非 `CodeLocation`** —— 这是"PDF 上不出现任何高亮框"的结构性保证。
21. **步级底色与 emphasis 配色是两个独立 decoration type**（D41）。
22. **会话游标是「拍」不是「步」**（D48）：一个 step（n 个子高亮）占 n+1 拍，第 1 拍只铺整块底色，之后每拍点亮**一个**子高亮。**一次只亮一个点是"块底均匀"的结构性保证**，别改回"一次全亮"。
23. **`stop()` 必须先收状态、再清视觉**；`emit()` 必须先置 context key、三个渲染面各自 `isolated()`（D49）。回归测在 `smoke-walkthrough.mjs` 第 7、8 节。
24. **"讲解失败"与"渲染失败"不许混**（D49）：`startSession` 在 `explain()` 的 try **之外**。
25. **两个 context key 分工不许合并**（D46）：`walkthroughActive` 管推进键，`sessionOpen` 管收尾。`escape` 绑在后者上。
26. **webview 里的按键不会冒泡到工作台**（D47）：宿主把**已解析的用户键位**内联进 HTML（`ANCHOR_CHORDS`），客户端自己派发。状态栏提示与这份内联表必须同源（都来自 `keybindingResolve`）。
27. **侧边栏客户端脚本是字符串常量，不参与类型检查**，而且**里面不能出现反引号**（那是外层模板字符串的结束符）。DOM 行为仍靠 F5（已知缺口）。
28. **「整个文件」与「选区」是同一个形状**（D51）：`getDocumentSelection()` 返回的也是 `EditorSelection`，`capture(scope?)` 只按 `scope` 选来源。别为整文件另开一条产出路径。
29. **`sourceName` 走 `paths.ts` 的 `basenameOf()`**（D51），不要用 `node:path.basename`（按平台变行为），也不要用 `workspace.asRelativePath`（会把 vscode 拽进 `adapters/`）。
30. **`showState` 里的「上次捕获」不是调试残留**：真选区接上后，那是唯一能复核锚点区间的观测点，也是 `smoke:chain` 第 9 节的唯一观测点。
31. **写 `smoke-extension.mjs` 里的中文断言前先做 `\uXXXX` 反解**：esbuild 默认 `charset='ascii'`（`bundleText` 已在读取时解回来了）。
32. **§3.2 的两条实现约定不许改回去**（D52）：`file` 请求**没给 `path` 要放行**（§8 的 schema 里没有 `path`，当成"就要锚点这个文件"），且解析侧要把**自定义键一并带过去**。改回去会让 `file` 取件全部被拒——取件功能形同不存在，而且症状是"模型老是说取不到上下文"，很难往回追。
33. **去重排在频率前面**（D52）：两条规则同时命中时回灌已取内容，不回"已达上限"。§3.2 的编号是"规则序号"，不是"执行顺序"。
34. **输出校验是两道闸门**（D52）：编排层一道、命令层一道。别为了"省一次纯函数调用"删掉命令层那道 —— 渲染层只消费校验过的数据，这条规矩不该有例外。
35. **加新的 §6 配置项 = 改契约**：要同步 `CONTRACTS.md §6` + `package.json` 的 `contributes.configuration` + `config.ts` 的映射 + 单测。`temperature` 是这么加进去的。
36. **`temperature` 是"请求级优先于 provider 级"**（D52）：`ChatRequest.temperature ?? OpenAICompatibleOptions.temperature`。provider 实例是长命的，编排层可能想对某一轮单独降温。

## 待补 docs

（空。若发现 docs 缺失导致不得不读源码，记在这里，并在同一会话内补齐。）

## 已知缺口（不算 docs 缺失，但要记着）

1. **侧边栏客户端脚本没有自动化覆盖**：`ui/clientScript.ts` 是字符串常量，单测碰不到它；
   **排版**可以用 `pnpm preview:sidebar` 自己看（D50），**交互**（按钮禁用、`▸` 跟随、事件委托）仍只能靠 F5。
2. **状态栏提示的落点未定**：`Anchor: 显示状态` 会报它的 `shown` 与 `text`。
3. **`primary` 与 `definition` 两档底色相同**，只差边线颜色/粗细，区分度是待评审的手感项。
4. **`playPause` 只有键位、侧边栏里没有按钮**：§5.3 的 `SidebarToHost` 里没有 `ui:playPause`。
5. **§7 的 `ToolTrace` 面板没做**：取件日志现在落 OutputChannel「Anchor」（D52）。
6. **`CodeAdapter.detect()` 没落**：归 S7（出现第二个 adapter 时才有真假之别）。
7. **`wantsImage` 只有"锚点自带截图"这一个触发条件**：`ModelRouter` 的两条判据有单测，
   但"模型自己说要看图"这条路径线1 走不到（S5 的 PDF 才有截图）。
8. **`pnpm devhost` 不会自动构建**（F5 有 `preLaunchTask: anchor: watch`，devhost 没有）。
   改完代码用 devhost 测，必须先 `pnpm build`，否则测的是旧产物 —— 这一条已经坑过一次。

## 最后更新

2026-09-13，S3 收工（等用户配 key 实操）。
