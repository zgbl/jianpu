import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';globalThis.crypto??=webcrypto;
import {chordAlternatives,harmonizeScore,configureHarmony} from '../src/chord-harmony.js';
import {demo} from '../src/model.js';
import {render} from '../src/render.js';
import {layout} from '../src/layout.js';

test('only nearby playable and melody-supported candidates appear, primary is excluded and at most two remain',()=>{
 const options=[{label:'C',value:1,melodySupport:1},{label:'Am',value:.99,melodySupport:.9},{label:'Em',value:.95,melodySupport:.8},{label:'F',value:.92,melodySupport:.7},{label:'G',value:.6,melodySupport:.6},{label:'Dm',value:.99,melodySupport:.1}];
 assert.deepEqual(chordAlternatives(options,'C').map(a=>a.label),['Am','Em']);
 assert.deepEqual(chordAlternatives([{label:'C',value:1},{label:'G',value:.5}],'C'),[]);
});
test('melody alternatives survive saving, whole-window support is checked, and manual chords stay intact',()=>{
 const s=demo();s.key='C';s.measures=s.measures.slice(0,1);s.spans=[];s.measures[0].notes=[{id:'tone',degree:3,octave:0,base:1,dots:0}];
 const next=harmonizeScore(s,{color:0,seventhLimit:0});assert.ok(next.chords[0].alternatives.length);assert.ok(next.chords.every(c=>c.alternatives.length<=2&&c.alternatives.every(a=>a.label!==c.label)));
 assert.deepEqual(JSON.parse(JSON.stringify(next)).chords.map(c=>c.alternatives),next.chords.map(c=>c.alternatives));assert.deepEqual(next.measures,s.measures);
 const manual={measureId:s.measures[0].id,label:'C',source:'manual'};s.chords=[manual];assert.deepEqual(harmonizeScore(s).chords,[manual]);
});
test('audio alternatives merged across a marker must be present in both windows',()=>{
 const s=demo(),id=s.measures[0].id;
 const chords=[{measureId:id,start:0,end:1,label:'C',candidates:[{label:'C',score:1},{label:'Am',score:.93}]},{measureId:id,start:1,end:2,label:'C',candidates:[{label:'C',score:1},{label:'G',score:.93}]}];
 const next=configureHarmony(s,{chords});assert.equal(next.chords.length,1);assert.deepEqual(next.chords[0].alternatives,[]);
});
test('alternatives have an independent display flag, use Capo labels, export as small text, and have no additional diagrams',()=>{
 const s=demo();s.chords=[{measureId:s.measures[0].id,label:'D',alternatives:[{label:'Bm'},{label:'G'}]}];s.showGuitarDiagrams=true;s.guitarNotation={mode:'fingering',shapeKey:'C',capo:2};
 const hidden=render(s);assert.ok(!hidden.includes('class="chord-alternatives"'));
 s.showChordAlternatives=true;const visible=render(s,null,-1,true);assert.match(visible,/\(Am \/ F\)/);assert.match(visible,/class="chord-alternatives"[^>]*font-size="11"/);
 assert.equal((visible.match(/class="guitar-chord-diagram"/g)||[]).length,(hidden.match(/class="guitar-chord-diagram"/g)||[]).length);
 s.showGuitarDiagrams=false;assert.match(render(s),/\(Am \/ F\)/);
 const wide=layout(s).measures[0].width;s.showChordAlternatives=false;assert.ok(wide>=layout(s).measures[0].width);
});

test('a chord fitting only the first half is not offered for a merged melody marker',()=>{
 const s=demo();s.key='C';s.measures=s.measures.slice(0,1);s.spans=[];
 s.measures[0].notes=[{id:'e',degree:3,octave:0,base:2,dots:0},{id:'b',degree:7,octave:0,base:2,dots:0}];
 const next=harmonizeScore(s,{color:0,seventhLimit:0});
 assert.equal(next.chords.length,1);assert.equal(next.chords[0].label,'Em');
 assert.ok(!next.chords[0].alternatives.some(c=>c.label==='C'||c.label==='Am'));
});
