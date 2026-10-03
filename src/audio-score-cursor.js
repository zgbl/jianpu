import {layout} from './layout.js';

// Source seconds stay independent of edited tempo. A quantized source event may
// span several tied glyphs; divide its real duration by their written durations.
export function audioScoreTimeline(score,minimumVerses=0){
 if(!score)return [];
 const plan=layout(score,minimumVerses),notes=plan.measures.flatMap(m=>m.notes),segments=[];
 for(let i=0;i<notes.length;){
  const first=notes[i];
  if(Number.isFinite(first.n.gridTimeStart)&&Number.isFinite(first.n.gridTimeEnd)){const following=notes[i+1],m=plan.measures[first.mi];segments.push({id:first.n.id,start:first.n.gridTimeStart,end:first.n.gridTimeEnd,x:first.x-14,toX:following?.row===first.row?following.x-14:m.x+m.width-7,y:first.y-45,bottom:first.y+40+plan.verseCount*26,row:first.row});i++;continue;}
  const start=first.n.sourceTime;
  if(!Number.isFinite(start)){i++;continue;}
  let j=i+1;
  while(j<notes.length&&notes[j].n.sourceTime===start&&notes[j].n.sourceEnd===first.n.sourceEnd)j++;
  const next=notes.slice(j).find(p=>Number.isFinite(p.n.sourceTime)&&p.n.sourceTime>start);
  const end=Number.isFinite(first.n.sourceEnd)?first.n.sourceEnd:Math.min(next?.n.sourceTime??Infinity,start+notes.slice(i,j).reduce((s,p)=>s+p.duration/16,0)*60/(score.transcription?.bpm||score.tempo||120));
  const total=notes.slice(i,j).reduce((s,p)=>s+p.duration,0);let elapsed=0;
  for(let k=i;k<j;k++){
   const p=notes[k],a=start+(end-start)*elapsed/total;elapsed+=p.duration;
   const b=start+(end-start)*elapsed/total,following=notes[k+1],measure=plan.measures[p.mi];
   segments.push({id:p.n.id,start:a,end:b,x:p.x-14,toX:following?.row===p.row?following.x-14:measure.x+measure.width-7,y:p.y-45,bottom:p.y+40+plan.verseCount*26,row:p.row});
  }
  i=j;
 }
 // Silence has its own position: distribute the actual gap over written rests.
 const sounding=segments.slice();
 for(let i=0;i<sounding.length-1;i++){
  const a=sounding[i],b=sounding[i+1];if(b.start<=a.end)continue;
  const from=notes.findIndex(p=>p.n.id===a.id),to=notes.findIndex(p=>p.n.id===b.id),rests=notes.slice(from+1,to);
  if(!rests.length||rests.some(p=>p.n.degree!==0))continue;
  const total=rests.reduce((s,p)=>s+p.duration,0);let elapsed=0;
  for(const p of rests){const start=a.end+(b.start-a.end)*elapsed/total;elapsed+=p.duration;const following=notes[notes.indexOf(p)+1],m=plan.measures[p.mi];segments.push({id:p.n.id,start,end:a.end+(b.start-a.end)*elapsed/total,x:p.x-14,toX:following?.row===p.row?following.x-14:m.x+m.width-7,y:p.y-45,bottom:p.y+40+plan.verseCount*26,row:p.row});}
 }
 return segments.sort((a,b)=>a.start-b.start);
}
// MIDI follows written durations, never the recording source timestamps.
export function midiScoreTimeline(score,timeline,minimumVerses=0){
 const plan=layout(score,minimumVerses),notes=plan.measures.flatMap(m=>m.notes),byId=new Map(notes.map((p,i)=>[p.n.id,{p,i}]));
 return timeline.marks.flatMap(mark=>{const found=byId.get(mark.id);if(!found)return [];const {p,i}=found,m=plan.measures[p.mi],following=notes[i+1];return [{id:mark.id,start:mark.start,end:mark.end,x:p.x-14,toX:following?.row===p.row?following.x-14:m.x+m.width-7,y:p.y-45,bottom:p.y+40+plan.verseCount*26,row:p.row}];});
}
export function audioScorePosition(segments,time){
 const p=segments.find(s=>time>=s.start&&time<s.end);
 if(!p)return null;
 return {...p,x:p.x+(p.toX-p.x)*Math.max(0,Math.min(1,(time-p.start)/(p.end-p.start)))};
}
export function createAudioScoreCursor(container,getScore,{minimumVerses=()=>0}={}){
 let segments=[],player=null,offset=()=>0,frame=0,lastRow=null,midi=null;
 const ns='http://www.w3.org/2000/svg';
 function paint(){
  const svg=container.querySelector('svg');if(!svg)return;
  let head=svg.querySelector('.audio-score-playhead');
  const p=player?audioScorePosition(segments,player.currentTime-offset()):null;
  if(!p){head?.remove();return;}
  if(!head){head=document.createElementNS(ns,'g');head.classList.add('audio-score-playhead');head.setAttribute('pointer-events','none');head.setAttribute('aria-hidden','true');const line=document.createElementNS(ns,'line');line.style.stroke='#c45d32';line.style.strokeWidth='2';line.setAttribute('vector-effect','non-scaling-stroke');const cap=document.createElementNS(ns,'path');cap.style.fill='#c45d32';cap.style.stroke='none';head.append(line,cap);svg.append(head);}
  head.dataset.note=p.id;head.dataset.time=String(player.currentTime-offset());head.setAttribute('transform',`translate(${p.x} 0)`);
  const line=head.firstChild;line.setAttribute('x1','0');line.setAttribute('x2','0');line.setAttribute('y1',p.y);line.setAttribute('y2',p.bottom);head.lastChild.setAttribute('d',`M -5 ${p.y-6} L 5 ${p.y-6} L 0 ${p.y+1} Z`);
  if(!player.paused&&lastRow!==p.row){const group=svg.querySelector(`[data-note="${CSS.escape(p.id)}"]`),rect=group?.getBoundingClientRect();if(rect&&(rect.top<0||rect.bottom>innerHeight))group.scrollIntoView({block:'center',inline:'nearest',behavior:'smooth'});lastRow=p.row;}
 }
 function tick(){paint();if(player&&!player.paused&&!player.ended)frame=requestAnimationFrame(tick);else frame=0;}
 function follow(media,getOffset=()=>0){midi=null;segments=audioScoreTimeline(getScore(),minimumVerses());player=media;offset=getOffset;cancelAnimationFrame(frame);frame=0;tick();}
 function bind(media,getOffset=()=>0){for(const event of ['play','seeking','seeked','timeupdate','pause','ended'])media.addEventListener(event,()=>{if(event==='play'||event==='seeking'||player===media)follow(media,getOffset);});}
 function refresh(){segments=midi?midiScoreTimeline(getScore(),midi,minimumVerses()):audioScoreTimeline(getScore(),minimumVerses());paint();}
 function clear(){cancelAnimationFrame(frame);frame=0;player=null;midi=null;lastRow=null;container.querySelector('.audio-score-playhead')?.remove();}
 function showMidi(timeline,time,state){cancelAnimationFrame(frame);frame=0;if(midi!==timeline){segments=midiScoreTimeline(getScore(),timeline,minimumVerses());lastRow=null;}midi=timeline;player={currentTime:time,paused:state!=='playing',ended:false};offset=()=>0;paint();}
 function clearMidi(){if(midi){clear();refresh();}}
 refresh();return {bind,follow,refresh,clear,showMidi,clearMidi,noteTime:id=>segments.find(s=>s.id===id)?.start};
}
