import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const child=spawn(process.env.AUDIO_PYTHON||resolve(root,'.venv-audio/bin/python'),['audio/transcribe.py','--prepare','--model','htdemucs_6s'],{cwd:root,env:{...process.env,TORCH_HOME:resolve(root,'.cache/torch')},stdio:'inherit'});
child.on('error',error=>{console.error('先运行 npm run audio:setup，再准备六声部模型：'+error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code||0;if(code===0)console.log('六声部模型已就绪：人声、吉他、鼓、贝斯、钢琴、其他。');});
