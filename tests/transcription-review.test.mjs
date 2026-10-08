import test from 'node:test';
import assert from 'node:assert/strict';
import {transcriptionToScore} from '../src/transcription-score.js';
import {render} from '../src/render.js';
import {change,parse} from '../src/model.js';
import {normalizeDebugData,frameDecisionLabel,scoreNoteLabel} from '../src/audio-debug-data.js';
const make=notes=>({notes,estimatedBpm:120,duration:3,clipStart:0,pitchDiagnostics:{version:'vocal-notes-v3.2'}});
const n=(midi,start,end,extra={})=>({midi,start,end,confidence:.9,...extra});
test('unrecognized gaps stay editable duration placeholders but render as pending, not certain rests',()=>{
 const s=transcriptionToScore(make([n(60,0,.5),n(64,1.5,2)]),{key:'C',rhythmMode:'stable',barAnchor:0});
 const gaps=s.measures.flatMap(m=>m.notes).filter(n=>n.reviewReason==='unresolved-gap');assert.ok(gaps.length);assert.ok(gaps.every(n=>n.degree===0&&n.confidence!==1&&n.reviewRequired));
 assert.match(render(s,null,-1),/>\?<\/text>/);assert.match(render(s,null,-1),/未识别区间/);assert.equal(parse(JSON.stringify(s)).transcription.unresolvedGaps,gaps.length);
 change(s,0,gaps[0].id,{degree:0});assert.equal(s.measures[0].notes.find(n=>n.id===gaps[0].id).reviewRequired,undefined);
});
test('a gap with repeated voiced pitch-track evidence becomes a tinted natural-scale guess and keeps its duration',()=>{
 const frames=Array.from({length:6},(_,i)=>({time:.55+i*.1,midi:65.1,confidence:.8}));
 const s=transcriptionToScore({...make([n(60,0,.5),n(67,1.5,2)]),pitchTrack:frames},{key:'C',rhythmMode:'stable',barAnchor:0});
 const guessed=s.measures.flatMap(m=>m.notes).find(note=>note.reviewReason==='inferred-gap-pitch');
 assert.ok(guessed);assert.equal(guessed.degree,4);assert.equal(guessed.accidental,undefined);assert.equal(guessed.reviewRequired,true);assert.equal(guessed.pitchStatus,'uncertain');
 assert.ok(guessed.gridTimeEnd>guessed.gridTimeStart);assert.match(render(s,null,-1),/class="digit inferred-pitch"/);assert.match(render(s,null,-1),/推测的自然音级/);
});
test('recovered events carry review provenance into final score and never replace strict evidence sharing a grid slot',()=>{
 const recovered=n(62,.52,.85,{confidence:0,pitchStatus:'uncertain',reviewRequired:true,recoveryReason:'low-voicing-stable-evidence'});
 const s=transcriptionToScore(make([n(60,0,.5),recovered,n(64,1,1.5)]),{key:'C'});
 const r=s.measures.flatMap(m=>m.notes).find(n=>n.pitchMidi===62);assert.ok(r.reviewRequired);assert.equal(r.recoveryReason,recovered.recoveryReason);
 const collision=transcriptionToScore(make([recovered,n(65,.55,.95,{confidence:0,pitchStatus:'uncertain'})]),{key:'C',rhythmMode:'stable',barAnchor:0});assert.ok(collision.measures.flatMap(m=>m.notes).some(n=>n.pitchMidi===65));assert.ok(!collision.measures.flatMap(m=>m.notes).some(n=>n.pitchMidi===62));
});
test('plot faithfully distinguishes recorded source rejection from old approximate eligibility; note labels retain accidentals',()=>{
 const d=normalizeDebugData({frames:[{time:0,midi:60,voiced:true,energy:.1,voicingProbability:.8,decoderEligible:false,decoderRejection:'source-ratio'},{time:.1,midi:60,voiced:true,energy:.1,voicingProbability:.02}]},null,{duration:1});
 assert.equal(d.frames[0].decoderEligible,false);assert.equal(frameDecisionLabel(d.frames[0]),'人声/原曲比例不足');assert.equal(d.frames[1].decoderEligible,false);assert.match(frameDecisionLabel(d.frames[1]),/旧数据估算/);
 assert.equal(scoreNoteLabel({degree:6,accidental:1,octave:-1}),'♯6（低1八度）');
});
