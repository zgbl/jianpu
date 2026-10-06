// Pitch events have already been decoded from acoustic cores. This pass only
// chooses notation times; it never crops audio or recomputes a pitch from beats.
export function quantizeMelodyOnsets(events,toUnit){
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
  const sustained=group.filter(e=>e.manual||toUnit(e.end)-toUnit(e.start)>=.5);
  notes.push(...(sustained.length?sustained:[best(group)]));
 }
 notes.sort((a,b)=>a.start-b.start);
 let states=[{unit:-Infinity,cost:0,previous:null,event:null}];
 for(const event of notes){
  const observed=toUnit(event.start),nearest=Math.max(0,Math.round(observed));
  const candidates=event.manual?[nearest]:[...new Set([Math.max(0,Math.floor(observed)),Math.max(0,Math.ceil(observed))])].filter(u=>Math.abs(u-observed)<=.8);
  const next=[];
  for(const unit of candidates){
   let winner=null;
   for(const previous of states){
    if(unit<=previous.unit)continue;
    const duration=unit-previous.unit;
    // Timing evidence dominates. A small spelling cost favors ordinary
    // durations only when adjacent grid choices fit the performance similarly.
    const spelling=Number.isFinite(duration)&&duration>1&&duration%2===1?.08:0;
    const cost=previous.cost+(unit-observed)**2+spelling;
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
 const retained=notes.filter(e=>units.has(e));
 return {notes:retained,units,dropped:events.length-retained.length,adjusted:retained.filter(e=>units.get(e)!==Math.max(0,Math.round(toUnit(e.start)))).length};
}
