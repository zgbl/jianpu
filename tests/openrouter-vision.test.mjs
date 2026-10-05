import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {createModelVisionAPI} from '../audio/model-vision-api.mjs';
import {readOpenRouterScoreStream} from '../audio/openrouter-score-stream.mjs';

const root=new URL('..',import.meta.url).pathname;
const spec=await readFile(new URL('../doc/视觉大模型读谱输出JPU规范与提示词.md',import.meta.url),'utf8');
const example=spec.match(/```json\n([\s\S]*?)\n```/)[1],image={mimeType:'image/png',data:'YQ=='};
const req=body=>Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]),{method:'POST'});
function res(){return {writeHead(status,headers){this.status=status;this.headers=headers;this.headersSent=true;},write(data){(this.events||=[]).push(JSON.parse(data));},end(data=''){if(data)(this.events||=[]).push(JSON.parse(data));this.body=data;this.writableEnded=true;}};}
const sse=data=>`data: ${JSON.stringify(data)}\n\n`;

test('OpenRouter 模型目录只返回可读图片的模型 ID，不返回密钥',async()=>{
 let options;const api=createModelVisionAPI(root,{env:{OPENROUTER_API_KEY:'secret'},fetchImpl:async(_url,init)=>{options=init;return Response.json({data:[{id:'vision/model',name:'Vision',architecture:{input_modalities:['text','image']}},{id:'text/model',architecture:{input_modalities:['text']}}]});}});
 const response=res();await api.handle({method:'GET'},response,new URL('http://localhost/api/model-vision/status?provider=openrouter'));
 const body=JSON.parse(response.body);assert.equal(body.configured,true);assert.deepEqual(body.models,[{id:'vision/model',name:'Vision'}]);assert.equal(JSON.stringify(body).includes('secret'),false);assert.equal(options.headers.Authorization,'Bearer secret');
});

test('OpenRouter 使用选择的模型传图并增量转发 JPU 文本',async()=>{
 let request;const api=createModelVisionAPI(root,{env:{OPENROUTER_API_KEY:'secret'},fetchImpl:async(url,options)=>{request={url,options};return new Response(sse({choices:[{delta:{content:example},finish_reason:null}]})+sse({choices:[{delta:{},finish_reason:'stop'}],usage:{total_tokens:22}})+'data: [DONE]\n\n');}});
 const response=res();await api.handle(req({provider:'openrouter',model:'vendor/vision:free',stream:true,mode:'initial',images:[image]}),response,new URL('http://localhost/api/model-vision/recognize'));
 assert.match(request.url,/openrouter\.ai\/api\/v1\/chat\/completions$/);assert.equal(request.options.headers.Authorization,'Bearer secret');
 const body=JSON.parse(request.options.body);assert.equal(body.model,'vendor/vision:free');assert.equal(body.stream,true);assert.equal(body.response_format,undefined);assert.match(body.messages[0].content[0].text,/jianpu-melody/);
 assert.equal(response.status,200);assert.deepEqual(response.events.map(item=>item.type),['started','delta','result']);assert.equal(response.events[1].text,example);assert.equal(response.events[2].usage.total_tokens,22);assert.equal(JSON.stringify(response.events).includes('secret'),false);
});

test('OpenRouter 模型无效或上游失败时显示明确错误且不泄露 Key',async()=>{
 const api=createModelVisionAPI(root,{env:{OPENROUTER_API_KEY:'secret'},fetchImpl:async()=>new Response(JSON.stringify({error:{message:'model not found'}}),{status:404,headers:{'content-type':'application/json'}})});
 const missing=res();await api.handle(req({provider:'openrouter',mode:'initial',images:[image]}),missing,new URL('http://localhost/api/model-vision/recognize'));assert.match(JSON.parse(missing.body).error,/模型名称无效/);
 const failed=res();await api.handle(req({provider:'openrouter',model:'bad/model',stream:true,mode:'initial',images:[image]}),failed,new URL('http://localhost/api/model-vision/recognize'));assert.equal(failed.events.at(-1).type,'error');assert.match(failed.events.at(-1).error,/model not found/);assert.equal(JSON.stringify(failed.events).includes('secret'),false);
});

test('OpenRouter SSE 连接结束但未完成时不误报成功',async()=>{
 await assert.rejects(readOpenRouterScoreStream(new Response(sse({choices:[{delta:{content:'partial'}}]})),()=>{}),/连接中断/);
});

test('识谱默认等待时限延长到十五分钟',async()=>{
 const {MODEL_REQUEST_TIMEOUT_MS}=await import('../audio/model-vision-api.mjs');
 assert.equal(MODEL_REQUEST_TIMEOUT_MS,900000);
});

test('OpenRouter 已输出部分文字后本地超时，明确标出原因且不返回完整结果',async()=>{
 const api=createModelVisionAPI(root,{requestTimeoutMs:30,env:{OPENROUTER_API_KEY:'secret'},fetchImpl:async(_url,{signal})=>new Response(new ReadableStream({start(controller){
  controller.enqueue(new TextEncoder().encode(sse({choices:[{delta:{content:'partial JPU'}}]})));
  signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});
 }}))});
 const keepAlive=setTimeout(()=>{},1000);
 try{
  const response=res();await api.handle(req({provider:'openrouter',model:'vendor/vision',stream:true,mode:'initial',images:[image,image,image]}),response,new URL('http://localhost/api/model-vision/recognize'));
  assert.deepEqual(response.events.map(item=>item.type),['started','delta','error']);
  assert.match(response.events.at(-1).error,/本地等待时限已到/);
  assert.equal(response.events[1].text,'partial JPU');
 }finally{clearTimeout(keepAlive);}
});
