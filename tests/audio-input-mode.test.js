import test from 'node:test';import assert from 'node:assert/strict';
import {importedAudioMode,analysisMethod,sourceTrackLabel} from '../src/audio-input-mode.js';
test('新歌曲和系统录音重置为分离模式；只有明确独奏样例跳过分离',()=>{assert.equal(importedAudioMode(), 'mixed');assert.equal(importedAudioMode({previousMode:'solo'}),'mixed');assert.equal(importedAudioMode({inputMode:'solo'}),'solo');assert.equal(importedAudioMode({inputMode:'invalid'}),'mixed');});
test('独奏模式不能冒称人声分离，任务记录与音轨标签明确区分',()=>{assert.match(analysisMethod('solo'),/user-supplied/);assert.doesNotMatch(analysisMethod('solo'),/demucs/);assert.match(analysisMethod('mixed','htdemucs_6s'),/htdemucs_6s/);assert.match(sourceTrackLabel('solo'),/未做人声分离/);});

test('新歌曲与App录音默认全曲，独奏模式也不能继承15秒，只有测试样例例外',async()=>{const {importedAudioDuration}=await import('../src/audio-input-mode.js');assert.equal(importedAudioDuration(), '600');assert.equal(importedAudioDuration({previousDuration:'15'}),'600');assert.equal(importedAudioDuration({inputMode:'solo'}),'600');assert.equal(importedAudioDuration({inputMode:'solo',demo:true}),'15');});
