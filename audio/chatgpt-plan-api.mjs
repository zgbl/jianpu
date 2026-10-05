import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {homedir,platform,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createChatGPT} from '../vendor/siwc-local/dist/index.js';
import {createCredentialEncryption} from './chatgpt-credential-encryption.mjs';
import {withVerifiedChatGPTModels} from './chatgpt-model-catalog.mjs';

const SERVICE='com.music-jianpu.chatgpt-plan';
const ACCOUNT='credential-encryption-key-v1';

function run(program,args,{input='',notFoundOk=false}={}) {
 return new Promise((resolveRun,reject)=>{
  const child=spawn(program,args,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  child.stdout.setEncoding('utf8').on('data',x=>stdout+=x);
  child.stderr.setEncoding('utf8').on('data',x=>stderr+=x);
  child.on('error',reject);
  child.on('close',code=>{
   if(code===0){resolveRun(stdout.trim());return;}
   if(notFoundOk&&code===3){resolveRun(null);return;}
   reject(new Error(stderr.trim()||`${program} exited with status ${code}`));
  });
  child.stdin.end(input);
 });
}

let encryptionKey=null;
async function getEncryptionKey(helper){
 if(platform()!=='darwin')throw new Error('ChatGPT 登录凭据的安全存储目前需要 macOS 钥匙串。');
 if(encryptionKey)return encryptionKey;
 const swiftArgs=['-module-cache-path',join(tmpdir(),'jianpu-swift-module-cache'),helper];
 const stored=await run('swift',[...swiftArgs,'get',SERVICE,ACCOUNT],{notFoundOk:true});
 if(stored){const key=Buffer.from(stored,'base64');if(key.length!==32)throw new Error('钥匙串中的本地加密密钥格式无效。');encryptionKey=key;return key;}
 const key=randomBytes(32);
 await run('swift',[...swiftArgs,'set',SERVICE,ACCOUNT],{input:key.toString('base64')});
 encryptionKey=key;return key;
}

const openBrowser=async url=>{
 await new Promise((resolveOpen,reject)=>{
  const child=spawn('open',[url],{stdio:'ignore'});
  child.once('error',reject);child.once('close',code=>code===0?resolveOpen():reject(new Error('无法打开系统浏览器，请检查 macOS 默认浏览器设置。')));
 });
};

export function createChatGPTPlanAPI(root){
 const helper=resolve(root,'audio/chatgpt-keychain.swift');
 const encryption=createCredentialEncryption(()=>getEncryptionKey(helper),{isAvailable:()=>platform()==='darwin'});
 const client=createChatGPT({
  appName:'谱间 · 简谱编辑器',
  appId:'jianpu-melody-editor',
  redirectPort:0,
  storageDir:join(homedir(),'.config','jianpu-melody-editor','chatgpt'),
  credentialEncryption:encryption,
  openBrowser,
  sendHostId:true
 });
 let loginPromise=null,modelCache=null,modelCacheAt=0;
 const json=(res,status,payload)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(payload));};
 async function sessionInfo(force=false){
  const session=await client.getSession();let models=[];
  if(session.sharing){
   if(force||!modelCache||Date.now()-modelCacheAt>60_000){modelCache=await client.listModels().catch(error=>({error:error.message}));modelCacheAt=Date.now();}
   if(Array.isArray(modelCache))models=withVerifiedChatGPTModels(modelCache);
  }
  return {session,models,error:session.sharing&&!Array.isArray(modelCache)?modelCache.error:session.error?.message||null};
 }
 return {client,async handle(req,res,url){
  if(url.pathname==='/api/chatgpt-plan/status'){
   if(req.method!=='GET'){json(res,405,{error:'方法不支持'});return true;}
   try{json(res,200,await sessionInfo(url.searchParams.get('refresh')==='1'));}
   catch(error){json(res,200,{session:{status:'disconnected',sharing:false},models:[],error:error.message});}
   return true;
  }
  if(url.pathname==='/api/chatgpt-plan/connect'){
   if(req.method!=='POST'){json(res,405,{error:'方法不支持'});return true;}
   if(!loginPromise){
    loginPromise=client.signIn({label:'谱间',reconsent:url.searchParams.get('reconsent')==='1'}).then(()=>{modelCache=null;modelCacheAt=0;}).catch(()=>null).finally(()=>{loginPromise=null;});
   }
   json(res,202,{status:'connecting',message:'已打开 ChatGPT 授权页面；请登录并允许使用 ChatGPT 计划额度。'});return true;
  }
  if(url.pathname==='/api/chatgpt-plan/disconnect'){
   if(req.method!=='POST'){json(res,405,{error:'方法不支持'});return true;}
   try{client.cancelSignIn();if(loginPromise)await loginPromise;await client.disconnect();modelCache=null;json(res,200,{session:await client.getSession()});}
   catch(error){json(res,400,{error:error.message});}
   return true;
  }
  return false;
 }};
}
