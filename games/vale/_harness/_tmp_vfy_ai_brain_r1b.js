// TEMP owner15 lane-AI r1 live verifier: in-page scripted player + passive monitors (read only on the sim; the
// scripted seat 0 sends the same Commands the input layer sends, through host.send). Installed by
// _harness/_tmp_vfy_owner15_ai_live.mjs onto _tmp_ai_live.html.
(() => {
  const B = window.__VALE_BENCH__;
  const H = () => B.host;
  const V = () => B.host.view;
  const A = {
    mode: null, plan: [], phase: 'auto', phaseT0: 0, ctrl: null, savedDriver: null,
    tl: [], shots: [], scen: {}, ev: [], lastPos: new Map(), hist: new Map(), mon: new Map(),
    idle: [], dither: [], lowEp: [], lowOpen: new Map(), deaths: [], objectives: [], fights: 0, fightSizes: [],
    sieges: new Map(), siegeLog: [], beelines: [], hidden: new Map(), structFalls: [], tick: 0,
  };
  window.__AI = A;
  const log = (s, extra) => { const t = V().time; A.tl.push({ t: +t.toFixed(1), s, ...(extra || {}) }); };
  const me = () => { const v = V(); const p = v.players.find((x) => x.player === 0); return p ? v.entity(p.entity) : null; };
  const myP = () => V().players.find((x) => x.player === 0);
  const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const fighters = () => V().entities.filter((e) => e.kind === 'fighter');
  const pOf = (eid) => V().players.find((p) => p.entity === eid);
  const fountain = (team) => A.bases[team];

  // ── seat 0 control ─────────────────────────────────────────────────────────────
  A.take = () => { const h = H(); if (h.drivers.has(0)) { A.savedDriver = h.drivers.get(0); h.drivers.delete(0); } };
  A.release = () => { const h = H(); if (A.savedDriver && !h.drivers.has(0)) h.drivers.set(0, A.savedDriver); };
  const send = (c) => H().send(c);

  // ── events ──────────────────────────────────────────────────────────────────────
  A.install = (cfg) => {
    A.mode = cfg.mode; A.bases = cfg.bases; A.myTeam = 0; A.mid = cfg.mid;
    H().onEvents((evs) => {
      for (const e of evs) {
        if (e.e === 'damage' || e.e === 'death' || e.e === 'objective' || e.e === 'structure' || e.e === 'status' || e.e === 'takedown' || e.e === 'recall') {
          A.ev.push(e);
          if (e.e === 'objective') {
            const v = V();
            const at = A.lastMon?.get(e.unit) || null;
            const near = at ? fighters().filter((f) => f.alive && d2(f, at) < 22) : [];
            const rec = { t: +e.t.toFixed(0), unit: e.unit, team: e.team, takers: near.filter((f) => f.team === e.team).length, enemies: near.filter((f) => f.team !== e.team).length };
            rec.major = /sunsplinter|longshade/.test(e.unit); A.objectives.push(rec); if (rec.major) log(`OBJECTIVE ${e.unit} by team ${e.team}: ${rec.takers} takers present, ${rec.enemies} contesting`);
            if (rec.major) A.shots.push({ tag: `objective_${e.unit}`, x: at?.x, y: at?.y });
          }
          if (e.e === 'structure') { A.structFalls.push({ t: +e.t.toFixed(0), def: e.def, team: e.team }); log(`structure ${e.def} (team ${e.team}) fell`); }
          if (e.e === 'death' && e.kind === 'fighter') {
            const v = V(); const vic = v.entity(e.dst); const vp = pOf(e.dst);
            const allies = vic ? fighters().filter((f) => f.alive && f.team === vic.team && f.id !== vic.id && d2(f, vic) < 15).length : 0;
            const foes = vic ? fighters().filter((f) => f.alive && f.team !== vic.team && d2(f, vic) < 15).length : 0;
            const side = vic ? (A.mode === 'fray' ? 'n/a' : ((vic.team === 0) === (vic.x > A.mid) ? 'enemy half' : 'own half')) : '?';
            A.deaths.push({ t: +e.t.toFixed(0), player: vp?.player, team: vic?.team, allies, foes, side, x: vic && +vic.x.toFixed(0), y: vic && +vic.y.toFixed(0), assists: e.assists?.length ?? 0 });
          }
        }
      }
      if (A.ev.length > 40000) A.ev.splice(0, 20000);
    });
  };

  // ── passive monitors (every 3 ticks = 0.1 s) ────────────────────────────────────
  const monitor = () => {
    const v = V(), t = v.time;
    const fs = fighters();
    A.lastMon = A.lastMon || new Map();
    for (const m of v.entities) if (m.kind === 'monster' && m.alive) A.lastMon.set(m.def, { x: m.x, y: m.y });
    // objectives: unit ids differ from def names; keep both by unit def
    // per-fighter history (1 s resolution for idle/dither)
    if (A.tick % 30 === 0) {
      for (const f of fs) {
        const p = pOf(f.id); if (!p) continue;
        let h = A.hist.get(f.id); if (!h) { h = []; A.hist.set(f.id, h); }
        const near = v.entities.filter((o) => o.alive && o.team !== f.team && o.team >= -1 && (o.kind === 'fighter' || o.kind === 'minion' || o.kind === 'structure' || o.kind === 'monster' || o.kind === 'summon') && d2(o, f) < 12 + (o.radius || 0)).length;
        const busy = /attack|cast|channel|recall|dash/.test(f.state);
        const home = A.bases[f.team] ? d2(f, { x: A.bases[f.team][0], y: A.bases[f.team][1] }) < 14 : false;
        let nf = 1e9, nm = 1e9; for (const o of v.entities) { if (!o.alive || o.team === f.team || o.team < 0) continue; const dd = d2(o, f); if (o.kind === 'fighter') nf = Math.min(nf, dd); else if (o.kind === 'minion') nm = Math.min(nm, dd); }
        h.push({ t, x: f.x, y: f.y, alive: f.alive, near, busy, home, hp: f.hp / f.maxHp, nf: Math.round(nf), nm: Math.round(nm), st: f.state });
        if (h.length > 12) h.shift();
        if (p.player !== 0 && t > 90 && h.length >= 10 && h.every((q) => q.alive)) {
          const w = h.slice(-10); // 10 s
          let path = 0; for (let i = 1; i < w.length; i++) path += Math.hypot(w[i].x - w[i - 1].x, w[i].y - w[i - 1].y);
          const net = Math.hypot(w[9].x - w[0].x, w[9].y - w[0].y);
          const quiet = w.every((q) => q.near === 0 && !q.busy && !q.home);
          const ownStruct = v.entities.some((s) => s.kind === 'structure' && s.alive && s.team === f.team && d2(s, f) < 14);
          const key = p.player;
          const openI = A.mon.get('idle' + key), openD = A.mon.get('dith' + key);
          if (quiet && path < 1.0) { if (!openI) { const r = { player: key, t0: +w[0].t.toFixed(0), t1: +t.toFixed(0), x: +f.x.toFixed(0), y: +f.y.toFixed(0), atOwnStructure: ownStruct, hp: +f.hp.toFixed(0) }; A.mon.set('idle' + key, r); A.idle.push(r); } else openI.t1 = +t.toFixed(0); }
          else A.mon.delete('idle' + key);
          if (quiet && path > 14 && net < 3) { if (!openD) { const r = { player: key, t0: +w[0].t.toFixed(0), t1: +t.toFixed(0), x: +f.x.toFixed(0), y: +f.y.toFixed(0), path: +path.toFixed(0), net: +net.toFixed(1), trace: w.map((q) => [Math.round(q.x), Math.round(q.y), q.nf, q.nm, q.st, Math.round(q.hp * 100)]) }; A.mon.set('dith' + key, r); A.dither.push(r); if (A.dither.length <= 3) A.shots.push({ tag: `dither_p${key}`, x: f.x, y: f.y }); } else openD.t1 = +t.toFixed(0); }
          else A.mon.delete('dith' + key);
        }
      }
      // fights: >= 2 fighters per side within 12 m of a centre
      if (A.mode !== 'fray') {
        const alive = fs.filter((f) => f.alive);
        let best = null;
        for (const f of alive) {
          const near = alive.filter((o) => d2(o, f) < 12);
          const a = near.filter((o) => o.team === 0).length, b = near.filter((o) => o.team === 1).length;
          if (a >= 2 && b >= 2 && a + b >= 5 && (!best || a + b > best.a + best.b)) best = { a, b, x: f.x, y: f.y };
        }
        if (best && best.a + best.b >= 5) { A.fightSizes.push(best.a + best.b); if (!A.inFight) { A.fights++; log(`team fight ${best.a}v${best.b} at (${best.x.toFixed(0)},${best.y.toFixed(0)})`); if (A.fights <= 6) A.shots.push({ tag: `fight${A.fights}_${best.a}v${best.b}`, x: best.x, y: best.y }); } A.inFight = true; }
        else A.inFight = false;
      }
      // sieges: enemy fighters within 10 m of a structure -> defenders' response
      if (A.mode !== 'fray') for (const s of v.entities.filter((e) => e.kind === 'structure' && e.alive)) {
        const att = fs.filter((f) => f.alive && f.team !== s.team && d2(f, s) < 11);
        const k = s.id; let sg = A.sieges.get(k);
        if (att.length) {
          const defNear = fs.filter((f) => f.alive && f.team === s.team && d2(f, s) < 18).length;
          if (!sg) { sg = { def: s.def, team: s.team, t0: +t.toFixed(0), t1: +t.toFixed(0), attackers: att.length, maxAtt: att.length, defAt0: defNear, defMax: defNear, firstDefT: defNear ? 0 : null, hp0: +(s.hp / s.maxHp).toFixed(2), hp1: null, fell: false, attackerHasMe: att.some((f) => pOf(f.id)?.player === 0) }; A.sieges.set(k, sg); }
          sg.t1 = +t.toFixed(0); sg.maxAtt = Math.max(sg.maxAtt, att.length); sg.defMax = Math.max(sg.defMax, defNear);
          if (defNear && sg.firstDefT == null) sg.firstDefT = +(t - sg.t0).toFixed(0);
          sg.attackerHasMe = sg.attackerHasMe || att.some((f) => pOf(f.id)?.player === 0);
          { A.coreW = A.coreW || []; A.lastHp = A.lastHp || new Map(); const ph = A.lastHp.get(s.id); A.lastHp.set(s.id, s.hp);
            if (ph != null && s.hp < ph - 1) { const own = fs.filter((f) => f.alive && f.team === s.team && f.hp / f.maxHp > 0.6).map((f) => ({ p: pOf(f.id)?.player, d: +d2(f, s).toFixed(1), st: f.state, hp: Math.round(100 * f.hp / f.maxHp) }));
              A.coreW.push({ t: +t.toFixed(0), def: s.def, team: s.team, hp: Math.round(100 * s.hp / s.maxHp), att: att.length, fitOwn: own }); } }
        } else if (sg && t - sg.t1 > 8) { sg.hp1 = +(s.hp / s.maxHp).toFixed(2); A.siegeLog.push(sg); A.sieges.delete(k); }
      }
      for (const [k, sg] of A.sieges) { const s = v.entity(k); if (s && !s.alive && !sg.fell) { sg.fell = true; sg.hp1 = 0; A.siegeLog.push(sg); A.sieges.delete(k); } }
    }
    // low HP episodes (every 0.1 s): any fighter under 25 % with an enemy fighter within 10 m
    for (const f of fs) {
      const p = pOf(f.id); if (!p) continue;
      const op = A.lowOpen.get(p.player);
      const foes = fs.filter((o) => o.alive && o.team !== f.team && d2(o, f) < 10);
      if (f.alive && f.hp / f.maxHp < 0.25 && foes.length && !op) {
        const fb = A.bases[f.team] ? { x: A.bases[f.team][0], y: A.bases[f.team][1] } : null;
        A.lowOpen.set(p.player, { player: p.player, team: f.team, t0: t, x0: f.x, y0: f.y, home0: fb ? d2(f, fb) : null, foes0: foes.length, foeIds: foes.map((o) => o.id), hp0: +(f.hp / f.maxHp).toFixed(2), nf0: +Math.min(...foes.map((o) => d2(o, f))).toFixed(1), attackersOnIt: new Set(), recalled: false, ent: f.id });
      } else if (op) {
        if (!f.alive) { op.outcome = 'died'; }
        else if (t - op.t0 >= 4) {
          const fb = A.bases[f.team] ? { x: A.bases[f.team][0], y: A.bases[f.team][1] } : null;
          const dHome = fb ? op.home0 - d2(f, fb) : 0;
          const minFoe = Math.min(1e9, ...op.foeIds.map((id) => { const o = v.entity(id); return o && o.alive ? d2(o, f) : 1e9; }));
          op.outcome = f.state === 'recall' ? 'recalling' : (dHome > 3 || minFoe > 12) ? 'retreated' : 'stayed';
          op.hp4 = +(f.hp / f.maxHp).toFixed(2); op.homeGain = +dHome.toFixed(1); op.nf4 = +Math.min(1e9, ...fs.filter((o) => o.alive && o.team !== f.team).map((o) => d2(o, f))).toFixed(1);
        }
        if (op.outcome) {
          op.attackers = op.attackersOnIt.size; delete op.attackersOnIt; delete op.foeIds;
          op.t0 = +op.t0.toFixed(0); op.x0 = +op.x0.toFixed(0); op.y0 = +op.y0.toFixed(0); op.home0 = op.home0 && +op.home0.toFixed(0);
          A.lowEp.push(op); A.lowOpen.delete(p.player);
        }
      }
    }
    // fog honesty: bot fighter F closing on enemy fighter E while E is hidden from F's team for >= 4 s, from > 20 m
    if (A.tick % 15 === 0) {
      for (const f of fs) {
        const pf = pOf(f.id); if (!pf || pf.player === 0 || !f.alive) continue;
        for (const e of fs) {
          if (e.team === f.team || !e.alive) continue;
          const k = f.id + ':' + e.id;
          const vis = (e.visibleMask & (1 << f.team)) !== 0;
          let hd = A.hidden.get(k);
          if (vis) { A.hidden.delete(k); continue; }
          if (!hd) { hd = { t0: t, d0: d2(f, e), samples: [] }; A.hidden.set(k, hd); }
          hd.samples.push({ t, d: d2(f, e), fx: f.x, fy: f.y, ex: e.x, ey: e.y });
          if (hd.samples.length > 20) hd.samples.shift();
          const s = hd.samples;
          if (t - hd.t0 >= 6 && s.length >= 12) {
            const a = s[s.length - 12], b = s[s.length - 1];
            // closed > 10 m in 6 s, started > 22 m, target itself moved < 4 m (so it is not just walking into F)
            const em = Math.hypot(b.ex - a.ex, b.ey - a.ey);
            const eb = A.bases[e.team]; const eHome = eb ? Math.hypot(b.ex - eb[0], b.ey - eb[1]) < 25 : false;
            if (t > 60 && !eHome && a.d > 22 && a.d < 60 && a.d - b.d > 10 && em < 4 && !hd.flagged) {
              hd.flagged = true;
              const pe = pOf(e.id);
              A.beelines.push({ t: +t.toFixed(0), hunter: pf.player, target: pe?.player, d0: +a.d.toFixed(0), d1: +b.d.toFixed(0), hiddenFor: +(t - hd.t0).toFixed(0), hunterAt: [+b.fx.toFixed(0), +b.fy.toFixed(0)], targetAt: [+b.ex.toFixed(0), +b.ey.toFixed(0)] });
            }
          }
        }
      }
    }
  };
  // attackers on low fighters
  const noteDamage = () => {
    // drain fresh damage events into the open low episodes and scenario trackers
    const evs = A.ev; const from = A.evIdx || 0;
    for (let i = from; i < evs.length; i++) {
      const e = evs[i];
      if (e.e !== 'damage' && e.e !== 'status') continue;
      for (const op of A.lowOpen.values()) if (e.e === 'damage' && e.dst === op.ent) { const s = V().entity(e.src); if (s && s.kind === 'fighter') op.attackersOnIt.add(e.src); }
      if (A.onDmg) A.onDmg(e);
    }
    A.evIdx = evs.length;
  };

  // ── scripted player ─────────────────────────────────────────────────────────────
  const castAll = (target) => {
    for (const s of ['a1', 'a2', 'a3', 'ult']) {
      const ab = myP().abilities.find((a) => a.slot === s);
      if (ab && ab.rank > 0 && ab.ready) send({ type: 'cast', slot: s, target: target.id, x: target.x, y: target.y });
    }
  };
  const goHome = () => { const b = A.bases[0]; send({ type: 'move', x: b[0], y: b[1] }); };

  A.scenario = {
    // walk deep into the enemy half alone and hang there, farming, until hurt or 70 s pass
    overextend: {
      start(cfg) {
        A.take(); A.sc = { kind: 'overextend', t0: V().time, spot: cfg.spot, arrived: null, approaches: new Map(), meVisToFoe: [], hp0: null, ended: false };
        log(`OVEREXTEND start: walking alone to (${cfg.spot[0]},${cfg.spot[1]})`);
      },
      step() {
        const sc = A.sc, m = me(), v = V(), t = v.time;
        if (!m || !m.alive) { sc.ended = true; sc.result = 'died'; log('OVEREXTEND: died'); return; }
        const dSpot = Math.hypot(m.x - sc.spot[0], m.y - sc.spot[1]);
        if (!sc.arrived) { if (dSpot < 4) { sc.arrived = t; log('OVEREXTEND: arrived, farming alone'); A.shots.push({ tag: 'overextend_arrived', id: m.id }); } else send({ type: 'move', x: sc.spot[0], y: sc.spot[1] }); }
        else send({ type: 'move', x: sc.spot[0] + Math.sin(t) * 2, y: sc.spot[1], attackMove: true });
        sc.meVisToFoe.push((m.visibleMask & 2) !== 0 ? 1 : 0);
        for (const e of fighters()) {
          if (e.team === 0) continue;
          const pe = pOf(e.id); const k = pe.player;
          let ap = sc.approaches.get(k); if (!ap) { ap = { player: k, role: pe.role, track: [] }; sc.approaches.set(k, ap); }
          ap.track.push({ t: +t.toFixed(1), d: +d2(e, m).toFixed(1), visToMe: (e.visibleMask & 1) !== 0, meVisToThem: (m.visibleMask & 2) !== 0, alive: e.alive });
          if (ap.track.length > 400) ap.track.shift();
          if (!ap.arrived && e.alive && d2(e, m) < 10 && sc.arrived) {
            ap.arrived = +t.toFixed(1);
            const pre = ap.track.filter((q) => q.t > t - 10 && q.t <= t - 1.5);
            ap.hiddenShare = pre.length ? +(pre.filter((q) => !q.visToMe).length / pre.length).toFixed(2) : null;
            ap.meVisShare = pre.length ? +(pre.filter((q) => q.meVisToThem).length / pre.length).toFixed(2) : null;
            ap.from = pre[0]?.d;
            log(`OVEREXTEND: enemy p${k} (${pe.role ?? pe.fighter}) arrived within 10 m; hidden from us ${Math.round((ap.hiddenShare ?? 0) * 100)} % of its last 10 s; we were visible to them ${Math.round((ap.meVisShare ?? 0) * 100)} %`);
            A.shots.push({ tag: `overextend_gank_p${k}`, id: m.id });
          }
        }
        if (sc.arrived && m.hp / m.maxHp < 0.3 && !sc.fled) { sc.fled = t; log(`OVEREXTEND: low (${Math.round(100 * m.hp / m.maxHp)} %), running home`); A.shots.push({ tag: 'overextend_low', id: m.id }); }
        if (sc.fled) goHome();
        if ((sc.arrived && t - sc.arrived > 70 && !sc.fled) || (sc.fled && t - sc.fled > 12)) { sc.ended = true; sc.result = sc.fled ? 'fled' : 'timeout'; }
      },
    },
    // find the enemy carry beside its support and attack the carry
    dive: {
      start() { A.take(); A.sc = { kind: 'dive', t0: V().time, target: null, engaged: null, supportHits: [], peelers: new Set(), allHitters: new Set(), ended: false }; log('DIVE: looking for the enemy carry beside its support'); },
      step() {
        const sc = A.sc, m = me(), v = V(), t = v.time;
        if (!m || !m.alive) { sc.ended = true; sc.result = sc.engaged ? 'died in dive' : 'died before'; log('DIVE: died'); A.shots.push({ tag: 'dive_died', x: sc.lastX, y: sc.lastY }); return; }
        sc.lastX = m.x; sc.lastY = m.y;
        const ps = v.players.filter((p) => p.team !== 0);
        const carryP = ps.find((p) => p.role === 'shaftlight') || ps.find((p) => p.role === 'dialcross') || ps[0];
        const suppP = ps.find((p) => p.role === 'lampglass') || ps.find((p) => p !== carryP);
        const carry = v.entity(carryP.entity), supp = v.entity(suppP.entity);
        if (!sc.engaged) {
          if (t - sc.t0 > 150) { sc.ended = true; sc.result = 'no pair found'; return; }
          // walk toward the carry's road (its true position only once it is visible to us: no fog cheating by the script)
          const vis = carry && carry.alive && (carry.visibleMask & 1) !== 0;
          if (vis && supp && supp.alive && d2(carry, supp) < 11 && d2(m, carry) < 14) {
            sc.engaged = t; sc.carryP = carryP.player; sc.suppP = suppP.player; sc.carryId = carry.id; sc.suppId = supp.id; sc.hp0 = m.hp / m.maxHp;
            log(`DIVE: engaging carry p${carryP.player} with support p${suppP.player} ${d2(carry, supp).toFixed(1)} m from it`);
            A.shots.push({ tag: 'dive_engage', id: m.id });
          } else if (vis && d2(m, carry) < 30) send({ type: 'move', x: carry.x, y: carry.y });
          else send({ type: 'move', x: sc.road[0], y: sc.road[1], attackMove: true });
          return;
        }
        if (!sc.fled) {
          const c = v.entity(sc.carryId);
          if (c && c.alive) { send({ type: 'attack', target: c.id }); if (A.tick % 9 === 0) castAll(c); }
          if (m.hp / m.maxHp < 0.25 || t - sc.engaged > 10 || !c || !c.alive) { sc.fled = t; log(`DIVE: disengaging (hp ${Math.round(100 * m.hp / m.maxHp)} %, carry ${c && c.alive ? 'alive ' + Math.round(100 * c.hp / c.maxHp) + ' %' : 'dead'})`); A.shots.push({ tag: 'dive_disengage', id: m.id }); }
        } else { goHome(); if (t - sc.fled > 10) { sc.ended = true; sc.result = 'escaped'; } }
      },
      onDmg(e) {
        const sc = A.sc; if (!sc || !sc.engaged || sc.kind !== 'dive') return;
        const m = me(); if (!m || e.dst !== m.id) return;
        const s = V().entity(e.src); if (!s) return;
        const sp = pOf(e.src) || (s.owner >= 0 ? V().players.find((p) => p.player === s.owner) : null);
        if (!sp) return;
        const dt = V().time - sc.engaged;
        sc.allHitters.add(sp.player);
        if (sp.player === sc.suppP) { sc.supportHits.push(+dt.toFixed(1)); }
        if (sp.player !== sc.carryP && dt < 6) sc.peelers.add(sp.player);
      },
    },
    // push with the wave into the enemy base: the next living enemy structure along a road
    push: {
      start(cfg) { A.take(); A.sc = { kind: 'push', t0: V().time, road: cfg.road, ended: false, deaths: 0, reached: [], lastAlive: true }; log(`PUSH: pushing ${cfg.name} into the enemy base`); },
      step() {
        const sc = A.sc, m = me(), v = V(), t = v.time;
        if (t - sc.t0 > sc.dur) { sc.ended = true; sc.result = 'time'; return; }
        if (!m || !m.alive) { if (sc.lastAlive) { sc.deaths++; log('PUSH: died'); } sc.lastAlive = false; return; }
        sc.lastAlive = true;
        // next living enemy structure along the road (nearest our base first)
        const ss = v.entities.filter((s) => s.kind === 'structure' && s.alive && s.team === 1 && sc.road.some((p) => Math.hypot(p[0] - s.x, p[1] - s.y) < 14));
        ss.sort((a, b) => a.x - b.x);
        const tgt = ss[0] || v.entities.filter((s) => s.kind === 'structure' && s.alive && s.team === 1).sort((a, b) => a.x - b.x)[0];
        if (!tgt) { sc.ended = true; sc.result = 'nothing left'; return; }
        if (m.hp / m.maxHp < 0.3 && !sc.backing) { sc.backing = t; log(`PUSH: low at ${tgt.def}, backing off`); A.shots.push({ tag: `push_low_${tgt.def}`, id: m.id }); }
        if (sc.backing) { if (m.hp / m.maxHp > 0.9) { sc.backing = null; log('PUSH: healed, back to it'); } else { if (t - sc.backing > 3 && m.state !== 'recall') send({ type: 'recall' }); if (t - sc.backing <= 3) goHome(); return; } }
        // wait for an own Wick near us before walking under the tower (a human-like push behind the wave)
        const myWicks = v.entities.filter((w) => w.kind === 'minion' && w.alive && w.team === 0 && d2(w, tgt) < 16).length;
        const dT = d2(m, tgt);
        if (dT < 16 && !sc.reached.includes(tgt.def)) { sc.reached.push(tgt.def); log(`PUSH: at ${tgt.def}, ${myWicks} own Wicks with us`); A.shots.push({ tag: `push_at_${tgt.def}`, id: m.id }); }
        if (dT < 14 && myWicks === 0) { send({ type: 'move', x: tgt.x - 18, y: tgt.y }); return; }
        if (dT < 12) { send({ type: 'attack', target: tgt.id }); const foe = fighters().find((f) => f.alive && f.team === 1 && d2(f, m) < 6 && (f.visibleMask & 1)); if (foe && A.tick % 9 === 0) castAll(foe); }
        else send({ type: 'move', x: tgt.x, y: tgt.y, attackMove: true });
      },
    },
  };

  A.startScenario = (name, cfg) => { A.cur = A.scenario[name]; A.cur.start(cfg || {}); Object.assign(A.sc, cfg || {}); A.onDmg = A.cur.onDmg ? (e) => A.cur.onDmg(e) : null; };
  A.endScenario = () => { const sc = A.sc; A.scen[sc.kind] = A.scen[sc.kind] || []; const out = { ...sc }; if (out.approaches) out.approaches = [...out.approaches.values()].map((a) => ({ ...a, track: undefined, minD: Math.min(...a.track.map((q) => q.d)) })); if (out.meVisToFoe) out.meVisShare = +(out.meVisToFoe.reduce((s, x) => s + x, 0) / Math.max(1, out.meVisToFoe.length)).toFixed(2), delete out.meVisToFoe; if (out.peelers) out.peelers = [...out.peelers]; if (out.allHitters) out.allHitters = [...out.allHitters]; A.scen[sc.kind].push(out); log(`${sc.kind.toUpperCase()} end: ${sc.result}`); A.cur = null; A.sc = null; A.onDmg = null; A.release(); };

  /** pump `secs` of match time; the scripted player thinks every 0.2 s */
  A.shotTags = new Set();
  const pushShot = A.shots.push.bind(A.shots);
  A.shots.push = (s) => { const k = s.tag.replace(/\d+$/, ''); if (A.shotTags.has(s.tag)) return 0; A.shotTags.add(s.tag); return pushShot(s); };
  A.run = (secs) => {
    const h = H();
    const n = Math.round(secs * 30);
    for (let i = 0; i < n; i++) {
      if (h.ended) break;
      h.pump(1 / 30); A.tick++;
      if (A.tick % 3 === 0) { monitor(); noteDamage(); }
      if (A.cur && A.tick % 6 === 0) { A.cur.step(); if (A.sc?.ended) A.endScenario(); }
    }
    const m = me();
    return { t: V().time, ended: !!h.ended, scen: A.sc?.kind ?? null, me: m && { x: +m.x.toFixed(0), y: +m.y.toFixed(0), hp: Math.round(100 * m.hp / m.maxHp), alive: m.alive }, shots: A.shots.splice(0) };
  };
})();
