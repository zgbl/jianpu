import test from 'node:test';import assert from 'node:assert/strict';
import {suggestedRhythmAnchor} from '../src/rhythm-anchor.js';
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
