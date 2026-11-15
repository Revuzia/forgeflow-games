#!/usr/bin/env python
"""roster - P2-D LC-16 the new guns (DMR, LMG, burst AR: an explicit `fire` field and the burst cadence) + LC-34 per-class ADS time (owner OD-6)
+ the plan's bot soak (lane sim; bots PREFER_RANGE; hud icons / BURST label). Plan gate: "selftest length 9. DMR beats AR at 90 m and AR beats DMR at
15 m. LMG has the highest sustained value at 30 m. Each new gun spawns from a seeded roll. Bot soak: over 10 matches every gun gets at least 1 kill."

    python _harness/p23/roster.py --disk                         # node + fire + soak (10 whole matches: the long part)
    python _harness/p23/roster.py --disk --parts node,fire
    python _harness/p23/roster.py --rev 9aa2b746                 # control: the P2 base (6 guns) - MUST FAIL
    python _harness/p23/roster.py --disk --plant dmr-weak        # the DMR's damage 12 - MUST FAIL (the 90 m lane)
    python _harness/p23/roster.py --lanes sim,bots,hud           # validation: those lanes' work served over the base

Part NODE (sim/royale.js, no browser): ids (WEAPON_IDS has 9 incl. dmr / lmg / burst, each with fire auto | semi | burst) - lanes (gunValueAt:
  DMR > AR at 90 m, AR > DMR at 15 m, LMG the highest of all 9 at 30 m) - burst-cadence (K.fireInterval(burst) = ((n-1) gap + delay) / n) -
  ads-times (every gun has adsTimeS; pistol <= smg <= ar <= dmr <= lmg <= sniper) - rolls (20,000 seeded rolls each of rollFloorItem /
  rollChest / rollSupplyDrop: every new gun appears in each table).
Part FIRE (PRACTICE, Savanna 4242, REAL LMB / RMB): burst (one click = exactly 3 rounds 0.075 s apart; a held trigger = a burst every
  2 x 0.075 + 0.42 s) - ads-earned (DMR: the spread fire() uses on an ADS shot 0.10 s after RMB is the HIP cone; after adsTimeS + 0.05 s the
  ADS cone) - hud-label (the slot / weapon card names BURST for the burst rifle) - errors.
Part SOAK (--soak N whole STANDARD matches through fastForward, seeds 1..N on the three maps in turn): every one of the 9 guns gets >= 1 kill.
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C

PLANTS = {"dmr-weak": "if (K.WEAPONS.dmr) K.WEAPONS.dmr.damage = 12"}
NEW = ("dmr", "lmg", "burst")


def part_node(args, v):
    root, label = L.node_root(args)
    argv = [os.path.join(L.HERE, "node", "roster.cjs"), "--root", root, "--n", "20000"]
    if args.plant:
        argv += ["--plant", args.plant]
    r, _t, wall = L.run_node(argv, timeout=900)
    v.data["node"] = r
    ids = r["ids"] or []
    v.check("ids (WEAPON_IDS: 9 guns incl. dmr / lmg / burst, each with fire auto | semi | burst)",
            len(ids) == 9 and all(x in ids for x in NEW) and all(r["fire"].get(i) in ("auto", "semi", "burst") for i in ids), {"ids": ids, "fire": r["fire"]}, "9, fire set")
    val = r["value"]
    g = lambda d, i: (val.get(str(d)) or {}).get(i)
    ok = None not in (g(90, "dmr"), g(90, "ar"), g(15, "ar"), g(15, "dmr"), g(30, "lmg")) and g(90, "dmr") > g(90, "ar") and g(15, "ar") > g(15, "dmr") \
        and g(30, "lmg") >= max(x for x in val["30"].values() if x is not None)
    v.check("lanes (gunValueAt: DMR > AR at 90 m, AR > DMR at 15 m, LMG highest at 30 m)", ok,
            {"90": {k: g(90, k) and round(g(90, k), 2) for k in ("dmr", "ar")}, "15": {k: g(15, k) and round(g(15, k), 2) for k in ("ar", "dmr")},
             "30": {k: x and round(x, 2) for k, x in (val.get("30") or {}).items()}}, "as the plan")
    b = r["burst"]
    v.check("burst-cadence (K.fireInterval(burst) = ((n - 1) gap + delay) / n)", bool(b) and b["expect"] and abs(b["interval"] - b["expect"]) < 1e-9, b, "equal")
    ads = r["ads"]
    order = ["pistol", "smg", "ar", "dmr", "lmg", "sniper"]
    v.check("ads-times (every gun has adsTimeS; pistol <= smg <= ar <= dmr <= lmg <= sniper)",
            all(ads.get(i) for i in ids) and all(ads[a] <= ads[b] for a, b in zip(order, order[1:]) if a in ads and b in ads), ads, "set, ordered")
    miss = {t: [i for i in NEW if not (r["rolls"].get(t) or {}).get(i)] for t in ("floor", "chest", "supply")}
    v.check("rolls (20,000 seeded rolls: every new gun in the floor, chest and supply tables)", all(r["rolls"].get(t) for t in miss) and not any(miss.values()),
            {"missing": miss, "counts": {t: {i: (r["rolls"].get(t) or {}).get(i) for i in NEW} for t in miss}}, "none missing")
    v.info("node", {"root": label, "wall_s": wall})


SPREAD_HOOK = r"""() => { const W = window.__LC__.W, K = W.SIM; if (window.__P23R__) return; const Q = window.__P23R__ = { sp: [], shots: [] };
  const es = K.effectiveSpread; K.effectiveSpread = function (id, r, st) { const v = es.call(this, id, r, st);
    if (st && /at fire \(/.test(new Error().stack || '')) Q.sp.push({ id, v, ads: !!st.ads, t: +W.t.toFixed(4) }); return v; };
  W.events.on('shotFired', (a, wid) => { if (a === W.player) Q.shots.push({ wid, t: +W.t.toFixed(4) }); }); }"""


def part_fire(args, v):
    with C.Session(args, "p23_roster_fire") as s:
        L.practice(s, 4242, "ashgrid")
        if not s.js("() => !!(window.__LC__.W.SIM.WEAPONS.burst && window.__LC__.W.SIM.WEAPONS.dmr)"):
            v.check("burst (one click = 3 rounds 0.075 s apart; held = a burst every 0.57 s)", False, {"burst": "absent"}, "present")
            L.errors_row(v, s, "errors [fire]")
            return
        s.js(SPREAD_HOOK)
        L.lock_pointer(s)
        s.js("() => { const p = window.__LC__.W.player; p.inventory.slots[1] = { kind: 'weapon', id: 'burst', rarity: 0, mag: 30 }; p.inventory.slots[2] = { kind: 'weapon', id: 'dmr', rarity: 0, mag: 10 }; p.inventory.ammo.medium = 999; }")
        s.press("Digit2")
        s.step_frames(45, 1 / 60)
        s.js("() => { window.__P23R__.shots.length = 0; }")
        s.page.mouse.down(button="left")
        s.step_frames(2, 1 / 60)
        s.page.mouse.up(button="left")
        s.step_frames(50, 1 / 60)
        one = s.js("() => window.__P23R__.shots.filter((x) => x.wid === 'burst').map((x) => x.t)")
        s.js("() => { window.__P23R__.shots.length = 0; const p = window.__LC__.W.player; if (p.weapon) p.weapon.magAmmo = 30; }")
        s.step_frames(30, 1 / 60)
        s.page.mouse.down(button="left")
        s.step_frames(150, 1 / 60)
        s.page.mouse.up(button="left")
        held = s.js("() => window.__P23R__.shots.filter((x) => x.wid === 'burst').map((x) => x.t)")
        b = s.js("() => window.__LC__.W.SIM.WEAPONS.burst.burst")
        gaps1 = [round(y - x, 4) for x, y in zip(one, one[1:])]
        starts = [held[i] for i in range(0, len(held), b["n"])] if b else []
        cyc = [round(y - x, 3) for x, y in zip(starts, starts[1:])]
        want = (b["n"] - 1) * b["gapS"] + b["delayS"] if b else None
        v.check("burst (one click = exactly 3 rounds 0.075 s apart; held = a burst every (n-1) gap + delay)",
                len(one) == b["n"] and all(abs(x - b["gapS"]) <= 1 / 60 + 1e-6 for x in gaps1) and len(cyc) >= 2 and all(abs(c - want) <= 1 / 60 + 1e-6 for c in cyc),
                {"oneClick": len(one), "gaps": gaps1, "heldCycles": cyc, "want": want}, "3 rounds; cycle %.3f s" % (want or 0))
        s.step_frames(20, 1 / 60, render=True)
        card = s.js("() => document.body.innerText")
        v.check("hud-label (the burst rifle reads BURST in the HUD)", "BURST" in card.upper(), {"found": "BURST" in card.upper()}, "shown")
        # ADS earned at adsTimeS: DMR
        s.press("Digit3")
        s.step_frames(45, 1 / 60)
        ads_t = s.js("() => window.__LC__.W.SIM.WEAPONS.dmr.adsTimeS")
        res = {}
        for label, wait_s in (("early", 0.10), ("earned", ads_t + 0.05)):
            s.js("() => { window.__P23R__.sp.length = 0; const p = window.__LC__.W.player; if (p.weapon) { p.weapon.magAmmo = 10; p.weapon.cd = 0; p.weapon.state = 'ready'; } p.vel.set(0, 0, 0); }")
            s.step_frames(40, 1 / 60)
            s.page.mouse.down(button="right")
            s.step_frames(max(1, int(round(wait_s * 60))), 1 / 60)
            s.page.mouse.down(button="left")
            s.step_frames(1, 1 / 60)
            s.page.mouse.up(button="left")
            s.step_frames(2, 1 / 60)
            s.page.mouse.up(button="right")
            sp = s.js("() => window.__P23R__.sp.filter((x) => x.id === 'dmr')")
            res[label] = sp[0] if sp else None
            s.step_frames(60, 1 / 60)
        hip = s.js("() => { const K = window.__LC__.W.SIM; return [K.effectiveSpread('dmr', 0, { ads: false, speed: 0, sinceLastShotS: 9, heat: null }), K.effectiveSpread('dmr', 0, { ads: true, speed: 0, sinceLastShotS: 9, heat: null })]; }")
        e, d = res.get("early"), res.get("earned")
        v.check("ads-earned (DMR: 0.10 s into ADS = the hip cone; after adsTimeS = the ADS cone)",
                bool(e) and bool(d) and not e["ads"] and d["ads"] and d["v"] < e["v"], {"early": e, "earned": d, "adsTimeS": ads_t, "hipVsAdsLegacy": hip}, "hip, then ADS")
        L.errors_row(v, s, "errors [fire]")


SOAK_JS = r"""([maxS]) => { const C = window.__LC__, W = C.W; const k = {}; const off = W.events.on('actorDied', (a, by, wid) => { if (wid) k[wid] = (k[wid] || 0) + 1; });
  let t = 0; while (t < maxS && W.phase !== 'over') { C.fastForward(10, 1 / 30); t += 10; const p = W.player; if (p && p.alive) { p.hp = 100; p.shield = 100; } }
  return { kills: k, t: +W.t.toFixed(1), phase: W.phase, alive: W.actors.filter((a) => a.alive).length }; }"""


def part_soak(args, v):
    maps = ["isla_viva", "ashgrid", "deepwood"]
    tot = {}
    runs = []
    with C.Session(args, "p23_roster_soak") as s:
        s.boot()
        L.dismiss_cards(s)
        for i in range(args.soak):
            st = L.start(s, "standard", i + 1, maps[i % 3], team=None, guard=False)
            s.freeze_loop()
            r = s.js(SOAK_JS, [1500])
            runs.append({"seed": i + 1, "map": maps[i % 3], **r})
            for w, n in r["kills"].items():
                tot[w] = tot.get(w, 0) + n
            print("  soak %d/%d %s seed %d: %s" % (i + 1, args.soak, maps[i % 3], i + 1, r), flush=True)
            s.thaw_loop()
        ids = s.js("() => window.__LC__.W.SIM.WEAPON_IDS")
        L.errors_row(v, s, "errors [soak]")
    v.data["soak"] = runs
    miss = [i for i in ids if not tot.get(i)]
    v.check("soak (%d whole matches: every one of the %d guns gets >= 1 kill)" % (args.soak, len(ids)), len(ids) == 9 and not miss, {"kills": tot, "noKill": miss}, "none at 0")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    ap.add_argument("--parts", default="node,fire,soak")
    ap.add_argument("--soak", type=int, default=10)
    args = L.parse(ap)
    parts = args.parts.split(",")

    def body(v):
        if "node" in parts:
            part_node(args, v)
        if "fire" in parts:
            part_fire(args, v)
        if "soak" in parts:
            part_soak(args, v)
    return C.run_gate("p23_roster", body, args)


if __name__ == "__main__":
    sys.exit(main())
