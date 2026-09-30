import {loadPlaywright} from './playwright-runtime.mjs';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';

import {Readable,Writable} from 'node:stream';
import {createAudioAPI} from '../audio/api.mjs';
import {validate} from '../src/model.js';
const {chromium}=await loadPlaywright();
const root=process.cwd(),origin='http://localhost:51999',api=createAudioAPI(root),browser=await chromium.launch({headless:true,channel:'chrome'}),errors=[];
class Response extends Writable{
 constructor(){super();this.chunks=[];this.status=200;this.headers={};}
 _write(chunk,encoding,callback){this.chunks.push(Buffer.from(chunk));callback();}
 writeHead(status,headers){this.status=status;this.headers=headers;this.headersSent=true;return this;}
}
try{
 const context=await browser.newContext({viewport:{width:1440,height:1024}});
 await context.addInitScript(()=>localStorage.setItem('jianpu-workbench:workspace','untouched-editor-draft'));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){await route.abort();return;}
  if(url.pathname.startsWith('/api/audio/')){
   const req=Readable.from(request.postDataBuffer()?[request.postDataBuffer()]:[]);req.method=request.method();req.headers={...request.headers(),host:'localhost:51999'};
   const res=new Response();const finished=new Promise((ok,fail)=>{res.on('finish',ok);res.on('error',fail);});await api.handle(req,res,url);await finished;
   await route.fulfill({status:res.status,headers:res.headers,body:Buffer.concat(res.chunks)});return;
  }
  try{const target=resolve(root,'.'+decodeURIComponent(url.pathname)),file=target===root?resolve(root,'index.html'):target;assert.ok(file.startsWith(root+sep));await route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.mp3':'audio/mpeg'})[extname(file)]||'application/json'});}catch{await route.fulfill({status:404,body:'Not found'});}
 });
 await page.goto(origin+'/transcribe.html');await page.waitForSelector('#runtime.ready');assert.ok(await page.locator('#recognize').isDisabled());
 await page.locator('#audioFile').setInputFiles(resolve(root,'audio/examples/known-melody.mp3'));await page.selectOption('#sourceMode','solo');await page.selectOption('#clipDuration','15');await page.click('#recognize');assert.ok(await page.locator('#cancel').isVisible());await page.waitForSelector('#recognizedScore:not([hidden])',{timeout:120000});
 const jobId=await page.locator('#vocalPlayer').getAttribute('src');const id=jobId.match(/jobs\/([^/]+)/)[1];
 const actual=JSON.parse(await readFile(resolve(root,'.audio-jobs',id,'result.json'),'utf8'));assert.deepEqual(actual.notes.map(n=>n.midi),[60,62,64,65,67,69,71,72]);assert.equal(actual.sourceMode,'solo');
 await page.selectOption('#key','C');await page.fill('#bpm','120');await page.locator('#bpm').dispatchEvent('change');
 const digits=await page.locator('#recognizedScore .digit').allTextContents();assert.deepEqual(digits.filter(d=>d!=='0'),['1','2','3','4','5','6','7','1']);assert.equal(await page.locator('#recognizedScore .octave').count(),1);
 await page.click('#playMelody');assert.match(await page.locator('#playMelody').textContent(),/停止/);await page.click('#playMelody');
 const [download]=await Promise.all([page.waitForEvent('download'),page.click('#download')]);const score=JSON.parse(await readFile(await download.path(),'utf8'));validate(score);assert.equal(score.measures.length,2);assert.ok(score.measures.flatMap(m=>m.notes).filter(n=>n.degree).every(n=>n.base===4));
 await page.selectOption('#key','D');assert.match(await page.locator('#recognizedScore').textContent(),/♯/);await page.selectOption('#key','C');await page.fill('#bpm','60');await page.locator('#bpm').dispatchEvent('change');assert.ok(await page.locator('#recognizedScore .beam').count()>0);await page.fill('#bpm','120');await page.locator('#bpm').dispatchEvent('change');
 await mkdir('design/previews',{recursive:true});await page.screenshot({path:'design/previews/transcription-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'design/previews/transcription-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1024});
 await page.click('#edit');await page.waitForURL(/score=/);await page.waitForSelector('#score .digit');assert.equal(await page.evaluate(()=>localStorage.getItem('jianpu-workbench:workspace')),'untouched-editor-draft');
 await page.click('[data-mode="select"]');await page.locator('#score [data-note]').first().click();await page.selectOption('#accidental','1');await page.click('#apply');assert.match(await page.locator('#score').textContent(),/♯/);await page.selectOption('#accidental','0');await page.click('#apply');assert.doesNotMatch(await page.locator('#score').textContent(),/♯/);
 await page.goto(origin+'/transcribe.html');await page.waitForSelector('#runtime.ready');await page.locator('#audioFile').setInputFiles(resolve(root,'audio/examples/known-melody.mp3'));await page.selectOption('#sourceMode','solo');await page.click('#recognize');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('主旋律输入')||document.querySelector('#status').textContent.includes('音高'),{},{timeout:30000});await page.click('#cancel');await page.locator('#cancel').waitFor({state:'hidden'});assert.match(await page.locator('#status').textContent(),/取消/);
 await page.locator('#audioFile').setInputFiles({name:'损坏音频.mp3',mimeType:'audio/mpeg',buffer:Buffer.from('not an mp3')});await page.click('#recognize');await page.waitForFunction(()=>document.querySelector('#status').classList.contains('error'),{},{timeout:30000});assert.ok(await page.locator('#download').isDisabled());assert.ok(await page.locator('#recognizedScore').isHidden());
 if(process.env.TRANSCRIBE_TEST_MIXED){
  const mp=await context.newPage();mp.on('pageerror',e=>errors.push(e.message));await mp.goto(origin+'/transcribe.html');await mp.waitForSelector('#runtime.ready');await mp.locator('#audioFile').setInputFiles(resolve(root,'.cache/test-audio/with-vocals.mp3'));await mp.selectOption('#clipDuration','30');await mp.click('#recognize');await mp.waitForSelector('#recognizedScore:not([hidden])',{timeout:180000});
  const vocalPath=await mp.locator('#vocalPlayer').getAttribute('src'),mixedId=vocalPath.match(/jobs\/([^/]+)/)[1],mixed=JSON.parse(await readFile(resolve(root,'.audio-jobs',mixedId,'result.json'),'utf8'));assert.equal(mixed.sourceMode,'mixed');assert.ok(mixed.notes.length>10);assert.match(mixed.method,/htdemucs/);await mp.screenshot({path:'design/previews/transcription-vocal-song.png',fullPage:true});
  const [md]=await Promise.all([mp.waitForEvent('download'),mp.click('#download')]);validate(JSON.parse(await readFile(await md.path(),'utf8')));console.log('真实带伴奏主唱样本浏览器流程通过：'+mixed.notes.length+' 个候选音符；该数量不表示转录准确率。');await mp.close();
 }
 assert.deepEqual(errors,[]);console.log('真实端到端通过：MP3 上传→Python 音高识别→已知八音准确匹配→时值/八度/升号显示→试听→速度调号重排→JPU 下载→进入编辑器且旧草稿不变→取消任务→坏音频错误→手机布局。未启动任何服务器。');
}finally{api.close();await browser.close();}
