import test from 'node:test';import assert from 'node:assert/strict';
import {transcriptionToScore} from '../src/transcription-score.js';
import {refineScorePitch} from '../src/tonal-pitch-refinement.js';
const event=(midi,start,end,center=midi)=>({midi,start,end,coreStart:start,coreEnd:end,pitchCenterMidi:center,coreDispersionCents:10,confidence:.8,pitchStatus:'candidate'});
const score=notes=>transcriptionToScore({notes,estimatedBpm:120},{key:'G',rhythmMode:'fixed',barAnchor:0});
test('brief G sharp scoop resolves to following A with observed rising contour, raw events remain intact',()=>{
 const events=[event(68,1,1.08,67.7),event(69,1.128,1.4,69)],s=score(events),before=structuredClone({s,events});
 const frames=[{time:1,midi:67.8},{time:1.048,midi:67.7},{time:1.096,midi:68.5},{time:1.128,midi:69.2}];
 const fixed=refineScorePitch(s,events,{frames,enabled:true}),ns=fixed.measures.flatMap(m=>m.notes).filter(n=>n.degree);
 assert.equal(ns[0].degree,2);assert.equal(ns[0].accidental,undefined);assert.equal(ns[0].pitchCorrection.originalMidi,68);assert.ok(fixed.spans.some(t=>t.from===ns[0].id&&t.to===ns[1].id));
 assert.deepEqual({s,events},before);assert.deepEqual(refineScorePitch(fixed,events,{frames,enabled:true}),fixed);
});
test('stable borrowed flat seventh, ambiguous halfway pitches and manual alterations survive',()=>{
 const events=[event(65,0,.3,64.85),event(68,.5,.8,68),event(58,1,1.05,58)];const s=score(events),fixed=refineScorePitch(s,events,{enabled:true});
 assert.deepEqual(fixed.measures,s.measures);
 const weak=[event(68,0,.08,68.4)],manual=score(weak);manual.measures[0].notes[0].pitchStatus='manual-confirmed';assert.deepEqual(refineScorePitch(manual,weak,{enabled:true}).measures,manual.measures);
});
test('scale prior fixes only weak asymmetric evidence; a suggested key alone never changes pitch',()=>{
 const events=[event(68,0,.08,68.4)],s=score(events);assert.deepEqual(refineScorePitch(s,events),s);
 const fixed=refineScorePitch(s,events,{enabled:true});assert.equal(fixed.measures[0].notes[0].degree,2);assert.equal(fixed.measures[0].notes[0].pitchMidi,69);assert.equal(fixed.measures[0].notes[0].sourceTime,0);
});
test('restoring optimization preserves later manual edits and original note IDs',async()=>{
 const {restoreScorePitch}=await import('../src/tonal-pitch-refinement.js');
 const events=[event(68,0,.08,68.4)],s=score(events),fixed=refineScorePitch(s,events,{enabled:true});
 assert.deepEqual(restoreScorePitch(fixed).measures,s.measures);
 fixed.measures[0].notes[0].degree=3;fixed.measures[0].notes[0].pitchStatus='manual-confirmed';
 assert.equal(restoreScorePitch(fixed).measures[0].notes[0].degree,3);
});
