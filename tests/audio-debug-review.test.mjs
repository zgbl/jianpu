import test from 'node:test';
import assert from 'node:assert/strict';
import {rankDo,doEvidence} from '../src/do-ranking.js';
import {suggestKey} from '../src/transcription-score.js';
import {debugIssues,reviewKey,validatedReview,frameGates} from '../src/audio-debug-review.js';
const profile=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
function song(d,shift=0){let t=0;const notes=profile.map((dur,i)=>{const n={midi:60+(d+i)%12+shift,start:t,end:t+dur,confidence:1};t+=dur;return n;});return [...notes,{midi:60+d+shift,start:t,end:t+1,confidence:1}];}
test('Do ranking includes all twelve tonics and is octave-invariant',()=>{
 for(let d=0;d<12;d++){assert.equal(rankDo(song(d)).candidates[0].doPc,d);assert.equal(rankDo(song(d,12)).candidates[0].doPc,d);assert.equal(rankDo(song(d)).candidates.length,12);}assert.equal(suggestKey(song(3)),'Eb');assert.equal(suggestKey(song(10)),'Bb');
});
test('uncertain/recovered/invalid events cannot pollute pitch-class weights; tuning center is not corrected twice',()=>{
 const notes=[...song(3),{midi:61,start:0,end:1000,pitchStatus:'uncertain'},{midi:62,start:0,end:1000,recoveryReason:'stable-evidence'},{midi:63,start:0,end:1000,confidence:NaN},{midi:63,start:0,end:1000,pitchReliability:0}];const r=rankDo(notes);assert.equal(r.excluded,4);assert.equal(r.candidates[0].key,'Eb');assert.ok(r.candidates.every(c=>Number.isFinite(c.score)));assert.equal(rankDo([{midi:61,pitchCenterMidi:60.49,start:0,end:1}]).histogram[0],1);assert.equal(rankDo([]).status,'unknown');assert.equal(doEvidence([]).suspectedModulation,false);
});
test('relative minor maps to major-degree Do and short evidence does not claim modulation',()=>{
 const minor=[6.33,2.68,3.52,5.38,2.6,3.53,2.54,4.75,3.98,2.69,3.34,3.17];let t=0;const ns=minor.map((dur,i)=>{let n={midi:60+(9+i)%12,start:t,end:t+dur};t+=dur;return n;});assert.equal(rankDo(ns,{strategy:'distribution'}).candidates[0].key,'C');assert.equal(rankDo(ns,{strategy:'distribution'}).candidates[0].mode,'relative-minor');assert.equal(doEvidence([{midi:60,start:0,end:.1},{midi:62,start:1,end:1.1}]).suspectedModulation,false);
});
test('problem queue ranks gaps, recovered, uncertain and pitch deviations; review status persists by original-time key',()=>{
 const ns=[{index:0,start:31,end:32,performanceStart:31,performanceEnd:32,midi:60,pitchCenterMidi:60.3},{index:1,start:32,end:33,performanceStart:32,performanceEnd:33,midi:60,pitchStatus:'uncertain'},{index:2,start:33,end:34,performanceStart:33,performanceEnd:34,midi:60,recoveryReason:'low-probability'}];const issues=debugIssues({notes:ns},[{start:35,end:36,measure:9,note:{id:'gap1',reviewReason:'unresolved-gap'}}],{[reviewKey(ns[2])]:{type:'correct'}});assert.deepEqual(issues.map(i=>i.severity),[4,3,2,1]);assert.equal(issues[1].reviewed,true);assert.match(issues[1].label,/#3/);
});
test('manual annotation requires valid original-time boundaries and MIDI, allows missing-pitch conclusions',()=>{
 const record={key:'range:31:32',type:'missing',midi:null,start:31,end:32,comment:'漏音'};assert.deepEqual(validatedReview(record),record);for(const patch of [{midi:200},{end:30},{type:'bad'},{comment:null}])assert.throws(()=>validatedReview({...record,...patch}));
});
test('gate bands preserve independent failed thresholds and old missing source evidence',()=>{
 const d={meta:{decoderThresholds:{energy:.01,voicingProbability:.35,sourceRatio:.04}},diagnostics:{}};
 const g=frameGates({voiced:true,voicingProbability:.2,energy:.005,sourceRatio:.02},d);assert.deepEqual(g.map(v=>v.pass),[false,false,false]);assert.deepEqual(frameGates({voiced:true,voicingProbability:.8,energy:.1},{meta:{},diagnostics:{}}).map(v=>v.pass),[true,null,null]);assert.equal(frameGates({voiced:true,voicingProbability:.8,energy:.1},{meta:{decoderThresholds:{sourceRatio:0}},diagnostics:{}})[2].pass,true);
});

test('terminal outside plausible scales is rejected while reliable terminal and skipped tail remain inspectable',()=>{
 const notes=[...song(0),{midi:69,start:60,end:61,coreStart:60.2,coreEnd:60.8,pitchCenterMidi:69.05,confidence:.9},{midi:70,start:61,end:61.08,confidence:1},{midi:71,start:61.1,end:62,coreStart:61.2,coreEnd:61.8,pitchStatus:'uncertain',confidence:1}];
 const r=rankDo(notes);assert.equal(r.candidates[0].key,'C');assert.equal(r.terminalRejected,true);assert.equal(r.distributionWinner,'C');assert.equal(r.conflict,false);assert.equal(r.terminal.midi,69);assert.equal(r.terminal.kind,'stable-core');assert.equal(r.terminal.skippedTrailing,1);const c=r.candidates.find(c=>c.key==='C');assert.equal(c.endRole,6);assert.equal(c.cadence,.032);
});
test('pentatonic melody without 4 or 7 is not penalized for absent notes',()=>{
 const notes=[65,67,69,72,74,65].map((midi,i)=>({midi,start:i,end:i+.7,confidence:1}));const r=rankDo(notes);assert.equal(r.candidates[0].key,'F');assert.equal(r.candidates[0].inScale,1);assert.equal(r.candidates[0].accidentalShare,0);assert.equal(r.supported,5);assert.equal(r.candidates.find(c=>c.key==='C').inScale,1);
});
test('no sustained reliable terminal falls back to scale evidence and marks its source',()=>{
 const notes=song(3).map(n=>({...n,coreStart:n.start,coreEnd:n.start+.05}));const r=rankDo(notes);assert.equal(r.terminal,null);assert.equal(r.method,'scale-support-v1');assert.ok(r.candidates.every(c=>c.cadence===0));
});
