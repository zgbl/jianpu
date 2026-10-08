import test from 'node:test';import assert from 'node:assert/strict';
import {preferredRhythmBpm,suggestedRhythmAnchor} from '../src/rhythm-anchor.js';
import {transcriptionToScore} from '../src/transcription-score.js';
import {webcrypto} from 'node:crypto';globalThis.crypto??=webcrypto;
test('local vocal downbeat phase overrides an intro phase change',()=>{
 const r={estimatedBpm:68.18,notes:[{midi:57,start:41.92,end:43.6,confidence:.9},{midi:55,start:44.784,end:44.94,confidence:.9}],rhythm:{stableGrid:{period:60/67.9522,anchorTime:.8},estimatedBpm:68.18,downbeatTimes:[.8,4.32,29.06,30.82,32.58,34.36,37.9,41.42,44.94,48.48,52.02,55.54]}};
 assert.equal(suggestedRhythmAnchor(r),41.42);
 const s=transcriptionToScore(r,{key:'C',bpm:67.9522});
 const g=s.measures[0].notes.find(n=>n.pitchMidi===55);assert.ok(g);assert.ok(g.gridTimeEnd>44.8&&g.gridTimeEnd<45.1);assert.equal(s.transcription.barStartTime,41.42);
 const manual=transcriptionToScore(r,{key:'C',bpm:67.9522,barAnchor:.8});assert.equal(manual.transcription.barAnchor,.8);
});
test('sparse or missing downbeat evidence retains the available fallback',()=>{
 assert.equal(suggestedRhythmAnchor({notes:[],rhythm:{stableGrid:{anchorTime:2,period:.5}}}),2);
 assert.equal(suggestedRhythmAnchor({notes:[{midi:60,start:3}],rhythm:{estimatedBpm:120,downbeatTimes:[0,2]}}),0);
});
test('opening downbeats two fast bars apart select the slower 4/4 level',()=>{
 const opening=[1.14,4.64,8.12,11.62,15.1,18.56,22.04,25.5,29.04,30.84];
 const r={estimatedBpm:137.9,notes:[{midi:55,start:1.232,end:1.36}],rhythm:{estimatedBpm:137.93,stableGrid:{bpm:137.9509,barDuration:1.73974889,period:.43493722,anchorTime:25.5},downbeatTimes:opening}};
 assert.equal(preferredRhythmBpm(r),137.9509/2);
 assert.equal(suggestedRhythmAnchor(r,4,preferredRhythmBpm(r)),1.14);
 const ordinary={...r,rhythm:{...r.rhythm,downbeatTimes:[1.14,2.88,4.62,6.36,8.1,9.84,11.58]}};
 assert.equal(preferredRhythmBpm(ordinary),137.9509);
});
test('whole-track repeated two-bar downbeats survive an irregular opening',()=>{
 const r={rhythm:{stableGrid:{bpm:130,barDuration:60/130*4},downbeatTimes:[0,1.82,4.59,8.27,11.93,15.61,19.29,22.97,26.65,30.33,32.17]}};
 assert.equal(preferredRhythmBpm(r),65);
});
test('dense opening vocals resolve the 130/65 ambiguity even when the model labels every half-bar as a downbeat',()=>{
 const bpm=129.9876,bar=60/bpm*4;
 const r={notes:[6,6,5,4].flatMap((count,i)=>Array.from({length:count},(_,j)=>({midi:60,start:15.824+i*bar+j*bar/count}))),rhythm:{estimatedBpm:130.43,pulseBpm:130.43,downbeatBpm:130.43,downbeatConfirmed:false,stableGrid:{bpm,barDuration:bar},candidates:[{bpm:130.43},{bpm:65.22}],downbeatTimes:Array.from({length:12},(_,i)=>1.1+i*bar)}};
 assert.equal(preferredRhythmBpm(r),bpm/2);
 assert.equal(preferredRhythmBpm({...r,rhythm:{...r.rhythm,downbeatConfirmed:true}}),bpm);
 assert.equal(preferredRhythmBpm({...r,notes:r.notes.slice(0,8)}),bpm);
});
