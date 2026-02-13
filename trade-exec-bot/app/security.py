from __future__ import annotations

import hmac
from hashlib import sha256


def verify_hmac_signature(secret: str, raw_body: bytes, signature: str | None) -> bool:
    if not secret or not signature:
        return False
    provided = signature.strip()
    if provided.lower().startswith("sha256="):
        provided = provided.split("=", 1)[1]
    expected = hmac.new(secret.encode("utf-8"), raw_body, sha256).hexdigest()
    return hmac.compare_digest(expected, provided)


def ip_allowed(client_ip: str | None, allowed_ips: set[str]) -> bool:
    if not allowed_ips:
        return True
    if not client_ip:
        return False
    return client_ip in allowed_ips
