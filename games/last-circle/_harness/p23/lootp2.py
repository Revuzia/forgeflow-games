#!/usr/bin/env python
"""lootp2 - P2-H loot (lane loot): LC-27 death piles, LC-28 supply drops, LC-29 tiered POIs + the hot zone. Plan gates: "a bot killed holding 240
medium drops 240 medium; at least 3 drops have landed by t = 760 s on 3 seeds; high-tier POIs give at least 1.5x the rare share of basic POIs";
section 5 "one readable pile with all ammo"; "supply drops: >= 3 per match, beacon until opened"; "a marked hot zone".

    python _harness/p23/lootp2.py --disk
    python _harness/p23/lootp2.py --rev 9aa2b746                # control: the P2 base (2-box ammo cap, no tiers, no beacons) - MUST FAIL
    python _harness/p23/lootp2.py --disk --plant ammo-cap       # the death path caps every ammo stack at 60 (the base's pile cap) - MUST FAIL (pile row)
    python _harness/p23/lootp2.py --disk --plant no-supply      # every 'supplyDropLanded' swallowed and W.supplyDrops emptied - MUST FAIL
    python _harness/p23/lootp2.py --lanes loot,hud              # validation: those lanes' work served over the base

Rows:
  tiers [3 seeds]     STANDARD Savanna / Isla Viva / Deepwood seeds 7 / 21 / 1234 at match start: W.lootTiers.pois carry tiers; the rare+ share of guns
                      lying in HIGH POIs >= 1.5 x the share in BASIC POIs (aggregated); W.lootHotZone exists on every seed
  supply [3 seeds]    the same matches fastForwarded to t = 760 s (the human guarded): >= 3 W.supplyDrops landed on every seed; every landed,
                      unopened drop still has its beacon
  supply-open         the human teleported to a landed drop, a REAL E held: 'supplyDropOpened', the drop marked opened, its beacon gone, its items out
  pile                a bot holding an AR, 240 medium and a medkit killed 3 m from the human: one death pile; 240 medium in it; ONE marker (ring + beam)
                      for the pile, none on its members; the marker in the best gun's rarity colour
  errors
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C

PLANTS = {
    # the death path itself caps every ammo stack at 60 (the base's 2-box pile cap, put back into the game's killActor)
    "ammo-cap": "const ka = W.killActor; W.killActor = function (a) { if (a && a.inventory && a.inventory.ammo) for (const t in a.inventory.ammo) a.inventory.ammo[t] = Math.min(a.inventory.ammo[t], 60); return ka.apply(this, arguments); }",
    "no-supply": "const em = W.events.emit.bind(W.events); W.events.emit = function (n) { if (n === 'supplyDropLanded') return; return em.apply(null, arguments); }; W.kernel._updaters.push(() => { if (Array.isArray(W.supplyDrops)) W.supplyDrops.length = 0; })",
}
RUNS = [("ashgrid", 7), ("isla_viva", 21), ("deepwood", 1234)]

TIER_JS = r"""() => { const W = window.__LC__.W, T = W.lootTiers; if (!T || !Array.isArray(T.pois) || !W.debugItems) return null;
  const tierAt = (x, z) => { let best = null, bk = Infinity; for (const p of T.pois) { const dx = x - p.x, dz = z - p.z, k = (dx * dx + dz * dz) / (p.r * p.r); if (k < 1 && k < bk) { bk = k; best = p; } } return best ? (best.hot ? 'hot' : best.tier) : 'out'; };
  const c = {}; for (const it of W.debugItems()) { const d = it.data; if (!d || d.kind !== 'weapon' || it.pile) continue; const p = it.pos || it; const t = tierAt(p.x, p.z);
    const e = c[t] = c[t] || { n: 0, rare: 0 }; e.n++; if ((d.rarity || 0) >= 2) e.rare++; }
  return { counts: c, hot: W.lootHotZone || T.hot || null, tiers: T.pois.reduce((m, p) => { m[p.tier] = (m[p.tier] || 0) + 1; return m; }, {}) }; }"""
SUPPLY_JS = r"""([toT]) => { const C = window.__LC__, W = C.W; if (!window.__P23SD__) { window.__P23SD__ = []; W.events.on('supplyDropLanded', (d) => window.__P23SD__.push(+W.t.toFixed(1))); }
  while (W.t < toT && W.phase !== 'over') { C.fastForward(5, 1 / 30); const p = W.player; if (p && p.alive) { p.hp = 100; p.shield = 100; } }
  const list = (W.supplyDrops || []).map((s) => ({ id: s.id, x: s.x, z: s.z, landed: !!s.landed, opened: !!s.opened }));
  // the drop's beacon = its beam slot in the shared marker pool (loot.js debugLootFx(id): the base's test hook), alive and tall
  const beaconAt = (s) => { if (!W.debugLootFx) return null; const o = (W.debugLootFx(s.id) || {}).obj; return !!(o && o.beam && o.beam.alive && (o.beam.top || 0) - (o.beam.y || 0) > 20); };
  return { t: +W.t.toFixed(1), events: window.__P23SD__.slice(), list, beacons: list.filter((s) => s.landed && !s.opened).map((s) => beaconAt(s)) }; }"""


def part_tiers_supply(s, v):
    agg = {}
    sup = {}
    opened = None
    for mp, seed in RUNS:
        L.start(s, "standard", seed, mp, guard=True)
        s.freeze_loop()
        tr = s.js(TIER_JS)
        v.data.setdefault("tiers", {})["%s_%d" % (mp, seed)] = tr
        if tr:
            for k, e in tr["counts"].items():
                a = agg.setdefault(k, {"n": 0, "rare": 0})
                a["n"] += e["n"]
                a["rare"] += e["rare"]
        sp = s.js(SUPPLY_JS, [760])
        sup["%s_%d" % (mp, seed)] = sp
        if opened is None:
            opened = open_drop(s, sp)
        s.thaw_loop()
    share = {k: round(e["rare"] / e["n"], 3) if e["n"] else None for k, e in agg.items()}
    hot_all = all((v.data["tiers"].get("%s_%d" % r) or {}).get("hot") for r in RUNS)
    ratio = round(share["high"] / share["basic"], 3) if share.get("high") and share.get("basic") else None
    v.check("tiers (rare+ share of guns in HIGH POIs >= 1.5 x BASIC, 3 seeds; a hot zone on every seed)", ratio is not None and ratio >= 1.5 and hot_all,
            {"share": share, "ratioHighBasic": ratio, "hotZones": hot_all, "n": {k: e["n"] for k, e in agg.items()}}, ">= 1.5, hot zone")
    for k, sp in sup.items():
        landed = [x for x in sp["list"] if x["landed"]]
        bea = sp["beacons"]
        v.check("supply [%s] (>= 3 drops landed by t 760 s; every landed unopened drop has its beacon)" % k,
                len(landed) >= 3 and bea is not None and all(b is True for b in bea), {"t": sp["t"], "landed": len(landed), "events": sp["events"], "beacons": bea},
                ">= 3, beacons")
    v.check("supply-open (REAL E at a landed drop: opened, beacon gone, items out)", bool(opened) and opened.get("ok"), opened, "opened")


def open_drop(s, sp):
    tgt = next((x for x in sp["list"] if x["landed"] and not x["opened"]), None)
    if not tgt:
        return {"ok": False, "why": "no landed unopened drop"}
    s.install_pump()
    s.js("([x, z]) => { const W = window.__LC__.W, p = W.player; p.pos.set(x + 1.3, W.map.heightAt(x + 1.3, z), z); p.vel.set(0, 0, 0); p.input.yaw = Math.PI / 2; window.__P23SO__ = [];"
         " W.events.on('supplyDropOpened', (a, d) => window.__P23SO__.push(d && d.id)); }", [tgt["x"], tgt["z"]])
    n_items0 = s.js("() => window.__LC__.W.debugItems ? window.__LC__.W.debugItems().length : null")
    s.step_frames(10, 1 / 60)
    s.page.keyboard.down("KeyE")
    s.step_frames(5 * 60, 1 / 60)
    s.page.keyboard.up("KeyE")
    s.step_frames(30, 1 / 60)
    r = s.js("""(id) => { const W = window.__LC__.W; const s = (W.supplyDrops || []).find((q) => q.id === id); const o = W.debugLootFx ? (W.debugLootFx(id) || {}).obj : null;
        const beam = !!(o && o.beam && o.beam.alive);
        return { opened: !!(s && s.opened), events: window.__P23SO__.slice(), beam, items: W.debugItems ? W.debugItems().length : null }; }""", tgt["id"])
    r["itemsBefore"] = n_items0
    r["ok"] = r["opened"] and tgt["id"] in r["events"] and r["beam"] is False and (r["items"] or 0) > (n_items0 or 0)
    return r


PILE_JS = r"""() => { const W = window.__LC__.W, K = W.SIM, p = W.player; const b = W.actors.find((a) => a.isBot && a.alive); if (!b) return null;
  b.pos.set(p.pos.x + 3, W.map.heightAt(p.pos.x + 3, p.pos.z), p.pos.z); b.vel.set(0, 0, 0);
  b.inventory.slots[1] = { kind: 'weapon', id: 'ar', rarity: 3, mag: 30 }; b.inventory.slots[2] = { kind: 'weapon', id: 'smg', rarity: 1, mag: 20 };
  b.inventory.slots[3] = { kind: 'consumable', id: 'medkit', count: 1 }; b.inventory.ammo.medium = 240;
  const before = W.debugItems ? W.debugItems().length : 0;
  W.killActor(b, p.id, 'ar'); window.__LC__.stepFrames(3, 1 / 60, true);
  const all = W.debugItems ? W.debugItems() : []; const near = all.filter((it) => { const q = it.pos || it; return Math.hypot(q.x - b.pos.x, q.z - b.pos.z) < 4; });
  const med = near.filter((it) => it.data && it.data.kind === 'ammo' && it.data.id === 'medium').reduce((s, it) => s + (it.data.count || 0), 0);
  const piles = W.debugPiles ? W.debugPiles() : null;
  const pileIds = [...new Set(near.map((it) => it.pile).filter(Boolean))];
  const has = (x) => x != null && x >= 0; const memberMarkers = near.filter((it) => it.pile && (has(it.ring) || has(it.beam) || has(it.glow))).length;
  const pl = piles ? piles.find((q) => pileIds.includes(q.id)) : null;
  const best = K.RARITY_COLOR && K.RARITY ? K.RARITY_COLOR[K.RARITY[3]] : null;
  return { items: near.length, medium: med, pileIds, piles: piles ? piles.length : null, pile: pl ? { ring: has(pl.ring), beam: has(pl.beam), color: pl.color, members: pl.members.length } : null,
           memberMarkers, bestColor: best, before }; }"""


def part_pile(s, v, plant=None):
    L.start(s, "standard", 7, "ashgrid", guard=True)
    s.land(140, protect=True)
    s.freeze_loop()
    if plant:                       # after the match start (a start may rebuild the W hooks a plant wraps)
        L.plant_js(s, plant)
    s.install_pump()
    r = s.js(PILE_JS)
    v.data["pile"] = r
    hexc = lambda c: (("#%06x" % c) if isinstance(c, int) else str(c or "")).lower()
    ok = bool(r) and r["medium"] == 240 and len(r["pileIds"]) == 1 and r["pile"] and r["pile"]["ring"] and r["pile"]["beam"] and r["memberMarkers"] == 0 \
        and hexc(r["pile"]["color"]).lstrip("#") == hexc(r["bestColor"]).lstrip("#")
    v.check("pile (240 medium in ONE pile; one ring + beam for the pile, none on members; the best gun's rarity colour)", ok, r, "240, 1 pile, 1 marker, epic colour")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    ap.add_argument("--parts", default="pile,tiers")
    args = L.parse(ap)

    def body(v):
        with C.Session(args, "p23_lootp2") as s:
            s.boot()
            L.dismiss_cards(s)
            have = L.contract(s, {"W.debugItems": "typeof W.debugItems === 'function'"})
            if args.plant:
                s.js("() => { window.__P23PLANT__ = true; }")
            if "pile" in args.parts:
                part_pile(s, v, PLANTS[args.plant] if args.plant else None)
                s.thaw_loop()
            if "tiers" in args.parts:
                if args.plant:
                    L.plant_js(s, PLANTS[args.plant])
                part_tiers_supply(s, v)
            have["W.lootTiers"] = bool(s.safe_js("() => !!window.__LC__.W.lootTiers", default=False))
            have["W.supplyDrops"] = bool(s.safe_js("() => Array.isArray(window.__LC__.W.supplyDrops)", default=False))
            L.contract_row(v, "contract (W.debugItems, W.lootTiers, W.supplyDrops)", have)
            L.errors_row(v, s)
    return C.run_gate("p23_lootp2", body, args)


if __name__ == "__main__":
    sys.exit(main())
