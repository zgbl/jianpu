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
  assert.deepEqual(JSON.parse(request.options.body),{kind:'align',projectId:'p',runId:'r',text,manualAnchors:[]});
  assert.ok(calls.some(c=>c.url==='/api/lyrics/jobs/fresh-job/result'));
  assert.equal(redraws,1);assert.ok(publishes>0);assert.equal(workflow.busy(),false);
 }finally{globalThis.document=savedDocument;globalThis.fetch=savedFetch;}
});

test('首次识别完成前多次动态渲染，取消保留部分歌词而不是等待最终文件',async()=>{
 const savedDocument=globalThis.document,savedFetch=globalThis.fetch,elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,textContent:'',classList:{toggle(){}},addEventListener(){},replaceChildren(){},append(){}});return elements.get(id);};
 globalThis.document={getElementById:element};element('lyricTargetVerse').value='1';
 let calls=0,redraws=0,workflow;const seen=[];const response=data=>({ok:true,json:async()=>data});
 globalThis.fetch=async(url)=>{
  if(url==='/api/lyrics/jobs')return response({id:'streaming'});
  if(url.endsWith('/result'))throw Error('取消前不应获取最终结果');
  const revision=++calls;return response({id:'streaming',kind:'asr',status:revision<3?'running':'cancelled',progress:revision*.2,startedAt:Date.now(),message:'识别中',...(revision<3?{preview:{revision,partial:true,text:revision===1?'前句':'前句后句',words:[{text:revision===1?'前句':'前句后句',start:10,end:20,probability:1}],processedUntil:revision*30,duration:90}}:{})});
 };
 try{
  workflow=createLyricWorkflow({bridge:{context:()=>({project:{id:'p',scoreBasedOn:'r'}})},getJob:()=>({id:'r'}),getResult:()=>({}),getScore:()=>({}),getBusy:()=>false,replaceScore(){},redraw(){redraws++;seen.push(workflow.snapshot().lyricPreview.text);},publish(){},controls(){}});
  workflow.setHealth(true);await element('recognizeLyrics').onclick();
  assert.equal(redraws,2);assert.deepEqual(seen,['前句','前句后句']);assert.equal(workflow.snapshot().lyricPreview.processedUntil,60);assert.equal(workflow.busy(),false);assert.equal(workflow.snapshot().lyricTask,null);
 }finally{globalThis.document=savedDocument;globalThis.fetch=savedFetch;}
});

test('用户补思念锚点后点击校准：提交新锚点，回写补词且保留人工文字',async()=>{
 const {demo}=await import('../src/model.js'),{setLyric}=await import('../src/lyrics.js');
 const savedDocument=globalThis.document,savedFetch=globalThis.fetch,elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,textContent:'',classList:{toggle(){}},addEventListener(){},replaceChildren(){},append(){}});return elements.get(id);};
 globalThis.document={getElementById:element,createElement:()=>({append(){}})};
 element('lyricMatchMode').value='acoustic';element('lyricTargetVerse').value='1';element('lyricText').value='思念是种病';
 let score=demo(),workflow,body;const n=score.measures[0].notes[0];n.degree=1;n.sourceTime=20;n.sourceEnd=22;setLyric(score,n.id,1,'思念');
 const response=data=>({ok:true,json:async()=>data});
 globalThis.fetch=async(url,options={})=>{
  if(url==='/api/lyrics/jobs'){body=JSON.parse(options.body);return response({id:'manual-job'});}
  if(url.endsWith('/result'))return response({text:'思念是种病',characters:Array.from('思念是种病').map((text,i)=>({id:'c'+i,text,start:20+i*.2,end:20+(i+1)*.2,status:'acoustic'}))});
  return response({kind:'align',status:'done',progress:1,startedAt:Date.now(),message:'完成'});
 };
 try{
  workflow=createLyricWorkflow({bridge:{context:()=>({project:{id:'p',scoreBasedOn:'r'}})},getJob:()=>({id:'r'}),getResult:()=>({}),getScore:()=>score,getBusy:()=>false,replaceScore(next){score=next;},redraw(){score=workflow.decorate(score);},publish(){},controls(){}});
  await element('applyPastedLyrics').onclick();assert.equal(body.manualAnchors[0].text,'思念');assert.equal(body.manualAnchors[0].manual,true);assert.equal(score.lyrics[0].text,'思念');assert.deepEqual(score.lyricAlignment.characters.map(c=>c.text),['是','种','病']);assert.equal(workflow.busy(),false);
 }finally{globalThis.document=savedDocument;globalThis.fetch=savedFetch;}
});
