import {configureHarmony} from './chord-harmony.js';
import {audioScoreTimeline} from './audio-score-cursor.js';
export function chordWindows(score,{halves=false}={}){
 const segments=audioScoreTimeline(score),byId=new Map(segments.map(s=>[s.id,s]));
 return score.measures.flatMap(m=>{const timed=m.notes.map(n=>byId.get(n.id)).filter(Boolean);if(!timed.length)return [];const start=Math.min(...timed.map(s=>s.start)),end=Math.max(...timed.map(s=>s.end));return end>start?(halves?[{measureId:m.id,start,end:(start+end)/2},{measureId:m.id,start:(start+end)/2,end}]:[{measureId:m.id,start,end}]):[];});
}
export function applyChords(score,analysis){const next=structuredClone(score);next.chordAnalysis=analysis;const configured=configureHarmony(next,analysis);const manual=(score.chords||[]).filter(c=>c.source==='manual');next.chords=[...configured.chords.filter(c=>!manual.some(m=>m.measureId===c.measureId)),...manual];next.chordConfiguration=configured.report;return next;}
export function chordAtMeasure(score,measure){return (score.chords||[]).find(c=>c.measureId===measure.id);}
