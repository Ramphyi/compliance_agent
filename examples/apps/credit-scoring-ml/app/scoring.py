"""Scoring and the automated approve/decline decision."""
from app import config
from app.model import load_model

# Gender is encoded directly as a model feature.
GENDER_ENCODING = {"male": 1.0, "female": 0.0, "m": 1.0, "f": 0.0}


def build_features(application):
    """Turn a raw application into the model's feature dict."""
    return {
        "income": application.get("income", 0),
        "debt": application.get("debt", 0),
        "employment_years": application.get("employment_years", 0),
        "requested_amount": application.get("requested_amount", 0),
        "age": application.get("age", 0),
        "gender": GENDER_ENCODING.get(str(application.get("gender", "")).lower(), 0.0),
    }


def decide(application, bureau_score=None, model_path=None):
    """Score the application and return the automated decision.

    The decision is final: an application that scores below the threshold is
    declined and the result is returned straight to the caller.
    """
    model = load_model(model_path)
    features = build_features(application)
    score = model.score(features)

    if bureau_score is not None:
        score = 0.7 * score + 0.3 * bureau_score

    approved = score >= config.APPROVE_THRESHOLD
    return {
        "approved": approved,
        "score": round(score, 4),
        "decision": "approve" if approved else "decline",
    }
