import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDebugData,rangeStats,midiHz,pitchLabel,clampWindow,peakEnvelope,spectrum,pitchDeviation,centsLabel} from '../src/audio-debug-data.js';
import {selectDebugRun} from '../src/audio-debug-data.js';
test('debug follows a newly recognized score instead of retaining its old run',()=>{
 const runs=[{id:'old',status:'done'},{id:'new',status:'done'}];
 const before={id:'p',scoreBasedOn:'old',runs},after={id:'p',scoreBasedOn:'new',runs};
 assert.equal(selectDebugRun(after,before,runs[0]).id,'new');
 assert.equal(selectDebugRun(after,after,runs[0]).id,'old');
 assert.equal(selectDebugRun(after,null,null).id,'new');
});
test('signed deviations restore tuning once and measure raw core spread without unvoiced guesses',()=>{
 const n={midi:69,pitchCenterMidi:68.9,coreStart:30,coreEnd:31};
 const frames=[{time:30,midi:69.1,voiced:true},{time:30.2,midi:69.3,voiced:true},{time:30.4,midi:45,voiced:false},{time:31,midi:81,voiced:true}];
 const d=pitchDeviation(n,frames,20);
 assert.ok(Math.abs(d.rawCents-10)<1e-8);assert.ok(Math.abs(d.correctedCents+10)<1e-8);assert.equal(d.count,2);assert.ok(Math.abs(d.spread[0]-10)<1e-8);assert.ok(Math.abs(d.spread[1]-30)<1e-8);
 assert.equal(centsLabel(d.rawCents),'+10.0 音分');assert.equal(centsLabel(d.correctedCents),'-10.0 音分');
 assert.ok(Math.abs(d.rawHz-midiHz(69.1))<1e-8);
});
test('missing tuning uses raw core median, missing evidence stays unknown rather than pretending zero',()=>{
 const n={midi:69,pitchCenterMidi:69.1,coreStart:0,coreEnd:1};
 assert.ok(Math.abs(pitchDeviation(n,[{time:.2,midi:68.8,voiced:true}]).rawCents+20)<1e-8);
 assert.equal(pitchDeviation(n).rawCents,null);assert.equal(pitchDeviation({midi:69}).correctedCents,null);assert.equal(centsLabel(null),'未提供');
 const d=normalizeDebugData(null,{notes:[{start:0,end:1,midi:69,pitchCenterMidi:69.2}],diagnostics:{tuningCents:0}},{duration:1});
 assert.equal(centsLabel(d.notes[0].deviation.rawCents),'+20.0 音分');
});
test('reference pitch exposes a wrong target even when assigned-target cents are small',()=>{
 const note={midi:59,pitchCenterMidi:59.3983,coreStart:42.432,coreEnd:42.56};
 const assigned=pitchDeviation(note,[],0),reference=pitchDeviation(note,[],0,60);
 assert.equal(centsLabel(assigned.rawCents),'+39.8 音分');
 assert.equal(centsLabel(reference.rawCents),'-60.2 音分');
 assert.equal(reference.rawHz,assigned.rawHz);assert.equal(note.midi,59);
 assert.equal(pitchDeviation(note,[],0,null).rawCents,null);
 const range=pitchDeviation({coreStart:0,coreEnd:1},[{time:.2,midi:60.2,voiced:true}],null,60);
 assert.equal(centsLabel(range.rawCents),'+20.0 音分');assert.equal(range.correctedCents,null);
});
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
