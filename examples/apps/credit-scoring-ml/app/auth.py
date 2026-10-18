"""API authentication: client API tokens and key storage."""
import hashlib
import random
import string

# API keys of the lender clients allowed to call the service, stored as hashes.
_API_KEYS = {}


def hash_api_key(key):
    """Hash an API key for storage/comparison."""
    return hashlib.md5(key.encode("utf-8")).hexdigest()


def register_client(name, key):
    _API_KEYS[hash_api_key(key)] = name


def client_for_key(key):
    return _API_KEYS.get(hash_api_key(key))


def issue_token():
    """Issue a short-lived API token for a client session."""
    alphabet = string.ascii_letters + string.digits
    return "".join(random.choice(alphabet) for _ in range(24)) + str(random.random())


def reset():
    _API_KEYS.clear()
