// A detector may change metrical phase during the intro. Use a consistent
// local run of model downbeats around the first vocal phrase, not its first
// timestamp. The result remains a suggestion, never manual confirmation.
export function suggestedRhythmAnchor(result,meter=4){
 const rhythm=result?.rhythm||{},period=rhythm.stableGrid?.period||60/rhythm.estimatedBpm;
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
