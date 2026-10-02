import {ticks,validate} from './model.js';
// Only bridge brief detector gaps, never long silence or explicitly edited events.
export function tidyDetectedRests(score){
 const next=structuredClone(score),all=next.measures.flatMap(m=>m.notes.map(n=>({n,m})));let count=0;
 const protectedIds=new Set([...(next.lyrics||[]).flatMap(l=>[l.noteId,l.endNoteId]),...(next.lyricAlignment?.characters||[]).map(c=>c.placement?.noteId),...next.spans.flatMap(s=>[s.from,s.to])]);
 for(let i=1;i<all.length-1;i++){
  const {n,m}=all[i],prev=all[i-1].n,following=all[i+1].n;
  const gap=following.sourceTime-prev.sourceEnd;
  if(n.degree||!prev.degree||!following.degree||n.manual||prev.manual||following.manual||!Number.isFinite(gap)||gap<0||gap>Math.min(.3,30/(next.tempo||next.transcription?.bpm||120))||ticks(n)>8)continue;
  const combined=ticks(prev)+ticks(n),duration=[[1,0],[2,1],[2,0],[4,1],[4,0],[8,1],[8,0],[16,0]].find(([base,dots])=>ticks({base,dots})===combined);
  if(duration&&all[i-1].m===m&&!protectedIds.has(n.id)){
   prev.base=duration[0];prev.dots=duration[1];prev.gridTimeEnd=n.gridTimeEnd??prev.gridTimeEnd;prev.sourceEnd=following.sourceTime;
   m.notes.splice(m.notes.indexOf(n),1);all.splice(i,1);i--;
  }else{
   n.detectedRestBeforeCleanup={degree:n.degree,octave:n.octave,base:n.base,dots:n.dots};
   Object.assign(n,{degree:prev.degree,octave:prev.octave,accidental:prev.accidental||0,pitchMidi:prev.pitchMidi,sourceTime:prev.sourceTime,sourceEnd:following.sourceTime,sourceEventId:prev.sourceEventId});
   next.spans.push({id:crypto.randomUUID(),type:'tie',from:prev.id,to:n.id});
  }count++;
 }
 next.transcription={...next.transcription,restCleanup:{version:1,bridged:count}};
 return {score:validate(next),count};
}
