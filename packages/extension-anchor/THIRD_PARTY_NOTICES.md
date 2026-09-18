# 第三方声明（线1）

本包自身是**专有软件**（All rights reserved，见同目录 `LICENSE.txt`；D85 起不再按 MIT 分发）。
产物里**打包**了下面这个第三方依赖，它的许可与本包不同，因此单独声明。

## pdfjs-dist（Apache-2.0）

| 项 | 值 |
|---|---|
| 包名 | `pdfjs-dist` |
| 版本 | 见 `packages/extension-anchor/package.json` 的 `dependencies` |
| 许可 | **Apache License 2.0** |
| 许可全文 | `node_modules/pdfjs-dist/LICENSE`（安装后可见） |
| 上游 | <https://github.com/mozilla/pdf.js> |

**为什么会被打进产物**：S7 的 PDF 取件要在**没有 webview** 的情况下按页读文字层，
而 `pdfjs-dist/legacy` 是官方给 Node 用的入口。它是 ESM-only，
CommonJS 产物里没法用 `require` 去外部加载，所以只能打包。

**署名放在哪**：`src/adapters/pdf/pdfjsSource.ts` 顶部有一条 `/*! ... */` 注释 ——
esbuild 的 `legalComments` 会把它原样保留到产物末尾。
`scripts/smoke-extension.mjs` 有一条断言守着它（注释被删/被压掉时会红），
因为"打包了别人的代码却不带署名"是这类问题里最难在事后发现的一种。

**注意**：线2（`extension-anchor-pdf`）里那份 `assets/pdf.js/` 是**另一份** pdf.js
（上游 vendored + 打过补丁的浏览器构建），它的许可是那个 fork 的事，
见 `packages/extension-anchor-pdf/MODIFICATIONS.md`。
