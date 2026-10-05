import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
const ID=/^[a-f0-9-]{36}$/;
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
export function createLyricsAPI(root,{projects}){
 const jobs=new Map(),directory=resolve(root,'.audio-lyrics'),python=process.env.AUDIO_PYTHON||resolve(root,'.venv-audio/bin/python');let admitting=false;
 const publicJob=j=>({id:j.id,projectId:j.projectId,runId:j.runId,kind:j.kind,status:j.status,progress:j.progress,message:j.message,startedAt:j.startedAt});
 const save=j=>{j.saving=(j.saving||Promise.resolve()).then(()=>writeFile(resolve(j.folder,'job.json'),JSON.stringify(publicJob(j)))).catch(()=>{});return j.saving;};
 async function health(){try{const ready=JSON.parse(await readFile(resolve(root,'.cache/lyrics-ready.json'),'utf8'));if(ready.model!=='whisper-small'||ready.checkpoint!=='.cache/whisper/small.pt')throw Error();await access(python);await access(resolve(root,ready.checkpoint));return {ready:true,model:ready.model,setup:'npm run audio:lyrics'};}catch{return {ready:false,setup:'npm run audio:lyrics'};}}
 const kill=j=>{if(j.child?.pid)try{process.platform==='win32'?j.child.kill():process.kill(-j.child.pid,'SIGTERM');}catch{}};
 async function get(id){if(jobs.has(id))return jobs.get(id);try{const j={...JSON.parse(await readFile(resolve(directory,id,'job.json'),'utf8')),folder:resolve(directory,id)};if(j.status==='running'){j.status='error';j.message='服务已重启，歌词识别中断，请重试';await save(j);}jobs.set(id,j);return j;}catch{return null;}}
 async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>60000)throw Error('请求过大');}return JSON.parse(raw||'{}');}
 function launch(j,input,extra=[]){
  const child=spawn(python,[resolve(root,j.kind==='align'?'audio/lyrics-align.py':j.kind==='chords'?'audio/chords.py':j.kind==='intro'?'audio/intro-melody.py':'audio/lyrics-asr.py'),'--input',input,'--output',resolve(j.folder,'result.json'),...extra],{cwd:root,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32',env:{...process.env,NUMBA_CACHE_DIR:resolve(root,'.cache/numba')}});j.child=child;let lines='',stderr='';
  child.stdout.on('data',chunk=>{lines+=chunk;const parts=lines.split('\n');lines=parts.pop();for(const line of parts)try{const event=JSON.parse(line);if(j.status!=='running')continue;j.message=event.message;j.progress=Math.max(j.progress,Math.min(.99,event.progress||0));save(j);}catch{}});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-3000);const percentages=String(chunk).matchAll(/(\d+)%/g);for(const match of percentages)if(j.status==='running'){j.progress=Math.max(j.progress,Math.min(.98,.2+.75*Number(match[1])/100));save(j);}});
  const timer=setTimeout(()=>{if(j.status==='running'){j.status='error';j.message=j.kind==='chords'?'和弦分析超时，请缩短音频范围后重试':'歌词识别超时，请缩短片段';kill(j);save(j);}},15*60*1000);timer.unref();
  child.on('error',error=>{clearTimeout(timer);j.status='error';j.message=error.message;save(j);});
  child.on('exit',async code=>{clearTimeout(timer);j.child=null;if(j.status!=='running')return;try{if(code!==0)throw Error(stderr.trim().slice(-1000)||`${j.kind} 处理器退出（${code}）`);const result=JSON.parse(await readFile(resolve(j.folder,'result.json'),'utf8'));if(j.projectId)await projects.saveLyrics(j.projectId,j.runId,result,j.kind);j.status='done';j.progress=1;j.message=j.kind==='chords'?'和弦分析完成':'中文歌词识别完成';}catch(error){j.status='error';j.message=error.message;}await save(j);});
 }
 async function handle(req,res,url){if(!url.pathname.startsWith('/api/lyrics/'))return false;try{
  if(!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(req.headers.host||'')||req.headers['sec-fetch-site']==='cross-site'||req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`){json(res,403,{error:'仅允许本机页面'});return true;}
  if(url.pathname==='/api/lyrics/health'&&req.method==='GET'){json(res,200,await health());return true;}
  if(url.pathname==='/api/lyrics/jobs'&&req.method==='POST'){
   if(admitting||[...jobs.values()].some(j=>j.status==='running')){json(res,409,{error:'已有歌词任务处理中'});return true;}admitting=true;
   try{const data=await body(req);const kind=data.kind||'asr';if(!['asr','align','intro','chords'].includes(kind))throw Error('未知音频任务');if(kind==='asr'&&!(await health()).ready)throw Error('请先运行 npm run audio:lyrics');if(kind==='align'){try{await access(resolve(root,'.cache/lyrics-align/ready.json'));}catch{throw Error('请先运行 npm run audio:lyrics-align，准备中文声学对齐模型');}}if(!ID.test(data.runId)||data.projectId&&!ID.test(data.projectId))throw Error('工程或识别编号不合法');let input;
    if(data.projectId){const p=await projects.read(data.projectId),run=p.runs.find(r=>r.id===data.runId);if(run?.status!=='done'||!p.assets.some(a=>a.path===`runs/${run.id}/vocals.wav`))throw Error('请先完成主旋律识别');input=resolve(projects.folder(p.id),`runs/${run.id}/vocals.wav`);}
    else{const j=JSON.parse(await readFile(resolve(root,'.audio-jobs',data.runId,'job.json'),'utf8'));if(j.status!=='done')throw Error('主旋律识别未完成');input=resolve(root,'.audio-jobs',data.runId,'vocals.wav');}
    const id=randomUUID(),folder=resolve(directory,id);await mkdir(folder,{recursive:true});let extra=[];if(kind==='align'){if(typeof data.text!=='string'||!data.text.trim()||data.text.length>10000)throw Error('请粘贴正确歌词');await writeFile(resolve(folder,'transcript.txt'),data.text);extra=['--text',resolve(folder,'transcript.txt'),'--anchors',resolve(input,'../lyrics.json')];}if(kind==='intro'){if(!['other','guitar','piano','clip'].includes(data.source)||!Number.isFinite(data.start)||!Number.isFinite(data.end)||data.start<0||data.end<=data.start||data.end-data.start>120)throw Error('请选择有效前奏范围（最多120秒）');input=resolve(input,'../'+data.source+'.wav');await access(input);extra=['--source',data.source,'--start',String(data.start),'--end',String(data.end)];}if(kind==='chords'){if(!Array.isArray(data.windows)||!data.windows.length||data.windows.length>1000||data.windows.some(w=>!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.start<0||w.end<=w.start||w.end>601))throw Error('小节时间范围不合法');await writeFile(resolve(folder,'windows.json'),JSON.stringify(data.windows));extra=['--windows',resolve(folder,'windows.json')];}const j={id,folder,kind,projectId:data.projectId||null,runId:data.runId,status:'running',progress:.01,message:kind==='chords'?'开始分析伴奏和弦':'开始识别中文歌词',startedAt:Date.now()};jobs.set(id,j);await save(j);launch(j,input,extra);json(res,202,publicJob(j));
   }finally{admitting=false;}return true;
  }
  const match=url.pathname.match(/^\/api\/lyrics\/jobs\/([a-f0-9-]{36})(\/result)?$/);if(!match){json(res,404,{error:'没有这个歌词接口'});return true;}const j=await get(match[1]);if(!j){json(res,404,{error:'歌词任务不存在'});return true;}
  if(req.method==='DELETE'&&!match[2]){if(j.status==='running'){j.status='cancelled';j.message='已取消歌词识别';kill(j);await save(j);}json(res,200,publicJob(j));return true;}
  if(req.method==='GET'){if(match[2]){if(j.status!=='done')throw Error('歌词尚未完成');json(res,200,JSON.parse(await readFile(resolve(j.folder,'result.json'),'utf8')));}else json(res,200,publicJob(j));return true;}
  json(res,405,{error:'不支持的请求方式'});
 }catch(error){if(!res.headersSent)json(res,400,{error:error.message});else res.destroy();}return true;}
 return {handle,close(){for(const j of jobs.values())if(j.child){j.status='cancelled';j.message='服务器停止，歌词任务已取消';kill(j);save(j);}}};
}
