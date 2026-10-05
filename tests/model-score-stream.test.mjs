import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {chooseChatGPTModel,readModelStream} from '../src/model-score-stream.js';
import {createModelVisionAPI} from '../audio/model-vision-api.mjs';

test('优先 GPT-6 Luna，记住明确选择，缺 Luna 时不自动用 Astra 或5.6',()=>{
 const models=[{slug:'gpt-6-astra'},{slug:'gpt-5.6-luna'},{slug:'gpt-6-luna'}];
 assert.equal(chooseChatGPTModel(models),'gpt-6-luna');
 assert.equal(chooseChatGPTModel(models,'gpt-5.6-luna'),'gpt-5.6-luna');
 assert.equal(chooseChatGPTModel(models.slice(0,2)),'');
 assert.equal(chooseChatGPTModel(models,'removed-model'),'gpt-6-luna');
});
test('实际文本增量在完整结果到达之前显示，跨块中文不损坏',async()=>{
 const encoder=new TextEncoder();let release,observed='';
 const stream=new ReadableStream({async start(controller){
  const chunk=encoder.encode(JSON.stringify({type:'delta',text:'音符三'})+'\n');
  controller.enqueue(chunk.slice(0,chunk.length-3));controller.enqueue(chunk.slice(chunk.length-3));
  await new Promise(resolve=>release=resolve);
  controller.enqueue(encoder.encode(JSON.stringify({type:'result',text:'完成谱面'})+'\n'));controller.close();
 }});
 const result=await readModelStream(new Response(stream),text=>{observed+=text;release();});
 assert.equal(observed,'音符三');assert.equal(result.text,'完成谱面');
});
test('只有部分输出或服务器报错不能冒充完整识谱',async()=>{
 await assert.rejects(readModelStream(new Response('{"type":"delta","text":"部分"}\n')),/连接中断/);
 await assert.rejects(readModelStream(new Response('{"type":"error","error":"额度不足"}\n')),/额度不足/);
});
test('识谱后端实时转发 onDelta，再发完整结果；流中错误不写第二次HTTP头',async()=>{
 for(const fails of [false,true]){
  const events=[],response={headersSent:false,writeHead(code,headers){assert.equal(this.headersSent,false);this.headersSent=true;this.code=code;this.headers=headers;},write(data){events.push(JSON.parse(data));},end(data){if(data)events.push(JSON.parse(data));}};
  const client={getSession:async()=>({sharing:true}),listModels:async()=>[{slug:'gpt-6-luna'}],streamResponse:async options=>{
   options.onDelta('首段');assert.equal(events.at(-1).type,'delta');
   if(fails)throw Error('流中断');return {text:'完整内容'};
  }};
  const api=createModelVisionAPI(new URL('..',import.meta.url).pathname,{chatgptClient:client});
  const request=Readable.from([Buffer.from(JSON.stringify({provider:'chatgpt',model:'gpt-6-luna',mode:'initial',stream:true,images:[{mimeType:'image/png',data:'YQ=='}]}))]);request.method='POST';
  await api.handle(request,response,new URL('http://localhost/api/model-vision/recognize'));
  assert.match(response.headers['Content-Type'],/ndjson/);
  assert.deepEqual(events.map(x=>x.type),['started','delta',fails?'error':'result']);
 }
});
