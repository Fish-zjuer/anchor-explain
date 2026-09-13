/**
 * 把两个扩展**装进你平时的 VS Code**（目录联接），让它们像别的插件一样常驻 ——
 * 不用起开发宿主、不用按 F5、不用敲任何命令。
 *
 * @anchor 为什么是联接而不是 `.vsix`：
 *   1. 打 vsix 要装 `@vscode/vsce`（多一个工具、还要联网），而联接只用 `node:fs`；
 *   2. 更要紧的是**改一次代码的成本**：vsix 要重打重装，联接只要 `pnpm build` + 重新加载窗口；
 *   3. Windows 上 **junction 不需要管理员权限**（symlink 需要，这是选 junction 的唯一原因）。
 *   代价如实说：**仓库不能挪走**（联接指向仓库里的目录），而且改完代码必须 `pnpm build`
 *   才会生效（VS Code 读的就是 `dist/extension.cjs`）。
 *
 * 用法：
 *   node scripts/link-extension.mjs              # 装（线1 + 线2）
 *   node scripts/link-extension.mjs line1        # 只装线1
 *   node scripts/link-extension.mjs line2        # 只装线2
 *   node scripts/link-extension.mjs --uninstall  # 卸载（**只删我们自己建的联接**）
 *   node scripts/link-extension.mjs --dry        # 只打印会做什么，不动手
 *
 * 装完要**重启 VS Code**（或命令面板 →「开发人员: 重新加载窗口」）。之后活动栏就有 Anchor 图标，
 * 每次打开都在 —— 因为那时它是一个"已安装的扩展"，不再是开发宿主里的临时扩展。
 */

import { existsSync, lstatSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const uninstall = argv.includes('--uninstall');

/** 扩展目录：优先 `--extensions-dir=`，其次 `VSCODE_EXTENSIONS`（VS Code 给子进程设的那个），再次按平台默认。 */
function extensionsDir() {
  const explicit = argv.find((a) => a.startsWith('--extensions-dir='));
  if (explicit) return explicit.slice('--extensions-dir='.length);
  if (process.env.VSCODE_EXTENSIONS) return process.env.VSCODE_EXTENSIONS;
  // Insiders 用的是 .vscode-insiders，要装到那边就自己传 --extensions-dir
  return join(homedir(), '.vscode', 'extensions');
}

const TARGETS = [
  { flag: 'line1', dir: 'extension-anchor' },
  { flag: 'line2', dir: 'extension-anchor-pdf' },
];

const wanted = TARGETS.filter((t) => !argv.some((a) => ['line1', 'line2'].includes(a)) || argv.includes(t.flag));
const target = extensionsDir();
const isWindows = process.platform === 'win32';

console.log(`[link] 扩展目录：${target}`);
if (!existsSync(target)) {
  console.error(
    `[link] 这个目录不存在：${target}\n` +
      '       说明这台机器上的 VS Code 从没用过（或者用的是 Insiders / 便携版）。\n' +
      '       先用 VS Code 打开一次任意文件夹，它就会建好这个目录；\n' +
      '       或者显式指定：node scripts/link-extension.mjs --extensions-dir=<你的扩展目录>',
  );
  process.exit(1);
}

let failed = 0;

for (const { dir } of wanted) {
  const source = join(root, 'packages', dir);
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  const id = `${manifest.publisher}.${manifest.name}`;
  // 目录名用 VS Code 的约定（publisher.name-version）：不这样的话它会当成"版本未知"
  const link = join(target, `${id}-${manifest.version}`);

  if (!existsSync(join(source, 'dist', 'extension.cjs'))) {
    console.error(`[link] ${id}：产物不在（${join(source, 'dist', 'extension.cjs')}），先跑 pnpm build`);
    failed += 1;
    continue;
  }

  const exists = existsSync(link) || isLink(link);
  const ours = exists && pointsAt(link, source);

  if (uninstall) {
    if (!exists) {
      console.log(`[link] ${id}：没装（${link} 不存在）`);
    } else if (!ours) {
      // **绝不删**：那可能是用户自己装的正式版本，或者是别的东西
      console.error(`[link] ${id}：${link} 存在，但它不是我们建的联接 —— 没有动它，请自己确认`);
      failed += 1;
    } else if (dry) {
      console.log(`[link] ${id}：会删除联接 ${link}（不会碰仓库里的源码）`);
    } else {
      remove(link);
      console.log(`[link] ${id}：已卸载（${link}）`);
    }
    continue;
  }

  if (ours) {
    console.log(`[link] ${id}：已装（${link} → ${source}）`);
    continue;
  }
  if (exists) {
    console.error(
      `[link] ${id}：${link} 已经存在，**不是**我们建的联接 —— 没有动它。\n` +
        '       它可能是你以前正式装过的同名扩展：两种方式装同一份扩展会打架，\n' +
        '       先用 VS Code 把那个卸载掉（或删掉这个目录）再来。',
    );
    failed += 1;
    continue;
  }

  if (dry) {
    console.log(`[link] ${id}：会建联接 ${link} → ${source}`);
    continue;
  }

  symlinkSync(source, link, isWindows ? 'junction' : 'dir');
  console.log(`[link] ${id}：已装 ${link} → ${source}`);
}

if (failed === 0 && !dry) {
  console.log(
    '\n[link] 下一步：**重启 VS Code**（或命令面板 →「开发人员: 重新加载窗口」）。\n' +
      '[link] 之后活动栏就有 Anchor 图标，每次打开都在 —— 不用再起开发宿主。\n' +
      '[link] 改了代码：pnpm build → 重新加载窗口。撤掉这次安装：pnpm unlink:ext。',
  );
}

process.exit(failed === 0 ? 0 : 1);

function isLink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** 联接指向的正是仓库里那个目录吗（Windows 的 junction 读出来是 `\??\C:\...` 这种形状，要归一） */
function pointsAt(link, source) {
  try {
    const raw = readlinkSync(link).replace(/^\\\\\?\\/, '');
    return raw.toLowerCase() === source.toLowerCase();
  } catch {
    return false;
  }
}

/** 只删联接本身。**绝不递归**：写错一个参数就会把仓库里的源码删掉，这种事不该有机会发生。 */
function remove(link) {
  if (isWindows) unlinkSync(link);
  else rmSync(link, { recursive: false });
}
