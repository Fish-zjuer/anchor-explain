/**
 * 守卫：**内联进 webview 的字符串常量里不许出现反引号**。
 *
 * 为什么值得单独一个脚本（而不是一条单测）：反引号坏的是**模块本身** ——
 * 它会把模板字符串当场截断，于是 `import` 直接语法错，那条断言根本没机会跑。
 * 所以守卫必须在**导入之前**跑，`node --test` 帮不上忙。
 *
 * 踩过的次数：styles.ts 三次、clientScript.ts 一次（都是写在 CSS/JS 注释里给属性名加反引号）。
 *
 * ## 只查反引号，**不查 `${`**
 *
 * 因为源码里 `${TILT_MAX_DEG}` 这种是**有意插值**，源码级分不出"有意"与"手滑"。
 * 未求值的 `${` 留给渲染结果去查（`test/blockView.test.ts` 里"内联字符串不许被模板插值咬坏"
 * 那条断言：渲染出来的 HTML 里不许残留 `${`）—— 那才是唯一权威的判据。
 *
 * 用法：node scripts/check-inline-strings.mjs（挂在 pnpm check 的前面）
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 要守的「文件 + 常量名」清单。新增内联字符串就往这里加一行。 */
const TARGETS = [
  'packages/extension-anchor/src/blocks/ui/styles.ts:BLOCK_VIEW_STYLES',
  'packages/extension-anchor/src/blocks/ui/clientScript.ts:BLOCK_VIEW_CLIENT_SCRIPT',
  'packages/extension-anchor/src/sidebar/ui/styles.ts:SIDEBAR_STYLES',
  'packages/extension-anchor/src/sidebar/ui/clientScript.ts:SIDEBAR_CLIENT_SCRIPT',
  'packages/extension-anchor/src/start/ui/startStyles.ts:START_STYLES',
  'packages/extension-anchor/src/start/ui/startClientScript.ts:START_CLIENT_SCRIPT',
];

const problems = [];

for (const target of TARGETS) {
  const [rel, constName] = target.split(':');
  const file = path.join(ROOT, rel);
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    // 文件还没被创建（这份清单比代码走得早时）——跳过，不算错
    continue;
  }
  const marker = `${constName} = \``;
  const start = source.indexOf(marker);
  if (start < 0) {
    problems.push(`${rel}：找不到 ${constName} 的模板字符串起点（清单过期了？）`);
    continue;
  }
  const from = start + marker.length;
  const to = source.lastIndexOf('`;');
  if (to <= from) {
    problems.push(`${rel}：${constName} 的模板字符串没有收尾`);
    continue;
  }
  const body = source.slice(from, to);

  const ticks = [...body.matchAll(/`/g)].length;
  if (ticks > 0) {
    const line = body.slice(0, body.indexOf('`')).split('\n').length;
    problems.push(
      `${rel}：${constName} 里出现 ${ticks} 个反引号（约在模板第 ${line} 行）——` +
        `它会把模板字符串截断，导致整模块语法错。注释里包属性名不要用反引号。`,
    );
  }
}

if (problems.length > 0) {
  console.error('[inline-strings] 内联字符串有问题：');
  for (const p of problems) console.error(`  ✖ ${p}`);
  process.exit(1);
}

console.log(`[inline-strings] ${TARGETS.length} 个内联字符串常量：反引号 0 —— 通过（未求值的插值由渲染结果那条断言管）。`);
