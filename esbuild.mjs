// @anchor: 唯一的打包入口。tsc 只做类型检查（noEmit），esbuild 负责出可加载的扩展产物。
//
// 为什么打成一个 cjs 文件：VS Code 扩展宿主的入口是 require()，不支持 ESM 入口，
// 所以两个扩展的 main 都是 dist/extension.cjs（package.json 里 type: module，
// 用 .cjs 后缀明确告诉 Node 这是 CommonJS）。
//
// 新增一个扩展时，只在这里往 TARGETS 里加一行，不要另写打包脚本。

import { build, context } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {{ name: string; entry: string }[]} */
const TARGETS = [
  { name: 'extension-anchor', entry: 'packages/extension-anchor/src/extension.ts' },
  // S4 会加：{ name: 'extension-anchor-pdf', entry: 'packages/extension-anchor-pdf/src/extension.ts' }
];

/** 让 .vscode/tasks.json 的 problemMatcher 有稳定的起止标记，不依赖 esbuild 自身的日志格式 */
const watchMarkers = (name) => ({
  name: 'anchor-watch-markers',
  setup(b) {
    b.onStart(() => console.log(`[anchor] build started: ${name}`));
    b.onEnd(() => console.log(`[anchor] build finished: ${name}`));
  },
});

function optionsFor(target) {
  return {
    entryPoints: [path.join(root, target.entry)],
    outfile: path.join(root, 'packages', target.name, 'dist', 'extension.cjs'),
    bundle: true,
    format: 'cjs',
    platform: 'node',
    // VS Code 1.90+ 的扩展宿主基于 Node 20，target 不高于它即可
    target: 'node20',
    // 宿主的运行时注入，不能也不该打包
    external: ['vscode'],
    sourcemap: production ? false : 'inline',
    minify: production,
    logLevel: 'info',
    plugins: watch ? [watchMarkers(target.name)] : [],
  };
}

if (watch) {
  const contexts = await Promise.all(TARGETS.map((t) => context(optionsFor(t))));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('[anchor] watching for changes...');
} else {
  await Promise.all(TARGETS.map((t) => build(optionsFor(t))));
  console.log(`[anchor] built ${TARGETS.length} target(s)${production ? ' (production)' : ''}`);
}
