"""Local Chinese vocal transcription; no cloud inference."""
import argparse
import json
import os
from pathlib import Path
import sys
import certifi
os.environ.setdefault('SSL_CERT_FILE', certifi.where())
ROOT = Path(__file__).resolve().parent.parent

def emit(stage, message, progress):
    print(json.dumps(dict(stage=stage,message=message,progress=progress),ensure_ascii=False),flush=True)

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
    result=model.transcribe(audio,language='zh',task='transcribe',fp16=False,word_timestamps=True,verbose=False,temperature=0,condition_on_previous_text=False)
    convert=OpenCC('t2s').convert
    words=[{'text':convert(w['word']).strip(),'start':float(w['start']),'end':float(w['end']),'probability':float(w.get('probability',0))} for s in result['segments'] for w in s.get('words',[]) if w['word'].strip() and w['end']>w['start']]
    payload={'version':1,'model':'whisper-small','language':'zh','text':convert(result['text']).strip(),'duration':len(audio)/sr,'words':words,'warnings':['歌唱文字及词级时间戳为实验结果，中文词内逐字时间均分估计，需试听核对。']}
    target=Path(args.output);temporary=target.with_suffix('.tmp');temporary.write_text(json.dumps(payload,ensure_ascii=False),encoding='utf8');temporary.replace(target)
    emit('done','歌词识别完成，正在保存',1)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--prepare',action='store_true');p.add_argument('--input');p.add_argument('--output');args=p.parse_args()
    try:main(args)
    except Exception as e:emit('error',str(e),0);sys.exit(1)
