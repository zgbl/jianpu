import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectController} from '../src/project-controller.js';
import {webcrypto} from 'node:crypto';globalThis.crypto??=webcrypto;
test('stale unchanged score snapshots retry UI saves without overwriting newer score and refresh debug',async()=>{
 const keys=['document','window','location','history','localStorage','fetch'],original=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));
 const nodes=new Map(),listeners=new Map(),debugMessages=[],messages=[];let saved;
 const element=()=>({classList:{toggle(){}},replaceChildren(){},showModal(){},close(){}});
 globalThis.document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},querySelectorAll:()=>[],addEventListener(){}};
 globalThis.window={addEventListener:(k,fn)=>listeners.set(k,fn)};
 globalThis.location={origin:'http://localhost',href:'http://localhost/?project=p',search:'?project=p'};globalThis.history={replaceState(){}};globalThis.localStorage={setItem(){}};
 const old={id:'p',revision:0,name:'song',workspace:{stage:'transcribe',transcribe:{}},score:{title:'old',measures:[]},scoreBasedOn:'old-run',runs:[]};
 let stored=structuredClone(old),patches=[],first=true;
 globalThis.fetch=async(url,options)=>{
  if(options?.method==='PATCH'){
   const data=JSON.parse(options.body);patches.push(data);
   if(first){first=false;stored={...stored,revision:1,score:{title:'new',measures:[]},scoreBasedOn:'new-run'};return {ok:false,status:409,json:async()=>({error:'版本冲突'})};}
   assert.equal(data.revision,stored.revision);stored={...stored,...data,workspace:{...stored.workspace,...data.workspace},revision:stored.revision+1};
  }
  return {ok:true,json:async()=>structuredClone(stored)};
 };
 const source={postMessage:data=>{messages.push(data);if(data.type==='project:saved')saved?.();}},debug={postMessage:data=>debugMessages.push(data)};
 const controller=createProjectController({frames:{transcribe:{contentWindow:source},audioDebug:{contentWindow:debug}},activate(){}});
 try{
  await controller.init();const send=(from,data)=>listeners.get('message')({source:from,origin:location.origin,data});
  send(source,{type:'workspace:ready'});send(debug,{type:'workspace:ready'});
  const session=messages.find(m=>m.type==='project:restore').session;
  const done=new Promise(resolve=>saved=resolve);
  send(source,{type:'project:change',projectId:'p',session,snapshot:{score:old.score,scoreBasedOn:'old-run',transcribe:{zoom:3}}});await done;
  assert.equal(patches.length,2);assert.ok(patches.every(p=>!('score' in p)&&!('scoreBasedOn' in p)));
  assert.equal(controller.current().score.title,'new');assert.equal(stored.scoreBasedOn,'new-run');assert.equal(stored.workspace.transcribe.zoom,3);
  assert.ok(debugMessages.some(m=>m.type==='project:restore'&&m.project.revision===1&&m.project.score.title==='new'));
  // A successful score save must also notify debugging, without needing a 409.
  debugMessages.length=0;const synced=new Promise(resolve=>saved=resolve);
  send(source,{type:'project:change',projectId:'p',session,snapshot:{score:{title:'new rhythm',measures:[]},scoreBasedOn:'new-run',transcribe:{zoom:3}}});await synced;
  assert.ok(debugMessages.some(m=>m.type==='project:restore'&&m.project.revision===3&&m.project.score.title==='new rhythm'));
  debugMessages.length=0;const uiOnly=new Promise(resolve=>saved=resolve);
  send(source,{type:'project:change',projectId:'p',session,snapshot:{transcribe:{zoom:4}}});await uiOnly;
  assert.equal(debugMessages.filter(m=>m.type==='project:restore').length,0);

 }finally{for(const [k,v] of Object.entries(original))v===undefined?delete globalThis[k]:globalThis[k]=v;}
});
