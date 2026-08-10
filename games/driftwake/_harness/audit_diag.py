#!/usr/bin/env python
"""Diagnose the run environment for audit_rebind: shell phase, fps, cast wrap."""
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

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
    page = b.new_page(viewport={"width": 1280, "height": 720})
    page.goto(URL)
    page.wait_for_function(READY, timeout=120000)
    time.sleep(3)
    out = page.evaluate("""() => {
      const SF = globalThis.SNOWFLOW;
      const shell = globalThis.FFG ? globalThis.FFG.shell : null;
      // wrap cast to count calls
      const sp = SF.spells;
      SF.__castLog = [];
      const orig = sp.cast.bind(sp);
      sp.cast = (k) => { SF.__castLog.push([k, +sp._time.toFixed(3)]); return orig(k); };
      return {
        shellPhase: shell ? shell.phase : 'NO FFG SHELL',
        time: sp._time,
        docHasFocus: document.hasFocus(),
        visibility: document.visibilityState,
      };
    }""")
    # frame counter over 2 s
    page.evaluate("""() => {
      globalThis.__fc = 0;
      const tick = () => { globalThis.__fc++; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }""")
    t0 = page.evaluate("() => SNOWFLOW.spells._time")
    time.sleep(2)
    fc = page.evaluate("() => globalThis.__fc")
    t1 = page.evaluate("() => SNOWFLOW.spells._time")
    out["rafFps2s"] = fc / 2.0
    out["spellTimeAdvance2s"] = round(t1 - t0, 3)
    # character identity vs controller
    out["ident"] = page.evaluate("""() => {
      const SF = globalThis.SNOWFLOW, sp = SF.spells;
      return {
        charIsCtx: sp.ctx && sp.ctx.controller === SF.character,
        charMana: SF.character.mana,
        ctxMana: sp.ctx && sp.ctx.controller ? sp.ctx.controller.mana : null,
        manaMax: SF.character.manaMax ?? null,
      };
    }""")
    # press Digit2 unlocked with wrap in place
    page.evaluate("""() => {
      const SF = globalThis.SNOWFLOW;
      SF.input.locked = true;
      for (const k of [1,2,3,4,5]) SF.progression.unlocked.add(k);
      SF.character.mana = 100;
    }""")
    page.evaluate("() => window.dispatchEvent(new KeyboardEvent('keydown', {code:'Digit2', bubbles:true}))")
    time.sleep(0.3)
    page.evaluate("() => window.dispatchEvent(new KeyboardEvent('keyup', {code:'Digit2', bubbles:true}))")
    time.sleep(0.3)
    out["afterDigit2"] = page.evaluate("""() => {
      const SF = globalThis.SNOWFLOW, sp = SF.spells;
      return { castLog: SF.__castLog, cd1: +sp.cooldownFrac(1).toFixed(3),
               mana: SF.character.mana, time: +sp._time.toFixed(3),
               spellPressedNow: SF.input.spellPressed };
    }""")
    b.close()
print(json.dumps(out, indent=2))
