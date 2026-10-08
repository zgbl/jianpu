// The beat detector may label every half-bar as a downbeat later in a song.
// A sustained opening run of real downbeats two candidate bars apart is
// stronger evidence for the slower 4/4 level than the fast pulse prior.
function denseVocalHalfTime(result,bpm,bar){
 const rhythm=result?.rhythm||{};
 if(rhythm.downbeatConfirmed||result?.manualCalibration||bpm<120||bpm>150||!Array.isArray(result?.notes))return false;
 // A 4/4 detector can confidently mark every *half* of a slow bar as a
 // downbeat. In this range the model's downbeat spacing alone cannot resolve
 // 130 vs 65 BPM; use the opening vocal phrase as an independent cue.
 if(!rhythm.candidates?.some(c=>Math.abs(c.bpm-bpm/2)<bpm*.025))return false;
 const starts=result.notes.filter(n=>n.midi>0&&Number.isFinite(n.start)).map(n=>n.start).sort((a,b)=>a-b);
 if(starts.length<20)return false;
 const first=starts[0],counts=Array.from({length:4},(_,i)=>starts.filter(t=>t>=first+i*bar&&t<first+(i+1)*bar).length);
 return counts.reduce((a,b)=>a+b,0)>=20&&counts.filter(n=>n>=4).length>=3;
}

export function preferredRhythmBpm(result,meter=4){
 const rhythm=result?.rhythm||{},stable=rhythm.stableGrid;
 if(Number.isFinite(rhythm.preferredBpm)&&rhythm.preferredBpm>0)return rhythm.preferredBpm;
 const candidate=stable?.bpm||rhythm.estimatedBpm||result?.estimatedBpm;
 if(meter!==4||!stable||candidate<100)return candidate;
 const bar=stable.barDuration||60/candidate*meter;
 if(denseVocalHalfTime(result,candidate,bar))return candidate/2;
 if(!Array.isArray(rhythm.downbeatTimes))return candidate;
 const times=rhythm.downbeatTimes;
 const intervals=times.slice(1).map((t,i)=>t-times[i]).filter(d=>Number.isFinite(d)&&d>=bar*.75&&d<=bar*2.25),tolerance=Math.max(.14,bar*.12);
 const doubleBars=intervals.filter(d=>Math.abs(d-2*bar)<=tolerance).length;
 // Ignore an irregular intro: repeated model downbeats two fast bars apart
 // across the track are evidence that the detected pulse is subdivisions.
 return doubleBars>=4&&doubleBars/Math.max(1,intervals.length)>=.6?candidate/2:candidate;
}

// A detector may change metrical phase during the intro. Use a consistent
// local run of model downbeats around the first vocal phrase, not its first
// timestamp. The result remains a suggestion, never manual confirmation.
export function suggestedRhythmAnchor(result,meter=4,bpm=preferredRhythmBpm(result,meter)){
 const rhythm=result?.rhythm||{},period=60/bpm;
 const fallback=rhythm.downbeatTimes?.[0]??rhythm.stableGrid?.anchorTime??rhythm.beatTimes?.[rhythm.downbeatIndex||0]??0;
 const first=Math.min(...(result?.notes||[]).filter(n=>n.midi>0&&Number.isFinite(n.start)).map(n=>n.start));
 if(!Number.isFinite(first)||!Number.isFinite(period)||period<=0)return fallback;
 const bar=period*meter,times=(rhythm.downbeatTimes||[]).filter(t=>Number.isFinite(t)&&t>=first-2*bar&&t<=first+4*bar);
 if(times.length<3)return fallback;
 const candidates=times.filter(t=>t<=first);
 let chosen=null;
 for(const anchor of candidates){
  const agreeing=times.filter(t=>Math.abs((t-anchor)/bar-Math.round((t-anchor)/bar))*bar<=period*.15);
  if(agreeing.length<3)continue;
  const score=agreeing.reduce((sum,t)=>sum+1/(1+Math.abs(t-first)/bar),0);
  if(!chosen||score>chosen.score+1e-8||Math.abs(score-chosen.score)<=1e-8&&anchor>chosen.anchor)chosen={anchor,score};
 }
 return chosen?.anchor??fallback;
}
