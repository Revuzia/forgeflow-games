# -*- coding: utf-8 -*-
"""qa_boss_shots.py -- the three laneB screenshots, on their own (port 8871).

Same framing helper qa_boss.py uses (imported, not copied): boss intro, boss
phase 2, and the realm portal. Exists so the shots can be re-taken without
paying for the whole assertion battery again.
"""
import subprocess, sys, time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from qa_boss import ev, frame_shot, BOSS_POS, PORTAL_POS, FLAGS  # noqa: E402

ROOT = HERE.parents[2]
PORT = 8871
URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"

srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                       cwd=str(ROOT), stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL, wait_until="domcontentloaded")
        pg.wait_for_function("() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                             timeout=180000)
        pg.wait_for_timeout(4000)

        print(ev(pg, """
            SF.S.combatEnemies = false;
            SF.progression.level = 8;
            put(60, 60); C.facing = 0;
            await gameWait(0.6);
            const ok = B.spawnBoss('mini');
            await gameWait(1.0);
            return { ok, state: B.stats.state, name: B.stats.name };
        """))
        frame_shot(pg, "intro", BOSS_POS)

        print(ev(pg, """
            for (let n = 0; n < 400; n++) {
                const s = R.slot(B.bossId);
                if (s < 0 || R.hp[s] / R.hpMax[s] <= 0.54) break;
                R.damage(B.bossId, 30, {});
            }
            await gameWait(0.5);
            return { phase: B.stats.phase, hpFrac: +B.stats.hpFrac.toFixed(3),
                     speed: B.stats.speedNow, pattern: B.stats.patternNow };
        """))
        frame_shot(pg, "phase2", BOSS_POS)

        print(ev(pg, """
            B.clearBoss();
            for (let n = R.count - 1; n >= 0; n--)
                if (R.kind[n] !== 'dummy') R.remove(R.idOf[n]);
            put(120, -40); C.facing = 0;
            await gameWait(0.6);
            B.spawnBoss('realm');
            await gameWait(0.6);
            for (let n = 0; n < 600; n++) {
                const s = R.slot(B.bossId);
                if (s < 0 || R.hp[s] <= 0) break;
                R.damage(B.bossId, 400, {});
            }
            await gameWait(0.8);
            return { kills: B.stats.kills, portal: SF.portal.stats };
        """))
        # let the gate finish rising before the exposure
        ev(pg, "await gameWait(1.8); return SF.portal.stats.grow;")
        frame_shot(pg, "portal", PORTAL_POS, dist=7.0)
        print("errors:", errs)
        br.close()
finally:
    srv.terminate()
