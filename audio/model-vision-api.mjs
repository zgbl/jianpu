import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {readGeminiScoreStream} from './gemini-score-stream.mjs';
import {readOpenRouterScoreStream} from './openrouter-score-stream.mjs';
import {withVerifiedChatGPTModels} from './chatgpt-model-catalog.mjs';

const MAX_BODY=18*1024*1024;
export const MODEL_REQUEST_TIMEOUT_MS=15*60*1000;
const MODEL=/^[a-z][a-z0-9.-]{1,79}$/;
const PROVIDERS={gemini:{key:'GEMINI_API_KEY',model:'gemini-3.6-flash'},openai:{key:'OPENAI_API_KEY',model:'gpt-6-luna'},qwen:{key:'QWEN_API_KEY',model:'qwen3.8-flash'},deepseek:{key:'DEEPSEEK_API_KEY',model:'deepseek-flash'},openrouter:{key:'OPENROUTER_API_KEY',model:''}};
const IMAGE_TYPES=new Set(['image/png','image/jpeg','image/webp']);
const REVIEW_RULES=`只复核用户指定的小节，不改动其他小节。按原图重新读取数字、八度点、附点、减时线、延长线、小节线、歌词和弦。返回一个 JSON 对象：
{"format":"jianpu-measure-revision","version":1,"updates":[{"measure":7,"notes":[{"degree":1,"base":4,"octave":0,"dots":0,"lyrics":[{"verse":1,"text":"字"}]}],"repeatStart":false,"repeatEnd":false,"chords":["G"],"spans":[{"type":"tie","from":0,"to":1}]}],"issues":[{"measure":7,"description":"仍不确定之处"}]}。
updates 中每项必须只对应指定小节，measure 从 1 开始；notes 须列出该小节全部音符而非差异。每个音符可带 accidental (-1/0/1)、grace、beamBreak、tuplet。三连音必须整组连续三个等时值音符（休止符也算），三个成员均带相同 {id:"全谱唯一组ID",actual:3,normal:2}，实际时值乘 2/3；不得当作普通音或 slur 丢掉数字3；lyrics 是该音符下的歌词数组。不确定的内容写入 issues，不要猜。spans 的 from/to 是本小节 notes 的零基索引；跨小节连线请在 issues 说明。chords 必须是该小节全部印刷和弦的实际发声音名。不要返回完整 JPU，不要加 Markdown。`;

function fail(message,status=400){return Object.assign(Error(message),{status});}
async function readJson(req){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)throw fail('图片总量过大，请缩小图片后重试',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail('请求 JSON 格式错误');}}
function imageParts(images){if(!Array.isArray(images)||!images.length||images.length>12)throw fail('请提供 1–12 张谱图');return images.map((image,i)=>{if(!IMAGE_TYPES.has(image?.mimeType)||typeof image.data!=='string'||!image.data||!/^[A-Za-z0-9+/]+={0,2}$/.test(image.data))throw fail(`第 ${i+1} 张图片格式无效（支持 PNG、JPEG、WebP）`);return {inlineData:{mimeType:image.mimeType,data:image.data},mediaResolution:{level:'media_resolution_high'}};});}
async function localEnv(root){const file=await readFile(resolve(root,'.env'),'utf8').catch(()=>null),values={};if(!file)return values;for(const line of file.split(/\r?\n/)){const match=line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);if(match){let value=match[2].trim();if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);values[match[1]]=value;}}return values;}
function configured(name,env,file){return env[name]||file[name]||'';}
function retryDelay(response,attempt){const raw=response.headers?.get?.('retry-after');if(raw){const seconds=Number(raw),date=Date.parse(raw),ms=Number.isFinite(seconds)?seconds*1000:date-Date.now();if(Number.isFinite(ms)&&ms>0)return Math.min(15000,Math.max(1000,ms));}return attempt===0?2000:5000;}
function reviewPrompt(input){const score=input.score,selected=input.selected;if(score?.format!=='jianpu-melody'||score.version!==2||!Array.isArray(score.measures)||!Array.isArray(selected)||!selected.length||selected.length>30)throw fail('复核需要当前乐谱与 1–30 个标记小节');const unique=[...new Set(selected.map(x=>Number(x.measure)))];if(unique.some(n=>!Number.isInteger(n)||n<1||n>score.measures.length))throw fail('标记的小节编号无效');const marks=selected.map(x=>({measure:Number(x.measure),note:String(x.note||'').slice(0,500)}));return `${REVIEW_RULES}\n当前完整 JPU（仅用于定位上下文，不要原样输出）：\n${JSON.stringify(score)}\n要复核的小节及人工意见：\n${JSON.stringify(marks)}`;}

export function createModelVisionAPI(root,{fetchImpl=fetch,env=process.env,chatgptClient=null,requestTimeoutMs=MODEL_REQUEST_TIMEOUT_MS}={}){
 const rulesPath=resolve(root,'doc/视觉大模型读谱输出JPU规范与提示词.md');
 return {async handle(req,res,url){
  if(url.pathname==='/api/model-vision/status'){
   if(req.method!=='GET'){res.writeHead(405);res.end();return true;}
   const provider=url.searchParams.get('provider')||'gemini',config=PROVIDERS[provider];
   if(!config){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:'模型服务商无效'}));return true;}
   const file=await localEnv(root),key=configured(config.key,env,file)||(provider==='qwen'?configured('DASHSCOPE_API_KEY',env,file):''),model=configured(`${provider.toUpperCase()}_MODEL`,env,file)||config.model;
   let models=[];
   if(provider==='openrouter'&&key){try{const response=await fetchImpl('https://openrouter.ai/api/v1/models',{headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},signal:AbortSignal.timeout(15000)});if(response.ok){const payload=await response.json();models=(payload.data||[]).filter(item=>item?.id&&item?.architecture?.input_modalities?.includes('image')).map(item=>({id:item.id,name:item.name||item.id}));}}catch{}}
   res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
   res.end(JSON.stringify({provider,configured:Boolean(String(key).trim()),model,models}));return true;
  }
  if(url.pathname!=='/api/model-vision/recognize')return false;
  if(req.method!=='POST'){res.writeHead(405);res.end();return true;}
  let activeKey='',streamPulse=null;const upstreamController=new AbortController();
  req.on?.('aborted',()=>upstreamController.abort());
  res.on?.('close',()=>{if(!res.writableEnded)upstreamController.abort();});
  try{
    const input=await readJson(req),provider=String(input.provider||'gemini');
    if(provider==='chatgpt'){
     if(!chatgptClient)throw fail('ChatGPT 计划登录服务未初始化；请安装依赖并重启本地开发服务',503);
     const session=await chatgptClient.getSession();
     if(!session.sharing)throw fail('尚未授权使用 ChatGPT 计划额度。请先点击“继续使用 ChatGPT 登录”，并在授权页允许该应用使用计划额度。',401);
     const model=String(input.model||'');
     if(!MODEL.test(model))throw fail('请先在模型列表中选择一个可用模型');
     const models=withVerifiedChatGPTModels(await chatgptClient.listModels());
     if(!models.some(item=>item.slug===model))throw fail('所选模型当前不在该 ChatGPT 账号的可用列表中；请刷新模型列表后重试',400);
     const images=imageParts(input.images);
     const prompt=input.mode==='review'?reviewPrompt(input):input.mode==='initial'?await readFile(rulesPath,'utf8'):null;
     if(!prompt)throw fail('识别模式无效');
     const content=images.map(image=>({type:'input_image',image_url:`data:${image.inlineData.mimeType};base64,${image.inlineData.data}`,detail:'high'}));
     const streaming=input.stream===true;
     const send=value=>res.write(JSON.stringify(value)+'\n');
     if(streaming){res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});res.flushHeaders?.();send({type:'started',model,provider,message:'已提交 ChatGPT，等待模型首段文字'});streamPulse=setInterval(()=>send({type:'progress',message:'ChatGPT 连接保持中，模型尚未返回文字'}),5000);}
     const result=await chatgptClient.streamResponse({model,instructions:prompt,input:[{role:'user',content}],signal:AbortSignal.any([upstreamController.signal,AbortSignal.timeout(requestTimeoutMs)]),...(streaming?{onDelta:text=>send({type:'delta',text})}:{})});
     if(streamPulse){clearInterval(streamPulse);streamPulse=null;}
     if(!result.text)throw fail('ChatGPT 没有返回 JPU 内容，请重试',502);
     if(streaming){send({type:'result',text:result.text,model,provider,usage:null});res.end();return true;}
     res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({text:result.text,model,provider,usage:null}));return true;
    }
    const config=PROVIDERS[provider];
    if(!config)throw fail('模型服务商无效');const file=await localEnv(root),model=String(input.model||configured(`${provider.toUpperCase()}_MODEL`,env,file)||config.model);
   if(provider==='openrouter'?!/^[a-z0-9][a-z0-9._-]{0,99}\/[a-z0-9][a-z0-9._:-]{0,149}$/i.test(model):!MODEL.test(model))throw fail('模型名称无效');
   const key=String(input.apiKey||configured(config.key,env,file)||(provider==='qwen'?configured('DASHSCOPE_API_KEY',env,file):'')).trim();if(!key)throw fail(`请在项目 .env 填写 ${config.key}，或在页面临时输入 API Key`);
   activeKey=key;
   const images=imageParts(input.images);
   const prompt=input.mode==='review'?reviewPrompt(input):input.mode==='initial'?`${await readFile(rulesPath,'utf8')}\n\n请按上传顺序读取全部谱图，返回一份完整的 jianpu-melody version 2 JSON。`:null;
   if(!prompt)throw fail('识别模式无效');
   let endpoint,headers,body;
   if(provider==='gemini'){
    endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    headers={'Content-Type':'application/json','x-goog-api-key':key};
    body={contents:[{role:'user',parts:[{text:prompt},...images]}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:65536}};
   }else{
    const base=provider==='qwen'?(configured('QWEN_BASE_URL',env,file)||'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'):provider==='openrouter'?'https://openrouter.ai/api/v1':provider==='openai'?'https://api.openai.com/v1':'https://api.deepseek.com';
    if(provider==='qwen'&&!/^https:\/\/[a-z0-9.-]+\/(?:compatible-mode\/v1|v1)\/?$/i.test(base))throw fail('QWEN_BASE_URL 必须是 HTTPS 的 OpenAI 兼容 v1 地址');
    endpoint=`${base.replace(/\/$/,'')}/chat/completions`;
    headers={'Content-Type':'application/json',Authorization:`Bearer ${key}`};
    if(provider==='openrouter'){headers['HTTP-Referer']='http://localhost';headers['X-OpenRouter-Title']='Music JianPu';}
    body={model,messages:[{role:'user',content:[{type:'text',text:prompt},...images.map(p=>({type:'image_url',image_url:{url:`data:${p.inlineData.mimeType};base64,${p.inlineData.data}`,detail:provider==='openai'?'original':'high'}}))]}]};
    if(provider!=='openrouter')body.response_format={type:'json_object'};
    if(provider==='openai'){body.max_completion_tokens=32768;body.store=false;}
    else body.max_tokens=32768;
    if(provider==='qwen')body.reasoning_effort='low';
   }
   if(provider==='openrouter'&&input.stream===true){
    body.stream=true;body.stream_options={include_usage:true};
    const signal=AbortSignal.any([upstreamController.signal,AbortSignal.timeout(requestTimeoutMs)]);
    res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});res.flushHeaders?.();
    const send=value=>res.write(JSON.stringify(value)+'\n');send({type:'started',model,provider,message:'已向 OpenRouter 提交请求，等待上游模型首段文字'});
    const pulse=setInterval(()=>send({type:'progress',message:'OpenRouter 请求处理中，连接保持中；尚未收到模型文字'}),5000);
    try{
     const response=await fetchImpl(endpoint,{method:'POST',headers,body:JSON.stringify(body),signal});
     if(!response.ok){const error=await response.json().catch(()=>null);throw fail(`OpenRouter 请求失败（HTTP ${response.status}）：${String(error?.error?.message||'请检查 API Key、模型名称和余额').slice(0,400)}`,response.status>=400&&response.status<500?response.status:502);}
     const result=await readOpenRouterScoreStream(response,text=>send({type:'delta',text}));
     clearInterval(pulse);send({type:'result',...result,model,provider});res.end();return true;
    }catch(error){clearInterval(pulse);throw error;}
   }
   if(provider==='gemini'&&input.stream===true){
    const signal=AbortSignal.any([upstreamController.signal,AbortSignal.timeout(requestTimeoutMs)]);
    res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});res.flushHeaders?.();
    const send=value=>res.write(JSON.stringify(value)+'\n');send({type:'started',model,provider,message:'已向 Gemini 提交请求，等待模型首段文字'});
    const pulse=setInterval(()=>send({type:'progress',message:'Gemini 请求处理中，连接保持中；尚未收到模型文字'}),5000);
    try{
     const response=await fetchImpl(endpoint.replace(':generateContent',':streamGenerateContent?alt=sse'),{method:'POST',headers,body:JSON.stringify(body),signal});
     if(!response.ok){const error=await response.json().catch(()=>null);throw fail(`Gemini 请求失败（HTTP ${response.status}）：${String(error?.error?.message||'请检查模型和额度').slice(0,400)}`,response.status>=400&&response.status<500?response.status:502);}
     const result=await readGeminiScoreStream(response,text=>send({type:'delta',text}),{signal});
     clearInterval(pulse);send({type:'result',...result,model,provider});res.end();return true;
    }catch(error){clearInterval(pulse);throw error;}
   }
   let response,result;
   for(let attempt=0;attempt<3;attempt++){
    response=await fetchImpl(endpoint,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.any([upstreamController.signal,AbortSignal.timeout(requestTimeoutMs)])});
    result=await response.json().catch(()=>null);
    if(response.status!==503||attempt===2)break;
    await new Promise(resolve=>setTimeout(resolve,retryDelay(response,attempt)));
   }
   if(!response.ok){const status=response.status>=400&&response.status<500?response.status:response.status===503?503:502;throw fail(`${provider} 请求失败（HTTP ${response.status}）：${String(result?.error?.message||'请检查 API Key、模型名称和额度').slice(0,400)}`,status);}
   const candidate=result?.candidates?.[0],choice=result?.choices?.[0],text=provider==='gemini'?(candidate?.content?.parts||[]).map(p=>p.text||'').join(''):choice?.message?.content;
   if(candidate?.finishReason==='MAX_TOKENS'||choice?.finish_reason==='length')throw fail('模型输出超出长度限制。请减少单次图片数量或分段识别',502);
   if(!text)throw fail(`${provider} 没有返回 JSON（${candidate?.finishReason||choice?.finish_reason||'未知原因'}）`,502);
   res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({text,model,provider,usage:result.usageMetadata||result.usage||null}));
  }catch(e){if(streamPulse){clearInterval(streamPulse);streamPulse=null;}const message=(e.name==='TimeoutError'?`本地等待时限已到（${requestTimeoutMs/60000} 分钟），本次请求已取消；这不代表上游模型主动中断。已收到的文字保留在输出区，未完成内容不会导入谱面。`:e.message||'视觉模型识别失败').replaceAll(activeKey||'\0','[密钥已隐藏]');if(res.headersSent){if(!res.destroyed)res.end(JSON.stringify({type:'error',error:message})+'\n');}else{res.writeHead(e.status||500,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:message}));}}
  return true;
 }};
}
