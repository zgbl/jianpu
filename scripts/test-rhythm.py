"""Deterministic beat tests with known audio ground truth, no network/model."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'audio'))
import numpy as np
from rhythm import analyze
sr = 11025
for bpm in [79, 96, 120]:
    duration = 32
    y = np.zeros(sr * duration)
    expected = np.arange(.2, duration - .1, 60 / bpm)
    for i, t in enumerate(expected):
        count = min(round(.09 * sr), len(y) - round(t * sr))
        tone = np.sin(2 * np.pi * (90 if i % 2 == 0 else 180) * np.arange(count) / sr)
        tone *= np.exp(-np.arange(count) / (sr * .015)) * (1 if i % 4 == 0 else .7)
        y[round(t * sr):round(t * sr) + count] += tone
    r = analyze(y, sr, 'synthetic drums')
    assert abs(r['estimatedBpm'] - bpm) < 1, (bpm, r)
    detected = np.asarray(r['beatTimes'])
    errors = np.asarray([np.min(np.abs(detected - t)) for t in expected[1:-1]])
    assert np.percentile(errors, 95) < .06, (bpm, errors)
    assert not r['downbeatConfirmed']
    print(f'PASS: {bpm} BPM -> {r["estimatedBpm"]}, p95 beat error {np.percentile(errors, 95):.3f}s')
r = analyze(np.zeros(sr * 8), sr)
assert r['beatTimes'] == [] and r['confidence'] == 0
print('PASS: silence has no fabricated beat grid')
from rhythm import stable_grid
rng = np.random.default_rng(7)
period = 60 / 79
raw = 1.2 + np.arange(320)*period + rng.normal(0,.02,320)
raw[110:115] += .16  # drum fill should not reset the song's clock
r = {'beatTimes':raw.tolist(),'estimatedBpm':79,'downbeatPhaseScores':[2,1,1.6,1]}
s = stable_grid(r)
assert s['fitMeasures'] == 20
assert abs(s['barDuration']-period*4)<.001
assert abs(s['period']-period)*320 < .06
assert not s['bassUsed']
print('PASS: fixed 20-bar average rejects fill jitter, projects through 320 beats without cumulative local jitter')
bass_step=.01
bass=np.zeros(26000)
for k,t in enumerate(raw):
    frame=round(t/bass_step)
    if frame<len(bass):bass[frame]=5 if k%4==2 else .05
supported=stable_grid(r,bass,bass_step)
assert supported['bassUsed']
assert supported['downbeatPhaseScores'][2]>supported['downbeatPhaseScores'][0]
print('PASS: bass accent evidence changes bar phase without changing beat period')
