import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import auth, bureau
from app.scoring import decide


class AuthTest(unittest.TestCase):
    def setUp(self):
        auth.reset()

    def test_api_key_registration_and_lookup(self):
        auth.register_client("LenderOne", "secret-key-123")
        self.assertEqual(auth.client_for_key("secret-key-123"), "LenderOne")
        self.assertIsNone(auth.client_for_key("wrong-key"))

    def test_issue_token_length(self):
        token = auth.issue_token()
        self.assertGreaterEqual(len(token), 24)
        self.assertNotEqual(token, auth.issue_token())


class BureauTest(unittest.TestCase):
    def test_bureau_score_normalised(self):
        class FakeResp:
            def read(self_inner):
                return json.dumps({"score": 1.4}).encode("utf-8")

        score = bureau.fetch_bureau_score({"national_id": "x"}, opener=lambda req: FakeResp())
        self.assertEqual(score, 1.0)

    def test_bureau_unreachable_returns_none(self):
        def boom(req):
            raise OSError("unreachable")

        self.assertIsNone(bureau.fetch_bureau_score({}, opener=boom))


class DecisionShapeTest(unittest.TestCase):
    def test_decision_has_expected_keys(self):
        result = decide(
            {
                "income": 3000,
                "debt": 500,
                "employment_years": 5,
                "requested_amount": 10000,
                "age": 40,
                "gender": "female",
            }
        )
        self.assertEqual(set(result.keys()), {"approved", "score", "decision"})


if __name__ == "__main__":
    unittest.main()
