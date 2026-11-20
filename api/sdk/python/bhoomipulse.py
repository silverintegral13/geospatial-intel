"""Minimal Python client for the BhoomiPulse API (stdlib only).

    from bhoomipulse import Client
    bp = Client("https://api.bhoomipulse.example", api_key="bp_live_...")
    r = bp.assess(lat=22.9957, lon=72.3759, asset_type="residential", built_up_sqft=1150, loan_amount=3_500_000)
    print(r["score"]["grade"], r["valuation"]["p50"], r["decision"]["route"])
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.request


class BhoomiPulseError(Exception):
    pass


class Client:
    def __init__(self, base_url: str, api_key: str, timeout: float = 60):
        self.base = base_url.rstrip("/")
        self.key = api_key
        self.timeout = timeout

    def _req(self, method: str, path: str, body: dict | None = None, headers: dict | None = None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers={
            "Authorization": f"Bearer {self.key}", "Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                ctype = r.headers.get("Content-Type", "")
                raw = r.read()
                return json.loads(raw) if "json" in ctype else raw.decode()
        except urllib.error.HTTPError as e:
            raise BhoomiPulseError(f"{e.code}: {e.read().decode()[:300]}") from None

    def assess(self, idempotency_key: str | None = None, **asset):
        return self._req("POST", "/v1/assess", asset, {"Idempotency-Key": idempotency_key} if idempotency_key else None)

    def report_html(self, assessment_id: str) -> str:
        return self._req("GET", f"/v1/assessments/{assessment_id}/report")

    def batch(self, assets: list[dict], mode: str = "fast", webhook_url: str | None = None, wait: bool = True, poll: float = 3):
        job = self._req("POST", "/v1/batch", {"assets": assets, "mode": mode, "webhook_url": webhook_url})
        while wait and job.get("status") not in ("completed", "failed"):
            time.sleep(poll)
            job = self._req("GET", f"/v1/jobs/{job['id']}")
        return job

    def portfolio_audit(self, loans: list[dict]):
        return self._req("POST", "/v1/portfolio/audit", {"loans": loans})

    def monitor(self, asset: dict, webhook_url: str | None = None, cadence: str = "monthly"):
        return self._req("POST", "/v1/pulse/subscriptions", {"asset": asset, "webhook_url": webhook_url, "cadence": cadence})

    def audit_log(self, limit: int = 100):
        return self._req("GET", f"/v1/audit-log?limit={limit}")


def verify_webhook(secret: str, signature_header: str, body: bytes, tolerance_s: int = 300) -> bool:
    """Check X-BhoomiPulse-Signature: t=<unix>,v1=<hex>."""
    parts = dict(p.split("=", 1) for p in signature_header.split(","))
    if abs(time.time() - int(parts["t"])) > tolerance_s:
        return False
    expected = hmac.new(secret.encode(), f"{parts['t']}.".encode() + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts["v1"])
