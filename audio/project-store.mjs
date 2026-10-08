import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm,readdir,stat,copyFile,access} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {resolve,extname} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {spawn} from 'node:child_process';
import {validate} from '../src/model.js';
import {localPageRequest} from './local-origin.mjs';
const newScore=title=>validate({format:'jianpu-melody',version:2,title:String(title).slice(0,200),key:'C',meter:[4,4],measures:Array.from({length:4},()=>({id:randomUUID(),notes:[],repeatStart:false,repeatEnd:false})),spans:[],lyrics:[]});
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ASSET=/^(audio\/original\.(mp3|wav|m4a|flac|ogg|mp4|mov|m4v|audio)|runs\/[a-f0-9-]{36}\/(clip\.wav|vocals\.wav|drums\.wav|bass\.wav|other\.wav|guitar\.wav|piano\.wav|stems\.json|pitch-observations\.json|melody-candidates-v3\.json|key-analysis\.json|lyrics\.json|lyrics-alignment\.json|intro-melody\.json|chords\.json|result\.json|recognized\.jpu|params\.json))$/;
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const error=(message,status=400)=>Object.assign(Error(message),{status});
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
function validateWorkspace(value){
 if(!plain(value)||JSON.stringify(value).length>4_000_000)throw error('工作状态不合法');
 if(value.stage!==undefined&&!['editor','transcribe'].includes(value.stage))throw error('工程阶段不合法');
 for(const key of ['modelImage','comparison'])if(value[key]!==undefined){if(!plain(value[key]))throw error('比较谱状态不合法');if(value[key].score)validate(value[key].score);}
 for(const key of ['editor','transcribe'])if(value[key]!==undefined&&!plain(value[key]))throw error('工作视图状态不合法');
 const editor=value.editor;if(editor){if(editor.range!==undefined&&(!Array.isArray(editor.range)||editor.range.some(v=>typeof v!=='string')))throw error('选区不合法');for(const key of ['active','zoom','scrollTop','scrollLeft','originalTime','vocalTime'])if(editor[key]!==undefined&&(!Number.isFinite(editor[key])||editor[key]<0))throw error('工作位置不合法');}
 return value;
}
async function atomic(file,value){await mkdir(resolve(file,'..'),{recursive:true});const temporary=file+'.'+randomUUID()+'.tmp';try{await writeFile(temporary,JSON.stringify(value,null,2));await rename(temporary,file);}finally{await rm(temporary,{force:true});}}
async function digest(file){const hash=createHash('sha256');let size=0;for await(const chunk of createReadStream(file)){hash.update(chunk);size+=chunk.length;}return {size,sha256:hash.digest('hex')};}
async function body(req,limit=8*1024*1024){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw error('请求数据过大',413);chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}
async function upload(req,file,limit){let bytes=0;try{await pipeline(req,new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;callback(bytes>limit?error('文件体积超过限制',413):null,chunk);}}),createWriteStream(file));if(!bytes)throw error('文件为空');}catch(e){await rm(file,{force:true});throw e;}}
export function createProjectStore(root){
 const directory=resolve(root,'.projects'),queues=new Map();
 const folder=id=>{if(!ID.test(id))throw error('工程编号不合法');return resolve(directory,id);};
 async function read(id){try{return JSON.parse(await readFile(resolve(folder(id),'project.json'),'utf8'));}catch(e){if(e.code==='ENOENT')throw error('没有找到工程',404);throw e;}}
 function serial(id,fn){const previous=queues.get(id)||Promise.resolve(),next=previous.catch(()=>{}).then(fn);queues.set(id,next);next.finally(()=>{if(queues.get(id)===next)queues.delete(id);}).catch(()=>{});return next;}
 async function write(p){p.revision++;p.updatedAt=new Date().toISOString();await atomic(resolve(folder(p.id),'project.json'),p);return p;}
 async function create(name='未命名工程'){
  const id=randomUUID(),p={format:'jianpu-project',version:1,id,name:String(name).trim().slice(0,200)||'未命名工程',revision:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),source:null,activeRunId:null,runs:[],assets:[],score:newScore(name),scoreBasedOn:null,workspace:{stage:'transcribe',transcribe:{},editor:{}}};
  await mkdir(folder(id),{recursive:true});await atomic(resolve(folder(id),'project.json'),p);return p;
 }
 const assetURL=(id,path)=>`/api/projects/${id}/asset?path=${encodeURIComponent(path)}`;
 async function register(p,path){const info=await digest(resolve(folder(p.id),path));p.assets=p.assets.filter(a=>a.path!==path);p.assets.push({path,...info});}
 async function addSource(id,req,name){return serial(id,async()=>{
  const p=await read(id);if(p.source)throw error('工程已有原曲，请新建工程导入另一首歌',409);
  const ext=extname(name||'').toLowerCase(),video=['.mp4','.mov','.m4v'].includes(ext),path='audio/original'+(['.mp3','.wav','.m4a','.flac','.ogg','.mp4','.mov','.m4v'].includes(ext)?ext:'.audio');await mkdir(resolve(folder(id),'audio'),{recursive:true});const tmp=resolve(folder(id),path+'.tmp');await upload(req,tmp,(video?300:100)*1024*1024);await rename(tmp,resolve(folder(id),path));await register(p,path);p.source={path,originalName:String(name||'音频').slice(0,200)};return write(p);
 });}
 async function patch(id,data){return serial(id,async()=>{
  const p=await read(id);if(data.revision!==p.revision)throw error('工程版本已变化，请重新打开；未保存的编辑已保留在当前页面',409);
  if(data.score){const next=validate(data.score);if(data.archiveScore&&JSON.stringify(next)!==JSON.stringify(p.score))remember(p);p.score=next;p.name=p.score.title;if(data.scoreBasedOn!==undefined){if(data.scoreBasedOn!==null&&!p.runs.some(r=>r.id===data.scoreBasedOn&&r.status==='done'))throw error('乐谱来源识别版本不合法');p.scoreBasedOn=data.scoreBasedOn;}}
  if(data.workspace){validateWorkspace(data.workspace);p.workspace={...p.workspace,...data.workspace};}
  if(data.keyAnalysis){const {runId,value}=data.keyAnalysis;const run=p.runs.find(r=>r.id===runId);if(run?.status!=='done'||value?.runId!==runId||value?.version!==1||!Array.isArray(value.candidates)||value.candidates.length!==24||JSON.stringify(value).length>2000000)throw error('Do分析数据不合法');if(run.keyAnalysisRevision!==value.revision){const path=`runs/${runId}/key-analysis.json`;await atomic(resolve(folder(id),path),value);await register(p,path);run.keyAnalysisRevision=value.revision;}}
  if(data.preview){const r=p.runs.find(r=>r.id===data.preview.runId);if(!r||r.status!=='done')throw error('识别版本尚未完成');r.notation=data.preview.notation;const path=`runs/${r.id}/recognized.jpu`;await atomic(resolve(folder(id),path),validate(data.preview.score));await register(p,path);}
  return write(p);
 });}
 async function saveLyrics(id,runId,value,kind='asr'){return serial(id,async()=>{const p=await read(id),run=p.runs.find(r=>r.id===runId);if(run?.status!=='done')throw error('识别版本未完成');if(kind==='asr'&&(typeof value.text!=='string'||value.text.length>20000||!Array.isArray(value.words)||value.words.length>10000||value.words.some(w=>typeof w.text!=='string'||!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.start<0||w.end<=w.start)))throw error('歌词识别数据不合法');const path=`runs/${runId}/${kind==='align'?'lyrics-alignment.json':kind==='intro'?'intro-melody.json':kind==='chords'?'chords.json':'lyrics.json'}`;await atomic(resolve(folder(id),path),value);await register(p,path);return write(p);});}
 async function startRun(id,runId,params){return serial(id,async()=>{const p=await read(id);if(!p.source)throw error('工程没有原曲');if(!ID.test(runId))throw error('识别编号不合法');if(p.runs.length>=30)throw error('工程最多保留 30 次识别，请另建工程');if(p.runs.some(r=>r.id===runId))throw error('识别版本重复');p.runs.push({id:runId,jobId:runId,status:'running',params,createdAt:new Date().toISOString()});p.activeRunId=runId;return write(p);});}
 async function finishRun(id,runId,jobFolder,status,message){return serial(id,async()=>{
  const p=await read(id),r=p.runs.find(r=>r.id===runId);if(!r)return;p.activeRunId=runId;r.status=status;r.message=message;
  const base=`runs/${runId}`;await mkdir(resolve(folder(id),base),{recursive:true});
  // Only files present at a completed boundary are adopted; a cancelled run never claims success.
  for(const file of status==='done'?['clip.wav','vocals.wav','drums.wav','bass.wav','other.wav','guitar.wav','piano.wav','stems.json','pitch-observations.json','melody-candidates-v3.json','result.json']:[]){
   const source=resolve(jobFolder,file);if(await access(source).then(()=>true,()=>false)){await copyFile(source,resolve(folder(id),base,file));await register(p,`${base}/${file}`);}
  }
  await atomic(resolve(folder(id),base,'params.json'),r.params);await register(p,`${base}/params.json`);return write(p);
 });}
 function remember(p){if(p.score.measures.some(m=>m.notes.length))p.history=[{id:randomUUID(),savedAt:new Date().toISOString(),score:p.score,basedOn:p.scoreBasedOn},...(p.history||[])].slice(0,10);}
 async function adopt(id,runId){return serial(id,async()=>{const p=await read(id),r=p.runs.find(r=>r.id===runId);if(!r||r.status!=='done')throw error('没有已完成的识别版本');const path=`runs/${runId}/recognized.jpu`,incoming=validate(JSON.parse(await readFile(resolve(folder(id),path),'utf8')));remember(p);p.score=incoming;p.scoreBasedOn=runId;p.name=p.score.title;p.workspace.stage='editor';p.workspace.editor={};return write(p);});}
 async function restore(id,historyId){return serial(id,async()=>{const p=await read(id),h=p.history?.find(h=>h.id===historyId);if(!h)throw error('修订版本不存在');const incoming=structuredClone(h);remember(p);p.score=validate(incoming.score);p.scoreBasedOn=incoming.basedOn;p.name=p.score.title;p.workspace.stage='transcribe';p.workspace.editor={};p.workspace.transcribe={...p.workspace.transcribe,unified:true,scoreEdited:true,runId:incoming.basedOn||null,bpm:String(p.score.transcription?.heardBpm??p.score.tempo??p.score.transcription?.bpm??120),beatUnit:String(p.score.transcription?.heardBeatUnit??1),meter:String(p.score.meter[0]),key:p.score.key,rhythmMode:p.score.transcription?.rhythmMode||'fixed',barAnchor:String(p.score.transcription?.barAnchor||0),manualBars:p.score.transcription?.manualCalibration?.points||[],manualCalibration:p.score.transcription?.manualCalibration||null,inlineEditor:{}};return write(p);});}
 async function legacy(){const jobs=resolve(root,'.audio-jobs'),items=[];try{for(const id of await readdir(jobs)){if(!ID.test(id))continue;try{const j=JSON.parse(await readFile(resolve(jobs,id,'job.json'),'utf8'));if(j.status==='done'){const info=await stat(resolve(jobs,id,'result.json'));items.push({id,title:j.title||'旧识别',updatedAt:info.mtime.toISOString()});}}catch{}}}catch{}return items.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
 async function recover(jobId){if(!ID.test(jobId))throw error('旧任务编号不合法');const sourceFolder=resolve(root,'.audio-jobs',jobId),j=JSON.parse(await readFile(resolve(sourceFolder,'job.json'),'utf8')),result=JSON.parse(await readFile(resolve(sourceFolder,'result.json'),'utf8'));if(j.status!=='done')throw error('旧任务尚未完成');const p=await create(j.title||'恢复的歌曲工程');try{const path='audio/original.audio';await mkdir(resolve(folder(p.id),'audio'));await copyFile(resolve(sourceFolder,'input.audio'),resolve(folder(p.id),path));await register(p,path);p.source={path,originalName:j.title||'原曲'};await write(p);await startRun(p.id,jobId,{start:result.clipStart||0,duration:result.duration,mode:result.sourceMode,model:'htdemucs'});await finishRun(p.id,jobId,sourceFolder,'done','已恢复旧识别');let restored=await read(p.id);const file=resolve(sourceFolder,'score.jpu');if(await access(file).then(()=>true,()=>false)){const score=validate(JSON.parse(await readFile(file,'utf8')));restored=await patch(p.id,{revision:restored.revision,score,preview:{runId:jobId,score,notation:{}},workspace:{stage:'editor'}});restored.scoreBasedOn=jobId;await write(restored);}return restored;}catch(e){await rm(folder(p.id),{recursive:true,force:true});throw e;}}
 async function archive(action,input,output){const local=resolve(root,'.venv-audio/bin/python'),python=process.env.AUDIO_PYTHON||(await access(local).then(()=>true,()=>false)?local:'python3');await new Promise((ok,fail)=>{const child=spawn(python,[resolve(root,'audio/project-archive.py'),action,input,output],{stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',c=>stderr=(stderr+c).slice(-2000));child.on('error',()=>fail(error('工程归档需要 Python 3，请安装或运行音频环境准备命令')));child.on('exit',code=>code===0?ok():fail(error('工程归档失败：'+stderr.trim())));});}
 async function exportPackage(id){return serial(id,async()=>{
  const p=await read(id),temp=resolve(directory,'.export-'+randomUUID());await mkdir(temp,{recursive:true});try{
   const assets=[];for(const a of p.assets){if(!ASSET.test(a.path))throw error('资产路径不合法');await mkdir(resolve(temp,a.path,'..'),{recursive:true});await copyFile(resolve(folder(id),a.path),resolve(temp,a.path));assets.push({...a});}
   for(const [path,data] of [['score/edited.jpu',p.score],['state/workspace.json',p.workspace]]){await atomic(resolve(temp,path),data);assets.push({path,...await digest(resolve(temp,path))});}
   const {score,workspace,...metadata}=p;await atomic(resolve(temp,'manifest.json'),{...metadata,assets,scorePath:'score/edited.jpu',workspacePath:'state/workspace.json'});const output=temp+'.jpp';await archive('pack',temp,output);return {path:output,revision:p.revision,name:p.name,cleanup:()=>rm(output,{force:true})};
  }finally{await rm(temp,{recursive:true,force:true});}
 });}
 async function importPackage(req){await mkdir(directory,{recursive:true});const temp=resolve(directory,'.import-'+randomUUID()),input=temp+'.jpp';await mkdir(temp);try{
  await upload(req,input,2*1024**3);await archive('unpack',input,temp);const manifest=JSON.parse(await readFile(resolve(temp,'manifest.json'),'utf8'));
  if(manifest.format!=='jianpu-project'||manifest.version!==1||!Array.isArray(manifest.assets)||!Array.isArray(manifest.runs)||manifest.runs.length>30||!ID.test(manifest.id))throw error('工程格式或版本不支持');
  if(manifest.history!==undefined){if(!Array.isArray(manifest.history)||manifest.history.length>10)throw error('修订历史不合法');for(const h of manifest.history){if(!ID.test(h.id))throw error('修订历史不合法');validate(h.score);}}
  const paths=new Set();for(const a of manifest.assets){if(!plain(a)||!['score/edited.jpu','state/workspace.json'].includes(a.path)&&!ASSET.test(a.path)||paths.has(a.path))throw error('工程资产清单不合法');paths.add(a.path);const info=await digest(resolve(temp,a.path));if(info.size!==a.size||info.sha256!==a.sha256)throw error('工程资产缺失或校验失败：'+a.path);}
  for(const required of ['score/edited.jpu','state/workspace.json'])if(!paths.has(required))throw error('工程缺少编辑状态');
  if(manifest.source&&!paths.has(manifest.source.path))throw error('工程原曲缺失');
  for(const r of manifest.runs){if(!ID.test(r.id)||!plain(r.params))throw error('识别版本不合法');if(r.status==='done')for(const file of ['clip.wav','vocals.wav','result.json'])if(!paths.has(`runs/${r.id}/${file}`))throw error('识别结果不完整');if(['running','uploading'].includes(r.status)){r.status='interrupted';r.message='导入的识别任务已中断，请重新识别';}delete r.jobId;}
  const workspace=validateWorkspace(JSON.parse(await readFile(resolve(temp,'state/workspace.json'),'utf8')));
  const p={...manifest,id:randomUUID(),revision:0,importedFrom:manifest.id,updatedAt:new Date().toISOString(),score:validate(JSON.parse(await readFile(resolve(temp,'score/edited.jpu'),'utf8'))),workspace,assets:manifest.assets.filter(a=>ASSET.test(a.path))};
  delete p.scorePath;delete p.workspacePath;await atomic(resolve(temp,'project.json'),p);await rm(resolve(temp,'manifest.json'));await rename(temp,folder(p.id));return p;
 }finally{await rm(temp,{recursive:true,force:true});await rm(input,{force:true});}}
 async function list(){await mkdir(directory,{recursive:true});const found=[];for(const name of await readdir(directory)){if(!ID.test(name))continue;try{const p=await read(name);found.push({id:p.id,name:p.name,updatedAt:p.updatedAt,revision:p.revision,stage:p.workspace.stage,hasAudio:!!p.source});}catch{}}return found.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
 async function stream(req,res,path,type){const info=await stat(path);let start=0,end=info.size-1;const range=req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);if(range){if(!range[1]&&range[2])start=Math.max(0,info.size-Number(range[2]));else{start=Number(range[1]||0);end=range[2]?Math.min(end,Number(range[2])):end;}if(start>end||start>=info.size){res.writeHead(416,{'Content-Range':`bytes */${info.size}`});res.end();return;}}
  res.writeHead(range?206:200,{'Content-Type':type,'Cache-Control':'no-store','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${info.size}`}:{})});await pipeline(createReadStream(path,{start,end}),res);
 }
 async function handle(req,res,url){if(!url.pathname.startsWith('/api/projects'))return false;try{
  if(!localPageRequest(req))throw error('工程接口仅供本机或局域网同源页面使用',403);
  if(url.pathname==='/api/projects'&&req.method==='GET'){json(res,200,await list());return true;}
  if(url.pathname==='/api/projects'&&req.method==='POST'){json(res,201,await create((await body(req)).name));return true;}
  if(url.pathname==='/api/projects/import'&&req.method==='POST'){json(res,201,await importPackage(req));return true;}
  if(url.pathname==='/api/projects/legacy'&&req.method==='GET'){json(res,200,await legacy());return true;}
  if(url.pathname==='/api/projects/legacy'&&req.method==='POST'){json(res,201,await recover((await body(req)).jobId));return true;}
  const match=url.pathname.match(/^\/api\/projects\/([a-f0-9-]{36})(?:\/(source|asset|export|adopt|restore))?$/);if(!match)throw error('没有这个工程接口',404);const id=match[1],action=match[2];
  if(!action&&req.method==='GET'){json(res,200,await read(id));return true;}
  if(!action&&req.method==='PATCH'){json(res,200,await patch(id,await body(req)));return true;}
  if(action==='source'&&req.method==='PUT'){json(res,200,await addSource(id,req,url.searchParams.get('name')));return true;}
  if(action==='adopt'&&req.method==='POST'){json(res,200,await adopt(id,(await body(req)).runId));return true;}
  if(action==='restore'&&req.method==='POST'){json(res,200,await restore(id,(await body(req)).historyId));return true;}
  if(action==='asset'&&req.method==='GET'){const p=await read(id),path=url.searchParams.get('path');if(!p.assets.some(a=>a.path===path)||!ASSET.test(path))throw error('没有这个工程资产',404);await stream(req,res,resolve(folder(id),path),path.endsWith('.wav')?'audio/wav':path.endsWith('.mp3')?'audio/mpeg':path.endsWith('.m4a')?'audio/mp4':path.endsWith('.mp4')||path.endsWith('.m4v')?'video/mp4':path.endsWith('.mov')?'video/quicktime':path.endsWith('.flac')?'audio/flac':path.endsWith('.ogg')?'audio/ogg':path.endsWith('.json')||path.endsWith('.jpu')?'application/json':'application/octet-stream');return true;}
  if(action==='export'&&req.method==='GET'){const exported=await exportPackage(id);try{const info=await stat(exported.path);res.writeHead(200,{'Content-Type':'application/zip','Content-Length':info.size,'X-Project-Revision':String(exported.revision),'Content-Disposition':`attachment; filename="project.jpp"; filename*=UTF-8''${encodeURIComponent(exported.name+'.jpp')}`});await pipeline(createReadStream(exported.path),res);}finally{await exported.cleanup();}return true;}
  throw error('不支持这个工程操作',405);
 }catch(e){if(!res.headersSent)json(res,e.status||400,{error:e.message});else res.destroy();}return true;}
 return {handle,read,patch,saveLyrics,create,list,addSource,startRun,finishRun,adopt,exportPackage,importPackage,folder,assetURL};
}
