// Recover legacy collapsed estimates from the separately saved ASR transcript.
// This uses text/timestamps, not note counts; multiple syllables may share a note.
const cache=new WeakMap();
const clean=text=>String(text).normalize('NFKC').replace(/guitar/ig,'吉他').replace(/[^\p{L}\p{N}]/gu,'');
const metadata=text=>/(music\s*163\s*[.\s]*com|百度百科|https?:\/\/|www\.)/i.test(text);
function similarity(a,b){
 let previous=Array(b.length+1).fill(0),continuous=previous.slice(),run=0;
 for(const char of a){const row=[0],next=[0];for(let j=1;j<=b.length;j++){row[j]=char===b[j-1]?previous[j-1]+1:Math.max(previous[j],row[j-1]);next[j]=char===b[j-1]?continuous[j-1]+1:0;run=Math.max(run,next[j]);}previous=row;continuous=next;}
 return run>=2?2*previous[b.length]/(a.length+b.length):0;
}
export function repairCollapsedLyricTiming(alignment,words){
 const saved=cache.get(alignment);if(saved?.words===words)return saved.result;
 const original=alignment.characters||[],lines=alignment.lines||[];
 const bad=new Set(lines.filter(l=>{const cs=original.filter(c=>c.lineId===l.id);return cs.length>=4&&cs.every(c=>c.status==='estimated')&&cs.length/Math.max(.01,Math.max(...cs.map(c=>c.end))-Math.min(...cs.map(c=>c.start)))>10;}).map(l=>l.id));
 if(!bad.size)return alignment;
 const source=[];
 for(const w of words||[]){if(!Number.isFinite(w.start)||!(w.end>w.start))continue;const text=Array.from(clean(w.text));text.forEach((c,i)=>source.push({text:c,start:w.start+i*(w.end-w.start)/text.length,end:w.start+(i+1)*(w.end-w.start)/text.length}));}
 if(!source.length)return alignment;
 const next=structuredClone(alignment),used=new Set(),matches=new Map();let previousEnd=0;
 for(const line of lines){
  if(metadata(line.text))continue;
  const target=Array.from(clean(line.text)),options=[];
  for(let at=0;at<source.length;at++)for(let length=Math.max(2,Math.floor(target.length*.7));length<=Math.min(source.length-at,Math.floor(target.length*1.3)+2);length++){
   if(source.slice(at,at+length).some((_,i)=>used.has(at+i)))continue;
   const score=similarity(target,source.slice(at,at+length).map(c=>c.text));if(score>=.55)options.push({at,length,score});
  }
  if(!options.length)continue;
  const best=Math.max(...options.map(o=>o.score));let eligible=options.filter(o=>o.score>=Math.max(.55,best-.2));
  const forward=eligible.filter(o=>source[o.at].start>=previousEnd-.05);if(forward.length)eligible=forward;
  const first=Math.min(...eligible.map(o=>o.at));eligible=eligible.filter(o=>o.at<=first+Math.max(2,Math.floor(target.length/2))).sort((a,b)=>b.score-a.score||a.length-b.length||a.at-b.at);
  const match=eligible[0],start=source[match.at].start,end=source[match.at+match.length-1].end;
  for(let i=0;i<match.length;i++)used.add(match.at+i);previousEnd=end;matches.set(line.id,{start,end});
 }
 let repaired=0;
 for(const line of next.lines){
  if(metadata(line.text)){next.characters=next.characters.filter(c=>c.lineId!==line.id);line.excluded=true;continue;}
  if(!bad.has(line.id))continue;
  const match=matches.get(line.id);if(!match)continue;
  const cs=next.characters.filter(c=>c.lineId===line.id),step=(match.end-match.start)/cs.length;
  cs.forEach((c,i)=>{if(c.placement?.manual)return;c.observedStart??=c.start;c.observedEnd??=c.end;c.start=match.start+i*step;c.end=c.start+step*.8;c.evidence='phrase-asr-estimate';c.timingEstimated=true;});
  line.timingEstimated=true;repaired++;
 }
 next.lines=next.lines.filter(l=>!l.excluded);
 if(repaired)next.warnings=[...(next.warnings||[]),`${repaired} 句过度压缩的旧估算已按录音识别文字重新定位，仍需试听校对。`];
 cache.set(alignment,{words,result:next});
 return next;
}
