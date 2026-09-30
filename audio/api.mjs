import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {access,mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {validate} from '../src/model.js';
const LIMIT=100*1024*1024;
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
export function createAudioAPI(root){
 const jobs=new Map(),python=process.env.AUDIO_PYTHON||resolve(root,'.venv-audio/bin/python'),directory=resolve(root,'.audio-jobs');
 let admitting=false;
 async function readiness(){
  const pythonReady=await access(python).then(()=>true,()=>false);
  let modelReady=false;
  try{const ready=JSON.parse(await readFile(resolve(root,'.cache/audio-ready.json'),'utf8'));modelReady=ready.model==='htdemucs'&&ready.checkpoints.length>0;for(const path of ready.checkpoints){if(!path.startsWith('.cache/torch/')){modelReady=false;break;}await access(resolve(root,path));}}catch{modelReady=false;}
  return {pythonReady,modelReady,ready:pythonReady&&modelReady,method:'Demucs 人声分离 + pYIN',setup:'npm run audio:setup'};
 }
 const publicJob=j=>({id:j.id,title:j.title,status:j.status,stage:j.stage,progress:j.progress,message:j.message});
 const save=j=>{const snapshot=JSON.stringify(publicJob(j));j.saving=(j.saving||Promise.resolve()).then(()=>writeFile(resolve(j.folder,'job.json'),snapshot)).catch(()=>{});return j.saving;};
 async function getJob(id){if(jobs.has(id))return jobs.get(id);try{const saved=JSON.parse(await readFile(resolve(directory,id,'job.json'),'utf8'));const j={...saved,folder:resolve(directory,id)};if(['running','uploading'].includes(j.status)){j.status='error';j.message='服务器已重启，请重新识别音频。';}jobs.set(id,j);return j;}catch{return null;}}
 function terminate(j){if(!j.child?.pid)return;try{if(process.platform==='win32')j.child.kill('SIGTERM');else process.kill(-j.child.pid,'SIGTERM');}catch{}}
 function launch(j,options){
  j.status='running';j.stage='decode';j.message='准备音频处理';save(j);
  const child=spawn(python,[resolve(root,'audio/transcribe.py'),'--input',resolve(j.folder,'input.audio'),'--output',j.folder,'--start',String(options.start),'--duration',String(options.duration),'--mode',options.mode],{cwd:root,env:{...process.env,TORCH_HOME:resolve(root,'.cache/torch'),NUMBA_CACHE_DIR:resolve(root,'.cache/numba'),MPLCONFIGDIR:resolve(root,'.cache/matplotlib')},stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});j.child=child;
  let pending='',stderr='';
  child.stdout.on('data',chunk=>{pending+=chunk;const lines=pending.split('\n');pending=lines.pop();for(const line of lines){try{const event=JSON.parse(line);if(j.status!=='running')continue;j.stage=event.stage;j.message=event.message;j.progress=Math.min(.99,event.progress||j.progress);save(j);}catch{}}});
  child.stderr.on('data',chunk=>stderr=(stderr+chunk).slice(-3000));
  const timeout=setTimeout(()=>{if(j.status==='running'){j.status='error';j.message='处理超过 30 分钟，请选取更短片段。';terminate(j);save(j);}},30*60*1000);timeout.unref();
  child.on('error',e=>{clearTimeout(timeout);j.status='error';j.message='音频环境不可用：'+e.message;save(j);});
  child.on('exit',async code=>{clearTimeout(timeout);j.child=null;if(j.status!=='running')return;if(code===0){try{JSON.parse(await readFile(resolve(j.folder,'result.json'),'utf8'));j.status='done';j.progress=1;j.stage='done';}catch{j.status='error';j.message='识别结果未完整写出，请重试。';}}else{j.status='error';if(j.stage!=='error')j.message='识别失败：'+(stderr.trim().split('\n').at(-1)||`进程退出 ${code}`);}save(j);});
 }
 async function streamAudio(req,res,file){
  const {size}=await stat(file);let start=0,end=size-1;const match=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  if(match){start=+match[1];end=match[2]?Math.min(+match[2],size-1):size-1;if(start>end||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return;}}
  res.writeHead(match?206:200,{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':end-start+1,'Cache-Control':'no-store',...(match?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});await pipeline(createReadStream(file,{start,end}),res);
 }
 async function handle(req,res,url){
  if(!url.pathname.startsWith('/api/audio/'))return false;
  try{
   if(!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(req.headers.host||'')||req.headers['sec-fetch-site']==='cross-site'){json(res,403,{error:'音频接口仅供本机页面使用。'});return true;}
   if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`){json(res,403,{error:'仅允许当前本地页面发起请求。'});return true;}
   if(url.pathname==='/api/audio/health'&&req.method==='GET'){json(res,200,await readiness());return true;}
   if(url.pathname==='/api/audio/jobs'&&req.method==='POST'){
    if(admitting||[...jobs.values()].some(j=>['running','uploading'].includes(j.status))){json(res,409,{error:'已有音频正在处理，请等它完成或先取消。'});return true;}
    admitting=true;
    try{
     const ready=await readiness();if(!ready.pythonReady||!ready.modelReady){json(res,503,{error:'音频环境尚未准备，请运行 npm run audio:setup。'});return true;}
     const options={start:Number(url.searchParams.get('start')||0),duration:Number(url.searchParams.get('duration')||30),mode:url.searchParams.get('mode')||'mixed'};
     if(!Number.isFinite(options.start)||options.start<0||options.start>36000||!Number.isFinite(options.duration)||options.duration<.5||options.duration>600||!['mixed','solo'].includes(options.mode)){json(res,400,{error:'片段时间或输入类型不合法。'});return true;}
     if(+(req.headers['content-length']||0)>LIMIT){json(res,413,{error:'Demo 音频文件最多 100MB。'});return true;}
     const id=url.searchParams.get('id')||randomUUID();if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))throw Error('任务编号不合法');const folder=resolve(directory,id);await mkdir(directory,{recursive:true});await mkdir(folder);
     const j={id,folder,title:(url.searchParams.get('title')||'音频旋律').slice(0,180),status:'uploading',stage:'upload',progress:0,message:'正在接收音频'};jobs.set(id,j);
     try{let bytes=0;await pipeline(req,new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;callback(bytes>LIMIT?Error('音频文件超过 100MB'):null,chunk);}}),createWriteStream(resolve(folder,'input.audio')));if(!bytes)throw Error('没有选择音频文件');if(j.status!=='cancelled')launch(j,options);json(res,202,publicJob(j));}catch(e){j.status='error';j.message=e.message;save(j);if(!res.destroyed)json(res,400,{error:e.message});}
    }finally{admitting=false;}
    return true;
   }
   const match=url.pathname.match(/^\/api\/audio\/jobs\/([0-9a-f-]{36})(?:\/(vocals\.wav|result\.json|score\.jpu))?$/);
   if(!match){json(res,404,{error:'没有这个音频接口。'});return true;}
   const j=await getJob(match[1]);if(!j){json(res,404,{error:'没有找到识别任务。'});return true;}
   const asset=match[2];
   if(!asset&&req.method==='GET'){json(res,200,publicJob(j));return true;}
   if(!asset&&req.method==='DELETE'){if(['running','uploading'].includes(j.status)){j.status='cancelled';j.message='已取消识别';terminate(j);await save(j);}json(res,200,publicJob(j));return true;}
   if(j.status!=='done'){json(res,409,{error:'音频尚未识别完成。'});return true;}
   if(asset==='score.jpu'&&req.method==='PUT'){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2_000_000)throw Error('乐谱超过 2MB');}const score=validate(JSON.parse(raw));await writeFile(resolve(j.folder,asset),JSON.stringify(score,null,2));json(res,200,{ok:true});return true;}
   if(asset&&req.method==='GET'){if(asset==='vocals.wav')await streamAudio(req,res,resolve(j.folder,asset));else json(res,200,JSON.parse(await readFile(resolve(j.folder,asset),'utf8')));return true;}
   json(res,405,{error:'不支持这个请求方式。'});
  }catch(e){if(!res.headersSent)json(res,e.code==='ENOENT'?404:400,{error:e.message});else res.destroy();}
  return true;
 }
 return {handle,close(){for(const j of jobs.values())if(j.child){j.status='cancelled';j.message='服务器停止，识别已取消';terminate(j);save(j);}}};
}
