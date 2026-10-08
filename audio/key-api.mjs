import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {localPageRequest} from './local-origin.mjs';
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const kill=child=>{if(child?.pid>0)child.kill();};
const send=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
export function createKeyAPI(root,{projects}={}){
 const jobs=new Map(),python=process.env.AUDIO_PYTHON||resolve(root,'.venv-audio/bin/python');
 function publicJob(j){return {id:j.id,projectId:j.projectId,runId:j.runId,kind:j.kind,status:j.status,progress:j.progress,message:j.message,result:j.result};}
 async function handle(req,res,url){if(!url.pathname.startsWith('/api/key/'))return false;
  try{
   if(!localPageRequest(req))throw Error('接口仅供本机或局域网同源页面');
   if(url.pathname==='/api/key/jobs'&&req.method==='POST'){
    if([...jobs.values()].some(j=>j.status==='running'))throw Error('已有Do分析正在运行，请稍候或取消');
    let raw='';for await(const c of req){raw+=c;if(raw.length>4096)throw Error('请求过大');}const data=JSON.parse(raw||'{}');const {projectId,runId}=data;
    if(!ID.test(runId||'')||projectId&&!ID.test(projectId))throw Error('工程或识别编号不合法');
    let folder,offset=0;
    if(projectId){const p=await projects.read(projectId),run=p.runs.find(r=>r.id===runId);if(run?.status!=='done'||!p.assets.some(a=>a.path===`runs/${runId}/clip.wav`))throw Error('请先打开已完成识别的工程');folder=resolve(projects.folder(projectId),`runs/${runId}`);offset=+run.params.start||0;}
    else{folder=resolve(root,'.audio-jobs',runId);const job=JSON.parse(await readFile(resolve(folder,'job.json')));if(job.status!=='done')throw Error('识别尚未完成');const r=JSON.parse(await readFile(resolve(folder,'result.json')));offset=+r.clipStart||0;}
    const kind=data.kind==='measure'?'measure':'analyze',j={id:randomUUID(),projectId,runId,kind,status:'running',progress:0,message:'读取已有音轨'};
    const args=[resolve(root,'audio/key_analysis.py'),'--offset',String(offset)];
    if(kind==='measure'){if(!['vocals','clip'].includes(data.source)||!Number.isFinite(data.start)||!Number.isFinite(data.end)||data.start<offset||data.end-data.start<.12||data.end-data.start>3)throw Error('请选择原曲时间中0.12–3秒的稳定单音');args.push('--file',resolve(folder,data.source+'.wav'),'--start',String(data.start-offset),'--end',String(data.end-offset));}
    else args.push('--folder',folder);
    jobs.set(j.id,j);
    const child=spawn(python,args,{cwd:root,env:{...process.env,NUMBA_CACHE_DIR:resolve(root,'.cache/numba'),MPLCONFIGDIR:resolve(root,'.cache/matplotlib')},stdio:['ignore','pipe','pipe']});j.child=child;let buf='',stderr='';
    const timer=setTimeout(()=>{if(j.status==='running'){j.status='error';j.message='分析超时，请重试或选择更短音频';kill(child);}},300000);timer.unref();
    child.stdout.on('data',c=>{buf+=c;if(buf.length>6000000){kill(child);j.status='error';j.message='分析结果过大';return;}let at;while((at=buf.indexOf('\n'))>=0){const line=buf.slice(0,at);buf=buf.slice(at+1);try{const v=JSON.parse(line);if(j.status!=='running')continue;if(v.result)j.result=v.result;else{j.progress=v.progress;j.message=v.message;}}catch{}}});
    child.stderr.on('data',c=>stderr=(stderr+c).slice(-1800));child.on('error',e=>{clearTimeout(timer);j.status='error';j.message='本地Python不可用：'+e.message;});
    child.on('exit',code=>{clearTimeout(timer);j.child=null;if(j.status!=='running')return;j.status=code===0&&j.result?'done':'error';j.progress=j.status==='done'?1:j.progress;j.message=j.status==='done'?'分析完成；候选尚未确认':stderr||'分析失败';});
    // Bound retained job summaries; no model or user assets are deleted.
    if(jobs.size>32)for(const [id,old] of jobs){if(old.status!=='running'&&id!==j.id){jobs.delete(id);break;}}
    send(res,202,publicJob(j));return true;
   }
   const match=url.pathname.match(/^\/api\/key\/jobs\/([a-f0-9-]{36})$/),j=match&&jobs.get(match[1]);if(!j){send(res,404,{error:'没有这个Do分析任务；服务重启后可重新分析'});return true;}
   if(req.method==='DELETE'){if(j.status==='running'){j.status='cancelled';j.message='已取消';kill(j.child);}send(res,200,publicJob(j));return true;}
   if(req.method==='GET'){send(res,200,publicJob(j));return true;}
   send(res,405,{error:'请求方式不支持'});
  }catch(e){send(res,400,{error:e.message});}return true;
 }
 return {handle,close(){for(const j of jobs.values())kill(j.child);}};
}
