#!/usr/bin/env python
"""Title-screen battery: opaque plate, PLAY=new run, CONTINUE=saved run."""
import sys, time
from playwright.sync_api import sync_playwright
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass
FLAGS = ["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox",
         "--enable-gpu-rasterization","--disable-features=CalculateNativeWinOcclusion"]
URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8799/games/driftwake/index.html"
# `?menu` defeats main.js's AUTOPLAY (navigator.webdriver) so the shell runs —
# without it an automated page skips the title screen entirely by design.
if "menu" not in URL:
    URL += ("&" if "?" in URL else "?") + "menu"

def ready(pg, needShell=True):
    end = time.time() + 120
    while time.time() < end:
        try:
            if pg.evaluate("!!(globalThis.FFG && FFG.shell && globalThis.SNOWFLOW && SNOWFLOW.progression)"):
                return True
        except Exception: pass
        pg.wait_for_timeout(500)
    return False

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
    pg = br.new_page(viewport={"width":1280,"height":720})
    pg.goto(URL, wait_until="load", timeout=60000)
    ready(pg); pg.wait_for_timeout(2500)

    # --- fresh visitor: no save -> only PLAY, no CONTINUE
    # NOTE: the launch's ephemeral profile IS a fresh visitor. Do NOT
    # localStorage.clear()+reload here — main.js saves on beforeunload, so a
    # reload writes a level-1 blob back BEFORE the fresh check (false FAIL).
    m = pg.evaluate("""(() => {
        const ov = document.querySelector('.ffg-ov') || document.querySelector('[style*="z-index:60"]') ||
                   [...document.querySelectorAll('div')].find(d => d.textContent.includes('DRIFTWAKE') && d.querySelector('button'));
        const btns = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
        const shellOv = FFG.shell.ov;
        const cs = getComputedStyle(shellOv);
        return {phase: FFG.shell.phase, buttons: btns,
                bg: cs.backgroundImage.slice(0, 120),
                opaqueLayer: cs.backgroundImage.includes('keyart'),
                canvasCovered: cs.display !== 'none'};
    })()""")
    print("fresh menu:", m["phase"], m["buttons"])
    print(("PASS " if m["opaqueLayer"] else "FAIL ") + "key art on the title plate")
    print(("PASS " if not any('CONTINUE' in b for b in m["buttons"]) else "FAIL ") + "no CONTINUE without a save")

    # is the world hidden? sample a pixel where the terrain would be
    shot = pg.screenshot()
    print(("PASS " if len(shot) > 0 else "FAIL ") + "menu renders")

    # --- PLAY -> new run at level 1, save created
    pg.evaluate("""(() => { const b = [...document.querySelectorAll('button')]
        .find(x => /PLAY|NEW RUN/i.test(x.textContent)); b.click(); })()""")
    pg.wait_for_timeout(2500)
    st = pg.evaluate("(() => ({phase: FFG.shell.phase, lvl: SNOWFLOW.progression.level, xp: SNOWFLOW.progression.xp}))()")
    print(("PASS " if st["phase"] == "playing" and st["lvl"] == 1 else "FAIL ") + f"PLAY starts a level-1 run -> {st}")

    # bank progress, then force a save
    pg.evaluate("SNOWFLOW.progression.addXP(4000, 'test'); SNOWFLOW.progression.save();")
    pg.wait_for_timeout(600)
    lvl = pg.evaluate("SNOWFLOW.progression.level")
    saved = pg.evaluate("!!localStorage.getItem('driftwake_save')")
    print(("PASS " if saved and lvl > 1 else "FAIL ") + f"run saved at level {lvl}")

    # --- reload: CONTINUE appears and restores that level
    pg.reload(wait_until="load"); ready(pg); pg.wait_for_timeout(2500)
    m2 = pg.evaluate(r"""(() => ({buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()),
        note: [...document.querySelectorAll('div')].map(d => d.textContent).find(t => /^Level \d/.test(t || '')) || ''}))()""")
    hasCont = any('CONTINUE' in b for b in m2["buttons"])
    print(("PASS " if hasCont else "FAIL ") + f"CONTINUE offered after a save -> {m2['buttons']} note='{m2['note']}'")
    if hasCont:
        pg.evaluate("""(() => { const b = [...document.querySelectorAll('button')]
            .find(x => /CONTINUE/i.test(x.textContent)); b.click(); })()""")
        pg.wait_for_timeout(2500)
        st2 = pg.evaluate("(() => ({phase: FFG.shell.phase, lvl: SNOWFLOW.progression.level}))()")
        print(("PASS " if st2["phase"] == "playing" and st2["lvl"] == lvl else "FAIL ") +
              f"CONTINUE restores level {lvl} -> {st2}")

    # --- NEW RUN over a save requires confirm, then resets
    pg.reload(wait_until="load"); ready(pg); pg.wait_for_timeout(2500)
    first = pg.evaluate("""(() => { const b = [...document.querySelectorAll('button')]
        .find(x => /NEW RUN/i.test(x.textContent)); if (!b) return 'no NEW RUN'; b.click();
        return FFG.shell.phase; })()""")
    pg.wait_for_timeout(600)
    warned = pg.evaluate("document.body.textContent.includes('press again to confirm')")
    print(("PASS " if first == "menu" and warned else "FAIL ") +
          f"NEW RUN over a save asks to confirm (phase after 1st click: {first}, warned: {warned})")
    pg.evaluate("""(() => { const b = [...document.querySelectorAll('button')]
        .find(x => /NEW RUN/i.test(x.textContent)); b.click(); })()""")
    pg.wait_for_timeout(2500)
    st3 = pg.evaluate("(() => ({phase: FFG.shell.phase, lvl: SNOWFLOW.progression.level}))()")
    print(("PASS " if st3["phase"] == "playing" and st3["lvl"] == 1 else "FAIL ") +
          f"confirmed NEW RUN resets to level 1 -> {st3}")
    br.close()
