// A complete corrected transcript owns word and sentence order. Old cached CTC
// guesses may overlap or jump to a later chorus; never sort those into the text.
export function enforceLyricOrder(alignment){
 if(!alignment.text?.trim()||!alignment.lines?.length)return alignment;
 const next=structuredClone(alignment),lines=next.lines.filter(l=>!l.supplemental);
 next.characters=(next.characters||[]).filter(c=>c.evidence!=='uncovered-asr-word');next.lines=lines;
 const groups=lines.map(l=>next.characters.filter(c=>c.lineId===l.id));
 const reliableStart=cs=>{const good=cs.filter(c=>c.status==='acoustic'&&!c.timingUnresolved&&Number.isFinite(c.start));return good.length>=2?Math.min(...good.map(c=>c.start)):Infinity;};
 let end=0,rejected=0;
 for(let i=0;i<groups.length;i++){
  const cs=groups[i],timed=cs.filter(c=>!c.timingUnresolved&&Number.isFinite(c.start)&&Number.isFinite(c.end));
  if(!timed.length)continue;
  const future=Math.min(Infinity,...groups.slice(i+1).map(reliableStart).filter(t=>t>=end));
  const conflict=timed.some((c,j)=>c.start<end-.001||c.end>future+.001||c.end<=c.start||j&&c.start<timed[j-1].end-.001);
  if(conflict){
   for(const c of cs){if(c.placement?.manual)continue;c.observedStart??=c.start;c.observedEnd??=c.end;delete c.start;delete c.end;c.timingUnresolved=true;c.status='pending';c.evidence='transcript-order-conflict';}
   lines[i].timingUnresolved=true;lines[i].status='pending';rejected++;
  }else end=Math.max(end,...timed.map(c=>c.end));
 }
 if(rejected)next.warnings=[...(next.warnings||[]),`${rejected} 句旧歌词时间与正确文本顺序冲突，已保留待定位；请按正确歌词重新听音对齐。`];
 return next;
}
