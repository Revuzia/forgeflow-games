// botbatch_probe.js - the P2-B bot batch probe, PROMOTED into the harness by lane P2-F (2026-10-20) from lane P23/bots' scratch probe
// F:/lc_p23/bots/bb_probe.js (snapshot 2026-10-20T23:50, itself from the ai_flow audit's af_probe4.js). READ-ONLY on game decisions: the 'afk' human writes
// nothing; the 'rotator' human writes ONLY the local player's input + tops up its hp / shield. Defines window.__AF (install / advance / collect).
// ai_flow parity probe (READ-ONLY on game decisions; the "rotator" human mode writes ONLY the local player's
// input struct + tops up the local player's hp/shield, nothing on bots). Defines window.__AF.
(() => {
  const AF = (window.__AF = window.__AF || {});
  // lane P23/bots batch probe (from the ai_flow audit's af_probe4.js): + reaction-vs-tier, frags/smokes, shields at 600 s, AFK survival, team/DBNO counters
  AF.install = (opts) => {
    const C = window.__LC__, W = C.W, K = W.SIM;
    const human = opts.human || "afk";
    const pid = W.player ? W.player.id : null;
    const brains = C.brains();
    const brainOf = new Map(brains.map((b) => [b.actor.id, b]));
    const tierOf = (id) => { const b = brainOf.get(id); return b ? b.tier0 : null; };
    const gen = (window.__afGen = (window.__afGen || 0) + 1);
    const live = () => window.__afGen === gen;
    const S = {
      human, pid, seed: W.seed, map: W.mapId, mode: W.mode, gen,
      tiers: brains.map((b) => b.tier0), pers: brains.map((b) => b.actor.personality), ramps: brains.map((b) => b.ramp),
      kills: [], hurtLog: [], landings: [], heals: [], shots: {}, hits: {}, hitsByDist: {}, shotsByCls: {}, hitsByCls: {},
      firstContact: null, firstHurt: null, playerDeath: null,
      samples: [], phases: [], lastPhase: 0, acq: [], repeek: [], humanMin: {}, stormDeaths: 0,
      pairs: new Map(), engageStart: [], mixRating: W.botMixRating, mix: W.botMix,
    };
    AF.S = S;
    const recentHurt = new Map();   // victimId -> [{t, att}]
    W.events.on("actorHurt", (v, info) => {
      if (!live()) return;
      const att = info && info.attackerId ? W.actorById.get(info.attackerId) : null;
      const d = att ? Math.hypot(att.pos.x - v.pos.x, att.pos.z - v.pos.z) : null;
      const arr = recentHurt.get(v.id) || []; arr.push({ t: W.t, att: info ? info.attackerId : null }); recentHurt.set(v.id, arr.filter((e) => W.t - e.t < 10));
      if (att && att.isBot) {
        const tk = "t" + tierOf(att.id), wc = info.weaponId || "?";
        S.hits[tk] = (S.hits[tk] || 0) + 1;
        S.hitsByCls[wc] = (S.hitsByCls[wc] || 0) + 1;
        const db = d < 15 ? "<15" : d < 30 ? "15-30" : d < 60 ? "30-60" : d < 120 ? "60-120" : "120+";
        S.hitsByDist[db] = (S.hitsByDist[db] || 0) + 1;
        const key = att.id + ">" + v.id; const last = S.pairs.get(key);
        if (!last || W.t - last > 20) {
          const brg = Math.atan2(-(att.pos.x - v.pos.x), -(att.pos.z - v.pos.z));
          let off = brg - v.yaw; while (off > Math.PI) off -= 2 * Math.PI; while (off < -Math.PI) off += 2 * Math.PI;
          const vb = brainOf.get(v.id);
          const ab = brainOf.get(att.id);
          const dy = att.pos.y - v.pos.y;
          S.engageStart.push({ t: +W.t.toFixed(1), d: +d.toFixed(1), tier: tierOf(att.id), w: wc, vHuman: v.id === pid, offDeg: Math.round(Math.abs(off) * 180 / Math.PI),
            vState: vb ? vb.state : (v.id === pid ? 'human' : null), aState: ab ? ab.state : null, aPers: att.personality || null, dy: +dy.toFixed(1),
            vTgtIsAtt: vb ? vb.bb.target === att.id : null });
        }
        S.pairs.set(key, W.t);
      }
      if (v.id === pid) {
        if (!S.firstHurt) S.firstHurt = { t: +W.t.toFixed(1), by: info.attackerId, tier: tierOf(info.attackerId), d: d == null ? null : +d.toFixed(1), w: info.weaponId };
        const m = Math.floor(W.t / 60); const hm = S.humanMin[m] || (S.humanMin[m] = { dmg: 0, hits: 0, attackers: {}, targeting: 0, samples: 0, nearSum: 0, near50: 0, near100: 0, inStorm: 0 });
        hm.dmg += info.dmg || 0; hm.hits++; if (info.attackerId) hm.attackers[info.attackerId] = 1;
      }
    });
    W.events.on("shotFired", (a, wid) => {
      if (!live() || !a || !a.isBot) return;
      const tk = "t" + tierOf(a.id); S.shots[tk] = (S.shots[tk] || 0) + 1;
      S.shotsByCls[wid] = (S.shotsByCls[wid] || 0) + 1;
      const b = brainOf.get(a.id);
      if (b && b._afPendAcq && b.bb.target === b._afPendAcq.target) { S.acq.push([+(W.t - b._afPendAcq.t).toFixed(3), b.tier0, wid, b._afPendAcq.rms]); b._afPendAcq = null; }
      if (b && b._afPendRe && b.bb.target === b._afPendRe.target) { S.repeek.push([+(W.t - b._afPendRe.t).toFixed(3), b.tier0, wid, +b._afPendRe.gap.toFixed(2), b._afPendRe.rms]); b._afPendRe = null; }
    });
    W.events.on("actorDied", (v, killerId, wid) => {
      if (!live()) return;
      const k = killerId ? W.actorById.get(killerId) : null;
      const st = W.stormCtl ? W.stormCtl.storm.stateAt(W.t) : null;
      const atts = new Set((recentHurt.get(v.id) || []).filter((e) => W.t - e.t < 10 && e.att).map((e) => e.att));
      const kb = k ? brainOf.get(k.id) : null;
      const rec = { t: +W.t.toFixed(1), v: v.id, vBot: !!v.isBot, vTier: tierOf(v.id), k: killerId || null, kTier: killerId ? tierOf(killerId) : null,
        w: wid || null, d: k ? +Math.hypot(k.pos.x - v.pos.x, k.pos.z - v.pos.z).toFixed(1) : null, phase: st ? st.phase : null, ps: st ? st.phaseState : null,
        attackers10s: atts.size, kState: kb ? kb.state : null, vState: (brainOf.get(v.id) || {}).state || null, r: st ? Math.round(st.radius) : null, kElev: k ? +(k.pos.y - W.map.heightAt(k.pos.x, k.pos.z)).toFixed(1) : null, vElev: +(v.pos.y - W.map.heightAt(v.pos.x, v.pos.z)).toFixed(1), kEhp: k ? Math.round(k.hp + k.shield) : null, vShieldLast: v._afShield != null ? v._afShield : null,
        kPers: k && k.isBot ? k.personality : null, vPers: v.isBot ? v.personality : null, alive: W.match.aliveCount() };
      if (wid === "storm") S.stormDeaths++;
      S.kills.push(rec);
      if (v.id === pid) S.playerDeath = rec;
    });
    S.nades = []; S.downs = []; S.revives = []; S.reviveStarts = 0; S.reviveCancels = 0; S.fallDmg = [];
    W.events.on("grenadeThrown", (a, wid, o, v) => {
      if (!live() || !a) return;
      S.nades.push({ t: +W.t.toFixed(1), id: a.id, bot: !!a.isBot, w: wid, tier: tierOf(a.id), tgt: a.brain ? a.brain.bb.target : null,
        d: (a.brain && a.brain.bb.targetPos) ? +Math.hypot(a.brain.bb.targetPos.x - a.pos.x, a.brain.bb.targetPos.z - a.pos.z).toFixed(1) : null });
    });
    W.events.on("actorDowned", (a, src) => { if (live()) S.downs.push({ t: +W.t.toFixed(1), id: a.id, team: a.teamId || null }); });
    W.events.on("reviveStart", () => { if (live()) S.reviveStarts++; });
    W.events.on("reviveCancel", () => { if (live()) S.reviveCancels++; });
    W.events.on("actorRevived", (a, by) => { if (live()) S.revives.push({ t: +W.t.toFixed(1), id: a.id, by: by && by.id ? by.id : by }); });
    W.events.on("fallDamage", (a, dmg) => { if (live()) S.fallDmg.push({ t: +W.t.toFixed(1), id: a && a.id, bot: !!(a && a.isBot), dmg }); });
    W.events.on("landed", (a) => {
      if (!live()) return;
      S.landings.push({ id: a.id, t: +W.t.toFixed(1), x: +a.pos.x.toFixed(1), z: +a.pos.z.toFixed(1), bot: !!a.isBot });
    });
    W.events.on("healStart", (a, id) => {
      if (!live() || !a || !a.isBot) return;
      const b = brainOf.get(a.id);
      S.heals.push({ t: +W.t.toFixed(1), id, hp: Math.round(a.hp), sh: Math.round(a.shield), tgt: !!(b && b.bb.target), tier: tierOf(a.id) });
    });
    // per-tick hook: acquire / re-sight latency bookkeeping and (rotator) protection
    const prevHook = W._tickHook;
    W._tickHook = (W2) => {
      if (prevHook) try { prevHook(W2); } catch (e) {}
      if (!live()) return;
      for (const b of brains) {
        const a = b.actor; if (!a.alive || a.gliding) continue;
        const bb = b.bb;
        if (bb.acquireT !== b._afLastAcq) { b._afLastAcq = bb.acquireT; if (bb.target) b._afPendAcq = { t: bb.acquireT, target: bb.target, rms: b.tierK.reactionMs }; }
        const seenNow = bb.target && W.t - bb.targetSeenT < 0.05;
        if (seenNow && b._afLastTarget === bb.target && b._afLastSeenT != null && bb.targetSeenT - b._afLastSeenT > 1.0 && (bb.acquireT !== bb.targetSeenT || b._afLastTarget === bb.target)) {
          b._afPendRe = { t: bb.targetSeenT, target: bb.target, gap: bb.targetSeenT - b._afLastSeenT, rms: b.tierK.reactionMs };
        }
        if (bb.target) { if (b._afLastTarget !== bb.target) b._afLastSeenT = null; b._afLastTarget = bb.target; if (seenNow) b._afLastSeenT = bb.targetSeenT; }
        a._afShield = a.shield;
      }
      if (S.human === "rotator" && W.player && W.player.alive) { W.player.hp = 100; W.player.shield = 100; }
    };
    S.t0 = W.t;
    // drop heat: every bot's declared target vs the map's named POIs; the human's landing target
    S.pois = (W.map.pois || []).map((p) => ({ id: p.id, name: p.name, x: Math.round(p.x), z: Math.round(p.z), r: Math.round(p.r) }));
    S.drops = brains.map((b) => b.bb.dropTarget ? { x: Math.round(b.bb.dropTarget.x), z: Math.round(b.bb.dropTarget.z), pers: b.actor.personality, chute: !!b.earlyChute } : null);
    S.humanStart = W.player ? { x: Math.round(W.player.pos.x), z: Math.round(W.player.pos.z), y: Math.round(W.player.pos.y) } : null;
    S.neglect = { n: 0, calmLowShieldWithItem: 0, calmLowShield: 0, calmHpLowWithItem: 0 };
    S.cover = { engage: 0, inCover: 0, moving: 0, seenOpen: 0, indoor: 0, campN: 0, campCrouch: 0 };
    return { pid, nBots: brains.length, tiers: S.tiers, mix: W.botMix, mixRating: W.botMixRating, phase: W.phase, t: W.t };
  };

  AF.advance = (seconds) => {
    const C = window.__LC__, W = C.W, S = AF.S, K = W.SIM;
    const brains = C.brains();
    const brainOf = new Map(brains.map((b) => [b.actor.id, b]));
    const tierOf = (id) => { const b = brainOf.get(id); return b ? b.tier0 : null; };
    const pid = S.pid;
    const SLICE = 0.5;
    for (let el = 0; el < seconds; el += SLICE) {
      // scripted human: rotate toward the next safe zone when outside 60 % of it; otherwise hold (no shooting)
      const p = W.player;
      if (S.human === "rotator" && p && p.alive && !p.gliding) {
        const st = W.stormCtl.storm.stateAt(W.t);
        const c = st.nextCenter || st.center, r = st.nextRadius != null ? st.nextRadius : st.radius;
        const dx = c.x - p.pos.x, dz = c.z - p.pos.z, d = Math.hypot(dx, dz);
        const inp = p.input;
        if (d > r * 0.6) { inp.yaw = Math.atan2(-dx, -dz); inp.mz = 1; inp.sprint = true; }
        else { inp.mz = 0; inp.sprint = false; }
        inp.mx = 0; inp.fire = false;
      }
      C.fastForward(SLICE, 1 / 60);
      const st = W.stormCtl ? W.stormCtl.storm.stateAt(W.t) : null;
      if (st && st.phase !== S.lastPhase) { S.phases.push({ phase: st.phase, t: +W.t.toFixed(1), alive: W.match.aliveCount(), r: Math.round(st.radius) }); S.lastPhase = st.phase; }
      if (st && st.closing && !S.phases.find((x) => x.phase === st.phase && x.closing)) S.phases.push({ phase: st.phase, closing: true, t: +W.t.toFixed(1), alive: W.match.aliveCount(), r: Math.round(st.radius) });
      // sample every 2 s
      if (Math.round(W.t * 2) % 4 === 0) {
        let n = 0, sh = 0, sh0 = 0, sh50 = 0, hpFull = 0, inStorm = 0, landed = 0, ehp = 0, elev = 0, crouchN = 0;
        const states = {};
        for (const b of brains) {
          const a = b.actor; if (!a.alive) continue;
          n++;
          if (a.gliding) continue;
          landed++;
          sh += a.shield; ehp += a.hp + a.shield; if (a.shield <= 0) sh0++; if (a.shield >= 50) sh50++; if (a.hp >= 100) hpFull++;
          states[b.state] = (states[b.state] || 0) + 1; { const el = a.pos.y - W.map.heightAt(a.pos.x, a.pos.z); if (el > 2.5) elev++; } if (a.crouch || a.crouching) crouchN++;
          if (st && st.dps > 0 && Math.hypot(a.pos.x - st.center.x, a.pos.z - st.center.z) > st.radius) inStorm++;
        }
        for (const b of brains) {
          const a = b.actor; if (!a.alive || a.gliding) continue;
          if (b.state === 'ENGAGE') { S.cover.engage++; if (b.bb.coverState === 'IN') S.cover.inCover++; else if (b.bb.coverState === 'MOVING') S.cover.moving++; else if (W.t - b.bb.targetSeenT < 0.4) S.cover.seenOpen++; }
          if (b.state === 'CAMP') { S.cover.campN++; if (a.crouching) S.cover.campCrouch++; }
          const calm = !b.bb.target && !a.healing && W.t - (a.lastDamageT || -99) > 5;
          if (!calm) continue;
          S.neglect.n++;
          const hasSh = a.inventory.slots.some((s2) => s2 && s2.kind === 'consumable' && s2.count > 0 && (s2.id === 'mini_shield' ? a.shield < 50 : s2.id === 'big_shield' ? a.shield < 100 : false));
          const hasHp = a.inventory.slots.some((s2) => s2 && s2.kind === 'consumable' && s2.count > 0 && (s2.id === 'bandage' ? a.hp < 75 : s2.id === 'medkit' ? a.hp < 100 : false));
          if (a.shield < 50) { S.neglect.calmLowShield++; if (hasSh) S.neglect.calmLowShieldWithItem++; }
          if (a.hp < 75 && hasHp) S.neglect.calmHpLowWithItem++;
        }
        if (W.t >= 600) { for (const b of brains) { const a = b.actor; if (a.alive && !a.gliding) { (S.sh600 || (S.sh600 = [])).push(Math.round(a.shield));
          if (a.shield < 75) { const D = S.sh600why || (S.sh600why = { n: 0, hasItem: 0, hurt10: 0, healing: 0, target: 0, states: {}, noItemCalm: 0 });
            D.n++; const hi = a.inventory.slots.some((s2) => s2 && s2.kind === 'consumable' && s2.count > 0 && (s2.id === 'mini_shield' ? a.shield < 50 : s2.id === 'big_shield'));
            if (hi) D.hasItem++; if (W.t - (a.lastDamageT || -99) < 10) D.hurt10++; if (a.healing) D.healing++; if (b.bb.target) D.target++;
            if (!hi && W.t - (a.lastDamageT || -99) >= 10 && !b.bb.target) D.noItemCalm++;
            const k = b.state + (hi ? '+i' : ''); D.states[k] = (D.states[k] || 0) + 1; } } } }
        S.samples.push({ t: +W.t.toFixed(1), alive: W.match.aliveCount(), bots: n, landed, meanSh: landed ? +(sh / landed).toFixed(1) : null, meanEhp: landed ? +(ehp / landed).toFixed(1) : null,
          sh0: landed ? +(sh0 / landed).toFixed(3) : null, sh50: landed ? +(sh50 / landed).toFixed(3) : null, hpFull: landed ? +(hpFull / landed).toFixed(3) : null,
          inStorm, elev, crouchN, states, phase: st ? st.phase : null, ps: st ? st.phaseState : null, r: st ? Math.round(st.radius) : null });
        // human exposure
        if (p && p.alive && !p.gliding) {
          if (!S.landT) S.landT = +W.t.toFixed(1);
          const m = Math.floor(W.t / 60);
          const hm = S.humanMin[m] || (S.humanMin[m] = { dmg: 0, hits: 0, attackers: {}, targeting: 0, samples: 0, nearSum: 0, near50: 0, near100: 0, inStorm: 0 });
          hm.samples++;
          let near = 1e9, tg = 0, n50 = 0, n100 = 0;
          for (const b of brains) {
            const a = b.actor; if (!a.alive || a.gliding) continue;
            const d = Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z);
            if (d < near) near = d; if (d < 50) n50++; if (d < 100) n100++;
            if (b.bb.target === pid && W.t - b.bb.targetSeenT < 0.5) tg++;
          }
          hm.targeting += tg; hm.nearSum += near < 1e9 ? near : 0; hm.near50 += n50; hm.near100 += n100;
          if (st && st.dps > 0 && Math.hypot(p.pos.x - st.center.x, p.pos.z - st.center.z) > st.radius) hm.inStorm++;
          if (tg && !S.firstContact) S.firstContact = { t: +W.t.toFixed(1), n: tg };
        }
      }
      if (W.match.aliveCount() <= 4 && !S.final4) {
        const al = W.actors.filter((x) => x.alive).map((x) => ({ id: x.id, x: +x.pos.x.toFixed(0), z: +x.pos.z.toFixed(0), hp: Math.round(x.hp), sh: Math.round(x.shield), tier: tierOf(x.id), state: (brainOf.get(x.id) || {}).state || 'human' }));
        S.final4 = { t: +W.t.toFixed(1), r: st ? Math.round(st.radius) : null, c: st ? [Math.round(st.center.x), Math.round(st.center.z)] : null, actors: al };
      }
      if (W.match && W.match.over) break;
    }
    return { t: +W.t.toFixed(1), alive: W.match.aliveCount(), over: !!W.match.over, phase: W.phase };
  };

  AF.collect = () => {
    const W = window.__LC__.W, S = AF.S;
    const out = Object.assign({}, S);
    delete out.pairs;
    out.stub = window.__STUBM ? JSON.parse(JSON.stringify(window.__STUBM)) : null; out.simT = +W.t.toFixed(1); out.nav = Object.assign({}, window.__LC__.navStats ? window.__LC__.navStats() : {}); out.over = !!W.match.over; out.winner = W.match.winner;
    out.winnerTier = (() => { const b = window.__LC__.brains().find((x) => x.actor.id === W.match.winner); return b ? b.tier0 : (W.match.winner === S.pid ? "human" : null); })();
    out.placements = (W.match.placements || []).slice();
    out.playerPlacement = W.match.placementOf ? W.match.placementOf(S.pid) : null;
    out.storm = W.stormCtl ? { total: +W.stormCtl.storm.totalS.toFixed(1), timeline: W.stormCtl.storm.timeline.map((x) => [Math.round(x.waitStart), Math.round(x.shrinkStart), Math.round(x.end)]),
      radii: W.stormCtl.storm.circles.map((c) => Math.round(c.r)), half: W.map.half } : null;
    window.__afGen++;
    return out;
  };
})();
