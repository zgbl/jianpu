// Links inside embedded pages switch the workspace tab, keeping both pages alive.
if(parent!==window){
 document.addEventListener('click',event=>{const link=event.target.closest('a[data-workspace-tab]');if(!link||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();parent.postMessage({type:'workspace:tab',tab:link.dataset.workspaceTab},location.origin);});
}
