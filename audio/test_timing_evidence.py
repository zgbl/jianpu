import importlib
import math
import unittest
module = importlib.import_module('timing-evidence')

class TimingEnergyTests(unittest.TestCase):
    def test_normalized_energy_retains_later_mass_without_changing_event(self):
        e = dict(start=.1, end=.5, midi=60, coreStart=.25, coreEnd=.45)
        module.attach_timing_energy([e], [0, 1, 1, 3, 3], .1, bins=4)
        self.assertEqual(e['midi'], 60)
        self.assertAlmostEqual(sum(e['timingEnergy']['weights']), 1, places=6)
        self.assertGreater(sum(e['timingEnergy']['weights'][2:]), .8)
        self.assertEqual(e['coreStart'], .25)

    def test_silence_and_invalid_energy_do_not_create_evidence(self):
        events = [dict(start=0, end=.3), dict(start=.3, end=.4)]
        module.attach_timing_energy(events, [0, math.nan, -1, 0], .1)
        self.assertTrue(all('timingEnergy' not in e for e in events))

    def test_long_events_have_bounded_payload(self):
        e = dict(start=0, end=20)
        module.attach_timing_energy([e], [1]*2000, .01)
        self.assertEqual(len(e['timingEnergy']['weights']), 32)

if __name__ == '__main__':
    unittest.main()
