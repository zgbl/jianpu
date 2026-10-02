import {transcriptionToScore} from './transcription-score.js';
import {render} from './render.js';
import {ScorePlayer,scoreTimeline} from './playback.js';
const $=id=>document.getElementById(id);
export function mergeIntroNotes(result,intro){
 const vocal=result.notes.filter(n=>n.voice!=='intro');const first=vocal.reduce((t,n)=>Math.min(t,n.start),Infinity);
 if(intro.notes.some(n=>n.end>first+.05))throw Error('前奏范围进入了已识别的人声，请缩短结束时间后重试');
 return {...result,intro,notes:[...intro.notes,...vocal].sort((a,b)=>a.start-b.start)};
}
export function createIntroWorkflow({getResult,getScore,getJob,getBusy,bridge,apply,publish,player,beforePreview=()=>{}}){
 let candidate=null,running=false,generation=0;let playback=player;
 const message=t=>$('introStatus').textContent=t;
 function refresh(){$('recognizeIntro').disabled=!getResult()||getBusy()||running;$('applyIntro').disabled=!candidate?.notes.length||getBusy()||running;}
 function preview(){const r=getResult();if(!candidate||!r)return;const current=getScore();const s=transcriptionToScore({...r,notes:candidate.notes},{key:current?.key||'C',bpm:current?.transcription?.bpm||r.estimatedBpm,title:'前奏旋律候选',meter:current?.meter[0]||4});$('introPreview').innerHTML=render(s,null,-1);const play=document.createElement('button');play.textContent='试听前奏 MIDI';play.onclick=()=>{playback?.stop();beforePreview();playback??=new ScorePlayer();playback.play(scoreTimeline(s)).catch(e=>message(e.message));};const stop=document.createElement('button');stop.textContent='停止试听';stop.onclick=()=>playback?.stop();$('introPreview').prepend(play,stop);}
 $('recognizeIntro').onclick=async()=>{const token=++generation;running=true;refresh();try{const response=await fetch('/api/lyrics/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'intro',projectId:bridge.context()?.project.id,runId:getJob()?.id,source:$('introSource').value,start:+$('introStart').value,end:+$('introEnd').value})});const j=await response.json();if(!response.ok)throw Error(j.error);while(token===generation){const res=await fetch(`/api/lyrics/jobs/${j.id}`);const state=await res.json();if(!res.ok)throw Error(state.error);message(`${state.message} · ${Math.round(state.progress*100)}%`);if(state.status==='error'||state.status==='cancelled')throw Error(state.message);if(state.status==='done'){const res=await fetch(`/api/lyrics/jobs/${j.id}/result`);candidate=await res.json();if(!res.ok)throw Error(candidate.error);if(token!==generation)return;preview();message(`生成 ${candidate.notes.length} 个前奏候选音；先试听，再加入当前谱。${candidate.warnings.join(' ')}`);publish();break;}await new Promise(r=>setTimeout(r,800));}}catch(e){message(e.message);}finally{if(token===generation){running=false;refresh();}}};
 $('applyIntro').onclick=()=>{try{mergeIntroNotes(getResult(),candidate);apply(candidate);message('前奏已加入当前谱；请对比原曲与简谱播放，保存工程。');publish();}catch(e){message(e.message);}};
 return {refresh,snapshot:()=>({introCandidate:candidate,introStart:$('introStart').value,introEnd:$('introEnd').value,introSource:$('introSource').value}),reset(){generation++;running=false;candidate=null;playback?.stop();$('introPreview').replaceChildren();refresh();},restore(state){candidate=state.introCandidate||null;for(const id of ['introStart','introEnd','introSource'])if(state[id]!==undefined)$(id).value=state[id];if(candidate?.notes.length)preview();refresh();}};
}
