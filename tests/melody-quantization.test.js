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
 assert.equal(s.transcription.onsetQuantization,'ordered-acoustic-events-v1');
});
test('actual sixteenth runs and manual positions are retained; long rests remain gaps',()=>{
 const notes=[event(60,0,.125),event(61,.125,.25),event(62,.25,.375),event(63,.375,.5),{...event(64,2,2.5),manual:true}];
 const q=quantizeMelodyOnsets(notes,t=>t/.125);assert.deepEqual(notes.map(n=>q.units.get(n)),[0,1,2,3,16]);assert.equal(q.dropped,0);
});
test('dense micro fragments cannot move later notes beyond their measured beat',()=>{
 const notes=[event(60,0,.03),event(61,.03,.05),event(62,.05,.2),event(64,.5,1)],q=quantizeMelodyOnsets(notes,t=>t/.125);
 assert.equal(q.dropped,2);assert.equal(q.units.get(notes.at(-1)),4);
});
