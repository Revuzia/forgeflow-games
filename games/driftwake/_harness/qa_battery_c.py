#!/usr/bin/env python
"""DRIFTWAKE — Battery C: enemy AI end-to-end through the live game.

Drives http://localhost:8799 with Playwright (real Chrome, real frames) and
reads back only observed state off globalThis.SNOWFLOW: the enemy SoA pool
(combat/enemies.js), the Damageable registry, and controller.health.

Tests:
  1  aggro     imp at 30 m must hold; imp at 12 m (facing) must close + melee
  2  telegraph brute adjacent: time from ST_WINDUP entry to the hp drop
  3  cc        stun freezes the imp ~1.5 s; wave knocks it back metres
  4  sprite    caster at 15 m: bolts spawn, player hp drops, no melee range
  5  leash     player teleported 80 m: imp disengages, returns, heals full
  6  cleanup   kill everything: registry back to dummies-only, no orphans

The ambient encounter director (combat/encounters.js) is no-op-patched for
the battery so roaming packs cannot contaminate counts; noted in the report.
"""
import json, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

URL = "http://localhost:8799/games/driftwake/index.html"

SETUP = r"""
() => {
  const SF = globalThis.SNOWFLOW;
  if (!SF || !SF.combat) return { ok: false };
  const E = SF.combat.enemies;
  window.__qa = {
    slotOf(id) {
      for (let i = 0; i < 24; i++) if (E.alive[i] && E.id[i] === id) return i;
      return -1;
    },
    faceAt(i) {           // point enemy i's sight cone at the player
      const p = SF.character.position;
      E.yaw[i] = Math.atan2(p.x - E.x[i], -(p.z - E.z[i]));
    },
    boltsAlive() { let n = 0; for (let b = 0; b < 16; b++) n += E.boltAlive[b]; return n; },
    barsOn() { return document.querySelectorAll('.eb.on').length; },
    sample(secs, fn) {
      const rec = []; const t0 = performance.now();
      return new Promise(res => {
        const step = () => {
          const t = (performance.now() - t0) / 1000;
          rec.push(fn(t));
          if (t < secs) requestAnimationFrame(step); else res(rec);
        };
        requestAnimationFrame(step);
      });
    },
  };
  // Freeze the ambient pack director for the battery (restored on reload).
  SF.combat.encounters.update = () => {};
  E.clear();
  const reg = SF.combat.registry;
  let dummies = 0, enemies = 0;
  for (let s = 0; s < reg.count; s++) {
    if (reg.kind[s] === 'dummy') dummies++; else enemies++;
  }
  return { ok: true, regCount: reg.count, dummies, enemies,
           barsOn: window.__qa.barsOn(), blips: SF.minimap.blips.length,
           px: SF.character.position.x, pz: SF.character.position.z };
}
"""

T1A = r"""
async () => {
  const SF = SNOWFLOW, Q = window.__qa, E = SF.combat.enemies, C = SF.character;
  E.clear(); C.health = 100;
  const p = C.position;
  const id = E.spawn('rime_imp', p.x + 30, p.z, 10);
  const i = Q.slotOf(id);
  const rec = await Q.sample(5, t => [t,
      Math.hypot(E.x[i] - p.x, E.z[i] - p.z), E.state[i], C.health]);
  E.clear();
  return { spawnedId: id, rec };
}
"""

T1B = r"""
async () => {
  const SF = SNOWFLOW, Q = window.__qa, E = SF.combat.enemies, C = SF.character;
  E.clear(); C.health = 100;
  const p = C.position;
  const id = E.spawn('rime_imp', p.x + 12, p.z, 10);
  const i = Q.slotOf(id);
  Q.faceAt(i);
  const rec = await Q.sample(12, t => [t,
      Math.hypot(E.x[i] - p.x, E.z[i] - p.z), E.state[i], C.health]);
  return { rec, hp: C.health };
}
"""

T1C = r"""
async () => {   // i-frame cap: 4 imps adjacent, tokens allow 2 attackers
  const SF = SNOWFLOW, Q = window.__qa, E = SF.combat.enemies, C = SF.character;
  E.clear(); C.health = 100;
  const p = C.position;
  for (const [ox, oz] of [[2,0],[-2,0],[0,2],[0,-2]]) {
    const id = E.spawn('rime_imp', p.x + ox, p.z + oz, 10);
    Q.faceAt(Q.slotOf(id));
  }
  const rec = await Q.sample(10, t => [t, C.health]);
  E.clear();
  return { rec, hp: C.health };
}
"""

T2 = r"""
async () => {
  const SF = SNOWFLOW, Q = window.__qa, E = SF.combat.enemies, C = SF.character;
  E.clear(); C.health = 100;
  const p = C.position;
  const id = E.spawn('glacier_brute', p.x + 2, p.z, 10);
  const i = Q.slotOf(id);
  const rec = await Q.sample(9, t => [t, E.state[i], E.flash[i], C.health,
      Math.hypot(E.x[i] - p.x, E.z[i] - p.z)]);
  E.clear();
  return { rec };
}
"""

T3A = r"""
async () => {   // stun: freeze mid-approach for ccDur
  const SF = SNOWFLOW, Q = window.__qa, E = SF.combat.enemies, C = SF.character;
  const reg = SF.combat.registry;
  E.clear(); C.health = 100;
  const p = C.position;
  const id = E.spawn('rime_imp', p.x + 16, p.z, 10);
  const i = Q.slotOf(id);
  Q.faceAt(i);
  await Q.sample(1.0, () => 0);                    // let it aggro + start moving
  reg.damage(id, 1, { cc: 'stun', ccDur: 1.5 });
  const rec = await Q.sample(3.5, t => [t, E.x[i], E.z[i], E.state[i]]);
  E.clear();
  return { rec };
}
"""

T3B = r"""
async () => {   // wave knockback: imp 3 m in front, cast key 1 at it
  const SF = SNOWFLOW, Q = window.__qa, E = SF.combat.enemies, C = SF.character;
  const reg = SF.combat.registry;
  E.clear(); C.health = 100; C.mana = 100;
  const p = C.position;
  const id = E.spawn('rime_imp', p.x + 3, p.z, 20);   // L20: hp ~62, wave won't kill
  const i = Q.slotOf(id);
  const s0 = reg.slot(id);
  const hp0 = reg.hp[s0];
  const dx = E.x[i] - p.x, dz = E.z[i] - p.z;
  const d = Math.hypot(dx, dz);
  SF.spells.aim.set(dx / d, 0, dz / d);
  C.facing = Math.atan2(dz, dx);
  SF.spells.cast(1);
  const rec = await Q.sample(3, t => {
    const s = reg.slot(id);
    return [t, Math.hypot(E.x[i] - p.x, E.z[i] - p.z),
            s >= 0 ? reg.hp[s] : -1];
  });
  E.clear();
  return { hp0, rec };
}
"""

T4 = r"""
async () => {
  const SF = SNOWFLOW, Q = window.__qa, E = SF.combat.enemies, C = SF.character;
  E.clear(); C.health = 100;
  const p = C.position;
  const id = E.spawn('hoarfrost_sprite', p.x + 15, p.z, 10);
  const i = Q.slotOf(id);
  Q.faceAt(i);
  const rec = await Q.sample(12, t => [t,
      Math.hypot(E.x[i] - p.x, E.z[i] - p.z), E.state[i],
      Q.boltsAlive(), C.health]);
  E.clear();
  return { rec, hp: C.health };
}
"""

T5 = r"""
async () => {
  const SF = SNOWFLOW, Q = window.__qa, E = SF.combat.enemies, C = SF.character;
  const reg = SF.combat.registry;
  E.clear(); C.health = 100;
  const p = C.position;
  const px0 = p.x, pz0 = p.z;
  const id = E.spawn('rime_imp', px0 + 12, pz0, 10);
  const i = Q.slotOf(id);
  Q.faceAt(i);
  await Q.sample(1.0, () => 0);              // combat entered
  reg.damage(id, 10);                        // wound it so the heal is visible
  p.x = px0 - 80;                            // teleport the player away
  const rec = await Q.sample(30, t => {
    const s = reg.slot(id);
    return [t, Math.hypot(E.x[i] - E.homeX[i], E.z[i] - E.homeZ[i]),
            E.state[i], s >= 0 ? reg.hp[s] : -1,
            s >= 0 ? reg.hpMax[s] : -1];
  });
  p.x = px0; p.z = pz0;                      // put the player back
  const s = reg.slot(id);
  const end = { hp: s >= 0 ? reg.hp[s] : -1, hpMax: s >= 0 ? reg.hpMax[s] : -1,
                state: E.state[i] };
  E.clear();
  return { rec, end };
}
"""

T6 = r"""
async () => {
  const SF = SNOWFLOW, Q = window.__qa, E = SF.combat.enemies, C = SF.character;
  const reg = SF.combat.registry;
  E.clear(); C.health = 100;
  const p = C.position;
  const before = { regCount: reg.count };
  const ids = [
    E.spawn('rime_imp', p.x + 6, p.z, 10),
    E.spawn('rime_imp', p.x - 6, p.z, 10),
    E.spawn('hoarfrost_sprite', p.x + 14, p.z, 10),
    E.spawn('glacier_brute', p.x + 8, p.z + 4, 10),
  ];
  for (const id of ids) Q.faceAt(Q.slotOf(id));
  await Q.sample(1.5, () => 0);              // aggro, bars up, maybe bolts out
  const midBars = Q.barsOn();
  const midAlive = E.aliveCount;
  const midCount = reg.count;
  for (const id of ids) if (reg.slot(id) >= 0) reg.damage(id, 1e9);
  await Q.sample(2.5, () => 0);              // 1.2 s dissolve + margin
  let enemyKinds = 0;
  for (let s = 0; s < reg.count; s++) if (reg.kind[s] === 'enemy') enemyKinds++;
  return { before, spawned: ids, midBars, midAlive, midCount,
           after: { regCount: reg.count, aliveCount: E.aliveCount,
                    enemyKinds, bolts: Q.boltsAlive(), barsOn: Q.barsOn(),
                    blips: SF.minimap.blips.length } };
}
"""

ST = {0:"IDLE",1:"ALERTED",2:"COMBAT",3:"WINDUP",4:"RECOVER",5:"SUBMERGED",
      6:"RETREAT",7:"RETURN",8:"FIRING",9:"DYING"}


def drops(rec, hp_col):
    """[(t, amount)] of player-hp decreases across a [t, ..., hp] series."""
    out = []
    for a, b in zip(rec, rec[1:]):
        if b[hp_col] < a[hp_col] - 1e-6:
            out.append((b[0], a[hp_col] - b[hp_col]))
    return out


def main():
    out = {}
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=False, args=[
            "--ignore-gpu-blocklist", "--use-angle=d3d11",
            "--disable-gpu-sandbox", "--enable-gpu-rasterization"])
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.goto(URL, wait_until="load", timeout=120_000)
        end = time.time() + 180
        while time.time() < end and not pg.evaluate(
                "!!(globalThis.SNOWFLOW && SNOWFLOW.combat)"):
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(3000)   # settle

        base = pg.evaluate(SETUP)
        out["baseline"] = base
        print(f"BASELINE  registry count={base['regCount']} "
              f"(dummies={base['dummies']}, enemies={base['enemies']}), "
              f"bars-on={base['barsOn']}, blips={base['blips']}, "
              f"player=({base['px']:.1f},{base['pz']:.1f})")
        print("  [encounter director no-op-patched for the battery]")

        # ---- 1a: no aggro at 30 m -------------------------------------------
        r = pg.evaluate(T1A)
        rec = r["rec"]
        d0, d1 = rec[0][1], rec[-1][1]
        dmin = min(s[1] for s in rec)
        states = sorted(set(s[2] for s in rec))
        hplost = rec[0][3] - rec[-1][3]
        out["aggro_far"] = {"d0": d0, "dEnd": d1, "dMin": dmin,
                            "states": states, "hpLost": hplost}
        print(f"\n1a AGGRO-FAR  imp @ {d0:.2f} m for {rec[-1][0]:.1f} s: "
              f"dist end {d1:.2f} m (min {dmin:.2f}), "
              f"states seen {[ST[s] for s in states]}, player hp lost {hplost:.1f}")

        # ---- 1b: aggro + melee at 12 m --------------------------------------
        r = pg.evaluate(T1B)
        rec = r["rec"]
        hs = drops(rec, 3)
        dmin = min(s[1] for s in rec)
        t_combat = next((s[0] for s in rec if s[2] == 2), None)
        span = (hs[-1][0] - hs[0][0]) if len(hs) > 1 else 0
        dps = sum(a for _, a in hs) / span if span > 0 else 0
        gaps = [round(b[0]-a[0], 3) for a, b in zip(hs, hs[1:])]
        out["aggro_near"] = {"tCombat": t_combat, "dMin": dmin, "hits": hs,
                             "gaps": gaps, "dps": dps}
        print(f"1b AGGRO-NEAR imp @ 12 m: combat at t={t_combat}, "
              f"closed to {dmin:.2f} m, {len(hs)} hits "
              f"{[(round(t,2), round(a,1)) for t,a in hs]}")
        print(f"   inter-hit gaps {gaps} s; dps over hit-span {dps:.2f}")

        # ---- 1c: i-frame cap with 4 imps ------------------------------------
        r = pg.evaluate(T1C)
        hs = drops(r["rec"], 1)
        gaps = [round(b[0]-a[0], 3) for a, b in zip(hs, hs[1:])]
        total = sum(a for _, a in hs)
        span = (hs[-1][0] - hs[0][0]) if len(hs) > 1 else 0
        out["iframes"] = {"hits": len(hs), "gaps": gaps, "total": total,
                          "minGap": min(gaps) if gaps else None,
                          "dps": total / span if span else 0}
        print(f"1c I-FRAMES   4 imps adjacent, 10 s: {len(hs)} hits, "
              f"total {total:.1f} hp, min inter-hit gap "
              f"{min(gaps) if gaps else 'n/a'} s, gaps {gaps}")

        # ---- 2: brute telegraph ---------------------------------------------
        r = pg.evaluate(T2)
        rec = r["rec"]
        tele = []
        t_w = None
        prev_state = rec[0][1]
        prev_hp = rec[0][3]
        for s in rec:
            if s[1] == 3 and prev_state != 3:
                t_w = s[0]
            if s[3] < prev_hp - 1e-6 and t_w is not None:
                tele.append({"windup": t_w, "hit": s[0],
                             "ms": round((s[0] - t_w) * 1000),
                             "dmg": round(prev_hp - s[3], 2)})
                t_w = None
            prev_state, prev_hp = s[1], s[3]
        out["telegraph"] = tele
        print(f"\n2 TELEGRAPH  glacier_brute adjacent: "
              f"{len(tele)} slam(s): " + "; ".join(
                  f"windup->hit {t['ms']} ms, dmg {t['dmg']}" for t in tele))

        # ---- 3a: stun -------------------------------------------------------
        r = pg.evaluate(T3A)
        rec = r["rec"]
        # per-frame speed; find the frozen stretch from t=0
        moving_at = None
        frozen_until = 0
        for a, b in zip(rec, rec[1:]):
            dt = b[0] - a[0]
            if dt <= 0: continue
            v = ((b[1]-a[1])**2 + (b[2]-a[2])**2) ** 0.5 / dt
            if v < 0.2:
                frozen_until = b[0]
            elif moving_at is None and b[0] > 0.1:
                moving_at = b[0]
                break
        out["stun"] = {"frozenS": frozen_until, "movingAt": moving_at}
        print(f"\n3a STUN      damage(1, cc=stun, ccDur=1.5) mid-approach: "
              f"stationary for {frozen_until:.2f} s, movement resumed at "
              f"t={moving_at if moving_at is not None else '>3.5'} s")

        # ---- 3b: wave knockback ---------------------------------------------
        r = pg.evaluate(T3B)
        rec = r["rec"]
        hp0 = r["hp0"]
        t_hit = next((s[0] for s in rec if 0 <= s[2] < hp0 - 1e-6), None)
        if t_hit is not None:
            d_at_hit = next(s[1] for s in rec if s[0] >= t_hit)
            after = [s[1] for s in rec if t_hit <= s[0] <= t_hit + 1.2]
            kb = max(after) - d_at_hit
            hp_after = next(s[2] for s in rec if s[0] >= t_hit)
            out["knockback"] = {"tHit": t_hit, "dAtHit": d_at_hit,
                                "dMax": max(after), "kbMetres": kb,
                                "dmg": hp0 - hp_after}
            print(f"3b KNOCKBACK wave (key 1) on imp @ {rec[0][1]:.2f} m: hit at "
                  f"t={t_hit:.2f}, dist {d_at_hit:.2f} -> {max(after):.2f} m "
                  f"(jump {kb:.2f} m), wave dmg {hp0 - hp_after:.1f}")
        else:
            out["knockback"] = {"tHit": None}
            print("3b KNOCKBACK wave did NOT hit the imp (no hp drop seen)")

        # ---- 4: sprite casts ------------------------------------------------
        r = pg.evaluate(T4)
        rec = r["rec"]
        spawn_events = sum(max(0, b[3]-a[3]) for a, b in zip(rec, rec[1:]))
        hs = drops(rec, 4)
        dmin = min(s[1] for s in rec)
        dmax = max(s[1] for s in rec)
        fired = any(s[2] == 8 for s in rec)
        out["sprite"] = {"boltSpawns": spawn_events, "hits": hs,
                         "dMin": dmin, "dMax": dmax, "firedState": fired}
        print(f"\n4 SPRITE     @ 15 m, 12 s: {spawn_events:.0f} bolts launched, "
              f"FIRING state seen={fired}, {len(hs)} player hits "
              f"{[(round(t,2), round(a,1)) for t,a in hs]}, "
              f"kept range {dmin:.1f}-{dmax:.1f} m")

        # ---- 5: leash -------------------------------------------------------
        r = pg.evaluate(T5)
        rec = r["rec"]
        t_ret = next((s[0] for s in rec if s[2] == 7), None)
        maxHome = max(s[1] for s in rec)
        t_home = next((s[0] for s in rec if t_ret and s[0] > t_ret and s[1] < 1.5), None)
        hp_low = min(s[3] for s in rec if s[3] >= 0)
        e = r["end"]
        out["leash"] = {"tReturn": t_ret, "maxHomeDist": maxHome,
                        "tHome": t_home, "hpLow": hp_low, "end": e}
        print(f"\n5 LEASH      player teleported 80 m: chased to {maxHome:.1f} m "
              f"from home, RETURN at t={t_ret}, back home at t={t_home}, "
              f"hp {hp_low:.1f} -> {e['hp']:.1f}/{e['hpMax']:.1f}, "
              f"end state {ST.get(e['state'])}")

        # ---- 6: kill cleanup ------------------------------------------------
        r = pg.evaluate(T6)
        out["cleanup"] = r
        a = r["after"]
        print(f"\n6 CLEANUP    spawned 4 (reg {r['before']['regCount']}"
              f"->{r['midCount']}, bars-on {r['midBars']}, alive {r['midAlive']}); "
              f"after kill+2.5 s: reg count {a['regCount']} "
              f"(enemy-kind rows {a['enemyKinds']}), enemies alive "
              f"{a['aliveCount']}, bolts {a['bolts']}, bars-on {a['barsOn']}, "
              f"blips {a['blips']}")

        br.close()

    with open("qa_battery_c_last.json", "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    print("\n  -> qa_battery_c_last.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
