# Anchor Explain

跨场景 AI 截图讲解系统。核心命题：

> **截图 = 带地址的锚点，不是像素包。**
> 用户在文档上截取一块区域，系统捕获的不只是像素，而是**带地址的结构化坐标**；
> AI 先尝试讲解，不够时按地址回取上下文，最终输出**带定位的讲解步骤**并逐步高亮流转。

先例工具（Code Explainer / Agent CodeWalk / MCP Walkthrough / Contral）都只能表达
`(文件, 起始行, 结束行)`，**没有一个能表达 PDF 位置** —— 这正是 `Location` 联合类型的价值所在。
调研结论见 `docs/PRIOR-ART.md`。

## 现在能跑什么

**S7 阶段：计划内的切片全部做完（F0/F1/F2 + S1~S7）。**
线1 接真实 AI + 取件；线2 能框选 PDF 并把位置交给线1 讲解、点击侧边栏滚到对应页；
线1 还能无头读 PDF 的文字层（取件与 `extractedText`）。
在 Anchor 的 PDF 视图里 `Ctrl+Alt+S` 拖一个矩形 → 位置变成锚点交给线1 讲解。

**线1**： 打开 `main.c`、**选中一段**、按 `Ctrl+Shift+A`，
先弹一个确认（「讲解这段 / 整个文件」，只放光标时改为提示 + 一个按钮），
确认后**调你配的模型端点**产出讲解：编辑器里出现**均匀的浅色块**，
`Alt+]` 让一个荧光在块内**逐个小逻辑点扫过去**，侧边栏同步出讲解，`Esc` 退出。
**文件一个字节都不会变。**

**链路里已经没有任何替身**：真选区 → 真适配器 → 真编排循环（带取件）→ 真校验 → 真渲染。
代价是多一步配置：填 `anchorExplain.providers` + 用 `Anchor: 设置 API Key` 存一把 key
（存进 `SecretStorage`，不进 settings.json）。见
[`packages/extension-anchor/README.md`](packages/extension-anchor/README.md) 的「第 0.5 步」。

（S1/S2 里的两个替身 —— 假选区、假 AI —— 都已退出产物，现在只在 `test/` 与 `scripts/` 里
作为"边界上的替身"存在。判据是 `pnpm smoke` 直接查产物里有没有替身独有的字面量。）

**线2**：`packages/extension-anchor-pdf/` 是 [`mathematic-inc/vscode-pdf`](https://github.com/mathematic-inc/vscode-pdf)
的 fork。**不劫持**（`customEditors` 是 `priority: "option"`，你的默认 PDF 打开方式不变），
想看它就用 `code --extensionDevelopmentPath=packages/extension-anchor-pdf test/fixtures`
再跑 `Anchor: 用 Anchor 打开 PDF`。改动逐条见该包的 `MODIFICATIONS.md`。

## 仓库结构

```
packages/core                  @anchor/core —— 类型契约 / ports / 纯函数（零 vscode 依赖）
packages/extension-anchor      线1 代码编辑器扩展（ID anchor.anchor-explain）
packages/extension-anchor-pdf  线2 PDF 扩展（fork，Apache-2.0；改动见该包 MODIFICATIONS.md）
scripts/make-fixture-pdf.mjs   生成 30 页验收样本 PDF
scripts/smoke-extension.mjs    产物冒烟：能加载 / 命令注册与声明对齐 / webview 资源在不在 / 两个替身都已退出产物
scripts/smoke-walkthrough.mjs  链路冒烟：capture 从真选区跑到 decoration，跑真编排循环（取件/拒绝/上限、画哪几行、文件未变）
scripts/smoke-pdf-extension.mjs 线2 产物冒烟：不劫持（priority:option）/ 改名改干净 / 命令真能打开
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
pnpm test         # node --test 直接跑 .ts（Node 24 类型剥离，无需构建）：core 28 + ext 133 + pdf 12
pnpm smoke        # 不启动 VS Code，require 打包产物，只对 vscode 模块打桩（33 项断言）
pnpm smoke:chain  # 链路冒烟：跑一次完整讲解（真编排循环，只有 fetch 是桩）（105 项断言）
pnpm smoke:pdf    # 线2 产物冒烟：不劫持 / 改名 / **框选整条链路**（66 项断言）
pnpm check        # 上面最后六件事串起来：typecheck → test → build → smoke → smoke:chain → smoke:pdf
```

> `pnpm build` 打**两个**扩展（`esbuild.mjs` 的 `TARGETS` 里两条）：线1 与线2。
> **线2 不劫持**：它的 `customEditors` 是 `priority: "option"`，你的默认 PDF 打开方式不变；
> 想看线2 就用 `code --extensionDevelopmentPath=packages/extension-anchor-pdf test/fixtures`
> 然后跑命令面板的 `Anchor: 用 Anchor 打开 PDF`。
>
> 两个冒烟脚本都只对 `vscode` 模块打桩，但**都不替代 F5**：配色好不好看、流转顺不顺只有肉眼算数。

按 `F5` 起扩展开发宿主：工作区会自动落到 `test/fixtures/`。**先配一次模型端点**
（`Anchor: 设置 API Key` + 设置里的 `anchorExplain.providers`，见子包 README 的「第 0.5 步」），
然后打开 `main.c`、**选中几行**、按 `Ctrl+Shift+A`（mac 是 `Cmd+Shift+A`），
先确认「讲解这段 / 整个文件」，侧边栏就出逐步讲解，`Alt+]` / `Alt+[` / `Esc` 操作它。
`Anchor: 显示状态` 可看选区、上次捕获的区间与**当前模型配置**。

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

本仓库自身的代码为 **MIT**。线1 的产物里**打包**了 `pdfjs-dist`（**Apache-2.0**，S7 的 PDF 取件要用），
其许可与署名声明见 [`packages/extension-anchor/THIRD_PARTY_NOTICES.md`](packages/extension-anchor/THIRD_PARTY_NOTICES.md)
（产物里那条 `/*!` 注释是唯一还留着的署名，有断言守着）。

线2 的 PDF 扩展是
[`mathematic-inc/vscode-pdf`](https://github.com/mathematic-inc/vscode-pdf) 的 fork（**Apache-2.0**），
因此那个包整体沿用 Apache-2.0：

- 上游 `LICENSE` 原文逐字保留；上游**没有 `NOTICE` 文件**，所以没有需要一并保留的 NOTICE
  （Apache-2.0 §4(d) 的前提是原作品包含 NOTICE）
- 改动逐条声明在 [`packages/extension-anchor-pdf/MODIFICATIONS.md`](packages/extension-anchor-pdf/MODIFICATIONS.md)，
  含上游 commit SHA（作 diff 基线）
- **已移除上游品牌**：`publisher` / `displayName` 不再使用上游标识，上游的募捐弹窗也已删除
- **不上架 Marketplace**（上游 `CONTRIBUTING.md` 要求先开 Discussion），`.vsix` 只做本地安装
