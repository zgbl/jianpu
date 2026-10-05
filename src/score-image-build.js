import {auditImageMeasures} from './score-image-parse.js';

export function buildImageScore(draft,{title=draft.title,key=draft.key,meter=draft.meter}={}){
 if(!draft?.notes?.length)throw Error('没有可导入的音符');
 const invalid=auditImageMeasures(draft.notes,meter).filter(m=>!m.valid);
 const ordered=[...draft.notes].sort((a,b)=>a.measure-b.measure);
 const measureMap=new Map(),spans=[],noteIds=new Map();let lastSounding=null;
 for(const n of ordered){
  if(!Number.isInteger(n.measure)||n.measure<1||n.measure>1000)throw Error('小节编号必须为 1–1000');
  if(!measureMap.has(n.measure))measureMap.set(n.measure,{id:crypto.randomUUID(),notes:[],repeatStart:false,repeatEnd:false});
  const {x,measure,lyric,hold,pageIndex,...props}=n;
  const note={id:crypto.randomUUID(),...props};
  measureMap.get(n.measure).notes.push(note);noteIds.set(n,note.id);
  if(hold&&lastSounding&&note.degree===lastSounding.degree&&note.octave===lastSounding.octave&&(note.accidental||0)===(lastSounding.accidental||0))spans.push({id:crypto.randomUUID(),type:'tie',from:lastSounding.id,to:note.id});
  lastSounding=note.degree?note:null;
 }
 const max=Math.max(...measureMap.keys());
 for(let i=1;i<=max;i++)if(!measureMap.has(i))measureMap.set(i,{id:crypto.randomUUID(),notes:[],repeatStart:false,repeatEnd:false});
 for(const i of draft.repeatStarts||[])if(measureMap.has(i))measureMap.get(i).repeatStart=true;
 for(const i of draft.repeatEnds||[])if(measureMap.has(i))measureMap.get(i).repeatEnd=true;
 const measureIds=new Map([...measureMap].map(([index,measure])=>[index,measure.id]));
 const lyrics=ordered.filter(n=>n.lyric?.trim()&&n.degree>0&&!n.hold).map(n=>({noteId:noteIds.get(n),verse:1,text:n.lyric.trim()}));
 const chords=(draft.chords||[]).filter(c=>c.label?.trim()&&Number.isInteger(c.measure)&&measureIds.has(c.measure)).map(c=>({measureId:measureIds.get(c.measure),label:c.label.trim(),source:'image'}));
 const numerator=Number(String(meter).split('/')[0]);
 return {format:'jianpu-melody',version:2,title:String(title).trim()||'图片导入的简谱',key,meter:[numerator,Number(String(meter).split('/')[1])||4],measures:[...measureMap].sort((a,b)=>a[0]-b[0]).map(([,m])=>m),spans,lyrics,chords,manualBarlines:true,
  importSource:{type:'image-omr',createdAt:new Date().toISOString(),rhythmNeedsReview:invalid.length>0,invalidMeasures:invalid.map(m=>({measure:m.measure,beats:m.beats,expected:m.expected}))}};
}
