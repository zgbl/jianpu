import {audioScoreTimeline} from './audio-score-cursor.js';
import {lyricWidth} from './lyrics.js';import {layout,beamSegments} from './layout.js';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function render(score,selected,active,exporting=false,range=[],entry=null,lyricVerse=0){
 const plan=layout(score,lyricVerse);let shapes='';
 for(const {m,mi,x,y,width,notes,groups} of plan.measures){
  if(!exporting)shapes+=`<g data-measure="${mi}">`;
  if(!exporting)shapes+=`<rect data-measure="${mi}" x="${x}" y="${y-53}" width="${width}" height="${108+(plan.verseCount?plan.verseCount*26+18:0)}" fill="${mi===active?'#edf4f0':'transparent'}" rx="5"/><text x="${x+8}" y="${y-37}" class="measure">${mi+1}</text>`;
  for(const {n,x:nx,width:w,leftInset=0} of notes){
   shapes+=`<g ${exporting?'':`data-note="${esc(n.id)}" data-mi="${mi}" tabindex="0" role="button" aria-label="${n.degree===0?'休止':n.degree+'，八度 '+n.octave}，${n.base}分${n.dots?'附点':''}"`}><rect x="${nx-13-(n.grace?28:0)-leftInset}" y="${y-36}" width="${w-4}" height="69" rx="4" fill="${!exporting&&(n.id===selected||range.includes(n.id))?'#d7e9e0':'transparent'}"/><text class="digit" x="${nx}" y="${y}">${n.degree}</text>`;
   if(n.accidental)shapes+=`<text x="${nx-17}" y="${y-5}" font-size="16">${n.accidental>0?'♯':'♭'}</text>`;
   for(let o=0;o<Math.abs(n.octave);o++)shapes+=`<circle class="octave" cx="${nx}" cy="${n.octave>0?y-29-o*7:y+24+o*7}" r="1.9"/>`;
   if(n.dots)shapes+=`<circle class="augmentation" cx="${nx+15}" cy="${y-8}" r="2.3"/>`;
   const extensions=n.base===1?3:n.base===2?1:0;for(let j=1;j<=extensions;j++)shapes+=`<line class="extension" x1="${nx+j*43-7}" x2="${nx+j*43+7}" y1="${y-8}" y2="${y-8}"/>`;
   if(n.grace){const gx=nx-24,gy=y-16;shapes+=`<text class="grace" x="${gx}" y="${gy}">${n.grace.degree}</text>`;for(let b=0;b<(n.grace.base===16?2:1);b++)shapes+=`<line class="grace-beam" x1="${gx-4}" x2="${gx+4}" y1="${gy+4+b*3}" y2="${gy+4+b*3}"/>`;for(let o=0;o<Math.abs(n.grace.octave);o++)shapes+=`<circle cx="${gx}" cy="${n.grace.octave>0?gy-15-o*4:gy+13+o*4}" r="1.1"/>`;shapes+=`<path class="grace-curve" d="M ${gx+3} ${gy+8} Q ${gx+10} ${gy+16} ${nx-8} ${y-6}"/>`;}
   shapes+='</g>';
  }
  for(const g of groups)for(const b of beamSegments(g))shapes+=`<line class="beam beam-${b.level}" x1="${b.x1}" x2="${b.x2}" y1="${b.y}" y2="${b.y}"/>`;
  const bar=x+width-5;
  if(m.repeatStart){shapes+=`<line class="heavy" x1="${x+4}" x2="${x+4}" y1="${y-24}" y2="${y+20}"/><line x1="${x+10}" x2="${x+10}" y1="${y-24}" y2="${y+20}"/><circle cx="${x+18}" cy="${y-9}" r="2.5"/><circle cx="${x+18}" cy="${y+4}" r="2.5"/>`;}
  shapes+=`<line x1="${bar}" x2="${bar}" y1="${y-24}" y2="${y+20}"/>`;
  if(m.final)shapes+=`<line class="heavy final" x1="${bar+6}" x2="${bar+6}" y1="${y-24}" y2="${y+20}"/>`;
  if(m.repeatEnd)shapes+=`<line class="heavy" x1="${bar+6}" x2="${bar+6}" y1="${y-24}" y2="${y+20}"/><circle cx="${bar-8}" cy="${y-9}" r="2.5"/><circle cx="${bar-8}" cy="${y+4}" r="2.5"/>`;
  if(!notes.length&&!exporting)shapes+=`<text class="measure empty-bar" x="${x+22}" y="${y}">点击输入音符</text>`;
  if(!exporting)shapes+='</g>';
 }
 if(entry&&!exporting){const m=plan.measures[entry.mi];if(m){const next=m.notes[entry.index],prev=m.notes[entry.index-1],x=!m.notes.length?m.x+22:next?(prev?(prev.x+next.x)/2:next.x-17):m.x+m.width-16;shapes+=`<path class="input-caret" pointer-events="none" d="M ${x} ${m.y-31} v 64 M ${x-4} ${m.y-31} h 8" style="stroke:#416d63;stroke-width:2.5;fill:none"/>`;}}
 if(lyricVerse&&!exporting){for(const p of plan.positions.values()){if(!p.n.degree||(score.lyrics||[]).some(l=>l.noteId===p.n.id&&l.verse===lyricVerse))continue;const y=p.y+62+(lyricVerse-1)*26;shapes+=`<g class="lyric-slot" data-lyric-slot="${esc(p.n.id)}" data-verse="${lyricVerse}" data-mi="${p.mi}" role="button" aria-label="在此输入第${lyricVerse}段歌词"><rect x="${p.x-13}" y="${y-21}" width="26" height="27" rx="3" fill="transparent" stroke="#d9e5de" stroke-dasharray="2 3"/><text x="${p.x}" y="${y-2}" text-anchor="middle" font-size="12" fill="#9cadA5">＋</text></g>`;}}
 for(const l of score.lyrics||[]){const p=plan.positions.get(l.noteId);if(!p)continue;const y=p.y+62+(l.verse-1)*26,w=lyricWidth(l.text),lx=p.x+(l.offsetX||0);shapes+=`<g class="lyric-group" ${exporting?'':`data-lyric="${esc(l.noteId)}" data-verse="${l.verse}" data-mi="${p.mi}"`}><rect x="${lx-w/2-4}" y="${y-20}" width="${w+8}" height="26" fill="transparent"/><text class="lyric" x="${lx}" y="${y}">${exporting?esc(l.text):Array.from(l.text).map((c,i)=>`<tspan data-lyric-char="${i}">${esc(c)}</tspan>`).join('')}</text></g>`;if(l.endNoteId){const end=plan.positions.get(l.endNoteId);if(end){for(let r=p.row;r<=end.row;r++){const x1=r===p.row?lx+w/2+5:38,x2=r===end.row?end.x+8:plan.rowEnds[r],ly=plan.baseline+r*plan.rowGap+65+(l.verse-1)*26;if(x2>x1)shapes+=`<line class="melisma" x1="${x1}" x2="${x2}" y1="${ly}" y2="${ly}"/>`;}}}}
 // Both ends retain event IDs; a cross-row curve is split at the system edges.
 const lanes=[];
 for(const span of score.spans){const a=plan.positions.get(span.from),b=plan.positions.get(span.to);if(!a||!b)continue;const interval=[a.mi*64+a.start,b.mi*64+b.start];let lane=0;while(lanes[lane]?.some(v=>v[0]<=interval[1]&&v[1]>=interval[0]))lane++;(lanes[lane]??=[]).push(interval);const offset=43+lane*12;
  const curve=(x1,x2,y,split=false)=>{const rise=split?9:Math.min(18,Math.max(8,(x2-x1)*.12));return `<path class="${span.type}" d="M ${x1} ${y} C ${x1+(x2-x1)*.25} ${y-rise}, ${x2-(x2-x1)*.25} ${y-rise}, ${x2} ${y}"/>`;};
  if(a.row===b.row)shapes+=curve(a.x,b.x,a.y-offset);else{shapes+=curve(a.x,plan.rowEnds[a.row],a.y-offset,true);for(let r=a.row+1;r<b.row;r++)shapes+=curve(38,plan.rowEnds[r],plan.baseline+r*plan.rowGap-offset,true);shapes+=curve(38,b.x,b.y-offset,true);}
 }
 for(const ending of score.endings||[]){const a=plan.measures.find(m=>m.m.id===ending.fromMeasure),b=plan.measures.find(m=>m.m.id===ending.toMeasure);if(!a||!b)continue;for(let row=a.row;row<=b.row;row++){const x1=row===a.row?a.x:38,x2=row===b.row?b.x+b.width-5:plan.rowEnds[row],y=plan.baseline+row*plan.rowGap-78;shapes+=`<path class="ending" d="M ${x1} ${y+12} V ${y} H ${x2}${row===b.row?' v 12':''}"/><text class="measure" x="${x1+5}" y="${y-4}">${ending.number}${row!==a.row?'（续）':''}.</text>`;}}
 const unresolved=score.lyricAlignment?.pending||[];let extraHeight=0;const segments=unresolved.length?audioScoreTimeline(score):[];
 for(const c of unresolved){if(c.status!=='acoustic'||!Number.isFinite(c.start))continue;const seg=segments.find(s=>s.start<=c.start&&s.end>c.start);if(!seg)continue;const x=seg.x+(seg.toX-seg.x)*(c.start-seg.start)/(seg.end-seg.start);shapes+=`<text x="${x}" y="${seg.y+112}" font-size="17" fill="#9b641e">${esc(c.text)}</text>`;}
 if(unresolved.length){const text='待定位歌词：'+unresolved.map(c=>c.text).join('');const chunks=Array.from(text);for(let i=0;i<chunks.length;i+=48){shapes+=`<text x="38" y="${plan.height+20+extraHeight}" font-size="16" fill="#9b641e">${esc(chunks.slice(i,i+48).join(''))}</text>`;extraHeight+=25;}extraHeight+=30;}
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${plan.width} ${plan.height+extraHeight}" style="font-family:Arial,sans-serif;color:#252d32"><style>.digit{font-size:28px;font-weight:600;text-anchor:middle;fill:#252d32}.lyric{font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:18px;text-anchor:middle;fill:#303b43}.melisma{stroke-width:1}.lyric-group{cursor:text}.grace{font-size:15px;font-weight:600;text-anchor:middle;fill:#252d32}.measure{font-size:12px;fill:#62728a}line{stroke:#252d32;stroke-width:1.7}line.heavy{stroke-width:4}circle{fill:#252d32}path{fill:none;stroke:#252d32;stroke-width:1.3}g:focus{outline:none}g:focus rect{stroke:#416d63}.beam{pointer-events:none}</style><text x="38" y="28" font-size="20">${esc(score.title)}</text><text x="38" y="51" font-size="14">1 = ${esc(score.key)}　${score.meter[0]}/4${score.performer?`　${esc(score.performer)} 演唱`:""}</text>${shapes}</svg>`;
}
