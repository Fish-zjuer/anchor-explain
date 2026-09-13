# Anchor Explain

跨场景 AI 截图讲解系统。核心命题：

> **截图 = 带地址的锚点，不是像素包。**
> 用户在文档上截取一块区域，系统捕获的不只是像素，而是**带地址的结构化坐标**；
> AI 先尝试讲解，不够时按地址回取上下文，最终输出**带定位的讲解步骤**并逐步高亮流转。

先例工具（Code Explainer / Agent CodeWalk / MCP Walkthrough / Contral）都只能表达
`(文件, 起始行, 结束行)`，**没有一个能表达 PDF 位置** —— 这正是 `Location` 联合类型的价值所在。
调研结论见 `docs/PRIOR-ART.md`。

## 现在能跑什么

**S2 阶段：线1（代码编辑器）的触发与确认 UI 也通了。** 打开 `main.c`、**选中一段**、按 `Ctrl+Shift+A`，
先弹一个确认（「讲解这段 / 整个文件」，只放光标时改为提示 + 一个按钮），确认后编辑器里出现
**均匀的浅色块**，`Alt+]` 让一个荧光在块内**逐个小逻辑点扫过去**，侧边栏同步出讲解，`Esc` 退出。
**文件一个字节都不会变。**

目前**只剩"AI 从哪来"一处是替身**（写死的三个 step）。链路其余部分全是真的：
真选区 → 适配器 → 输出校验 → 会话状态 → decoration → 侧边栏 → 状态栏。S3 换掉它 —— **只改一行**，
见 `packages/extension-anchor/README.md`。

（S1 里"选区从哪来"也是替身，写死第 40-48 行；S2 已换成真实现，`fakes/fakeEditorPort.ts`
现在只被单测引用，已从打包产物里 tree-shake 掉。）

## 仓库结构

```
packages/core                  @anchor/core —— 类型契约 / ports / 纯函数（零 vscode 依赖）
packages/extension-anchor      线1 代码编辑器扩展（ID anchor.anchor-explain）
packages/extension-anchor-pdf  线2 PDF 扩展（fork，S4 才落地）
scripts/make-fixture-pdf.mjs   生成 30 页验收样本 PDF
scripts/smoke-extension.mjs    产物冒烟：能加载 / 命令注册与声明对齐 / webview 资源在不在 / 假选区已退出产物
scripts/smoke-walkthrough.mjs  链路冒烟：capture 从真选区跑到 decoration（确认分支、画哪几行、哪档配色、文件未变）
scripts/def-lines.mjs          一次性工具：生成 CONTRACTS §9.1 的行号表
test/fixtures/                 main.c（第 40-48 行是默认选区）+ sample-30p.pdf
docs/                          唯一事实源，见下
```

## 命令

```bash
pnpm install
pnpm fixtures     # 重新生成 test/fixtures/sample-30p.pdf（零依赖，已提交，一般不用跑）
pnpm build        # esbuild 打包扩展，产物落在各自 packages/<包名>/dist/extension.cjs
pnpm watch        # 同上，watch 模式；F5 的 preLaunchTask 用的就是这个
pnpm typecheck    # tsc --noEmit，只做类型检查，不出产物
pnpm test         # node --test 直接跑 .ts（Node 24 类型剥离，无需构建）：core 28 + ext 72
pnpm smoke        # 不启动 VS Code，require 打包产物，只对 vscode 模块打桩（23 项断言）
pnpm smoke:chain  # 链路冒烟：跑一次完整讲解，断言每一拍只亮一个点、文件未变（82 项断言）
pnpm check        # 上面最后五件事串起来：typecheck → test → build → smoke → smoke:chain
```

> `pnpm build` 目前只打一个扩展（`esbuild.mjs` 的 `TARGETS` 里只有 `extension-anchor`），
> 线2 的 `extension-anchor-pdf` 到 S4 才加进去。
>
> 两个冒烟脚本都只对 `vscode` 模块打桩，但**都不替代 F5**：配色好不好看、流转顺不顺只有肉眼算数。

按 `F5` 起扩展开发宿主：工作区会自动落到 `test/fixtures/`。打开 `main.c`、**选中几行**、
按 `Ctrl+Shift+A`（mac 是 `Cmd+Shift+A`），先确认「讲解这段 / 整个文件」，侧边栏就出逐步讲解，
`Alt+]` / `Alt+[` / `Esc` 操作它。命令面板里另有 `Anchor: 显示状态`，可看骨架接线与**上次捕获的区间**。

**F5 不灵、或者你根本没在用 VS Code**：`pnpm devhost` 是一条等价命令（不用 F5、不用调试器）。
**改侧边栏排版**用 `pnpm preview:sidebar`：把真实生成的侧边栏 HTML 起在本地服务上，
浏览器打开就能看，不用起 VS Code（D50）。
**第一次上手请照 [`packages/extension-anchor/README.md`](packages/extension-anchor/README.md)
的「从零到看见荧光笔」走一遍** —— 那里有逐步操作、预期结果，和一张"看不到反应查这里"的对照表。

## 文档（唯一事实源）

**改代码前先读 `AGENTS.md`。** 文档顺序固定，为的是让上下文前缀稳定：

| 文件 | 内容 |
|---|---|
| `AGENTS.md` | 工作协议：切片纪律、读文件预算、报告格式 |
| `docs/STATE.md` | 当前切片 + **下次第一件事**（续接锚点） |
| `docs/SLICES.md` | F1/F2 + S1~S7 切片计划，含硬门与每片的回退点 |
| `docs/CONTRACTS.md` | 接口契约，改类型必须同步这里 |
| `docs/DECISIONS.md` | 决策记录，只追加不删除 |
| `docs/ARCHITECTURE.md` | 四层架构 + 双 package 拓扑 + 数据流 |
| `docs/PRIOR-ART.md` | 四个先例工具的核实结论 |

## 许可

本仓库自身的代码为 MIT。线2 的 PDF 扩展是 [`mathematic-inc/vscode-pdf`](https://github.com/mathematic-inc/vscode-pdf)
的 fork（Apache-2.0），届时将保留上游 LICENSE/NOTICE、以 `MODIFICATIONS.md` 声明改动，并移除上游品牌字样。
