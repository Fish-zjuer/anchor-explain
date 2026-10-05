import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createArchiveStore, parseHistoryMessage } from '../src/session/archive.ts';
import type { ArchiveIO } from '../src/session/archive.ts';
import type { LastRun } from '../src/session/lastRun.ts';

function run(id='run-1', savedAt=100): LastRun {
  return {id,savedAt,updatedAt:savedAt,language:'en',usage:{input:100,output:20,cachedInput:80},
    anchor:{sourceType:'code',sourceId:'hash',sourceName:'main.c',location:{filePath:'C:/repo/main.c',lineStart:1,lineEnd:2}},
    result:{summary:'Summary',title:'Title',confidence:0.8,steps:[{location:{filePath:'C:/repo/main.c',lineStart:1,lineEnd:2},text:'Explain',highlights:[]}]}};
}
function memory() {
  const files = new Map<string,string>();
  const io: ArchiveIO = {list:async()=>[...files.keys()],read:async name=>{if(!files.has(name))throw new Error('ENOENT');return files.get(name)!;},
    writeAtomic:async(name,text)=>{files.set(name,text);},remove:async name=>{files.delete(name);}};
  return {files,io};
}

test('多份完整数据跨 store 重建，倒序列表有标题/时间/步数/用量，重开保留原文与语言', async () => {
  const {io} = memory();
  const first = createArchiveStore(io);
  await first.save(run('old',100)); await first.save(run('new',200));
  const restarted = createArchiveStore(io);
  const items = await restarted.list();
  assert.deepEqual(items.map(i=>i.id), ['new','old']);
  assert.equal(items[0]!.steps, 1);
  assert.deepEqual(items[0]!.usage, {input:100,output:20,cachedInput:80});
  const reopened = await restarted.read('old');
  assert.equal(reopened.result.steps[0]!.text, 'Explain');
  assert.equal(reopened.language, 'en');
  assert.equal(reopened.anchor.sourceName, 'main.c');
});

test('追问保存同一个 ID，不新增历史，原时间保持、用量与步数更新', async () => {
  const {io,files} = memory(); const store=createArchiveStore(io);
  const original=run(); await store.save(original);
  await store.save({...original,updatedAt:500,usage:{input:120,output:25},result:{...original.result,steps:[...original.result.steps,...original.result.steps]}});
  assert.equal(files.size,1);
  const item=(await store.list())[0]!;
  assert.equal(item.savedAt,100); assert.equal(item.updatedAt,500); assert.equal(item.steps,2);
  assert.equal(item.usage?.input,120);
});

test('坏档跳过，其他记录可读；清空只移除安全 JSON 文件', async () => {
  const {io,files}=memory(); const invalid:string[]=[];
  const store=createArchiveStore(io,name=>invalid.push(name)); await store.save(run());
  files.set('broken.json','{'); files.set('foreign.txt','keep'); files.set('run-1.json.tmp','unfinished');
  files.set('../../secret.json','keep');
  assert.equal((await store.list()).length,1); assert.deepEqual(invalid,['broken.json']);
  await store.clear();
  assert.deepEqual([...files.keys()].sort(),['../../secret.json','foreign.txt','run-1.json.tmp'].sort());
});

test('延迟写入与清空串行，旧保存不会把删除的记录复活', async () => {
  const {io,files}=memory(); let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const write=io.writeAtomic;
  io.writeAtomic=async(name,text)=>{await gate;await write(name,text);};
  const store=createArchiveStore(io); const saving=store.save(run()); const clearing=store.clear();
  release(); await Promise.all([saving,clearing]); assert.equal(files.size,0);
});

test('写入失败保留旧档，后续保存仍可执行，入队前冻结结果', async () => {
  const {io}=memory(); const store=createArchiveStore(io); await store.save(run());
  const write=io.writeAtomic; io.writeAtomic=async()=>{throw new Error('disk full');};
  await assert.rejects(store.save({...run(),updatedAt:500}),/disk full/);
  assert.equal((await store.read('run-1')).updatedAt,100);
  io.writeAtomic=write;
  const changed=run(); const saving=store.save(changed); changed.result.steps[0]!.text='mutated';
  await saving; assert.equal((await store.read('run-1')).result.steps[0]!.text,'Explain');
});

test('安全 ID 拒绝目录穿越、任意路径和不匹配档案', async () => {
  const {io,files}=memory(); const store=createArchiveStore(io);
  for (const id of ['../run-1','C:/secret','..','x.json','']) {
    assert.equal(parseHistoryMessage({type:'history:delete',id}),undefined);
    await assert.rejects(store.read(id),/ID/);
  }
  files.set('wrong.json',JSON.stringify({version:1,...run('other')}));
  await assert.rejects(store.read('wrong'),/ID 不匹配/);
});

test('历史消息只有固定动作和安全 ID，可清空空列表，不接受脚本命令', () => {
  assert.deepEqual(parseHistoryMessage({type:'history:open',id:'abc-123'}),{type:'history:open',id:'abc-123'});
  assert.deepEqual(parseHistoryMessage({type:'history:clear'}),{type:'history:clear'});
  assert.equal(parseHistoryMessage({type:'execute',command:'anything'}),undefined);
});
