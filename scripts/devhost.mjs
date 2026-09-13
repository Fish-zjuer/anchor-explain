/**
 * 起扩展开发宿主 —— **用绝对路径**。
 *
 * @anchor 为什么不能直接写 `code --extensionDevelopmentPath=packages/extension-anchor`（相对路径）：
 *         `code` CLI 只是把参数转交给**已经在跑的那个 VS Code 实例**（IPC），而**它不传 CWD**。
 *         于是相对路径在对面按它自己的工作目录解析。实测拿到的就是这一行（VS Code 的 renderer.log）：
 *
 *           Error scanning extensions at /packages/extension-anchor: 无法解析不存在的文件 '\packages\extension-anchor'
 *
 *         症状是本项目里最难往回追的一类：**窗口照开、一切正常、就是没有那个扩展** ——
 *         没有活动栏图标、命令面板搜不到 Anchor，而且**不弹任何错**（D59）。
 *         所以路径在这里算成绝对的，而且**起之前先把"能不能起"查清楚**。
 *
 * 用法：
 *   node scripts/devhost.mjs            # 线1（代码编辑器）
 *   node scripts/devhost.mjs line2      # 线2（PDF 视图）
 *   node scripts/devhost.mjs --dry      # 只打印将要执行的命令，不启动
 *
 * 说明：这里的 `code` 依赖 PATH 里的 VS Code CLI。没有它的话，在 VS Code 里执行
 *      「Shell 命令: 在 PATH 中安装 code 命令」，或者用 F5（`.vscode/launch.json` 用的是
 *      `${workspaceFolder}` 展开出的绝对路径，本来就没这个问题）。
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const which = process.argv.includes('line2') ? 'extension-anchor-pdf' : 'extension-anchor';

const extensionPath = join(root, 'packages', which);
const artifact = join(extensionPath, 'dist', 'extension.cjs');
const fixturePath = join(root, 'test', 'fixtures');

/** 起宿主前先查清楚。这些错误在 VS Code 那边**全是静默的**，所以在这里说清。 */
const problems = [];
if (!existsSync(join(extensionPath, 'package.json'))) {
  problems.push(`扩展目录里没有 package.json：${extensionPath}`);
}
if (!existsSync(artifact)) {
  problems.push(`产物不在：${artifact}（先跑 pnpm build）`);
}
if (!existsSync(fixturePath)) {
  problems.push(`样本目录不在：${fixturePath}`);
}
if (problems.length > 0) {
  for (const problem of problems) console.error(`[devhost] ${problem}`);
  process.exit(1);
}

// 引号是给 shell 的（Windows 上是 cmd.exe）：路径里出现空格时不能靠运气
const command = ['code', `"--extensionDevelopmentPath=${extensionPath}"`, `"${fixturePath}"`].join(' ');
console.log(`[devhost] ${which}`);
console.log(`[devhost] ${command}`);

if (process.argv.includes('--dry')) process.exit(0);

spawn(command, { stdio: 'inherit', shell: true }).on('exit', (code) => {
  if (code === 0) return;
  console.error(
    `[devhost] code 退出码 ${code}。最可能的原因是 VS Code CLI 不在 PATH 里：` +
      '在 VS Code 里执行「Shell 命令: 在 PATH 中安装 code 命令」，或改用 F5。',
  );
  process.exit(code ?? 1);
});
