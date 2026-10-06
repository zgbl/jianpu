import {audioScoreTimeline} from './audio-score-cursor.js';

const CHARACTER_GAP=23;

// Fit a sequence into ONE measure. This moves display coordinates only, never
// timestamps, note bindings or verses. Explicit manual coordinates remain fixed.
function packMeasure(items,measure){
 const left=measure.x+12,right=measure.x+measure.width-18;
 let previous=null,begin=0;
 for(let end=0;end<=items.length;end++){
  const next=items[end];if(next&&!next.c.placement?.manual)continue;
  const group=items.slice(begin,end),low=Math.max(left,previous?previous.x+CHARACTER_GAP:left),high=Math.min(right,next?next.x-CHARACTER_GAP:right);
  const a=Math.min(right,Math.max(left,low)),b=Math.max(a,Math.min(right,high));
  const gap=group.length>1?Math.min(CHARACTER_GAP,(b-a)/(group.length-1)):0;
  let cursor=a-gap;
  for(const item of group){item.x=Math.max(cursor+gap,Math.min(b,item.x));cursor=item.x;}
  cursor=b+gap;
  for(let i=group.length-1;i>=0;i--){group[i].x=Math.min(group[i].x,cursor-gap);cursor=group[i].x;}
  previous=next;begin=end+1;
 }
}

// A text lineId identifies a sentence, NOT a repeated verse. Crowding must never
// create another lyric row. Only the explicitly selected verse controls y.
export function timedLyricLayout(score,plan){
 const alignment=score.lyricAlignment;
 const chars=alignment?.displayMode==='characters'?alignment.characters:alignment?.pending||[];
 const segments=chars?.length?audioScoreTimeline(score,0,plan):[];
 const groups=new Map(),placed=[],minimumMeasureWidths=new Map();
 const verse=alignment?.verse||1;
 for(const c of chars||[]){
  if(!Number.isFinite(c.start)||!segments.length)continue;
  const seg=segments.find(s=>s.start<=c.start&&s.end>c.start)||
   segments.reduce((best,s)=>Math.min(Math.abs(c.start-s.start),Math.abs(c.start-s.end))<Math.min(Math.abs(c.start-best.start),Math.abs(c.start-best.end))?s:best);
  const p=c.placement?plan.positions.get(c.placement.noteId):null,position=p||plan.positions.get(seg.id),measure=plan.measures[position.mi];
  const x=p?p.x+(c.placement.offsetX||0):seg.x+14+(seg.toX-seg.x)*Math.max(0,Math.min(1,(c.start-seg.start)/(seg.end-seg.start||1)));
  const item={c,x,preferredX:x,mi:position.mi,row:position.row,baseline:position.y,verse,y:position.y+62+(verse-1)*26,collision:false};
  placed.push(item);if(!groups.has(measure.m.id))groups.set(measure.m.id,[]);groups.get(measure.m.id).push(item);
 }
 for(const [id,group] of groups){
  group.sort((a,b)=>a.c.start-b.c.start);
  // Widen dense bars instead of pushing words over a barline or below the line.
  minimumMeasureWidths.set(id,30+CHARACTER_GAP*Math.max(0,group.length-1));
  packMeasure(group,plan.measures[group[0].mi]);
  for(const item of group){item.left=item.x-10;item.right=item.x+10;item.spacingAdjusted=!item.c.placement?.manual&&Math.abs(item.x-item.preferredX)>.1;}
 }
 return {items:placed,verseCount:verse,collisions:0,minimumMeasureWidths,spacingAdjustments:placed.filter(p=>p.spacingAdjusted).length};
}
