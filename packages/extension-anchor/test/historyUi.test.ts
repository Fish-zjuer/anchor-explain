import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { historyHtml } from '../src/sidebar/ui/historyHtml.ts';

class Node {
  children: Node[]=[]; dataset:Record<string,string>={}; disabled=false; className='';
  #text='';
  readonly tag:string;
  constructor(tag:string){this.tag=tag;}
  get textContent(){return this.#text;}
  set textContent(text:string){this.#text=text;this.children=[];}
  appendChild(node:Node){this.children.push(node);return node;}
  closest(){return this;}
}
function ui(){
  const roots=new Map(['list','count','clear','status'].map(id=>[id,new Node(id)]));
  const messages:Record<string,unknown>[]=[];const handlers=new Map<string,(e:unknown)=>void>();
  const html=historyHtml('vscode-webview:','test-nonce');
  const code=/<script nonce="test-nonce">([\s\S]*?)<\/script>/.exec(html)![1]!;
  runInNewContext(code,{acquireVsCodeApi:()=>({postMessage:(m:Record<string,unknown>)=>messages.push(m)}),
    document:{getElementById:(id:string)=>roots.get(id),createElement:(tag:string)=>new Node(tag),
      addEventListener:(name:string,cb:(e:unknown)=>void)=>handlers.set(name,cb)},
    window:{addEventListener:(name:string,cb:(e:unknown)=>void)=>handlers.set(name,cb)},
  });
  const all=(node:Node):Node[]=>[node,...node.children.flatMap(all)];
  return {html,roots,messages,handlers,all};
}

test('历史页面启动握手、CSP 与脚本能运行',()=>{
  const app=ui();
  assert.equal(app.messages[0]?.type,'history:ready');
  assert.match(app.html,/default-src 'none'/);
  assert.match(app.html,/script-src 'nonce-test-nonce'/);
});

test('记录经 DOM textContent 展示，标题不成为 HTML；重开只发送安全 ID',()=>{
  const app=ui();const title='<img src=x onerror=alert(1)>';
  app.handlers.get('message')!({data:{type:'history:list',entries:[{id:'run-1',title,sourceName:'main.c',savedAt:100,steps:2,language:'en',usage:{input:15,output:3}}]}});
  const nodes=app.all(app.roots.get('list')!);
  assert.ok(nodes.some(n=>n.textContent===title));assert.ok(!nodes.some(n=>n.tag==='img'));
  assert.ok(nodes.some(n=>n.textContent.includes('2 步')));
  assert.ok(nodes.some(n=>n.textContent.includes('输入 15')));
  const open=nodes.find(n=>n.dataset.action==='open')!;
  app.handlers.get('click')!({target:open});
  assert.equal(app.messages.at(-1)?.type,'history:open');assert.equal(app.messages.at(-1)?.id,'run-1');
});

test('空列表有下一步提示，忙时不能重复删除，错误可见',()=>{
  const app=ui();app.handlers.get('message')!({data:{type:'history:list',entries:[]}});
  assert.equal(app.roots.get('clear')!.disabled,true);
  assert.match(app.roots.get('list')!.children[0]!.textContent,/成功讲解一次/);
  app.handlers.get('message')!({data:{type:'history:list',busy:true,error:'磁盘不可写',entries:[{id:'run-1',title:'T',savedAt:100,steps:1,sourceName:'a.c'}]}});
  const button=app.all(app.roots.get('list')!).find(n=>n.dataset.action==='delete')!;
  const count=app.messages.length;app.handlers.get('click')!({target:button});assert.equal(app.messages.length,count);
  assert.equal(app.roots.get('status')!.textContent,'磁盘不可写');
});

test('只有损坏记录时仍能清空，不能被空列表禁用挡住',()=>{
  const app=ui();app.handlers.get('message')!({data:{type:'history:list',entries:[],canClear:true,note:'1 份损坏记录'}});
  assert.equal(app.roots.get('clear')!.disabled,false);
});
