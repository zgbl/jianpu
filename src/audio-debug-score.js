import {audioScoreTimeline} from './audio-score-cursor.js';
import {noteMidi} from './pitch.js';

// Use recording anchors, never bar number / nominal tempo as the time origin.
export function debugScoreTimeline(score,offset=0){
 if(!score?.measures?.length)return [];
 const byId=new Map(score.measures.flatMap((m,mi)=>m.notes.map(n=>[n.id,{note:n,measure:mi+1,measureId:m.id}])));
 const origin=score.transcription?.clipStart??offset;
 return audioScoreTimeline(score).flatMap(t=>{const found=byId.get(t.id);return found&&t.end>t.start?[{...found,id:t.id,start:t.start+origin,end:t.end+origin,estimated:!!t.timingSource,midi:found.note.degree?noteMidi(found.note,score):null,lyrics:(score.lyrics||[]).filter(l=>l.noteId===t.id).sort((a,b)=>(a.verse||1)-(b.verse||1))}]:[];});
}
export function drawDebugScore(p,score,segments,windowRange,{pad=76,rightPad=64,time=null,selectedId=null}={}){
 const {ctx,w,h}=p,[a,b]=windowRange,x=t=>pad+(t-a)/(b-a)*(w-pad-rightPad);
 const visible=segments.filter(s=>s.end>a&&s.start<b),active=segments.find(s=>time+1e-6>=s.start&&time<s.end-1e-6);
 p.c.dataset.activeNote=active?.id||'';
 p.c.dataset.noteCount=String(visible.length);
 if(!segments.length){ctx.fillStyle='#687c74';ctx.fillText('此版本没有带录音时间的乐谱；请先生成音频识别谱。',pad,65);return;}
 ctx.save();ctx.beginPath();ctx.rect(pad,20,w-pad-rightPad,h-44);ctx.clip();
 const continuations=new Set((score.spans||[]).filter(s=>s.type==='tie').map(s=>s.to));
 let lastMeasure=null;
 for(const s of visible){
  const n=s.note,left=x(s.start),end=x(s.end),width=end-left,center=left+Math.min(13,Math.max(5,width/2)),y=65;
  ctx.fillStyle=s.id===active?.id?'#78b59a66':s.id===selectedId?'#e6bb4644':n.reviewRequired?'#f3cc8b66':'#386e6010';ctx.fillRect(left,40,Math.max(1,width),62);
  ctx.strokeStyle=s.estimated?'#b79a64':'#b9cec3';ctx.setLineDash(s.estimated?[3,3]:[]);ctx.beginPath();ctx.moveTo(left,40);ctx.lineTo(left,102);ctx.stroke();ctx.setLineDash([]);
  if(lastMeasure!==s.measure){if(s===segments.find(t=>t.measure===s.measure)){ctx.strokeStyle='#627e70';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(left,45);ctx.lineTo(left,91);ctx.stroke();ctx.lineWidth=1;}ctx.fillStyle='#647a70';ctx.font='11px system-ui';ctx.fillText(`第 ${s.measure} 小节`,Math.max(pad,left)+3,31);lastMeasure=s.measure;}
  ctx.textAlign='center';ctx.fillStyle='#233d38';ctx.font='bold 23px system-ui';ctx.fillText(n.reviewReason==='unresolved-gap'?'?':continuations.has(n.id)?'−':String(n.degree),center,y);
  if(!continuations.has(n.id)){
   ctx.font='15px system-ui';if(n.accidental)ctx.fillText(n.accidental>0?'♯':'♭',center-13,y-2);
   for(let i=0;i<Math.abs(n.octave||0)&&n.degree;i++){ctx.beginPath();ctx.arc(center,(n.octave>0?y-29-i*6:y+23+i*6),1.6,0,Math.PI*2);ctx.fill();}
  }
  if(n.grace){ctx.font='11px system-ui';ctx.fillText(String(n.grace.degree),center-18,y-17);}
  if(n.dots){ctx.beginPath();ctx.arc(center+13,y-7,2,0,Math.PI*2);ctx.fill();}
  ctx.strokeStyle='#233d38';const beams=n.base>=8?Math.round(Math.log2(n.base/4)):0;
  for(let i=0;i<beams;i++){ctx.beginPath();ctx.moveTo(left+2,y+7+i*5);ctx.lineTo(Math.max(left+5,end-2),y+7+i*5);ctx.stroke();}
  if(n.base<=2){ctx.font='18px system-ui';for(let i=1;i<4/n.base;i++)ctx.fillText('−',left+width*i/(4/n.base),y);}
  ctx.font='12px system-ui';ctx.fillStyle='#536c60';s.lyrics.slice(0,2).forEach((l,i)=>ctx.fillText(l.text,center,122+i*18));ctx.textAlign='left';
 }
 // Tuplet groups and ties retain their musical meaning on a time-based layout.
 const groups=new Map();for(const s of segments){const t=s.note.tuplet;if(t){const list=groups.get(t.id)||[];list.push(s);groups.set(t.id,list);}}
 ctx.strokeStyle='#536c60';ctx.fillStyle='#536c60';ctx.font='11px system-ui';
 for(const list of groups.values()){const first=list[0],last=list.at(-1);if(last.end<a||first.start>b)continue;const l=x(first.start)+2,r=x(last.end)-2;ctx.beginPath();ctx.moveTo(l,43);ctx.lineTo(l,37);ctx.lineTo(r,37);ctx.lineTo(r,43);ctx.stroke();ctx.fillText(String(first.note.tuplet.actual),(l+r)/2,36);}
 const byId=new Map(segments.map(s=>[s.id,s]));for(const span of score.spans||[]){const from=byId.get(span.from),to=byId.get(span.to);if(!from||!to||to.end<a||from.start>b)continue;ctx.beginPath();ctx.moveTo(x(from.start)+9,46);ctx.quadraticCurveTo((x(from.start)+x(to.start))/2,29,x(to.start)+9,46);ctx.stroke();}
 ctx.restore();return active;
}
