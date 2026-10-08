// View-only changes should not reset audio debugging; score and run changes must.
export function debugProjectChanged(before,after){
 if(!before||!after||before.id!==after.id||before.scoreBasedOn!==after.scoreBasedOn)return true;
 if(JSON.stringify(before.score)!==JSON.stringify(after.score))return true;
 const runs=p=>(p.runs||[]).map(r=>({id:r.id,status:r.status,notation:r.notation}));
 const assets=p=>(p.assets||[]).filter(a=>/\/(recognized\.jpu|result\.json|melody-candidates-v3\.json|pitch-observations\.json)$/.test(a.path));
 return JSON.stringify(runs(before))!==JSON.stringify(runs(after))||JSON.stringify(assets(before))!==JSON.stringify(assets(after));
}
export function debugScoreSource(project,previousProject,source){
 return previousProject&&project.id===previousProject.id&&project.scoreBasedOn===previousProject.scoreBasedOn?source:'current';
}
export function debugPreviewStamp(project,runId){return project?.assets?.find(a=>a.path===`runs/${runId}/recognized.jpu`)?.sha256??null;}
