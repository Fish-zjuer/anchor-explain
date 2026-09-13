# SLICES.md — 切片计划

> 切片是**唯一的工作单位**。一次只做一个切片，独立验收、独立回退（`git tag slice-<编号>`）。
> 用户说不符合就**回退**，不在上面叠加修补。
> 开工前把当前切片的「目标 / 范围 / 验收标准 / 回退点」写全；收工后标记完成。

## 编号说明

- `F*` = 基础层（Foundation）：契约与测试台。**先建基础，上层在其上构建。**
- `S*` = 功能切片（Slice）：按体感优先排序，线1 先于线2。

## 总览

| 编号 | 目标 | 验收 |
|---|---|---|
| F1 | 契约冻结：`packages/core` 类型与 ports 落地 | 自动化 |
| F2 | 走通骨架 + 测试台（能装能编能跑能测 + 假货 + fixture） | 自动化 |
| S1 | 线1 最小可视：F5 → main.c → FakeProvider 写死 3 step → 高亮流转 → ESC 清除 | **用户实操确认** |
| S2 | 线1 触发与确认 UI（选区 → QuickPick → 发送） | 用户实操 |
| S3 | 线1 接真实 AI（openAICompatible） | 自动化 + 用户实操 |
| S4 | PDF fork 骨架：改名 / 不劫持 / 能打开 | 用户实操 |
| S5 | PDF 注入 overlay 框选 | 用户实操（拖拽手感必须本人确认） |
| S6 | PDF 框选 → Anchor → 侧边栏讲解（含点击滚动定位） | 自动化 + 用户实操 |
| S7 | PDF 取件（page_range 取附近页文字） | 自动化 |

## 硬性约束

> **S1 必须用户实操确认后，才允许进入 S2。不允许"先做完再一起看"。**

原因：S1 决定的是"荧光笔手感"这类只能靠眼睛判断的东西，一旦错误被后续切片固化，返工面会涉及播放器、侧边栏、键位三层。

## 防返工的关键约定（所有切片共用）

**假货只允许出现在最外层边界，中间链路必须全真。**

| 切片 | 假的东西 | 真的东西 |
|---|---|---|
| S1 | AI 从哪来（`FakeProvider` 返回写死的 `ExplanationResult`）、选区从哪来（`EditorPort` 的假实现返回写死 40-48 行） | `ExplanationResult → 校验 → 会话状态 → decoration 渲染 → 侧边栏 → 状态栏 → 键位` **全真** |
| S2 | 仅 AI（`FakeProvider`） | 以上全部 + 真实选区捕获 |
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
- **验收标准**：**用户实操确认**（高亮像不像荧光笔、流转顺不顺）。补充硬指标：
  - 高亮为**半透明背景 + `isWholeLine` + border**，纯视觉
  - 文件 `isDirty === false` 且**字节未变**
  - 键位走 `contributes.keybindings` 默认声明，**不硬编码 Space**
  - 状态栏提示**反映用户实际绑定**
- **回退点**：`slice-F2`

## S2 线1 触发与确认 UI

- **目标**：把假选区换成真选区，加 QuickPick 确认（「讲解这段 / 整个文件」）。
- **范围**：`src/vscode/ports/editorPort.ts`（接 `window.activeTextEditor`）、`src/commands.ts`（确认流程）、`src/adapters/CodeAdapter.ts`（首次落地 `capture`）
- **验收标准**：**用户实操** —— 选中 40-48 行 → 快捷键 → 出现确认 → 确认后结果与 S1 一致。
- **回退点**：`slice-S1`

## S3 线1 接真实 AI

- **目标**：把 `FakeProvider` 换成 `openAICompatible`，接上 orchestrator 的 `fetch_context` 循环（≤3 轮）。
- **范围**：`src/orchestrator/{Orchestrator.ts, ModelRouter.ts, toolSchema.ts, validateContextRequest.ts, providers/{types.ts, openAICompatible.ts}}`、`src/prompts/*`、`src/adapters/CodeAdapter.ts` 的 `fetchContext`、`src/config.ts`
- **验收标准**：自动化（mock 驱动的编排循环测试：≤3 轮、取件命中、非法请求走拒绝路径）+ **用户实操**（真 key 下走通一次）
- **回退点**：`slice-S2`

## S4 PDF fork 骨架

- **目标**：fork 进 `packages/extension-anchor-pdf`，改名 / 不劫持 / 能打开。
- **范围**：整个 fork 树 + `MODIFICATIONS.md`（记录上游 commit SHA 作 diff 基线）；改 `publisher` / `name` / `viewType`（`pdf.view` → `anchorPdf.view`）/ 命令与配置命名空间（`pdf.*` → `anchorPdf.*`）/ `displayName`，**移除一切上游品牌字样**；`customEditors` 加 `"priority": "option"`
- **验收标准**：**用户实操** —— 命令面板 `用 Anchor 打开 PDF` 能打开；**默认 PDF 打开仍是原扩展**（不劫持）；`anchorPdf.*` 配置节出现。
- **回退点**：`slice-S3`

## S5 PDF 注入 overlay 框选

- **目标**：注入式 overlay，能拖拽画矩形，**不碰 `assets/pdf.js/`**。
- **范围**：`packages/extension-anchor-pdf/media/anchor-select.js`、`src/anchor/{rectToNormalizedBBox.ts, captureAnchor.ts, bridge.ts}`
- **验收标准**：**用户实操（拖拽手感必须本人确认）** + 自动化（`rectToNormalizedBBox` 纯函数单测）。
- **回退点**：`slice-S4`

## S6 PDF 框选 → Anchor → 侧边栏讲解（含点击滚动定位）

- **目标**：框选 → Anchor → `executeCommand` 交给 ext-A → 侧边栏出讲解；侧边栏每条 step 显示位置标签（「第 N 页」），**点击该条滚动 PDF 到对应页**（滚动，不是高亮框）。空格/next 只推进侧边栏文字，**不动 PDF**。
- **范围**：`bridge.ts` 的 `executeCommand('anchorExplain.explainAnchor', anchor)` 通路；ext-A 的 `explainAnchor` 命令；`SidebarPanel` 加位置标签与点击；ext-B 的 `anchorPdf.revealPage` 命令 + 注入脚本 `gotoPage`（`PDFViewerApplication.page = N`）
- **验收标准**：自动化 + **用户实操**。**PDF 上不出现任何高亮框。** 未装 ext-B 时明确提示而非静默失败。
- **回退点**：`slice-S5`

## S7 PDF 取件

- **目标**：`page_range` 取附近页文字（`pdfjs-dist` legacy 无头，**不依赖 webview**）。
- **范围**：`src/adapters/PDFAdapter.ts`、`src/adapters/pdf/{PDFSource.ts, pdfDocumentCache.ts, pageTextIndex.ts, textSearch.ts}`
- **验收标准**：自动化 —— 30 页 fixture 上 `bbox → 文本` 命中第 23 页且跨行补换行；`fetchContext({type:'page_range', start:22, end:24})` 返回带 `--- 第 N 页 ---` 页头的文本。
- **回退点**：`slice-S6`
