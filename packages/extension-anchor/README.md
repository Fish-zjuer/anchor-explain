# anchor-explain（线1：代码编辑器）

把**当前选区**变成带地址的锚点：AI 讲解 → 校验 → 逐步高亮流转。走 VS Code 原生能力
（`TextEditorDecorationType` + `setDecorations` + `revealRange`），**纯视觉，不修改文件**。

- 扩展 ID：`anchor.anchor-explain`（publisher `anchor`，见 `DECISIONS.md` D27）
- 入口：`src/extension.ts` → 打包产物 `dist/extension.cjs`（CommonJS，宿主的 `require` 不吃 ESM 入口）

## 现在到哪了

**S1：线1 最小可视**。八个命令全部可用，链路是真的（校验 → 会话 → decoration → 侧边栏 → 状态栏），
**只有"AI 从哪来"与"选区从哪来"两处是替身**（见下）。

| 命令 ID | 命令面板里显示 | 默认键（`when` 见 `package.json`） |
|---|---|---|
| `anchorExplain.capture` | `Anchor: 捕获选区并讲解` | `Ctrl+Shift+A`（`editorTextFocus`） |
| `anchorExplain.next` | `Anchor: 下一步` | `Alt+]` |
| `anchorExplain.prev` | `Anchor: 上一步` | `Alt+[` |
| `anchorExplain.stop` | `Anchor: 退出讲解` | `Esc`（带 `!inputFocus`） |
| `anchorExplain.goto` | `Anchor: 跳到指定步` | `Ctrl+Alt+W` |
| `anchorExplain.playPause` | `Anchor: 播放或暂停` | `Ctrl+Shift+Space` |
| `anchorExplain.explainAnchor` | `Anchor: 讲解外部锚点` | —（跨扩展入口，S6 由线2 调用） |
| `anchorExplain.showState` | `Anchor: 显示状态` | —（骨架自检） |

mac 上 `Ctrl` 换成 `Cmd`。**默认不绑 `Space`**（那是打字键），键位请自己在
`keybindings.json` 里改；状态栏提示会读你的实际绑定（读不到才回退默认）。

### 两个替身在哪（S2 / S3 各自只改一行）

`src/commands.ts` 里 `registerCommands()` 的开头：

```ts
// ★ S2 接线点（唯一）：删掉下面两行里对 getSelection 的覆盖，真选区即刻生效。
const fakeSelection = createFakeEditorPort({ filePath: resolveS1FixturePath() });
const editorPort: EditorPort = { ...realEditorPort, getSelection: () => fakeSelection.getSelection() };

// ★ S3 接线点（唯一）：换成 orchestrator 循环（真实 AI + fetch_context 取件）。
const provider: ExplainProvider = fakeProvider;
```

配套的 S1 脚手架是文件末尾的 `resolveS1FixturePath()`（**S2 一并删除**）：把假选区里那个
仓库相对路径落到 F5 工作区里的真文件上，好让"文档总行数"取自真实文件。

## 源码入口表

| 文件 | 职责 |
|---|---|
| `src/extension.ts` | activate → `registerCommands`，入口保持极薄 |
| `src/commands.ts` | §4.1 全部命令 + 四层装配 + **唯一的假货接线点** |
| `src/protocol.ts` | §5 消息协议 + 两处边界守卫（webview 来的、其他扩展来的） |
| `src/paths.ts` | 路径归一/比较/行数（四条链路共用，vscode-free） |
| `src/orchestrator/validateExplanation.ts` | §3.3 输出校验闸门 —— **AI 输出不可信的唯一入口** |
| `src/playback/WalkthroughSession.ts` | 会话状态机（下标/播放/staleness，vscode-free） |
| `src/playback/decorationPlan.ts` | 「一个 step 该画哪些框」的纯决策（vscode-free） |
| `src/playback/CodeWalkthroughPlayer.ts` | decoration 渲染 + `revealRange(InCenter)`；只读不写文档 |
| `src/sidebar/SidebarPanel.ts` | 侧边栏宿主侧：建面板 / 发消息 / 收消息 / 重放 |
| `src/sidebar/statusBar.ts` | 状态栏提示（键位读用户实际绑定、staleness 提示） |
| `src/sidebar/keybindingResolve.ts` | 键位表 + JSONC 解析 + 显示格式化（vscode-free） |
| `src/sidebar/ui/{styles,clientScript,html}.ts` | 侧边栏 webview 资源，**内联进产物**；客户端脚本不参与类型检查 |
| `src/vscode/ports/editorPort.ts` | §2 `EditorPort` 真实现（`getSelection` 当前被替身顶掉） |
| `src/vscode/ports/fileSystemPort.ts` | §2 `FileSystemPort` 真实现 + `countLines` |

## 怎么跑

```bash
pnpm install          # 在仓库根执行
pnpm build            # 或 pnpm watch，产物落在本包 dist/extension.cjs
pnpm check            # 在根执行：typecheck → test → build → smoke → smoke:chain
pnpm test             # 在根执行：core 28 条 + 本包 54 条
pnpm smoke:chain      # 单独的链路冒烟（见下）
```

在仓库根按 `F5`：`.vscode/launch.json` 会起扩展开发宿主，`preLaunchTask` 自动跑 `pnpm watch`，
并且**默认把 `test/fixtures/` 当工作区打开**（里面就是 `main.c`）。
打开 `main.c`、随便选中几行、按 `Ctrl+Shift+A`（mac 是 `Cmd+Shift+A`）。

## 测试分三层

| 层 | 命令 | 覆盖什么 |
|---|---|---|
| 单测（54 条，vscode-free） | `pnpm test` | 校验闸门、会话状态机、配色决策、键位解析、两处守卫 |
| 产物冒烟 | `pnpm smoke` | 产物能 `require`；**声明的命令 == 注册的命令**；webview 资源在产物里 |
| 链路冒烟 | `pnpm smoke:chain` | `capture` 从选区跑到 decoration：画在哪几行、哪一档配色、退出清干净、**文件字节未变** |

这三层都只对**最外层边界**（`vscode` 模块）打桩，桩之外全是真代码。
它们**都不替代 F5**：配色好不好看、流转顺不顺，只有肉眼看才算数。

## 边界

- 不 import `core/` 之外的内部实现；四层（命令 / 适配器 / 编排 / 渲染）之间只经 `@anchor/core` 通信
- 不改用户文件：高亮一律是 decoration，不是编辑（链路冒烟会断言 `applyEdit` 从未被调用）
- 命令的 `title` **只写动作**（如 `显示状态`），分类由 `category: "Anchor"` 提供，
  面板里显示成 `Anchor: 显示状态`。别在 `title` 里再写一遍 `Anchor:`，会重复
