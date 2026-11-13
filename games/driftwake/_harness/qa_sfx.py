#!/usr/bin/env python
"""Combat/spell SFX layer battery (src/audio/sfx.js), port 8842.

A probe cannot hear. The acceptance bar is therefore:
  - AudioContext "running" after a REAL Playwright PLAY click (the gesture),
  - `SNOWFLOW.sfx.stats.triggers[name]` increments once per driven event,
  - the layer's master gain follows the shell's SOUND FX slider value,
  - one-shot voices actually open (voicesActive > 0 at some point),
  - the vortex loop opens on cast and closes when the column ends,
  - zero page errors while all of it happens.
"""
import json, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]
PORT = 8842
REPO = Path(__file__).resolve().parents[3]          # game dir is repo/games/driftwake
URL = f"http://localhost:{PORT}/games/driftwake/index.html?menu"

FAILS = []
def check(ok, label):
    print(("PASS " if ok else "FAIL ") + label)
    if not ok:
        FAILS.append(label)

def poll(pg, expr, timeout_s, tick=0.1):
    """Poll a JS expression until truthy; returns its last value."""
    end = time.time() + timeout_s
    val = None
    while time.time() < end:
        try:
            val = pg.evaluate(expr)
            if val: return val
        except Exception:
            pass
        pg.wait_for_timeout(int(tick * 1000))
    return val

# --- serve the repo root ourselves (double-bind on Windows is fine) ---------
server = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                          cwd=str(REPO), stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL)
time.sleep(2.5)

errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(URL, wait_until="load", timeout=60000)

        ok = poll(pg, "!!(globalThis.FFG && FFG.shell && globalThis.SNOWFLOW"
                      " && SNOWFLOW.progression && SNOWFLOW.sfx)", 120, 0.5)
        check(bool(ok), "boot: shell + SNOWFLOW + sfx published")
        pg.wait_for_timeout(2000)

        # --- the gesture: a REAL click on PLAY (JS .click() is untrusted and
        # would not unlock the AudioContext — the whole point of this step).
        pg.locator("button", has_text="PLAY").first.click()
        st = poll(pg, "SNOWFLOW.audio && SNOWFLOW.audio.state === 'running'"
                      " && !SNOWFLOW.S.freezeTime", 10)
        check(bool(st), "PLAY click unlocks: AudioContext running, sim unfrozen")
        ctx_state = pg.evaluate("SNOWFLOW.sfx.stats.context")
        check(ctx_state == "running", f"sfx sees the running context -> {ctx_state}")

        # --- master gain follows the shell's SOUND FX slider value ----------
        # The settings slider's oninput does exactly `FFG.sfxVolume = v`.
        pg.evaluate("FFG.sfxVolume = 0.33")
        pg.wait_for_timeout(600)
        mg = pg.evaluate("SNOWFLOW.sfx.stats.masterGain")
        check(abs(mg - 0.33) < 0.02, f"master gain follows the slider -> {mg}")
        pg.evaluate("FFG.sfxVolume = 1.0")
        pg.wait_for_timeout(300)

        def count(name):
            return pg.evaluate(f"SNOWFLOW.sfx.stats.triggers[{name!r}] || 0")

        mv = [0]   # peak voicesActive observed across every poll below
        # GAME-TIME waits: under the harness the page can run far below 60 fps
        # and game time crawls (measured: ~0.13 game-s per wall-s on this box),
        # so every scheduled strike (STRIKE_DELAY up to 0.98 game-s) needs a
        # budget in GAME seconds, polled off the registry clock, with a hard
        # wall-clock cap as the safety net.
        def wait_count(name, base, game_s, wall_cap=120):
            t0 = pg.evaluate("SNOWFLOW.combat.registry.time")
            end = time.time() + wall_cap
            while time.time() < end:
                s = pg.evaluate("SNOWFLOW.sfx.stats")
                if s["voicesActive"] > mv[0]: mv[0] = s["voicesActive"]
                if s["triggers"].get(name, 0) > base: return True
                if pg.evaluate("SNOWFLOW.combat.registry.time") - t0 > game_s:
                    return pg.evaluate(f"SNOWFLOW.sfx.stats.triggers[{name!r}] || 0") > base
                pg.wait_for_timeout(100)
            return False

        # --- bolt (LMB, id 6): throw + ground impact ------------------------
        b = count("spell_bolt")
        pg.evaluate("SNOWFLOW.spells.cast(6)")
        check(wait_count("spell_bolt", b, 1), "bolt cast -> spell_bolt count")
        # Worst case the bolt flies its whole 40 m leash at 21 m/s: ~2 game-s.
        check(wait_count("hit_bolt", 0, 3.5), "bolt terminates -> hit_bolt count")

        # --- frost arc (key 1 hotkey, id 7) ---------------------------------
        a = count("spell_arc")
        pg.evaluate("SNOWFLOW.spells.cast(7)")
        check(wait_count("spell_arc", a, 1), "arc cast -> spell_arc count")

        # --- an enemy in front, for wave-hit / windup / death ---------------
        eid = pg.evaluate("""(() => {
            const c = SNOWFLOW.character, f = SNOWFLOW.rig.forward;
            const fl = Math.hypot(f.x, f.z) || 1;
            return SNOWFLOW.combat.enemies.spawn('rimeImp',
                c.position.x + (f.x / fl) * 5, c.position.z + (f.z / fl) * 5, 1);
        })()""")
        check(eid is not None and eid >= 0, f"enemy spawned for hit tests -> id {eid}")
        pg.wait_for_timeout(500)   # a fresh spawn's registry slot lands NEXT frame

        # --- the four unlockable spells (fresh save: unlock first) ----------
        pg.evaluate("[1,3,4,5].forEach(k => SNOWFLOW.progression.unlocked.add(k))")

        w = count("spell_wave")
        pg.evaluate("SNOWFLOW.character.mana = 500; SNOWFLOW.spells.cast(1)")
        check(wait_count("spell_wave", w, 2.5), "wave ignite -> spell_wave count")
        check(wait_count("hit_wave", 0, 3), "wave reaches the imp -> hit_wave count")

        bl = count("spell_bloom_burst")
        pg.evaluate("SNOWFLOW.character.mana = 500; SNOWFLOW.spells.cast(3)")
        check(wait_count("spell_bloom_burst", bl, 2.5), "bloom burst -> spell_bloom_burst count")

        sp = count("spell_spikes_plant")
        pg.evaluate("SNOWFLOW.character.mana = 500; SNOWFLOW.spells.cast(4)")
        check(wait_count("spell_spikes_plant", sp, 2.5), "spikes plant -> spell_spikes_plant count")

        # --- vortex: loop opens on trigger, closes when the column ends -----
        v = count("spell_vortex")
        pg.evaluate("SNOWFLOW.character.mana = 500; SNOWFLOW.spells.cast(5)")
        check(wait_count("spell_vortex", v, 2.5), "vortex trigger -> spell_vortex count")
        la = pg.evaluate("SNOWFLOW.sfx.stats.loopActive")
        check(bool(la), "vortex churn loop is HELD while the column stands")
        # The column lives RAMP+HOLD+FADE = 4.65 game-s from its trigger.
        gone = poll(pg, "!SNOWFLOW.sfx.stats.loopActive", 90)
        check(bool(gone), "vortex loop RELEASES when the column ends (~4.7 s)")

        # --- windup + death on a FRESH imp ----------------------------------
        # The first imp usually dies to the spell battery above (its death
        # already counted enemy_death) — a dead body neither telegraphs nor
        # dies twice, so these two phases get their own target.
        eid2 = pg.evaluate("""(() => {
            const c = SNOWFLOW.character, f = SNOWFLOW.rig.forward;
            const fl = Math.hypot(f.x, f.z) || 1;
            return SNOWFLOW.combat.enemies.spawn('rimeImp',
                c.position.x + (f.x / fl) * 2.5, c.position.z + (f.z / fl) * 2.5, 1);
        })()""")
        check(eid2 is not None and eid2 >= 0, f"second imp spawned -> id {eid2}")
        pg.wait_for_timeout(500)

        # Windup cue: the imp at melee reach telegraphs within a few game-s.
        wu = count("enemy_windup")
        check(wait_count("enemy_windup", wu, 25, wall_cap=240),
              "enemy telegraph -> enemy_windup count")

        # Death dissolve: an explicit overkill on the LIVING imp.
        d = count("enemy_death")
        alive = pg.evaluate(f"SNOWFLOW.combat.registry.slot({eid2}) >= 0")
        pg.evaluate(f"SNOWFLOW.combat.registry.damage({eid2}, 99999, {{poise: 0, tag: 'probe'}})")
        check(wait_count("enemy_death", d, 3, wall_cap=60),
              f"kill (target alive: {alive}) -> enemy_death count")

        # --- player hurt thud (retry past the 0.5 GAME-s i-frame window) ----
        h = count("player_hurt")
        got = False
        for _ in range(10):
            pg.evaluate("SNOWFLOW.combat.enemies._hurtPlayer(3)")
            if wait_count("player_hurt", h, 0.15, wall_cap=3): got = True; break
            pg.wait_for_timeout(800)
        check(got, "player takes damage -> player_hurt count")

        check(mv[0] >= 1, f"voices actually opened -> peak voicesActive {mv[0]}")

        stats = pg.evaluate("SNOWFLOW.sfx.stats")
        print("final stats:", json.dumps(stats))
        check(not errors, f"zero page errors ({len(errors)})")
        for e in errors[:5]: print("  pageerror:", e)
        br.close()
finally:
    server.terminate()

print(("\nRESULT OK" if not FAILS else f"\nRESULT {len(FAILS)} FAILURE(S): " + "; ".join(FAILS)))
sys.exit(0 if not FAILS else 1)
