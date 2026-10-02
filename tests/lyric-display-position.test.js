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
