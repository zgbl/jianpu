import unittest,tempfile
from pathlib import Path
from unittest.mock import patch
import numpy as np
from chords import accompaniment,mix_tracks

class AccompanimentTest(unittest.TestCase):
 def test_piano_is_included_even_when_guitar_is_silent(self):
  with tempfile.TemporaryDirectory() as directory:
   folder=Path(directory)
   for name in ['vocals','piano','guitar','other','clip']:(folder/(name+'.wav')).touch()
   data={'piano':np.array([.2,.1,0],dtype=np.float32),'guitar':np.zeros(3),'other':np.zeros(3)}
   with patch('chords.mono_audio',side_effect=lambda path:(data[path.stem],{})):
    y,source=accompaniment(folder/'vocals.wav')
   np.testing.assert_allclose(y,data['piano']);self.assertIn('piano',source)
 def test_stems_share_origin_and_pad_not_concatenate(self):
  np.testing.assert_allclose(mix_tracks([np.array([1.,2.,3.]),np.array([.5,.5])]),[1.5,2.5,3.])
 def test_all_silent_stems_fall_back_to_clip(self):
  with tempfile.TemporaryDirectory() as directory:
   folder=Path(directory)
   for name in ['vocals','piano','guitar','clip']:(folder/(name+'.wav')).touch()
   with patch('chords.mono_audio',side_effect=lambda path:(np.ones(3) if path.stem=='clip' else np.zeros(3),{})):
    y,source=accompaniment(folder/'vocals.wav')
   self.assertEqual(source,'clip');np.testing.assert_allclose(y,np.ones(3))
if __name__=='__main__':unittest.main()
