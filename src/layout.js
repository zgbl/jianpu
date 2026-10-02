import {ticks} from './model.js';
import {lyricWidth} from './lyrics.js';
export function layout(score,minimumVerses=0){
 const verseCount=Math.max(minimumVerses,score.lyricAlignment?.verse||0,...(score.lyrics||[]).map(l=>l.verse));
 const lyricWidths=new Map();for(const l of score.lyrics||[])lyricWidths.set(l.noteId,Math.max(lyricWidths.get(l.noteId)||0,lyricWidth(l.text)+16));
 const maxWidth=1120,left=38,right=38,rowGap=(score.chords?.length?180:156)+Math.max(0,verseCount-1)*26,baseline=score.endings?.length?144:score.chords?.length?148:128;
 const measures=[],positions=new Map();let row=0;
 const prepared=score.measures.map((m,mi)=>{
  let time=0;const notes=m.notes.map(n=>{
   const duration=ticks(n),beats=duration/16,lyric=lyricWidths.get(n.id)||0,leftInset=Math.max(0,(lyric-16)/2-12);
   const width=Math.max(leftInset+Math.max(n.accidental?42:32,beats*36)+(n.dots?12:0)+(n.grace?22:0),lyric);
   const result={n,start:time,duration,width,leftInset,beams:n.base===16?2:n.base===8?1:0};time+=duration;return result;
  });const startPad=m.repeatStart?29:16;return {m,mi,notes,startPad,width:Math.max(132,startPad+notes.reduce((sum,n)=>sum+n.width,0)+18)};
 });
 for(let offset=0;offset<prepared.length;){
  let count=Math.min(4,prepared.length-offset);
  const explicit=prepared.slice(offset+1,offset+count).findIndex(p=>p.m.breakBefore);
  if(explicit>=0)count=explicit+1;
  if(count===4&&prepared.slice(offset,offset+count).reduce((sum,p)=>sum+p.width,0)>1180)count=3;
  const group=prepared.slice(offset,offset+count),total=group.reduce((sum,p)=>sum+p.width,0),scale=Math.max(1,(maxWidth-left-right)/total);let x=left;
  for(const p of group){const {m,mi,notes,startPad}=p,width=p.width*scale,y=baseline+row*rowGap;let nx=x+startPad*scale;
   for(const n of notes){n.width*=scale;n.x=nx+(n.n.grace?22:0)+n.leftInset;n.y=y;n.row=row;n.mi=mi;positions.set(n.n.id,n);nx+=n.width;}
   const groups=[];for(const n of notes){const g=groups.at(-1);if(n.beams&&g&&g.at(-1).beams&&!n.n.beamBreak&&Math.floor(g.at(-1).start/16)===Math.floor(n.start/16))g.push(n);else groups.push([n]);}
   measures.push({m,mi,x,y,row,width,notes,groups});x+=width;
  }offset+=count;row++;
 }
 row=Math.max(0,row-1);
 const rowEnds=Array.from({length:row+1},(_,r)=>Math.max(...measures.filter(m=>m.row===r).map(m=>m.x+m.width-5)));
 return {width:Math.max(maxWidth,...rowEnds.map(x=>x+right),...(score.lyrics||[]).map(l=>{const p=positions.get(l.noteId);return p?p.x+(l.offsetX||0)+lyricWidth(l.text)/2+right:0;})),height:baseline+row*rowGap+80+verseCount*26,baseline,rowGap,rowEnds,measures,positions,verseCount};
}
export function beamSegments(group){const segments=[];for(let level=1;level<=2;level++){const members=group.filter(n=>n.beams>=level);for(let i=0;i<members.length;i++){const n=members[i],next=members[i+1],prev=members[i-1];const connectedNext=next&&group.indexOf(next)===group.indexOf(n)+1;const connectedPrev=prev&&group.indexOf(prev)===group.indexOf(n)-1;if(connectedNext)segments.push({level,x1:n.x-8,x2:next.x+8,y:n.y+9+(level-1)*6});else if(!connectedPrev)segments.push({level,x1:n.x-8,x2:n.x+8,y:n.y+9+(level-1)*6});}}return segments;}
