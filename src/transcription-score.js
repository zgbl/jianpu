import {rankDo} from './do-ranking.js';
import {parseMeter} from './model.js';
import {beatGrid} from './beat-grid.js';
import {quantizeMelodyOnsets} from './melody-quantization.js';
import {suggestedRhythmAnchor} from './rhythm-anchor.js';
import {validate} from './model.js';
import {keyPc,pitchToDegree,legacyKeyMap} from './pitch.js';
export {pitchToDegree} from './pitch.js';
export function suggestKey(notes){return rankDo(notes).candidates[0].key;}
const DURATIONS=[[16,1,0],[12,2,1],[8,2,0],[6,4,1],[4,4,0],[3,8,1],[2,8,0],[1,16,0]];
export function transcriptionToScore(result,{title='识别旋律',bpm=result.estimatedBpm,key='auto',meter=4,firstBeat=1,rhythmMode=result.rhythm?.stableGrid?'stable':result.rhythm?.beatTimes?.length?'tracked':'legacy',barAnchor=suggestedRhythmAnchor(result),notationOctaveShift=1}={}){
 if(!result.notes?.length)throw Error('没有可靠的主旋律音符，无法生成乐谱。');
 if(!Number.isFinite(+bpm)||bpm<40||bpm>240)throw Error('速度应为 40–240 BPM。');
 const signature=parseMeter(meter);meter=signature[0]*4/signature[1];
 if(![2,3,4].includes(+meter)||!Number.isFinite(+firstBeat)||firstBeat<1||firstBeat>meter)throw Error('拍号或第一音的拍位不合法。');
 const evidence=key==='auto'?rankDo(result.notes):null;
 const warnings=[],chosen=key==='auto'?evidence.candidates[0].key:key;keyPc(chosen);
 if(evidence){const t=evidence.terminal;warnings.push(evidence.terminalAccepted?`末音优先建议：1=${chosen}；采用片段内 ${t.start.toFixed(2)}–${t.end.toFixed(2)} 秒的${t.kind==='stable-core'?'稳定核心':'持续音'}，仍待确认。`:`没有可靠末音；按已有音尽量少用升降号，建议 1=${chosen}，仍待确认。`);if(evidence.terminalRejected)warnings.push('末音候选会造成过多调外音，已采用全片段音阶支持的 Do。');if(evidence.conflict)warnings.push(`末音建议与全片段统计不一致（统计候选 1=${evidence.distributionWinner}），请试听确认。`);}

 if(!Number.isInteger(notationOctaveShift)||notationOctaveShift< -2||notationOctaveShift>2)throw Error('简谱八度基准不合法。');
 const effectiveKey=chosen,referenceDoMidi=60+keyPc(chosen)-12*notationOctaveShift;result.notes.forEach(n=>pitchToDegree(n.midi,chosen,referenceDoMidi));
 const beatSeconds=60/bpm,unit=beatSeconds/4,origin=result.intro?0:result.notes.reduce((time,n)=>Math.min(time,n.start),Infinity),phase=Math.round((firstBeat-1)*4),barUnits=meter*4;
 const grid=rhythmMode==='legacy'?null:beatGrid({beatTimes:result.rhythm?.beatTimes,bpm:+bpm,anchor:+barAnchor,tracked:rhythmMode==='tracked'});
 const firstBar=grid?Math.floor(grid.toBeat(origin)/+meter)*+meter:0;
 const toUnit=time=>grid?(grid.toBeat(time)-firstBar)*4:(time-origin)/unit+phase;
 const toTime=value=>grid?grid.toTime(firstBar+value/4):origin+(value-phase)*unit;
 const score={format:'jianpu-melody',version:2,title:title.slice(0,200),key:effectiveKey,meter:signature,measures:[],spans:[],transcription:{detectedBpm:result.rhythm?.estimatedBpm??result.estimatedBpm,method:result.method,...(result.pitchDiagnostics?{pitchDiagnostics:structuredClone(result.pitchDiagnostics)}:{}),clipStart:result.clipStart,bpm:+bpm,firstNoteTime:origin,grid:'1/16',rhythmMode,barAnchor:+barAnchor,barStartTime:toTime(0),notationOctaveShift,...(evidence?{doEvidence:evidence}:{}),...(grid?{beatTimes:rhythmMode==='tracked'?result.rhythm?.beatTimes:[],beatSource:result.rhythm?.source,downbeatConfirmed:result.rhythm?.downbeatConfirmed===true}:{}),warnings}};
 let cursor=0,used=0,measure=null,uncertain=0;
 function append(duration,pitch,confidence,source,sourceEnd,eventKey,reviewReason=null){
  let previous=null;
  while(duration>0){
   if(!measure||used===barUnits){if(score.measures.length>=1000)throw Error('片段超过 1000 小节，请选取更短片段。');measure={id:crypto.randomUUID(),notes:[],repeatStart:false,repeatEnd:false};score.measures.push(measure);used=0;}
   const max=Math.min(duration,barUnits-used),[amount,base,dots]=DURATIONS.find(d=>d[0]<=max),id=crypto.randomUUID();
   const n={id,degree:0,octave:0,base,dots};if(pitch){Object.assign(n,pitchToDegree(pitch,effectiveKey,referenceDoMidi));n.pitchMidi=pitch;n.confidence=confidence;n.sourceTime=source;n.sourceEnd=sourceEnd;n.sourceEventId=eventKey;}
   if(reviewReason){n.reviewRequired=!['alignment-padding','bar-padding'].includes(reviewReason);n.reviewReason=reviewReason;}
   if(grid){n.gridTimeStart=toTime(cursor);n.gridTimeEnd=toTime(cursor+amount);}
   measure.notes.push(n);if(previous)score.spans.push({id:crypto.randomUUID(),type:'tie',from:previous,to:id});if(pitch)previous=id;
   duration-=amount;used+=amount;cursor+=amount;
  }
 }
 let sourceNotes=result.notes,onsetUnits=null;
 if(grid){
  const quantized=quantizeMelodyOnsets(result.notes,toUnit);sourceNotes=quantized.notes;onsetUnits=quantized.units;
  score.transcription.onsetQuantization='ordered-acoustic-events-v1';score.transcription.adjustedOnsets=quantized.adjusted;
  if(quantized.dropped)warnings.push(`${quantized.dropped} 个过密候选音无法在附近十六分格独立排位，保留较可靠的候选，避免将后续小节向后挤移。`);
 }
 for(let i=0;i<sourceNotes.length;i++){
  const e=sourceNotes[i];if(!Number.isInteger(e.midi)||!Number.isFinite(e.start)||!Number.isFinite(e.end)||e.end<=e.start||e.start<origin)throw Error('识别时间数据不合法。');
  const start=Math.max(cursor,onsetUnits?.get(e)??Math.round(toUnit(e.start))),next=sourceNotes[i+1],nextStart=next?(onsetUnits?.get(next)??Math.round(toUnit(next.start))):Infinity;
  if(start>cursor)append(start-cursor,0,0,null,null,null,cursor===0?'alignment-padding':'unresolved-gap');
  const observedEnd=Math.round(toUnit(e.end)),gap=next?next.start-e.end:Infinity;
  // Brief unvoiced consonants / pitch-detector dropouts belong to the held note.
  const sustain=next&&!e.manual&&!next.manual&&gap>=0&&gap<=Math.min(.3,beatSeconds*.5);
  const end=Math.max(start+1,Math.min(sustain?nextStart:observedEnd,nextStart)),duration=end-start;
  if(sustain&&nextStart>observedEnd)score.transcription.bridgedGaps=(score.transcription.bridgedGaps||0)+1;
  const before=score.measures.flatMap(m=>m.notes).length,eventKey=e.sourceEventId||`${Math.round(e.start*1000)}-${e.midi}`;append(duration,e.midi,e.confidence,e.start,e.end,eventKey);for(const n of score.measures.flatMap(m=>m.notes).slice(before)){n.centsDeviation=e.centsDeviation;n.pitchStatus=e.pitchStatus;if(e.pitchStatus==='uncertain'||e.reviewRequired){n.reviewRequired=true;n.reviewReason=e.reviewReason||e.recoveryReason||'uncertain-pitch';}if(e.recoveryReason)n.recoveryReason=e.recoveryReason;}if(e.confidence<.8||e.centsDeviation>35)uncertain++;
 }
 if(used<barUnits)append(barUnits-used,0,1,null,null,null,'bar-padding');score.measures.at(-1).final=true;
 score.transcription.unresolvedGaps=score.measures.flatMap(m=>m.notes).filter(n=>n.reviewReason==='unresolved-gap').length;
 if(score.transcription.unresolvedGaps)warnings.push('问号表示未识别区间，需试听确认；不是已确定的休止符。');
 score.transcription.uncertain=uncertain;score.transcription.sourceNotes=result.notes.length;
 score.keyMap={...legacyKeyMap(score),referenceDoMidi,status:key==='auto'&&evidence.status==='suggested'?'suggested':'unknown',source:key==='auto'?evidence.method:'unconfirmed'};
 return validate(score);
}
