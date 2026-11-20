#!/usr/bin/env python
"""netnoise - a '0 console errors' / '0 failed requests' row that is red ONLY because a THIRD-PARTY host was unreachable at the
network level is COULD-NOT-JUDGE (the host named), never a pass and never a fail (Wave 10 tools lane, 2026-11-19).

Why: player_camwall / player_rim went red because fonts.googleapis.com timed out (net::ERR_CONNECTION_TIMED_OUT) - the box's
network, not the game. The rule (orchestrator ticket 3):
  * network-level failure = ERR_CONNECTION_* / ERR_NAME_NOT_RESOLVED / ERR_TIMED_OUT / ERR_INTERNET_DISCONNECTED (NET_CODES);
  * third-party = the request's host is not the page's own host (common.Session.origin(): the served game);
  * a row whose EVERY offending entry is such a failure -> COULD-NOT-JUDGE "network noise: <hosts>" and the line
    `NETNOISE <gate> hosts=<hosts>` is printed, so gate.py re-runs that gate ONCE (retry_netnoise; the second verdict stands);
  * anything else stays exactly as it was: an HTTP error status (HTTP >= 400 has no net:: code), ANY failure on the game's own
    origin, any other console error, or a row whose list mixes noise with a real error -> the row FAILS as before.
The row's verdict is only ever DOWNGRADED from fail to could-not-judge, never to a pass, and only when the full list of the latest
Session.diagnostics() call (not the truncated detail) agrees.

install() wraps common.Verdict.check and common.Session.diagnostics; a gate (or its shared lib) calls it once at import.
Planted controls (player_rim --plant net-third-party-font / net-own-asset, via plant_route()): a blocked third-party font must
read COULD-NOT-JUDGE; a blocked own-origin asset must still FAIL.
"""
from __future__ import annotations

import re
import urllib.parse

import common as C

NET_CODES = ("ERR_CONNECTION_", "ERR_NAME_NOT_RESOLVED", "ERR_TIMED_OUT", "ERR_INTERNET_DISCONNECTED")
# which diagnostics() list a row name covers; a named list that cannot be noise (page errors ...) must be empty for a downgrade
ROW_KEYS = (("console error", "consoleErrors"), ("failed request", "failedRequests"), ("page error", "pageErrors"),
            ("window error", "windowErrors"), ("shader", "shader"), ("[rig]", "rigWarnings"))
_LAST = {"d": None, "host": None}
_URL = re.compile(r"(https?://[^\s\]\)]+)")


def _host(url):
    try:
        return (urllib.parse.urlparse(url).hostname or "").lower()
    except Exception:
        return ""


def _netcode(text):
    m = re.search(r"(?:net::)?(ERR_[A-Z_]+)", text)
    return m.group(1) if m and m.group(1).startswith(NET_CODES) else None


def noise_host(entry, own_host):
    """the third-party host when `entry` (a failedRequests / consoleErrors string) is ONLY a network-level failure to a host that is
    not the page's own; else None."""
    t = str(entry)
    if t.startswith("HTTP "):                       # an HTTP status: the server answered - never noise
        return None
    code = _netcode(t)
    if not code:
        return None
    if t.startswith("FAILED "):                     # common.Session._on_reqfail: "FAILED <url> (<failure>) [stage]"
        url = t[len("FAILED "):].split(" ", 1)[0]
    elif "Failed to load resource" in t:            # common.Session._on_console: "Failed to load resource: net::ERR_... [<url>]"
        urls = _URL.findall(t)
        if len(urls) != 1:
            return None
        url = urls[0]
    else:
        return None
    h = _host(url)
    if not h or not own_host or h == own_host:
        return None
    return h


def classify(row_name, detail):
    """(hosts, why) when the failing row `row_name` is network noise only; else None."""
    d, own = _LAST["d"], _LAST["host"]
    if d is None:
        return None
    low = row_name.lower()
    keys = [k for (needle, k) in ROW_KEYS if needle in low]
    if not any(k in ("consoleErrors", "failedRequests") for k in keys):
        return None
    hosts = set()
    seen = 0
    for k in keys:
        items = list(d.get(k) or [])
        if k not in ("consoleErrors", "failedRequests"):
            if items:
                return None
            continue
        for it in items:
            h = noise_host(it, own)
            if not h:
                return None
            hosts.add(h)
            seen += 1
    if not seen:
        return None
    # the row's own evidence must come from that same diagnostics() call: every listed item of the detail is in the full lists
    full = set(str(x) for k in keys for x in (d.get(k) or []))
    det = detail if isinstance(detail, (list, tuple)) else ([detail] if isinstance(detail, str) and detail else [])
    if det and not all(str(x) in full for x in det):
        return None
    return sorted(hosts), "%d network-level failure(s), all to third-party host(s)" % seen


def install():
    if getattr(C.Verdict.check, "_netnoise", False):
        return
    diag0, check0 = C.Session.diagnostics, C.Verdict.check

    def diagnostics(self):
        d = diag0(self)
        try:
            _LAST["d"], _LAST["host"] = d, _host(self.origin())
        except Exception:
            _LAST["d"], _LAST["host"] = d, None
        return d

    def check(self, name, ok, detail="", expect=None):
        if ok is not None and not isinstance(ok, bool):
            ok = bool(ok)
        if ok is False:
            try:
                r = classify(str(name), detail)
            except Exception:
                r = None
            if r:
                hosts, why = r
                print("NETNOISE %s hosts=%s row=%s" % (self.gate, ",".join(hosts), name), flush=True)
                return check0(self, name, None, "network noise, COULD-NOT-JUDGE (re-run): %s %s - %s" % (why, ", ".join(hosts), C._short(detail, 300)), expect)
        return check0(self, name, ok, detail, expect)

    check._netnoise = True
    C.Session.diagnostics = diagnostics
    C.Verdict.check = check


# planted controls (a gate exposes them as --plant net-third-party-font / net-own-asset)
PLANTS = ("net-third-party-font", "net-own-asset")
OWN_ASSET = "__h_plant_own_asset.css"


def plant_route(s, plant):
    """install the planted network fault on session `s` (after s.start(), before the boot):
    net-third-party-font: the game's own fonts.googleapis.com request aborted with ERR_TIMED_OUT (the 2026-11 outage)
      -> the error rows must read COULD-NOT-JUDGE (and gate.py re-runs the gate once);
    net-own-asset: a stylesheet on the game's OWN origin aborted with ERR_CONNECTION_FAILED -> the error rows must still FAIL."""
    if plant == "net-third-party-font":
        # hud.js's ensureAAAStyles() requests the Orbitron / Rajdhani stylesheet from fonts.googleapis.com once the menu is up
        s.context.route("https://fonts.googleapis.com/**", lambda route: route.abort("timedout"))
        return "fonts.googleapis.com aborted with net::ERR_TIMED_OUT (the game's own font request)"
    if plant == "net-own-asset":
        own = s.origin()
        s.context.add_init_script("(() => { const add = () => { if (document.head && !document.getElementById('__h_plant_own')) {"
                                  " const l = document.createElement('link'); l.id = '__h_plant_own'; l.rel = 'stylesheet'; l.href = %r;"
                                  " document.head.appendChild(l); } }; if (document.head) add(); else document.addEventListener('DOMContentLoaded', add); })();"
                                  % OWN_ASSET)
        s.context.route(lambda url: url.startswith(own) and urllib.parse.urlparse(url).path.endswith("/" + OWN_ASSET),
                        lambda route: route.abort("connectionfailed"))
        return "an own-origin stylesheet (%s) requested and aborted with net::ERR_CONNECTION_FAILED" % OWN_ASSET
    raise C.HarnessError("unknown netnoise plant %r" % plant)
