import test from 'node:test';
import assert from 'node:assert/strict';
import {transcriptionToScore} from '../src/transcription-score.js';
import {createChordWorkflow} from '../src/chord-workflow.js';
const sheet=()=>transcriptionToScore({estimatedBpm:120,notes:[{start:0,end:2,midi:60,confidence:1}]},{key:'C'});
const response=(body,ok=true)=>({ok,status:ok?200:400,json:async()=>body});
test('提交前显示反馈，进度、结果接入谱面并可由编辑器撤销',async()=>{
 const events=[],score=sheet();let calls=0,applied;
 const flow=createChordWorkflow({getScore:()=>score,getContext:()=>({runId:'r'}),pollMs:0,feedback:(text,state)=>events.push({text,...state}),applyScore:next=>{applied=next;},fetcher:async(url,options)=>{
  assert.equal(events[0].busy,true);calls++;
  if(options.method==='POST'){assert.equal(JSON.parse(options.body).kind,'chords');return response({id:'task'});}
  if(url.endsWith('/result'))return response({chords:[{measureId:score.measures[0].id,start:0,end:2,label:'C',source:'automatic'}]});
  return response(calls===2?{status:'running',progress:.4,message:'分析伴奏'}:{status:'done',progress:1});
 }});
 await flow.run('audio');assert.equal(applied.chords.length,1);assert.deepEqual(applied.measures,score.measures);assert(events.some(e=>e.text.includes('40%')));assert.match(events.at(-1).text,/已配入 1/);assert.match(events.at(-1).text,/覆盖 1\/1/);assert.match(events.at(-1).text,/第一个和弦在第 1 小节/);assert(!events.at(-1).busy);
});
test('后端错误明确显示，失败后允许再次提交',async()=>{
 let calls=0;const events=[];const flow=createChordWorkflow({getScore:sheet,getContext:()=>({runId:'r'}),feedback:(text,state)=>events.push({text,...state}),applyScore:()=>assert.fail(),fetcher:async()=>{calls++;return response({error:'音频文件不存在'},false);}});
 await flow.run('audio');await flow.run('audio');assert.equal(calls,2);assert.match(events.at(-1).text,/音频文件不存在/);assert.equal(events.at(-1).error,true);
});
test('没有音频版本，按钮反馈说明前置条件',async()=>{
 let text;await createChordWorkflow({getScore:sheet,getContext:()=>null,applyScore:()=>assert.fail(),feedback:value=>text=value,fetcher:()=>assert.fail()}).run('audio');assert.match(text,/音频识别结果/);
});
test('取消中止请求并保留原谱；重复点击不重复提交',async()=>{
 const events=[];let calls=0,started;
 const ready=new Promise(resolve=>started=resolve);
 const flow=createChordWorkflow({getScore:sheet,getContext:()=>({runId:'r'}),applyScore:()=>assert.fail(),feedback:(text,state)=>events.push({text,...state}),fetcher:async(url,options)=>{calls++;started();return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));}});
 const pending=flow.run('audio');await ready;await flow.run('audio');await flow.cancel();await pending;assert.equal(calls,1);assert.match(events.at(-1).text,/已取消/);
});
test('工程切换后不会把旧和弦写入新谱',async()=>{
 let context={runId:'r'},text;const flow=createChordWorkflow({getScore:sheet,getContext:()=>context,applyScore:()=>assert.fail(),feedback:value=>text=value,fetcher:async(url,options)=>{if(options.method==='POST'){context={runId:'new'};return response({id:'old'});}return response({});}});
 await flow.run('audio');assert.match(text,/工程或音频版本已改变/);
});
