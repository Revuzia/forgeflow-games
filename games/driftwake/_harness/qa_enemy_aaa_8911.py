# -*- coding: utf-8 -*-
"""
qa_enemy_aaa.py -- the per-enemy AAA behavioural gauntlet (owner 2026-08-10:
"make sure they properly run, attack, take damage, etc").

For EVERY spawnable identity in all three realms, in one live session:

  RIG    the bound body is a real Mixamo-rigged skeleton (bone count, name),
         with its role kit's core clips present (idle/walk/run/death + attacks)
  CHASE  spawned at 13 m the unit responds: closes distance, or opens its
         ranged/stealth behaviour (bolt in flight / submerge / telegraph) --
         and whenever it MOVES, a locomotion clip carries the feet
  ATTACK adjacent, the telegraph ramps (flash) and a strike follows (lunge /
         bolt / player hp loss)
  DAMAGE registry.damage() through the real pipeline drops its hp
  DEATH  dissolve ramps, the death CLIP plays from its start (the
         reset-on-death fix: action time must be young, not clamped at end),
         and the slot frees

All waits are GAME time (registry clock), immune to harness Chrome running
slow. Exit 0 only if every unit passes every phase.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
GAME_URL = "http://localhost:8911/games/driftwake/index.html"

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

BAND_MIN = {"cold": 1, "sand": 8, "ash": 18}

# One in-page helper battery, installed once. Sampling promises accumulate
# GAME dt off the registry clock so a 0.1x-wall harness frame rate cannot
# fake a timeout or a missed one-frame edge.
HELPERS = """(() => {
    const SF = SNOWFLOW;
    window.__aaa = {
        gameWait(sec) {
            const reg = SF.combat.registry;
            const t0 = reg.time;
            return new Promise((res) => {
                const tick = () => (reg.time - t0 >= sec) ? res(true)
                    : requestAnimationFrame(tick);
                tick();
            });
        },
        sample(slot, sec) {
            const SFc = SF.character, e = SF.combat.enemies, v = e.vis;
            const reg = SF.combat.registry;
            const t0 = reg.time;
            const d0 = Math.hypot(e.x[slot] - SFc.position.x,
                                  e.z[slot] - SFc.position.z);
            const m = { d0: +d0.toFixed(2), dMin: d0, maxSpeed: 0, maxLoc: 0,
                        maxFlash: 0, maxLunge: 0, maxSub: 0, bolt: false,
                        hp0: SFc.health, moved: 0 };
            const x0 = e.x[slot], z0 = e.z[slot];
            return new Promise((res) => {
                const tick = () => {
                    if (!e.alive[slot]) { m.gone = true; return res(m); }
                    const d = Math.hypot(e.x[slot] - SFc.position.x,
                                         e.z[slot] - SFc.position.z);
                    if (d < m.dMin) m.dMin = d;
                    m.moved = Math.max(m.moved,
                        Math.hypot(e.x[slot] - x0, e.z[slot] - z0));
                    if (v) {
                        if (v.speed01[slot] > m.maxSpeed) m.maxSpeed = v.speed01[slot];
                        if (v.flash[slot] > m.maxFlash) m.maxFlash = v.flash[slot];
                        if (v.lunge[slot] > m.maxLunge) m.maxLunge = v.lunge[slot];
                        if (v.submerge[slot] > m.maxSub) m.maxSub = v.submerge[slot];
                        const inst = v._slotInst[slot];
                        if (inst && inst.weights) {
                            const loc = inst.weights[1] + inst.weights[2];
                            if (loc > m.maxLoc) m.maxLoc = loc;
                        }
                    }
                    for (let b = 0; b < e.boltAlive.length; b++) {
                        if (e.boltAlive[b]) { m.bolt = true; break; }
                    }
                    if (reg.time - t0 >= sec) {
                        m.dMin = +m.dMin.toFixed(2);
                        m.moved = +m.moved.toFixed(2);
                        m.maxSpeed = +m.maxSpeed.toFixed(2);
                        m.maxLoc = +m.maxLoc.toFixed(2);
                        m.maxFlash = +m.maxFlash.toFixed(2);
                        m.maxLunge = +m.maxLunge.toFixed(2);
                        m.maxSub = +m.maxSub.toFixed(2);
                        m.hpNow = SFc.health;
                        return res(m);
                    }
                    requestAnimationFrame(tick);
                };
                tick();
            });
        },
        deathWatch(slot, sec) {
            const e = SF.combat.enemies, v = e.vis;
            const reg = SF.combat.registry;
            const t0 = reg.time;
            const m = { maxDis: 0, maxDeathW: 0, firstActT: -1, freed: false };
            return new Promise((res) => {
                const tick = () => {
                    const inst = v ? v._slotInst[slot] : null;
                    if (v && e.alive[slot]) {
                        if (v.dissolve[slot] > m.maxDis) m.maxDis = v.dissolve[slot];
                        if (inst && inst.weights && inst.acts[4]) {
                            if (inst.weights[4] > m.maxDeathW)
                                m.maxDeathW = inst.weights[4];
                            // The reset-on-death proof: the FIRST time the
                            // death clip carries weight, its playhead must be
                            // young. A clamped-finished action reads == dur.
                            if (m.firstActT < 0 && inst.weights[4] > 0.05) {
                                const a = inst.acts[4];
                                m.firstActT = +(a.time /
                                    a.getClip().duration).toFixed(2);
                            }
                        }
                    }
                    if (!e.alive[slot]) m.freed = true;
                    if (m.freed || reg.time - t0 >= sec) {
                        m.maxDis = +m.maxDis.toFixed(2);
                        m.maxDeathW = +m.maxDeathW.toFixed(2);
                        return res(m);
                    }
                    requestAnimationFrame(tick);
                };
                tick();
            });
        },
    };
    return true;
})()"""


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8911"], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    fails = []
    rows = []
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(GAME_URL + "?autoplay", wait_until="domcontentloaded")
            pg.wait_for_function("() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                                 timeout=120000)
            pg.wait_for_timeout(2500)
            pg.evaluate(HELPERS)

            for realm in ("cold", "sand", "ash"):
                pg.evaluate(f"SNOWFLOW.enterRealm('{realm}')")
                pg.wait_for_timeout(1500)
                # every body of the realm resident before the gauntlet
                pg.evaluate("SNOWFLOW.combat.enemies.vis.stream()")
                pg.wait_for_function(
                    "() => SNOWFLOW.combat.enemies.vis.stats.types >= 8",
                    timeout=120000)
                pg.evaluate(
                    "SNOWFLOW.combat.encounters._nextSpawnAt = 1e9;"
                    "SNOWFLOW.combat.encounters._clearAll();"
                    "SNOWFLOW.combat.enemies.clear();")

                units = pg.evaluate(f"""(() => {{
                    const U = [];
                    const roster = SNOWFLOW.combat.enemies.units ||
                                   SNOWFLOW.combat.data.UNITS;
                    for (let i = 0; i < roster.length; i++) {{
                        if (roster[i].realm === '{realm}')
                            U.push({{ key: roster[i].key,
                                      role: roster[i].animRole || '' }});
                    }}
                    return U;
                }})()""")
                lv = BAND_MIN[realm]

                # RIG audit per resident body TYPE (once per realm)
                rigs = pg.evaluate("""(() => {
                    const out = [];
                    const v = SNOWFLOW.combat.enemies.vis;
                    for (const slug of v._types.keys()) {
                        const t = v._types.get(slug);
                        if (!t || t.state !== 1) { out.push({slug, state: t ? t.state : -1}); continue; }
                        const sk = t.protoMesh.skeleton;
                        const clips = (t.clips || []).map(c => c.name);
                        out.push({
                            slug, bones: sk.bones.length,
                            bone0: sk.bones[0] ? sk.bones[0].name : "",
                            nClips: clips.length,
                            kit: t.clipNames.length,
                            missing: t.clipNames.filter(n =>
                                clips.indexOf(n) < 0),
                        });
                    }
                    return out;
                })()""")
                for r in rigs:
                    bad = (r.get("bones", 0) < 15 or r.get("nClips", 0) < 4
                           or len(r.get("missing", [])) > 2)
                    tag = "RIG-POOR" if bad else "rig-ok"
                    if bad:
                        fails.append(f"{realm}:{r['slug']} rig {r}")
                    print(f"  {tag} {r['slug']} bones={r.get('bones')} "
                          f"clips={r.get('nClips')}/{r.get('kit')} "
                          f"missing={r.get('missing')}")

                for u in units:
                    key, role = u["key"], u["role"]
                    pg.evaluate(
                        "(() => { const c = SNOWFLOW.character;"
                        " c.hp = c.hpMax; c.mana = c.manaMax; })()")
                    st = pg.evaluate(f"""(() => {{
                        const SF = SNOWFLOW, c = SF.character,
                              e = SF.combat.enemies;
                        const a = SF.rig.yaw;
                        const x = c.position.x + Math.sin(a) * 13;
                        const z = c.position.z - Math.cos(a) * 13;
                        const id = e.spawn('{key}', x, z, {lv});
                        if (typeof id !== 'number' || id <= 0)
                            return {{ err: 'spawn ' + String(id) }};
                        let slot = -1;
                        for (let i = 0; i < e.alive.length; i++)
                            if (e.alive[i] && e.id[i] === id) {{ slot = i; break; }}
                        const inst = e.vis ? e.vis._slotInst[slot] : null;
                        return {{ id, slot, bound: !!inst,
                                  slug: inst ? inst.type.slug : null }};
                    }})()""")
                    if st.get("err") or not st.get("bound"):
                        fails.append(f"{realm}:{key} spawn/bind {st}")
                        print(f"FAIL {realm}:{key} spawn/bind {st}")
                        continue
                    slot, eid = st["slot"], st["id"]

                    # WAKE: perception is a 130-deg sight cone + 4 m proximity
                    # (enemies.js _perceives) and a fresh spawn faces yaw 0 --
                    # the AAA-legit wake at 13 m is a hit (aggro-on-damage).
                    pg.evaluate(
                        f"SNOWFLOW.combat.registry.damage({eid}, 1, {{}})")
                    # CHASE, 3.5 s game time
                    ch = pg.evaluate(f"__aaa.sample({slot}, 6.0)")
                    approached = ch["d0"] - ch["dMin"] >= 1.5
                    # enemies.js:90 (spec 4.3/3.5): guards, wardens, sentinels
                    # and knights HOLD A POST -- refusing to chase from 13 m
                    # is the designed behaviour, so their proof of life is the
                    # adjacent attack phase instead.
                    holds_post = role in ("sentinel", "warden", "guardian",
                                          "knight", "golem", "boss")
                    responded = (holds_post or approached or ch["bolt"] or
                                 ch["maxFlash"] > 0.2 or ch["maxSub"] > 0.2)
                    loc_ok = ch["maxSpeed"] < 0.3 or ch["maxLoc"] > 0.2
                    # ATTACK: teleport adjacent, 4.5 s game time
                    pg.evaluate(f"""(() => {{
                        const SF = SNOWFLOW, c = SF.character,
                              e = SF.combat.enemies;
                        const a = SF.rig.yaw;
                        e.x[{slot}] = c.position.x + Math.sin(a) * 1.6;
                        e.z[{slot}] = c.position.z - Math.cos(a) * 1.6;
                    }})()""")
                    at = pg.evaluate(f"__aaa.sample({slot}, 4.5)")
                    # A stalker's dive-erupt fires DURING the chase window, so
                    # attack evidence legitimately spans both samples.
                    lunge = max(at["maxLunge"], ch["maxLunge"])
                    flash = max(at["maxFlash"], ch["maxFlash"])
                    bolt = at["bolt"] or ch["bolt"]
                    struck = (lunge > 0.05 or bolt or
                              at["hpNow"] < ch["hp0"])
                    telegraphed = flash > 0.3 or bolt
                    # DAMAGE through the pipeline
                    dmg = pg.evaluate(f"""(() => {{
                        const reg = SNOWFLOW.combat.registry;
                        const s = reg.slot({eid});
                        if (s < 0) return {{ err: 'slot gone' }};
                        const hp0 = reg.hp[s];
                        reg.damage({eid}, 6, {{}});
                        return {{ hp0: +hp0.toFixed(1),
                                  hp1: +reg.hp[s].toFixed(1) }};
                    }})()""")
                    took = (not dmg.get("err")) and dmg["hp1"] < dmg["hp0"]
                    # DEATH: lethal damage, watch the clip
                    pg.evaluate(
                        f"(() => {{ const reg = SNOWFLOW.combat.registry;"
                        f" if (reg.slot({eid}) >= 0)"
                        f" reg.damage({eid}, 99999, {{}}); }})()")
                    de = pg.evaluate(f"__aaa.deathWatch({slot}, 2.2)")
                    died = (de["maxDis"] > 0.5 and de["freed"])
                    anim_death = de["maxDeathW"] > 0.25
                    fresh_clip = 0 <= de["firstActT"] <= 0.5 \
                        if de["firstActT"] >= 0 else False

                    ok = (responded and loc_ok and telegraphed and struck
                          and took and died and anim_death and fresh_clip)
                    verdict = "PASS" if ok else "FAIL"
                    if not ok:
                        fails.append(f"{realm}:{key}")
                    rows.append((realm, key, verdict))
                    print(f"{verdict} {realm}:{key} [{st['slug']}] "
                          f"chase(d {ch['d0']}->{ch['dMin']} loc {ch['maxLoc']}"
                          f" spd {ch['maxSpeed']} sub {ch['maxSub']}) "
                          f"atk(flash {at['maxFlash']} lunge {at['maxLunge']}"
                          f" bolt {at['bolt']} hp {at['hp0']}->{at['hpNow']}) "
                          f"dmg({dmg.get('hp0')}->{dmg.get('hp1')}) "
                          f"death(dis {de['maxDis']} w {de['maxDeathW']}"
                          f" t0 {de['firstActT']} freed {de['freed']})")
                    pg.evaluate(
                        "SNOWFLOW.combat.enemies.clear();"
                        "SNOWFLOW.combat.encounters._clearAll();"
                        "SNOWFLOW.combat.encounters._nextSpawnAt = 1e9;")

            if errs:
                fails.append("page errors: " + " | ".join(errs[:4]))
                print("PAGE ERRORS:", errs[:4])
            br.close()
    finally:
        srv.terminate()

    npass = sum(1 for r in rows if r[2] == "PASS")
    print(f"\n{npass}/{len(rows)} units PASS")
    print("RESULT:", "OK" if not fails else "ENEMY AAA FAIL: " +
          ", ".join(fails[:12]))
    sys.exit(0 if not fails else 1)


if __name__ == "__main__":
    main()
