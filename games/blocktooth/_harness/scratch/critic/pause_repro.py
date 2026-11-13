"""Repro: pause menu Retry / Quit with real keys; log every key's effect (observation only)."""
import os, sys, time, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import Session, add_common_args, build_url, SHOTS  # noqa
import argparse
ap = argparse.ArgumentParser(); add_common_args(ap); args = ap.parse_args(); args.no_serve = True
OUT = os.path.join(SHOTS, "critic", "pause"); os.makedirs(OUT, exist_ok=True)
S = Session(args, "pause_repro"); S.start()
PJS = """() => { const L = document.querySelector('.bt-pause'); if (!L) return null;
  const items = [...L.querySelectorAll('.bt-menu-item')].map(b => (b.classList.contains('is-sel') ? '>' : ' ') + (b.classList.contains('armed') ? '!' : ' ') + b.innerText.replace(/\s+/g,' '));
  return { hidden: L.classList.contains('bt-hidden'), items, confirm: (L.querySelector('.bt-pause-confirm')||{}).innerText, active: document.activeElement && document.activeElement.className }; }"""
def show(tag):
    s = S.state() or {}
    p = S.safe_js(PJS)
    print("%-28s screen=%s seed=%s t=%.1f pause=%s" % (tag, s.get("screen"), s.get("seed"), s.get("t") or 0, json.dumps(p)), flush=True)
    return s
try:
    S.goto(build_url(args.base, autostart=1, seed=4242, titan="voltkite", biome="lockwater"))
    S.wait_bt(60); S.wait_screen("slate", 60); time.sleep(1)
    S.press("Enter"); S.wait_screen("play", 10); time.sleep(1.0); show("play")
    S.press("Escape"); S.wait_screen("pause", 3); show("after Esc (0s)"); time.sleep(0.35); show("after Esc (+.35)")
    S.press("ArrowDown"); time.sleep(0.2); show("ArrowDown 1")
    S.press("ArrowDown"); time.sleep(0.2); show("ArrowDown 2")
    S.screenshot(os.path.join(OUT, "retry_sel.png"))
    S.press("Enter"); time.sleep(0.4); show("Enter 1 (arm)")
    S.screenshot(os.path.join(OUT, "retry_armed.png"))
    S.press("Enter"); time.sleep(0.2); show("Enter 2 (+0.2)")
    for i in range(20):
        time.sleep(0.5); s = show("wait %d" % i)
        if s.get("screen") in ("slate", "play") and s.get("seed") != 4242: break
    if S.state().get("screen") == "slate":
        S.press("Enter"); S.wait_screen("play", 10); time.sleep(1)
    S.press("Escape"); S.wait_screen("pause", 3); time.sleep(0.35); show("pause for quit")
    for i in range(3):
        S.press("ArrowDown"); time.sleep(0.2); show("down %d" % (i + 1))
    S.press("Enter"); time.sleep(0.4); show("quit Enter 1")
    S.press("Enter"); time.sleep(0.2); show("quit Enter 2")
    for i in range(10):
        time.sleep(0.5); s = show("wait %d" % i)
        if s.get("screen") == "title": break
    # blur + hidden via CDP
    S.goto(build_url(args.base, autostart=1, noslate=1, seed=5, titan="molo"))
    S.wait_bt(60); S.wait_screen("play", 60); time.sleep(1.0); show("play2")
    cdp = S.page.context.new_cdp_session(S.page)
    wid = cdp.send("Browser.getWindowForTarget")["windowId"]
    cdp.send("Browser.setWindowBounds", {"windowId": wid, "bounds": {"windowState": "minimized"}})
    time.sleep(1.2)
    hid = S.safe_js("() => document.hidden")
    s = show("minimized hidden=%s" % hid)
    cdp.send("Browser.setWindowBounds", {"windowId": wid, "bounds": {"windowState": "normal"}})
    time.sleep(1.0); show("restored")
    if (S.state() or {}).get("screen") == "pause":
        S.press("Escape"); time.sleep(0.6); show("resumed")
finally:
    print(json.dumps({k: v[:5] for k, v in S.diagnostics().items() if v}, default=str)[:1500])
    S.close()
