import {layout} from './layout.js';
import {audioScoreTimeline} from './audio-score-cursor.js';
import {lyricWidth} from './lyrics.js';
const letters=text=>Array.from(text).filter(c=>/[\p{L}\p{N}]/u.test(c));
export function manualLyrics(score,verse=1){
 if(!score)return [];
 const alignment=score.lyricAlignment;
 return (score.lyrics||[]).filter(l=>l.verse===verse&&(l.manual||alignment?.displayMode==='characters'&&alignment.source!=='word-timestamps'));
}
// Use the same engraved positions and recording clock as the playback cursor.
// These are human placement anchors, not model confidence or acoustic observations.
export function manualLyricAnchors(score,verse=1){
 if(!score?.measures)return [];
 const plan=layout(score),segments=audioScoreTimeline(score,0,plan);
 function timeAt(p,x){const row=segments.filter(s=>s.row===p.row);if(!row.length)return null;const seg=row.find(s=>x>=s.x+14&&x<s.toX+14)||row.reduce((a,b)=>Math.abs(x-b.x-14)<Math.abs(x-a.x-14)?b:a);return Math.max(0,seg.start+(seg.end-seg.start)*Math.max(0,Math.min(1,(x-seg.x-14)/(seg.toX-seg.x||1))));}
 const words=[];
 for(const l of manualLyrics(score,verse)){
  const p=plan.positions.get(l.noteId);if(!p)continue;let cursor=p.x+(l.offsetX||0)-lyricWidth(l.text)/2;const chars=[];
  Array.from(l.text).forEach((text,i)=>{const w=lyricWidth(text),x=cursor+w/2+(l.charOffsets?.[i]||0);cursor+=w;const start=timeAt(p,x);if(letters(text).length&&start!==null)chars.push({text,start,end:start+.08,manual:true,probability:1});});
  if(chars.length)words.push({text:chars.map(c=>c.text).join(''),start:chars[0].start,end:Math.max(chars.at(-1).end,chars[0].start+.08),manual:true,probability:1,characters:chars});
 }
 for(const c of score.lyricAlignment?.verse===verse?score.lyricAlignment.characters||[]:[]){if(!c.manual&&!c.placement?.manual)continue;const p=c.placement&&plan.positions.get(c.placement.noteId),start=p?timeAt(p,p.x+(c.placement.offsetX||0)):c.start;if(Number.isFinite(start)&&letters(c.text).length)words.push({text:c.text,start,end:start+Math.max(.08,(c.end-c.start)||.08),manual:true,probability:1});}
 return words.sort((a,b)=>a.start-b.start);
}
export function mergeManualAnchorWords(words,manual){return [...(words||[]).filter(w=>!manual.some(a=>w.start<a.end&&w.end>a.start)),...manual].sort((a,b)=>a.start-b.start);}
export function preserveManualLyrics(original,next,verse=1){
 const saved=manualLyrics(original,verse),edited=original.lyricAlignment?.verse===verse?(original.lyricAlignment.characters||[]).filter(c=>c.manual||c.placement?.manual):[];if(!saved.length&&!edited.length)return next;
 const anchors=manualLyricAnchors(original,verse),chars=next.lyricAlignment?.verse===verse?next.lyricAlignment.characters:[];
 const removed=new Set();
 for(const a of anchors){const text=letters(a.text).join('');let best=null;for(let i=0;i<chars.length;i++){const group=chars.slice(i,i+text.length);if(group.map(c=>c.text).join('')!==text)continue;const distance=Math.abs(group[0].start-a.start);if(distance<5&&(!best||distance<best.distance))best={group,distance};}if(best)best.group.forEach(c=>removed.add(c.id));}
 if(next.lyricAlignment?.verse===verse)next.lyricAlignment.characters=[...chars.filter(c=>!removed.has(c.id)||edited.some(e=>e.id===c.id)).map(c=>structuredClone(edited.find(e=>e.id===c.id)||c)),...structuredClone(edited.filter(e=>!chars.some(c=>c.id===e.id)))];
 const keys=new Set(saved.map(l=>l.noteId+':'+l.verse));next.lyrics=[...(next.lyrics||[]).filter(l=>!keys.has(l.noteId+':'+l.verse)),...structuredClone(saved).map(l=>({...l,manual:true}))];return next;
}
