import test from 'node:test';import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';globalThis.crypto??=webcrypto;
import {newScore} from '../src/commands.js';import {note,validate} from '../src/model.js';
import {insertBarline,deleteBarline,moveBarline} from '../src/barline-editing.js';
import {scoreTimeline} from '../src/playback.js';
function fixture(){const s=newScore('手工划分','C',4,2);for(const m of s.measures)m.notes=[1,2,3,4].map(d=>({...note(d),sourceTime:d}));s.lyrics=[{noteId:s.measures[0].notes[2].id,verse:1,text:'我的'}];return s;}
const ids=s=>s.measures.flatMap(m=>m.notes.map(n=>n.id));
test('insert/remove boundaries keeps every note ID, pitch, timing and lyric',()=>{const s=fixture(),notes=structuredClone(s.measures.flatMap(m=>m.notes)),lyrics=structuredClone(s.lyrics);insertBarline(s,s.measures[0].notes[2].id);assert.equal(s.measures.length,3);assert.equal(s.measures[0].notes.length,2);deleteBarline(s,0);assert.equal(s.measures.length,2);assert.deepEqual(s.measures.flatMap(m=>m.notes),notes);assert.deepEqual(s.lyrics,lyrics);validate(s);});
test('drag can transfer notes across a boundary without deleting anything',()=>{const s=fixture(),before=ids(s);moveBarline(s,0,s.measures[0].notes[1].id);assert.equal(s.measures[0].notes.length,1);assert.equal(s.measures[1].notes.length,7);assert.deepEqual(ids(s),before);assert.equal(s.lyrics[0].noteId,before[2]);assert.equal(scoreTimeline(s).duration,4);});
test('delete line combines full bars and preserves rhythmic playback duration',()=>{const s=fixture(),before=ids(s);deleteBarline(s,0);assert.equal(s.measures[0].notes.length,8);assert.deepEqual(ids(s),before);assert.equal(scoreTimeline(s).duration,4);});
test('final line and redundant splits do not silently remove notes',()=>{const s=fixture(),before=ids(s);assert.throws(()=>deleteBarline(s,1),/终止/);assert.throws(()=>insertBarline(s,s.measures[0].notes[0].id),/已经/);assert.throws(()=>moveBarline(s,0,'unknown'),/相邻/);assert.deepEqual(ids(s),before);});
