import {validate,used,measureCapacity,note,remove,detachInterruptedTies} from './model.js';
export function emptyMeasure(){return {id:crypto.randomUUID(),notes:[],repeatStart:false,repeatEnd:false};}
export function newScore(title='未命名乐谱',key='C',beats=4,count=4){
 if(!Number.isInteger(count)||count<1||count>100)throw Error('初始小节数量应为 1–100');
 return validate({format:'jianpu-melody',version:2,title:title.trim()||'未命名乐谱',key,meter:[beats,4],measures:Array.from({length:count},emptyMeasure),spans:[],lyrics:[]});
}
export function insertMeasureAfter(score,index){
 if(!Number.isInteger(index)||index<0||index>=score.measures.length)throw Error('请选择有效的小节');
 score.measures.splice(index+1,0,emptyMeasure());return index+1;
}
export function deleteMeasure(score,index){
 const m=score.measures[index];remove(score,m.notes.map(n=>n.id));score.endings=score.endings?.filter(e=>e.fromMeasure!==m.id&&e.toMeasure!==m.id);score.measures.splice(index,1);if(!score.measures.length)score.measures.push(emptyMeasure());
}
export function fillRests(score,index){let remaining=measureCapacity(score)-used(score.measures[index]);for(const base of [4,8,16])while(remaining>=64/base){score.measures[index].notes.push(note(0,base));remaining-=64/base;}if(remaining)throw Error('剩余时值无法由当前支持的休止符补齐');}
export function copySelection(score,ids){
 const keys=new Set(ids),groups=score.measures.map(m=>({notes:m.notes.filter(n=>keys.has(n.id))})).filter(g=>g.notes.length);
 if(!groups.length)throw Error('请选择要复制的音符');
 return structuredClone({groups,spans:score.spans.filter(p=>keys.has(p.from)&&keys.has(p.to)),lyrics:(score.lyrics||[]).filter(l=>keys.has(l.noteId)).map(l=>({...l,...(l.endNoteId&&!keys.has(l.endNoteId)?{endNoteId:undefined}:{})}))});
}
export function pasteSelection(score,index,after,clip){
 if(!clip?.groups?.length)throw Error('请先复制音符');
 const map=new Map(),groups=clip.groups.map(g=>g.notes.map(n=>{const id=crypto.randomUUID();map.set(n.id,id);return {...structuredClone(n),id};}));
 const m=score.measures[index],pos=m.notes.findIndex(n=>n.id===after);if(used(m)+groups[0].reduce((v,n)=>v+64/n.base*(n.dots?1.5:1),0)>measureCapacity(score))throw Error('粘贴后小节超拍，请选择空小节或先删除音符');
 m.notes.splice(pos<0?m.notes.length:pos+1,0,...groups[0]);
 for(let i=1;i<groups.length;i++){const next=emptyMeasure();next.notes=groups[i];score.measures.splice(index+i,0,next);}
 score.spans.push(...clip.spans.map(p=>({...p,id:crypto.randomUUID(),from:map.get(p.from),to:map.get(p.to)})));
 score.lyrics??=[];score.lyrics.push(...clip.lyrics.map(l=>({...l,noteId:map.get(l.noteId),...(l.endNoteId?{endNoteId:map.get(l.endNoteId)}:{})})));
 detachInterruptedTies(score);validate(score);return groups.flat().map(n=>n.id);
}
