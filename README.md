# Anchor Explain

跨场景 AI 截图讲解系统。核心命题：

> **截图 = 带地址的锚点，不是像素包。**
> 用户在文档上截取一块区域，系统捕获的不只是像素，而是**带地址的结构化坐标**；
> AI 先尝试讲解，不够时按地址回取上下文，最终输出**带定位的讲解步骤**并逐步高亮流转。

先例工具（Code Explainer / Agent CodeWalk / MCP Walkthrough / Contral）都只能表达
`(文件, 起始行, 结束行)`，**没有一个能表达 PDF 位置** —— 这正是 `Location` 联合类型的价值所在。
调研结论见 `docs/PRIOR-ART.md`。

## 现在能跑什么

**F2 阶段：能装、能编、能测、能起调试宿主，但还没有任何讲解功能。**
下一条可见的能力是 S1（线1 最小可视，用假 AI 跑通真实播放链路）。

## 仓库结构

```
packages/core                  @anchor/core —— 类型契约 / ports / 纯函数（零 vscode 依赖）
packages/extension-anchor      线1 代码编辑器扩展（ID anchor.anchor-explain）
packages/extension-anchor-pdf  线2 PDF 扩展（fork，S4 才落地）
scripts/make-fixture-pdf.mjs   生成 30 页验收样本 PDF
test/fixtures/                 main.c（第 40-48 行是默认选区）+ sample-30p.pdf
docs/                          唯一事实源，见下
```

## 命令

```bash
pnpm install
pnpm fixtures    # 重新生成 test/fixtures/sample-30p.pdf（零依赖，已提交，一般不用跑）
pnpm build       # esbuild 打包扩展，产物落在各自 packages/<包名>/dist/extension.cjs
pnpm watch       # 同上，watch 模式；F5 的 preLaunchTask 用的就是这个
pnpm typecheck   # tsc --noEmit，只做类型检查，不出产物
pnpm test        # node --test 直接跑 .ts（Node 24 类型剥离，无需构建）
pnpm smoke       # 不启动 VS Code，require 打包产物，只对 vscode 模块打桩
pnpm check       # 以上最后四件事串起来：typecheck → test → build → smoke
```

> `pnpm build` 目前只打一个扩展（`esbuild.mjs` 的 `TARGETS` 里只有 `extension-anchor`），
> 线2 的 `extension-anchor-pdf` 到 S4 才加进去。
>
> `pnpm test` 目前也**只覆盖 `@anchor/core`** —— `extension-anchor` 还没有 `test` 脚本，
> 它的行为由 `pnpm smoke` 覆盖（S1 起会给它补真测试）。


按 `F5` 起扩展开发宿主：工作区会自动落到 `test/fixtures/`，命令面板里执行 `Anchor: 显示状态` 应弹出通知。

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
