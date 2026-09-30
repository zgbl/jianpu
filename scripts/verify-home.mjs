import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'/Users/tuxy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const root=process.cwd(),origin='http://localhost:51999',browser=await chromium.launch({headless:true,channel:'chrome'});
const context=await browser.newContext({viewport:{width:1440,height:960}}),errors=[];
await context.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(url.pathname==='/api/audio/health')return route.fulfill({json:{ready:true}});
 try{assert.equal(url.origin,origin);const file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));assert.ok(file.startsWith(root+'/'));await route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]||'application/json'});}catch{await route.fulfill({status:404,body:'Not found'});}
});
try{
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
 const editor=page.frameLocator('#editorFrame'),audio=page.frameLocator('#transcribeFrame');await editor.locator('#score svg').waitFor();
 await editor.locator('#notes button').nth(2).click();assert.equal(await editor.locator('#score .digit').count(),1);
 const originalEditor=page.frames().find(frame=>frame.url().includes('editor.html'));
 await page.getByRole('tab',{name:'听歌记谱'}).click();await audio.locator('#runtime.ready').waitFor();
 await audio.locator('#audioFile').setInputFiles(resolve(root,'audio/examples/known-melody.mp3'));
 await page.getByRole('tab',{name:'简谱编辑器'}).click();assert.equal(await editor.locator('#score .digit').count(),1);assert.ok(page.frames().includes(originalEditor));
 await editor.locator('details.menu').filter({has:editor.locator('[data-workspace-tab="transcribe"]')}).locator('summary').click();await editor.locator('[data-workspace-tab="transcribe"]').click();await page.waitForFunction(()=>document.querySelector('#transcribeTab').getAttribute('aria-selected')==='true');assert.match(await audio.locator('#fileLabel').textContent(),/known-melody/);
 await audio.locator('a.back').click();await page.waitForFunction(()=>document.querySelector('#editorTab').getAttribute('aria-selected')==='true');
 // Generated score handoff respects the editor's existing unsaved-document dialog.
 const song='/SampleSheet/我如此爱你/我们的输出/我如此爱你.jpu';
 const af=page.frames().find(frame=>frame.url().includes('transcribe.html'));
 await af.evaluate(path=>parent.postMessage({type:'workspace:open-score',path},location.origin),song);
 await editor.locator('#unsavedDialog').waitFor({state:'visible'});await editor.locator('#unsavedDiscard').click();await editor.locator('#score .digit').nth(189).waitFor();await page.waitForURL(/score=/);
 await page.getByRole('tab',{name:'听歌记谱'}).click();await page.getByRole('tab',{name:'听歌记谱'}).press('ArrowLeft');assert.equal(await page.locator('#editorTab').getAttribute('aria-selected'),'true');
 await mkdir('design/previews',{recursive:true});await page.screenshot({path:'design/previews/home-editor.png'});await page.getByRole('tab',{name:'听歌记谱'}).click();await page.screenshot({path:'design/previews/home-transcribe.png'});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await page.getByRole('tab',{name:'听歌记谱'}).isVisible());
 const legacy=await context.newPage();legacy.on('pageerror',e=>errors.push(e.message));await legacy.goto(origin+'/?score='+encodeURIComponent(song));await legacy.frameLocator('#editorFrame').locator('#score .digit').nth(189).waitFor();
 const direct=await context.newPage();await direct.goto(origin+'/?tab=transcribe');await direct.frameLocator('#transcribeFrame').locator('#runtime.ready').waitFor();assert.equal(await direct.locator('#transcribeTab').getAttribute('aria-selected'),'true');
 assert.deepEqual(errors,[]);console.log('PASS: root homepage, tabs, preserved editor/MP3 state, child links, guarded score handoff, keyboard tabs, mobile, legacy score URLs, direct audio tab. No server started.');
}finally{await browser.close();}
