import unittest
from lyric_line_windows import clean_line, phrase_windows

class PhraseWindows(unittest.TestCase):
    def test_web_metadata_and_guitar(self):
        self.assertIsNone(clean_line('music163com'))
        self.assertIsNone(clean_line('我要你 百度百科'))
        self.assertEqual(clean_line('都怪这 guitar 弹得太凄凉'),'都怪这吉他弹得太凄凉')

    def test_pasted_verse_order_does_not_squeeze_chorus_into_earlier_gap(self):
        text='我在他乡望着月亮我要美丽的衣裳都怪这吉他弹得太凄凉哦我要唱着歌你在何方眼看天亮'
        source=[(c,30+i*.4) for i,c in enumerate(text)]
        lines=['我在他乡望着月亮','都怪这guitar弹得太凄凉','哦我要唱着歌','你在何方眼看天亮','我要美丽的衣裳']
        matches=phrase_windows(lines,source)
        self.assertTrue(all(matches))
        self.assertGreaterEqual(matches[1]['start'],matches[4]['end'])
        self.assertGreater(matches[3]['start'],matches[2]['end']-.5)

    def test_repeated_occurrences_consumed_once_and_in_time_order(self):
        text='你在何方眼看天亮哦我要唱着歌你在何方眼看天亮哦我要唱着歌你在何方眼看天亮'
        source=[(c,i*.3) for i,c in enumerate(text)]
        matches=phrase_windows(['哦我要唱着歌','你在何方眼看天亮','哦我要唱着歌','你在何方眼看天亮'],source)
        self.assertTrue(all(matches))
        self.assertTrue(all(a['start']<b['start'] for a,b in zip(matches,matches[1:])))

if __name__=='__main__':unittest.main()


class ManualAnchorTests(unittest.TestCase):
    def test_missing_phrase_uses_partial_manual_words(self):
        from lyric_line_windows import manual_phrase_windows
        result=manual_phrase_windows(['思念是一种病','后来我才知道'],[dict(text='思念',start=20,end=20.8)],[None,dict(start=40,end=44,anchors={},similarity=1)],60)
        self.assertTrue(result[0]['manual'])
        self.assertLess(result[0]['start'],20)
        self.assertGreater(result[0]['end'],20.8)
        self.assertEqual(result[1]['start'],40)

    def test_repeated_phrases_keep_separate_occurrences(self):
        from lyric_line_windows import manual_phrase_windows
        result=manual_phrase_windows(['思念是一种病','思念是一种病'],[dict(text='思念',start=20,end=20.8),dict(text='思念',start=50,end=50.8)],[None,None],60)
        self.assertTrue(result[0]['manual'])
        self.assertTrue(result[1]['manual'])
        self.assertLess(result[0]['end'],result[1]['start'])
