"""Independent tonal evidence and known-degree anchor measurement. No separation or cloud."""
import argparse, hashlib, json, sys
from pathlib import Path
import numpy as np
import soundfile as sf

NAMES = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B']
MAJOR = np.array([6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88])
MINOR = np.array([6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17])
ALGORITHM = 'harmonic-cqt-window-key-v1'

def progress(f, message):
    print(json.dumps({'progress': f, 'message': message}, ensure_ascii=False), flush=True)

def mono_audio(path, start=0, end=None, target=11025):
    import librosa
    info=sf.info(path)
    y,sr=sf.read(path, start=round(start*info.samplerate), stop=round(end*info.samplerate) if end is not None else None, dtype='float32', always_2d=True)
    if not len(y): raise ValueError('区间没有音频')
    rms=np.sqrt(np.mean(y*y,axis=0)); mixed=y.mean(axis=1)
    cancellation=float(np.sqrt(np.mean(mixed*mixed))/(max(float(rms.max()),1e-9)))
    selected='mean'
    if cancellation<.35:
        selected='channel-'+str(int(np.argmax(rms))); mixed=y[:,np.argmax(rms)]
    quality={'channel':selected,'phaseRatio':cancellation,'clippingFraction':float(np.mean(np.abs(y)>=.999))}
    return librosa.resample(mixed,orig_sr=sr,target_sr=target),quality

def rank_candidates(chroma):
    c=np.asarray(chroma,dtype=float); z=c-c.mean(); denom=np.linalg.norm(z)
    out=[]
    for mode,profile,scale in [('major',MAJOR,[0,2,4,5,7,9,11]),('minor',MINOR,[0,2,3,5,7,8,10])]:
        for tonic in range(12):
            p=np.roll(profile,tonic); p=p-p.mean(); corr=float(np.dot(z,p)/(denom*np.linalg.norm(p))) if denom>1e-10 else 0.
            do=(tonic+(3 if mode=='minor' else 0))%12
            out.append({'tonicPc':tonic,'tonicName':NAMES[tonic],'mode':mode,'doPc':do,'doName':NAMES[do],'score':round(corr,6),'scaleEnergy':round(float(c[[(tonic+i)%12 for i in scale]].sum()/max(c.sum(),1e-9)),6)})
    return sorted(out,key=lambda x:x['score'],reverse=True)

def analyze(folder, offset=0):
    import librosa
    folder=Path(folder); main=folder/'clip.wav'
    if not main.is_file(): raise ValueError('已有识别片段缺失，请打开已完成的工程')
    digest=hashlib.sha256()
    with main.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): digest.update(block)
    sources=[]
    files=[name for name in ['clip','vocals','other','bass'] if (folder/(name+'.wav')).is_file()]
    for idx,name in enumerate(files):
        progress(.05+.8*idx/len(files),'分析 '+name+' 的谐波音类与时间窗')
        y,q=mono_audio(folder/(name+'.wav'));sr=11025;hop=512
        if len(y)>sr*601: raise ValueError('调性分析最多十分钟')
        duration=len(y)/sr; peak=float(np.max(np.abs(y)))
        if peak<1e-5: sources.append({'source':name,'quality':q,'windows':[],'reason':'silent'});continue
        harmonic=librosa.effects.harmonic(y,hop_length=hop)
        tuning=float(librosa.estimate_tuning(y=harmonic[:sr*60],sr=sr,n_fft=4096))
        chroma=librosa.feature.chroma_cqt(y=harmonic,sr=sr,hop_length=hop,fmin=librosa.note_to_hz('C2'),n_octaves=6,tuning=tuning*3,bins_per_octave=36)
        energy=librosa.feature.rms(y=harmonic,hop_length=hop)[0]; size=min(len(energy),chroma.shape[1]);chroma=chroma[:,:size];energy=energy[:size]
        valid=(energy>=max(.0005,float(energy.max())*.025))&(chroma.sum(axis=0)>1e-7)
        normalized=chroma/np.maximum(chroma.sum(axis=0,keepdims=True),1e-9)
        windows=[]
        for start in np.arange(0,max(1,duration-5),6):
            a=round(start*sr/hop);b=min(size,round((start+12)*sr/hop));mask=valid[a:b]
            if mask.sum()*hop/sr<4:continue
            c=normalized[:,a:b][:,mask].mean(axis=1)
            windows.append({'start':round(offset+start,3),'end':round(offset+min(start+12,duration),3),'effectiveSeconds':round(float(mask.sum()*hop/sr),3),'chroma':[round(float(v),6) for v in c],'candidates':rank_candidates(c)})
        sources.append({'source':name,'quality':{**q,'effectiveSeconds':round(float(valid.sum()*hop/sr),3),'duration':round(duration,3),'tuningCents':round(tuning*100,2)},'windows':windows})
    # Stems are correlated with the original. They are auxiliary features, not majority votes.
    available=[s for s in sources if s['windows'] and s['source']!='bass']
    weights={'clip':.65,'vocals':.2,'other':.15}; scores=np.zeros(24); vectors=[]
    for s in available:
        c=np.mean([w['chroma'] for w in s['windows']],axis=0); vectors.append((weights[s['source']],c))
    if not vectors:
        return {'version':1,'method':ALGORITHM,'status':'unknown','timeBase':'original-audio-seconds','inputSha256':digest.hexdigest(),'sources':sources,'candidates':rank_candidates(np.zeros(12)),'doCandidates':[],'reason':'没有足够有效谐波证据','p2':{'intervals':None,'cadences':None,'chords':None,'segments':[]}}
    c=sum(w*c for w,c in vectors)/sum(w for w,c in vectors); ranked=rank_candidates(c)
    support=int(np.sum(c>=.055)); effective=next((s['quality']['effectiveSeconds'] for s in sources if s['source']=='clip'),0)
    valid=support>=3 and effective>=6
    do=[]
    for pc in range(12):
        options=[r for r in ranked if r['doPc']==pc];best=options[0];do.append({'doPc':pc,'doName':NAMES[pc],'score':best['score'],'tonalOptions':options})
    do.sort(key=lambda d:d['score'],reverse=True)
    original=next((s for s in sources if s['source']=='clip'),{})
    wins=[w['candidates'][0]['doPc'] for w in original.get('windows',[])];agreement=wins.count(do[0]['doPc'])/max(len(wins),1)
    progress(.98,'已形成24个调性候选；等待试听确认')
    return {'version':1,'method':ALGORITHM,'status':'suggested' if valid else 'unknown','timeBase':'original-audio-seconds','inputSha256':digest.hexdigest(),'parameters':{'sampleRate':11025,'hop':512,'windowSeconds':12,'stepSeconds':6,'sourceWeights':weights,'librosaVersion':librosa.__version__,'numpyVersion':np.__version__},'candidates':ranked,'doCandidates':do,'sources':sources,'quality':{'effectiveSeconds':effective,'supportedPitchClasses':support,'windowAgreement':round(agreement,3),'doScoreGap':round(do[0]['score']-do[1]['score'],6)},'tuningCents':original.get('quality',{}).get('tuningCents',0),'reason':'候选分数不是正确概率；需人工确认' if valid else '有效覆盖或音类种类不足，不能确认Do','p2':{'intervals':None,'cadences':None,'chords':None,'segments':[]}}

def measure(path,start,end,offset=0):
    import librosa
    if not np.isfinite(start) or not np.isfinite(end) or start<0 or end-start<.12 or end-start>3:raise ValueError('请选择0.12–3秒的稳定单音')
    if end>sf.info(path).duration+.01:raise ValueError('校准区间超过音轨长度')
    y,q=mono_audio(path,start,end,target=16000)
    f0,voiced,prob=librosa.pyin(y,fmin=65.4,fmax=1200,sr=16000,frame_length=2048,hop_length=256,fill_na=np.nan)
    good=voiced&np.isfinite(f0); coverage=float(good.mean())
    if not good.any():return {'reliable':False,'reason':'没有稳定基频，请选择元音较清楚的单音','start':start+offset,'end':end+offset}
    raw=librosa.hz_to_midi(f0[good]);weights=np.maximum(prob[good],.01);rounded=np.rint(raw).astype(int)
    bins={int(m):float(weights[rounded==m].sum()) for m in np.unique(rounded)};best=max(bins,key=bins.get);mask=rounded==best;med=float(np.median(raw[mask]));spread=float(np.median(np.abs(raw[mask]-med))*100);purity=bins[best]/sum(bins.values());mean_prob=float(np.mean(prob[good]));reliable=coverage>=.55 and purity>=.75 and spread<=30 and mean_prob>=.5 and mask.sum()>=5
    alternatives=sorted([{'midi':m,'note':str(librosa.midi_to_note(m)),'support':round(w/sum(bins.values()),3)} for m,w in bins.items()],key=lambda a:a['support'],reverse=True)[:4]
    return {'reliable':bool(reliable),'reason':'稳定音；请听参考音核对，再添加锚点' if reliable else '音高变化、低覆盖或置信度不足，请缩短/更换稳定区间','start':round(start+offset,4),'end':round(end+offset,4),'midi':round(med,3),'note':str(librosa.midi_to_note(best)),'cents':round((med-best)*100,2),'coverage':round(coverage,3),'purity':round(purity,3),'dispersionCents':round(spread,2),'meanProbability':round(mean_prob,3),'alternatives':alternatives,'quality':q}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--folder');p.add_argument('--file');p.add_argument('--start',type=float);p.add_argument('--end',type=float);p.add_argument('--offset',type=float,default=0);a=p.parse_args()
    try:
        value=measure(a.file,a.start,a.end,a.offset) if a.file else analyze(a.folder,a.offset)
        print(json.dumps({'result':value},ensure_ascii=False,allow_nan=False),flush=True)
    except Exception as e:
        print(str(e),file=sys.stderr);sys.exit(1)
