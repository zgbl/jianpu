import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {loadPlaywright} from './playwright-runtime.mjs';

// All requests are fulfilled from files: no development server or paid model call.
const root=process.cwd(),origin='http://jianpu-test.local';
const rules=await readFile(resolve(root,'doc/视觉大模型读谱输出JPU规范与提示词.md'),'utf8');
const input=process.env.MODEL_SCORE_INPUT?await readFile(process.env.MODEL_SCORE_INPUT,'utf8'):rules.match(/```json\n([\s\S]*?)\n```/)[1];
const {chromium}=await loadPlaywright();
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 const context=await browser.newContext(),page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());assert.equal(url.origin,origin);
  if(url.pathname.startsWith('/api/')){requests.push(url.pathname);return route.fulfill({json:{configured:false}});}
  const file=resolve(root,'.'+url.pathname);assert.ok(file.startsWith(root+'/'));
  await route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(file)]||'application/octet-stream'});
 });
 await page.goto(origin+'/model-score.html');await page.waitForLoadState('networkidle');
 assert.equal(await page.locator('#onlineSetup').isVisible(),false);
 assert.equal(await page.locator('#convert').isEnabled(),true);
 await page.locator('#modelText').fill(input);await page.locator('#convert').click();
 await page.locator('#scorePreview svg').waitFor();
 assert.equal(await page.locator('#error').isVisible(),false);
 assert.equal(requests.length,0,'手工生成不应访问模型接口');
 const summary=await page.locator('#summary').textContent();assert.match(summary,/小节/);
 const downloaded=page.waitForEvent('download');await page.locator('#download').click();
 assert.match((await downloaded).suggestedFilename(),/\.jpu$/);
 await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{origin:location.origin,source:parent,data:{type:'project:restore',project:{name:'测试工程'}}})));
 assert.equal(await page.locator('#import').isEnabled(),true);
 await page.evaluate(()=>{window.testImported=null;window.addEventListener('message',event=>{if(event.data?.type==='workspace:import-score')window.testImported=event.data.score;});});
 await page.locator('#import').click();await page.waitForFunction(()=>window.testImported?.measures?.length>0);
 await page.locator('#onlineMode').click();assert.equal(await page.locator('#onlineSetup').isVisible(),true);
 assert.equal(await page.locator('#provider').inputValue(),'gemini');
 await page.locator('#manualMode').click();assert.equal(await page.locator('#onlineSetup').isVisible(),false);
 await page.locator('#modelText').fill('{"format":"jianpu-melody","version":2,"measures":[]}');await page.locator('#convert').click();
 assert.match(await page.locator('#error').textContent(),/没有识别出任何小节/);
 assert.equal(await page.locator('#previewPanel').isVisible(),false);
 assert.deepEqual(errors,[]);
 console.log('浏览器验证通过：'+summary+'；无需登录生成、下载 JPU、发送导入消息、切换 Gemini、拒绝空谱面。');
}finally{await browser.close();}
