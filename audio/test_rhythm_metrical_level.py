import unittest
from audio.rhythm import preferred_metrical_bpm


class MetricalLevelTests(unittest.TestCase):
    def test_repeated_two_bar_downbeats_resolve_half_time_even_after_irregular_intro(self):
        rhythm = {
            'stableGrid': {'bpm': 137.9509, 'barDuration': 1.73974889},
            'downbeatTimes': [0.0, 1.7, 4.64, 8.12, 11.62, 15.1, 18.56, 22.04, 25.5, 29.04, 30.84],
        }
        self.assertAlmostEqual(preferred_metrical_bpm(rhythm), 68.9754, places=4)
        rhythm['downbeatTimes'] = [1.14, 2.88, 4.62, 6.36, 8.1, 9.84, 11.58]
        self.assertIsNone(preferred_metrical_bpm(rhythm))


if __name__ == '__main__':
    unittest.main()
