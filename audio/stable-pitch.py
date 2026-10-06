"""Experimental continuous-pitch core decoder. No key or scale is consulted.

Voicing probabilities are evidence of speech, NOT pitch correctness. Configuration
is deliberately exposed for calibration; these defaults are not measured accuracy.
"""
import numpy as np
from importlib import import_module

VERSION = 'vocal-notes-v3.6'
DEFAULTS = dict(shortCoreWindow=.048, coreWindow=.080, vibratoWindow=.208, coreSpread=.32,
                coreDrift=.22, coreTolerance=.45, minCore=.048,
                seedVoicing=.65, continuationVoicing=.35, missingGap=.096,
                mergePenalty=.7, repeatDip=.65, estimateTuning=True,
                tuningMinFrames=60, tuningMinNotes=5, tuningMinConcentration=.65,
                tuningMaxCents=35, recoverLowConfidence=True, recoveryVoicing=.01,
                recoveryMinDuration=.16, recoveryMinCore=.12,
                transitionMaxCore=.10, transitionMaxGap=.096,
                transitionMaxStep=.45, onsetRecoveryLookback=.8)
runs = import_module('pitch-segmentation').runs


def median(values, weights=None):
    values = np.asarray(values)
    if weights is None:
        return float(np.median(values))
    order = np.argsort(values)
    weights = np.asarray(weights)[order]
    return float(values[order][np.searchsorted(np.cumsum(weights), weights.sum()/2)])


def transition_cores(cores, raw, valid, step, cfg, onsets, energy):
    """Keep short discrete notes; absorb brief plateaus inside smooth scoops.

    A short duration alone is never sufficient. Require a longer destination,
    continuous observed pitch, predominantly one-way motion, and no reattack
    between the plateau and destination. No key/scale or MIDI rounding is used.
    """
    kept, removed = [], []
    for i, core in enumerate(cores):
        following = cores[i+1] if i+1 < len(cores) else None
        if (following is None or (core['b']-core['a'])*step > cfg['transitionMaxCore']+1e-8
                or (following['b']-following['a'])*step < .112-1e-8
                or (following['a']-core['b'])*step > cfg['transitionMaxGap']+1e-8):
            kept.append(core)
            continue
        path = raw[core['a']:following['a']+1]
        good = valid[core['a']:following['a']+1]
        direction = np.sign(following['center']-core['center'])
        delta = np.diff(path)
        smooth = (direction != 0 and .6 <= abs(following['center']-core['center']) <= 2.5
                  and np.all(good) and np.all(np.isfinite(path))
                  and np.max(np.abs(delta), initial=0) <= cfg['transitionMaxStep']
                  and np.sum(np.maximum(0, -direction*delta)) <= .25
                  and direction*(path[-1]-path[0]) >= .6)
        reattack = False
        if smooth and energy is not None:
            for k in onsets:
                if not core['b'] <= k <= following['a']:
                    continue
                before = energy[max(core['a'], k-round(.09/step)):k]
                after = energy[k:min(following['b'], k+round(.08/step))]
                if len(before) and len(after) and np.min(before) < cfg['repeatDip']*np.max(after):
                    reattack = True
                    break
        if smooth and not reattack:
            removed.append(dict(start=round(core['a']*step,4), end=round(core['b']*step,4),
                                pitchCenterMidi=round(core['center'],4), reason='short-smooth-transition'))
        else:
            kept.append(core)
    return kept, removed


def absorb_noise_fragments(events, step, cfg, onsets, energy):
    """Extend dominant performance ranges without contaminating their cores.

    Only brief uncertain events lacking a well-centered stable pitch qualify.
    A discrete short note, a new acoustic attack, silence, and a source-gated
    boundary are not evidence of noise and are never absorbed by this pass.
    """
    events = sorted(events, key=lambda e:e['start'])
    absorbed = []
    for fragment in list(events):
        if fragment['end']-fragment['start'] > .12+1e-8 or fragment['pitchStatus'] != 'uncertain':
            continue
        # An off-center but stable short note still has independent evidence.
        if fragment['coreStart'] is not None:
            continue
        index = events.index(fragment)
        neighbors = [(events[j], j) for j in (index-1,index+1) if 0 <= j < len(events)]
        choices = []
        for main, j in neighbors:
            if main['pitchStatus'] != 'candidate' or main['coreStart'] is None or main['coreEnd']-main['coreStart'] < .16:
                continue
            left,right = (main,fragment) if j < index else (fragment,main)
            gap = right['start']-left['end']
            if gap < -step/2 or gap > step/2+1e-8 or energy is None:
                continue
            a=max(0,int(round((left['end']-.032)/step)))
            b=min(len(energy),int(round((right['start']+.032)/step))+1)
            floor=max(.0008,float(np.max(energy))*.025)
            if b<=a or np.min(energy[a:b]) < floor:
                continue
            reattack=False
            for k in onsets:
                if not left['end']-.032 <= k*step <= right['start']+.032:
                    continue
                before=energy[max(0,k-round(.09/step)):k]
                after=energy[k:min(len(energy),k+round(.08/step))]
                if len(before) and len(after) and np.min(before) < cfg['repeatDip']*np.max(after):
                    reattack=True
                    break
            if not reattack:
                choices.append((abs(fragment['pitchCenterMidi']-main['pitchCenterMidi']),main))
        if not choices:
            continue
        _,main=min(choices,key=lambda pair:pair[0])
        record=dict(start=fragment['start'],end=fragment['end'],pitchCenterMidi=fragment['pitchCenterMidi'],
                    reason='brief-coreless-noise',destinationMidi=main['midi'])
        main.setdefault('absorbedFragments',[]).append(record)
        main['start']=main['performanceStart']=min(main['start'],fragment['start'])
        main['end']=main['performanceEnd']=max(main['end'],fragment['end'])
        main['evidenceFrameRange']=[min(main['evidenceFrameRange'][0],fragment['evidenceFrameRange'][0]),
                                    max(main['evidenceFrameRange'][1],fragment['evidenceFrameRange'][1])]
        events.remove(fragment)
        absorbed.append(record)
    return events,absorbed


def contextual_pitch_targets(events):
    """A narrow alternative for uncertain, flat melodic peaks.

    A peak near a rounding boundary followed by a distinct lower core must
    not automatically collapse into a repeated integer note. This is a
    contour-based proposal, not new acoustic evidence or a confident truth.
    """
    proposals=[]
    for left,event,right in zip(events,events[1:],events[2:]):
        center=event['pitchCenterMidi']
        if (event['pitchStatus']!='uncertain' or event['coreStart'] is None
                or event['coreEnd']-event['coreStart'] < .096-1e-8
                or event.get('coreDispersionCents',100)>15
                or event['voicingProbability']<.65
                or left['pitchStatus']!='candidate' or right['pitchStatus']!='candidate'
                or right['start']-event['end']>.3 or event['start']-left['end']>.15):
            continue
        offset=center-event['midi']
        if not (.35<=offset<.5 and event['midi']==right['midi']
                and center-left['pitchCenterMidi']>=1.5
                and .28<=center-right['pitchCenterMidi']<=.8):
            continue
        original=event['midi'];event['midi']=original+1
        event['acousticNearestMidi']=original
        event['pitchAlternatives']=[original,original+1]
        event['targetReason']='uncertain-flat-peak-contour'
        event['reviewRequired']=True;event['reviewReason']='contextual-pitch-target'
        event['confidence']=0
        event['centsDeviation']=round(abs(center-event['midi'])*100,1)
        proposals.append(dict(start=event['start'],end=event['end'],fromMidi=original,
                              proposedMidi=event['midi'],pitchCenterMidi=center,
                              reason=event['targetReason']))
    return proposals


def estimate_tuning(raw, valid, voiced, prob, step, cfg):
    """Estimate a small global cents offset from reliable, locally stable frames.

    Sampling is thinned to roughly 80 ms so heavily overlapping pYIN frames do
    not dominate the circular mean. This is deliberately conservative: one
    sustained note cannot establish the tuning reference.
    """
    empty = dict(applied=False, cents=0.0, concentration=0.0, sampleCount=0,
                 distinctNotes=0, reason='disabled' if not cfg['estimateTuning'] else 'insufficient-evidence')
    if not cfg['estimateTuning']:
        return 0.0, empty
    stride = max(1, round(.080 / step))
    stable = []
    radius = max(1, round(.080 / step / 2))
    for i in range(radius, len(raw)-radius, stride):
        left, right = i-radius, i+radius+1
        ix = np.flatnonzero(valid[left:right] & voiced[left:right] & (prob[left:right] >= cfg['seedVoicing'])) + left
        if len(ix) < max(3, round((right-left)*.7)):
            continue
        values = raw[ix]
        if np.quantile(values, .75)-np.quantile(values, .25) > .25:
            continue
        stable.append(float(np.median(values)))
    if len(stable) < cfg['tuningMinFrames']:
        empty.update(sampleCount=len(stable))
        return 0.0, empty
    stable = np.asarray(stable)
    distinct = len(np.unique(np.floor(stable + .5).astype(int)))
    phases = np.exp(2j*np.pi*stable)
    resultant = np.mean(phases)
    concentration = float(abs(resultant))
    cents = float(np.angle(resultant) / (2*np.pi) * 100)
    if distinct < cfg['tuningMinNotes']:
        empty.update(sampleCount=len(stable), distinctNotes=distinct, concentration=round(concentration, 3), reason='too-few-distinct-notes')
        return 0.0, empty
    if concentration < cfg['tuningMinConcentration']:
        empty.update(sampleCount=len(stable), distinctNotes=distinct, concentration=round(concentration, 3), reason='diffuse-offsets')
        return 0.0, empty
    if abs(cents) > cfg['tuningMaxCents']:
        empty.update(sampleCount=len(stable), distinctNotes=distinct, concentration=round(concentration, 3), reason='offset-out-of-safe-range')
        return 0.0, empty
    result = dict(applied=True, cents=round(cents, 1), concentration=round(concentration, 3),
                  sampleCount=len(stable), distinctNotes=distinct, reason='reliable-consensus')
    return cents / 100, result


def extract_events(f0, voiced, voicing_probability, hop, sr, onset_times=(), energy=None, config=None):
    cfg = {**DEFAULTS, **(config or {})}
    step = hop / sr
    f0 = np.asarray(f0, float)
    prob = np.nan_to_num(np.asarray(voicing_probability, float))
    raw = np.full(len(f0), np.nan)
    finite = np.isfinite(f0) & (f0 > 0)
    raw[finite] = 69 + 12*np.log2(f0[finite]/440)
    voiced = np.asarray(voiced, bool)[:len(f0)]
    valid = finite & voiced & (prob >= cfg['continuationVoicing'])
    energy = np.asarray(energy, float) if energy is not None else None
    if energy is not None:
        valid &= energy[:len(f0)] >= max(.0008, float(np.max(energy))*.025)
    tuning, tuning_diagnostics = estimate_tuning(raw, valid, voiced, prob, step, cfg)
    # Keep observations untouched; the corrected copy is used only for core
    # stability, grouping and final semitone selection.
    raw[finite] -= tuning
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
    events, all_cores, transitions = [], [], []
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
        cores, removed = transition_cores(cores, raw, valid, step, cfg, onsets, energy)
        transitions.extend(removed)
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
    recovered = []
    if cfg['recoverLowConfidence'] and events and energy is not None:
        # A second, explicitly uncertain lane. Never reinterpret unvoiced
        # guesses, silent frames, or source-gated (prob=0) frames.
        # The strict lane and its tuning estimate remain untouched.
        uncovered = finite & voiced & (prob >= cfg['recoveryVoicing'])
        uncovered &= energy[:len(raw)] >= max(.0008, float(np.max(energy))*.025)
        bounds = np.arange(len(raw))*step
        first_strict_start = events[0]['start']
        uncovered &= (bounds >= max(0, first_strict_start-cfg['onsetRecoveryLookback'])) & (bounds < events[-1]['end'])
        for event in events:
            uncovered &= ~((bounds >= event['start']-step/2) & (bounds < event['end']-step/2))
        if uncovered.any():
            recovery_f0 = np.full(len(raw), np.nan)
            recovery_f0[uncovered] = 440*2**((raw[uncovered]-69)/12)
            candidates, _, recovery_diag = extract_events(
                recovery_f0, uncovered, prob, hop, sr, onset_times, energy,
                {**cfg, 'recoverLowConfidence': False, 'estimateTuning': False,
                 'continuationVoicing': cfg['recoveryVoicing'],
                 'seedVoicing': cfg['recoveryVoicing'], 'minCore': .08,
                 'missingGap': 0})
            for event in candidates:
                # Only a nearby acoustic onset can justify recovering a weak
                # first note. Do not promote quiet accompaniment in the intro.
                if event['start'] < first_strict_start and not any(
                        abs(k*step-event['start']) <= .08+1e-8 for k in onsets):
                    continue
                core_seconds = sum(max(0, min(event['end'], c['end'])-max(event['start'], c['start']))
                                   for c in recovery_diag['cores'])
                if event['end']-event['start']+1e-8 < cfg['recoveryMinDuration'] or core_seconds+1e-8 < cfg['recoveryMinCore']:
                    continue
                # Retain a proposed pitch, not a confident transcription.
                event.update(pitchStatus='uncertain', confidence=0,
                             recoveryReason='low-voicing-stable-evidence',
                             reviewRequired=True, boundaryStatus='uncertain')
                recovered.append(event)
                begin, finish = event['evidenceFrameRange']
                labels[begin:finish] = event['midi']
            all_cores.extend(c for c in recovery_diag['cores'] if any(
                c['start'] < e['end'] and c['end'] > e['start'] for e in recovered))
    # A recovery lane fills missing evidence, not necessarily a new attack.
    # Reattach a weak tail to its strict event only at a touching same-pitch
    # boundary, with no acoustic reattack there. Do not merge strict repeats.
    combined = sorted(events+recovered, key=lambda e: e['start'])
    events = []
    attached = 0
    for event in combined:
        previous = events[-1] if events else None
        joins_tail = (previous is not None and event.get('recoveryReason') and
                      not previous.get('recoveryReason') and
                      abs(event['start']-previous['end']) <= step/2 and
                      event['midi'] == previous['midi'] and
                      abs(event['pitchCenterMidi']-previous['pitchCenterMidi']) <= .3)
        reattack = False
        if joins_tail:
            boundary = int(round(event['start']/step))
            for k in onsets:
                if abs(k-boundary) > 2:
                    continue
                before = energy[max(0,k-round(.09/step)):k]
                after = energy[k:min(len(energy),k+round(.08/step))]
                if len(before) and len(after) and np.min(before) < cfg['repeatDip']*np.max(after):
                    reattack = True
                    break
        if joins_tail and not reattack:
            previous.setdefault('recoveredContinuations', []).append(dict(
                start=event['start'], end=event['end'],
                reason=event['recoveryReason'], voicingProbability=event['voicingProbability']))
            previous['end'] = previous['performanceEnd'] = event['end']
            previous['evidenceFrameRange'][1] = event['evidenceFrameRange'][1]
            previous['reviewRequired'] = True
            previous['reviewReason'] = 'low-voicing-continuation'
            previous['ornaments'].extend(event['ornaments'])
            attached += 1
        else:
            events.append(event)
    events, noise_fragments = absorb_noise_fragments(events, step, cfg, onsets, energy)
    target_proposals = contextual_pitch_targets(events)
    for event in events:
        if event.get('absorbedFragments') or event.get('targetReason'):
            begin,finish=event['evidenceFrameRange'];labels[begin:finish]=event['midi']
    return events, labels, dict(version=VERSION,config=cfg,cores=all_cores,filledDropouts=filled,
                               absorbedTransitions=transitions,
                               absorbedNoiseFragments=noise_fragments,
                               contextualPitchProposals=target_proposals,
                               uncertainEvents=sum(e['pitchStatus']=='uncertain' for e in events),
                               confidenceMeaning='voicingProbability is not pitch correctness probability',
                               recoveredLowConfidenceEvents=len(recovered),
                               attachedLowConfidenceContinuations=attached,
                               energyThreshold=max(.0008, float(np.max(energy))*.025) if energy is not None else None,
                               secondaryDetector=None,tuningCents=tuning_diagnostics['cents'],
                               tuning=tuning_diagnostics,
                               voicedMaskApplied=True)
