# -*- coding: utf-8 -*-
"""qa_packexact.py -- the spawnPack fixture path must stay VERBATIM (port 8879).

The roam path jitters 1-2 members of every pack (same §6.1 cost, different
unit). The test API must not: probes call spawnPack("The Hunt") precisely
because they need that row's two frost stalkers (_harness/qa_flee.py). This
asserts the forced queue equals the authored row, and that a roam spawn of the
same realm still differs from its row at least once in six tries.
"""
import json, subprocess, sys, time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PORT = 8879
URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

JS = """(() => {
  const SF = SNOWFLOW, E = SF.combat.encounters;
  const out = {};
  const queued = (sl) => {
      const a = [];
      for (let i = 0; i < sl.qCount; i++) a.push(sl.qKey[i]);
      return a;
  };
  out.forced = {};
  for (const name of ["The Hunt", "Imp Warren", "Ritual Circle"]) {
      const ok = E.spawnPack(name);
      out.forced[name] = { ok, queue: queued(E._slots[0]) };
  }
  E._clearAll();
  // six roam spawns, recording each composition against its row
  SF.progression.level = 10;
  out.roam = [];
  for (let i = 0; i < 6; i++) {
      E._endSlot(E._slots[0]);
      E.spawnRoam(false);
      out.roam.push({ name: E._slots[0].name, queue: queued(E._slots[0]) });
  }
  E._clearAll();
  return out;
})()"""

ROWS = {
    "The Hunt": ["frostStalker", "frostStalker", "rimeImp", "rimeImp",
                 "rimeImp", "rimeImp", "rimeImp"],
    "Imp Warren": ["rimeImp", "rimeImp", "rimeImp", "rimeImp", "rimeImp",
                   "hoarfrostSprite", "rimeImp", "rimeImp"],
    "Ritual Circle": ["rimeboundCultist", "hailPlateGuard", "rimeImp",
                      "rimeImp", "rimeImp"],
}

srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                       cwd=str(ROOT), stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.goto(URL, wait_until="domcontentloaded")
        pg.wait_for_function("() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                             timeout=180000)
        pg.wait_for_timeout(4000)
        out = pg.evaluate(JS)
        for name, want in ROWS.items():
            got = out["forced"][name]["queue"]
            ok = got == want
            print(f"  {'PASS' if ok else 'FAIL'}  spawnPack('{name}') verbatim")
            if not ok:
                print("        want", want, "\n        got ", got)
                fails.append(name)
        jittered = 0
        for r in out["roam"]:
            row = ROWS.get(r["name"])
            print(f"       roam {r['name']}: {','.join(r['queue'])}")
            if row is not None and r["queue"] != row:
                jittered += 1
            elif row is None:
                jittered += 0
        print(f"  roam spawns differing from their authored row: {jittered}"
              f" of {len(out['roam'])} (rows known for cold entry packs only)")
        br.close()
finally:
    srv.terminate()
print("RESULT:", "OK" if not fails else "FAIL " + ",".join(fails))
sys.exit(1 if fails else 0)
