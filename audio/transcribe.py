"""Local vocal separation and monophonic transcription. Emits JSON progress lines."""
import argparse
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
import certifi
os.environ.setdefault('SSL_CERT_FILE', certifi.where())
os.environ.setdefault('TORCH_HOME', str(ROOT / '.cache/torch'))

def progress(stage, message, fraction):
    print(json.dumps({'stage': stage, 'message': message, 'progress': fraction}, ensure_ascii=False), flush=True)

def prepare():
    import torch
    from demucs.pretrained import get_model
    progress('model', '下载并检查人声分离模型', .1)
    model = get_model('htdemucs')
    assert 'vocals' in model.sources
    checkpoints = [str(p.relative_to(ROOT)) for p in (ROOT / '.cache/torch/hub/checkpoints').glob('*.th')]
    (ROOT / '.cache/audio-ready.json').write_text(json.dumps({'model': 'htdemucs', 'checkpoints': checkpoints}), encoding='utf8')
    progress('ready', '模型已准备好，歌曲在本机处理', 1)

def pitch_events(f0, voiced, confidence, hop, sr, onset_times):
    """Ignore unvoiced frames; stabilize vibrato, retain rests and repeated attacks."""
    import numpy as np
    from scipy.ndimage import median_filter
    midi = np.zeros(len(f0), dtype=int)
    good = voiced & np.isfinite(f0) & (confidence >= .65)
    raw = np.zeros(len(f0))
    raw[good] = 69 + 12 * np.log2(f0[good] / 440)
    midi[good] = np.rint(raw[good]).astype(int)
    stable = median_filter(midi, size=5, mode='nearest')
    # Do not invent pitched frames where pYIN found no voice.
    stable[~good] = 0
    step = hop / sr
    events = []
    at = 0
    while at < len(stable):
        pitch = int(stable[at]); end = at + 1
        while end < len(stable) and stable[end] == pitch:
            end += 1
        if pitch and (end - at) * step >= .075:
            start_t, end_t = at * step, end * step
            cuts = [start_t]
            for t in onset_times:
                if t - cuts[-1] >= .12 and end_t - t >= .09 and start_t < t < end_t:
                    cuts.append(float(t))
            cuts.append(end_t)
            conf = float(np.mean(confidence[at:end]))
            cents = float(np.median(np.abs(raw[at:end] - pitch)) * 100)
            for a, b in zip(cuts, cuts[1:]):
                events.append({'start': round(a, 4), 'end': round(b, 4), 'midi': pitch,
                               'confidence': round(conf, 3), 'centsDeviation': round(cents, 1)})
        at = end
    # Merge tiny unvoiced dropouts in an otherwise sustained note.
    merged = []
    for e in events:
        if merged and e['midi'] == merged[-1]['midi'] and 0 < e['start'] - merged[-1]['end'] <= .055:
            merged[-1]['end'] = e['end']; merged[-1]['confidence'] = min(merged[-1]['confidence'], e['confidence'])
        else:
            merged.append(e)
    return merged

def estimate_tempo(samples, sr):
    import numpy as np
    hop = max(1, round(sr / 100))
    count = len(samples) // hop
    if count < 200:
        return 120.0
    energy = np.sqrt(np.mean(samples[:count * hop].reshape(count, hop) ** 2, axis=1))
    novelty = np.maximum(0, np.diff(energy, prepend=energy[0]))
    if float(novelty.max()) < 1e-5:
        return 120.0
    novelty -= novelty.mean()
    size = 1 << (2 * count - 1).bit_length()
    spectrum = np.fft.rfft(novelty, n=size)
    autocorrelation = np.fft.irfft(spectrum * np.conj(spectrum), n=size)[:count]
    lags = np.arange(25, min(151, count))
    bpms = 60 * sr / hop / lags
    # Prefer a plausible central metrical level; octave ambiguity is not hidden.
    weights = np.exp(-.5 * (np.log2(bpms / 120) / .65) ** 2)
    score = autocorrelation[lags] * weights
    if float(score.max()) <= 0:
        return 120.0
    return float(bpms[np.argmax(score)])

def run(args):
    import numpy as np
    import soundfile as sf
    import subprocess
    import imageio_ffmpeg
    import librosa
    output = Path(args.output); output.mkdir(parents=True, exist_ok=True)
    progress('decode', '解码选定的音频片段', .05)
    cmd = [imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-nostdin', '-y', '-ss', str(args.start),
           '-i', str(args.input), '-t', str(args.duration), '-ac', '2', '-ar', '44100', str(output / 'clip.wav')]
    result = subprocess.run(cmd, capture_output=True, timeout=120)
    if result.returncode:
        raise ValueError('无法解码音频，请使用有效的 MP3、WAV 或 M4A 文件。')
    mix, sr = sf.read(output / 'clip.wav', dtype='float32', always_2d=True)
    if len(mix) < sr / 2:
        raise ValueError('所选片段不足半秒，请检查开始时间。')
    if len(mix) > sr * 601:
        raise ValueError('Demo 最多处理十分钟。')
    if args.mode == 'mixed':
        if not (ROOT / '.cache/audio-ready.json').exists():
            raise ValueError('请先运行 npm run audio:setup，准备人声分离模型。')
        progress('separate', '正在分离人声与伴奏；此阶段最耗时', .15)
        separated = subprocess.run([sys.executable, str(ROOT / 'audio/separate.py'),
                                    str(output / 'clip.wav'), str(output / 'vocals.wav')], capture_output=True, timeout=1700)
        if separated.returncode:
            raise ValueError('人声分离失败，未对混合音频取音高。' + separated.stderr.decode(errors='replace')[-500:])
        vocal, _ = sf.read(output / 'vocals.wav', dtype='float32', always_2d=True)
    else:
        progress('separate', '使用你明确选择的清唱／独奏主旋律输入', .25)
        vocal = mix
        peak = float(np.max(np.abs(vocal)))
        sf.write(output / 'vocals.wav', vocal / max(1, peak), sr, subtype='PCM_16')
    progress('pitch', '从主旋律声部识别音高和音符起止', .65)
    sample_rate, hop = 16000, 256
    mono = librosa.resample(vocal.mean(axis=1), orig_sr=sr, target_sr=sample_rate)
    f0, voiced, probs = librosa.pyin(mono, fmin=65.4, fmax=1046.5, sr=sample_rate,
                                   frame_length=1024, hop_length=hop, fill_na=np.nan)
    rms = librosa.feature.rms(y=mono, frame_length=1024, hop_length=hop)[0]
    voiced &= rms[:len(voiced)] >= max(.0008, float(np.max(rms)) * .025)
    if args.mode == 'mixed':
        mixed_mono = librosa.resample(mix.mean(axis=1), orig_sr=sr, target_sr=sample_rate)
        mixed_rms = librosa.feature.rms(y=mixed_mono, frame_length=1024, hop_length=hop)[0]
        voiced &= rms[:len(voiced)] / (mixed_rms[:len(voiced)] + 1e-8) >= .04
    onset_times = librosa.onset.onset_detect(y=mono, sr=sample_rate, hop_length=hop, units='time')
    events = pitch_events(f0, voiced, probs, hop, sample_rate, onset_times)
    progress('rhythm', '估计速度；保留原始时间用于试听核对', .9)
    # A lightweight onset autocorrelation avoids native beat-tracker crashes on
    # this macOS runtime. Tempo remains explicitly editable in the demo.
    bpm = estimate_tempo(mix.mean(axis=1), sr)
    warnings = ['节拍、调号和附点是草稿估计，请对照原曲核对。']
    if args.mode == 'mixed':
        warnings.append('人声分离可能残留伴奏；和声、合唱、说唱及器乐主旋律不保证正确。')
    if not events:
        warnings.append('没有识别到可靠的有音高主旋律；未用伴奏补音，请换一个有人声的片段。')
    track = [{'time': round(i * hop / sample_rate, 3), 'midi': round(float(69 + 12 * np.log2(f0[i] / 440)), 2),
              'confidence': round(float(probs[i]), 3)} for i in range(0, len(f0), 3) if voiced[i] and np.isfinite(f0[i])]
    payload = {'version': 1, 'sourceMode': args.mode, 'duration': round(len(mix) / sr, 3),
               'clipStart': args.start, 'estimatedBpm': round(bpm, 1), 'notes': events, 'pitchTrack': track,
               'warnings': warnings, 'method': 'htdemucs vocals + pYIN' if args.mode == 'mixed' else 'pYIN (user-supplied melody)'}
    (output / 'result.json').write_text(json.dumps(payload, ensure_ascii=False), encoding='utf8')
    progress('done', f'识别到 {len(events)} 个候选音符', 1)

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--prepare', action='store_true')
    p.add_argument('--input'); p.add_argument('--output'); p.add_argument('--start', type=float, default=0)
    p.add_argument('--duration', type=float, default=30); p.add_argument('--mode', choices=['mixed', 'solo'], default='mixed')
    args = p.parse_args()
    try:
        if args.prepare:
            prepare()
        else:
            run(args)
    except Exception as e:
        print(json.dumps({'stage': 'error', 'message': str(e)}, ensure_ascii=False), flush=True)
        sys.exit(1)
