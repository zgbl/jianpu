import {validate} from '../src/model.js';
import {localPageRequest,serverDeviceRequest} from './local-origin.mjs';
import {createSqliteLibraryRepository} from './library-repository.mjs';

const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function createLibraryAPI(root,{projects,repository=createSqliteLibraryRepository(root)}){
 const item=record=>({...record,audioUrl:record.sourcePath?projects.assetURL(record.id,record.sourcePath):null});
 async function publish(id){
  if(!ID.test(id))throw error('工程编号不合法');
  const project=await projects.read(id),score=validate(project.score);
  if(!score.measures.some(m=>m.notes.some(n=>n.degree)))throw error('乐谱还没有可播放的音符');
  const sourcePath=project.source?.path&&project.assets?.some(a=>a.path===project.source.path)?project.source.path:null;
  const run=project.runs?.find(r=>r.id===(project.scoreBasedOn||project.activeRunId));
  const audioOffset=Number.isFinite(run?.params?.start)?run.params.start:Number.isFinite(score.transcription?.clipStart)?score.transcription.clipStart:0;
  return item(await repository.put({id,title:score.title,score,sourcePath,audioOffset,revision:project.revision,publishedAt:new Date().toISOString()}));
 }
 async function handle(req,res,url){
  if(!url.pathname.startsWith('/api/library'))return false;
  try{
   if(!localPageRequest(req))throw error('乐谱库仅供同源页面使用',403);
   if(url.pathname==='/api/library'&&req.method==='GET'){json(res,200,(await repository.list()).map(({id,title,score,revision,publishedAt})=>({id,title,key:score.key,meter:score.meter,measureCount:score.measures.length,revision,publishedAt})));return true;}
   const match=/^\/api\/library\/([a-f0-9-]{36})$/.exec(url.pathname);
   if(!match||!ID.test(match[1]))throw error('没有这个乐谱库接口',404);
   const id=match[1];
   if(req.method==='GET'){const record=await repository.get(id);if(!record)throw error('乐谱未发布',404);json(res,200,item(record));return true;}
   if(!serverDeviceRequest(req))throw error('只有服务器本机可以发布或撤下乐谱',403);
   if(req.method==='PUT'){json(res,200,await publish(id));return true;}
   if(req.method==='DELETE'){await repository.remove(id);json(res,200,{ok:true});return true;}
   throw error('不支持这个操作',405);
  }catch(e){json(res,e.status||500,{error:e.message});}return true;
 }
 return {handle,publish,list:()=>repository.list(),get:async id=>{const record=await repository.get(id);return record?item(record):null;},close:()=>repository.close()};
}
