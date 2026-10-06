import test from 'node:test';
import assert from 'node:assert/strict';
import {newScore} from '../src/commands.js';
import {note,validate} from '../src/model.js';
import {render} from '../src/render.js';
import {relocateLyricTail,setLyric,moveManualLyricCharacter} from '../src/lyrics.js';
test('multiple manual characters share one note and drag independently without consuming note slots',()=>{
 const s=newScore('测试','C',4,1);s.measures[0].notes=[note(1)];const n=s.measures[0].notes[0];setLyric(s,n.id,1,'美丽的梦');
 const before=structuredClone(s.measures);moveManualLyricCharacter(s,n.id,1,2,25);assert.deepEqual(s.lyrics[0].charOffsets,[0,0,25,0]);assert.deepEqual(s.measures,before);validate(JSON.parse(JSON.stringify(s)));
 assert.match(render(s,null,0,false,[],null,1),/data-lyric-slot=/);assert.equal((render(s).match(/data-lyric-char=/g)||[]).length,4);assert.match(render(s,null,0,true),/>的<\/text>/);
 moveManualLyricCharacter(s,n.id,1,1,-13);assert.deepEqual(s.lyrics[0].charOffsets,[0,-13,25,0]);setLyric(s,n.id,1,'新词');assert.equal(s.lyrics[0].charOffsets,undefined);
});
import {applyTimedLyrics,applyAcousticLyrics} from '../src/lyric-alignment.js';
test('多字歌词每个字可单独命中，移动候保持旋律、源字和保存恢复',()=>{
 const s=newScore('测试','C',4,1);s.measures[0].notes=[note(1),note(2),note(3),note(4)];const [a,b]=s.measures[0].notes;s.lyrics=[{noteId:a.id,verse:1,text:'时候'}];
 const svg=render(s);assert.match(svg,/data-lyric-char="1" role="button" aria-label="拖动歌词 候"/);
 const before=structuredClone(s.measures);relocateLyricTail(s,a.id,1,b.id,[], 'single',1);
 assert.deepEqual(s.measures,before);assert.deepEqual(s.lyrics.map(l=>l.text),['时','候']);assert.equal(s.lyrics[1].noteId,b.id);validate(JSON.parse(JSON.stringify(s)));
});
test('词级自动结果保留独立字和原时间，不用词组替代逐字定位',()=>{
 const s=newScore('测试','C',4,1);s.measures[0].notes=[note(1),note(2),note(3),note(4)];s.measures[0].notes.forEach((n,i)=>{n.sourceTime=i;n.sourceEnd=i+1;});
 const chars=[{text:'时',start:.2,end:.4},{text:'候',start:.7,end:.9}];const result=applyTimedLyrics(s,chars).score;
 assert.equal(result.lyricAlignment.displayMode,'characters');assert.deepEqual(result.lyricAlignment.characters.map(c=>c.text),['时','候']);assert.deepEqual(result.lyricAlignment.characters.map(c=>c.start),[.2,.7]);
 const restored=applyAcousticLyrics(result,result.lyricAlignment).score;assert.deepEqual(restored.lyricAlignment.characters.map(c=>c.start),[.2,.7]);assert.equal((render(result).match(/data-timed-lyric=/g)||[]).length,2);
});
