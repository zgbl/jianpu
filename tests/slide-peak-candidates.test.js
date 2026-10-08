import test from 'node:test';
import assert from 'node:assert/strict';
import {slidePeakCandidates} from '../src/slide-peak-candidates.js';
import {debugIssues} from '../src/audio-debug-review.js';
function example(){
 const contour=[56.998,57.498,57.798,57.898,58.098,58.098,57.898,57.598,57.398];
 return {meta:{hopLength:256,sampleRate:16000},diagnostics:{tuningCents:0},frames:contour.map((midi,i)=>({time:41.92+i*.016,midi,voiced:true,decoderEligible:true})),notes:[{index:0,start:41.92,end:42.256,performanceStart:41.92,performanceEnd:42.256,coreStart:42.064,coreEnd:42.192,midi:57,pitchCenterMidi:57.0983,ornaments:[{type:'scoop',start:41.92,end:42.064}]}]};
}
test('first vocal crest survives as review evidence without inventing B or altering the A event',()=>{
 const d=example(),before=structuredClone(d);const [c]=slidePeakCandidates(d);assert.equal(c.midi,58);assert.ok(Math.abs(c.start-41.952)<1e-6);assert.ok(Math.abs(c.end-42.032)<1e-6);assert.equal(c.frameCount,5);assert.ok(c.prominenceCents>99);assert.deepEqual(d,before);
 const issue=debugIssues(d,[]).find(i=>i.kinds.includes('slide-peak'));assert.ok(issue);assert.equal(issue.index,null);assert.equal(issue.parentIndex,0);assert.match(issue.label,/候选/);assert.equal(debugIssues(d,[],{[issue.key]:{type:'slide'}}).find(i=>i.key===issue.key).reviewed,true);
});
test('flat attacks, monotonic slides, one-frame spikes and rejected crests are not candidate notes',()=>{
 for(const change of [d=>d.frames.forEach(f=>f.midi=57.1),d=>d.frames.forEach((f,i)=>f.midi=57+i*.15),d=>d.frames.forEach((f,i)=>f.midi=i===4?58.1:57.1),d=>d.frames.forEach(f=>f.decoderEligible=false),d=>d.notes[0].ornaments=[]]){const d=example();change(d);assert.equal(slidePeakCandidates(d).length,0);}
});
test('unreliable parents and already separated short notes do not create duplicate proposals',()=>{
 for(const change of [d=>d.notes[0].pitchStatus='uncertain',d=>d.notes[0].recoveryReason='low-probability',d=>d.notes.push({index:1,midi:58,performanceStart:41.96,performanceEnd:42.01})]){const d=example();change(d);assert.equal(slidePeakCandidates(d).length,0);}
 assert.deepEqual(slidePeakCandidates({notes:[]}),[]);
});
test('raw peak and tuning-corrected parent are compared in the same pitch reference',()=>{
 const d=example();d.diagnostics.tuningCents=20;d.frames.forEach(f=>f.midi+=.2);const c=slidePeakCandidates(d)[0];assert.equal(c.midi,58);assert.ok(Math.abs(c.prominenceCents-99.97)<.01);
});
