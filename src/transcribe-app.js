import {transcriptionToScore} from './transcription-score.js';
import {render} from './render.js';
import {downloadFile,safeName} from './files.js';
const $=id=>document.getElementById(id);
let file=null,originalURL=null,job=null,result=null,score=null,busy=false,healthReady=false,abort=null,oscillators=[],audioContext=null,playTimer=null;
const durationText=seconds=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
const status=(text,error=false)=>{$('status').textContent=text;$('status').classList.toggle('error',error);};
function controls(){ $('recognize').disabled=!file||busy||!healthReady;$('audioFile').disabled=busy;$('trySample').disabled=busy;$('cancel').hidden=!busy;for(const id of ['sourceMode','clipStart','clipDuration'])$(id).disabled=busy;for(const id of ['download','edit','playMelody'])$(id).disabled=!score||busy;$('recognize').textContent=busy?'正在识别…':'识别主旋律';}
async function responseJSON(response){const text=await response.text();let payload;try{payload=JSON.parse(text);}catch{throw Error('音频接口尚未加载，请在终端停止后重新运行 npm run dev。');}if(!response.ok)throw Error(payload.error||'音频处理失败');return payload;}
async function checkHealth(){
 try{const health=await responseJSON(await fetch('/api/audio/health',{cache:'no-store'}));healthReady=health.ready;$('runtime').textContent=healthReady?'人声分离模型已就绪 · 音频留在本机':'音频环境未准备完成';$('runtime').classList.toggle('ready',healthReady);$('setup').hidden=healthReady;}catch(e){healthReady=false;$('runtime').textContent=e.message;$('setup').hidden=false;}controls();
}
$('checkHealth').onclick=checkHealth;
function stopMelody(){for(const node of oscillators){try{node.stop();}catch{}}oscillators=[];clearTimeout(playTimer);$('playMelody').textContent='▶ 试听识别旋律';}
function acceptFile(incoming){
 if(busy)return;if(!incoming)return;if(!incoming.size||incoming.size>100*1024*1024){status('请选择不超过 100MB 的有效音频文件。',true);return;}
 stopMelody();$('originalPlayer').pause();$('vocalPlayer').pause();if(originalURL)URL.revokeObjectURL(originalURL);file=incoming;originalURL=URL.createObjectURL(file);$('originalPlayer').src=originalURL;$('vocalPlayer').removeAttribute('src');$('vocalPlayer').load();job=result=score=null;
 $('fileLabel').textContent=file.name;$('fileMeta').textContent=`${(file.size/1024/1024).toFixed(1)} MB · 等待读取时长`;
 $('recognizedScore').hidden=true;$('recognizedScore').replaceChildren();$('empty').hidden=false;$('pitchPanel').hidden=true;$('warnings').hidden=true;$('rawResult').hidden=true;$('summary').textContent='已选择音频，等待识别';setStage(null);status('定位到有主唱的片段，再点击“识别主旋律”。');controls();
}
$('trySample').onclick=async()=>{try{const response=await fetch('/audio/examples/known-melody.mp3');if(!response.ok)throw Error('样例音频无法读取');acceptFile(new File([await response.blob()],'known-melody.mp3',{type:'audio/mpeg'}));$('sourceMode').value='solo';$('sourceMode').dispatchEvent(new Event('change'));$('clipStart').value='0';$('clipDuration').value='15';status('已载入人工合成的八音独奏样例，用于检查识别流程。点击“识别主旋律”。');}catch(e){status(e.message,true);}};
$('audioFile').onchange=()=>acceptFile($('audioFile').files[0]);
$('originalPlayer').onloadedmetadata=()=>{if(file)$('fileMeta').textContent=`${durationText($('originalPlayer').duration)} · ${(file.size/1024/1024).toFixed(1)} MB`;};
for(const type of ['dragenter','dragover'])$('dropzone').addEventListener(type,e=>{e.preventDefault();$('dropzone').classList.add('drag-over');});
for(const type of ['dragleave','drop'])$('dropzone').addEventListener(type,e=>{e.preventDefault();$('dropzone').classList.remove('drag-over');if(type==='drop')acceptFile(e.dataTransfer.files[0]);});
$('sourceMode').onchange=()=>{$('modeHint').textContent=$('sourceMode').value==='mixed'?'只记录人声旋律，不对原曲的混合声部直接取音高。':'仅用于确实没有伴奏的主旋律音频；这一模式不做声部分离。';};
function setStage(stage){const steps=['decode','separate','pitch','done'],index=stage==='rhythm'?2:steps.indexOf(stage);for(const item of $('steps').children){const at=steps.indexOf(item.dataset.stage);item.classList.toggle('active',at===index);item.classList.toggle('finished',at<index);}}
function drawScore(){
 if(!result)return;
 try{
  score=transcriptionToScore(result,{title:file.name.replace(/\.[^.]+$/,'')+' · 旋律草稿',bpm:+$('bpm').value,key:$('key').value,meter:+$('meter').value,firstBeat:+$('firstBeat').value});
  $('recognizedScore').innerHTML=render(score,null,-1);$('recognizedScore').hidden=false;$('empty').hidden=true;
  for(const n of score.measures.flatMap(m=>m.notes)){if(n.degree&&(n.confidence<.8||n.centsDeviation>35))$('recognizedScore').querySelector(`[data-note="${CSS.escape(n.id)}"]`)?.classList.add('needs-review');}
  $('summary').textContent=`${result.notes.length} 个候选音符 · ${score.measures.length} 小节 · 1=${score.key} · ${$('bpm').value} BPM`;
  const messages=[`${result.sourceMode==='mixed'?'人声分离后识别':'你提供的独奏／清唱主旋律'} · ${result.duration} 秒片段 · ${score.transcription.uncertain} 个音符片段需核对。`,...result.warnings,...score.transcription.warnings];$('warnings').textContent=messages.join(' ');$('warnings').hidden=false;
 }catch(e){score=null;$('recognizedScore').hidden=true;$('empty').hidden=false;status(e.message,true);}controls();
}
for(const id of ['bpm','key','meter','firstBeat'])$(id).onchange=drawScore;
function drawTrack(){
 const svg=$('pitchChart'),width=Math.max(800,result.duration*10),height=160,left=45,top=16,bottom=132,duration=result.duration,midis=result.notes.map(n=>n.midi),min=Math.min(...midis)-2,max=Math.max(...midis)+2;
 svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.style.width=`${Math.max(100,width/8)}%`;svg.dataset.width=width;svg.dataset.duration=duration;
 const y=midi=>bottom-(midi-min)/(max-min)*(bottom-top),x=time=>left+time/duration*(width-left-16);let parts='';
 for(let midi=Math.ceil(min/12)*12;midi<=max;midi+=12){parts+=`<line x1="${left}" x2="${width-16}" y1="${y(midi)}" y2="${y(midi)}" stroke="#edf1f4"/><text x="8" y="${y(midi)+4}" font-size="10" fill="#8794a0">C${midi/12-1}</text>`;}
 for(let time=0;time<=duration;time+=Math.max(5,Math.ceil(duration/10/5)*5))parts+=`<text x="${x(time)}" y="152" font-size="10" fill="#8794a0">${time}s</text>`;
 for(const n of result.notes){const uncertain=n.confidence<.8||n.centsDeviation>35;parts+=`<rect x="${x(n.start)}" y="${y(n.midi)-3}" width="${Math.max(2,x(n.end)-x(n.start))}" height="6" rx="2" fill="${uncertain?'#a76824':'#426b97'}"><title>${n.start.toFixed(2)}s，MIDI ${n.midi}${uncertain?'，需核对':''}</title></rect>`;}
 parts+=`<line id="playhead" x1="${left}" x2="${left}" y1="8" y2="${bottom}" stroke="#416d63" stroke-width="1.5"/>`;svg.innerHTML=parts;$('pitchPanel').hidden=false;
}
$('pitchChart').onclick=e=>{if(!result)return;const svg=$('pitchChart'),point=svg.createSVGPoint();point.x=e.clientX;point.y=e.clientY;const x=point.matrixTransform(svg.getScreenCTM().inverse()).x;seek(Math.max(0,Math.min(result.duration,(x-45)/(+svg.dataset.width-61)*result.duration)));};
function seek(time){stopMelody();$('originalPlayer').pause();$('vocalPlayer').currentTime=time;$('vocalPlayer').play().catch(e=>status('无法播放提取的声部：'+e.message,true));}
$('recognizedScore').onclick=e=>{const group=e.target.closest('[data-note]');if(!group||!score)return;const n=score.measures.flatMap(m=>m.notes).find(n=>n.id===group.dataset.note);if(n?.sourceTime!==undefined)seek(n.sourceTime);};
function updatePlayhead(time){if(!result)return;const width=+$('pitchChart').dataset.width,x=45+Math.max(0,Math.min(result.duration,time))/result.duration*(width-61);const head=$('pitchChart').querySelector('#playhead');if(head){head.setAttribute('x1',x);head.setAttribute('x2',x);}}
for(const id of ['originalPlayer','vocalPlayer']){const player=$(id);player.addEventListener('play',()=>{stopMelody();$(id==='originalPlayer'?'vocalPlayer':'originalPlayer').pause();});player.addEventListener('timeupdate',()=>updatePlayhead(player.currentTime-(id==='originalPlayer'?(result?.clipStart||0):0)));}
$('playMelody').onclick=async()=>{
 if(oscillators.length){stopMelody();return;}if(!result?.notes.length)return;
 try{audioContext??=new AudioContext();await audioContext.resume();$('originalPlayer').pause();$('vocalPlayer').pause();const now=audioContext.currentTime+.05,offset=result.notes[0].start;
  for(const n of result.notes){const oscillator=audioContext.createOscillator(),gain=audioContext.createGain(),start=now+n.start-offset,end=now+n.end-offset;oscillator.type='sine';oscillator.frequency.value=440*2**((n.midi-69)/12);gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.11,start+.012);gain.gain.setValueAtTime(.11,Math.max(start+.012,end-.02));gain.gain.linearRampToValueAtTime(0,end);oscillator.connect(gain);gain.connect(audioContext.destination);oscillator.start(start);oscillator.stop(end+.01);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};oscillators.push(oscillator);}
  $('playMelody').textContent='■ 停止旋律试听';playTimer=setTimeout(stopMelody,(result.notes.at(-1).end-offset+.2)*1000);
 }catch(e){stopMelody();status('无法开始旋律试听：'+e.message,true);}
};
$('recognize').onclick=async()=>{
 if(!file||busy)return;const start=+$('clipStart').value,duration=+$('clipDuration').value;
 if(!Number.isFinite(start)||start<0||start>=($('originalPlayer').duration||Infinity)){status('开始时间超出音频范围。',true);return;}
 stopMelody();$('originalPlayer').pause();$('vocalPlayer').pause();result=score=null;$('recognizedScore').hidden=true;$('empty').hidden=false;$('pitchPanel').hidden=true;$('warnings').hidden=true;$('rawResult').hidden=true;$('summary').textContent='等待本次识别结果';busy=true;abort=new AbortController();job={id:crypto.randomUUID()};controls();status('正在上传到本机音频处理器…');setStage('decode');
 try{
  const query=new URLSearchParams({title:file.name,start:String(start),duration:String(duration),mode:$('sourceMode').value,id:job.id});job=await responseJSON(await fetch('/api/audio/jobs?'+query,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file,signal:abort.signal}));
  while(busy){
   const state=await responseJSON(await fetch(`/api/audio/jobs/${job.id}`,{signal:abort.signal,cache:'no-store'}));status(state.message);setStage(state.stage);
   if(state.status==='error')throw Error(state.message);if(state.status==='cancelled')throw new DOMException('已取消识别','AbortError');
   if(state.status==='done'){
    result=await responseJSON(await fetch(`/api/audio/jobs/${job.id}/result.json`,{signal:abort.signal}));$('vocalPlayer').src=`/api/audio/jobs/${job.id}/vocals.wav`;
    $('rawResult').href=`/api/audio/jobs/${job.id}/result.json`;$('rawResult').download='旋律识别-原始时间.json';$('rawResult').hidden=false;
    if(!result.notes.length){score=null;$('recognizedScore').hidden=true;$('empty').hidden=false;$('pitchPanel').hidden=true;$('warnings').textContent=result.warnings.join(' ');$('warnings').hidden=false;status('未识别到可靠主旋律。可先听提取的声部，再换一段有人声的片段。',true);}
    else{$('bpm').value=result.estimatedBpm;drawTrack();drawScore();if(score)status('旋律草稿已生成。先对照试听，再核对速度、调号和时值。');}break;
   }
   await new Promise((ok,fail)=>{const signal=abort.signal,onAbort=()=>{clearTimeout(timer);fail(new DOMException('已取消','AbortError'));},timer=setTimeout(()=>{signal.removeEventListener('abort',onAbort);ok();},1000);signal.addEventListener('abort',onAbort,{once:true});});
  }
 }catch(e){status(e.name==='AbortError'?'已取消识别。':e.message,e.name!=='AbortError');}finally{busy=false;controls();}
};
$('cancel').onclick=async()=>{busy=false;abort?.abort();if(job?.id){try{await fetch(`/api/audio/jobs/${job.id}`,{method:'DELETE'});}catch{}}status('已取消识别。');controls();};
$('download').onclick=()=>{if(score)downloadFile(JSON.stringify(score,null,2),safeName(score.title),'application/json');};
$('edit').onclick=async()=>{if(!score||!job)return;try{await responseJSON(await fetch(`/api/audio/jobs/${job.id}/score.jpu`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(score)}));const path=`/api/audio/jobs/${job.id}/score.jpu`;if(parent!==window)parent.postMessage({type:'workspace:open-score',path},location.origin);else location.assign('/editor.html?score='+encodeURIComponent(path));}catch(e){status(e.message,true);}};
window.addEventListener('pagehide',()=>{stopMelody();if(originalURL)URL.revokeObjectURL(originalURL);});
checkHealth();
