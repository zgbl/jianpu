import {rankDo} from './do-ranking.js';
import {keyName,pitchToDegree,mod12} from './pitch.js';
export function mainPitchClasses(events,key){
 const evidence=rankDo(events),total=evidence.effectiveSeconds;
 return evidence.histogram.map((weight,pc)=>({pc,weight})).filter(r=>r.weight>0).sort((a,b)=>b.weight-a.weight||a.pc-b.pc).slice(0,7).map(r=>{
  const octaves=new Map();
  for(const e of events){const center=e.pitchCenterMidi??e.midi;if(!Number.isFinite(center)||mod12(Math.round(center))!==r.pc||e.uncertain||e.pitchStatus==='uncertain'||e.recoveryReason)continue;const w=(e.end-e.start)*Math.min(1,e.pitchReliability??e.confidence??1);if(!(w>0&&Number.isFinite(w)))continue;const midi=Math.round(center);octaves.set(midi,(octaves.get(midi)||0)+w);}
  const midi=[...octaves].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0]??60+r.pc;
  // Choose one representative octave; class shares include all octaves.
  const relative=pitchToDegree(60+r.pc,key);
  return {...r,midi,name:`${String(key).includes('b')?keyName(r.pc):['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][r.pc]}${Math.floor(midi/12)-1}`,hz:440*2**((midi-69)/12),share:total?r.weight/total:0,degree:`${relative.accidental===1?'♯':relative.accidental===-1?'♭':''}${relative.degree}`};
 });
}
export function renderMainPitches(host,events,key){
 if(!host)return;host.replaceChildren();host.hidden=!events?.length;if(host.hidden)return;
 const rows=mainPitchClasses(events,key),heading=document.createElement('strong');heading.textContent=`识别出的主要音类（最多7个） · 当前 1=${key}`;host.append(heading);
 const table=document.createElement('table');table.style.width='100%';const head=table.createTHead().insertRow();for(const label of ['音名（代表八度）','标准频率','简谱音级','可靠时长权重','占比']){const cell=document.createElement('th');cell.textContent=label;head.append(cell);}const body=table.createTBody();
 for(const r of rows){const row=body.insertRow();for(const value of [r.name,`${r.hz.toFixed(1)} Hz`,r.degree,`${r.weight.toFixed(2)} 秒`,`${(r.share*100).toFixed(1)}%`])row.insertCell().textContent=value;}
 const hint=document.createElement('small');hint.textContent='按时长 × 可靠度排名；合并不同八度，排除不确定和补回音。频率为该音的标准值。低占比音可能是变化音或误识别；这张表不强制凑齐七声音阶。';host.append(table,hint);
}
