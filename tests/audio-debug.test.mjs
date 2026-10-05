import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDebugData,rangeStats,midiHz,pitchLabel,clampWindow,peakEnvelope,spectrum} from '../src/audio-debug-data.js';
test('all evidence ranges convert clip seconds to original seconds exactly once, missing cores stay absent',()=>{
 const d=normalizeDebugData({metadata:{clipStart:30},frames:[{time:.5,midi:69,voiced:false}]},{notes:[{start:.4,end:.9,midi:69,coreStart:.6,coreEnd:.8},{start:1,end:2,midi:70}]},{duration:3,clipStart:30},{params:{start:30}});
 assert.equal(d.frames[0].time,30.5);assert.equal(d.notes[0].coreStart,30.6);assert.equal(d.notes[1].coreStart,null);assert.deepEqual([d.min,d.max],[30,33]);assert.equal(d.frames[0].voiced,false);
});
test('old sparse pitch tracks are explicitly labelled incomplete; unvoiced guesses excluded from range center',()=>{
 const d=normalizeDebugData(null,null,{duration:3,clipStart:4,pitchTrack:[{time:1,midi:69,confidence:.8}],notes:[]});assert.equal(d.full,false);assert.equal(d.frames[0].voiced,null);
 const s=rangeStats([{time:0,midi:81,voiced:false},{time:.1,midi:69,voiced:true},{time:.2,midi:69.2,voiced:true}],0,1);assert.equal(s.count,3);assert.equal(s.voiced,2);assert.equal(s.center,69.1);
});
test('wave envelope preserves positive and negative impulses instead of averaging them away',()=>{
 const samples=new Float32Array(130);samples[2]=.9;samples[8]=-.8;samples[129]=.3;const p=peakEnvelope(samples);assert.ok(Math.abs(p.max[0]-.9)<1e-6);assert.ok(Math.abs(p.min[0]+.8)<1e-6);assert.equal(p.min.length,3);assert.ok(p.min[2]===0&&p.max[2]>.29);
});
test('frequency/name axes and edge zoom remain mathematically consistent',()=>{
 assert.equal(midiHz(69),440);assert.equal(pitchLabel(69),'A4');assert.deepEqual(clampWindow(25,37,30,60),[30,42]);assert.deepEqual(clampWindow(59,61,30,60),[58,60]);
});
test('STFT peaks near A4 for an actual 440 Hz sine, not an invented pitch track',()=>{
 const sr=16000,samples=Float32Array.from({length:sr},(_,i)=>.5*Math.sin(2*Math.PI*440*i/sr));const r=spectrum(samples,sr,.2,.8,{minMidi:60,maxMidi:78,maxColumns:20});let peak=-Infinity,index=-1;for(let row=0;row<r.rows;row++){const db=r.values[5*r.rows+row];if(db>peak){peak=db;index=row;}}assert.ok(Math.abs((r.minMidi+index/2)-69)<=.5);assert.ok(peak>-8&&peak<-4);assert.ok(r.columns<=21);
});
