import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),python=process.env.AUDIO_PYTHON||resolve(root,'.venv-audio/bin/python');
const run=args=>new Promise((ok,fail)=>{const child=spawn(python,args,{cwd:root,stdio:'inherit'});child.on('error',fail);child.on('exit',code=>code===0?ok():fail(Error('中文歌词环境准备失败')));});
try{await run(['-m','pip','install','-r','audio/lyrics-requirements.txt']);await run(['audio/lyrics-asr.py','--prepare']);}catch(error){console.error(error.message);process.exitCode=1;}
