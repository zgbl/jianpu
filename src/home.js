const tabs=[...document.querySelectorAll('[data-tab]')];
const frames={editor:document.getElementById('editorFrame'),transcribe:document.getElementById('transcribeFrame')};
const params=new URLSearchParams(location.search);
frames.editor.src='/editor.html'+(params.has('score')?'?score='+encodeURIComponent(params.get('score')):'');
function activate(name,updateURL=true){
 if(!frames[name])name='editor';
 if(name==='transcribe'&&!frames.transcribe.hasAttribute('src'))frames.transcribe.src='/transcribe.html';
 for(const tab of tabs){const active=tab.dataset.tab===name;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;document.getElementById(tab.getAttribute('aria-controls')).hidden=!active;}
 if(updateURL){const url=new URL(location.href);if(name==='editor')url.searchParams.delete('tab');else url.searchParams.set('tab',name);history.replaceState({},'',url);}
 document.title=name==='editor'?'谱间 · 简谱编辑器':'谱间 · 听歌记谱';
 // Let the visible page recalculate its layout after switching without reloading it.
 frames[name].contentWindow?.dispatchEvent(new Event('resize'));
}
for(const tab of tabs){tab.addEventListener('click',()=>activate(tab.dataset.tab));tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const index=event.key==='Home'?0:event.key==='End'?1:(tabs.indexOf(tab)+1)%2;activate(tabs[index].dataset.tab);tabs[index].focus();});}
window.addEventListener('message',event=>{
 if(event.origin!==location.origin||!Object.values(frames).some(frame=>frame.contentWindow===event.source))return;
 if(event.data?.type==='workspace:tab')activate(event.data.tab);
 if(event.data?.type==='workspace:score-path'&&event.source===frames.editor.contentWindow){const url=new URL(location.href);if(event.data.path)url.searchParams.set('score',event.data.path);else url.searchParams.delete('score');history.replaceState({},'',url);}
 if(event.data?.type==='workspace:open-score'&&event.source===frames.transcribe.contentWindow&&typeof event.data.path==='string'){
  activate('editor');frames.editor.contentWindow.postMessage({type:'workspace:open-score',path:event.data.path},location.origin);
 }
});
window.addEventListener('popstate',()=>activate(new URLSearchParams(location.search).get('tab'),false));
activate(params.get('tab'),false);
