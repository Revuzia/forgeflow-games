"""feel_gate.py — Layer-4 feel (play-bot) gate. Genre + engine agnostic.

Answers "can the game actually be PLAYED to a conclusion?" — not just "does it
boot." Works for ANY FFG game, 2D (Phaser, window.__FFG_GAME__) or 3D (three.js,
window.__FFG3D__), by driving the STANDARD test hooks every genre runtime
exposes:
  - __test.start()        dismiss the menu / begin gameplay
  - __test.autoResolve()  greedily play to a win/lose (alias: playToEnd/autoPlay)
  - __test.state()        read progress + end state

A genre is "feel-complete" when start() + autoResolve() drive it to an `ended`
state. Needs a running static server + a browser, so it runs outside the
interactive session. Self-contained Playwright script.

Usage:
    python feel_gate.py <game_url>
Requires: pip install playwright ; playwright install chromium
"""
import json
import sys

PROBE_JS = r"""
(async () => {
  function getTest() {
    if (window.__FFG3D__ && window.__FFG3D__.controller && window.__FFG3D__.controller.__test) return window.__FFG3D__.controller.__test;
    if (window.__FFG_GAME__ && window.__FFG_GAME__.scene) {
      var s = window.__FFG_GAME__.scene.scenes.find(function (sc) { return sc.__test; });
      return s ? s.__test : null;
    }
    return null;
  }
  var T = null, tries = 0;
  while (!T && tries++ < 80) { T = getTest(); if (!T) await new Promise(function (r) { setTimeout(r, 250); }); }
  if (!T) return { ok: false, error: "no FFG __test hooks found (2D or 3D)" };
  var started = false;
  if (typeof T.start === "function") { T.start(); started = true; }
  await new Promise(function (r) { setTimeout(r, 400); });
  var pre = T.state ? T.state() : {};
  var res = null, how = null;
  if (typeof T.autoResolve === "function") { res = T.autoResolve(); how = "autoResolve"; }
  else if (typeof T.playToEnd === "function") { res = T.playToEnd(); how = "playToEnd"; }
  else if (typeof T.autoPlay === "function") { res = T.autoPlay(); how = "autoPlay"; }
  else return { ok: false, error: "genre exposes no autoResolve/playToEnd/autoPlay" };
  var post = T.state ? T.state() : {};
  return { ok: true, started: started, driver: how, result: res, ended: !!(res && res.ended), post: post };
})()
"""


def run(url, timeout_ms=60000):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {"ok": False, "error": "playwright not installed (pip install playwright; playwright install chromium)"}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1024, "height": 768})
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto(url, wait_until="load", timeout=timeout_ms)
        result = page.evaluate(PROBE_JS)
        result["console_errors"] = errors[:10]
        browser.close()
        return result


def grade(result):
    if not result.get("ok"):
        return False, "play-bot could not drive the game: " + str(result.get("error", "?"))
    res = result.get("result") or {}
    if not result.get("started"):
        return False, "no start() hook — game did not begin"
    if not res.get("ended"):
        return False, "game did NOT resolve to an end state (autoResolve ran but never ended): " + json.dumps(res)
    errs = [e for e in result.get("console_errors", []) if "favicon" not in e]
    tag = " (console errors: %d)" % len(errs) if errs else ""
    return True, "played to resolution via %s: %s%s" % (result.get("driver"), json.dumps(res), tag)


def main():
    if len(sys.argv) < 2:
        print("usage: python feel_gate.py <game_url>")
        sys.exit(2)
    result = run(sys.argv[1])
    print(json.dumps(result, indent=2))  # full object (NOT truncated — a cut JSON can't be parsed by the gate)
    ok, msg = grade(result)
    print(f"[feel_gate] {'PASS' if ok else 'FAIL'} — {msg}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
