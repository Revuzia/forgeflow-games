#!/usr/bin/env python
"""Battery D pre-probe: discover perfStats shape, encounters API, spells API,
floater/enemy-bar DOM anatomy. Read-only, ~20 s."""
import json, os, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

URL = "http://localhost:8799/games/driftwake/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
    pg = br.new_page(viewport={"width": 1280, "height": 720})
    pg.goto(URL, wait_until="load", timeout=60_000)
    deadline = time.time() + 120
    while time.time() < deadline:
        try:
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.combat)"):
                break
        except Exception:
            pass
        pg.wait_for_timeout(500)
    pg.wait_for_timeout(3000)

    info = pg.evaluate("""() => {
        const SF = globalThis.SNOWFLOW;
        const shape = (o, d=1) => {
            if (o == null) return String(o);
            if (typeof o !== 'object' && typeof o !== 'function') return typeof o + ':' + String(o).slice(0,40);
            if (typeof o === 'function') return 'fn(' + o.length + ')';
            if (d <= 0) return '{...}';
            const out = {};
            for (const k of Object.keys(o).slice(0, 40)) out[k] = shape(o[k], d-1);
            return out;
        };
        const enc = SF.combat.encounters;
        const doc = document;
        const floaterish = [];
        for (const el of doc.querySelectorAll('body *')) {
            const c = (el.className && typeof el.className === 'string') ? el.className : '';
            const id = el.id || '';
            if (/float|dmg|damage|bar|hp|pool/i.test(c + ' ' + id)) {
                floaterish.push((el.tagName + '.' + c + '#' + id).slice(0, 60));
            }
        }
        const counts = {};
        for (const f of floaterish) counts[f] = (counts[f]||0)+1;
        return {
            perfStats: shape(SF.perfStats, 2),
            perfStatsKeys: SF.perfStats ? Object.keys(SF.perfStats) : null,
            encountersShape: shape(enc, 1),
            spellsShape: shape(SF.spells, 1),
            aimType: SF.spells && SF.spells.aim ? (SF.spells.aim.isVector3 ? 'Vector3' : typeof SF.spells.aim) : null,
            cooldownFracType: SF.spells ? typeof SF.spells.cooldownFrac : null,
            charShape: shape(SF.character, 1),
            registryKeys: Object.keys(SF.combat.registry),
            regCount: SF.combat.registry.count,
            enemiesShape: shape(SF.combat.enemies, 1),
            domTotal: doc.querySelectorAll('*').length,
            floaterishCounts: counts,
            hasPerfMemory: !!performance.memory,
        };
    }""")
    print(json.dumps(info, indent=2)[:8000])
    br.close()
