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
    def test_voiced_false_frames_are_not_used_as_pitch(self):
        f0=np.full(30,440*2**((60-69)/12))
        voiced=np.zeros(30,bool)
        e,_,d=module.extract_events(f0,voiced,np.full(30,.95),16,1000)
        self.assertEqual(e,[])
        self.assertTrue(d['voicedMaskApplied'])
    def test_global_tuning_is_applied_only_with_multi_note_evidence(self):
        pitches=np.concatenate([np.full(100,n+.20) for n in (60,62,64,65,67)])
        f0=440*2**((pitches-69)/12)
        e,_,d=module.extract_events(f0,np.ones(len(f0),bool),np.full(len(f0),.95),16,1000)
        self.assertTrue(d['tuning']['applied'])
        self.assertAlmostEqual(d['tuningCents'],20,delta=2)
        self.assertEqual([n['midi'] for n in e],[60,62,64,65,67])
    def test_single_note_does_not_define_global_tuning(self):
        e,_,d=self.decode([60.20]*500)
        self.assertFalse(d['tuning']['applied'])
        self.assertEqual(d['tuning']['reason'],'too-few-distinct-notes')
    def test_weak_stable_interior_note_is_recovered_but_not_trusted(self):
        p=np.r_[[60]*20,[62]*30,[64]*20];prob=np.r_[[.9]*20,[.08]*30,[.9]*20]
        e,_,d=self.decode(p,energy=np.ones(len(p)),probability=prob)
        self.assertEqual([n['midi'] for n in e],[60,62,64])
        self.assertEqual(e[1]['pitchStatus'],'uncertain');self.assertEqual(e[1]['confidence'],0)
        self.assertTrue(e[1]['reviewRequired']);self.assertEqual(d['recoveredLowConfidenceEvents'],1)
        self.assertTrue(all(a['end']<=b['start'] for a,b in zip(e,e[1:])))
    def test_weak_prelude_and_silent_or_source_gated_interior_not_recovered(self):
        p=np.r_[[55]*20,[60]*20,[62]*30,[64]*20];prob=np.r_[[.08]*20,[.9]*20,[.08]*30,[.9]*20]
        energy=np.ones(len(p));energy[40:70]=0
        e,_,_=self.decode(p,energy=energy,probability=prob)
        self.assertEqual([n['midi'] for n in e],[60,64])
        energy[:]=1;prob[40:70]=0
        e,_,_=self.decode(p,energy=energy,probability=prob)
        self.assertEqual([n['midi'] for n in e],[60,64])
    def test_weak_fast_glide_without_sustained_core_is_not_promoted(self):
        p=np.r_[[60]*20,np.linspace(61,70,20),[72]*20];prob=np.r_[[.9]*20,[.08]*20,[.9]*20]
        e,_,_=self.decode(p,energy=np.ones(len(p)),probability=prob)
        self.assertEqual([n['midi'] for n in e],[60,72])
    def test_recovery_never_bridges_across_short_strict_event(self):
        p=np.r_[[60]*16,[62]*20,[62]*5,[62]*20,[64]*16]
        prob=np.r_[[.9]*16,[.08]*20,[.9]*5,[.08]*20,[.9]*16]
        events,_,_=self.decode(p,energy=np.ones(len(p)),probability=prob)
        self.assertTrue(any(not e.get('recoveryReason') and e['midi']==62 for e in events))
        self.assertTrue(all(a['end']<=b['start'] for a,b in zip(events,events[1:])))
if __name__=='__main__':unittest.main()
