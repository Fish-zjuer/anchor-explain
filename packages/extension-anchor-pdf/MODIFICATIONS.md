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

（上面两个文件在版权声明之后都追加了一段"本文件已被修改"的显著声明，即 Apache-2.0 §4(b) 的要求。
未列出的文件就是逐字未改的。）

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
| `scripts` | tsup / oxlint / vsce / hk… | `typecheck` + `test` | 打包统一由根 `esbuild.mjs` 负责（见下） |
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
