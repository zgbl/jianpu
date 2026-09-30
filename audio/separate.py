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

def separate(source,destination):
    torch.set_num_threads(min(4, os.cpu_count() or 2))
    mix,sr=sf.read(source,dtype='float32',always_2d=True)
    model=get_model('htdemucs').cpu().eval()
    audio=torch.from_numpy(mix.T.copy())
    reference=audio.mean(0);mean,std=reference.mean(),reference.std().clamp(min=1e-8)
    with torch.inference_mode():
        stems=apply_model(model,((audio-mean)/std)[None],device='cpu',shifts=0,split=True,overlap=.25,progress=False,num_workers=0)[0]
    vocal=(stems[model.sources.index('vocals')]*std).numpy().T
    peak=float(np.max(np.abs(vocal)))
    sf.write(destination,vocal/max(1,peak),sr,subtype='PCM_16')

if __name__=='__main__':
    separate(sys.argv[1],sys.argv[2])
