# STATE.md — 当前状态

> 这是**续接锚点**。压缩上下文后，读完本文件 + `SLICES.md` 当前切片那一节，就应当能直接开工。
> 每次收工必须更新，尤其「下次第一件事」必须具体到文件。

## 项目一句话

跨场景 AI 截图讲解系统：用户在文档上截取一块区域，系统捕获**带地址的结构化坐标**（不只是像素），AI 先尝试讲解，不够时按地址回取上下文，最终输出**带定位的讲解步骤**并逐步高亮流转。

核心命题：**截图 = 带地址的锚点，不是像素包。**

## 当前切片

**F1（契约冻结）— 已完成，tag `slice-F1`**

## 已完成切片

| 切片 | 内容 | tag | 日期 |
|---|---|---|---|
| F0 | 规划定稿 + docs 六件套基线 | `slice-F0` | 2026-09-13 |
| F1 | 契约冻结：core 类型 + ports + 纯函数 | `slice-F1` | 2026-09-13 |

## 下次第一件事

**F2 走通骨架 + 测试台**。具体动作：

1. 建根 `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`esbuild.mjs`、`.vscodeignore`
2. `packages/extension-anchor/{package.json, src/extension.ts}` 最小可激活：贡献命令 `anchorExplain.showState`，执行后弹一条通知
3. `.vscode/launch.json` + `tasks.json`，F5 能起扩展开发宿主
4. `packages/core/src/fakes/{fakeProvider.ts, fakeEditorPort.ts}` 就位（`fakeEditorPort` 返回写死的第 40-48 行）
5. `scripts/make-fixture-pdf.mjs` 生成 30 页 `test/fixtures/sample-30p.pdf`；写 `test/fixtures/main.c`（≥48 行）
6. 各 package 补 `README.md`（入口 + 职责）

## 未完成待办

- F2 走通骨架 + 测试台（见上）。
  **注意**：`packages/core/pnpm-lock.yaml` 现在落在 `packages/core/` 内，F2 建根 workspace 时要删掉并在根重装（见 `CONTRACTS.md` §9.3）
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

## 待补 docs

（空。若发现 docs 缺失导致不得不读源码，记在这里，并在同一会话内补齐。）

## 最后更新

2026-09-13，F1 收工。
