import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareModelScore} from '../src/model-score-import.js';
import {render} from '../src/render.js';

const document=readFileSync(new URL('../doc/视觉大模型读谱输出JPU规范与提示词.md',import.meta.url),'utf8');
const example=document.match(/```json\n([\s\S]*?)\n```/)?.[1];

test('模型返回空小节时明确失败并保留原因',()=>{
 const raw=JSON.parse(example);raw.measures=[];raw.visionReview={issues:[{description:'无法可靠区分音符'}]};
 assert.throws(()=>prepareModelScore(JSON.stringify(raw)),/没有识别出任何小节.*无法可靠区分音符/);
});

test('模型 JPU 示例可从原文或单个代码块转换并预览',()=>{
 assert.ok(example);
 for(const input of [example,`模型输出：\n\n\`\`\`json\n${example}\n\`\`\``]){
  const {score,invalid,issues,beats}=prepareModelScore(input);
  assert.equal(score.measures.length,2);
  assert.deepEqual(beats.map(x=>x.beats),[4,4]);
  assert.equal(invalid.length,0);
  assert.equal(issues.length,0);
  assert.equal(score.measures[1].repeatStart,true);
  assert.equal(score.importSource.type,'vision-model');
  const svg=render(score,null,-1,true);
  assert.match(svg,/示例旋律/);
  assert.match(svg,/class="digit"/);
  assert.match(svg,/class="lyric"/);
 }
});

test('拍数不符和复核项保留为明确提示，不自动凑拍',()=>{
 const raw=JSON.parse(example);raw.measures[0].notes.pop();raw.visionReview.issues=[{page:1,measure:1,kind:'rhythm',description:'末尾音模糊'}];
 const result=prepareModelScore(JSON.stringify(raw));
 assert.equal(result.invalid[0].measure,1);
 assert.equal(result.invalid[0].beats,3);
 assert.match(result.warnings.join(' '),/末尾音|复核/);
 assert.equal(result.score.measures[0].notes.length,4);
});

test('超拍图片初稿仍可显示并标记，而不删除模型读出的音符',()=>{
 const raw=JSON.parse(example);raw.measures[0].notes.push({id:'extra-note',degree:2,base:4,octave:0,dots:0});
 const result=prepareModelScore(JSON.stringify(raw));
 assert.equal(result.score.manualBarlines,true);
 assert.equal(result.score.measures[0].notes.length,6);
 assert.equal(result.invalid[0].beats,5);
});

test('拒绝不完整回复、无效引用与不可靠图片状态',()=>{
 assert.throws(()=>prepareModelScore('{"status":"needs_clearer_image","issues":[{"description":"谱线看不清"}]}'),/谱线看不清/);
 assert.throws(()=>prepareModelScore('这是说明，不是 JPU'),/完整的 JPU/);
 const bad=JSON.parse(example);bad.chords[0].measureId='不存在';
 assert.throws(()=>prepareModelScore(JSON.stringify(bad)),/不存在的小节/);
 bad.chords[0].measureId='m001';bad.lyrics[0].noteId='不存在';
 assert.throws(()=>prepareModelScore(JSON.stringify(bad)),/JPU 校验失败/);
});

test('指型调与 Capo 不一致时提示核对，旋律数字不移调',()=>{
 const raw=JSON.parse(example);raw.key='D';raw.guitarNotation={version:1,mode:'fingering',shapeKey:'C',capo:2};
 const good=prepareModelScore(JSON.stringify(raw));
 assert.equal(good.warnings.length,0);
 assert.equal(good.score.measures[0].notes[0].degree,3);
 raw.guitarNotation.capo=3;
 assert.match(prepareModelScore(JSON.stringify(raw)).warnings.join(' '),/不一致/);
 raw.key='F';raw.guitarNotation={version:1,mode:'fingering',shapeKey:'G',capo:-2};
 const lowered=prepareModelScore(JSON.stringify(raw));
 assert.equal(lowered.score.guitarNotation.capo,-2);
 assert.equal(lowered.warnings.length,0);
});

test('中断输出只恢复完整小节，并标明歌词和和弦可能缺失',async()=>{
 const {prepareReceivedModelScore}=await import('../src/model-score-import.js');
 const raw={format:'jianpu-melody',version:2,title:'中断',key:'C',meter:[4,4],measures:[{id:'m1',repeatStart:false,repeatEnd:false,notes:[{id:'n1',degree:1,base:1,octave:0,dots:0}]}]};
 const partial=JSON.stringify(raw).slice(0,-2)+',{"id":"m2","notes":[{"degree":';
 const recovered=prepareReceivedModelScore(partial);
 assert.equal(recovered.score.measures.length,1);
 assert.equal(recovered.score.importSource.incompleteOutput,true);
 assert.match(recovered.warnings[0],/仅恢复/);
 assert.throws(()=>prepareReceivedModelScore('{"format":"jianpu-melody","version":2,"measures":[{"id":'),/尚无完整小节/);
});

test('图片模型误把歌词挂到三连音休止符时保留待定位，旋律和其余歌词仍可预览',()=>{
 const raw=JSON.parse(example);const rest=raw.measures.flatMap(m=>m.notes).find(n=>n.degree===0);assert.ok(rest);raw.lyrics.push({noteId:rest.id,verse:1,text:'样'});
 const before=JSON.stringify(raw),result=prepareModelScore(before);
 assert.equal(JSON.stringify(raw),before);
 assert.equal(result.score.importSource.pendingLyrics.at(-1).text,'样');
 assert.equal(result.score.lyrics.some(l=>l.noteId===rest.id),false);
 assert.ok(result.warnings.some(x=>x.includes('待定位歌词')));
 assert.ok(result.issues.some(x=>x.description.includes('样')&&x.description.includes(rest.id)));
});
