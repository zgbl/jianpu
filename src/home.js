import {createProjectController} from './project-controller.js';
const frames={transcribe:document.getElementById('transcribeFrame')};
const params=new URLSearchParams(location.search);
frames.transcribe.src='/transcribe.html'+(params.has('score')?'?score='+encodeURIComponent(params.get('score')):'');
function activate(name,updateURL=true){
 document.title='谱间 · 歌曲工作台';
 if(updateURL){const url=new URL(location.href);url.searchParams.delete('tab');history.replaceState({},'',url);}
 frames.transcribe.contentWindow?.postMessage({type:'workspace:visibility',visible:true},location.origin);
 if(name==='editor')frames.transcribe.contentWindow?.postMessage({type:'workspace:focus-editor'},location.origin);
}
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==frames.transcribe.contentWindow)return;if(event.data?.type==='workspace:tab')activate(event.data.tab);});
const controller=createProjectController({frames,activate});controller.init();
document.addEventListener('keydown',event=>{if(event.code!=='Space'||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||event.target.closest('input,textarea,[contenteditable=true]'))return;event.preventDefault();if(!event.repeat)frames.transcribe.contentWindow?.postMessage({type:'workspace:transport-toggle'},location.origin);});
