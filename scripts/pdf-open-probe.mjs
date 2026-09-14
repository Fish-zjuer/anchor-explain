/**
 * 「产物里 pdf.js 真的能打开一份 PDF 吗」的探针 —— 由 `smoke-extension.mjs` 用**与真实构建
 * 同一套选项**打成一个 cjs 再跑（见那里的第 9 节）。
 *
 * @anchor 为什么需要这么一个看起来多余的东西（D74）：线1 的 PDF 取件在用户手上
 *         **从来没成功过**，而 `pnpm check` 一直是全绿的 —— 因为
 *           - `node --test` 跑的是**源码**，`node_modules/pdfjs-dist/...` 就在旁边，pdf.js 靠
 *             `import.meta.url` 推出的那个 worker 路径正好指得到真文件；
 *           - 而用户跑的是**产物**：`import.meta.url` 被 esbuild 改写成了产物自己的位置，
 *             于是 pdf.js 去 `dist/pdf.worker.mjs` 找一个不存在的文件，报
 *             `Setting up fake worker failed: Cannot find module …`。
 *         两边的差别只有一个字：打包。所以这条锁必须在**打包之后**跑，也就是这里。
 *
 * 用法（一般不用手敲，冒烟会调）：
 *   node scripts/pdf-open-probe.mjs test/fixtures/sample-30p.pdf
 *
 * 退出码 0 = 打开成功；1 = 失败（失败原因打到 stdout，冒烟会原样带出来）。
 */

import { openPdfJsSource } from '../packages/extension-anchor/src/adapters/pdf/pdfjsSource.ts';

const filePath = process.argv[2] ?? 'test/fixtures/sample-30p.pdf';

async function main() {
  try {
    const source = await openPdfJsSource(filePath);
    const page = await source.page(1);
    console.log(`[pdf-probe] pages=${source.pageCount} firstPageText=${page?.text.length ?? 0}`);
    source.dispose();
  } catch (err) {
    console.log(`[pdf-probe] failed: ${err?.message ?? err}`);
    process.exitCode = 1;
  }
}

void main();
