"""Local Chinese vocal transcription; no cloud inference."""
import argparse
import json
import os
from pathlib import Path
import sys
import certifi
from lyric_credits import filter_credit_blocks
os.environ.setdefault('SSL_CERT_FILE', certifi.where())
ROOT = Path(__file__).resolve().parent.parent

def emit(stage, message, progress, **extra):
    print(json.dumps(dict(stage=stage,message=message,progress=progress,**extra),ensure_ascii=False),flush=True)

def main(args):
    import torch
    import whisper
    cache=ROOT / '.cache/whisper'
    torch.set_num_threads(min(4,os.cpu_count() or 2))
    if not args.prepare and not (cache / 'small.pt').is_file():
        raise ValueError('请先运行 npm run audio:lyrics')
    emit('model','准备本机中文语音模型',.1)
    model=whisper.load_model('small',device='cpu',download_root=str(cache))
    if args.prepare:
        (ROOT / '.cache/lyrics-ready.json').write_text(json.dumps({'model':'whisper-small','checkpoint':'.cache/whisper/small.pt'}))
        emit('done','中文歌词模型已就绪',1)
        return
    import librosa
    from opencc import OpenCC
    audio,sr=librosa.load(args.input,sr=16000,mono=True)
    emit('transcribe','识别中文歌词及时间戳',.2)
    from lyric_stream import recognition_windows, window_words, vocal_decode_window
    convert=OpenCC('t2s').convert
    words=[];raw_segments=[];segment_discards=[];duration=len(audio)/sr
    for revision,(start,end,window_start,window_end) in enumerate(recognition_windows(duration),1):
        emit('transcribe',f'正在识别 {start:.0f}–{end:.0f} 秒；此前结果已显示在谱面',.2+.75*start/max(1,duration))
        decode_window=vocal_decode_window(audio,sr,window_start,window_end)
        if decode_window:
            decode_start,decode_end=decode_window
            result=model.transcribe(audio[int(decode_start*sr):int(decode_end*sr)],language='zh',task='transcribe',fp16=False,word_timestamps=True,verbose=False,temperature=0,condition_on_previous_text=False)
        else:
            decode_start,decode_end=window_start,window_end
            result={'segments':[]}
        # Check the full decoder text BEFORE zero-duration word removal and window
        # ownership fragment a credit block into e.g. '词宗盛盛演宗'.
        segment_text=''.join(convert(s.get('text','')) for s in result['segments'])
        chunk_words=window_words(result['segments'],decode_start,start,end,convert)
        _,chunk_words,blocks=filter_credit_blocks(segment_text,chunk_words)
        raw_segments.append(dict(start=window_start,end=window_end,decodeStart=decode_start,decodeEnd=decode_end,text=segment_text))
        segment_discards.extend(blocks)
        words.extend(chunk_words)
        raw_text=''.join(w['text'] for w in words)
        text,clean_words,discarded=filter_credit_blocks(raw_text,words)
        emit('partial',f'已识别至 {end:.1f} / {duration:.1f} 秒，正在更新谱面',.2+.75*end/max(1,duration),
             preview=dict(version=1,revision=revision,model='whisper-small',language='zh',text=text,words=clean_words,duration=duration,processedUntil=end,partial=True,warnings=['识别进行中；词级时间戳用于逐字估算，最终结果可能修订。']))
    raw_text=''.join(w['text'] for w in words)
    text,clean_words,discarded=filter_credit_blocks(raw_text,words)
    discarded=segment_discards+discarded
    warnings=['歌唱文字及词级时间戳为实验结果，中文词内逐字时间均分估计，需试听核对。']
    if discarded: warnings.append(f'已过滤 {len(discarded)} 段署名文字，疑似语音模型幻觉；原始结果已保留供核对。')
    payload={'version':1,'model':'whisper-small','language':'zh','text':text,'duration':len(audio)/sr,'words':clean_words,'warnings':warnings,'discardedCreditBlocks':discarded,'rawSegments':raw_segments}
    if discarded: payload.update(rawText=raw_text,rawWords=words)
    target=Path(args.output);temporary=target.with_suffix('.tmp');temporary.write_text(json.dumps(payload,ensure_ascii=False),encoding='utf8');temporary.replace(target)
    emit('done','歌词识别完成，正在保存',1)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--prepare',action='store_true');p.add_argument('--input');p.add_argument('--output');args=p.parse_args()
    try:main(args)
    except Exception as e:emit('error',str(e),0);sys.exit(1)
