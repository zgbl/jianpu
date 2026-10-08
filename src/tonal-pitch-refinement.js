import {keyPc,mod12,noteMidi,pitchToDegree,referenceDo} from './pitch.js';
import {validate} from './model.js';
const SCALE=[0,2,4,5,7,9,11];
const eventKey=e=>e.sourceEventId||`${Math.round(e.start*1000)}-${e.midi}`;
function slideDestination(event,next,frames,inScale){
 if(!next||!inScale(next.midi)||Math.abs(next.midi-event.midi)!==1||event.independentEvidence||next.independentEvidence||event.articulationBoundary||next.articulationBoundary)return false;
 if(event.end-event.start>.12||next.start-event.end<0||next.start-event.end>.096||next.coreEnd-next.coreStart<.16||next.pitchStatus==='uncertain')return false;
 const path=frames.filter(f=>f.time>=event.start&&f.time<=next.coreStart+.02&&Number.isFinite(f.midi));
 if(path.length<3||path[0].time-event.start>.05||next.coreStart-path.at(-1).time>.05)return false;
 const direction=Math.sign(next.midi-event.midi);let backwards=0;
 for(let i=1;i<path.length;i++){const delta=path[i].midi-path[i-1].midi;if(path[i].time-path[i-1].time>.065||Math.abs(delta)>Math.min(1.5,40*(path[i].time-path[i-1].time)))return false;backwards+=Math.max(0,-direction*delta);}
 return backwards<=.4&&direction*(path.at(-1).midi-path[0].midi)>=.7;
}
// A notation pass, explicitly enabled for the chosen Do. Raw acoustic events,
// cents and source times remain evidence; genuine chromatic plateaus survive.
export function refineScorePitch(score,events,{frames=[],enabled=score.pitchRefinement?.enabled??score.keyMap?.locked??false}={}){
 if(!enabled)return structuredClone(score);
 const next=structuredClone(score),pc=keyPc(score.key),inScale=midi=>SCALE.includes(mod12(midi-pc)),decisions=new Map();
 const ordered=[...events].sort((a,b)=>a.start-b.start);
 for(let i=0;i<ordered.length;i++){
  const e=ordered[i],center=e.pitchCenterMidi;
  if(e.manual||e.pitchStatus==='manual-confirmed'||inScale(e.midi)||!Number.isFinite(center))continue;
  const following=ordered[i+1];
  if(slideDestination(e,following,frames,inScale)){
   decisions.set(eventKey(e),{originalMidi:e.midi,targetMidi:following.midi,reason:'slide-to-stable-diatonic',destinationEventId:eventKey(following),pitchCenterMidi:center,key:score.key});continue;
  }
  const core=Number.isFinite(e.coreStart)&&Number.isFinite(e.coreEnd)?e.coreEnd-e.coreStart:0;
  const weak=e.pitchStatus==='uncertain'||core<.12||Math.abs(center-e.midi)>.28||(e.coreDispersionCents??0)>25;
  if(!weak)continue;
  const candidates=[e.midi-1,e.midi+1].filter(inScale).map(midi=>({midi,distance:Math.abs(midi-center)})).sort((a,b)=>a.distance-b.distance);
  const target=candidates[0];
  if(!target||target.distance>.85||candidates[1]&&candidates[1].distance-target.distance<.2)continue;
  // Repeated stable chromatic evidence is stronger than the scale prior.
  const repeats=ordered.filter(n=>n!==e&&n.midi===e.midi&&n.pitchStatus!=='uncertain'&&Number.isFinite(n.coreStart)&&n.coreEnd-n.coreStart>=.16&&Math.abs(n.pitchCenterMidi-n.midi)<.2);
  if(repeats.length>=2)continue;
  decisions.set(eventKey(e),{originalMidi:e.midi,targetMidi:target.midi,reason:'weak-pitch-diatonic-prior',pitchCenterMidi:center,key:score.key});
 }
 const notes=next.measures.flatMap(m=>m.notes),changed=[];
 for(const n of notes){
  const d=decisions.get(n.sourceEventId);if(!d||!n.degree||n.pitchStatus==='manual-confirmed')continue;
  const midi=noteMidi(n,next);if(midi!==d.originalMidi&&!(n.pitchCorrection&&midi===n.pitchCorrection.targetMidi))continue;
  const originalNotation=n.pitchCorrection?.originalNotation||Object.fromEntries(['degree','octave','accidental','pitchMidi','reviewRequired','reviewReason'].filter(k=>k in n).map(k=>[k,n[k]]));
  delete n.accidental;Object.assign(n,pitchToDegree(d.targetMidi,next.key,referenceDo(next)));
  n.pitchMidi=d.targetMidi;n.pitchCorrection={...d,originalNotation};n.reviewRequired=true;
  if(!n.reviewReason)n.reviewReason='tonal-pitch-candidate';changed.push(n.id);
 }
 // A resolved scoop and its destination are one sustained notated pitch.
 // Keep both IDs/times so lyrics, selections and raw-audio comparisons survive.
 for(let i=0;i<notes.length-1;i++){
  const a=notes[i],b=notes[i+1],d=a.pitchCorrection;
  if(d?.reason!=='slide-to-stable-diatonic'||b.sourceEventId!==d.destinationEventId||!b.degree||noteMidi(a,next)!==noteMidi(b,next)||a.gridTimeEnd!==b.gridTimeStart)continue;
  if(!next.spans.some(s=>s.type==='tie'&&s.from===a.id&&s.to===b.id))next.spans.push({id:crypto.randomUUID(),type:'tie',from:a.id,to:b.id,pitchRefinement:true});
 }
 next.pitchRefinement={enabled:true,key:score.key,method:'diatonic-evidence-v1',changedEvents:new Set(changed.map(id=>notes.find(n=>n.id===id).sourceEventId)).size};
 return validate(next);
}

export function restoreScorePitch(score){
 const next=structuredClone(score);
 for(const n of next.measures.flatMap(m=>m.notes)){
  if(!n.pitchCorrection)continue;
  if(n.pitchStatus!=='manual-confirmed'){
   for(const k of ['degree','octave','accidental','pitchMidi','reviewRequired','reviewReason'])delete n[k];
   Object.assign(n,n.pitchCorrection.originalNotation);
  }
  delete n.pitchCorrection;
 }
 next.spans=next.spans.filter(s=>!s.pitchRefinement);next.pitchRefinement={enabled:false};return validate(next);
}
