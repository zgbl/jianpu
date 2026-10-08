import {configureHarmony} from './chord-harmony.js';
// One pitch convention for transcription, editing, calibration and playback.
export const SCALE=[0,2,4,5,7,9,11];
export const KEY_NAMES=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
export const mod12=x=>((x%12)+12)%12;
const ROOTS={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
export function keyPc(key){const m=/^([A-G])([#b]?)$/.exec(String(key).replaceAll('♯','#').replaceAll('♭','b'));if(!m)throw Error('调号不合法');return mod12(ROOTS[m[1]]+(m[2]==='#'?1:m[2]==='b'?-1:0));}
export const keyName=pc=>KEY_NAMES[mod12(pc)];
export const displayKey=key=>String(key).replace('#','♯').replace('b','♭');
export function referenceDo(score){return score.keyMap?.referenceDoMidi??60+keyPc(score.key);}
// Move notation dots, not sounding pitches. Lowering the reference raises dots.
export function shiftOctaveNotation(score,direction){
 if(![-1,1].includes(direction))throw Error('八度标记只能上移或下移一组');
 const next=structuredClone(score);
 for(const m of next.measures)for(const n of m.notes)for(const pitched of [n,n.grace].filter(Boolean)){
  if(!pitched.degree)continue;
  const octave=(pitched.octave||0)+direction;
  if(octave< -2||octave>2)throw Error('移动后超出两组八度标记范围，未修改乐谱');
  pitched.octave=octave;
 }
 next.keyMap={...(score.keyMap||legacyKeyMap(score)),referenceDoMidi:referenceDo(score)-12*direction,revision:crypto.randomUUID()};
 return next;
}
export function noteMidi(n,score){return referenceDo(score)+SCALE[n.degree-1]+12*(n.octave||0)+(n.accidental||0);}
export function pitchToDegree(midi,key,reference=60+keyPc(key)){
 if(!Number.isInteger(midi)||!Number.isInteger(reference))throw Error('音高必须是整数 MIDI');
 const distance=midi-reference,pc=mod12(distance);let index=SCALE.indexOf(pc),accidental=0,octave=Math.floor(distance/12);
 if(index<0){if(String(key).includes('b')||String(key).includes('♭')){index=SCALE.findIndex(v=>v>pc);accidental=-1;}else{index=SCALE.findLastIndex(v=>v<pc);accidental=1;}}
 if(octave< -2||octave>2)throw Error('音域超过当前简谱两组八度范围，请调整无八度点的 1 的 MIDI 位置');
 return {degree:index+1,octave,...(accidental?{accidental}:{})};
}
export function legacyKeyMap(score){return {version:1,status:'unknown',source:'legacy',doPc:keyPc(score.key),doSpelling:score.key,referenceDoMidi:60+keyPc(score.key),tonicPc:null,mode:'unknown',notationPolicy:'major-degree-template',tuningCents:0,locked:false,anchors:[],segments:[]};}
export function validateKeyMap(map,key){
 if(!map||map.version!==1||!['unknown','suggested','confirmed','conflict'].includes(map.status)||!Number.isInteger(map.doPc)||map.doPc<0||map.doPc>11||map.doPc!==keyPc(key)||!Number.isInteger(map.referenceDoMidi)||mod12(map.referenceDoMidi)!==map.doPc||typeof map.locked!=='boolean'||(map.locked&&map.status!=='confirmed'))throw Error('Do 校准状态不合法');
 if(!['unknown','major','minor'].includes(map.mode)||map.tonicPc!==null&&(!Number.isInteger(map.tonicPc)||map.tonicPc<0||map.tonicPc>11))throw Error('调性主音不合法');
 if(!Array.isArray(map.anchors)||map.anchors.length>64||!Array.isArray(map.segments)||!Number.isFinite(map.tuningCents))throw Error('Do 校准记录不合法');
 for(const a of map.anchors)if(!Number.isFinite(a.start)||!Number.isFinite(a.end)||a.start<0||a.end<=a.start||!Number.isInteger(a.degree)||a.degree<1||a.degree>7||![-1,0,1].includes(a.accidental)||!Number.isFinite(a.midi)||!Number.isInteger(a.doPc)||a.doPc<0||a.doPc>11)throw Error('Do 音级锚点不合法');
 return map;
}
export function relabelScore(score,key,map={}){
 keyPc(key);const next=structuredClone(score),ref=map.referenceDoMidi??60+keyPc(key);
 for(const m of next.measures)for(const n of m.notes){if(!n.degree)continue;const midi=noteMidi(n,score),grace=n.grace?noteMidi(n.grace,score):null;
  const p=pitchToDegree(midi,key,ref);delete n.accidental;Object.assign(n,p);
  if(grace!==null){delete n.grace.accidental;Object.assign(n.grace,pitchToDegree(grace,key,ref));}
 }
 next.key=key;next.keyMap={...legacyKeyMap(next),...map,doPc:keyPc(key),doSpelling:key,referenceDoMidi:ref,revision:crypto.randomUUID()};validateKeyMap(next.keyMap,key);if(next.chordAnalysis){const configured=configureHarmony(next,next.chordAnalysis);next.chords=[...configured.chords.filter(c=>!(score.chords||[]).some(m=>m.source==='manual'&&m.measureId===c.measureId)),...(score.chords||[]).filter(c=>c.source==='manual')];next.chordConfiguration=configured.report;}return next;
}
export function anchorDo(midi,degree,accidental=0){if(!Number.isFinite(midi)||!Number.isInteger(degree)||degree<1||degree>7||![-1,0,1].includes(accidental))throw Error('音级锚点不合法');return mod12(Math.round(midi)-SCALE[degree-1]-accidental);}
export function anchorConsensus(anchors){const pcs=[...new Set(anchors.map(a=>a.doPc))];return {status:pcs.length>1?'conflict':anchors.length>=2&&new Set(anchors.map(a=>a.degree)).size>=2?'verified':'insufficient',doPc:pcs.length===1?pcs[0]:null};}
export function concertPc(key,capo,meaning){if(!['concert','fingering'].includes(meaning)||!Number.isInteger(capo)||capo< -12||capo>12)throw Error('请说明实际调或指型调及 -12–12 半音移调');return mod12(keyPc(key)+(meaning==='fingering'?capo:0));}
