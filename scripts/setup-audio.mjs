import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
const root=resolve(import.meta.dirname,'..'),python=resolve(root,'.venv-audio/bin/python');
const env={...process.env,TORCH_HOME:resolve(root,'.cache/torch'),PIP_CACHE_DIR:resolve(root,'.cache/pip')};
const run=(cmd,args)=>new Promise((ok,fail)=>{const p=spawn(cmd,args,{cwd:root,env,stdio:'inherit'});p.on('error',fail);p.on('exit',code=>code===0?ok():fail(Error(`${cmd} 退出：${code}`)));});
try{await mkdir(resolve(root,'.cache'),{recursive:true});await run(process.env.AUDIO_SETUP_PYTHON||'python3',['-m','venv',resolve(root,'.venv-audio')]);await run(python,['-m','pip','install','-r','audio/requirements.txt']);await run(python,['audio/transcribe.py','--prepare']);console.log('音频环境和人声模型已准备完成。启动 npm run dev，打开 /transcribe.html。');}catch(e){console.error('音频环境准备失败：'+e.message);process.exitCode=1;}
