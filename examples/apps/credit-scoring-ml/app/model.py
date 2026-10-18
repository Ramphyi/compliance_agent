"""Logistic-regression model and loader."""
import math
import pickle

from app import config

# Order of the feature vector the model expects.
FEATURE_ORDER = [
    "income",
    "debt",
    "employment_years",
    "requested_amount",
    "age",
    "gender",
]


class LogisticModel:
    """A plain logistic-regression scorer."""

    def __init__(self, weights, bias, means, scales):
        self.weights = weights
        self.bias = bias
        self.means = means
        self.scales = scales

    def _vector(self, features):
        return [float(features.get(name, 0.0)) for name in FEATURE_ORDER]

    def score(self, features):
        x = self._vector(features)
        z = self.bias
        for i, name in enumerate(FEATURE_ORDER):
            standardized = (x[i] - self.means[i]) / self.scales[i]
            z += self.weights[name] * standardized
        return 1.0 / (1.0 + math.exp(-z))


def load_model(path=None):
    """Load a serialised model. The path may be overridden per request."""
    model_path = path or config.DEFAULT_MODEL_PATH
    with open(model_path, "rb") as fh:
        return pickle.load(fh)
