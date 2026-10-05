import {measureCapacity as barCapacity,parseMeter} from './model.js';
import {ticks,validate} from './model.js';
import {beatGrid} from './beat-grid.js';
import {noteMidi} from './pitch.js';
export const playbackBpm=score=>score.tempo??score.transcription?.bpm??120;
export function scoreTimeline(score,{bpm=playbackBpm(score),startMeasure=0}={}){
 validate(score);if(!Number.isFinite(bpm)||bpm<40||bpm>240)throw Error('播放速度应为 40–240 BPM');
 if(!Number.isInteger(startMeasure)||startMeasure<0||startMeasure>=score.measures.length)throw Error('播放起点不合法');
 const events=[],marks=[],unit=60/bpm/16,capacity=barCapacity(score),tracked=score.transcription?.rhythmMode==='tracked'&&score.transcription.beatTimes?.length>1;
 let sourceOrigin=0;
 if(tracked){
  let leading=0,firstGrid=null;
  for(const m of score.measures.slice(startMeasure)){let used=0;for(const n of m.notes){if(Number.isFinite(n.gridTimeStart)){firstGrid=n.gridTimeStart;break;}used+=ticks(n);}if(firstGrid!==null){leading+=used;break;}leading+=m.manualDurationTicks??capacity;}
  // MIDI plays inserted prefix bars before the anchored score. Its zero is
  // separate from the unchanged recording timestamps used by audio cursors.
  if(firstGrid!==null)sourceOrigin=(startMeasure?firstGrid:score.transcription.barStartTime??firstGrid)-leading*unit;
 }
 const grid=tracked?beatGrid({beatTimes:score.transcription.beatTimes,bpm,anchor:score.transcription.barAnchor,tracked:true}):null;
 const ties=new Map(score.spans.filter(s=>s.type==='tie').map(s=>[s.to,s.from])),ending=new Map();let position=0;
 const pitch=n=>noteMidi(n,score);
 for(let mi=startMeasure;mi<score.measures.length;mi++){
  let used=0;
  for(const n of score.measures[mi].notes){
   const start=tracked&&Number.isFinite(n.gridTimeStart)?n.gridTimeStart-sourceOrigin:position+used*unit,duration=tracked&&Number.isFinite(n.gridTimeEnd)?n.gridTimeEnd-n.gridTimeStart:ticks(n)*unit;marks.push({id:n.id,measure:mi,start,end:start+duration});
   if(n.degree){
    const previous=ending.get(ties.get(n.id));
    if(previous&&Math.abs(previous.end-start)<1e-6&&!n.grace){previous.end=start+duration;previous.ids.push(n.id);ending.set(n.id,previous);}
    else{
     let onset=start;
     if(n.grace){const graceDuration=Math.min(duration/4,60/bpm/4);events.push({midi:pitch(n.grace),start,end:start+graceDuration,ids:[n.id],grace:true});onset+=graceDuration;}
     const event={midi:pitch(n),start:onset,end:start+duration,ids:[n.id]};events.push(event);ending.set(n.id,event);
    }
   }
   used+=ticks(n);
  }
  // Incomplete/empty bars retain their remaining silent beats.
  if(tracked){const end=score.measures[mi].notes.reduce((max,n)=>Number.isFinite(n.gridTimeEnd)?Math.max(max,n.gridTimeEnd-sourceOrigin):max,position);position=end>position?end:position+capacity*unit;}
  else position+=(Number.isFinite(score.measures[mi].manualDurationTicks)?score.measures[mi].manualDurationTicks:capacity)*unit;
 }
 const tempoChanges=[];if(tracked&&grid){const first=grid.toBeat(sourceOrigin),last=grid.toBeat(sourceOrigin+position);for(let beat=Math.floor(first);beat<Math.ceil(last);beat++){const a=grid.toTime(beat),b=grid.toTime(beat+1);if(b<=a)continue;const time=Math.max(0,a-sourceOrigin);if(a<=sourceOrigin&&b>sourceOrigin)tempoChanges.push({time:0,bpm:60/(b-a)});else if(time<position)tempoChanges.push({time,bpm:60/(b-a)});}}
 return {bpm,events,marks,duration:position,startMeasure,tempoChanges};
}
const vlq=value=>{const bytes=[value&127];while(value>>=7)bytes.unshift((value&127)|128);return bytes;};
const uint32=n=>[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];
export function scoreMidi(score,options={}){
 const timeline=scoreTimeline(score,options),ppq=480;let tickCursor=0,timeCursor=0,activeBpm=timeline.bpm;const toTick=seconds=>{let ticks=tickCursor,time=timeCursor,bpm=activeBpm;for(const change of timeline.tempoChanges){if(change.time>seconds)break;if(change.time>=time){ticks+=(change.time-time)*bpm/60*ppq;time=change.time;bpm=change.bpm;}}return Math.round(ticks+(seconds-time)*bpm/60*ppq);};
 const tempoMessage=bpm=>{const tempo=Math.round(60000000/bpm);return [255,81,3,(tempo>>>16)&255,(tempo>>>8)&255,tempo&255];};
 const messages=[{at:0,order:0,data:tempoMessage(timeline.tempoChanges[0]?.time===0?timeline.tempoChanges[0].bpm:timeline.bpm)},
  {at:0,order:0,data:[255,88,4,score.meter[0],Math.log2(score.meter[1]),score.meter[1]===8?36:24,8]},{at:0,order:0,data:[192,0]}];
 for(const change of timeline.tempoChanges)if(change.time>0)messages.push({at:toTick(change.time),order:0,data:tempoMessage(change.bpm)});
 for(const e of timeline.events){messages.push({at:toTick(e.start),order:2,data:[144,e.midi,88]},{at:toTick(e.end),order:1,data:[128,e.midi,0]});}
 messages.push({at:toTick(timeline.duration),order:3,data:[255,47,0]});messages.sort((a,b)=>a.at-b.at||a.order-b.order);
 const track=[];let last=0;for(const event of messages){track.push(...vlq(event.at-last),...event.data);last=event.at;}
 return new Uint8Array([77,84,104,100,0,0,0,6,0,0,0,1,ppq>>>8,ppq&255,77,84,114,107,...uint32(track.length),...track]);
}
export class ScorePlayer{
 constructor(onUpdate=()=>{}){this.onUpdate=onUpdate;this.context=null;this.nodes=[];this.state='stopped';this.position=0;this.generation=0;}
 async play(timeline){this.stop();const generation=this.generation;this.context??=new AudioContext();await this.context.resume();if(generation!==this.generation)return;this.timeline=timeline;this.position=0;this.schedule();}
 schedule(){
  const context=this.context;this.epoch=context.currentTime+.04-this.position;this.state='playing';
  for(const event of this.timeline.events){if(event.end<=this.position)continue;const start=this.epoch+Math.max(event.start,this.position),end=this.epoch+event.end;
   const oscillator=context.createOscillator(),gain=context.createGain();oscillator.type='triangle';oscillator.frequency.value=440*2**((event.midi-69)/12);
   const attack=Math.min(.012,(end-start)/4),release=Math.min(.025,(end-start)/4);gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.12,start+attack);gain.gain.setValueAtTime(.12,end-release);gain.gain.linearRampToValueAtTime(0,end);
   oscillator.connect(gain);gain.connect(context.destination);oscillator.start(start);oscillator.stop(end+.005);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};this.nodes.push(oscillator);
  }
  const update=()=>{if(this.state!=='playing')return;this.position=Math.max(0,context.currentTime-this.epoch);if(this.position>=this.timeline.duration){this.stop();return;}this.onUpdate(this.state,this.position,this.timeline.marks.find(m=>m.start<=this.position&&m.end>this.position));};
  update();this.timer=setInterval(update,40);
 }
 clear(){clearInterval(this.timer);for(const node of this.nodes){try{node.stop();node.disconnect();}catch{}}this.nodes=[];}
 pause(){if(this.state!=='playing')return;this.position=Math.max(0,this.context.currentTime-this.epoch);this.clear();this.state='paused';this.onUpdate(this.state,this.position);}
 async resume(){if(this.state!=='paused')return;const generation=this.generation;await this.context.resume();if(generation===this.generation&&this.state==='paused')this.schedule();}
 stop(){this.generation++;this.clear();this.state='stopped';this.position=0;this.onUpdate(this.state,0);}
}
