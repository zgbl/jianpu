import {ticks} from './model.js';

// Diagnostic playback keeps the detector's seconds and absolute MIDI, without
// Do relabeling, bar quantization, or manually edited score pitches.
export function melodyTimeline(result,score,start=0){
 if(!Number.isFinite(start)||start<0)throw Error('旋律试听起点不合法');
 const marks=[],events=[],notes=score?.measures.flatMap((m,measure)=>m.notes.map(n=>({n,measure})))||[];
 for(const event of result.notes){
  if(event.end<=start)continue;
  events.push({midi:event.midi,start:Math.max(0,event.start-start),end:event.end-start});
  const key=event.sourceEventId||`${Math.round(event.start*1000)}-${event.midi}`;
  const fragments=notes.filter(({n})=>n.sourceEventId===key),total=fragments.reduce((s,{n})=>s+ticks(n),0);
  let cursor=event.start;
  for(const {n,measure} of fragments){const end=cursor+(event.end-event.start)*ticks(n)/total;if(end>start)marks.push({id:n.id,measure,start:Math.max(0,cursor-start),end:end-start});cursor=end;}
 }
 return {events,marks,duration:Math.max(0,result.duration-start),bpm:120,source:'unquantized-melody',sourceStart:start};
}
