export function projectView(){
 let context=null,next=0;const requests=new Map();
 const post=data=>parent.postMessage({...data,projectId:context?.project.id,session:context?.session},location.origin);
 window.addEventListener('message',event=>{if(event.source!==parent||event.origin!==location.origin)return;const data=event.data;
  if(data.type==='project:restore'){context={project:data.project,session:data.session};document.body.classList.add('project-mode');window.dispatchEvent(new CustomEvent('project-restore',{detail:context}));}
  if(data.type==='project:command-response'){const item=requests.get(data.requestId);if(!item)return;clearTimeout(item.timeout);requests.delete(data.requestId);if(data.payload?.project)context={project:data.payload.project,session:data.payload.session};data.error?item.reject(Error(data.error)):item.resolve(data.payload);}
  if(context&&(data.projectId!==context.project.id||data.session!==context.session))return;
  if(data.type==='project:snapshot-request')window.dispatchEvent(new CustomEvent('project-snapshot-request',{detail:{reply:(snapshot,error)=>post({type:'project:snapshot-response',requestId:data.requestId,snapshot,error})}}));
  if(data.type==='project:saved'&&context){context.project.revision=data.revision;window.dispatchEvent(new CustomEvent('project-saved',{detail:data}));}
 });
 return {context:()=>context,ready:()=>{if(parent!==window)post({type:'workspace:ready'});},change:snapshot=>{if(context)post({type:'project:change',snapshot});},command:(action,data={})=>{if(!context)return Promise.reject(Error('工程尚未准备好'));const requestId='view-'+ ++next;return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{requests.delete(requestId);reject(Error('工程操作超时，请检查本机服务'));},120000);requests.set(requestId,{resolve,reject,timeout});post({type:'project:command',action,requestId,...data});});}};
}
