// A single transport for native tracks and the synthesized score. Capture keys
// before native audio/button shortcuts, including keys in the parent workspace.
export function createTransportShortcuts({synth,getMedia=()=>[],onError=()=>{}}){
 let last=null;
 document.addEventListener('play',event=>{if(event.target instanceof HTMLMediaElement)last=event.target;},true);
 function toggle(){
  const playing=getMedia().find(p=>!p.paused&&!p.ended);
  if(playing){last=playing;playing.pause();return;}
  if(synth.state==='playing'){last='synth';synth.pause();return;}
  if(synth.state==='paused'){last='synth';synth.resume().catch(onError);return;}
  if(last&&last!=='synth'&&last.isConnected&&last.currentSrc){if(last.ended)last.currentTime=0;last.play().catch(onError);}
 }
 document.addEventListener('keydown',event=>{
  if(event.code!=='Space'||event.isComposing||event.ctrlKey||event.metaKey||event.altKey)return;
  if(event.target.closest('textarea,input:not([type=range]),[contenteditable=true]'))return;
  event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)toggle();
 },true);
 window.addEventListener('message',event=>{if(event.source===parent&&event.origin===location.origin&&event.data?.type==='workspace:transport-toggle')toggle();});
 window.addEventListener('project-restore',()=>{last=null;});
 return {toggle,select(media){if(media?.isConnected)last=media;}};
}
