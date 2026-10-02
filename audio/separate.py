"""Keep the PyTorch separation runtime isolated from the pitch/tempo runtime."""
import os
import sys
from pathlib import Path
import certifi
os.environ.setdefault('SSL_CERT_FILE',certifi.where())
os.environ.setdefault('TORCH_HOME',str(Path(__file__).resolve().parent.parent / '.cache/torch'))
import numpy as np
import soundfile as sf
import torch
from demucs.pretrained import get_model
from demucs.apply import apply_model

def separate(source,destination,model_name='htdemucs'):
    if model_name not in ('htdemucs', 'htdemucs_6s'):
        raise ValueError('不支持的声部分离模型')
    torch.set_num_threads(min(4, os.cpu_count() or 2))
    mix,sr=sf.read(source,dtype='float32',always_2d=True)
    model=get_model(model_name).cpu().eval()
    audio=torch.from_numpy(mix.T.copy())
    reference=audio.mean(0);mean,std=reference.mean(),reference.std().clamp(min=1e-8)
    with torch.inference_mode():
        stems=apply_model(model,((audio-mean)/std)[None],device='cpu',shifts=0,split=True,overlap=.25,progress=False,num_workers=0)[0]
    # A common gain preserves the relative levels across stems. Never normalize each stem independently.
    restored=(stems*std).numpy()
    gain=max(1,float(np.max(np.abs(restored))))
    folder=Path(destination).parent
    for index,name in enumerate(model.sources):
        target=Path(destination) if name=='vocals' else folder / (name+'.wav')
        sf.write(target,restored[index].T/gain,sr,subtype='PCM_16')
    import json
    (folder / 'stems.json').write_text(json.dumps({'model':model_name,'sources':list(model.sources),'sampleRate':sr,'gain':gain}),encoding='utf8')

if __name__=='__main__':
    separate(sys.argv[1],sys.argv[2],sys.argv[3] if len(sys.argv)>3 else 'htdemucs')
