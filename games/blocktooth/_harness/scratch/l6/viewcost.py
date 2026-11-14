#!/usr/bin/env python
"""L6 scratch self-check (NOT the orchestrator's perfcheck): ?prof=1 per-view CPU ms for the four L6 views
in a Size V scene with ~200 foes, 3 objectives, 3 power-ups and one UPROAR fired in the window."""
import argparse, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", ".."))
from common import Session, add_common_args, build_url, dismiss_slate, ensure_play  # noqa: E402

STATS = r"""(names) => { const P = window.__BTPROF__; const ring = P.ring.filter(f => f && f.screen === 'play');
  const out = { frames: ring.length };
  const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
  let tot = [];
  for (const n of names) { const a = ring.map(f => f.sec[n] || 0); out[n] = { p50: +q(a, 0.5).toFixed(3), p90: +q(a, 0.9).toFixed(3), p99: +q(a, 0.99).toFixed(3), mean: +(a.reduce((s, v) => s + v, 0) / Math.max(1, a.length)).toFixed(3) }; }
  const sum = ring.map(f => names.reduce((s, n) => s + (f.sec[n] || 0), 0));
  out.sumL6 = { p50: +q(sum, 0.5).toFixed(3), p90: +q(sum, 0.9).toFixed(3), p99: +q(sum, 0.99).toFixed(3) };
  out.raw = { p50: +q(ring.map(f => f.raw), 0.5).toFixed(2), p99: +q(ring.map(f => f.raw), 0.99).toFixed(2) };
  return out; }"""
NAMES = ["UltView", "ObjectiveView", "PowerupView", "MarkerView", "TitanView"]

def main():
    ap = add_common_args(argparse.ArgumentParser())
    ap.add_argument("--titan", default="voltkite")
    args = ap.parse_args()
    sess = Session(args, "l6cost"); sess.start()
    try:
        sess.goto(build_url(args.base, autostart=1, dev=1, prof=1, titan=args.titan, biome="grideast", seed=11))
        sess.wait_bt(90); sess.wait_screen(["slate", "play"], 90); dismiss_slate(sess); sess.wait_screen(["play"], 20)
        sess.js("() => { const c = window.__BT__.cheat; c.god(true); c.rank(4); }")
        time.sleep(3.0); ensure_play(sess, 10)
        sess.js("() => { const c = window.__BT__.cheat; c.spawn('android', 80); c.spawn('squad', 60); c.spawn('buggy', 30); c.spawn('drone', 30); }")
        for k in ("overloadSite", "reliefDepot", "recordsAnnex"): sess.cheat("objective", k)
        for k in ("cleanup", "redLight", "backPay"): sess.cheat("powerup", k)
        time.sleep(2.0); ensure_play(sess, 10)
        sess.js("() => window.__BTPROF__.reset()")
        time.sleep(3.0)
        sess.js("() => window.__BT__.cheat.ult(100)"); time.sleep(0.2); sess.press("KeyE")
        time.sleep(4.0)
        print(json.dumps(sess.js(STATS, NAMES), indent=1))
        print("state:", json.dumps({k: (sess.state() or {}).get(k) for k in ("screen", "enemies", "rank")}), json.dumps((sess.state() or {}).get("v2", {}).get("ult")))
    finally:
        sess.close()

if __name__ == "__main__":
    main()
