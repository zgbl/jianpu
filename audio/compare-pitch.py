"""Read-only cache replay. Output must be OUTSIDE the original run directory."""
import argparse
import hashlib
import json
from pathlib import Path
from importlib import import_module
import numpy as np


def synth(events, duration, sr=16000):
    audio=np.zeros(round(duration*sr))
    for event in events:
        a=max(0,round(event['start']*sr));b=min(len(audio),round(event['end']*sr))
        if b<=a:continue
        t=np.arange(b-a)/sr
        envelope=np.minimum(1,np.minimum(t/.01,(len(t)/sr-t)/.025))
        audio[a:b]+=.2*np.sin(2*np.pi*440*2**((event['midi']-69)/12)*t)*envelope
    return audio


def run(args):
    source=Path(args.cache).resolve();output=Path(args.output).resolve()
    if output==source.parent or source.parent in output.parents:
        raise ValueError('对照结果必须写在原工程/运行目录以外')
    data=json.loads(source.read_text());frames=data['frames']
    selected=[f for f in frames if args.start<=f['time']<args.end]
    if len(selected)<3:raise ValueError('范围内没有足够的音高缓存')
    step=float(np.median(np.diff([f['time'] for f in selected])))
    raw=np.array([f['midi'] if f['midi'] is not None else np.nan for f in selected])
    prob=np.array([f.get('voicingProbability',f.get('confidence',0)) for f in selected])
    voiced=np.array([f['voiced'] for f in selected]);energy=None;onsets=[]
    warnings=[]
    if args.vocals:
        import librosa
        mono,sr=librosa.load(args.vocals,sr=16000,offset=args.start,duration=args.end-args.start)
        rms=librosa.feature.rms(y=mono,frame_length=1024,hop_length=256)[0]
        energy=np.interp(np.arange(len(selected))*step,np.arange(len(rms))*.016,rms)
        onsets=librosa.onset.onset_detect(y=mono,sr=sr,hop_length=256,units='time')
    elif all('energy' in f for f in selected):energy=np.array([f['energy'] for f in selected])
    else:warnings.append('旧缓存缺少能量：不填补缺测、不推断同音重起音。')
    if not data.get('metadata'):warnings.append('旧缓存无检测元数据，原voiced可能已被硬掩码；此实验只比较解码，不证明基频测准。')
    f0=440*2**((raw-69)/12)
    old,_,od=import_module('pitch-segmentation').extract_events(f0,voiced,prob,step*16000,16000,onsets,energy)
    new,_,nd=import_module('stable-pitch').extract_events(f0,voiced,prob,step*16000,16000,onsets,energy)
    output.mkdir(parents=True,exist_ok=True)
    report={'sourceCacheSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
            'start':args.start,'end':args.end,'timeOrigin':'relative to selected cache start',
            'warnings':warnings,'baseline':{'notes':old,'diagnostics':od},'candidate':{'notes':new,'diagnostics':nd},
            'truthStatus':'not manually confirmed','accuracy':None,
            'manualTruthTemplate':[{'candidateStart':e['start']+args.start,'candidateEnd':e['end']+args.start,
                                   'candidateMidi':e['midi'],'confirmedMidi':None,'confirmedStart':None,'confirmedEnd':None} for e in new]}
    (output/'comparison.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    import soundfile as sf
    for name,events in [('v2',old),('v3',new)]:sf.write(output/(name+'.wav'),synth(events,args.end-args.start),16000)
    if args.vocals:sf.write(output/'vocals.wav',mono,16000)
    print(json.dumps({'v2Events':len(old),'v3Events':len(new),'uncertain':nd['uncertainEvents'],
                      'v2Midi':[e['midi'] for e in old],'v3Midi':[e['midi'] for e in new],
                      'warnings':warnings,'accuracy':None},ensure_ascii=False))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--cache',required=True);p.add_argument('--vocals');p.add_argument('--output',required=True)
    p.add_argument('--start',type=float,default=10);p.add_argument('--end',type=float,default=20)
    args=p.parse_args()
    if not 0<=args.start<args.end:p.error('时间范围不合法')
    run(args)
