import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export async function loadPlaywright(){
 if(process.env.PLAYWRIGHT_MODULE)return import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)));
 try{return await import('playwright');}catch(error){
  if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;
 }
 // Optional existing Codex runtime; derive the location from the current user.
 const bundled=resolve(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
 try{return await import(pathToFileURL(bundled));}catch{
  throw Error('需要 Playwright：安装 playwright，或用 PLAYWRIGHT_MODULE 指定其 index.mjs。');
 }
}
