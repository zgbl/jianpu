import {keyName,mod12} from './pitch.js';
const major=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88],minor=[6.33,2.68,3.52,5.38,2.6,3.53,2.54,4.75,3.98,2.69,3.34,3.17],scale=[0,2,4,5,7,9,11];
function correlation(a,b){const ma=a.reduce((s,v)=>s+v,0)/12,mb=b.reduce((s,v)=>s+v,0)/12;let sum=0,aa=0,bb=0;for(let i=0;i<12;i++){const x=a[i]-ma,y=b[i]-mb;sum+=x*y;aa+=x*x;bb+=y*y;}return aa*bb?sum/Math.sqrt(aa*bb):0;}
const eventPitch=e=>Number.isFinite(e.pitchCenterMidi)?e.pitchCenterMidi:e.midi;
function terminalEvidence(valid){
 // Take a sustained stable core, not a short breath/fall at the end.
 const ordered=[...valid].sort((a,b)=>(b.performanceEnd??b.end)-(a.performanceEnd??a.end));
 const index=ordered.findIndex(e=>{
  const hasCore=Number.isFinite(e.coreStart)&&Number.isFinite(e.coreEnd),duration=hasCore?e.coreEnd-e.coreStart:e.end-e.start;
  return duration>=(hasCore?.2:.25)&&(e.pitchReliability??e.confidence??1)>=.5&&Math.abs(eventPitch(e)-Math.round(eventPitch(e)))<=.35;
 });
 if(index<0)return null;const e=ordered[index],hasCore=Number.isFinite(e.coreStart)&&Number.isFinite(e.coreEnd);
 return {index:e.index??valid.indexOf(e),midi:Math.round(eventPitch(e)),doPc:mod12(Math.round(eventPitch(e))),start:hasCore?e.coreStart:e.start,end:hasCore?e.coreEnd:e.end,kind:hasCore?'stable-core':'legacy-duration',skippedTrailing:index};
}
function phraseEvidence(events,valid){
 // Only an observed silence counts: a rejected pitch event is not a pause.
 const ordered=events.filter(e=>Number.isFinite(e.start)&&Number.isFinite(e.end)&&e.end>e.start).sort((a,b)=>a.start-b.start),reliable=new Set(valid),ends=[];
 let soundingEnd=-Infinity;
 for(let i=0;i<ordered.length-1;i++){
  const e=ordered[i];soundingEnd=Math.max(soundingEnd,e.performanceEnd??e.end);
  if(ordered[i+1].start-soundingEnd<.5||!reliable.has(e))continue;
  const hasCore=Number.isFinite(e.coreStart)&&Number.isFinite(e.coreEnd),start=hasCore?e.coreStart:e.start,end=hasCore?e.coreEnd:e.end;
  if(end-start<.12||Math.abs(eventPitch(e)-Math.round(eventPitch(e)))>.35)continue;
  ends.push({midi:Math.round(eventPitch(e)),start,end,weight:Math.min(1.5,end-start)*Math.min(1,e.pitchReliability??e.confidence??1)});
 }
 const histogram=Array(12).fill(0);for(const e of ends)histogram[mod12(e.midi)]+=e.weight;
 return {ends,histogram,total:histogram.reduce((a,b)=>a+b,0),count:ends.length,gapSeconds:.5};
}
export function rankDo(events,{strategy='last-note'}={}){
 // V3 pitch centers are ALREADY tuning-corrected. Never subtract it twice.
 const valid=events.filter(e=>Number.isFinite(e.midi)&&e.midi>0&&Number.isFinite(e.start)&&Number.isFinite(e.end)&&e.end>e.start&&!e.uncertain&&e.pitchStatus!=='uncertain'&&!e.recoveryReason&&Number.isFinite(e.pitchReliability??e.confidence??1)&&(e.pitchReliability??e.confidence??1)>0).sort((a,b)=>a.start-b.start);
 const histogram=Array(12).fill(0);for(const e of valid){const weight=(e.end-e.start)*Math.min(1,e.pitchReliability??e.confidence??1);histogram[mod12(Math.round(Number.isFinite(e.pitchCenterMidi)?e.pitchCenterMidi:e.midi))]+=weight;}
 const total=histogram.reduce((s,v)=>s+v,0),terminal=terminalEvidence(valid),lastPc=terminal?.doPc??null,phrases=phraseEvidence(events,valid);
 const coverage=d=>total?scale.reduce((s,i)=>s+histogram[mod12(d+i)],0)/total:0,maxCoverage=Math.max(...Array.from({length:12},(_,d)=>coverage(d)));
 // A terminal note breaks plausible-key ties; it cannot force most of the song out of scale.
 const terminalAccepted=!!terminal&&maxCoverage-coverage(lastPc)<=.18;
 const candidates=Array.from({length:12},(_,d)=>{const inScale=total?scale.reduce((s,i)=>s+histogram[mod12(d+i)],0)/total:0,tonic=total?(histogram[d]+.8*histogram[mod12(d+9)])/total:0,plausible=maxCoverage-inScale<=.12,cadence=strategy==='last-note'&&plausible&&terminal&&(terminalAccepted||lastPc===mod12(d+9))?(lastPc===d?.04:lastPc===mod12(d+9)?.032:lastPc===mod12(d+7)?.012:0):0;
 const phraseSupport=phrases.total?(phrases.histogram[d]+.8*phrases.histogram[mod12(d+9)]+.35*phrases.histogram[mod12(d+7)])/phrases.total:0,phraseScore=strategy==='last-note'&&plausible?.12*Math.min(1,phrases.count/4)*phraseSupport:0;
 const majorScore=correlation(histogram,Array.from({length:12},(_,i)=>major[mod12(i-d)])),minorScore=correlation(histogram,Array.from({length:12},(_,i)=>minor[mod12(i-d-9)]));
 const profile=Math.max(majorScore,minorScore),distributionScore=.65*inScale+.25*(profile+1)/2+.1*tonic;
 return {doPc:d,key:keyName(d),score:distributionScore+cadence+phraseScore,phraseScore,phraseSupport,endingScore:cadence+phraseScore,distributionScore,inScale,accidentalShare:1-inScale,tonic,cadence,endRole:lastPc===d?1:lastPc===mod12(d+9)?6:null,profile,mode:minorScore>majorScore?'relative-minor':'major'};
 }).sort((a,b)=>b.score-a.score||a.doPc-b.doPc);
 const distributionWinner=[...candidates].sort((a,b)=>b.distributionScore-a.distributionScore)[0];
 return {method:strategy==='last-note'&&(terminalAccepted||phrases.count)?'ending-evidence-v2':'scale-support-v1',terminal,phrases,weights:{terminal:.04,phrases:.12,maxEndingBonus:.16},terminalAccepted,terminalRejected:!!terminal&&!terminalAccepted,maxCoverage,strategy,distributionWinner:distributionWinner.key,conflict:!!terminal&&strategy==='last-note'&&distributionWinner.doPc!==candidates[0].doPc,candidates,histogram,effectiveSeconds:total,used:valid.length,excluded:events.length-valid.length,supported:histogram.filter(v=>v>total*.03).length,ambiguous:!total||candidates[0].score-candidates[1].score<.035,status:total?'suggested':'unknown'};
}
export function doEvidence(events){const all=rankDo(events),start=Math.min(...events.map(e=>e.start)),end=Math.max(...events.map(e=>e.end)),span=end-start,early=rankDo(events.filter(e=>e.start<start+span*.5),{strategy:'distribution'}),late=rankDo(events.filter(e=>e.start>=start+span*2/3),{strategy:'distribution'});return {...all,early,late,suspectedModulation:early.effectiveSeconds>=4&&late.effectiveSeconds>=4&&!early.ambiguous&&!late.ambiguous&&early.candidates[0].doPc!==late.candidates[0].doPc};}
