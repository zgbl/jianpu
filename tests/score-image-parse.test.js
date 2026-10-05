import test from 'node:test';
import assert from 'node:assert/strict';
import {parseScoreImage,detectPrintedBars,observationGlyphs,auditImageMeasures} from '../src/score-image-parse.js';

function picture(width=500,height=240){const data=new Uint8ClampedArray(width*height*4);data.fill(255);const ink=(x,y)=>{const p=(y*width+x)*4;data[p]=data[p+1]=data[p+2]=0;};return {width,height,data,ink,line(x1,y1,x2,y2){if(x1===x2){for(let y=y1;y<=y2;y++)ink(x1,y);}else for(let x=x1;x<=x2;x++)ink(x,y1);}};}
function glyph(ch,x,y,w=12,h=22,picture){return {text:ch,box:[(x-w/2)/picture.width,1-(y+h/2)/picture.height,w/picture.width,h/picture.height]};}
test('uses Vision character boxes instead of uniform line spacing',()=>{
 const p=picture(),o={text:'123',box:[0.1,0.5,0.8,0.1],glyphs:[glyph('1',60,80,12,22,p),glyph('2',100,80,12,22,p),glyph('3',430,80,12,22,p)]};
 assert.deepEqual(observationGlyphs([o]).map(g=>Math.round(g.x*p.width)),[60,100,430]);
});
test('falls back to word spacing when Vision gives every glyph the same rectangle',()=>{
 const p=picture(),box=[.2,.5,.3,.1];
 const o={text:'432',box,glyphs:[{text:'4',box},{text:'3',box},{text:'2',box}]};
 assert.deepEqual(observationGlyphs([o]).map(g=>Math.round(g.x*p.width)),[125,175,225]);
});
test('reads printed barlines and underlines while excluding TAB staff digits',()=>{
 const p=picture();
 p.line(56,105,69,105);p.line(256,105,269,105);p.line(256,109,269,109);
 p.line(200,69,200,110);p.line(400,69,400,110);
 // Six long tablature staff rules surround a separate row of fret numbers.
 // A separate TAB staff is close enough that the old broad scan discarded
 // the melody row as "tablature", even though the Jianpu line is clear.
 for(let y=122;y<=152;y+=6)p.line(20,y,480,y);
 const noteXs=[60,110,160,260,310,360],notes='123456';
 const observations=[{text:notes,box:[.1,.3,.65,.12],glyphs:[...notes].map((ch,i)=>glyph(ch,noteXs[i],82,12,22,p))},
  {text:'12345',box:[.1,.59,.65,.12],glyphs:[1,2,3,4,5].map((n,i)=>glyph(String(n),60+i*70,138,12,16,p))}];
 const bars=detectPrintedBars({glyphs:observationGlyphs([observations[0]])},p);
 assert.deepEqual(bars.map(x=>Math.round(x*p.width)),[200,400]);
 const result=parseScoreImage({observations,chords:[{text:'C',x:.1,y:.05},{text:'G',x:.55,y:.05}]},p);
 assert.equal(result.notes.length,6);
 assert.deepEqual(result.notes.map(n=>n.measure),[1,1,1,2,2,2]);
 assert.equal(result.notes[0].base,8);
 assert.equal(result.notes[3].base,16);
 assert.deepEqual(result.chords.map(c=>[c.measure,c.label]),[[1,'C'],[2,'G']]);
 assert.equal(result.warnings.length,0);
});
test('missing bars stay unresolved rather than grouping every four digits',()=>{
 const p=picture();const o={text:'1234567',box:[.1,.3,.75,.1],glyphs:[1,2,3,4,5,6,7].map((n,i)=>glyph(String(n),40+i*60,80,12,22,p))};
 const result=parseScoreImage({observations:[o]},p);
 assert.deepEqual([...new Set(result.notes.map(n=>n.measure))],[1]);
 assert.match(result.warnings[0],/小节线/);
});
test('a narrow guitar TAB staff cannot become a long Jianpu measure',()=>{
 const p=picture();p.line(200,42,200,85);p.line(400,42,400,85);
 for(let y=110;y<=150;y+=10)p.line(20,y,155,y);
 const melody={text:'123456',box:[.1,.7,.7,.1],glyphs:[50,90,130,250,290,330].map((x,i)=>glyph(String(i+1),x,60,12,22,p))};
 // The TAB has many fret digits but no printed Jianpu barlines.
 const tab={text:'123456123456',box:[.04,.35,.4,.1],glyphs:Array.from({length:12},(_,i)=>glyph(String(i%6+1),25+i*10,132,8,14,p))};
 const result=parseScoreImage({observations:[melody,tab]},p);
 assert.equal(result.notes.length,6);
 assert.equal(Math.max(...result.notes.map(n=>n.measure)),2);
});
test('tall Vision boxes do not hide printed bars or delete the last real note',()=>{
 const p=picture();p.line(200,69,200,118);p.line(400,69,400,118);
 const notes=[['3',60],['7',190],['1',203],['5',250]];
 const o={text:'3715',box:[.1,.5,.7,.25],glyphs:notes.map(([ch,x])=>glyph(ch,x,90,20,60,p))};
 const result=parseScoreImage({observations:[o]},p);
 assert.deepEqual(result.notes.map(n=>[n.degree,n.measure]),[[3,1],[7,1],[5,2]]);
});
test('thick eighth-note beams and octave points inside inflated OCR boxes stay distinct',()=>{
 const p=picture();const xs=[60,110,150,210,260];
 for(const x of xs){for(let y=69;y<=92;y++)p.line(x-7,y,x+7,y);for(let y=58;y<=63;y++)p.line(x-4,y,x+1,y);}
 for(let y=101;y<=104;y++)p.line(101,y,161,y);
 p.line(300,59,300,111);
 const o={text:'33465',box:[.08,.49,.53,.24],glyphs:[...('33465')].map((ch,i)=>glyph(ch,xs[i],80,34,52,p))};
 const result=parseScoreImage({observations:[o]},p);
 assert.deepEqual(result.notes.map(n=>n.base),[4,8,8,4,4]);
 assert.deepEqual(result.notes.map(n=>n.octave),[1,1,1,1,1]);
 assert.equal(auditImageMeasures(result.notes)[0].beats,4);
});
test('cropped lyric OCR fills missing characters without replacing a clearer whole-page word',()=>{
 const p=picture(500,1000);p.line(400,275,400,333);
 const notes={text:'1234',box:[.06,.68,.64,.05],glyphs:[50,130,210,290].map((x,i)=>glyph(String(i+1),x,300,16,24,p))};
 const whole={text:'和个',box:[.08,.62,.48,.03],glyphs:[glyph('和',50,350,18,24,p),glyph('个',210,350,18,24,p)]};
 const crop={text:'加一个抱',box:[.08,.62,.64,.03],glyphs:[glyph('加',50,350,18,24,p),glyph('一',130,350,18,24,p),glyph('个',210,350,18,24,p),glyph('抱',290,350,18,24,p)]};
 const result=parseScoreImage({observations:[notes,whole],lyricObservations:[crop]},p);
 assert.deepEqual(result.notes.map(n=>n.lyric),['和','一','个','抱']);
});
test('a complete local melody reading repairs an omitted note in the page OCR',()=>{
 const p=picture();p.line(200,65,200,111);
 const whole={text:'123',box:[.08,.6,.3,.12],glyphs:[60,100,140].map((x,i)=>glyph(String(i+1),x,82,12,22,p))};
 const crop={text:'1234',box:[.08,.6,.32,.12],systemIndex:0,glyphs:[60,100,140,180].map((x,i)=>glyph(String(i+1),x,82,12,22,p))};
 const result=parseScoreImage({observations:[whole],melodyObservations:[crop]},p);
 assert.deepEqual(result.notes.map(n=>n.degree),[1,2,3,4]);
 assert.equal(auditImageMeasures(result.notes)[0].beats,4);
});
test('detects the printed repeat-start dots beside a double bar',()=>{
 const p=picture();p.line(196,60,196,108);p.line(200,60,200,108);p.line(400,60,400,108);
 for(const y of [74,89])for(let dy=0;dy<3;dy++)p.line(211,y+dy,215,y+dy);
 const o={text:'123456',box:[.06,.6,.72,.12],glyphs:[50,95,150,250,300,350].map((x,i)=>glyph(String(i+1),x,82,12,22,p))};
 const result=parseScoreImage({observations:[o]},p);
 assert.deepEqual(result.repeatStarts,[2]);
 assert.deepEqual(result.repeatEnds,[]);
});
test('audits measure capacity after rhythm editing',()=>{
 assert.deepEqual(auditImageMeasures([{measure:1,base:8,dots:0},{measure:1,base:8,dots:1},{measure:1,base:2,dots:0}], '4/4')[0],{measure:1,beats:3.25,expected:4,valid:false});
});
