import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import config
from app.model import load_model
from app.scoring import build_features, decide


class ScoringTest(unittest.TestCase):
    def test_model_file_exists_and_loads(self):
        model = load_model()
        self.assertTrue(hasattr(model, "score"))

    def test_strong_applicant_is_approved(self):
        app = {
            "income": 6000,
            "debt": 100,
            "employment_years": 12,
            "requested_amount": 5000,
            "age": 45,
            "gender": "female",
        }
        result = decide(app)
        self.assertEqual(result["decision"], "approve")
        self.assertTrue(result["approved"])
        self.assertGreaterEqual(result["score"], config.APPROVE_THRESHOLD)

    def test_weak_applicant_is_declined(self):
        app = {
            "income": 900,
            "debt": 2000,
            "employment_years": 0,
            "requested_amount": 40000,
            "age": 22,
            "gender": "male",
        }
        result = decide(app)
        self.assertEqual(result["decision"], "decline")
        self.assertFalse(result["approved"])

    def test_bureau_score_blended(self):
        app = {
            "income": 3000,
            "debt": 500,
            "employment_years": 5,
            "requested_amount": 10000,
            "age": 40,
            "gender": "female",
        }
        high = decide(app, bureau_score=1.0)["score"]
        low = decide(app, bureau_score=0.0)["score"]
        self.assertGreater(high, low)

    def test_build_features_encodes_gender(self):
        f = build_features({"gender": "male"})
        self.assertEqual(f["gender"], 1.0)
        f = build_features({"gender": "female"})
        self.assertEqual(f["gender"], 0.0)


if __name__ == "__main__":
    unittest.main()
