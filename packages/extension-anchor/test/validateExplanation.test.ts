/**
 * 输出校验闸门（§3.3）的单测。
 *
 * 这里最有价值的一条是「真替身的输出能过闸门」：它同时钉住了
 * `fakes/fakeProvider.ts` 的行号、锚点文件、两层 step 模型三件事。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isCodeLocation } from '@anchor/core';
import type { Anchor } from '@anchor/core';
import { fakeProvider } from '@anchor/core/fakes/fakeProvider';
import { countTextLines } from '../src/paths.ts';
import { describeIssues, parseMaybeJson, validateExplanation } from '../src/orchestrator/validateExplanation.ts';

const MAIN_C = new URL('../../../test/fixtures/main.c', import.meta.url);
const DOC_LINES = countTextLines(readFileSync(MAIN_C, 'utf8'));
const FILE_PATH = 'C:\\repo\\test\\fixtures\\main.c';

function codeAnchor(): Anchor {
  return {
    sourceType: 'code',
    sourceId: 'hash-1',
    sourceName: 'main.c',
    location: { filePath: FILE_PATH, lineStart: 40, lineEnd: 48 },
    extractedText: 'static int rb_pop(ring_buffer_t *rb, int *out)',
  };
}

function codeResult(): Record<string, unknown> {
  return {
    steps: [
      {
        location: { filePath: FILE_PATH, lineStart: 40, lineEnd: 42 },
        text: '第 40 行是函数签名。',
        title: '出队前先挡住空队列',
        highlights: [
          { location: { filePath: FILE_PATH, lineStart: 42, lineEnd: 42 }, narration: '空队列返回 -1。', emphasis: 'caveat' },
        ],
      },
    ],
    summary: '这一段是环形队列的出队路径。',
    confidence: 0.9,
  };
}

test('主路径：真替身（fakeProvider）的整段输出能过闸门', async () => {
  const anchor = codeAnchor();
  const produced = await fakeProvider(anchor);
  const verdict = validateExplanation(produced, anchor, { documentLineCount: DOC_LINES });

  assert.equal(verdict.ok, true, verdict.ok ? '' : describeIssues(verdict.issues));
  if (!verdict.ok) return;

  // 三个 step、每个 step 都带两层模型，且都落在锚点的 40-48 行内
  assert.equal(verdict.result.steps.length, 3);
  for (const step of verdict.result.steps) {
    const loc = step.location;
    // 用真守门函数，不用 `'filePath' in loc`：S7 给 PDFLocation 也加了可选的 filePath
    // （为了让线1 能按路径去读 PDF），于是"有没有 filePath"**不再等于**"是不是代码位置"。
    assert.ok(isCodeLocation(loc), '代码锚点的 location 必须是 CodeLocation');
    if (!isCodeLocation(loc)) continue;
    assert.equal(loc.filePath, FILE_PATH);
    assert.ok(step.title && step.intro && step.text);
    assert.ok((step.highlights ?? []).length > 0);
    assert.ok(loc.lineStart >= 40 && loc.lineEnd <= 48);
  }
});

test('主路径：行数上界用真 main.c 的行数，末行不越界', () => {
  const anchor = codeAnchor();
  const raw = codeResult();
  (raw.steps as Record<string, unknown>[])[0]!.location = {
    filePath: FILE_PATH,
    lineStart: DOC_LINES,
    lineEnd: DOC_LINES,
  };
  assert.equal(validateExplanation(raw, anchor, { documentLineCount: DOC_LINES }).ok, true);
});

test('容错：```json 围栏与前后散文都能抽出来', () => {
  const body = JSON.stringify(codeResult());
  const fenced = '好的，我的讲解如下：\n```json\n' + body + '\n```\n希望有帮助！';
  const verdict = validateExplanation(fenced, codeAnchor(), { documentLineCount: DOC_LINES });
  assert.equal(verdict.ok, true, verdict.ok ? '' : describeIssues(verdict.issues));
});

test('容错：裸围栏、纯 JSON、以及没围栏的散文包裹', () => {
  const body = JSON.stringify(codeResult());
  for (const raw of [body, '```\n' + body + '\n```', '这里是结果：' + body + ' 完']) {
    assert.equal(validateExplanation(raw, codeAnchor(), { documentLineCount: DOC_LINES }).ok, true);
  }
});

test('拒绝：空字符串与解析不出 JSON 的文本', () => {
  for (const raw of ['', '   ', '我说了一大段话但没有 JSON']) {
    const verdict = validateExplanation(raw, codeAnchor(), { documentLineCount: DOC_LINES });
    assert.equal(verdict.ok, false);
    assert.match(describeIssues(verdict.issues), /JSON|空内容/);
  }
});

test('拒绝：模型漫游到别的文件', () => {
  const raw = codeResult();
  (raw.steps as Record<string, unknown>[])[0]!.location = {
    filePath: 'C:\\repo\\test\\fixtures\\other.c',
    lineStart: 1,
    lineEnd: 2,
  };
  const verdict = validateExplanation(raw, codeAnchor(), { documentLineCount: DOC_LINES });
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.match(describeIssues(verdict.issues), /不允许漫游到别的文件/);
});

test('拒绝：行号越界 / 区间反了 / 非整数', () => {
  const cases: unknown[] = [
    { filePath: FILE_PATH, lineStart: 1, lineEnd: DOC_LINES + 1 },
    { filePath: FILE_PATH, lineStart: 48, lineEnd: 40 },
    { filePath: FILE_PATH, lineStart: 0, lineEnd: 3 },
    { filePath: FILE_PATH, lineStart: 1.5, lineEnd: 3 },
  ];
  for (const location of cases) {
    const raw = codeResult();
    (raw.steps as Record<string, unknown>[])[0]!.location = location;
    assert.equal(validateExplanation(raw, codeAnchor(), { documentLineCount: DOC_LINES }).ok, false);
  }
});

test('拒绝：steps / summary / confidence 三项信封不合格', () => {
  const bad: Record<string, unknown>[] = [
    { ...codeResult(), steps: [] },
    { ...codeResult(), steps: '不是数组' },
    { ...codeResult(), summary: '' },
    { ...codeResult(), confidence: 1.5 },
    { ...codeResult(), confidence: '0.9' },
  ];
  for (const raw of bad) {
    assert.equal(validateExplanation(raw, codeAnchor(), { documentLineCount: DOC_LINES }).ok, false);
  }
});

test('拒绝：step 少了 text', () => {
  const raw = codeResult();
  const steps = raw.steps as Record<string, unknown>[];
  const { text, ...withoutText } = steps[0]!;
  void text;
  steps[0] = withoutText;

  const verdict = validateExplanation(raw, codeAnchor(), { documentLineCount: DOC_LINES });
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.match(describeIssues(verdict.issues), /text/);
});

test('PDF 分支：bbox 越界 / 退化 / 带 NaN 一律拒绝', () => {
  const pdfAnchor: Anchor = {
    sourceType: 'pdf',
    sourceId: 'pdf-1',
    sourceName: 'sample.pdf',
    location: { page: 23, bbox: [0.1, 0.1, 0.5, 0.2] },
  };
  const withBBox = (bbox: unknown): Record<string, unknown> => ({
    steps: [{ location: { page: 23, bbox }, text: '这段在讲第 23 页。' }],
    summary: 'PDF 讲解。',
    confidence: 0.7,
  });

  assert.equal(validateExplanation(withBBox([0.1, 0.1, 0.5, 0.2]), pdfAnchor, { pageCount: 30 }).ok, true);
  for (const bbox of [
    [0.1, 0.1, 1.5, 0.2],
    [0.5, 0.1, 0.5, 0.2],
    [0.1, 0.1, 0.5, 0.1],
    [0.1, 0.1, Number.NaN, 0.2],
    [0.1, 0.1, 0.5],
    'nope',
  ]) {
    assert.equal(validateExplanation(withBBox(bbox), pdfAnchor, { pageCount: 30 }).ok, false, JSON.stringify(bbox));
  }
});

test('PDF 分支：页码越界与 0 页拒绝', () => {
  const pdfAnchor: Anchor = {
    sourceType: 'pdf',
    sourceId: 'pdf-1',
    sourceName: 'sample.pdf',
    location: { page: 23, bbox: [0.1, 0.1, 0.5, 0.2] },
  };
  for (const page of [0, 31, 2.5]) {
    const raw = {
      steps: [{ location: { page, bbox: [0.1, 0.1, 0.5, 0.2] }, text: 'x' }],
      summary: 's',
      confidence: 0.5,
    };
    assert.equal(validateExplanation(raw, pdfAnchor, { pageCount: 30 }).ok, false, `page=${page}`);
  }
});

test('来源不匹配：代码锚点里混进 PDF 位置（反之亦然）', () => {
  const raw = codeResult();
  (raw.steps as Record<string, unknown>[])[0]!.location = { page: 3, bbox: [0.1, 0.1, 0.4, 0.4] };
  assert.equal(validateExplanation(raw, codeAnchor(), { documentLineCount: DOC_LINES }).ok, false);
});

test('emphasis 未知值降级而不是判失败（配色是装饰性字段）', () => {
  const raw = codeResult();
  const step = (raw.steps as Record<string, unknown>[])[0]!;
  (step.highlights as Record<string, unknown>[])[0]!.emphasis = 'IMPORTANT';
  const verdict = validateExplanation(raw, codeAnchor(), { documentLineCount: DOC_LINES });
  assert.equal(verdict.ok, true);
  if (!verdict.ok) return;
  assert.equal(verdict.result.steps[0]!.highlights![0]!.emphasis, undefined);
});

test('重建：模型多塞的键不会流到渲染层', () => {
  const raw = codeResult();
  const step = (raw.steps as Record<string, unknown>[])[0]!;
  step.__proto__free = 'neak';
  step.injected = 'should-not-survive';
  (step.highlights as Record<string, unknown>[])[0]!.extra = 1;

  const verdict = validateExplanation(raw, codeAnchor(), { documentLineCount: DOC_LINES });
  assert.equal(verdict.ok, true);
  if (!verdict.ok) return;

  const clean = verdict.result.steps[0]!;
  // codeResult() 的 step 没有 intro，所以重建结果里也不该凭空多出这个键
  assert.deepEqual(Object.keys(clean).sort(), ['highlights', 'location', 'text', 'title']);
  assert.deepEqual(Object.keys(clean.highlights![0]!).sort(), ['emphasis', 'location', 'narration']);
});

test('parseMaybeJson 已经解析好的对象原样返回', () => {
  const obj = { a: 1 };
  const parsed = parseMaybeJson(obj);
  assert.ok('value' in parsed && parsed.value === obj);
});

test('文档行数取不到（null）时跳过上界检查，但其余校验照旧', () => {
  const wayPast = codeResult();
  (wayPast.steps as Record<string, unknown>[])[0]!.location = { filePath: FILE_PATH, lineStart: 9999, lineEnd: 99999 };
  assert.equal(validateExplanation(wayPast, codeAnchor(), { documentLineCount: null }).ok, true);

  const negative = codeResult();
  (negative.steps as Record<string, unknown>[])[0]!.location = { filePath: FILE_PATH, lineStart: -1, lineEnd: 5 };
  assert.equal(validateExplanation(negative, codeAnchor(), { documentLineCount: null }).ok, false);
});
