import test from 'node:test';import assert from 'node:assert/strict';import {Readable,Writable} from 'node:stream';import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {resolve} from 'node:path';import {randomUUID} from 'node:crypto';import {createLyricsAPI} from '../audio/lyrics-api.mjs';
test('识别子进程的部分结果在任务完成前可轮询，最终结果独立保存',async()=>{
 const root=await mkdtemp(resolve(tmpdir(),'lyric-stream-')),runId=randomUUID();
 for(const directory of ['audio','.venv-audio/bin','.cache/whisper',`.audio-jobs/${runId}`])await mkdir(resolve(root,directory),{recursive:true});
 await symlink(resolve('.venv-audio/bin/python'),resolve(root,'.venv-audio/bin/python'));
 await writeFile(resolve(root,'.cache/lyrics-ready.json'),JSON.stringify({model:'whisper-small',checkpoint:'.cache/whisper/small.pt'}));await writeFile(resolve(root,'.cache/whisper/small.pt'),'fixture');await writeFile(resolve(root,`.audio-jobs/${runId}/job.json`),' {"status":"done"}');
 await writeFile(resolve(root,'audio/lyrics-asr.py'),`import json,sys,time
output=sys.argv[sys.argv.index('--output')+1]
print(json.dumps(dict(message='部分歌词',progress=.5,preview=dict(revision=1,partial=True,text='你好',words=[dict(text='你好',start=3,end=5,probability=1)],processedUntil=30,duration=60))),flush=True)
time.sleep(.2)
open(output,'w').write(json.dumps(dict(text='你好世界',words=[dict(text='你好世界',start=3,end=8,probability=1)])))
`);
 const api=createLyricsAPI(root,{projects:{}});
 async function call(path,method='GET',data={}){const req=Readable.from(method==='POST'?[JSON.stringify(data)]:[]);req.method=method;req.headers={host:'localhost:5173'};let raw='',code;const res=new Writable({write(c,e,cb){raw+=c;cb();}});res.writeHead=c=>code=c;await api.handle(req,res,new URL('http://localhost:5173'+path));return {code,value:JSON.parse(raw)};}
 try{
  const submitted=await call('/api/lyrics/jobs','POST',{runId});assert.equal(submitted.code,202);const path='/api/lyrics/jobs/'+submitted.value.id;
  let state;for(let i=0;i<100;i++){state=(await call(path)).value;if(state.preview)break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(state.status,'running');assert.equal(state.preview.words[0].start,3);assert.equal(state.preview.processedUntil,30);
  const saved=JSON.parse(await readFile(resolve(root,'.audio-lyrics',state.id,'job.json'),'utf8'));assert.equal(saved.preview.text,'你好');
  for(let i=0;i<100;i++){state=(await call(path)).value;if(state.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(state.status,'done');assert.equal((await call(path+'/result')).value.text,'你好世界');
 }finally{api.close();await rm(root,{recursive:true,force:true});}
});

test('校准任务合并手工谱面锚点与旧ASR时间，模型收到缺失词句的定位',async()=>{
 const root=await mkdtemp(resolve(tmpdir(),'lyric-manual-')),runId=randomUUID();
 for(const directory of ['audio','.venv-audio/bin','.cache/lyrics-align',`.audio-jobs/${runId}`])await mkdir(resolve(root,directory),{recursive:true});
 await symlink(resolve('.venv-audio/bin/python'),resolve(root,'.venv-audio/bin/python'));
 await writeFile(resolve(root,'.cache/lyrics-align/ready.json'),'{}');
 await writeFile(resolve(root,`.audio-jobs/${runId}/job.json`),'{"status":"done"}');
 await writeFile(resolve(root,`.audio-jobs/${runId}/lyrics.json`),JSON.stringify({words:[{text:'后来',start:30,end:31}]}));
 await writeFile(resolve(root,'audio/lyrics-align.py'),`import json,sys
output=sys.argv[sys.argv.index('--output')+1]
anchors=json.load(open(sys.argv[sys.argv.index('--anchors')+1]))
open(output,'w').write(json.dumps(anchors))
`);
 const api=createLyricsAPI(root,{projects:{}});
 async function call(path,method='GET',data={}){const req=Readable.from(method==='POST'?[JSON.stringify(data)]:[]);req.method=method;req.headers={host:'localhost:5173'};let raw='',code;const res=new Writable({write(c,e,cb){raw+=c;cb();}});res.writeHead=c=>code=c;await api.handle(req,res,new URL('http://localhost:5173'+path));return {code,value:JSON.parse(raw)};}
 try{
  const manualAnchors=[{text:'思念',start:12,end:12.8,manual:true}];
  const submitted=await call('/api/lyrics/jobs','POST',{kind:'align',runId,text:'思念是种病\n后来',manualAnchors});assert.equal(submitted.code,202);const path='/api/lyrics/jobs/'+submitted.value.id;
  let state;for(let i=0;i<100;i++){state=(await call(path)).value;if(state.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(state.status,'done');const result=(await call(path+'/result')).value;
  assert.deepEqual(result.manualAnchors,manualAnchors);assert.equal(result.words[0].text,'后来');
 }finally{api.close();await rm(root,{recursive:true,force:true});}
});
