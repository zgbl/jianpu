"""Experimental continuous-pitch core decoder. No key or scale is consulted.

Voicing probabilities are evidence of speech, NOT pitch correctness. Configuration
is deliberately exposed for calibration; these defaults are not measured accuracy.
"""
import numpy as np
from importlib import import_module

VERSION = 'vocal-notes-v3'
DEFAULTS = dict(shortCoreWindow=.048, coreWindow=.080, vibratoWindow=.208, coreSpread=.32,
                coreDrift=.22, coreTolerance=.45, minCore=.048,
                seedVoicing=.65, continuationVoicing=.35, missingGap=.096,
                mergePenalty=.7, repeatDip=.65)
runs = import_module('pitch-segmentation').runs


def median(values, weights=None):
    values = np.asarray(values)
    if weights is None:
        return float(np.median(values))
    order = np.argsort(values)
    weights = np.asarray(weights)[order]
    return float(values[order][np.searchsorted(np.cumsum(weights), weights.sum()/2)])


def extract_events(f0, voiced, voicing_probability, hop, sr, onset_times=(), energy=None, config=None):
    cfg = {**DEFAULTS, **(config or {})}
    step = hop / sr
    f0 = np.asarray(f0, float)
    prob = np.nan_to_num(np.asarray(voicing_probability, float))
    raw = np.full(len(f0), np.nan)
    finite = np.isfinite(f0) & (f0 > 0)
    raw[finite] = 69 + 12*np.log2(f0[finite]/440)
    valid = finite & (prob >= cfg['continuationVoicing'])
    energy = np.asarray(energy, float) if energy is not None else None
    if energy is not None:
        valid &= energy[:len(f0)] >= max(.0008, float(np.max(energy))*.025)
    # Missing periodic observations are bridged ONLY with sustained energy and
    # compatible endpoints. Keep their pitch missing: never fabricate a curve.
    connected = valid.copy()
    filled = 0
    for a, b, yes in runs(valid):
        if yes or a == 0 or b == len(raw) or (b-a)*step > cfg['missingGap']:
            continue
        if energy is not None and abs(raw[a-1]-raw[b]) < .5 and np.min(energy[a:b]) >= .45*min(energy[a-1], energy[b]):
            connected[a:b] = True
            filled += 1
    labels = np.zeros(len(raw), int)  # display only; never feeds segmentation
    events, all_cores = [], []
    onsets = sorted(set(int(round(t/step)) for t in onset_times))
    for a, b, yes in runs(connected):
        if not yes or not np.any(prob[a:b][valid[a:b]] >= cfg['seedVoicing']):
            continue
        stable = np.zeros(b-a, bool)
        trend = raw.copy()
        oscillating = np.zeros(len(raw), bool)
        for i in range(a, b):
            if not valid[i]:
                continue
            for seconds in (cfg['vibratoWindow'], cfg['coreWindow'], cfg['shortCoreWindow']):
                radius = max(1, int(seconds/step/2))
                left, right = max(a, i-radius), min(b, i+radius+1)
                indices = np.flatnonzero(valid[left:right])+left
                if len(indices) < 3 or len(indices)/(right-left) < .7:
                    continue
                x = raw[indices]
                third = max(1, len(x)//3)
                drift = abs(median(x[:third])-median(x[-third:]))
                spread = float(np.quantile(x, .75)-np.quantile(x, .25))
                # Longer context is permitted for oscillation, not for a
                # monotonic slide that happens to pass near a semitone.
                delta = np.diff(x)
                significant = delta[np.abs(delta) > .025]
                reversals = np.sum(significant[1:]*significant[:-1] < 0)
                vibrato = seconds == cfg['vibratoWindow'] and reversals >= 2 and spread < 1.25
                if drift <= cfg['coreDrift'] and (spread <= cfg['coreSpread'] or vibrato):
                    stable[i-a] = True
                    if vibrato:
                        trend[i] = float(np.mean(x))
                        oscillating[i] = True
                    break
        for i in range(a,b):
            if stable[i-a] or not valid[i]:
                continue
            nearby = np.flatnonzero(oscillating[max(a,i-6):min(b,i+7)])+max(a,i-6)
            if len(nearby) and abs(raw[i]-median(trend[nearby])) < .9:
                stable[i-a] = True
                trend[i] = median(trend[nearby])
        # Stable frame groups may contain two nearby centers: split on FLOAT
        # evidence, before MIDI rounding, and keep real semitone steps.
        cores = []
        for left, right, good in runs(stable):
            if not good:
                continue
            start = a+left
            for i in range(start+1, a+right+1):
                split = i == a+right or abs(trend[i]-median(trend[start:i])) > cfg['coreTolerance']
                if split:
                    if (i-start)*step >= cfg['minCore'] and np.any(prob[start:i] >= cfg['seedVoicing']):
                        center = median(trend[start:i], prob[start:i])
                        cores.append(dict(a=start, b=i, center=center))
                    start = i
        # Group stable cores with DP. A merge pays pitch residual in cents;
        # adding an event has a penalty. Never merge across an independent
        # semitone core, and do not give large jumps special permission to merge.
        n = len(cores)
        costs, previous = [0]+[float('inf')]*n, [0]*(n+1)
        for end in range(1, n+1):
            for start in range(end-1, max(-1, end-24), -1):
                group = cores[start:end]
                centers = [c['center'] for c in group]
                if max(centers)-min(centers) > cfg['coreTolerance']:
                    break
                weights = [c['b']-c['a'] for c in group]
                center = median(centers, weights)
                residual = sum(w*(p-center)**2 for p,w in zip(centers,weights))/sum(weights)
                cost = costs[start] + cfg['mergePenalty'] + residual*8
                if cost < costs[end]:
                    costs[end], previous[end] = cost, start
        groups, end = [], n
        while end:
            start = previous[end]
            group = cores[start:end]
            groups.append(dict(a=group[0]['a'], b=group[-1]['b'],
                               center=median([c['center'] for c in group], [c['b']-c['a'] for c in group]), cores=group))
            end = start
        groups.reverse()
        if not groups:
            # A continuous glide with no stable center remains ONE uncertain
            # event, not a ladder of integer pitches. No endpoint truth claim.
            indices = np.flatnonzero(valid[a:b])+a
            groups = [dict(a=a, b=b, center=median(raw[indices], prob[indices]), cores=[])]
        boundaries = [a]
        for left, right in zip(groups, groups[1:]):
            cut = left['b']
            for k in range(left['b'], right['a']):
                if valid[k] and abs(raw[k]-left['center']) > cfg['coreTolerance']:
                    cut = k
                    break
            boundaries.append(cut)
        boundaries.append(b)
        for group, left, right in zip(groups, boundaries, boundaries[1:]):
            cuts = [left]
            # Repeat notes need an acoustic reattack; onset by itself is weak.
            for k in onsets:
                if k-cuts[-1] < round(.12/step) or right-k < round(.09/step) or energy is None:
                    continue
                before, after = energy[max(left,k-round(.09/step)):k], energy[k:min(right,k+round(.08/step))]
                if len(before) and len(after) and np.min(before) < cfg['repeatDip']*np.max(after):
                    cuts.append(k)
            cuts.append(right)
            for begin, finish in zip(cuts, cuts[1:]):
                evidence = [c for c in group['cores'] if c['a'] < finish and c['b'] > begin]
                indices = np.concatenate([np.arange(max(begin,c['a']),min(finish,c['b'])) for c in evidence]) if evidence else np.flatnonzero(valid[begin:finish])+begin
                center = median(raw[indices], prob[indices])
                target = int(np.floor(center+.5))  # ONLY now quantize target
                core_start = max(begin, evidence[0]['a']) if evidence else None
                core_end = min(finish, evidence[-1]['b']) if evidence else None
                dispersion = median(np.abs(raw[indices]-center))*100
                uncertain = not evidence or abs(center-target) > .35 or dispersion > 35
                ornaments = []
                if core_start is not None and core_start > begin and np.any(np.abs(raw[begin:core_start]-center) > .6):
                    ornaments.append(dict(type='scoop',start=round(begin*step,4),end=round(core_start*step,4)))
                if core_end is not None and finish > core_end and np.any(np.abs(raw[core_end:finish]-center) > .6):
                    ornaments.append(dict(type='fall',start=round(core_end*step,4),end=round(finish*step,4)))
                event = dict(start=round(begin*step,4),end=round(finish*step,4),midi=target,
                             performanceStart=round(begin*step,4),performanceEnd=round(finish*step,4),
                             coreStart=round(core_start*step,4) if core_start is not None else None,
                             coreEnd=round(core_end*step,4) if core_end is not None else None,
                             pitchCenterMidi=round(center,4), pitchStatus='uncertain' if uncertain else 'candidate',
                             boundaryStatus='candidate',voicingProbability=round(float(np.mean(prob[indices])),3),
                             pitchReliability=None,sourceReliability=None,periodicity=None,
                             confidence=0 if uncertain else round(float(np.mean(prob[indices])),3),
                             confidenceMeaning='legacy display score; not pitch correctness probability',
                             centsDeviation=round(abs(center-target)*100,1),coreDispersionCents=round(dispersion,1),
                             evidenceFrameRange=[begin,finish],ornaments=ornaments,algorithmVersion=VERSION)
                events.append(event)
                labels[begin:finish] = target
        all_cores.extend(dict(start=round(c['a']*step,4),end=round(c['b']*step,4),pitchCenterMidi=round(c['center'],4)) for c in cores)
    return events, labels, dict(version=VERSION,config=cfg,cores=all_cores,filledDropouts=filled,
                               uncertainEvents=sum(e['pitchStatus']=='uncertain' for e in events),
                               confidenceMeaning='voicingProbability is not pitch correctness probability',
                               secondaryDetector=None,tuningCents=None)
