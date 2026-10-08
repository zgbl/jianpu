import {parse,used,ticks} from './model.js';
import {shiftChordLabel} from './guitar-notation.js';
import {keyPc,mod12,validateKeyMap} from './pitch.js';

export function extractModelJson(text){
 const input=String(text||'').replace(/^\uFEFF/,'').trim();
 if(!input)throw Error('请先粘贴视觉大模型返回的 JPU JSON');
 if(input.length>2_000_000)throw Error('模型文本超过 2 MB，请分批检查或缩短输出');
 if(input.startsWith('{'))return input;
 const blocks=[...input.matchAll(/```(?:json|jpu)?\s*([\s\S]*?)\s*```/gi)];
 if(blocks.length!==1)throw Error('请只粘贴一个完整的 JPU JSON 对象；含说明文字时只能有一个 JSON 代码块');
 return blocks[0][1].trim();
}

function makeDisplayableJpu(input){
 const raw=structuredClone(input),repairs=[],pendingNotes=[],pendingLyrics=[],pendingChords=[],pendingMetadata=[];
 const warn=(measure,kind,description)=>repairs.push({measure,kind,description});
 const usedIds=new Set();let serial=0;
 const uniqueId=(wanted,prefix)=>{
  if(typeof wanted==='string'&&wanted.trim()&&!usedIds.has(wanted)){usedIds.add(wanted);return wanted;}
  let id;do{id=`${prefix}_recovered_${++serial}`;}while(usedIds.has(id));usedIds.add(id);return id;
 };
 if(typeof raw.title!=='string'||!raw.title.trim()){raw.title='未命名视觉谱';warn(0,'missing_title','曲名缺失，暂用“未命名视觉谱”。');}
 if(typeof raw.key!=='string'||!/^([A-G])([#b♯♭]?)$/.test(raw.key)){raw.key='C';delete raw.keyMap;warn(0,'invalid_key','调号无法识别，暂按 C 调显示；请核对原图。');}
 else raw.key=raw.key.replace('♯','#').replace('♭','b');
 if(typeof raw.meter==='string'&&/^\s*[2346]\s*\/\s*[48]\s*$/.test(raw.meter))raw.meter=raw.meter.split('/').map(x=>Number(x.trim()));
 if(![[2,4],[3,4],[4,4],[6,8]].some(x=>JSON.stringify(x)===JSON.stringify(raw.meter))){raw.meter=[4,4];warn(0,'invalid_meter','拍号无法识别，暂按 4/4 显示；请核对原图。');}
 if(!Array.isArray(raw.measures))raw.measures=[];
 if(!raw.measures.length){raw.measures=[{id:'m001_recovered',notes:[{id:'n001_recovered',degree:0,base:1,octave:0,dots:0}],repeatStart:false,repeatEnd:false}];warn(1,'missing_measures','模型没有返回小节；已放置一个全休止占位小节，旋律需要重新识别。');}
 if(raw.measures.length>1000){raw.measures=raw.measures.slice(0,1000);warn(0,'measures_truncated','小节数超过 1000 的显示上限，超出部分暂时截去。');}for(let mi=0;mi<raw.measures.length;mi++){
  let m=raw.measures[mi];if(!m||typeof m!=='object'||Array.isArray(m)){m=raw.measures[mi]={notes:[]};warn(mi+1,'invalid_measure','小节对象损坏，已显示为空小节。');}
  const oldId=m.id;m.id=uniqueId(m.id,`m${String(mi+1).padStart(3,'0')}`);if(oldId!==m.id)warn(mi+1,'recovered_measure_id','小节编号缺失或重复，已重新编号；依赖旧编号的和弦需核对。');
  if(!Array.isArray(m.notes)){m.notes=[];warn(mi+1,'missing_notes','小节缺少 notes 数组，已显示为空小节。');}if(m.notes.length>512){m.notes=m.notes.slice(0,512);warn(mi+1,'notes_truncated','单小节音符超过安全显示上限，超出部分暂时截去。');}
  if(m.final!==undefined&&typeof m.final!=='boolean'){delete m.final;warn(mi+1,'measure_final_default','小节终止线设置格式错误，已使用默认显示。');}
  if(m.breakBefore!==undefined&&typeof m.breakBefore!=='boolean'){delete m.breakBefore;warn(mi+1,'measure_break_default','换行标记格式错误，已使用自动排版。');}
  if(typeof m.repeatStart!=='boolean'){m.repeatStart=false;warn(mi+1,'repeat_default','repeatStart 缺失或格式不正确，暂按 false。');}
  if(typeof m.repeatEnd!=='boolean'){m.repeatEnd=false;warn(mi+1,'repeat_default','repeatEnd 缺失或格式不正确，暂按 false。');}
  for(let ni=0;ni<m.notes.length;ni++){
   let n=m.notes[ni];if(!n||typeof n!=='object'||Array.isArray(n)){n=m.notes[ni]={};warn(mi+1,'invalid_note','音符对象损坏，已用休止符占位。');}
   const original=structuredClone(n),oldNoteId=n.id;n.id=uniqueId(n.id,`n${String(mi+1).padStart(3,'0')}_${String(ni+1).padStart(3,'0')}`);if(oldNoteId!==n.id)warn(mi+1,'recovered_note_id',`音符 ${ni+1} 的 ID 缺失或重复，已重建。`);
   for(const key of ['degree','base','octave','dots','accidental'])if(typeof n[key]==='string'&&n[key].trim()!==''&&Number.isFinite(Number(n[key])))n[key]=Number(n[key]);
   if(n.base===undefined){n.base=4;warn(mi+1,'base_default','音符缺少 base，暂按四分音符显示；请核对减时线。');}
   if(n.octave===undefined)n.octave=0;if(n.dots===undefined)n.dots=0;
   const unresolved=[];
   if(n.degree===8){if(!Number.isInteger(n.octave))n.octave=0;if(n.octave<2){n.degree=1;n.octave++;warn(mi+1,'octave_degree_normalized',`音符 ${n.id} 的 degree:8 已转换成 degree:1、octave:${n.octave}；请核对八度点。`);}else{unresolved.push('degree:8 加八度点后超出显示范围');n.degree=1;n.octave=2;}}
   if(!Number.isInteger(n.degree)||n.degree<0||n.degree>7){unresolved.push(`degree=${String(n.degree)}`);n.degree=0;n.octave=0;delete n.accidental;delete n.grace;}
   if(![1,2,4,8,16].includes(n.base)){if(n.base===32){n.base=16;warn(mi+1,'duration_truncated','32 分音符超出当前支持范围，暂按 16 分音符显示；请核对原图。');}else{unresolved.push(`base=${String(n.base)}`);n.base=4;}}
   if(![-2,-1,0,1,2].includes(n.octave)){unresolved.push(`octave=${String(n.octave)}`);n.octave=0;}
   if(![0,1].includes(n.dots)){unresolved.push(`dots=${String(n.dots)}`);n.dots=0;}
   if(n.accidental!==undefined&&![-1,0,1].includes(n.accidental)){unresolved.push(`accidental=${String(n.accidental)}`);delete n.accidental;}
   if(n.beamBreak!==undefined&&typeof n.beamBreak!=='boolean'){unresolved.push('beamBreak');delete n.beamBreak;}
   if(n.grace){if(!n.grace||typeof n.grace!=='object'||Array.isArray(n.grace)){unresolved.push('grace');delete n.grace;}else{if(n.grace.degree===8){if(!Number.isInteger(n.grace.octave))n.grace.octave=0;if(n.grace.octave<2){n.grace.degree=1;n.grace.octave++;warn(mi+1,'grace_octave_normalized',`倚音 ${n.id} 的 degree:8 已转换成高八度 1；请核对八度点。`);}else{n.grace.degree=1;n.grace.octave=2;unresolved.push('grace.degree:8 八度超出范围');}}if(!n.degree||!Number.isInteger(n.grace.degree)||n.grace.degree<1||n.grace.degree>7||![-2,-1,0,1,2].includes(n.grace.octave)||![8,16].includes(n.grace.base)){unresolved.push('grace');delete n.grace;}}}
   if(n.degree===0){n.octave=0;delete n.accidental;delete n.grace;}
   if(unresolved.length){pendingNotes.push({measure:mi+1,noteId:n.id,original,fields:unresolved,reason:'无法可靠推断的音符字段已用可显示的休止符/默认时值占位'});warn(mi+1,'note_placeholder',`音符 ${n.id} 的 ${unresolved.join('、')} 无法安全修正，已用休止符或默认时值占位；请对照原图。`);}
  }
 }
 // Drop only malformed tuplet metadata as a whole group; keep the notes visible.
 const groups=new Map();for(let mi=0;mi<raw.measures.length;mi++)for(let ni=0;ni<raw.measures[mi].notes.length;ni++){const n=raw.measures[mi].notes[ni];if(n.tuplet){if(!n.tuplet||typeof n.tuplet!=='object'||Array.isArray(n.tuplet)){delete n.tuplet;warn(mi+1,'tuplet_placeholder','三连音属性格式无法识别；音符仍按普通时值显示。');continue;}const id=n.tuplet.id??`__missing_${mi}_${ni}`,list=groups.get(id)||[];list.push({mi,ni,n});groups.set(id,list);}}
 for(const [id,list] of groups){const indexes=list.map(x=>x.ni),valid=typeof id==='string'&&list.length===3&&list[2].mi===list[0].mi&&indexes[1]===indexes[0]+1&&indexes[2]===indexes[1]+1&&list.every(x=>x.n.tuplet.actual===3&&x.n.tuplet.normal===2&&x.n.dots===0&&x.n.base===list[0].n.base);
  if(!valid){for(const x of list)delete x.n.tuplet;warn(list[0].mi+1,'tuplet_placeholder',`三连音组 ${String(id)} 的成员不完整或时值不一致；已保留音符并按普通时值显示，请核对原图。`);}}
 const tupletGroups=new Map();for(const m of raw.measures)for(const n of m.notes)if(n.tuplet){const id=n.tuplet.id;const key=typeof id==='string'&&id?id:`__missing_${tupletGroups.size}`;const group=tupletGroups.get(key)||[];group.push(n);tupletGroups.set(key,group);}
 for(const [id,notes] of tupletGroups){if(typeof id==='string'&&!usedIds.has(id)){usedIds.add(id);continue;}const replacement=uniqueId(`t_recovered_${++serial}`,'t');for(const n of notes)n.tuplet.id=replacement;warn(0,'recovered_tuplet_id',`三连音组 ID 缺失或与其他对象重复，已改为 ${replacement}。`);}
 const noteMap=new Map(raw.measures.flatMap((m,mi)=>m.notes.map((n,ni)=>[n.id,{n,measure:mi+1,order:mi*100000+ni}])));
 if(!Array.isArray(raw.lyrics)){if(raw.lyrics!==undefined)warn(0,'lyrics_default','歌词字段不是数组，暂时跳过歌词并保留旋律。');raw.lyrics=[];}if(raw.lyrics.length>10000){raw.lyrics=raw.lyrics.slice(0,10000);warn(0,'lyrics_truncated','歌词条目超出安全上限，超出部分暂时跳过。');}
 const lyricKeys=new Set();raw.lyrics=raw.lyrics.filter(l=>{const found=noteMap.get(l?.noteId),end=noteMap.get(l?.endNoteId),validText=typeof l?.text==='string'&&l.text.trim()&&l.text.length<=80,validVerse=Number.isInteger(l?.verse)&&l.verse>=1&&l.verse<=4,key=`${l?.noteId}:${l?.verse}`;let reason=!found?'歌词引用的音符不存在':!found.n.degree?'歌词被放在休止符上':!validVerse?'歌词段落编号无效':!validText?'歌词文字为空或过长':lyricKeys.has(key)?'同一音符重复绑定歌词':l?.offsetX!==undefined&&(!Number.isFinite(l.offsetX)||Math.abs(l.offsetX)>2000)?'歌词位置偏移不合法':l?.endNoteId&&(!end||end.order<found.order)?'拖腔结束音符无效':'';
  if(!reason){lyricKeys.add(key);return true;}
  const item={...(l&&typeof l==='object'?l:{text:String(l)}),measure:found?.measure||null,reason};pendingLyrics.push(item);warn(found?.measure||0,'pending_lyric',`歌词“${item.text||''}”未能可靠定位（${item.reason}），已保留待校。`);return false;});
 if(!Array.isArray(raw.spans)){if(raw.spans!==undefined)warn(0,'spans_default','连线字段不是数组，已暂时跳过连线；音符保留。');raw.spans=[];}if(raw.spans.length>2000){raw.spans=raw.spans.slice(0,2000);warn(0,'spans_truncated','连线条目超过安全上限，超出部分暂时跳过。');}
 const validSpanTypes=new Set(['tie','slur']),ordered=new Map(raw.measures.flatMap((m,mi)=>m.notes.map((n,ni)=>[n.id,{n,mi,ni,order:mi*100000+ni}])));raw.spans=raw.spans.filter(s=>{const a=ordered.get(s?.from),b=ordered.get(s?.to);let valid=validSpanTypes.has(s?.type)&&a&&b&&a.order<b.order;if(valid&&s.type==='tie')valid=b.order===a.order+1&&a.n.degree!==0&&a.n.degree===b.n.degree&&a.n.octave===b.n.octave&&(a.n.accidental||0)===(b.n.accidental||0);if(valid){const old=s.id;s.id=uniqueId(s.id,'span');if(old!==s.id)warn(a.mi+1,'span_id_recovered','连线 ID 缺失或重复，已自动重建。');return true;}warn(a?.mi!==undefined?a.mi+1:0,'pending_span','一条连线端点、方向或延音音高不合法，已从初稿移除；音符保留，请核对原图。');return false;});
 const measuresById=new Set(raw.measures.map(m=>m.id));if(!Array.isArray(raw.chords)){if(raw.chords!==undefined)warn(0,'chords_default','和弦字段不是数组，已暂时跳过和弦。');raw.chords=[];}if(raw.chords.length>5000){raw.chords=raw.chords.slice(0,5000);warn(0,'chords_truncated','和弦条目超出安全上限，超出部分暂时跳过。');}
 raw.chords=raw.chords.filter(c=>{try{if(!measuresById.has(c?.measureId))throw 0;shiftChordLabel(c.label,0);return true;}catch{pendingChords.push(c);warn(0,'pending_chord',`和弦“${c?.label||''}”的名称或小节引用无效，已保留待校。`);return false;}});
 if(raw.ending!==undefined&&!Array.isArray(raw.endings)){pendingMetadata.push(raw.endings??raw.ending);delete raw.endings;delete raw.ending;warn(0,'pending_endings','结尾反复标记格式无法识别，已保留为待校信息。');}else delete raw.ending;
 if(raw.endings!==undefined){let valid=Array.isArray(raw.endings)&&raw.endings.length<=100;const ids=new Set([...raw.measures.flatMap(m=>[m.id,...m.notes.map(n=>n.id)]),...raw.spans.map(s=>s.id)]),measureIds=raw.measures.map(m=>m.id);for(const e of valid?raw.endings:[]){const a=measureIds.indexOf(e?.fromMeasure),b=measureIds.indexOf(e?.toMeasure);if(typeof e?.id!=='string'||ids.has(e.id)||![1,2].includes(e.number)||a<0||b<a){valid=false;break;}ids.add(e.id);}if(!valid){pendingMetadata.push(raw.endings);delete raw.endings;warn(0,'pending_endings','结尾括号格式无法识别，已保留为待校信息。');}else for(const e of raw.endings){const old=e.id;e.id=uniqueId(e.id,'ending');if(old!==e.id)warn(0,'ending_id_recovered','结尾反复 ID 缺失或重复，已自动重建。');}}
 if(raw.keyMap!==undefined){try{validateKeyMap(raw.keyMap,raw.key);}catch{pendingMetadata.push(raw.keyMap);delete raw.keyMap;warn(0,'keymap_default','调性校准附加信息无效，已按调号默认值显示；谱面音符保留。');}}
 if(raw.guitarNotation!==undefined){const g=raw.guitarNotation,valid=g&&g.version===1&&['concert','fingering'].includes(g.mode)&&['C','G'].includes(g.shapeKey)&&Number.isInteger(g.capo)&&g.capo>= -12&&g.capo<=12;if(!valid){pendingMetadata.push(raw.guitarNotation);delete raw.guitarNotation;warn(0,'pending_guitar','吉他指型设置无效，已从显示设置移除；旋律保留。');}}
 if(raw.title.length>200){raw.title=raw.title.slice(0,200);warn(0,'title_truncated','曲名过长，已截到 200 字。');}
 if(raw.measures.some(m=>m.notes.length>64))raw.manualBarlines=true;
 if(raw.manualBarlines!==undefined&&typeof raw.manualBarlines!=='boolean'){delete raw.manualBarlines;warn(0,'manual_barlines_default','人工小节线设置格式错误，已使用自动排版。');}
 if(raw.tempo!==undefined&&(!Number.isFinite(raw.tempo)||raw.tempo<40||raw.tempo>240)){pendingMetadata.push({tempo:raw.tempo});delete raw.tempo;warn(0,'pending_tempo','速度字段超出支持范围，已暂时移除；旋律保留。');}
 const source=raw.importSource&&typeof raw.importSource==='object'&&!Array.isArray(raw.importSource)?raw.importSource:{};raw.importSource={...source,...(pendingNotes.length?{pendingNotes:[...(Array.isArray(source.pendingNotes)?source.pendingNotes:[]),...pendingNotes]}:{}),...(pendingLyrics.length?{pendingLyrics:[...(Array.isArray(source.pendingLyrics)?source.pendingLyrics:[]),...pendingLyrics]}:{}),...(pendingChords.length?{pendingChords:[...(Array.isArray(source.pendingChords)?source.pendingChords:[]),...pendingChords]}:{}),...(pendingMetadata.length?{pendingMetadata:[...(Array.isArray(source.pendingMetadata)?source.pendingMetadata:[]),...pendingMetadata]}:{})};
 const review=raw.visionReview&&typeof raw.visionReview==='object'&&!Array.isArray(raw.visionReview)?raw.visionReview:{};raw.visionReview={...review,issues:[...(Array.isArray(review.issues)?review.issues:[]),...repairs]};
 return {raw,repairs};
}

export function prepareModelScore(text){
 let raw;
 try{raw=JSON.parse(extractModelJson(text));}catch(error){if(error instanceof SyntaxError)throw Error(`JSON 格式错误：${error.message}`);throw error;}
 if(raw?.status==='needs_clearer_image')throw Error(`模型认为图片不足以可靠读谱：${(Array.isArray(raw.issues)?raw.issues:[]).map(i=>typeof i==='string'?i:i.description).filter(Boolean).join('；')||'请补充清晰图片'}`);
 if(raw?.format!=='jianpu-melody'||raw.version!==2)throw Error('需要完整的 jianpu-melody version 2 JPU；请把规范文档和谱图重新交给模型');
 // Keep syntactically valid JPU drafts displayable: normalize only clear aliases
 // and quarantine uncertain fields as warnings/placeholders before strict parse.
 const recovery=makeDisplayableJpu(raw);raw=recovery.raw;
 // An overfull visual draft must remain visible for review. The editor's
 // manual-bar mode permits it without inventing or deleting printed notes.
 if(Array.isArray(raw.meter)&&Array.isArray(raw.measures)&&raw.measures.some(m=>Array.isArray(m.notes)&&m.notes.reduce((sum,n)=>sum+ticks(n),0)>raw.meter[0]*64/raw.meter[1]+.01))raw.manualBarlines=true;
 // Keep misplaced model lyrics as explicit unresolved data, not guessed notes.
 if(Array.isArray(raw.lyrics)&&Array.isArray(raw.measures)){
  const notes=new Map(raw.measures.flatMap((m,i)=>(m.notes||[]).map(n=>[n.id,{n,measure:i+1}]))),pending=[];
  raw.lyrics=raw.lyrics.filter(l=>{const found=notes.get(l?.noteId);if(found?.n.degree===0&&Number.isInteger(l?.verse)&&l.verse>=1&&l.verse<=4&&typeof l.text==='string'&&l.text.trim()&&l.text.length<=80){pending.push({...l,measure:found.measure,reason:'歌词引用了休止符，尚未定位到有音高的音符'});return false;}return true;});
  if(pending.length){raw.importSource={...raw.importSource,pendingLyrics:[...(Array.isArray(raw.importSource?.pendingLyrics)?raw.importSource.pendingLyrics:[]),...pending]};raw.visionReview={...raw.visionReview,issues:[...(Array.isArray(raw.visionReview?.issues)?raw.visionReview.issues:[]),...pending.map(l=>({measure:l.measure,kind:'lyric_on_rest',description:`歌词“${l.text}”被模型放在休止符 ${l.noteId} 下，已保留为待定位；请对照原图确认，不会自动移位。`}))]};}
 }
 let score;
 try{score=parse(JSON.stringify(raw));}catch(error){throw Error(`JPU 校验失败：${error.message}`);}
 if(score.chords!==undefined&&!Array.isArray(score.chords))throw Error('chords 必须是和弦数组');
 const measureIds=new Set(score.measures.map(m=>m.id));
 for(const chord of score.chords||[]){
  if(!measureIds.has(chord.measureId))throw Error(`和弦 ${chord.label||''} 引用了不存在的小节 ID`);
  try{shiftChordLabel(chord.label,0);}catch{throw Error(`和弦名称不合法：${chord.label||'空白'}`);}
 }
 const review=score.visionReview;
 if(review!==undefined&&(!review||typeof review!=='object'||!Array.isArray(review.issues)))throw Error('visionReview.issues 必须是数组');
 const issues=(review?.issues||[]).map((issue,index)=>({index:index+1,page:issue?.page,measure:issue?.measure,description:typeof issue==='string'?issue:String(issue?.description||'未说明的复核项')}));
 const beats=score.measures.map((measure,index)=>({measure:index+1,beats:Math.round(used(measure)/(64/score.meter[1])*100)/100,expected:score.meter[0]}));
 const invalid=beats.filter(item=>Math.abs(item.beats-item.expected)>.01);
 const warnings=[];
 const octaveAliases=recovery.repairs.filter(x=>x.kind==='octave_degree_normalized');if(octaveAliases.length)warnings.push(`${octaveAliases.length} 个 degree:8 已转换为高八度 1。请对照原图确认八度点。`);
 if(recovery.repairs.length)warnings.push(`已自动修正或降级 ${recovery.repairs.length} 处 JPU 字段以显示草稿；橙色复核项说明原始内容未能可靠解释，请勿把占位内容当成已识别结果。`);
 if(score.importSource?.pendingNotes?.length)warnings.push(`${score.importSource.pendingNotes.length} 个音符字段无法安全推断，已用休止符/默认时值占位；请检查橙色复核项。`);
 if(score.importSource?.pendingChords?.length)warnings.push(`${score.importSource.pendingChords.length} 个和弦未能识别或定位，已从谱面暂时移除并保留待校。`);
 if(score.importSource?.pendingMetadata?.length)warnings.push(`${score.importSource.pendingMetadata.length} 项附加信息不符合当前格式，已隔离；旋律草稿仍可显示。`);
 if(score.importSource?.pendingLyrics?.length)warnings.push(`待定位歌词：${score.importSource.pendingLyrics.map(l=>`第 ${l.measure} 小节“${l.text}”（${l.noteId}）`).join('、')}。已保留文字，请对照原图或局部复核。`);
 if(invalid.length)warnings.push(`${invalid.length} 个小节拍数与 ${score.meter.join('/')} 不符：${invalid.map(x=>`第 ${x.measure} 小节 ${x.beats} 拍`).join('、')}`);
 if(score.guitarNotation?.mode==='fingering'&&mod12(keyPc(score.guitarNotation.shapeKey)+score.guitarNotation.capo)!==keyPc(score.key))warnings.push(`吉他 ${score.guitarNotation.shapeKey} 指型 + Capo ${score.guitarNotation.capo} 的实际调与 1=${score.key} 不一致，请核对`);
 if(issues.length)warnings.push(`模型标出了 ${issues.length} 处需要对照原图复核`);
 if(recovery.repairs.length)for(const repair of recovery.repairs)if(Number.isInteger(repair.measure)&&repair.measure>=1&&repair.measure<=raw.measures.length&&!issues.some(i=>i.measure===repair.measure&&i.description===repair.description))issues.push({measure:repair.measure,description:repair.description});
 score.importSource={...score.importSource,type:'vision-model',createdAt:new Date().toISOString(),rhythmNeedsReview:invalid.length>0,invalidMeasures:invalid};
 return {score,beats,invalid,issues,warnings};
}

// Recover only complete measure objects. Never invent a truncated note or bar.
export function prepareReceivedModelScore(text){
 try{return prepareModelScore(text);}catch(original){
  const input=String(text||'').replace(/^\s*```(?:json|jpu)?\s*/i,'').trim();
  try{JSON.parse(input);throw original;}catch(error){if(!(error instanceof SyntaxError))throw error;}
  const match=/"measures"\s*:\s*\[/.exec(input);
  if(!match)throw original;
  const start=match.index+match[0].length;let depth=0,string=false,escaped=false,last=-1;
  for(let i=start;i<input.length;i++){
   const c=input[i];
   if(string){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')string=false;continue;}
   if(c==='"'){string=true;continue;}
   if(c==='{'||c==='[')depth++;
   else if(c==='}'||c===']'){if(depth===0)break;depth--;if(depth===0&&c==='}')last=i;}
  }
  if(last<0)throw Error('输出已收到，但尚无完整小节可恢复；请继续等待或重新识别。');
  let raw;try{raw=JSON.parse(input.slice(0,last+1)+']}');}catch{throw original;}
  const noteIds=new Set(raw.measures.flatMap(m=>(m.notes||[]).map(n=>n.id)));
  const measureIds=new Set(raw.measures.map(m=>m.id));
  raw.lyrics=(raw.lyrics||[]).filter(x=>noteIds.has(x.noteId));
  raw.spans=(raw.spans||[]).filter(x=>noteIds.has(x.from)&&noteIds.has(x.to));
  raw.chords=(raw.chords||[]).filter(x=>measureIds.has(x.measureId));
  const description=`模型输出中断：仅恢复已完整返回的 ${raw.measures.length} 个小节；末尾未完整的小节已舍弃，后续歌词、和弦或连线可能尚未返回。`;
  raw.visionReview={...raw.visionReview,issues:[...(raw.visionReview?.issues||[]),{kind:'incomplete_output',description}]};
  const prepared=prepareModelScore(JSON.stringify(raw));
  prepared.score.importSource.incompleteOutput=true;
  prepared.warnings.unshift(description);
  return prepared;
 }
}
