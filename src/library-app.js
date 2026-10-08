import {validate} from './model.js';
import {render} from './render.js';
import {ScorePlayer,scoreTimeline,playbackBpm} from './playback.js';
import {audioScoreTimeline,createAudioScoreCursor} from './audio-score-cursor.js';

const $=id=>document.getElementById(id);
let songs=[],current=null,selectedMeasure=0,midiTimeline=null;
const cursor=createAudioScoreCursor($('paper'),()=>current?.score);
cursor.bind($('original'),()=>current?.audioOffset||0);
const cursorPreference='jianpu-library-original-cursor';
try{$('showOriginalCursor').checked=localStorage.getItem(cursorPreference)!=='false';}catch{}
cursor.setEnabled(false);
const player=new ScorePlayer((state,position,mark)=>{
 $('play').textContent=state==='playing'?'Ⅱ 暂停':state==='paused'?'▶ 继续':'▶ 播放简谱';
 $('playStatus').textContent=state==='playing'?`${Math.floor(position/60)}:${String(Math.floor(position%60)).padStart(2,'0')} · 第 ${(mark?.measure??selectedMeasure)+1} 小节`:'';
 if(state==='stopped')cursor.clearMidi();
 else if(midiTimeline)cursor.showMidi(midiTimeline,position,state);
});
async function request(path){const response=await fetch('/api/library'+path,{cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error||'读取失败');return data;}
function drawCatalog(){const target=$('songs');target.replaceChildren();for(const song of songs){const button=document.createElement('button');button.className='song'+(current?.id===song.id?' selected':'');const title=document.createElement('strong'),details=document.createElement('small'),date=document.createElement('small');title.textContent=song.title;details.textContent=`1 = ${song.key} · ${song.meter.join('/')} · ${song.measureCount} 小节`;date.textContent=new Date(song.publishedAt).toLocaleDateString('zh-CN');button.append(title,details,date);button.onclick=()=>openSong(song.id);target.append(button);}}
async function refresh(){try{songs=await request('');$('catalogStatus').textContent=songs.length?`${songs.length} 首乐谱`:'暂无已发布乐谱';drawCatalog();}catch(e){$('catalogStatus').textContent=e.message;}}
async function openSong(id){try{
  player.stop();midiTimeline=null;$('original').pause();cursor.clear();const item=await request('/'+id);item.score=validate(item.score);current=item;selectedMeasure=0;
  $('empty').hidden=true;$('scorePanel').hidden=false;$('title').textContent=item.title;$('details').textContent=`1 = ${item.score.key} · ${item.score.meter.join('/')} · ${item.score.measures.length} 小节`;
  $('bpm').value=String(Math.round(playbackBpm(item.score)));$('audioPanel').hidden=!item.audioUrl;$('original').removeAttribute('src');if(item.audioUrl)$('original').src=item.audioUrl;
  const timed=!!item.audioUrl&&audioScoreTimeline(item.score).length>0;
  $('showOriginalCursor').disabled=!timed;$('showOriginalCursor').title=timed?'':'这份乐谱没有与原曲对应的时间信息';
  showScore();cursor.setEnabled(timed&&$('showOriginalCursor').checked);drawCatalog();history.replaceState(null,'','?score='+encodeURIComponent(id));
 }catch(e){$('catalogStatus').textContent=e.message;}}
function showScore(){if(!current)return;$('paper').innerHTML=render(current.score,null,selectedMeasure);cursor.refresh();$('paper').onclick=event=>{const note=event.target.closest('[data-note]');if(note&&current.audioUrl&&$('showOriginalCursor').checked){const time=cursor.noteTime(note.dataset.note);if(Number.isFinite(time))$('original').currentTime=Math.max(0,(current.audioOffset||0)+time);}
 const node=event.target.closest('[data-measure]');if(!node)return;const index=Number(node.dataset.measure);if(!Number.isInteger(index)||index<0||index>=current.score.measures.length)return;selectedMeasure=index;player.stop();showScore();};}
$('play').onclick=async()=>{if(!current)return;try{if(player.state==='playing'){player.pause();return;}if(player.state==='paused'){await player.resume();return;}
 const bpm=Number($('bpm').value),timeline=scoreTimeline(current.score,{bpm,startMeasure:selectedMeasure});$('original').pause();midiTimeline=timeline;await player.play(timeline);
 }catch(e){$('playStatus').textContent=e.message;}};
$('stop').onclick=()=>player.stop();$('refresh').onclick=refresh;
$('showOriginalCursor').onchange=()=>{cursor.setEnabled($('showOriginalCursor').checked);try{localStorage.setItem(cursorPreference,String($('showOriginalCursor').checked));}catch{}};
$('original').addEventListener('play',()=>{player.stop();if($('showOriginalCursor').checked)cursor.follow($('original'),()=>current?.audioOffset||0);});
window.addEventListener('pagehide',()=>{player.stop();$('original').pause();cursor.clear();});
await refresh();const requested=new URLSearchParams(location.search).get('score');if(requested&&songs.some(s=>s.id===requested))await openSong(requested);
