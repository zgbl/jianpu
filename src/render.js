import {displayChordLabel,guitarCaption} from './guitar-notation.js';
import {chordAtMeasure} from './chords.js';
import {guitarDiagram} from './guitar-fingering.js';
import {lyricWidth} from './lyrics.js';import {layout,beamSegments} from './layout.js';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function render(score,selected,active,exporting=false,range=[],entry=null,lyricVerse=0){
 const plan=layout(score,lyricVerse),continuations=new Set(score.spans.filter(s=>s.type==='tie').map(s=>s.to));let shapes='';
 for(const {m,mi,x,y,width,notes,groups} of plan.measures){
  if(!exporting)shapes+=`<g data-measure="${mi}">`;
  if(!exporting)shapes+=`<rect data-measure="${mi}" x="${x}" y="${y-53}" width="${width}" height="${108+(plan.verseCount?plan.verseCount*26+18:0)}" fill="${mi===active?'#edf4f0':'transparent'}" rx="5"/><text x="${x+8}" y="${y-37}" class="measure">${mi+1}</text>`;
  for(const {n,x:nx,width:w,leftInset=0} of notes){
   shapes+=`<g ${exporting?'':`data-note="${esc(n.id)}" data-mi="${mi}" tabindex="0" role="button" aria-label="${n.reviewReason==='unresolved-gap'?'未识别，待确认':n.degree===0?'休止':n.degree+'，八度 '+n.octave}，${n.base}分${n.dots?'附点':''}"`}><rect x="${nx-13-(n.grace?28:0)-leftInset}" y="${y-36}" width="${w-4}" height="69" rx="4" fill="${!exporting&&(n.id===selected||range.includes(n.id))?'#d7e9e0':n.reviewRequired?'#f8e6c7':'transparent'}"/><text class="digit" x="${nx}" y="${y}">${n.reviewReason==='unresolved-gap'?'?':continuations.has(n.id)?'−':n.degree}</text>${n.reviewRequired?`<title>${n.reviewReason==='unresolved-gap'?'未识别区间：试听确认，不能视为确定休止符':'不确定音高：需要试听确认'}</title>`:''}`;
   if(n.accidental&&!continuations.has(n.id))shapes+=`<text x="${nx-17}" y="${y-5}" font-size="16">${n.accidental>0?'♯':'♭'}</text>`;
   for(let o=0;o<(continuations.has(n.id)?0:Math.abs(n.octave));o++)shapes+=`<circle class="octave" cx="${nx}" cy="${n.octave>0?y-29-o*7:y+24+o*7}" r="1.9"/>`;
   if(n.dots)shapes+=`<circle class="augmentation" cx="${nx+15}" cy="${y-8}" r="2.3"/>`;
   const extensions=n.base===1?3:n.base===2?1:0;for(let j=1;j<=extensions;j++)shapes+=`<line class="extension" x1="${nx+j*Math.max(22,(w-18)/(extensions+1))-7}" x2="${nx+j*Math.max(22,(w-18)/(extensions+1))+7}" y1="${y-8}" y2="${y-8}"/>`;
   if(n.grace){const gx=nx-24,gy=y-16;shapes+=`<text class="grace" x="${gx}" y="${gy}">${n.grace.degree}</text>`;for(let b=0;b<(n.grace.base===16?2:1);b++)shapes+=`<line class="grace-beam" x1="${gx-4}" x2="${gx+4}" y1="${gy+4+b*3}" y2="${gy+4+b*3}"/>`;for(let o=0;o<Math.abs(n.grace.octave);o++)shapes+=`<circle cx="${gx}" cy="${n.grace.octave>0?gy-15-o*4:gy+13+o*4}" r="1.1"/>`;shapes+=`<path class="grace-curve" d="M ${gx+3} ${gy+8} Q ${gx+10} ${gy+16} ${nx-8} ${y-6}"/>`;}
   shapes+='</g>';
  }
  for(const g of groups)for(const b of beamSegments(g))shapes+=`<line class="beam beam-${b.level}" x1="${b.x1}" x2="${b.x2}" y1="${b.y}" y2="${b.y}"/>`;
  const tuplets=new Map();for(const p of notes)if(p.n.tuplet){const group=tuplets.get(p.n.tuplet.id)||[];group.push(p);tuplets.set(p.n.tuplet.id,group);}
  for(const group of tuplets.values()){const a=group[0].x-9,b=group.at(-1).x+9,c=(a+b)/2,ty=y-44;shapes+=`<g class="tuplet-bracket"><path d="M ${a} ${ty+5} V ${ty} H ${c-9} M ${c+9} ${ty} H ${b} V ${ty+5}"/><text x="${c}" y="${ty+4}" text-anchor="middle" font-size="13" fill="#252d32">3</text></g>`;}
  const chords=(score.chords||[]).filter(c=>c.measureId===m.id),begin=notes.find(n=>Number.isFinite(n.n.gridTimeStart))?.n.gridTimeStart,finish=notes.at(-1)?.n.gridTimeEnd;
  for(const chord of chords){const fraction=Number.isFinite(chord.startTick)?Math.max(0,Math.min(.75,chord.startTick/Math.max(score.meter[0]*64/score.meter[1],notes.reduce((sum,n)=>sum+n.duration,0)))):Number.isFinite(begin)&&finish>begin&&Number.isFinite(chord.start)?Math.max(0,Math.min(.75,(chord.start-begin)/(finish-begin))):0;const chordX=(notes[0]?.x??x+18)+fraction*(width-32);if(score.showGuitarDiagrams){shapes+=guitarDiagram(displayChordLabel(score,chord.label),chordX-8,y-144,{capo:score.guitarNotation?.mode==='fingering'?score.guitarNotation.capo:0});shapes+=`<text class="chord-symbol" x="${chordX+24}" y="${y-148}" text-anchor="middle" font-size="17" font-weight="600" fill="#416d63">${esc(displayChordLabel(score,chord.label))}</text>`;}else shapes+=`<text x="${chordX}" y="${y-60}" font-size="17" font-weight="600" fill="#416d63">${esc(displayChordLabel(score,chord.label))}</text>`;}
  const bar=x+width-5;
  if(m.repeatStart){shapes+=`<line class="heavy" x1="${x+4}" x2="${x+4}" y1="${y-24}" y2="${y+20}"/><line x1="${x+10}" x2="${x+10}" y1="${y-24}" y2="${y+20}"/><circle cx="${x+18}" cy="${y-9}" r="2.5"/><circle cx="${x+18}" cy="${y+4}" r="2.5"/>`;}
  shapes+=`<line x1="${bar}" x2="${bar}" y1="${y-24}" y2="${y+20}"/>`;
  if(m.final)shapes+=`<line class="heavy final" x1="${bar+6}" x2="${bar+6}" y1="${y-24}" y2="${y+20}"/>`;
  if(m.repeatEnd)shapes+=`<line class="heavy" x1="${bar+6}" x2="${bar+6}" y1="${y-24}" y2="${y+20}"/><circle cx="${bar-8}" cy="${y-9}" r="2.5"/><circle cx="${bar-8}" cy="${y+4}" r="2.5"/>`;
  if(!notes.length&&!exporting)shapes+=`<text class="measure empty-bar" x="${x+22}" y="${y}">点击输入音符</text>`;
  if(!exporting)shapes+='</g>';
 }
 if(entry&&!exporting){const m=plan.measures[entry.mi];if(m){const next=m.notes[entry.index],prev=m.notes[entry.index-1],x=!m.notes.length?m.x+22:next?(prev?(prev.x+next.x)/2:next.x-17):m.x+m.width-16;shapes+=`<path class="input-caret" pointer-events="none" d="M ${x} ${m.y-31} v 64 M ${x-4} ${m.y-31} h 8" style="stroke:#416d63;stroke-width:2.5;fill:none"/>`;}}
 if(lyricVerse&&!exporting){for(const p of plan.positions.values()){if(!p.n.degree)continue;const existing=(score.lyrics||[]).find(l=>l.noteId===p.n.id&&l.verse===lyricVerse),slotX=p.x+(existing?lyricWidth(existing.text)/2+(existing.offsetX||0)+20:0);const y=p.y+62+(lyricVerse-1)*26;shapes+=`<g class="lyric-slot" data-lyric-slot="${esc(p.n.id)}" data-verse="${lyricVerse}" data-mi="${p.mi}" role="button" aria-label="在此输入第${lyricVerse}段歌词"><rect x="${slotX-13}" y="${y-21}" width="26" height="27" rx="3" fill="transparent" stroke="#d9e5de" stroke-dasharray="2 3"/><text x="${slotX}" y="${y-2}" text-anchor="middle" font-size="12" fill="#9cadA5">＋</text></g>`;}}
 for(const l of score.lyrics||[]){if(score.lyricAlignment?.displayMode==='characters'&&score.lyricAlignment.source==='word-timestamps'&&l.verse===score.lyricAlignment.verse&&!l.manual)continue;const p=plan.positions.get(l.noteId);if(!p)continue;const y=p.y+62+(l.verse-1)*26,w=lyricWidth(l.text),lx=p.x+(l.offsetX||0);let cursor=lx-w/2;shapes+=`<g class="lyric-group" ${exporting?'':`data-lyric="${esc(l.noteId)}" data-verse="${l.verse}" data-mi="${p.mi}"`}>${exporting&&!l.charOffsets?`<text class="lyric" x="${lx}" y="${y}">${esc(l.text)}</text>`:Array.from(l.text).map((c,i)=>{const cw=lyricWidth(c),cx=cursor+cw/2+(l.charOffsets?.[i]||0);cursor+=cw;return `<g ${exporting?'':`data-lyric-char="${i}" role="button" aria-label="拖动歌词 ${esc(c)}"`}><rect x="${cx-cw/2}" y="${y-21}" width="${cw}" height="28" fill="transparent" pointer-events="all"/><text class="lyric" x="${cx}" y="${y}" pointer-events="none">${esc(c)}</text></g>`;}).join('')}</g>`;if(l.endNoteId){const end=plan.positions.get(l.endNoteId);if(end){for(let r=p.row;r<=end.row;r++){const x1=r===p.row?lx+w/2+5:38,x2=r===end.row?end.x+8:plan.rowEnds[r],ly=plan.baseline+r*plan.rowGap+65+(l.verse-1)*26;if(x2>x1)shapes+=`<line class="melisma" x1="${x1}" x2="${x2}" y1="${ly}" y2="${ly}"/>`;}}}}
 // Both ends retain event IDs; a cross-row curve is split at the system edges.
 const lanes=[];
 for(const span of score.spans){const a=plan.positions.get(span.from),b=plan.positions.get(span.to);if(!a||!b)continue;const interval=[a.mi*64+a.start,b.mi*64+b.start];let lane=0;while(lanes[lane]?.some(v=>v[0]<=interval[1]&&v[1]>=interval[0]))lane++;(lanes[lane]??=[]).push(interval);const offset=43+lane*12;
  const curve=(x1,x2,y,split=false)=>{const rise=split?9:Math.min(18,Math.max(8,(x2-x1)*.12));return `<path class="${span.type}" d="M ${x1} ${y} C ${x1+(x2-x1)*.25} ${y-rise}, ${x2-(x2-x1)*.25} ${y-rise}, ${x2} ${y}"/>`;};
  if(a.row===b.row)shapes+=curve(a.x,b.x,a.y-offset);else{shapes+=curve(a.x,plan.rowEnds[a.row],a.y-offset,true);for(let r=a.row+1;r<b.row;r++)shapes+=curve(38,plan.rowEnds[r],plan.baseline+r*plan.rowGap-offset,true);shapes+=curve(38,b.x,b.y-offset,true);}
 }
 for(const ending of score.endings||[]){const a=plan.measures.find(m=>m.m.id===ending.fromMeasure),b=plan.measures.find(m=>m.m.id===ending.toMeasure);if(!a||!b)continue;for(let row=a.row;row<=b.row;row++){const x1=row===a.row?a.x:38,x2=row===b.row?b.x+b.width-5:plan.rowEnds[row],y=plan.baseline+row*plan.rowGap-78;shapes+=`<path class="ending" d="M ${x1} ${y+12} V ${y} H ${x2}${row===b.row?' v 12':''}"/><text class="measure" x="${x1+5}" y="${y-4}">${ending.number}${row!==a.row?'（续）':''}.</text>`;}}
 let extraHeight=0;
 for(const {c,x,y,verse,spacingAdjusted} of plan.timedLyrics){
  const uncertain=c.status!=='acoustic';
  shapes+=`<g ${exporting?'':`data-timed-lyric="${esc(c.id)}" data-verse="${verse}" class="draggable-lyric" role="button" tabindex="0" aria-label="选择或拖动歌词 ${esc(c.text)}" style="cursor:grab;touch-action:none"`}><title>${uncertain?'时间待核对':'声学定位'} ${c.start.toFixed(2)} 秒${spacingAdjusted?'；小节内横向排开，时间未改动':''}</title><rect x="${x-10}" y="${y-21}" width="20" height="28" fill="transparent" pointer-events="all"/><text x="${x}" y="${y}" text-anchor="middle" font-size="18" fill="${uncertain?'#9b641e':'#303b43'}">${esc(c.text)}</text></g>`;
 }
 // Keep lyrics with no usable time visible for review. Show them below the
 // score as pending text instead of silently dropping or falsely aligning them.
 const alignment=score.lyricAlignment;
 const unresolved=(alignment?.characters||[]).filter(c=>c.timingUnresolved||!Number.isFinite(c.start)||!Number.isFinite(c.end));
 const unresolvedByLine=new Map();
 for(const c of unresolved){const key=c.lineId||'pending';unresolvedByLine.set(key,(unresolvedByLine.get(key)||'')+c.text);}
 const unresolvedLines=(alignment?.lines||[]).filter(line=>line.timingUnresolved&&unresolvedByLine.has(line.id)).map(line=>({id:line.id,text:unresolvedByLine.get(line.id)}));
 for(const [id,text] of unresolvedByLine)if(!unresolvedLines.some(line=>line.id===id))unresolvedLines.push({id,text});
 for(let i=0;i<unresolvedLines.length;i++){
  const y=plan.height+28+i*27,entry=unresolvedLines[i];
  shapes+=`<rect x="38" y="${y-19}" width="${Math.min(plan.width-76,Math.max(440,entry.text.length*22+170))}" height="25" rx="4" fill="#fff3df" stroke="#d5a34c" stroke-dasharray="4 3"/><text x="48" y="${y}" font-size="14" fill="#8b5c19">待定位</text><text x="104" y="${y}" font-size="17" fill="#9b641e">${esc(entry.text)}</text>`;
 }
 extraHeight=unresolvedLines.length?unresolvedLines.length*27+20:0;
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${plan.width} ${plan.height+extraHeight}" style="font-family:Arial,sans-serif;color:#252d32;--score-width-factor:${Math.max(1,plan.width/1120)}"><style>.digit{font-size:24px;font-weight:600;text-anchor:middle;fill:#252d32}.lyric{font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:18px;text-anchor:middle;fill:#303b43}.melisma{stroke-width:1}.lyric-group{cursor:grab;user-select:none}.draggable-lyric{user-select:none}.draggable-lyric text{pointer-events:none}.selected-lyric rect{fill:#d7e9e0;stroke:#416d63;stroke-width:1.5}.lyric-drag-ghost{font-family:Arial,sans-serif}.grace{font-size:15px;font-weight:600;text-anchor:middle;fill:#252d32}.measure{font-size:12px;fill:#62728a}line{stroke:#252d32;stroke-width:1.7}line.heavy{stroke-width:4}circle{fill:#252d32}path{fill:none;stroke:#252d32;stroke-width:1.3}g:focus{outline:none}g:focus rect{stroke:#416d63}.beam{pointer-events:none}</style><text x="38" y="28" font-size="20">${esc(score.title)}</text><text x="38" y="51" font-size="14">1 = ${esc(score.key)}　${score.meter.join('/')}${score.performer?`　${esc(score.performer)} 演唱`:""}</text>${guitarCaption(score)?`<text x="38" y="73" font-size="13" fill="#416d63">${esc(guitarCaption(score))}</text>`:""}${shapes}</svg>`;
}
