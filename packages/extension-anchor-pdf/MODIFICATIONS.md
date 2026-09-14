# MODIFICATIONS.md

本包是 [`mathematic-inc/vscode-pdf`](https://github.com/mathematic-inc/vscode-pdf) 的 fork。
上游是 **Apache-2.0**。这份文件逐条声明我们改了什么、删了什么、以及为什么 ——
这是 Apache-2.0 §4(b) 的义务，也是把我们和上游对齐的唯一依据。

## fork 基线

| 项 | 值 |
|---|---|
| 上游仓库 | `https://github.com/mathematic-inc/vscode-pdf` |
| 上游 commit | `1153346694f457bc7b4c73c9b0e95b629f02dc03`（2026-09-05，`ci: reuse published artifacts for marketplace retries (#73)`） |
| 上游版本号 | `0.2.5` |
| 源码获取方式 | `git clone --depth 1`（**只读下来看，没有跑上游任何 setup / prepare 脚本**） |
| 上游 pdf.js | `6.2.108@7d9b2e0095e602ad274f05bb02fbb4125b30d93f`（见 `pdfjs_version.txt`） |

要重新生成 diff：拿上面那个 SHA 与本包对比即可（`git diff <sha>` 在同一个仓库里都能算）。

## 一、保留原样的部分（**一个字节都没动**）

| 路径 | 说明 |
|---|---|
| `LICENSE` | 上游的 Apache-2.0 原文，逐字保留 |
| `assets/` | 页面运行时的全部资源：`main.css`、`main.mjs`、以及 vendored 的 `pdf.js/`（23MB，含 168 个 `.bcmap`、10 个 `.pfb`、4 个 `.wasm`） |
| `patches/pdf.js.patch` | 上游给 pdf.js 打的补丁（唯一目的是拆掉 pdf.js 自带的 CSP，好让宿主注入自己的） |
| `pdfjs_version.txt` | 上游记录的 pdf.js 版本 |
| `tools/check_pdfjs.mjs` | 上游自己写的**不变式守卫**（见下），原样保留并接进了本包的 `test` 脚本 |
| `src/{disposable,pdf-document,types,utils,webview-collection}.ts` | 逐字未改 |

`assets/` 与 `patches/` 是**上游 vendored 源码，必须提交，不许 gitignore**
（根 `.gitignore` 里专门写了注释说明这件事；`dist/` 也因此写成 `packages/*/dist/` 而不是 `dist/`）。

### 关于 `tools/check_pdfjs.mjs`

它不是我们的测试，是上游用来守住"pdf.js 被正确打补丁"的不变式检查，例如：
`viewer.html` 里不能出现 CSP、而我们注入的那一份必须恰好出现一次；
必须带上 `'wasm-unsafe-eval'` / `base-uri 'none'` / `form-action 'none'` 三条指令。
**我们把它接成了本包的 `test` 脚本**（`pnpm test` 会跑到），理由：
这些不变式一旦被破坏（比如将来升级 pdf.js 时补丁没打上），表现是"PDF 打不开"或"安全策略被绕过"，
两者都不该等到用户发现。

## 二、改动清单（只有两个文件）

### `src/extension.ts`

1. **删掉上游的"赞助提示"弹窗。**
   上游每次安装后第一次激活都会弹一次，把用户引向它的非营利组织捐赠页
   （`Support Mathematic` → `github.com/sponsors/mathematic-inc`）。
   删除的理由有两条，**都不是审美**：
   - 它是上游品牌露出。fork 保留上游的**署名与许可**（见上），但不承接它的**推广**。
   - 它替用户做了主。本包是个 PDF 阅读器，不该在用户第一次打开 PDF 时弹募捐入口。
2. **新增命令 `anchorPdf.openInAnchorViewer`（"用 Anchor 打开 PDF"）。**
   见 `package.json` 的 `contributes.commands` 与 `activationEvents`。
   实现走 `vscode.openWith`，所以"用 Anchor 打开"和用户从"打开方式"里选我们**是同一条路**，
   不会出现两套行为。没给 uri 时：活动编辑器里的 PDF → 否则让用户挑一个文件。
   接受 `uri` 参数是为 S6 留的（跨扩展调用走 `executeCommand`，见 `CONTRACTS.md` §5.1）。

### `src/pdf-viewer-provider.ts`

1. **`viewType`：`"pdf.view"` → `"anchorPdf.view"`。**
   两个扩展如果注册同一个 `viewType`，谁先激活谁生效 —— 那是"劫持"的另一种写法。
2. **配置命名空间：`getConfiguration("pdf")` → `getConfiguration("anchorPdf")`。**
   同时 `package.json` 里的两个配置项改名 `pdf.*` → `anchorPdf.*`。
   否则装了上游扩展的用户会发现两个扩展抢同一份配置。
3. **S5：`getHtmlForWebview` 多插一个 `<script src="media/anchor-select.js">`。**
   这是框选 overlay 的注入点。选这个做法的关键是 **`assets/pdf.js/` 一个字节都没动** ——
   overlay 是独立文件，框选逻辑不往 pdf.js 里塞代码，所以将来升级 pdf.js 时这条注入不用重做
   （升级流程见本文档 §四）。

   **注入位置：必须排在 `pdf.mjs` / `main.mjs` 之前**（S5 补，D73）。
   不是依赖顺序，而是 `acquireVsCodeApi()` 在一个 webview 里**只能成功调用一次**，
   而这份页面里 **pdf.js 自己也要用它**（`viewer.mjs` 的 `VSCodeLinkService` 把 PDF 里的链接
   交回宿主，交给它那次 `{open: string}` 消息），且 `assets/main.mjs` 一开头就 `import` 了
   viewer.mjs —— 它天然跑在我们前面。所以 overlay 先接管 `acquireVsCodeApi`、把实例共享出去，
   之后 pdf.js 来取就拿到同一个。反过来的话，overlay 那次调用会抛，
   宿主侧收到的是**一片静默**（用户看到"框选毫无反应"）。
   module 脚本不带 `async` 时按文档顺序执行，所以"我们在前"是结构性保证。

4. **S5：`onDidReceiveMessage` 多接一类消息。** 上游只看 `{open: string}`（页面里的链接），
   我们多接 §5.2 的框选消息；两类消息各看各的字段，`parseSelectMessage` 返回 null 就落回上游那条路。
   **没有改动上游原有的那段处理**，是在它前面加了一个分支。
5. **S5：宿主自己多记一份"面板 → 文档 uri"。** 上游的 `WebviewCollection` 只提供
   `get(uri)`（按文档找面板），而跨扩展定位（`revealPage`）要的是反过来的查询
   （"所有活着的面板"）。为了**不改上游那个文件**，宿主在自己的字段里再记一份。
   `src/webview-collection.ts` 因此仍然逐字未改。
6. **S5 补（D73）：框选失败时不许静默。** `startSelectRegion` 不管页面有没有握过手都先推一次
   `enterSelectMode`（推早了无害），没握手时再补一句人话；注入脚本在**拿不到 VS Code API** 时
   会在页面上贴一句故障说明（`#anchor-select-fault`，复用 VS Code 的报错配色）。
   这两处都不改上游行为，只是把"什么都发生了但屏幕上没有"变成"屏幕上有一句话"，理由见 D73。
   界面文案（命令标题、通知文本）全部是中文，这是我们自己新增的字符串，与上游无冲突。
7. **S6 补（D76）：`anchor:flashRegion` —— 用户点了某一步时，滚到那一页并闪现一下那一块。**
   它是"约束 1 收窄"的落点（`CONTRACTS.md` §5.2 的边界表）：PDF 页面上的位置指示
   只允许**用户点击触发、约 2 秒后自己摘掉**这一种。实现仍在 `media/anchor-select.js` 里
   （DOM 元素 `#anchor-select-flash`，每帧跟着页面重算位置），**`assets/` 依旧一个字节没动**。
   归一化 → 像素的逆换算也留在这个文件里，但正确性由 `test/anchorSelectClient.test.ts`
   的**往返校验**兜着（用有单测的正向函数反过来验）。

（上面两个文件在版权声明之后都追加了一段"本文件已被修改"的显著声明，即 Apache-2.0 §4(b) 的要求。
未列出的文件就是逐字未改的。）

### `src/extension.ts`（续）

3. **S5/S6：新增三个命令** `anchorPdf.selectRegion`（让当前面板进入框选模式）、
   `anchorPdf.revealPage`（跨扩展入口：把 PDF 滚到第 N 页）、
   `anchorPdf.flashRegion`（跨扩展入口：滚到第 N 页 **并闪现一下那一块**，D76）。
   后两个也声明进了 `contributes.commands`：
   **"注册了但没声明"是最坏的一种状态** —— 命令面板里根本看不见，
   而一个看不见的入口等于没有。`revealPage` 没有参数时会问用户要页号，所以手动调用也有意义；
   `flashRegion` 的参数（页码 + bbox）不合法时**明确提示**,而不是拿一个坏框去页面上画。

### `package.json`

| 字段 | 上游 | 现在 | 为什么 |
|---|---|---|---|
| `name` | `vscode-pdf` | `anchor-pdf` | 与线1 的 `anchor-explain` 配成一对，扩展 ID 是 `anchor.anchor-pdf`（`CONTRACTS` §9 里线1 的 `PEER_EXTENSION_ID` 就写着它） |
| `publisher` | `mathematic` | `anchor` | **商标要求**：发布者标识不能沿用上游 |
| `displayName` | `PDF Viewer` | `Anchor PDF 视图` | 同上 |
| `author` | `Mathematic Inc` | 删除 | 署名在 `LICENSE` 与上面的 fork 基线里，不在 `publisher` 旁边 |
| `repository` | 指向上游仓库 | 删除 | 写在那里会让"这是谁的仓库"变成误导 |
| `icon` | `icon.png`（上游图标） | 删除 | 上游品牌资产，不随 fork 分发 |
| `description` | 上游的 | 我们自己的 | — |
| `version` | `0.2.5` | `0.0.0` | 本仓库的约定（`private: true`，不发布 Marketplace） |
| `engines.vscode` | `^1.134.0` | `^1.90.0` | 与线1 一致。上游用的是更新的 API，但**实际用到的都是 1.90 就有的**（`registerCustomEditorProvider` / `asWebviewUri` / `openWith`），类型面因此钉在 `@types/vscode@1.90.0` |
| `main` | `./dist/extension.js` | `./dist/extension.cjs` | 本仓库的打包约定（CommonJS + `.cjs` 后缀，见 `CONTRACTS` §9.4） |
| `scripts` | tsup / oxlint / vsce / hk… | `typecheck` + `test`（单测 + 上游的 pdf.js 守卫） | 打包统一由根 `esbuild.mjs` 负责（见下） |
| `dependencies` | 无 | `@anchor/core`（workspace） | S5 起线2 用它的 `normalizeBBox` / `coerceBBox` / `isValidBBox` 与 `basenameOf` / `samePath` —— 那是"两条线共用的位置数学"，不该复制一份 |
| `contributes.commands` | 无 | 三个（打开 / 框选 / 跳页） | 见 `src/extension.ts` 那几条 |
| `contributes.keybindings` | 无 | `ctrl+alt+s`（框选） | `when: activeCustomEditorId == 'anchorPdf.view'`，只在我们自己的视图里生效 |
| `customEditors[0].priority` | 无 | `"option"` | **不劫持**：我们的视图只是候选项之一，用户的默认 PDF 打开方式不变 |
| `contributes.commands` | 无 | 加上 `anchorPdf.openInAnchorViewer` | 没有它，`priority: "option"` 就意味着"用户根本进不来" |
| `devDependencies` | typescript 7 / tsup / oxlint / oxfmt / vsce | 与本仓库其它包一致 | 一个仓库一套工具链 |

### 删掉的上游工程设施（连同理由）

| 路径 | 为什么删 |
|---|---|
| `.github/` | 上游的 CI、release-please、市场发布流程。本仓库不上架 Marketplace，且那些工作流会引用上游的 secrets 与仓库名 |
| `.vscode/` | 上游的调试配置指向它自己的目录结构 |
| `tsup.config.ts` | 打包改由根 `esbuild.mjs` 统一负责（`TARGETS` 里加了一行，含 `.html` 的 text loader） |
| `pnpm-workspace.yaml` / `pnpm-lock.yaml` | 本仓库是 workspace，依赖与 lockfile 归仓库根 |
| `hk.pkl` / `mise.toml` / `.oxfmtrc.json` / `.oxlintrc.json` / `.typos.toml` / `.rumdl.toml` / `.yamllint` / `.node-version` | 上游的 lint / format / 版本管理工具链。一个仓库一套；且其中 `hk.pkl` 会让 `pnpm install` 触发它的 `prepare` 脚本 —— 我们不跑上游的 setup |
| `CHANGELOG.md` / `CONTRIBUTING.md` / `release-please-config.json` / `.release-please-manifest.json` | 上游的发布流程文档。上游的改动历史用上面的 commit SHA 定位，比一份会过期的 CHANGELOG 更准 |
| `tools/{download,patching,prepare}_pdfjs.sh` | 需要 `gh` + 网络才能跑，是上游更新 pdf.js 的流程。`patches/pdf.js.patch` 与 `pdfjs_version.txt` 已经把"打了什么补丁、基于哪个版本"记全了 |
| `README.md` / `icon.png` | 上游的说明与品牌资产（README 换成了我们的，见下） |
| `.gitignore` / `.gitattributes` / `.gitmodules` | 仓库级的，归仓库根。本包另有一份**只关于字节敏感资源**的 `.gitattributes`（`*.bcmap` / `*.pfb` / `*.wasm` / `*.ttf` 标 binary） |

### 新增的目录（我们写的，不是上游的）

| 路径 | 说明 |
|---|---|
| `src/anchor/` | 框选相关的**可测**部分：像素→归一化换算（`rectToNormalizedBBox.ts`）、§5.2 消息守卫（`bridge.ts`）、Anchor 组装（`captureAnchor.ts`）。三个都**零 vscode 依赖**，所以能被 `node --test` 覆盖 |
| `media/anchor-select.js` | 注入式框选 overlay。**不参与类型检查、也不进 bundle**（运行时从扩展目录读）。所以它的纪律是：**一行业务数学都不做**，只做"跟手的事"（画橡皮筋、报像素几何）。另外它必须先接管 `globalThis.acquireVsCodeApi`（D73，见上），并在拿不到 API 时在页面上贴一句故障说明 |
| `test/anchor.test.ts` | 上面三个模块的单测（11 条） |
| `test/anchorSelectClient.test.ts` | **S5 补（D73）**：注入脚本的行为夹具（9 条）。最小 DOM + 逐字复刻 VS Code 预加载语义的 `acquireVsCodeApi`，把"推 `enterSelectMode` → 拖框 → 消息过宿主守卫 → 算得出第几页哪一块"整条跑一遍。它也不碰 `vscode` |
| `.gitattributes` | 字节敏感资源标 `binary`（见 D53 第 9 条） |

## 三、许可与署名

- 本包整体仍是 **Apache-2.0**（见 `LICENSE`），不是本仓库根声明的 MIT。
  两个包的许可不同是刻意的：fork 的部分受上游许可约束。
- **上游没有 `NOTICE` 文件**，所以没有需要一并保留的 NOTICE（Apache-2.0 §4(d) 的前提是
  "原作品包含 NOTICE"）。将来若上游补上，这里要跟着加。
- 每个被修改的文件都带"本文件已被修改"的显著声明；未修改的文件保留上游版权头原样。

## 四、将来更新 pdf.js 时

上游的流程是 `tools/*.sh`（需要 `gh`）。我们的最小流程：

1. 取上游新版本的 `assets/`、`patches/`、`pdfjs_version.txt`
2. 跑 `pnpm --filter anchor-pdf test`（就是上游那个 `check_pdfjs.mjs`）——
   它会在**打补丁没打上**或 **CSP 被 pdf.js 自己又加回来**时立刻失败
3. 重新 `pnpm build`，按 F5 打开一个多页 PDF 看一眼
