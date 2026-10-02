import {keyPc,validateKeyMap,legacyKeyMap} from './pitch.js';
import {validateLyrics} from './lyrics.js';
export const capacity=64;
export const measureCapacity=s=>s.meter[0]*64/s.meter[1];
export const ticks=n=>64/n.base*(n.dots?1.5:1);
export const used=m=>m.notes.reduce((s,n)=>s+ticks(n),0);
export const note=(degree=1,base=4,octave=0,dots=0)=>({id:crypto.randomUUID(),degree,base,octave,dots});
const measure=notes=>({id:crypto.randomUUID(),notes,repeatStart:false,repeatEnd:false});
const from=rows=>rows.map(row=>measure(row.map(args=>note(...args))));
export function demo(which='low'){
 const low=[[[0,8],[3,8,-1],[3,8,-1],[6,16,-1],[6,16,-1],[6,8,-1,1],[5,16,-1],[5,4,-1]],[[4,16,-1],[3,8,-1,1],[0,4],[0,4],[0,4]],[[0,8],[3,8,-1],[3,8,-1],[6,16,-1],[6,16,-1],[6,8,-1],[1,16,-1],[1,16,-1],[2,8,-1],[3,8,-1]],[[3,4,-1],[0,4],[0,4],[0,4]]];
 const high=[[[5,4,1,1],[7,8],[1,4,1,1],[4,16,1],[3,16,1]],[[4,4,1,1],[3,16,1],[4,16,1],[3,8,1],[2,8,1],[1,8,1],[7,16],[1,16,1]],[[1,1,1]],[[0,4],[1,8,1],[7,8],[1,4,1],[3,8],[4,8]]];
 const ornament=[[[5,8,-1],[6,16],[1,16],[1,16],[2,8],[3,16]],[[3,8,-1],[1,16],[6,16],[6,16],[5,8,0,1]],[[5,8],[4,16],[4,16],[4,16],[3,8],[1,16]],[[1,16],[2,8,0,1],[0,4]],[[4,8],[3,16],[1,16],[1,16],[3,8,0,1]]];
 const measures=from(which==='high'?high:which==='ornament'?ornament:low),spans=[];
 const link=(type,a,b,c,d)=>spans.push({id:crypto.randomUUID(),type,from:measures[a].notes[b].id,to:measures[c].notes[d].id});
 if(which==='ornament'){measures[1].notes[2].grace={degree:5,octave:0,base:16};link('tie',0,2,0,3);link('slur',0,5,1,0);link('tie',1,2,1,3);link('tie',2,2,2,3);link('slur',2,5,3,0);link('tie',4,2,4,3);}
 else if(which==='high'){link('tie',1,7,2,0);link('slur',3,1,3,3);measures[3].repeatStart=true;}else{link('tie',0,4,0,5);link('tie',2,4,2,5);link('slur',2,9,3,0);}
 return {format:'jianpu-melody',version:2,title:which==='high'?'旋律片段 B · 高音与延长音':which==='ornament'?'旋律片段 C · 倚音与连线':'旋律片段 A · 低音与节奏',key:'C',meter:which==='ornament'?[2,4]:[4,4],measures,spans};
}
export function validate(s){
 if(s?.tempo!==undefined&&(!Number.isFinite(s.tempo)||s.tempo<40||s.tempo>240))throw Error('播放速度应为 40–240 BPM');
 if(!s||s.format!=='jianpu-melody'||s.version!==2)throw Error('不支持的文件格式或版本');
 if(typeof s.title!=='string'||s.title.length>200||typeof s.key!=='string'||!['[4,4]','[3,4]','[2,4]'].includes(JSON.stringify(s.meter)))throw Error('标题、调号或拍号不合法');
 keyPc(s.key);if(s.keyMap!==undefined)validateKeyMap(s.keyMap,s.key);
 if(!Array.isArray(s.measures)||!s.measures.length||s.measures.length>1000)throw Error('小节数量应为 1–1000');
 if(s.manualBarlines!==undefined&&typeof s.manualBarlines!=='boolean')throw Error('人工小节线属性不合法');
 const ids=new Set(),events=new Map();let order=0;
 for(const m of s.measures){
  if(!Array.isArray(m.notes)||m.notes.length>(s.manualBarlines?512:64))throw Error('小节音符列表不合法');
  if(('final' in m&&typeof m.final!=='boolean')||('breakBefore' in m&&typeof m.breakBefore!=='boolean'))throw Error('小节排版或终止线属性不合法');
  if(typeof m.repeatStart!=='boolean'||typeof m.repeatEnd!=='boolean')throw Error('反复记号不合法');
  for(const x of [m,...m.notes]){if(typeof x.id!=='string'||!x.id||ids.has(x.id))throw Error('对象 ID 缺失或重复');ids.add(x.id);}
  for(const n of m.notes){
   if(!Number.isInteger(n.degree)||n.degree<0||n.degree>7||![1,2,4,8,16].includes(n.base)||![-2,-1,0,1,2].includes(n.octave)||![0,1].includes(n.dots)||('beamBreak' in n&&typeof n.beamBreak!=='boolean'))throw Error('音符属性不合法');
   if(n.accidental!==undefined&&![-1,0,1].includes(n.accidental))throw Error('升降号不合法');
   if(n.grace&&(!n.degree||!Number.isInteger(n.grace.degree)||n.grace.degree<1||n.grace.degree>7||![-2,-1,0,1,2].includes(n.grace.octave)||![8,16].includes(n.grace.base)))throw Error('倚音属性不合法');
   if(n.degree===0&&n.accidental)throw Error('休止符不能有升降号');
   if(n.degree===0&&n.octave!==0)throw Error('休止符不能有八度点');events.set(n.id,{...n,order:order++});
  }
  if(used(m)>measureCapacity(s)&&!s.manualBarlines)throw Error('小节超过拍号容量');
 }
 if(!Array.isArray(s.spans)||s.spans.length>2000)throw Error('连线列表不合法');
 for(const p of s.spans){if(typeof p.id!=='string'||ids.has(p.id))throw Error('连线 ID 不合法');ids.add(p.id);const a=events.get(p.from),b=events.get(p.to);if(!a||!b||a.order>=b.order||!['tie','slur'].includes(p.type))throw Error('连线端点不合法');if(p.type==='tie'&&(b.order!==a.order+1||!a.degree||a.degree!==b.degree||a.octave!==b.octave||(a.accidental||0)!==(b.accidental||0)))throw Error('延音线必须连接相邻的同音高音符');}
 if(s.endings!==undefined){
  if(!Array.isArray(s.endings)||s.endings.length>100)throw Error('结尾括号不合法');
  const measureIds=s.measures.map(m=>m.id);
  for(const e of s.endings){if(typeof e.id!=='string'||ids.has(e.id)||![1,2].includes(e.number))throw Error('结尾括号 ID 或编号不合法');ids.add(e.id);const a=measureIds.indexOf(e.fromMeasure),b=measureIds.indexOf(e.toMeasure);if(a<0||b<a)throw Error('结尾括号的小节范围不合法');}
 }
 validateLyrics(s,events);
 return s;
}
export function parse(raw){const s=JSON.parse(raw);if(s?.format==='jianpu-melody'&&s.version===1){s.version=2;s.spans=[];for(const m of s.measures){m.repeatStart=false;m.repeatEnd=false;}}if(!s.keyMap)s.keyMap=legacyKeyMap(s);return validate(s);}
// Inserting music between the endpoints breaks a tie: retain notes and slurs,
// detach only ties whose original notes are no longer consecutive.
export function detachInterruptedTies(s){const order=new Map(s.measures.flatMap(m=>m.notes).map((n,i)=>[n.id,i])),detached=[];
 s.spans=s.spans.filter(p=>{if(p.type==='tie'&&order.has(p.from)&&order.has(p.to)&&order.get(p.to)!==order.get(p.from)+1){detached.push(p);return false;}return true;});return detached;
}
export function insert(s,index,n,at){const m=s.measures[index];if(used(m)+ticks(n)>measureCapacity(s))throw Error('小节超过拍号容量，请缩短时值或切换小节');m.notes.splice(at??m.notes.length,0,n);return detachInterruptedTies(s);}
export function change(s,mi,id,patch){const m=s.measures[mi],i=m.notes.findIndex(n=>n.id===id);if(i<0)throw Error('请选择音符');const next={...m.notes[i],...patch};if(next.degree===0){next.octave=0;delete next.grace;delete next.accidental;}const copy=structuredClone(s);copy.measures[mi].notes[i]=next;if(!next.degree&&copy.lyrics)copy.lyrics=copy.lyrics.filter(l=>l.noteId!==id);validate(copy);m.notes[i]=next;if(!next.degree&&s.lyrics)s.lyrics=s.lyrics.filter(l=>l.noteId!==id);}
export function remove(s,ids){for(const m of s.measures)m.notes=m.notes.filter(n=>!ids.includes(n.id));s.spans=s.spans.filter(p=>!ids.includes(p.from)&&!ids.includes(p.to));if(s.lyrics)s.lyrics=s.lyrics.filter(l=>!ids.includes(l.noteId)).map(l=>{if(l.endNoteId&&ids.includes(l.endNoteId)){const next={...l};delete next.endNoteId;return next;}return l;});}
export function connect(s,type,from,to){const copy=structuredClone(s);const p={id:crypto.randomUUID(),type,from,to};copy.spans.push(p);validate(copy);s.spans.push(p);}
