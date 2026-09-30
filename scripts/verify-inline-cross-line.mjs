import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const engine=process.env.JIANPU_TEST_BROWSER||'chromium';
const {chromium,webkit}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||(engine==='webkit'?'/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/playwright/driver/package/index.mjs':'/Users/tuxy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const browser=await(engine==='webkit'?webkit.launch({headless:true,executablePath:'/Users/tuxy/Library/Caches/ms-playwright/webkit-1967/pw_run.sh'}):chromium.launch({headless:true,channel:'chrome'}));
const root=process.cwd(),origin='http://localhost:51999',path='/SampleSheet/我如此爱你/我们的输出/我如此爱你.jpu',errors=[];
const fixture=JSON.parse(await readFile(resolve(root,'.'+path),'utf8'));
fixture.lyrics=fixture.lyrics.filter(l=>l.verse!==1||(process.env.JIANPU_TEST_FULL_SONG&&!['m4n4','m4n5','m4n6','m5n1','m5n2'].includes(l.noteId)));
for(const [noteId,text] of [['m4n4','我'],['m4n5','真'],['m4n6','的'],['m5n1','爱'],['m5n2','你']])fixture.lyrics.push({noteId,verse:1,text});
if(process.env.JIANPU_TEST_LEGACY_OFFSETS)for(const l of fixture.lyrics)if(l.verse===1&&['m4n4','m4n5','m4n6'].includes(l.noteId))l.offsetX=55;
try{
 const context=await browser.newContext({viewport:{width:1440,height:960}});
 await context.addInitScript(()=>{window.showSaveFilePicker=undefined;});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  try{const url=new URL(route.request().url());assert.equal(url.origin,origin);const target=resolve(root,'.'+decodeURIComponent(url.pathname)),file=target===root?resolve(root,'index.html'):target;assert.ok(file.startsWith(root+sep));await route.fulfill({body:file===resolve(root,'.'+path)?JSON.stringify(fixture):await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]||'application/json'});}catch{await route.fulfill({status:404,body:'Not found'});}
 });
 const saved=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)).score,'jianpu-workbench:'+path);
 const word=(s,id)=>s.lyrics.find(l=>l.noteId===id&&l.verse===1)?.text;
 const group=id=>page.locator(`[data-lyric="${id}"][data-verse="1"]`);
 const anchor=id=>page.locator(`[data-note="${id}"] .digit`).evaluate(el=>{const svg=el.ownerSVGElement,p=svg.createSVGPoint();p.x=+el.getAttribute('x');p.y=+el.getAttribute('y')+62;const t=p.matrixTransform(svg.getScreenCTM());return {x:t.x,y:t.y};});
 async function pressFrom(locator){await locator.scrollIntoViewIfNeeded();const r=await locator.boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();}
 async function drop(locator,id,previewCheck){await pressFrom(locator);const target=await anchor(id);await page.mouse.move(target.x,target.y,{steps:16});if(previewCheck)await previewCheck();await page.mouse.up();}
 async function aligned(){const boxes=await page.locator('#score [data-verse="1"] text.lyric').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {text:el.textContent,x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];assert.ok(!(a.x<b.right-.5&&b.x<a.right-.5&&a.y<b.bottom-.5&&b.y<a.bottom-.5),`歌词重叠：${a.text}/${b.text}`);}}
 await page.goto(origin+'/editor.html?score='+encodeURIComponent(path));await page.waitForFunction(count=>document.querySelectorAll('#score .lyric').length===count,fixture.lyrics.length);
 if(process.env.JIANPU_TEST_ZOOM)await page.selectOption('#zoom',process.env.JIANPU_TEST_ZOOM);
 // Same-line movement must re-anchor, not leave text at arbitrary pixel offsets.
 await group('m4n4').click();await drop(page.locator('#lyricInput'),'m4n5');
 let s=await saved();assert.equal(word(s,'m4n4'),undefined);assert.equal(word(s,'m4n5'),'我');assert.equal(word(s,'m4n6'),'真');assert.equal(word(s,'m5n1'),'的');await aligned();await page.click('#undo');
 // Destination text must move during preview, not only after releasing the mouse.
 await group('m4n4').click();await drop(page.locator('#lyricInput'),'m5n1',async()=>{
  for(const [id,text] of [['m5n1','我'],['m5n2','真'],['m5n3','的'],['m5n4','爱'],['m5n5','你']])assert.equal(await group(id).locator('.lyric').textContent(),text);
  assert.equal(word(await saved(),'m4n4'),'我','预览不能提前保存');await aligned();
  await mkdir('design/previews',{recursive:true});await page.screenshot({path:`design/previews/lyrics-insertion-preview-${engine}.png`});
 });
 s=await saved();assert.deepEqual(s.measures[4].notes.map(n=>word(s,n.id)),['我','真','的','爱','你']);assert.ok(!s.lyrics.some(l=>l.verse===1&&['m4n4','m4n5','m4n6'].includes(l.noteId)));
 assert.deepEqual(s.lyrics.filter(l=>l.verse===1).map(l=>l.text).sort(),fixture.lyrics.filter(l=>l.verse===1).map(l=>l.text).sort());assert.deepEqual(s.lyrics.filter(l=>l.verse===2),fixture.lyrics.filter(l=>l.verse===2));await aligned();
 await page.click('#undo');assert.equal(word(await saved(),'m4n4'),'我');await page.click('#redo');assert.equal(word(await saved(),'m5n1'),'我');
 const [download]=await Promise.all([page.waitForEvent('download'),page.click('#save')]);assert.equal(word(JSON.parse(await readFile(await download.path(),'utf8')),'m5n1'),'我');await page.reload();await page.waitForSelector('#score .lyric');assert.equal(word(await saved(),'m5n1'),'我');
 // Single-character dragging leaves source-side following words in place.
 await group('m5n1').click();await page.selectOption('#lyricDragScope','single');await drop(group('m5n1').locator('[data-lyric-char="0"]'),'m5n3');s=await saved();assert.equal(word(s,'m5n1'),undefined);assert.equal(word(s,'m5n2'),'真');assert.equal(word(s,'m5n3'),'我');assert.equal(word(s,'m5n4'),'的');await aligned();await page.click('#undo');
 // Multiple characters on one note; extract the specific character that was grabbed.
 await group('m5n1').click();await page.selectOption('#lyricEntryMode','note');await page.fill('#lyricInput','我如此爱');await page.press('#lyricInput','Escape');
 // Escape cancels text, so repeat and explicitly commit before moving.
 await group('m5n1').click();await page.fill('#lyricInput','我如此爱');await page.click('#lyricApply');s=await saved();assert.equal(word(s,'m5n1'),'我如此爱');assert.equal(word(s,'m5n2'),'真');assert.equal(await group('m5n1').locator('[data-lyric-char]').count(),4);await aligned();
 await drop(group('m5n1').locator('[data-lyric-char="2"]'),'m6n1');s=await saved();assert.equal(word(s,'m5n1'),'我如爱');assert.equal(word(s,'m5n2'),'真');assert.equal(word(s,'m6n1'),'此');await aligned();
 const [multiDownload]=await Promise.all([page.waitForEvent('download'),page.click('#save')]);const multi=JSON.parse(await readFile(await multiDownload.path(),'utf8'));assert.equal(word(multi,'m5n1'),'我如爱');assert.equal(word(multi,'m6n1'),'此');await page.reload();await page.waitForSelector('#score .lyric');assert.equal(word(await saved(),'m6n1'),'此');await aligned();
 await page.screenshot({path:`design/previews/lyrics-single-character-${engine}.png`});assert.deepEqual(errors,[]);
 console.log(`${engine} 通过：同排及跨排插入、拖动中已有歌词让位且不重叠、后续跨行排列、单字拖动、同音四字及指定字提取、撤销重做、保存刷新。未启动服务器。`);
}finally{await browser.close();}
