// Standard tuning, left to right: low E (6th string) to high E (1st).
const OPEN=[40,45,50,55,59,64],PC={C:0,D:2,E:4,F:5,G:7,A:9,B:11},cache=new Map();
const BASIC_TRIAD_ROOTS=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const BASIC_TRIADS=BASIC_TRIAD_ROOTS.flatMap(root=>[root,`${root}m`]);
export const GUITAR_LIBRARIES={C:[...BASIC_TRIADS,'Bdim','C7','D7','E7','G7','A7','B7','Cmaj7','Dm7','Em7','Fmaj7','Am7','Cadd9','Fadd9','Gadd9','Cmaj9','Dm9','Em9','Fmaj9','G9','Am9','Dm11','G13'],G:[...BASIC_TRIADS,'F#dim','G7','A7','B7','C7','D7','E7','Gmaj7','Am7','Bm7','Cmaj7','Dmaj7','Em7','Gadd9','Cadd9','Dadd9','Gmaj9','Am9','Bm9','Cmaj9','D9','Em9','Am11','D13','Gbm7']};
const libraryLabels=new Set(Object.values(GUITAR_LIBRARIES).flat());
const SHAPES={C:[-1,3,2,0,1,0],Cm:[-1,3,5,5,4,3],D:[-1,-1,0,2,3,2],Dm:[-1,-1,0,2,3,1],E:[0,2,2,1,0,0],Em:[0,2,2,0,0,0],F:[1,3,3,2,1,1],G:[3,2,0,0,0,3],A:[-1,0,2,2,2,0],Am:[-1,0,2,2,1,0],B7:[-1,2,1,2,0,2],C7:[-1,3,2,3,1,0],D7:[-1,-1,0,2,1,2],E7:[0,2,0,1,0,0],G7:[3,2,0,0,0,1],A7:[-1,0,2,0,2,0],Am7:[-1,0,2,0,1,0],Dm7:[-1,-1,0,2,1,1],Bm:[-1,2,4,4,3,2],Bdim:[-1,2,3,4,3,-1],'F#dim':[-1,-1,4,2,1,2],Gmaj7:[3,2,0,0,0,2],Bm7:[-1,2,4,2,3,2],Gbm:[2,4,4,2,2,2],Gbm7:[2,4,2,2,2,2],Dmaj7:[-1,-1,0,2,2,2],Cadd9:[-1,3,2,0,3,3],Fadd9:[-1,-1,3,2,1,3],Dadd9:[-1,5,4,2,5,-1],Cmaj9:[-1,3,2,4,3,-1],Dm9:[-1,5,3,5,5,-1],G13:[3,-1,3,4,5,-1],D13:[-1,5,-1,5,7,7],Am9:[-1,0,5,5,0,0],Cmaj7:[-1,3,2,0,0,0],Fmaj7:[-1,-1,3,2,1,0],Em7:[0,2,0,0,0,0]};
function pc(name){const m=/^([A-G])([#b]?)$/.exec(name);return m?(PC[m[1]]+(m[2]==='#'?1:m[2]==='b'?-1:0)+12)%12:null;}
export function guitarChord(label){
 const m=/^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(label);if(!m)return null;
 const root=pc(m[1]),suffix=m[2],minor=suffix.startsWith('m')&&!suffix.startsWith('maj');
 if(!/^(?:m|maj|dim|aug|sus2|sus4|sus|add9|madd9)?(?:7|9|11|13)?$/.test(suffix))return null;
 const intervals=[0,suffix.startsWith('sus2')?2:suffix.startsWith('sus')?5:suffix.startsWith('dim')?3:minor?3:4,suffix.startsWith('dim')?6:suffix.startsWith('aug')?8:7];
 if(/7|9|11|13/.test(suffix)&&!suffix.includes('add'))intervals.push(suffix.startsWith('maj')?11:suffix.startsWith('dim')?9:10);
 if(/9|11|13/.test(suffix))intervals.push(2);if(/11|13/.test(suffix))intervals.push(5);if(/13/.test(suffix))intervals.push(9);
 const pcs=[...new Set(intervals.map(i=>(root+i)%12))],extended=/9|11|13/.test(suffix);
 // Guitar extended voicings may omit fifth and intermediate extensions, but
 // retain the root, third/suspension, seventh and named top extension.
 const required=extended?[root,(root+intervals[1])%12,...(suffix.includes('add')?[]:[(root+intervals[3])%12]),(root+(/13/.test(suffix)?9:/11/.test(suffix)?5:2))%12]:/7/.test(suffix)?[root,(root+intervals[1])%12,(root+intervals[3])%12]:pcs;
 return {root,pcs,required:[...new Set(required)],bass:m[3]?pc(m[3]):null};
}
function fingers(frets){
 const pressed=frets.map((f,i)=>({f,i})).filter(p=>p.f>0);if(!pressed.length)return {fingers:frets.map(()=>0),barre:null};
 const min=Math.min(...pressed.map(p=>p.f)),same=pressed.filter(p=>p.f===min),first=same[0].i,last=same.at(-1).i;
 const barre=same.length>=2&&frets.slice(first,last+1).every(f=>f===-1||f>=min)?{fret:min,from:first,to:last}:null;
 const independent=pressed.filter(p=>!barre||p.f!==min),fingerCount=independent.length+(barre?1:0);if(fingerCount>4)return null;
 independent.sort((a,b)=>a.f-b.f||a.i-b.i);const numbered=frets.map(()=>0);if(barre)for(const p of same)numbered[p.i]=1;
 independent.forEach((p,i)=>numbered[p.i]=i+1+(barre?1:0));return {fingers:numbered,barre};
}
function assess(frets,chord){
 const played=frets.flatMap((f,i)=>f<0?[]:[OPEN[i]+f]);if(played.length<3)return null;
 const pcs=played.map(n=>n%12);if(chord.bass===null&&Math.min(...played)%12!==chord.root)return null;if(pcs.some(p=>!chord.pcs.includes(p))||chord.required.some(p=>!pcs.includes(p))||chord.bass!==null&&Math.min(...played)%12!==chord.bass)return null;
 const positive=frets.filter(f=>f>0),span=positive.length?Math.max(...positive)-Math.min(...positive):0;if(span>3)return null;
 const hand=fingers(frets);if(!hand)return null;
 const muted=frets.filter(f=>f<0).length,score=muted*.7+span*.5+Math.max(...frets)*.12+(hand.barre?.8:0)+(Math.min(...played)%12!==chord.root?.6:0);
 return {frets:[...frets],...hand,baseFret:positive.length&&Math.max(...positive)>4?Math.min(...positive):1,omitted:chord.pcs.filter(p=>!pcs.includes(p)),score};
}
export function guitarFingering(label){
 if(!libraryLabels.has(label))return null;
 if(cache.has(label))return cache.get(label);const chord=guitarChord(label);if(!chord){cache.set(label,null);return null;}
 let best=SHAPES[label]?assess(SHAPES[label],chord):null;const standard={C:[0,3,2,0,1,0],D:[0,0,0,1,3,2],Em:[0,2,3,0,0,0]};if(best&&standard[label]){best.fingers=standard[label];best.barre=null;}
 if(!best)for(let base=1;base<=9;base++){
  const choices=OPEN.map(open=>[-1,...(chord.pcs.includes(open%12)?[0]:[]),...[base,base+1,base+2,base+3].filter(f=>chord.pcs.includes((open+f)%12))]);
  const current=[];function search(i){if(i===6){const candidate=assess(current,chord);if(candidate&&(!best||candidate.score<best.score))best=candidate;return;}for(const fret of choices[i]){current.push(fret);search(i+1);current.pop();}}search(0);
 }
 cache.set(label,best);return best;
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function guitarDiagram(label,x,y,{capo=0}={}){
 const shape=guitarFingering(label),width=64,height=75;
 if(!shape)return `<g class="guitar-chord-diagram"><title>${esc(label)}：未找到已校验的参考指法</title><text x="${x}" y="${y+26}" font-size="9" fill="#9b641e">指法待补</text></g>`;
 const left=x+12,top=y+14,dx=8,dy=12,transposeLabel=capo<0?`；标准调弦降 ${Math.abs(capo)} 半音`:capo?`；品位相对Capo ${capo}`:'';let content=`<g class="guitar-chord-diagram" role="img" aria-label="${esc(label)} 吉他参考指法"><title>${esc(label)}：6弦→1弦 ${shape.frets.map(f=>f<0?'×':f).join(' ')}；手指1食指/2中指/3无名指/4小指${transposeLabel}${shape.omitted.length?'；扩展和弦省略部分内声部':''}。参考指法需试听。</title>`;
 for(let i=0;i<6;i++)content+=`<line x1="${left+i*dx}" x2="${left+i*dx}" y1="${top}" y2="${top+4*dy}" stroke="#416d63" stroke-width=".8"/>`;
 for(let f=0;f<=4;f++)content+=`<line x1="${left}" x2="${left+5*dx}" y1="${top+f*dy}" y2="${top+f*dy}" stroke="#416d63" stroke-width="${f===0&&shape.baseFret===1?2: .8}"/>`;
 if(shape.baseFret>1)content+=`<text x="${x}" y="${top+9}" font-size="8">${shape.baseFret}</text>`;
 if(shape.barre){const py=top+(shape.barre.fret-shape.baseFret+.5)*dy;content+=`<line x1="${left+shape.barre.from*dx}" x2="${left+shape.barre.to*dx}" y1="${py}" y2="${py}" stroke="#416d63" stroke-width="7" stroke-linecap="round"/>`;}
 shape.frets.forEach((f,i)=>{const px=left+i*dx;if(f<=0)content+=`<text x="${px}" y="${top-4}" font-size="10" text-anchor="middle">${f<0?'×':'○'}</text>`;else{const py=top+(f-shape.baseFret+.5)*dy;content+=`<circle cx="${px}" cy="${py}" r="4.4" fill="#416d63"/><text x="${px}" y="${py+2.7}" font-size="7" fill="#fff" text-anchor="middle">${shape.fingers[i]}</text>`;}});
 content+=`<text x="${left}" y="${top+4*dy+10}" font-size="7">6弦 → 1弦${capo<0?` · 降${Math.abs(capo)}半音`:capo?' · 相对Capo':''}</text></g>`;return content;
}

export function guitarLibrarySvg(key='C'){
 const labels=GUITAR_LIBRARIES[key]||[],columns=6,rowHeight=110,width=columns*100,height=Math.ceil(labels.length/columns)*rowHeight+10;
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${key}调吉他和弦图库">${labels.map((label,i)=>{const x=10+i%columns*100,y=20+Math.floor(i/columns)*rowHeight;return `<text x="${x+12}" y="${y}" font-size="13" font-weight="600" fill="#416d63">${esc(label)}</text>`+guitarDiagram(label,x,y+5);}).join('')}</svg>`;
}
