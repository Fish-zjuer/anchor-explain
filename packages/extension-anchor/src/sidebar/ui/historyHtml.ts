/** S13 历史 UI：只有常量 HTML，记录经消息传入并用 textContent 渲染。 */
export function historyHtml(cspSource: string, nonce: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>讲解历史</title>
<style>
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:20px}
header{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:20px}h1{font-size:20px;margin:0;flex:1}button{font:inherit;cursor:pointer;border:1px solid var(--vscode-button-border,transparent);border-radius:4px;padding:7px 11px;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}button:hover{background:var(--vscode-button-hoverBackground)}button:disabled{opacity:.45;cursor:default}.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}.entry{border:1px solid var(--vscode-widget-border);border-radius:6px;padding:14px;margin-bottom:10px;display:flex;gap:16px;align-items:center}.body{flex:1;min-width:0}.title{font-weight:600;overflow-wrap:anywhere}.meta{color:var(--vscode-descriptionForeground);margin-top:7px;line-height:1.6}.actions{display:flex;gap:7px}.empty{color:var(--vscode-descriptionForeground);padding:24px 0}#status{margin-bottom:14px;white-space:pre-wrap}#status.error{color:var(--vscode-errorForeground)}
</style></head><body><header><h1>讲解历史 <span id="count"></span></h1><button data-action="refresh" class="secondary">刷新</button><button data-action="folder" class="secondary">Markdown 文件夹</button><button data-action="clear" class="secondary" id="clear">清空历史</button></header><div id="status" role="status">正在读取历史…</div><main id="list"></main>
<script nonce="${nonce}">
(function(){
var api=acquireVsCodeApi(), entries=[], busy=false, canClear=false;
function el(tag, cls, text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;}
function usage(u){if(!u)return '用量未提供';var values=[];[['输入',u.input],['输出',u.output],['缓存命中',u.cachedInput]].forEach(function(p){if(typeof p[1]==='number')values.push(p[0]+' '+p[1]);});return values.length?values.join(' · ')+' token':'用量未提供';}
function render(){var list=document.getElementById('list');list.textContent='';document.getElementById('count').textContent='('+entries.length+')';document.getElementById('clear').disabled=busy||(!entries.length&&!canClear);
if(!entries.length)list.appendChild(el('p','empty','还没有完整讲解留档。成功讲解一次后就会出现在这里。'));
entries.forEach(function(item){var row=el('article','entry'), body=el('div','body');body.appendChild(el('div','title',item.title));body.appendChild(el('div','meta',new Date(item.savedAt).toLocaleString()+' · '+item.steps+' 步 · '+(item.language==='en'?'English':'中文')+' · '+item.sourceName));body.appendChild(el('div','meta',usage(item.usage)));row.appendChild(body);var actions=el('div','actions');[['open','重新打开'],['delete','删除']].forEach(function(a){var btn=el('button',a[0]==='delete'?'secondary':'',a[1]);btn.dataset.action=a[0];btn.dataset.id=item.id;btn.disabled=busy;actions.appendChild(btn);});row.appendChild(actions);list.appendChild(row);});}
document.addEventListener('click',function(event){var button=event.target.closest('button[data-action]');if(!button||button.disabled||busy)return;api.postMessage({type:'history:'+button.dataset.action,id:button.dataset.id});});
window.addEventListener('message',function(event){var msg=event.data;if(!msg||msg.type!=='history:list')return;entries=Array.isArray(msg.entries)?msg.entries:[];busy=Boolean(msg.busy);canClear=Boolean(msg.canClear);var status=document.getElementById('status');status.textContent=msg.error||msg.note||'';status.className=msg.error?'error':'';render();});
api.postMessage({type:'history:ready'});
})();
</script></body></html>`;
}

