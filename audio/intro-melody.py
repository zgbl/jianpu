"""Instrumental lead candidate tracking; does not transcribe all accompaniment."""
import argparse,json,sys
from pathlib import Path
import numpy as np

def track(pitches,magnitudes):
    paths=[];scores=[];backs=[]
    for f in range(pitches.shape[1]):
        ids=np.argsort(magnitudes[:,f])[-8:];ids=ids[(pitches[ids,f]>130)&(magnitudes[ids,f]>0)]
        if not len(ids): ids=np.array([0])
        hz=pitches[ids,f];midi=np.where(hz>0,69+12*np.log2(np.maximum(hz,1)/440),0)
        strength=magnitudes[ids,f];local=np.log(np.maximum(strength,1e-10));local-=local.max()
        if paths:
            prev=paths[-1];cost=scores[-1][:,None]-.16*np.minimum(np.abs(prev[:,None]-midi[None,:]),24)
            best=cost.argmax(0);scores.append(local+cost[best,np.arange(len(ids))]);backs.append(best)
        else:scores.append(local);backs.append(np.zeros(len(ids),int))
        paths.append(midi)
    selected=np.zeros(len(paths));j=int(scores[-1].argmax())
    for f in range(len(paths)-1,-1,-1):selected[f]=paths[f][j];j=int(backs[f][j])
    return selected

def main(a):
    import librosa
    from scipy.ndimage import median_filter
    from transcribe import pitch_events
    print(json.dumps({'message':'分析器乐连续旋律候选','progress':.1}),flush=True)
    y,sr=librosa.load(a.input,sr=16000,mono=True,offset=a.start,duration=a.end-a.start)
    if len(y)<sr*.2:raise ValueError('前奏范围太短')
    hop=256;p,m=librosa.piptrack(y=y,sr=sr,n_fft=2048,hop_length=hop,fmin=130,fmax=1500,threshold=.15)
    midi=median_filter(track(p,m),size=5);rms=librosa.feature.rms(y=y,hop_length=hop)[0][:len(midi)]
    voiced=(midi>0)&(rms>max(.001,float(rms.max())*.06));confidence=np.where(voiced,.75,0)
    f0=440*2**((midi-69)/12);onsets=librosa.onset.onset_detect(y=y,sr=sr,hop_length=hop,units='time')
    events=pitch_events(f0,voiced,confidence,hop,sr,onsets)
    for e in events:e['end']=min(e['end'],a.end-a.start)
    events=[e for e in events if e['end']>e['start']]
    for e in events:e.update(start=round(e['start']+a.start,4),end=round(e['end']+a.start,4),voice='intro',sourceEventId=f"intro-{a.source}-{e['start']+a.start:.4f}")
    Path(a.output).write_text(json.dumps(dict(version=1,source=a.source,start=a.start,end=a.end,notes=events,warnings=['器乐主旋律为连续频谱候选；多音和弦及串音可能误识别，请对比 MIDI。']),ensure_ascii=False))
    print(json.dumps({'message':'前奏候选已生成','progress':1}),flush=True)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--input');p.add_argument('--output');p.add_argument('--start',type=float);p.add_argument('--end',type=float);p.add_argument('--source');a=p.parse_args()
    try:main(a)
    except Exception as e:print(json.dumps({'message':str(e),'progress':0}),flush=True);sys.exit(1)
