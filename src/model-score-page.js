import {prepareModelScore,prepareReceivedModelScore} from './model-score-import.js';
import {applyMeasureReview} from './model-score-review.js';
import {render} from './render.js';
import {downloadFile,safeName} from './files.js';
import {chooseChatGPTModel,readModelStream} from './model-score-stream.js';

const $=id=>document.getElementById(id),origin=location.origin;
let prepared=null,project=null,importing=false,busy=false,images=[],history=[],providerConfigured=false,providerCheck=0,activeRequest=null,requestStartedAt=0,requestTicker=null,chatgptModels=[],loginPoll=null;
let receivedCharacters=0,firstOutputAt=null;
function savedChatGPTModel(){try{return localStorage.getItem('jianpu.chatgpt-model')||'';}catch{return '';}}
function rememberChatGPTModel(value){try{localStorage.setItem('jianpu.chatgpt-model',value);}catch{}}
const marked=new Map();
function selectInputMode(mode){
 const manual=mode==='manual';$('onlineSetup').hidden=manual;$('manualHint').hidden=!manual;
 for(const [id,selected] of [['manualMode',manual],['onlineMode',!manual]]){$(id).classList.toggle('primary',selected);$(id).setAttribute('aria-pressed',String(selected));}
 if(manual){providerCheck++;clearError();$('modelText').focus();}else refreshProviderConfig();
}
$('manualMode').onclick=()=>selectInputMode('manual');
$('onlineMode').onclick=()=>selectInputMode('online');
function error(message){$('error').textContent=message;$('error').hidden=false;}
function clearError(){$('error').hidden=true;$('error').textContent='';}
function status(message){$('status').textContent=message;}
function invalidate(){prepared=null;$('result').hidden=true;$('empty').hidden=false;$('previewPanel').hidden=true;$('import').disabled=true;$('download').disabled=true;$('review').disabled=true;clearError();}
function renderMarked(){
 $('marked').replaceChildren();for(const [number,note] of [...marked].sort((a,b)=>a[0]-b[0])){
  const row=document.createElement('div');row.className='marked-row';const label=document.createElement('label');label.textContent=`第 ${number} 小节`;const input=document.createElement('input');input.value=note;input.placeholder='补充疑点，例如：第二个音应为 8 分音符';input.setAttribute('aria-label',`第 ${number} 小节的复核意见`);input.oninput=()=>marked.set(number,input.value);const remove=document.createElement('button');remove.textContent='移除';remove.type='button';remove.onclick=()=>{marked.delete(number);renderMarked();highlightMarks();};row.append(label,input,remove);$('marked').append(row);
 }
 if(!marked.size)$('marked').textContent='尚未标记小节。点击谱面上的小节即可添加。';
 $('review').disabled=!prepared||!marked.size||busy||!images.length;
}
function highlightMarks(){for(const g of $('scorePreview').querySelectorAll('g[data-measure]'))g.classList.toggle('flagged',marked.has(Number(g.dataset.measure)+1));}
function showPrepared(next,{resetMarks=false}={}){
 prepared=next;const {score,beats,issues,warnings}=next;
 if(project)parent.postMessage({type:'model-score:draft',score,projectId:project.id},origin);
 if(resetMarks){marked.clear();for(const item of next.invalid)marked.set(item.measure,'拍数不符，请对照原图复核');for(const item of issues)if(Number.isInteger(item.measure)&&item.measure>=1&&item.measure<=score.measures.length&&!marked.has(item.measure))marked.set(item.measure,item.description);}
 $('summary').textContent=`${score.title} · ${score.measures.length} 小节 · ${score.measures.reduce((sum,m)=>sum+m.notes.length,0)} 个音符 · ${(score.lyrics||[]).length} 个歌词位置 · ${(score.chords||[]).length} 个和弦`;
 $('warnings').replaceChildren();for(const message of warnings){const p=document.createElement('p');p.textContent=message;$('warnings').append(p);}$('warnings').hidden=!warnings.length;
 $('issues').replaceChildren();for(const issue of issues){const item=document.createElement('li');item.textContent=`${issue.page?`第 ${issue.page} 图 · `:''}${issue.measure?`第 ${issue.measure} 小节 · `:''}${issue.description}`;$('issues').append(item);}$('issueDetails').hidden=!issues.length;
 $('beats').replaceChildren();for(const beat of beats){const span=document.createElement('span');span.className='beat'+(Math.abs(beat.beats-beat.expected)>.01?' invalid':'');span.textContent=`${beat.measure}：${beat.beats}/${beat.expected} 拍`;$('beats').append(span);}
 $('scorePreview').innerHTML=render(score,null,-1,false);highlightMarks();renderMarked();
 $('empty').hidden=true;$('result').hidden=false;$('previewPanel').hidden=false;$('download').disabled=false;$('import').disabled=!project||importing;$('undo').disabled=!history.length;
}
function showImages(){
 $('imageList').replaceChildren();images.forEach((image,i)=>{const card=document.createElement('div');card.className='image-card';const img=document.createElement('img');img.src=image.url;img.alt=`第 ${i+1} 张谱图`;const info=document.createElement('div');info.textContent=`第 ${i+1} 张 · ${image.file.name||'粘贴图片'} · ${(image.file.size/1024/1024).toFixed(1)} MB`;const actions=document.createElement('div');for(const [symbol,offset,title] of [['↑',-1,'上移'],['↓',1,'下移']]){const button=document.createElement('button');button.textContent=symbol;button.type='button';button.title=title;button.disabled=i+offset<0||i+offset>=images.length;button.onclick=()=>{[images[i],images[i+offset]]=[images[i+offset],images[i]];showImages();};actions.append(button);}const remove=document.createElement('button');remove.textContent='移除';remove.type='button';remove.onclick=()=>{URL.revokeObjectURL(image.url);images.splice(i,1);showImages();};actions.append(remove);card.append(img,info,actions);$('imageList').append(card);});
 const selectedModel=$('modelName').value.trim()||providerModels[$('provider').value]||'';
 $('recognize').disabled=busy||!images.length||($('provider').value==='chatgpt'?(!providerConfigured||!$('chatgptModel').value):(!providerConfigured&&!$('apiKey').value.trim()))||($('provider').value==='openrouter'&&!selectedModel);
}
async function refreshProviderConfig(force=false){
 const token=++providerCheck,provider=$('provider').value;
 $('modelNameField').hidden=provider==='chatgpt';$('apiKeyField').hidden=provider==='chatgpt';$('chatgptControls').hidden=provider!=='chatgpt';$('chatgptPlanNote').hidden=provider!=='chatgpt';$('openRouterModelsInfo').hidden=provider!=='openrouter';
 $('modelNameField').firstChild.textContent=provider==='openrouter'?'模型 ID（必填）':'模型 ID（选填）';$('modelName').placeholder=provider==='openrouter'?'从图像模型目录选择或输入完整 ID':'留空，使用 .env 配置或服务商默认值';
 if(provider==='chatgpt'){
  try{
   const response=await fetch('/api/chatgpt-plan/status'+(force?'?refresh=1':''),{cache:'no-store'}),payload=await response.json();if(token!==providerCheck)return;
   const session=payload.session||{};providerConfigured=session.sharing===true;chatgptModels=Array.isArray(payload.models)?payload.models:[];
   const selected=chooseChatGPTModel(chatgptModels,savedChatGPTModel());$('chatgptModel').replaceChildren();
   const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='请选择模型（不会自动选择 Astra）';$('chatgptModel').append(placeholder);
   for(const item of chatgptModels){const option=document.createElement('option');option.value=item.slug;option.textContent=item.displayName||item.slug;$('chatgptModel').append(option);}
   $('chatgptModel').value=selected;
   $('modelName').value=$('chatgptModel').value;$('chatgptModelField').hidden=!providerConfigured||!chatgptModels.length;
   $('chatgptConnect').hidden=session.status==='connected'&&session.sharing;
   $('chatgptConnect').textContent=session.status==='connected'?'启用 ChatGPT 计划额度':'继续使用 ChatGPT 登录';
   $('chatgptDisconnect').hidden=session.status!=='connected';
   const email=session.identity?.email;
   $('chatgptState').textContent=session.status==='connecting'?'正在等待浏览器完成授权…':session.sharing?'已连接'+(email?'：'+email:'')+(payload.error?' · 模型列表读取失败：'+payload.error:''):session.status==='connected'?'账号已连接，但尚未授权计划额度；点击“启用 ChatGPT 计划额度”。':payload.error?'登录状态不可用：'+payload.error:'尚未登录 ChatGPT。';
   status(providerConfigured?(selected?'ChatGPT 计划额度已授权；识别请求将使用当前选定模型。':'已授权；请选择模型。GPT-6.1 Sol 已通过直接调用验证，未自动选择模型。'):'等待 ChatGPT 账号登录及计划额度授权。');
  }catch(error){if(token!==providerCheck)return;providerConfigured=false;$('chatgptState').textContent='无法读取本机 ChatGPT 登录状态：'+error.message;}
  renderActiveModel();showImages();return;
 }
 try{const response=await fetch(`/api/model-vision/status?provider=${encodeURIComponent(provider)}`,{cache:'no-store'}),payload=await response.json();if(!response.ok)throw Error(payload.error||'配置状态读取失败');if(token!==providerCheck)return;providerConfigured=payload.configured===true;providerModels[provider]=payload.model;
  if(provider==='openrouter'){
   const list=$('openRouterModelsInfo');
   if(!providerConfigured)list.textContent='在 .env 设置 OPENROUTER_API_KEY。选择 OpenRouter 模型时请输入完整模型 ID。';
   else if(Array.isArray(payload.models)&&payload.models.length){list.textContent=`目录找到 ${payload.models.length} 个可接收图片的模型。可在模型 ID 输入框按名称搜索，或填入目录中的完整 ID。`;const datalist=$('openRouterModelOptions');datalist.replaceChildren();for(const item of payload.models){const option=document.createElement('option');option.value=item.id;option.label=item.name;datalist.append(option);}}
   else list.textContent='Key 已读取，但目录暂不可用；可手工填写 OpenRouter 模型 ID。';
  }
  if(providerConfigured){if(!$('apiKey').value.trim())clearError();status(provider==='openrouter'?'OpenRouter Key 已就绪；请选择目录中的图像模型或填写完整模型 ID。':'服务商密钥已就绪；模型 ID 可留空，使用项目配置。');}
  else if(!$('apiKey').value.trim()){error(`尚未配置 ${providerLabel(provider)} API Key。请填入项目根目录 .env 并保存，或在“API Key 覆盖”临时输入；页面不会预填密钥。`);status('等待配置 API Key；识别按钮已停用。');}
 }catch{if(token!==providerCheck)return;providerConfigured=false;if(!$('apiKey').value.trim()){error('无法读取本地模型配置状态；请确认开发服务已重启到当前项目版本。');status('本地模型配置状态不可用。');}}
 showImages();
 renderActiveModel();
}
const providerModels={};
function providerLabel(provider){return ({chatgpt:'ChatGPT Plus / Pro',gemini:'Gemini',openrouter:'OpenRouter',openai:'OpenAI',qwen:'Qwen',deepseek:'DeepSeek'})[provider]||provider;}
function renderActiveModel(){const provider=$('provider').value,model=$('modelName').value.trim()||providerModels[provider];$('activeModel').textContent=model?`当前模型：${providerLabel(provider)} · ${model}`:provider==='chatgpt'?'当前模型：未选择模型':provider==='openrouter'?'当前模型：请填写 OpenRouter 模型 ID':`当前模型：正在读取 ${providerLabel(provider)} 配置…`;}
function addFiles(files){const accepted=[...files].filter(f=>['image/png','image/jpeg','image/webp'].includes(f.type));if(!accepted.length){error('请使用 PNG、JPEG 或 WebP 图片');return;}if(images.length+accepted.length>12){error('最多添加 12 张图片');return;}for(const file of accepted)images.push({file,url:URL.createObjectURL(file)});showImages();clearError();}
function base64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('读取图片失败'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);});}
async function request(mode,extra={},signal){
 if(!images.length)throw Error('请先添加谱图');if(images.reduce((sum,x)=>sum+x.file.size,0)>12*1024*1024)throw Error('图片合计超过 12 MB，请缩小或分批添加');
 status('正在读取并压缩谱图数据…');
 const encoded=await Promise.all(images.map(async x=>({mimeType:x.file.type,data:await base64(x.file)})));
 status(`已发送 ${encoded.length} 张谱图给 ${providerLabel($('provider').value)}，等待模型完整返回…`);
 const response=await fetch('/api/model-vision/recognize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode,provider:$('provider').value,model:$('modelName').value.trim(),apiKey:$('apiKey').value.trim(),stream:['chatgpt','gemini','openrouter'].includes($('provider').value),images:encoded,...extra}),signal});
 if(response.ok&&response.headers.get('content-type')?.includes('application/x-ndjson')){
  return readModelStream(response,text=>{receivedCharacters+=text.length;if(firstOutputAt===null)firstOutputAt=Date.now();$('liveOutput').hidden=false;$('liveOutput').open=true;$('liveOutputText').textContent+=text;if(mode==='initial')$('modelText').value=$('liveOutputText').textContent;status(`已收到 ${receivedCharacters} 字；首次输出等待 ${((firstOutputAt-requestStartedAt)/1000).toFixed(1)} 秒，正在接收后续内容。`);},message=>{if(!receivedCharacters)status(`${message}（已等待 ${Math.floor((Date.now()-requestStartedAt)/1000)} 秒）`);});
 }
 const payload=await response.json().catch(()=>({}));if(!response.ok){const message=payload.error||`模型请求失败（HTTP ${response.status}）`;if(/API key was reported as leaked/i.test(message))throw Error('Gemini 已将这把 API Key 标记为泄露并封锁。请在 Google AI Studio 撤销这把 Key、创建新 Key，替换项目 .env 中的 GEMINI_API_KEY 后重启开发服务。不要把 Key 发到聊天或截图中。');throw Error(message);}return payload;
}
function setBusy(value,message){busy=value;for(const id of ['provider','chatgptModel','modelName','refreshChatGPTModels'])$(id).disabled=value;status(message);$('recognize').disabled=value||!images.length;$('cancelRequest').hidden=!value;$('review').disabled=value||!prepared||!marked.size||!images.length;if(value){receivedCharacters=0;firstOutputAt=null;$('liveOutputText').textContent='';$('liveOutput').hidden=true;requestStartedAt=Date.now();clearInterval(requestTicker);requestTicker=setInterval(()=>{if(!busy)return;const elapsed=Math.floor((Date.now()-requestStartedAt)/1000);if(elapsed>=10)status(receivedCharacters?`已收到 ${receivedCharacters} 字（总耗时 ${elapsed} 秒）；等待后续输出，可取消。`:`尚未收到首个输出（已等待 ${elapsed} 秒）；可点击“取消等待”。`);},1000);}else{clearInterval(requestTicker);requestTicker=null;activeRequest=null;showImages();}}
$('cancelRequest').onclick=()=>{if(activeRequest){activeRequest.abort();status('已取消本次等待；已生成的谱面未修改。');}};
$('imageFiles').onchange=event=>{addFiles(event.target.files);event.target.value='';};
$('modelSettings').addEventListener('submit',event=>event.preventDefault());
$('provider').onchange=()=>{$('modelName').value='';$('apiKey').value='';providerConfigured=false;renderActiveModel();refreshProviderConfig();};
 $('modelName').oninput=()=>{renderActiveModel();showImages();};
$('chatgptModel').onchange=()=>{rememberChatGPTModel($('chatgptModel').value);$('modelName').value=$('chatgptModel').value;renderActiveModel();showImages();};
$('refreshChatGPTModels').onclick=async()=>{$('refreshChatGPTModels').disabled=true;try{await refreshProviderConfig(true);}finally{$('refreshChatGPTModels').disabled=false;}};
$('apiKey').oninput=showImages;
$('chatgptConnect').onclick=async()=>{
 const reconsent=$('chatgptConnect').textContent.includes('启用');
 $('chatgptConnect').disabled=true;$('chatgptState').textContent='正在打开 ChatGPT 授权页…';
 try{
  const response=await fetch('/api/chatgpt-plan/connect'+(reconsent?'?reconsent=1':''),{method:'POST'}),payload=await response.json();if(!response.ok)throw Error(payload.error||'无法开始 ChatGPT 登录');
  if(loginPoll)clearInterval(loginPoll);
  loginPoll=setInterval(async()=>{await refreshProviderConfig();const state=$('chatgptState').textContent;if(state.startsWith('已连接')||state.startsWith('账号已连接')||state.startsWith('无法读取')||state.startsWith('登录状态不可用')||state.startsWith('尚未登录')){clearInterval(loginPoll);loginPoll=null;$('chatgptConnect').disabled=false;}},2000);
  await refreshProviderConfig();
 }catch(error){$('chatgptState').textContent=error.message;$('chatgptConnect').disabled=false;}
};
$('chatgptDisconnect').onclick=async()=>{
 $('chatgptDisconnect').disabled=true;$('chatgptState').textContent='正在断开 ChatGPT 登录…';
 try{const response=await fetch('/api/chatgpt-plan/disconnect',{method:'POST'}),payload=await response.json();if(!response.ok)throw Error(payload.error||'断开失败');await refreshProviderConfig();}
 catch(error){$('chatgptState').textContent=error.message;}
 finally{$('chatgptDisconnect').disabled=false;}
};
$('dropZone').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('imageFiles').click();}};
$('dropZone').ondragover=e=>{e.preventDefault();$('dropZone').classList.add('drag-over');};
$('dropZone').ondragleave=()=>$('dropZone').classList.remove('drag-over');
$('dropZone').ondrop=e=>{e.preventDefault();$('dropZone').classList.remove('drag-over');addFiles(e.dataTransfer.files);};
window.addEventListener('paste',e=>{const files=[...e.clipboardData?.items||[]].filter(x=>x.kind==='file').map(x=>x.getAsFile()).filter(Boolean);if(files.length){e.preventDefault();selectInputMode('online');addFiles(files);}});
$('scorePreview').addEventListener('click',e=>{const group=e.target.closest('g[data-measure]');if(!group||!prepared)return;const number=Number(group.dataset.measure)+1;if(marked.has(number))marked.delete(number);else marked.set(number,'');renderMarked();highlightMarks();});
$('modelText').addEventListener('input',invalidate);
$('convert').onclick=()=>{if(busy){error('模型仍在返回内容，请等待结束或点击取消等待后生成草稿。');return;}clearError();try{history=[];showPrepared(prepareReceivedModelScore($('modelText').value||$('liveOutputText').textContent),{resetMarks:true});$('previewPanel').scrollIntoView({behavior:'smooth',block:'start'});}catch(e){invalidate();error(e.message);}};
$('clear').onclick=()=>{$('modelText').value='';invalidate();$('modelText').focus();};
$('recognize').onclick=async()=>{if(busy)return;clearError();activeRequest=new AbortController();setBusy(true,'正在准备图片…');try{const result=await request('initial',{},activeRequest.signal);const next=prepareModelScore(result.text);if(prepared)history.push(structuredClone(prepared.score));$('modelText').value=result.text;showPrepared(next,{resetMarks:true});status(`已收到 ${result.model} 的初稿；请点击有问题的小节，再提交局部复核。`);}catch(e){if(e.name==='AbortError'){status('已取消本次等待；现有谱面未修改。');}else{error(e.message);status('识别未完成；现有谱面未修改。');}}finally{setBusy(false,$('status').textContent);}};
$('review').onclick=async()=>{if(busy||!prepared||!marked.size)return;clearError();activeRequest=new AbortController();const selected=[...marked].map(([measure,note])=>({measure,note}));setBusy(true,`正在准备图片并复核 ${selected.length} 个小节…`);try{const result=await request('review',{score:prepared.score,selected},activeRequest.signal);const revision=applyMeasureReview(prepared.score,result.text,selected.map(x=>x.measure));const next=prepareModelScore(JSON.stringify(revision.score));history.push(structuredClone(prepared.score));$('modelText').value=JSON.stringify(next.score,null,2);for(const n of revision.updated)marked.delete(n);for(const invalid of next.invalid)if(!marked.has(invalid.measure))marked.set(invalid.measure,'拍数仍不符，请继续对照原图');for(const issue of revision.issues)if(Number.isInteger(issue.measure)&&!marked.has(issue.measure))marked.set(issue.measure,issue.description||'仍需复核');showPrepared(next);$('revisionInfo').textContent=`本轮更新第 ${revision.updated.join('、')} 小节。${revision.warnings.join('；')} 可继续标记复核，或返回上一版。`;status('局部复核已合并；请对照原图检查。');}catch(e){if(e.name==='AbortError'){status('已取消本次等待；原谱保持不变。');}else{error(e.message);status('复核未应用；原谱保持不变。');}}finally{setBusy(false,$('status').textContent);}};
$('unmark').onclick=()=>{marked.clear();renderMarked();highlightMarks();};
$('undo').onclick=()=>{if(!history.length)return;const previous=history.pop();const next=prepareModelScore(JSON.stringify(previous));$('modelText').value=JSON.stringify(next.score,null,2);showPrepared(next);$('revisionInfo').textContent='已返回上一版。';};
$('download').onclick=()=>{if(prepared)downloadFile(JSON.stringify(prepared.score,null,2),safeName(prepared.score.title),'application/json');};
$('import').onclick=()=>{if(!prepared||!project||importing)return;importing=true;$('import').disabled=true;$('import').textContent='正在导入…';parent.postMessage({type:'workspace:import-score',score:prepared.score},origin);};
window.addEventListener('message',event=>{if(event.origin!==origin||event.source!==parent)return;if(event.data?.type==='model-score:draft-saved')parent.postMessage({type:'model-score:compare-ready'},origin);if(event.data?.type==='project:restore'){project=event.data.project;$('projectName').textContent=project?`当前工程：${project.name}`:'工程未就绪';$('import').disabled=!prepared||!project||importing;}if(event.data?.type==='model-score:error'){importing=false;$('import').textContent='导入当前工程并编辑';$('import').disabled=!prepared||!project;error(event.data.message||'导入失败');}});
parent.postMessage({type:'workspace:ready'},origin);
selectInputMode('manual');
