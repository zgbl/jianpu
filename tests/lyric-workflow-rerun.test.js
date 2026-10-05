import test from 'node:test';
import assert from 'node:assert/strict';
import {createLyricWorkflow} from '../src/lyric-workflow.js';

test('相同正确歌词与旧声学结果也必须启动新任务，显示进度并获取新结果',async()=>{
 const savedDocument=globalThis.document,savedFetch=globalThis.fetch;
 const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,textContent:'',classList:{toggle(){}},addEventListener(){},replaceChildren(){},append(){}});return elements.get(id);};
 globalThis.document={getElementById:element};
 element('lyricMatchMode').value='acoustic';element('lyricTargetVerse').value='1';
 const text='亲爱的你躲在哪里发呆';
 const old={text,algorithmVersion:'ctc-phonetic-window-v4',characters:[]};
 const incoming={text,algorithmVersion:'ctc-phonetic-window-v4.1',characters:[]};
 const calls=[];let redraws=0,publishes=0;
 const response=data=>({ok:true,json:async()=>data});
 globalThis.fetch=async(url,options={})=>{calls.push({url,options});
  if(url.includes('/asset?'))return response(old);
  if(url==='/api/lyrics/jobs'){
   assert.match(element('lyricsStatus').textContent,/不复用旧结果/);
   assert.equal(element('applyPastedLyrics').disabled,true);
   return response({id:'fresh-job'});
  }
  if(url.endsWith('/result'))return response(incoming);
  return response({id:'fresh-job',kind:'align',status:'done',progress:1,startedAt:Date.now(),message:'新对齐完成'});
 };
 try{
  const workflow=createLyricWorkflow({bridge:{context:()=>({project:{id:'p',scoreBasedOn:'r'}})},getJob:()=>({id:'r'}),getResult:()=>({}),getScore:()=>({}),getBusy:()=>false,replaceScore(){},redraw(){redraws++;},publish(){publishes++;},controls(){}});
  await workflow.restore({id:'p',assets:[{path:'runs/r/lyrics-alignment.json'}]},{id:'r'},{lyricText:text,lyricMatchMode:'acoustic',lyricPlan:{method:'acoustic',text,verse:1}});
  await element('applyPastedLyrics').onclick();
  const request=calls.find(c=>c.url==='/api/lyrics/jobs');assert.ok(request);
  assert.equal(request.options.method,'POST');
  assert.deepEqual(JSON.parse(request.options.body),{kind:'align',projectId:'p',runId:'r',text});
  assert.ok(calls.some(c=>c.url==='/api/lyrics/jobs/fresh-job/result'));
  assert.equal(redraws,1);assert.ok(publishes>0);assert.equal(workflow.busy(),false);
 }finally{globalThis.document=savedDocument;globalThis.fetch=savedFetch;}
});
