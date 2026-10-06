// Correct lyrics replace covered phrases; they must not erase other sung passages.
const websiteOrTag=text=>/(music\s*163\s*[.\s]*com|百度百科|https?:\/\/|www\.|zither\s*harp)/i.test(text);
export function preserveUncoveredASRLyrics(alignment,words){
 if(!words?.length)return alignment;
 const next=structuredClone(alignment),base=(next.characters||[]).filter(c=>c.evidence!=='uncovered-asr-word');
 const baseLines=(next.lines||[]).filter(l=>!l.supplemental);
 const ranges=baseLines.flatMap(line=>{
  const cs=base.filter(c=>c.lineId===line.id&&Number.isFinite(c.start)&&Number.isFinite(c.end));
  if(!cs.length)return [];
  const window=(next.searchWindows||[]).find(w=>w.lines?.includes(Number(line.id.replace('line-',''))+1));
  return [window&&window.end>window.start&&window.matched!==false?[window.start,window.end]:[Math.min(...cs.map(c=>c.start)),Math.max(...cs.map(c=>c.end))]];
 });
 const groups=[];let active=null;
 for(let wi=0;wi<words.length;wi++){
  const word=words[wi];if(!Number.isFinite(word.start)||!(word.end>word.start)||websiteOrTag(word.text)){active=null;continue;}
  const letters=Array.from(String(word.text).normalize('NFKC')).filter(c=>/[\p{L}\p{N}]/u.test(c));
  for(let i=0;i<letters.length;i++){
   const start=word.start+i*(word.end-word.start)/letters.length,end=word.start+(i+1)*(word.end-word.start)/letters.length,middle=(start+end)/2;
   if(ranges.some(([a,b])=>middle>=a&&middle<=b)){active=null;continue;}
   if(!active||start-active.at(-1).end>2||active.length>=20){active=[];groups.push(active);}
   active.push({id:`asr-extra-${wi}-${i}`,text:letters[i],start,end,status:'estimated',timingEstimated:true,evidence:'uncovered-asr-word',probability:word.probability});
  }
 }
 // Single edge syllables are often boundary differences, not another verse.
 const extras=groups.filter(g=>g.length>=3&&g.reduce((sum,c)=>sum+(c.probability??1),0)/g.length>=.35&&g.some(c=>/[\u4e00-\u9fff]/.test(c.text)));
 next.characters=base;next.lines=baseLines;
 for(const group of extras){const id=`asr-extra-line-${group[0].id}`;next.lines.push({id,text:group.map(c=>c.text).join(''),status:'estimated',timingEstimated:true,supplemental:true});next.characters.push(...group.map(c=>({...c,lineId:id})));}
 if(extras.length)next.warnings=[...(next.warnings||[]).filter(w=>!w.includes('原识别补回')),`原识别补回 ${extras.length} 段未被正确歌词覆盖的演唱文字（棕色），请核对重复段和文字。`];
 return next;
}
