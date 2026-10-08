import {createCaptureAPI} from './audio/capture-api.mjs';
import {createKeyAPI} from './audio/key-api.mjs';
import {createLyricsAPI} from './audio/lyrics-api.mjs';
import http from 'node:http';
import {createProjectStore} from './audio/project-store.mjs';
import {createLibraryAPI} from './audio/library-api.mjs';
import {createAudioAPI} from './audio/api.mjs';
import {createScoreImageAPI} from './audio/score-image-api.mjs';
import {createModelVisionAPI} from './audio/model-vision-api.mjs';
import {createChatGPTPlanAPI} from './audio/chatgpt-plan-api.mjs';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

export function privateStaticPath(pathname){return /^\/(?:\.env(?:\..*)?|\.git|\.projects|\.audio-lyrics|\.audio-jobs|\.audio-captures|\.cache|\.venv-audio)(?:\/|$)/.test(decodeURIComponent(pathname));}

export function startServer({port=5173,host='127.0.0.1',root=process.cwd(),maxAttempts=10,log=console.log,libraryRepository}={}) {
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT 必须是 1–65535 的整数');
  const projects=createProjectStore(root),library=createLibraryAPI(root,{projects,...(libraryRepository?{repository:libraryRepository}:{})}),audio=createAudioAPI(root,{projects}),lyrics=createLyricsAPI(root,{projects}),keys=createKeyAPI(root,{projects}),capture=createCaptureAPI(root),scoreImages=createScoreImageAPI(root),chatgptPlan=createChatGPTPlanAPI(root),modelVision=createModelVisionAPI(root,{chatgptClient:chatgptPlan.client});
  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/editor.html'){url.searchParams.delete('tab');res.writeHead(302,{Location:'/'+url.search});res.end();return;}
      if(await capture.handle(req,res,url))return;
      if(await scoreImages.handle(req,res,url))return;
      if(await chatgptPlan.handle(req,res,url))return;
      if(await modelVision.handle(req,res,url))return;
      if(await keys.handle(req,res,url))return;
      if(await library.handle(req,res,url))return;
      if(await projects.handle(req,res,url))return;
      if(await lyrics.handle(req,res,url))return;
      if(await audio.handle(req,res,url))return;
      if(privateStaticPath(url.pathname)){res.writeHead(404);res.end('Not found');return;}
      const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
      if(!path.startsWith(root+sep)&&path!==root)throw new Error('Invalid path');
      const file=path===root?resolve(root,'index.html'):path;
      const data=await readFile(file);
      res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.md':'text/markdown; charset=utf-8'})[extname(file)]||'application/octet-stream');
      res.end(data);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  server.on('close',()=>{audio.close();lyrics.close();keys.close();capture.close();library.close();});
  return new Promise((resolveStart,reject)=>{
    let attempts=0;
    const listen=()=>{attempts++;server.listen(port,host);};
    const onError=error=>{
      if(error.code==='EADDRINUSE'&&attempts<maxAttempts&&port<65535){
        log(`端口 ${port} 已被占用，尝试 ${port+1}…`);
        port++;listen();
      }else{
        server.removeListener('listening',onListening);
        reject(error.code==='EADDRINUSE'?new Error(`没有可用端口；请通过 PORT 指定其他端口，例如 PORT=5200 npm run dev`):error);
      }
    };
    const onListening=()=>{
      server.removeListener('error',onError);
      log(`简谱编辑器已启动：http://${host==='0.0.0.0'?'127.0.0.1':host}:${port}/`+(host==='0.0.0.0'?'（已允许局域网访问，请用本机局域网 IP）':''));
      resolveStart(server);
    };
    server.on('error',onError);
    server.once('listening',onListening);
    listen();
  });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{await startServer({port:Number(process.env.PORT??5173),host:process.env.HOST||'127.0.0.1',maxAttempts:1});}
  catch(error){console.error(`启动失败：${error.message}`);process.exitCode=1;}
}
