#!/usr/bin/env python
"""AUDIT: spell rebind (commit 9d95f49d) — input layer with REAL events.

FRAME-SYNCED: the page runs ~10 fps under the harness, so every key event is
followed by a wait for actual game frames (rAF counter + spellPressed consumed),
never a fixed sleep. Records every `input.spellPressed` edge through a
defineProperty tap and every `spells.cast()` invocation through a wrap.

Phases:
  A  baseline (spells array length, level, unlocked set, mana/manaMax)
  B  LOCKED state (level 1): Digit3/Digit5 must edge but NOT cast; spellbar locks
  C  unlock all: each bind casts the claimed spell (cooldown start = accept)
  D  cooldown re-gate: second Digit2 press while cooling must not re-cast
  E  mana gate: mana=0 written in the SAME tick as the keydown; cast must reject
"""
import json, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

URL = "http://localhost:8799/games/driftwake/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion",
         "--disable-backgrounding-occluded-windows",
         "--disable-renderer-backgrounding",
         "--disable-background-timer-throttling"]

READY = """() => {
  const SF = globalThis.SNOWFLOW;
  if (!SF || !SF.combat || !SF.spells || !SF.input) return false;
  const b = document.getElementById('boot');
  return !(b && !b.classList.contains('gone'));
}"""

INSTRUMENT = """() => {
  const SF = globalThis.SNOWFLOW, inp = SF.input, sp = SF.spells;
  inp.locked = true;
  const edges = [];
  let v = inp.spellPressed;
  Object.defineProperty(inp, 'spellPressed', {
    configurable: true,
    get() { return v; },
    set(x) { if (x) edges.push(x); v = x; },
  });
  SF.__edges = edges;
  SF.__castLog = [];
  const orig = sp.cast.bind(sp);
  sp.cast = (k) => { SF.__castLog.push(k); return orig(k); };
  globalThis.__fc = 0;
  const tick = () => { globalThis.__fc++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return { locked: inp.locked };
}"""

STATE = """() => {
  const SF = globalThis.SNOWFLOW, sp = SF.spells;
  const cd = {};
  for (const k of [1,3,4,5]) cd[k] = +sp.cooldownFrac(k).toFixed(3);
  return {
    edges: SF.__edges.slice(), castLog: SF.__castLog.slice(),
    mana: +SF.character.mana.toFixed(2), cd,
    ribbonHeld: !!sp.ribbon.held,
    spellHeld2: !!SF.input.spellHeld2, spellHeld1: !!SF.input.spellHeld1,
    boltHeld: !!SF.input.boltHeld,
    boltNext: +(sp._boltNext ?? -1).toFixed(3),
    time: +(sp._time ?? -1).toFixed(3),
    fc: globalThis.__fc,
  };
}"""

def key(page, code, down):
    page.evaluate(
        "([c, t]) => window.dispatchEvent(new KeyboardEvent(t, {code: c, bubbles: true}))",
        [code, "keydown" if down else "keyup"])

def mouse(page, down):
    page.evaluate(
        "d => document.dispatchEvent(new MouseEvent(d ? 'mousedown' : 'mouseup', {button:0, bubbles:true}))",
        down)

def wait_frames(page, n, timeout=15.0):
    """Wait for n real game frames AND the pressed edge to be consumed."""
    fc0 = page.evaluate("() => globalThis.__fc")
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = page.evaluate("() => ({fc: globalThis.__fc, sp: SNOWFLOW.input.spellPressed})")
        if st["fc"] - fc0 >= n and st["sp"] == 0:
            return True
        time.sleep(0.05)
    return False

def run():
    out = {}
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        page = b.new_page(viewport={"width": 1280, "height": 720})
        page.goto(URL)
        page.wait_for_function(READY, timeout=120000)
        time.sleep(3.0)
        page.evaluate(INSTRUMENT)
        wait_frames(page, 3)

        out["baseline"] = page.evaluate("""() => {
          const SF = globalThis.SNOWFLOW, sp = SF.spells;
          return {
            spellsArrayLen: Array.isArray(sp.spells) ? sp.spells.length : null,
            spellCtors: Array.isArray(sp.spells) ? sp.spells.map(s => s && s.constructor.name) : null,
            level: SF.progression.level,
            unlocked: Array.from(SF.progression.unlocked).sort(),
            mana: +SF.character.mana.toFixed(2),
            manaMax: SF.character.manaMax ?? null,
            realm: sp.realm,
          };
        }""")

        # ---- B locked-state (level 1): Digit3 (bloom L2), Digit5 (vortex L6)
        locked = {}
        for code, iid in (("Digit3", 3), ("Digit5", 5)):
            pre = page.evaluate(STATE)
            key(page, code, True); wait_frames(page, 2); key(page, code, False); wait_frames(page, 3)
            post = page.evaluate(STATE)
            locked[code] = {
                "newEdges": post["edges"][len(pre["edges"]):],
                "castCalls": post["castLog"][len(pre["castLog"]):],
                "cdAfter": post["cd"][str(iid)],
                "manaDelta": round(post["mana"] - pre["mana"], 2),
            }
        out["lockedState"] = locked
        out["spellbarLocks"] = page.evaluate("""() => {
          const r = {};
          document.querySelectorAll('#spellbar .sb-slot').forEach(s => {
            r[s.dataset.spell] = {
              bind: s.querySelector('.sb-bind').textContent,
              locked: s.classList.contains('locked'),
              lockLabel: s.querySelector('.sb-lock').textContent,
            };
          });
          return r;
        }""")

        # ---- C unlock all; test every bind, frame-synced
        page.evaluate("() => { for (const k of [1,2,3,4,5]) SNOWFLOW.progression.unlocked.add(k); }")
        casts = {}
        # Digit1 = held stream (no edge, ribbon holds)
        pre = page.evaluate(STATE)
        key(page, "Digit1", True); wait_frames(page, 4)
        mid = page.evaluate(STATE)
        key(page, "Digit1", False); wait_frames(page, 4)
        post = page.evaluate(STATE)
        casts["Digit1"] = {"newEdges": post["edges"][len(pre["edges"]):],
                           "castCalls": post["castLog"][len(pre["castLog"]):],
                           "heldMid": {"spellHeld2": mid["spellHeld2"], "spellHeld1": mid["spellHeld1"],
                                        "ribbonHeld": mid["ribbonHeld"]},
                           "ribbonHeldAfterUp": post["ribbonHeld"]}
        for code, iid in (("Digit2", 1), ("Digit3", 3), ("Digit4", 4), ("Digit5", 5)):
            page.evaluate("""() => {
              const sp = SNOWFLOW.spells;
              if (sp._cdUntil) for (const k in sp._cdUntil) sp._cdUntil[k] = 0;
              SNOWFLOW.character.mana = SNOWFLOW.character.manaMax ?? 100;
            }""")
            pre = page.evaluate(STATE)
            key(page, code, True); wait_frames(page, 2); key(page, code, False); wait_frames(page, 3)
            post = page.evaluate(STATE)
            casts[code] = {"newEdges": post["edges"][len(pre["edges"]):],
                           "castCalls": post["castLog"][len(pre["castLog"]):],
                           "cdAfter": post["cd"][str(iid)],
                           "manaDelta": round(post["mana"] - pre["mana"], 2)}
        # LMB bolt
        pre = page.evaluate(STATE)
        mouse(page, True); wait_frames(page, 3)
        mid = page.evaluate(STATE)
        mouse(page, False); wait_frames(page, 2)
        post = page.evaluate(STATE)
        casts["LMB"] = {"newEdges": post["edges"][len(pre["edges"]):],
                        "castCalls": post["castLog"][len(pre["castLog"]):],
                        "boltHeldMid": mid["boltHeld"], "boltHeldAfterUp": post["boltHeld"],
                        "boltNextBefore": pre["boltNext"], "boltNextAfter": post["boltNext"],
                        "timeMid": mid["time"], "manaDelta": round(post["mana"] - pre["mana"], 2)}
        out["casts"] = casts

        # ---- D cooldown re-gate: cast wave, then press again while cooling
        page.evaluate("""() => {
          const sp = SNOWFLOW.spells;
          if (sp._cdUntil) for (const k in sp._cdUntil) sp._cdUntil[k] = 0;
          SNOWFLOW.character.mana = SNOWFLOW.character.manaMax ?? 100;
        }""")
        key(page, "Digit2", True); wait_frames(page, 2); key(page, "Digit2", False); wait_frames(page, 2)
        pre = page.evaluate(STATE)
        key(page, "Digit2", True); wait_frames(page, 2); key(page, "Digit2", False); wait_frames(page, 3)
        post = page.evaluate(STATE)
        out["cooldownGate"] = {"cdAtSecondPress": pre["cd"]["1"], "cdAfter": post["cd"]["1"],
                               "newEdges": post["edges"][len(pre["edges"]):],
                               "castCalls": post["castLog"][len(pre["castLog"]):],
                               "manaDelta": round(post["mana"] - pre["mana"], 2)}

        # ---- E mana gate: zero mana in the SAME tick as the keydown
        page.evaluate("""() => {
          const sp = SNOWFLOW.spells;
          if (sp._cdUntil) for (const k in sp._cdUntil) sp._cdUntil[k] = 0;
        }""")
        pre = page.evaluate(STATE)
        page.evaluate("""() => {
          SNOWFLOW.character.mana = 0;
          window.dispatchEvent(new KeyboardEvent('keydown', {code:'Digit4', bubbles:true}));
        }""")
        wait_frames(page, 2)
        manamid = page.evaluate("() => +SNOWFLOW.character.mana.toFixed(2)")
        key(page, "Digit4", False); wait_frames(page, 2)
        post = page.evaluate(STATE)
        out["manaGate"] = {"newEdges": post["edges"][len(pre["edges"]):],
                           "castCalls": post["castLog"][len(pre["castLog"]):],
                           "cdAfter": post["cd"]["4"], "manaAtConsume": manamid,
                           "manaAfter": post["mana"]}
        b.close()
    print(json.dumps(out, indent=2))
    with open("C:/Users/TestRun/Claude Claw/forgeflow-games/games/driftwake/_harness/audit_rebind.json", "w") as f:
        json.dump(out, f, indent=2)

if __name__ == "__main__":
    run()
