"""Train (hand-set) and serialise the toy logistic model.

Run from the app root:  python3 tools/make_model.py
"""
import os
import pickle
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.model import LogisticModel, FEATURE_ORDER  # noqa: E402

# Hand-set coefficients for the demo. Positive weights raise the approval
# probability, negative weights lower it.
WEIGHTS = {
    "income": 1.3,
    "debt": -1.1,
    "employment_years": 0.6,
    "requested_amount": -0.7,
    "age": 0.25,
    "gender": 0.4,
}
BIAS = 0.1

# Standardisation parameters (per feature, in FEATURE_ORDER).
MEANS = [3000.0, 500.0, 5.0, 10000.0, 40.0, 0.5]
SCALES = [1500.0, 400.0, 4.0, 8000.0, 12.0, 0.5]


def main():
    model = LogisticModel(WEIGHTS, BIAS, MEANS, SCALES)
    out = os.path.join(os.path.dirname(__file__), "..", "models", "model.pkl")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "wb") as fh:
        pickle.dump(model, fh)
    print("wrote", os.path.normpath(out), "features:", FEATURE_ORDER)


if __name__ == "__main__":
    main()
