// Beat detections are observations, not a complete sequence: a missed attack
// must not turn two physical beats into one coordinate interval. Fill beat
// positions from the selected BPM before interpolating local timing.
export function beatGrid({beatTimes=[],beatPositions=null,bpm=120,anchor=0,tracked=true}={}){
 const period=60/+bpm;
 if(!Number.isFinite(period)||period<=0||!Number.isFinite(+anchor))throw Error('节拍速度或小节起点不合法');
 const observed=tracked?beatTimes.filter(Number.isFinite):[];
 if(observed.some((t,i)=>i&&t<=observed[i-1]))throw Error('拍点时间必须递增');
 const beats=[];
 if(observed.length>=2){
  const positions=beatPositions?.length===observed.length?beatPositions.map(Number):[0];
  if(!beatPositions||beatPositions.length!==observed.length){for(let i=1;i<observed.length;i++)positions.push(positions[i-1]+Math.max(1,Math.round((observed[i]-observed[i-1])/period)));}
  if(positions.some((p,i)=>!Number.isInteger(p)||i&&p<=positions[i-1]))throw Error('拍点序号必须严格递增');
  observed.forEach((time,i)=>beats.push({time,position:positions[i]}));
 }
 function coordinate(time){
  if(beats.length<2)return time/period;
  let low=0,high=beats.length-1;
  while(high-low>1){const mid=(low+high)>>1;if(beats[mid].time<=time)low=mid;else high=mid;}
  const index=time<beats[0].time?0:time>=beats.at(-1).time?beats.length-2:low;
  const a=beats[index],b=beats[index+1];
  return a.position+(time-a.time)/(b.time-a.time)*(b.position-a.position);
 }
 function timeAt(coordinate){
  if(beats.length<2)return coordinate*period;
  let low=0,high=beats.length-1;
  while(high-low>1){const mid=(low+high)>>1;if(beats[mid].position<=coordinate)low=mid;else high=mid;}
  const index=Math.max(0,Math.min(beats.length-2,low)),a=beats[index],b=beats[index+1];
  return a.time+(coordinate-a.position)/(b.position-a.position)*(b.time-a.time);
 }
 const origin=coordinate(+anchor);
 return {toBeat:time=>coordinate(time)-origin,toTime:beat=>timeAt(beat+origin)};
}
