import os

p = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'shots.py')
s = open(p, encoding='utf-8').read()


def rep(old, new):
    global s
    assert old in s, old[:80]
    s = s.replace(old, new, 1)


rep('''Output: _shots/battery/<name>.png''', '''  gates    (GATEKEEPERS §8.3, K3) at 1280×720 unless the name says otherwise: each gatekeeper fielded
           through the REAL lock path (cheat.level to the Size below, XP 1 short, cheat.xp → grow → lockGate →
           the summon delay → spawnGate), then frozen / stepped to the beat: gate_stencil_intro / _stripe /
           _refill / _tipped, gate_stencil_tipped_1280 (VOLT-KITE, WHITE STACKS), gate_cordon_shove / _flank /
           _stalled, gate_switch_callin / _relocate / _linesdown; the city boss at Size IV in each biome
           (boss_parkade_s4 / boss_gully_s4 / boss_caisson_s4, frozen mid-telegraph); grow_locked_1280 /
           grow_locked_1920 (SIZE LOCKED — BEAT STENCIL-1 + the GATEKEEPER plate); finale_s5 (the finale banner
           + surge, 3.2 s after the city boss's kill); tabloid_heldby (a death while CORDON-2 holds Size II);
           gate_rematch_v (clear → real K → the REAL EXTENDED COVERAGE rematch, its 75 s timer moved to 1 s).
           Stagger shots reach the stagger in real time (fx ignores events while frozen).

Output: _shots/battery/<name>.png''')

rep('''GROUPS = ("menus", "titans", "hud", "bosses", "tabloid", "v2fx", "v2hud", "cine", "screens", "parkade")''',
    '''GROUPS = ("menus", "titans", "hud", "bosses", "tabloid", "v2fx", "v2hud", "cine", "screens", "parkade", "gates")''')

CONST = r'''
# ── GATEKEEPERS §8.3 shots (group `gates`; ported from the K2a / K2b lane scripts) ──
GATE_OF = {"stencil": ("stencil1", 1, 7), "cordon": ("cordon2", 2, 16), "switch": ("switchboard5", 3, 27)}
# name → (gate key, mode, param, min phase, titan, biome)
GATE_SHOTS = [
    ("gate_stencil_intro", ("stencil", "intro", 1.4, 1, "molo", "grideast")),
    ("gate_stencil_stripe", ("stencil", "tell:stripeRun", 0.55, 1, "molo", "grideast")),
    ("gate_stencil_refill", ("stencil", "attack:refill", 1.0, 1, "molo", "grideast")),
    ("gate_stencil_tipped", ("stencil", "stagger", 0.8, 1, "molo", "grideast")),
    ("gate_stencil_tipped_1280", ("stencil", "stagger", 0.45, 1, "voltkite", "whitestacks")),
    ("gate_cordon_shove", ("cordon", "tell:shieldShove", 0.7, 1, "hearthback", "grideast")),
    ("gate_cordon_flank", ("cordon", "flank", 0.6, 1, "hearthback", "grideast")),
    ("gate_cordon_stalled", ("cordon", "stagger", 0.7, 1, "hearthback", "grideast")),
    ("gate_switch_callin", ("switch", "attack:callIn", 0.6, 1, "briarwick", "grideast")),
    ("gate_switch_relocate", ("switch", "mode:5", 1.2, 1, "briarwick", "grideast")),
    ("gate_switch_linesdown", ("switch", "stagger", 0.7, 1, "briarwick", "grideast")),
]
CITY_S4 = [("boss_parkade_s4", "grideast"), ("boss_gully_s4", "whitestacks"), ("boss_caisson_s4", "lockwater")]

# freeze + step (frozen only) to a gatekeeper beat; returns the boss summary
GATE_STEP_JS = r"""
async ([mode, param, phase, maxTicks]) => {
  const B = window.__BT__; const W = B.world; if (!W) return { err: 'no world' };
  B.freeze(true);
  const T = W.titan;
  const ev = {};
  const tally = () => { for (const e of W.events) ev[e.type] = (ev[e.type] || 0) + 1; };
  const tell = (tag) => W.telegraphs.find((t) => t.alive && t.owner === 'boss' && !t.fired && t.tag.startsWith(tag));
  let n = 0, t0 = -1, reached = false;
  const [kind, arg] = mode.split(':');
  for (; n < maxTicks; n++) {
    const b = W.boss;
    if (!b) { B.step(1); tally(); continue; }
    if (b.introT <= 0 && b.alive && b.phase < phase) b.phase = phase;
    if (kind === 'intro') { if (b.introT > 0 && b.introT < 3 - param) { reached = true; break; } }
    else if (kind === 'tell') {
      const tg = tell(arg); if (b.attack === arg && tg && tg.t >= tg.windup * param) { reached = true; break; }
      if (arg === 'shieldShove' && b.introT <= 0) { const H = b.data.H, a = b.heading; T.x = b.x + Math.sin(a) * 2.2 * H; T.z = b.z + Math.cos(a) * 2.2 * H; }
    }
    else if (kind === 'attack') { if (b.attack === arg && b.attackT >= param) { reached = true; break; } }
    else if (kind === 'flank') {
      const H = b.data.H, a = b.heading;
      if (b.attack === 'overheated') { if (t0 < 0) t0 = W.t; T.x = b.x - Math.sin(a) * 2.0 * H; T.z = b.z - Math.cos(a) * 2.0 * H; if (W.t - t0 >= param) { reached = true; break; } }
      else if (b.introT <= 0 && b.attack !== 'shieldShove') { T.x = b.x + Math.sin(a) * 2.2 * H; T.z = b.z + Math.cos(a) * 2.2 * H; }
    }
    else if (kind === 'mode') {
      if ((b.data.mode || 0) === +arg) { if (t0 < 0) t0 = W.t; if (W.t - t0 >= param) { reached = true; break; } }
      else if (b.introT <= 0) { const H = b.data.H, a = Math.atan2(T.x - b.x, T.z - b.z); T.x = b.x + Math.sin(a) * 2.0 * H; T.z = b.z + Math.cos(a) * 2.0 * H; }
    }
    else if (kind === 'near') { if (b.introT <= 0 && Math.hypot(T.x - b.x, T.z - b.z) <= param * b.data.H) { reached = true; break; } }
    B.step(1); tally();
  }
  const b = W.boss;
  return { reached, n, ev, id: b && b.id, alive: b && b.alive, attack: b && b.attack, attackT: b && +b.attackT.toFixed(2), phase: b && b.phase,
    introT: b && +b.introT.toFixed(2), staggerT: b && +b.staggerT.toFixed(2), meter: b && +b.meter.toFixed(3), H: b && +(b.data.H || 0).toFixed(2),
    mode: b && b.data.mode, d: b && +(Math.hypot(b.x - T.x, b.z - T.z) / Math.max(1, T.height)).toFixed(2), rank: T.rank,
    tells: W.telegraphs.filter((t) => t.alive && t.owner === 'boss').map((t) => t.tag + ':' + t.t.toFixed(2) + '/' + t.windup.toFixed(2)) };
}
"""

# a real-time stagger: the meter at 0.99999 and the titan just outside the keep-out so its own auto-attack lands it
GATE_STAGGER_POLL_JS = r"""() => { const W = window.__BT__.world, b = W.boss, T = W.titan; if (!b) return null;
  if (b.staggerT > 0) return { stag: b.staggerT, t: W.t };
  if (b.introT <= 0) { b.meter = Math.max(b.meter, 0.99999); b.attack = null;
    const H = b.data.H, a = b.id === 'cordon2' ? b.heading + Math.PI : Math.atan2(T.x - b.x, T.z - b.z), r = b.id === 'stencil1' ? 1.2 : 1.75;
    T.x = b.x + Math.sin(a) * r * H; T.z = b.z + Math.cos(a) * r * H; }
  return { stag: 0, intro: b.introT }; }"""

GATE_Q_JS = r"""() => { const W = window.__BT__.world; if (!W) return null; const b = W.boss, G = W.gates;
  return { t: W.t, rank: W.titan.rank, level: W.titan.level, pending: G.pending, active: G.active, finaleT: G.finaleT,
           boss: b ? { id: b.id, role: b.role, slot: b.slot, alive: b.alive, introT: b.introT } : null,
           endless: !!W.endless, result: W.run.result }; }"""

GATE_DOM_JS = r"""() => { const q = (s) => document.querySelector(s);
  const gl = q('[data-gate="grow-lock"] .bt-gl-t'); const k = q('[data-gate="kicker"]'); const a = q('.bt-alert.on .bt-alert-title');
  return { lock: gl ? gl.textContent : null, kicker: k ? k.textContent : null, alert: a ? a.textContent : null,
           heldBy: q('[data-gate="heldby"]') ? q('[data-gate="heldby"]').textContent : null,
           subheads: Array.from(document.querySelectorAll('.bt-np-subhead')).map((e) => e.textContent) }; }"""
'''
rep('''RANK_ARG = {"I": 0''', CONST.lstrip('\n') + '\nRANK_ARG = {"I": 0')

GROUP = r'''
    # ─────────────────────────────── gates (GATEKEEPERS §8.3) ───────────────────────────────
    def gate_q(self):
        return self.sess.safe_js(GATE_Q_JS) or {}

    def gate_run(self, titan, biome, seed):
        sess = self.sess
        ok, scr = self.v2_run(titan, biome, seed)
        if not ok or not ensure_play(sess, 20, self.olog)[0]:
            return False
        self.cheats_on(True, True)
        sess.cheat("killAll")
        return True

    def gate_lock(self, slot, lv_below, want, timeout_s=15):
        """The REAL lock path: level to one below the gate, XP 1 short, cheat.xp → grow → lockGate → arrival.
        noSpawns also holds a pending lock (meta/gates.ts): lifted for the arrival, then the street is cleared."""
        sess = self.sess
        sess.cheat("level", lv_below)
        time.sleep(0.4)
        ensure_play(sess, 10, self.olog)
        sess.js("() => { const T = window.__BT__.world.titan; T.xp = Math.max(0, T.xpToNext - 1); }")
        sess.cheat("xp", 2)
        time.sleep(0.3)
        ensure_play(sess, 10, self.olog)
        g = self.gate_q()
        if g.get("pending") != slot and g.get("active") != slot:
            self.log("    XP did not lock slot %d (%s) — cheat.gateLock(%d)" % (slot, json.dumps(g)[:160], slot))
            sess.cheat("gateLock", slot)
        sess.cheat("noSpawns", False)
        t_end = time.time() + timeout_s
        while time.time() < t_end:
            g = self.gate_q()
            b = g.get("boss") or {}
            if b.get("alive") and want(b):
                break
            if (sess.screen() or "play") != "play":
                ensure_play(sess, 5, self.olog)
            time.sleep(0.15)
        sess.cheat("noSpawns", True)
        sess.cheat("killAll")
        b = (self.gate_q().get("boss") or {})
        return bool(b.get("alive") and want(b))

    def g_gates(self):
        self.group = "gates"
        sess = self.sess
        vp0 = sess.page.viewport_size or {"width": self.args.width, "height": self.args.height}
        try:
            sess.page.set_viewport_size({"width": 1280, "height": 720})
            self._g_gates()
        finally:
            sess.page.set_viewport_size(vp0)

    def _g_gates(self):
        sess, a = self.sess, self.args
        seed = a.seed + 300
        # 1. the gatekeeper beats
        for name, (key, mode, param, phase, titan, biome) in GATE_SHOTS:
            gid, slot, lv = GATE_OF[key]
            if not self.gate_run(titan, biome, seed):
                self.miss(name, "run did not start")
                continue
            if not self.gate_lock(slot, lv - 1, lambda b, gid=gid: b.get("id") == gid):
                self.miss(name, "%s never arrived through the lock path" % gid)
                continue
            if mode == "stagger":
                sess.js(GATE_STEP_JS, ["intro", 2.99, 1, 30 * 10])
                sess.bt_call("freeze", False)
                ensure_play(sess, 8, self.olog)
                t_end = time.time() + 15
                st = None
                while time.time() < t_end:
                    st = sess.safe_js(GATE_STAGGER_POLL_JS)
                    if st and st.get("stag", 0) > 0:
                        break
                    if sess.screen() != "play":
                        ensure_play(sess, 5, self.olog)
                    time.sleep(0.05)
                if not (st and st.get("stag", 0) > 0):
                    self.miss(name, "no stagger within 15 s (%s)" % json.dumps(st))
                    continue
                time.sleep(param)
                ensure_play(sess, 4, self.olog)
                sess.bt_call("freeze", True)
                time.sleep(0.3)
                self.shot(name, "gate", gate=gid, beat="stagger", stagger=st)
                sess.bt_call("freeze", False)
                continue
            r = sess.js(GATE_STEP_JS, [mode, param, phase, 30 * 240]) or {}
            if not r.get("reached"):
                sess.bt_call("freeze", False)
                self.miss(name, "the %s beat was not reached (%s)" % (mode, json.dumps(r)[:200]))
                continue
            time.sleep(1.0)                                   # frozen: views idle, the pose settles
            self.shot(name, "gate", gate=gid, beat=mode, boss=r)
            sess.bt_call("freeze", False)

        # 2. the city boss at Size IV in each biome (§4.2 re-scale), frozen mid-telegraph
        for name, biome in CITY_S4:
            if not self.gate_run("hearthback", biome, seed + 7):
                self.miss(name, "run did not start")
                continue
            sess.js("() => { window.__BT__.world.gates.mainEarliestT = 0; }")
            sess.cheat("gatesOpen", 3)
            if not self.gate_lock(4, 34, lambda b: b.get("role") == "main"):
                self.miss(name, "the city boss never arrived through the lock path")
                continue
            t_end = time.time() + 25
            got = False
            while time.time() < t_end:
                if sess.screen() != "play":
                    ensure_play(sess, 5, self.olog)
                o = sess.safe_js(BOSS_TG_JS) or {}
                bo, tg = o.get("boss") or {}, o.get("tg")
                if bo.get("introT", 1) <= 0 and tg and 0.45 <= tg["frac"] <= 0.85:
                    sess.bt_call("freeze", True)
                    time.sleep(0.8)
                    if sess.screen() == "play":
                        self.shot(name, "boss", bossId=bo.get("id"), telegraph=tg, rank=3)
                        got = True
                    sess.bt_call("freeze", False)
                    if got:
                        break
                time.sleep(0.08)
            if not got:
                self.shot(name, "boss", note="no telegraph caught mid-windup in 25 s: a plain fight frame")

        # 3. grow_locked at 1280 and 1920: SIZE LOCKED — BEAT STENCIL-1 + the GATEKEEPER plate
        for w_, h_ in ((1280, 720), (1920, 1080)):
            name = "grow_locked_%d" % w_
            sess.page.set_viewport_size({"width": w_, "height": h_})
            if not self.gate_run("molo", "grideast", seed + 11) or not self.gate_lock(1, 6, lambda b: b.get("id") == "stencil1"):
                self.miss(name, "STENCIL-1 never arrived")
                continue
            sess.js(GATE_STEP_JS, ["intro", 2.99, 1, 30 * 10])
            time.sleep(1.0)
            d = sess.safe_js(GATE_DOM_JS) or {}
            self.shot(name, "hud", dom=d)
            sess.bt_call("freeze", False)
        sess.page.set_viewport_size({"width": 1280, "height": 720})

        # 4. finale_s5, then the REAL rematch: clear → real K → EXTENDED COVERAGE → spawnRematch (timer moved to 1 s)
        if self.gate_run("molo", "grideast", seed + 13):
            sess.js("() => { window.__BT__.world.gates.mainEarliestT = 0; }")
            sess.cheat("gatesOpen", 3)
            if self.gate_lock(4, 34, lambda b: b.get("role") == "main"):
                t_end = time.time() + 8
                while time.time() < t_end and ((self.gate_q().get("boss") or {}).get("introT") or 0) > 0:
                    time.sleep(0.2)
                sess.cheat("gateKill")
                time.sleep(3.2)                               # the banner is due 2.5 s in (+ its wipe)
                d = sess.safe_js(GATE_DOM_JS) or {}
                self.shot("finale_s5", "finale", dom=d, gates=self.gate_q())
                sess.cheat("finaleSkip")
                ok, scr = sess.wait_screen(("end",), 25)
                time.sleep(2.2)
                if ok:
                    sess.press("KeyK")                       # real K: KEEP GOING
                    ensure_play(sess, 20, self.olog)
                    sess.js("() => { const W = window.__BT__.world; if (W.endless) W.endless.nextBossT = W.t + 1; }")
                    t_end = time.time() + 15
                    b = {}
                    while time.time() < t_end:
                        b = self.gate_q().get("boss") or {}
                        if b.get("alive") and b.get("role") == "gate":
                            break
                        if sess.screen() != "play":
                            ensure_play(sess, 5, self.olog)
                        time.sleep(0.2)
                    if b.get("alive") and b.get("role") == "gate":
                        sess.js(GATE_STEP_JS, ["near", 3.2, 1, 30 * 40])
                        time.sleep(1.0)
                        d = sess.safe_js(GATE_DOM_JS) or {}
                        self.shot("gate_rematch_v", "gate", dom=d, boss=b)
                        sess.bt_call("freeze", False)
                    else:
                        self.miss("gate_rematch_v", "no rematch spawned (%s)" % json.dumps(b))
                else:
                    self.miss("gate_rematch_v", "the clear tabloid never showed (screen %s)" % scr)
            else:
                self.miss("finale_s5", "the city boss never arrived")
                self.miss("gate_rematch_v", "the city boss never arrived")
        else:
            self.miss("finale_s5", "run did not start")
            self.miss("gate_rematch_v", "run did not start")

        # 5. tabloid_heldby: a death while CORDON-2 holds Size II
        name = "tabloid_heldby"
        if self.gate_run("molo", "grideast", seed + 17) and self.gate_lock(2, 15, lambda b: b.get("id") == "cordon2"):
            sess.cheat("god", False)
            sess.cheat("noSpawns", False)
            sess.cheat("spawn", "tank", 30)
            t_end = time.time() + 45
            while time.time() < t_end and self.gate_q().get("result") != "dead":
                if sess.screen() not in ("play", "end"):
                    ensure_play(sess, 3, self.olog)
                sess.safe_js("() => { const w = window.__BT__.world; if (w && w.titan.alive) { w.ult.invulnT = 0; w.titan.hp = Math.min(w.titan.hp, 0.5); } }")
                time.sleep(0.4)
            ok, scr = sess.wait_screen(("end",), 30)
            time.sleep(2.4)                                   # the paper's spin-in
            d = sess.safe_js(GATE_DOM_JS) or {}
            if ok:
                self.shot(name, "tabloid", dom=d)
            else:
                self.miss(name, "no tabloid after the death (screen %s)" % scr)
        else:
            self.miss(name, "CORDON-2 never arrived")

'''
rep('''    # ─────────────────────────────── contact sheets ───────────────────────────────''',
    GROUP.lstrip('\n') + '''    # ─────────────────────────────── contact sheets ───────────────────────────────''')
open(p, 'w', encoding='utf-8').write(s)
print('patched')
