import test from 'node:test';
import assert from 'node:assert/strict';
import {repairUnconfirmedDo} from '../src/automatic-do.js';
import {transcriptionToScore} from '../src/transcription-score.js';
import {noteMidi} from '../src/pitch.js';
const input={notes:[60,62,64,67,69,60].map((midi,i)=>({midi,start:i,end:i+.8,confidence:1})),duration:6,estimatedBpm:120,clipStart:0,warnings:[]};
test('legacy generated Bb preview gets its own Do and octave reference without losing lyrics or actual MIDI',()=>{
 const s=transcriptionToScore(input,{key:'Bb',notationOctaveShift:0});s.lyrics=[{noteId:s.measures[0].notes[0].id,text:'词',verse:1}];
 const p=repairUnconfirmedDo(s,input,{runId:'r',scoreBasedOn:'r'});
 assert.equal(p.key,'C');assert.equal(p.keyMap.referenceDoMidi,48);assert.equal(p.keyMap.status,'suggested');assert.equal(p.keyMap.locked,false);assert.deepEqual(p.lyrics,s.lyrics);assert.deepEqual(p.measures.flatMap(m=>m.notes).map(n=>n.degree?noteMidi(n,p):null),s.measures.flatMap(m=>m.notes).map(n=>n.degree?noteMidi(n,s):null));assert.equal(p.transcription.doEvidence.candidates[0].key,'C');assert.equal(repairUnconfirmedDo(p,input,{runId:'r',scoreBasedOn:'r'}),p);
});
test('manual confirmed Do, independent imported scores and another run are never automatically relabelled',()=>{
 const s=transcriptionToScore(input,{key:'Bb'});
 s.keyMap.locked=true;s.keyMap.status='confirmed';assert.equal(repairUnconfirmedDo(s,input,{runId:'r',scoreBasedOn:'r'}),s);
 s.keyMap.locked=false;s.keyMap.status='unknown';assert.equal(repairUnconfirmedDo(s,input,{runId:'new',scoreBasedOn:'old'}),s);delete s.transcription;assert.equal(repairUnconfirmedDo(s,input,{runId:'r',scoreBasedOn:'r'}),s);
});
