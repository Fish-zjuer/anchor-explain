/**
 * 「产物里 pdf.js 真的能打开一份 PDF 吗」的探针 —— 由 `smoke-extension.mjs` 用**与真实构建
 * 同一套选项**打成一个 cjs 再跑（见那里的第 9 节）。
 *
 * @anchor 为什么要这么一个看起来多余的东西（D74/D75）：线1 的 PDF 取件在用户手上
 *         **从来没成功过**，而 `pnpm check` 一直是全绿的 —— 因为两处"测的不是它"：
 *
 *         1. **跑的是源码，不是产物**（D74）。pdf.js 靠 `import.meta.url` 推出 worker 的路径；
 *            源码直跑时那正好指得到 `node_modules`，而打成一个 cjs 之后 `import.meta.url`
 *            被改写成产物自己的位置 —— 它去 `dist/pdf.worker.mjs` 找一个不存在的文件：
 *            `Setting up fake worker failed: Cannot find module …`。
 *            → 所以这个探针**必须先打包再跑**。
 *         2. **进程的形状不对**（D75）。上一版探针跑在干净的 CLI Node 里，而真实的扩展宿主是
 *            **Electron 的 utility 进程**（`process.versions.electron` 有值、`process.type === 'utility'`）。
 *            pdf.js 那句 `isNodeJS` 判定里有一个为 Electron **渲染进程**写的条件，
 *            utility 进程会被它误判成"浏览器"，于是走 `url:` 那条路时直接
 *            `ReferenceError: window is not defined`。
 *            → 所以探针**先把这个进程伪装成宿主**，再加载 pdf.js。
 *
 * 用法（一般不用手敲，冒烟会调）：
 *   node scripts/pdf-open-probe.mjs test/fixtures/sample-30p.pdf
 *
 * 退出码 0 = 打开成功；1 = 失败（失败原因打到 stdout，冒烟会原样带出来）。
 */

import { readFile } from 'node:fs/promises';

// ── 先伪装成扩展宿主（必须在 pdf.js 被加载**之前**：它的判定是模块级常量）──────
// 这不是"测试技巧"，它就是把真实环境的形状摆出来。少这一段，探针就会像上一版那样
// "在我这儿是绿的、在宿主里打不开" —— 那正是 D75 的教训。
try {
  if (process.type === undefined) process.type = 'utility';
  if (process.versions.electron === undefined) {
    Object.defineProperty(process.versions, 'electron', { value: '42.10.0', configurable: true });
  }
} catch {
  // 伪装不了也继续：那说明这个运行时本来就不是宿主那种形状
}

const filePath = process.argv[2] ?? 'test/fixtures/sample-30p.pdf';

async function main() {
  // 动态 import：pdf.js 的判定发生在它被求值时，必须晚于上面那段伪装
  const { createPdfJsSource } = await import(
    '../packages/extension-anchor/src/adapters/pdf/pdfjsSource.ts'
  );
  const open = createPdfJsSource({ bytes: { readBytes: (p) => readFile(p) } });

  try {
    const source = await open(filePath);
    const page = await source.page(1);
    console.log(`[pdf-probe] pages=${source.pageCount} firstPageText=${page?.text.length ?? 0}`);
    source.dispose();
  } catch (err) {
    console.log(`[pdf-probe] failed: ${err?.message ?? err}`);
    process.exitCode = 1;
  }
}

void main();
