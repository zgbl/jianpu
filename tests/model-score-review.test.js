import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareModelScore} from '../src/model-score-import.js';
import {applyMeasureReview} from '../src/model-score-review.js';
import {createModelVisionAPI} from '../audio/model-vision-api.mjs';
import {privateStaticPath} from '../server.mjs';

const doc=readFileSync(new URL('../doc/视觉大模型读谱输出JPU规范与提示词.md',import.meta.url),'utf8');
const sample=doc.match(/```json\n([\s\S]*?)\n```/)?.[1];
const score=()=>prepareModelScore(sample).score;
const revision={format:'jianpu-measure-revision',version:1,updates:[{measure:1,notes:[
 {degree:3,base:4,octave:0,dots:0,lyrics:[{verse:1,text:'我'}]},
 {degree:3,base:8,octave:0,dots:0},
 {degree:4,base:8,octave:0,dots:0},
 {degree:6,base:4,octave:1,dots:0},
 {degree:5,base:4,octave:0,dots:0}
],repeatStart:false,repeatEnd:false,chords:['G']}],issues:[]};

test('局部复核仅更新指定小节，其他小节 ID、歌词、和弦及节奏保持',()=>{
 const original=score(),untouched=structuredClone(original.measures[1]),originalText=JSON.stringify(original);
 const result=applyMeasureReview(original,JSON.stringify(revision),[1]);
 assert.deepEqual(result.updated,[1]);assert.equal(result.score.measures[0].notes[3].octave,1);
 assert.deepEqual(result.score.measures[1],untouched);assert.deepEqual(result.score.chords,original.chords);
 assert.equal(JSON.stringify(original),originalText);assert.equal(result.score.lyrics[0].text,'我');
});

test('局部复核保留有效的跨小节圆滑线',()=>{
 const original=score(),from=original.measures[0].notes.at(-1).id,to=original.measures[1].notes[0].id;
 original.spans.push({id:'cross-slur',type:'slur',from,to});
 const result=applyMeasureReview(original,JSON.stringify(revision),[1]);
 assert.deepEqual(result.score.spans.find(s=>s.id==='cross-slur'),{id:'cross-slur',type:'slur',from,to});
});

test('复核不能改未标记小节，非法结果不会修改原谱',()=>{
 const original=score(),before=JSON.stringify(original);const bad=structuredClone(revision);bad.updates[0].measure=2;
 assert.throws(()=>applyMeasureReview(original,JSON.stringify(bad),[1]),/未标记/);
 bad.updates[0].measure=1;bad.updates[0].notes[0].base=3;
 assert.throws(()=>applyMeasureReview(original,JSON.stringify(bad),[1]),/校验失败/);
 assert.equal(JSON.stringify(original),before);
});

function request(body){const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.method='POST';return req;}
function response(){return {status:0,headers:null,body:'',writeHead(status,headers){this.status=status;this.headers=headers;},end(data=''){this.body=String(data);}};}
const images=[{mimeType:'image/png',data:'YQ=='}];
test('静态服务拒绝读取 .env 与 Git 隐藏内容',()=>{
 for(const path of ['/.env','/.env.local','/%2Eenv','/.git/config'])assert.equal(privateStaticPath(path),true);
 assert.equal(privateStaticPath('/model-score.html'),false);
});
test('Gemini 接口发出完整规范和多图，密钥只进上游请求',async()=>{
 let sent;const api=createModelVisionAPI(new URL('..',import.meta.url).pathname,{env:{GEMINI_API_KEY:'test-secret'},fetchImpl:async(url,options)=>{sent={url,options};return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:sample}]}}]})};}});
 const res=response();assert.equal(await api.handle(request({mode:'initial',model:'gemini-3.6-flash',images:[...images,...images]}),res,new URL('http://localhost/api/model-vision/recognize')),true);
 assert.equal(res.status,200);assert.equal(JSON.parse(res.body).text,sample);assert.equal(res.body.includes('test-secret'),false);
 assert.equal(sent.options.headers['x-goog-api-key'],'test-secret');const payload=JSON.parse(sent.options.body);
 assert.match(payload.contents[0].parts[0].text,/逐小节/);assert.equal(payload.contents[0].parts.length,3);
 assert.equal(payload.contents[0].parts[1].mediaResolution.level,'media_resolution_high');
});

test('Gemini 复核提示包含已标记小节；缺 Key 时不调用上游',async()=>{
 let sent;const root=new URL('..',import.meta.url).pathname;const api=createModelVisionAPI(root,{env:{GEMINI_API_KEY:'test-secret'},fetchImpl:async(_url,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(revision)}]}}]})};}});
 const res=response();await api.handle(request({mode:'review',images,score:score(),selected:[{measure:1,note:'第 4 个音应高八度'}]}),res,new URL('http://localhost/api/model-vision/recognize'));
 assert.equal(res.status,200);assert.match(sent.contents[0].parts[0].text,/第 4 个音应高八度/);
 const isolated=mkdtempSync(join(tmpdir(),'jianpu-no-provider-key-'));
 try{const missing=createModelVisionAPI(isolated,{env:{GEMINI_API_KEY:''},fetchImpl:async()=>{throw Error('should not call');}});const out=response();await missing.handle(request({mode:'initial',images}),out,new URL('http://localhost/api/model-vision/recognize'));assert.equal(out.status,400);}
 finally{rmSync(isolated,{recursive:true,force:true});}
});

test('OpenAI、Qwen 3.8、DeepSeek 分别走视觉接口并读取各自 .env 密钥',async()=>{
 const root=mkdtempSync(join(tmpdir(),'jianpu-provider-'));
 try{
  writeFileSync(join(root,'.env'),'OPENAI_API_KEY=openai-secret\nQWEN_API_KEY=qwen-secret\nDEEPSEEK_API_KEY=deepseek-secret\n');
  for(const [provider,model,host,key] of [
   ['openai','gpt-6-luna','api.openai.com','openai-secret'],
   ['qwen','qwen3.8-flash','dashscope-intl.aliyuncs.com','qwen-secret'],
   ['deepseek','deepseek-flash','api.deepseek.com','deepseek-secret']]){
   let sent;const api=createModelVisionAPI(root,{env:{},fetchImpl:async(url,options)=>{sent={url,options};return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(revision)},finish_reason:'stop'}]})};}});
   const res=response();await api.handle(request({mode:'review',provider,images,score:score(),selected:[{measure:1,note:'复核八度'}]}),res,new URL('http://localhost/api/model-vision/recognize'));
   assert.equal(res.status,200,`${provider}: ${res.body}`);assert.equal(JSON.parse(res.body).model,model);
   assert.match(sent.url,new RegExp(host.replaceAll('.','\\.')));assert.equal(sent.options.headers.Authorization,`Bearer ${key}`);
   const payload=JSON.parse(sent.options.body);assert.equal(payload.model,model);
   assert.match(payload.messages[0].content[0].text,/复核八度/);
   assert.match(payload.messages[0].content[1].image_url.url,/^data:image\/png;base64,/);
   assert.equal(res.body.includes(key),false);
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
