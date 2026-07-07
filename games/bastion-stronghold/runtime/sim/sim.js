// Bastion Realms: Stronghold — core simulation.
// Pure + deterministic. View/audio consume drainEvents(); tests step synchronously.
import { makeRng } from './rng.js';
import { GRID_W, GRID_H, CX, CY, cellToWorld, posAlong, isPlaza } from './map.js';
import { enemyDef } from '../data/enemies.js';
import { towerDef, upgradeCost, SELL_REFUND } from '../data/towers.js';
import { levelDef } from '../data/levels.js';
import { endlessWave, wavePreview } from './waves.js';

const DT = 1 / 30;
export const TARGET_MODES = ['first', 'last', 'strong', 'close'];

let nextId = 1;
function uid() { return nextId++; }

export function createSim(wi, li, { endless = false } = {}) {
  const level = levelDef(wi, li);
  const { map } = level;
  const rng = makeRng(level.seed ^ 0xabcdef);
  const hazard = level.hazard ? { ...level.hazard } : null;

  // resonance zones (crystal world): fixed positions near roads
  const resonanceZones = [];
  if (hazard?.id === 'resonance') {
    for (let i = 0; i < (hazard.zones || 2); i++) {
      const route = map.routes[i % map.routes.length];
      const p = posAlong(route, route.total * (0.35 + i * 0.25));
      resonanceZones.push({ x: p.x, z: p.z, r: hazard.radius });
    }
  }

  const sim = {
    wi, li, level, endless,
    time: 0,
    phase: 'idle',          // idle | prep | wave | won | lost
    waveIdx: -1,
    waveTotal: endless ? Infinity : level.waves.length,
    prepT: 0,
    gold: level.startGold,
    bastionHp: level.bastionHp, bastionMax: level.bastionHp,
    enemies: [], towers: [], projectiles: [], zones: [], carts: [], spawnQueue: [],
    waveRepairUsed: 0, waveRepairCap: 5,
    events: [],
    hasteUntil: 0,           // global enemy haste (tailwind / rally cry)
    resonanceZones,
    hazardState: hazard ? { nextAt: 14 + rng.range(0, 8) } : null,
    stats: {
      kills: 0, breaches: 0, built: 0, sold: 0, upgrades: 0, maxed: 0,
      goldEarned: 0, repairs: 0, pierceHits: 0, chainHits: 0, runeBlasts: 0,
      zonesBurned: 0, wavesCleared: 0, dmgTaken: 0,
    },
    rng,
  };

  function emit(kind, data) {
    sim.events.push({ kind, t: sim.time, ...data });
    if (sim.events.length > 900) sim.events.splice(0, sim.events.length - 600);
  }
  sim.drainEvents = () => { const e = sim.events; sim.events = []; return e; };

  sim.enemyPos = (e) => posAlong(map.routes[e.roadIdx], e.dist);

  // ---------- bastion ----------
  function bastionTier() {
    const f = sim.bastionHp / sim.bastionMax;
    return f > 0.75 ? 0 : f > 0.5 ? 1 : f > 0.25 ? 2 : 3;
  }
  sim.bastionTier = bastionTier;

  function damageBastion(amount, source) {
    const before = bastionTier();
    sim.bastionHp = Math.max(0, sim.bastionHp - amount);
    sim.stats.dmgTaken += amount;
    emit('bastionHit', { amount, hp: sim.bastionHp, source });
    if (bastionTier() !== before) emit('bastionTier', { tier: bastionTier() });
    if (sim.bastionHp <= 0 && sim.phase !== 'lost') {
      sim.phase = 'lost';
      emit('bastionFall', {});
      emit('lose', {});
    }
  }
  function repairBastion(amount) {
    if (sim.bastionHp <= 0 || sim.bastionHp >= sim.bastionMax) return;
    const before = bastionTier();
    sim.bastionHp = Math.min(sim.bastionMax, sim.bastionHp + amount);
    sim.stats.repairs += amount;
    if (bastionTier() !== before) emit('bastionTier', { tier: bastionTier() });
  }

  // ---------- build / placement ----------
  function cellKey(cx, cy) { return cx + ',' + cy; }
  const blockedSet = new Set(map.blocked.map(([x, y]) => cellKey(x, y)));

  sim.canBuild = (type, cx, cy) => {
    const def = towerDef(type);
    if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) return { ok: false, reason: 'out of bounds' };
    const onRoad = map.roadSet.has(cellKey(cx, cy));
    if (sim.towers.some((t) => t.cx === cx && t.cy === cy)) return { ok: false, reason: 'occupied' };
    if (def.placement === 'road') {
      if (!onRoad) return { ok: false, reason: 'must be placed ON a road' };
      const owned = sim.towers.filter((t) => t.type === type);
      const capLvl = Math.max(0, ...owned.map((t) => t.level));
      const cap = def.maxActive[capLvl];
      if (owned.length >= cap) return { ok: false, reason: `limit ${cap} active — upgrade one to raise it` };
    } else {
      if (onRoad) return { ok: false, reason: 'cannot build on the road' };
      if (isPlaza(cx, cy)) return { ok: false, reason: 'the Bastion stands here' };
      if (blockedSet.has(cellKey(cx, cy))) return { ok: false, reason: 'blocked terrain' };
    }
    return { ok: true };
  };

  sim.placeTower = (type, cx, cy) => {
    const def = towerDef(type);
    const chk = sim.canBuild(type, cx, cy);
    if (!chk.ok) return chk;
    if (sim.gold < def.cost) return { ok: false, reason: 'not enough gold' };
    sim.gold -= def.cost;
    const w = cellToWorld(cx, cy);
    const tw = {
      id: uid(), type, def, cx, cy, x: w.x, z: w.z,
      level: 0, cooldown: 0.4, mode: 'first',
      invested: def.cost, disabledUntil: 0, armedAt: 0,
      kills: 0, dmgDealt: 0,
      inResonance: resonanceZones.some((zz) => Math.hypot(w.x - zz.x, w.z - zz.z) < zz.r),
    };
    sim.towers.push(tw);
    sim.stats.built++;
    emit('build', { towerId: tw.id, type, cx, cy });
    return { ok: true, tower: tw };
  };

  sim.upgradeTower = (id) => {
    const tw = sim.towers.find((t) => t.id === id);
    if (!tw) return { ok: false, reason: 'no tower' };
    if (tw.level >= 2) return { ok: false, reason: 'max level' };
    const cost = upgradeCost(tw.type, tw.level);
    if (sim.gold < cost) return { ok: false, reason: 'not enough gold' };
    sim.gold -= cost;
    tw.level++;
    tw.invested += cost;
    sim.stats.upgrades++;
    if (tw.level === 2) sim.stats.maxed++;
    emit('upgrade', { towerId: tw.id, level: tw.level, type: tw.type });
    return { ok: true };
  };

  sim.sellTower = (id) => {
    const i = sim.towers.findIndex((t) => t.id === id);
    if (i < 0) return { ok: false, reason: 'no tower' };
    const tw = sim.towers[i];
    const refund = Math.floor(tw.invested * SELL_REFUND);
    sim.gold += refund;
    sim.towers.splice(i, 1);
    sim.stats.sold++;
    emit('sell', { towerId: tw.id, type: tw.type, refund, cx: tw.cx, cy: tw.cy });
    return { ok: true, refund };
  };

  sim.setTargetMode = (id, mode) => {
    const tw = sim.towers.find((t) => t.id === id);
    if (tw && TARGET_MODES.includes(mode)) { tw.mode = mode; return { ok: true }; }
    return { ok: false };
  };

  // ---------- waves ----------
  function enqueueWave(w) {
    for (const g of w.groups) {
      for (let i = 0; i < g.count; i++) {
        sim.spawnQueue.push({
          at: sim.time + g.delay + i * g.gap,
          type: g.type, roadIdx: (g.roadIdx || 0) % map.routes.length,
          hpMul: g.hpMul || 1, bountyMul: g.bountyMul || 1,
          eliteFlag: !!g.eliteFlag, empowered: !!g.empowered,
        });
      }
    }
    sim.spawnQueue.sort((a, b) => a.at - b.at);
  }

  sim.nextWavePreview = () => {
    if (sim.phase === 'won' || sim.phase === 'lost') return [];
    const nextIdx = sim.waveIdx + 1;
    if (endless) return wavePreview(endlessWave(wi, Math.max(0, nextIdx), map.routes.length));
    if (nextIdx >= level.waves.length) return [];
    return wavePreview(level.waves[nextIdx]);
  };

  sim.startWave = () => {
    if (sim.phase !== 'idle' && sim.phase !== 'prep') return { ok: false };
    sim.waveIdx++;
    const w = endless ? endlessWave(wi, sim.waveIdx, map.routes.length) : level.waves[sim.waveIdx];
    if (!w) return { ok: false };
    sim.phase = 'wave';
    sim.prepT = 0;
    sim.waveRepairUsed = 0;
    enqueueWave(w);
    emit('wave', { idx: sim.waveIdx, label: w.label, isBoss: w.isBoss });
    return { ok: true };
  };

  // ---------- enemies ----------
  function spawnEnemy(type, opts = {}) {
    const def = enemyDef(type);
    const e = {
      id: uid(), type, def,
      roadIdx: opts.roadIdx ?? 0,
      hp: def.hp * (opts.hpMul || 1), maxHp: def.hp * (opts.hpMul || 1),
      dist: opts.dist ?? 0,
      bounty: Math.max(1, Math.round(def.bounty * (opts.bountyMul || 1))),
      siegeDmg: def.siegeDmg, flying: !!def.flying,
      armor: def.armor || 0, warding: def.warding || 0,
      shieldHits: def.shield || 0,
      slowPct: 0, slowUntil: 0, stunUntil: 0,
      physImmuneUntil: 0, magicImmuneUntil: 0,
      selfHasteUntil: 0,
      boss: !!def.boss, elite: !!opts.eliteFlag, empowered: !!opts.empowered,
      abil: def.abilities ? Object.fromEntries(def.abilities.map((a) => [a, sim.time + abilityCd(a) * 0.6])) : null,
      hpMulOrigin: opts.hpMul || 1, bountyMulOrigin: opts.bountyMul || 1,
      alive: true,
      speedJitter: 0.93 + rng.next() * 0.14,
    };
    sim.enemies.push(e);
    emit('spawn', { enemyId: e.id, type, boss: e.boss, elite: e.elite, roadIdx: e.roadIdx });
    return e;
  }

  function abilityCd(a) {
    return {
      rallyCry: 11, shieldWall: 14, summonRams: 12, ironPlates: 15,
      summonRays: 11, windShield: 13, prismPhase: 8, summonSkitterers: 10,
      overdrive: 12, deployKegs: 13, platingShield: 15,
    }[a] || 10;
  }

  function runAbility(e, a) {
    const p = sim.enemyPos(e);
    const spawnKids = (type, n) => {
      for (let i = 0; i < n; i++) {
        spawnEnemy(type, {
          roadIdx: e.roadIdx, dist: Math.max(0, e.dist - 1 - i * 0.9),
          hpMul: e.hpMulOrigin * 0.5, bountyMul: e.bountyMulOrigin * 0.5,
        });
      }
      emit('ability', { name: a, enemyId: e.id, x: p.x, z: p.z });
    };
    switch (a) {
      case 'rallyCry':
        sim.hasteUntil = Math.max(sim.hasteUntil, sim.time + 3);
        emit('ability', { name: a, enemyId: e.id, x: p.x, z: p.z });
        break;
      case 'shieldWall': case 'ironPlates': case 'windShield': case 'platingShield': {
        const n = { shieldWall: 10, ironPlates: 12, windShield: 14, platingShield: 14 }[a];
        e.shieldHits = Math.min(n, e.shieldHits + n);
        emit('ability', { name: a, enemyId: e.id, x: p.x, z: p.z });
        break;
      }
      case 'summonRams': spawnKids('ram', 2); break;
      case 'summonRays': spawnKids('cloud_ray', 2); break;
      case 'summonSkitterers': spawnKids('skitterer', 3); break;
      case 'deployKegs': spawnKids('keg_runner', 2); break;
      case 'prismPhase': {
        // alternate immunity windows — the counter is mixed damage types
        if (e._phase !== 'magic') { e.physImmuneUntil = sim.time + 3; e._phase = 'magic'; }
        else { e.magicImmuneUntil = sim.time + 3; e._phase = 'phys'; }
        emit('ability', { name: a, enemyId: e.id, x: p.x, z: p.z, phase: e._phase });
        break;
      }
      case 'overdrive':
        e.selfHasteUntil = sim.time + 2.5;
        emit('ability', { name: a, enemyId: e.id, x: p.x, z: p.z });
        break;
    }
  }

  // ---------- damage ----------
  function applyDamage(e, raw, dmgType, src = {}) {
    if (!e.alive) return 0;
    if (dmgType === 'phys' && sim.time < e.physImmuneUntil) { emit('immune', { enemyId: e.id }); return 0; }
    if (dmgType !== 'phys' && sim.time < e.magicImmuneUntil) { emit('immune', { enemyId: e.id }); return 0; }
    if (e.shieldHits > 0 && src.dot !== true) {
      e.shieldHits = Math.max(0, e.shieldHits - (src.shieldMul || 1));
      emit('shieldHit', { enemyId: e.id, left: e.shieldHits });
      if (e.shieldHits === 0) emit('shieldBreak', { enemyId: e.id });
      return 0;
    }
    let resist = 0;
    if (dmgType === 'phys') resist = e.armor * (1 - (src.pierce || 0));
    else if (dmgType === 'magic') resist = e.warding;
    else if (dmgType === 'fire' || dmgType === 'nature') resist = e.warding * 0.5;
    else if (dmgType === 'holy') resist = e.warding * 0.5;
    let dmg = raw * (1 - resist);
    if (src.armorBonus && e.armor > 0) dmg *= src.armorBonus;
    e.hp -= dmg;
    if (src.towerId) {
      const tw = sim.towers.find((t) => t.id === src.towerId);
      if (tw) tw.dmgDealt += dmg;
    }
    if (src.event !== false) emit('hit', { enemyId: e.id, amount: dmg, dmgType, crit: !!src.crit });
    if (e.hp <= 0) killEnemy(e, src);
    return dmg;
  }
  sim.applyDamage = applyDamage;

  function killEnemy(e, src = {}) {
    if (!e.alive) return;
    e.alive = false;
    sim.gold += e.bounty;
    sim.stats.goldEarned += e.bounty;
    sim.stats.kills++;
    if (src.towerId) {
      const tw = sim.towers.find((t) => t.id === src.towerId);
      if (tw) tw.kills++;
    }
    const p = sim.enemyPos(e);
    emit('death', { enemyId: e.id, type: e.type, x: p.x, z: p.z, bounty: e.bounty, boss: e.boss, big: e.maxHp >= 300 });
    // splitters birth their children where they fell
    const d = e.def;
    if ((d.traits || []).includes('splitter') && d.splitInto) {
      for (let i = 0; i < d.splitInto.count; i++) {
        spawnEnemy(d.splitInto.type, {
          roadIdx: e.roadIdx, dist: Math.max(0, e.dist - 0.4 - i * 0.5),
          hpMul: e.hpMulOrigin, bountyMul: e.bountyMulOrigin * 0.6,
        });
      }
      emit('split', { x: p.x, z: p.z, type: d.splitInto.type });
    }
  }

  // ---------- targeting ----------
  function acquire(tw, opts = {}) {
    const r = effRange(tw);
    const r2 = r * r;
    let best = null, bestKey = -Infinity;
    for (const e of sim.enemies) {
      if (!e.alive) continue;
      if (e.flying && !tw.def.canFlying) continue;
      if (opts.exclude && opts.exclude.has(e.id)) continue;
      const p = sim.enemyPos(e);
      const dx = p.x - tw.x, dz = p.z - tw.z;
      if (dx * dx + dz * dz > r2) continue;
      let key;
      switch (tw.mode) {
        case 'last': key = e.dist / map.routes[e.roadIdx].total * -1; break;
        case 'strong': key = e.hp; break;
        case 'close': key = -(dx * dx + dz * dz); break;
        default: key = e.dist / map.routes[e.roadIdx].total; // FIRST = closest to the Bastion
      }
      if (key > bestKey) { best = e; bestKey = key; }
    }
    return best;
  }

  function effRange(tw) { return tw.def.range[tw.level]; }
  function effRate(tw) {
    let m = 1;
    if (tw.inResonance && hazard?.rateBonus) m += hazard.rateBonus;
    return tw.def.rate[tw.level] * m;
  }
  function effDmg(tw) { return tw.def.dmg[tw.level]; }
  sim.effRange = effRange; sim.effRate = effRate; sim.effDmg = effDmg;

  // ---------- firing ----------
  function fireTower(tw) {
    const kind = tw.def.kind;
    const lvl = tw.level;
    const target = acquire(tw);
    if (!target) return false;
    const tp = sim.enemyPos(target);
    const dmg = effDmg(tw);

    switch (kind) {
      case 'pierce': {
        // bolt flies through the target direction, hitting up to N enemies in the corridor
        const dirx = tp.x - tw.x, dirz = tp.z - tw.z;
        const len = Math.hypot(dirx, dirz) || 1;
        const nx = dirx / len, nz = dirz / len;
        const maxHits = tw.def.pierce[lvl];
        const reach = effRange(tw) + 2;
        const victims = [];
        for (const e of sim.enemies) {
          if (!e.alive) continue;
          if (e.flying && !tw.def.canFlying) continue;
          const p = sim.enemyPos(e);
          const rel = (p.x - tw.x) * nx + (p.z - tw.z) * nz;   // along-ray distance
          if (rel < 0.5 || rel > reach) continue;
          const perp = Math.abs((p.x - tw.x) * nz - (p.z - tw.z) * nx);
          if (perp < 0.85) victims.push({ e, rel });
        }
        victims.sort((a, b) => a.rel - b.rel);
        const hit = victims.slice(0, maxHits);
        for (const { e } of hit) {
          applyDamage(e, dmg, 'phys', { towerId: tw.id });
          sim.stats.pierceHits++;
        }
        const endD = hit.length ? Math.min(reach, hit[hit.length - 1].rel + 1.4) : Math.min(reach, len + 1);
        emit('pierce', { towerId: tw.id, x: tw.x, z: tw.z, nx, nz, dist: endD, hits: hit.length });
        break;
      }
      case 'homing': {
        const n = tw.def.volley[lvl];
        const excluded = new Set();
        for (let i = 0; i < n; i++) {
          const t2 = i === 0 ? target : (acquire(tw, { exclude: excluded }) || target);
          excluded.add(t2.id);
          const p2 = sim.enemyPos(t2);
          const flight = Math.max(0.3, Math.hypot(p2.x - tw.x, p2.z - tw.z) / 14) + i * 0.08;
          sim.projectiles.push({
            id: uid(), kind: 'missile', x: tw.x, z: tw.z, y: 2.2,
            targetId: t2.id, t: 0, flight, dmg, towerId: tw.id, curve: (i % 2 ? 1 : -1) * (0.6 + i * 0.3),
          });
        }
        emit('shot', { towerId: tw.id, type: tw.type, x: tw.x, z: tw.z, tx: tp.x, tz: tp.z });
        break;
      }
      case 'zone': {
        const lead = Math.hypot(tp.x - tw.x, tp.z - tw.z) / tw.def.projSpeed;
        const fut = posAlong(map.routes[target.roadIdx], target.dist + target.def.speed * lead * 0.7);
        sim.projectiles.push({
          id: uid(), kind: 'oilpot', x: tw.x, z: tw.z, y: 1.6,
          aim: { x: fut.x, z: fut.z }, arc: true, t: 0, flight: Math.max(0.45, lead),
          dmg, towerId: tw.id,
          zone: { r: tw.def.zoneR[lvl], dps: tw.def.zoneDps[lvl], dur: tw.def.zoneDur[lvl], slow: tw.def.zoneSlow },
        });
        emit('shot', { towerId: tw.id, type: tw.type, x: tw.x, z: tw.z, tx: fut.x, tz: fut.z, arc: true });
        break;
      }
      case 'snipe': {
        applyDamage(target, dmg, 'phys', { towerId: tw.id, armorBonus: target.armor > 0 ? tw.def.armorBonus[lvl] : 1, crit: target.armor > 0 });
        emit('snipe', { towerId: tw.id, x: tw.x, z: tw.z, tx: tp.x, tz: tp.z, crit: target.armor > 0 });
        break;
      }
      case 'chain': {
        const points = [{ x: tw.x, z: tw.z }];
        let cur = target, curDmg = dmg;
        const hitSet = new Set();
        for (let c = 0; c < tw.def.chains[lvl] && cur; c++) {
          const cp = sim.enemyPos(cur);
          points.push({ x: cp.x, z: cp.z });
          hitSet.add(cur.id);
          applyDamage(cur, curDmg, 'magic', { towerId: tw.id });
          sim.stats.chainHits++;
          if (cur.alive) {
            const stun = tw.def.stun[lvl] * (cur.boss ? 0.25 : 1);
            cur.stunUntil = Math.max(cur.stunUntil, sim.time + stun);
          }
          let nxt = null, nd = tw.def.chainRadius ** 2;
          for (const e of sim.enemies) {
            if (!e.alive || hitSet.has(e.id)) continue;
            const ep = sim.enemyPos(e);
            const d2 = (ep.x - cp.x) ** 2 + (ep.z - cp.z) ** 2;
            if (d2 < nd) { nd = d2; nxt = e; }
          }
          cur = nxt; curDmg *= tw.def.falloff;
        }
        emit('chain', { towerId: tw.id, points });
        break;
      }
    }
    return true;
  }

  // ---------- projectiles / zones / carts ----------
  function stepProjectiles(dt) {
    for (const pr of sim.projectiles) {
      if (pr.done) continue;
      pr.t += dt;
      if (pr.t < pr.flight) continue;
      pr.done = true;
      if (pr.kind === 'missile') {
        const target = sim.enemies.find((e) => e.id === pr.targetId && e.alive);
        if (target) {
          applyDamage(target, pr.dmg, 'magic', { towerId: pr.towerId });
          const p = sim.enemyPos(target);
          emit('missileHit', { x: p.x, z: p.z });
        }
      } else if (pr.kind === 'oilpot') {
        sim.zones.push({
          id: uid(), x: pr.aim.x, z: pr.aim.z,
          r: pr.zone.r, dps: pr.zone.dps, slow: pr.zone.slow,
          until: sim.time + pr.zone.dur, towerId: pr.towerId,
        });
        // impact splash
        for (const e of sim.enemies) {
          if (!e.alive || e.flying) continue;
          const p = sim.enemyPos(e);
          if (Math.hypot(p.x - pr.aim.x, p.z - pr.aim.z) <= pr.zone.r) {
            applyDamage(e, pr.dmg, 'fire', { towerId: pr.towerId });
          }
        }
        emit('oilSplash', { x: pr.aim.x, z: pr.aim.z, r: pr.zone.r });
      }
    }
    if (sim.projectiles.length > 50 || sim.projectiles.some((p) => p.done)) {
      sim.projectiles = sim.projectiles.filter((p) => !p.done);
    }
    // burning zones tick
    let zoneDirty = false;
    for (const z of sim.zones) {
      if (sim.time > z.until) { z.dead = true; zoneDirty = true; continue; }
      for (const e of sim.enemies) {
        if (!e.alive || e.flying) continue;
        const p = sim.enemyPos(e);
        if (Math.hypot(p.x - z.x, p.z - z.z) <= z.r) {
          applyDamage(e, z.dps * dt, 'fire', { towerId: z.towerId, event: false, dot: true });
          sim.stats.zonesBurned += dt;
          if (e.alive && z.slow > e.slowPct) { e.slowPct = z.slow; e.slowUntil = sim.time + 0.3; }
        }
      }
    }
    if (zoneDirty) sim.zones = sim.zones.filter((z) => !z.dead);
    // mine carts sweep their road
    for (const c of sim.carts) {
      c.dist += 12 * dt;
      const route = map.routes[c.roadIdx];
      if (c.dist >= route.total - 3) { c.done = true; continue; }
      const cp = posAlong(route, c.dist);
      for (const e of sim.enemies) {
        if (!e.alive || e.flying || e.roadIdx !== c.roadIdx || c.hit.has(e.id)) continue;
        const p = sim.enemyPos(e);
        if (Math.hypot(p.x - cp.x, p.z - cp.z) < 1.2) {
          c.hit.add(e.id);
          applyDamage(e, c.dmg, 'phys', {});
        }
      }
    }
    if (sim.carts.some((c) => c.done)) sim.carts = sim.carts.filter((c) => !c.done);
  }

  // ---------- road placeables + auras ----------
  function stepPassives(dt) {
    for (const tw of sim.towers) {
      if (sim.time < tw.disabledUntil) continue;
      const lvl = tw.level;
      if (tw.def.kind === 'roadThorn') {
        const rr = 1.5;
        for (const e of sim.enemies) {
          if (!e.alive || e.flying) continue;
          const p = sim.enemyPos(e);
          if (Math.hypot(p.x - tw.x, p.z - tw.z) <= rr) {
            applyDamage(e, tw.def.thornDps[lvl] * dt, 'nature', { towerId: tw.id, event: false, dot: true });
            if (e.alive) {
              const s = tw.def.slowPct[lvl];
              if (s >= e.slowPct) { e.slowPct = s * (e.boss ? 0.5 : 1); e.slowUntil = sim.time + 0.25; }
            }
          }
        }
      } else if (tw.def.kind === 'roadRune') {
        if (sim.time < tw.armedAt) continue;
        let trigger = null;
        for (const e of sim.enemies) {
          if (!e.alive || e.flying) continue;
          const p = sim.enemyPos(e);
          if (Math.hypot(p.x - tw.x, p.z - tw.z) <= tw.def.range[lvl] * 0.55) { trigger = e; break; }
        }
        if (trigger) {
          const r = tw.def.range[lvl];
          for (const e of sim.enemies) {
            if (!e.alive || e.flying) continue;
            const p = sim.enemyPos(e);
            if (Math.hypot(p.x - tw.x, p.z - tw.z) <= r) {
              applyDamage(e, tw.def.dmg[lvl], 'magic', { towerId: tw.id });
            }
          }
          tw.armedAt = sim.time + tw.def.rearm[lvl];
          sim.stats.runeBlasts++;
          emit('runeBlast', { towerId: tw.id, x: tw.x, z: tw.z, r });
        }
      } else if (tw.def.kind === 'aura') {
        const r = tw.def.range[lvl];
        for (const e of sim.enemies) {
          if (!e.alive) continue;
          const p = sim.enemyPos(e);
          if (Math.hypot(p.x - tw.x, p.z - tw.z) <= r) {
            applyDamage(e, tw.def.auraDps[lvl] * dt, 'holy', { towerId: tw.id, event: false, dot: true });
          }
        }
        // repair the Bastion if the beacon stands near the plaza — capped per wave
        // so stacked beacons can never out-heal a failing defense
        const nearPlaza = Math.hypot(tw.x, tw.z) < 8;
        if (nearPlaza && sim.phase === 'wave' && sim.waveRepairUsed < sim.waveRepairCap) {
          const amt = Math.min(tw.def.repair[lvl] * dt, sim.waveRepairCap - sim.waveRepairUsed);
          repairBastion(amt);
          sim.waveRepairUsed += amt;
        }
      }
    }
  }

  // ---------- enemy update ----------
  function stepEnemies(dt) {
    const globalHaste = sim.time < sim.hasteUntil ? 1 + (hazard?.haste ?? 0.45) : 1;
    for (const e of sim.enemies) {
      if (!e.alive) continue;
      if (sim.time > e.slowUntil) e.slowPct = 0;
      const stunned = sim.time < e.stunUntil;
      if (!stunned) {
        let spd = e.def.speed * e.speedJitter * (1 - e.slowPct) * globalHaste;
        if (sim.time < e.selfHasteUntil) spd *= 1.8;
        if (hazard?.id === 'resonance') {
          const p = sim.enemyPos(e);
          for (const z of resonanceZones) {
            if (Math.hypot(p.x - z.x, p.z - z.z) < z.r) { spd *= 1 + hazard.hasteBonus; break; }
          }
        }
        e.dist += spd * dt;
      }
      if (e.abil) {
        for (const [a, readyAt] of Object.entries(e.abil)) {
          if (sim.time >= readyAt) { runAbility(e, a); e.abil[a] = sim.time + abilityCd(a); }
        }
      }
      // breach!
      if (e.dist >= map.routes[e.roadIdx].total - 0.4) {
        e.alive = false;
        sim.stats.breaches++;
        const dmg = e.siegeDmg;
        emit('breach', { enemyId: e.id, type: e.type, dmg, boss: e.boss, detonator: (e.def.traits || []).includes('detonator') });
        damageBastion(dmg, e.type);
      }
    }
    if (sim.enemies.some((e) => !e.alive)) sim.enemies = sim.enemies.filter((e) => e.alive);
  }

  // ---------- hazards ----------
  function stepHazards() {
    if (!hazard || !sim.hazardState) return;
    if (sim.phase !== 'wave') return;
    const hs = sim.hazardState;
    if (sim.time < hs.nextAt) return;
    hs.nextAt = sim.time + hazard.interval?.[0] + rng.next() * ((hazard.interval?.[1] || 20) - (hazard.interval?.[0] || 14));
    switch (hazard.id) {
      case 'gateRelease': {
        const road = rng.int(0, map.routes.length - 1);
        const pool = worldPoolSafe();
        const n = 3 + rng.int(0, 2);
        for (let i = 0; i < n; i++) {
          sim.spawnQueue.push({
            at: sim.time + i * 0.8, type: pool[rng.int(0, pool.length - 1)],
            roadIdx: road, hpMul: hpNow(), bountyMul: 0.7,
          });
        }
        sim.spawnQueue.sort((a, b) => a.at - b.at);
        emit('hazard', { id: 'gateRelease', roadIdx: road });
        break;
      }
      case 'lightning': {
        const cands = sim.towers.filter((t) => t.def.placement === 'ground');
        if (cands.length) {
          const tw = cands[Math.floor(rng.next() * cands.length)];
          tw.disabledUntil = sim.time + hazard.stun;
          emit('hazard', { id: 'lightning', towerId: tw.id, x: tw.x, z: tw.z });
        }
        break;
      }
      case 'tailwind':
        sim.hasteUntil = Math.max(sim.hasteUntil, sim.time + (hazard.duration || 4));
        emit('hazard', { id: 'tailwind' });
        break;
      case 'minecarts': {
        const road = rng.int(0, map.routes.length - 1);
        sim.carts.push({ id: uid(), roadIdx: road, dist: 0, dmg: hazard.dmg, hit: new Set() });
        emit('hazard', { id: 'minecarts', roadIdx: road });
        break;
      }
    }
  }
  function worldPoolSafe() {
    return level.world.pool.filter((id) => !enemyDef(id).flying);
  }
  function hpNow() {
    return (1 + li * 0.1 + wi * 0.07) * (1 + Math.max(0, sim.waveIdx) * 0.03);
  }

  // ---------- main step ----------
  sim.step = (dt) => {
    if (sim.phase === 'won' || sim.phase === 'lost') return;
    sim.time += dt;
    while (sim.spawnQueue.length && sim.spawnQueue[0].at <= sim.time) {
      const s = sim.spawnQueue.shift();
      spawnEnemy(s.type, s);
    }
    stepEnemies(dt);
    if (sim.phase === 'lost') return;

    for (const tw of sim.towers) {
      const k = tw.def.kind;
      if (k === 'roadThorn' || k === 'roadRune' || k === 'aura') continue;
      if (sim.time < tw.disabledUntil) continue;
      tw.cooldown -= dt;
      if (tw.cooldown <= 0) {
        if (fireTower(tw)) tw.cooldown = 1 / effRate(tw);
        else tw.cooldown = 0.08;
      }
    }
    stepPassives(dt);
    stepProjectiles(dt);
    stepHazards();

    if (sim.phase === 'wave' && !sim.spawnQueue.length && sim.enemies.length === 0) {
      const wv = sim.waveIdx;
      const bonus = Math.round((42 + wv * 6) * (1 + wi * 0.5 + li * 0.07));
      sim.gold += bonus;
      sim.stats.goldEarned += bonus;
      sim.stats.wavesCleared++;
      emit('waveEnd', { idx: wv, bonus });
      if (!endless && wv >= level.waves.length - 1) {
        sim.phase = 'won';
        emit('win', { stars: sim.stars() });
      } else {
        sim.phase = 'prep';
        sim.prepT = level.prepTime;
      }
    } else if (sim.phase === 'prep') {
      sim.prepT -= dt;
      if (sim.prepT <= 0) sim.startWave();
    }
  };

  sim.stars = () => {
    const f = sim.bastionHp / sim.bastionMax;
    return f >= 0.9 ? 3 : f >= 0.5 ? 2 : sim.bastionHp > 0 ? 1 : 0;
  };

  sim.fastForward = (seconds) => {
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i++) {
      sim.step(DT);
      if (sim.phase === 'won' || sim.phase === 'lost') break;
    }
  };

  return sim;
}

export { DT };
