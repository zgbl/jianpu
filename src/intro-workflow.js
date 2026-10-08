import {transcriptionToScore} from './transcription-score.js';
import {render} from './render.js';
import {ScorePlayer,scoreTimeline} from './playback.js';
import {note,validate,ticks,measureCapacity} from './model.js';
const $=id=>document.getElementById(id);
export function zeroIntroRange(score,{start=0,count=null}={}){
 if(!score)throw Error('请先打开当前谱');
 const measures=score.measures.filter(m=>!m.introPlaceholder),unit=60/(score.transcription?.bpm||score.tempo||120)/16;
 let elapsed=0,end=null;
 for(const m of measures){let used=0;for(const n of m.notes){
  const time=n.gridTimeStart??n.sourceTime;
  if(Number.isFinite(time)){end=time-(elapsed+used)*unit;break;}
  used+=ticks(n);
 }if(end!==null)break;elapsed+=m.manualDurationTicks??measureCapacity(score);}
 if(!Number.isFinite(end)||end<=start)throw Error('无法确定人声所在小节的起点，请先校准小节时间');
 return {start,end,count};
}
export function zeroIntroScore(score,{start=0,end,count=null}={}){
 if(!score)throw Error('请先打开当前谱');
 const bpm=score.transcription?.bpm||score.tempo||120;
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)throw Error('请选择有效前奏范围');
 const [beats,denominator]=score.meter,seconds=60/bpm*beats*4/denominator;
 const automatic=count===null,anchor=score.transcription?.barAnchor;
 const onGrid=automatic&&Number.isFinite(anchor)&&Math.abs((end-anchor)/seconds-Math.round((end-anchor)/seconds))<.01;
 const gridStart=onGrid?anchor+Math.ceil((start-anchor)/seconds-1e-7)*seconds:start;
 count=count??Math.max(1,Math.round((end-gridStart)/seconds));
 if(!Number.isInteger(count)||count<1||count>1000)throw Error('前奏小节数应为1–1000');
 const timingStart=onGrid&&end-count*seconds>=start-.001?end-count*seconds:start;
 const next=structuredClone(score);next.lyrics=[];delete next.lyricAlignment;next.spans=[];delete next.chords;delete next.endings;
 next.measures=Array.from({length:count},(_,i)=>({id:crypto.randomUUID(),repeatStart:false,repeatEnd:false,introPlaceholder:true,notes:Array.from({length:beats},(_,j)=>({...note(0,denominator),gridTimeStart:timingStart+(end-timingStart)*(i+j/beats)/count,gridTimeEnd:timingStart+(end-timingStart)*(i+(j+1)/beats)/count}))}));
 next.introPlaceholder={start:timingStart,end,count,bpm,timing:onGrid?'beat-grid':'range-estimate'};
 return validate(next);
}
export function prependZeroIntro(score,range){
 const next=structuredClone(score),existing=next.measures.filter(m=>!m.introPlaceholder);
 range=range||zeroIntroRange(score);
 const first=zeroIntroRange(score).end;
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
 const zeroButton=document.createElement('button');zeroButton.id='fillZeroIntro';zeroButton.textContent='补齐 / 重补前奏（全0）';zeroButton.type='button';
 const countField=document.createElement('input');countField.id='introMeasureCount';countField.type='number';countField.min='1';countField.max='1000';countField.placeholder='自动补齐';countField.style.width='100px';countField.setAttribute('aria-label','前奏小节数，留空按人声小节起点自动补齐');
 const countLabel=document.createElement('label');countLabel.textContent='前奏小节数 ';countLabel.append(countField);$('applyIntro').after(countLabel,zeroButton);
 zeroButton.title='按当前人声所在小节的实际录音时间补齐整段前奏；重新点击会替换旧的全0前奏，不受器乐识别片段长度限制';
 const zeroHint=document.createElement('p');zeroHint.className='hint';zeroHint.textContent='全0补谱自动覆盖整段前奏，不受上方器乐识别片段的结束秒限制；留空按节拍算小节数，也可指定数量后重补。';zeroButton.after(zeroHint);
 const fitButton=document.createElement('button');fitButton.type='button';fitButton.textContent='前奏范围设到人声谱起点';fitButton.title='排除已补的占位小节，读取原人声谱起点；有钢琴声道时选择钢琴';zeroButton.after(fitButton);
 fitButton.onclick=()=>{try{
  const score=getScore();if(!score)throw Error('请先打开当前谱');
  const first=zeroIntroRange(score).end;
  if(!Number.isFinite(first)||first<=0)throw Error('当前谱没有可用的人声起点时间，请手工填写前奏范围');
  const start=+$('introStart').value;if(start>=first)throw Error('前奏开始时间须早于人声谱起点');
  $('introEnd').value=first.toFixed(4);countField.value='';
  const piano=getResult()?.stems?.includes('piano')||bridge.context()?.project.assets.some(a=>a.path===`runs/${getJob()?.id}/piano.wav`);
  if(piano)$('introSource').value='piano';
  const draft=zeroIntroScore(score,{start,end:first});
  message(`前奏范围已设置为 ${start}–${first.toFixed(3)} 秒，估算 ${draft.measures.length} 小节${piano?'；已选择钢琴声道':''}。可点全0补谱，或重新识别前奏试听。`);publish();
 }catch(e){message(e.message);}};
 const range=()=>({start:+$('introStart').value,end:+$('introEnd').value,count:countField.value.trim()?+countField.value:null});
 function fillZeros(){const value=zeroIntroRange(getScore(),range()),s=zeroIntroScore(getScore(),value);applyZeros(value);$('introEnd').value=value.end.toFixed(4);message(`已重新补齐 ${s.measures.length} 个全0前奏小节，到人声小节起点 ${value.end.toFixed(3)} 秒；已替换旧前奏，原人声时间不变。可改小节数后再次补齐。`);publish();}
 zeroButton.onclick=()=>{try{fillZeros();}catch(e){message(e.message);}};
 function refresh(){$('recognizeIntro').disabled=!getResult()||getBusy()||running;$('applyIntro').disabled=!candidate||getBusy()||running;zeroButton.disabled=!getScore()||getBusy()||running;fitButton.disabled=zeroButton.disabled;}
 function preview(){const r=getResult();if(!candidate||!r)return;const current=getScore();const s=candidate.notes.length?transcriptionToScore({...r,notes:candidate.notes},{key:current?.key||'C',bpm:current?.transcription?.bpm||r.estimatedBpm,title:'前奏旋律候选',meter:current?.meter||4}):zeroIntroScore(current,{...range(),start:candidate.start,end:candidate.end});$('introPreview').innerHTML=render(s,null,-1);const play=document.createElement('button');play.textContent='试听前奏 MIDI';play.onclick=()=>{playback?.stop();beforePreview();playback??=new ScorePlayer();playback.play(scoreTimeline(s)).catch(e=>message(e.message));};const stop=document.createElement('button');stop.textContent='停止试听';stop.onclick=()=>playback?.stop();$('introPreview').prepend(play,stop);}
 $('recognizeIntro').onclick=async()=>{const token=++generation;running=true;refresh();try{const response=await fetch('/api/lyrics/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'intro',projectId:bridge.context()?.project.id,runId:getJob()?.id,source:$('introSource').value,start:+$('introStart').value,end:+$('introEnd').value})});const j=await response.json();if(!response.ok)throw Error(j.error);while(token===generation){const res=await fetch(`/api/lyrics/jobs/${j.id}`);const state=await res.json();if(!res.ok)throw Error(state.error);message(`${state.message} · ${Math.round(state.progress*100)}%`);if(state.status==='error'||state.status==='cancelled')throw Error(state.message);if(state.status==='done'){const res=await fetch(`/api/lyrics/jobs/${j.id}/result`);candidate=await res.json();if(!res.ok)throw Error(candidate.error);if(token!==generation)return;preview();message(`生成 ${candidate.notes.length} 个前奏候选音；先试听，再加入当前谱。${candidate.warnings.join(' ')}${candidate.notes.length?'':' 未识别出音符，可点击加入当前谱补全0小节。'}`);publish();break;}await new Promise(r=>setTimeout(r,800));}}catch(e){message(e.message);}finally{if(token===generation){running=false;refresh();}}};
 $('applyIntro').onclick=()=>{try{if(!candidate.notes.length){fillZeros();return;}mergeIntroNotes(getResult(),candidate);apply(candidate);message('前奏已加入当前谱；请对比原曲与简谱播放，保存工程。');publish();}catch(e){message(e.message);}};
 return {refresh,fillZeros,snapshot:()=>({introCandidate:candidate,introStart:$('introStart').value,introEnd:$('introEnd').value,introSource:$('introSource').value,introMeasureCount:countField.value}),reset(){generation++;running=false;candidate=null;playback?.stop();$('introPreview').replaceChildren();refresh();},restore(state){candidate=state.introCandidate||null;for(const id of ['introStart','introEnd','introSource','introMeasureCount'])if(state[id]!==undefined)$(id).value=state[id];if(candidate){try{preview();}catch(e){$('introPreview').replaceChildren();message('前奏候选预览失败：'+e.message+'；当前乐谱仍可编辑。');}}refresh();}};
}
