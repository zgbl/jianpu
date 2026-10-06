import test from 'node:test';import assert from 'node:assert/strict';
import {repairCollapsedLyricTiming} from '../src/lyric-phrase-repair.js';
test('旧版把多句塞进几秒的估算按录音词句重定位，不改变可靠字和人工位置',()=>{
 const lines=['我要美丽的衣裳','都怪这guitar弹得太凄凉','哦我要唱着歌','你在何方眼看天亮'];
 const sung=['我要美丽的衣裳','都怪这吉他弹得太凄凉','哦我要唱着歌','你在何方眼看天亮'];
 const words=sung.map((text,i)=>({text,start:20+i*10,end:26+i*10}));
 const alignment={lines:lines.map((text,i)=>({id:`l${i}`,text})),characters:lines.flatMap((s,i)=>Array.from(s).map((text,j)=>({id:`c${i}-${j}`,lineId:`l${i}`,text,start:i?27+j*.02:20+j*.5,end:i?27.01+j*.02:20.4+j*.5,status:i?'estimated':'acoustic'})))};
 const before=structuredClone(alignment),fixed=repairCollapsedLyricTiming(alignment,words);
 for(let i=1;i<4;i++){const cs=fixed.characters.filter(c=>c.lineId===`l${i}`);assert.ok(cs[0].start>=20+i*10);assert.ok(cs.at(-1).end<=26+i*10);assert.equal(cs.map(c=>c.text).join(''),lines[i]);}
 assert.deepEqual(fixed.characters.filter(c=>c.lineId==='l0'),alignment.characters.filter(c=>c.lineId==='l0'));assert.deepEqual(alignment,before);
});
test('正常的一音多字不因共享音符被当作异常时间',()=>{const alignment={lines:[{id:'l',text:'子都想'}],characters:Array.from('子都想').map((text,i)=>({lineId:'l',text,start:10+i*.2,end:10.2+i*.2,status:'estimated'}))};assert.equal(repairCollapsedLyricTiming(alignment,[{text:'子都想',start:10,end:12}]),alignment);});
