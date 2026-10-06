import test from 'node:test';import assert from 'node:assert/strict';
import {preserveUncoveredASRLyrics} from '../src/lyric-coverage.js';
test('正确文本未写第三遍副歌和结尾重复时，保留原识别时间并补回待校对，不复制已覆盖段',()=>{
 const alignment={lines:[{id:'line-0',text:'你在何方眼看天亮'}],characters:[{id:'a',lineId:'line-0',text:'你',start:10,end:11,status:'acoustic'}],searchWindows:[{lines:[1],start:10,end:18,matched:true}]};
 const words=[{text:'你在何方眼看天亮',start:10,end:18,probability:1},{text:'你在何方眼看天亮',start:180,end:188,probability:.8},{text:'我要你在我身旁',start:216,end:224,probability:.9}];
 const before=structuredClone(alignment),result=preserveUncoveredASRLyrics(alignment,words),extra=result.characters.filter(c=>c.evidence==='uncovered-asr-word');
 assert.equal(extra.map(c=>c.text).join(''),'你在何方眼看天亮我要你在我身旁');assert.equal(extra[0].start,180);assert.equal(extra.at(-1).end,224);assert.deepEqual(result.characters[0],alignment.characters[0]);assert.deepEqual(alignment,before);
 assert.deepEqual(preserveUncoveredASRLyrics(result,words),result);
});
test('网页来源、器乐标签和低置信度词不作为漏段补回',()=>{const result=preserveUncoveredASRLyrics({lines:[],characters:[]},[{text:'music163com',start:1,end:3},{text:'Zither Harp',start:4,end:6},{text:'我要你 百度百科',start:7,end:10},{text:'这是幻觉词',start:12,end:15,probability:.1}]);assert.deepEqual(result.characters,[]);});
test('一句中个别字低置信度也保留，不能把完整句补成残句',()=>{const words=[{text:'都',start:180,end:181,probability:.1},{text:'怪这吉他弹得太凄凉',start:181,end:188,probability:.9}];const result=preserveUncoveredASRLyrics({lines:[],characters:[]},words);assert.equal(result.characters.map(c=>c.text).join(''),'都怪这吉他弹得太凄凉');});
