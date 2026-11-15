#!/usr/bin/env python
"""modes - C-MODE / LC-19 Duos / Trios with bot teammates (owner OD-4; no ranked) + LC-18 squad drop. Lanes: sim (K.TEAM_SIZE), boot (team
assignment in ffg_royale3d.js), bots (squad behaviour), hud (the mode cards), net (mode + teamId on the wire: dbno.py's human2 part).

    python _harness/p23/modes.py --disk
    python _harness/p23/modes.py --rev 9aa2b746                 # control: the P2 base (no team modes) - MUST FAIL
    python _harness/p23/modes.py --disk --plant teams-off       # after the start every actor becomes its own team - MUST FAIL (follow / drop rows)
    python _harness/p23/modes.py --lanes all                    # validation: every lane's work served over the base

Rows:
  contract            K.TEAM_SIZE = {solo 1, duo 2, trio 3, squad 4}
  sizes [mode]        STANDARD, Savanna seed 7, startMatch({ teamMode }): W.match.mode = the mode and W.match.pace = 'standard'; every actor has a
                      teamId; team sizes = the mode's size (the remainder in ONE smaller team: 50 = 16 x 3 + 2, 12 x 4 + 2); the human's team = the
                      human + (size - 1) BOTS                                                                              (solo / duo / trio / squad)
  drop-together [mode] every team's members touch down within 100 m of each other (LC-18 squad drop: >= 95 % of the teams; duo seeds 7 + 21, trio 7)
  follow [mode]       120 s after landing (the human AFK under the guard): the bot teammates' median distance to the human <= 60 m
  menu-card           the menu's team row offers SOLO / DUO / TRIO (/ SQUAD); a REAL click on DUO then the QUICK MATCH card starts a duo match
  errors
"""
from __future__ import annotations

import argparse
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C

PLANTS = {"teams-off": "for (const a of W.actors) a.teamId = a.id"}
SIZE = {"solo": 1, "duo": 2, "trio": 3, "squad": 4}

TEAMS_JS = r"""() => { const W = window.__LC__.W, p = W.player; const by = new Map(); let nulls = 0;
  for (const a of W.actors) { if (!a.teamId) { nulls++; continue; } if (!by.has(a.teamId)) by.set(a.teamId, []); by.get(a.teamId).push(a); }
  const mine = by.get(p.teamId) || [p];
  return { mode: W.match && W.match.mode, pace: W.match && W.match.pace, n: W.actors.length, nulls, sizes: [...by.values()].map((l) => l.length).sort((a, b) => b - a),
           mine: mine.map((a) => ({ id: a.id, bot: !!a.isBot, human: a === p })) }; }"""
# every actor's first touchdown, recorded per frame through the drop (fastForward slices)
DROP_JS = r"""() => { const C = window.__LC__, W = C.W; const land = new Map(); let n = 0;
  W.events.on('landed', (a) => { if (a && !land.has(a.id)) land.set(a.id, [a.pos.x, a.pos.z]); });     // the glide touchdown itself (player.js emits it)
  // the FIRST frame each actor stands on the ground (W.phase stays 'drop' ~15 s after touchdown: the touchdown itself is what LC-18 places)
  while (n < 3000 && W.actors.some((a) => a.alive && !land.has(a.id))) {
    C.fastForward(1 / 15, 1 / 30); n++; const p = W.player; if (p && p.alive) { p.hp = Math.max(p.hp, 100); p.shield = Math.max(p.shield || 0, 100); }
  }
  const by = new Map(); for (const a of W.actors) { if (!land.has(a.id) || !a.teamId) continue; if (!by.has(a.teamId)) by.set(a.teamId, []); by.get(a.teamId).push(land.get(a.id)); }
  let teams = 0, together = 0; const worst = [];
  for (const [t, l] of by) { if (l.length < 2) continue; teams++; let m = 0; for (const a of l) for (const b of l) m = Math.max(m, Math.hypot(a[0] - b[0], a[1] - b[1]));
    if (m <= 100) together++; else worst.push([t, Math.round(m)]); }
  return { teams, together, share: teams ? +(together / teams).toFixed(3) : null, worst: worst.slice(0, 6), t: +W.t.toFixed(1) }; }"""
FOLLOW_JS = r"""([S]) => { const C = window.__LC__, W = C.W, p = W.player; const ds = [];
  const mates = W.actors.filter((a) => a !== p && !!a.teamId && a.teamId === p.teamId);
  for (let i = 0; i < S; i++) { C.fastForward(1, 1 / 30); if (p.alive) { p.hp = 100; p.shield = 100; }
    for (const m of mates) if (m.alive) ds.push(Math.hypot(m.pos.x - p.pos.x, m.pos.z - p.pos.z)); }
  ds.sort((a, b) => a - b); return { mates: mates.length, alive: mates.filter((m) => m.alive).length, samples: ds.length, median: ds.length ? +ds[ds.length >> 1].toFixed(1) : null, p90: ds.length ? +ds[Math.floor(ds.length * 0.9)].toFixed(1) : null }; }"""


def sizes_ok(t, mode):
    k = SIZE[mode]
    want = [k] * (50 // k) + ([50 % k] if 50 % k else [])
    mine = t["mine"]
    return (t["mode"] == mode and t["pace"] == "standard" and t["nulls"] == 0 and t["sizes"] == sorted(want, reverse=True)
            and len(mine) == k and sum(1 for m in mine if m["human"]) == 1 and all(m["bot"] for m in mine if not m["human"]))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    ap.add_argument("--modes", default="solo,duo,trio,squad")
    args = L.parse(ap)
    modes = [m for m in args.modes.split(",") if m]

    def body(v):
        with C.Session(args, "p23_modes") as s:
            s.boot()
            L.dismiss_cards(s)
            have = L.contract(s, {"K.TEAM_SIZE": "!!K.TEAM_SIZE && K.TEAM_SIZE.solo === 1 && K.TEAM_SIZE.duo === 2 && K.TEAM_SIZE.trio === 3 && K.TEAM_SIZE.squad === 4"})
            L.contract_row(v, "contract (K.TEAM_SIZE solo 1 / duo 2 / trio 3 / squad 4)", have)
            R = v.data["modes"] = {}
            runs = [(m, 7) for m in modes] + ([("duo", 21)] if "duo" in modes else [])
            drops = {}
            for mode, seed in runs:
                st = L.start(s, "standard", seed, "ashgrid", team=mode, guard=True)
                if args.plant:
                    L.plant_js(s, PLANTS[args.plant])
                t = s.js(TEAMS_JS)
                R["%s_%d" % (mode, seed)] = {"start": st, "teams": t}
                if seed == 7:
                    v.check("sizes [%s] (W.match.mode / pace; team sizes; the human + %d bot(s))" % (mode, SIZE[mode] - 1), sizes_ok(t, mode),
                            {"mode": t["mode"], "pace": t["pace"], "nulls": t["nulls"], "sizes": t["sizes"][:4] + ["..."] + t["sizes"][-2:], "mine": t["mine"]},
                            "%d x %d" % (50 // SIZE[mode], SIZE[mode]))
                if mode == "solo":
                    s.land(140, protect=True)
                    continue
                d = s.js(DROP_JS)
                drops.setdefault(mode, []).append(d)
                R["%s_%d" % (mode, seed)]["drop"] = d
                if seed == 7 and mode in ("duo", "trio"):
                    f = s.js(FOLLOW_JS, [120])
                    R["%s_%d" % (mode, seed)]["follow"] = f
                    v.check("follow [%s] (120 s after landing: bot teammates' median distance to the human <= 60 m)" % mode,
                            f["median"] is not None and f["median"] <= 60 and f["mates"] == SIZE[mode] - 1, f, "<= 60 m")
            for mode, ds in drops.items():
                teams = sum(d["teams"] for d in ds)
                tog = sum(d["together"] for d in ds)
                share = tog / teams if teams else None
                v.check("drop-together [%s] (every team's touchdowns within 100 m: >= 95 %% of teams)" % mode, share is not None and share >= 0.95,
                        {"teams": teams, "together": tog, "share": share and round(share, 3), "worst": [w for d in ds for w in d["worst"]][:6]}, ">= 0.95")
            # the menu card, real clicks
            s.thaw_loop()
            s.js("() => { const W = window.__LC__.W; if (W.phase !== 'menu' && W.hud && W.hud.toMenu) W.hud.toMenu(); }")
            s.page.reload()
            s.boot(url=s.page.url)
            L.dismiss_cards(s)
            s.sleep(1.0)
            row = s.js("""() => { const r = document.querySelector('[data-lc="teamrow"]'); if (!r || !r.offsetParent) return null;
                const bs = [...r.querySelectorAll('button, [role=button], div')].filter((b) => b.offsetParent && /^(SOLO|DUO|DUOS|TRIO|TRIOS|SQUAD|SQUADS)$/i.test((b.textContent || '').trim()));
                return bs.map((b) => { const q = b.getBoundingClientRect(); return { t: b.textContent.trim().toUpperCase(), x: q.left + q.width / 2, y: q.top + q.height / 2 }; }); }""")
            v.data["teamRow"] = row
            duo = next((b for b in (row or []) if b["t"].startswith("DUO")), None)
            texts = sorted(set(b["t"] for b in (row or [])))
            if duo:
                s.page.mouse.click(duo["x"], duo["y"])
                s.sleep(0.4)
                card = s.js("""() => { const c = [...document.querySelectorAll('.lc-mode-card')].find((x) => x.offsetParent && /QUICK MATCH/.test(x.textContent));
                    if (!c) return null; c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }""")
                if card:
                    s.page.mouse.click(card[0], card[1])
                # wait for the match to START (any team mode), then judge the mode it started in - a start in the wrong mode is a
                # FAIL with the mode named, not a 25-minute wait for a 'duo' that never comes
                seen = s.wait_js("() => { const W = window.__LC__.W; return W.match && ['lobby', 'drop', 'match'].includes(W.phase) ? (W.match.mode || 'none') : null; }",
                                 args.load_timeout, 0.5)
                got = s.safe_js("() => { const W = window.__LC__.W; return W.match && W.match.mode || null; }") if seen is not None else None     # wait_js returns the seconds waited
                v.data["menuStartS"] = seen
                v.data["menuStart"] = s.safe_js("() => { const W = window.__LC__.W; return { phase: W.phase, matchMode: W.match && W.match.mode, teamMode: W.teamMode, pace: W.match && W.match.pace,"
                                                " mates: W.player ? W.actors.filter((a) => a !== W.player && a.teamId === W.player.teamId).length : null }; }")
            else:
                got = None
            norm = set(t[:-1] if t.endswith("S") and t != "SOLO" else t for t in texts)
            v.check("menu-card (team row SOLO / DUO / TRIO; real DUO click + QUICK MATCH starts a duo match)",
                    {"SOLO", "DUO", "TRIO"} <= norm and duo is not None and got == "duo",
                    {"buttons": texts, "started": got, "at": v.data.get("menuStart")}, "duo")
            L.errors_row(v, s)
    return C.run_gate("p23_modes", body, args)


if __name__ == "__main__":
    sys.exit(main())
