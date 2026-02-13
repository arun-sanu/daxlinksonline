from __future__ import annotations

from typing import Any

import httpx


class DaxLinksClient:
    def __init__(self, url: str, token: str, timeout_seconds: float = 12.0):
        self.url = url
        self.token = token
        self.timeout_seconds = timeout_seconds

    def post_order_result(self, payload: dict[str, Any]) -> dict[str, Any]:
        headers = {
            "Content-Type": "application/json",
            "x-internal-token": self.token,
        }
        with httpx.Client(timeout=self.timeout_seconds) as client:
            response = client.post(self.url, json=payload, headers=headers)
        if response.status_code >= 400:
            raise RuntimeError(
                f"DaxLinks internal write failed ({response.status_code}): {response.text[:500]}"
            )
        return response.json()
