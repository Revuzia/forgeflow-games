#!/usr/bin/env python
"""Do the six spell slots actually LOOK different in cold / sand / ash?

The question this answers is NOT "did the realm uniform change" -- a colour
written into a uniform that no pass samples produces a byte-identical frame, and
`_harness/realmuniforms.py` already proves the uniforms move. This measures the
PIXELS a cast puts on screen, and it does so with the world held still so the
three realms are comparable frame-to-frame rather than merely describable.

HOW THE POSE IS HELD
    `S.freezeTime` is useless here: it makes dt exactly 0, so the spell never
    animates and every capture is the frame before the effect exists. Instead
    this pins the two integrators that move the view -- `character.update` and
    `rig.update` are replaced by no-ops after a settle, so the camera and the
    rider stop dead while `figure.update` / `meshChar.update` / `spells.update`
    keep running on a live dt. The cast animation plays, the hands strike, the
    FX evolve, and the camera does not move between the baseline and the cast.
    `--nopin` turns this off, so the pin itself can be shown not to change the
    firing result.

WHAT IS MEASURED, per (realm, slot)
    base        one frame captured immediately before the key goes down
    cast        the frame with the MOST FX pixels inside the cast window
    mask        |cast - base| > THRESH on any channel: the pixels the spell owns
    add RGB     mean of (cast - base) over the mask -- the light the spell ADDED.
                This is the realm-comparable number: it is independent of the
                terrain underneath, which is fully re-authored per realm and
                would otherwise dominate any raw cross-realm pixel difference.
    abs RGB     mean of cast over the mask -- what a player's eye lands on
    n, centroid, bbox   the SHAPE, which is what separates a rope from a cone
                and a wave born at the feet from a fireball thrown 5 m out

CROSS-REALM VERDICT
    dAdd    euclidean distance between this realm's add-RGB and cold's
    IoU     intersection-over-union of the two FX masks
    A slot is IDENTICAL if dAdd is small AND IoU is high. Both matter: a
    recoloured rope and a same-coloured cone are both real differences, and
    either metric alone misses one of them.

    python _harness/spellrealm_truth.py [--nopin] [--out FILE.json]
"""
import argparse
import json
import os
import sys

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# The last three matter when other agents' Chrome windows are also on this
# machine: an occluded or backgrounded window has its rAF throttled to a crawl,
# and a probe that waits on frame counts then dies on a timeout that has nothing
# to do with the build under test.
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion",
         "--disable-backgrounding-occluded-windows",
         "--disable-renderer-backgrounding",
         "--disable-background-timer-throttling"]

SHOTS = "_shots"
THRESH = 24          # per-channel delta that counts a pixel as "the spell"
MIN_PX = 200         # below this, call it no FX rather than measure noise

READY = """() => {
  const SF = globalThis.SNOWFLOW;
  if (!SF || !SF.spells || !SF.enterRealm || !SF.rig || !SF.character) return false;
  const b = document.getElementById('boot');
  return !(b && !b.classList.contains('gone'));
}"""

# Pin: record the pose, then stop the two integrators that move the view.
# figure/meshChar/spells keep updating, so the cast still animates.
PIN = """() => {
  const SF = globalThis.SNOWFLOW, c = SF.rig.camera, ch = SF.character;
  SF.__pose = { cp: c.position.toArray(), cq: c.quaternion.toArray(),
                chp: ch.position.toArray() };
  if (ch.velocity && ch.velocity.set) ch.velocity.set(0, 0, 0);
  SF.__chUpdate = ch.update.bind(ch);
  SF.__rigUpdate = SF.rig.update.bind(SF.rig);
  ch.update = () => {};
  SF.rig.update = () => {};
  return SF.__pose;
}"""

# Re-seat the recorded pose. Called after every realm crossing: enterRealm
# rebuilds terrain and streams bodies, and a pin that is not re-seated after
# that is a pin that silently came loose.
RESEAT = """() => {
  const SF = globalThis.SNOWFLOW, c = SF.rig.camera, ch = SF.character, P = SF.__pose;
  if (!P) return null;
  ch.position.fromArray(P.chp);
  if (ch.velocity && ch.velocity.set) ch.velocity.set(0, 0, 0);
  c.position.fromArray(P.cp);
  c.quaternion.fromArray(P.cq);
  c.updateMatrixWorld(true);
  return { cp: c.position.toArray().map(v => +v.toFixed(2)) };
}"""

ARM = """() => {
  const SF = globalThis.SNOWFLOW;
  if (SF.spells.unlocked) for (const k of [1,2,3,4,5,6]) SF.spells.unlocked.add(k);
  SF.character.mana = 100;
  if (SF.spells.cooldowns) for (const k in SF.spells.cooldowns) SF.spells.cooldowns[k] = 0;
}"""

CHROME = """() => {
  for (const sel of ['#hud','#crosshair','#spellbar','#minimap','#overlay','#boot',
                     '.ffg-controls','#xp','#floaters','#enemybars','#toast']) {
    document.querySelectorAll(sel).forEach(e => { e.style.visibility = 'hidden'; });
  }
}"""

SNAP = """() => {
  const S = globalThis.SNOWFLOW.spells;
  const named = { sweep: 1, ribbon: 2, bloom: 3, crystallize: 4, vortex: 5, bolt: 6 };
  const out = {};
  for (const k in named) {
    const o = S[k];
    out[named[k]] = o ? !!(o.active || o.held || o.live || o.firing) : null;
  }
  return out;
}"""

# The camera pose + program count, so a realm crossing can be shown to compile
# nothing and to leave the view where it was.
STATE = """() => {
  const SF = globalThis.SNOWFLOW;
  return { programs: SF.renderer.info.programs.length,
           draws: SF.perfStats.drawCalls, tris: SF.perfStats.triangles,
           cam: SF.rig.camera.position.toArray().map(v => +v.toFixed(2)),
           realm: SF.spells.realm };
}"""

# key -> (engine id, label). Delays are polled for, not slept through: at this
# machine's ~13 fps a `delay * 60` frame wait overshoots a 0.71 s strike by five
# seconds of game time and samples an effect that is already over.
CASES = [("LMB", 6, "LMB bolt"), ("Digit1", 2, "1 stream"), ("Digit2", 1, "2 wave"),
         ("Digit3", 3, "3 bloom"), ("Digit4", 4, "4 spikes"), ("Digit5", 5, "5 vortex")]

REALMS = ("cold", "sand", "ash")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--nopin", action="store_true", help="leave camera/character live")
    ap.add_argument("--out", default="_harness/spellrealm_truth.json")
    ap.add_argument("--tag", default="srt")
    ap.add_argument("--analyze", action="store_true",
                    help="re-score the captures already on disk, no browser")
    args = ap.parse_args()

    os.makedirs(SHOTS, exist_ok=True)
    errors = []
    rows = []
    states = {}

    if args.analyze:
        import glob
        for realm in REALMS:
            for key, want, label in CASES:
                caps = sorted(glob.glob(f"{SHOTS}/srt_{realm}_{key}_c*.png"))
                base = f"{SHOTS}/srt_{realm}_{key}_base.png"
                if not caps or not os.path.exists(base):
                    continue
                rows.append(dict(realm=realm, key=key, label=label, want=want,
                                 fired=None, base0=f"{SHOTS}/srt_{realm}_{key}_base0.png",
                                 base=base, caps=caps))
        return analyze(rows, states, errors, args)

    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errors.append(f"console.error: {m.text}")
              if m.type == "error" else None)
        pg.add_init_script(
            "window.__f=0;(function t(){window.__f++;requestAnimationFrame(t);})();")
        pg.goto(f"http://localhost:8788/games/driftwake/index.html?v={args.tag}",
                wait_until="load", timeout=90_000)
        pg.wait_for_function(READY, timeout=220_000)

        def frames(n):
            """Wait n rendered frames. Reports the frame counter on a stall so a
            throttled window is distinguishable from a hung build."""
            s = pg.evaluate("() => window.__f")
            try:
                pg.wait_for_function("(s) => window.__f > s + %d" % n, arg=s,
                                     timeout=240_000)
            except Exception:
                now = pg.evaluate("() => window.__f")
                raise RuntimeError(
                    f"rAF stalled waiting {n} frames: counter {s} -> {now}")

        frames(60)
        pg.evaluate(CHROME)
        if not args.nopin:
            pose = pg.evaluate(PIN)
            print("pinned  camera=" + json.dumps([round(v, 2) for v in pose["cp"]])
                  + "  rider=" + json.dumps([round(v, 2) for v in pose["chp"]]))
        frames(10)

        for realm in REALMS:
            if realm != "cold":
                pg.evaluate("(r) => globalThis.SNOWFLOW.enterRealm(r)", realm)
                frames(150)
                if not args.nopin:
                    pg.evaluate(RESEAT)
                    frames(6)
            states[realm] = pg.evaluate(STATE)
            pg.evaluate(ARM)
            frames(15)

            for key, want, label in CASES:
                pg.evaluate(ARM)
                if not args.nopin:
                    pg.evaluate(RESEAT)
                pre = pg.evaluate(SNAP)
                # TWO baselines, the same frame gap apart as base->cast. The
                # difference between them is the AMBIENT motion -- driving snow,
                # blowing grit, drifting embers, the water surface -- which is
                # live in every realm and otherwise lands in the FX mask and
                # gets measured as if the spell had painted it.
                base0 = f"{SHOTS}/srt_{realm}_{key}_base0.png"
                pg.screenshot(path=base0)
                frames(3)
                base = f"{SHOTS}/srt_{realm}_{key}_base.png"
                pg.screenshot(path=base)

                if key == "LMB":
                    # The bolt CANNOT be driven by a real click here: input.js:171
                    # gates mousedown behind `input.locked`, and pointer lock is
                    # unavailable to automation ("root document ... not valid for
                    # pointer lock"). So drive the exact flags the handler sets --
                    # the same path `_harness/spellbind.py` uses, one layer below
                    # the mouse and above the spell.
                    pg.evaluate("""() => {
                      const I = globalThis.SNOWFLOW.input;
                      I.boltHeld = true; I.spellPressed = 6;
                    }""")
                elif key == "Digit1":
                    # The stream is a CHANNEL: cast(2) routes to holdRibbon(true)
                    # and keyup releases it. A `press` is down+up inside one
                    # frame, so the channel is dead before any frame samples it.
                    pg.keyboard.down("Digit1")
                else:
                    pg.keyboard.press(key)

                # Poll for the strike rather than sleeping a fixed number of
                # frames, then take a short burst: the peak of a 0.4 s crescent
                # and the peak of a 1.8 s column are not at the same offset.
                caps = []
                fired = False
                for i in range(90):
                    frames(1)
                    s = pg.evaluate(SNAP)
                    if s.get(str(want)):
                        fired = True
                        break
                if fired:
                    last = 0
                    for j, off in enumerate((0, 2, 4, 7, 11)):
                        if off > last:
                            frames(off - last)
                            last = off
                        c = f"{SHOTS}/srt_{realm}_{key}_c{j}.png"
                        pg.screenshot(path=c)
                        caps.append(c)
                else:
                    c = f"{SHOTS}/srt_{realm}_{key}_c0.png"
                    pg.screenshot(path=c)
                    caps.append(c)

                if key == "LMB":
                    pg.evaluate(
                        "() => { globalThis.SNOWFLOW.input.boltHeld = false; }")
                elif key == "Digit1":
                    pg.keyboard.up("Digit1")
                rows.append(dict(realm=realm, key=key, label=label, want=want,
                                 fired=fired and not bool(pre.get(str(want))),
                                 base0=base0, base=base, caps=caps))
                frames(45)

        # Cross BACK to cold, then out to sand again. A program count that rises
        # once and then stays put is a one-time compile on first sight of a
        # realm; one that rises on every crossing is a per-swap recompile, which
        # is the thing the contract actually forbids.
        pg.evaluate("(r) => globalThis.SNOWFLOW.enterRealm(r)", "cold")
        frames(150)
        states["back_cold"] = pg.evaluate(STATE)
        pg.evaluate("(r) => globalThis.SNOWFLOW.enterRealm(r)", "sand")
        frames(150)
        states["resand"] = pg.evaluate(STATE)
        br.close()

    return analyze(rows, states, errors, args)


def analyze(rows, states, errors, args):
    # ---- pixels ----------------------------------------------------------
    try:
        import numpy as np
        from PIL import Image
    except Exception as e:
        print("no numpy/PIL:", e)
        return 1

    def load(p):
        return np.asarray(Image.open(p).convert("RGB"), dtype=np.float64)

    def dilate(m):
        """3x3 max. The ambient mask is one frame's worth of a moving particle;
        the same particle sits a pixel or two away in the cast frame, so an
        undilated subtraction leaves its trailing edge behind as fake FX."""
        o = m.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                o |= np.roll(np.roll(m, dy, axis=0), dx, axis=1)
        return o

    measured = {}
    for r in rows:
        b = load(r["base"])
        amb = dilate(np.abs(b - load(r["base0"])).max(axis=2) > THRESH)
        # PICK THE FRAME BY ADDED LIGHT, not by changed-pixel count. A cast's
        # last frames change the MOST pixels -- settling spray, the shadow the
        # effect just stopped casting, snow knocked loose -- while the effect
        # itself is already gone, so a max-pixels selector reliably reports the
        # aftermath and prints a NEGATIVE mean for a bright spell. Total added
        # luminance peaks when the effect is actually on screen, which is the
        # frame the question is about.
        best = None
        for c in r["caps"]:
            cimg = load(c)
            d = np.abs(cimg - b).max(axis=2)
            m = (d > THRESH) & ~amb
            if int(m.sum()) < MIN_PX:
                score = -1e18
            else:
                score = float(np.clip((cimg - b).mean(axis=2)[m], 0, None).sum())
            if best is None or score > best[0]:
                best = (score, m, cimg, c)
        _score, m, cimg, cpath = best
        n = int(m.sum())
        rawn = int(((np.abs(cimg - b).max(axis=2)) > THRESH).sum())
        rec = dict(realm=r["realm"], key=r["key"], label=r["label"],
                   fired=r["fired"], n=n, raw=rawn, ambient=int(amb.sum()),
                   shot=cpath)
        if n >= MIN_PX:
            add = (cimg - b)[m].mean(axis=0)
            absm = cimg[m].mean(axis=0)
            ys, xs = np.nonzero(m)
            rec.update(add=[round(float(v), 1) for v in add],
                       abs=[round(float(v), 1) for v in absm],
                       cx=int(xs.mean()), cy=int(ys.mean()),
                       bbox=[int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())])
            rec["_mask"] = m
        measured[(r["realm"], r["key"])] = rec

    print(f"\n{'slot':<10}{'realm':<6}{'fired':>6}{'fxpx':>8}{'ambpx':>8}"
          f"{'add R  G  B':>20}{'abs R  G  B':>20}{'centroid':>12}")
    for key, want, label in CASES:
        for realm in REALMS:
            rec = measured.get((realm, key))
            if not rec:
                continue
            head = (f"{label:<10}{realm:<6}{str(rec['fired']):>6}"
                    f"{rec['n']:>8}{rec['ambient']:>8}")
            if "add" in rec:
                a, ab = rec["add"], rec["abs"]
                print(head + f"{a[0]:>8.0f}{a[1]:>6.0f}{a[2]:>6.0f}"
                      f"{ab[0]:>8.0f}{ab[1]:>6.0f}{ab[2]:>6.0f}"
                      f"{rec['cx']:>7}{rec['cy']:>5}")
            else:
                print(head + f"{'(no FX pixels)':>20}")

    print(f"\n{'slot':<10}{'sand vs cold':>28}{'ash vs cold':>28}")
    print(f"{'':<10}{'dAdd   IoU   dCentroid':>28}{'dAdd   IoU   dCentroid':>28}")
    verdict = {}
    for key, want, label in CASES:
        cold = measured.get((realm := "cold", key)) or {}
        cells = []
        for other in ("sand", "ash"):
            o = measured.get((other, key)) or {}
            if "add" not in cold or "add" not in o:
                cells.append(f"{'-':>28}")
                continue
            d = float(np.linalg.norm(np.array(o["add"]) - np.array(cold["add"])))
            mi = cold["_mask"] & o["_mask"]
            mu = cold["_mask"] | o["_mask"]
            iou = float(mi.sum()) / max(1, int(mu.sum()))
            dc = float(np.hypot(o["cx"] - cold["cx"], o["cy"] - cold["cy"]))
            cells.append(f"{d:>16.1f}{iou:>7.2f}{dc:>7.0f}")
            verdict[f"{key}:{other}"] = dict(dAdd=round(d, 1), iou=round(iou, 3),
                                             dCentroid=round(dc, 1))
        print(f"{label:<10}" + "".join(cells))

    print("\nrenderer state across the realm crossings:")
    for k, v in states.items():
        print(f"  {k:<6} programs={v['programs']:<4} draws={v['draws']:<5}"
              f" tris={v['tris']:<10} cam={v['cam']} spellRealm={v['realm']}")

    print(f"\nerrors {len(errors)}")
    for e in errors[:10]:
        print("  ", e)

    out = dict(states=states, verdict=verdict,
               rows=[{k: v for k, v in r.items() if k != "_mask"}
                     for r in measured.values()])
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print("wrote", args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
