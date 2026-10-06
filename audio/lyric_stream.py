"""Overlapping recognition windows with unique timestamp ownership."""
import math


def recognition_windows(duration, seconds=30, overlap=1.5):
    for index in range(math.ceil(duration/seconds)):
        start=index*seconds;end=min(duration,start+seconds)
        yield start,end,max(0,start-overlap),min(duration,end+overlap)


def vocal_decode_window(audio, sr, start, end):
    """Remove long silent vocal-stem edges while retaining original timestamps.

    Silence before the first verse can make Whisper hallucinate credits and
    omit the following sung words. Interior pauses and window ownership stay
    intact; returned times are always relative to the original recording.
    """
    import numpy as np
    samples=audio[int(start*sr):int(end*sr)]
    hop=max(1,round(sr*.08))
    count=len(samples)//hop
    if not count:return None
    frames=samples[:count*hop].reshape(count,hop)
    rms=np.sqrt(np.mean(frames*frames,axis=1))
    threshold=max(.0005,float(rms.max())*.015)
    active=rms>=threshold
    sustained=np.flatnonzero(np.convolve(active.astype(int),np.ones(3,dtype=int),'valid')>=3) if count>=3 else []
    if not len(sustained):return None
    first=start+int(sustained[0])*hop/sr
    last=min(end,start+(int(sustained[-1])+3)*hop/sr)
    low=max(start,first-.6) if first-start>2 else start
    high=min(end,last+.6) if end-last>2 else end
    return low,high


def window_words(segments, offset, start, end, convert):
    result=[]
    for segment in segments:
        for word in segment.get('words',[]):
            a=offset+float(word['start']);b=offset+float(word['end'])
            text=convert(word['word']).strip()
            if text and b>a and start<=(a+b)/2<end:
                result.append(dict(text=text,start=a,end=b,probability=float(word.get('probability',0))))
    return result
