import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
globalThis.crypto??=webcrypto;
import {demo} from '../src/model.js';
import {layout} from '../src/layout.js';
import {render} from '../src/render.js';
import {setLyric} from '../src/lyrics.js';
test('manual lyrics stay visible after save alongside acoustic characters, including previously saved additions',()=>{
 const s=demo(),n=s.measures[0].notes[0];s.lyrics=[];n.degree=1;n.gridTimeStart=10;n.gridTimeEnd=11;
 s.lyricAlignment={verse:1,displayMode:'characters',characters:[{id:'auto',text:'原',start:10,end:10.2,status:'acoustic'}]};
 setLyric(s,n.id,1,'美丽 的梦');assert.equal(s.lyrics[0].manual,true);
 const restored=JSON.parse(JSON.stringify(s));assert.match(render(restored),/data-lyric="/);assert.match(render(restored),/data-timed-lyric="auto"/);assert.match(render(restored,null,-1,true),/美丽 的梦/);
 delete restored.lyrics[0].manual;assert.match(render(restored,null,-1,true),/美丽 的梦/);
 restored.lyricAlignment.source='word-timestamps';assert.doesNotMatch(render(restored),/data-lyric="/);setLyric(restored,n.id,1,'手工');assert.match(render(restored),/data-lyric="/);
 setLyric(restored,n.id,1,'');assert.equal(restored.lyrics.length,0);assert.match(render(restored),/data-timed-lyric="auto"/);
});
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
test('句子ID和时间挤在一起也不能生成第二歌词行，跨句在小节内统一排开',()=>{
 const s=demo(),n=s.measures[0].notes[0];s.lyrics=[];n.degree=1;n.gridTimeStart=10;n.gridTimeEnd=11;
 s.lyricAlignment={verse:1,displayMode:'characters',characters:[
  {id:'a',lineId:'first',text:'里',start:10,end:10.1,status:'acoustic'},
  {id:'b',lineId:'second',text:'的',start:10,end:10.1,status:'estimated'},
  {id:'c',lineId:'second',text:'天',start:10.01,end:10.11,status:'estimated'}
 ]};
 const before=structuredClone(s),p=layout(s),items=p.timedLyrics;
 assert.equal(items.length,3);assert.ok(items.every(item=>item.verse===1));
 for(let i=1;i<items.length;i++)assert.ok(items[i].x-items[i-1].x>=23);
 assert.equal(p.verseCount,1);assert.equal(p.lyricCollisions,0);assert.deepEqual(s,before);
 const svg=render(s);assert.doesNotMatch(svg,/已分行显示/);assert.match(svg,/时间待核对/);
});
test('同一句子与想等挤在一起时横向排开，不当作第二段换行，不改时间',()=>{
 const s=demo(),n=s.measures[0].notes[0];s.lyrics=[];n.degree=1;n.gridTimeStart=10;n.gridTimeEnd=11;
 s.lyricAlignment={verse:1,displayMode:'characters',characters:Array.from('辈子都不想').map((text,i)=>({id:`c${i}`,lineId:'one-line',text,start:10+i*.001,end:10+i*.001+.0005,status:'estimated'}))};
 const before=structuredClone(s),p=layout(s);
 assert.ok(p.timedLyrics.every(c=>c.verse===1));assert.equal(p.lyricCollisions,0);
 for(let i=1;i<p.timedLyrics.length;i++)assert.ok(p.timedLyrics[i].x-p.timedLyrics[i-1].x>=23);
 assert.deepEqual(s,before);
});

test('密集多字可共享同一音符，小节加宽且所有字留在该小节，人工拖动保留',()=>{
 const s=demo(),n=s.measures[0].notes[0];s.lyrics=[];n.degree=1;n.gridTimeStart=10;n.gridTimeEnd=11;
 const narrow=layout(s).measures[0].width;
 s.lyricAlignment={verse:1,displayMode:'characters',characters:Array.from({length:30},(_,i)=>({id:`dense-${i}`,lineId:`sentence-${Math.floor(i/5)}`,text:'字',start:10+i*.0001,end:10+i*.0001+.00005,status:'estimated'}))};
 const before=structuredClone(s),p=layout(s),m=p.measures[0];
 assert.ok(m.width>narrow);assert.equal(p.timedLyrics.length,30);assert.equal(p.verseCount,1);
 for(const item of p.timedLyrics){assert.equal(item.mi,0);assert.equal(item.verse,1);assert.ok(item.x>=m.x+12);assert.ok(item.x<=m.x+m.width-18);}
 for(let i=1;i<p.timedLyrics.length;i++)assert.ok(p.timedLyrics[i].x-p.timedLyrics[i-1].x>=23-1e-8);
 assert.deepEqual(s,before);
 s.lyricAlignment.characters[15].placement={noteId:n.id,offsetX:60,manual:true};
 const manual=layout(s);assert.equal(manual.timedLyrics[15].x,manual.positions.get(n.id).x+60);assert.equal(manual.timedLyrics[15].verse,1);
});
test('相邻小节的密集句尾和句首各留本小节，实际第二段由明确verse选择',()=>{
 const s=demo();s.lyrics=[];
 for(let mi=0;mi<2;mi++)for(const n of s.measures[mi].notes){n.gridTimeStart=10+mi;n.gridTimeEnd=11+mi;}
 s.lyricAlignment={verse:2,displayMode:'characters',characters:[
  ...Array.from('前句的句尾').map((text,i)=>({id:`left-${i}`,lineId:'left',text,start:10.99+i*.001,end:10.9905+i*.001,status:'acoustic'})),
  ...Array.from('下一句开始').map((text,i)=>({id:`right-${i}`,lineId:'right',text,start:11.001+i*.001,end:11.0015+i*.001,status:'acoustic'}))
 ]};
 s.lyrics=[{noteId:s.measures[0].notes[0].id,verse:1,text:'第一段'}];
 const p=layout(s);assert.equal(p.verseCount,2);
 for(const item of p.timedLyrics){const m=p.measures[item.mi];assert.equal(item.verse,2);assert.equal(item.mi,item.c.id.startsWith('left')?0:1);assert.ok(item.x>=m.x+12&&item.x<=m.x+m.width-18);}
});
