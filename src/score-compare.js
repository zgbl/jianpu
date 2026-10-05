import {ticks,validate} from './model.js';
import {noteMidi} from './pitch.js';
import {scoreTimeline} from './playback.js';
import {audioScoreTimeline} from './audio-score-cursor.js';
export const flattenScore=score=>score.measures.flatMap((m,mi)=>m.notes.map(n=>({n,mi,midi:n.degree?noteMidi(n,score):null,duration:ticks(n)})));
// Sequence alignment tolerates omissions. It is a hypothesis, not a pitch truth.
export function compareScores(audio,visual){
 const a=flattenScore(audio),b=flattenScore(visual);if(a.length*b.length>4_000_000)throw Error('音符过多，请按片段比较');
 const cols=b.length+1,d=new Float64Array((a.length+1)*cols),back=new Uint8Array(d.length);
 for(let i=1;i<=a.length;i++){d[i*cols]=i*2;back[i*cols]=1;}for(let j=1;j<=b.length;j++){d[j]=j*2;back[j]=2;}
 for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++){
  const x=a[i-1],y=b[j-1],pitch=x.midi===y.midi?0:x.midi===null||y.midi===null?3:Math.min(2.5,Math.abs(x.midi-y.midi)*.35),cost=pitch+Math.min(1,Math.abs(Math.log2(x.duration/y.duration))*.4);
  const k=i*cols+j,options=[d[k-cols-1]+cost,d[k-cols]+2,d[k-1]+2],best=options.indexOf(Math.min(...options));d[k]=options[best];back[k]=best;
 }
 const pairs=[],issues=[];let i=a.length,j=b.length;
 while(i||j){const direction=back[i*cols+j];if(direction===0){pairs.push({audio:i-1,visual:j-1});i--;j--;}else if(direction===1){issues.push({type:'unmatchedAudio',audio:i-1,description:'音频谱有额外音符；可能是视觉漏音，也可能是滑音误分。请试听确认。'});i--;}else{issues.push({type:'unmatchedVisual',visual:j-1,description:'视觉谱音符未匹配到音频；可能是音频漏音。请对照原图。'});j--;}}
 pairs.reverse();for(const pair of pairs){const x=a[pair.audio],y=b[pair.visual];if(x.midi!==y.midi||Math.abs(x.duration-y.duration)>1e-7)issues.push({...pair,type:'difference',description:'两种识谱结果不同；音频结果仅作为候选，需试听与原图核对。'});}
 return {a,b,pairs,issues};
}
export function comparisonTimelines(audio,visual,comparison,{timedLyrics=null}={}){
 const timeline=scoreTimeline(audio),marks=new Map(timeline.marks.map(x=>[x.id,x]));
 const recorded=audioScoreTimeline(audio),recordedById=new Map(recorded.map(x=>[x.id,x]));
 const audioTimes=comparison.a.map(({n})=>{const mark=marks.get(n.id),known=recordedById.get(n.id),fallback=!recorded.length,start=known?.start??(fallback?mark.start+(audio.transcription?.barStartTime||0):NaN),end=known?.end??(fallback?start+(mark.end-mark.start):NaN);return {id:n.id,start:start+(audio.transcription?.clipStart||0),end:end+(audio.transcription?.clipStart||0),...(known?.timingSource?{timingSource:known.timingSource}:{})};});
 const estimated=audioTimes.filter(x=>x.timingSource?.startsWith('estimated')).length;
 const explain=alignment=>({...alignment,estimatedAudioNotes:estimated,description:alignment.description+(estimated?`；左谱新增前奏/尾奏的 ${estimated} 个音符时间按原识别 BPM 从录音锚点向外估算，虚线指针表示估算；原有歌声时间不变。`:'')});
 const aligned=alignScoreByLyrics(audio,visual,audioTimes,{timedLyrics});
 if(aligned)return {audio:audioTimes,visual:aligned.visual,alignment:explain(aligned.alignment)};
 const visualTimes=comparison.pairs.map(p=>({...audioTimes[p.audio],id:comparison.b[p.visual].n.id}));
 return {audio:audioTimes,visual:visualTimes,alignment:explain({method:'notes',anchors:0,description:'共同歌词不足，右谱仍按音符序列估算时间；请先核对两谱歌词或补充手工对齐点。'})};
}

// Match short, distinctive lyric phrases in order. The audio score supplies
// recorded times; the visual score supplies relative engraved durations.
// Pitch is intentionally excluded because the two drafts may use different Do.
export function alignScoreByLyrics(audio,visual,audioTimes,{timedLyrics=null}={}){
 const audioNotes=flattenScore(audio),visualNotes=flattenScore(visual);
 const lyricTokens=(score,notes,verse)=>{
  const byId=new Map(notes.map((x,index)=>[x.n.id,index])),tokens=[];
  for(const lyric of (score.lyrics||[]).filter(x=>x.verse===verse).sort((a,b)=>(byId.get(a.noteId)??Infinity)-(byId.get(b.noteId)??Infinity))){
   const noteIndex=byId.get(lyric.noteId);if(noteIndex===undefined)continue;
   for(const character of Array.from(String(lyric.text||'').normalize('NFKC').toLowerCase()))if(/[\p{L}\p{N}]/u.test(character))tokens.push({character,noteIndex});
  }
  return tokens;
 };
 const visualMarks=new Map(scoreTimeline(visual).marks.map(mark=>[mark.id,mark]));
 const timed=[];
 if(timedLyrics?.characters&&Array.isArray(timedLyrics.characters))for(const entry of timedLyrics.characters){const start=Number(entry?.start);if(!Number.isFinite(start)||start<0)continue;for(const character of Array.from(String(entry.text||'').normalize('NFKC').toLowerCase()))if(/[\p{L}\p{N}]/u.test(character))timed.push({character,time:start+(timedLyrics.timeBase==='clip-seconds'?(audio.transcription?.clipStart||0):0),confidence:entry.confidence??0,status:entry.status});}
 let best=[],bestVerse=1,bestSource='score';
 for(const source of [...(timed.length?[{tokens:timed,name:'audio',verse:null}]:[]),...[1,2,3,4].map(verse=>({tokens:lyricTokens(audio,audioNotes,verse).map(token=>({...token,time:audioTimes[token.noteIndex]?.start})),name:'score',verse}))]){
  const a=source.tokens;
  for(let verse=1;verse<=4;verse++){
  const b=lyricTokens(visual,visualNotes,verse);
  if(a.length<3||b.length<3)continue;
  const candidates=[];
  for(const size of [5,4,3]){
   const positions=items=>{const map=new Map();for(let i=0;i<=items.length-size;i++){const phrase=items.slice(i,i+size).map(x=>x.character).join('');const locations=map.get(phrase)||[];locations.push(i);map.set(phrase,locations);}return map;};
   const aPhrases=positions(a),bPhrases=positions(b);
   for(const [phrase,where] of bPhrases){const left=aPhrases.get(phrase);if(where.length!==1||left?.length!==1)continue;const ai=left[0]+Math.floor(size/2),vi=b[where[0]+Math.floor(size/2)].noteIndex,token=a[ai],time=token.time,mark=visualMarks.get(visualNotes[vi]?.n.id);if(Number.isFinite(time)&&mark&&(source.name!=='audio'||token.status==='acoustic'&&token.confidence>=.2))candidates.push({ai,vi,time,position:mark.start,size});}
  }
  const byPair=new Map();for(const candidate of candidates){const key=`${candidate.ai}:${candidate.vi}`;if(!byPair.has(key))byPair.set(key,candidate);}const unique=[...byPair.values()].sort((x,y)=>x.vi-y.vi||x.ai-y.ai);
  const weight=new Float64Array(unique.length),previous=new Int32Array(unique.length).fill(-1);
  for(let i=0;i<unique.length;i++){weight[i]=unique[i].size;for(let j=0;j<i;j++)if(unique[j].vi<unique[i].vi&&unique[j].ai<unique[i].ai&&unique[j].time<unique[i].time&&unique[j].position<unique[i].position&&weight[j]+unique[i].size>weight[i]){weight[i]=weight[j]+unique[i].size;previous[i]=j;}}
  let max=-1,end=-1;for(let i=0;i<weight.length;i++)if(weight[i]>max){max=weight[i];end=i;}const chain=[];while(end>=0&&unique[end]){chain.push(unique[end]);end=previous[end];}chain.reverse();
  if(chain.length>best.length){best=chain;bestVerse=verse;bestSource=source.name;}
  }
 }
 if(best.length<2)return null;
 // Nearby overlapping phrases are one timing landmark. Widely separated
 // landmarks keep the piecewise map stable across tempo changes and omissions.
 const anchors=[];for(const candidate of best){const last=anchors.at(-1);if(last&&candidate.position-last.position<.7&&candidate.time-last.time<2){if(candidate.size>last.size)anchors[anchors.length-1]=candidate;}else anchors.push(candidate);}
 if(anchors.length<2)return null;
 const segment=(position)=>{if(position<=anchors[0].position)return [anchors[0],anchors[1]];for(let i=1;i<anchors.length;i++)if(position<=anchors[i].position)return [anchors[i-1],anchors[i]];return [anchors.at(-2),anchors.at(-1)];};
 const visualTimes=visualNotes.map(({n})=>{const mark=visualMarks.get(n.id);if(!mark)return {id:n.id,start:NaN,end:NaN};const map=position=>{const [a,b]=segment(position),ratio=(position-a.position)/(b.position-a.position);return a.time+ratio*(b.time-a.time);};return {id:n.id,start:map(mark.start),end:map(mark.end)};});
 return {visual:visualTimes,alignment:{method:'lyrics',source:bestSource,anchors:anchors.length,verse:bestVerse,firstMeasure:visualNotes[anchors[0].vi].mi+1,lastMeasure:visualNotes[anchors.at(-1).vi].mi+1,description:`已用${bestSource==='audio'?'音频逐字时间':'左谱歌词'}与右谱第 ${bestVerse} 段的 ${anchors.length} 处共同歌词对齐时间（视觉谱第 ${visualNotes[anchors[0].vi].mi+1}–${visualNotes[anchors.at(-1).vi].mi+1} 小节）；两端范围按相邻节奏延伸，请试听核对。`}};
}
export function applyComparisonSuggestion(visual,audio,issue,fields=['pitch','duration']){
 if(issue.type!=='difference')throw Error('未匹配音符不能自动插入或删除，请先人工编辑');
 const next=structuredClone(visual),target=flattenScore(next)[issue.visual].n,source=flattenScore(audio)[issue.audio].n;
 if(fields.includes('pitch'))for(const key of ['degree','octave','accidental'])target[key]=source[key]??0;
 // Absolute pitch must be translated to the visual score key.
 if(fields.includes('pitch')&&audio.key!==visual.key)throw Error('两谱实际调不同，请先校准实际 Do，再确认音高修改');
 if(fields.includes('duration')){if(target.tuplet||source.tuplet)throw Error('三连音必须按整组校对，请在编辑谱或视觉局部复核中修改，不能只改一音');target.base=source.base;target.dots=source.dots;}
 next.manualBarlines=true;return validate(next);
}
