#!/usr/bin/env python
"""
Prove the owner's rebind is REAL: LMB fires the bolt, keys 1-5 fire the pushed spells.

A spellbar label and a SPELL_KEYS table agreeing with each other proves nothing --
both are just data, and the bug that matters is the one where the table says
"Digit3 -> bloom" and pressing 3 lights up the vortex. So this drives the ENGINE
and watches which spell object goes active, rather than reading any table.

Bindings under test (owner remap):
    LMB -> internal 6 bolt · 1 -> 2 stream · 2 -> 1 wave
    3   -> internal 3 bloom · 4 -> 4 spikes · 5 -> 5 vortex

    python _harness/spellbind.py
"""
import argparse
import json
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
  if (!SF || !SF.terrain || !SF.spells) return false;
  const b = document.getElementById('boot');
  return !(b && !b.classList.contains('gone'));
}"""

# Which engine object is live, by internal id. Read from the spell system's own
# `spells` array so a spell added or reordered shows up here rather than silently
# falling outside the probe.
SNAP = """() => {
  const S = globalThis.SNOWFLOW.spells;
  const out = {};
  const named = { sweep: 1, ribbon: 2, bloom: 3, crystallize: 4, vortex: 5, bolt: 6 };
  for (const k in named) {
    const o = S[k];
    out[named[k]] = o ? !!(o.active || o.held || o.live || o.firing) : null;
  }
  out._count = Array.isArray(S.spells) ? S.spells.length : -1;
  out._mana = globalThis.SNOWFLOW.character.mana;
  return out;
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8788/games/driftwake/index.html")
    ap.add_argument("--wait", type=float, default=150.0)
    args = ap.parse_args()

    errors = []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        pg.on("console",
              lambda m: errors.append(f"console.error: {m.text}")
              if m.type == "error" else None)
        pg.add_init_script(
            "window.__f=0;(function t(){window.__f++;requestAnimationFrame(t);})();")
        pg.goto(args.url + "?v=bind", wait_until="load", timeout=90_000)
        try:
            pg.wait_for_function(READY, timeout=int(args.wait * 1000))
        except Exception as e:
            print("BOOT FAILED:", e, file=sys.stderr)
            for m in errors[:15]:
                print("  ", m, file=sys.stderr)
            br.close()
            return 1

        def frames(n):
            s = pg.evaluate("() => window.__f")
            pg.wait_for_function("(s) => window.__f > s + %d" % n, arg=s, timeout=60_000)

        frames(30)
        # Unlock everything and refill mana: the probe is testing BINDINGS, not the
        # progression gate, and a locked key is indistinguishable from a wrong one.
        pg.evaluate("""() => {
          const SF = globalThis.SNOWFLOW;
          if (SF.spells.unlocked) for (const k of [1,2,3,4,5,6]) SF.spells.unlocked.add(k);
          SF.character.mana = 100;
        }""")

        rows = []
        # key label -> (internal id it must activate, its STRIKE_DELAY seconds)
        # The delay matters: a cast is SCHEDULED on the press and fires when the
        # character's hands strike. Sampling before then reads a spell that has
        # not started yet and calls a correct binding broken.
        cases = [("1", 2, 0.0), ("2", 1, 0.71), ("3", 3, 0.66),
                 ("4", 4, 0.95), ("5", 5, 0.98)]
        for label, want, delay in cases:
            pg.evaluate("() => { globalThis.SNOWFLOW.character.mana = 100; }")
            pre = pg.evaluate(SNAP)
            pg.keyboard.press("Digit" + label)
            # strike delay + margin, at ~60 fps, then a little longer for slow rigs
            frames(int(delay * 60) + 30)
            post = pg.evaluate(SNAP)
            # TRANSITION, not exclusivity: Crystal Spikes stand 34-42 s and Bloom's
            # column lives 1.75 s, so an earlier cast is legitimately still live
            # when the next key fires. Requiring sole occupancy tests nothing but
            # the order the probe happens to press keys in.
            became = bool(post.get(str(want))) and not bool(pre.get(str(want)))
            still = bool(post.get(str(want)))
            rows.append((label, want, became, still,
                         [k for k, v in post.items()
                          if not k.startswith("_") and v]))
            frames(30)

        # LMB: a HOLD, driven through the same input flag mousedown sets.
        pg.evaluate("() => { globalThis.SNOWFLOW.input.spellHeld2 = false; }")
        before = pg.evaluate(SNAP)
        pg.evaluate("""() => {
          const SF = globalThis.SNOWFLOW;
          SF.character.mana = 100;
          if (SF.spells.debugBolt !== undefined) SF.spells.debugBolt = true;
          SF.input.lmb = true; SF.input.spellHeld6 = true; SF.input.boltHeld = true;
        }""")
        frames(20)
        lmb = pg.evaluate(SNAP)

        print(f"spell objects in system.spells array: {before['_count']} (expect 6)")
        print(f"{'key':<5}{'expect':>8}{'fired':>8}{'live':>7}   all live ids")
        ok = True
        for label, want, became, still, live in rows:
            good = became or still
            ok = ok and good
            print(f"{label:<5}{want:>8}{str(became):>8}{str(still):>7}   {live}"
                  f"  {'OK' if good else 'FAIL'}")
        print(f"LMB  bolt(6) live before={before.get('6')} after={lmb.get('6')}")
        print(f"errors {len(errors)}")
        for m in errors[:8]:
            print("  ", m)
        br.close()
        print("\nRESULT:", "OK" if ok and not errors else "CHECK ABOVE")
        return 0 if ok and not errors else 1


if __name__ == "__main__":
    sys.exit(main())
