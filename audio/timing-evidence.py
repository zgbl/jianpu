"""Compact vocal-energy evidence for notation timing, in clip-relative seconds."""
import math


def attach_timing_energy(events, rms, step, bins=32):
    for event in events:
        start, end = event['start'], event['end']
        if end <= start:
            continue
        count = min(bins, max(1, math.ceil((end-start)/step)))
        weights = [0.0]*count
        for i in range(max(0, math.floor(start/step)), min(len(rms), math.ceil(end/step))):
            value = float(rms[i])
            if not math.isfinite(value) or value < 0:
                continue
            # RMS is a centred-window observation, not a precise attack boundary.
            t = min(end-1e-9, max(start, i*step))
            slot = min(count-1, int((t-start)/(end-start)*count))
            weights[slot] += value*value
        total = sum(weights)
        if total > 0:
            event['timingEnergy'] = {'start': start, 'end': end,
                                     'weights': [round(w/total, 7) for w in weights]}
    return events
