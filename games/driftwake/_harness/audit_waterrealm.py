#!/usr/bin/env python
"""AUDIT: water palette per realm (commit a34d64e9) — cold vs ash wave, LIVE.

Pins the camera (spellrealm_truth.py's pin), hides UI chrome, casts the WAVE
(Digit2, internal id 1) in cold and again after `await SNOWFLOW.enterRealm('ash')`,
bursts screenshots through the cast, picks the frame with the most FX pixels,
and reports the mean ADDED RGB over the changed-pixel mask plus its dominant
channel. Ice-blue (B-dominant) added light in ash = FAIL.

Writes audit_wave_cold.png / audit_wave_ash.png (the chosen cast frames) and
audit_waterrealm.json next to this file.
"""
import io, json, sys, time
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

HARN = "C:/Users/TestRun/Claude Claw/forgeflow-games/games/driftwake/_harness"
URL = "http://localhost:8799/games/driftwake/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion",
         "--disable-backgrounding-occluded-windows",
         "--disable-renderer-backgrounding",
         "--disable-background-timer-throttling"]
THRESH = 24
MIN_PX = 200

READY = """() => {
  const SF = globalThis.SNOWFLOW;
  if (!SF || !SF.combat || !SF.spells || !SF.enterRealm || !SF.rig || !SF.character) return false;
  const b = document.getElementById('boot');
  return !(b && !b.classList.contains('gone'));
}"""

PIN = """() => {
  const SF = globalThis.SNOWFLOW, c = SF.rig.camera, ch = SF.character;
  SF.__pose = { cp: c.position.toArray(), cq: c.quaternion.toArray(),
                chp: ch.position.toArray() };
  if (ch.velocity && ch.velocity.set) ch.velocity.set(0, 0, 0);
  ch.update = () => {};
  SF.rig.update = () => {};
  return SF.__pose;
}"""

RESEAT = """() => {
  const SF = globalThis.SNOWFLOW, c = SF.rig.camera, ch = SF.character, P = SF.__pose;
  ch.position.fromArray(P.chp);
  if (ch.velocity && ch.velocity.set) ch.velocity.set(0, 0, 0);
  c.position.fromArray(P.cp);
  c.quaternion.fromArray(P.cq);
  c.updateMatrixWorld(true);
  return true;
}"""

ARM = """() => {
  const SF = globalThis.SNOWFLOW, sp = SF.spells;
  SF.input.locked = true;
  for (const k of [1,2,3,4,5]) SF.progression.unlocked.add(k);
  if (sp._cdUntil) for (const k in sp._cdUntil) sp._cdUntil[k] = 0;
  SF.character.mana = SF.character.manaMax ?? 100;
  return { realm: sp.realm, mana: SF.character.mana };
}"""

CHROME = """() => {
  for (const sel of ['#hud','#crosshair','#spellbar','#minimap','#overlay','#boot',
                     '.ffg-controls','#xp','#floaters','#enemybars','#toast','#hint']) {
    document.querySelectorAll(sel).forEach(e => { e.style.visibility = 'hidden'; });
  }
}"""

def shot(page):
    return np.asarray(Image.open(io.BytesIO(page.screenshot())).convert("RGB")).astype(np.int16)

def cast_and_measure(page, tag):
    page.evaluate(ARM)
    time.sleep(0.4)
    base = shot(page)
    page.evaluate("() => window.dispatchEvent(new KeyboardEvent('keydown', {code:'Digit2', bubbles:true}))")
    time.sleep(0.15)
    page.evaluate("() => window.dispatchEvent(new KeyboardEvent('keyup', {code:'Digit2', bubbles:true}))")
    best = None
    t0 = time.time()
    while time.time() - t0 < 3.2:
        f = shot(page)
        d = np.abs(f - base).max(axis=2)
        mask = d > THRESH
        n = int(mask.sum())
        if best is None or n > best["n"]:
            best = {"n": n, "frame": f, "mask": mask, "t": round(time.time() - t0, 2)}
        time.sleep(0.18)
    n, frame, mask = best["n"], best["frame"], best["mask"]
    res = {"tag": tag, "fxPixels": n, "pickedAt_s": best["t"]}
    if n >= MIN_PX:
        add = (frame - base)[mask].mean(axis=0)
        absrgb = frame[mask].mean(axis=0)
        res["addRGB"] = [round(float(v), 1) for v in add]
        res["absRGB"] = [round(float(v), 1) for v in absrgb]
        r, g, bch = add
        res["dominant"] = "R" if r >= g and r >= bch else ("G" if g >= bch else "B")
        ys, xs = np.where(mask)
        res["bbox"] = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
    Image.fromarray(frame.astype(np.uint8)).save(f"{HARN}/audit_wave_{tag}.png")
    return res

def run():
    out = {}
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        page = b.new_page(viewport={"width": 1280, "height": 720})
        page.goto(URL)
        page.wait_for_function(READY, timeout=120000)
        time.sleep(3.0)
        page.evaluate(CHROME)
        page.evaluate(PIN)
        time.sleep(0.5)

        out["cold"] = cast_and_measure(page, "cold")

        out["enterRealm"] = page.evaluate("async () => await SNOWFLOW.enterRealm('ash')")
        page.evaluate(RESEAT)
        page.evaluate(CHROME)
        time.sleep(2.0)
        out["realmNow"] = page.evaluate("() => SNOWFLOW.spells.realm")
        out["ash"] = cast_and_measure(page, "ash")

        if "addRGB" in out.get("cold", {}) and "addRGB" in out.get("ash", {}):
            c, a = np.array(out["cold"]["addRGB"]), np.array(out["ash"]["addRGB"])
            out["dAdd_cold_vs_ash"] = round(float(np.linalg.norm(c - a)), 1)
        b.close()
    print(json.dumps(out, indent=2))
    with open(f"{HARN}/audit_waterrealm.json", "w") as f:
        json.dump(out, f, indent=2)

if __name__ == "__main__":
    run()
