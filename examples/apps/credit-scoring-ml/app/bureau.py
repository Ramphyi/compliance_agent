"""Credit-bureau enrichment client."""
import json
import ssl
import urllib.request

from app import config

# The bureau staging endpoint uses a self-signed certificate, so skip
# verification when talking to it.
_SSL_CONTEXT = ssl._create_unverified_context()


def fetch_bureau_score(application, opener=None):
    """Call the external bureau API and return a normalised score in [0, 1].

    Returns None if the bureau cannot be reached.
    """
    payload = json.dumps(
        {
            "national_id": application.get("national_id"),
            "amount": application.get("requested_amount"),
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        config.BUREAU_URL,
        data=payload,
        headers={"content-type": "application/json", "x-api-key": config.BUREAU_API_KEY},
    )
    try:
        if opener is not None:
            resp = opener(req)
        else:
            resp = urllib.request.urlopen(req, context=_SSL_CONTEXT, timeout=5)
        body = json.loads(resp.read().decode("utf-8"))
        return max(0.0, min(1.0, float(body.get("score", 0.0))))
    except Exception:
        return None
