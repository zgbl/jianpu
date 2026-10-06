// Soft harmony priors. Absolute chord roots are never transposed by Do relabeling.
import {guitarFingering} from './guitar-fingering.js';
const PC={C:0,Db:1,'C#':1,D:2,Eb:3,'D#':3,E:4,F:5,Gb:6,'F#':6,G:7,Ab:8,'G#':8,A:9,Bb:10,'A#':10,B:11};
const SCALE=[0,2,4,5,7,9,11];
export const POP_PROGRESSIONS=[[4,5,3,6],[4,5,3,6,2,5,1],[1,5,6,4],[6,4,1,5],[1,6,4,5],[1,6,2,5],[2,5,1],[1,5,6,3,4,1,4,5]];
export function chordInfo(label){
 const m=label.match(/^([A-G](?:#|b)?)(.*)$/);if(!m)return null;
 const root=PC[m[1]],suffix=m[2],minor=suffix.startsWith('m')&&!suffix.startsWith('maj');
 const extended=/9|11|13/.test(suffix),hasSeventh=suffix.includes('7')||extended&&!suffix.includes('add');
 const intervals=[0,suffix==='dim'?3:minor?3:4,suffix==='dim'?6:7];
 if(hasSeventh)intervals.push(suffix.startsWith('maj')?11:10);
 if(extended)intervals.push(2);if(/11|13/.test(suffix))intervals.push(5);if(/13/.test(suffix))intervals.push(9);
 return {root,suffix,minor,extended,seventhPc:hasSeventh?(root+intervals[3])%12:null,extensionPcs:extended?intervals.slice(hasSeventh?4:3).map(i=>(root+i)%12):[],pcs:intervals.map(i=>(root+i)%12)};
}
export function configureHarmony(score,analysis){
 if(['current-score-melody-v1','current-score-melody-v2','current-score-melody-v3','current-score-melody-v4'].includes(analysis.method))return melodyHarmony(score,{granularity:analysis.granularity||'half',color:analysis.color||0,seventhLimit:analysis.seventhLimit??30});
 const doPc=PC[score.key],scale=SCALE.map(v=>(v+doPc)%12),degree=c=>SCALE.indexOf((c.root-doPc+12)%12)+1;
 const observations=(analysis.chords||[]).filter(c=>c.label).sort((a,b)=>a.start-b.start),transition=(a,b)=>{if(a===b)return 0;const da=degree(chordInfo(a)),db=degree(chordInfo(b));return POP_PROGRESSIONS.some(p=>p.some((v,i)=>v===da&&p[(i+1)%p.length]===db))?.055:0;};
 let beam=[{score:0,path:[],last:null,run:0}];
 for(const w of observations){
  const notes=score.measures.flatMap(m=>m.notes).filter(n=>n.degree&&Number.isFinite(n.pitchMidi)&&Number.isFinite(n.sourceTime)&&n.sourceTime>=w.start&&n.sourceTime<w.end),unique=[...new Map(notes.map(n=>[n.sourceEventId||n.id,n])).values()];
  const options=(w.candidates?.length?w.candidates:[{label:w.label,score:w.score||0}]).map(c=>{const info=chordInfo(c.label);if(!info)return null;const diatonic=info.pcs.every(pc=>scale.includes(pc));let melody=0,weight=0;for(const n of unique){const emphasis=n.sourceTime-w.start<Math.min(.5,(w.end-w.start)*.2)?2:1;const length=Math.min(1,Math.max(.05,(n.sourceEnd??n.sourceTime+.2)-n.sourceTime));weight+=emphasis*length;melody+=emphasis*length*(info.pcs.includes(n.pitchMidi%12)?1:0);}return {...c,value:c.score+.07*(diatonic?1:0)+.05*(weight?melody/weight:0)-(info.suffix.includes('7')?.025:0),diatonic,melodySupport:weight?melody/weight:null};}).filter(Boolean).sort((a,b)=>b.value-a.value).slice(0,10);
  const next=[];for(const state of beam)for(const c of options){const run=state.last===c.label?state.run+1:1;const hold=(analysis.windowsPerMeasure||1)*2;const excess=Math.max(0,run-hold);next.push({score:state.score+c.value+transition(state.last||c.label,c.label)-.09*excess,path:[...state.path,{...w,label:c.label,score:c.score,diatonic:c.diatonic,melodySupport:c.melodySupport}],last:c.label,run});}beam=next.sort((a,b)=>b.score-a.score).slice(0,32);
 }
 const raw=beam[0]?.path||[],chords=[];for(const c of raw){const prev=chords.at(-1);if(prev&&prev.measureId===c.measureId&&prev.label===c.label&&Math.abs(prev.end-c.start)<.01)prev.end=c.end;else chords.push({...c,source:'automatic'});}
 return {chords,report:{version:2,do:score.key,weights:{audio:1,diatonic:.07,melody:.05,progression:.055,seventhPenalty:.025,longHoldPenalty:.09},progressions:POP_PROGRESSIONS,warning:'配法为建议，长驻和弦仅软惩罚；不能替代重拍校准或原曲核验。'}};
}

// Harmonize the edited score in written order. Recording timestamps and cached
// detector MIDI must not influence pitches, durations or bar boundaries here.
export function melodyHarmony(score,{granularity='half',color=0,seventhLimit=30}={}){
 const seventhRatio=Math.max(0,Math.min(60,Number.isFinite(Number(seventhLimit))?Number(seventhLimit):30))/100;
 const suffixes=['','m','m','','','m','dim'],names=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
 const palette=SCALE.map((pc,i)=>names[(PC[score.key]+pc)%12]+suffixes[i]);for(const [i,suffix] of ['maj7','m7','m7','maj7','7','m7'].entries())palette.push(names[(PC[score.key]+SCALE[i])%12]+suffix);
 const colorPreference=Math.max(0,Math.min(60,Number(color)||0))/100,targetRatio=Math.min(.4,colorPreference),scale=SCALE.map(pc=>(PC[score.key]+pc)%12);
 if(colorPreference>0)for(const label of [...palette].filter(label=>chordInfo(label).seventhPc!==null))for(const extension of ['9','11','13']){const candidate=label.replace('7',extension);if(chordInfo(candidate).pcs.every(pc=>scale.includes(pc)))palette.push(candidate);}
 const playablePalette=palette.filter(label=>guitarFingering(label));
 const manual=new Map((score.chords||[]).filter(c=>c.source==='manual').map(c=>[c.measureId,c]));
 const duration=n=>64/n.base*(n.dots?1.5:1)*(n.tuplet?n.tuplet.normal/n.tuplet.actual:1);
 const capacity=score.meter[0]*64/score.meter[1];
 const bars=score.measures.flatMap(m=>{
  let position=0;const events=[];
  for(const n of m.notes){const length=duration(n);if(n.degree&&n.reviewReason!=='unresolved-gap'&&!n.manualSuppressed)events.push({pc:(PC[score.key]+SCALE[n.degree-1]+(n.accidental||0)+12)%12,start:position,end:position+length});position+=length;}
  const length=Math.max(capacity,position),step=granularity==='measure'?length:length/2,pinned=manual.get(m.id);
  const windows=[];
  for(let startTick=0;startTick<length-1e-9;startTick+=step){const endTick=Math.min(length,startTick+step),window={measureId:m.id,startTick,endTick};
   if(pinned){windows.push({...window,options:[{...pinned,...window,value:0}]});continue;}
   const tones=events.flatMap(e=>{const overlap=Math.min(endTick,e.end)-Math.max(startTick,e.start);return overlap>0?[{pc:e.pc,weight:overlap*(Math.abs(e.start-startTick)<1e-6?1.5:1)}]:[];});
   if(!tones.length){windows.push({...window,options:[]});continue;}
   const total=tones.reduce((sum,t)=>sum+t.weight,0);
   const options=playablePalette.flatMap(label=>{const c=chordInfo(label),seventh=c.seventhPc!==null,seventhSupport=seventh?tones.reduce((sum,t)=>sum+(t.pc===c.seventhPc?t.weight:0),0)/total:0;
    // A brief passing seventh is insufficient to upgrade a plain triad.
    if(seventh&&seventhSupport<.2)return [];
    if(c.extended&&tones.reduce((sum,t)=>sum+(c.extensionPcs.some(pc=>pc===t.pc)?t.weight:0),0)/total<.2)return [];
    const support=tones.reduce((sum,t)=>sum+t.weight*(c.pcs.includes(t.pc)?1:0),0)/total;
    return [{...window,label,source:'automatic',melodySupport:support,extended:c.extended,seventh:seventh&&!c.extended,seventhSupport:seventh?seventhSupport:undefined,value:support-(c.suffix==='dim'?.12:0)-(c.extended?.04*(1-colorPreference):0)}];});
   windows.push({...window,options});
  }
  return windows;
 });
 let beam=[{value:0,path:[],last:null,history:[],matches:[],autoCount:0,extendedCount:0,seventhCount:0}];
 const remainingAutomatic=Array(bars.length+1).fill(0);for(let i=bars.length-1;i>=0;i--)remainingAutomatic[i]=remainingAutomatic[i+1]+(bars[i].options.length&&bars[i].options[0].source!=='manual'?1:0);
 const rootDegree=label=>{const info=chordInfo(label);return info?SCALE.indexOf((info.root-PC[score.key]+12)%12)+1:0;};
 for(const [index,bar] of bars.entries()){
  if(!bar.options.length){beam=beam.map(s=>({...s,last:null,history:[]}));continue;}
  // Progression rewards can resolve ambiguity, but cannot override a clearly
  // better melody fit. Manual locks are never filtered out.
  const best=Math.max(...bar.options.map(c=>c.value));
  const triad=bar.options.filter(c=>c.source!=='manual'&&!c.extended&&!c.seventh).sort((a,b)=>b.value-a.value)[0];
  const options=bar.options.filter(c=>c.source==='manual'||c===triad||best-c.value<=.18+1e-9),paths=[];

  for(const state of beam)for(const c of options){
   if(c.source!=='manual'&&c.extended&&(state.extendedCount+1)/Math.max(1,state.autoCount+1)>.4+1e-9)continue;
   const history=[...state.history,rootDegree(c.label)].slice(-8);
   const a=state.last&&rootDegree(state.last),b=rootDegree(c.label);
   const common=a&&POP_PROGRESSIONS.some(p=>p.some((v,i)=>i<p.length-1&&v===a&&p[i+1]===b));
   const complete=POP_PROGRESSIONS.filter(p=>p.length<=history.length&&p.every((v,i)=>v===history[history.length-p.length+i])).sort((a,b)=>b.length-a.length)[0];
   const prefix=!complete&&POP_PROGRESSIONS.some(p=>p.length>3&&history.length>=3&&p.slice(0,3).every((v,i)=>v===history[history.length-3+i]));
   const progressionReward=complete?Math.min(.15,.025*complete.length):prefix?.01:0;
   const autoCount=state.autoCount+(c.source==='manual'?0:1),extendedCount=state.extendedCount+(c.source!=='manual'&&c.extended?1:0);
   const seventhCount=state.seventhCount+(c.source!=='manual'&&c.seventh?1:0);
   if(seventhCount>Math.floor(seventhRatio*(autoCount-extendedCount+remainingAutomatic[index+1])+1e-9))continue;
   const excess=Math.max(0,extendedCount-targetRatio*autoCount),oldExcess=Math.max(0,state.extendedCount-targetRatio*state.autoCount);
   const colorCost=.2*(excess-oldExcess);
   paths.push({autoCount,extendedCount,seventhCount,value:state.value-colorCost+c.value+(common?.03:0)+(state.last===c.label?.015:0)-(state.last&&state.last!==c.label?.04:0)+progressionReward,path:[...state.path,c],last:c.label,history,matches:complete?[...state.matches,{endingMeasureId:bar.measureId,degrees:[...complete],reward:progressionReward}]:state.matches});
  }
  const sorted=paths.sort((a,b)=>b.value-a.value),quotaPaths=new Map();for(const state of sorted)if(!state.extendedCount&&!quotaPaths.has(state.seventhCount))quotaPaths.set(state.seventhCount,state);
  beam=[...new Set([...sorted.slice(0,48),...quotaPaths.values()])];
 }
 const chords=[];
 for(const {value,...c} of (beam[0]?.path||[]).filter(c=>c.source!=='manual')){
  const previous=chords.at(-1);
  if(previous&&previous.measureId===c.measureId&&previous.label===c.label&&Math.abs(previous.endTick-c.startTick)<1e-6){const a=previous.endTick-previous.startTick,b=c.endTick-c.startTick;previous.melodySupport=(a*previous.melodySupport+b*c.melodySupport)/(a+b);previous.endTick=c.endTick;}
  else chords.push(c);
 }
 // Merging repeated triads can inflate the visible seventh-marker fraction.
 // Downgrade the least-supported sevenths, preserving root and major/minor,
 // until the displayed non-complex chord count also satisfies the limit.
 const ordinary=()=>chords.filter(c=>!c.extended),sevenths=()=>ordinary().filter(c=>c.seventh);
 while(sevenths().length>Math.floor(seventhRatio*ordinary().length+1e-9)){
  const c=sevenths().sort((a,b)=>(a.seventhSupport||0)-(b.seventhSupport||0))[0];
  c.simplifiedFrom=c.label;c.label=c.label.match(/^[A-G](?:#|b)?/)[0]+(chordInfo(c.label).minor?'m':'');c.seventh=false;c.simplificationReason='seventh-ratio-limit';c.melodySupport=Math.max(0,c.melodySupport-(c.seventhSupport||0));
  for(let i=chords.length-1;i>0;i--){const a=chords[i-1],b=chords[i];if(a.measureId===b.measureId&&a.label===b.label&&Math.abs(a.endTick-b.startTick)<1e-6){const x=a.endTick-a.startTick,y=b.endTick-b.startTick;a.melodySupport=(x*a.melodySupport+y*b.melodySupport)/(x+y);a.endTick=b.endTick;chords.splice(i,1);}}
 }
 const seventhReport={limit:seventhRatio,actual:ordinary().length?sevenths().length/ordinary().length:0,seventhChords:sevenths().length,ordinaryChords:ordinary().length,includesManual:false};
 return {chords,report:{version:1,method:'current-score-melody-v4',do:score.key,timeBase:'written-measures',granularity,seventhLimit:Math.round(seventhRatio*100),seventhReport,color:Math.round(colorPreference*100),colorReport:{target:targetRatio,preference:colorPreference,max:0.4,actual:beam[0]?.autoCount?beam[0].extendedCount/beam[0].autoCount:0,extendedSlots:beam[0]?.extendedCount||0,automaticSlots:beam[0]?.autoCount||0,includesManual:false},progressionMatches:beam[0]?.matches||[],weights:{melody:1,maxLocalScoreLoss:.18,adjacentProgression:.03,sameChord:.015,threeChordPrefix:.01,completeProgressionPerChord:.025,maxCompleteProgression:.15,chordChangeCost:.04,seventhPenalty:0,minSeventhSupport:.2,maxExtendedShare:.4,beamWidth:48},warning:'根据当前旋律、时值和小节建议和弦；配法不唯一，不等同于原曲编配。'}};
}
export function harmonizeScore(score,options={}){
 const next=structuredClone(score),configured=melodyHarmony(score,options),manual=(score.chords||[]).filter(c=>c.source==='manual');
 next.chords=[...configured.chords,...manual];next.chordAnalysis={method:'current-score-melody-v4',timeBase:'written-measures',granularity:options.granularity||'half',color:configured.report.color,seventhLimit:configured.report.seventhLimit};next.chordConfiguration=configured.report;return next;
}
