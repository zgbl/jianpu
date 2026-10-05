"""Correct-transcript CTC alignment. Local models only during inference."""
import argparse, json, os, sys, hashlib, re
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parent.parent
MODEL='jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn'
CACHE=ROOT/'.cache/lyrics-align'
def emit(message,progress): print(json.dumps(dict(message=message,progress=progress),ensure_ascii=False),flush=True)
def line_groups(lines, anchors):
    """Decode consecutive missing-anchor lines together, preserving CTC order."""
    groups=[];at=0
    for li,line in enumerate(lines):
        indices=list(range(at,at+len(line)))
        known=[anchors[i] for i in indices if i in anchors]
        item=dict(index=li,text=line,offset=at,known=known)
        if not known and groups and not groups[-1][0]['known']:
            groups[-1].append(item)
        else: groups.append([item])
        at+=len(line)
    return groups

def search_window(group, anchors, duration, last_end):
    at=group[0]['offset'];finish=group[-1]['offset']+len(group[-1]['text'])
    known=[anchors[i] for i in range(at,finish) if i in anchors]
    future=[v for i,v in anchors.items() if i>=finish and v>last_end]
    ceiling=min(duration,min(future)-.05) if future else duration
    if known:
        start=max(last_end,min(known)-2)
        end=min(ceiling,max(known)+max(3,(finish-at)*.6))
    else:
        # Search the WHOLE intervening gap. Starting near the next anchor
        # skips the first missing verse after a long instrumental break.
        start=last_end;end=ceiling
    return start,max(start,end)

def accept_line_timing(chars):
    good=[c for c in chars if c.get('status')=='acoustic']
    consecutive=any(a.get('status')=='acoustic' and b.get('status')=='acoustic'
                    for a,b in zip(chars,chars[1:]))
    supported=len(good)>=2 and (consecutive or len(good)>=len(chars)*.4)
    if not supported:
        for c in chars:
            c['observedStart']=c.pop('start',None);c['observedEnd']=c.pop('end',None)
            c.update(status='pending',timingUnresolved=True,evidence='insufficient-line-evidence')
    return supported

def restore_estimated_timing(chars, start, end):
    """Retain draft coverage without promoting weak observations to anchors."""
    if end<=start:return
    # Preserve ordered CTC positions within this constrained window as estimates.
    observed=[(c.get('start',c.get('observedStart')),c.get('end',c.get('observedEnd'))) for c in chars]
    ordered=all(a is not None and b is not None and start<=a<b<=end+.001 for a,b in observed)
    ordered=ordered and all(a[1]<=b[0]+.001 for a,b in zip(observed,observed[1:]))
    for i,c in enumerate(chars):
        if not c.get('timingUnresolved'):continue
        if ordered:a,b=observed[i]
        else:
            left=next((j for j in range(i-1,-1,-1) if not chars[j].get('timingUnresolved') and chars[j].get('status')=='acoustic'),-1)
            right=next((j for j in range(i+1,len(chars)) if not chars[j].get('timingUnresolved') and chars[j].get('status')=='acoustic'),len(chars))
            low=chars[left]['end'] if left>=0 else start
            high=chars[right]['start'] if right<len(chars) else end
            step=max(0,(high-low)/(right-left-1))
            if step<=0:continue
            a=low+(i-left-1)*step;b=min(high,a+step*.8)
        c.update(start=round(a,4),end=round(b,4),status='estimated',timingEstimated=True,
                 evidence='bounded-weak-alignment' if ordered else 'bounded-window-estimate')
        c.pop('timingUnresolved',None)
def ctc_align(logp,tokens,blank):
    # Expanded blank states distinguish repeated letters. Free start/end allow
    # locating a short phrase within a larger acoustic search window.
    states=[blank]
    for t in tokens: states.extend([t,blank])
    T,S=len(logp),len(states)
    if not tokens or T<len(tokens): return None
    prev=np.full(S,-np.inf); prev[0]=0
    back=np.zeros((T,S),dtype=np.uint8)
    for t in range(T):
        stay=prev.copy(); one=np.r_[-np.inf,prev[:-1]]; two=np.r_[-np.inf,-np.inf,prev[:-2]]
        for s in range(S):
            if s<2 or states[s]==blank or states[s]==states[s-2]: two[s]=-np.inf
        options=np.stack([stay,one,two]); moves=np.argmax(options,axis=0)
        prev=options[moves,np.arange(S)]+logp[t,states];prev[0]=0
        back[t]=moves
        if t==0: best=(-np.inf,0,0)
        for s in (S-1,S-2):
            if prev[s]>best[0]: best=(prev[s],t,s)
    if not np.isfinite(best[0]): return None
    _,t,s=best; frames=[[] for _ in tokens]
    while t>=0 and s>0:
        if s%2: frames[(s-1)//2].append(t)
        s-=int(back[t,s]);t-=1
    if any(not f for f in frames): return None
    return [(min(f),max(f)+1,float(np.exp(np.mean(logp[f,tok])))) for f,tok in zip(frames,tokens)]
def main(a):
    import torch
    from transformers import AutoProcessor,AutoModelForCTC
    torch.set_num_threads(min(4,os.cpu_count() or 2))
    processor=AutoProcessor.from_pretrained(MODEL,cache_dir=str(CACHE),local_files_only=not a.prepare)
    model=AutoModelForCTC.from_pretrained(MODEL,cache_dir=str(CACHE),local_files_only=not a.prepare).eval()
    if a.prepare:
        CACHE.mkdir(parents=True,exist_ok=True);(CACHE/'ready.json').write_text(json.dumps({'model':MODEL}));emit('中文声学对齐模型已准备',1);return
    import librosa
    from difflib import SequenceMatcher
    from opencc import OpenCC
    text=Path(a.text).read_text();convert=OpenCC('t2s').convert
    lines=[re.sub(r'[^\w]', '',convert(s)) for s in text.splitlines() if s.strip()];lines=[s for s in lines if s]
    audio,sr=librosa.load(a.input,sr=16000,mono=True);duration=len(audio)/sr
    words=json.loads(Path(a.anchors).read_text()).get('words',[]) if a.anchors and Path(a.anchors).exists() else []
    source=[]
    for w in words:
        if w.get('probability',1)<.2:continue
        chars=re.sub(r'[^\w]','',convert(w['text']))
        for i,c in enumerate(chars):source.append((c,w['start']+(w['end']-w['start'])*i/max(1,len(chars))))
    target=''.join(lines);anchors={}
    for block in SequenceMatcher(None,''.join(c for c,_ in source),target,autojunk=False).get_matching_blocks():
        if block.size>=2:
            for k in range(block.size): anchors[block.b+k]=source[block.a+k][1]
    results=[];line_results=[];last_end=0;windows=[]
    vocab=processor.tokenizer.get_vocab();blank=model.config.pad_token_id
    from pypinyin import lazy_pinyin
    phonetic={}
    for c,token in vocab.items():
        if len(c)==1 and '\u4e00'<=c<='\u9fff':phonetic.setdefault(lazy_pinyin(c)[0],[]).append(token)
    for group in line_groups(lines,anchors):
        li=group[0]['index'];line=''.join(item['text'] for item in group)
        start,end=search_window(group,anchors,duration,last_end)
        windows.append(dict(lines=[item['index']+1 for item in group],start=start,end=end))
        emit(f'声学对齐第 {li+1}–{group[-1]["index"]+1}/{len(lines)} 句',.05+.9*li/len(lines))
        chars=[dict(id=f'line-{item["index"]}-char-{i}',lineId=f'line-{item["index"]}',text=c,status='pending',timingUnresolved=True)
               for item in group for i,c in enumerate(item['text'])]
        tokens=[vocab.get(c) for c in line]
        if end-start>.2 and all(t is not None and t!=processor.tokenizer.unk_token_id for t in tokens):
            samples=audio[int(start*sr):int(end*sr)]
            with torch.inference_mode(): logits=model(**processor(samples,sampling_rate=sr,return_tensors='pt')).logits[0].log_softmax(-1).numpy()
            # Same-syllable alternatives tolerate ASR spelling errors while keeping
            # authoritative text unchanged. Discount homophone evidence.
            acoustic=logits.copy()
            for c,token in zip(line,tokens):
                alternatives=[t for t in phonetic.get(lazy_pinyin(c)[0],[]) if t!=token]
                if alternatives:
                    vals=np.concatenate([logits[:,token:token+1],logits[:,alternatives]+np.log(.5)],axis=1)
                    peak=vals.max(axis=1);acoustic[:,token]=np.minimum(0,peak+np.log(np.exp(vals-peak[:,None]).sum(axis=1)))
            aligned=ctc_align(acoustic,tokens,blank);step=(end-start)/len(logits)
            if aligned:
                for c,(f,g,p) in zip(chars,aligned):
                    c.update(start=round(start+f*step,4),end=round(start+g*step,4),confidence=p,evidence='character-or-phonetic',status='acoustic' if p>=.15 else 'pending')
                    c.pop('timingUnresolved',None)
        supported_lines={}
        for item in group:
            lid=f'line-{item["index"]}';part=[c for c in chars if c['lineId']==lid]
            supported=accept_line_timing(part)
            supported_lines[lid]=supported
        restore_estimated_timing(chars,start,end)
        for item in group:
            lid=f'line-{item["index"]}';part=[c for c in chars if c['lineId']==lid]
            supported=supported_lines[lid]
            # Advance search order for both evidence and explicit estimates.
            # Estimated characters never become acoustic anchors.
            timed=[c for c in part if c.get('end') is not None]
            if timed:last_end=max(last_end,max(c['end'] for c in timed))
            line_results.append(dict(id=lid,text=item['text'],status='aligned' if supported and all(c['status']=='acoustic' for c in part) else 'mixed' if supported else 'estimated' if timed else 'pending',timingUnresolved=not timed,timingEstimated=not supported and bool(timed)))
        results.extend(chars)
    payload=dict(version=1,text=text,model=MODEL,algorithmVersion='ctc-phonetic-window-v4.1',audioHash=hashlib.sha256(Path(a.input).read_bytes()).hexdigest(),modelRevision=getattr(model.config,'_commit_hash',None),timeBase='clip-seconds',transcriptHash=hashlib.sha256(text.encode()).hexdigest(),lines=line_results,characters=results,searchWindows=windows,warnings=['漏句按顺序联合搜索；低置信整句保留估算排位，棕色字需要试听校对，估算不作为声学锚点。'])
    Path(a.output).write_text(json.dumps(payload,ensure_ascii=False));emit('逐字对齐完成',1)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--prepare',action='store_true');p.add_argument('--input');p.add_argument('--output');p.add_argument('--text');p.add_argument('--anchors');a=p.parse_args()
    try:main(a)
    except Exception as e:emit(str(e),0);sys.exit(1)
