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

## 怎么跑（第一次：从零到看见荧光笔）

### 0. 前提（只做一次，在仓库根）

```bash
cd C:\Users\29927\Desktop\anchor-explain
pnpm install
pnpm build
```

两条都必须成功。`pnpm build` 的产物 `packages/extension-anchor/dist/extension.cjs` 就是扩展本体 ——
**没有它，扩展载入时会被静默跳过**（VS Code 只会说"没有 main"）。

### 1. 用 **VS Code（桌面版）** 打开**仓库根目录**

必须打开 `C:\Users\29927\Desktop\anchor-explain` **本身**：

```bash
code C:\Users\29927\Desktop\anchor-explain
```

`.vscode/launch.json` 与 `.vscode/tasks.json` 都在这里，F5 只有在这个窗口里才有意义。
第一次打开会问「是否信任此文件夹的作者」，选**信任** —— 不信任的话任务不会跑。

> **ZCode、其他编辑器、或者别的窗口里的 F5 都不是这件事。** 必须是打开了上面那个目录的 VS Code 窗口。

### 2. 起"扩展开发宿主"，二选一

**方式 A：F5**（笔记本键盘可能要 `Fn+F5`）

1. `Ctrl+Shift+D` 打开"运行和调试"面板
2. 顶部配置下拉选 **「Anchor：扩展开发宿主（线1 代码讲解）」**
3. 按 `F5`，或点绿色 ▶
4. （等价路径：`Ctrl+Shift+P` → `Debug: Start Debugging` → 选同名配置）

会**新开一个窗口**，标题带 `[Extension Development Host]`。这个新窗口就是"装了本扩展的 VS Code"。

**方式 B：一条命令，完全不用 F5**

```bash
pnpm devhost
# 等价于：code --extensionDevelopmentPath=packages/extension-anchor test/fixtures
```

它做的事情和方式 A 一样（载入扩展 + 把 `test/fixtures` 当工作区打开），只是不挂断点。
**F5 被别的键占了、笔记本 Fn 键别扭、或者懒得配，就用这条。**
（若按键被别的扩展抢走，可再加 `--disable-extensions` 来一个"只有本扩展"的干净环境。）

### 3. 在**新开的那个窗口**里操作

1. 左侧资源管理器里应该只有两个文件：`main.c`、`sample-30p.pdf`。
   **如果不是**，说明第 2 步的目录参数没生效（那就回到方式 B）。
2. 点开 `main.c`，滚到第 40 行，能看到 `static int rb_pop(ring_buffer_t *rb, int *out)`。
3. 用鼠标选中 40-48 行（**S1 里这一步只影响手感，不影响结果** —— 见下面的说明）。
4. 触发讲解，二选一：
   - **命令面板（最稳）**：`Ctrl+Shift+P` → 输入 `Anchor` → 选 **`Anchor: 捕获选区并讲解`**
   - **快捷键**：`Ctrl+Shift+A`（mac `Cmd+Shift+A`；**焦点必须在编辑器里**，不能停在资源管理器）
5. 应该同时发生三件事：
   - 右边（第 2 列）弹出「**Anchor 讲解**」面板，里面有标题、摘要、3 个步骤
   - 编辑器里第 40-42 行出现**半透明底色**，其中第 40 行是"上下文"、第 42 行是"定义（左侧边线）"
   - 右下角状态栏出现 `$(book) 1/3 · 讲解中 · Alt+] 下一步 · …`
6. **流转**：`Alt+]` / `Alt+[` 前后走；最后一步再按 `Alt+]` → 状态栏变「**已讲完**」；
   **接着按 `Esc`** → 高亮全清、状态栏收起、面板显示「讲解已结束」。

> **所有动作都能从命令面板触发**，键位只是方便。被抢键或键盘不顺手时用命令面板：
> `Anchor: 下一步` / `Anchor: 上一步` / `Anchor: 退出讲解` / `Anchor: 跳到指定步` / `Anchor: 播放或暂停`。

> **S1 的选区是写死的**：不管你在 `main.c` 里选了什么、甚至什么都没选，
> 讲解的一定是**第 40-48 行** —— 那是 `fakeEditorPort` 里写死的一段（S2 才换成你真正的选区）。
> 想看你**实际**选了什么，用命令面板的 `Anchor: 显示状态`，那条走的是真选区。
> **两者不一致是 S1 的正常现象，不是 bug。**

### 4. 看不到反应就查这张表

| 症状 | 原因 | 怎么办 |
|---|---|---|
| 按 F5 没反应，或弹出一个"选择环境"下拉 | 当前窗口不是仓库根目录 / 这个窗口里没有 launch 配置 | 用 `code C:\Users\29927\Desktop\anchor-explain` 重开；或直接用方式 B |
| F5 报「preLaunchTask "anchor: watch" 已终止，退出代码 1」 | 没跑 `pnpm install`（找不到 esbuild），或 `node` 不在 PATH | 在仓库根跑 `pnpm install`；看底部"终端"面板里 `anchor: watch` 的输出 |
| 新窗口里命令面板搜不到 `Anchor:` | 扩展没被载入：产物缺失/损坏 | 在那个新窗口执行 `Developer: Show Running Extensions`，看 `anchor.anchor-explain` 在不在；不在就回仓库根重跑 `pnpm build` 再起一次 |
| 有 `Anchor:` 命令，但 `Ctrl+Shift+A` 没反应 | `when: editorTextFocus` 不满足（焦点在资源管理器/终端），或键被别的扩展抢了 | 先点一下 `main.c` 的编辑区；或改用命令面板；或加 `--disable-extensions` 重起方式 B |
| 面板里有讲解文字，但编辑器里**没有**高亮 | 目标文件路径没解析到 —— 宿主的工作区既不是 `test/fixtures` 也不是仓库根 | 用方式 B 起宿主（它带的目录参数就是对的） |
| 高亮有，但 `main.c` 被挤得看不见 | 面板开在第 2 列 | 拖分栏，或把面板拖到侧边栏 |
| 想重来一次 | 上一次的框还在 | `Esc` 退出，或直接再触发一次讲解（会先收掉上一次） |

### 5. 跑完怎么收

关掉那个带 `[Extension Development Host]` 的窗口即可，它不影响你日常的 VS Code。
`main.c` **一个字节都没被改过** —— 高亮只是 decoration（`pnpm smoke:chain` 会断言这一点）。

## 怎么跑（日常）

```bash
pnpm install          # 在仓库根执行
pnpm build            # 或 pnpm watch，产物落在本包 dist/extension.cjs
pnpm devhost          # 不用 F5，直接起扩展开发宿主（见上）
pnpm check            # 在根执行：typecheck → test → build → smoke → smoke:chain
pnpm test             # 在根执行：core 28 条 + 本包 58 条
pnpm smoke:chain      # 单独的链路冒烟
```

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
