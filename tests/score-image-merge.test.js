import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeScoreImagePages} from '../src/score-image-merge.js';

test('依图片顺序连接小节，和弦与音符同幅面偏移并保留页码',()=>{
 const merged=mergeScoreImagePages([
  {title:'歌曲',key:'G',meter:'4/4',notes:[{measure:1,degree:1},{measure:2,degree:2}],chords:[{measure:1,label:'G'}],repeatEnds:[2],lines:[{text:'第一页'}]},
  {title:'ignored',key:'C',meter:'3/4',notes:[{measure:1,degree:3}],chords:[{measure:1,label:'D'}],repeatStarts:[1],lines:[{text:'第二页'}]}
 ]);
 assert.deepEqual(merged.notes.map(n=>[n.measure,n.pageIndex,n.degree]),[[1,0,1],[2,0,2],[3,1,3]]);
 assert.deepEqual(merged.chords.map(c=>[c.measure,c.pageIndex,c.label]),[[1,0,'G'],[3,1,'D']]);
 assert.deepEqual(merged.lines.map(l=>l.text),['【第 1 张】第一页','【第 2 张】第二页']);
 assert.deepEqual(merged.repeatEnds,[2]);
 assert.deepEqual(merged.repeatStarts,[3]);
 assert.equal(merged.key,'G');
});

test('缺页或无音符页明确报错，避免静默跳页错排',()=>{
 assert.throws(()=>mergeScoreImagePages([]),/至少一张/);
 assert.throws(()=>mergeScoreImagePages([{notes:[{measure:1}],chords:[]},{notes:[],chords:[]}]),/第 2 张/);
});
