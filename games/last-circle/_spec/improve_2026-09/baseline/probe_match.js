// In-page probe for Last Circle bot/match quality. READ-ONLY on game state:
// it never writes actor/brain fields. Driven by probe_match.py via page.evaluate.
// Args: [seed, mapId, maxSeconds, stepS, patchSeed]
//   patchSeed > 0 -> replace Math.random with a mulberry32 stream reset right
//   before the first fastForward (proves whether Math.random is the ONLY
//   non-determinism source). 0 -> leave Math.random alone (shipping behaviour).
async ([seed, mapId, maxSeconds, stepS, patchSeed, stormOn]) => {
  const C = window.__LC__, W = C.W;
  const origRandom = window.__probeOrigRandom || Math.random;
  window.__probeOrigRandom = origRandom;
  Math.random = origRandom;
  await C.startMatch({ mapId: mapId || undefined, mode: "standard", seed });
  const phaseAfterStart = W.phase;
  // The lobby screen (hud.js showLobby) only hands off to the drop after ~3.4 s
  // of setInterval — which never fires inside a synchronous probe, so W.phase
  // stays "lobby" and storm.js:111 (`W.phase === "match"`) never deals damage.
  // ENTER is the lobby's own skip (hud.js finishLobby, synchronous): press it so
  // the match runs through the real lobby -> drop -> match path.
  if (stormOn) window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
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
  let carryNotHoldN = 0, carrySniperLauncherN = 0;
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
      if (carriesBetter(a)) better++;
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
          everStuck.add(id);
          if (!stuckOpen.get(id)) {
            stuckOpen.set(id, true);
            const mt = b.bb.moveTo;
            stuckEp.push({ id, t: +W.t.toFixed(1), x: +a.pos.x.toFixed(1), y: +a.pos.y.toFixed(1), z: +a.pos.z.toFixed(1),
              st: ring.map((r) => r.st).join(">"), box: +box.toFixed(2),
              goalD: mt ? +Math.hypot(mt.x - a.pos.x, mt.z - a.pos.z).toFixed(1) : null,
              path: b.bb.path ? b.bb.path.length : 0, inWater: !!a.swimming });
          }
        } else stuckOpen.set(id, false);
      } else stuckOpen.set(id, false);
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
    callers, agg: { movingN, stuckBoxN, stuckNetN, landedN, activeDryN, allDryN, carryNotHoldN, carrySniperLauncherN,
      everAllDry: everAllDry.size, everStuck: everStuck.size, nBots: botIds.length, chests, stateCount },
  };
}
