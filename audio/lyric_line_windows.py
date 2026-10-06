"""Phrase-level ASR windows: occurrences are consumed once; input order is advisory."""
import re
from difflib import SequenceMatcher


def clean_line(text):
    if re.search(r'(?:music\s*163\s*(?:\.|\s)*com|百度百科|https?://|www\.)', text, re.I):
        return None
    return re.sub(r'[^\w]', '', re.sub(r'guitar', '吉他', text, flags=re.I))


def phrase_windows(lines, source):
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
