// All display and playback times use original-song seconds. Detector files are clip relative.
export const midiHz=m=>440*2**((m-69)/12);
const NAMES=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
export function pitchLabel(m){if(!Number.isFinite(m))return '—';const n=Math.round(m);return NAMES[((n%12)+12)%12]+(Math.floor(n/12)-1);}
export function timeLabel(t){return `${Math.floor(t/60)}:${(t%60).toFixed(2).padStart(5,'0')}`;}
export function clampWindow(start,end,min,max){const width=Math.min(max-min,Math.max(.25,end-start));start=Math.max(min,Math.min(max-width,start));return [start,start+width];}
export const centsLabel=c=>Number.isFinite(c)?`${c>0?'+':''}${(Math.abs(c)<.05?0:c).toFixed(1)} 音分`:'未提供';
export function selectDebugRun(project,previousProject,selectedRun){
 const completed=project.runs.filter(r=>r.status==='done');
 const keep=previousProject?.id===project.id&&previousProject.scoreBasedOn===project.scoreBasedOn;
 return (keep&&completed.find(r=>r.id===selectedRun?.id))||completed.find(r=>r.id===(project.scoreBasedOn||project.activeRunId))||completed.at(-1);
}
export function pitchDeviation(note,frames=[],tuningCents=null,targetMidi=note.midi){
 // Saved V3 centers are tuning-corrected; observation frames retain raw A440 MIDI.
 const target=targetMidi,hasCore=Number.isFinite(note.coreStart)&&Number.isFinite(note.coreEnd)&&note.coreEnd>note.coreStart;
 if(!Number.isFinite(target))return {rawCents:null,correctedCents:null,rawHz:null,spread:null,count:0,basis:'无目标音高'};
 const samples=hasCore?frames.filter(f=>f.time>=note.coreStart&&f.time<note.coreEnd&&f.voiced===true&&Number.isFinite(f.midi)).map(f=>f.midi).sort((a,b)=>a-b):[];
 const center=Number.isFinite(note.pitchCenterMidi)?note.pitchCenterMidi:null,knownTuning=Number.isFinite(tuningCents);
 const median=samples.length?(samples[Math.floor((samples.length-1)/2)]+samples[Math.ceil((samples.length-1)/2)])/2:null;
 const rawCenter=center!==null&&knownTuning?center+tuningCents/100:median;
 return {rawCents:rawCenter===null?null:(rawCenter-target)*100,correctedCents:center===null?null:(center-target)*100,rawHz:rawCenter===null?null:midiHz(rawCenter),spread:samples.length?[(samples[Math.floor((samples.length-1)*.1)]-target)*100,(samples[Math.ceil((samples.length-1)*.9)]-target)*100]:null,count:samples.length,basis:center!==null&&knownTuning?'已保存中心还原整体调律':median!==null?'稳定核心有声帧中位数':'原始偏差证据不足'};
}
export function normalizeDebugData(observations,candidates,result,run={}){
 const meta=observations?.metadata||candidates?.metadata||{};
 const offset=Number.isFinite(meta.clipStart)?meta.clipStart:Number(result?.clipStart??run.params?.start??0);
 const full=Array.isArray(observations?.frames);
 const diagnostics=candidates?.diagnostics||result?.pitchDiagnostics||{},cfg=diagnostics.config||{};
 const energyFloor=diagnostics.energyThreshold??Math.max(.0008,...(observations?.frames||[]).map(f=>(f.energy||0)*.025));
 const frames=(full?observations.frames:result?.pitchTrack||[]).filter(f=>Number.isFinite(f.time)).map(f=>({...f,time:f.time+offset,midi:Number.isFinite(f.midi)?f.midi:null,voicingProbability:f.voicingProbability??f.confidence,voiced:full?f.voiced:null,...(full?{decoderEligibilityEstimated:f.decoderEligible===undefined,decoderEligible:f.decoderEligible??(f.voiced&&Number.isFinite(f.midi)&&(f.voicingProbability??f.confidence??0)>=(cfg.continuationVoicing??.35)&&(f.energy??Infinity)>=energyFloor),decoderRejection:f.decoderRejection??(!f.voiced?'unvoiced':!Number.isFinite(f.midi)?'missing-pitch':(f.energy??Infinity)<energyFloor?'low-energy':(f.voicingProbability??f.confidence??0)<(cfg.continuationVoicing??.35)?'low-voicing':'eligible')}:{})}));
 const notes=(candidates?.notes||result?.notes||[]).filter(n=>Number.isFinite(n.start)&&Number.isFinite(n.end)&&n.end>n.start).map((n,i)=>({...n,index:i,start:n.start+offset,end:n.end+offset,performanceStart:(n.performanceStart??n.start)+offset,performanceEnd:(n.performanceEnd??n.end)+offset,coreStart:Number.isFinite(n.coreStart)?n.coreStart+offset:null,coreEnd:Number.isFinite(n.coreEnd)?n.coreEnd+offset:null}));
 for(const n of notes)n.deviation=pitchDeviation(n,frames,diagnostics.tuningCents);
 const duration=result?.duration||Math.max(0,...notes.map(n=>n.end-offset),...frames.map(f=>f.time-offset));
 return {offset,min:offset,max:offset+duration,frames,notes,meta,full,diagnostics,onsets:(candidates?.onsetTimes||[]).map(t=>t+offset)};
}
export function rangeStats(frames,start,end){
 const all=frames.filter(f=>f.time>=start&&f.time<=end),valid=all.filter(f=>f.voiced!==false&&Number.isFinite(f.midi));
 const sorted=valid.map(f=>f.midi).sort((a,b)=>a-b);const median=a=>a.length?(a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2:null;
 const center=median(sorted),mad=center===null?null:median(sorted.map(m=>Math.abs(m-center)).sort((a,b)=>a-b))*100;
 return {count:all.length,voiced:valid.length,center,mad,probability:all.length?all.reduce((s,f)=>s+(f.voicingProbability||0),0)/all.length:null};
}
export function peakEnvelope(samples,bucketSize=64){
 const count=Math.ceil(samples.length/bucketSize),min=new Float32Array(count),max=new Float32Array(count);
 for(let b=0;b<count;b++){let lo=Infinity,hi=-Infinity;for(let i=b*bucketSize;i<Math.min(samples.length,(b+1)*bucketSize);i++){lo=Math.min(lo,samples[i]);hi=Math.max(hi,samples[i]);}min[b]=lo;max[b]=hi;}
 return {min,max,bucketSize};
}
export function spectrum(samples,sr,start,end,{size=2048,maxColumns=900,minMidi=36,maxMidi=90}={}){
 // Hann-window STFT. dBFS magnitude of spectral bins, not a pitch detector.
 const begin=Math.max(0,Math.floor(start*sr)),finish=Math.min(samples.length,Math.ceil(end*sr));
 const hop=Math.max(256,Math.ceil((finish-begin)/maxColumns));const columns=Math.max(1,Math.ceil((finish-begin)/hop)),rows=(maxMidi-minMidi)*2+1;
 const values=new Float32Array(columns*rows),real=new Float64Array(size),imag=new Float64Array(size);
 for(let c=0;c<columns;c++){
  const center=begin+c*hop;for(let i=0;i<size;i++){real[i]=(samples[center+i-size/2]||0)*(.5-.5*Math.cos(2*Math.PI*i/(size-1)));imag[i]=0;}
  for(let i=1,j=0;i<size;i++){let bit=size>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[real[i],real[j]]=[real[j],real[i]];}}
  for(let len=2;len<=size;len*=2){const a=-2*Math.PI/len,wr=Math.cos(a),wi=Math.sin(a);for(let i=0;i<size;i+=len){let ur=1,ui=0;for(let k=0;k<len/2;k++){const p=i+k,q=p+len/2,tr=real[q]*ur-imag[q]*ui,ti=real[q]*ui+imag[q]*ur;real[q]=real[p]-tr;imag[q]=imag[p]-ti;real[p]+=tr;imag[p]+=ti;const v=ur*wr-ui*wi;ui=ur*wi+ui*wr;ur=v;}}}
  for(let r=0;r<rows;r++){const bin=Math.max(1,Math.min(size/2-1,Math.round(midiHz(minMidi+r/2)*size/sr)));const magnitude=Math.hypot(real[bin],imag[bin])*4/size;values[c*rows+r]=20*Math.log10(Math.max(1e-7,magnitude));}
 }
 return {values,columns,rows,start:begin/sr,end:(begin+(columns-1)*hop)/sr,hop:hop/sr,minMidi,maxMidi,size,sampleRate:sr};
}

export const frameDecisionLabel=f=>({eligible:'通过严格帧筛选',unvoiced:'无声帧猜测','missing-pitch':'缺少音高','low-energy':'能量不足','low-voicing':'有声概率不足','source-ratio':'人声/原曲比例不足'}[f.decoderRejection]||'未提供')+(f.decoderEligibilityEstimated?'（旧数据估算，未核实来源门槛）':'');
export const scoreNoteLabel=n=>n.reviewReason==='unresolved-gap'?'?（未识别）':(n.accidental>0?'♯':n.accidental<0?'♭':'')+n.degree+(n.octave?'（'+(n.octave>0?'高':'低')+Math.abs(n.octave)+'八度）':'');
