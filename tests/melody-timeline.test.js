import test from 'node:test';
import assert from 'node:assert/strict';
import {melodyTimeline} from '../src/melody-timeline.js';
test('未量化试听保持检测音高与秒数，不受Do、BPM、小节影响',()=>{
 const result={duration:12,notes:[{start:10,end:11,midi:63}]};
 const score={key:'G',tempo:240,measures:[{notes:[{id:'a',base:4,dots:0,degree:7,sourceEventId:'10000-63'},{id:'b',base:4,dots:0,degree:7,sourceEventId:'10000-63'}]}]};
 const t=melodyTimeline(result,score,10.25);
 assert.deepEqual(t.events,[{midi:63,start:0,end:.75}]);assert.equal(t.marks[0].start,0);assert.equal(t.marks[0].end,.25);assert.equal(t.marks[1].end,.75);assert.equal(t.duration,1.75);
});
test('未关联音符仍可试听，真实间隙保持静默',()=>{
 const t=melodyTimeline({duration:3,notes:[{start:0,end:1,midi:60},{start:2,end:3,midi:61}]},null);
 assert.equal(t.events[1].start,2);assert.deepEqual(t.marks,[]);
});
