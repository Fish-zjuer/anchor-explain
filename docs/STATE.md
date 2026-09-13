# STATE.md — 当前状态

> 这是**续接锚点**。压缩上下文后，读完本文件 + `SLICES.md` 当前切片那一节，就应当能直接开工。
> 每次收工必须更新，尤其「下次第一件事」必须具体到文件。

## 项目一句话

跨场景 AI 截图讲解系统：用户在文档上截取一块区域，系统捕获**带地址的结构化坐标**（不只是像素），AI 先尝试讲解，不够时按地址回取上下文，最终输出**带定位的讲解步骤**并逐步高亮流转。

核心命题：**截图 = 带地址的锚点，不是像素包。**

## 当前切片

**F2（走通骨架 + 测试台）— 已完成，tag `slice-F2`**

## 已完成切片

| 切片 | 内容 | tag | 日期 |
|---|---|---|---|
| F0 | 规划定稿 + docs 六件套基线 | `slice-F0` | 2026-09-13 |
| F1 | 契约冻结：core 类型 + ports + 纯函数 | `slice-F1` | 2026-09-13 |
| F2 | 走通骨架 + 测试台：workspace / 最小可激活扩展 / F5 / 两个替身 / fixtures | `slice-F2` | 2026-09-13 |

## 下次第一件事

**S1 线1 最小可视**（`SLICES.md` S1 那一节）。建议落盘顺序：

1. `packages/extension-anchor/src/orchestrator/validateExplanation.ts` —— §3.3 输出校验。
   **先写它**：这是「AI 输出不可信」的唯一闸门，S1 要真跑，S3 接真 AI 时不再动。
2. `packages/extension-anchor/src/protocol.ts` —— §5 消息协议类型（`WalkthroughState` / `HostToSidebar` / `SidebarToHost`）
3. `packages/extension-anchor/src/playback/WalkthroughSession.ts` —— 会话状态机（下标 / 状态 / staleness）
4. `packages/extension-anchor/src/playback/CodeWalkthroughPlayer.ts` —— decoration 渲染 + `revealLocation`
5. `packages/extension-anchor/src/sidebar/{SidebarPanel.ts, ui/*}` —— 原生 DOM 侧边栏（不用 React）
6. `packages/extension-anchor/src/sidebar/{statusBar.ts, keybindingResolve.ts}` —— 读**用户实际绑定**渲染提示
7. `packages/extension-anchor/src/vscode/ports/{editorPort.ts, fileSystemPort.ts}` —— 真 ports；
   `getSelection` 先用 `fakes/fakeEditorPort.ts` 的假选区（S2 换成真选区）
8. `packages/extension-anchor/src/commands.ts` —— §4.1 命令 + 四层装配
9. `packages/extension-anchor/package.json` 的 `contributes.commands` / `contributes.keybindings`

**唯一的接线点**：`commands.ts` 里 `const provider: ExplainProvider = fakeProvider;` —— S3 只改这一行。

**S1 是硬门**：必须用户实操确认（荧光笔手感、流转顺不顺），不允许"先做完再一起看"。

## 未完成待办

- S1~S7（见 `SLICES.md`）
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
11. **提交前跑 `pnpm check`**（typecheck → test → build → smoke）。`pnpm smoke` 不启动 VS Code，只对 `vscode` 模块打桩，验证产物可加载 + core 真被 bundle。
12. **`fakes/*` 不进 `@anchor/core` 的 barrel**，导入必须写成 `@anchor/core/fakes/fakeProvider`——多打一截路径就是防止正式链路悄悄依赖替身。
13. **改 `test/fixtures/main.c` 第 40-48 行** → 必须同步 `fakes/fakeEditorPort.ts` 的 `FAKE_SELECTION_TEXT` 与 `fakes/fakeProvider.ts` 的脚本行号；`test/fakes.test.ts` 里有一条耦合锁会拦住漏改。
14. **`@types/vscode` 与 `engines.vscode` 必须是同一个精确版本**（现为 `1.90.0`，不带 `^`）。写成 `^` 会让类型漂到最新版，`tsc` 静默放行低版本不存在的 API。见 `CONTRACTS.md` §9.5 / D39。
15. **仓库内文本一律 LF**（根 `.gitattributes` 钉死）。本机 `core.autocrlf=true`，没有它就等着耦合锁变红。见 D40。
16. **`pnpm test` 目前只覆盖 `@anchor/core`**：`extension-anchor` 没有 `test` 脚本（F2 阶段包内没有可脱离 `vscode` 测的东西），它的行为由 `pnpm smoke` 覆盖。S1 起补。

## 待补 docs

（空。若发现 docs 缺失导致不得不读源码，记在这里，并在同一会话内补齐。）

## 最后更新

2026-09-13，F2 收工。
