import test from 'node:test';
import assert from 'node:assert/strict';
import {newScore} from '../src/commands.js';
import {note,validate,measureCapacity} from '../src/model.js';
import {scoreTimeline,scoreMidi} from '../src/playback.js';
import {render} from '../src/render.js';
import {prepareModelScore} from '../src/model-score-import.js';
test('6/8 六个八分音符正好一小节，显示和 MIDI 拍号正确',()=>{
 const s=newScore('6/8','C',6,2);s.measures[0].notes=Array.from({length:6},()=>note(1,8));s.measures[1].notes=[note(1,2,0,1)];
 validate(s);assert.deepEqual(s.meter,[6,8]);assert.equal(measureCapacity(s),48);
 const t=scoreTimeline(s,{bpm:120});assert.equal(t.duration,3);assert.equal(t.events[6].start,1.5);
 assert.match(render(s),/6\/8/);assert.equal(prepareModelScore(JSON.stringify(s)).invalid.length,0);
 const midi=Array.from(scoreMidi(s));assert.ok(midi.some((x,i)=>x===255&&midi[i+1]===88&&midi[i+3]===6&&midi[i+4]===3));
});

test('MP3 排谱按 6/8 容量分小节，保留分母',async()=>{
 const {transcriptionToScore}=await import('../src/transcription-score.js');
 const s=transcriptionToScore({estimatedBpm:120,notes:Array.from({length:12},(_,i)=>({start:i*.25,end:(i+1)*.25,midi:60,confidence:1}))},{meter:6,key:'C',bpm:120,rhythmMode:'fixed',barAnchor:0});
 assert.deepEqual(s.meter,[6,8]);assert.equal(s.measures.length,2);assert.ok(s.measures.every(m=>m.notes.reduce((v,n)=>v+64/n.base*(n.dots?1.5:1),0)===48));
});
