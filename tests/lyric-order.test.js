import test from 'node:test';import assert from 'node:assert/strict';
import {enforceLyricOrder} from '../src/lyric-order.js';
import {applyAcousticLyrics} from '../src/lyric-alignment.js';
import {demo} from '../src/model.js';
const line=(text,id,start,status='acoustic')=>Array.from(text).map((text,i)=>({id:`${id}-${i}`,lineId:id,text,start:start+i*.25,end:start+i*.25+.1,status}));
test('cached weak next sentence cannot interleave with correct preceding words or return through interpolation',()=>{
 const a={text:'一个小细节\n哎呀呀呀',lines:[{id:'a'},{id:'b'}],characters:[...line('一个小细节','a',28),...line('哎呀呀呀','b',28.5,'estimated')]},before=structuredClone(a);
 const fixed=applyAcousticLyrics(demo(),a,{words:[{text:'意外识别文字',start:60,end:65}]}).score.lyricAlignment;
 assert.deepEqual(fixed.characters.slice(0,5),a.characters.slice(0,5));
 assert.ok(fixed.characters.slice(5).every(c=>c.timingUnresolved&&!Number.isFinite(c.start)));
 assert.equal(fixed.characters.map(c=>c.text).join(''),'一个小细节哎呀呀呀');assert.deepEqual(a,before);
});
test('a later chorus cannot precede an earlier verse; manual positions survive',()=>{
 const a={text:'前句\n错句\n后句',lines:['a','b','c'].map(id=>({id})),characters:[...line('前句','a',10),...line('错句','b',210),...line('后句','c',124)]};
 a.characters[2].placement={noteId:'manual',manual:true};const fixed=enforceLyricOrder(a);
 assert.equal(fixed.characters[2].placement.noteId,'manual');assert.ok(fixed.characters[3].timingUnresolved);assert.equal(fixed.characters[4].start,124);
});
test('ordered repeated syllables retain their separate occurrences and acoustic timestamps',()=>{
 const a={text:'哎呀\n哎呀',lines:[{id:'a'},{id:'b'}],characters:[...line('哎呀','a',10),...line('哎呀','b',12)]};assert.deepEqual(enforceLyricOrder(a),a);
});
