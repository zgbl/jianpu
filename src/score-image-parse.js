// Geometry-based Jianpu parsing. OCR supplies characters; pixels supply the
// staff exclusion, printed barlines, underlines, octave and augmentation dots.
const chinese=/[\u3400-\u9fff]/;
const number=/[0-7]/;
const scoreDigit=ch=>ch==='%'?6:ch==='z'?7:/^[iIlL]$/.test(ch)?1:number.test(ch)?Number(ch):null;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const median=values=>{const a=[...values].sort((x,y)=>x-y);return a.length?a[Math.floor(a.length/2)]:0;};

export function observationGlyphs(observations){
 const out=[];
 for(const o of observations||[]){
  const parent=o.box||[];
  if(!Number.isFinite(parent[0]))continue;
  const raw=Array.from(String(o.text||''));
  const repeated=o.glyphs?.some((entry,i)=>o.glyphs.slice(i+1).some(other=>entry.box?.[2]>0&&Math.abs(entry.box[0]-other.box?.[0])<1e-6&&Math.abs(entry.box[2]-other.box?.[2])<1e-6));
  // Vision sometimes reports the entire recognized word for every character
  // in a cropped strip. In that case only, distribute positions within the
  // actual word rectangle; otherwise preserve its precise character boxes.
  const chars=o.glyphs?.length&&!repeated?o.glyphs:raw.map((text,i)=>({text,box:[parent[0]+parent[2]*i/raw.length,parent[1],parent[2]/raw.length,parent[3]]}));
  for(const entry of chars){const [x,y,w,h]=entry.box||[];if(!Number.isFinite(x)||!Number.isFinite(y)||!w||!h)continue;const ch=String(entry.text||'');if(!ch.trim())continue;out.push({ch,x:x+w/2,y:1-y-h/2,top:1-y-h,bottom:1-y,left:x,right:x+w,confidence:o.confidence??0});}
 }
 return out;
}
function linesFromObservations(observations){
 // Vision sometimes returns a whole line and sometimes one observation per
 // note. Merge observations on the same printed baseline without inventing x.
 const rows=[];
 for(const o of observations||[]){const glyphs=observationGlyphs([o]);if(!glyphs.length)continue;
  const y=median(glyphs.map(g=>g.y)),height=median(glyphs.map(g=>g.bottom-g.top));
  const hasChinese=glyphs.some(g=>chinese.test(g.ch));
  const musicLike=glyphs.filter(g=>/[0-7iIjJlL•.\-—|:：]/.test(g.ch)).length/glyphs.length>.55;
  const row=rows.find(r=>(r.hasChinese===hasChinese||(r.musicLike&&musicLike))&&Math.abs(r.y-y)<Math.max(.018,Math.min(r.height,height)*.55));
  if(row){row.glyphs.push(...glyphs);row.y=median(row.glyphs.map(g=>g.y));row.height=median(row.glyphs.map(g=>g.bottom-g.top));}
  else rows.push({glyphs,y,height,hasChinese,musicLike});
 }
 return rows.map(r=>({...r,glyphs:r.glyphs.sort((a,b)=>a.x-b.x),text:r.glyphs.map(g=>g.ch).join('')})).sort((a,b)=>a.y-b.y);
}
function pixels(image){if(typeof image?.dark==='function')return image;const {width,height,data}=image;if(!width||!height||!data)throw Error('无法读取图片像素');return {width,height,dark(x,y){x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=width||y>=height)return false;const p=(y*width+x)*4;return data[p]<185&&data[p+1]<185&&data[p+2]<185;}};}
function isTabStaff(row,img){
 const cy=Math.round(row.y*img.height),rh=Math.max(10,Math.round(row.height*img.height));
 const radius=Math.min(Math.max(rh*2,30),Math.round(img.height*.11));
 const scan=[];
 // TAB rules are long and nearly equidistant. This also works when a picture
 // contains only part of a staff; a global 45%-of-image cutoff did not.
 for(let y=Math.max(0,cy-radius);y<Math.min(img.height,cy+radius);y++){
  let run=0,best=0;for(let x=0;x<img.width;x++){if(img.dark(x,y))run++;else{best=Math.max(best,run);run=0;}}best=Math.max(best,run);
  if(best>=Math.max(32,img.width*.11))scan.push(y);
 }
 const rules=[];for(const y of scan)if(!rules.length||y-rules.at(-1)>3)rules.push(y);
 for(let i=0;i+3<rules.length;i++){
  const group=rules.slice(i,i+5),gaps=group.slice(1).map((y,j)=>y-group[j]);
  if(gaps.length<3)continue;
  const typical=median(gaps);
  if(typical>=5&&typical<=Math.max(42,rh*1.5)&&gaps.filter(v=>Math.abs(v-typical)<=Math.max(3,typical*.3)).length>=3&&cy>=group[0]-typical*1.2&&cy<=group.at(-1)+typical*1.2)return true;
 }
 return false;
}
function melodyRows(lines,img){
 const candidates=lines.filter(r=>r.glyphs.filter(g=>number.test(g.ch)).length>=2&&!/1\s*[=＝]\s*[A-G]/i.test(r.text)&&!isTabStaff(r,img));
 return candidates.filter(r=>{const digits=r.glyphs.filter(g=>number.test(g.ch)).length,bars=detectPrintedBars(r,img).length;return (digits>=3||bars>=2)&&(bars>0||digits<=8);});
}
function verticalRun(img,x,top,bottom){let run=0,best=0,total=0;for(let y=top;y<=bottom;y++){if(img.dark(x,y)){run++;total++;best=Math.max(best,run);}else run=0;}return {best,total};}
export function detectPrintedBars(row,image){
 const img=pixels(image),glyphs=row.glyphs.filter(g=>number.test(g.ch)||g.ch==='-'||g.ch==='—');if(!glyphs.length)return [];
 // OCR boxes can absorb octave dots and underlines. Their extrema make the
 // scan too tall and lose even obvious printed bars. Use the median digit
 // height/baseline and test for a near full-height straight vertical stroke.
 const mid=median(glyphs.map(g=>g.y))*img.height;
 const height=median(glyphs.map(g=>(g.bottom-g.top)*img.height));
 const radius=Math.max(18,Math.round(height*.75));
 const top=clamp(Math.round(mid-radius),0,img.height-1);
 const bottom=clamp(Math.round(mid+radius),0,img.height-1);
 // Vision's character rectangles often include the octave dot and the
 // underline, so they can be taller than a printed barline. A full-height
 // requirement missed every separator in real guitar/Jianpu scans.
 const minRun=Math.max(24,Math.min(34,Math.round(height*.75)));
 // A boundary closes notes to its left. Ink before the first recognized note
 // is commonly the stem of a high-octave dot or a left page rule.
 const first=glyphs.reduce((a,b)=>a.x<b.x?a:b);
 const start=clamp(Math.ceil(first.right*img.width+3),0,img.width-1);
 const end=img.width-1;
 const candidates=[];
 for(let x=start;x<=end;x++){
  const {best}=verticalRun(img,x,top,bottom);
  if(best<minRun)continue;
  candidates.push({x,run:best});
 }
 const groups=[];for(const c of candidates){const last=groups.at(-1);if(last&&c.x-last.at(-1).x<=2)last.push(c);else groups.push([c]);}
 const bars=groups.filter(g=>g.at(-1).x-g[0].x<=Math.max(5,Math.round(img.width*.006))).map(g=>g.reduce((a,b)=>b.run>a.run?b:a).x).sort((a,b)=>a-b);
 const unique=[];for(const x of bars){if(unique.length&&x-unique.at(-1)<=Math.max(12,Math.round(img.width*.01)))unique[unique.length-1]=x;else unique.push(x);}
 return unique.map(x=>x/img.width);
}
function repeatAtBar(img,row,bar,side){
 // A repeat sign has two small vertically separated dots beside the double
 // bar. The bar detector deliberately merges its two strokes into one x.
 const x=Math.round(bar*img.width),cy=Math.round(row.y*img.height);
 const from=side==='right'?x+5:x-21,to=side==='right'?x+22:x-5;
 const rows=[];
 for(let y=Math.max(0,cy-19);y<=Math.min(img.height-1,cy+19);y++){
  let count=0;for(let px=from;px<=to;px++)if(img.dark(px,y))count++;
  if(count>=3&&count<=11)rows.push(y);
 }
 const bands=[];for(const y of rows){if(!bands.length||y-bands.at(-1).at(-1)>1)bands.push([y]);else bands.at(-1).push(y);}
 return bands.some((a,i)=>bands.slice(i+1).some(b=>b[0]-a.at(-1)>=5&&b[0]-a.at(-1)<=20&&a.length<=8&&b.length<=8));
}
function horizontalStrokeCount(img,g,row,bodyBottom,lyric){
 const cx=g.x*img.width,size=Math.max(6,median(row.glyphs.filter(v=>number.test(v.ch)).map(v=>(v.right-v.left)*img.width)));
 const left=clamp(Math.floor(cx-size*1.5),0,img.width-1),right=clamp(Math.ceil(cx+size*1.5),0,img.width-1);
 const base=Number.isFinite(bodyBottom)?bodyBottom+2:Math.round(row.y*img.height+20);
 const lyricTop=lyric?Math.min(...lyric.glyphs.filter(v=>chinese.test(v.ch)).map(v=>v.top*img.height)):Infinity;
 const limit=Math.min(img.height-1,Math.round(base+25),Math.round(lyricTop-5));
 const hits=[];
 for(let y=base+2;y<=limit;y++){
  let run=0,best=0,touchesCenter=false;for(let x=left;x<=right;x++){if(img.dark(x,y)){run++;if(run>best){best=run;touchesCenter=x-run+1<=cx+12&&x>=cx-12;}}else run=0;}
  if(best>=14){let whole=0,longest=0;for(let x=0;x<img.width;x++){if(img.dark(x,y)){whole++;longest=Math.max(longest,whole);}else whole=0;}if(longest>img.width*.2)continue;}
  // Vision's box may be 40px wide around a 16px digit. A short beam under
  // ONE note is still a valid eighth-note beam; do not size the threshold
  // from that inflated OCR rectangle.
  if(touchesCenter&&best>=14)hits.push(y);
 }
 // One printed beam is commonly 3–4 pixels thick. Count ink bands, not
 // individual dark rows; otherwise a single eighth-note beam becomes a pair
 // of sixteenth-note beams.
 let stripes=0,previous=-10;for(const y of hits){if(y-previous>1)stripes++;previous=y;}
 return Math.min(2,stripes);
}
function dotInfo(img,g,row,lyric){
 // Vision often puts the digit, upper octave dot and beam in ONE 60px-high
 // character box. Its top/bottom therefore cannot locate either dot. Find
 // isolated ink components relative to the shared note baseline instead.
 const cx=Math.round(g.x*img.width),cy=Math.round(row.y*img.height);
 const x1=clamp(cx-43,0,img.width-1),x2=clamp(cx+35,0,img.width-1);
 const y1=clamp(cy-31,0,img.height-1),y2=clamp(cy+62,0,img.height-1);
 const lyricTop=lyric?Math.min(...lyric.glyphs.filter(v=>chinese.test(v.ch)).map(v=>v.top*img.height)):Infinity;
 const seen=new Set(),components=[];
 for(let y=y1;y<=y2;y++)for(let x=x1;x<=x2;x++){
  const key=(y-y1)*(x2-x1+1)+(x-x1);if(seen.has(key)||!img.dark(x,y))continue;
  const stack=[[x,y]];seen.add(key);let minX=x,maxX=x,minY=y,maxY=y,area=0;
  while(stack.length){const [px,py]=stack.pop();area++;minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py);
   for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=px+dx,ny=py+dy,nk=(ny-y1)*(x2-x1+1)+(nx-x1);if(nx<x1||nx>x2||ny<y1||ny>y2||seen.has(nk)||!img.dark(nx,ny))continue;seen.add(nk);stack.push([nx,ny]);}
  }
  const mx=(minX+maxX)/2,my=(minY+maxY)/2;
  components.push({minX,maxX,minY,maxY,mx,my,area});
 }
 const small=c=>c.area>=5&&c.area<=90&&c.maxX-c.minX<=10&&c.maxY-c.minY<=10;
 // Long OCR words can place the box center 20–30px away from the actual
 // final digit, especially before a barline. Locate its 28px-tall ink first.
 const body=components.filter(c=>c.area>=70&&c.maxX-c.minX>=5&&c.maxX-c.minX<=26&&c.maxY-c.minY>=15&&c.maxY-c.minY<=35&&c.my>=cy-12&&c.my<=cy+16&&Math.abs(c.mx-cx)<=31).sort((a,b)=>Math.abs(a.mx-cx)-Math.abs(b.mx-cx))[0];
 const actualCx=body?.mx??cx;
 const above=components.some(c=>small(c)&&Math.abs(c.mx-actualCx)<=15&&c.my>=cy-22&&c.my<=cy-8);
 // A Chinese lyric begins just below the beam on some layouts. Isolated
 // strokes of 我/还 otherwise look exactly like a low-octave point.
 const below=components.some(c=>small(c)&&Math.abs(c.mx-actualCx)<=15&&c.my>=cy+32&&c.my<=cy+56&&c.my<lyricTop-4);
 const augmentation=body&&components.some(c=>small(c)&&c.minX>=body.maxX+4&&c.minX<=body.maxX+17&&c.my>=body.minY+5&&c.my<=body.maxY-5);
 return {octave:Number(above)-Number(below),dots:Number(!!augmentation),bodyBottom:body?.maxY,noteX:body?actualCx/img.width:g.x};
}
function rowLyrics(row,lines){return lines.find(l=>l.y>row.y+row.height*.65&&l.y<row.y+Math.max(.09,row.height*4)&&l.glyphs.some(g=>chinese.test(g.ch)));}
function lyricLine(row,lines,extra){
 const original=rowLyrics(row,lines),glyphs=[...(original?.glyphs||[])].filter(g=>chinese.test(g.ch));
 // The cropped Chinese pass fills holes in the whole-page OCR. When the two
 // disagree at the same printed position, preserve the whole-page reading:
 // its surrounding context is better (e.g. 和 versus cropped 加).
 for(const g of extra||[])if(chinese.test(g.ch)&&g.y>row.y+.014&&g.y<row.y+.085&&!glyphs.some(v=>Math.abs(v.x-g.x)<.014))glyphs.push(g);
 return glyphs.length?{glyphs:glyphs.sort((a,b)=>a.x-b.x)}:null;
}
function alignLyrics(notes,line){if(!line)return;const chars=line.glyphs.filter(g=>chinese.test(g.ch));const available=notes.filter(n=>n.degree>0&&!n.hold);if(!available.length)return;
 // Multiple sung syllables can share a printed note. Never discard a visible
 // lyric merely because an OCR note was missed or an earlier note got a word.
 for(const ch of chars){let best=available[0],distance=Infinity;for(const note of available){const d=Math.abs(note.x-ch.x);if(d<distance){distance=d;best=note;}}best.lyric+=ch.ch;}
}
function parseMelodyRow(row,lines,img,bars,extraLyrics){
 const notes=[],glyphs=row.glyphs,lyric=lyricLine(row,lines,extraLyrics);let accidental=0;
 for(const g of glyphs){const ch=g.ch;if(/^[#♯b♭]$/.test(ch)){accidental=/^[b♭]$/.test(ch)?-1:1;continue;}const hold=/^[-—–]$/.test(ch),degree=scoreDigit(ch);if(degree===null&&!hold)continue;
  // Vision often reads a printed separator as 1, i, or l. Its long vertical
  // ink is already identified geometrically, so it cannot also be a note.
  if(/^[1iIlL|]$/.test(ch)&&bars.some(b=>Math.abs(b-g.x)*img.width<=10)){accidental=0;continue;}
  // OCR sometimes calls a small augmentation dot a dash. A nearby physical
  // dot already found beside the preceding numeral must not add a beat.
  if(hold&&notes.at(-1)?.dots&&g.x>notes.at(-1).x&&(g.x-notes.at(-1).x)*img.width<35)continue;
  const {octave,dots,bodyBottom,noteX}=hold?{octave:0,dots:0,noteX:g.x}:dotInfo(img,g,row,lyric);
  notes.push({degree:hold?(notes.at(-1)?.degree||0):degree,accidental:hold?0:accidental,octave,base:hold?4:4*2**horizontalStrokeCount(img,{...g,x:noteX},row,bodyBottom,lyric),dots,x:noteX,measure:1,hold:hold&&!!notes.at(-1)?.degree,lyric:''});accidental=0;
 }
 alignLyrics(notes,lyric);
 for(const mark of glyphs.filter(g=>/^[.．·•]$/.test(g.ch))){
  const preceding=[...notes].reverse().find(n=>n.x<mark.x&&mark.x-n.x<.032);
  if(preceding)preceding.dots=1;
 }
 for(const n of notes)n.measure=1+bars.filter(b=>b<n.x).length;
 return notes;
}
const noteBeats=n=>4/(Number(n.base)||4)*(n.dots?1.5:1);
function mergeNoteReads(primary,secondary,img){
 const merged=primary.map(n=>({...n}));
 for(const note of secondary){
  const nearest=merged.reduce((best,n)=>Math.abs(n.x-note.x)<Math.abs((best?.x??-10)-note.x)?n:best,null);
  if(nearest&&Math.abs(nearest.x-note.x)*img.width<13){if(!nearest.lyric&&note.lyric)nearest.lyric=note.lyric;continue;}
  merged.push({...note});
 }
 return merged.sort((a,b)=>a.x-b.x);
}
function chooseMeasureNotes(primary,secondary,img,expected){
 if(!secondary.length)return primary;
 const combined=mergeNoteReads(primary,secondary,img);
 const candidates=[primary,secondary,combined];
 const score=notes=>Math.abs(notes.reduce((total,n)=>total+noteBeats(n),0)-expected);
 // A complete reading wins. If neither OCR pass is complete, merge only
 // geometrically distinct notes before giving up and reporting bad beats.
 return candidates.reduce((best,candidate)=>score(candidate)<score(best)-.001?candidate:best,primary);
}
function parseChords(lines,rows,barsByRow){const chords=[];for(let ri=0;ri<rows.length;ri++){
 const row=rows[ri],prior=ri?rows[ri-1].y:0,next=rows[ri+1]?.y??1;
 const zone=lines.filter(l=>l.y>prior&&l.y<next&&l.y>row.y+row.height&&l.y<row.y+.18&&!chinese.test(l.text));
 for(const line of zone)for(const g of line.glyphs){if(!/^[A-G]$/.test(g.ch))continue;const suffix=line.glyphs.filter(v=>v.x>g.x&&v.x<g.x+.035).map(v=>v.ch).join('');const label=(g.ch+suffix).match(/^[A-G](?:[#b♯♭])?(?:maj|min|m|dim|aug|sus|add)?(?:\d+)?(?:\/[A-G][#b♯♭]?)?/i)?.[0];if(!label)continue;const measure=1+barsByRow[ri].filter(b=>b<g.x).length;chords.push({rowIndex:ri,measure,label});}
 }return chords;}
export function parseScoreImage(result,image){
 const img=pixels(image),lines=linesFromObservations(result.observations),rows=melodyRows(lines,img);
 if(!rows.length){const numeric=lines.filter(r=>r.glyphs.some(g=>number.test(g.ch))).slice(0,8).map(r=>r.text.slice(0,48));throw Error(`OCR 得到 ${lines.length} 行文字，但没有组成简谱数字行。识别到的数字行：${numeric.length?numeric.join(' / '):'无'}。请保留原图供排查；不需要裁掉清晰的六线谱。`);}
 const croppedRows=[...new Set((result.melodyObservations||[]).map(o=>o.systemIndex))].map(systemIndex=>{
  const glyphs=observationGlyphs(result.melodyObservations.filter(o=>o.systemIndex===systemIndex)).filter(g=>scoreDigit(g.ch)!==null||/^[-—–.．·•]$/.test(g.ch)).sort((a,b)=>a.x-b.x);
  return glyphs.length?{glyphs,y:median(glyphs.map(g=>g.y)),height:median(glyphs.map(g=>g.bottom-g.top)),text:glyphs.map(g=>g.ch).join('')}:null;
 }).filter(Boolean);
 const notes=[],chords=[],warnings=[],repeatStarts=[],repeatEnds=[];let offset=0;
 const croppedLyrics=observationGlyphs(result.lyricObservations||[]);
 const barsByRow=rows.map(row=>detectPrintedBars(row,image));
 for(let i=0;i<rows.length;i++){
  const row=rows[i],bars=barsByRow[i];
  if(!bars.length)warnings.push(`第 ${i+1} 行没有找到清晰的小节线，本行保留为一个待校对小节。`);
  const extraLyrics=croppedLyrics.filter(g=>g.y>row.y+.014&&g.y<row.y+.085);
  let parsed=parseMelodyRow(row,lines,img,bars,extraLyrics);
  const cropped=croppedRows.reduce((best,candidate)=>Math.abs(candidate.y-row.y)<Math.abs((best?.y??-10)-row.y)?candidate:best,null);
  if(cropped&&Math.abs(cropped.y-row.y)<.05){
   const alternate=parseMelodyRow(cropped,lines,img,bars,extraLyrics);
   const selected=[];
   const expected=Number((lines.map(x=>x.text).join(' ').match(/([2346])\s*[/／]\s*([48])/)||[])[1])||4;
   for(let measure=1;measure<=Math.max(1,bars.length);measure++){
    const original=parsed.filter(n=>n.measure===measure),replacement=alternate.filter(n=>n.measure===measure);
    selected.push(...chooseMeasureNotes(original,replacement,img,expected));
   }
   parsed=selected;
  }
  for(const n of parsed){n.measure+=offset;notes.push(n);}
  bars.forEach((bar,index)=>{if(repeatAtBar(img,row,bar,'right'))repeatStarts.push(offset+index+2);if(repeatAtBar(img,row,bar,'left'))repeatEnds.push(offset+index+1);});
  const rowMeasures=Math.max(1,bars.length,...parsed.map(n=>n.measure-offset));
  const printed=(result.chords||[]).filter(c=>Number.isFinite(c.x)&&Number.isFinite(c.y)&&c.y<row.y&&(i===0||c.y>rows[i-1].y));
  if(printed.length){for(const c of printed)chords.push({measure:offset+1+bars.filter(b=>b<c.x).length,label:c.text});}
  else for(const c of parseChords(lines,[row],[bars]))chords.push({measure:c.measure+offset,label:c.label});
  offset+=rowMeasures;
 }
 if(!notes.length)throw Error('没有识别到可用音符。');
 const text=lines.map(x=>x.text).join('\n');const key=text.match(/1\s*[=＝]\s*([A-G])(?:\s*([#b♯♭]))?/i);const meter=text.match(/([2346])\s*[/／]\s*([48])/);
 const title=lines.find(l=>l.text.replace(/\s/g,'').length>=3&&chinese.test(l.text)&&l.y<rows[0].y-.05)?.text||'图片导入的简谱';
 return {notes,chords,repeatStarts,repeatEnds,key:key?(key[1]+(key[2]||'')):'C',meter:meter?`${meter[1]}/${meter[2]}`:'4/4',title,lines,warnings};
}
export function inspectScoreImageRows(result,image){
 const img=pixels(image),lines=linesFromObservations(result.observations);
 return lines.map(row=>({y:Math.round(row.y*img.height),height:Math.round(row.height*img.height),text:row.text.slice(0,90),tab:isTabStaff(row,img),bars:detectPrintedBars(row,image).map(x=>Math.round(x*img.width))}));
}
export function auditImageMeasures(notes,meter='4/4'){
 const beats=Number(String(meter).split('/')[0])||4;
 const totals=new Map();for(const n of notes||[]){const value=(Number(String(meter).split('/')[1])||4)/(Number(n.base)||4)*(n.dots?1.5:1);totals.set(n.measure,(totals.get(n.measure)||0)+value);}
 return [...totals].sort((a,b)=>a[0]-b[0]).map(([measure,total])=>({measure,beats:Math.round(total*100)/100,expected:beats,valid:Math.abs(total-beats)<.01}));
}
