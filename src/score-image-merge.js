export function mergeScoreImagePages(pageDrafts){
 if(!Array.isArray(pageDrafts)||!pageDrafts.length)throw Error('请先识别至少一张谱图');
 const first=pageDrafts[0],notes=[],chords=[],lines=[],warnings=[],repeatStarts=[],repeatEnds=[];let measureOffset=0;
 pageDrafts.forEach((page,pageIndex)=>{
  if(!Array.isArray(page.notes)||!page.notes.length)throw Error(`第 ${pageIndex+1} 张图片没有识别到音符`);
  const pageEnd=Math.max(...page.notes.map(n=>n.measure||1));
  for(const note of page.notes)notes.push({...note,measure:note.measure+measureOffset,pageIndex});
  for(const chord of page.chords||[])chords.push({...chord,measure:chord.measure+measureOffset,pageIndex});
  for(const measure of page.repeatStarts||[])repeatStarts.push(measure+measureOffset);
  for(const measure of page.repeatEnds||[])repeatEnds.push(measure+measureOffset);
  for(const line of page.lines||[])lines.push({...line,text:`【第 ${pageIndex+1} 张】${line.text}`});
  for(const warning of page.warnings||[])warnings.push(`第 ${pageIndex+1} 张：${warning}`);
  measureOffset+=pageEnd;
 });
 return {...first,notes,chords,lines,warnings,repeatStarts,repeatEnds};
}
