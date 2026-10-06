"""Conservative removal of repeated ASR credit blocks; no model dependencies."""
import re
from difflib import SequenceMatcher

ROLES = r'(?:作曲|作词|编曲|词曲|演唱|作词作曲|制作人|混音|录音|母带|监制|出品人)'
# Explicit labelled names may lose punctuation in ASR segment output.
COMPACT_CREDIT = re.compile(r'(' + ROLES + r')[\s:：]*([\u4e00-\u9fff]{2,4}?)(?='+ROLES+r'|[\s,，;；。]|$)')
CREDIT = re.compile(r'(' + ROLES + r')[\s:：]+([\u4e00-\u9fff]{2,4})(?=\s|'+ROLES+r'|$)')


def filter_credit_blocks(text, words):
    # Repeated role/name phrases with an explicit separator are stronger
    # evidence than an isolated lyric mentioning composing or recording.
    phrases = {}
    for m in COMPACT_CREDIT.finditer(text):
        phrases.setdefault(m.groups(), []).append(m.span())
    # Once an explicit name is established, the same name following another
    # role is valid even when the decoder concatenates the next sung lyric.
    for name in {name for _, name in phrases}:
        for m in re.finditer(r'('+ROLES+r')[\s:：]*'+re.escape(name), text):
            key=(m.group(1),name)
            if m.span() not in phrases.setdefault(key,[]):phrases[key].append(m.span())
    repeated = [parts for parts, spans in phrases.items() if len(spans) >= 2]
    spans = []
    repeated_names = {name for _, name in repeated}
    for name in {name for _, name in phrases}:
        roles={role for role,n in phrases if n==name}
        if len(roles)>=2:repeated_names.add(name)
    for role, name in phrases:
        if name not in repeated_names:
            continue
        spans.extend(m.span() for m in re.finditer(re.escape(role)+r'[\s:：]*'+re.escape(name), text))
    if not spans:
        return text, words, []
    spans.sort()
    groups = []
    for start, end in spans:
        if groups and not text[groups[-1][1]:start].strip(' \n\r\t，,。;；:：'):
            groups[-1][1] = max(end, groups[-1][1])
        else:
            groups.append([start, end])
    # Whisper text and timestamped words can disagree. Align their character
    # sequences before excluding the timestamped portion of a credit block.
    target = [(c, i) for i, c in enumerate(text) if c.isalnum()]
    source = [(c, wi) for wi, w in enumerate(words) for c in w['text'] if c.isalnum()]
    matches = SequenceMatcher(None, ''.join(c for c,_ in source), ''.join(c for c,_ in target), autojunk=False).get_matching_blocks()
    removed = set()
    for start, end in groups:
        indices = [source[b.a+k][1] for b in matches for k in range(b.size) if start <= target[b.b+k][1] < end]
        if indices:
            removed.update(range(min(indices), max(indices)+1))
    cleaned = text
    for start, end in reversed(groups):
        cleaned = cleaned[:start] + cleaned[end:]
    discarded = [{'text':text[a:b], 'words':[w for i,w in enumerate(words) if i in removed]} for a,b in groups]
    return cleaned.strip(), [w for i,w in enumerate(words) if i not in removed], discarded
