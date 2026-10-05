import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
globalThis.crypto??=webcrypto;
import {demo} from '../src/model.js';
import {layout} from '../src/layout.js';
import {render} from '../src/render.js';
test('声学歌词起音对齐音符中心，不复用播放竖线左侧偏移；人工位置保留',()=>{
 const s=demo(),n=s.measures[0].notes[0];n.gridTimeStart=10;n.gridTimeEnd=11;
 s.lyricAlignment={verse:1,displayMode:'characters',characters:[{id:'test-char',text:'我',start:10,end:10.2,status:'acoustic'}]};
 const x=layout(s).positions.get(n.id).x;
 const lyricX=score=>Number(render(score).match(/data-timed-lyric="test-char"[\s\S]*?<text x="([^"]+)"/)[1]);
 assert.equal(lyricX(s),x);
 s.lyricAlignment.characters[0].placement={noteId:n.id,offsetX:9,manual:true};
 assert.equal(lyricX(s),x+9);
 assert.equal(s.lyricAlignment.characters[0].start,10);
});
test('不同歌词句时间重叠时分行，同句拥挤也避让，原时间和人工位置不变',()=>{
 const s=demo(),n=s.measures[0].notes[0];s.lyrics=[];n.gridTimeStart=10;n.gridTimeEnd=11;
 s.lyricAlignment={verse:1,displayMode:'characters',characters:[
  {id:'a',lineId:'first',text:'里',start:10,end:10.1,status:'acoustic'},
  {id:'b',lineId:'second',text:'的',start:10,end:10.1,status:'pending'},
  {id:'c',lineId:'second',text:'天',start:10.01,end:10.11,status:'pending',placement:{noteId:n.id,offsetX:0,manual:true}}
 ]};
 const before=structuredClone(s),p=layout(s),items=p.timedLyrics;
 assert.equal(items.length,3);assert.ok(items[1].verse>items[0].verse);
 for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++)assert.ok(items[i].verse!==items[j].verse||Math.abs(items[i].x-items[j].x)>=23);
 assert.ok(p.verseCount>=3);assert.deepEqual(s,before);
 const svg=render(s);assert.match(svg,/位置冲突，已分行显示/);assert.match(svg,/时间待核对/);
});
test('同一句子与想等挤在一起时横向排开，不当作第二段换行，不改时间',()=>{
 const s=demo(),n=s.measures[0].notes[0];s.lyrics=[];n.gridTimeStart=10;n.gridTimeEnd=11;
 s.lyricAlignment={verse:1,displayMode:'characters',characters:Array.from('辈子都不想').map((text,i)=>({id:`c${i}`,lineId:'one-line',text,start:10+i*.001,end:10+i*.001+.0005,status:'estimated'}))};
 const before=structuredClone(s),p=layout(s);
 assert.ok(p.timedLyrics.every(c=>c.verse===1));assert.equal(p.lyricCollisions,0);
 for(let i=1;i<p.timedLyrics.length;i++)assert.ok(p.timedLyrics[i].x-p.timedLyrics[i-1].x>=23);
 assert.deepEqual(s,before);
});
