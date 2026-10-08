// Pitch events have already been decoded from acoustic cores. This pass only
// chooses notation times; it never crops audio or recomputes a pitch from beats.
function energyAfter(event,boundary,toUnit){
 const energy=event.timingEnergy;if(!energy||!Array.isArray(energy.weights)||!energy.weights.length||!(energy.end>energy.start))return null;
 let after=0,total=0;const width=(energy.end-energy.start)/energy.weights.length;
 for(let i=0;i<energy.weights.length;i++){const w=energy.weights[i];if(!Number.isFinite(w)||w<0)continue;const a=toUnit(energy.start+i*width),b=toUnit(energy.start+(i+1)*width);if(!(b>a))continue;total+=w;after+=w*Math.max(0,Math.min(1,(b-Math.max(a,boundary))/(b-a)));}
 return total?after/total:null;
}
function boundaryEvidence(events,toUnit,barUnits){
 const evidence=new Map();
 for(let i=0;i<events.length;i++){
  const e=events[i],observed=toUnit(e.start),boundary=Math.ceil(observed/barUnits)*barUnits,early=boundary-observed;
  if(e.manual||e.pitchStatus==='uncertain'||e.recoveryReason||!Number.isFinite(e.coreStart)||!Number.isFinite(e.coreEnd)||e.coreEnd-e.coreStart<.08||early<=0||early>1.15)continue;
  const a=toUnit(e.coreStart),b=toUnit(e.coreEnd),end=toUnit(e.end),coreShare=Math.max(0,Math.min(1,(b-Math.max(a,boundary))/(b-a))),energyShare=energyAfter(e,boundary,toUnit);
  // A well-established attack before the bar is a pickup/syncopation candidate.
  // Majority overlap alone never moves a long note that began much earlier.
  const ordinary=early<=.9&&a>=boundary-.85&&end>=boundary+.5&&coreShare>=.6&&(energyShare!==null?energyShare>=.6:coreShare>=.65);
  // An isolated phrase entrance may anticipate by a full sixteenth. Require
  // a short stable note straddling the bar, measured energy, and three reliable
  // following attacks supporting the eighth-note grid. Do not move the grid:
  // those following attacks already agree with the accompaniment.
  const following=events.slice(i+1,i+4),previous=events[i-1];
  const phraseEntry=early>=.5&&(!previous||observed-toUnit(previous.end)>=8)&&
   end-observed<=4&&end>=boundary+1&&coreShare>=.55&&energyShare!==null&&energyShare>=.5&&
   following.length===3&&following.every((n,j)=>{
    const offset=toUnit(n.start)-boundary,slot=Math.round(offset/2)*2;
    return !n.manual&&!n.recoveryReason&&n.pitchStatus!=='uncertain'&&Number.isFinite(n.coreStart)&&Number.isFinite(n.coreEnd)&&n.coreEnd-n.coreStart>=.08&&
     slot>=2&&slot<=8&&Math.abs(offset-slot)<=.4&&(!j||slot>Math.round((toUnit(following[j-1].start)-boundary)/2)*2);
   });
  if(!ordinary&&!phraseEntry)continue;
  const peers=events.filter((other,j)=>j!==i&&events[j-1]?.midi===events[i-1]?.midi&&events[j+1]?.midi===events[i+1]?.midi&&other.midi===e.midi&&other.pitchStatus!=='uncertain'&&Number.isFinite(other.coreStart)&&Number.isFinite(other.coreEnd)&&Math.abs((other.end-other.start)-(e.end-e.start))<.12);
  const pickups=peers.filter(other=>{const x=toUnit(other.start),edge=Math.ceil(x/barUnits)*barUnits;return edge-x>=.85&&edge-x<=1.15&&toUnit(other.coreStart)<edge-.75;}).length;
  // Repeated deliberate pickups reduce the strong-beat preference.
  const bonus=Math.max(0,(phraseEntry?1.4:.75*coreShare+.45*(energyShare??coreShare)-.05)-(pickups>=2?.8:0));
  evidence.set(e,{boundary,earlyUnits:early,coreAfterShare:coreShare,energyAfterShare:energyShare,repeatedPickups:pickups,phraseEntry,bonus});
 }
 return evidence;
}
export function quantizeMelodyOnsets(events,toUnit,{barUnits=16,toTime=null}={}){
 const priority=e=>e.manual?3:e.recoveryReason?1:2;
 const best=group=>group.reduce((a,b)=>priority(b)>priority(a)||priority(b)===priority(a)&&(b.end-b.start)*(b.confidence||0)>(a.end-a.start)*(a.confidence||0)?b:a);
 const slots=new Map();
 for(const e of events){
  if(!Number.isFinite(e.start)||!Number.isFinite(e.end)||e.end<=e.start)throw Error('识别时间数据不合法。');
  const slot=Math.round(toUnit(e.start));if(!slots.has(slot))slots.set(slot,[]);slots.get(slot).push(e);
 }
 // Only unresolved micro fragments compete for a slot. Two sustained pitch
 // events must not be discarded simply because separate rounding collides.
 const notes=[];
 for(const group of slots.values()){
  // A recovery candidate covering the same acoustic interval as a primary
  // event is alternative evidence, not a second sung note. Giving both nearby
  // grid slots would invent a pitch change (and can displace the primary).
  const eligible=group.filter(e=>!e.recoveryReason||e.manual||e.independentEvidence||!group.some(other=>
   other!==e&&!other.recoveryReason&&Math.min(e.end,other.end)-Math.max(e.start,other.start)>(e.end-e.start)*.5));
  const sustained=eligible.filter(e=>e.manual||e.independentEvidence||toUnit(e.end)-toUnit(e.start)>=.5);
  notes.push(...(sustained.length?sustained:[best(eligible)]));
 }
 notes.sort((a,b)=>a.start-b.start);
 const boundaryInfo=boundaryEvidence(notes,toUnit,barUnits);
 let states=[{unit:-Infinity,cost:0,previous:null,event:null}];
 for(const event of notes){
  const observed=toUnit(event.start),nearest=Math.max(0,Math.round(observed));
  const candidates=event.manual?[nearest]:[...new Set([Math.max(0,Math.floor(observed)),Math.max(0,Math.ceil(observed))])].filter(u=>Math.abs(u-observed)<=.8);
  const boundary=boundaryInfo.get(event);if(boundary&&!candidates.includes(boundary.boundary))candidates.push(boundary.boundary);
  const next=[];
  for(const unit of candidates){
   let winner=null;
   for(const previous of states){
    if(unit<=previous.unit)continue;
    const duration=unit-previous.unit;
    // Timing evidence dominates. A small spelling cost favors ordinary
    // durations only when adjacent grid choices fit the performance similarly.
    const spelling=Number.isFinite(duration)&&duration>1&&duration%2===1?.08:0;
    const cost=previous.cost+(unit-observed)**2+spelling-(boundary?.boundary===unit?boundary.bonus:0);
    if(!winner||cost<winner.cost)winner={unit,cost,previous,event};
   }
   if(winner)next.push(winner);
  }
  if(!next.length){
   // Resolve only this local collision. A crowded fragment must not undo
   // successful timing matches elsewhere in the song or shift later bars.
   const winner=states.reduce((a,b)=>b.cost<a.cost?b:a);
   const previous=winner.previous;
   if(previous&&best([winner.event,event])===event&&nearest>previous.unit){
    states=[{unit:nearest,cost:previous.cost+(nearest-observed)**2,previous,event}];
   }else states=[winner];
   continue;
  }
  states=next;
 }
 const units=new Map();let last=states.reduce((a,b)=>b.cost<a.cost?b:a);
 while(last.event){units.set(last.event,last.unit);last=last.previous;}
 const retained=notes.filter(e=>units.has(e)),decisions=new Map();
 for(const event of retained){const unit=units.get(event),info=boundaryInfo.get(event),boundarySelected=info?.boundary===unit;
  decisions.set(event,{method:'metrical-core-energy-v2',actualStart:event.start,...(toTime?{notationStart:toTime(unit),shiftMs:(toTime(unit)-event.start)*1000}:{}),unit,reason:event.manual?'manual-position':boundarySelected?(info.phraseEntry?'phrase-entry-to-downbeat':'early-entry-to-downbeat'):'nearest-grid-with-context',...(info?{coreAfterShare:info.coreAfterShare,energyAfterShare:info.energyAfterShare,repeatedPickups:info.repeatedPickups,boundarySelected}: {})});
 }
 return {notes:retained,units,decisions,boundaryAligned:[...decisions.values()].filter(d=>d.boundarySelected).length,dropped:events.length-retained.length,adjusted:retained.filter(e=>units.get(e)!==Math.max(0,Math.round(toUnit(e.start)))).length};
}
