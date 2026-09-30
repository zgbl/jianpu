import {ticks} from './model.js';
import {lyricWidth} from './lyrics.js';
export function layout(score,minimumVerses=0){
 const verseCount=Math.max(minimumVerses,...(score.lyrics||[]).map(l=>l.verse));
 const lyricWidths=new Map();for(const l of score.lyrics||[])lyricWidths.set(l.noteId,Math.max(lyricWidths.get(l.noteId)||0,lyricWidth(l.text)+16));
 const maxWidth=1120,left=38,right=38,rowGap=152+Math.max(0,verseCount-1)*26,baseline=score.endings?.length?144:112;let x=left,row=0;const measures=[],positions=new Map();
 for(let mi=0;mi<score.measures.length;mi++){
  const m=score.measures[mi];let time=0;
  const notes=m.notes.map(n=>{const duration=ticks(n),beats=duration/16;const lyric=lyricWidths.get(n.id)||0,leftInset=Math.max(0,(lyric-16)/2-16);const width=Math.max(leftInset+Math.max(39,Math.ceil(beats)*43)+(n.dots?13:0)+(n.grace?28:0),lyric);const result={n,start:time,duration,width,leftInset,beams:n.base===16?2:n.base===8?1:0};time+=duration;return result;});
  const startPad=m.repeatStart?37:22;const width=Math.max(155,startPad+notes.reduce((sum,n)=>sum+n.width,0)+27);
  if((m.breakBefore||x+width>maxWidth-right)&&x>left){row++;x=left;}
  const y=baseline+row*rowGap;let nx=x+startPad;
  for(const n of notes){n.x=nx+(n.n.grace?28:0)+n.leftInset;n.y=y;n.row=row;n.mi=mi;positions.set(n.n.id,n);nx+=n.width;}
  // Join only consecutive short notes in the same quarter-note beat.
  const groups=[];for(const n of notes){const g=groups.at(-1);if(n.beams&&g&&g.at(-1).beams&&!n.n.beamBreak&&Math.floor(g.at(-1).start/16)===Math.floor(n.start/16))g.push(n);else groups.push([n]);}
  measures.push({m,mi,x,y,row,width,notes,groups});x+=width;
 }
 const rowEnds=Array.from({length:row+1},(_,r)=>Math.max(...measures.filter(m=>m.row===r).map(m=>m.x+m.width-5)));
 return {width:Math.max(maxWidth,...rowEnds.map(x=>x+right),...(score.lyrics||[]).map(l=>{const p=positions.get(l.noteId);return p?p.x+(l.offsetX||0)+lyricWidth(l.text)/2+right:0;})),height:baseline+row*rowGap+80+verseCount*26,baseline,rowGap,rowEnds,measures,positions,verseCount};
}
export function beamSegments(group){const segments=[];for(let level=1;level<=2;level++){const members=group.filter(n=>n.beams>=level);for(let i=0;i<members.length;i++){const n=members[i],next=members[i+1],prev=members[i-1];const connectedNext=next&&group.indexOf(next)===group.indexOf(n)+1;const connectedPrev=prev&&group.indexOf(prev)===group.indexOf(n)-1;if(connectedNext)segments.push({level,x1:n.x-8,x2:next.x+8,y:n.y+9+(level-1)*6});else if(!connectedPrev)segments.push({level,x1:n.x-8,x2:n.x+8,y:n.y+9+(level-1)*6});}}return segments;}
