export const safeName=title=>(title.trim().replace(/[\\/:*?"<>|]/g,'_')||'未命名乐谱')+'.jpu';
export function downloadFile(content,name,type='application/json'){
 const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function saveDocument(content,{handle=null,saveAs=false,name='未命名乐谱.jpu'}={}){
 if(typeof window.showSaveFilePicker==='function'){
  const target=saveAs||!handle?await window.showSaveFilePicker({suggestedName:name,types:[{description:'简谱文件',accept:{'application/json':['.jpu']}}]}):handle;
  if(typeof target.queryPermission==='function'&&await target.queryPermission({mode:'readwrite'})!=='granted'){if(typeof target.requestPermission!=='function'||await target.requestPermission({mode:'readwrite'})!=='granted')throw Error('未获得写入权限，请使用另存为选择文件');}
  const stream=await target.createWritable();try{await stream.write(content);await stream.close();}catch(e){try{await stream.abort();}catch{}throw e;}
  return {handle:target,name:target.name,download:false};
 }
 downloadFile(content,name);return {handle:null,name,download:true};
}
