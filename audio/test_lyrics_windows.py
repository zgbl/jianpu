import importlib
import unittest
import numpy as np
m=importlib.import_module('lyrics-align')
class LyricWindows(unittest.TestCase):
    def test_missing_lines_share_whole_gap_before_next_anchor(self):
        groups=m.line_groups(['前句','天台','等待','后句'],{0:110,1:111,6:155,7:156})
        self.assertEqual([len(g) for g in groups],[1,2,1])
        start,end=m.search_window(groups[1],{0:110,1:111,6:155,7:156},250,116)
        self.assertEqual(start,116);self.assertAlmostEqual(end,154.95)
    def test_known_window_is_bounded_and_never_goes_back(self):
        anchors={0:100,1:101,2:104,3:105}
        group=m.line_groups(['前句','后句'],anchors)[0]
        start,end=m.search_window(group,anchors,200,102)
        self.assertEqual(start,102);self.assertLess(end,104)
    def test_single_coincidental_character_does_not_place_whole_line(self):
        chars=[dict(text=c,start=162+i,end=162+i+.1,status='acoustic' if i==2 else 'pending') for i,c in enumerate('流星的天台')]
        self.assertFalse(m.accept_line_timing(chars))
        self.assertTrue(all(c['timingUnresolved'] and 'start' not in c for c in chars))
        self.assertEqual(chars[2]['observedStart'],164)
    def test_supported_partial_line_keeps_weak_neighbours(self):
        chars=[dict(text=c,start=140+i,end=140+i+.1,status='acoustic' if i<2 else 'pending') for i,c in enumerate('天台上')]
        self.assertTrue(m.accept_line_timing(chars));self.assertEqual(chars[2]['start'],142)
    def test_weak_line_is_retained_as_estimate_without_acoustic_anchors(self):
        chars=[dict(text=c,start=24+i*.4,end=24+i*.4+.2,status='acoustic' if i==2 else 'pending') for i,c in enumerate('亲爱的你')]
        self.assertFalse(m.accept_line_timing(chars))
        m.restore_estimated_timing(chars,23,28)
        self.assertTrue(all(c['status']=='estimated' and not c.get('timingUnresolved') for c in chars))
        self.assertEqual(chars[0]['start'],24)
        self.assertTrue(all(a['end']<=b['start'] for a,b in zip(chars,chars[1:])))
    def test_failed_ctc_gets_bounded_draft_between_reliable_neighbours(self):
        chars=[dict(text='前',status='acoustic',start=10,end=11),dict(text='子',status='pending',timingUnresolved=True),dict(text='想',status='pending',timingUnresolved=True),dict(text='后',status='acoustic',start=14,end=15)]
        m.restore_estimated_timing(chars,9,16)
        self.assertEqual(chars[0]['start'],10);self.assertEqual(chars[-1]['start'],14)
        self.assertEqual(chars[1]['status'],'estimated');self.assertTrue(11<=chars[1]['start']<chars[2]['end']<=14)
    def test_joint_ctc_does_not_reuse_frames_for_next_phrase(self):
        logp=np.log(np.array([[.01,.98,.01],[.01,.98,.01],[.98,.01,.01],[.01,.01,.98],[.01,.01,.98]]))
        result=m.ctc_align(logp,[1,2],0)
        self.assertIsNotNone(result);self.assertLessEqual(result[0][1],result[1][0])
if __name__=='__main__':unittest.main()
