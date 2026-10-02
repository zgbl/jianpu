const labels={drums:'鼓',bass:'贝斯',guitar:'吉他 · 实验',piano:'钢琴 · 实验',other:'其他伴奏'};
export function createStemPlayers(container,{onPlay=()=>{},onSeek=()=>{}}={}){
 let players=[];
 function pause(){for(const player of players)player.pause();}
 function reset(){pause();for(const player of players){player.removeAttribute('src');player.load();}players=[];container.replaceChildren();container.hidden=true;}
 function restore(sources,url,times={}){
  reset();
  for(const name of Object.keys(labels)){
   if(!sources.includes(name))continue;
   const card=document.createElement('div');card.className='stem-player';card.dataset.stem=name;
   const header=document.createElement('div');header.className='stem-player-heading';
   const label=document.createElement('label'),player=document.createElement('audio');player.id=container.id+'-'+name;label.htmlFor=player.id;label.textContent=labels[name];
   const download=document.createElement('a');download.href=url(name);download.download=name+'.wav';download.textContent='下载 WAV';header.append(label,download);
   player.controls=true;player.preload='metadata';player.src=url(name);player.addEventListener('loadedmetadata',()=>{player.currentTime=Math.min(Number(times[name])||0,player.duration||0);});
   player.addEventListener('play',()=>{for(const other of players)if(other!==player)other.pause();onPlay(player,name);});player.addEventListener('seeked',onSeek);
   card.append(header,player);container.append(card);players.push(player);
  }
  container.hidden=players.length===0;
 }
 return {pause,reset,restore,times:()=>Object.fromEntries(players.map(player=>[player.parentElement.dataset.stem,player.currentTime||0]))};
}
