import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const python=process.env.AUDIO_PYTHON||resolve(root,'.venv-audio/bin/python');
const env={...process.env,TORCH_HOME:resolve(root,'.cache/torch')};
const run=args=>new Promise((ok,fail)=>{
 const child=spawn(python,args,{cwd:root,env,stdio:'inherit'});
 child.on('error',fail);
 child.on('exit',code=>code===0?ok():fail(Error(`节拍模型准备失败，退出码 ${code}`)));
});

try{
 await run(['-m','pip','install','-r','audio/rhythm-requirements.txt']);
 await run(['audio/rhythm.py','--prepare']);
 console.log('Beat This! final0 已下载并准备在本机运行。首次下载约 78 MB；识别音频不会发送到云 API。');
}catch(error){
 console.error(error.message);
 process.exitCode=1;
}
