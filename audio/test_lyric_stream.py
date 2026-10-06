import unittest
from lyric_stream import recognition_windows, window_words, vocal_decode_window

class LyricStream(unittest.TestCase):
    def test_short_tail_and_context_overlap(self):
        self.assertEqual(list(recognition_windows(65)),[(0,30,0,31.5),(30,60,28.5,61.5),(60,65,58.5,65)])
        self.assertEqual(list(recognition_windows(0)),[])

    def test_overlap_words_owned_once_and_keep_recording_seconds(self):
        first=[{'words':[{'word':'前','start':29,'end':29.5,'probability':.9},{'word':'边界','start':29.8,'end':30.2,'probability':.8}]}]
        second=[{'words':[{'word':'前','start':.5,'end':1,'probability':.9},{'word':'边界','start':1.3,'end':1.7,'probability':.8},{'word':'后','start':2,'end':3,'probability':.7}]}]
        result=window_words(first,0,0,30,str)+window_words(second,28.5,30,60,str)
        self.assertEqual([w['text'] for w in result],['前','边界','后'])
        self.assertAlmostEqual(result[1]['start'],29.8);self.assertEqual(result[-1]['end'],31.5)

    def test_long_intro_silence_is_trimmed_without_moving_recording_time(self):
        import numpy as np
        sr=1000
        audio=np.full(62000,.00006)
        audio[41500:61000]=.07
        low,high=vocal_decode_window(audio,sr,28.5,61.5)
        self.assertGreater(low,40)
        self.assertLess(low,41.5)
        self.assertEqual(high,61.5)
        words=window_words([{'words':[{'word':'对','start':41.6-low,'end':42-low,'probability':.9}]}],low,30,60,str)
        self.assertAlmostEqual(words[0]['start'],41.6)
        self.assertAlmostEqual(words[0]['end'],42)

    def test_silent_intro_skipped_but_inner_pause_retained(self):
        import numpy as np
        sr=1000
        audio=np.full(30000,.00006)
        self.assertIsNone(vocal_decode_window(audio,sr,0,30))
        audio[500:10000]=.06;audio[22000:29500]=.06
        self.assertEqual(vocal_decode_window(audio,sr,0,30),(0,30))

if __name__=='__main__':unittest.main()
