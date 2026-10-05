import {beatGrid} from './beat-grid.js';
// Schedule clicks on the audio clock, independent of animation/scrolling.
export class Metronome {
 constructor({settings,media=()=>null,onState=()=>{},onBeat=()=>{},contextFactory=()=>new AudioContext()}={}){Object.assign(this,{settings,media,onState,onBeat,contextFactory});this.state='stopped';this.nodes=new Set();this.generation=0;}
 async start(){this.stop();const generation=this.generation;this.context??=this.contextFactory();await this.context.resume();if(generation!==this.generation)return;this.state='playing';this.origin=this.context.currentTime;this.lastBeat=null;this.lastPosition=null;this.attached=null;this.onState(this.state);this.tick();this.timer=setInterval(()=>this.tick(),25);}
 tick(){
  if(this.state!=='playing')return;
  const {bpm,meter,denominator=4,anchor=0,volume=.4,beatTimes=[],tracked=false}=this.settings();if(!Number.isFinite(bpm)||bpm<40||bpm>240||![2,3,4,6].includes(meter))return;
  const player=this.media();if(player&&!player.paused&&!player.ended)this.attached=player;
  if(this.attached&&(this.attached.paused||this.attached.ended)){this.clearNodes();this.lastBeat=null;this.lastPosition=null;return;}
  const position=this.attached?this.attached.currentTime-(this.attached.dataset.clipOffset?+this.attached.dataset.clipOffset:0):this.context.currentTime-this.origin;
  const signature=[bpm,meter,denominator,anchor,volume,tracked,beatTimes.length,beatTimes[0],beatTimes.at(-1)].join('/');
  if(signature!==this.signature||this.lastPosition!==null&&(position<this.lastPosition-.04||position-this.lastPosition>.25)){this.clearNodes();this.lastBeat=null;}
  this.signature=signature;this.lastPosition=position;
  const period=60/bpm*4/denominator,grid=this.attached&&tracked?beatGrid({beatTimes,bpm,anchor,tracked:true}):null,beat=grid?Math.ceil(grid.toBeat(position)*denominator/4-.005):Math.ceil((position-anchor-.005)/period),time=grid?grid.toTime(beat*4/denominator):anchor+beat*period;
  if(time-position>.10||beat===this.lastBeat)return;
  this.lastBeat=beat;const strong=((beat%meter)+meter)%meter===0,at=this.context.currentTime+Math.max(0,time-position);
  const oscillator=this.context.createOscillator(),gain=this.context.createGain();oscillator.frequency.value=strong?1500:meter===6&&beat%6===3?1200:950;oscillator.type='sine';gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(volume*(strong?.65:.4),at+.002);gain.gain.exponentialRampToValueAtTime(.0001,at+.055);oscillator.connect(gain);gain.connect(this.context.destination);oscillator.start(at);oscillator.stop(at+.06);this.nodes.add(oscillator);oscillator.onended=()=>{this.nodes.delete(oscillator);oscillator.disconnect();gain.disconnect();};
  clearTimeout(this.flash);this.flash=setTimeout(()=>this.onBeat(((beat%meter)+meter)%meter+1,meter),Math.max(0,(at-this.context.currentTime)*1000));
 }
 clearNodes(){clearTimeout(this.flash);for(const node of this.nodes){try{node.stop();node.disconnect();}catch{}}this.nodes.clear();}
 pause(){if(this.state!=='playing')return;this.clearNodes();clearInterval(this.timer);this.state='paused';this.onState(this.state);}
 async resume(){if(this.state!=='paused')return;await this.start();}
 stop(){this.generation++;this.clearNodes();clearInterval(this.timer);this.state='stopped';this.onState(this.state);}
}
