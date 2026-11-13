"""Guard for a PUBLIC repo: block large files, secrets and restricted data.

Usage:
  python scripts/precommit_guard.py --staged    (pre-commit hook)
  python scripts/precommit_guard.py --tracked   (CI: every tracked file)
  python scripts/precommit_guard.py --history   (every blob in the git history)
"""
from __future__ import annotations

import re
import subprocess
import sys

MAX_BYTES = 50 * 1024 * 1024
BAD_PATH = re.compile(
    r"(^|/)(\.env(\..+)?|secrets\.toml|credentials.*\.json)$|^data/(raw|interim|cache)/"
    r"|freddie|\.(tif|tiff|nc|pem|key|safe)$|7[-_]12.*\.pdf$|8a.*\.pdf$",
    re.I,
)
ALLOW_PATH = re.compile(r"\.env\.example$")
SECRET = re.compile(
    r"sk-ant-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}"
    r"|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY-----"
    r"|xox[baprs]-[A-Za-z0-9-]{10,}"
)


def sh(*args: str) -> bytes:
    return subprocess.run(args, check=True, capture_output=True).stdout


def check(path: str, blob: bytes) -> list[str]:
    errs = []
    if BAD_PATH.search(path) and not ALLOW_PATH.search(path):
        errs.append(f"restricted path: {path}")
    if len(blob) > MAX_BYTES:
        errs.append(f"file over 50 MB: {path} ({len(blob) / 1e6:.0f} MB)")
    if b"\0" not in blob[:4096]:
        m = SECRET.search(blob.decode("utf-8", "ignore"))
        if m:
            errs.append(f"possible secret in {path}: {m.group(0)[:12]}...")
    return errs


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "--staged"
    errs: list[str] = []
    if mode == "--history":
        seen = set()
        for line in sh("git", "rev-list", "--objects", "--all").decode().splitlines():
            sha, _, path = line.partition(" ")
            if not path or sha in seen:
                continue
            seen.add(sha)
            if sh("git", "cat-file", "-t", sha).strip() != b"blob":
                continue
            errs += check(path, sh("git", "cat-file", "blob", sha))
        print(f"scanned {len(seen)} objects in history")
    else:
        cmd = (
            ["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"]
            if mode == "--staged"
            else ["git", "ls-files"]
        )
        for path in sh(*cmd).decode().splitlines():
            try:
                blob = sh("git", "show", f":{path}")
            except subprocess.CalledProcessError:
                continue
            errs += check(path, blob)
    for e in errs:
        print("BLOCKED:", e)
    if not errs:
        print("guard: ok")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
