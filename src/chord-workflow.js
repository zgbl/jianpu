import {chordWindows,applyChords} from './chords.js';
import {harmonizeScore} from './chord-harmony.js';

// Report locally before the first network request; never silently ignore a click.
export function createChordWorkflow({getScore,getContext,getDuration=()=>null,getGranularity=()=>'half',getColor=()=>0,getSeventhLimit=()=>30,applyScore,feedback,fetcher=fetch,pollMs=800}){
 let running=false,controller=null,taskId=null;
 async function json(url,options={}){
  const response=await fetcher(url,{...options,signal:controller.signal});
  let value;try{value=await response.json();}catch{throw Error('和弦接口未返回有效数据，请检查本机服务。');}
  if(!response.ok)throw Error(value.error||`和弦请求失败（${response.status}）`);
  return value;
 }
 async function cancel(){
  controller?.abort();
  if(taskId)try{await fetcher(`/api/lyrics/jobs/${taskId}`,{method:'DELETE'});}catch{}
 }
 async function run(mode='score'){
  if(running)return;
  const score=getScore(),context=getContext();
  if(mode==='score'){
   if(!score){feedback('请先生成或打开乐谱，再按谱配和弦。',{error:true});return;}
   feedback('正在按当前乐谱的旋律、时值和小节配和弦…',{busy:true});
   try{const next=harmonizeScore(score,{granularity:getGranularity(),color:getColor(),seventhLimit:getSeventhLimit()});if(!next.chords.length)throw Error('当前谱面没有可用旋律音符，请补正问号或全休止小节。');if(applyScore(next,'已按当前乐谱配和弦')===false)throw Error('请先完成当前谱面编辑。');const assigned=new Set(next.chords.map(c=>c.measureId)),missing=next.measures.length-assigned.size;const matches=[...new Set((next.chordConfiguration.progressionMatches||[]).map(m=>m.degrees.join('')))];feedback(`已按当前乐谱配入 ${next.chords.length} 个和弦，覆盖 ${assigned.size}/${next.measures.length} 个小节${missing?`；${missing} 个小节没有可用旋律，未推测和弦`:''}。${matches.length?`命中完整进行：${matches.join('、')}。`:'未命中完整流行模板，按旋律匹配配置。'}扩展和弦实际占比 ${Math.round((next.chordConfiguration.colorReport?.actual||0)*100)}%（偏好 ${next.chordConfiguration.color||0}%，不含人工和弦）。普通和弦中七和弦 ${next.chordConfiguration.seventhReport?.seventhChords||0}/${next.chordConfiguration.seventhReport?.ordinaryChords||0}，实际占比 ${Math.round((next.chordConfiguration.seventhReport?.actual||0)*100)}%（上限 ${next.chordConfiguration.seventhLimit??30}%）。人工和弦保留，可撤销；这是配法建议，需试听校对。`,{progress:1});}
   catch(e){feedback(`按谱配和弦失败：${e.message}`,{error:true});}
   return;
  }
  if(!score||!context?.runId){feedback('请先打开带有音频识别结果的工程，再识别和弦。',{error:true});return;}
  const identity=JSON.stringify(context),started=Date.now();let phase='正在提交和弦分析任务',progress=null;
  running=true;controller=new AbortController();taskId=null;
  const report=()=>feedback(`${phase} · 已等待 ${Math.floor((Date.now()-started)/1000)} 秒`,{busy:true,progress});
  report();const timer=setInterval(report,1000);
  try{
   const duration=getDuration(),windows=chordWindows(score,{halves:true,duration:Number.isFinite(duration)&&duration>0?duration:601});
   if(!windows.length)throw Error('乐谱没有可用的小节音频时间，请先完成音频识别或时间对齐。');
   const task=await json('/api/lyrics/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'chords',...context,windows})});taskId=task.id;
   if(!taskId)throw Error('和弦任务未创建，请重试。');
   while(true){
    if(identity!==JSON.stringify(getContext())){await cancel();throw Error('工程或音频版本已改变，本次和弦结果未应用。');}
    const state=await json(`/api/lyrics/jobs/${taskId}`);
    progress=Number.isFinite(state.progress)?state.progress:null;phase=`和弦分析${progress===null?'':` ${Math.round(progress*100)}%`} · ${state.message||'正在处理音频'}`;report();
    if(['error','cancelled'].includes(state.status))throw Error(state.message||'和弦分析未完成');
    if(state.status==='done'){
     phase='正在读取和弦结果';report();
     const analysis=await json(`/api/lyrics/jobs/${taskId}/result`);
     if(identity!==JSON.stringify(getContext()))throw Error('工程或音频版本已改变，本次和弦结果未应用。');
     const next=applyChords(getScore(),analysis);
     if(!next.chords.length)throw Error('分析完成，但没有得到可用和弦；请检查音频范围或手动填写和弦。');
     if(applyScore(next,'已识别并自动配和弦')===false)throw Error('和弦已分析，但谱面更新失败，请先完成当前编辑。');
     const assigned=new Set(next.chords.map(c=>c.measureId)),missing=next.measures.map((m,i)=>assigned.has(m.id)?null:i+1).filter(Boolean);
     const first=next.measures.findIndex(m=>assigned.has(m.id))+1;
     const gaps=missing.length?`；${missing.length} 个小节未配出和弦（第 ${missing.slice(0,12).join('、')}${missing.length>12?'…':''} 小节）`:'';
     clearInterval(timer);feedback(`已配入 ${next.chords.length} 个和弦，覆盖 ${next.measures.length-missing.length}/${next.measures.length} 个小节${gaps}。第一个和弦在第 ${first} 小节；可关闭设置面板查看谱面，支持撤销。`,{progress:1});return;
    }
    await new Promise(resolve=>setTimeout(resolve,pollMs));
   }
  }catch(error){clearInterval(timer);feedback(error.name==='AbortError'?'已取消和弦识别，原有和弦保留。':`和弦识别失败：${error.message}`,{error:error.name!=='AbortError'});}
  finally{clearInterval(timer);running=false;controller=null;taskId=null;}
 }
 return {run,cancel};
}
