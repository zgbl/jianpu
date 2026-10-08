import {keyPc,keyName} from './pitch.js';
const SHARPS=['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
export function shiftChordLabel(label,semitones){
 if(typeof label!=='string'||!Number.isInteger(semitones))throw Error('和弦或移调参数不合法');
 const match=/^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(label);
 if(!match)throw Error('和弦字母不合法');
 const name=root=>SHARPS[((keyPc(root)+semitones)%12+12)%12];
 return name(match[1])+match[2]+(match[3]?'/'+name(match[3]):'');
}
export function setGuitarNotation(score,{shapeKey,capo,enabled=true}){
 if(!['C','G'].includes(shapeKey)||!Number.isInteger(capo)||capo< -12||capo>12)throw Error('请选择 C/G 指型及 -12–12 半音移调');
 const next=structuredClone(score);next.guitarNotation={version:1,mode:enabled?'fingering':'concert',shapeKey,capo};return next;
}
export const recommendedCapo=(score,shapeKey)=>{const delta=(keyPc(score.key)-keyPc(shapeKey)+12)%12;return delta>6?delta-12:delta;};
export function easiestNonnegativeGuitarShape(score){
 const options=['C','G'].map(shapeKey=>({shapeKey,capo:(keyPc(score.key)-keyPc(shapeKey)+12)%12})).filter(option=>option.capo>=0);
 options.sort((a,b)=>a.capo-b.capo||a.shapeKey.localeCompare(b.shapeKey));
 return options[0];
}
const transposed=score=>!!score.guitarNotation&&(score.guitarNotation.mode==='fingering'||score.guitarNotation.capo!==0);
export function displayChordLabel(score,label){return transposed(score)?shiftChordLabel(label,-score.guitarNotation.capo):label;}
export function concertChordLabel(score,label){return transposed(score)?shiftChordLabel(label,score.guitarNotation.capo):label;}
export function guitarCaption(score){
 const g=score.guitarNotation;if(g?.mode==='concert'&&g.capo!==0)return `和弦按 Capo 移调 ${g.capo>0?'+':''}${g.capo} 半音`;
 if(g?.mode!=='fingering')return '';
 const actual=keyName(((keyPc(g.shapeKey)+g.capo)%12+12)%12),setting=g.capo<0?`降调弦 ${Math.abs(g.capo)} 半音`:`Capo ${g.capo} 品`;
 return `吉他 ${g.shapeKey} 指型 · ${setting} · 和弦显示指型${keyPc(actual)!==keyPc(score.key)?`（此组合实际调 ${actual}，与录音 1=${score.key} 不一致）`:''}`;
}
