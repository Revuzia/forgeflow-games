#!/usr/bin/env python
"""heal - C-HEAL / LC-05 heal cancel (P2-A lane player; the weapons.js hook shipped inert in P1-A): a heal is spent on COMPLETION, a
weapon switch mid-heal cancels it with the item kept, and the gun is usable within 0.4 s of the switch. Humans only: bots keep their heal.

    python _harness/p23/heal.py --disk
    python _harness/p23/heal.py --rev 9aa2b746                  # control: the P2 base spends the medkit at the START - MUST FAIL
    python _harness/p23/heal.py --disk --plant no-cancel        # W.cancelHeal removed (the hook goes inert) - MUST FAIL
    python _harness/p23/heal.py --disk --plant refund-lost      # a cancel that still burns one item - MUST FAIL
    python _harness/p23/heal.py --disk --inject F:/lc_p23/harness/stubs/heal_stub.js   # validation against a contract stub

PRACTICE (Savanna seed 4242), kernel loop frozen, frames stepped at 60 Hz, REAL keys and REAL LMB (pointer locked). Slot 4 holds the item
under test. Rows:
  contract           W.cancelHeal is a function
  cancel [medkit]    hp 30, 2 medkits: Digit4, LMB -> 'healStart'; 1.0 s later Digit1 (the pistol): the count is still 2, no heal is
                     running, hp is still 30 (the plan: "medkit at hp 30 switched at 1.0 s leaves the count unchanged")
  gun-ready          LMB held right after that switch: the pistol's first shot within 0.40 s (+1 frame) of the switch
  full [medkit]      hp 30, 2 medkits, no switch for 8.5 s: hp 100 and exactly ONE medkit spent
  last-item          hp 30, 1 medkit, full heal: the slot empties on completion and a gun is back in the hands
  cancel [shield]    shield 0, 3 big shields, switch at 1.0 s: the count is still 3
  bots-exempt        a bot mid-heal that equips another slot keeps healing (W.equipSlot on a bot-flagged range actor)
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
    "no-cancel": "W.cancelHeal = undefined",
    "refund-lost": "const c0 = W.cancelHeal; W.cancelHeal = function (W_, a) { const id = a.healing && a.healing.id; const r = c0 && c0.apply(this, arguments);"
                   " const sl = a.inventory.slots.find((x) => x && x.kind === 'consumable' && x.id === id); if (sl) sl.count = Math.max(0, sl.count - 1); return r; }",
}

PREP_JS = r"""([id, count, hp, sh]) => { const W = window.__LC__.W, p = W.player; const Q = window.__P23H__ = window.__P23H__ || { ev: [] };
  if (!Q.on) { Q.on = true; for (const n of ['healStart', 'healed', 'healCancel', 'shotFired', 'weaponEquipped']) W.events.on(n, function (a, x) { if (a === p) Q.ev.push({ n, t: +W.t.toFixed(4), x: n === 'shotFired' ? x : (typeof x === 'string' ? x : null) }); }); }
  Q.ev.length = 0; p.healing = null;
  p.inventory.slots[3] = { kind: 'consumable', id, count };
  if (!p.inventory.slots[0] || p.inventory.slots[0].id !== 'pistol') p.inventory.slots[0] = { kind: 'weapon', id: 'pistol', rarity: 0, mag: 12 };
  p.inventory.ammo.light = 999; p.hp = hp; p.shield = sh; p.vel.set(0, 0, 0); return true; }"""

READ_JS = r"""() => { const W = window.__LC__.W, p = W.player, sl = p.inventory.slots[3];
  return { t: +W.t.toFixed(4), hp: p.hp, shield: p.shield, healing: p.healing ? { id: p.healing.id, tLeft: +(p.healing.tLeft || 0).toFixed(3) } : null,
           slot3: sl ? { id: sl.id, count: sl.count } : null, wid: p.weapon && p.weapon.id, active: p.inventory.active, ev: window.__P23H__.ev.slice() }; }"""


def start_heal(s, id_, count, hp, sh):
    s.js(PREP_JS, [id_, count, hp, sh])
    s.press("Digit1")
    s.step_frames(40, 1 / 60)
    s.press("Digit4")
    s.step_frames(40, 1 / 60)          # past the 0.4 s ready delay
    s.page.mouse.down(button="left")
    s.step_frames(2, 1 / 60)
    s.page.mouse.up(button="left")
    return s.js(READ_JS)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    args = L.parse(ap)

    def body(v):
        with C.Session(args, "p23_heal") as s:
            v.data["setup"] = L.practice(s, 4242, "ashgrid")
            s.guard_player(False)
            have = L.contract(s, {"W.cancelHeal": "typeof W.cancelHeal === 'function'"})
            L.contract_row(v, "contract (W.cancelHeal is a function)", have)
            if args.plant:
                L.plant_js(s, PLANTS[args.plant])
            v.data["lock_s"] = L.lock_pointer(s)
            s.step_frames(10, 1 / 60)
            R = v.data["rows"] = {}
            # cancel [medkit] + gun-ready
            a = start_heal(s, "medkit", 2, 30, 0)
            R["cancel_started"] = a
            started = any(e["n"] == "healStart" for e in a["ev"])
            s.step_frames(60, 1 / 60)                       # 1.0 s into the heal
            mid = s.js(READ_JS)
            s.press("Digit1")
            t_sw = s.js("() => window.__LC__.W.t")
            s.page.mouse.down(button="left")
            s.step_frames(int(0.40 * 60) + 2, 1 / 60)
            s.page.mouse.up(button="left")
            b = s.js(READ_JS)
            R["cancel_mid"], R["cancel_after"] = mid, b
            v.check("cancel [medkit] (switched at 1.0 s: 2 medkits kept, no heal running, hp still 30)",
                    started and mid["healing"] is not None and b["slot3"] == {"id": "medkit", "count": 2} and b["healing"] is None and b["hp"] == 30,
                    {"started": started, "midHealing": mid["healing"], "after": {k: b[k] for k in ("slot3", "healing", "hp", "wid")}}, "count 2, healing null, hp 30")
            shots = [e for e in b["ev"] if e["n"] == "shotFired" and e["t"] > t_sw - 1e-6]
            # t_sw is read BEFORE the frame that applies the key (the press lands in the next stepped frame): + 1 frame of input latency,
            # compared on 1e-4 s (the event times are stamped to 4 decimals)
            first = round(shots[0]["t"] - t_sw, 4) if shots else None
            v.check("gun-ready (the pistol's first shot <= 0.40 s + 1 frame after the switch)", first is not None and first <= 0.40 + 1 / 60 + 1e-4 and b["wid"] == "pistol",
                    {"firstShotAfterS": first, "wid": b["wid"]}, "<= 0.417 s")
            # full [medkit]
            s.step_frames(60, 1 / 60)
            a = start_heal(s, "medkit", 2, 30, 0)
            s.step_frames(int(8.5 * 60), 1 / 60)
            f = s.js(READ_JS)
            R["full"] = f
            v.check("full [medkit] (8.5 s, no switch: hp 100 and exactly one medkit spent)", f["hp"] == 100 and f["slot3"] == {"id": "medkit", "count": 1} and f["healing"] is None,
                    {k: f[k] for k in ("hp", "slot3", "healing")}, "hp 100, count 1")
            # last-item
            a = start_heal(s, "medkit", 1, 30, 0)
            mid1 = s.js(READ_JS)
            s.step_frames(int(8.5 * 60), 1 / 60)
            g = s.js(READ_JS)
            R["last_mid"], R["last"] = mid1, g
            v.check("last-item (1 medkit: kept during the heal, slot empty + a gun in hand at completion)",
                    mid1["slot3"] == {"id": "medkit", "count": 1} and g["slot3"] is None and g["hp"] == 100 and (g["wid"] or "").find("consumable") < 0,
                    {"during": mid1["slot3"], "after": {k: g[k] for k in ("slot3", "hp", "wid")}}, "count 1 during, empty + gun after")
            # cancel [shield]
            a = start_heal(s, "big_shield", 3, 100, 0)
            s.step_frames(60, 1 / 60)
            s.press("Digit1")
            s.step_frames(10, 1 / 60)
            h = s.js(READ_JS)
            R["shield"] = h
            v.check("cancel [shield] (big shield switched at 1.0 s: 3 kept)", h["slot3"] == {"id": "big_shield", "count": 3} and h["healing"] is None,
                    {k: h[k] for k in ("slot3", "healing", "shield")}, "count 3")
            # bots-exempt: a bot-flagged range actor mid-heal equips another slot
            be = s.js("""() => { const W = window.__LC__.W, d = W.rangeDummies && W.rangeDummies[0]; if (!d) return null;
                const was = d.isBot; d.isBot = true; d.inventory.slots[0] = d.inventory.slots[0] || { kind: 'weapon', id: 'pistol', rarity: 0, mag: 12 };
                d.inventory.slots[3] = { kind: 'consumable', id: 'medkit', count: 2 }; W.equipSlot(d, 3);
                d.healing = { id: 'medkit', tLeft: 6 }; W.equipSlot(d, 0); const kept = !!d.healing; d.healing = null; d.isBot = was;
                return { kept, count: d.inventory.slots[3] && d.inventory.slots[3].count }; }""")
            R["botsExempt"] = be
            if be is None:
                v.cnj("bots-exempt (a bot's heal survives its own weapon switch)", "no range actor in the practice match")
            else:
                v.check("bots-exempt (a bot's heal survives its own weapon switch)", be["kept"], be, "healing kept")
            L.errors_row(v, s)
    return C.run_gate("p23_heal", body, args)


if __name__ == "__main__":
    sys.exit(main())
