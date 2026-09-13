# anchor-explain（线1：代码编辑器）

把**当前选区**变成带地址的锚点：AI 讲解 → 校验 → 逐步高亮流转。走 VS Code 原生能力
（`TextEditorDecorationType` + `setDecorations` + `revealRange`），**纯视觉，不修改文件**。

- 扩展 ID：`anchor.anchor-explain`（publisher `anchor`，见 `DECISIONS.md` D27）
- 入口：`src/extension.ts` → 打包产物 `dist/extension.cjs`（CommonJS，宿主的 `require` 不吃 ESM 入口）

## 现在到哪了

F2 阶段，**只有一个自检命令**：

| 命令 | 作用 |
|---|---|
| `Anchor: 显示状态` | 报当前活动文件/选区，并显示对端 `anchor-pdf` 是否已安装 |

它同时是一次接线验证：输出里的行号标签来自 `@anchor/core` 的 `locationLabel`，
能正常显示就说明 workspace 链接与 esbuild 打包都通了。

`docs/CONTRACTS.md` §4.1 里其余命令在 **S1** 才有处理函数。**故意不提前声明** ——
声明了却没实现，用户点了只会得到「命令未找到」。

## 怎么跑

```bash
pnpm install          # 在仓库根执行
pnpm build            # 或 pnpm watch，产物落在本包 dist/extension.cjs
pnpm check            # 在根执行：typecheck → test → build → smoke
pnpm smoke            # 单独跑产物冒烟（见下）
```

在仓库根按 `F5`：`.vscode/launch.json` 会起扩展开发宿主，`preLaunchTask` 自动跑 `pnpm watch`，
并且**默认把 `test/fixtures/` 当工作区打开**（里面就是 `main.c`）。

**本包没有 `test` 脚本**（F2 阶段包内没有可脱离 `vscode` 测试的东西），
所以根 `pnpm test`（`pnpm -r --if-present test`）实际只跑 `@anchor/core`。
本包的行为由根目录的 `scripts/smoke-extension.mjs` 覆盖：它不启动 VS Code，
直接 `require` 本包产物，只把 `vscode` 模块换成桩，断言产物可加载、`activate` 注册了命令、
命令回调能跑通且 core 真被 bundle。S1 起会补本包自己的测试。

## 边界

- 不 import `core/` 之外的内部实现；四层（命令 / 适配器 / 编排 / 渲染）之间只经 `@anchor/core` 通信
- 不改用户文件：高亮一律是 decoration，不是编辑
- 命令的 `title` **只写动作**（如 `显示状态`），分类由 `category: "Anchor"` 提供，
  面板里显示成 `Anchor: 显示状态`。别在 `title` 里再写一遍 `Anchor:`，会重复
