"""Local vocal separation and monophonic transcription. Emits JSON progress lines."""
import argparse
import json
import hashlib
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
import certifi
os.environ.setdefault('SSL_CERT_FILE', certifi.where())
os.environ.setdefault('TORCH_HOME', str(ROOT / '.cache/torch'))

def progress(stage, message, fraction):
    print(json.dumps({'stage': stage, 'message': message, 'progress': fraction}, ensure_ascii=False), flush=True)

def prepare(model_name='htdemucs'):
    import torch
    from demucs.pretrained import get_model
    progress('model', '下载并检查人声分离模型', .1)
    model = get_model(model_name)
    assert 'vocals' in model.sources
    checkpoints = [str(p.relative_to(ROOT)) for p in (ROOT / '.cache/torch/hub/checkpoints').glob('*.th')]
    (ROOT / ('.cache/audio-ready-6s.json' if model_name=='htdemucs_6s' else '.cache/audio-ready.json')).write_text(json.dumps({'model': model_name, 'checkpoints': checkpoints}), encoding='utf8')
    progress('ready', '模型已准备好，歌曲在本机处理', 1)

def pitch_events(f0, voiced, confidence, hop, sr, onset_times, energy=None):
    from importlib import import_module
    return import_module('pitch-segmentation').extract_events(f0, voiced, confidence, hop, sr, onset_times, energy)[0]

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
        if not (ROOT / ('.cache/audio-ready-6s.json' if args.model=='htdemucs_6s' else '.cache/audio-ready.json')).exists():
            raise ValueError('请先运行 npm run audio:setup，准备人声分离模型。')
        progress('separate', '正在提取人声、鼓、贝斯及伴奏声部；此阶段最耗时', .15)
        separated = subprocess.run([sys.executable, str(ROOT / 'audio/separate.py'),
                                    str(output / 'clip.wav'), str(output / 'vocals.wav'), args.model], capture_output=True, timeout=1700)
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
    frame_length = getattr(args, 'pyin_frame_length', 1024)
    f0, voiced, probs = librosa.pyin(mono, fmin=65.4, fmax=1046.5, sr=sample_rate,
                                   frame_length=frame_length, hop_length=hop, fill_na=None)
    raw_voiced = voiced.copy()
    rms = librosa.feature.rms(y=mono, frame_length=1024, hop_length=hop)[0]
    voiced &= rms[:len(voiced)] >= max(.0008, float(np.max(rms)) * .025)
    if args.mode == 'mixed':
        mixed_mono = librosa.resample(mix.mean(axis=1), orig_sr=sr, target_sr=sample_rate)
        mixed_rms = librosa.feature.rms(y=mixed_mono, frame_length=1024, hop_length=hop)[0]
        voiced &= rms[:len(voiced)] / (mixed_rms[:len(voiced)] + 1e-8) >= .04
    onset_times = librosa.onset.onset_detect(y=mono, sr=sample_rate, hop_length=hop, units='time')
    from importlib import import_module
    baseline, baseline_pitch, baseline_diagnostics = import_module('pitch-segmentation').extract_events(f0, voiced, probs, hop, sample_rate, onset_times, rms)
    algorithm = getattr(args, 'pitch_algorithm', 'stable-v3')
    if algorithm == 'stable-v3':
        # Preserve unvoiced observations; source/energy evidence is separate.
        decoder_probs = probs.copy()
        if args.mode == 'mixed':
            decoder_probs[rms[:len(probs)] / (mixed_rms[:len(probs)] + 1e-8) < .04] = 0
        events, cleaned_pitch, pitch_diagnostics = import_module('stable-pitch').extract_events(f0, raw_voiced, decoder_probs, hop, sample_rate, onset_times, rms)
    else:
        events, cleaned_pitch, pitch_diagnostics = baseline, baseline_pitch, baseline_diagnostics
    metadata = {'detector': 'librosa.pyin', 'librosaVersion': librosa.__version__, 'sampleRate':sample_rate,
                'hopLength':hop,'frameLength':frame_length,'energyFrameLength':1024,'center':True,'padding':'constant',
                'timeOrigin':'clip-relative seconds','clipStart':args.start,'fmin':65.4,'fmax':1046.5,
                'audioSha256':hashlib.sha256((output / 'vocals.wav').read_bytes()).hexdigest(),
                'confidenceMeaning':'legacy confidence is pYIN voiced_prob, NOT pitch correctness probability'}
    (output / 'melody-candidates-v3.json').write_text(json.dumps({'version':pitch_diagnostics['version'],
         'selectedAlgorithm':algorithm,'metadata':metadata,'notes':events,'diagnostics':pitch_diagnostics,
         'baseline':{'version':baseline_diagnostics['version'],'notes':baseline},
         'onsetTimes':list(map(float,onset_times))}),encoding='utf8')
    cfg = pitch_diagnostics.get('config', {})
    probability_floor = cfg.get('continuationVoicing', .35)
    energy_floor = max(.0008, float(np.max(rms))*.025)
    def frame_decision(i):
        if not np.isfinite(f0[i]) or f0[i] <= 0:
            return 'missing-pitch'
        if not raw_voiced[i]:
            return 'unvoiced'
        if args.mode == 'mixed' and rms[i]/(mixed_rms[i]+1e-8) < .04:
            return 'source-ratio'
        if rms[i] < energy_floor:
            return 'low-energy'
        if probs[i] < probability_floor:
            return 'low-voicing'
        return 'eligible'
    metadata['decoderThresholds']={'voicingProbability':probability_floor,'energy':energy_floor,'sourceRatio':.04 if args.mode=='mixed' else 0}
    observations = [{'time': round(i * hop / sample_rate, 4), 'midi': round(float(69 + 12 * np.log2(f0[i] / 440)), 3) if np.isfinite(f0[i]) and f0[i] > 0 else None, 'voiced': bool(raw_voiced[i]), 'decoderEligible': frame_decision(i)=='eligible', 'decoderRejection': frame_decision(i), 'eligibleV2':bool(voiced[i]), 'energy':round(float(rms[i]),7), 'voicingProbability':round(float(probs[i]),4), 'pitchReliability':None, 'sourceReliability':None, 'sourceRatio':round(float(rms[i]/(mixed_rms[i]+1e-8)),6) if args.mode=='mixed' else None, 'confidence': round(float(probs[i]), 4), 'cleanedMidi': int(cleaned_pitch[i])} for i in range(len(f0))]
    (output / 'pitch-observations.json').write_text(json.dumps({'version': pitch_diagnostics['version'], 'metadata':metadata,'frames': observations}), encoding='utf8')
    progress('rhythm', '从鼓声／原曲建立节拍时间轴，保留原始音符时间', .9)
    # A lightweight onset autocorrelation avoids native beat-tracker crashes on
    # this macOS runtime. Tempo remains explicitly editable in the demo.
    from rhythm import analyze_files
    rhythm = analyze_files(output)
    bpm = rhythm.get('estimatedBpm') or estimate_tempo(mix.mean(axis=1), sr)
    warnings = [('稳定核心 v3（实验）：请用原始旋律 MIDI 与人声核对。' if algorithm=='stable-v3' else '旧分段 v2 对照版本。'), '节拍、调号和附点是草稿估计，请对照原曲核对。']
    if args.mode == 'mixed':
        warnings.append('人声分离可能残留伴奏；和声、合唱、说唱及器乐主旋律不保证正确。')
        if args.model=='htdemucs_6s':
            warnings.append('六声部模型为实验版本，吉他、钢琴可能串音；输出声部不证明原曲一定含有该乐器。')
    if not events:
        warnings.append('没有识别到可靠的有音高主旋律；未用伴奏补音，请换一个有人声的片段。')
    track = [{'time': round(i * hop / sample_rate, 3), 'midi': round(float(69 + 12 * np.log2(f0[i] / 440)), 2),
              'confidence': round(float(probs[i]), 3)} for i in range(0, len(f0), 3) if voiced[i] and np.isfinite(f0[i])]
    payload = {'version': 1, 'sourceMode': args.mode, 'duration': round(len(mix) / sr, 3),
               'pitchDiagnostics': pitch_diagnostics, 'rhythm': rhythm, 'clipStart': args.start, 'estimatedBpm': round(bpm, 1), 'notes': events, 'pitchTrack': track,
               'warnings': warnings, 'separationModel': args.model if args.mode=='mixed' else None,
               'stems': json.loads((output / 'stems.json').read_text())['sources'] if args.mode=='mixed' else ['vocals'],
               'pitchAlgorithm':algorithm, 'method': (args.model+' vocals + pYIN / ' if args.mode == 'mixed' else 'pYIN / ') + pitch_diagnostics['version']}
    (output / 'result.json').write_text(json.dumps(payload, ensure_ascii=False), encoding='utf8')
    progress('done', f'识别到 {len(events)} 个候选音符', 1)

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--prepare', action='store_true')
    p.add_argument('--input'); p.add_argument('--output'); p.add_argument('--start', type=float, default=0)
    p.add_argument('--duration', type=float, default=30); p.add_argument('--mode', choices=['mixed', 'solo'], default='mixed')
    p.add_argument('--pitch-algorithm', choices=['stable-v3','legacy-v2'],default='stable-v3')
    p.add_argument('--pyin-frame-length', type=int, choices=[1024,2048], default=1024,
                   help='pitch-analysis window; 1024 is more local, 2048 is smoother')
    p.add_argument('--model', choices=['htdemucs','htdemucs_6s'], default='htdemucs')
    args = p.parse_args()
    try:
        if args.prepare:
            prepare(args.model)
        else:
            run(args)
    except Exception as e:
        print(json.dumps({'stage': 'error', 'message': str(e)}, ensure_ascii=False), flush=True)
        sys.exit(1)
