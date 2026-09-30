export function lyricWidth(text){return Array.from(text).reduce((w,c)=>w+(/[\u2e80-\uffff]/u.test(c)?18:9),0);}
export function validateLyrics(score,events){
 if(score.lyrics===undefined)return;
 if(!Array.isArray(score.lyrics)||score.lyrics.length>10000)throw Error('歌词列表不合法');
 const keys=new Set();
 for(const l of score.lyrics){const n=events.get(l.noteId),end=l.endNoteId?events.get(l.endNoteId):null,key=`${l.noteId}:${l.verse}`;
  if(!n||!n.degree||!Number.isInteger(l.verse)||l.verse<1||l.verse>4||typeof l.text!=='string'||l.text.length>80||!l.text.trim()||keys.has(key))throw Error('歌词音符、段落或文字不合法');
  if(l.offsetX!==undefined&&(!Number.isFinite(l.offsetX)||Math.abs(l.offsetX)>2000))throw Error('歌词位置不合法');
  if(l.endNoteId&&(!end||end.order<n.order))throw Error('拖腔结束音符不合法');keys.add(key);
 }
}
export function setLyric(score,noteId,verse,text,endNoteId){
 const n=score.measures.flatMap(m=>m.notes).find(n=>n.id===noteId);if(!n?.degree)throw Error('请选择有音高的音符填写歌词');
 if(!Number.isInteger(verse)||verse<1||verse>4)throw Error('歌词段落应为 1–4');
 text=text.trim();if(text.length>80)throw Error('单个音符的歌词最多 80 个字符');
 score.lyrics??=[];const old=score.lyrics.find(l=>l.noteId===noteId&&l.verse===verse);score.lyrics=score.lyrics.filter(l=>l.noteId!==noteId||l.verse!==verse);
 if(text)score.lyrics.push({noteId,verse,text,...(old?.offsetX?{offsetX:old.offsetX}:{}),...(endNoteId?{endNoteId}:{})});
}
export function lyricTokens(text){
 const clean=text.trim();if(!clean)return [];
 if(/\s/.test(clean))return clean.split(/\s+/);
 if(!/[\u3400-\u9fff]/.test(clean))return [clean];
 const tokens=[];for(const c of Array.from(clean)){if(/[，。！？、；：,.!?;:]/.test(c)&&tokens.length)tokens[tokens.length-1]+=c;else tokens.push(c);}return tokens;
}
export function distributeLyrics(score,ids,text,verse){
 const tokens=lyricTokens(text),tieEnds=new Set(score.spans.filter(p=>p.type==='tie').map(p=>p.to));
 const chosen=new Set(ids);
 const candidates=score.measures.flatMap(m=>m.notes).filter(n=>chosen.has(n.id)&&n.degree&&!tieEnds.has(n.id));
 if(!tokens.length)throw Error('请输入要分配的歌词');if(tokens.length>candidates.length)throw Error(`歌词有 ${tokens.length} 个音节，只有 ${candidates.length} 个可填音符，请扩大选区或减少歌词`);
 tokens.forEach((t,i)=>setLyric(score,candidates[i].id,verse,t));return tokens.length;
}

// Manual engraving shifts the picked syllable and following syllables in this system.
export function moveLyricTail(score,noteId,verse,delta,rowIds){
 if(!Number.isFinite(delta))throw Error('歌词移动距离不合法');const order=score.measures.flatMap(m=>m.notes).map(n=>n.id),start=order.indexOf(noteId),rows=new Set(rowIds);if(start<0||!(score.lyrics||[]).some(l=>l.noteId===noteId&&l.verse===verse))throw Error('请选择已有歌词');
 const tail=score.lyrics.filter(l=>l.verse===verse&&rows.has(l.noteId)&&order.indexOf(l.noteId)>=start);if(tail.some(l=>Math.abs((l.offsetX||0)+delta)>2000))throw Error('歌词移动距离过大');for(const l of tail)l.offsetX=Math.round(((l.offsetX||0)+delta)*10)/10;return tail.length;
}
export function writeInlineLyrics(score,noteId,verse,text){
 const tokens=lyricTokens(text);if(tokens.length<=1){const old=(score.lyrics||[]).find(l=>l.noteId===noteId&&l.verse===verse);setLyric(score,noteId,verse,tokens[0]||'',old?.endNoteId);return {last:noteId,count:tokens.length};}
 const notes=score.measures.flatMap(m=>m.notes),start=notes.findIndex(n=>n.id===noteId),tieEnds=new Set(score.spans.filter(p=>p.type==='tie').map(p=>p.to)),targets=notes.slice(start).filter(n=>n.degree&&(!tieEnds.has(n.id)||n.id===noteId));if(start<0||tokens.length>targets.length)throw Error('后面没有足够音符容纳这些歌词，请分段输入');
 tokens.forEach((t,i)=>setLyric(score,targets[i].id,verse,t));return {last:targets[tokens.length-1].id,count:tokens.length};
}

// Insert the selected syllable(s) before the entire destination suffix.
// The same plan is used for preview and commit, including occupied destinations.
export function relocateLyricTail(score,noteId,verse,targetId,rowIds,scope='tail',charIndex=0){
 const notes=score.measures.flatMap(m=>m.notes),order=new Map(notes.map((n,i)=>[n.id,i])),row=new Set(rowIds),all=score.lyrics||[],picked=all.find(l=>l.noteId===noteId&&l.verse===verse);
 if(!picked)throw Error('请选择已有歌词');
 if(noteId===targetId){delete picked.offsetX;return {count:0,last:noteId};}
 let moving,remaining;
 if(scope==='single'){
  const chars=Array.from(picked.text);if(!Number.isInteger(charIndex)||charIndex<0||charIndex>=chars.length)throw Error('请选择要移动的字');
  moving=[{...picked,text:chars.splice(charIndex,1)[0]}];
  remaining=all.filter(l=>l!==picked).map(l=>({...l}));if(chars.length)remaining.push({...picked,text:chars.join('')});
 }else{
  moving=all.filter(l=>l.verse===verse&&row.has(l.noteId)&&order.get(l.noteId)>=order.get(noteId)).sort((a,b)=>order.get(a.noteId)-order.get(b.noteId));
  const ids=new Set(moving.map(l=>l.noteId));remaining=all.filter(l=>l.verse!==verse||!ids.has(l.noteId)).map(l=>({...l}));
 }
 const tieEnds=new Set(score.spans.filter(p=>p.type==='tie').map(p=>p.to)),targets=notes.filter(n=>n.degree&&!(scope==='single'&&n.id===noteId&&remaining.some(l=>l.noteId===noteId&&l.verse===verse))&&(!tieEnds.has(n.id)||n.id===targetId||all.some(l=>l.noteId===n.id&&l.verse===verse))),start=targets.findIndex(n=>n.id===targetId);
 if(start<0)throw Error('请拖到有音高的音符下方');
 const suffix=remaining.filter(l=>l.verse===verse&&!(scope==='single'&&l.noteId===noteId)&&order.get(l.noteId)>=order.get(targetId)).sort((a,b)=>order.get(a.noteId)-order.get(b.noteId));
 const queue=[...moving,...suffix];if(start+queue.length>targets.length)throw Error('后面音符不足，请先增加音符或选择“只拖这个字”；歌词未移动');
 const suffixIds=new Set(suffix.map(l=>l.noteId)),kept=remaining.filter(l=>l.verse!==verse||!suffixIds.has(l.noteId));
 const placed=queue.map((entry,i)=>{const moved={...entry,noteId:targets[start+i].id};delete moved.offsetX;delete moved.endNoteId;return moved;});
 score.lyrics=[...kept,...placed];return {count:moving.length,last:targets[start+queue.length-1].id};
}
