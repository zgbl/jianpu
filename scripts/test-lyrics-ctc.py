import importlib.util
from pathlib import Path
import numpy as np
spec=importlib.util.spec_from_file_location('alignment',Path(__file__).resolve().parents[1]/'audio/lyrics-align.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
# Repeated tokens require an intervening blank, not a single sustained glyph.
x=np.full((9,3),-12.0)
for i,t in enumerate([0,1,1,0,1,1,0,2,0]):x[i,t]=-.01
r=m.ctc_align(x,[1,1,2],0)
assert r is not None and r[0][1]<=r[1][0] and r[1][1]<=r[2][0],r
assert m.ctc_align(x[:1],[1,1,2],0) is None
print('CTC repeated characters and insufficient frames: passed')
