"""Correct-transcript CTC alignment. Local models only during inference."""
import argparse, json, os, sys, hashlib, re
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parent.parent
MODEL='jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn'
CACHE=ROOT/'.cache/lyrics-align'
def emit(message,progress): print(json.dumps(dict(message=message,progress=progress),ensure_ascii=False),flush=True)
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
        chars=re.sub(r'[^\w]','',convert(w['text']))
        for i,c in enumerate(chars):source.append((c,w['start']+(w['end']-w['start'])*i/max(1,len(chars))))
    target=''.join(lines);anchors={}
    for block in SequenceMatcher(None,''.join(c for c,_ in source),target,autojunk=False).get_matching_blocks():
        if block.size>=2:
            for k in range(block.size): anchors[block.b+k]=source[block.a+k][1]
    results=[];line_results=[];at=0;last_end=0
    vocab=processor.tokenizer.get_vocab();blank=model.config.pad_token_id
    from pypinyin import lazy_pinyin
    phonetic={}
    for c,token in vocab.items():
        if len(c)==1 and '\u4e00'<=c<='\u9fff':phonetic.setdefault(lazy_pinyin(c)[0],[]).append(token)
    for li,line in enumerate(lines):
        known=[anchors[i] for i in range(at,at+len(line)) if i in anchors]
        future=[v for i,v in anchors.items() if i>=at+len(line)]
        if known: start=max(last_end,min(known)-2);end=min(duration,max(known)+max(3,len(line)*.6))
        elif future: end=min(duration,min(future)+.4);start=max(last_end,end-max(14,len(line)*1.5))
        elif not anchors: start=last_end;end=min(duration,start+30)
        else: start=last_end;end=min(duration,start+max(10,len(line)*1.1))
        end=min(end,start+45)
        emit(f'声学对齐第 {li+1}/{len(lines)} 句',.05+.9*li/len(lines))
        chars=[dict(id=f'line-{li}-char-{i}',lineId=f'line-{li}',text=c,status='pending') for i,c in enumerate(line)]
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
                good=[c for c in chars if c['status']=='acoustic']
                if len(good)>=len(chars)*.7:last_end=max(last_end,chars[-1]['end'])
                # A weak syllable must not discard independently supported
                # neighbours. Keep per-character confidence and mark the line
                # mixed/pending without erasing its reliable timing candidates.
        results.extend(chars);line_results.append(dict(id=f'line-{li}',text=line,status='aligned' if all(c['status']=='acoustic' for c in chars) else 'pending'));at+=len(line)
    payload=dict(version=1,text=text,model=MODEL,algorithmVersion='ctc-phonetic-window-v3',audioHash=hashlib.sha256(Path(a.input).read_bytes()).hexdigest(),modelRevision=getattr(model.config,'_commit_hash',None),timeBase='clip-seconds',transcriptHash=hashlib.sha256(text.encode()).hexdigest(),lines=line_results,characters=results,warnings=['中文语音声学模型用于歌唱对齐，低置信文字保留待定位；请试听核对。'])
    Path(a.output).write_text(json.dumps(payload,ensure_ascii=False));emit('逐字对齐完成',1)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--prepare',action='store_true');p.add_argument('--input');p.add_argument('--output');p.add_argument('--text');p.add_argument('--anchors');a=p.parse_args()
    try:main(a)
    except Exception as e:emit(str(e),0);sys.exit(1)
