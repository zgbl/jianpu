import test from 'node:test';
import assert from 'node:assert/strict';
import {newScore,emptyMeasure} from '../src/commands.js';
import {note} from '../src/model.js';
import {scoreTimeline,scoreMidi,playbackBpm} from '../src/playback.js';
const fixture=()=>{const s=newScore('播放测试','G',4,1);return s;};
test('播放按当前简谱音高、八度和升降号，忽略旧识别 MIDI',()=>{
 const s=fixture();s.measures[0].notes=[{...note(1,4),pitchMidi:60},{...note(3,8,1,1),accidental:-1},note(0,8)];
 const t=scoreTimeline(s,{bpm:120});assert.deepEqual(t.events.map(e=>e.midi),[67,82]);assert.equal(t.events[1].end-t.events[1].start,.375);assert.equal(t.duration,2);
 s.measures[0].notes[0].degree=2;assert.equal(scoreTimeline(s).events[0].midi,69);
});
test('延音线合并发声，圆滑线不合并；补足未满小节及休止',()=>{
 const s=fixture(),a=note(1,2),b=note(1,4);s.measures[0].notes=[a,b,note(0,4)];s.measures.push(emptyMeasure());s.measures[1].notes=[note(2,4)];s.spans=[{id:'tie',type:'tie',from:a.id,to:b.id}];
 let t=scoreTimeline(s,{bpm:120});assert.equal(t.events.length,2);assert.equal(t.events[0].end,1.5);assert.equal(t.events[1].start,2);assert.equal(t.duration,4);
 s.spans[0].type='slur';assert.equal(scoreTimeline(s).events.length,3);
 assert.equal(scoreTimeline(s,{startMeasure:1}).events[0].start,0);
});
test('倚音借主音时值，跨小节延音保留总时长',()=>{
 const s=fixture(),a=note(1,1),b=note(1,4);s.measures[0].notes=[a];s.measures.push(emptyMeasure());s.measures[1].notes=[b];s.spans=[{id:'tie',type:'tie',from:a.id,to:b.id}];assert.equal(scoreTimeline(s).events[0].end,2.5);
 s.spans=[];a.grace={degree:2,octave:0,base:16};const t=scoreTimeline(s);assert.equal(t.events[0].midi,69);assert.equal(t.events[0].end,t.events[1].start);assert.equal(t.events[1].end,2);
});
test('速度优先使用保存的播放速度，其次识别速度；MIDI 含正确头与音符',()=>{
 const s=fixture();s.measures[0].notes=[note(1,4)];s.transcription={bpm:80};assert.equal(playbackBpm(s),80);s.tempo=160;assert.equal(playbackBpm(s),160);
 const bytes=scoreMidi(s);assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'MThd');assert.deepEqual([...bytes.slice(8,14)],[0,0,0,1,1,224]);assert.equal(new DataView(bytes.buffer).getUint32(18),bytes.length-22);
 assert.ok(Buffer.from(bytes).includes(Buffer.from([144,67,88])));assert.ok(Buffer.from(bytes).includes(Buffer.from([128,67,0])));assert.ok(Buffer.from(bytes).includes(Buffer.from([255,47,0])));
 assert.throws(()=>scoreTimeline(s,{bpm:0}),/速度/);assert.throws(()=>scoreTimeline(s,{startMeasure:3}),/起点/);
});
