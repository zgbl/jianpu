import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildImageScore} from '../src/score-image-build.js';
import {createProjectStore} from '../audio/project-store.mjs';

test('an imperfect image draft imports, saves and reopens with printed bars and chords',async()=>{
 const root=await mkdtemp(join(tmpdir(),'jianpu-image-import-test-'));
 try{
  const notes=[1,2,3,4,5].map((degree,index)=>({degree,base:4,dots:0,octave:0,accidental:0,measure:1,lyric:index?'':'我',hold:false}));
  notes.push({degree:6,base:8,dots:0,octave:0,accidental:0,measure:3,lyric:'找',hold:false});
  const score=buildImageScore({title:'识谱',key:'C',meter:'4/4',notes,chords:[{measure:1,label:'G'},{measure:3,label:'Am'}],repeatStarts:[3],repeatEnds:[3]});
  const store=createProjectStore(root),project=await store.create('识谱');
  const saved=await store.patch(project.id,{revision:project.revision,score,archiveScore:true,scoreBasedOn:null,workspace:{stage:'editor'}});
  const reopened=await store.read(saved.id);
  assert.equal(reopened.score.measures.length,3);
  assert.equal(reopened.score.measures[2].repeatStart,true);
  assert.equal(reopened.score.measures[2].repeatEnd,true);
  assert.deepEqual(reopened.score.measures.map(m=>m.notes.length),[5,0,1]);
  assert.deepEqual(reopened.score.chords.map(c=>c.label),['G','Am']);
  assert.equal(reopened.score.lyrics.length,2);
  assert.equal(reopened.score.importSource.rhythmNeedsReview,true);
  assert.equal(reopened.workspace.stage,'editor');
 }finally{await rm(root,{recursive:true,force:true});}
});
