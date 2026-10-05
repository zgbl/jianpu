import {createProjectController} from './project-controller.js';
const frames={audioDebug:document.getElementById('audioDebugFrame'),compare:document.getElementById('compareFrame'),transcribe:document.getElementById('transcribeFrame'),scoreImage:document.getElementById('scoreImageFrame'),modelImage:document.getElementById('modelImageFrame')};
const params=new URLSearchParams(location.search);
frames.transcribe.src='/transcribe.html'+(params.has('score')?'?score='+encodeURIComponent(params.get('score')):'');
frames.scoreImage.src='/score-image.html';
frames.modelImage.src='/model-score.html';frames.compare.src='/compare.html';frames.audioDebug.src='/audio-debug.html';
let activeTab='transcribe';
function showTab(name,updateURL=true){activeTab=name;for(const [view,panel,button] of [['transcribe','transcribePanel','tabTranscribe'],['scoreImage','scoreImagePanel','tabImage'],['modelImage','modelImagePanel','tabModelImage'],['compare','comparePanel','tabCompare'],['audioDebug','audioDebugPanel','tabAudioDebug']]){document.getElementById(panel).hidden=name!==view;document.getElementById(button).setAttribute('aria-selected',String(name===view));frames[view]?.contentWindow?.postMessage({type:'workspace:visibility',visible:name===view},location.origin);}if(updateURL){const url=new URL(location.href);if(name==='transcribe')url.searchParams.delete('tab');else url.searchParams.set('tab',name);history.replaceState({},'',url);}}
document.getElementById('tabAudioDebug').onclick=()=>showTab('audioDebug');
document.getElementById('tabCompare').onclick=()=>showTab('compare');
document.getElementById('tabTranscribe').onclick=()=>showTab('transcribe');document.getElementById('tabImage').onclick=()=>showTab('scoreImage');document.getElementById('tabModelImage').onclick=()=>showTab('modelImage');
function activate(name,updateURL=true){
 showTab('transcribe',false);
 document.title='谱间 · 歌曲工作台';
 if(updateURL){const url=new URL(location.href);url.searchParams.delete('tab');history.replaceState({},'',url);}
 frames.transcribe.contentWindow?.postMessage({type:'workspace:visibility',visible:true},location.origin);
 if(name==='editor')frames.transcribe.contentWindow?.postMessage({type:'workspace:focus-editor'},location.origin);
}
window.addEventListener('message',event=>{if(event.origin!==location.origin)return;if(event.source===frames.transcribe.contentWindow&&event.data?.type==='workspace:tab')activate(event.data.tab);if([frames.scoreImage.contentWindow,frames.modelImage.contentWindow,frames.compare.contentWindow].includes(event.source)&&event.data?.type==='workspace:import-score'){const source=event.source,errorType=source===frames.modelImage.contentWindow?'model-score:error':source===frames.compare.contentWindow?'compare:error':'score-image:error';controller.importScore(event.data.score).then(()=>showTab('transcribe')).catch(error=>source.postMessage({type:errorType,message:error.message},location.origin));}});
const controller=createProjectController({frames,activate});
window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===frames.audioDebug.contentWindow&&event.data?.type==='workspace:ready')frames.audioDebug.contentWindow.postMessage({type:'workspace:visibility',visible:activeTab==='audioDebug'},location.origin);});
window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===frames.modelImage.contentWindow&&e.data?.type==='model-score:compare-ready')showTab('compare');});
controller.init().then(()=>{if(['scoreImage','modelImage','compare','audioDebug'].includes(params.get('tab')))showTab(params.get('tab'),false);});
document.addEventListener('keydown',event=>{if(event.code!=='Space'||activeTab!=='transcribe'||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||event.target.closest('input,textarea,[contenteditable=true]'))return;event.preventDefault();if(!event.repeat)frames.transcribe.contentWindow?.postMessage({type:'workspace:transport-toggle'},location.origin);});
