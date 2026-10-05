import test from 'node:test';import assert from 'node:assert/strict';
import {newScore} from '../src/commands.js';import {note} from '../src/model.js';
import {compareScores,comparisonTimelines,applyComparisonSuggestion} from '../src/score-compare.js';
const score=()=>{const s=newScore('测试','C',4,1);s.measures[0].notes=[note(1,4),note(2,4),note(3,4),note(4,4)];return s;};
test('差异先标记，确认只修改克隆的视觉稿，原始两谱保留',()=>{const a=score(),b=structuredClone(a);b.measures[0].notes[1].degree=3;const original=JSON.stringify(b),c=compareScores(a,b),issue=c.issues.find(x=>x.type==='difference');assert.ok(issue);assert.equal(JSON.stringify(b),original);const next=applyComparisonSuggestion(b,a,issue,['pitch']);assert.equal(next.measures[0].notes[1].degree,2);assert.equal(b.measures[0].notes[1].degree,3);});
test('音符漏失允许序列对齐，双谱指针映射原曲时间',()=>{const a=score();a.transcription={clipStart:10,bpm:120};a.measures[0].notes.forEach((n,i)=>{n.sourceTime=i*.5;n.sourceEnd=(i+1)*.5;});const b=structuredClone(a);b.measures[0].notes.splice(1,1);const c=compareScores(a,b);assert.ok(c.issues.some(x=>x.type==='unmatchedAudio'));const t=comparisonTimelines(a,b,c);assert.equal(t.audio[0].start,10);assert.equal(t.visual.at(-1).start,11.5);assert.throws(()=>applyComparisonSuggestion(b,a,c.issues.find(x=>x.type==='unmatchedAudio')),/不能自动/);});
test('左谱没有歌词且两谱调不同，仍按音频逐字时间同步右谱全部音符',()=>{
 const a=score();a.measures.push({id:'second-bar',notes:[note(5,4),note(6,4),note(7,4),note(1,4,1)],repeatStart:false,repeatEnd:false});
 a.transcription={clipStart:20,bpm:120};a.measures.flatMap(m=>m.notes).forEach((n,i)=>{n.sourceTime=10+i*.5;n.sourceEnd=10+(i+1)*.5;});
 const b=structuredClone(a);b.key='G';delete b.transcription;const symbols=[...'春夏秋冬山川河海'];b.lyrics=b.measures.flatMap(m=>m.notes).map((n,i)=>({noteId:n.id,verse:1,text:symbols[i]}));
 for(const n of b.measures.flatMap(m=>m.notes)){delete n.sourceTime;delete n.sourceEnd;}
 const timedLyrics={timeBase:'clip-seconds',characters:symbols.map((text,i)=>({text,start:10+i*.5,status:'acoustic',confidence:.9}))};
 const timeline=comparisonTimelines(a,b,compareScores(a,b),{timedLyrics});
 assert.equal(timeline.alignment.method,'lyrics');assert.equal(timeline.alignment.source,'audio');assert.ok(timeline.alignment.anchors>=2);
 assert.equal(timeline.visual.length,8);assert.ok(Math.abs(timeline.visual[0].start-30)<.05);assert.ok(Math.abs(timeline.visual[7].start-33.5)<.05);
});
import {insertMeasureBefore,fillRests,deleteMeasure} from '../src/commands.js';
test('双谱页前插四小节的手写休止时间不能抢占录音歌声，重新加载已编辑工程也可恢复',()=>{
 const a=score();a.transcription={bpm:120,clipStart:10,barStartTime:20};a.measures[0].notes.forEach((n,i)=>{n.gridTimeStart=20+i*.5;n.gridTimeEnd=20+(i+1)*.5;n.sourceTime=20+i*.5;n.sourceEnd=20+(i+1)*.5;});const visual=structuredClone(a),voice=a.measures[0].notes[0].id;
 for(let i=0;i<4;i++){insertMeasureBefore(a,0);fillRests(a,0);}
 const reloaded=JSON.parse(JSON.stringify(a)),t=comparisonTimelines(reloaded,visual,compareScores(reloaded,visual));
 assert.equal(t.audio.find(x=>30.1>=x.start&&30.1<x.end).id,voice);assert.equal(t.audio.find(x=>x.id===voice).start,30);
 assert.ok(t.audio.slice(0,16).every(x=>x.end<=30));assert.equal(t.alignment.estimatedAudioNotes,16);assert.match(t.alignment.description,/原有歌声时间不变/);
 for(let i=0;i<4;i++)deleteMeasure(a,0);const reverted=comparisonTimelines(a,visual,compareScores(a,visual));assert.equal(reverted.audio[0].start,30);
});
