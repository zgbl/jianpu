import {validate,used} from './model.js';
import {shiftChordLabel} from './guitar-notation.js';
import {extractModelJson} from './model-score-import.js';

// Gemini returns complete replacements for selected measures. Keep every other
// measure, ID and annotation untouched so a local correction stays local.
export function applyMeasureReview(score,text,selected){
 let patch;try{patch=JSON.parse(extractModelJson(text));}catch(error){throw Error(`复核 JSON 格式错误：${error.message}`);}
 if(patch?.format!=='jianpu-measure-revision'||patch.version!==1||!Array.isArray(patch.updates)||!patch.updates.length)throw Error('需要 jianpu-measure-revision version 1，且 updates 不能为空');
 const allowed=new Set(selected.map(Number)),seen=new Set(),next=structuredClone(score),warnings=[],addedSpanIds=new Set();
 next.lyrics??=[];next.chords??=[];next.spans??=[];
 for(const item of patch.updates){
  const index=Number(item.measure)-1;if(!Number.isInteger(index)||index<0||!allowed.has(index+1)||seen.has(index)||!Array.isArray(item.notes))throw Error(`复核返回了未标记、重复或无效的小节：${item.measure}`);seen.add(index);
  const old=next.measures[index],oldIds=new Set(old.notes.map(n=>n.id));
  const notes=item.notes.map((n,i)=>{
   if(!n||!Number.isInteger(n.degree)||!Number.isInteger(n.base)||!Number.isInteger(n.octave)||!Number.isInteger(n.dots))throw Error(`第 ${index+1} 小节第 ${i+1} 个音符缺少必填字段`);
   const {lyrics, ...fields}=n;const clean={id:old.notes[i]?.id||crypto.randomUUID(),degree:n.degree,base:n.base,octave:n.octave,dots:n.dots};
   for(const key of ['accidental','grace','beamBreak','tuplet'])if(fields[key]!==undefined)clean[key]=fields[key];
   return clean;
  });
  const retainedIds=new Set(notes.map(n=>n.id));
  next.lyrics=next.lyrics.filter(l=>!oldIds.has(l.noteId)).map(l=>{if(l.endNoteId&&oldIds.has(l.endNoteId)&&!retainedIds.has(l.endNoteId)){const copy={...l};delete copy.endNoteId;return copy;}return l;});
  for(let i=0;i<notes.length;i++)for(const l of item.notes[i].lyrics||[]){if(!notes[i].degree)throw Error(`第 ${index+1} 小节休止符不能挂歌词`);next.lyrics.push({noteId:notes[i].id,verse:l.verse,text:l.text});}
  // The model replaces internal curves; keep valid curves crossing into an
  // untouched bar whenever their endpoint IDs still exist.
  next.spans=next.spans.filter(s=>!(oldIds.has(s.from)&&oldIds.has(s.to))&&(!oldIds.has(s.from)||retainedIds.has(s.from))&&(!oldIds.has(s.to)||retainedIds.has(s.to)));
  for(const span of item.spans||[]){const from=notes[span.from],to=notes[span.to];if(!from||!to)throw Error(`第 ${index+1} 小节连线索引无效`);const id=crypto.randomUUID();addedSpanIds.add(id);next.spans.push({id,type:span.type,from:from.id,to:to.id});}
  if(!Array.isArray(item.chords))throw Error(`第 ${index+1} 小节复核结果缺少 chords 数组`);
  next.chords=next.chords.filter(c=>c.measureId!==old.id);
  for(const label of item.chords){try{shiftChordLabel(label,0);}catch{throw Error(`第 ${index+1} 小节和弦无效：${label}`);}next.chords.push({measureId:old.id,label,source:'image'});}
  old.notes=notes;
  for(const key of ['repeatStart','repeatEnd','final'])if(item[key]!==undefined)old[key]=item[key];
  if(Math.abs(used(old)/(64/next.meter[1])-next.meter[0])>.01)warnings.push(`第 ${index+1} 小节拍数为 ${used(old)/(64/next.meter[1])}，与 ${next.meter.join('/')} 不符`);
 }
 if(next.measures.some(m=>used(m)>next.meter[0]*64/next.meter[1]+.01))next.manualBarlines=true;
 const ordered=next.measures.flatMap(m=>m.notes),indexById=new Map(ordered.map((n,i)=>[n.id,i]));let detached=0;
 next.spans=next.spans.filter(s=>{const a=indexById.get(s.from),b=indexById.get(s.to),from=ordered[a],to=ordered[b];const valid=a!==undefined&&b!==undefined&&a<b&&(s.type!=='tie'||(b===a+1&&from.degree&&from.degree===to.degree&&from.octave===to.octave&&(from.accidental||0)===(to.accidental||0)));if(!valid&&!addedSpanIds.has(s.id))detached++;return valid||addedSpanIds.has(s.id);});
 if(detached)warnings.push(`${detached} 条跨小节连线因端点变化而解除，请对照原图检查`);
 if(seen.size!==allowed.size)warnings.push(`Gemini 未返回标记的 ${[...allowed].filter(n=>!seen.has(n-1)).join('、')} 小节；这些小节保持原样`);
 next.visionReview={...(next.visionReview||{}),issues:[...(next.visionReview?.issues||[]).filter(i=>!seen.has(Number(i.measure)-1)),...(Array.isArray(patch.issues)?patch.issues:[])]};
 try{validate(next);}catch(error){throw Error(`复核结果校验失败，原谱未修改：${error.message}`);}
 return {score:next,warnings,updated:[...seen].map(i=>i+1),issues:patch.issues||[]};
}
