"""Polite access to public portals: one record at a time, robots.txt, >= 5 s gap, cache.

There is no crawler. `polite_get` fetches single pages you list; parsers.py then
reads auction notices and saved tables. The portals could not be inspected from
the build environment, so read their terms first and check results by eye.
"""
from __future__ import annotations

import hashlib
import time
from urllib import robotparser
from urllib.parse import urlparse

import requests

from ..config import CFG, ROOT

CACHE = ROOT / "data" / "cache"
_last = 0.0
UA = "BhoomiPulse-prototype/0.1 (academic research; contact via repository issues)"


def polite_get(url: str) -> str:
    """GET with robots.txt check, throttle and on-disk cache. Raises if disallowed."""
    global _last
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / (hashlib.sha1(url.encode()).hexdigest() + ".html")
    if f.exists():
        return f.read_text()
    u = urlparse(url)
    rp = robotparser.RobotFileParser(f"{u.scheme}://{u.netloc}/robots.txt")
    rp.read()
    if not rp.can_fetch(UA, url):
        raise PermissionError(f"robots.txt disallows {url}; use the CSV template instead")
    wait = CFG["live"]["portal_min_seconds_between_requests"] - (time.time() - _last)
    if wait > 0:
        time.sleep(wait)
    r = requests.get(url, headers={"User-Agent": UA}, timeout=60)
    _last = time.time()
    r.raise_for_status()
    f.write_text(r.text)
    return r.text
