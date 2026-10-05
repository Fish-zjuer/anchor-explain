import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHandoffDoc } from '../src/external/handoffDoc.ts';
import { snapshotHandoffSelection, sourceSegmentsAnchor } from '../src/external/queueSegments.ts';
import { validateExplanation } from '../src/orchestrator/validateExplanation.ts';

const A = 'C:/repo/a.c';
const B = 'C:/repo/include/b.h';
const doc = buildHandoffDoc([
  { filePath: A, lineStart: 10, lineEnd: 11, text: 'a10\na11', expanded: false },
  { filePath: B, lineStart: 90, lineEnd: 91, text: 'b90\nb91', expanded: false },
]);
const sources = new Map([[A, Array.from({length: 15}, (_, i) => `a${i + 1}`).join('\n')],
  [B, Array.from({length: 100}, (_, i) => `b${i + 1}`).join('\n')]]);

test('临时多选跨 filler 和文件：队列快照只有源坐标与源原文', async () => {
  const reads: string[] = [];
  const segments = await snapshotHandoffSelection(doc, 1, doc.lines.length, async p => {
    reads.push(p); return sources.get(p)!;
  });
  assert.deepEqual(segments.map(s => [s.filePath, s.lineStart, s.lineEnd, s.text]),
    [[A, 10, 11, 'a10\na11'], [B, 90, 91, 'b90\nb91']]);
  assert.deepEqual(reads, [A, B]);
  const anchor = sourceSegmentsAnchor(segments);
  assert.deepEqual(anchor.location, { filePath: A, lineStart: 10, lineEnd: 11 });
  assert.match(anchor.extractedText!, /a\.c 第 10-11 行/);
  assert.match(anchor.extractedText!, /b\.h 第 90-91 行/);
  const result = validateExplanation({summary:'两段',confidence:0.8,steps:[
    {location:{filePath:B,lineStart:90,lineEnd:91},text:'已经选入锚点的头文件',highlights:[]},
  ]}, anchor, {documentLineCount:15});
  assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.issues));
});

test('只选标注/分割线不产生虚假的队列片段，也不读源文件', async () => {
  let reads = 0;
  assert.deepEqual(await snapshotHandoffSelection(doc, 1, 2, async () => { reads++; return ''; }), []);
  assert.equal(reads, 0);
});

test('源文件读失败不返回部分快照；队列调用方可以保持原队列', async () => {
  await assert.rejects(snapshotHandoffSelection(doc, 1, doc.lines.length, async p => {
    if (p === B) throw new Error('ENOENT'); return sources.get(p)!;
  }), /ENOENT/);
});

test('锚点允许已选择的第二个文件，但拒绝未提供的第三个文件', async () => {
  const anchor = sourceSegmentsAnchor(await snapshotHandoffSelection(doc, 1, doc.lines.length, async p => sources.get(p)!));
  assert.equal(validateExplanation({summary:'x',confidence:0.8,steps:[
    {location:{filePath:'C:/repo/other.c',lineStart:1,lineEnd:2},text:'没有读过',highlights:[]},
  ]}, anchor, {documentLineCount:15}).ok, false);
});
