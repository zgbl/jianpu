import {transcriptionToScore} from './transcription-score.js';
import {render} from './render.js';
import {ScorePlayer,scoreTimeline} from './playback.js';
import {note,validate} from './model.js';
const $=id=>document.getElementById(id);
export function zeroIntroScore(score,{start=0,end,count=null}={}){
 if(!score)throw Error('请先打开当前谱');
 const bpm=score.transcription?.bpm||score.tempo||120;
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end-start>120)throw Error('请选择有效前奏范围（最多120秒）');
 const [beats,denominator]=score.meter,seconds=60/bpm*beats*4/denominator;
 count=count??Math.max(1,Math.round((end-start)/seconds));
 if(!Number.isInteger(count)||count<1||count>100)throw Error('前奏小节数应为1–100');
 const next=structuredClone(score);next.lyrics=[];delete next.lyricAlignment;next.spans=[];delete next.chords;delete next.endings;
 next.measures=Array.from({length:count},(_,i)=>({id:crypto.randomUUID(),repeatStart:false,repeatEnd:false,introPlaceholder:true,notes:Array.from({length:beats},(_,j)=>({...note(0,denominator),gridTimeStart:start+(end-start)*(i+j/beats)/count,gridTimeEnd:start+(end-start)*(i+(j+1)/beats)/count}))}));
 next.introPlaceholder={start,end,count,bpm,timing:'range-estimate'};
 return validate(next);
}
export function prependZeroIntro(score,range){
 const next=structuredClone(score),existing=next.measures.filter(m=>!m.introPlaceholder);
 const first=Math.min(...existing.flatMap(m=>m.notes.map(n=>n.gridTimeStart??n.sourceTime)).filter(Number.isFinite));
 if(range.end>first+.05)throw Error('前奏结束时间超过当前谱起点，请缩短范围；原谱未修改');
 const intro=zeroIntroScore(score,range);next.measures=[...intro.measures,...existing];next.introPlaceholder=intro.introPlaceholder;
 return validate(next);
}

export function mergeIntroNotes(result,intro){
 const vocal=result.notes.filter(n=>n.voice!=='intro');const first=vocal.reduce((t,n)=>Math.min(t,n.start),Infinity);
 if(intro.notes.some(n=>n.end>first+.05))throw Error('前奏范围进入了已识别的人声，请缩短结束时间后重试');
 return {...result,intro,notes:[...intro.notes,...vocal].sort((a,b)=>a.start-b.start)};
}
export function createIntroWorkflow({getResult,getScore,getJob,getBusy,bridge,apply,applyZeros,publish,player,beforePreview=()=>{}}){
 let candidate=null,running=false,generation=0;let playback=player;
 const message=t=>$('introStatus').textContent=t;
 const zeroButton=document.createElement('button');zeroButton.id='fillZeroIntro';zeroButton.textContent='直接补前奏小节（全0）';zeroButton.type='button';
 const countField=document.createElement('input');countField.id='introMeasureCount';countField.type='number';countField.min='1';countField.max='100';countField.placeholder='自动估算';countField.style.width='100px';countField.setAttribute('aria-label','前奏小节数，留空自动估算');
 const countLabel=document.createElement('label');countLabel.textContent='前奏小节数 ';countLabel.append(countField);$('applyIntro').after(countLabel,zeroButton);
 const fitButton=document.createElement('button');fitButton.type='button';fitButton.textContent='前奏范围设到人声谱起点';fitButton.title='排除已补的占位小节，读取原人声谱起点；有钢琴声道时选择钢琴';zeroButton.after(fitButton);
 fitButton.onclick=()=>{try{
  const score=getScore();if(!score)throw Error('请先打开当前谱');
  const first=Math.min(...score.measures.filter(m=>!m.introPlaceholder).flatMap(m=>m.notes.map(n=>n.gridTimeStart??n.sourceTime)).filter(Number.isFinite));
  if(!Number.isFinite(first)||first<=0)throw Error('当前谱没有可用的人声起点时间，请手工填写前奏范围');
  const start=+$('introStart').value;if(start>=first)throw Error('前奏开始时间须早于人声谱起点');
  $('introEnd').value=first.toFixed(4);countField.value='';
  const piano=getResult()?.stems?.includes('piano')||bridge.context()?.project.assets.some(a=>a.path===`runs/${getJob()?.id}/piano.wav`);
  if(piano)$('introSource').value='piano';
  const draft=zeroIntroScore(score,{start,end:first});
  message(`前奏范围已设置为 ${start}–${first.toFixed(3)} 秒，估算 ${draft.measures.length} 小节${piano?'；已选择钢琴声道':''}。可点全0补谱，或重新识别前奏试听。`);publish();
 }catch(e){message(e.message);}};
 const range=()=>({start:+$('introStart').value,end:+$('introEnd').value,count:countField.value.trim()?+countField.value:null});
 function fillZeros(value=range()){const s=zeroIntroScore(getScore(),value);applyZeros(value);message(`已补 ${s.measures.length} 个全0前奏小节；按范围估算时间，原人声时间不变。小节数可手工校准。`);publish();}
 zeroButton.onclick=()=>{try{fillZeros();}catch(e){message(e.message);}};
 function refresh(){$('recognizeIntro').disabled=!getResult()||getBusy()||running;$('applyIntro').disabled=!candidate||getBusy()||running;zeroButton.disabled=!getScore()||getBusy()||running;fitButton.disabled=zeroButton.disabled;}
 function preview(){const r=getResult();if(!candidate||!r)return;const current=getScore();const s=candidate.notes.length?transcriptionToScore({...r,notes:candidate.notes},{key:current?.key||'C',bpm:current?.transcription?.bpm||r.estimatedBpm,title:'前奏旋律候选',meter:current?.meter||4}):zeroIntroScore(current,{...range(),start:candidate.start,end:candidate.end});$('introPreview').innerHTML=render(s,null,-1);const play=document.createElement('button');play.textContent='试听前奏 MIDI';play.onclick=()=>{playback?.stop();beforePreview();playback??=new ScorePlayer();playback.play(scoreTimeline(s)).catch(e=>message(e.message));};const stop=document.createElement('button');stop.textContent='停止试听';stop.onclick=()=>playback?.stop();$('introPreview').prepend(play,stop);}
 $('recognizeIntro').onclick=async()=>{const token=++generation;running=true;refresh();try{const response=await fetch('/api/lyrics/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'intro',projectId:bridge.context()?.project.id,runId:getJob()?.id,source:$('introSource').value,start:+$('introStart').value,end:+$('introEnd').value})});const j=await response.json();if(!response.ok)throw Error(j.error);while(token===generation){const res=await fetch(`/api/lyrics/jobs/${j.id}`);const state=await res.json();if(!res.ok)throw Error(state.error);message(`${state.message} · ${Math.round(state.progress*100)}%`);if(state.status==='error'||state.status==='cancelled')throw Error(state.message);if(state.status==='done'){const res=await fetch(`/api/lyrics/jobs/${j.id}/result`);candidate=await res.json();if(!res.ok)throw Error(candidate.error);if(token!==generation)return;preview();message(`生成 ${candidate.notes.length} 个前奏候选音；先试听，再加入当前谱。${candidate.warnings.join(' ')}${candidate.notes.length?'':' 未识别出音符，可点击加入当前谱补全0小节。'}`);publish();break;}await new Promise(r=>setTimeout(r,800));}}catch(e){message(e.message);}finally{if(token===generation){running=false;refresh();}}};
 $('applyIntro').onclick=()=>{try{if(!candidate.notes.length){fillZeros({...range(),start:candidate.start,end:candidate.end});return;}mergeIntroNotes(getResult(),candidate);apply(candidate);message('前奏已加入当前谱；请对比原曲与简谱播放，保存工程。');publish();}catch(e){message(e.message);}};
 return {refresh,snapshot:()=>({introCandidate:candidate,introStart:$('introStart').value,introEnd:$('introEnd').value,introSource:$('introSource').value,introMeasureCount:countField.value}),reset(){generation++;running=false;candidate=null;playback?.stop();$('introPreview').replaceChildren();refresh();},restore(state){candidate=state.introCandidate||null;for(const id of ['introStart','introEnd','introSource','introMeasureCount'])if(state[id]!==undefined)$(id).value=state[id];if(candidate)preview();refresh();}};
}
