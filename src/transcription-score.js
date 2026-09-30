import {validate} from './model.js';
const KEYS={C:0,D:2,E:4,F:5,G:7,A:9,B:11},SCALE=[0,2,4,5,7,9,11];
export function suggestKey(notes){
 const weights=Array(12).fill(0);for(const n of notes)weights[n.midi%12]+=(n.end-n.start)*n.confidence;
 const profile=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
 return Object.keys(KEYS).sort((a,b)=>weights.reduce((sum,w,i)=>sum+w*(profile[(i-KEYS[b]+12)%12]-profile[(i-KEYS[a]+12)%12]),0))[0];
}
export function pitchToDegree(midi,key){
 const distance=midi-(60+KEYS[key]),octave=Math.floor(distance/12),pc=((distance%12)+12)%12;
 let index=SCALE.findIndex(v=>v===pc),accidental=0;if(index<0){index=SCALE.findLastIndex(v=>v<pc);accidental=1;}
 if(octave< -2||octave>2)throw Error('音域超过当前简谱格式的两组八度范围，请改用 1=C 或缩短片段。');
 return {degree:index+1,octave,...(accidental?{accidental}:{})};
}
const DURATIONS=[[16,1,0],[12,2,1],[8,2,0],[6,4,1],[4,4,0],[3,8,1],[2,8,0],[1,16,0]];
export function transcriptionToScore(result,{title='识别旋律',bpm=result.estimatedBpm,key='auto',meter=4,firstBeat=1}={}){
 if(!result.notes?.length)throw Error('没有可靠的主旋律音符，无法生成乐谱。');
 if(!Number.isFinite(+bpm)||bpm<40||bpm>240)throw Error('速度应为 40–240 BPM。');
 if(![2,4].includes(+meter)||!Number.isFinite(+firstBeat)||firstBeat<1||firstBeat>meter)throw Error('拍号或第一音的拍位不合法。');
 const warnings=[],chosen=key==='auto'?suggestKey(result.notes):key;if(!(chosen in KEYS))throw Error('调号不合法');
 let effectiveKey=chosen;try{result.notes.forEach(n=>pitchToDegree(n.midi,chosen));}catch{if(key!=='auto')throw Error('当前调号超出音域，请选择 1=C。');effectiveKey='C';warnings.push('自动调号超出八度范围，使用 1=C 保留原音高。');}
 const beatSeconds=60/bpm,unit=beatSeconds/4,origin=result.notes[0].start,phase=Math.round((firstBeat-1)*4),barUnits=meter*4;
 const score={format:'jianpu-melody',version:2,title:title.slice(0,200),key:effectiveKey,meter:[+meter,4],measures:[],spans:[],transcription:{method:result.method,clipStart:result.clipStart,bpm:+bpm,firstNoteTime:origin,grid:'1/16',warnings}};
 let cursor=0,used=0,measure=null,uncertain=0;
 function append(duration,pitch,confidence,source){
  let previous=null;
  while(duration>0){
   if(!measure||used===barUnits){if(score.measures.length>=200)throw Error('片段超过 200 小节，请选取更短片段。');measure={id:crypto.randomUUID(),notes:[],repeatStart:false,repeatEnd:false};score.measures.push(measure);used=0;}
   const max=Math.min(duration,barUnits-used),[amount,base,dots]=DURATIONS.find(d=>d[0]<=max),id=crypto.randomUUID();
   const n={id,degree:0,octave:0,base,dots};if(pitch){Object.assign(n,pitchToDegree(pitch,effectiveKey));n.pitchMidi=pitch;n.confidence=confidence;n.sourceTime=source;}
   measure.notes.push(n);if(previous)score.spans.push({id:crypto.randomUUID(),type:'tie',from:previous,to:id});if(pitch)previous=id;
   duration-=amount;used+=amount;cursor+=amount;
  }
 }
 for(let i=0;i<result.notes.length;i++){
  const e=result.notes[i];if(!Number.isInteger(e.midi)||!Number.isFinite(e.start)||!Number.isFinite(e.end)||e.end<=e.start||e.start<origin)throw Error('识别时间数据不合法。');
  const start=Math.max(cursor,Math.round((e.start-origin)/unit)+phase),next=result.notes[i+1],nextStart=next?Math.round((next.start-origin)/unit)+phase:Infinity;
  if(start>cursor)append(start-cursor,0,1,null);
  const end=Math.max(start+1,Math.min(Math.round((e.end-origin)/unit)+phase,nextStart)),duration=end-start;
  const before=score.measures.flatMap(m=>m.notes).length;append(duration,e.midi,e.confidence,e.start);for(const n of score.measures.flatMap(m=>m.notes).slice(before))n.centsDeviation=e.centsDeviation;if(e.confidence<.8||e.centsDeviation>35)uncertain++;
 }
 if(used<barUnits)append(barUnits-used,0,1,null);score.measures.at(-1).final=true;
 score.transcription.uncertain=uncertain;score.transcription.sourceNotes=result.notes.length;
 return validate(score);
}
