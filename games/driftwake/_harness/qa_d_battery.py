#!/usr/bin/env python
"""Battery D — perf + stability soak.

Phase 1: 10 s idle baseline fps (rAF counter + SNOWFLOW.perfStats).
Phase 2: spawn 12 mixed enemies near player, 15 s fps while they attack.
Phase 3: 20 s spell spam (keys 1/3/4/5 + ribbon bursts) amid the pack;
         NaN scans, console errors, event-ring, floater/enemy-bar DOM counts.
Phase 4: 60 s soak, encounters director live, W held; pageerrors, heap, fps trend.
All numbers observed, none expected.
"""
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

console_msgs = []   # (phase, type, text)
page_errors = []    # (phase, text)
PHASE = ["boot"]

def snap_perf(pg):
    return pg.evaluate("""() => {
        const ps = SNOWFLOW.perfStats || {};
        const m = performance.memory;
        const r = SNOWFLOW.combat.registry;
        let alive = 0;
        for (let i = 0; i < r.count; i++) if (r.alive[i]) alive++;
        return {fps: ps.fps, fpsLow: ps.fpsLow, drawCalls: ps.drawCalls,
                triangles: ps.triangles, gpuMs: ps.gpuMs == null ? null : +ps.gpuMs.toFixed(2),
                medianMs: ps.median, regCount: r.count, regAlive: alive,
                heapMB: m ? +(m.usedJSHeapSize / 1048576).toFixed(1) : null};
    }""")

def dom_counts(pg):
    return pg.evaluate("""() => ({
        total: document.querySelectorAll('*').length,
        floaters: document.querySelectorAll('#floaters *').length,
        enemybars: document.querySelectorAll('#enemybars *').length,
    })""")

def nan_scan(pg):
    return pg.evaluate("""() => {
        const r = SNOWFLOW.combat.registry, ch = SNOWFLOW.character;
        const bad = [];
        for (let i = 0; i < r.count; i++)
            if (Number.isNaN(r.hp[i]) || Number.isNaN(r.x[i]) || Number.isNaN(r.z[i])) bad.push(i);
        return {regNaNSlots: bad,
                charHealthNaN: Number.isNaN(ch.health),
                charManaNaN: Number.isNaN(ch.mana),
                charPosNaN: [ch.position.x, ch.position.y, ch.position.z].some(Number.isNaN),
                eventCount: r.eventCount, evRingCap: r.evType ? r.evType.length : null};
    }""")

def measure_fps(pg, seconds):
    """rAF frame count over a wall-clock window; returns observed fps."""
    pg.evaluate("window.__qaF = 0")
    t0 = time.time()
    pg.wait_for_timeout(int(seconds * 1000))
    frames = pg.evaluate("window.__qaF")
    dt = time.time() - t0
    return round(frames / dt, 1), round(dt, 2)

report = {}

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
    pg = br.new_page(viewport={"width": 1280, "height": 720})
    pg.on("console", lambda m: console_msgs.append((PHASE[0], m.type, m.text[:300]))
          if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: page_errors.append((PHASE[0], str(e)[:400])))
    pg.goto(URL, wait_until="load", timeout=60_000)
    deadline = time.time() + 120
    while time.time() < deadline:
        try:
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.combat)"):
                break
        except Exception:
            pass
        pg.wait_for_timeout(500)
    pg.bring_to_front()
    pg.wait_for_timeout(3000)  # settle

    # persistent rAF counter
    pg.evaluate("""() => {
        window.__qaF = 0;
        (function loop(){ window.__qaF++; requestAnimationFrame(loop); })();
    }""")

    # ---------- Phase 1: baseline ----------
    PHASE[0] = "P1-baseline"
    fps1, dt1 = measure_fps(pg, 10)
    report["P1"] = {"fps_rAF": fps1, "window_s": dt1, "perf": snap_perf(pg),
                    "dom": dom_counts(pg), "nan": nan_scan(pg)}

    # ---------- Phase 2: 12 mixed enemies attacking ----------
    PHASE[0] = "P2-pack"
    spawned = pg.evaluate("""() => {
        const SF = SNOWFLOW, ch = SF.character;
        const mix = ['rime_imp','rime_imp','rime_imp','rime_imp','rime_imp','rime_imp',
                     'hoarfrost_sprite','hoarfrost_sprite','hoarfrost_sprite','hoarfrost_sprite',
                     'glacier_brute','glacier_brute'];
        const out = [];
        for (let i = 0; i < mix.length; i++) {
            const a = i / mix.length * Math.PI * 2, rr = 9 + (i % 3) * 2;
            const x = ch.position.x + Math.sin(a) * rr, z = ch.position.z + Math.cos(a) * rr;
            let id = null, err = null;
            try { id = SF.combat.enemies.spawn(mix[i], x, z, 1); } catch (e) { err = String(e); }
            out.push({key: mix[i], id: id, err: err});
        }
        return out;
    }""")
    pg.wait_for_timeout(1500)  # let them aggro
    fps2, dt2 = measure_fps(pg, 15)
    report["P2"] = {"spawned": spawned, "fps_rAF": fps2, "window_s": dt2,
                    "fps_delta_vs_baseline": round(fps2 - fps1, 1),
                    "perf": snap_perf(pg), "dom": dom_counts(pg), "nan": nan_scan(pg)}

    # ---------- Phase 3: 20 s spell spam ----------
    PHASE[0] = "P3-spells"
    hp_before = pg.evaluate("""() => {
        const r = SNOWFLOW.combat.registry; let s = 0;
        for (let i = 0; i < r.count; i++) if (r.alive[i]) s += r.hp[i];
        return +s.toFixed(1);
    }""")
    # in-page caster: every 200 ms aim at nearest enemy, top up mana+health
    # (top-ups reported — they keep the soak from ending in a death screen),
    # cast first ready spell among internal keys 1/3/4/5.
    pg.evaluate("""() => {
        window.__qaCastN = 0; window.__qaCastErrs = [];
        window.__qaCast = setInterval(() => {
            try {
                const SF = SNOWFLOW, r = SF.combat.registry, ch = SF.character;
                let best = -1, bd = 1e18;
                for (let i = 0; i < r.count; i++) {
                    if (!r.alive[i]) continue;
                    const dx = r.x[i] - ch.position.x, dz = r.z[i] - ch.position.z;
                    const d = dx*dx + dz*dz;
                    if (d < bd) { bd = d; best = i; }
                }
                if (best >= 0) {
                    const dx = r.x[best] - ch.position.x, dz = r.z[best] - ch.position.z;
                    const L = Math.hypot(dx, dz) || 1;
                    ch.facing = Math.atan2(dx, dz);
                    SF.spells.aim.set(dx / L, 0, dz / L);
                }
                ch.mana = ch.manaMax; ch.health = ch.healthMax;
                for (const k of [1, 3, 4, 5]) {
                    if (SF.spells.cooldownFrac(k) <= 0) { SF.spells.cast(k); window.__qaCastN++; break; }
                }
            } catch (e) { window.__qaCastErrs.push(String(e).slice(0, 200)); }
        }, 200);
    }""")
    p3_samples = []
    t_end = time.time() + 20
    ribbon_ok = pg.evaluate("typeof SNOWFLOW.spells.holdRibbon === 'function'")
    next_ribbon = time.time() + 2
    ribbon_on_until = 0
    while time.time() < t_end:
        now = time.time()
        if ribbon_ok and now >= next_ribbon:
            pg.evaluate("SNOWFLOW.spells.holdRibbon(true)")
            ribbon_on_until = now + 1.0
            next_ribbon = now + 4.0
        if ribbon_on_until and now >= ribbon_on_until:
            pg.evaluate("SNOWFLOW.spells.holdRibbon(false)")
            ribbon_on_until = 0
        p3_samples.append({"t": round(now - (t_end - 20), 1),
                           "dom": dom_counts(pg), "nan": nan_scan(pg)})
        pg.wait_for_timeout(1800)
    if ribbon_ok:
        pg.evaluate("SNOWFLOW.spells.holdRibbon(false)")
    cast_stats = pg.evaluate("""() => {
        clearInterval(window.__qaCast);
        return {casts: window.__qaCastN, errs: window.__qaCastErrs};
    }""")
    hp_after = pg.evaluate("""() => {
        const r = SNOWFLOW.combat.registry; let s = 0, alive = 0;
        for (let i = 0; i < r.count; i++) if (r.alive[i]) { s += r.hp[i]; alive++; }
        return {hpSum: +s.toFixed(1), alive: alive};
    }""")
    report["P3"] = {"ribbonAvailable": ribbon_ok, "castAttempts": cast_stats["casts"],
                    "castErrors": cast_stats["errs"],
                    "enemyHpSumBefore": hp_before, "enemyHpAfter": hp_after,
                    "samples": p3_samples, "perf": snap_perf(pg)}

    # ---------- Phase 4: 60 s soak, W held, director live ----------
    PHASE[0] = "P4-soak"
    pg.evaluate("SNOWFLOW.character.health = SNOWFLOW.character.healthMax")
    pg.keyboard.down("w")
    soak = []
    t0 = time.time()
    for i in range(12):  # 12 x 5 s = 60 s
        fpsb, _ = measure_fps(pg, 5)
        s = snap_perf(pg)
        s["t"] = round(time.time() - t0, 1)
        s["fps_rAF"] = fpsb
        soak.append(s)
    pg.keyboard.up("w")
    report["P4"] = {"buckets": soak, "dom_end": dom_counts(pg), "nan_end": nan_scan(pg),
                    "pos_end": pg.evaluate(
                        "() => ({x:+SNOWFLOW.character.position.x.toFixed(1), z:+SNOWFLOW.character.position.z.toFixed(1)})")}

    report["console_errors"] = [m for m in console_msgs if m[1] == "error"]
    report["console_warnings_n"] = sum(1 for m in console_msgs if m[1] == "warning")
    report["console_warnings_sample"] = [m for m in console_msgs if m[1] == "warning"][:5]
    report["page_errors"] = page_errors
    br.close()

print(json.dumps(report, indent=1))
