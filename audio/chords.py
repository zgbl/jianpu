"""Local accompaniment chord candidates. No downloads, no source separation."""
import argparse,json
from pathlib import Path
import numpy as np
from key_analysis import mono_audio,progress
NAMES=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B']
def analyze(input_path,windows):
 import librosa
 folder=Path(input_path).parent;sr=11025;hop=512
 path=next((folder/(n+'.wav') for n in ['guitar','other','clip'] if (folder/(n+'.wav')).exists()),Path(input_path))
 progress(.05,'读取已有伴奏声部：'+path.stem)
 y,_=mono_audio(path);h=librosa.effects.harmonic(y,hop_length=hop)
 tuning=librosa.estimate_tuning(y=h[:sr*60],sr=sr,n_fft=4096)
 c=librosa.feature.chroma_cqt(y=h,sr=sr,hop_length=hop,tuning=tuning*3,bins_per_octave=36,n_octaves=6,fmin=librosa.note_to_hz('C2'))
 bass=None
 if (folder/'bass.wav').exists():
  progress(.4,'分析贝斯根音证据')
  by,_=mono_audio(folder/'bass.wav');bass=librosa.feature.chroma_cqt(y=by,sr=sr,hop_length=hop,n_octaves=3,fmin=librosa.note_to_hz('C1'))
 templates=[];labels=[]
 for root in range(12):
  for suffix,intervals in [('',[0,4,7]),('m',[0,3,7]),('7',[0,4,7,10]),('maj7',[0,4,7,11]),('m7',[0,3,7,10])]:
   t=np.full(12,-.18);t[[(root+i)%12 for i in intervals]]=1.;t/=np.linalg.norm(t);templates.append(t);labels.append(NAMES[root]+suffix)
 templates=np.array(templates);emissions=[];energies=[]
 for w in windows:
  a=max(0,int(w['start']*sr/hop));b=min(c.shape[1],max(a+1,int(w['end']*sr/hop)))
  v=np.mean(c[:,a:b],axis=1) if b>a else np.zeros(12);energies.append(float(np.max(np.abs(h[max(0,int(w['start']*sr)):min(len(h),int(w['end']*sr))]),initial=0)))
  if b>a:
   head=c[:,a:min(b,a+max(1,int((b-a)*.2)))].mean(axis=1);v=.7*v+.3*head
  v/=max(np.linalg.norm(v),1e-9);scores=templates@v
  if bass is not None and a<bass.shape[1]:
   bv=bass[:,a:min(b,bass.shape[1])].mean(axis=1);bv/=max(float(bv.max()),1e-9)
   scores+=.08*np.repeat(bv,5)
  emissions.append(scores)
 progress(.8,'平滑和弦候选并对应小节')
 e=np.array(emissions);dp=e[0].copy();back=[]
 for row in e[1:]:
  choices=dp[:,None]-.12*(1-np.eye(len(labels)));idx=choices.argmax(axis=0);back.append(idx);dp=choices[idx,np.arange(len(labels))]+row
 ids=[int(dp.argmax())]
 for idx in reversed(back):ids.append(int(idx[ids[-1]]))
 ids.reverse();out=[]
 for i,(w,k) in enumerate(zip(windows,ids)):
  alternatives=sorted(range(len(labels)),key=lambda j:e[i,j],reverse=True)[:60]
  out.append({**w,'label':labels[k] if energies[i]>.002 else '','score':round(float(e[i,k]),3),'candidates':[{'label':labels[j],'score':round(float(e[i,j]),3)} for j in alternatives],'source':'automatic'})
 return {'version':2,'windowsPerMeasure':2,'method':'harmonic-head-bass-cqt-v2','audioSource':path.stem,'timeBase':'clip-seconds','chords':out,'warning':'和弦为伴奏谐波候选，复杂和弦、转位与编配变化需试听核对；字母为实际音高，未转换Capo指型。'}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);p.add_argument('--windows',required=True);a=p.parse_args()
 w=json.loads(Path(a.windows).read_text());Path(a.output).write_text(json.dumps(analyze(a.input,w),ensure_ascii=False));progress(1,'和弦分析完成')
