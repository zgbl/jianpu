const $=id=>document.getElementById(id);
const PERSONAL_PREFERENCES=['separationModel','pitchAlgorithm','pyinFrameLength','meter','beatUnit','introSource','lyricMatchMode','pipelineIntro','pipelineAsr','pipelineAlign','pipelineChords','pipelineAutoGuitar','pipelineChordGranularity','pipelineChordColor','pipelineChordSeventh'];
const PREFERENCE_KEY='jianpu:transcribe-preferences:v1';
function savedPreferences(){try{return JSON.parse(localStorage.getItem(PREFERENCE_KEY)||'{}');}catch{return {};}}
function applyPreferences(values){for(const id of PERSONAL_PREFERENCES){const field=$(id),value=values[id];if(!field||value===undefined)continue;if(field.type==='checkbox')field.checked=!!value;else if(field.tagName!=='SELECT'||[...field.options].some(o=>o.value===String(value)))field.value=String(value);field.dispatchEvent(new Event('input'));}}
function rememberPreferences(){try{localStorage.setItem(PREFERENCE_KEY,JSON.stringify(Object.fromEntries(PERSONAL_PREFERENCES.map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value]))));}catch{}}

export function createTranscribePipeline({getScore,getResult,recognize,calibrateRhythm,recognizeLyrics,alignLyrics,fillIntro,configureChords,configureGuitar,showDo,publish}){
 const sidebar=document.querySelector('.controls');
 const host=document.createElement('div');host.className='production-pipeline';
 host.innerHTML=`<div class="pipeline-heading"><h2>一键生成可弹奏乐谱</h2><p>从原曲到可试听、可编辑的简谱。下方七步按顺序运行，每一步也能单独调整。</p><button id="runPipeline" class="primary" type="button">一键生成乐谱</button><p id="pipelineStatus" role="status">先选择音频；如有正确歌词，可先在第 5 步粘贴。</p></div>
 <section class="pipeline-step" data-pipeline-step="1"><h3>1 · 识别人声与旋律 <span>待运行</span></h3><p>原曲分离声部，提取人声并识别音高与节奏。</p><div class="pipeline-content"></div></section>
 <section class="pipeline-step" data-pipeline-step="2"><h3>2 · 确定 Do 与小节 <span>待运行</span></h3><p>自动建议 Do；可在此修正调号、速度、拍号和小节线。</p><button id="pipelineDo" type="button">展开 Do 校准</button><div class="pipeline-content"></div></section>
 <section class="pipeline-step" data-pipeline-step="3"><h3>3 · 补足前奏小节 <span>待运行</span></h3><p>从开头补齐到人声小节起点，默认每小节 0000。</p><label class="pipeline-choice"><input id="pipelineIntro" type="checkbox" checked>一键运行时自动补全全 0 前奏</label><div class="pipeline-content"></div></section>
 <section class="pipeline-step" data-pipeline-step="4"><h3>4 · 识别歌词锚点 <span>待运行</span></h3><p>听人声取得逐词时间；识别结果会先铺到当前谱。</p><label class="pipeline-choice"><input id="pipelineAsr" type="checkbox" checked>一键运行时识别歌词</label><div class="pipeline-content"></div></section>
 <section class="pipeline-step" data-pipeline-step="5"><h3>5 · 用正确歌词校准 <span>待运行</span></h3><p>可在运行前粘贴完整歌词；有文字时才自动对齐。</p><label class="pipeline-choice"><input id="pipelineAlign" type="checkbox" checked>有正确歌词时自动声学对齐</label><div class="pipeline-content"></div></section>
 <section class="pipeline-step" data-pipeline-step="6"><h3>6 · 配置和弦 <span>待运行</span></h3><p>按当前谱的旋律和小节生成可修改的和弦。</p><label class="pipeline-choice"><input id="pipelineChords" type="checkbox" checked>一键运行时按谱配和弦</label><label>粒度 <select id="pipelineChordGranularity"><option value="half">半小节</option><option value="measure">整小节</option></select></label><label>复杂和弦偏好 <input id="pipelineChordColor" type="range" min="0" max="60" step="5" value="30"><output id="pipelineChordColorValue">30%</output></label><label>七和弦上限 <input id="pipelineChordSeventh" type="range" min="0" max="60" step="5" value="30"><output id="pipelineChordSeventhValue">30%</output></label><button id="pipelineConfigureChords" type="button">按当前乐谱配和弦</button></section>
 <section class="pipeline-step" data-pipeline-step="7"><h3>7 · 选择吉他 C/G 指型 <span>待运行</span></h3><p>和弦生成后，自动选择 Capo 非负且最小的 C/G 指型，并更新和弦显示。</p><label class="pipeline-choice"><input id="pipelineAutoGuitar" type="checkbox" checked>一键运行时自动选择指型和 Capo</label></section>`;
 sidebar.prepend(host);
 const card=n=>host.querySelector(`[data-pipeline-step="${n}"] .pipeline-content`);
 const notation=sidebar.querySelector('.notation-controls');
 for(let node=host.nextSibling;node&&node!==notation;){const next=node.nextSibling;if(!node.classList?.contains('limits'))card(1).append(node);node=next;}
 card(2).append(notation);
 const pitch=document.querySelector('.pitch-refinement');if(pitch)card(2).append(pitch);
 const oldPanel=document.querySelector('.correct-lyrics-panel');
 const intro=oldPanel?.querySelector('details:not(#manualLyrics)');if(intro){intro.open=true;card(3).append(intro);}
 const asr=document.querySelector('.lyric-recognition');if(asr)card(4).append(asr);
 const lyrics=$('manualLyrics');if(lyrics){lyrics.open=true;card(5).append(lyrics);}
 $('lyricText').addEventListener('input',()=>{$('lyricText').dataset.correctLyrics='true';});
 if(oldPanel){oldPanel.hidden=true;oldPanel.closest('.score-lyric-workspace')?.classList.add('pipeline-score-layout');}
 $('pipelineDo').onclick=showDo;
 const updateSlider=(id,out)=>{$(id).addEventListener('input',()=>{$(out).value=$(id).value+'%';});};
 updateSlider('pipelineChordColor','pipelineChordColorValue');updateSlider('pipelineChordSeventh','pipelineChordSeventhValue');
 applyPreferences(savedPreferences());
 $('separationModel').dispatchEvent(new Event('change'));
 for(const id of PERSONAL_PREFERENCES)$(id).addEventListener('change',()=>{rememberPreferences();publish();});
 function applyChordSettings(){const toolbar=$('scoreEditToolbar');for(const [source,target] of [['pipelineChordGranularity','chordGranularity'],['pipelineChordColor','chordColor'],['pipelineChordSeventh','chordSeventhLimit']]){const input=toolbar.querySelector(`[data-${target.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())}]`);if(input){input.value=$(source).value;input.dispatchEvent(new Event(input.type==='range'?'input':'change',{bubbles:true}));}}}
 $('pipelineConfigureChords').onclick=async()=>{applyChordSettings();await configureChords();publish();};
 function mark(n,value){const step=host.querySelector(`[data-pipeline-step="${n}"]`);step.dataset.state=value;step.querySelector('h3 span').textContent=({pending:'待运行',running:'进行中',done:'完成',skipped:'跳过',error:'需处理'})[value]||value;}
 let running=false;
 $('runPipeline').onclick=async()=>{
  if(running)return;
  const button=$('runPipeline'),message=$('pipelineStatus'),errors=[],details=[],suppliedLyrics=$('lyricText').dataset.correctLyrics==='true'?$('lyricText').value.trim():'';running=true;button.disabled=true;button.textContent='正在生成…';
  for(let n=1;n<=7;n++)mark(n,'pending');
  async function step(n,label,action,{optional=false}={}){mark(n,'running');message.textContent=`第 ${n}/7 步：${label}`;try{const value=await action();if(value===false)throw Error(`${label}未完成`);mark(n,'done');if(typeof value==='string'&&value)details.push(value);return true;}catch(error){mark(n,'error');errors.push(`第 ${n} 步 ${error.message}`);if(!optional)throw error;return false;}}
  try{
   if(getScore()&&getResult())mark(1,'done');
   else await step(1,'识别人声与旋律',async()=>{await recognize();if(!getScore()||!getResult())throw Error('没有生成可用旋律，请查看识别状态');});
   await step(2,'确定 Do 与小节',async()=>{if(!getScore()?.key)throw Error('无法判断 Do');return calibrateRhythm?.();});
   if($('pipelineIntro').checked)await step(3,'补全前奏',async()=>fillIntro(),{optional:true});else mark(3,'skipped');
   if($('pipelineAsr').checked)await step(4,'识别歌词锚点',async()=>recognizeLyrics(),{optional:true});else mark(4,'skipped');
   if($('pipelineAlign').checked&&suppliedLyrics){$('lyricText').value=suppliedLyrics;await step(5,'按正确歌词校准',async()=>alignLyrics(),{optional:true});}else mark(5,'skipped');
   if($('pipelineChords').checked){const chordReady=await step(6,'配置和弦',async()=>{applyChordSettings();return configureChords();},{optional:true});if(chordReady&&$('pipelineAutoGuitar').checked&&getScore()?.chords?.length)await step(7,'选择吉他指型与 Capo',async()=>configureGuitar(),{optional:true});else mark(7,'skipped');}else{mark(6,'skipped');mark(7,'skipped');}
   publish();message.textContent=errors.length?`乐谱已生成，可试听和编辑；${errors.join('；')}。可在对应步骤重试。`:`可弹奏乐谱已生成；请试听核对 Do、小节、歌词与和弦。${details.length?` 吉他已自动选择 ${details.at(-1)}。`:''}`;
  }catch(error){message.textContent=`流程暂停：${error.message}。请在对应步骤修正后重试。`;}finally{running=false;button.disabled=false;button.textContent='一键生成 / 完成乐谱';}
 };
 return {mark,reset:hasPastedLyrics=>{for(let n=1;n<=7;n++)mark(n,'pending');$('lyricText').dataset.correctLyrics=hasPastedLyrics?'true':'false';$('pipelineStatus').textContent='音频已就绪；如有正确歌词，可先在第 5 步粘贴。';},snapshot:()=>({pipelineCorrectLyrics:$('lyricText').dataset.correctLyrics==='true',...Object.fromEntries(PERSONAL_PREFERENCES.filter(id=>id.startsWith('pipeline')).map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value]))}),restore:state=>{applyPreferences(savedPreferences());state={...state,pipelineChordGranularity:state.pipelineChordGranularity??state.chordPreferences?.granularity,pipelineChordColor:state.pipelineChordColor??state.chordPreferences?.color,pipelineChordSeventh:state.pipelineChordSeventh??state.chordPreferences?.seventhLimit};$('lyricText').dataset.correctLyrics=(state.pipelineCorrectLyrics??(state.lyricPlan?.type==='manual'&&!!state.lyricText))?'true':'false';applyPreferences(state);}};
}
