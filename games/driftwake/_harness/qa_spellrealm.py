#!/usr/bin/env python
"""Do the six spell slots fire from the REAL input layer, and do they LOOK
different per realm?

Two questions, deliberately together, because they share a boot and because the
second is the one everybody answers wrong. "The realm uniform changed" is not
"it looks different" -- a colour written into a uniform that no FX pass reads
produces an identical frame. So this measures the PIXELS the cast adds:

  baseline    one frame per realm with nothing cast
  cast        one frame per (realm, slot) at the strike
  FX pixels   pixels whose |cast - baseline| exceeds a threshold; their mean RGB
              is the spell's actual on-screen colour in that realm

If Frost Bolt and Cinder Bolt produce the same FX mean RGB, the spell set is
realm-labelled and not realm-coloured, and this prints that as a number.

Input is driven the way a player drives it: real `keyboard.press("Digit3")` and a
real `mouse.down()` on the canvas, never by poking engine flags -- a SPELL_KEYS
table that agrees with a spellbar proves only that two tables agree.

    python _harness/qa_spellrealm.py
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

READY = """() => {
  const SF = globalThis.SNOWFLOW;
  if (!SF || !SF.spells || !SF.enterRealm) return false;
  const b = document.getElementById('boot');
  return !(b && !b.classList.contains('gone'));
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

ARM = """() => {
  const SF = globalThis.SNOWFLOW;
  if (SF.spells.unlocked) for (const k of [1,2,3,4,5,6]) SF.spells.unlocked.add(k);
  SF.character.mana = 100;
}"""

CHROME = """() => {
  for (const sel of ['#hud','#crosshair','#spellbar','#minimap','#overlay',
                     '.ffg-controls','#xp','#floaters','#enemybars']) {
    document.querySelectorAll(sel).forEach(e => { e.style.visibility = 'hidden'; });
  }
}"""

# label -> (engine id it must activate, STRIKE_DELAY seconds -- spellSystem.js:75)
CASES = [("Digit1", 2, 0.00), ("Digit2", 1, 0.71), ("Digit3", 3, 0.66),
         ("Digit4", 4, 0.95), ("Digit5", 5, 0.98)]


def main():
    errors = []
    rows = []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errors.append(f"console.error: {m.text}")
              if m.type == "error" else None)
        pg.add_init_script(
            "window.__f=0;(function t(){window.__f++;requestAnimationFrame(t);})();")
        pg.goto("http://localhost:8788/games/driftwake/index.html?v=sprealm",
                wait_until="load", timeout=90_000)
        pg.wait_for_function(READY, timeout=200_000)

        def frames(n):
            s = pg.evaluate("() => window.__f")
            pg.wait_for_function("(s) => window.__f > s + %d" % n, arg=s, timeout=90_000)

        frames(50)
        pg.evaluate(CHROME)

        for realm in ("cold", "sand", "ash"):
            if realm != "cold":
                pg.evaluate("(r) => globalThis.SNOWFLOW.enterRealm(r)", realm)
                frames(150)
            pg.evaluate(ARM)
            frames(20)

            for key, want, delay in CASES:
                pg.evaluate(ARM)
                pre = pg.evaluate(SNAP)
                # The baseline is taken IMMEDIATELY before the press, not once
                # per realm: the character is still surfing, so a baseline from
                # ten seconds ago differs from the cast frame by the whole
                # camera move and the diff measures the terrain instead of the
                # spell. Two frames apart, the camera move is negligible and
                # what is left in the difference is the FX.
                pg.screenshot(path=f"_shots/qa_sp_{realm}_{key}_base.png")
                pg.keyboard.press(key)
                # POLL the engine across the whole cast window instead of
                # sampling once at the strike. Every one of these spells is
                # transient -- sweep's crescent and ribbon's channel are over in
                # well under a second -- and a single late sample reports a
                # correct binding as dead.
                seen = dict(pre)
                shot = False
                for _ in range(int(delay * 60) + 40):
                    frames(1)
                    s = pg.evaluate(SNAP)
                    for k, v in s.items():
                        if v:
                            seen[k] = True
                    if not shot and s.get(str(want)):
                        pg.screenshot(path=f"_shots/qa_sp_{realm}_{key}.png")
                        shot = True
                if not shot:
                    pg.screenshot(path=f"_shots/qa_sp_{realm}_{key}.png")
                rows.append(dict(realm=realm, key=key, want=want,
                                 fired=bool(seen.get(str(want))) and not bool(pre.get(str(want))),
                                 live=shot,
                                 all_live=[k for k, v in seen.items() if v]))
                frames(40)

            # LMB: a real mouse press on the canvas, held, then released.
            pg.evaluate(ARM)
            pre = pg.evaluate(SNAP)
            pg.mouse.move(640, 360)
            pg.screenshot(path=f"_shots/qa_sp_{realm}_LMB_base.png")
            pg.mouse.down()
            frames(30)
            post = pg.evaluate(SNAP)
            pg.screenshot(path=f"_shots/qa_sp_{realm}_LMB.png")
            pg.mouse.up()
            rows.append(dict(realm=realm, key="LMB", want=6,
                             fired=bool(post.get("6")) and not bool(pre.get("6")),
                             live=bool(post.get("6")),
                             all_live=[k for k, v in post.items() if v]))

            # Held stream: 1 is the channel. Hold the key down and check it stays live.
            pg.evaluate(ARM)
            pg.keyboard.down("Digit1")
            frames(45)
            held = pg.evaluate(SNAP)
            pg.keyboard.up("Digit1")
            frames(30)
            after = pg.evaluate(SNAP)
            rows.append(dict(realm=realm, key="1-HELD", want=2,
                             fired=bool(held.get("2")), live=bool(after.get("2")),
                             all_live=[k for k, v in held.items() if v]))
            frames(40)
        br.close()

    print(f"{'realm':<6}{'key':<9}{'expect':>7}{'fired':>7}{'still':>7}   live ids")
    for r in rows:
        print(f"{r['realm']:<6}{r['key']:<9}{r['want']:>7}{str(r['fired']):>7}"
              f"{str(r['live']):>7}   {r['all_live']}")

    # ---- what the cast actually painted, per realm -------------------------
    try:
        import numpy as np
        from PIL import Image
    except Exception as e:                                   # pragma: no cover
        print("no numpy/PIL, skipping FX colour:", e)
        return 0

    print(f"\n{'slot':<9}" + "".join(f"{r:>26}" for r in ("cold", "sand", "ash")))
    print(f"{'':<9}" + "".join(f"{'FX mean RGB / px':>26}" for _ in range(3)))
    for key in ("Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "LMB"):
        cells = []
        for realm in ("cold", "sand", "ash"):
            bp = f"_shots/qa_sp_{realm}_{key}_base.png"
            cp = f"_shots/qa_sp_{realm}_{key}.png"
            if not (os.path.exists(bp) and os.path.exists(cp)):
                cells.append(f"{'-':>26}")
                continue
            b = np.asarray(Image.open(bp).convert("RGB"), dtype=np.float64)
            c = np.asarray(Image.open(cp).convert("RGB"), dtype=np.float64)
            d = np.abs(c - b).max(axis=2)
            m = d > 24
            n = int(m.sum())
            if n < 200:
                cells.append(f"{'(no FX pixels)':>26}")
                continue
            mean = c[m].mean(axis=0)
            cells.append(f"{mean[0]:6.0f}{mean[1]:5.0f}{mean[2]:5.0f}{n:10d}")
        print(f"{key:<9}" + "".join(cells))
    print(f"\nerrors {len(errors)}")
    for e in errors[:8]:
        print("  ", e)
    return 0


if __name__ == "__main__":
    sys.exit(main())
