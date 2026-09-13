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

/** @type {{ name: string; entry: string; loader?: Record<string, string> }[]} */
const TARGETS = [
  { name: 'extension-anchor', entry: 'packages/extension-anchor/src/extension.ts' },
  {
    name: 'extension-anchor-pdf',
    entry: 'packages/extension-anchor-pdf/src/extension.ts',
    // fork 的 pdf-viewer-provider 把 assets/pdf.js/web/viewer.html 当字符串导入
    // （上游用 tsup 的 .html text loader 做同一件事）。类型那一侧靠
    // src/types.ts 里的 `declare module "*.html"`。
    loader: { '.html': 'text' },
  },
];

/**
 * 让 `.vscode/tasks.json` 的 problemMatcher 有稳定的起止标记，不依赖 esbuild 自身的日志格式。
 *
 * @anchor 标记必须**聚合到"这一批构建全做完"**，不能每个 target 各报一次（S8 修）：
 *         VS Code 的 `background` 匹配器一看到 endsPattern 就认为任务就绪、随即启动调试宿主。
 *         而两个目标里线2 先好（307KB），线1 的 4.2MB 还在写 —— 于是宿主可能读到
 *         **没写完或过期的 dist/extension.cjs**，表现是"宿主窗口起来了，但活动栏里没有
 *         那个图标、命令也搜不到"，看起来就像"F5 没反应"。
 *         所以：第一个目标开始时报 started，**全部**结束后才报 finished。
 */
const inFlight = new Set();

const watchMarkers = (name) => ({
  name: 'anchor-watch-markers',
  setup(b) {
    b.onStart(() => {
      if (inFlight.size === 0) console.log('[anchor] build started');
      inFlight.add(name);
    });
    b.onEnd((result) => {
      inFlight.delete(name);
      if (inFlight.size > 0) return;
      // **出错也要报 finished**：否则 VS Code 永远等不到就绪信号，
      // 症状是"按 F5 完全没反应"（连报错框都没有）。错误数写进同一条日志里，终端上照样看得见。
      const errors = result?.errors?.length ?? 0;
      console.log(`[anchor] build finished${errors > 0 ? `（${errors} 个错误）` : ''}`);
    });
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
    ...(target.loader ? { loader: target.loader } : {}),
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
