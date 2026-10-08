import test from 'node:test';import assert from 'node:assert/strict';
import {debugProjectChanged,debugScoreSource,debugPreviewStamp} from '../src/debug-project-sync.js';
const project=()=>({id:'p',revision:1,scoreBasedOn:'r',score:{key:'C',measures:[{notes:[{gridTimeStart:1}]}]},runs:[{id:'r',status:'done'}],assets:[{path:'runs/r/recognized.jpu',sha256:'a'}],workspace:{transcribe:{zoom:1}}});
test('successful recognition and note timing edits invalidate the debug view, UI-only saves do not',()=>{
 const p=project(),q=structuredClone(p);q.revision++;q.workspace.transcribe.zoom=2;assert.equal(debugProjectChanged(p,q),false);
 q.score.measures[0].notes[0].gridTimeStart=2;assert.equal(debugProjectChanged(p,q),true);
 const r=project();r.scoreBasedOn='new';assert.equal(debugProjectChanged(p,r),true);
 r.scoreBasedOn='r';r.runs.push({id:'new',status:'done'});assert.equal(debugProjectChanged(p,r),true);
});
test('new score run selects current score, while deliberate historical source selection survives ordinary saves',()=>{
 const p=project(),q=structuredClone(p);assert.equal(debugScoreSource(q,p,'recognized'),'recognized');q.scoreBasedOn='new';assert.equal(debugScoreSource(q,p,'recognized'),'current');assert.equal(debugScoreSource(p,null,'recognized'),'current');
});
test('recognized preview asset replacements invalidate its cache independently of revision',()=>{
 const p=project(),q=structuredClone(p);q.assets[0].sha256='b';assert.equal(debugProjectChanged(p,q),true);assert.notEqual(debugPreviewStamp(p,'r'),debugPreviewStamp(q,'r'));assert.equal(debugPreviewStamp(p,'missing'),null);
});
