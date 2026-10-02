"""Beat/downbeat evidence for the local transcription workflow."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from scipy.signal import resample_poly, find_peaks
import soundfile as sf
from math import gcd


def novelty(samples, sr):
    target = 11025
    g = gcd(sr, target)
    y = resample_poly(samples, target // g, sr // g).astype(np.float32)
    hop, size = 110, 1024
    y = np.pad(y, (size // 2, size // 2))
    frames = np.lib.stride_tricks.sliding_window_view(y, size)[::hop]
    window = np.hanning(size).astype(np.float32)
    parts, low_parts, previous = [], [], None
    frequency = np.fft.rfftfreq(size, 1 / target)
    for offset in range(0, len(frames), 2048):
        spectrum = np.log1p(20 * np.abs(np.fft.rfft(frames[offset:offset + 2048] * window)))
        delta = np.maximum(0, np.diff(spectrum, axis=0, prepend=spectrum[:1] if previous is None else previous))
        previous = spectrum[-1:]
        parts.append(delta.mean(axis=1))
        low_parts.append(delta[:, (frequency >= 35) & (frequency <= 250)].mean(axis=1))
    flux = np.concatenate(parts)
    low = np.concatenate(low_parts)
    def normalize(v):
        baseline = np.convolve(v, np.ones(101) / 101, mode='same')
        v = np.maximum(0, v - baseline)
        scale = np.percentile(v, 95)
        return np.minimum(v / max(scale, 1e-8), 4)
    return .7 * normalize(flux) + .3 * normalize(low), hop / target


def analyze(samples, sr, source='mix'):
    duration = len(samples) / sr
    envelope, step = novelty(samples, sr)
    if duration < 3 or np.max(envelope) < 1e-5:
        return {'version': 1, 'source': source, 'duration': round(duration, 3), 'beatTimes': [], 'confidence': 0, 'candidates': [], 'warning': '节拍信号不足，请手动校准速度和小节起点'}
    centered = envelope - envelope.mean()
    size = 1 << (2 * len(centered) - 1).bit_length()
    spectrum = np.fft.rfft(centered, n=size)
    ac = np.fft.irfft(spectrum * spectrum.conj(), n=size)[:len(centered)]
    lo, hi = round(60 / 220 / step), round(60 / 45 / step)
    peaks, _ = find_peaks(ac[lo:hi], distance=3)
    lags = sorted((int(p + lo) for p in peaks), key=lambda p: ac[p], reverse=True)[:12]
    if not lags:
        lags = [int(np.argmax(ac[lo:hi]) + lo)]
    candidates = []
    # Refine period on several local windows: full-song phase cancellation is
    # avoided, while live rubato is handled by the subsequent beat tracker.
    for lag in lags:
        best = None
        for period in np.linspace((lag - 1) * step, (lag + 1) * step, 17):
            scores, phases = [], []
            for start in range(0, len(envelope), round(24 / step)):
                chunk = envelope[start:start + round(24 / step)]
                if len(chunk) < 3 / step:
                    continue
                phase_count = max(8, round(period / step))
                bins = np.arange(len(chunk)) * step / period
                folded = np.bincount((np.floor(bins * phase_count).astype(int) % phase_count), weights=chunk, minlength=phase_count)
                smooth = np.convolve(np.tile(folded, 3), np.array([.2, .6, .2]), mode='same')[phase_count:2 * phase_count]
                scores.append(float(smooth.max() / max(smooth.mean(), 1e-8)))
                phases.append(float(np.argmax(smooth) * period / phase_count + start * step))
            strength = float(np.median(scores)) if scores else 0
            value = strength * max(float(ac[lag] / max(ac[0], 1e-8)), .01) ** .25
            # Weak prior only: do not force every song towards 120 BPM.
            value *= np.exp(-.3 * np.log2((60 / period) / 95) ** 2)
            if best is None or value > best[0]:
                best = (value, period, phases[0] if phases else 0, strength)
        candidates.append(best)
    candidates.sort(reverse=True)
    value, period, phase, strength = candidates[0]
    # Dynamic programming over frame positions; prefer successive quarter beats
    # but allow local tempo change and silent beats. Pure numpy avoids JIT/native
    # beat-tracker issues in the existing audio runtime.
    lag = period / step
    distances = np.arange(max(1, round(lag * .65)), round(lag * 1.45) + 1)
    penalty = -25 * np.log(distances / lag) ** 2
    local = np.convolve(envelope, np.exp(-.5 * (np.arange(-3, 4) / 1.5) ** 2), mode='same')
    cumulative = np.zeros(len(local)); links = np.full(len(local), -1, dtype=int)
    for t in range(len(local)):
        valid = distances[distances <= t]
        if len(valid):
            values = cumulative[t - valid] + penalty[:len(valid)]
            at = int(np.argmax(values))
            if values[at] > 0:
                links[t] = t - valid[at]; cumulative[t] = values[at]
        cumulative[t] += local[t]
    tail = max(0, len(local) - round(2 * lag))
    at = tail + int(np.argmax(cumulative[tail:])); beats = []
    while at >= 0:
        beats.append(at * step); at = links[at]
    beats.reverse()
    # Suppress a spurious pickup chain before music begins.
    peaks, _ = find_peaks(envelope, distance=max(1, round(.15 / step)), prominence=.3)
    if len(peaks):
        first = peaks[0] * step
        beats = [t for t in beats if t >= first - period]
    # Provisional 4/4 phase from recurring attack accents, never a claim of a
    # confirmed musical downbeat. Harmonic phrasing may select another phase.
    accents = [float(local[min(len(local)-1, round(t/step))]) for t in beats]
    phase_scores = [float(np.mean(accents[i::4])) if accents[i::4] else 0 for i in range(4)]
    downbeat_index = int(np.argmax(phase_scores)) if len(beats) >= 8 else 0
    unique = []
    for c in candidates:
        bpm = round(60 / c[1], 2)
        if all(abs(bpm - x['bpm']) > 2 for x in unique):
            unique.append({'bpm': bpm, 'score': round(c[0], 3)})
    # Autocorrelation often finds a subdivision rather than the musical beat.
    # Keep metrical alternatives visible instead of treating the strongest lag
    # as truth. The inherited score is only a search hint, not confidence.
    expanded = list(unique)
    for candidate in unique[:6]:
        for ratio in (1/3, .5, 2/3, 4/3, 1.5, 2, 3):
            bpm = round(candidate['bpm'] * ratio, 2)
            if 40 <= bpm <= 240 and all(abs(bpm - item['bpm']) > 1 for item in expanded):
                expanded.append({'bpm': bpm, 'score': round(candidate['score'] * .82, 3), 'type': 'metrical-level', 'derivedFrom': candidate['bpm']})
    expanded.sort(key=lambda c: c['score'], reverse=True)
    aliases = (1/3, .5, 2/3, 4/3, 1.5, 2, 3)
    ambiguous = any(abs(c['bpm'] / unique[0]['bpm'] - ratio) < .04 and c['score'] > unique[0]['score'] * .75 for c in unique[1:] for ratio in aliases)
    confidence = float(np.clip((strength - 1) / 5, 0, 1))
    return {'version': 2, 'source': source, 'duration': round(duration, 3), 'estimatedBpm': round(60 / period, 2), 'beatTimes': [round(t, 4) for t in beats], 'confidence': round(confidence, 3), 'tempoAmbiguous': ambiguous, 'candidates': expanded[:16], 'downbeatIndex': downbeat_index, 'downbeatPhaseScores': [round(v, 3) for v in phase_scores], 'assumedMeter': 4, 'downbeatConfirmed': False, 'method': 'spectral-flux-fallback', 'warning': '节拍来自本地信号分析；自动置信度只表示周期性。请用原曲试听确认速度层级与小节第一拍'}


def stable_grid(rhythm, bass_envelope=None, bass_step=None, meter=4, pulse_envelope=None, pulse_step=None):
    """Fit candidate periods with inferred integer beat positions.

    Missing detections advance multiple beat positions; they are not treated as
    longer single beats. Several metrical levels remain available for review.
    """
    observed = np.asarray(rhythm.get('beatTimes', []), dtype=float)
    if len(observed) < 8:
        return None
    candidates = rhythm.get('candidates') or [{'bpm': rhythm['estimatedBpm'], 'score': 1}]
    window = min(len(observed), 20 * meter + 1)
    fits = []
    for candidate in candidates:
        expected = 60 / float(candidate['bpm'])
        for start in range(0, len(observed) - window + 1, max(1, meter)):
            y = observed[start:start+window]
            gaps = np.maximum(1, np.rint(np.diff(y) / expected)).astype(int)
            x = np.r_[0, np.cumsum(gaps)].astype(float)
            slope, intercept = np.polyfit(x, y, 1)
            residual = np.abs(y - (intercept + slope * x))
            for _ in range(3):
                keep = residual <= max(.05, float(np.median(residual)) * 3)
                if keep.sum() < window * .65:
                    break
                slope, intercept = np.polyfit(x[keep], y[keep], 1)
                residual = np.abs(y - (intercept + slope * x))
            if abs(slope / expected - 1) > .12:
                continue
            fits.append({'period': slope, 'intercept': intercept, 'error': float(np.median(residual)), 'start': start, 'end': start+window-1, 'bpm': 60/slope, 'score': float(candidate.get('score', 0)), 'positions': x})
    if not fits:
        return None
    best = max(fits, key=lambda f: f['score'] - min(f['error'] * 4, 2))
    # Pool the agreeing stable windows to reduce long-song drift. Average bar
    # lengths, not independent onset-to-onset fluctuations. Reject outlier
    # sections; the chosen stable section remains available in diagnostics.
    agreeing = [f for f in fits if abs(f['bpm']/best['bpm']-1) <= .006]
    period = float(np.median([f['period'] for f in agreeing]))
    observed_window = observed[best['start']:best['end']+1]
    positions = best['positions']
    intercept = float(np.median(observed_window - period * positions))
    model_scores = np.zeros(meter)
    downbeats = np.asarray(rhythm.get('downbeatTimes', []), dtype=float)
    if len(downbeats):
        for time in downbeats:
            beat = int(round((time-intercept)/period))
            model_scores[beat % meter] += 1
        model_scores /= max(float(model_scores.max()), 1e-8)
    else:
        old_scores = np.asarray(rhythm.get('downbeatPhaseScores', []), dtype=float)
        for i, position in enumerate(positions):
            if len(old_scores): model_scores[int(position) % meter] += old_scores[i % len(old_scores)]
        model_scores /= max(float(model_scores.max()), 1e-8)
    pulse_scores = np.zeros(meter)
    if pulse_envelope is not None and pulse_step:
        for phase in range(meter):
            strengths = []
            for k, position in enumerate(positions):
                if int(position) % meter != phase: continue
                frame = round((intercept + period*position)/pulse_step)
                radius = max(1, round(.08*period/pulse_step))
                a, b = max(0,frame-radius), min(len(pulse_envelope),frame+radius+1)
                if a < b: strengths.append(float(np.max(pulse_envelope[a:b])))
            pulse_scores[phase] = float(np.mean(strengths)) if strengths else 0
        pulse_scores /= max(float(pulse_scores.max()), 1e-8)
    bass_scores = np.zeros(meter)
    if bass_envelope is not None and float(np.max(bass_envelope)) > 1e-5:
        for phase in range(meter):
            strengths = []
            for k in range(phase, len(positions), meter):
                frame = round((intercept + period*positions[k])/bass_step)
                radius = max(1, round(.09*period/bass_step))
                a, b = max(0,frame-radius), min(len(bass_envelope),frame+radius+1)
                if a < b:
                    strengths.append(float(np.max(bass_envelope[a:b])))
            bass_scores[phase] = float(np.mean(strengths)) if strengths else 0
        bass_scores /= max(float(bass_scores.max()), 1e-8)
    if len(downbeats):
        combined = .6*model_scores + .2*pulse_scores + .2*bass_scores
    elif np.max(pulse_scores):
        combined = .7*pulse_scores + .3*bass_scores if np.max(bass_scores) else pulse_scores
    else:
        combined = model_scores
    phase = int(np.argmax(combined))
    anchor = intercept + phase*period
    if len(downbeats):
        anchor = float(downbeats[0] + round((intercept - downbeats[0])/(period*meter))*period*meter)
    measures = (positions[-1]-positions[0])/meter
    return {'bpm': round(60/period, 4), 'period': round(period, 8), 'barDuration': round(period*meter, 8), 'meter': meter,
            'anchorTime': round(anchor, 6), 'fitStart': float(observed[best['start']]), 'fitEnd': float(observed[best['end']]),
            'fitMeasures': round(measures, 2), 'medianError': round(best['error'], 4), 'agreeingWindows': len(agreeing),
            'bassUsed': bool(np.max(bass_scores)), 'downbeatPhaseScores': [round(float(v), 4) for v in combined],
            'candidateBpm': round(best['bpm'], 4), 'beatPositions': positions.tolist(),
            'warning': '不足10小节，暂按较短片段估计固定时长' if measures < 10 else '固定时长来自连续10–20小节；强拍相位仍需试听确认'}


def analyze_files(folder, meter=4):
    folder = Path(folder)
    source = 'mix'
    samples, sr = sf.read(folder / 'clip.wav', dtype='float32', always_2d=True)
    rhythm = None
    try:
        from beat_this.inference import File2Beats
        import torch
        checkpoint = Path(torch.hub.get_dir()) / 'checkpoints' / 'beat_this-final0.ckpt'
        if not checkpoint.exists():
            raise FileNotFoundError('本地权重尚未准备，请先运行 npm run audio:rhythm-setup')
        digest = hashlib.sha256()
        with checkpoint.open('rb') as weight_file:
            for block in iter(lambda: weight_file.read(1024*1024), b''):
                digest.update(block)
        beat_model = File2Beats(checkpoint_path=str(checkpoint), device='cpu', dbn=False)
        beats, downbeats = beat_model(str(folder / 'clip.wav'))
        beat_times = np.asarray(beats, dtype=float).reshape(-1)
        downbeat_times = np.asarray(downbeats, dtype=float).reshape(-1)
        pulse_bpm = round(60/float(np.median(np.diff(beat_times))), 2) if len(beat_times)>1 else 0
        downbeat_bpm = round(60*meter/float(np.median(np.diff(downbeat_times))), 2) if len(downbeat_times)>3 else 0
        downbeat_valid = 40 <= downbeat_bpm <= 240
        primary_bpm = downbeat_bpm if downbeat_valid else pulse_bpm
        rhythm = {'version': 2, 'source': 'mix', 'duration': round(len(samples)/sr, 3),
                  'estimatedBpm': primary_bpm, 'pulseBpm': pulse_bpm, 'downbeatBpm': downbeat_bpm or None,
                  'beatTimes': np.round(beat_times, 4).tolist(), 'downbeatTimes': np.round(downbeat_times, 4).tolist(),
                  'confidence': None, 'tempoAmbiguous': bool(downbeat_valid and pulse_bpm and abs(downbeat_bpm/pulse_bpm-1)>.12), 'candidates': [], 'downbeatConfirmed': False,
                  'method': 'Beat This! final0 CPU', 'model': {'name': 'beat-this', 'checkpoint': 'final0', 'device': 'cpu', 'sha256': digest.hexdigest()},
                  'warning': 'Beat This! 输出是模型估计；请试听核对速度层级和小节第一拍'}
        if len(beat_times) > 1:
            for factor in (1/3, .5, 2/3, 4/3, 1.5, 2, 3):
                bpm = round(pulse_bpm * factor, 2)
                if 40 <= bpm <= 240:
                    rhythm['candidates'].append({'bpm': bpm, 'score': 0.72, 'type': 'metrical-level', 'derivedFrom': pulse_bpm})
            rhythm['candidates'].append({'bpm': pulse_bpm, 'score': .9, 'type': 'beat-model'})
            if downbeat_valid: rhythm['candidates'].append({'bpm': downbeat_bpm, 'score': 1.2, 'type': 'downbeat+meter', 'derivedFrom': downbeat_times[0]})
            rhythm['candidates'] = sorted({c['bpm']: c for c in rhythm['candidates']}.values(), key=lambda c: c['score'], reverse=True)
    except Exception as model_error:
        rhythm = analyze(samples.mean(axis=1), sr, 'mix')
        drum_path = folder / 'drums.wav'
        if drum_path.exists():
            drum, drum_sr = sf.read(drum_path, dtype='float32', always_2d=True)
            drum_rhythm = analyze(drum.mean(axis=1), drum_sr, 'drums')
            if len(drum_rhythm.get('beatTimes', [])) >= 8 and drum_rhythm.get('confidence', 0) >= max(.35, rhythm.get('confidence', 0) + .1):
                rhythm = drum_rhythm
        rhythm['warning'] += f'；Beat This! 不可用（{type(model_error).__name__}），当前使用频谱起音回退分析；可运行 npm run audio:rhythm-setup 安装并下载本地模型'
    bass_env = bass_step = None
    if (folder / 'bass.wav').exists():
        bass, bass_sr = sf.read(folder / 'bass.wav', dtype='float32', always_2d=True)
        bass_env, bass_step = novelty(bass.mean(axis=1), bass_sr)
    pulse_env, pulse_step = novelty(samples.mean(axis=1), sr)
    if (folder / 'drums.wav').exists():
        pulse_samples, pulse_sr = sf.read(folder / 'drums.wav', dtype='float32', always_2d=True)
        drum_env, drum_step = novelty(pulse_samples.mean(axis=1), pulse_sr)
        if abs(drum_step-pulse_step)<1e-8 and len(drum_env)==len(pulse_env):
            pulse_env = .65*pulse_env + .35*drum_env
    stable = stable_grid(rhythm, bass_env, bass_step, meter=meter, pulse_envelope=pulse_env, pulse_step=pulse_step)
    if stable:
        rhythm['stableGrid'] = stable
    return rhythm


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--folder'); parser.add_argument('--meter', type=int, choices=(2,3,4), default=4); parser.add_argument('--prepare', action='store_true')
    args = parser.parse_args()
    if args.prepare:
        from beat_this.inference import CHECKPOINT_URL, File2Beats
        import torch
        import ssl
        import certifi
        import urllib.request
        checkpoint = Path(torch.hub.get_dir()) / 'checkpoints' / 'beat_this-final0.ckpt'
        checkpoint.parent.mkdir(parents=True, exist_ok=True)
        if not checkpoint.exists() or checkpoint.stat().st_size == 0:
            url = f'{CHECKPOINT_URL}/download?path=%2F&files=final0.ckpt'
            request = urllib.request.Request(url, headers={'User-Agent': 'Music-JianPu/1.0'})
            temporary = checkpoint.with_suffix(checkpoint.suffix + '.download')
            context = ssl.create_default_context(cafile=certifi.where())
            try:
                with urllib.request.urlopen(request, context=context, timeout=60) as response, temporary.open('wb') as output:
                    while True:
                        block = response.read(1024 * 1024)
                        if not block:
                            break
                        output.write(block)
                if temporary.stat().st_size < 1024 * 1024:
                    raise RuntimeError('下载文件过小，可能收到的不是模型权重文件')
                temporary.replace(checkpoint)
            finally:
                temporary.unlink(missing_ok=True)
        # Pass an explicit local path so Beat This! never triggers its own
        # urllib/Torch Hub downloader, whose Python certificate store may differ.
        File2Beats(checkpoint_path=str(checkpoint), device='cpu', dbn=False)
        digest = hashlib.sha256()
        with checkpoint.open('rb') as weight_file:
            for block in iter(lambda: weight_file.read(1024*1024), b''):
                digest.update(block)
        print(json.dumps({'model':'Beat This! final0','device':'cpu','ready':True,'checkpointPath':str(checkpoint),'sha256':digest.hexdigest()}))
    elif args.folder:
        print(json.dumps(analyze_files(args.folder, meter=args.meter), ensure_ascii=False))
    else:
        parser.error('--folder or --prepare is required')
