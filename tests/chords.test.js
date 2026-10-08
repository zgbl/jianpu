import test from 'node:test';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';globalThis.crypto??=webcrypto;
import {transcriptionToScore} from '../src/transcription-score.js';import {applyChords,chordWindows,remapChordsByTime} from '../src/chords.js';import {render} from '../src/render.js';
test('重排双倍速度时保留按小节刻度存储的和弦',()=>{
 const notes=[{start:0,end:1,midi:60,confidence:1},{start:1,end:2,midi:62,confidence:1},{start:2,end:3,midi:64,confidence:1},{start:3,end:4,midi:65,confidence:1}];
 const previous=transcriptionToScore({estimatedBpm:120,notes},{key:'C',bpm:120,rhythmMode:'fixed',barAnchor:0});
 previous.chords=previous.measures.flatMap((m,i)=>[{measureId:m.id,startTick:0,endTick:64,label:i?'G':'C',source:'manual'}]);
 const next=transcriptionToScore({estimatedBpm:120,notes},{key:'C',bpm:60,rhythmMode:'fixed',barAnchor:0});
 const mapped=remapChordsByTime(previous,next);
 assert.deepEqual(mapped.map(c=>[c.label,c.startTick,c.endTick]),[['C',0,32],['G',32,64]]);
 assert.ok(mapped.every(c=>c.measureId===next.measures[0].id&&c.source==='manual'));
});
test('和弦按小节时间绑定，保存重开保留，不修改旋律歌词',()=>{const s=transcriptionToScore({estimatedBpm:120,notes:[{start:2,end:4,midi:60,confidence:1},{start:4,end:6,midi:62,confidence:1}]},{key:'C',rhythmMode:'fixed',barAnchor:0});const windows=chordWindows(s);assert.equal(windows.length,2);assert.equal(windows[0].start,2);const r=applyChords(s,{version:1,chords:windows.map(w=>({...w,label:'Am'}))});assert.deepEqual(r.measures,s.measures);assert.deepEqual(r.spans,s.spans);assert.equal(JSON.parse(JSON.stringify(r)).chords.length,2);assert.equal((render(r).match(/>Am<\/text>/g)||[]).length,2);assert.equal(s.chords,undefined);});
import {configureHarmony} from '../src/chord-harmony.js';import {relabelScore,noteMidi} from '../src/pitch.js';
test('Do 校准重评自动和弦，实际音高与人工和弦不变',()=>{const s=transcriptionToScore({estimatedBpm:120,notes:[{start:0,end:2,midi:60,confidence:1}]},{key:'C'});const w=chordWindows(s)[0],a={chords:[{...w,label:'C',score:.7,candidates:[{label:'C',score:.7},{label:'D',score:.69}]}]};const r=applyChords(s,a),next=relabelScore(r,'D');assert.equal(next.chordConfiguration.do,'D');assert.equal(next.chords[0].label,'D');assert.equal(noteMidi(next.measures[0].notes[0],next),60);r.chords[0].source='manual';assert.equal(relabelScore(r,'D').chords[0].label,'C');});
test('半小节候选相同则合并，每小节至多两个和弦',()=>{const s=transcriptionToScore({estimatedBpm:120,notes:[{start:0,end:2,midi:60,confidence:1}]},{key:'C'});const w=chordWindows(s,{halves:true});assert.equal(w.length,2);const c=configureHarmony(s,{windowsPerMeasure:2,chords:w.map(x=>({...x,label:'C',score:1,candidates:[{label:'C',score:1}]}))});assert.equal(c.chords.length,1);assert.equal(c.chords[0].end,2);});
test('起点早于录音的首小节裁到零秒，再划分半小节，不修改原时间',()=>{
 const s=transcriptionToScore({estimatedBpm:120,notes:[{start:0,end:2,midi:60,confidence:1}]},{key:'C'}),m=s.measures[0];
 m.notes[0].gridTimeStart=-2.236;m.notes[0].gridTimeEnd=.74;
 const before=structuredClone(s),w=chordWindows(s,{halves:true,duration:2});
 assert.deepEqual(w,[{measureId:m.id,start:0,end:.37},{measureId:m.id,start:.37,end:.74}]);assert.deepEqual(s,before);
});
test('完全在录音外的小节不参与分析，跨过结尾的小节裁到音频时长',()=>{
 const s=transcriptionToScore({estimatedBpm:120,notes:[{start:0,end:2,midi:60,confidence:1},{start:2,end:4,midi:62,confidence:1}]},{key:'C'});
 for(const n of s.measures[0].notes){n.gridTimeStart=-2;n.gridTimeEnd=-1;}
 for(const n of s.measures[1].notes){n.gridTimeStart=2;n.gridTimeEnd=4;}
 const w=chordWindows(s,{halves:true,duration:3});assert.equal(w.length,2);assert.deepEqual(w.map(x=>[x.start,x.end]),[[2,2.5],[2.5,3]]);
});
