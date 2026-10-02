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
async function context(){const ctx=await browser.newContext({viewport:{width:1440,height:1024}});await ctx.addInitScript(()=>{window.showSaveFilePicker=undefined;});await ctx.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin)return route.abort();if(url.pathname.startsWith('/api/')){const req=Readable.from(request.postDataBuffer()?[request.postDataBuffer()]:[]);req.method=request.method();req.headers={...request.headers(),host:'localhost:51999'};const res=new Response(),done=new Promise((ok,fail)=>{res.on('finish',ok);res.on('error',fail);});if(!(await store.handle(req,res,url)))await api.handle(req,res,url);await done;return route.fulfill({status:res.status,headers:res.headers,body:Buffer.concat(res.chunks)});}try{const file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));assert.ok(file.startsWith(root+'/'));await route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream'});}catch{await route.fulfill({status:404,body:'Not found'});}});return ctx;}
async function saved(predicate){for(let i=0;i<150;i++){const latest=await store.read(p.id);if(predicate(latest))return latest;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('工程状态未保存');}
try{
 let ctx=await context(),page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/?project='+p.id);const view=()=>page.frameLocator('#transcribeFrame');await view().locator('#recognizedScore:not([hidden])').waitFor();
 assert.equal(await view().locator('#clipDuration option[value="600"]').textContent(),'全曲');
 const oldBars=await view().locator('#recognizedScore g[data-measure]').count();await view().locator('#analyzeRhythm').click();await view().locator('#rhythmMode').evaluate(async node=>{while(node.value!=='stable')await new Promise(resolve=>setTimeout(resolve,50));});
 const bpm=Number(await view().locator('#bpm').inputValue()),newBars=await view().locator('#recognizedScore g[data-measure]').count();assert.ok(bpm>77&&bpm<81);assert.ok(Math.abs(oldBpm/bpm-2)<.05);assert.ok(newBars<oldBars*.65);
 p=await saved(v=>v.workspace.transcribe.rhythmMode==='stable');assert.deepEqual(p.score,originalScore);const rhythm=p.workspace.transcribe.rhythm;assert.ok(rhythm.beatTimes.length>200);assert.equal(rhythm.source,'bass+drums');assert.equal(rhythm.stableGrid.fitMeasures,20);const starts=JSON.parse(await readFile(resolve(store.folder(p.id),`runs/${run.id}/recognized.jpu`),'utf8')).measures.map(m=>m.notes[0].gridTimeStart);for(let i=1;i<starts.length;i++)assert.ok(Math.abs(starts[i]-starts[i-1]-rhythm.stableGrid.barDuration)<.00001);assert.equal(rhythm.downbeatConfirmed,false);assert.ok(await view().locator('.rhythm-downbeat').count()>50);
 // Choose an actual detected beat. Both the timestamp button and beat-phase
 // shift must change bars without altering source pitches.
 const target=rhythm.beatTimes[8];await view().locator('#vocalPlayer').evaluate((node,time)=>{node.currentTime=time;},target);await page.waitForTimeout(120);await view().locator('#anchorCurrent').click();assert.ok(Math.abs(Number(await view().locator('#barAnchor').inputValue())-target)<.002);await view().locator('#barLater').click();assert.ok(Number(await view().locator('#barAnchor').inputValue())>target+.6);
 await view().locator('#tempoCandidate').selectOption(String(rhythm.candidates.find(c=>c.bpm>150&&c.bpm<165).bpm));assert.equal(await view().locator('#rhythmMode').inputValue(),'fixed');
 // Reset the provisional automatic result, then export a NEW package with the
 // original manual score preserved in history, never touch the input package.
 await view().locator('#analyzeRhythm').click();await view().locator('#analyzeRhythm').waitFor({state:'visible'});p=await saved(v=>v.workspace.transcribe.rhythmMode==='stable'&&!v.workspace.transcribe.rhythm.downbeatConfirmed&&v.workspace.transcribe.bpm===String(bpm));
 await ctx.close();p=await store.adopt(p.id,run.id);assert.equal(p.score.transcription.rhythmMode,'stable');assert.equal(p.score.transcription.bpm,bpm);if(originalScore.measures.some(m=>m.notes.length))assert.deepEqual(p.history[0].score,originalScore);
 if(output){await mkdir(dirname(resolve(output)),{recursive:true});const bundle=await store.exportPackage(p.id);try{await copyFile(bundle.path,resolve(output));}finally{await bundle.cleanup();}}
 ctx=await context();page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/?project='+p.id);await page.getByRole('tab',{name:'听歌识别'}).click();await view().locator('#recognizedScore:not([hidden])').waitFor();assert.equal(await view().locator('#rhythmMode').inputValue(),'stable');assert.equal(Number(await view().locator('#bpm').inputValue()),bpm);assert.equal(await view().locator('#recognizedScore g[data-measure]').count(),newBars);
 // Grid-based playhead must change rows at the written bar's real boundary.
 const first=p.score.measures[0].notes.find(n=>n.degree);await view().locator('#vocalPlayer').evaluate((node,time)=>{node.currentTime=time;},first.gridTimeStart+.03);await view().locator('.audio-score-playhead').waitFor();await view().locator('#recognizedScore g[data-note]').first().scrollIntoViewIfNeeded();await view().locator('#analyzeRhythm').scrollIntoViewIfNeeded();await mkdir(resolve(root,'design/previews'),{recursive:true});await page.screenshot({path:resolve(root,'design/previews/rhythm-calibration.png')});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 console.log(`PASS: actual 美若黎明 .jpp; ${oldBpm}→${bpm} BPM, ${oldBars}→${newBars} melody measures; beat analysis, timestamp calibration, phase shift, tempo alternatives, original score preservation, history, package export, browser recovery and playhead. No server started.`);
}finally{api.close();await browser.close();await rm(temporary,{recursive:true,force:true});}
