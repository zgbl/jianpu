// Soft harmony priors. Absolute chord roots are never transposed by Do relabeling.
const PC={C:0,Db:1,'C#':1,D:2,Eb:3,'D#':3,E:4,F:5,Gb:6,'F#':6,G:7,Ab:8,'G#':8,A:9,Bb:10,'A#':10,B:11};
const SCALE=[0,2,4,5,7,9,11];
export const POP_PROGRESSIONS=[[4,5,3,6],[4,5,3,6,2,5,1],[1,5,6,4],[6,4,1,5],[1,6,4,5],[1,6,2,5],[2,5,1],[1,5,6,3,4,1,4,5]];
export function chordInfo(label){const m=label.match(/^([A-G](?:#|b)?)(.*)$/);if(!m)return null;const root=PC[m[1]],suffix=m[2],minor=suffix.startsWith('m')&&!suffix.startsWith('maj');const intervals=[0,minor?3:4,7,...(suffix.includes('7')?[suffix.startsWith('maj')?11:10]:[])];return {root,suffix,minor,pcs:intervals.map(i=>(root+i)%12)};}
export function configureHarmony(score,analysis){
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
