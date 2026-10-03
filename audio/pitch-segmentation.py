"""Conservative vocal event segmentation; no key/scale snapping."""
import numpy as np

VERSION = 'vocal-events-v2'

def runs(values):
    at = 0
    while at < len(values):
        end = at + 1
        while end < len(values) and values[end] == values[at]:
            end += 1
        yield at, end, values[at]
        at = end

def extract_events(f0, voiced, confidence, hop, sr, onset_times=(), energy=None):
    step = hop / sr
    f0, confidence = np.asarray(f0), np.nan_to_num(confidence)
    valid = np.asarray(voiced, dtype=bool) & np.isfinite(f0) & (f0 > 0)
    raw = np.full(len(f0), np.nan)
    raw[valid] = 69 + 12 * np.log2(f0[valid] / 440)
    # A reliable island seeds its lower-confidence neighbours. Isolated low
    # probability observations cannot become melody by themselves.
    labels = np.zeros(len(f0), dtype=int)
    eligible = valid & (confidence >= .35)
    for a, b, yes in runs(eligible):
        if yes and np.any(confidence[a:b] >= .65):
            labels[a:b] = np.rint(raw[a:b]).astype(int)
    # Confidence continuation cannot introduce a new unconfirmed pitch.
    for a, b, pitch in list(runs(labels)):
        if pitch and not np.any(confidence[a:b] >= .65):
            labels[a:b] = 0
    # Smooth brief vibrato excursions only when surrounded by the same pitch.
    # Genuine short steps between different notes remain untouched.
    changes = 0
    for a, b, pitch in list(runs(labels)):
        if a == 0 or b == len(labels):
            continue
        left, right = labels[a - 1], labels[b]
        if left and left == right and pitch and (b-a)*step <= (.12 if np.mean(confidence[a:b]) < .8 else .064) and (abs(pitch-left) <= 2 or abs(pitch-left) == 12):
            labels[a:b] = left
            changes += 1
    energy = np.asarray(energy) if energy is not None else None
    filled = 0
    for a, b, pitch in list(runs(labels)):
        if pitch or a == 0 or b == len(labels) or (b-a)*step > .096:
            continue
        if labels[a-1] != labels[b] or not labels[b]:
            continue
        # Do not fill an audible breath/silence. Require sustained vocal energy.
        if energy is None or b >= len(energy):
            continue
        edge = min(float(energy[a-1]), float(energy[b]))
        if edge > 0 and np.min(energy[a:b]) >= edge * .45:
            labels[a:b] = labels[b]
            filled += 1
    events = []
    for a, b, pitch in runs(labels):
        if not pitch or (b-a)*step < .075:
            continue
        cuts = [a]
        for t in onset_times:
            k = int(round(t / step))
            if k-cuts[-1] < round(.12/step) or b-k < round(.09/step) or not a < k < b:
                continue
            # A spectral onset alone can be vibrato or separation residue.
            # Split repeated notes only with a preceding vocal energy dip.
            if energy is None or k+2 >= len(energy):
                continue
            before = energy[max(a, k-round(.09/step)):k]
            after = energy[k:min(b,k+round(.08/step))]
            if len(before) and len(after) and np.min(before) < np.max(after)*.65:
                cuts.append(k)
        cuts.append(b)
        for left, right in zip(cuts, cuts[1:]):
            observed = raw[left:right]
            observed = observed[np.isfinite(observed)]
            events.append({'start':round(left*step,4),'end':round(right*step,4),
                           'midi':int(pitch),'confidence':round(float(np.mean(confidence[left:right])),3),
                           'centsDeviation':round(float(np.median(np.abs(observed-pitch))*100),1) if len(observed) else 0})
    return events, labels, {'version':VERSION,'filledDropouts':filled,'smoothedExcursions':changes,
                            'seedConfidence':.65,'continuationConfidence':.35}
