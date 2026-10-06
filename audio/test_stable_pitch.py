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
    def test_flat_peak_near_boundary_is_proposed_as_distinct_note_and_stays_uncertain(self):
        events,_,d=self.decode(np.r_[[57.1]*20,[59.4]*12,[np.nan]*8,[59.05]*12,[57]*20],energy=np.ones(72))
        self.assertEqual([e['midi'] for e in events],[57,60,59,57])
        peak=events[1];self.assertEqual(peak['pitchStatus'],'uncertain');self.assertEqual(peak['confidence'],0)
        self.assertEqual(peak['acousticNearestMidi'],59);self.assertEqual(peak['pitchAlternatives'],[59,60])
        self.assertAlmostEqual(peak['pitchCenterMidi'],59.4);self.assertEqual(len(d['contextualPitchProposals']),1)
    def test_ordinary_intonation_repeats_and_coreless_peaks_are_not_raised(self):
        events,_,d=self.decode(np.r_[[57]*20,[59.2]*12,[59.05]*12,[57]*20])
        self.assertNotIn(60,[e['midi'] for e in events]);self.assertEqual(d['contextualPitchProposals'],[])
    def test_brief_plateau_in_smooth_scoop_uses_destination_not_extra_semitone(self):
        pitches=np.r_[[58.2]*5,[58.4,58.6,58.9,59.1],[59.3]*14]
        events,_,d=self.decode(pitches,energy=np.ones(len(pitches)),onsets=[.032])
        self.assertEqual([e['midi'] for e in events],[59])
        self.assertEqual(events[0]['start'],0)
        self.assertEqual(len(d['absorbedTransitions']),1)
        self.assertTrue(any(o['type']=='scoop' for o in events[0]['ornaments']))
    def test_short_semitone_with_discrete_step_or_reattack_is_kept(self):
        events,_,_=self.decode(np.r_[[58.2]*5,[59.3]*14])
        self.assertEqual([e['midi'] for e in events],[58,59])
        pitches=np.r_[[58.2]*5,[58.4,58.6,58.9,59.1],[59.3]*14]
        energy=np.ones(len(pitches));energy[4:6]=.2
        events,_,_=self.decode(pitches,energy=energy,onsets=[.096])
        self.assertEqual([e['midi'] for e in events],[58,59])
    def test_weak_first_note_needs_nearby_onset_and_stable_core(self):
        pitches=np.r_[[59]*20,[57]*20,[60]*20]
        prob=np.r_[[.08]*20,[.9]*40]
        events,_,_=self.decode(pitches,energy=np.ones(len(pitches)),probability=prob,onsets=[0])
        self.assertEqual([e['midi'] for e in events],[59,57,60])
        self.assertEqual(events[0]['pitchStatus'],'uncertain')
        self.assertTrue(events[0]['reviewRequired'])
        events,_,_=self.decode(pitches,energy=np.ones(len(pitches)),probability=prob)
        self.assertEqual([e['midi'] for e in events],[57,60])
    def test_vibrato_crossing_integer_boundary_is_one_note(self):
        t=np.arange(80)*.016
        e,_,_=self.decode(60+.6*np.sin(2*np.pi*6*t))
        self.assertEqual([n['midi'] for n in e],[60])
    def test_coreless_glide_is_uncertain_not_semitone_ladder(self):
        e,_,_=self.decode(np.linspace(60,70,45))
        self.assertEqual(len(e),1);self.assertEqual(e[0]['pitchStatus'],'uncertain');self.assertIsNone(e[0]['coreStart'])
    def test_brief_coreless_noise_attaches_to_dominant_range_not_pitch_center(self):
        main=dict(start=0,end=.4,performanceStart=0,performanceEnd=.4,midi=60,
                  pitchCenterMidi=60.1,pitchStatus='candidate',coreStart=.032,coreEnd=.368,evidenceFrameRange=[0,25])
        fragment=dict(start=.4,end=.48,performanceStart=.4,performanceEnd=.48,midi=63,
                      pitchCenterMidi=63.4,pitchStatus='uncertain',coreStart=None,coreEnd=None,evidenceFrameRange=[25,30])
        events,absorbed=module.absorb_noise_fragments([main,fragment],.016,module.DEFAULTS,[],np.ones(40))
        self.assertEqual(len(events),1);self.assertEqual(main['end'],.48)
        self.assertEqual(main['midi'],60);self.assertEqual(main['pitchCenterMidi'],60.1)
        self.assertEqual(main['coreEnd'],.368);self.assertEqual(len(absorbed),1)
    def test_noise_absorption_preserves_reattacks_stable_short_notes_and_silence(self):
        import copy
        main=dict(start=0,end=.4,performanceStart=0,performanceEnd=.4,midi=60,
                  pitchCenterMidi=60.1,pitchStatus='candidate',coreStart=.032,coreEnd=.368,evidenceFrameRange=[0,25])
        fragment=dict(start=.4,end=.48,performanceStart=.4,performanceEnd=.48,midi=63,
                      pitchCenterMidi=63.4,pitchStatus='uncertain',coreStart=None,coreEnd=None,evidenceFrameRange=[25,30])
        for energy,onsets,extra in [(np.r_[np.ones(23),[.2,.2],np.ones(15)],[25],{}),
                                   (np.r_[np.ones(24),[0],np.ones(15)],[],{}),
                                   (np.ones(40),[],{'coreStart':.416,'coreEnd':.464})]:
            events,absorbed=module.absorb_noise_fragments([copy.deepcopy(main),{**fragment,**extra}],.016,module.DEFAULTS,onsets,energy)
            self.assertEqual(len(events),2);self.assertEqual(absorbed,[])
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
    def test_weak_same_pitch_tail_is_continuation_not_new_note(self):
        pitches=np.r_[[64]*20,[64.1]*10,[62]*20]
        probability=np.r_[[.9]*20,[.03]*10,[.9]*20]
        events,_,d=self.decode(pitches,energy=np.ones(len(pitches)),probability=probability)
        self.assertEqual([e['midi'] for e in events],[64,62])
        self.assertAlmostEqual(events[0]['end'],.48)
        self.assertTrue(events[0]['reviewRequired'])
        self.assertEqual(events[0]['reviewReason'],'low-voicing-continuation')
        self.assertEqual(d['attachedLowConfidenceContinuations'],1)
        self.assertEqual(events[0]['coreEnd'],.32)
    def test_weak_same_pitch_reattack_is_not_attached(self):
        pitches=np.r_[[64]*20,[64]*14,[62]*20]
        probability=np.r_[[.9]*20,[.03]*14,[.9]*20]
        energy=np.ones(len(pitches));energy[17:20]=.2
        events,_,d=self.decode(pitches,energy=energy,probability=probability,onsets=[.32])
        self.assertEqual([e['midi'] for e in events],[64,64,62])
        self.assertEqual(d['attachedLowConfidenceContinuations'],0)
if __name__=='__main__':unittest.main()
