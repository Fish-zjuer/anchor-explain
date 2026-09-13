# @anchor/core

外壳无关的**类型契约、ports 与纯函数**。`adapters/`、`orchestrator/`、`prompts/` 与两个扩展都依赖它，
而它**不依赖任何外壳** —— 本包内出现 `import ... from 'vscode'` 即为违规。

## 入口

| 路径 | 职责 | 关键实体 |
|---|---|---|
| `src/types.ts` | 规范 §1 全部类型 + §3 适配器接口 + 类型守卫 | `Location`、`Anchor`、`ContextRequest`、`WalkthroughStep`、`ExplanationResult`、`SourceAdapter`、`isPDFLocation` / `isCodeLocation` / `isWebLocation` |
| `src/ports.ts` | 零 vscode 依赖的接缝（**全为新增**） | `EditorPort`、`FileSystemPort`、`ImageRendererPort`、`ExplainProvider` |
| `src/normalizeBBox.ts` | bbox 数学，**唯一实现**，fork 的 PDF 侧也复用它 | `normalizeBBox`、`coerceBBox`、`isValidBBox`、`bboxArea` |
| `src/locationLabel.ts` | 把 `Location` 渲染成人类可读标签 | `locationLabel`、`formatLineRange` |
| `src/errors.ts` | 类型化错误 | `AnchorError`、`AnchorErrorCode`、`describeError` |
| `src/logging.ts` | `ContextRequest` 的环形缓冲日志（规范要求每次取件都必须记录） | `createContextRequestLogger`、`ContextRequestLogEntry` |
| `src/index.ts` | barrel。**外部一律从 `@anchor/core` 导入，不深链 `src/`** | — |
| `src/fakes/fakeProvider.ts` | 假 AI（最外层边界的替身） | `fakeProvider`、`createFakeProvider` |
| `src/fakes/fakeEditorPort.ts` | 假选区（写死第 40-48 行） | `createFakeEditorPort` |

`fakes/` **刻意不进 barrel**：正式代码只应通过子路径显式引入，避免生产链路悄悄依赖测试替身。
导入写法为 `@anchor/core/fakes/fakeProvider`。

## 命令

```bash
pnpm --filter @anchor/core test       # node --test，直接跑 .ts，无构建步骤
pnpm --filter @anchor/core typecheck  # tsc --noEmit
```

## 约束（改动前先看 [`../../docs/CONTRACTS.md`](../../docs/CONTRACTS.md)）

- 改任何类型签名 → 必须同步 `docs/CONTRACTS.md`（以本包目录为基准是 `../../docs/CONTRACTS.md`）
- `SourceAdapter.detect()` 是**同步** `boolean`，改成 `Promise` 属契约变更
- `fakes/` 里的行号与 `test/fixtures/main.c` 第 40-48 行绑定，动一边必须动另一边；
  `test/fakes.test.ts` 里有一条耦合锁会拦住漏改
