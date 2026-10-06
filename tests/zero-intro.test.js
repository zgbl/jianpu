import test from 'node:test';import assert from 'node:assert/strict';
import {demo,used,measureCapacity} from '../src/model.js';
import {zeroIntroScore,prependZeroIntro,zeroIntroRange} from '../src/intro-workflow.js';
import {audioScoreTimeline} from '../src/audio-score-cursor.js';

test('4/4无音符前奏补0000，时长推算小节，原谱和人声时间保留，重复不累加',()=>{
 const score=demo();score.transcription={bpm:120};score.measures[0].notes[0].sourceTime=8;score.measures[0].notes[0].sourceEnd=9;
 const before=structuredClone(score),range={start:0,end:8};
 const next=prependZeroIntro(score,range);
 assert.equal(next.measures.length,score.measures.length+4);
 for(const m of next.measures.slice(0,4)){assert.deepEqual(m.notes.map(n=>n.degree),[0,0,0,0]);assert.equal(used(m),measureCapacity(score));}
 assert.deepEqual(next.measures.slice(4),score.measures);assert.deepEqual(next.lyrics,score.lyrics);assert.deepEqual(score,before);
 assert.deepEqual(prependZeroIntro(next,range).measures.slice(4),score.measures);
 assert.equal(prependZeroIntro(next,range).measures.length,next.measures.length);
 const timeline=audioScoreTimeline(next);assert.equal(timeline.find(t=>t.id===score.measures[0].notes[0].id).start,8);
 assert.equal(next.measures[3].notes[3].gridTimeEnd,8);
});
test('6/8前奏按六个八分0填满，人声范围冲突拒绝，非整数小节时间明确为估算',()=>{
 const score=demo();score.meter=[6,8];score.transcription={bpm:120};
 const intro=zeroIntroScore(score,{start:0,end:6});assert.equal(intro.measures.length,4);
 assert.ok(intro.measures.every(m=>m.notes.length===6&&used(m)===measureCapacity(score)));
 const custom=zeroIntroScore(score,{start:0,end:5,count:3});assert.equal(custom.measures.length,3);assert.equal(custom.introPlaceholder.timing,'range-estimate');
 score.measures[0].notes[0].sourceTime=4;
 assert.throws(()=>prependZeroIntro(score,{start:0,end:6}),/超过/);
 assert.throws(()=>zeroIntroScore(score,{start:0,end:5,count:1.5}),/小节数/);
});

test('默认20秒的旧前奏可重新补到人声小节起点，保留节拍和所有人声数据',()=>{
 const score=demo();score.transcription={bpm:67.9522,barAnchor:.8};
 const bar=60/score.transcription.bpm*4,begin=.8+11*bar;
 score.measures[0].notes[0].gridTimeStart=begin;score.measures[0].notes[0].gridTimeEnd=begin+bar/4;
 const old=prependZeroIntro(score,{start:0,end:20});assert.equal(old.introPlaceholder.count,6);
 const corrected=prependZeroIntro(old);
 assert.equal(corrected.introPlaceholder.count,11);
 assert.ok(Math.abs(corrected.introPlaceholder.start-.8)<1e-6);
 assert.deepEqual(corrected.measures.slice(11),score.measures);
 assert.deepEqual(corrected.lyrics,score.lyrics);
 assert.ok(Math.abs(corrected.measures[10].notes.at(-1).gridTimeEnd-begin)<1e-6);
 assert.equal(prependZeroIntro(corrected).measures.length,corrected.measures.length);
 const manuallyAdjusted=prependZeroIntro(corrected,zeroIntroRange(corrected,{count:12}));
 assert.equal(manuallyAdjusted.introPlaceholder.count,12);
 assert.deepEqual(manuallyAdjusted.measures.slice(12),score.measures);
});

test('全0补前奏不受器乐识别120秒限制，仍遵守全谱1000小节容量',()=>{
 const score=demo();score.transcription={bpm:120};
 score.measures[0].notes[0].sourceTime=300;
 const next=prependZeroIntro(score);
 assert.equal(next.introPlaceholder.count,150);
 assert.deepEqual(next.measures.slice(150),score.measures);
 assert.throws(()=>prependZeroIntro(score,{start:0,end:300,count:1000}),/小节数量/);
});

test('歌声前小节内部的休止要从前奏边界扣除',()=>{
 const score=demo();score.transcription={bpm:120};
 score.measures[0].notes[0].degree=0;score.measures[0].notes[0].base=4;score.measures[0].notes[0].dots=0;score.measures[0].notes[1].sourceTime=8.5;
 assert.equal(zeroIntroRange(score).end,8);
});
