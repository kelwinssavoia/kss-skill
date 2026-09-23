"""KSS QA evidence helpers — loaded by browser-use from $BH_AGENT_WORKSPACE/agent_helpers.py.

The blind driver records every step through these three calls; nothing else writes evidence.
Paths come from the environment qa.mjs sets: KSS_QA_EVIDENCE (this scenario's folder).
"""
import base64 as _b64
import json as _json
import os as _os
import re as _re
import time as _time

_DIR = _os.environ.get("KSS_QA_EVIDENCE", "")
_LOG = _os.path.join(_DIR, "steps.jsonl") if _DIR else ""
_STATUSES = ("pass", "fail", "blocked", "info")


def _h():
    # browser-use execs this file in its own module; its cdp/js live in browser_harness.helpers
    import browser_harness.helpers as h
    return h


def _next_index():
    if not _LOG or not _os.path.exists(_LOG):
        return 1
    with open(_LOG, encoding="utf-8") as f:
        return sum(1 for line in f if line.strip()) + 1


def _slug(text):
    return (_re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-") or "step")[:48]


def _shot(path, full=False):
    r = _h().cdp("Page.captureScreenshot", format="jpeg", quality=70, captureBeyondViewport=bool(full))
    with open(path, "wb") as f:
        f.write(_b64.b64decode(r["data"]))


def qa_step(title, expected, observed, status="info", full_page=False):
    """Record one step: a screenshot of the current page plus what was expected and what was seen.

    status: pass | fail | blocked | info. Call it after every meaningful action or check.
    """
    if not _DIR:
        raise RuntimeError("KSS_QA_EVIDENCE is not set")
    if status not in _STATUSES:
        raise ValueError(f"status must be one of {_STATUSES}")
    i = _next_index()
    name = f"{i:02d}-{_slug(title)}.jpg"
    try:
        _shot(_os.path.join(_DIR, name), full_page)
    except Exception as e:  # a failed screenshot never loses the step
        name = None
        observed = f"{observed} [screenshot failed: {e}]"
    try:
        url = _h().js("location.href")
    except Exception:
        url = None
    rec = {"i": i, "at": _time.strftime("%Y-%m-%dT%H:%M:%S"), "title": title, "expected": expected,
           "observed": observed, "status": status, "url": url, "screenshot": name}
    with open(_LOG, "a", encoding="utf-8") as f:
        f.write(_json.dumps(rec, ensure_ascii=False) + "\n")
    return f"step {i} recorded ({status})"


def qa_done(status, summary, issues=None):
    """Finish the scenario. status: pass | fail | blocked.

    issues: list of {"kind": "defect"|"adjustment"|"blocker", "title": str, "detail": str}.
    """
    if status not in ("pass", "fail", "blocked"):
        raise ValueError("status must be pass, fail or blocked")
    out = {"status": status, "summary": summary, "issues": list(issues or [])}
    with open(_os.path.join(_DIR, "result.json"), "w", encoding="utf-8") as f:
        _json.dump(out, f, ensure_ascii=False, indent=2)
    return "scenario closed"
