import importlib
import unittest
import numpy as np
module=importlib.import_module('stable-pitch')
class StablePitch(unittest.TestCase):
    def decode(self, pitches, energy=None, onsets=(), probability=None):
        pitches=np.asarray(pitches,float)
        f0=np.where(np.isfinite(pitches),440*2**((pitches-69)/12),np.nan)
        return module.extract_events(f0,np.isfinite(pitches),np.full(len(pitches),.9) if probability is None else probability,16,1000,onsets,energy)
    def test_scoop_uses_destination_core_and_original_attack(self):
        e,_,_=self.decode(np.r_[np.linspace(60,64,18),np.full(30,64.)])
        self.assertEqual([n['midi'] for n in e],[64]);self.assertEqual(e[0]['start'],0)
        self.assertGreater(e[0]['coreStart'],.2);self.assertEqual(e[0]['ornaments'][0]['type'],'scoop')
    def test_semitone_legato_and_octave_remain_real(self):
        e,_,_=self.decode([60]*16+[61]*8+[73]*16)
        self.assertEqual([n['midi'] for n in e],[60,61,73])
    def test_short_stable_note_is_preserved(self):
        e,_,_=self.decode([60]*16+[62]*5+[64]*16)
        self.assertEqual([n['midi'] for n in e],[60,62,64])
    def test_vibrato_crossing_integer_boundary_is_one_note(self):
        t=np.arange(80)*.016
        e,_,_=self.decode(60+.6*np.sin(2*np.pi*6*t))
        self.assertEqual([n['midi'] for n in e],[60])
    def test_coreless_glide_is_uncertain_not_semitone_ladder(self):
        e,_,_=self.decode(np.linspace(60,70,45))
        self.assertEqual(len(e),1);self.assertEqual(e[0]['pitchStatus'],'uncertain');self.assertIsNone(e[0]['coreStart'])
    def test_real_silence_vs_energy_supported_missing(self):
        pitches=[60]*16+[np.nan]*4+[60]*16
        e,_,_=self.decode(pitches,energy=np.ones(36));self.assertEqual(len(e),1)
        energy=np.ones(36);energy[16:20]=0
        e,_,_=self.decode(pitches,energy=energy);self.assertEqual(len(e),2)
    def test_same_pitch_reattack(self):
        energy=np.ones(40);energy[16:20]=.3
        e,_,_=self.decode([60]*40,energy=energy,onsets=[.32]);self.assertEqual(len(e),2)
    def test_voicing_is_not_pitch_confidence_and_ambiguous_target_marked(self):
        e,_,d=self.decode([60.49]*30)
        self.assertEqual(e[0]['pitchStatus'],'uncertain');self.assertIsNone(e[0]['pitchReliability'])
        self.assertIn('not pitch',d['confidenceMeaning'])
    def test_low_probability_continuation_not_a_rest(self):
        e,_,_=self.decode([60]*30,probability=np.r_[[.9]*10,[.4]*20])
        self.assertEqual(len(e),1);self.assertEqual(e[0]['end'],.48)
if __name__=='__main__':unittest.main()
