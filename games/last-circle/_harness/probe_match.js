// In-page probe for Last Circle bot/match quality. READ-ONLY on game state:
// it never writes actor/brain fields. Driven by _harness/probe_match.py via page.evaluate.
// (Promoted from _spec/improve_2026-09/baseline/probe_match.js; L1 additions: skipStart - the harness already
//  started the match and skipped the lobby with a REAL Enter (common.start_match) while the kernel loop was frozen;
//  better-gun-held-pistol counters; per-bot longest frozen span; a position track for watched bot ids; the POIs.)
// Args: [seed, mapId, maxSeconds, stepS, patchSeed, stormOn, skipStart, watchIds]
//   patchSeed > 0 -> replace Math.random with a mulberry32 stream reset right
//   before the first fastForward (proves whether Math.random is the ONLY
//   non-determinism source). 0 -> leave Math.random alone (shipping behaviour).
async ([seed, mapId, maxSeconds, stepS, patchSeed, stormOn, skipStart, watchIds]) => {
  const C = window.__LC__, W = C.W;
  const origRandom = window.__probeOrigRandom || Math.random;
  window.__probeOrigRandom = origRandom;
  Math.random = origRandom;
  if (!skipStart) await C.startMatch({ mapId: mapId || undefined, mode: "standard", seed });
  const phaseAfterStart = W.phase;
  // The lobby screen (hud.js showLobby) only hands off to the drop after ~3.4 s
  // of setInterval — which never fires inside a synchronous probe, so W.phase
  // stays "lobby" and storm.js:111 (`W.phase === "match"`) never deals damage.
  // ENTER is the lobby's own skip (hud.js finishLobby, synchronous): press it so
  // the match runs through the real lobby -> drop -> match path.
  if (stormOn && !skipStart) window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  const phaseAfterLobby = W.phase;
  // freeze the rAF loop so wall-clock frames cannot advance the sim between
  // our synchronous steps (fastForward ignores W.paused)
  W.paused = true;
  // patchSeed > 0: GLOBAL seeded stream (every caller shares it — view code too).
  // patchSeed < 0: ROUTED — only calls whose immediate caller is a SIM file
  //   (bots/weapons/loot/player/storm) draw from the seeded stream; view files
  //   (fx/audio/hud/kernel) keep the real Math.random, as a per-system fix would.
  const callers = {};
  if (patchSeed !== 0) {
    let s = Math.abs(patchSeed) >>> 0;
    const seeded = function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const SIMF = /royale\/(bots|weapons|loot|player|storm)\.js/;
    Math.random = function () {
      const st = new Error().stack.split("\n")[2] || "";
      const m = st.match(/\/([a-z_0-9]+\.js)/i);
      const f = m ? m[1] : "?";
      callers[f] = (callers[f] || 0) + 1;
      if (patchSeed > 0) return seeded();
      return SIMF.test(st) ? seeded() : origRandom();
    };
  }
  const K = W.SIM;
  const PISTOL_SCORE = K.gunScore("pistol", 0);
  const MOVING = new Set(["LOOT", "ROTATE", "PUSH", "WANDER", "HUNT", "FLEE", "SUPPLY"]);
  const brains = C.brains();
  const brainOf = new Map(brains.map((b) => [b.actor.id, b]));
  const botIds = brains.map((b) => b.actor.id);

  const slotAmmo = (a, s) => {
    const def = K.WEAPONS[s.id]; if (!def) return 0;
    return (s.mag != null ? s.mag : 0) + (a.inventory.ammo[def.ammo] || 0);
  };
  const guns = (a) => a.inventory.slots.filter((s) => s && s.kind === "weapon");
  const upgraded = (a) => a.inventory.slots.some((s, i) => s && s.kind === "weapon" && !(i === 0 && s.id === "pistol" && s.rarity === 0));
  const carriesBetter = (a) => guns(a).some((s) => K.gunScore(s.id, s.rarity || 0) > PISTOL_SCORE * 1.001);
  const holdsNonPistol = (a) => !!(a.weapon && a.weapon.id !== "pistol" && !a.weapon.id.startsWith("consumable"));
  const bestGun = (a) => {
    let b = null, bs = -1;
    for (const s of guns(a)) { const sc = K.gunScore(s.id, s.rarity || 0); if (sc > bs) { bs = sc; b = s; } }
    return b ? b.id + ":" + (b.rarity || 0) : "none";
  };
  // ── L1F (VERIFY.md #24): the RANGE/AMMO-AWARE "better gun" variant (L6's pmdiag), beside the raw-DPS gunScore one.
  // Values come from the sim's own gunValueAt (time-to-kill from the weapon tables) for THIS bot's hands: the live fight
  // (target seen < 3 s ago: its distance + EHP, the bot's own speed) or, out of a fight, the mean over 5/15/40/80 m;
  // the slot's own mag + reserve; the bot's tier aim error x 0.7 RMS; a sniper on the run halved. The decision rule is
  // bots.js ensureGunOut's, MIRRORED here (constants: idle tie 0.02, swap price 0.4 s in a fight, margin 1.15): a sample
  // "carries a better gun (value)" when a carried gun with ammo beats the PISTOL slot by that rule, whatever is held;
  // it "holds the pistol" when the active weapon is the pistol. Transitional samples are skipped: within 1.2 s of the last
  // swap (the bot's swap gate), reloading, or holding a consumable. If L6 changes ensureGunOut's rule, update this mirror.
  const VAL = typeof K.gunValueAt === "function";
  const IDLE_R = [5, 15, 40, 80];
  const gv = (a, s, dist, ehp, speed) => {
    const def = K.WEAPONS[s.id]; if (!def) return -1;
    const reserve = a.inventory.ammo[def.ammo] || 0, mag = s.mag != null ? s.mag : 0;
    if (mag + reserve <= 0) return 0;
    const tk = a.brain && a.brain.tierK; const aimDeg = tk ? tk.aimErrDeg * 0.7 : undefined;
    if (dist == null) { let v = 0; for (const d of IDLE_R) v += K.gunValueAt(s.id, s.rarity || 0, d, { mag, reserve, aimDeg }); return v / IDLE_R.length; }
    let v = K.gunValueAt(s.id, s.rarity || 0, dist, { ehp, speed, mag, reserve, aimDeg });
    if (def.cls === "sniper" && speed > 3) v *= 0.5;
    return v;
  };
  const fightOf = (a, b) => {
    const bb = b && b.bb; let dist = null, ehp = 150;
    if (bb && bb.target && bb.targetPos && W.t - bb.targetSeenT < 3) {
      dist = Math.hypot(bb.targetPos.x - a.pos.x, bb.targetPos.z - a.pos.z);
      const t = W.actorById.get(bb.target); if (t && t.alive) ehp = (t.hp || 0) + (t.shield || 0);
    }
    return { dist, ehp, speed: a.vel ? Math.hypot(a.vel.x, a.vel.z) : 0 };
  };
  // returns null (not judged: no pistol slot / transitional / no other loaded gun) or { better, holdsPistol, ... }
  const valueBetter = (a, b) => {
    if (!VAL) return null;
    const gs = guns(a);
    const pist = gs.find((s) => s.id === "pistol");
    if (!pist) return null;
    const w = a.weapon;
    if (!w || w.id.startsWith("consumable") || w.state === "reloading") return null;
    if (b && b.bb && W.t - (b.bb.swapT != null ? b.bb.swapT : -99) <= 1.2) return null;
    const c = fightOf(a, b);
    const sc = (s) => { const v = gv(a, s, c.dist, c.ehp, c.speed); return (c.dist != null && v > 0) ? v + 0.02 * gv(a, s, null, c.ehp, c.speed) : v; };
    const pv = sc(pist);
    let bestV = -1, bestS = null;
    for (const s of gs) { if (s === pist || slotAmmo(a, s) <= 0) continue; const v = sc(s); if (v > bestV) { bestV = v; bestS = s; } }
    if (!bestS) return { better: false };
    const eff = c.dist != null ? c.ehp / (c.ehp / Math.max(1e-6, bestV) + 0.4) : bestV;
    return { better: eff > pv * 1.15, holdsPistol: w.id === "pistol", dist: c.dist, pv, bestV, best: bestS.id + ":" + (bestS.rarity || 0) };
  };

  // ── events ──
  const kills = [];            // {t, victim, killer, wid, killerActive, killerIsBot}
  const deaths = new Map();    // id -> snapshot at death
  // loot.js:60 registers deathDrop on actorDied at init, BEFORE this listener, so
  // the victim's inventory is already emptied when we hear the event. Use the
  // snapshot from the last 0.5 s sample instead.
  const lastSnap = new Map();
  const snap = (a) => ({ upgraded: upgraded(a), better: carriesBetter(a),
      active: a.weapon ? a.weapon.id : null, best: bestGun(a),
      guns: guns(a).map((s) => s.id + ":" + (s.rarity || 0)),
      allDry: !guns(a).some((s) => slotAmmo(a, s) > 0),
      state: (brainOf.get(a.id) || {}).state || null });
  const onDied = (victim, killerId, weaponId) => {
    const k = killerId && W.actorById.get(killerId);
    kills.push({ t: +W.t.toFixed(2), victim: victim.id, killer: killerId || null,
      wid: weaponId || null, killerBot: !!(k && k.isBot),
      kActive: k && k.weapon ? k.weapon.id : null,
      // nearest floor GUN (not this death's own drop) to the KILLER when a pistol kill lands:
      // "fought with the pistol while a better gun lay within reach"
      kGunD: (k && weaponId === "pistol") ? (() => {
        let best = null;
        for (const n of W.nearbyLoot(k.pos, 40)) {
          if (n.type === "chest") { if (best == null || n.d < best.d) best = { d: n.d, what: "chest" }; continue; }
          if (n.data.kind !== "weapon" || String(n.id).startsWith("dd:" + victim.id)) continue;
          if (n.data.id === "pistol" && !(n.data.rarity > 0)) continue;
          if (best == null || n.d < best.d) best = { d: n.d, what: n.data.id + ":" + (n.data.rarity || 0) };
        }
        return best ? { d: +best.d.toFixed(1), what: best.what } : null;
      })() : null,
      kSinceLand: k && k._landT != null ? +(W.t - k._landT).toFixed(1) : null });
    if (victim.isBot) deaths.set(victim.id, Object.assign({ t: +W.t.toFixed(2) },
      lastSnap.get(victim.id) || { upgraded: false, better: false, active: null, best: "none", guns: [], allDry: false, state: null, noSnap: true }));
  };
  // W.events has no off(); guard with a generation token so old listeners go inert
  window.__probeGen = (window.__probeGen || 0) + 1;
  const gen = window.__probeGen;
  W.events.on("actorDied", (...a) => { if (window.__probeGen === gen) onDied(...a); });
  let pickups = 0, chests = 0;
  W.events.on("chestOpened", (a) => { if (window.__probeGen === gen && a && a.isBot) chests++; });

  // ── sampling ──
  const SLICE = 0.5, WIN = 7;          // 7 samples, 0.5 s apart = a 3.0 s window
  const hist = new Map();              // id -> ring of {x,z,mv,st}
  const series = [];                   // per-sample aggregates
  const stuckEp = [];                  // stuck windows (first detection per episode)
  const stuckOpen = new Map();
  let movingN = 0, stuckBoxN = 0, stuckNetN = 0, aliveN = 0, activeDryN = 0, allDryN = 0, landedN = 0;
  let carryNotHoldN = 0, carrySniperLauncherN = 0, betterN = 0, betterHoldPistolN = 0;
  let valJudgedN = 0, valBetterN = 0, valHoldPistolN = 0;
  // L1F (L6F request): the audit's raw-DPS definition counted (1) a bot HOLDING its best gun when that gun is a rare pistol
  // (gunScore pistol:1 153 > pistol:0 133, held id "pistol") and (2) better guns with 0 rounds. The refined raw row: a
  // better gun must be LOADED (mag + reserve > 0), and "holds the pistol" means a pistol scoring below the best loaded gun.
  let rawBetterN = 0, rawHoldPistolN = 0;
  const valByDist = {}, valSamples = [];
  const stuckRun = new Map(), maxStuckRun = new Map();
  const watch = new Set(watchIds || []), track = {};
  const everAllDry = new Set(), everStuck = new Set();
  const stateCount = {};
  const hashes = [];
  const hashAt = new Set([30, 60, 120, 240, 480]);
  const hashWorld = () => {
    let h = 0x811c9dc5;
    const mix = (v) => { const q = Math.round(v * 1000) | 0;
      for (let k = 0; k < 4; k++) { h ^= (q >>> (8 * k)) & 0xff; h = Math.imul(h, 0x01000193); } };
    for (const a of W.actors) { mix(a.pos.x); mix(a.pos.y); mix(a.pos.z); mix(a.hp); mix(a.shield); mix(a.alive ? 1 : 0); }
    return (h >>> 0).toString(16).padStart(8, "0");
  };
  const t0wall = performance.now();
  let firstDivergeProbe = [];
  let nextHash = 0;
  for (let el = 0; el < maxSeconds; el += SLICE) {
    C.fastForward(SLICE, stepS);
    const tt = Math.round(W.t * 2) / 2;
    if (hashAt.has(tt)) hashes.push({ t: tt, h: hashWorld(), alive: W.match.aliveCount() });
    // every 5 s: a cheap fingerprint of the world, to localise first divergence
    if (Math.abs(W.t - nextHash) < 1e-6 || W.t > nextHash) { firstDivergeProbe.push(hashWorld()); nextHash += 5; }
    let alive = 0, up = 0, better = 0, holdNP = 0, dryA = 0, dryAll = 0, landed = 0, lootState = 0;
    for (const id of botIds) {
      const a = W.actorById.get(id); const b = brainOf.get(id);
      if (!a || !a.alive) { hist.delete(id); continue; }
      alive++;
      stateCount[b.state] = (stateCount[b.state] || 0) + 1;
      if (b.state === "LOOT") lootState++;
      lastSnap.set(id, snap(a));
      if (a.gliding) continue;
      landed++;
      landedN++;
      if (upgraded(a)) up++;
      if (carriesBetter(a)) { better++; betterN++; if (a.weapon && a.weapon.id === "pistol") betterHoldPistolN++; }
      {
        let bestLoaded = -1;
        for (const s of guns(a)) { if (slotAmmo(a, s) <= 0) continue; const sc = K.gunScore(s.id, s.rarity || 0); if (sc > PISTOL_SCORE * 1.001 && sc > bestLoaded) bestLoaded = sc; }
        if (bestLoaded > 0) {
          rawBetterN++;
          const hs = a.inventory.slots[a.inventory.active];
          const heldScore = hs && hs.kind === "weapon" ? K.gunScore(hs.id, hs.rarity || 0) : -1;
          if (a.weapon && a.weapon.id === "pistol" && heldScore < bestLoaded) rawHoldPistolN++;
        }
      }
      const vb = valueBetter(a, b);
      if (vb) {
        valJudgedN++;
        if (vb.better) {
          valBetterN++;
          if (vb.holdsPistol) {
            valHoldPistolN++;
            const db = vb.dist == null ? "idle" : vb.dist < 15 ? "<15" : vb.dist < 30 ? "15-30" : vb.dist < 60 ? "30-60" : vb.dist < 120 ? "60-120" : "120+";
            valByDist[db] = (valByDist[db] || 0) + 1;
            if (valSamples.length < 40) valSamples.push({ t: +W.t.toFixed(1), id, st: b.state, dist: vb.dist == null ? null : +vb.dist.toFixed(0),
              pistolV: +vb.pv.toFixed(2), best: vb.best, bestV: +vb.bestV.toFixed(2) });
          }
        }
      }
      if (holdsNonPistol(a)) holdNP++;
      const gs = guns(a);
      const hasSL = gs.some((s) => s.id === "sniper" || s.id === "glauncher");
      if (hasSL) carrySniperLauncherN++;
      if (hasSL && a.weapon && a.weapon.id === "pistol") carryNotHoldN++;
      const act = a.inventory.slots[a.inventory.active];
      if (act && act.kind === "weapon" && slotAmmo(a, act) <= 0) { dryA++; activeDryN++; }
      if (!gs.some((s) => slotAmmo(a, s) > 0)) { dryAll++; allDryN++; everAllDry.add(id); }
      // stuck window
      const mv = MOVING.has(b.state) && !b.bb.chestId && !a.healing && !a.emoting;
      const ring = hist.get(id) || []; ring.push({ x: a.pos.x, z: a.pos.z, mv, st: b.state });
      if (ring.length > WIN) ring.shift();
      hist.set(id, ring);
      if (mv) movingN++;
      if (ring.length === WIN && ring.every((r) => r.mv)) {
        let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
        for (const r of ring) { mnx = Math.min(mnx, r.x); mxx = Math.max(mxx, r.x); mnz = Math.min(mnz, r.z); mxz = Math.max(mxz, r.z); }
        const box = Math.hypot(mxx - mnx, mxz - mnz);
        const net = Math.hypot(ring[WIN - 1].x - ring[0].x, ring[WIN - 1].z - ring[0].z);
        const isBox = box < 0.4, isNet = net < 0.4;
        if (isBox) stuckBoxN++;
        if (isNet) stuckNetN++;
        if (isNet) {
          const run = (stuckRun.get(id) || 0) + SLICE; stuckRun.set(id, run);
          if (run > (maxStuckRun.get(id) || 0)) maxStuckRun.set(id, run);
          everStuck.add(id);
          if (!stuckOpen.get(id)) {
            stuckOpen.set(id, true);
            const mt = b.bb.moveTo;
            stuckEp.push({ id, t: +W.t.toFixed(1), x: +a.pos.x.toFixed(1), y: +a.pos.y.toFixed(1), z: +a.pos.z.toFixed(1),
              st: ring.map((r) => r.st).join(">"), box: +box.toFixed(2),
              goalD: mt ? +Math.hypot(mt.x - a.pos.x, mt.z - a.pos.z).toFixed(1) : null,
              path: b.bb.path ? b.bb.path.length : 0, inWater: !!a.swimming });
          }
        } else { stuckOpen.set(id, false); stuckRun.set(id, 0); }
      } else { stuckOpen.set(id, false); stuckRun.set(id, 0); }
    }
    for (const id of watch) {
      const a = W.actorById.get(id); if (!a) continue;
      const tr = track[id] || (track[id] = []);
      if (tr.length < 2400) tr.push([+W.t.toFixed(1), +a.pos.x.toFixed(1), +a.pos.y.toFixed(1), +a.pos.z.toFixed(1), a.alive ? 1 : 0, a.gliding ? 1 : 0, (brainOf.get(id) || {}).state || null]);
    }
    aliveN += landed;
    const stS = W.stormCtl ? W.stormCtl.storm.stateAt(W.t) : null;
    series.push({ t: +W.t.toFixed(1), alive, landed, up, better, holdNP, dryA, dryAll, lootState,
      matchAlive: W.match.aliveCount(), stormR: stS ? Math.round(stS.radius) : null, phase: stS ? stS.phase : null });
    if (W.match && W.match.over) break;
  }
  const wallS = (performance.now() - t0wall) / 1000;
  // survivors at end
  const endInv = [];
  for (const id of botIds) {
    const a = W.actorById.get(id);
    const d = deaths.get(id);
    if (d) endInv.push(Object.assign({ id, died: true }, d));
    else if (a) endInv.push({ id, died: false, t: +W.t.toFixed(2), upgraded: upgraded(a), better: carriesBetter(a),
      active: a.weapon ? a.weapon.id : null, best: bestGun(a), guns: guns(a).map((s) => s.id + ":" + (s.rarity || 0)),
      allDry: !guns(a).some((s) => slotAmmo(a, s) > 0), state: (brainOf.get(id) || {}).state });
  }
  const tiers = brains.map((b) => b.tier0);
  window.__probeGen++;                 // retire our listeners
  Math.random = origRandom;
  return {
    seed, map: W.mapId, nPois: W.map.pois.length, simT: +W.t.toFixed(1), over: !!W.match.over, wallS: +wallS.toFixed(1), phaseAfterStart, phaseAfterLobby, phaseEnd: W.phase, stormOn: !!stormOn,
    matchAlive: W.match.aliveCount(), winner: W.match.winner || null,
    playerAlive: !!(W.player && W.player.alive), playerDiedT: (deaths.get(W.player && W.player.id) || {}).t || null,
    placements: (W.match.placements || []).slice(),
    kills, endInv, series, stuckEp, hashes, fp: firstDivergeProbe, tiers,
    callers, track, pois: W.map.pois.map((p) => ({ id: p.id, name: p.name, x: p.x, z: p.z, r: p.r })),
    maxStuck: [...maxStuckRun.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8),
    agg: { movingN, stuckBoxN, stuckNetN, landedN, activeDryN, allDryN, carryNotHoldN, carrySniperLauncherN, betterN, betterHoldPistolN,
      valueAware: VAL, valJudgedN, valBetterN, valHoldPistolN, valByDist, rawBetterN, rawHoldPistolN,
      everAllDry: everAllDry.size, everStuck: everStuck.size, nBots: botIds.length, chests, stateCount },
    valSamples,
  };
}
