"""Conservative same-pitch syllable proposals from vocal spectral transitions.

These cues do not identify words. Unvoiced pre-core attacks remain diagnostics
only, and never become notes by borrowing a neighboring pitch.
"""
import numpy as np


def spectral_changes(samples, sr, hop):
    size=round(sr*.064); size+=size%2
    frequencies=np.fft.rfftfreq(size,1/sr)
    edges=np.geomspace(150,min(6000,sr*.48),25)
    masks=[(frequencies>=a)&(frequencies<b) for a,b in zip(edges,edges[1:])]
    padded=np.pad(samples,(size//2,size//2))
    shapes=[]
    for c in range(0,len(samples)+1,hop):
        frame=padded[c:c+size]
        if len(frame)!=size:break
        power=np.abs(np.fft.rfft(frame*np.hanning(size)))**2
        shape=np.sqrt([power[m].sum() for m in masks])
        shapes.append(shape/(np.linalg.norm(shape)+1e-12))
    shapes=np.asarray(shapes); radius=max(1,round(.04*sr/hop))
    changes=np.zeros(len(shapes))
    for k in range(radius,len(shapes)-radius):
        changes[k]=max(0,1-float(shapes[k-radius]@shapes[k+radius]))
    return changes


def split_articulations(events, raw_midi, voiced, probability, energy, changes, onset_times, step):
    """Split only strongly supported repeats; preserve the acoustic cores."""
    result=[];proposals=[]
    floor=max(.0008,float(np.max(energy))*.025)
    onsets=[round(t/step) for t in onset_times]
    for original in events:
        event=original
        if event.get('pitchStatus')!='candidate' or event.get('coreStart') is None:
            result.append(event);continue
        a=round(event['start']/step);b=min(len(changes),round(event['end']/step))
        # Also inspect a short pre-core attack that strict voicing omitted.
        lower=max(0,a-round(.24/step));upper=min(b-3,a+round(.08/step))
        peaks=[k for k in range(lower+3,upper) if changes[k]>=.6 and changes[k]>=changes[k-1] and changes[k]>changes[k+1]]
        for k in sorted(peaks,key=lambda k:changes[k],reverse=True):
            attacks=[i for i in onsets if lower<=i<k and .08<=(k-i)*step<=.22]
            if not attacks:continue
            attack=max(attacks)
            # A spectrally changing consonant needs sustained energy and a
            # separate onset. Do not promote quiet accompaniment or silence.
            if (np.mean(energy[attack:k]>=floor)<.8 or
                    event['end']-k*step<.12 or
                    result and result[-1]['end']>attack*step+step/2):continue
            observed=np.asarray(raw_midi[attack:k]);finite=observed[np.isfinite(observed)]
            if len(finite)<3 or np.mean(np.abs(finite-event['midi'])<=.6)<.7:continue
            # Supported as articulation, NOT a confident unvoiced pitch.
            evidence=dict(kind='spectral-articulation',boundaryTime=round(k*step,4),
                          spectralChange=round(float(changes[k]),3),attackTime=round(attack*step,4),
                          borrowedPitch=True)
            # A consonant-to-vowel transition inside ONE syllable can look
            # identical. Keep diagnostics only; never invent an unvoiced note
            # or move the following event's onset without periodic evidence.
            evidence.update(diagnosticsOnly=True, start=round(attack*step,4),
                            end=round(k*step,4), proposedMidi=event['midi'])
            proposals.append(evidence);break
        # Inside a continuous same-pitch event, require a spectral transition
        # AND reattack/dropout evidence; pitch motion alone cannot split it.
        start=round(event['start']/step)
        for k in range(start+max(3,round(.12/step)),b-max(3,round(.12/step))):
            if changes[k]<.35 or changes[k]<changes[k-1] or changes[k]<=changes[k+1]:continue
            if not any(abs(i-k)*step<=.05 for i in onsets):continue
            radius=max(3,round(.08/step));left=max(start,k-radius);right=min(b,k+radius)
            before=np.asarray(raw_midi[left:k]);after=np.asarray(raw_midi[k:right])
            pre=before[np.isfinite(before)];post=after[np.isfinite(after)]
            if len(pre)<3 or len(post)<3 or abs(np.median(pre)-event['midi'])>.5 or abs(np.median(post)-event['midi'])>.5:continue
            near=energy[max(start,k-2):min(b,k+3)]
            peak=max(float(np.max(energy[left:k])),float(np.max(energy[k:right])))
            dip=len(near) and np.min(near)<.65*peak
            dropout=np.sum(~np.asarray(voiced[max(start,k-2):min(b,k+3)],bool))>=2
            if not (dip or dropout) or peak<floor:continue
            cut=round(k*step,4)
            evidence=dict(kind='spectral-articulation',boundaryTime=cut,
                          spectralChange=round(float(changes[k]),3),borrowedPitch=False)
            first={**event,'end':cut,'performanceEnd':cut,
                   'coreEnd':min(event['coreEnd'],cut),
                   'evidenceFrameRange':[event['evidenceFrameRange'][0],k],
                   'articulationBoundary':evidence,'reviewRequired':True,
                   'reviewReason':'same-pitch-articulation'}
            second={**event,'start':cut,'performanceStart':cut,
                   'coreStart':max(event['coreStart'],cut),
                   'evidenceFrameRange':[k,event['evidenceFrameRange'][1]],
                   'articulationBoundary':evidence,'reviewRequired':True,
                   'reviewReason':'same-pitch-articulation'}
            if first['coreEnd']-first['coreStart']<.048 or second['coreEnd']-second['coreStart']<.048:continue
            event=second
            result.append(first);proposals.append(evidence);start=k
        result.append(event)
    return result,proposals
