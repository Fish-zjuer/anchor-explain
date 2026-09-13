# PRIOR-ART.md — 先例研究（已核实事实）

> 为什么这份文档存在：这些事实**重新获取代价最高**（需要联网、翻 npm 包、读源码声明），
> 一旦被上下文压缩掉就得重来。所以一次性写全，并附"如何重新核实"的 URL。
>
> **置信度标注**：`【源码核实】`= 我亲自读过源码声明；`【官方文档】`= 来自项目 README/官网；`【搜索摘要】`= 来自搜索结果，未逐一核证。

---

## 结论先行

**这四个工具全都只能高亮"代码行"。** 它们的位置模型是 `(file, line, endLine)`，MCP Walkthrough 仅额外有可选的 `startChar`/`endChar` 到字符精度。

**没有一个能表达 PDF 位置**——PDF 没有行号，"第 23 页那个矩形"它们无从表达；网页的 `url + selector` 同样表达不了。

因此我们规范里的 `Location` 联合类型（`PDFLocation{page,bbox}` / `WebLocation` / `CodeLocation`）**不是重复造轮子，而是这批先例都没覆盖的寻址层**。它们能给的是**交互与渲染约定**（两层 step、teleprompter 节奏、键位惯例、`.walkthrough.json` 可分享回放），给不了寻址。**这个分工正是我们该用的方式。**

---

## 1. MCP Walkthrough

- 仓库：https://github.com/stefan-nitu/mcp-walkthrough
- npm：`mcp-walkthrough@0.4.0`（https://www.npmjs.com/package/mcp-walkthrough）
- 形态：MCP server + 配套 VS Code 扩展（扩展以预编译 `.vsix` 形式放在 npm 包里：`/vscode-extension/walkthrough-bridge.vsix`）`【源码核实】`

### 1.1 两层 step 模型（最重要，直接采用）

`【源码核实】` 来自 `mcp-walkthrough@0.4.0/dist/bridge.d.ts`：

```ts
interface WalkthroughHighlight {
  line: number;
  endLine?: number;
  narration: string;
}

interface WalkthroughStep {
  file: string;
  line: number;
  endLine?: number;
  explanation?: string;
  title?: string;
  highlights?: WalkthroughHighlight[];
}
```

语义：step 有主定位（`file` + `line`/`endLine`），`explanation` 是步级引入语，内部再挂一串**子高亮**，`narration` 绑在子高亮上。

我们原先的 `WalkthroughStep { location, text, color }` **只等于它的子高亮层**，缺了步级 `title`/`explanation` 和子高亮数组。已在 `CONTRACTS.md` §1.2 以**加法扩展**方式对齐（原三个字段语义不变）。

### 1.2 Teleprompter 节奏

`【官方文档】` step 的 `explanation` 先在气泡里渲染并朗读；随后**每个子高亮的 `narration` 逐个以粗体追加**，同时选区移动到对应行；最后一个子高亮结束后**取消粗体**并显示导航控件。

→ 这是我们要在 S1 之后复刻的"荧光笔流转"节奏。

### 1.3 工具面

`【官方文档】` 5 个工具：`walkthrough`（单一入口，涵盖单步/多步/导航/清除/状态）、`show_code`、`settings`、`walkthrough_voice_selection`、`get_selection`。

`【源码核实】` bridge 导出函数：`openFile` / `showHighlight` / `showExplanation` / `clearExplanations` / `startWalkthrough` / `navigateWalkthrough` / `getWalkthroughStatus` / `getSelection`。

`startWalkthrough(steps, autoplay?, delayMs?)`；`navigateWalkthrough(action, step?)`，动作含 `next` / `prev` / `goto` / `stop` / `pause` / `resume`；`goto` 的 `step` 是 **0-based index**。

→ 我们原计划的导航面只有 next/prev/ESC，偏窄；已在 `CONTRACTS.md` §4.1 补齐 `goto` / `playPause`。

### 1.4 传输与架构分工

`【源码核实】` 传输是**本地 socket**：`bridge.d.ts` 导出 `_setSocketPath(path: string)`，并有 `bridgeAvailable` / `checkBridge()` / `isBridgeAvailable()` / `resetBridgeState()` 这组**健康检查**模式。

`【搜索摘要，与源码有冲突】` 有来源称走 HTTP `localhost:7890` 并带 bearer token；**以源码为准，是 socket**。

架构分工：**扩展是哑渲染器，状态与驱动全在 server 侧。** 与我们"webview/编辑器负责显示、编排层负责决策"的分工一致。

### 1.5 键位惯例

`【官方文档】` `Cmd+Shift+→` 下一步、`Cmd+Shift+←` 上一步、`Cmd+Shift+↓` 停止。

---

## 2. Agent CodeWalk

- 仓库：https://github.com/andylin-hao/agent-codewalk
- Marketplace：https://marketplace.visualstudio.com/items?itemName=agent-codewalk.agent-codewalk
- 形态：Marketplace 扩展 + Rust 本地伴随进程（`【官方文档】` 通过标准输入输出与 agent 通信，**不开监听端口**），与编辑器共享一个数据目录来交换设置与会话。

### 2.1 值得直接采用的三个设计

**① 覆盖度校验** `【官方文档】`
> 普通改动 walkthrough：本地伴随进程**拒绝发布**，直到"每一个文本 diff hunk 都被至少一个 step 覆盖"。
> 解释型 walkthrough（无 Git 基线）：要求"每一个 step 都必须指向当前代码"。

→ 我们把第二种（"每步必须指向当前代码"）简化后纳入了 `CONTRACTS.md` §3.3 的边界校验；第一种（diff hunk 覆盖）**用户已砍掉**（`DECISIONS.md` D16）。

**② 代码哈希 + 失效标记** `【官方文档】`
> 存储的是"paths、explanations、line ranges、code hashes，以及每步最多 4000 字符的被替换文本"——**不复制整个源文件**。
> 代码移动时**只有当唯一哈希匹中才重定位**；否则把该步报告为 stale。

→ 我们在 `WalkthroughSession` 里做轻量版：存所高亮行的内容哈希，讲解期间文件若被改则标记该步失效，**而不是高亮错行**。成本极低，避免一个很糟的失败模式。

**③ 块级语义分类** `【官方文档】`
> 区分 **added / modified / deleted / renamed / contextual** 五类块，contextual 用更安静的中性高亮；主题感知；有替换文本时提供 before/after 对比；文件被整体删除时该步无可高亮目标，解释保留但目标标记为不可用。

→ 对应我们的 `HighlightEmphasis`（`primary` / `context` / `definition` / `caveat`）＋ `WalkthroughStep.color`。**用语义色而非裸颜色**更有用。

### 2.2 键位惯例

`【官方文档】`

| 动作 | 键 | 命令 |
|---|---|---|
| 下一步 | `Alt+]` | Next Step |
| 上一步 | `Alt+[` | Previous Step |
| 切换图/文件视图 | `Alt+\` | Switch Views |
| 跳到任意步 | `Ctrl+Alt+W` / `Cmd+Alt+W` | Jump to Step |

→ 我们采用 `Alt+]` / `Alt+[` 作默认，`Ctrl+Alt+W` 作 goto（`CONTRACTS.md` §4.1）。

### 2.3 工具面

`【官方文档】` 改动讲解：`begin_task` → `publish_walkthrough`；解释讲解：`publish_explanation`。

### 2.4 UI 面

`【官方文档】` CodeLens、状态栏、Activity Bar、Secondary Side Bar；图视图（含依赖泳道）与文件视图两种呈现。**README 未点名 decorations API**，只说"打开源文件并高亮该块"。

---

## 3. Code Explainer

- 仓库：https://github.com/Royal-lobster/code-explainer
- 形态：**coding agent skill**（不是传统 VS Code 插件）+ 一个 `.vsix`（VS Code + Cursor）+ 本地 TTS。

### 3.1 事实

`【官方文档】`

- 安装方式：让 agent 执行 `Install the code explainer skill from https://github.com/Royal-lobster/code-explainer`；`setup.sh` 负责 Python venv + TTS 引擎（`mlx-audio` + `sounddevice`）、构建安装 `.vsix`、**下载约 330MB 语音模型**、脚本权限。
- 高亮粒度：**1–8 行的范围，每个高亮带自己的解释**。→ 很好的粒度预算，值得写进我们的 system prompt（"高亮跨度控制在 1~8 行当量的小范围"）。
- 三种模式：`Walkthrough`（侧边栏 + TTS 自动播放）、`Read`（终端文本逐步，无需侧边栏/TTS）、`Podcast`（合成单个音频文件）。
- 落盘：`.walkthroughs/` 于工作区根、**用相对路径**，可 `save` / `load` / `list`，命令面板有 Save/Load；可提交进仓库分享给队友。
- 模型分层（`【搜索摘要】`）：LARGE(opus) 做 Deep Dive planner、MEDIUM(sonnet) 做分段 agent、SMALL(haiku) 做 Scout/Overview —— 与我们 `ModelRouter` 的成本分层思路一致。
- 常见错误（`【搜索摘要】`）：`ttsText` 缺失或含 markdown。

### 3.2 内部组件名（仅列名，README 未给形状）

`【官方文档】` `server.ts`、`sidebar.ts`、`walkthrough.ts`、`highlight.ts`、`tts-bridge.ts`、`storage.ts`、`types.ts`（标注为"Message protocol types"）。
另提到一个 **localhost 上的 HTTP + WebSocket 服务器，带 bearer token 认证**，端点覆盖 plan 下发、状态查询、save/load、以及**长轮询用户动作**。

### 3.3 为什么不抄

- **TTS**：用户未要求；且其 TTS 依赖 **macOS + Apple Silicon 的 GPU 加速**，**Windows 上语音功能可能不可用**。我们是 Windows，330MB 模型纯属累赘。（`DECISIONS.md` D15）
- **HTTP + WebSocket + bearer token**：单机单进程场景是过度设计。
- `Podcast` / `Read` 模式：超出范围。

---

## 4. Contral（闭源，仅作产品设计参考）

- 官网：https://contral.ai/extension ；Marketplace（publisher `contral.contral`，v0.0.1）；Open VSX `contral/contral`
- `【官方文档】` 定位"the teaching layer for any AI coding agent"；多编辑器通用（VS Code / Cursor / Windsurf / Antigravity / Kilo Code / VSCodium），终端 agent 用 `npx @contral/claude-code-hook install` 对接。
- **无源码可得**（闭源），因此只记录产品设计要点：
  - **Auto-teach on every AI edit**：AI 改完几秒内出 streaming 讲解卡，多文件改动按文件逐个串讲
  - **Codebase tours**：指向任意 repo 扫描生成学习路径，附文件引用
  - **Selection / file teaching**：右键 "Teach me this selection" → streaming 解释卡 + **逐行高亮** + 卡内 Ask Tutor 追问；**点击某一行，解释跳到对应位置**
  - **Defense Mode**：AI 写完暂停流程，要求用户解释代码含义才能 ship
  - **Learn Mode**：49+ 主题 Java 课程，带 hint 经济、前置锁、项目评分
  - **BYOK**：自带 Anthropic/OpenAI key，**key 存 OS keychain**；遥测可选关
  - 定价：免费档 + Pro 约 $9.99/月（年付）
- **对我们的启示**：Contral 验证了"教学层可以独立于编码 agent 存在"。它的 **"selection teaching + 点击行跳转解释"就是代码场景下的"截图 + 定位 + 讲解"**，只是触发方式是**选中**而非截图——与我们线1 的形态高度一致，而且**证明这条路有付费意愿**。
- `【搜索摘要，注意甄别】` 存在另一个名字相近的产品 **Contorium**（contorium.dev，跨会话保持工作区状态的 runtime continuity layer），与 Contral 无关。

---

## 5. fork base：`mathematic-inc/vscode-pdf`（已核实）

`【源码核实】` 来自其 `package.json`（https://raw.githubusercontent.com/mathematic-inc/vscode-pdf/main/package.json）：

| 项 | 值 |
|---|---|
| `name` / `publisher` / `version` | `vscode-pdf` / `mathematic` / `0.2.5` |
| `license` | **`Apache-2.0`** |
| `main` | `./dist/extension.js` |
| 构建 | **`tsup`**；`package` = `check:pdfjs && tsup --minify` |
| 包管理 | pnpm（脚本里用 `pnpm run`） |
| `engines.vscode` | **`^1.134.0`** |
| devDeps | `@types/node 26.4.0`、`@types/vscode 1.134.0`、`@vscode/vsce ^3.9.2`、`oxfmt ^0.65.0`、`oxlint ^1.80.0`、`tsup ^8.5.1`、`typescript ^7.0.2` |
| runtime deps | **无 `dependencies` 字段** —— pdf.js 不走 npm 依赖 |
| `contributes.customEditors` | `viewType: "pdf.view"`，`displayName: "PDF View"`，selector `*.pdf`，**无 `priority`**（等于默认 PDF 打开器） |
| `contributes.configuration` | `pdf.defaultZoomValue`（`auto`/`page-actual`/`page-fit`/`page-width`/`50`~`200`）、`pdf.sidebarViewOnLoad`（`-1`~`4`） |

### 5.1 pdf.js 是 vendored + 打补丁的（决定 fork 策略）

`【官方文档】` README 说明：改 `pdfjs_version.txt` → 跑 `tools/prepare_pdfjs.sh`，脚本下载目标版本并**应用 `patches/` 里的补丁**，落到 `assets/pdf.js/`；冲突会留 `.rej` 文件需手工解决；`--update-patches` 可基于当前版本生成新补丁；脚本不提交，需手工提交。

→ 结论：**这个扩展的 webview 就是打了补丁的完整 pdf.js viewer。** 因此框选 overlay **要"注入"不要"打补丁"**——由扩展宿主在运行时注入脚本，**完全不碰 `assets/pdf.js/`**，fork 的 diff 缩到几个新增文件，上游仍可同步。（`DECISIONS.md` D9）

### 5.2 两处矛盾 / 待验证

1. **VS Code 版本**：README 说"需要 VS Code **1.95** 或以上"，但 `package.json` 的 `engines.vscode` 是 **`^1.134.0`**。**以 package.json 为准。** → S4 开工前必须测 `code --version`；不够高则改 fork 旧 tag 或换 `tomoki1207/vscode-pdf`。
2. **viewer DOM 是否暴露 `data-page-number` 与 `window.PDFViewerApplication`**：注入式方案依赖这两点。**S5 开工前必须读一遍 fork 的 webview 代码或实际打开 PDF 用 DevTools 确认。** 若不暴露，回退到走 `patches/` 打补丁。
3. README 定位：**"只提供查看能力，不多做"**（"provide only viewing capabilities. Nothing more."）——所以我们的框选是对上游定位的**有意扩展**，需在 `MODIFICATIONS.md` 写明。
4. 上游 `CONTRIBUTING.md`：**要先开 Discussion，不接受直接提 PR**。→ 我们只做本地 fork，**不向 Marketplace 发布**。

### 5.3 已核实的仓库路径线索

`pdfjs_version.txt`、`tools/prepare_pdfjs.sh`、`patches/`、`assets/pdf.js/`、`CONTRIBUTING.md`、`tools/check_pdfjs.mjs`。
另：`tomoki1207/vscode-pdf` 的默认分支**不是 `main`**（`main` 路径返回 404）。

---

## 6. 打包与部署体验（两个先例的共同做法，已采用）

`【源码核实/官方文档】`
- MCP Walkthrough：npm 包里带预编译 `.vsix`，并有 `scripts/postinstall.cjs` 在 `npm install` 时自动调 `code --install-extension` 安装配套扩展。
- Code Explainer：`setup.sh` 构建并安装 `.vsix`（VS Code + Cursor），然后提示 `Developer: Reload Window`。

→ **部署体验是这个品类被评估的一部分**（用户原话的评估维度就是"部署难度"）。因此我们必须产出 `.vsix`，让用户一条命令装上，而不是手工按 F5。（`DECISIONS.md` D1/D26）

---

## 7. 我们采用 / 不采用清单

| 采用 | 来源 | 落在哪 |
|---|---|---|
| 两层 step 模型（`highlights[]` + 步级 intro） | MCP Walkthrough `【源码核实】` | `CONTRACTS.md` §1.2 |
| 导航动作补齐 `goto` / `playPause` / 状态查询 | MCP Walkthrough `【源码核实】` | `CONTRACTS.md` §4.1 |
| "渲染器是哑的、决策在上层"的分工 | MCP Walkthrough | `ARCHITECTURE.md` |
| `Alt+]` / `Alt+[` / `Ctrl+Alt+W` 键位惯例 | Agent CodeWalk `【官方文档】` | `CONTRACTS.md` §4.1 |
| 语义化块分类 → `HighlightEmphasis` | Agent CodeWalk `【官方文档】` | `CONTRACTS.md` §1.2 / §4.3 |
| 代码哈希 + 失效标记（防高亮错行） | Agent CodeWalk `【官方文档】` | S1 `WalkthroughSession` |
| 高亮粒度预算 1–8 行当量 | Code Explainer `【官方文档】` | S3 `prompts/system.ts` |
| 计划落盘可回放可分享（`.walkthroughs/`） | Code Explainer `【官方文档】` | 第二阶段 TODO |
| 产出 `.vsix` 一条命令安装 | 两者共同 | F2 / 阶段收尾 |

| 不采用 | 理由 |
|---|---|
| TTS / 语音 | 未要求；Windows 上先例的 TTS 不可用（D15） |
| 覆盖度校验（diff hunk 全覆盖） | 用户砍掉（D16） |
| HTTP + WebSocket + bearer token | 单机单进程过度设计（D14） |
| `Podcast` / `Read` / `Learn` / `Defense` / `Build` 模式 | 超范围 |
| MCP server + socket 桥 | 用户砍掉（D14） |
| `(file, line, endLine)` 作为唯一位置模型 | **无法表达 PDF**——这正是我们的差异点 |

---

## 8. 如何重新核实（压缩后按需取用）

```bash
# MCP Walkthrough 的两层 step 模型（最有价值的一条，直接读声明）
curl -s https://unpkg.com/mcp-walkthrough@0.4.0/dist/bridge.d.ts

# MCP Walkthrough 的工具面与 teleprompter 描述
curl -s https://raw.githubusercontent.com/stefan-nitu/mcp-walkthrough/main/README.md

# fork base 的关键事实（license / engines / viewType / contributes）
curl -s https://raw.githubusercontent.com/mathematic-inc/vscode-pdf/main/package.json

# fork base 的 pdf.js 供给方式（vendored + patches）
curl -s https://raw.githubusercontent.com/mathematic-inc/vscode-pdf/main/README.md

# Agent CodeWalk 的覆盖度规则与键位
curl -s https://raw.githubusercontent.com/andylin-hao/agent-codewalk/main/README.md
```

源码学习用的 clone（**只 clone 学习，不安装、不运行其 setup 脚本**）：

```bash
git clone --depth 1 https://github.com/stefan-nitu/mcp-walkthrough
git clone --depth 1 https://github.com/andylin-hao/agent-codewalk
git clone --depth 1 https://github.com/Royal-lobster/code-explainer
```

**注意**：mcp-walkthrough 的 npm 包只含编译后的 `dist/*.js`（**无 TS 源码**），要读 TS 源码得 clone GitHub 仓库。Contral 闭源，无法 clone。
