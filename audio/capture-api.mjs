import {captureErrorMessage,capturePermissionDenied} from '../src/capture-audio.js';
import {localPageRequest,serverDeviceRequest} from './local-origin.mjs';
import {spawn} from 'node:child_process';import {access,mkdir,stat,readFile} from 'node:fs/promises';import {resolve} from 'node:path';import {randomUUID} from 'node:crypto';
const send=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const stopChild=c=>{if(c?.pid>0)c.kill();};
export function createCaptureAPI(root){
 const helper=resolve(root,'.cache/bin/audio-capture'),folder=resolve(root,'.audio-captures'),jobs=new Map(),children=new Set();let listing=false;
 const ready=async()=>process.platform==='darwin'&&await access(helper).then(()=>true,()=>false);
 const info=j=>({id:j.id,status:j.status,message:j.message,seconds:Math.floor((Date.now()-(j.startedAt||Date.now()))/1000),bundleId:j.bundleId});
 async function handle(req,res,url){if(!url.pathname.startsWith('/api/capture/'))return false;
 try{
  if(!localPageRequest(req)){send(res,403,{error:'采集仅供本机或局域网同源页面使用'});return true;}
  if(url.pathname==='/api/capture/health'&&req.method==='GET'){send(res,200,{ready:serverDeviceRequest(req)&&await ready(),serverDevice:serverDeviceRequest(req),platform:process.platform,setup:'npm run audio:capture-setup'});return true;}
  if(!serverDeviceRequest(req)){send(res,403,{error:'只能录制当前客户端设备；服务器 App 采集仅限服务器本机页面'});return true;}
  if(url.pathname==='/api/capture/apps'&&req.method==='POST'){
   if(!await ready())throw Error('请先运行 npm run audio:capture-setup');if(listing||[...jobs.values()].some(j=>['starting','recording','stopping'].includes(j.status)))throw Error('采集正在运行，请先停止');listing=true;
   try{const apps=await new Promise((ok,fail)=>{const child=spawn(helper,['list']);children.add(child);let output='';const timer=setTimeout(()=>{stopChild(child);fail(Error('读取App超时，请检查macOS录制权限'));},60000);child.stdout.on('data',c=>{output+=c;if(output.length>200000){stopChild(child);fail(Error('App列表过大'));}});child.on('error',fail);child.on('close',code=>{clearTimeout(timer);children.delete(child);try{const value=JSON.parse(output.trim().split('\n').at(-1));if(code!==0||!Array.isArray(value.apps))throw Error(value.message||'读取App失败');ok(value.apps);}catch(e){fail(e);}});});send(res,200,{apps});}finally{listing=false;}return true;
  }
  if(url.pathname==='/api/capture/jobs'&&req.method==='POST'){
   if(!await ready())throw Error('请先运行 npm run audio:capture-setup');if(listing||[...jobs.values()].some(j=>['starting','recording','stopping'].includes(j.status)))throw Error('已有采集正在运行');let raw='';for await(const c of req){raw+=c;if(raw.length>2048)throw Error('请求过大');}const {bundleId}=JSON.parse(raw);if(typeof bundleId!=='string'||! /^[a-zA-Z0-9._-]{1,200}$/.test(bundleId))throw Error('请选择正在运行的App');
   const id=randomUUID(),dir=resolve(folder,id);await mkdir(dir,{recursive:true});const j={id,bundleId,status:'starting',message:'等待macOS录制权限',path:resolve(dir,'recording.m4a')};jobs.set(id,j);
   const child=spawn(helper,['record',bundleId,j.path],{stdio:['pipe','pipe','pipe']});j.child=child;children.add(child);let pending='',err='';
   j.timer=setTimeout(()=>{if(j.status==='recording'){j.status='stopping';j.message='达到十分钟上限，正在保存';child.stdin.end('\n');j.finishTimer=setTimeout(()=>{stopChild(child);j.status='error';j.message='保存采集超时';},15000);}else if(j.status==='starting'){stopChild(child);j.status='error';j.message='等待权限超时，请检查macOS录制权限';}},600000);j.timer.unref();
   child.stdout.on('data',c=>{pending+=c;let at;while((at=pending.indexOf('\n'))>=0){const line=pending.slice(0,at);pending=pending.slice(at+1);try{const v=JSON.parse(line);if(v.event==='recording'&&j.status==='starting'){j.status='recording';j.startedAt=Date.now();j.message='正在采集所选App音频';}if(v.event==='done')j.samples=v.samples;if(v.event==='error'){j.status='error';j.message=captureErrorMessage(v.message);stopChild(child);}}catch{}}});
   child.stderr.on('data',c=>err=(err+c).slice(-1000));child.stdin.on('error',()=>{});child.on('error',e=>{j.status='error';j.message=e.message;});child.on('close',async code=>{children.delete(child);clearTimeout(j.timer);clearTimeout(j.finishTimer);j.child=null;if(['error','cancelled'].includes(j.status))return;const size=await stat(j.path).then(s=>s.size,()=>0);j.status=code===0&&j.samples>0&&size>100?'done':'error';j.message=j.status==='done'?'采集完成，请试听后导入识别':err||'没有采集到有效音频，请确认App正在播放';});send(res,202,info(j));return true;
  }
  const m=url.pathname.match(/^\/api\/capture\/jobs\/([a-f0-9-]{36})(?:\/(stop|audio))?$/),j=m&&jobs.get(m[1]);if(!j){send(res,404,{error:'采集不存在或服务已重启'});return true;}
  if(req.method==='POST'&&m[2]==='stop'){if(j.status==='recording'){j.status='stopping';j.message='正在保存音频';j.child.stdin.end('\n');j.finishTimer=setTimeout(()=>{stopChild(j.child);j.status='error';j.message='保存超时';},15000);}else if(j.status==='starting'){j.status='cancelled';stopChild(j.child);}send(res,200,info(j));return true;}
  if(req.method==='DELETE'){if(['starting','recording','stopping'].includes(j.status)){j.status='cancelled';stopChild(j.child);}send(res,200,info(j));return true;}
  if(req.method==='GET'&&m[2]==='audio'){if(j.status!=='done')throw Error('采集尚未完成');const bytes=await readFile(j.path);if(bytes.length>100*1024*1024)throw Error('采集超过100MB，请缩短录音');res.writeHead(200,{'Content-Type':'audio/mp4','Content-Length':bytes.length,'Cache-Control':'no-store'});res.end(bytes);return true;}
  if(req.method==='GET'&&!m[2]){send(res,200,info(j));return true;}send(res,405,{error:'请求方式不支持'});
 }catch(e){send(res,capturePermissionDenied(e.message)?403:400,{error:captureErrorMessage(e.message),code:capturePermissionDenied(e.message)?'CAPTURE_PERMISSION_DENIED':'CAPTURE_FAILED'});}return true;}
 return {handle,close(){for(const c of children)stopChild(c);for(const j of jobs.values()){clearTimeout(j.timer);clearTimeout(j.finishTimer);}}};
}
