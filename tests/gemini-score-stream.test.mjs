import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readGeminiScoreStream} from '../audio/gemini-score-stream.mjs';
import {createModelVisionAPI} from '../audio/model-vision-api.mjs';

const event=value=>'data: '+JSON.stringify(value)+'\r\n\r\n';
const chunk=(text,finishReason)=>({candidates:[{content:{parts:[{text}]},...(finishReason?{finishReason}:{})}]});
test('Gemini SSE 实时转发文本，跨块中文完整，忽略思考内容',async()=>{
 let release,seen='';const encoder=new TextEncoder();
 const stream=new ReadableStream({async start(controller){
  const bytes=encoder.encode(event({candidates:[{content:{parts:[{text:'思考',thought:true},{text:'旋律'}]}}]}));
  for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));
  await new Promise(resolve=>release=resolve);
  controller.enqueue(encoder.encode(event(chunk('完成','STOP'))));controller.close();
 }});
 const result=await readGeminiScoreStream(new Response(stream),delta=>{seen+=delta;release();});
 assert.equal(seen,'旋律完成');assert.equal(result.text,seen);
});
test('Gemini 截断、拒绝、无内容均不能作为完整谱面',async()=>{
 for(const [value,pattern] of [[chunk('部分','MAX_TOKENS'),/长度限制/],[chunk('部分'),/连接中断/],[{promptFeedback:{blockReason:'SAFETY'}},/拒绝/],[chunk('','STOP'),/没有返回/]]){
  await assert.rejects(readGeminiScoreStream(new Response(event(value)),()=>{}),pattern);
 }
});
test('Gemini 后端请求 SSE 并立即转发，流中错误不覆盖为成功',async()=>{
 for(const finish of ['STOP','MAX_TOKENS']){
  let sent;const output=[];
  const api=createModelVisionAPI(new URL('..',import.meta.url).pathname,{env:{GEMINI_API_KEY:'test-secret'},fetchImpl:async(url,options)=>{
   sent={url,options};return new Response(event(chunk('首段'))+event(chunk('尾段',finish)));
  }});
  const req=Readable.from([Buffer.from(JSON.stringify({provider:'gemini',model:'gemini-3.6-flash',stream:true,mode:'initial',images:[{mimeType:'image/png',data:'YQ=='}]}))]);req.method='POST';
  const res={headersSent:false,writeHead(status,headers){assert.equal(this.headersSent,false);this.headersSent=true;assert.equal(status,200);assert.match(headers['Content-Type'],/ndjson/);},write(data){output.push(JSON.parse(data));},end(data){if(data)output.push(JSON.parse(data));}};
  await api.handle(req,res,new URL('http://localhost/api/model-vision/recognize'));
  assert.match(sent.url,/:streamGenerateContent\?alt=sse$/);
  assert.equal(sent.options.headers['x-goog-api-key'],'test-secret');
  assert.deepEqual(output.map(x=>x.type),['started','delta','delta',finish==='STOP'?'result':'error']);
  assert.equal(JSON.stringify(output).includes('test-secret'),false);
 }
});
