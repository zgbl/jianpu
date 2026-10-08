"""Phrase-level ASR windows: occurrences are consumed once; input order is advisory."""
import re
from difflib import SequenceMatcher


def matched_search_end(line, match, words, duration, ceiling=None):
    """Keep misrecognized suffix syllables inside the acoustic search window."""
    known=match.get('anchors', {})
    end=match['end']+1
    if known:
        last=max(known); tail=len(line)-last-1; time=known[last]
        slots=[]
        for word in words:
            text=clean_line(word.get('text','')) or ''
            for i in range(len(text)):
                start=word['start']+(word['end']-word['start'])*i/len(text)
                if start>time+.05:slots.append((start,word['end']))
        slots.sort()
        # Wrong text still supplies timing evidence. Do not jump across an
        # instrumental break to borrow the next sentence's syllables.
        cursor=time;used=[]
        for start,finish in slots:
            if len(used)>=tail or start-cursor>4:break
            used.append((start,finish));cursor=start
        if used:end=max(end,used[-1][1]+1)
        end=max(end,time+tail*.65+.5)
    return min(duration,ceiling if ceiling is not None else duration,end)


def clean_line(text):
    if re.search(r'(?:music\s*163\s*(?:\.|\s)*com|百度百科|https?://|www\.)', text, re.I):
        return None
    return re.sub(r'[^\w]', '', re.sub(r'guitar', '吉他', text, flags=re.I))


def phrase_windows(lines, source, ordered=False):
    if ordered:
        return ordered_phrase_windows(lines, source)
    text=''.join(c for c,_ in source);used=set();result=[];previous_end=0
    for line in lines:
        phrase=clean_line(line);options=[]
        if not phrase:
            result.append(None);continue
        size=len(phrase)
        for start in range(len(source)):
            for length in range(max(2,int(size*.7)), min(len(source)-start,int(size*1.3)+2)+1):
                if any(i in used for i in range(start,start+length)):continue
                match=SequenceMatcher(None,phrase,text[start:start+length],autojunk=False)
                blocks=match.get_matching_blocks();ratio=match.ratio()
                if ratio>=.55 and max(b.size for b in blocks)>=2:
                    # Prefer shorter precise windows over added adjacent syllables.
                    options.append((ratio,start,length,blocks))
        if not options:
            result.append(None);continue
        best=max(o[0] for o in options)
        eligible=[o for o in options if o[0]>=max(.55,best-.2)]
        forward=[o for o in eligible if source[o[1]][1]>=previous_end-.05]
        if forward:eligible=forward
        first=min(o[1] for o in eligible)
        ratio,start,length,blocks=max((o for o in eligible if o[1]<=first+max(2,size//2)),key=lambda o:(o[0],-o[2],-o[1]))
        used.update(range(start,start+length));previous_end=source[start+length-1][1]+.1
        result.append(dict(start=source[start][1],end=min(source[start+length-1][1]+.6,source[start+length][1]) if start+length<len(source) else source[start+length-1][1]+.6,
                           anchors={b.a+k:source[start+b.b+k][1] for b in blocks if b.size>=2 for k in range(b.size)},similarity=ratio))
    return result


def manual_phrase_windows(lines, manual, matches, duration):
    """Manual substrings constrain whole lyric-line searches, including ASR omissions.

    Repeated occurrences are assigned in recording order, with existing ASR timing
    breaking ties. Manual text is never discarded for lacking enough ASR matches.
    """
    result=list(matches);used=set();last_line=-1
    for word in sorted(manual,key=lambda w:w['start']):
        text=clean_line(word['text'])
        if not text:continue
        options=[]
        for li,line in enumerate(lines):
            at=line.find(text)
            while at>=0:
                if (li,at) not in used:
                    match=result[li]
                    distance=abs((match['start']+match['end'])/2-word['start']) if match else float('inf')
                    options.append((li,at,distance))
                at=line.find(text,at+1)
        if not options:continue
        # A lone common character cannot identify a missing sentence.
        if len(text)==1 and len(options)>1:
            options=[o for o in options if o[2]<2]
            if not options:continue
        close=[o for o in options if o[2]<5]
        eligible=close or [o for o in options if o[0]>=last_line] or options
        li,at,_=min(eligible,key=lambda o:(o[2],o[0],o[1]))
        used.add((li,at));last_line=li
        span=max(.08,word['end']-word['start']);rate=max(.12,min(.6,span/len(text)))
        start=max(0,word['start']-at*rate-.8)
        end=min(duration,word['end']+(len(lines[li])-at-len(text))*rate+.8)
        prior=result[li]
        if prior and prior.get('manual'):
            start=min(start,prior['start']);end=max(end,prior['end'])
        elif prior and prior['start']<=word['start']<=prior['end']:
            start=min(start,prior['start']);end=max(end,prior['end'])
        anchors=dict(prior.get('anchors',{})) if prior else {}
        anchors.update({at+i:word['start']+span*i/len(text) for i in range(len(text))})
        result[li]=dict(start=start,end=end,anchors=anchors,similarity=1,manual=True)
    return result


def ordered_phrase_windows(lines, source):
    """Globally match full pasted lyrics, consuming ASR frames in text order.

    Missing lines can be skipped. Later exact repeats cannot steal a window
    needed by intervening lines; an unmatched line never falls back backwards.
    """
    from bisect import bisect_right
    text = ''.join(c for c, _ in source)
    states = {0: (0., [])}
    for line in lines:
        phrase = clean_line(line) or ''
        size = len(phrase)
        ends = sorted(states)
        prefix = []
        best = None
        for end in ends:
            if best is None or states[end][0] > best[0]:
                best = states[end]
            prefix.append(best)
        following = {end: (score, path+[None]) for end, (score, path) in states.items()}
        for start in range(len(source)):
            previous = prefix[bisect_right(ends, start)-1]
            for length in range(max(2, int(size*.7)), min(len(source)-start, int(size*1.3)+2)+1):
                match = SequenceMatcher(None, phrase, text[start:start+length], autojunk=False)
                blocks = match.get_matching_blocks()
                ratio = match.ratio()
                if ratio < .55 or max(b.size for b in blocks) < 2:
                    continue
                score = previous[0]+(ratio-.5)*size
                end = start+length
                if end in following and following[end][0] >= score:
                    continue
                window = dict(start=source[start][1], end=min(source[end-1][1]+.6, source[end][1]) if end<len(source) else source[end-1][1]+.6,
                              anchors={b.a+k:source[start+b.b+k][1] for b in blocks if b.size>=2 for k in range(b.size)}, similarity=ratio)
                following[end] = (score, previous[1]+[window])
        states = following
    return max(states.values(), key=lambda value:value[0])[1]
