import test from 'node:test';
import assert from 'node:assert/strict';
import {rankDo} from '../src/do-ranking.js';
import {mainPitchClasses} from '../src/pitch-summary.js';
const note=(midi,start,dur=.6,extra={})=>({midi,start,end:start+dur,confidence:1,...extra});
test('repeated phrase endings inform Do without granting one last dominant tonic status',()=>{
 const ns=[];let t=0;for(let i=0;i<6;i++){for(const midi of [64,65,67,69,72]){ns.push(note(midi,t));t+=.6;}t+=.6;}ns.push(note(67,t));
 const r=rankDo(ns);assert.equal(r.phrases.count,6);assert.ok(Math.abs(r.phrases.histogram[0]-3.6)<1e-9);assert.equal(r.candidates[0].key,'C');assert.ok(r.candidates.every(c=>c.cadence<=.04&&c.endingScore<=.16));assert.equal(r.method,'ending-evidence-v2');
});
test('rejected events and overlapping performance spans cannot invent phrase silences',()=>{
 const ns=[note(60,0),note(61,.6,.5,{pitchStatus:'uncertain'}),note(62,1.2),note(64,2.5,.6,{performanceEnd:4}),note(65,3.8)];
 const r=rankDo(ns);assert.equal(r.phrases.count,1);assert.equal(r.phrases.ends[0].midi,62);
});
test('minor terminal is evidence for relative-major Do rather than a compulsory major tonic',()=>{
 const ns=[];let t=0;for(let i=0;i<5;i++){for(const midi of [69,72,74,76,77,76,69]){ns.push(note(midi,t));t+=.6;}t+=.6;}
 const r=rankDo(ns);assert.equal(r.candidates[0].key,'C');assert.equal(r.candidates[0].endRole,6);assert.ok(r.candidates[0].phraseScore>0);
});
test('top seven are observed pitch classes, octave-combined, with real frequency and degree mapping',()=>{
 const ns=[note(56,0,2),note(68,2,1),note(59,3,1),note(60,4,10,{pitchStatus:'uncertain'}),note(61,14,10,{recoveryReason:'recovered'})];
 const rows=mainPitchClasses(ns,'B');assert.equal(rows.length,2);assert.equal(rows[0].name,'G#3');assert.equal(rows[0].degree,'6');assert.ok(Math.abs(rows[0].hz-207.652)<.001);assert.equal(rows[0].share,.75);assert.equal(rows[1].degree,'1');assert.deepEqual(mainPitchClasses([],'C'),[]);
 const twelve=Array.from({length:12},(_,i)=>note(60+i,i));assert.equal(mainPitchClasses(twelve,'C').length,7);
});
