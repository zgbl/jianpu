import test from 'node:test';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';globalThis.crypto??=webcrypto;
import {applyAcousticLyrics,moveAlignedCharacter,completeAcousticCharacters} from '../src/lyric-alignment.js';import {mergeIntroNotes} from '../src/intro-workflow.js';import {transcriptionToScore} from '../src/transcription-score.js';
test('声学歌词使用唱入起点，保留旋律与漏句，支持一音多字',()=>{const score=transcriptionToScore({estimatedBpm:120,notes:[{start:10,end:11,midi:60,confidence:1},{start:11,end:12,midi:62,confidence:1}]},{key:'C'});const chars=[{text:'常',status:'pending'},{text:'有',start:10.1,end:11.9,status:'acoustic'},{text:'把',start:11.1,end:11.5,status:'acoustic'},{text:'你',start:11.2,end:11.7,status:'acoustic'}];const r=applyAcousticLyrics(score,{characters:chars});assert.deepEqual(r.score.measures,score.measures);assert.deepEqual(r.score.spans,score.spans);assert.equal(r.score.lyricAlignment.characters.map(c=>c.text).join(''),'常有把你');assert.equal(r.score.lyricAlignment.characters[0].status,'estimated');assert.equal(r.score.lyricAlignment.characters[1].start,10.1);assert.deepEqual(r.unplaced,[]);assert.equal(r.score.lyricAlignment.characters.length,4);assert.equal(score.lyrics,undefined);});
test('前奏并谱保留演唱事件，重复应用不累加，拒绝覆盖人声',()=>{const vocal={start:10,end:11,midi:65};const r={notes:[vocal]};const intro={notes:[{start:0,end:2,midi:60,voice:'intro'}]};const merged=mergeIntroNotes(r,intro);assert.deepEqual(merged.notes,[intro.notes[0],vocal]);assert.equal(mergeIntroNotes(merged,intro).notes.length,2);assert.equal(r.notes.length,1);assert.throws(()=>mergeIntroNotes(r,{notes:[{start:9,end:12}]}),/人声/);});

test('逐字移动包括休止符位置，其他字不动，重新应用与保存恢复保留人工位置',()=>{
 const score=transcriptionToScore({estimatedBpm:120,notes:[{start:10,end:11,midi:60,confidence:1}]},{key:'C'});
 const alignment={characters:[{id:'a',text:'甲',status:'acoustic',start:10},{id:'b',text:'乙',status:'pending'},{id:'c',text:'丙',status:'acoustic',start:11}]};
 const r=applyAcousticLyrics(score,alignment).score,other=structuredClone(r.lyricAlignment.characters[2]);
 moveAlignedCharacter(r,'b',r.measures[0].notes[0].id,18);
 assert.deepEqual(r.lyricAlignment.characters[2],other);
 assert.equal(r.lyricAlignment.characters[1].start,10.5);
 const restored=applyAcousticLyrics(JSON.parse(JSON.stringify(r)),alignment).score;
 assert.deepEqual(restored.lyricAlignment.characters[1].placement,{noteId:r.measures[0].notes[0].id,offsetX:18,manual:true});
});
test('无锚点仍完整铺排并明确估算，重复字不丢失',()=>{const c=completeAcousticCharacters({characters:[{text:'我'},{text:'我'},{text:'你'}]});assert.equal(c.length,3);assert.equal(new Set(c.map(x=>x.id)).size,3);assert.ok(c.every(x=>x.status==='estimated'&&Number.isFinite(x.start)));});
