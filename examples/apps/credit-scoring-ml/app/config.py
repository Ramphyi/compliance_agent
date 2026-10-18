"""Service configuration."""
import os

# Enable verbose responses and the debug endpoints.
DEBUG = True

HOST = os.environ.get("CREDITAS_HOST", "0.0.0.0")
PORT = int(os.environ.get("CREDITAS_PORT", "8081"))

# Path to the serialised model. Operators can point the service at a different
# model file per deployment.
DEFAULT_MODEL_PATH = os.environ.get(
    "CREDITAS_MODEL",
    os.path.join(os.path.dirname(__file__), "..", "models", "model.pkl"),
)

# Decision threshold: applications scoring at or above this are approved.
APPROVE_THRESHOLD = 0.55

# Credit bureau API.
BUREAU_URL = os.environ.get("CREDITAS_BUREAU_URL", "https://bureau.example.com/v2/score")
BUREAU_API_KEY = os.environ.get("CREDITAS_BUREAU_KEY", "demo-bureau-key")
