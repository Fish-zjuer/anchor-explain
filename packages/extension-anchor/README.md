# anchor-explain（线1：代码编辑器）

把**当前选区**变成带地址的锚点：AI 讲解 → 校验 → 逐步高亮流转。走 VS Code 原生能力
（`TextEditorDecorationType` + `setDecorations` + `revealRange`），**纯视觉，不修改文件**。

- 扩展 ID：`anchor.anchor-explain`（publisher `anchor`，见 `DECISIONS.md` D27）
- 入口：`src/extension.ts` → 打包产物 `dist/extension.cjs`（CommonJS，宿主的 `require` 不吃 ESM 入口）

## 现在到哪了

**S3：线1 接真实 AI**。八个 + 一个命令全部可用，**链路里已经没有任何替身**：
真选区 → 真适配器 → 真编排循环（带取件）→ 真校验 → 真渲染。

S3 相比 S2 的变化：**讲解内容不再写死了** —— 真的调你配的模型端点，
信息不够时它自己请求额外上下文（最多 `maxFetchRounds` 次），输出过校验闸门才渲染。

代价是**多一步配置**（只做一次）：填 `providers` + 存一把 API Key。见下面的「第 0.5 步」。

| 命令 ID | 命令面板里显示 | 默认键（`when` 见 `package.json`） |
|---|---|---|
| `anchorExplain.capture` | `Anchor: 捕获选区并讲解` | `Ctrl+Shift+A`（`editorTextFocus`） |
| `anchorExplain.next` | `Anchor: 下一步` | `Alt+]` |
| `anchorExplain.prev` | `Anchor: 上一步` | `Alt+[` |
| `anchorExplain.stop` | `Anchor: 退出讲解` | `Esc`（带 `!inputFocus`） |
| `anchorExplain.goto` | `Anchor: 跳到指定步` | `Ctrl+Alt+W` |
| `anchorExplain.playPause` | `Anchor: 播放或暂停` | `Ctrl+Shift+Space` |
| `anchorExplain.explainAnchor` | `Anchor: 讲解外部锚点` | —（跨扩展入口，S6 由线2 调用） |
| `anchorExplain.showState` | `Anchor: 显示状态` | —（自检：选区 / 上次捕获 / **模型配置** / 状态栏） |
| `anchorExplain.setApiKey` | `Anchor: 设置 API Key（存进 SecretStorage）` | —（**S3 新增**） |

mac 上 `Ctrl` 换成 `Cmd`。**默认不绑 `Space`**（那是打字键），键位请自己在
`keybindings.json` 里改；状态栏提示会读你的实际绑定（读不到才回退默认）。

### 模型端点怎么配（§6）

**两种都不用改代码。** 一个 OpenAI 兼容实现覆盖 OpenAI / DeepSeek / 通义 / Ollama，
换厂商只是改 `baseUrl` 与模型名。

```jsonc
// settings.json
{
  "anchorExplain.providers": {
    "default": { "baseUrl": "https://api.deepseek.com/v1", "tier1Model": "deepseek-chat" }
  },
  "anchorExplain.activeProvider": "default",
  "anchorExplain.maxFetchRounds": 3
}
```

再用命令 **`Anchor: 设置 API Key`** 把 key 存进 `SecretStorage`
（**不进 settings.json**，因此不会被同步、被截图、被提交）。
你也可以把 `apiKey` 直接写在 `providers.default` 里 —— 那是明文，仅当你确实想"一个文件管全部"时用。

配好之后用 `Anchor: 显示状态` 核对一句：
`模型：default：deepseek-chat @ https://api.deepseek.com/v1；最多取件 3 次`。

**想看 AI 到底取了几次件、被拒的理由是什么** → 输出面板选「**Anchor**」通道。

## 源码入口表

| 文件 | 职责 |
|---|---|
| `src/extension.ts` | activate → `registerCommands`，入口保持极薄 |
| `src/commands.ts` | §4.1 九个命令 + 四层装配 + 捕获确认（§4.1.1）+ 取件日志落 OutputChannel。**这里已经没有任何替身** |
| `src/adapters/CodeAdapter.ts` | 代码来源适配器：`capture(scope?)` 把「选区 / 整文件」变成 `Anchor`；`fetchContext` 按行取件（带行号）。**零 vscode 依赖** |
| `src/orchestrator/Orchestrator.ts` | 编排循环：取件（≤maxFetchRounds）→ §3.3 闸门 → repair 一次。**它就是 S1/S2 那个 `fakeProvider` 的真身** |
| `src/orchestrator/validateContextRequest.ts` | §3.2 五条规则的实现 —— **模型不许漫游的唯一闸门** |
| `src/orchestrator/validateExplanation.ts` | §3.3 输出校验闸门 —— **AI 输出不可信的唯一入口** |
| `src/orchestrator/ModelRouter.ts` | tier1/tier2 成本分层（默认便宜档，需要看图才升级） |
| `src/orchestrator/toolSchema.ts` | §8 的工具定义 + tool_call 参数解析 |
| `src/orchestrator/providers/{types,openAICompatible}.ts` | LLM 调用面的抽象 + OpenAI 兼容实现（`fetchImpl` 可注入，所以编排逻辑能离线全量测） |
| `src/prompts/index.ts` | system / user / repair 三段指令 + 输出契约（**prompt 是产品的一部分**） |
| `src/config.ts` | §6 配置的**纯映射**（vscode-free，可单测） |
| `src/vscode/configSource.ts` | 设置 + `SecretStorage` 的读取侧，以及存 key 的服务端 |
| `src/protocol.ts` | §5 消息协议 + 两处边界守卫（webview 来的、其他扩展来的） |
| `src/paths.ts` | 路径归一/比较/显示名/行数（四条链路共用，vscode-free） |
| `src/playback/WalkthroughSession.ts` | 会话状态机（拍游标/播放/staleness，vscode-free） |
| `src/playback/decorationPlan.ts` | 「这一拍该画哪些框」的纯决策（vscode-free） |
| `src/playback/CodeWalkthroughPlayer.ts` | decoration 渲染 + `revealRange(InCenter)`；只读不写文档 |
| `src/sidebar/SidebarPanel.ts` | 侧边栏宿主侧：建面板 / 发消息 / 收消息 / 重放 |
| `src/sidebar/statusBar.ts` | 状态栏提示（键位读用户实际绑定、staleness 提示） |
| `src/sidebar/keybindingResolve.ts` | 键位表 + JSONC 解析 + 显示格式化（vscode-free） |
| `src/sidebar/ui/{styles,clientScript,html}.ts` | 侧边栏 webview 资源，**内联进产物**；客户端脚本不参与类型检查 |
| `src/vscode/ports/editorPort.ts` | §2 `EditorPort` 真实现（五个方法全部是真的，没有覆盖层） |
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

### 0.5 配模型端点（S3 起必需，只做一次）

不配的话按 `Ctrl+Shift+A` 会明确告诉你「没有可用的 provider」——不会静默什么都不发生。

1. 命令面板 → **`Anchor: 设置 API Key`** → 选 `default` → 粘贴 key
   （存进 `SecretStorage`，**不进 settings.json**）
2. 打开设置（`Ctrl+,`）搜 `anchorExplain.providers`，点「在 settings.json 中编辑」，填：

```jsonc
"anchorExplain.providers": {
  "default": { "baseUrl": "https://api.deepseek.com/v1", "tier1Model": "deepseek-chat" }
}
```

`baseUrl` 与模型名按你用的服务填。**一个 OpenAI 兼容实现覆盖 OpenAI / DeepSeek / 通义 / Ollama。**

3. 核对：命令面板 → `Anchor: 显示状态` → 应看到
   `模型：default：deepseek-chat @ https://api.deepseek.com/v1；最多取件 3 次`

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
3. 用鼠标**选中 40-48 行**（S2 起这一步**决定讲什么** —— 选别的会讲别的）。
4. 触发讲解，二选一：
   - **命令面板（最稳）**：`Ctrl+Shift+P` → 输入 `Anchor` → 选 **`Anchor: 捕获选区并讲解`**
   - **快捷键**：`Ctrl+Shift+A`（mac `Cmd+Shift+A`；**焦点必须在编辑器里**，不能停在资源管理器）
5. **先出现确认框**（S2 新增）：面板顶部弹一个 QuickPick，两项 ——
   「**讲解这段** · 第 40-48 行」与「**讲解整个文件** · 共 N 行」。
   选第一项（想试整份就选第二项；按 Esc 则什么也不做）。
6. 确认后同时发生三件事：
   - 右边（第 2 列）弹出「**Anchor 讲解**」面板，里面有标题、摘要、3 个步骤
   - 编辑器里第 40-42 行出现**均匀的浅色底色**，此刻**还没有任何一行被单独点亮**
   - 右下角状态栏出现 `$(book) 1/3 步 · 整块 · 讲解中 · Alt+] 下一步 · …`
7. **逐点扫描**（这是"讲得细"的部分）：
   - `Alt+]` → 第 40 行亮起「上下文」，块级底色不变，面板里对应的那行出现 `▸` 与
     「第 1/2 个逻辑点」徽章
   - 再 `Alt+]` → 40 行灭、第 42 行亮起「定义」
   - **任何一拍都只有一行亮色** —— 这样块看起来才是"一整块"而不是花斑
   - 扫完两个点才进第 2 步（44-45）
   - 觉得一下一下按太慢：`Ctrl+Shift+Space` 播放，荧光会自己在块内扫过去
8. 走到最后一步的**最后一拍**再按一次 `Alt+]` → 状态栏变「**已讲完**」，
   **接着按 `Esc`** → 高亮全清、状态栏收起、面板显示「讲解已结束」。

**想确认"到底讲了哪一段"**：命令面板 → `Anchor: 显示状态`，看其中一项
「上次捕获：main.c 第 40-48 行（选区）」或「… 第 1-N 行（整个文件）」。

**没有选中内容时**（只放了光标）按 `Ctrl+Shift+A`：不会弹二选一，而是提示
「只放了光标，没有选中内容。」+ 一个「讲解整个文件」按钮。**没有打开文件**时是另一句提示
「先打开一个文件，再选中要讲解的代码。」—— 这两句是分开的，因为要你做的事不一样。

> **所有动作都能从命令面板触发**，键位只是方便。被抢键或键盘不顺手时用命令面板：
> `Anchor: 下一步` / `Anchor: 上一步` / `Anchor: 退出讲解` / `Anchor: 跳到指定步` / `Anchor: 播放或暂停`。

### 卡住了怎么退出来

**三条路都可用**，记住任意一条就行：

1. `Esc` —— 但**焦点必须在编辑器或侧边栏面板里**。如果焦点停在底部**终端**面板，Esc 会进
   PowerShell 而不是触发命令，看起来就像"没反应"。**先点一下编辑区再按 Esc。**
2. 侧边栏面板左下角的「**退出**」按钮（点一下就清）
3. 命令面板 → `Anchor: 退出讲解`

> **高亮可能落在与你所选不同的行** —— 这是**模型质量问题，不是接线问题**：
> 现在 location 由 AI 自己决定。它给出的区间如果越出文件范围，§3.3 会判掉并让它重试一次；
> 但"区间合法却讲错了地方"是判不出来的（那要靠更好的 prompt 或更强的模型）。
> 想看它有没有取件、取件被拒的理由 → 输出面板选「Anchor」通道。

> **看不到状态栏提示？** 命令面板执行 `Anchor: 显示状态`，它会报出状态栏项此刻是否显示、
> 文本是什么 —— 用来分辨"提示没显示"（我的问题）和"显示了但没找到"（落点问题）。

### 4. 看不到反应就查这张表

| 症状 | 原因 | 怎么办 |
|---|---|---|
| 按 F5 没反应，或弹出一个"选择环境"下拉 | 当前窗口不是仓库根目录 / 这个窗口里没有 launch 配置 | 用 `code C:\Users\29927\Desktop\anchor-explain` 重开；或直接用方式 B |
| F5 报「preLaunchTask "anchor: watch" 已终止，退出代码 1」 | 没跑 `pnpm install`（找不到 esbuild），或 `node` 不在 PATH | 在仓库根跑 `pnpm install`；看底部"终端"面板里 `anchor: watch` 的输出 |
| 新窗口里命令面板搜不到 `Anchor:` | 扩展没被载入：产物缺失/损坏 | 在那个新窗口执行 `Developer: Show Running Extensions`，看 `anchor.anchor-explain` 在不在；不在就回仓库根重跑 `pnpm build` 再起一次 |
| 有 `Anchor:` 命令，但 `Ctrl+Shift+A` 没反应 | `when: editorTextFocus` 不满足（焦点在资源管理器/终端），或键被别的扩展抢了 | 先点一下 `main.c` 的编辑区；或改用命令面板；或加 `--disable-extensions` 重起方式 B |
| 按 `Esc` 没反应、高亮清不掉 | 焦点在终端/别的输入框里，Esc 到不了命令 | 先点一下编区或侧边栏面板；或点面板里的「退出」；或命令面板 `Anchor: 退出讲解` |
| 弹了「只放了光标，没有选中内容」 | 这就是 S2 的行为：没选区不猜，问你要不要讲整份 | 点「讲解整个文件」，或先选中一段再按一次 |
| 确认框里写的行区间不是我选的 | 选区在弹框之前被改了（点了别处） | 重选一次；`Anchor: 显示状态` 的「上次捕获」是权威值 |
| 弹了「Anchor：没有可用的 provider（activeProvider = …）」 | 还没配模型端点，或 `baseUrl`/`tier1Model` 有一个没填 | 照上面「第 0.5 步」配一遍；`Anchor: 显示状态` 会报当前读到的是什么 |
| 弹了「连不上 https://…」 | `baseUrl` 写错，或网络/代理不通 | 核对地址（要带 `/v1` 这类前缀，但不带 `/chat/completions`） |
| 弹了「模型端点返回 401 / invalid api key」 | key 没存、存错了 provider、或已过期 | 重跑 `Anchor: 设置 API Key`（选对 provider id） |
| 弹了「AI 输出未通过校验（重试一次后仍失败）」 | 模型没按 JSON 契约回话 | 换一个更强的 `tier1Model` 试试；具体哪条不合规会写在错误里 |
| 弹了「取件 N 次之后模型仍未给出讲解」 | 模型一直在要上下文不肯作答 | 调大 `anchorExplain.maxFetchRounds`，或换模型 |
| 高亮位置不对 | 模型自己选的 location，可能选歪 | 不是接线问题（越界会被判掉，选歪判不出来）。输出面板「Anchor」能看到它取过什么 |
| 面板里有讲解文字，但编辑器里**没有**高亮 | 目标文件路径没解析到 —— 宿主的工作区既不是 `test/fixtures` 也不是仓库根 | 用方式 B 起宿主（它带的目录参数就是对的） |
| 找不到状态栏提示 | 未定论 | 运行 `Anchor: 显示状态`，它会报出状态栏项是否显示、文本是什么 |
| 高亮有，但 `main.c` 被挤得看不见 | 面板开在第 2 列 | 拖分栏，或把面板拖到侧边栏 |
| 想重来一次 | 上一次的框还在 | 触发一次新讲解即可（会先收掉上一次） |

### 5. 跑完怎么收

关掉那个带 `[Extension Development Host]` 的窗口即可，它不影响你日常的 VS Code。
`main.c` **一个字节都没被改过** —— 高亮只是 decoration（`pnpm smoke:chain` 会断言这一点）。

## 怎么跑（日常）

```bash
pnpm install          # 在仓库根执行
pnpm build            # 或 pnpm watch，产物落在本包 dist/extension.cjs
pnpm devhost          # 不用 F5，直接起扩展开发宿主（会先 build，见上）
pnpm preview:sidebar  # 起本地服务看侧边栏排版：不用 VS Code，改 UI 时先自己看一眼（D50）
pnpm check            # 在根执行：typecheck → test → build → smoke → smoke:chain
pnpm test             # 在根执行：core 28 条 + 本包 113 条
pnpm smoke:chain      # 单独的链路冒烟
```

> **改侧边栏排版先跑 `pnpm preview:sidebar`**：它把**真实生成**的 HTML 落到 `.tmp-preview/`
> 并起一个只读服务，浏览器打开就能看。排版的取舍只能靠眼睛判，而这个办法不用起 VS Code ——
> 改完先自己看一眼，比让你按一次 F5 便宜得多。它**不验交互**（按钮、按键仍要靠 F5）。

## 测试分三层

| 层 | 命令 | 覆盖什么 |
|---|---|---|
| 单测（113 条，vscode-free） | `pnpm test` | 校验闸门（§3.3）、取件闸门（§3.2）、编排循环（取件/拒绝/repair/上限）、端点请求映射、配置映射、会话状态机、配色决策、键位解析 |
| 产物冒烟（30 项） | `pnpm smoke` | 产物能 `require`；**声明的命令 == 注册的命令**；webview 资源在产物里；**两个替身都已从产物退出** |
| 链路冒烟（105 项） | `pnpm smoke:chain` | `capture` 从真选区跑到 decoration：**跑真编排循环**（只有 `fetch` 是桩）、取件一轮、越界被拒后仍继续、上限收场、确定行数与配色、**文件字节未变** |

这三层都只对**最外层边界**（`vscode` 模块）打桩，桩之外全是真代码。
它们**都不替代 F5**：配色好不好看、流转顺不顺，只有肉眼看才算数。

## 边界

- 不 import `core/` 之外的内部实现；四层（命令 / 适配器 / 编排 / 渲染）之间只经 `@anchor/core` 通信
- 不改用户文件：高亮一律是 decoration，不是编辑（链路冒烟会断言 `applyEdit` 从未被调用）
- 命令的 `title` **只写动作**（如 `显示状态`），分类由 `category: "Anchor"` 提供，
  面板里显示成 `Anchor: 显示状态`。别在 `title` 里再写一遍 `Anchor:`，会重复
