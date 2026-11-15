#!/usr/bin/env python
"""
LANE B — ADS occlusion LEVER SWEEP.

Same live mask reader as occlusion.py, but sweeps the two alignment-safe
levers (vm ADS zoom share, ADS standoff in metres) per weapon and prints the
occlusion numbers for every combination, so the shipped values are chosen by
measurement instead of taste.

`sightScale` is the analytic apparent-size factor the combination applies to
the SIGHT itself relative to the pre-iter10 build — the guard rail that stops
the sweep picking "invisibly small gun, unusable sight".

    python occl_sweep.py --weapon warden
    python occl_sweep.py --weapon corvus --shares 0,0.35,1 --standoffs 0,0.08,0.16
"""
import argparse, json, math, os, sys
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shotserver import ensure_server
from occlusion import MEASURE_JS, FLAGS, DEFAULT_URL

# posAds z per weapon (weapon_data.js) — the baseline eye->origin distance the
# standoff adds to, used only for the analytic sightScale guard rail.
Z_ADS = {"warden": 0.26, "vesper": 0.24, "corvus": 0.26, "pike": 0.22}
ADS_FOV = {"warden": 55, "vesper": 58, "corvus": 34, "pike": 60}
BASE_FOV, VM_FOV = 74.0, 60.0


def sight_scale(wid, share, standoff):
    """Apparent size of the sight vs the pre-iter10 build (share=1, standoff=0)."""
    def vmfov(s):
        mw = math.tan(math.radians(BASE_FOV / 2)) / math.tan(math.radians(ADS_FOV[wid] / 2))
        return 2 * math.degrees(math.atan(math.tan(math.radians(VM_FOV / 2)) / (mw ** s)))
    d0, d1 = Z_ADS[wid], Z_ADS[wid] + standoff
    t0 = math.tan(math.radians(vmfov(1) / 2))
    t1 = math.tan(math.radians(vmfov(share) / 2))
    return (d0 / d1) * (t0 / t1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--weapon", default="warden")
    ap.add_argument("--shares", default="1,0.5,0")
    ap.add_argument("--standoffs", default="0,0.06,0.12,0.18,0.24")
    ap.add_argument("--shotdir", default="")
    args = ap.parse_args()

    shares = [float(x) for x in args.shares.split(",")]
    stands = [float(x) for x in args.standoffs.split(",")]
    wid = args.weapon

    ensure_server()
    rows = []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.goto(args.url, wait_until="load", timeout=60_000)
        pg.wait_for_function(
            "!!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim && __FPS__.vm)",
            timeout=120_000)
        pg.evaluate("__FPS__.__test.startMission()")
        pg.wait_for_timeout(1500)
        pg.evaluate("__FPS__.__test.god(true); __FPS__.__test.noTarget(true)")
        pg.evaluate("__FPS__.__test.hud(false)")
        pg.evaluate("(id)=>__FPS__.__test.give(id)", wid)
        pg.wait_for_function("(id)=>__FPS__.vm.currentId===id", arg=wid, timeout=20_000)
        pg.wait_for_timeout(900)

        # hold ADS down for the whole sweep — one real right-click, as a player
        pg.evaluate("""() => document.getElementById('view').dispatchEvent(
            new MouseEvent('mousedown', {button: 2, buttons: 2, bubbles: true}))""")
        pg.wait_for_function(
            "()=>__FPS__.sim.state.player.weapon.adsT>=0.999", timeout=10_000)

        print(f"{'share':>6} {'stand':>6} {'area%':>7} {'band%':>7} {'disc%':>7} "
              f"{'bboxW%':>7} {'sgtW px':>8} {'sgtDx':>7} {'sgtTop%':>8} {'pred':>6}")
        for sh in shares:
            for st in stands:
                pg.evaluate("(v)=>__FPS__.vm.setAdsZoomShareOverride(v)", sh)
                pg.evaluate("(v)=>__FPS__.vm.setAdsStandoffOverride(v)", st)
                pg.wait_for_timeout(350)
                m = pg.evaluate(MEASURE_JS)
                ss = sight_scale(wid, sh, st)
                rows.append({"share": sh, "standoff": st, "sightScale": round(ss, 3), **m})
                print(f"{sh:6.2f} {st:6.3f} {m['areaPct']:7.2f} {m['bandPct']:7.2f} "
                      f"{m['discPct']:7.2f} {m['bboxWPct']:7.2f} "
                      f"{str(m['sightWpx']):>8} {str(m['sightDx']):>7} "
                      f"{str(m['sightTopPct']):>8} {ss:6.3f}")
                if args.shotdir:
                    os.makedirs(os.path.abspath(args.shotdir), exist_ok=True)
                    pg.screenshot(path=os.path.join(
                        args.shotdir, f"{wid}_s{sh:g}_d{st:g}.png"))
        pg.evaluate("__FPS__.vm.setAdsZoomShareOverride(null);"
                    "__FPS__.vm.setAdsStandoffOverride(null)")
        br.close()

    out = os.path.join(HERE, "..", "_shots", f"sweep_{wid}.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2)
    print("json ->", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
