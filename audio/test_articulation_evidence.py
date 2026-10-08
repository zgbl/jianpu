import importlib,unittest
import numpy as np
m=importlib.import_module('articulation-evidence')

class ArticulationTests(unittest.TestCase):
    def prefix(self,change=.85,onsets=(.16,)):
        n=80;raw=np.full(n,55.);energy=np.ones(n)*.08;energy[:10]=0
        changes=np.zeros(n);changes[17]=change
        event=dict(start=.304,end=.784,performanceStart=.304,performanceEnd=.784,midi=55,
                   coreStart=.304,coreEnd=.784,pitchCenterMidi=54.9,pitchStatus='candidate',
                   evidenceFrameRange=[19,49],ornaments=[],confidence=.8)
        return [event],raw,np.zeros(n,bool),np.ones(n)*.1,energy,changes,onsets,.016
    def test_unvoiced_prefix_is_diagnostic_only_and_cannot_invent_or_move_a_note(self):
        import copy
        args=self.prefix();before=copy.deepcopy(args[0])
        e,p=m.split_articulations(*args)
        self.assertEqual(e,before);self.assertEqual(len(e),1)
        self.assertTrue(p[0]['borrowedPitch']);self.assertTrue(p[0]['diagnosticsOnly'])
        self.assertEqual(p[0]['start'],.16);self.assertEqual(p[0]['end'],.272)
    def test_spectral_change_alone_or_quiet_attack_cannot_create_a_note(self):
        for args in [self.prefix(onsets=()),self.prefix(change=.1)]:
            self.assertEqual(len(m.split_articulations(*args)[0]),1)
        args=list(self.prefix());args[4][:18]=0
        self.assertEqual(len(m.split_articulations(*args)[0]),1)
    def test_pitch_mismatch_and_existing_event_block_prefix_recovery(self):
        args=list(self.prefix());args[1][:18]=60
        self.assertEqual(len(m.split_articulations(*args)[0]),1)
        args=list(self.prefix());args[0]=[dict(start=.16,end=.30,pitchStatus='uncertain')]+args[0]
        self.assertEqual(len(m.split_articulations(*args)[0]),2)
    def test_internal_repeat_requires_spectrum_and_reattack(self):
        args=list(self.prefix(onsets=(.512,)));args[0][0].update(start=0,performanceStart=0,coreStart=0,evidenceFrameRange=[0,49])
        args[4][:]=.08;args[5][:]=0;args[5][32]=.7;args[4][30:33]=.02
        e,p=m.split_articulations(*args);self.assertEqual(len(e),2);self.assertFalse(p[0]['borrowedPitch'])
        args[4][:]=.08;args[2][:]=True
        self.assertEqual(len(m.split_articulations(*args)[0]),1)
    def test_spectral_shape_is_gain_invariant_for_a_sustained_tone(self):
        sr=16000;t=np.arange(sr)/sr;y=np.sin(2*np.pi*196*t);a=m.spectral_changes(y,sr,256);b=m.spectral_changes(y*.1,sr,256)
        self.assertLess(np.max(np.abs(a-b)),1e-8);self.assertLess(np.max(a[8:-8]),.01)

if __name__=='__main__':unittest.main()
