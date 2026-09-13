# STATE.md — 当前状态

> 这是**续接锚点**。压缩上下文后，读完本文件 + `SLICES.md` 当前切片那一节，就应当能直接开工。
> 每次收工必须更新，尤其「下次第一件事」必须具体到文件。

## 项目一句话

跨场景 AI 截图讲解系统：用户在文档上截取一块区域，系统捕获**带地址的结构化坐标**（不只是像素），AI 先尝试讲解，不够时按地址回取上下文，最终输出**带定位的讲解步骤**并逐步高亮流转。

核心命题：**截图 = 带地址的锚点，不是像素包。**

## 当前切片

**F0（规划与文档基线）— 已完成，待打 tag**

## 已完成切片

| 切片 | 内容 | tag | 日期 |
|---|---|---|---|
| F0 | 规划定稿 + docs 六件套基线 | `slice-F0` | 2026-09-13 |

## 下次第一件事

**F1 契约冻结**：创建 `packages/core/`（`package.json` + `tsconfig.json` + `src/types.ts` + `src/ports.ts` + `src/normalizeBBox.ts` + `src/locationLabel.ts` + `src/errors.ts` + `src/logging.ts`），
逐字落地 `docs/CONTRACTS.md` §1~§3 中标为「待落地」的类型与 ports，然后把 CONTRACTS.md 里这些条目的状态从「待落地」改为「已冻结」并补 `path:line`。

**F1 不写任何行为逻辑**，只有类型、接口、纯函数（`normalizeBBox` 的裁剪与排序、`locationLabel` 的标签生成）。

## 未完成待办

- F1 契约冻结（见上）
- F2 走通骨架 + 测试台（workspace 能装能编、扩展能激活、`node --test` 绿、F5 起调试宿主、`FakeProvider` + fixtures 就位）
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

## 待补 docs

（空。若发现 docs 缺失导致不得不读源码，记在这里，并在同一会话内补齐。）

## 最后更新

2026-09-13，F0 收工。
