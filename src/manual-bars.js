// Human bar counts establish the metrical level. Detected pulses can refine
// timing only inside that level; they cannot divide the tempo by two or three.
export function fitManualBars(points,{meter=4,beatTimes=[]}={}){
 if(![2,3,4].includes(+meter)||!Array.isArray(points)||points.length<2)throw Error('至少标定两个小节边界，才能计算小节时长');
 const marks=points.map(p=>({time:+p.time,bar:+p.bar})).sort((a,b)=>a.bar-b.bar);
 if(marks.some((p,i)=>!Number.isFinite(p.time)||p.time<0||!Number.isInteger(p.bar)||p.bar<0||(i&&(p.bar<=marks[i-1].bar||p.time<=marks[i-1].time))))throw Error('小节编号和时间必须分别递增，不能重叠');
 function fit(values){const weight=values.reduce((s,p)=>s+p.weight,0),x=values.reduce((s,p)=>s+p.bar*p.weight,0)/weight,y=values.reduce((s,p)=>s+p.time*p.weight,0)/weight;const variance=values.reduce((s,p)=>s+p.weight*(p.bar-x)**2,0);const duration=values.reduce((s,p)=>s+p.weight*(p.bar-x)*(p.time-y),0)/variance;return {duration,anchor:y-duration*x};}
 const human=fit(marks.map(p=>({...p,weight:50}))),bpm=60*meter/human.duration;
 if(!Number.isFinite(bpm)||bpm<40||bpm>240)throw Error('标定结果超出 40–240 BPM，请检查两个边界之间实际相隔几小节');
 const error=Math.max(...marks.map(p=>Math.abs(p.time-(human.anchor+p.bar*human.duration))));
 if(error>Math.max(.12,human.duration*.06))throw Error('人工边界间隔不一致，请修正小节编号或时间后再计算');
 const quarter=human.duration/meter,detected=beatTimes.filter(t=>Number.isFinite(t)&&t>=marks[0].time&&t<=marks.at(-1).time).map(time=>{const beat=Math.round((time-human.anchor)/quarter),expected=human.anchor+beat*quarter;return {time,bar:beat/meter,weight:1,error:Math.abs(time-expected)};}).filter(p=>p.error<=Math.min(.08,quarter*.15));
 return {version:2,points:marks,bpm:60*meter/human.duration,barDuration:human.duration,anchorTime:human.anchor,detectedUsed:detected.length,manualError:error,manualLocked:true};
}
