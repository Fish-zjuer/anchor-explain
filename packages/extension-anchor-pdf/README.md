# anchor-pdf（线2：PDF）

把 PDF 上框选的一块变成**带地址的锚点**（第 N 页 + 归一化 bbox），然后把位置交给线1 去讲解。

**线2 只做框选定位，不做高亮流转** —— PDF 上不出现任何高亮框（`CONTRACTS.md` §2.1 / 约束 1）。
侧边栏点击某一步只是**滚到那一页**（S6），不是画框。

这是 [`mathematic-inc/vscode-pdf`](https://github.com/mathematic-inc/vscode-pdf)（Apache-2.0）的 fork。
**改了什么、删了什么、为什么，逐条在 [`MODIFICATIONS.md`](MODIFICATIONS.md)** —— 那份文件是这个包的必读。

- 扩展 ID：`anchor.anchor-pdf`（线1 的 `PEER_EXTENSION_ID` 就是它）
- 入口：`src/extension.ts` → 产物 `dist/extension.cjs`
- **不劫持**：`customEditors` 里写了 `priority: "option"`，用户的默认 PDF 打开方式不受影响。
  想用我们的视图 → 命令面板 `Anchor: 用 Anchor 打开 PDF`

## 现在到哪了

**S5：框选能用了**。改名 / 不劫持 / 能打开（S4）→ 现在还能**拖一个矩形**，
把它变成 `Anchor` 交给线1 讲解（S5）。点击侧边栏滚动定位是 S6。

### 怎么框选

1. `Ctrl+Alt+S`（或命令面板 `Anchor: 框选一块并讲解（PDF）`）→ 进入框选模式，光标变成十字
2. 在页面上拖一个矩形。**抬手就结束**：矩形消失、框选模式退出、屏幕上不留任何东西
3. 拖到页外/页缝 → 提示「没有落在任何一页上」，不会留下垃圾状态
4. 中途不想选了：`Esc`
5. 交给线1 之后侧边栏会出讲解（没装线1 会明确提示）

**跨页拖**（从第 1 页底部拖到第 2 页里）会判给**盖得多的那一页**，不是按起点判。

## 源码入口表

| 文件 | 职责 | 与上游的差异 |
|---|---|---|
| `src/extension.ts` | activate → 注册 provider + 命令 | **已改**：删掉上游募捐弹窗；新增 `anchorPdf.openInAnchorViewer` |
| `src/pdf-viewer-provider.ts` | `CustomReadonlyEditorProvider`：注册视图、拼 webview HTML、注入 CSP 与配置 | **已改**：`viewType` → `anchorPdf.view`；配置命名空间 → `anchorPdf` |
| `src/pdf-document.ts` | 文档模型（变更/删除事件） | 逐字未改 |
| `src/webview-collection.ts` | 一个文档对应多个 webview 的集合 | 逐字未改 |
| `src/disposable.ts` / `src/utils.ts` / `src/types.ts` | 小工具；`*.html` 的模块声明 | 逐字未改 |
| `src/anchor/rectToNormalizedBBox.ts` | **S5 新增**。像素矩形 → 「第几页 + 归一化 bbox」的**全部**换算（零 vscode 依赖，11 条单测） |
| `src/anchor/bridge.ts` | **S5 新增**。§5.2 消息的 TS 落地 + 边界守卫 |
| `src/anchor/captureAnchor.ts` | **S5 新增**。框选 → `Anchor`；`describePdfAnchor` 把 bbox 说成人话 |
| `media/anchor-select.js` | **S5 新增**。注入式框选 overlay。**不参与类型检查、不进 bundle**（运行时从扩展目录读）。**一行业务数学都不做** |
| `assets/` | **页面运行时的全部资源**：`main.css` / `main.mjs` / vendored `pdf.js`（23MB） | 逐字未改，**必须提交** |
| `patches/pdf.js.patch` | 上游给 pdf.js 打的补丁（拆掉 pdf.js 自带 CSP） | 逐字未改，**必须提交** |
| `tools/check_pdfjs.mjs` | 上游的不变式守卫（CSP 恰好一次、pdf.js 补丁在位） | 逐字未改，**接进了本包的 `test`** |

## 怎么跑

```bash
pnpm install                       # 仓库根
pnpm build                         # 产物落在本包 dist/extension.cjs（根 esbuild.mjs 的 TARGETS 里）
pnpm --filter anchor-pdf test      # 跑 test/anchor.test.ts（11 条）+ tools/check_pdfjs.mjs（上游的不变式守卫）
pnpm smoke:pdf                     # 产物冒烟：不劫持 / 改名 / 命令 / **框选整条链路**（66 项）
pnpm --filter anchor-pdf typecheck # tsc --noEmit
```

`pnpm build` 只打产物，**不会复制 assets** —— 视图是运行时从扩展目录读 `assets/` 的
（`webview.asWebviewUri`），所以开发时 `.vscodeignore` 排掉什么都没关系；
只有真的要打 `.vsix` 时才需要确认 `assets/` 没被排除。

### 怎么看它起来了

仓库根的 F5 配置目前只载入线1。要单独看线2：

```bash
pnpm devhost:pdf        # 在仓库根执行；等于「先 build，再用绝对路径起宿主」
```

**日常用就装成常驻扩展**（活动栏/命令面板一直在，不用每次起宿主）：

```bash
pnpm link:ext           # 线1 + 线2 一起装进 ~/.vscode/extensions（目录联接）
pnpm unlink:ext         # 撤掉
```

> **不要手敲 `code --extensionDevelopmentPath=packages/extension-anchor-pdf ...`（相对路径）。**
> `code` CLI 把参数转交给已在运行的 VS Code 实例时**不传 CWD**，相对路径会被解析成
> `/packages/extension-anchor-pdf` —— 结果是**窗口照开、一切正常、就是没有这个扩展**
> （设置里搜不到 `anchorPdf.*`、命令面板也没有那条命令，且不弹任何错）。见 D59。
> 这条已经坑过一次，所以 `pnpm devhost:pdf` 专门算绝对路径，并在起之前查产物在不在。

然后在新窗口里：命令面板 → `Anchor: 用 Anchor 打开 PDF` → 选 `sample-30p.pdf`。
应该能用 Anchor 的视图打开它，**并且**在设置里能搜到 `anchorPdf.defaultZoomValue` 与
`anchorPdf.sidebarViewOnLoad` 两项（这证明配置命名空间改对了）。

### 怎么验证"没有劫持"

1. **不装 Anchor 的视图时**：直接双击一个 `.pdf`，应由别的扩展（或内置）打开 ——
   因为我们写的是 `priority: "option"`，不是 `default`。
2. 装了之后仍然如此，只有走命令面板那条路才会用我们的视图。

## 边界

- **不碰 `assets/pdf.js/`**：那是上游 vendored + 打过补丁的 pdf.js，改它就没有升级路径了。
  S5 的框选走**注入式 overlay**（`media/anchor-select.js`），不往 pdf.js 里塞代码。
- **不画高亮框**：线2 的位置信息只用于"滚到那一页"。
- 本包许可 **Apache-2.0**（不是仓库根的 MIT），见 `LICENSE` 与 `MODIFICATIONS.md` §三。
