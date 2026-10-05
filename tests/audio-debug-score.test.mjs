import test from 'node:test';
import assert from 'node:assert/strict';
import {debugScoreTimeline} from '../src/audio-debug-score.js';
const note=(id,extra={})=>({id,degree:1,base:4,octave:0,dots:0,...extra});
const score=notes=>({title:'test',key:'C',meter:[4,4],measures:[{id:'m',notes}],lyrics:[],spans:[],transcription:{clipStart:30,bpm:120}});
test('score uses recording seconds once, keeps edited pitch and lyrics',()=>{
 const s=score([note('a',{degree:2,gridTimeStart:2,gridTimeEnd:3,sourceTime:2.1,sourceEnd:2.8})]);s.lyrics=[{noteId:'a',verse:1,text:'你'}];
 const [a]=debugScoreTimeline(s,30);assert.equal(a.start,32);assert.equal(a.end,33);assert.equal(a.midi,62);assert.equal(a.lyrics[0].text,'你');
 s.tempo=30;assert.equal(debugScoreTimeline(s,99)[0].start,32);
});
test('manual prefix cannot push recording anchors back to the first measure',()=>{
 const s=score([note('voice',{gridTimeStart:8,gridTimeEnd:9})]);s.measures.unshift({id:'intro',notes:[note('rest',{degree:0,base:1})]});
 const timeline=debugScoreTimeline(s);assert.equal(timeline.find(n=>n.id==='voice').start,38);assert.equal(timeline.find(n=>n.id==='voice').measure,2);assert.equal(timeline[0].estimated,true);assert.equal(timeline[0].start,36);
});
test('unanchored scores are not falsely placed from nominal tempo',()=>{assert.deepEqual(debugScoreTimeline(score([note('a')])),[]);assert.deepEqual(debugScoreTimeline(null),[]);});
test('tied event divides actual duration; keeps tuplet metadata',()=>{
 const tuplet={id:'t',actual:3,normal:2};const s=score([note('a',{sourceTime:1,sourceEnd:4,base:8,tuplet}),note('b',{sourceTime:1,sourceEnd:4,base:4,tuplet})]);
 const t=debugScoreTimeline(s);assert.equal(t[0].start,31);assert.equal(t[0].end,32);assert.equal(t[1].start,32);assert.equal(t[1].end,34);assert.deepEqual(t[0].note.tuplet,tuplet);
});
