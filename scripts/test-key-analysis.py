"""Synthetic audio checks, not an assertion of real-song ground truth."""
import sys,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'audio'))
import numpy as np, soundfile as sf
from key_analysis import analyze,measure,rank_candidates
profile=np.array([6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88])
for shift in range(12):
 r=rank_candidates(np.roll(profile,shift));assert r[0]['doPc']==shift and r[0]['mode']=='major'
assert next(c for c in rank_candidates(profile) if c['mode']=='minor' and c['tonicPc']==9)['doPc']==0
with tempfile.TemporaryDirectory() as d:
 p=Path(d);sr=16000;t=np.arange(sr*2)/sr;y=.2*np.sin(2*np.pi*440*t)
 sf.write(p/'tone.wav',y,sr);m=measure(p/'tone.wav',.2,1.5);assert m['reliable'] and abs(m['midi']-69)<.1,m
 sf.write(p/'silent.wav',np.zeros(sr*2),sr);assert not measure(p/'silent.wav',.2,1.5)['reliable']
 sf.write(p/'anti.wav',np.stack([y,-y],axis=1),sr);m=measure(p/'anti.wav',.2,1.5);assert m['reliable'] and m['quality']['channel'].startswith('channel-'),m
 # Transpose actual synthesized scale audio, then rerun CQT. Keep duration/profile identical.
 winners=[]
 for shift in range(12):
  chunks=[]
  for midi,seconds in [(60,2),(64,1),(67,1),(65,.6),(71,.6),(72,2),(62,.6),(69,.6),(67,1),(60,2)]:
   tt=np.arange(int(sr*seconds))/sr;f=440*2**((midi+shift-69)/12);chunks.append(.2*(np.sin(2*np.pi*f*tt)+.3*np.sin(4*np.pi*f*tt)))
  sf.write(p/'clip.wav',np.concatenate(chunks),sr);a=analyze(p);winners.append(a['doCandidates'][0]['doPc']);assert a['status']!='confirmed'
 assert winners==list(range(12)),winners
print('PASS: 12 real-audio transpositions, 24 candidates, relation-minor mapping, stable tone, silence, anti-phase stereo')
