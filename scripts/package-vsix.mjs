#!/usr/bin/env node
/**
 * 打 .vsix 安装包（D85）。用法：
 *
 *   pnpm package:vsix            # 两个都打（线1 + 线2）
 *   pnpm package:vsix line1      # 只打线1
 *   pnpm package:vsix line2      # 只打线2
 *
 * 它做三件事，缺一不可：
 *
 *   1. 调 vsce 打包（每个扩展在自己目录里打，产物落 `release/`）。
 *   2. **把打好的 .vsix 读回来**，逐项核 `必带` 与 `禁带` 两张表。
 *      这一步是重点：`.vscodeignore` 写错时的表现是"包里悄悄多了源码"，
 *      而那种事在事后最难发现 —— 所以判据不读那张排除表，直接读**产物本身**。
 *   3. 把每个 entry 解压出来扫一遍密钥特征（sk- / Bearer / PRIVATE KEY / ...）。
 *      用户的 key 从来不进仓库，但"从来不"要靠断言维持，不能靠记性。
 *
 * 任何一项不过 → 退出码 1。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const vsceEntry = path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce');
const releaseDir = path.join(root, 'release');

/**
 * 禁项。注意这几条禁的是"我们自己的源码/测试"：
 * `assets/pdf.js/**` 里那些 `.mjs` 是**第三方 vendored 运行时**，必须留下（Apache-2.0 允许且有要求），
 * 所以下面按扩展名禁 `.ts` 而不是禁 `.js`，也不要按目录禁 `assets/`。
 */
const FORBIDDEN = [
  { test: /^extension\/src\//, why: '我们的源码' },
  { test: /(^|\/)test\//, why: '测试' },
  { test: /(^|\/)tools\//, why: '工具脚本' },
  { test: /(^|\/)patches\//, why: '上游补丁' },
  { test: /(^|\/)docs\//, why: '文档目录' },
  { test: /(^|\/)node_modules\//, why: '依赖目录' },
  { test: /\.ts$/, why: 'TypeScript 源码' },
  { test: /\.map$/, why: 'source map' },
  { test: /tsconfig/, why: 'tsconfig' },
  { test: /\.tsbuildinfo$/, why: '增量编译缓存' },
  { test: /(^|\/)\.env/, why: '环境/密钥文件' },
  { test: /pnpm-lock\.yaml$/, why: 'lockfile' },
  { test: /\.vsix$/, why: '嵌套安装包' },
  { test: /(^|\/)\.vscode\//, why: '编辑器配置' },
  { test: /\.gitattributes$/, why: 'git 配置' },
  { test: /pdfjs_version\.txt$/, why: '版本戳' },
];

/** 两个扩展各自的"必须带"/"绝不能带"清单。 */
const TARGETS = {
  line1: {
    label: '线1 代码讲解',
    dir: 'packages/extension-anchor',
    /** 必带：包坏了、图标丢了、许可见证没了，都会在这一步红。 */
    required: [
      'extension/package.json',
      'extension/dist/extension.cjs',
      'extension/assets/anchor.svg',
      'extension/media/walkthrough/setup.md',
      'extension/README.md',
      'extension/LICENSE.txt',
      'extension/THIRD_PARTY_NOTICES.md',
    ],
    forbidden: FORBIDDEN,
  },
  line2: {
    label: '线2 PDF 视图',
    dir: 'packages/extension-anchor-pdf',
    required: [
      'extension/package.json',
      'extension/dist/extension.cjs',
      // vsce 会把盘上的 LICENSE 改名成 LICENSE.txt 再放进包里（README.md → readme.md 同理），
      // 所以这里要按**包里**的名字写，不是按盘上的名字写。
      'extension/LICENSE.txt',
      'extension/MODIFICATIONS.md',
      'extension/media/anchor-select.js',
      'extension/assets/main.mjs',
      'extension/assets/main.css',
      'extension/assets/pdf.js/build/pdf.mjs',
      'extension/assets/pdf.js/web/viewer.html',
      'extension/assets/pdf.js/web/viewer.mjs',
      'extension/assets/pdf.js/LICENSE',
    ],
    forbidden: FORBIDDEN,
  },
};

/** 密钥特征。命中即构建失败 —— 宁可误报一次，也不要漏出去一次。 */
const SECRETS = [
  { test: /sk-[A-Za-z0-9]{16,}/, why: 'OpenAI/DeepSeek 风格的 API key' },
  { test: /AIza[0-9A-Za-z_-]{30,}/, why: 'Google API key' },
  { test: /-----BEGIN [A-Z ]{0,24}PRIVATE KEY-----/, why: '私钥' },
  { test: /Bearer\s+[A-Za-z0-9_.-]{20,}/, why: '写死的 Bearer token' },
  { test: /ghp_[A-Za-z0-9]{30,}/, why: 'GitHub token' },
  { test: /xox[baprs]-[A-Za-z0-9-]{10,}/, why: 'Slack token' },
];

// ---------------------------------------------------------------- zip 读取
// 只实现"列目录项 + 取出内容"所需的最小部分（中央目录 + 本地头）。
// 不引第三方库：这个脚本要在没有网络的时候也能解释自己查了什么。

function readZipEntries(buf) {
  // EOCD 签名 0x06054b50，从尾部往前找（zip 注释最长 65535）。
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是合法的 zip：找不到 EOCD');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];

  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`中央目录第 ${i} 项签名不对`);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf, entry) {
  const off = entry.localOffset;
  if (buf.readUInt32LE(off) !== 0x04034b50) throw new Error(`本地头签名不对：${entry.name}`);
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const start = off + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return inflateRawSync(raw);
  throw new Error(`不支持的压缩方式 ${entry.method}：${entry.name}`);
}

// ---------------------------------------------------------------- 主流程

const want = process.argv[2];
const names = want ? [want] : Object.keys(TARGETS);
for (const n of names) {
  if (!TARGETS[n]) {
    console.error(`未知目标 "${n}"。可选：${Object.keys(TARGETS).join(' / ')}`);
    process.exit(1);
  }
}
if (!existsSync(vsceEntry)) {
  console.error(`找不到 vsce（${vsceEntry}）。先在仓库根跑一次 \`pnpm install\`。`);
  process.exit(1);
}
mkdirSync(releaseDir, { recursive: true });

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`  FAIL ${msg}`);
};
const ok = (msg) => console.log(`  ok   ${msg}`);

// 打包前先确认产物在 —— 打了旧产物比没打更坏（D82 的教训）。
for (const n of names) {
  const dist = path.join(root, TARGETS[n].dir, 'dist', 'extension.cjs');
  if (!existsSync(dist)) {
    console.error(`找不到 ${dist}。先跑 \`pnpm build\`（本脚本不替你构建）。`);
    process.exit(1);
  }
}

for (const n of names) {
  const target = TARGETS[n];
  const pkgDir = path.join(root, target.dir);
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const outPath = path.join(releaseDir, `${pkg.name}-${pkg.version}.vsix`);

  console.log(`\n=== ${target.label}（${pkg.name}@${pkg.version}） ===`);

  const res = spawnSync(
    process.execPath,
    [
      vsceEntry,
      'package',
      '--no-dependencies',
      '--skip-license',
      '--allow-missing-repository',
      // README 用**用户版**：仓库里的 README.md 是开发文档（源码入口表、pnpm 命令、切片编号），
      // 那些不该跟着安装包出门。用户版单独一份，在这里指给 vsce（D86）。
      '--readme-path',
      'README.dist.md',
      '--out',
      outPath,
    ],
    { cwd: pkgDir, stdio: 'inherit' },
  );
  if (res.status !== 0) {
    fail(`vsce package 退出码 ${res.status}`);
    continue;
  }

  const buf = readFileSync(outPath);
  const entries = readZipEntries(buf);
  const lower = new Set(entries.map((e) => e.name.toLowerCase()));

  // 1) 结构：VSIX 必须带这两件
  for (const must of ['[Content_Types].xml', 'extension.vsixmanifest']) {
    if (entries.some((e) => e.name === must)) ok(`有 ${must}`);
    else fail(`缺少 ${must}`);
  }
  const inner = entries.filter((e) => e.name.startsWith('extension/'));
  ok(
    `包内 ${entries.length} 个 entry（extension/ 下 ${inner.length} 个），` +
      `${(statSync(outPath).size / 1024).toFixed(0)} KB`,
  );

  // 1b) manifest 里那三行必须和 package.json 对得上（"打了别人的包"/版本发错都会在这一步红）
  const manifest = readEntry(buf, entries.find((e) => e.name === 'extension.vsixmanifest')).toString('utf8');
  for (const [label, attr, value] of [
    ['Id', 'Id', pkg.name],
    ['Version', 'Version', pkg.version],
    ['Publisher', 'Publisher', pkg.publisher],
  ]) {
    if (manifest.includes(`${attr}="${value}"`)) ok(`manifest 的 ${label} = ${value}`);
    else fail(`manifest 里没有 ${attr}="${value}"`);
  }

  // 2) 必带（大小写不敏感：vsce 会把 README.md 落成 readme.md，那不是我们要守的东西）
  for (const req of target.required) {
    if (lower.has(req.toLowerCase())) ok(`必带：${req}`);
    else fail(`必带却缺席：${req}`);
  }

  // 3) 禁带
  const hits = [];
  for (const e of entries) {
    for (const f of target.forbidden) {
      if (f.test.test(e.name)) hits.push({ name: e.name, why: f.why });
    }
  }
  if (hits.length === 0) {
    ok('禁带项：一个都没有（源码 / 测试 / 地图 / 环境文件 / lockfile 全不在包里）');
  } else {
    for (const h of hits.slice(0, 20)) fail(`禁带却出现：${h.name}（${h.why}）`);
    if (hits.length > 20) fail(`……还有 ${hits.length - 20} 条`);
  }

  // 4) 密钥扫描（真解压出来扫，不看文件名猜）
  const found = [];
  for (const e of entries) {
    if (e.uncompressedSize === 0 || e.uncompressedSize > 16 * 1024 * 1024) continue;
    let text;
    try {
      text = readEntry(buf, e).toString('latin1');
    } catch {
      continue; // 读不出来就跳过，不让一个坏 entry 把整轮判死
    }
    for (const s of SECRETS) {
      if (s.test.test(text)) found.push({ name: e.name, why: s.why });
    }
  }
  if (found.length === 0) ok('密钥扫描：sk- / Bearer / 私钥 / 各种 token 特征，一个都没命中');
  else for (const f of found) fail(`疑似密钥：${f.name}（${f.why}）`);

  console.log(`  -> ${path.relative(root, outPath)}`);
}

console.log('');
if (failures > 0) {
  console.error(`打包校验未通过：${failures} 项。产物已留在 release/，但不要分发。`);
  process.exit(1);
}
console.log('通过：结构 / 必带 / 禁带 / 密钥扫描。产物在 release/。');
