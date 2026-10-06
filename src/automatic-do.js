import {rankDo} from './do-ranking.js';
import {keyPc,relabelScore} from './pitch.js';

// Upgrade only generated, unconfirmed previews made before automatic Do was wired up.
// Relabel the existing score so lyrics, rhythms and manual note edits survive.
export function repairUnconfirmedDo(score,result,{runId,scoreBasedOn}={}){
 if(!score?.transcription||!result?.notes?.length||!runId||scoreBasedOn!==runId||score.keyMap?.locked||score.keyMap?.status==='confirmed'||score.transcription.doEvidence||!['unconfirmed','legacy',undefined].includes(score.keyMap?.source))return score;
 const evidence=rankDo(result.notes);if(evidence.status!=='suggested')return score;
 const key=evidence.candidates[0].key;
 const next=relabelScore(score,key,{status:'suggested',source:evidence.method,locked:false,referenceDoMidi:48+keyPc(key),anchors:[],segments:[],tonicPc:null,mode:'unknown'});
 next.transcription={...next.transcription,notationOctaveShift:1,doEvidence:evidence,warnings:[...(next.transcription.warnings||[]),'已修复旧版未确认预览：重新判断 Do 和八度基准，保留原音高、节奏与歌词。']};
 return next;
}
