export const REVIEW_TYPES=['correct','octave','semitone','missing','extra','boundary','slide','other'];
export const reviewKey=n=>`event:${n.index}:${n.start.toFixed(4)}:${n.end.toFixed(4)}`;
export function validatedReview(record){if(!record||typeof record.key!=='string'||!record.key||record.key.length>180||!REVIEW_TYPES.includes(record.type)||record.midi!==null&&(!Number.isInteger(record.midi)||record.midi<12||record.midi>108)||!Number.isFinite(record.start)||!Number.isFinite(record.end)||record.end<=record.start||record.start<0||typeof record.comment!=='string'||record.comment.length>2000)throw Error('人工标注不合法：请检查音高、范围和错误类型');return structuredClone(record);}
export function debugIssues(data,segments,reviews={}){
 const issues=[];for(const n of data.notes){const reasons=[],delta=Number.isFinite(n.pitchCenterMidi)?Math.abs(n.pitchCenterMidi-n.midi)*100:0;if(n.pitchStatus==='uncertain')reasons.push('不确定音高');if(n.recoveryReason)reasons.push('低可信补回');if(delta>=25)reasons.push(`中心偏差 ${delta.toFixed(1)} 音分`);if(!reasons.length)continue;const key=reviewKey(n);issues.push({key,index:n.index,start:n.performanceStart,end:n.performanceEnd,kinds:[...(n.recoveryReason?['recovered']:[]),...(n.pitchStatus==='uncertain'?['uncertain']:[]),...(delta>=25?['deviation']:[])],severity:n.recoveryReason?3:n.pitchStatus==='uncertain'?2:1,label:`#${n.index+1} · ${reasons.join(' / ')}`,reviewed:!!reviews[key]});}
 for(const s of segments)if(s.note.reviewReason==='unresolved-gap'){const key=`gap:${s.note.id}`;issues.push({key,index:null,start:s.start,end:s.end,kinds:['gap'],severity:4,label:`第 ${s.measure} 小节 · 未识别 ?`,reviewed:!!reviews[key]});}
 return issues.sort((a,b)=>b.severity-a.severity||a.start-b.start);
}
export function frameGates(frame,data){const floors=data.meta.decoderThresholds||{},cfg=data.diagnostics.config||{},prob=floors.voicingProbability??cfg.continuationVoicing??.35,energy=floors.energy??data.diagnostics.energyThreshold;
 const ratioLimit=floors.sourceRatio;
 return [
 {name:'有声 / 概率',value:frame.voicingProbability,threshold:prob,pass:frame.voiced===false?false:Number.isFinite(frame.voicingProbability)?frame.voicingProbability>=prob:null},
 {name:'人声能量',value:frame.energy,threshold:energy,pass:Number.isFinite(frame.energy)&&Number.isFinite(energy)?frame.energy>=energy:null},
 {name:'人声/原曲比',value:frame.sourceRatio,threshold:ratioLimit,pass:ratioLimit===0?true:Number.isFinite(frame.sourceRatio)&&Number.isFinite(ratioLimit)?frame.sourceRatio>=ratioLimit:frame.decoderRejection==='source-ratio'?false:null}
 ];}
