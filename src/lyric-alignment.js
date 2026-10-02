import {validate} from './model.js';
const characters=text=>Array.from(text.normalize('NFKC')).filter(c=>/[\p{L}\p{N}]/u.test(c));
export function timedCharacters(words){
 const result=[];
 for(const word of words||[]){if(!Number.isFinite(word.start)||!Number.isFinite(word.end)||word.end<=word.start)continue;const chars=characters(word.text||''),step=(word.end-word.start)/chars.length;chars.forEach((text,i)=>result.push({text,start:word.start+i*step,end:word.start+(i+1)*step,probability:word.probability}));}
 return result;
}
export function correctTimedText(text,words){
 const source=timedCharacters(words),target=characters(text),n=source.length,m=target.length;
 if(!n||!m)throw Error('需要识别时间戳和当前片段的歌词');if(n>2000||m>3000||m>n*2+20)throw Error('请只粘贴当前识别片段的歌词；整首歌词可使用带时间的 LRC');
 const width=m+1,directions=new Uint8Array((n+1)*width);let previous=Float64Array.from({length:width},(_,i)=>i);
 for(let i=1;i<=n;i++){const row=new Float64Array(width);row[0]=i;for(let j=1;j<=m;j++){const diagonal=previous[j-1]+(source[i-1].text===target[j-1]?0:1),remove=previous[j]+1,insert=row[j-1]+1;row[j]=Math.min(diagonal,remove,insert);directions[i*width+j]=row[j]===diagonal?1:row[j]===remove?2:3;}previous=row;}
 if(previous[m]/Math.max(n,m)>.6)throw Error('粘贴文字与本片段识别内容差异太大，无法可靠匹配。请缩小片段，或使用 LRC / 按音符初排');
 const aligned=Array(m).fill(null);let i=n,j=m;
 while(i&&j){const d=directions[i*width+j];if(d===1){aligned[j-1]={...source[i-1],text:target[j-1]};i--;j--;}else if(d===2)i--;else j--;}
 for(let at=0;at<m;at++)if(!aligned[at]){let a=at-1,b=at+1;while(a>=0&&!aligned[a])a--;while(b<m&&!aligned[b])b++;const start=a>=0?aligned[a].end:source[0].start,end=b<m?aligned[b].start:source.at(-1).end,step=Math.max(.02,(end-start)/(b-a-1));aligned[at]={text:target[at],start:start+step*(at-a-1),end:start+step*(at-a),estimated:true};}
 return aligned;
}
export function parseLRC(text,{clipStart=0,duration=600}={}){
 const lines=[];
 for(const line of text.split(/\r?\n/)){const matches=[...line.matchAll(/\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/g)],content=line.replace(/\[[^\]]*\]/g,'').trim();for(const match of matches)if(content)lines.push({start:Number(match[1])*60+Number(match[2])-clipStart,text:content});}
 lines.sort((a,b)=>a.start-b.start);if(!lines.length)throw Error('没有找到 [分:秒] 格式的 LRC 时间标签');
 const words=lines.map((line,i)=>({...line,end:lines[i+1]?.start??duration})).filter(line=>line.end>0&&line.start<duration&&line.end>line.start);
 return timedCharacters(words).filter(c=>(c.start+c.end)/2>=0&&(c.start+c.end)/2<duration);
}
function candidates(score){const ties=new Set(score.spans.filter(s=>s.type==='tie').map(s=>s.to));return score.measures.flatMap(m=>m.notes).filter(n=>n.degree&&!ties.has(n.id));}
export function applyTimedLyrics(score,chars,{verse=1,maxGap=1.2}={}){
 const next=structuredClone(score),notes=candidates(next).filter(n=>Number.isFinite(n.sourceTime)),all=next.measures.flatMap(m=>m.notes),buckets=new Map(),unplaced=[],accepted=[];
 if(!notes.length)throw Error('当前谱没有音频来源时间，不能按时间自动排词');
 for(const char of chars){const time=(char.start+char.end)/2;let best=null,distance=Infinity;
  for(let i=0;i<notes.length;i++){const n=notes[i],end=Number.isFinite(n.sourceEnd)?n.sourceEnd:notes[i+1]?.sourceTime??n.sourceTime+1,start=n.sourceTime,gap=time<start?start-time:time>end?time-end:0;if(gap<distance){distance=gap;best=n;}}
  if(!best||distance>maxGap){unplaced.push(char.text);continue;}accepted.push(char);const old=buckets.get(best.id)||{noteId:best.id,verse,text:''};old.text+=char.text;buckets.set(best.id,old);
 }
 for(const lyric of buckets.values()){if(lyric.text.length>80)throw Error('识别时间过于集中，单音歌词超过 80 字，请缩短片段');}
 // Tie continuations belong to the same sounding note and may carry a melisma.
 for(const lyric of buckets.values()){let id=lyric.noteId;while(next.spans.some(s=>s.type==='tie'&&s.from===id))id=next.spans.find(s=>s.type==='tie'&&s.from===id).to;if(id!==lyric.noteId&&all.some(n=>n.id===id))lyric.endNoteId=id;}
 next.lyrics=[...(next.lyrics||[]).filter(l=>l.verse!==verse),...buckets.values()];
 next.lyricAlignment={version:1,verse,displayMode:'characters',source:'word-timestamps',characters:accepted.map((c,i)=>({...c,id:`timed-${verse}-${i}`,status:'estimated',evidence:'word-time-estimate'})),pending:[]};
 return {score:validate(next),count:chars.length-unplaced.length,unplaced,warnings:['逐字时间由词级/句级时间估计；每个字独立显示和拖动。']};
}
export function applySequentialLyrics(score,text,{verse=1,start=0}={}){
 const next=structuredClone(score),notes=candidates(next).slice(start),chars=characters(text),buckets=new Map();if(!notes.length||!chars.length)throw Error('请输入歌词并选择有音高的起点');
 chars.forEach((text,i)=>{const index=chars.length<=notes.length?i:Math.floor(i*notes.length/chars.length),n=notes[index],old=buckets.get(n.id)||{noteId:n.id,verse,text:''};old.text+=text;buckets.set(n.id,old);});
 if([...buckets.values()].some(l=>l.text.length>80))throw Error('歌词太多，请分段输入');next.lyrics=[...(next.lyrics||[]).filter(l=>l.verse!==verse),...buckets.values()];
 return {score:validate(next),count:chars.length,unplaced:[],warnings:['没有歌唱时间信息，仅按音符顺序初排；位置必须手动核对。']};
}

// Local sequence alignment locates a sung excerpt inside complete lyrics. Only
// exact continuous matches are timing anchors; substitutions never gain timing.
export function alignLyricsByAnchors(text,words,{score=null}={}){
 const source=timedCharacters(words),target=characters(text),n=source.length,m=target.length;
 if(!n||!m)throw Error('请先识别歌词取得时间线，再粘贴正确歌词');
 if(n>2000||m>10000||n*m>8000000)throw Error('歌词过长，请分段校准');
 const width=m+1,directions=new Uint8Array((n+1)*width);let previous=new Float32Array(width),best=0,bi=0,bj=0;
 for(let i=1;i<=n;i++){
  const row=new Float32Array(width);
  for(let j=1;j<=m;j++){
   const exact=source[i-1].text===target[j-1],diagonal=previous[j-1]+(exact?2:-1.1),remove=previous[j]-.8,insert=row[j-1]-.8;
   const value=Math.max(0,diagonal,remove,insert);row[j]=value;
   directions[i*width+j]=value<=0?0:value===diagonal?1:value===remove?2:3;
   if(value>best){best=value;bi=i;bj=j;}
  }
  previous=row;
 }
 let i=bi,j=bj;const pairs=[];
 while(i&&j){const d=directions[i*width+j];if(!d)break;if(d===1){if(source[i-1].text===target[j-1])pairs.push({source:i-1,target:j-1});i--;j--;}else if(d===2)i--;else j--;}
 pairs.reverse();const runs=[];
 for(const p of pairs){const last=runs.at(-1),end=last?.at(-1);if(end&&p.source===end.source+1&&p.target===end.target+1)last.push(p);else runs.push([p]);}
 const trusted=runs.filter(run=>run.length>=2);
 const anchorPairs=trusted.flat();
 if(anchorPairs.length<4||best<5)throw Error('找不到足够的连续匹配词句，尚不能按锚点校准；请检查歌词版本或先识别更长片段');
 const anchors=trusted.map(run=>({text:run.map(p=>target[p.target]).join(''),targetStart:run[0].target,targetEnd:run.at(-1).target+1,start:source[run[0].source].start,end:source[run.at(-1).source].end}));
 // Include incomplete edge words in the matched lyric lines, not unrelated
 // verses outside the recognized excerpt. Long unsupported edges stay pending.
 let at=0;const lines=String(text).split(/\r?\n/).map(line=>{const length=characters(line).length,r={start:at,end:at+length};at+=length;return r;}).filter(l=>l.end>l.start);
 const first=anchorPairs[0].target,last=anchorPairs.at(-1).target;
 const leftLine=lines.find(l=>l.start<=first&&l.end>first),rightLine=lines.find(l=>l.start<=last&&l.end>last);
 const begin=first-(leftLine?.start??first)<=8?(leftLine?.start??first):first;
 const finish=(rightLine?.end??last+1)-last-1<=8?(rightLine?.end??last+1):last+1;
 const result=new Map(anchorPairs.map(p=>[p.target,{...source[p.source],text:target[p.target],targetIndex:p.target,anchor:true}]));
 const noteTimes=score?candidates(score).filter(n=>Number.isFinite(n.sourceTime)).map(n=>({start:n.sourceTime,end:n.sourceEnd??n.sourceTime+.2})):[];
 function fill(from,to,start,end){
  if(to<=from)return;
  if(end<=start){for(let k=from;k<to;k++)result.set(k,{text:target[k],targetIndex:k,unresolved:true});return;}
  // Distribute missing words over sounding melody, keeping instrumental gaps
  // out of the allocation. Multiple characters may share a single note.
  let intervals=noteTimes.map(n=>[Math.max(start,n.start),Math.min(end,n.end)]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
  const merged=[];for(const interval of intervals){const prior=merged.at(-1);if(prior&&interval[0]<=prior[1])prior[1]=Math.max(prior[1],interval[1]);else merged.push(interval.slice());}
  intervals=merged.length?merged:[[start,end]];const duration=intervals.reduce((s,[a,b])=>s+b-a,0);
  function clock(position){let remaining=position*duration;for(const [a,b] of intervals){if(remaining<=b-a)return a+remaining;remaining-=b-a;}return intervals.at(-1)[1];}
  for(let k=from;k<to;k++){const midpoint=clock((k-from+.5)/(to-from)),half=Math.min(.02,(end-start)/(to-from)/4);result.set(k,{text:target[k],start:midpoint-half,end:midpoint+half,targetIndex:k,estimated:true});}
 }
 for(let k=0;k<anchorPairs.length-1;k++){const a=anchorPairs[k],b=anchorPairs[k+1],left=source[a.source],right=source[b.source];let start=left.end,end=right.start;if(end<=start){start=(left.start+left.end)/2;end=(right.start+right.end)/2;}fill(a.target+1,b.target,start,end);}
 const startBound=Math.max(source[0].start,source[anchorPairs[0].source].start-(first-begin)*.6-1);
 const endBound=Math.min(source.at(-1).end,source[anchorPairs.at(-1).source].end+(finish-last-1)*.6+1);
 fill(begin,first,startBound,source[anchorPairs[0].source].start);fill(last+1,finish,source[anchorPairs.at(-1).source].end,endBound);
 const chars=[...result.values()].filter(c=>!c.unresolved).sort((a,b)=>a.targetIndex-b.targetIndex),pending=target.map((text,index)=>({text,index})).filter(c=>!result.has(c.index)||result.get(c.index).unresolved);
 const repeated=anchors.filter(a=>target.join('').indexOf(a.text)!==target.join('').lastIndexOf(a.text));for(const line of lines){const phrase=target.slice(line.start,line.end).join('');if(phrase.length>=2&&target.join('').indexOf(phrase)!==target.join('').lastIndexOf(phrase))repeated.push({text:phrase});}
 return {chars,anchors,pending,estimated:chars.filter(c=>c.estimated).length,total:target.length,warnings:[...(repeated.length?['含重复歌词，时间顺序已用于匹配；请核对副歌对应段落。']:[]),...(pending.length?['未有时间依据的歌词保留为待定位，不强行塞入当前片段。']:[]),'锚点之间的漏字按旋律时间补排，请试听核对。']};
}

// Keep reliable observations intact; missing characters receive explicit estimates.
export function completeAcousticCharacters(alignment){
 const chars=structuredClone(alignment.characters||[]).map((c,i)=>({...c,id:c.id||`char-${i}`}));
 const anchors=chars.map((c,i)=>({c,i})).filter(({c})=>c.status==='acoustic'&&Number.isFinite(c.start));
 const rates=anchors.slice(1).map((a,k)=>(a.c.start-anchors[k].c.start)/(a.i-anchors[k].i)).filter(v=>v>0&&v<2).sort((a,b)=>a-b);
 const rate=rates.length?rates[Math.floor(rates.length/2)]:.3;
 for(let i=0;i<chars.length;i++){
  const c=chars[i];if(Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.end>c.start)continue;
  const left=anchors.filter(a=>a.i<i).at(-1),right=anchors.find(a=>a.i>i);
  const start=left&&right?left.c.start+(right.c.start-left.c.start)*(i-left.i)/(right.i-left.i):left?left.c.start+rate*(i-left.i):right?Math.max(0,right.c.start-rate*(right.i-i)):i*rate;
  chars[i]={...c,observedStart:c.start,observedEnd:c.end,start,end:start+rate,status:'estimated',evidence:'anchor-interpolation'};
 }
 return chars;
}
export function moveAlignedCharacter(score,id,noteId,offsetX=0){
 const c=score.lyricAlignment?.characters.find(c=>c.id===id);
 if(!c||!score.measures.some(m=>m.notes.some(n=>n.id===noteId)))throw Error('歌词或目标音符不存在');
 c.placement={noteId,offsetX,manual:true};
}
export function applyAcousticLyrics(score,alignment,{verse=1}={}){
 const next=structuredClone(score),characters=completeAcousticCharacters(alignment);
 const prior=new Map((score.lyricAlignment?.characters||[]).map(c=>[c.id,c]));
 for(const c of characters){const old=prior.get(c.id);if(old?.text===c.text&&old.placement?.manual)c.placement=structuredClone(old.placement);}
 next.lyrics=(next.lyrics||[]).filter(l=>l.verse!==verse);
 next.lyricAlignment={...structuredClone(alignment),characters,verse,pending:[],displayMode:'characters',legacyLyrics:alignment.legacyLyrics||structuredClone((score.lyrics||[]).filter(l=>l.verse===verse))};
 return {score:validate(next),count:characters.length,unplaced:[],warnings:[`${characters.filter(c=>c.status==='estimated').length} 字按锚点估算，棕色标记；可逐字拖动核对。`]};
}
