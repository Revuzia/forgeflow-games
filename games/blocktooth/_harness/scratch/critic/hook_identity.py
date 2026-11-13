"""Hook identity check with real keys: play 45 s per titan (WASD toward food), press Space when ready,
screenshot ~0.35 s after the press, and count the sim events the press produced."""
import os, sys, time, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import Session, add_common_args, build_url, world_to_keys, SHOTS
from playtest import OBS_JS
import argparse
ap = argparse.ArgumentParser(); add_common_args(ap); ap.add_argument("--titans", default="molo,briarwick,voltkite,hearthback"); args = ap.parse_args(); args.no_serve = True
OUT = os.path.join(SHOTS, "critic", "hooks"); os.makedirs(OUT, exist_ok=True)
S = Session(args, "hook_identity"); S.start()
EVJS = "(t0) => { const W = window.__BT__.world; const ev = window.__BT__.events(400).filter(e => (e.t === undefined || true)); const c = {}; for (const e of ev) c[e.type] = (c[e.type] || 0) + 1; const K = W.titan.kit || {}; const pk = (W.pickups || []).filter(p => p.alive); return { counts: c, kit: Object.fromEntries(Object.entries(K).filter(([k, v]) => typeof v === 'number').slice(0, 12)), magnet: pk.filter(p => p.magnet).length, pickups: pk.length, hazards: (W.hazards || []).filter(h => h.alive !== false).length }; }"
try:
    for t in args.titans.split(","):
        S.goto(build_url(args.base, autostart=1, noslate=1, seed=21, titan=t, biome="grideast")); S.wait_bt(60); S.wait_screen("play", 60); time.sleep(0.8)
        t0 = time.time(); presses = []; shot = 0
        while time.time() - t0 < 45:
            obs = S.safe_js(OBS_JS, {"banned": []}) or {}
            s = obs.get("s") or {}
            if s.get("screen") == "draft": S.release_all(); S.press("Digit1"); time.sleep(0.6); continue
            if s.get("screen") != "play": time.sleep(0.2); continue
            T = obs.get("t") or {}; f = obs.get("food")
            S.hold(world_to_keys(f["x"] - T["x"], f["z"] - T["z"]) if f and T else {"KeyW"} or {"KeyW"})
            cd = T.get("abilityCd")
            if cd is not None and cd <= 0 and time.time() - t0 > 8:
                before = S.safe_js(EVJS, 0)
                if t == "voltkite": S.press("Shift"); time.sleep(0.25)
                S.press("Space"); time.sleep(0.35)
                p = os.path.join(OUT, "%s_%d.png" % (t, shot)); S.screenshot(p); shot += 1
                after = S.safe_js(EVJS, 0)
                d = {k: after["counts"].get(k, 0) for k in ("ability", "titanAttack", "hazardSpawn", "pickup", "enemyKilled", "floorBreak") if after}
                presses.append({"t": round(s.get("t") or 0, 1), "ev_after": d, "magnet": [before and before.get("magnet"), after and after.get("magnet")], "pickups": after and after.get("pickups"), "hazards": [before and before.get("hazards"), after and after.get("hazards")], "cdAfter": (S.state() or {}).get("abilityCd")})
                if shot >= 3: break
            time.sleep(0.1)
        S.release_all()
        print(t, json.dumps(presses)[:1400], flush=True)
finally:
    print(json.dumps({k: v[:3] for k, v in S.diagnostics().items() if v}, default=str)[:800])
    S.close()
