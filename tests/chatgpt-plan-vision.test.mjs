import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {createModelVisionAPI} from '../audio/model-vision-api.mjs';

const root=new URL('..',import.meta.url).pathname;
const spec=readFileSync(new URL('../doc/视觉大模型读谱输出JPU规范与提示词.md',import.meta.url),'utf8');
const sample=spec.match(/```json\n([\s\S]*?)\n```/)?.[1];
const image={mimeType:'image/png',data:'YQ=='};
function req(body){const value=Readable.from([Buffer.from(JSON.stringify(body))]);value.method='POST';return value;}
function res(){return {writeHead(status){this.status=status;},end(body=''){this.body=String(body);}};}

test('ChatGPT 计划识谱经授权模型发送图片并返回 JPU',async()=>{
 let call;
 const chatgptClient={
  getSession:async()=>({status:'connected',sharing:true}),
  listModels:async()=>[{slug:'vision-model',displayName:'Vision model'}],
  streamResponse:async options=>{call=options;return {text:sample};}
 };
 const api=createModelVisionAPI(root,{chatgptClient});
 const response=res();
 await api.handle(req({mode:'initial',provider:'chatgpt',model:'vision-model',apiKey:'',images:[image]}),response,new URL('http://localhost/api/model-vision/recognize'));
 assert.equal(response.status,200);
 assert.equal(JSON.parse(response.body).provider,'chatgpt');
 assert.equal(JSON.parse(response.body).model,'vision-model');
 assert.match(call.instructions,/jianpu-melody/);
 assert.deepEqual(call.input,[{role:'user',content:[{type:'input_image',image_url:'data:image/png;base64,YQ==',detail:'high'}]}]);
});

test('未授权 ChatGPT 计划额度时拒绝发送图片',async()=>{
 let called=false;
 const chatgptClient={getSession:async()=>({status:'connected',sharing:false}),streamResponse:async()=>{called=true;return {text:sample};}};
 const api=createModelVisionAPI(root,{chatgptClient}),response=res();
 await api.handle(req({mode:'initial',provider:'chatgpt',model:'vision-model',images:[image]}),response,new URL('http://localhost/api/model-vision/recognize'));
 assert.equal(response.status,401);assert.equal(called,false);
 assert.match(JSON.parse(response.body).error,/允许该应用使用计划额度/);
});

test('ChatGPT 计划模型必须来自当前账号的模型列表',async()=>{
 let called=false;
 const chatgptClient={getSession:async()=>({status:'connected',sharing:true}),listModels:async()=>[{slug:'allowed-model'}],streamResponse:async()=>{called=true;return {text:sample};}};
 const api=createModelVisionAPI(root,{chatgptClient}),response=res();
 await api.handle(req({mode:'initial',provider:'chatgpt',model:'other-model',images:[image]}),response,new URL('http://localhost/api/model-vision/recognize'));
 assert.equal(response.status,400);assert.equal(called,false);
 assert.match(JSON.parse(response.body).error,/不在该 ChatGPT 账号的可用列表/);
});

test('目录漏列 GPT-6.1 Sol 时仍可发送已验证模型，保持原模型 ID',async()=>{
 let call;
 const chatgptClient={getSession:async()=>({sharing:true}),listModels:async()=>[{slug:'gpt-5.6-sol'}],streamResponse:async options=>{call=options;return {text:sample};}};
 const api=createModelVisionAPI(root,{chatgptClient}),response=res();
 await api.handle(req({mode:'initial',provider:'chatgpt',model:'gpt-6.1-sol',images:[image]}),response,new URL('http://localhost/api/model-vision/recognize'));
 assert.equal(response.status,200);assert.equal(call.model,'gpt-6.1-sol');
});
