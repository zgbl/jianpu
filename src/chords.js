import {configureHarmony} from './chord-harmony.js';
import {audioScoreTimeline} from './audio-score-cursor.js';
export function chordWindows(score,{halves=false,duration=Infinity}={}){
 const segments=audioScoreTimeline(score),byId=new Map(segments.map(s=>[s.id,s]));
 return score.measures.flatMap(m=>{const timed=m.notes.map(n=>byId.get(n.id)).filter(Boolean);if(!timed.length)return [];// The written first bar may start before the recording; analyze only audible time.
 const start=Math.max(0,Math.min(...timed.map(s=>s.start))),end=Math.min(duration,Math.max(...timed.map(s=>s.end)));return end>start?(halves?[{measureId:m.id,start,end:(start+end)/2},{measureId:m.id,start:(start+end)/2,end}]:[{measureId:m.id,start,end}]):[];});
}
// Chords in the editable score use measure-relative ticks, not `start/end`
// seconds. When a tempo correction changes bar length, transfer their labels
// through the recording timeline and write fresh ticks for the new measures.
export function remapChordsByTime(previous,next){
 const oldWindows=new Map(chordWindows(previous).map(w=>[w.measureId,w]));
 const oldCapacity=previous.meter[0]*64/previous.meter[1];
 const timed=(previous.chords||[]).flatMap(c=>{
  const w=oldWindows.get(c.measureId);if(!w)return [];
  return [{...c,start:w.start+(w.end-w.start)*(c.startTick||0)/oldCapacity,end:w.start+(w.end-w.start)*(c.endTick??oldCapacity)/oldCapacity}];
 });
 const capacity=next.meter[0]*64/next.meter[1];
 return chordWindows(next).flatMap(w=>{
  const measure=next.measures.find(m=>m.id===w.measureId);if(measure?.introPlaceholder)return [];
  const half=(w.end-w.start)/2;
  return [0,1].flatMap(i=>{
   const sample=w.start+(i+.5)*half;
   const old=timed.find(c=>c.start<=sample&&c.end>sample);
   if(!old)return [];
   const {start,end,...chord}=old;
   return [{...chord,measureId:w.measureId,startTick:i*capacity/2,endTick:(i+1)*capacity/2}];
  });
 });
}
export function applyChords(score,analysis){const next=structuredClone(score);next.chordAnalysis=analysis;const configured=configureHarmony(next,analysis);const manual=(score.chords||[]).filter(c=>c.source==='manual');next.chords=[...configured.chords.filter(c=>!manual.some(m=>m.measureId===c.measureId)),...manual];next.chordConfiguration=configured.report;return next;}
export function chordAtMeasure(score,measure){return (score.chords||[]).find(c=>c.measureId===measure.id);}
