import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile,rm,symlink} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,extname,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable,Writable} from 'node:stream';
import {createProjectStore} from '../audio/project-store.mjs';
import {createAudioAPI} from '../audio/api.mjs';
import {loadPlaywright} from './playwright-runtime.mjs';
const root=process.cwd(),input=process.env.RHYTHM_TEST_PROJECT,output=process.env.RHYTHM_TEST_EXPORT;
if(!input)throw Error('指定 RHYTHM_TEST_PROJECT 为待验证的工程包');
const temporary=await mkdtemp(resolve(tmpdir(),'jianpu-rhythm-browser-')),store=createProjectStore(temporary),origin='http://localhost:51999',errors=[];
await mkdir(resolve(temporary,'audio'));for(const file of ['project-archive.py','rhythm.py'])await copyFile(resolve(root,'audio',file),resolve(temporary,'audio',file));await symlink(resolve(root,'.venv-audio'),resolve(temporary,'.venv-audio'));await symlink(resolve(root,'.cache'),resolve(temporary,'.cache'));
let p=await store.importPackage(createReadStream(input));const originalScore=structuredClone(p.score),run=p.runs.find(r=>r.id===p.activeRunId),oldBpm=run.notation.bpm;
p=await store.patch(p.id,{revision:p.revision,workspace:{...p.workspace,stage:'transcribe'}});
const api=createAudioAPI(temporary,{projects:store}),{chromium}=await loadPlaywright(),browser=await chromium.launch({headless:true,channel:'chrome'});
class Response extends Writable{constructor(){super();this.chunks=[];this.status=200;this.headers={};}_write(chunk,encoding,callback){this.chunks.push(Buffer.from(chunk));callback();}writeHead(status,headers){this.status=status;this.headers=headers;this.headersSent=true;}}
async function context(){const ctx=await browser.newContext({viewport:{width:1440,height:1024}});await ctx.addInitScript(()=>{window.showSaveFilePicker=undefined;});await ctx.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin)return route.abort();if(url.pathname.startsWith('/api/')){const req=Readable.from(request.postDataBuffer()?[request.postDataBuffer()]:[]);req.method=request.method();req.headers={...request.headers(),host:'localhost:51999'};if(url.pathname.endsWith('/asset')&&/\.(wav|audio|mp3)$/.test(url.searchParams.get('path')||'')){const start=Number((req.headers.range||'bytes=0-').match(/bytes=(\d+)/)?.[1]||0);req.headers.range=`bytes=${start}-${start+1048575}`;}const res=new Response(),done=new Promise((ok,fail)=>{res.on('finish',ok);res.on('error',fail);});if(!(await store.handle(req,res,url)))await api.handle(req,res,url);await done;return route.fulfill({status:res.status,headers:res.headers,body:Buffer.concat(res.chunks)});}try{const file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));assert.ok(file.startsWith(root+'/'));await route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream'});}catch{await route.fulfill({status:404,body:'Not found'});}});return ctx;}
async function saved(predicate){for(let i=0;i<150;i++){const latest=await store.read(p.id);if(predicate(latest))return latest;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('工程状态未保存');}
try{
 const ctx=await context(),page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 // Capture actual Web Audio graph scheduling and PCM energy in the browser.
 await ctx.addInitScript(()=>{window.clickSounds=[];window.audioEnergy=0;const native=AudioContext.prototype.createOscillator;AudioContext.prototype.createOscillator=function(){const o=native.call(this),start=o.start.bind(o);o.start=time=>{window.clickSounds.push({time,frequency:o.frequency.value});return start(time);};return o;};const resume=AudioContext.prototype.resume;AudioContext.prototype.resume=function(){const analyser=this.createAnalyser();analyser.fftSize=256;this.destination.channelCount=2;const gain=AudioContext.prototype.createGain;const ctx=this;AudioContext.prototype.createGain=function(){const g=gain.call(this);if(this===ctx)g.connect(analyser);return g;};setInterval(()=>{const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);window.audioEnergy=Math.max(window.audioEnergy,...data.map(Math.abs));},10);return resume.call(this);};});
 await page.goto(origin+'/?project='+p.id);const view=page.frameLocator('#transcribeFrame');await view.locator('#recognizedScore:not([hidden])').waitFor();
 assert.ok((await view.locator('#detectedTempo').textContent()).includes('BPM'));
 // Place on-score boundary; the click must add a real marker rather than seek.
 await view.locator('#manualBarMode').click();await view.locator('#recognizedScore g[data-note]').filter({hasText:/[1-7]/}).first().click();assert.equal(await view.locator('.manual-bar-marker').count(),1);
 const time=Number(await view.getByLabel('人工边界 0 时间',{exact:true}).inputValue());
 await view.locator('#vocalPlayer').evaluate((node,t)=>{node.currentTime=t;},time+4.4);await view.locator('#manualBarGap').fill('3');await view.locator('#manualBarCurrent').click();assert.equal(await view.locator('.manual-bar-marker').count(),2);
 // Explicit times simulate the human judgement: three bars in 4.4 seconds.
 await view.getByLabel('人工边界 0 时间',{exact:true}).fill('30');await view.getByLabel('人工边界 0 时间',{exact:true}).press('Tab');
 await view.getByLabel('人工边界 1 时间',{exact:true}).fill('34.4');await view.getByLabel('人工边界 1 时间',{exact:true}).press('Tab');
 await view.locator('#applyManualBars').click();const manualBpm=Number(await view.locator('#bpm').inputValue());assert.ok(manualBpm>162&&manualBpm<165);assert.equal(await view.locator('#rhythmMode').inputValue(),'fixed');assert.ok(await view.locator('#recognizedScore g[data-measure]').count()>200);
 p=await saved(v=>v.workspace.transcribe.manualCalibration?.points.length===2);assert.ok(p.score.transcription.bpm>162);
 let preview=JSON.parse(await readFile(resolve(store.folder(p.id),`runs/${run.id}/recognized.jpu`),'utf8'));const duration=preview.measures[1].notes[0].gridTimeStart-preview.measures[0].notes[0].gridTimeStart;assert.ok(Math.abs(duration-4.4/3)<.01);
 await view.locator('#undoManualBars').click();assert.equal(await view.locator('.manual-bar-marker').count(),2);assert.equal(Number(await view.locator('#bpm').inputValue()),oldBpm);
 await view.locator('#analyzeRhythm').click();assert.ok(Number(await view.locator('#bpm').inputValue())>162); // existing rebar honors manual markings
 await view.locator('#bpm').fill('120');await view.locator('#meter').selectOption('3');await view.locator('#applyTempo').click();
 p=await saved(v=>v.workspace.transcribe.bpm==='120'&&v.workspace.transcribe.meter==='3'&&v.workspace.transcribe.rhythmMode==='fixed'&&!v.workspace.transcribe.manualCalibration);
 preview=JSON.parse(await readFile(resolve(store.folder(p.id),`runs/${run.id}/recognized.jpu`),'utf8'));assert.deepEqual(preview.meter,[3,4]);for(let i=1;i<preview.measures.length;i++)assert.ok(Math.abs(preview.measures[i].notes[0].gridTimeStart-preview.measures[i-1].notes[0].gridTimeStart-1.5)<1e-6);
 await view.locator('#metronome').click();await page.waitForTimeout(1750);const sounds=await view.locator('body').evaluate(()=>({sounds:window.clickSounds,energy:window.audioEnergy}));assert.ok(sounds.sounds.length>=4);assert.deepEqual(sounds.sounds.slice(0,4).map(s=>s.frequency),[1500,950,950,1500]);assert.ok(sounds.energy>.01,'real PCM must be nonzero');assert.ok(Math.abs(sounds.sounds[1].time-sounds.sounds[0].time-.5)<.035);
 await page.locator('body').press('Space');await page.waitForTimeout(100);assert.equal(await view.locator('#metronome').getAttribute('aria-pressed'),'false');await page.locator('body').press('Space');await page.waitForTimeout(100);assert.equal(await view.locator('#metronome').getAttribute('aria-pressed'),'true');await view.locator('#metronome').click();const count=await view.locator('body').evaluate(()=>window.clickSounds.length);await page.waitForTimeout(600);assert.equal(await view.locator('body').evaluate(()=>window.clickSounds.length),count);
 // Move and delete are independent and do not silently merge markers.
 await view.locator('#manualBarList button').filter({hasText:'移动'}).first().click();await view.locator('#recognizedScore g[data-note]').filter({hasText:/[1-7]/}).first().click();assert.equal(await view.locator('.manual-bar-marker').count(),2);
 await view.locator('#manualBarList button').filter({hasText:'删除'}).last().click();assert.equal(await view.locator('.manual-bar-marker').count(),1);
 p=await saved(v=>v.workspace.transcribe.manualBars?.length===1&&v.workspace.transcribe.meter==='3');
 const bundle=await store.exportPackage(p.id);let reopened;try{reopened=await store.importPackage(createReadStream(bundle.path));}finally{await bundle.cleanup();}
 assert.equal(reopened.workspace.transcribe.manualBars.length,1);assert.equal(reopened.workspace.transcribe.bpm,'120');
 await page.reload();await view.locator('#recognizedScore:not([hidden])').waitFor();assert.equal(await view.locator('.manual-bar-marker').count(),1);assert.equal(await view.locator('#meter').inputValue(),'3');assert.equal(await view.locator('#bpm').inputValue(),'120');
 await view.locator('#applyTempo').scrollIntoViewIfNeeded();await mkdir(resolve(root,'design/previews'),{recursive:true});await page.screenshot({path:resolve(root,'design/previews/manual-bars.png')});await view.locator('#manualBarMode').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(root,'design/previews/manual-boundaries.png')});assert.deepEqual(errors,[]);
 console.log('PASS: actual 披着羊皮的狼 temporary project: on-score marking, 3-bar manual count, >200 bars, uniform extrapolation, undo, existing rebar honors marks, 120 BPM 3/4, actual nonzero PCM clicks with accents, stop, move/delete, package persistence and reload. Input package untouched; no server started.');
}finally{api.close();await browser.close();await rm(temporary,{recursive:true,force:true});}
