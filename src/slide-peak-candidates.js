// Review evidence only: a short crest is not proof of a separately intended note.
// Frames use raw A440 MIDI; saved event centers have tuning correction applied.
const cache=new WeakMap();
export function slidePeakCandidates(data){
 if(cache.has(data))return cache.get(data);
 const frames=data.frames||[],out=[],tuning=(data.diagnostics?.tuningCents||0)/100;
 const hop=(data.meta?.hopLength/data.meta?.sampleRate)||.016;
 for(const n of data.notes||[]){
  if(n.pitchStatus==='uncertain'||n.recoveryReason||!Number.isFinite(n.coreStart)||!Number.isFinite(n.coreEnd)||n.coreEnd-n.coreStart<.08)continue;
  if(!n.ornaments?.some(o=>o.type==='scoop'))continue;
  const baseline=(n.pitchCenterMidi??n.midi)+tuning;
  const fs=frames.filter(f=>f.time>=Math.max(n.performanceStart,n.coreStart-.5)&&f.time<n.coreStart&&f.voiced===true&&f.decoderEligible===true&&Number.isFinite(f.midi));
  if(fs.length<5)continue;
  const peak=fs.reduce((a,f)=>f.midi>a.midi?f:a),i=fs.indexOf(peak),prominence=peak.midi-baseline;
  // Need an observed rise AND fall, not a monotonic slide or a single-frame spike.
  if(i===0||i===fs.length-1||prominence<.7||prominence>3||peak.midi-fs[0].midi<.7||peak.midi-fs.at(-1).midi<.5)continue;
  let lo=i,hi=i;
  while(lo>0&&fs[lo].time-fs[lo-1].time<=hop*1.5&&peak.midi-fs[lo-1].midi<=.35)lo--;
  while(hi+1<fs.length&&fs[hi+1].time-fs[hi].time<=hop*1.5&&peak.midi-fs[hi+1].midi<=.35)hi++;
  const start=fs[lo].time,end=Math.min(n.coreStart,fs[hi].time+hop);
  if(hi-lo+1<3||end-start<.048-1e-6)continue;
  const midi=Math.round(peak.midi-tuning);
  if(midi===n.midi||(data.notes||[]).some(other=>other!==n&&other.performanceStart<end&&other.performanceEnd>start))continue;
  out.push({key:`slide-peak:${n.index}:${start.toFixed(4)}:${end.toFixed(4)}`,parentIndex:n.index,start,end,peakTime:peak.time,rawPeakMidi:peak.midi,midi,prominenceCents:prominence*100,frameCount:hi-lo+1,reviewRequired:true});
 }
 cache.set(data,out);return out;
}
