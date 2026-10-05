import {audioScoreTimeline} from './audio-score-cursor.js';
import {lyricWidth} from './lyrics.js';

// Presentation only: never replace an uncertain timestamp with invented timing.
export function timedLyricLayout(score,plan){
 const alignment=score.lyricAlignment;
 const chars=alignment?.displayMode==='characters'?alignment.characters:alignment?.pending||[];
 const segments=chars?.length?audioScoreTimeline(score,0,plan):[];
 const occupied=[],groups=new Map(),placed=[];
 const baseVerse=alignment?.verse||1;
 const overlaps=(a,b)=>a.row===b.row&&a.left<b.right+3&&a.right>b.left-3;
 for(const l of score.lyrics||[]){
  if(alignment?.displayMode==='characters'&&l.verse===baseVerse)continue;
  const p=plan.positions.get(l.noteId);if(!p)continue;
  const x=p.x+(l.offsetX||0),w=lyricWidth(l.text);
  occupied.push({row:p.row,left:x-w/2,right:x+w/2,verse:l.verse});
 }
 for(const c of chars||[]){
  if(!Number.isFinite(c.start)||!segments.length)continue;
  const seg=segments.find(s=>s.start<=c.start&&s.end>c.start)||
   segments.reduce((best,s)=>Math.min(Math.abs(c.start-s.start),Math.abs(c.start-s.end))<Math.min(Math.abs(c.start-best.start),Math.abs(c.start-best.end))?s:best);
  const p=c.placement?plan.positions.get(c.placement.noteId):null;
  const x=p?p.x+(c.placement.offsetX||0):seg.x+14+(seg.toX-seg.x)*Math.max(0,Math.min(1,(c.start-seg.start)/(seg.end-seg.start||1)));
  const item={c,x,row:p?.row??seg.row,baseline:p?.y??seg.y+45,left:x-10,right:x+10};
  const key=c.lineId||'timed';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);
 }
 for(const group of groups.values()){
  // A squeezed syllable in ONE lyric line is a spacing problem, not a verse.
  // Pack it horizontally; manual placements remain explicit user coordinates.
  for(const row of new Set(group.map(item=>item.row))){
   const items=group.filter(item=>item.row===row);
   for(let i=1;i<items.length;i++){
    const item=items[i],previous=items[i-1];
    if(!item.c.placement?.manual&&item.x<previous.x+23)item.x=previous.x+23;
   }
   const right=plan.rowEnds[row]-10,overflow=Math.max(0,items.at(-1).x-right);
   if(overflow&&!items.some(item=>item.c.placement?.manual)){
    const shift=Math.min(overflow,Math.max(0,items[0].x-48));
    for(const item of items)item.x-=shift;
   }
   for(const item of items){item.left=item.x-10;item.right=item.x+10;}
  }
  // Keep later conflicting lyric lines below earlier lines, regardless of text.
  let lane=baseVerse;
  while(group.some(item=>occupied.some(o=>o.verse===lane&&overlaps(item,o))))lane++;
  const within=[];
  for(const item of group){
   let verse=lane;
   while([...occupied,...within].some(o=>o.verse===verse&&overlaps(item,o)))verse++;
   const result={...item,verse,y:item.baseline+62+(verse-1)*26,collision:verse!==baseVerse};
   within.push(result);placed.push(result);
  }
  occupied.push(...within);
 }
 return {items:placed,verseCount:Math.max(baseVerse,...placed.map(p=>p.verse)),collisions:placed.filter(p=>p.collision).length};
}
