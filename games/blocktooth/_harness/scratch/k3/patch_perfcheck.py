import os

p = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'perfcheck.py')
s = open(p, encoding='utf-8').read()


def rep(old, new):
    global s
    assert old in s, old[:80]
    s = s.replace(old, new, 1)


rep('''Exit: 0 pass · 1 fail (or the load could not be reached) · 2 setup failed (server/browser/__BT__/cheats).
"""''', '''GATEKEEPERS §8.3 scenarios (--gate, run by the orchestrator ALONE after K2; pair with --enemies 150):
  (c) --gate c  SWITCHBOARD-5 at Size III (fielded through the real lock: LV 26 → XP → lockGate(3) → arrival) with
                its adds + 150 enemies and ONE UPROAR (real E) in the window; the rig kept alive (HP set back to
                ≥ 50 % between samples). Run once more with --prof for the rig mark: BossView ≤ 0.3 ms median.
  (d) --gate d  STENCIL-1 in P3 at Size I with the maximum WET PAINT load held live: 10 `paint` hazards (a U-TURN's
                two stripes, 5 bucket puddles, both DOUBLE LINE lanes, the TIPPED OVER pool; 4–5 s each, re-spawned
                as they expire) + 150 enemies. With --prof: HazardView ≤ 0.2 ms median (and BossView ≤ 0.3 ms).
  (e) --gate e  the finale at Size V: the city boss fielded through the real lock (LV 34 → 35), killed by cheat
                right before the window, so the window runs inside the 10 s finale: the game's own
                civilians.surge(x, z, 3 H, 120), Size V destruction under real keys, the stunned enemies live.
                The window is capped at 9 s (the finale's end clears the run).
  All three: the same p99 ≤ 22 ms and ≤ 450 draw calls.
Exit: 0 pass · 1 fail (or the load could not be reached) · 2 setup failed (server/browser/__BT__/cheats).
"""''')

HELPERS = r'''GATE_SCEN = {
    # scenario → (gate id, slot, level one below the gate's level, titan rank during the window)
    "c": ("switchboard5", 3, 26, 2),
    "d": ("stencil1", 1, 6, 0),
    "e": (None, 4, 34, 4),
}

GATE_STATE_JS = r"""() => { const W = window.__BT__.world; if (!W) return null; const b = W.boss, G = W.gates, T = W.titan;
  let paint = 0, paintOurs = 0; for (const h of W.hazards) if (h.alive && h.kind === 'paint') { paint++; if (h.data && h.data.__perf) paintOurs++; }
  return { boss: b ? { id: b.id, role: b.role, alive: b.alive, phase: b.phase, hp: b.hp, maxHp: b.maxHp, introT: b.introT, H: b.data.H } : null,
           pending: G.pending, active: G.active, finaleT: G.finaleT, rank: T.rank, level: T.level, paint, paintOurs }; }"""

# the §8.3 (d) WET PAINT load around the titan (boss-owned `paint`, slow only, 4–5 s), topped up to 10 of ours
PAINT_JS = r"""async (want) => {
  const m = await import('/src/combat/hazards.ts'); const W = window.__BT__.world; if (!W) return 0;
  const T = W.titan, b = W.boss; const H = b && b.data.H > 0 ? b.data.H : T.height;
  let ours = 0; for (const h of W.hazards) if (h.alive && h.kind === 'paint' && h.data && h.data.__perf) ours++;
  const P = window.__PERF_PAINT__ = (window.__PERF_PAINT__ || 0);
  const kinds = ['stripe', 'stripe', 'bucket', 'bucket', 'bucket', 'bucket', 'bucket', 'dline', 'dline', 'pool'];
  let made = 0;
  for (let i = ours; i < want; i++) {
    const k = kinds[(P + made) % kinds.length]; const a = Math.random() * Math.PI * 2, d = (1.5 + Math.random() * 3.5) * H;
    const x = T.x + Math.sin(a) * d, z = T.z + Math.cos(a) * d, dir = Math.random() * Math.PI * 2;
    const life = 4 + Math.random();
    let shape;
    if (k === 'stripe') { const L = 6 * H; shape = { k: 'capsule', x0: x, z0: z, x1: x + Math.sin(dir) * L, z1: z + Math.cos(dir) * L, r: 0.35 * H }; }
    else if (k === 'dline') { const L = 8 * H; shape = { k: 'capsule', x0: x - Math.sin(dir) * L / 2, z0: z - Math.cos(dir) * L / 2, x1: x + Math.sin(dir) * L / 2, z1: z + Math.cos(dir) * L / 2, r: 0.25 * H }; }
    else if (k === 'pool') shape = { k: 'circle', x, z, r: 0.8 * H };
    else shape = { k: 'circle', x, z, r: 0.45 * H };
    m.spawnHazard(W, { owner: 'boss', kind: 'paint', shape, life, data: { slow: 0.35, __perf: 1 } });
    made++;
  }
  window.__PERF_PAINT__ = P + made;
  return made; }"""

SURGE_JS = r"""() => { const c = window.__BT__; const cv = c.debugCore && c.debugCore.scene.getObjectByName('civilians');
  const cs = cv && cv.userData.civState; const dbg = cv && cv.userData.civ;
  return { surgePlaced: cs ? cs.view.surgePlaced : null, civLive: dbg ? dbg.live : null, fleeing: dbg ? dbg.fleeing : null }; }"""


def gate_setup(sess, args, log, info):
    """Field the scenario's fight through the real lock path. Returns a fatal string or None."""
    gid, slot, lv_below, want_rank = GATE_SCEN[args.gate]
    if args.gate == "e":
        sess.js("() => { window.__BT__.world.gates.mainEarliestT = 0; }")
    ok, v = sess.cheat("gatesOpen", slot - 1)
    if not ok:
        return "cheat.gatesOpen failed: %s" % v
    ok, v = sess.cheat("level", lv_below)
    if not ok:
        return "cheat.level failed: %s" % v
    time.sleep(0.6)
    s = sess.state() or {}
    if s.get("screen") in ("draft", "pause"):
        clear_overlay(sess, s.get("screen"))
    # noSpawns also holds a pending lock (meta/gates.ts): lift it for the arrival, then clear the street again
    sess.cheat("noSpawns", False)
    sess.js("() => { const T = window.__BT__.world.titan; T.xp = Math.max(0, T.xpToNext - 1); }")
    sess.cheat("xp", 2)
    deadline = time.time() + 20
    g = {}
    locked_by_cheat = False
    while time.time() < deadline:
        g = sess.safe_js(GATE_STATE_JS) or {}
        b = g.get("boss") or {}
        if b.get("alive") and ((gid and b.get("id") == gid) or (not gid and b.get("role") == "main")):
            break
        if (not locked_by_cheat and g.get("pending") != slot and g.get("active") != slot and time.time() > deadline - 17):
            sess.cheat("gateLock", slot)
            locked_by_cheat = True
        s = sess.state() or {}
        if s.get("screen") in ("draft", "pause"):
            clear_overlay(sess, s.get("screen"))
        time.sleep(0.2)
    sess.cheat("noSpawns", True)
    sess.cheat("killAll")
    b = g.get("boss") or {}
    if not b.get("alive"):
        return "scenario (%s): the fight never arrived (%s)" % (args.gate, json.dumps(g)[:200])
    info.update({"boss": b.get("id"), "slot": slot, "wantRank": want_rank, "lockedByCheat": locked_by_cheat})
    log("scenario (%s): %s fielded by the lock path at rank %s (LV %s)%s" % (
        args.gate, b.get("id"), g.get("rank"), g.get("level"), " (cheat.gateLock fallback)" if locked_by_cheat else ""))
    # past the intro (3 s of real time) so the rig is fighting, not arriving
    t_end = time.time() + 6
    while time.time() < t_end:
        g = sess.safe_js(GATE_STATE_JS) or {}
        if ((g.get("boss") or {}).get("introT") or 0) <= 0:
            break
        s = sess.state() or {}
        if s.get("screen") in ("draft", "pause"):
            clear_overlay(sess, s.get("screen"))
        time.sleep(0.2)
    if args.gate == "d":
        sess.js("() => { const b = window.__BT__.world.boss; if (b && b.alive) b.phase = 3; }")
    return None


def gate_maintain(sess, args, info):
    """Keep the scenario load live between samples (cheats set state only). Returns the gate state."""
    if args.gate in ("c", "d"):
        sess.safe_js("() => { const b = window.__BT__.world.boss; if (b && b.alive && b.hp < 0.5 * b.maxHp) b.hp = 0.9 * b.maxHp;"
                     " if (b && b.alive && %s) b.phase = 3; }" % ("true" if args.gate == "d" else "false"))
    if args.gate == "d":
        n = sess.safe_js(PAINT_JS, 10, default=0) or 0
        info["paintSpawned"] = info.get("paintSpawned", 0) + int(n)
    return sess.safe_js(GATE_STATE_JS) or {}


'''
rep('def spawn_mix(sess, n, log):', HELPERS + 'def spawn_mix(sess, n, log):')

rep('''    ap.add_argument("--ult-at", type=float, default=4.0''', '''    ap.add_argument("--gate", choices=("c", "d", "e"), default=None,
                    help="GATEKEEPERS §8.3 scenario (c) SWITCHBOARD-5 + adds + UPROAR, (d) STENCIL-1 P3 + 10 WET PAINT, "
                         "(e) the Size V finale + 120-civilian surge; pair with --enemies 150")
    ap.add_argument("--ult-at", type=float, default=4.0''')
rep('''    args = ap.parse_args()

    url = build_url(''', '''    args = ap.parse_args()
    fire_ult = args.v2 or args.gate == "c"
    want_rank = GATE_SCEN[args.gate][3] if args.gate else 4
    if args.gate == "e" and args.seconds > 9.0:
        args.seconds = 9.0                                  # the window must end inside the 10 s finale
    if args.gate == "e":
        args.warm = min(args.warm, 0.5)
    ginfo = {}
    gsamples = []

    url = build_url(''')

rep('''        if not fatal:
            ok, r = set_rank(sess, 4, log)
            if ok is False and not isinstance(r, (int, float)):
                fatal = "cheat.rank failed: %s" % (r,)
            elif r != 4:
                log("cheat.rank(4) → state().rank %s (the load check below will flag it)" % (r,))''', '''        if not fatal and args.gate:
            fatal = gate_setup(sess, args, log, ginfo)
            if fatal:
                raise HarnessError(fatal)
        elif not fatal:
            ok, r = set_rank(sess, 4, log)
            if ok is False and not isinstance(r, (int, float)):
                fatal = "cheat.rank failed: %s" % (r,)
            elif r != 4:
                log("cheat.rank(4) → state().rank %s (the load check below will flag it)" % (r,))''')

rep('''                if args.v2:
                    v2_top_up(s)
            s = sess.state() or {}
            prog0 = s.get("programs")''', '''                if args.v2:
                    v2_top_up(s)
                if args.gate:
                    gate_maintain(sess, args, ginfo)
            if args.gate == "e":
                okk, kv = sess.cheat("gateKill")        # the city boss dies → finale on (surge, stun) this frame
                t_f = time.time()
                gg = {}
                while time.time() - t_f < 2.0:
                    gg = sess.safe_js(GATE_STATE_JS) or {}
                    if (gg.get("finaleT") or 0) > 0:
                        break
                    time.sleep(0.05)
                ginfo["finaleAtStart"] = gg.get("finaleT")
                log("scenario (e): gateKill %s → finaleT %s · rank %s" % (kv, gg.get("finaleT"), gg.get("rank")))
                if not ((gg.get("finaleT") or 0) > 0):
                    fatal = "scenario (e): the finale did not start (%s)" % json.dumps(gg)[:200]
                    raise HarnessError(fatal)
                time.sleep(0.3)                          # the surge is placed by the next view update
                ginfo["surge"] = sess.safe_js(SURGE_JS)
                log("scenario (e): surge %s" % json.dumps(ginfo["surge"]))
            s = sess.state() or {}
            prog0 = s.get("programs")''')

rep('''            if args.v2:
                # timestamped rAF recorder''', '''            if fire_ult:
                # timestamped rAF recorder''')
rep('''            ult_state = "pending" if args.v2 else "off"''', '''            ult_state = "pending" if fire_ult else "off"''')
rep('''                s = sess.state() or {}
                if args.v2:
                    v2_top_up(s)
                bs = s.get("boss")''', '''                s = sess.state() or {}
                if args.v2:
                    v2_top_up(s)
                if args.gate:
                    gst = gate_maintain(sess, args, ginfo)
                    gb = gst.get("boss") or {}
                    gsamples.append({"t": round(now - t0, 2), "boss": gb.get("id") if gb.get("alive") else None,
                                     "phase": gb.get("phase"), "paint": gst.get("paint"), "paintOurs": gst.get("paintOurs"),
                                     "finaleT": gst.get("finaleT")})
                bs = s.get("boss")''')
rep('''            if args.v2:
                v2["frames"] = sess.safe_js(''', '''            if fire_ult:
                v2["frames"] = sess.safe_js(''')

rep('''    if not ranks or ranks[-1] != 4:
        problems.append("load not reached: titan not at Size V (rank %s)" % (ranks[-1] if ranks else None))''', '''    if not ranks or ranks[-1] != want_rank:
        problems.append("load not reached: titan not at Size %s (rank %s)" % (ROMAN[want_rank], ranks[-1] if ranks else None))''')

rep('''    if args.v2:
        objs = [x["objs"] for x in samples if isinstance(x.get("objs"), int)]''', '''    if args.gate:
        n = max(1, len(gsamples))
        if args.gate in ("c", "d"):
            live = sum(1 for x in gsamples if x.get("boss") == ginfo.get("boss"))
            print("gate (%s)  : %s alive in %d / %d samples · phases %s" % (
                args.gate, ginfo.get("boss"), live, len(gsamples), sorted(set(x.get("phase") for x in gsamples if x.get("phase") is not None))))
            if live < 0.9 * n:
                problems.append("scenario (%s) not held: %s alive in only %d / %d samples" % (args.gate, ginfo.get("boss"), live, len(gsamples)))
        if args.gate == "d":
            pts = [x.get("paint") or 0 for x in gsamples]
            ours = [x.get("paintOurs") or 0 for x in gsamples]
            print("gate (d)  : live paint hazards mean %.1f / min %s (ours mean %.1f / min %s) · spawned %s" % (
                sum(pts) / n, min(pts) if pts else None, sum(ours) / n, min(ours) if ours else None, ginfo.get("paintSpawned")))
            if (sum(pts) / n) < 9.0:
                problems.append("scenario (d) not held: live paint hazards mean %.1f < 9" % (sum(pts) / n))
        if args.gate == "e":
            fin = sum(1 for x in gsamples if (x.get("finaleT") or 0) > 0)
            su = ginfo.get("surge") or {}
            print("gate (e)  : finale live in %d / %d samples (finaleT at start %s) · surge %s" % (
                fin, len(gsamples), ginfo.get("finaleAtStart"), json.dumps(su)))
            if fin < 0.9 * n:
                problems.append("scenario (e) not held: the finale live in only %d / %d samples" % (fin, len(gsamples)))
            if su.get("surgePlaced") != 120:
                problems.append("scenario (e): surgePlaced %s != 120" % su.get("surgePlaced"))
    if args.v2:
        objs = [x["objs"] for x in samples if isinstance(x.get("objs"), int)]''')
rep('''        if mp < 2.5:
            problems.append("scenario (a) not held: power-ups mean %.2f < 2.5" % mp)
        u = v2.get("ult") or {}''', '''        if mp < 2.5:
            problems.append("scenario (a) not held: power-ups mean %.2f < 2.5" % mp)
    if fire_ult:
        u = v2.get("ult") or {}''')
rep('''        ult_rep = dict(ult_rep or {}, prof=pr)''', '''        ult_rep = dict(ult_rep or {}, prof=pr)
        if args.gate in ("c", "d"):
            bv = med.get("BossView")
            print("gate rig  : BossView median %s ms (<= 0.3) · mean %s ms" % (bv, mn.get("BossView")))
            if bv is None or bv > 0.3:
                problems.append("gate rig BossView median %s ms > 0.3 ms" % bv)
        if args.gate == "d":
            hv = med.get("HazardView")
            print("hazards   : HazardView median %s ms (<= 0.2) · mean %s ms" % (hv, mn.get("HazardView")))
            if hv is None or hv > 0.2:
                problems.append("HazardView median %s ms > 0.2 ms" % hv)''')
rep('''"simTicks": sim_ticks, "overlays": overlays, "v2": args.v2, "uproar": ult_rep,''', '''"simTicks": sim_ticks, "overlays": overlays, "v2": args.v2, "uproar": ult_rep,
           "gate": args.gate, "gateInfo": ginfo, "gateSamples": gsamples,''')
open(p, 'w', encoding='utf-8').write(s)
print('patched')
