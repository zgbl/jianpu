import unittest
from lyric_line_windows import clean_line, phrase_windows

class PhraseWindows(unittest.TestCase):
    def test_wrong_suffix_words_still_extend_sung_timing_window(self):
        from lyric_line_windows import matched_search_end
        match=dict(start=81,end=85.22,anchors={5:83.7,6:84.12,7:84.62})
        words=[dict(text='面',start=84.62,end=85.46),dict(text='身',start=85.46,end=87.12),dict(text='上',start=87.12,end=88.82)]
        self.assertAlmostEqual(matched_search_end('徒留我孤单在湖面成双',match,words,240,116),89.82)
        self.assertEqual(matched_search_end('徒留我孤单在湖面成双',match,words,240,88),88)

    def test_suffix_does_not_borrow_words_after_instrumental_break(self):
        from lyric_line_windows import matched_search_end
        match=dict(start=81,end=85.22,anchors={7:84.62})
        end=matched_search_end('徒留我孤单在湖面成双',match,[dict(text='花已向晚',start=116,end=120)],240)
        self.assertLess(end,90)

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

class OrderedPhraseTests(unittest.TestCase):
    def test_full_transcript_does_not_jump_to_last_chorus_then_back(self):
        lines=['开头唱一句','哎呀我有点胆怯','我怕浪费情绪的错觉','哎呀我有点胆怯','最后唱一句']
        text='开头唱一句哎呀我有点胆我怕浪费情绪的错觉哎呀我有点胆怯最后唱一句'
        matches=phrase_windows(lines,[(c,i*.3) for i,c in enumerate(text)],ordered=True)
        self.assertTrue(all(matches))
        self.assertTrue(all(a['end']<=b['start'] for a,b in zip(matches,matches[1:])))

    def test_missing_line_stays_missing_instead_of_reusing_earlier_words(self):
        matches=phrase_windows(['前面这句话','后面这句话','前面这句话'],[(c,i*.3) for i,c in enumerate('前面这句话后面这句话')],ordered=True)
        self.assertIsNone(matches[-1])
