# anchor-pdf（线2：PDF）

把 PDF 上框选的一块变成**带地址的锚点**（第 N 页 + 归一化 bbox），然后把位置交给线1 去讲解。

**线2 只做框选定位，不做高亮流转** —— PDF 上**不出现常驻的框，也没有任何框会自己冒出来**
（约束 1 在 D76 里的收窄说法）。侧边栏点击某一步会**滚到那一页、并在那一块上闪一个框**，
约 2 秒后自己消失 —— 那是唯一的例外，而且只在你点的时候出现。

这是 [`mathematic-inc/vscode-pdf`](https://github.com/mathematic-inc/vscode-pdf)（Apache-2.0）的 fork。
**改了什么、删了什么、为什么，逐条在 `MODIFICATIONS.md`** —— 那份文件是这个包的必读。
（写成代码块而不是链接：这份 README 会随 `.vsix` 一起分发，相对链接在 Extensions 视图里是坏的，
而 vsce 对"没有 repository 却带相对链接"直接报错 —— 我们没有 repository 也不想要一个假的。）

- 扩展 ID：`Fish-zjuer.anchor-pdf`（线1 的 `PEER_EXTENSION_ID` 就是它）
- 入口：`src/extension.ts` → 产物 `dist/extension.cjs`
- **不劫持**：`customEditors` 里写了 `priority: "option"`，用户的默认 PDF 打开方式不受影响。
  想用我们的视图 → 命令面板 `Anchor: 用 Anchor 打开 PDF`

## 现在到哪了

**S5/S6 修完（D73）：框选那条链路原本第一颗螺丝就是断的，现在真的能用**。
改名 / 不劫持 / 能打开（S4）→ **拖一个矩形**变成 `Anchor` 交给线1 讲解（S5）→
点击侧边栏「第 N 页」→ **滚到那一页 + 闪一下那一块**（S6 / D76），状态栏同时回执一句
（目标就在当前页时，那句回执是唯一能说明"刚才那一下成功了"的东西）。

### 怎么框选

1. `Ctrl+Alt+S`（或命令面板 `Anchor: 框选一块并讲解（PDF）`）→ 进入框选模式，光标变成十字
2. 在页面上拖一个矩形。**抬手就结束**：矩形消失、框选模式退出、屏幕上不留任何东西
3. 拖到页外/页缝 → 提示「没有落在任何一页上」，不会留下垃圾状态
4. 中途不想选了：`Esc`
5. 交给线1 之后侧边栏会出讲解（没装线1 会明确提示）

**跨页拖**（从第 1 页底部拖到第 2 页里）会判给**盖得多的那一页**，不是按起点判。

### 按了没反应？查这里（D73）

先分清"哪一种没反应" —— 这两种的下一步完全不同：

| 现象 | 说明 | 怎么办 |
|---|---|---|
| 有十字光标，拖完什么都没发生 | 页面活着（`anchor:ready` 到了），消息在半路被挡 | 输出面板「Anchor」里有没有日志；线1 那边装了没有（没装会明确提示） |
| **没有十字光标**，第一次按弹「页面还在加载」 | 页面脚本还没握上手 | 等一下再按一次（加载完会自动进入框选模式） |
| **没有十字光标**，再按弹「一直没有回应框选脚本」 | 页面里的脚本**没跑起来或拿不到 VS Code 接口** | 把 PDF 关掉重开；仍不行就看 Console：命令面板 → `Developer: Toggle Developer Tools` → Console。**把报错发我**（只说"没反应"没有可查的线索） |
| PDF 页面底部贴出一句红底说明 | 脚本活着但拿不到 `acquireVsCodeApi`（D73 的故障出口） | 同上：关掉重开 + 看 Console |
| 点侧边栏某一步**没看到框闪** | 可能目标就在当前页（闪是闪了，但页面没动），或这一步不是 PDF 位置 | 状态栏应当同时出现「已定位到第 N 页…」；没有那句说明这一步没走到线2，看输出面板「Anchor」的定位日志 |

**为什么可能拿不到**：`acquireVsCodeApi()` 在一个 webview 里只能成功调用一次，而这份页面里
pdf.js 自己也要用（PDF 里的链接要交回宿主）。所以我们先接管、再把实例共享出去，并**必须排在上游
脚本之前**加载。这条链上任何一环坏了，旧版本的表现就是"框选毫无反应、屏幕上也没有任何字" ——
现在至少会说话。

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
| `media/anchor-select.js` | **S5 新增**。注入式框选 overlay。**不参与类型检查、不进 bundle**（运行时从扩展目录读）。**一行业务数学都不做**；但必须先接管 `globalThis.acquireVsCodeApi`、把实例共享给 pdf.js，且排在上游脚本之前加载（D73） |
| `test/anchorSelectClient.test.ts` | **S5 补（D73）新增**。注入脚本的行为夹具（9 条）：最小 DOM + 复刻 VS Code 预加载语义的 `acquireVsCodeApi`，跑通「推 enterSelectMode → 拖框 → 消息过宿主守卫 → 算得出页与框」 |
| `assets/` | **页面运行时的全部资源**：`main.css` / `main.mjs` / vendored `pdf.js`（23MB） | 逐字未改，**必须提交** |
| `patches/pdf.js.patch` | 上游给 pdf.js 打的补丁（拆掉 pdf.js 自带 CSP） | 逐字未改，**必须提交** |
| `tools/check_pdfjs.mjs` | 上游的不变式守卫（CSP 恰好一次、pdf.js 补丁在位） | 逐字未改，**接进了本包的 `test`** |

## 怎么跑

```bash
pnpm install                       # 仓库根
pnpm build                         # 产物落在本包 dist/extension.cjs（根 esbuild.mjs 的 TARGETS 里）
pnpm --filter anchor-pdf test      # test/anchor.test.ts（11 条）+ test/anchorSelectClient.test.ts（9 条）
                                   # + tools/check_pdfjs.mjs（上游的不变式守卫）
pnpm smoke:pdf                     # 产物冒烟：不劫持 / 改名 / 命令 / **注入顺序** / **框选整条链路**（74 项）
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
- **不常驻、不自动的框**（D76 收窄后的约束 1）：播放/推进时 PDF 上一个框都不出现；
  只有"用户点了某一步"会滚到那一页并闪一下那一块，约 2 秒后自动消失。
- 本包许可 **Apache-2.0**，见 `LICENSE` 与 `MODIFICATIONS.md` §三。
  **D87 之后整仓（含线1）统一 Apache-2.0** —— D85 曾把线1 改成专有、并据此宣称
  "线2 不能被要求禁止再分发"，那条对比已随开源作废：现在两线条款相同，都允许再分发
  （条件是保留 `LICENSE` / `NOTICE` 与署名）。
