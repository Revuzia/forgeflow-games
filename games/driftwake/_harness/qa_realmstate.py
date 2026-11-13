#!/usr/bin/env python
"""Does a realm swap actually APPLY the realm's data, and can the new realm spawn?

Two questions that a screenshot cannot answer and that `realmswitch.py` does not
ask, because both failures boot clean and look almost right:

  APPLIED   `realmSettings(r)` is the contract table as data. After enterRealm(r)
            every one of those keys must be live in `S`. A swap that writes the
            uniform block but forgets the settings half leaves fog, exposure,
            wind and the mountain gate on the PREVIOUS realm's numbers, and the
            frame still renders. This diffs live `S` against `realmSettings(r)`
            key by key and prints only what disagrees.

  POPULATED The encounter director filters its pack table by realm
            (encounters.js `_tryRoamSpawn`). If a realm has no rows the realm is
            silently EMPTY -- `encounters.realm` reports the right token, the
            weather is right, the roster streams the right bodies, and nothing
            ever attacks you. So this drives the director's own spawn entry
            point directly and counts what appears.

    python _harness/qa_realmstate.py
"""
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
  if (!SF || !SF.enterRealm || !SF.realms || !SF.S) return false;
  const b = document.getElementById('boot');
  return !(b && !b.classList.contains('gone'));
}"""

# Live S against the realm's own declared settings row. Compared with a relative
# tolerance so a float that round-trips through a slider's quantisation is not
# reported as a mismatch; booleans and strings are compared exactly.
DIFF = """(r) => {
  const SF = globalThis.SNOWFLOW, S = SF.S;
  const want = SF.realms.realmSettings(r);
  const bad = [];
  for (const k in want) {
    const w = want[k], g = S[k];
    let ok;
    if (typeof w === 'number') ok = Math.abs(g - w) <= Math.max(1e-6, Math.abs(w) * 1e-4);
    else ok = (g === w);
    if (!ok) bad.push({ key: k, want: w, live: g === undefined ? '<undefined>' : g });
  }
  return { checked: Object.keys(want).length, bad };
}"""

# The encounter director's own spawn path, driven directly so the answer does not
# depend on standing around for the roam timer. Counts alive before and after.
SPAWNPROBE = """(tries) => {
  const SF = globalThis.SNOWFLOW;
  const enc = SF.combat.encounters, E = SF.combat.enemies;
  const before = E.aliveCount;
  let eligible = -1;
  // How many pack rows does THIS realm offer at the current level? Read from
  // the director's own filter if it exposes one, else count via _tryRoamSpawn's
  // observable effect alone.
  for (let i = 0; i < tries; i++) {
    if (typeof enc._tryRoamSpawn === 'function') enc._tryRoamSpawn();
    if (typeof enc._flushQueue === 'function') enc._flushQueue();
  }
  return { realm: enc.realm, before, after: E.aliveCount,
           queued: enc._queue ? enc._queue.length : null,
           eligible };
}"""


def main():
    errors = []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errors.append(f"console.error: {m.text}")
              if m.type == "error" else None)
        pg.add_init_script(
            "window.__f=0;(function t(){window.__f++;requestAnimationFrame(t);})();")
        pg.goto("http://localhost:8788/games/driftwake/index.html?v=rstate",
                wait_until="load", timeout=90_000)
        pg.wait_for_function(READY, timeout=200_000)

        def frames(n):
            s = pg.evaluate("() => window.__f")
            pg.wait_for_function("(s) => window.__f > s + %d" % n, arg=s, timeout=90_000)

        frames(40)
        for realm in ("cold", "sand", "ash"):
            if realm != "cold":
                pg.evaluate("(r) => globalThis.SNOWFLOW.enterRealm(r)", realm)
                frames(140)
            d = pg.evaluate(DIFF, realm)
            sp = pg.evaluate(SPAWNPROBE, 40)
            print(f"\n=== {realm.upper()} ===")
            print(f"settings applied : {d['checked'] - len(d['bad'])}/{d['checked']} keys match realmSettings('{realm}')")
            for b in d["bad"]:
                print(f"   MISMATCH {b['key']:<20} want={b['want']!r:<12} live={b['live']!r}")
            print(f"encounter director: realm={sp['realm']} alive {sp['before']} -> "
                  f"{sp['after']} after 40 forced _tryRoamSpawn() calls"
                  f"   queued={sp['queued']}")
            if sp["after"] == sp["before"]:
                print("   *** the director produced NOTHING in this realm ***")
        print(f"\nerrors {len(errors)}")
        for e in errors[:8]:
            print("  ", e)
        br.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
