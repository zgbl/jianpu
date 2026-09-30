import http from 'node:http';
import {createAudioAPI} from './audio/api.mjs';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

export function startServer({port=5173,root=process.cwd(),maxAttempts=10,log=console.log}={}) {
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT 必须是 1–65535 的整数');
  const audio=createAudioAPI(root);
  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost');
      if(await audio.handle(req,res,url))return;
      if(/^\/(?:\.audio-jobs|\.cache|\.venv-audio)(?:\/|$)/.test(url.pathname)){res.writeHead(404);res.end('Not found');return;}
      const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
      if(!path.startsWith(root+sep)&&path!==root)throw new Error('Invalid path');
      const file=path===root?resolve(root,'index.html'):path;
      const data=await readFile(file);
      res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[extname(file)]||'application/octet-stream');
      res.end(data);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  server.on('close',()=>audio.close());
  return new Promise((resolveStart,reject)=>{
    let attempts=0;
    const listen=()=>{attempts++;server.listen(port,'127.0.0.1');};
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
      log(`简谱编辑器已启动：http://127.0.0.1:${port}/`);
      resolveStart(server);
    };
    server.on('error',onError);
    server.once('listening',onListening);
    listen();
  });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{await startServer({port:Number(process.env.PORT??5173)});}
  catch(error){console.error(`启动失败：${error.message}`);process.exitCode=1;}
}
