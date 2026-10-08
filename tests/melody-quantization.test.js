import test from 'node:test';
import assert from 'node:assert/strict';
import {quantizeMelodyOnsets} from '../src/melody-quantization.js';
import {transcriptionToScore} from '../src/transcription-score.js';
import {webcrypto} from 'node:crypto';globalThis.crypto??=webcrypto;
const event=(midi,start,end)=>({midi,start,end,confidence:.95,coreStart:start+.01,coreEnd:end-.01,pitchCenterMidi:midi+.1});
test('separate stable pitches survive early/late onset collisions without changing acoustic evidence',()=>{
 const notes=[event(60,.065,.18),event(62,.18,.3),event(64,.5,1)],before=structuredClone(notes);
 const q=quantizeMelodyOnsets(notes,t=>t/.125);
 assert.equal(q.notes.length,3);assert.ok(q.units.get(notes[1])>q.units.get(notes[0]));assert.equal(q.units.get(notes[2]),4);assert.ok(q.adjusted>0);assert.deepEqual(notes,before);
 const s=transcriptionToScore({notes,estimatedBpm:120},{key:'C',rhythmMode:'fixed',barAnchor:0});
 const written=s.measures.flatMap(m=>m.notes).filter(n=>n.pitchMidi);
 assert.deepEqual(written.map(n=>[n.pitchMidi,n.sourceTime,n.sourceEnd]),notes.map(n=>[n.midi,n.start,n.end]));
 assert.equal(s.transcription.onsetQuantization,'metrical-core-energy-v2');
});
test('actual sixteenth runs and manual positions are retained; long rests remain gaps',()=>{
 const notes=[event(60,0,.125),event(61,.125,.25),event(62,.25,.375),event(63,.375,.5),{...event(64,2,2.5),manual:true}];
 const q=quantizeMelodyOnsets(notes,t=>t/.125);assert.deepEqual(notes.map(n=>q.units.get(n)),[0,1,2,3,16]);assert.equal(q.dropped,0);
});
test('dense micro fragments cannot move later notes beyond their measured beat',()=>{
 const notes=[event(60,0,.03),event(61,.03,.05),event(62,.05,.2),event(64,.5,1)],q=quantizeMelodyOnsets(notes,t=>t/.125);
 assert.equal(q.dropped,2);assert.equal(q.units.get(notes.at(-1)),4);
});

test('slightly early vocal attack with the stable core and energy after the bar moves to its downbeat',()=>{
 const n={...event(55,1.905,2.42),coreStart:1.98,coreEnd:2.4,timingEnergy:{start:1.905,end:2.42,weights:[.05,.1,.35,.5]}},notes=[event(60,1.5,1.8),n,event(57,2.5,3)],before=structuredClone(notes);
 const q=quantizeMelodyOnsets(notes,t=>t/.125,{toTime:u=>u*.125});assert.equal(q.units.get(n),16);assert.equal(q.decisions.get(n).reason,'early-entry-to-downbeat');assert.ok(q.decisions.get(n).energyAfterShare>.8);assert.ok(Math.abs(q.decisions.get(n).shiftMs-95)<1e-8);assert.deepEqual(notes,before);
 const score=transcriptionToScore({notes,estimatedBpm:120},{key:'C',rhythmMode:'fixed',barAnchor:0}),written=score.measures[1].notes.find(n=>n.pitchMidi===55);assert.equal(written.gridTimeStart,2);assert.equal(written.sourceTime,1.905);assert.equal(written.timingAlignment.reason,'early-entry-to-downbeat');assert.equal(score.transcription.boundaryAligned,1);
});
test('long syncopation and an established sixteenth pickup are not pulled to the next bar',()=>{
 for(const n of [{...event(55,1.75,2.5),coreStart:1.76,coreEnd:2.48},{...event(55,1.875,2.5),coreStart:1.875,coreEnd:2.48}]){
  const q=quantizeMelodyOnsets([n,event(57,2.6,3)],t=>t/.125);assert.equal(q.units.get(n),Math.round(n.start/.125));assert.equal(q.boundaryAligned,0);
 }
});
test('majority duration alone cannot override vocal energy before the downbeat or a manual anchor',()=>{
 const n={...event(55,1.905,2.42),coreStart:1.98,coreEnd:2.4,timingEnergy:{start:1.905,end:2.42,weights:[.95,.02,.02,.01]}};
 let q=quantizeMelodyOnsets([n,event(57,2.5,3)],t=>t/.125);assert.equal(q.units.get(n),15);assert.equal(q.boundaryAligned,0);
 const manual={...n,manual:true,timingEnergy:null};q=quantizeMelodyOnsets([manual,event(57,2.5,3)],t=>t/.125);assert.equal(q.units.get(manual),15);assert.equal(q.decisions.get(manual).reason,'manual-position');
});
test('legacy energy-free events can use clear stable-core evidence without inventing energy',()=>{
 const n={...event(55,1.905,2.42),coreStart:2.01,coreEnd:2.4},q=quantizeMelodyOnsets([n,event(57,2.5,3)],t=>t/.125);assert.equal(q.units.get(n),16);assert.equal(q.decisions.get(n).energyAfterShare,null);
});
test('repeated melodic pickups reduce downbeat preference for another occurrence of the same phrase',()=>{
 const notes=[];for(const end of [2,4])notes.push(event(60,end-.5,end-.25),{...event(55,end-.125,end+.42),coreStart:end-.125,coreEnd:end+.4},event(57,end+.5,end+1));
 const n={...event(55,5.905,6.42),coreStart:5.98,coreEnd:6.4};notes.push(event(60,5.5,5.75),n,event(57,6.5,7));const q=quantizeMelodyOnsets(notes,t=>t/.125);assert.equal(q.units.get(n),47);assert.equal(q.decisions.get(n).repeatedPickups,2);assert.equal(q.decisions.get(n).boundarySelected,false);
});

test('short independent contour evidence survives slot filtering and nearby grid alignment',()=>{
 const short={start:2.2,end:2.6,midi:58,confidence:0,pitchStatus:'uncertain',independentEvidence:{kind:'short-attack-crest'}};
 const main={start:2.6,end:4,midi:57,confidence:.9};
 const q=quantizeMelodyOnsets([short,main],t=>t);
 assert.equal(q.notes.length,2);assert.ok(q.units.get(short)<q.units.get(main));
});


test('phrase entry anticipating a downbeat by one sixteenth uses following eighth-note context',()=>{
 const notes=[
  {...event(59,17.792,18.112),coreStart:17.792,coreEnd:18.112,timingEnergy:{start:17.792,end:18.112,weights:[.089894,0,.126394,0,.1145447,0,.1127898,0,.1228891,0,.0653473,.0646611,.0618906,.0568164,.051015,.044545,.0361315,.0266432,.0169594,.009479]}},
  event(62,18.192,18.352),event(62,18.496,18.816),event(62,18.96,19.408)
 ];
 const period=60/114.9946,toUnit=t=>(t-15.84)/period*4,before=structuredClone(notes);
 const q=quantizeMelodyOnsets(notes,toUnit);
 assert.equal(q.units.get(notes[0]),16);assert.deepEqual(notes.slice(1).map(n=>q.units.get(n)),[18,20,24]);
 assert.equal(q.decisions.get(notes[0]).reason,'phrase-entry-to-downbeat');assert.deepEqual(notes,before);
 const score=transcriptionToScore({notes,estimatedBpm:114.9946},{key:'G',rhythmMode:'stable',barAnchor:15.84});
 assert.ok(score.measures[0].notes.every(n=>!n.pitchMidi));
 assert.equal(score.measures[1].notes[0].degree,3);assert.equal(score.measures[1].notes[0].sourceTime,17.792);
 assert.equal(score.spans.length,0);
});
test('phrase context cannot promote true pickups, early energy, weak pitches or manual notes',()=>{
 const make=()=>[{...event(59,1.866,2.19),coreStart:1.866,coreEnd:2.19,timingEnergy:{start:1.866,end:2.19,weights:[1,1,1,1]}},event(62,2.25,2.4),event(62,2.5,2.8),event(62,3,3.4)];
 for(const change of [n=>{n[0].manual=true;},n=>{n[0].pitchStatus='uncertain';},n=>{n[0].timingEnergy.weights=[1,0,0,0];},n=>{n[0].end=2.04;n[0].coreEnd=2.04;},n=>{n.splice(0,0,event(60,1.5,1.75));},n=>{n[2].start=2.625;},n=>{n.splice(2);}]){
  const notes=make(),first=notes[0];change(notes);const q=quantizeMelodyOnsets(notes,t=>t/.125);
  assert.equal(q.units.get(first),15);
 }
});
