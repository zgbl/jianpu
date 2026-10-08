import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createProjectStore} from '../audio/project-store.mjs';
import {createLibraryAPI} from '../audio/library-api.mjs';
import {copyPublishedScores} from '../audio/library-repository.mjs';

test('published scores are persisted as snapshots and can be reopened',async()=>{
 const root=mkdtempSync(join(tmpdir(),'jianpu-library-'));
 try{
  const projects=createProjectStore(root),project=await projects.create('测试歌曲');
  const score=structuredClone(project.score);score.transcription={clipStart:12.3,bpm:120};score.measures[0].notes.push({id:randomUUID(),degree:1,octave:0,base:4,dots:0});
  await projects.patch(project.id,{revision:project.revision,score});
  const library=createLibraryAPI(root,{projects});
  assert.equal((await library.publish(project.id)).score.measures[0].notes[0].degree,1);
  assert.equal((await library.list())[0].title,'测试歌曲');await library.close();
  const changed=await projects.read(project.id);changed.score.measures[0].notes[0].degree=2;
  await projects.patch(project.id,{revision:changed.revision,score:changed.score});
  const reopened=createLibraryAPI(root,{projects});
  assert.equal((await reopened.get(project.id)).score.measures[0].notes[0].degree,1);
  assert.equal((await reopened.get(project.id)).audioOffset,12.3);
  const migrated=new Map();
  assert.equal(await copyPublishedScores({list:()=>reopened.list(),get:id=>reopened.get(id)},
   {put:async record=>migrated.set(record.id,record)}),1);
  assert.equal(migrated.get(project.id).score.measures[0].notes[0].degree,1);
  assert.equal((await reopened.publish(project.id)).score.measures[0].notes[0].degree,2);
  await reopened.close();
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('existing SQLite publications gain their original-audio offset',async()=>{
 const root=mkdtempSync(join(tmpdir(),'jianpu-library-upgrade-'));
 try{
  const projects=createProjectStore(root),project=await projects.create('旧成品');
  const score={...project.score,transcription:{clipStart:23.5,bpm:120}};
  const db=new DatabaseSync(join(root,'.projects','library.sqlite'));
  db.exec('CREATE TABLE published_scores (project_id TEXT PRIMARY KEY, title TEXT NOT NULL, score_json TEXT NOT NULL, source_path TEXT, project_revision INTEGER NOT NULL, published_at TEXT NOT NULL)');
  db.prepare('INSERT INTO published_scores VALUES (?,?,?,?,?,?)').run(project.id,'旧成品',JSON.stringify(score),null,0,new Date().toISOString());db.close();
  const library=createLibraryAPI(root,{projects});assert.equal((await library.get(project.id)).audioOffset,23.5);await library.close();
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('library HTTP list shows published score metadata and detail opens the saved score',async()=>{
 const root=mkdtempSync(join(tmpdir(),'jianpu-library-http-'));
 try{
  const projects=createProjectStore(root),project=await projects.create('成品谱');
  const score=structuredClone(project.score);score.key='G';score.measures[0].notes.push({id:randomUUID(),degree:5,octave:0,base:4,dots:0});
  await projects.patch(project.id,{revision:project.revision,score});
  const library=createLibraryAPI(root,{projects});
  const call=async(method,path,remoteAddress='127.0.0.1')=>{
   const req={method,headers:{host:'localhost:5173'},socket:{localAddress:'127.0.0.1',remoteAddress}};
   const res={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}};
   await library.handle(req,res,new URL(path,'http://localhost:5173'));
   return {status:res.status,data:JSON.parse(res.body)};
  };
  assert.deepEqual((await call('GET','/api/library')).data,[]);
  assert.equal((await call('PUT',`/api/library/${project.id}`,'192.168.1.5')).status,403);
  assert.equal((await call('PUT',`/api/library/${project.id}`)).status,200);
  const listing=await call('GET','/api/library');
  assert.equal(listing.data[0].title,'成品谱');assert.equal(listing.data[0].key,'G');
  assert.deepEqual(listing.data[0].meter,[4,4]);assert.equal(listing.data[0].measureCount,4);
  assert.equal(listing.data[0].score,undefined);
  const opened=await call('GET',`/api/library/${project.id}`);
  assert.equal(opened.data.score.measures[0].notes[0].degree,5);
  await library.close();
 }finally{rmSync(root,{recursive:true,force:true});}
});
