import test from 'node:test';
import assert from 'node:assert/strict';
import {audioScoreTimeline,audioScorePosition} from '../src/audio-score-cursor.js';
const n=(id,degree,start,end,base=4)=>({id,degree,base,octave:0,dots:0,...(start===undefined?{}:{sourceTime:start,sourceEnd:end})});
const score=measures=>({title:'test',key:'C',meter:[4,4],lyrics:[],spans:[],measures:measures.map((notes,i)=>({id:'m'+i,notes,repeatStart:false,repeatEnd:false,breakBefore:i>0})),transcription:{bpm:120}});
test('cursor follows real seconds, interpolates and ignores edited tempo',()=>{const s=score([[n('a',1,1,2),n('b',2,2,3)]]),a=audioScoreTimeline(s);assert.equal(audioScorePosition(a,1).id,'a');assert.ok(audioScorePosition(a,1.5).x>audioScorePosition(a,1).x);assert.equal(audioScorePosition(a,2).id,'b');s.tempo=40;assert.deepEqual(audioScoreTimeline(s),a);assert.equal(audioScorePosition(a,.5),null);assert.equal(audioScorePosition(a,3),null);});
test('one recorded long note crosses rows at weighted tied glyph boundary',()=>{const a=audioScoreTimeline(score([[n('a',1,1,4,2)],[n('b',1,1,4,4)]]));assert.equal(a[0].end,3);assert.equal(a[1].start,3);assert.equal(audioScorePosition(a,2.99).row,0);assert.equal(audioScorePosition(a,3).row,1);});
test('written rests occupy actual silent gap; unrecorded edits are not falsely mapped',()=>{let s=score([[n('a',1,0,1),n('r',0),n('b',2,2,3)]]);assert.equal(audioScorePosition(audioScoreTimeline(s),1.5).id,'r');s.measures[0].notes[1].degree=3;assert.equal(audioScorePosition(audioScoreTimeline(s),1.5),null);});
import {midiScoreTimeline} from '../src/audio-score-cursor.js';
import {scoreTimeline} from '../src/playback.js';
test('MIDI指针用试听时间轴，支持当前小节、休止和跨行，不误用原曲秒数',()=>{
 const s=score([[n('a',1,100,101),n('b',2,101,102)],[n('c',3,200,201),n('rest',0),n('d',4,202,203)]]);s.format="jianpu-melody";s.version=2;s.tempo=60;
 const timeline=scoreTimeline(s,{startMeasure:1}),segments=midiScoreTimeline(s,timeline);
 assert.equal(audioScorePosition(segments,0).id,'c');assert.equal(audioScorePosition(segments,.5).row,1);assert.equal(audioScorePosition(segments,1).id,'rest');assert.equal(audioScorePosition(segments,2).id,'d');assert.equal(audioScorePosition(segments,200),null);
 assert.ok(audioScorePosition(segments,.9).x>audioScorePosition(segments,.1).x);
});
