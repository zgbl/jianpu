import importlib
import unittest
import numpy as np
extract = importlib.import_module('pitch-segmentation').extract_events
class PitchSegments(unittest.TestCase):
    def run_pitch(self, midi, probability=None, energy=None, onsets=()):
        midi=np.asarray(midi,float);f0=np.where(midi>0,440*2**((midi-69)/12),np.nan)
        return extract(f0,midi>0,np.ones(len(midi))*.9 if probability is None else probability,16,1000,onsets,energy)
    def test_low_confidence_tail_is_not_rest(self):
        events,_,_=self.run_pitch([60]*30,[.8]*10+[.4]*20)
        self.assertEqual(len(events),1);self.assertAlmostEqual(events[0]['end'],.48)
    def test_unseeded_noise_rejected(self):
        self.assertEqual(self.run_pitch([60]*30,[.4]*30)[0],[])
    def test_short_dropout_sustained_energy(self):
        e,_,d=self.run_pitch([60]*10+[0]*4+[60]*10,energy=np.ones(24))
        self.assertEqual(len(e),1);self.assertEqual(d['filledDropouts'],1)
    def test_real_silence_and_different_notes_not_filled(self):
        energy=np.ones(24);energy[10:14]=0
        self.assertEqual(len(self.run_pitch([60]*10+[0]*4+[60]*10,energy=energy)[0]),2)
        self.assertEqual(len(self.run_pitch([60]*10+[0]*4+[62]*10,energy=np.ones(24))[0]),2)
    def test_bracketed_octave_error_and_real_octave(self):
        self.assertEqual(len(self.run_pitch([60]*10+[72]*3+[60]*10)[0]),1)
        self.assertEqual([e['midi'] for e in self.run_pitch([60]*10+[72]*10)[0]],[60,72])
    def test_real_short_step_retained(self):
        self.assertEqual([e['midi'] for e in self.run_pitch([60]*10+[62]*5+[64]*10)[0]],[60,62,64])
    def test_onset_needs_energy_dip(self):
        self.assertEqual(len(self.run_pitch([60]*40,energy=np.ones(40),onsets=[.32])[0]),1)
        energy=np.ones(40);energy[16:20]=.2
        self.assertEqual(len(self.run_pitch([60]*40,energy=energy,onsets=[.32])[0]),2)
if __name__=='__main__':unittest.main()
