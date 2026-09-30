import {writeFile} from 'node:fs/promises';import {validate,used} from '../src/model.js';import {render} from '../src/render.js';
const out=new URL('../SampleSheet/我如此爱你/我们的输出/',import.meta.url);
// Token: degree / denominator / octave / dots. Musical text is manually transcribed from supplied pages.
const rows=[
 '0 0 0 0',
 '0 0 0 0',
 '0 0 0 0',
 '0 0 0 3/16 2/8 1/16',
 '3/2 3/8 4/8 5/8 5/8',
 '5 5/16 5/16 5/8 6/8 7/8 1/4/1',
 '1/8/1 1/8/1 1/8/1 1/8/1 1/8/1 7/8 7/8 5/8',
 '5/8 6/16 6/16 6 0/8 5/8 5/8 5/8',
 '5/16 6/16 5/8 5 0/8 6/8 6/8 5/8',
 '5/8 2/8 2 0/8 2/8 2/8 3/8',
 '4/4/0/1 4/16 4/16 6/8 6/8 5/16 6/16 5/8',
 '5/2 0 3/16 2/8 1/16',
 '3 0 3/8 4/8 5/8 5/8',
 '5 0 5/8 6/8 7/8 1/8/1',
 '1/8/1 1/8/1 1/8/1 1/8/1 1/8/1 7/8 6/8 5/8',
 '5/8 6/16 6/16 6 0 6/8 5/8',
 '5/16 6/16 5/8 0 6/8 5/8 5/8 5/16 5/16',
 '5/8 2/8 2 0 2/8 3/8',
 '4/8 1/8/1 1/8/1 6/16 6/16 1/8/1 6/8 6/8 2/8/1',
 '2/1/1',
 '0 0 0 0',
 '5/2/1 5/8/1/1 4/16/1 4/8/1 2/16/1 3/16/1',
 '2/8/1 1/8/1 1/2/1 0',
 '6/8 1/8/1 1/8/1 3/8/1 3/8/1 2/8/1 1/8/1 3/8/1',
 '3/8/1 3/8/1 3/2/1 0',
 '5/2/1 5/16/1 6/8/1 3/16/1 3/8/1 2/16/1 3/16/1',
 '2/8/1 1/8/1 1/2/1 0',
 '6/8 1/8/1 2/8/1 3/8/1 3/8/1 2/8/1 2/8/1 1/8/1',
 '1/1/1',
 '0 0 0 0',
 '0 0 0 0',
 '0 0 0 3/16/1 2/8/1 1/16/1',
 '0 0 0 0'
];
const sourceRows=[[1,1,5],[1,2,4],[1,3,4],[1,4,4],[2,1,5],[2,2,5],[2,3,5],[2,4,1]];let number=0;
const measures=sourceRows.flatMap(([page,row,count])=>Array.from({length:count},(_,column)=>{const i=number++;return {id:`m${i+1}`,repeatStart:i===4,repeatEnd:i===31,final:i===32,breakBefore:column===0&&i>0,source:{page,row,column:column+1},notes:rows[i].split(' ').map((token,j)=>{const [degree,base=4,octave=0,dots=0]=token.split('/').map(Number);return {id:`m${i+1}n${j+1}`,degree,base,octave,dots};})};}));
const spans=[];const link=(type,m,n,toM,toN)=>spans.push({id:`span-${spans.length+1}`,type,from:`m${m}n${n}`,to:`m${toM}n${toN}`});
// Curves in the supplied melody staff. Same pitch + adjacency = tie; otherwise slur.
link('tie',5,5,6,1);link('tie',6,7,7,1);link('tie',8,3,8,4);
link('slur',9,1,9,2);link('tie',9,3,9,4);link('tie',9,6,9,7);
link('tie',10,2,10,3);link('slur',11,6,11,7);link('tie',11,8,12,1);
link('tie',13,6,14,1);link('tie',14,6,15,1);link('tie',16,3,16,4);link('slur',17,1,17,2);
link('tie',18,2,18,3);link('tie',19,9,20,1);link('tie',22,3,22,4);link('slur',22,5,22,6);
link('slur',23,1,23,3);link('tie',25,1,25,2);link('slur',26,2,26,3);link('tie',26,4,26,5);link('slur',26,6,26,7);link('slur',27,1,27,3);link('tie',28,4,28,5);link('tie',28,8,29,1);
const score={format:'jianpu-melody',version:2,title:'我如此爱你',key:'G',meter:[4,4],performer:'汪峰',source:{files:['../我如此爱你G1.png','../我如此爱你G2.png','../我如此爱你G.pdf'],description:'用户提供的两页简谱；只录入旋律。PDF 第三页为歌词和弦文字，不包含额外旋律。'},measures,spans,endings:[{id:'ending-1',number:1,fromMeasure:'m30',toMeasure:'m32'},{id:'ending-2',number:2,fromMeasure:'m33',toMeasure:'m33'}]};
validate(score);for(const [i,m] of measures.entries())if(used(m)!==64)throw Error(`第 ${i+1} 小节不是四拍：${used(m)/16}`);
await writeFile(new URL('我如此爱你-旋律.jpu',out),JSON.stringify(score,null,2)+'\n');await writeFile(new URL('我如此爱你-旋律.svg',out),render(score,null,0,true));
await writeFile(new URL('preview.html',out),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>我如此爱你 · 旋律预览</title><style>body{margin:0;padding:18px;background:#e9eef5;color:#14243e;font:16px system-ui,sans-serif}nav{max-width:1120px;margin:auto auto 16px;display:flex;gap:16px;flex-wrap:wrap}main{max-width:1120px;margin:auto;background:white;padding:15px}svg{width:100%;height:auto}a{color:#285d9c}</style><nav><strong>完整旋律 · 33 小节 · 1=G · 4/4</strong><a href="/?score=${encodeURIComponent('/SampleSheet/我如此爱你/我们的输出/我如此爱你-旋律.jpu')}">进入编辑器</a><a href="我如此爱你-旋律.jpu" download>下载可编辑文件</a><a href="我如此爱你-旋律.svg">查看 SVG</a></nav><main>${render(score,null,0,true)}</main></html>`);
await writeFile(new URL('逐小节录入.txt',out),rows.map((row,i)=>`${i+1}\t原谱第${measures[i].source.page}页第${measures[i].source.row}行第${measures[i].source.column}小节\t${row}`).join('\n')+'\n');
console.log(`${measures.length} 小节 / ${measures.reduce((v,m)=>v+m.notes.length,0)} 音符与休止 / ${spans.length} 连线；全部四拍。`);
