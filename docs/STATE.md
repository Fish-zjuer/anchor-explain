# STATE.md — 当前状态

> 这是**续接锚点**。压缩上下文后，读完本文件 + `SLICES.md` 当前切片那一节，就应当能直接开工。
> 每次收工必须更新，尤其「下次第一件事」必须具体到文件。

## 项目一句话

跨场景 AI 截图讲解系统：用户在文档上截取一块区域，系统捕获**带地址的结构化坐标**（不只是像素），AI 先尝试讲解，不够时按地址回取上下文，最终输出**带定位的讲解步骤**并逐步高亮流转。

核心命题：**截图 = 带地址的锚点，不是像素包。**

## 当前切片

**S6（PDF 框选 → 侧边栏 + 点击滚动定位）— 代码与自动化验收完成，tag `slice-S6`。**
只剩 **S7**（PDF `page_range` 取件）没做。
（S3 的配 key、S4 的开 PDF、S5 的拖拽手感三件实操心都还挂着，互不依赖。）

## 已完成切片

| 切片 | 内容 | tag | 日期 |
|---|---|---|---|
| F0 | 规划定稿 + docs 六件套基线 | `slice-F0` | 2026-09-13 |
| F1 | 契约冻结：core 类型 + ports + 纯函数 | `slice-F1` | 2026-09-13 |
| F2 | 走通骨架 + 测试台：workspace / 最小可激活扩展 / F5 / 两个替身 / fixtures | `slice-F2` | 2026-09-13 |
| S1 | 线1 最小可视：8 个命令 + 真链路 + 键位 + 「整块 + 逐点扫描」 | `slice-S1` | 2026-09-13 |
| S2 | 线1 触发与确认 UI：真选区 + QuickPick 确认 + `capture` 搬进 `adapters/CodeAdapter.ts` | `slice-S2` | 2026-09-13 |
| S3 | 线1 接真实 AI：编排循环 + §3.2 取件闸门 + §3.3 双闸门 + repair + §6 配置 + SecretStorage | `slice-S3` | 2026-09-13 |
| S4 | 线2 fork `mathematic-inc/vscode-pdf`：改名 / **不劫持** / 移除品牌 / `MODIFICATIONS.md` | `slice-S4` | 2026-09-13 |
| S5 | 线2 注入式框选 overlay：像素→归一化换算（有单测）+ `anchorPdf.selectRegion` | `slice-S5` | 2026-09-13 |
| S6 | 线2 框选 → 线1 侧边栏讲解 + 点击滚动定位（**只滚，不画框**） | `slice-S6` | 2026-09-13 |

**线1（代码编辑器）的功能面到此完整**：真选区 → 真适配器 → 真 AI（带取件）→ 真校验 → 真渲染。
**产物里已经没有任何替身。**

## 下次第一件事

**S7：PDF 的 `page_range` 取件。** 范围与验收见 `SLICES.md` 的 S7 一节。落地清单：

1. `packages/extension-anchor-pdf/src/anchor/pdfText.ts` —— 用 `pdfjs-dist` 的 **legacy 无头**构建
   按页取文字（**不依赖 webview**）。注意：fork 的 `assets/pdf.js/` 是**打过补丁的 vendored 构建**，
   不是 npm 包，所以这一处要么复用 `assets/pdf.js/build/pdf.mjs`，要么加 `pdfjs-dist` 依赖 ——
   **先决定用哪一种，并把这个决定写进 `MODIFICATIONS.md`**（它决定了升级 pdf.js 时要动几处）
2. `packages/extension-anchor/src/adapters/PDFAdapter.ts` —— 线1 侧的 PDF 适配器：
   `capabilities.contextTypes = ['page_range']`、`fetchContext` 按页取文字、
   以及**终于该落的 `detect()`**（出现第二个 adapter 了，"谁适用"第一次有真假之别）
3. 线1 要能拿到 PDF 的页数（`makeOutline` 现在对 PDF 恒传 `pageCount: null`，
   于是 §3.3 的页码上界被跳过）—— 这是 S6 留下的缺口（D55 第 4 条），S7 正好是补它的时机：
   **要么**改契约（给 `Anchor` 加字段 / 让 §5.1 带返回值），**要么**在 `PDFAdapter` 侧自己读页数
   （如果 1 已经引入了无头 pdf.js，这一条几乎免费）。**优先后者**：不动冻结的契约。

**S3/S4/S5/S6 的实操验收都还挂着**（配 key / 开 PDF / 拖拽手感 / 点位置标签），互不依赖。

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
37. **"不劫持"是两半的一件事**（D53）：`customEditors[0].priority = "option"` **加上**命令 `anchorPdf.openInAnchorViewer`。只写 `option` 而不给命令 = 用户根本进不来；只给命令而不写 `option` = 抢用户的默认打开方式。`smoke:pdf` 两半都断言。
38. **线2 的 `assets/` 与 `patches/` 是上游 vendored 源码，必须提交、绝不 ignore**（23MB，含 168 个 `.bcmap` / 10 个 `.pfb` / 4 个 `.wasm`）。本包另有一份 `.gitattributes` 把它们标成 `binary` —— 那些文件的字节偏移是算出来的，被换行转换动一个字节就会在某类 PDF 上炸。改 `.gitignore` 时别把 `dist/` 写回泛匹配（根文件里有注释说明）。
39. **线2 的 `tsconfig.json` 是全仓唯一的 `moduleResolution: "Bundler"` 例外**（D53 第 7 条）：上游源码的相对导入不带扩展名，改成 `NodeNext` 等于重写一遍 fork。别为了"统一"去改它。
40. **fork 的改动必须同步 `MODIFICATIONS.md`**（Apache-2.0 §4(b) 的义务，也是与上游对齐的唯一依据）。改 `src/` 里任何文件之前先看那份文件里"改动清单"有没有它；改完在那一节补一行。
41. **`pnpm --filter anchor-pdf test` 跑两件事**：`test/anchor.test.ts`（我们的几何/守卫单测）+ 上游的 `tools/check_pdfjs.mjs`（pdf.js 补丁的不变式）。将来升级 pdf.js 时**先看后者**——它红了就是补丁没打上，而不是 PDF 有问题。
42. **注入脚本（`media/anchor-select.js`）里不许写业务数学**（D54 第 2 条）：它不参与类型检查、也没法被单测，所以"落在第几页、占那一页的百分之几"必须留在 `src/anchor/rectToNormalizedBBox.ts`（有 11 条单测）。它只做"跟手的事"：画橡皮筋、报像素几何。
43. **`anchor:ready` 握手不许省**（D54 第 4 条）：用户点框选时页面可能还在加载，不握手就会丢消息，表现是"第一次点没反应，再点一次才行"。`smoke:pdf` 两条断言分别钉住"未握手不推"与"握手后补推"。
44. **宿主对框选结果优先用 `geometry` 重算**（D54 第 3 条），不要图省事直接用脚本给的 `bbox`：那等于让唯一有对错的换算由没有测试覆盖的代码定案。冒烟里专门喂了一个**错的** bbox 来钉这件事。
45. **"不画框"的结构性判据在 `smoke:pdf` 里**：它查线2 产物里**有没有** `TextEditorDecorationType` 这个 API。"线2 不做高亮流转"这条约束因此不是靠自觉。
46. **路径工具在 `@anchor/core`（`packages/core/src/paths.ts`）**：`normPath` / `samePath` / `basenameOf` / `countTextLines`。线1 的 `src/paths.ts` 只是转发（保留它是不想改十几个导入路径）。**新增代码直接从 `@anchor/core` 导入。**
47. **两条线的定位方式必须是两套**（D55 第 1 条）：`commands.ts` 的 `revealStep` 先看 `primaryLocationOf`（只对 `CodeLocation` 有值）走播放器，否则看 `isPDFLocation` 走 `anchorPdf.revealPage`。**PDF 那一句根本不经过播放器**，再叠上 `decorationPlan` 的过滤，"PDF 上不出现高亮框"是结构性的。
48. **`anchorPdf.revealPage` 只接收 `page`，且落到当前聚焦的面板**（D55 第 2 条）：`PDFLocation` 里没有路径字段，所以线1 报不出"该滚哪一份"；落到所有面板会让"同时开两份对比"时一起滚。
49. **`pageCount` 传不进线1 是刻意留的缺口**（D55 第 4 条）：§5.1 是单向、不依赖返回值，`PDFLocation` 里也没有路径。后果是 §3.3 的页码上界被跳过（pdf.js 自己会把越界页夹住，所以用户可见后果有限）。**S7 是补它的时机**，优先在 `PDFAdapter` 侧自己读页数，别去动冻结的契约。

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
8. **线2 没有进 F5 的 launch 配置**：`.vscode/launch.json` 只载入线1。
   单独看线2 用 `code --extensionDevelopmentPath=packages/extension-anchor-pdf test/fixtures`。
   （`pnpm devhost` 同理只起线1。）
9. **手敲 `code --extensionDevelopmentPath=...` 时不会自动构建**。`pnpm devhost` 已经修成
   "先 `pnpm build` 再起宿主"了（S3 顺带），F5 有 `preLaunchTask`，但手敲那条命令没有 ——
   拿旧产物测新代码会让排查跑偏（这一条已经坑过一次）。
10. **线2 的框选还没做**：现在只能用我们的视图**看** PDF，不能框选（S5/S6）。
11. **上游 vendored pdf.js 里的 `PDF.js viewer` 字样没有改**：那是 pdf.js 自己的品牌，
    属于 vendored 依赖的一部分，不在"移除上游品牌"（publisher/displayName）的范围里。
    改它就要动 `assets/`，而那是明令不许碰的。

## 最后更新

2026-09-13，S6 收工（只剩 S7）。
S3 的配 key、S4 的开 PDF、S5 的拖拽、S6 的点位置标签四件实操心都还挂着，互不依赖。
