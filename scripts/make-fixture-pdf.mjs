/**
 * 生成 30 页固定内容的 PDF —— S5（框选）/ S6（Anchor）/ S7（取件）的验收样本。
 *
 * 零依赖：直接按 PDF 1.4 语法拼字节。
 * xref 偏移**不靠事后回算**，而是在写每一段时累加已写字节数得到；
 * 又因为一律用 latin1 编码（1 字符 = 1 字节），偏移与字符下标天然一致。
 * 写完还会自校验两件事：每个偏移处确实躺着 `<n> 0 obj`，且打印出的 xref 表与内存一致。
 *
 * 用法：
 *   node scripts/make-fixture-pdf.mjs           生成并自校验
 *   node scripts/make-fixture-pdf.mjs --check   只校验磁盘上已有的文件
 *
 * 注意：PDF 正文全是 ASCII。样本没嵌字体，塞中文只会得到一堆乱码方块。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test', 'fixtures', 'sample-30p.pdf');

export const PAGE_COUNT = 30;
const PAGE_W = 595;
const PAGE_H = 842;

// 对象编号规划（固定，xref 表依赖它）：
//   1 = Catalog，2 = Pages，3 = Helvetica 字体
//   4 + 2*(n-1) = 第 n 页的 Page 对象，5 + 2*(n-1) = 第 n 页的 Contents
const OBJ_CATALOG = 1;
const OBJ_PAGES = 2;
const OBJ_FONT = 3;
const OBJ_TOTAL = 3 + 2 * PAGE_COUNT;

const pageObj = (n) => 4 + 2 * (n - 1);
const contentObj = (n) => 5 + 2 * (n - 1);

/** 每页出现三次的标记串，供 S7 断言「确实取到了第 N 页的正文」 */
export function pageMarker(n) {
  return `PAGE-${String(n).padStart(2, '0')}`;
}

function contentStream(n) {
  const m = pageMarker(n);
  const nn = String(n).padStart(2, '0');
  return [
    'BT',
    '/F1 20 Tf',
    '64 770 Td',
    `(Anchor Explain Fixture -- Page ${nn} / ${PAGE_COUNT}) Tj`,
    'ET',
    'BT',
    '/F1 12 Tf',
    '64 726 Td',
    '16 TL',
    `(Section ${nn}.1 -- Overview) Tj`,
    `(This paragraph belongs to page ${nn} of the fixture PDF.) Tj`,
    '(It exists so that the page_range fetch can be verified end to end.) Tj',
    `(Marker ${m} appears three times on this page.) Tj`,
    `(${m} second occurrence -- inside the body block.) Tj`,
    `(${m} third occurrence -- closing the body block.) Tj`,
    'ET',
    'BT',
    '/F1 9 Tf',
    '64 60 Td',
    `(Anchor Explain fixture -- ${m} footer) Tj`,
    'ET',
  ].join('\n');
}

function build() {
  const chunks = [];
  let offset = 0;

  function put(str) {
    const buf = Buffer.from(str, 'latin1');
    chunks.push(buf);
    offset += buf.length;
  }

  const offsets = new Array(OBJ_TOTAL + 1).fill(0);

  function obj(num, body) {
    offsets[num] = offset;
    put(`${num} 0 obj\n${body}\nendobj\n`);
  }

  put('%PDF-1.4\n');
  // 二进制标记注释：让工具把文件当二进制处理，别做换行转换
  put('%\u00E2\u00E3\u00CF\u00D3\n');

  obj(OBJ_CATALOG, `<< /Type /Catalog /Pages ${OBJ_PAGES} 0 R >>`);

  const kids = [];
  for (let n = 1; n <= PAGE_COUNT; n++) kids.push(`${pageObj(n)} 0 R`);
  obj(OBJ_PAGES, `<< /Type /Pages /Count ${PAGE_COUNT} /Kids [${kids.join(' ')}] >>`);

  obj(OBJ_FONT, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  for (let n = 1; n <= PAGE_COUNT; n++) {
    const content = contentStream(n);
    obj(
      pageObj(n),
      `<< /Type /Page /Parent ${OBJ_PAGES} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 ${OBJ_FONT} 0 R >> >> /Contents ${contentObj(n)} 0 R >>`,
    );
    obj(contentObj(n), `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
  }

  const xrefStart = offset;
  put(`xref\n0 ${OBJ_TOTAL + 1}\n`);
  put('0000000000 65535 f \n');
  for (let n = 1; n <= OBJ_TOTAL; n++) put(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  put(`trailer\n<< /Size ${OBJ_TOTAL + 1} /Root ${OBJ_CATALOG} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  return { bytes: Buffer.concat(chunks), offsets, xrefStart, objectCount: OBJ_TOTAL };
}

/** 自校验：偏移是否指向正确的对象头，打印出的 xref 表是否与内存一致 */
function verify(bytes, expected) {
  const problems = [];
  const text = bytes.toString('latin1');
  const total = expected?.objectCount ?? OBJ_TOTAL;

  // 1) 打印出来的 xref 表必须与构造时的偏移逐行一致
  const head = text.lastIndexOf(`xref\n0 ${total + 1}\n`);
  if (head < 0) {
    problems.push(`找不到 xref 表头（期望 "xref\\n0 ${total + 1}"）`);
  } else {
    const tableStart = head + `xref\n0 ${total + 1}\n`.length;
    const lines = text.slice(tableStart, text.indexOf('trailer', tableStart)).split('\n');
    if (lines[0] !== '0000000000 65535 f ') problems.push(`首个空闲项应为 20 字节的 "0000000000 65535 f "，实际 ${JSON.stringify(lines[0])}`);
    for (let n = 1; n <= total; n++) {
      const line = lines[n];
      if (line === undefined) {
        problems.push(`xref 表缺少第 ${n} 项`);
        break;
      }
      if (line.length !== 19) problems.push(`xref 第 ${n} 项去掉换行后应为 19 字节，实际 ${line.length}`);
      const declared = Number.parseInt(line.slice(0, 10), 10);
      if (expected && declared !== expected.offsets[n]) {
        problems.push(`xref 第 ${n} 项偏移 ${declared} 与构造时的 ${expected.offsets[n]} 不符`);
      }
      const at = bytes.subarray(declared, declared + 24).toString('latin1');
      if (!at.startsWith(`${n} 0 obj`)) {
        problems.push(`偏移 ${declared} 处不是 "${n} 0 obj"，实际 ${JSON.stringify(at.slice(0, 24))}`);
      }
    }
  }

  // 2) 基本结构
  if (!text.startsWith('%PDF-1.4\n')) problems.push('缺少 %PDF-1.4 头');
  if (!text.endsWith('%%EOF\n')) problems.push('文件未以 %%EOF 结束');
  if (!text.includes(`/Count ${PAGE_COUNT}`)) problems.push(`缺少 /Count ${PAGE_COUNT}`);
  if (!text.includes(`/Root ${OBJ_CATALOG} 0 R`)) problems.push('trailer 缺少 /Root');

  return problems;
}

const checkOnly = process.argv.includes('--check');

if (checkOnly) {
  const bytes = readFileSync(OUT);
  const problems = verify(bytes);
  if (problems.length) {
    console.error(`[fixture] 校验失败（${OUT}）：`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`[fixture] 校验通过：${PAGE_COUNT} 页，${bytes.length} 字节 —— ${OUT}`);
} else {
  const { bytes, offsets, xrefStart, objectCount } = build();
  const problems = verify(bytes, { offsets, objectCount });
  if (problems.length) {
    console.error('[fixture] 自校验失败，未写盘：');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, bytes);
  console.log(
    `[fixture] 已生成 ${PAGE_COUNT} 页 / ${objectCount} 个对象 / ${bytes.length} 字节，xref @${xrefStart}\n` +
      `          ${OUT}`,
  );
}
