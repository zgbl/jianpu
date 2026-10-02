import {emptyMeasure} from './commands.js';
import {ticks,validate} from './model.js';
const durationOf=measure=>measure.notes.reduce((sum,n)=>sum+ticks(n),0);

// Bar edits partition the existing event sequence. IDs, source times, lyrics
// and slurs survive; removing a line never removes music.
export function insertBarline(score,noteId){
 const mi=score.measures.findIndex(m=>m.notes.some(n=>n.id===noteId));
 if(mi<0)throw Error('先选择小节线后面的音符');
 const left=score.measures[mi],at=left.notes.findIndex(n=>n.id===noteId);
 if(!at)throw Error('这个音符前已经是小节起点');
 const right={...emptyMeasure(),notes:left.notes.splice(at),final:!!left.final,repeatEnd:left.repeatEnd};
 left.final=false;left.repeatEnd=false;left.manualBoundary=true;left.manualDurationTicks=durationOf(left);right.manualDurationTicks=durationOf(right);score.measures.splice(mi+1,0,right);score.manualBarlines=true;
 if(score.endings)for(const e of score.endings)if(e.toMeasure===left.id)e.toMeasure=right.id;
 validate(score);return mi;
}
export function deleteBarline(score,index){
 if(!Number.isInteger(index)||index<0||index>=score.measures.length-1)throw Error('终止线不能删除；请选择两个小节之间的小节线');
 const left=score.measures[index],right=score.measures[index+1];
 left.notes.push(...right.notes);delete left.manualBoundary;left.manualDurationTicks=durationOf(left);left.final=!!right.final;left.repeatEnd=right.repeatEnd;
 score.measures.splice(index+1,1);score.manualBarlines=true;
 if(score.endings)for(const e of score.endings){if(e.fromMeasure===right.id)e.fromMeasure=left.id;if(e.toMeasure===right.id)e.toMeasure=left.id;}
 validate(score);return index;
}
export function moveBarline(score,index,noteId){
 if(!Number.isInteger(index)||index<0||index>=score.measures.length-1)throw Error('请选择内部小节线');
 const left=score.measures[index],right=score.measures[index+1],notes=[...left.notes,...right.notes],at=notes.findIndex(n=>n.id===noteId);
 if(at<=0)throw Error('小节线需留在两侧相邻小节内；要跨过其他小节线，请先删除那条线');
 left.notes=notes.slice(0,at);right.notes=notes.slice(at);left.manualBoundary=true;left.manualDurationTicks=durationOf(left);right.manualDurationTicks=durationOf(right);score.manualBarlines=true;validate(score);return index;
}
