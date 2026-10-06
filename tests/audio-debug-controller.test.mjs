import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectController} from '../src/project-controller.js';
import {noteMidi} from '../src/pitch.js';
test('debug annotation commands preserve session across saves; Do archives score and preserves sounding MIDI',async()=>{
 const original={document:globalThis.document,window:globalThis.window,location:globalThis.location,history:globalThis.history,localStorage:globalThis.localStorage,fetch:globalThis.fetch};
 const nodes=new Map(),listeners=new Map(),replies=[];let resolveReply;
 const element=()=>({classList:{toggle(){}},replaceChildren(){},dataset:{},showModal(){},close(){}});
 globalThis.document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},querySelectorAll:()=>[],addEventListener(){}};
 globalThis.window={addEventListener:(name,fn)=>listeners.set(name,fn)};
 globalThis.location={origin:'http://localhost',href:'http://localhost/?project=p',search:'?project=p'};globalThis.history={replaceState(){}};globalThis.localStorage={setItem(){}};
 let p={id:'p',revision:0,name:'test',workspace:{stage:'transcribe',transcribe:{}},history:[],scoreBasedOn:'r',runs:[{id:'r',status:'done'}],score:{key:'C',meter:[4,4],measures:[{id:'m',notes:[{id:'n',degree:1,octave:0,duration:4}]}],lyrics:[],chords:[]}};
 const patches=[];globalThis.fetch=async(url,options)=>{if(options?.method==='PATCH'){const patch=JSON.parse(options.body);patches.push(patch);assert.equal(patch.revision,p.revision);p={...p,...patch,workspace:{...p.workspace,...patch.workspace},revision:p.revision+1};}return {ok:true,json:async()=>structuredClone(p)};};
 const source={postMessage:data=>{replies.push(data);if(data.type==='project:command-response')resolveReply?.(data);}},controller=createProjectController({frames:{audioDebug:{contentWindow:source}},activate(){}});
 try{await controller.init();const send=data=>listeners.get('message')({source,origin:location.origin,data});send({type:'workspace:ready'});const session=replies.find(r=>r.type==='project:restore').session;
 const command=(action,data)=>new Promise(resolve=>{resolveReply=resolve;send({type:'project:command',projectId:'p',session,action,requestId:String(replies.length),...data});});
 const record={key:'event:0:0:1',midi:60,type:'correct',start:0,end:1,comment:'确认'};
 for(let i=0;i<2;i++){const response=await command('save-debug-review',{runId:'r',key:record.key,record:{...record,comment:String(i)}});assert.equal(response.error,undefined);assert.equal(response.payload.session,session);}
 assert.equal(controller.current().workspace.audioDebug.reviews.r[record.key].comment,'1');
 const before=noteMidi(p.score.measures[0].notes[0],p.score);const response=await command('apply-debug-do',{runId:'r',key:'D'});assert.equal(response.error,undefined);assert.equal(response.payload.session,session);assert.equal(p.score.key,'D');assert.equal(noteMidi(p.score.measures[0].notes[0],p.score),before);assert.equal(patches.at(-1).archiveScore,true);assert.equal(p.score.keyMap.locked,true);
 }finally{for(const [key,value] of Object.entries(original))value===undefined?delete globalThis[key]:globalThis[key]=value;}
});
