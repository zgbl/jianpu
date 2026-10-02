import {analysisMethod} from '../src/audio-input-mode.js';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {access,mkdir,readFile,writeFile,stat,copyFile} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {validate} from '../src/model.js';
const LIMIT=100*1024*1024;
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
export function createAudioAPI(root,{projects=null}={}){
 const jobs=new Map(),python=process.env.AUDIO_PYTHON||resolve(root,'.venv-audio/bin/python'),directory=resolve(root,'.audio-jobs');
 let admitting=false,rhythmBusy=false;const rhythmChildren=new Set();
 async function readiness(model='htdemucs'){
  const pythonReady=await access(python).then(()=>true,()=>false);
  let modelReady=false;
  try{const ready=JSON.parse(await readFile(resolve(root,model==='htdemucs_6s'?'.cache/audio-ready-6s.json':'.cache/audio-ready.json'),'utf8'));modelReady=ready.model===model&&ready.checkpoints.length>0;for(const path of ready.checkpoints){if(!path.startsWith('.cache/torch/')){modelReady=false;break;}await access(resolve(root,path));}}catch{modelReady=false;}
  return {pythonReady,modelReady,ready:pythonReady&&modelReady,method:'Demucs 人声分离 + pYIN',model,setup:model==='htdemucs_6s'?'npm run audio:stems':'npm run audio:setup'};
 }
 const publicJob=j=>({id:j.id,title:j.title,status:j.status,stage:j.stage,progress:j.progress,message:j.message,projectId:j.projectId||null,startedAt:j.startedAt});
 const save=j=>{const snapshot=JSON.stringify(publicJob(j));j.saving=(j.saving||Promise.resolve()).then(()=>writeFile(resolve(j.folder,'job.json'),snapshot)).catch(()=>{});return j.saving;};
 async function getJob(id){if(jobs.has(id))return jobs.get(id);try{const saved=JSON.parse(await readFile(resolve(directory,id,'job.json'),'utf8'));const j={...saved,folder:resolve(directory,id)};if(['running','uploading'].includes(j.status)){j.status='error';j.message='服务器已重启，处理已中断，可重新识别。';if(j.projectId&&projects)await projects.finishRun(j.projectId,j.id,j.folder,'interrupted',j.message);}if(j.projectId&&projects&&['error','cancelled'].includes(j.status)){const p=await projects.read(j.projectId);if(p.runs.some(r=>r.id===j.id&&r.status==='running'))await projects.finishRun(j.projectId,j.id,j.folder,j.status,j.message);}jobs.set(id,j);return j;}catch{return null;}}
 function finishFailure(j){if(j.projectId&&projects)return projects.finishRun(j.projectId,j.id,j.folder,j.status,j.message).catch(()=>{});return Promise.resolve();}
 function terminate(j){if(!j.child?.pid)return;try{if(process.platform==='win32')j.child.kill('SIGTERM');else process.kill(-j.child.pid,'SIGTERM');}catch{}}
 function launch(j,options){
  j.status='running';j.stage='decode';j.message='准备音频处理';save(j);
  const child=spawn(python,[resolve(root,'audio/transcribe.py'),'--input',resolve(j.folder,'input.audio'),'--output',j.folder,'--start',String(options.start),'--duration',String(options.duration),'--mode',options.mode,'--model',options.model],{cwd:root,env:{...process.env,TORCH_HOME:resolve(root,'.cache/torch'),NUMBA_CACHE_DIR:resolve(root,'.cache/numba'),MPLCONFIGDIR:resolve(root,'.cache/matplotlib')},stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});j.child=child;
  let pending='',stderr='';
  child.stdout.on('data',chunk=>{pending+=chunk;const lines=pending.split('\n');pending=lines.pop();for(const line of lines){try{const event=JSON.parse(line);if(j.status!=='running')continue;j.stage=event.stage;j.message=event.message;j.progress=Math.min(.99,event.progress||j.progress);save(j);}catch{}}});
  child.stderr.on('data',chunk=>stderr=(stderr+chunk).slice(-3000));
  const timeout=setTimeout(()=>{if(j.status==='running'){j.status='error';j.message='处理超过 30 分钟，请选取更短片段。';terminate(j);finishFailure(j);save(j);}},30*60*1000);timeout.unref();
  child.on('error',e=>{clearTimeout(timeout);j.status='error';j.message='音频环境不可用：'+e.message;finishFailure(j);save(j);});
  child.on('exit',async code=>{clearTimeout(timeout);j.child=null;if(j.status!=='running')return;if(code===0){try{JSON.parse(await readFile(resolve(j.folder,'result.json'),'utf8'));if(j.projectId)await projects.finishRun(j.projectId,j.id,j.folder,'done',j.message);j.status='done';j.progress=1;j.stage='done';}catch{j.status='error';j.message='识别结果未完整写出，请重试。';}}else{j.status='error';if(j.stage!=='error')j.message='识别失败：'+(stderr.trim().split('\n').at(-1)||`进程退出 ${code}`);}if(j.projectId&&j.status==='error'){try{await projects.finishRun(j.projectId,j.id,j.folder,'error',j.message);}catch{}}save(j);});
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
   if(url.pathname==='/api/audio/health'&&req.method==='GET'){const base=await readiness(),six=await readiness('htdemucs_6s');const lyricsReady=await access(resolve(root,'.cache/lyrics-ready.json')).then(()=>access(resolve(root,'.cache/whisper/small.pt'))).then(()=>true,()=>false);json(res,200,{...base,lyricsReady,models:{htdemucs:base.ready,htdemucs_6s:six.ready}});return true;}
   if(url.pathname==='/api/audio/rhythm'&&req.method==='POST'){
    if(rhythmBusy){json(res,409,{error:'节拍分析正在进行，请稍候'});return true;}
    rhythmBusy=true;
    try{
     const projectId=url.searchParams.get('projectId'),runId=url.searchParams.get('runId');
     if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(runId||''))throw Error('识别编号不合法');
     let folder;
     if(projectId){if(!projects)throw Error('工程接口不可用');const p=await projects.read(projectId),run=p.runs.find(r=>r.id===runId);if(run?.status!=='done'||!p.assets.some(a=>a.path===`runs/${runId}/clip.wav`))throw Error('请先完成音频识别');folder=resolve(projects.folder(projectId),`runs/${runId}`);}
     else{const j=await getJob(runId);if(j?.status!=='done')throw Error('请先完成音频识别');folder=j.folder;}
     const rhythm=await new Promise((ok,fail)=>{
      const meter=url.searchParams.get('meter')||'4';if(!['2','3','4'].includes(meter))throw Error('拍号不合法');
      const child=spawn(python,[resolve(root,'audio/rhythm.py'),'--folder',folder,'--meter',meter],{cwd:root,env:{...process.env,TORCH_HOME:resolve(root,'.cache/torch')},stdio:['ignore','pipe','pipe']});rhythmChildren.add(child);let output='',stderr='';
      const timer=setTimeout(()=>{child.kill();fail(Error('节拍分析超时，请缩短音频片段'));},90000);timer.unref();
      child.stdout.on('data',chunk=>{output+=chunk;if(output.length>1000000)child.kill();});child.stderr.on('data',chunk=>stderr=(stderr+chunk).slice(-2000));
      child.on('error',e=>{clearTimeout(timer);rhythmChildren.delete(child);fail(e);});
      child.on('exit',code=>{clearTimeout(timer);rhythmChildren.delete(child);try{if(code!==0)throw Error('节拍分析失败：'+stderr);ok(JSON.parse(output));}catch(e){fail(e);}});
     });
     json(res,200,rhythm);
    }finally{rhythmBusy=false;}
    return true;
   }
   if(url.pathname==='/api/audio/jobs'&&req.method==='POST'){
    if(admitting||[...jobs.values()].some(j=>['running','uploading'].includes(j.status))){json(res,409,{error:'已有音频正在处理，请等它完成或先取消。'});return true;}
    admitting=true;
    try{
     const selectedModel=url.searchParams.get('model')||'htdemucs';if(!['htdemucs','htdemucs_6s'].includes(selectedModel)){json(res,400,{error:'不支持的分离模型'});return true;}const ready=await readiness(selectedModel);if(!ready.pythonReady||!ready.modelReady){json(res,503,{error:'音频模型尚未准备，请运行 '+ready.setup+'。'});return true;}
     const options={model:selectedModel,projectId:url.searchParams.get('projectId'),start:Number(url.searchParams.get('start')||0),duration:Number(url.searchParams.get('duration')||30),mode:url.searchParams.get('mode')||'mixed'};
     if(!Number.isFinite(options.start)||options.start<0||options.start>36000||!Number.isFinite(options.duration)||options.duration<.5||options.duration>600||!['mixed','solo'].includes(options.mode)){json(res,400,{error:'片段时间或输入类型不合法。'});return true;}
     if(+(req.headers['content-length']||0)>LIMIT){json(res,413,{error:'Demo 音频文件最多 100MB。'});return true;}
     const id=url.searchParams.get('id')||randomUUID();if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))throw Error('任务编号不合法');const folder=resolve(directory,id);await mkdir(directory,{recursive:true});await mkdir(folder);
     const j={id,folder,startedAt:Date.now(),projectId:options.projectId,title:(url.searchParams.get('title')||'音频旋律').slice(0,180),status:'uploading',stage:'upload',progress:0,message:'正在接收音频'};jobs.set(id,j);
     try{let bytes=0;if(options.projectId){if(!projects)throw Error('工程接口不可用');const p=await projects.read(options.projectId);if(!p.source)throw Error('工程原曲缺失');await copyFile(resolve(projects.folder(p.id),p.source.path),resolve(folder,'input.audio'));bytes=(await stat(resolve(folder,'input.audio'))).size;}else await pipeline(req,new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;callback(bytes>LIMIT?Error('音频文件超过 100MB'):null,chunk);}}),createWriteStream(resolve(folder,'input.audio')));if(!bytes)throw Error('没有选择音频文件');if(j.status!=='cancelled'){if(options.projectId){if(!projects)throw Error('工程接口不可用');await projects.startRun(options.projectId,id,{start:options.start,duration:options.duration,mode:options.mode,model:options.model,method:analysisMethod(options.mode,options.model)});}launch(j,options);}json(res,202,publicJob(j));}catch(e){j.status='error';j.message=e.message;save(j);if(!res.destroyed)json(res,400,{error:e.message});}
    }finally{admitting=false;}
    return true;
   }
   const match=url.pathname.match(/^\/api\/audio\/jobs\/([0-9a-f-]{36})(?:\/((?:vocals|drums|bass|other|guitar|piano)\.wav|result\.json|score\.jpu))?$/);
   if(!match){json(res,404,{error:'没有这个音频接口。'});return true;}
   const j=await getJob(match[1]);if(!j){json(res,404,{error:'没有找到识别任务。'});return true;}
   const asset=match[2];
   if(!asset&&req.method==='GET'){json(res,200,publicJob(j));return true;}
   if(!asset&&req.method==='DELETE'){if(['running','uploading'].includes(j.status)){j.status='cancelled';j.message='已取消识别';terminate(j);if(j.projectId)await projects.finishRun(j.projectId,j.id,j.folder,'cancelled',j.message);await save(j);}json(res,200,publicJob(j));return true;}
   if(j.status!=='done'){json(res,409,{error:'音频尚未识别完成。'});return true;}
   if(asset==='score.jpu'&&req.method==='PUT'){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2_000_000)throw Error('乐谱超过 2MB');}const score=validate(JSON.parse(raw));await writeFile(resolve(j.folder,asset),JSON.stringify(score,null,2));json(res,200,{ok:true});return true;}
   if(asset&&req.method==='GET'){if(asset.endsWith('.wav'))await streamAudio(req,res,resolve(j.folder,asset));else json(res,200,JSON.parse(await readFile(resolve(j.folder,asset),'utf8')));return true;}
   json(res,405,{error:'不支持这个请求方式。'});
  }catch(e){if(!res.headersSent)json(res,e.code==='ENOENT'?404:400,{error:e.message});else res.destroy();}
  return true;
 }
 return {handle,close(){for(const child of rhythmChildren)child.kill();for(const j of jobs.values())if(j.child){j.status='cancelled';j.message='服务器停止，识别已取消';terminate(j);finishFailure(j);save(j);}}};
}
