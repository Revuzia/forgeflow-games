// Bastion Realms — core gameplay simulation.
// Pure + deterministic: no DOM, no three.js, no Math.random (seeded rng only).
// The view/audio layers consume sim.drainEvents(); tests step it synchronously.
import { makeRng } from './rng.js';
import { GRID_W, GRID_H, cellToWorld, posAlong } from './path.js';
import { enemyDef } from '../data/enemies.js';
import { towerDef, upgradeCost, totalInvested, SELL_REFUND } from '../data/towers.js';
import { levelDef } from '../data/levels.js';
import { endlessWave, wavePreview } from './waves.js';

const DT = 1 / 30; // canonical tick
export const TARGET_MODES = ['first', 'last', 'strong', 'close'];

let nextId = 1;
function uid() { return nextId++; }

export function createSim(bi, li, { endless = false } = {}) {
  const level = levelDef(bi, li);
  const rng = makeRng(level.seed ^ 0xabcdef);
  const pathSet = new Set(level.cells.map(([x, y]) => x + ',' + y));
  const blockedSet = new Set(level.blocked.map(([x, y]) => x + ',' + y));

  // hazard precompute
  const hazard = level.hazard ? { ...level.hazard } : null;
  let ventCells = [], fogZones = [];
  if (hazard?.id === 'lavaVent') {
    // vent cells: buildable cells adjacent to the path at 25/50/75% marks
    const marks = [0.25, 0.5, 0.75];
    const seen = new Set();
    for (const m of marks) {
      const [cx, cy] = level.cells[Math.floor(level.cells.length * m)];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = (cx + dx) + ',' + (cy + dy);
        if (cx + dx < 0 || cy + dy < 0 || cx + dx >= GRID_W || cy + dy >= GRID_H) continue;
        if (!pathSet.has(k) && !blockedSet.has(k) && !seen.has(k)) {
          seen.add(k); ventCells.push([cx + dx, cy + dy]); break;
        }
      }
    }
  }
  if (hazard?.id === 'fogbank') {
    for (let i = 0; i < (hazard.zones || 2); i++) {
      const frac = 0.3 + i * 0.35;
      const p = posAlong(level.route, level.route.total * frac);
      fogZones.push({ x: p.x, z: p.z, r: hazard.radius });
    }
  }

  const sim = {
    bi, li, level, endless,
    time: 0,
    phase: 'idle',            // idle | prep | wave | won | lost
    waveIdx: -1,
    waveTotal: endless ? Infinity : level.waves.length,
    prepT: 0,
    gold: level.startGold,
    lives: level.lives,
    enemies: [], towers: [], projectiles: [], spawnQueue: [],
    events: [],
    ventCells, fogZones,
    ventState: ventCells.length ? { nextAt: 10 + rng.range(0, 5), warnAt: 0, warning: false } : null,
    blizzardUntil: 0, bossBlizzardUntil: 0, gustUntil: 0,
    surge: hazard?.id === 'manaSurge' ? { nextAt: 12 + rng.range(0, 6), towerId: 0, until: 0 } : null,
    hazardBlizz: hazard?.id === 'blizzard' ? { nextAt: 16 + rng.range(0, 8), until: 0, warnAt: 0 } : null,
    stats: {
      kills: 0, leaks: 0, built: 0, sold: 0, upgrades: 0, maxed: 0,
      goldEarned: 0, burnsApplied: 0, freezeProcs: 0, chainHits: 0, poisonTicks: 0,
      dmgByType: {}, wavesCleared: 0,
    },
    rng,
  };

  // ---------- events ----------
  function emit(kind, data) {
    sim.events.push({ kind, t: sim.time, ...data });
    if (sim.events.length > 900) sim.events.splice(0, sim.events.length - 600);
  }
  sim.drainEvents = () => { const e = sim.events; sim.events = []; return e; };

  // ---------- helpers ----------
  sim.enemyPos = (e) => {
    const p = posAlong(level.route, e.dist);
    return p;
  };

  function towersRateMul(tw) {
    let m = 1;
    const blizzUntil = Math.max(sim.blizzardUntil, sim.bossBlizzardUntil);
    if (sim.time < blizzUntil) m *= (1 - (hazard?.ratePenalty ?? 0.25));
    if (sim.surge && tw.id === sim.surge.towerId && sim.time < sim.surge.until) m *= 1.5;
    return m;
  }

  function effRange(tw) {
    let r = tw.def.range[tw.level] * (1 + (tw.buffs?.range || 0));
    if (fogZones.length) {
      for (const z of fogZones) {
        const d = Math.hypot(tw.x - z.x, tw.z - z.z);
        if (d < z.r) { r *= (1 - hazard.rangePenalty); break; }
      }
    }
    return r;
  }
  sim.effRange = effRange;

  function effRate(tw) {
    return tw.def.rate[tw.level] * (1 + (tw.buffs?.rate || 0)) * towersRateMul(tw);
  }
  function effDmg(tw) {
    return tw.def.dmg[tw.level] * (1 + (tw.buffs?.dmg || 0));
  }
  sim.effRate = effRate; sim.effDmg = effDmg;

  function recomputeBuffs() {
    const banners = sim.towers.filter((t) => t.type === 'banner');
    for (const tw of sim.towers) {
      if (tw.type === 'banner') { tw.buffs = null; continue; }
      let best = null, bestScore = -1;
      for (const b of banners) {
        const d = Math.hypot(tw.x - b.x, tw.z - b.z);
        if (d <= b.def.range[b.level]) {
          const score = b.def.buffDmg[b.level] + b.def.buffRate[b.level];
          if (score > bestScore) { bestScore = score; best = b; }
        }
      }
      tw.buffs = best ? {
        rate: best.def.buffRate[best.level],
        dmg: best.def.buffDmg[best.level],
        range: best.def.buffRange[best.level],
        from: best.id,
      } : null;
    }
  }

  // ---------- build / upgrade / sell ----------
  sim.canBuild = (cx, cy) => {
    if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) return { ok: false, reason: 'out of bounds' };
    const k = cx + ',' + cy;
    if (pathSet.has(k)) return { ok: false, reason: 'on the path' };
    if (blockedSet.has(k)) return { ok: false, reason: 'blocked terrain' };
    if (sim.towers.some((t) => t.cx === cx && t.cy === cy)) return { ok: false, reason: 'occupied' };
    return { ok: true };
  };

  sim.placeTower = (type, cx, cy) => {
    const def = towerDef(type);
    const chk = sim.canBuild(cx, cy);
    if (!chk.ok) return chk;
    if (sim.gold < def.cost) return { ok: false, reason: 'not enough gold' };
    sim.gold -= def.cost;
    const w = cellToWorld(cx, cy);
    const tw = {
      id: uid(), type, def, cx, cy, x: w.x, z: w.z,
      level: 0, cooldown: 0.35, mode: 'first',
      invested: def.cost, buffs: null, disabledUntil: 0,
      kills: 0, dmgDealt: 0, shots2: 0,
    };
    sim.towers.push(tw);
    sim.stats.built++;
    recomputeBuffs();
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
    recomputeBuffs();
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
    recomputeBuffs();
    emit('sell', { towerId: tw.id, type: tw.type, refund, cx: tw.cx, cy: tw.cy });
    return { ok: true, refund };
  };

  sim.setTargetMode = (id, mode) => {
    const tw = sim.towers.find((t) => t.id === id);
    if (tw && TARGET_MODES.includes(mode)) { tw.mode = mode; return { ok: true }; }
    return { ok: false };
  };

  // ---------- waves ----------
  function currentWave() {
    if (endless) return sim._endlessWave;
    return level.waves[sim.waveIdx];
  }

  function enqueueWave(w) {
    for (const g of w.groups) {
      for (let i = 0; i < g.count; i++) {
        sim.spawnQueue.push({
          at: sim.time + g.delay + i * g.gap,
          type: g.type, hpMul: g.hpMul || 1, bountyMul: g.bountyMul || 1,
          eliteFlag: !!g.eliteFlag, empowered: !!g.empowered,
        });
      }
    }
    sim.spawnQueue.sort((a, b) => a.at - b.at);
  }

  sim.nextWavePreview = () => {
    if (sim.phase === 'won' || sim.phase === 'lost') return [];
    const nextIdx = sim.waveIdx + (sim.phase === 'wave' ? 1 : 1);
    if (endless) return wavePreview(endlessWave(bi, Math.max(0, nextIdx)));
    if (nextIdx >= level.waves.length) return [];
    return wavePreview(level.waves[nextIdx]);
  };

  sim.startWave = () => {
    if (sim.phase !== 'idle' && sim.phase !== 'prep') return { ok: false };
    let bonus = 0;
    if (sim.phase === 'prep' && sim.prepT > 0.5) {
      bonus = Math.floor(sim.prepT * 2);
      sim.gold += bonus;
      sim.stats.goldEarned += bonus;
    }
    sim.waveIdx++;
    const w = endless ? (sim._endlessWave = endlessWave(bi, sim.waveIdx)) : level.waves[sim.waveIdx];
    if (!w) return { ok: false };
    sim.phase = 'wave';
    sim.prepT = 0;
    enqueueWave(w);
    emit('wave', { idx: sim.waveIdx, label: w.label, isBoss: w.isBoss, bonus });
    return { ok: true, bonus };
  };

  // ---------- enemies ----------
  function spawnEnemy(type, opts = {}) {
    const def = enemyDef(type);
    const e = {
      id: uid(), type, def,
      hp: def.hp * (opts.hpMul || 1), maxHp: def.hp * (opts.hpMul || 1),
      dist: opts.dist ?? 0,
      bounty: Math.max(1, Math.round(def.bounty * (opts.bountyMul || 1))),
      leak: def.leak, flying: !!def.flying, float: !!def.float,
      armor: def.armor || 0, warding: def.warding || 0,
      shieldHits: def.shield || 0,
      regen: def.regen || 0,
      slowPct: 0, slowUntil: 0, freezeUntil: 0, stunUntil: 0, freezeCdUntil: 0,
      burn: null, poisons: [],
      etherealUntil: 0,
      boss: !!def.boss, elite: !!opts.eliteFlag, empowered: !!opts.empowered,
      abil: def.abilities ? Object.fromEntries(def.abilities.map((a) => [a, sim.time + abilityCd(a) * 0.6])) : null,
      alive: true, summoned: !!opts.summoned,
      speedJitter: 0.92 + rng.next() * 0.16,
    };
    if (opts.empowered) { e.hp *= 1; }
    sim.enemies.push(e);
    emit('spawn', { enemyId: e.id, type, boss: e.boss, elite: e.elite });
    return e;
  }

  function abilityCd(a) {
    return {
      sporeHeal: 5, summonMushnubs: 12, wingGust: 11, emberRain: 9,
      iceShield: 15, blizzard: 14, summonSkeletons: 10, etherealPhase: 12,
      bonewall: 8, starShield: 13, riftHop: 9, summonGlubs: 11,
    }[a] || 10;
  }

  function runAbility(e, a) {
    const p = sim.enemyPos(e);
    switch (a) {
      case 'sporeHeal': {
        let healed = 0;
        for (const o of sim.enemies) {
          if (!o.alive || o === e) continue;
          const op = sim.enemyPos(o);
          if (Math.hypot(op.x - p.x, op.z - p.z) < 5) {
            o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.04); healed++;
          }
        }
        if (healed) emit('ability', { name: a, enemyId: e.id, x: p.x, z: p.z });
        break;
      }
      case 'summonMushnubs':
        for (let i = 0; i < 3; i++) spawnEnemy('mushnub', { dist: Math.max(0, e.dist - 1 - i * 0.8), hpMul: e.maxHp / enemyDef(e.type).hp * 0.12, bountyMul: 0.5, summoned: true });
        emit('ability', { name: a, enemyId: e.id, x: p.x, z: p.z });
        break;
      case 'summonSkeletons':
        for (let i = 0; i < 4; i++) spawnEnemy('skeleton', { dist: Math.max(0, e.dist - 1 - i * 0.8), hpMul: e.maxHp / enemyDef(e.type).hp * 0.06, bountyMul: 0.5, summoned: true });
        emit('ability', { name: a, enemyId: e.id, x: p.x, z: p.z });
        break;
      case 'summonGlubs':
        for (let i = 0; i < 2; i++) spawnEnemy('glub', { dist: Math.max(0, e.dist - 1.5 - i), hpMul: e.maxHp / enemyDef(e.type).hp * 0.05, bountyMul: 0.5, summoned: true });
        emit('ability', { name: a, enemyId: e.id, x: p.x, z: p.z });
        break;
      case 'wingGust':
        sim.gustUntil = sim.time + 3;
        emit('ability', { name: a, enemyId: e.id, x: p.x, z: p.z });
        break;
      case 'emberRain': {
        const targets = sim.towers.filter((t) => t.type !== 'banner');
        if (targets.length) {
          const tw = targets[Math.floor(rng.next() * targets.length)];
          tw.disabledUntil = sim.time + 2.5;
          emit('ability', { name: a, enemyId: e.id, towerId: tw.id, x: tw.x, z: tw.z });
        }
        break;
      }
      case 'iceShield': case 'starShield': {
        const n = a === 'iceShield' ? 12 : 15;
        e.shieldHits = Math.min(n, e.shieldHits + n);
        emit('ability', { name: a, enemyId: e.id, x: p.x, z: p.z });
        break;
      }
      case 'blizzard':
        sim.bossBlizzardUntil = sim.time + 6;
        emit('ability', { name: a, enemyId: e.id, x: p.x, z: p.z });
        break;
      case 'etherealPhase':
        e.etherealUntil = sim.time + 3;
        emit('ability', { name: a, enemyId: e.id, x: p.x, z: p.z });
        break;
      case 'bonewall': {
        let n = 0;
        for (const o of sim.enemies) {
          if (!o.alive || o === e || o.boss) continue;
          const op = sim.enemyPos(o);
          if (Math.hypot(op.x - p.x, op.z - p.z) < 4 && o.shieldHits < 3) { o.shieldHits = 3; n++; }
          if (n >= 3) break;
        }
        if (n) emit('ability', { name: a, enemyId: e.id, x: p.x, z: p.z });
        break;
      }
      case 'riftHop':
        e.dist = Math.min(level.route.total - 2, e.dist + 5);
        emit('ability', { name: a, enemyId: e.id, x: p.x, z: p.z });
        break;
    }
  }

  // ---------- damage ----------
  function applyDamage(e, raw, dmgType, src = {}) {
    if (!e.alive) return 0;
    // shields: absorb whole hits
    if (e.shieldHits > 0 && dmgType !== 'dot') {
      const hits = src.shieldMul || 1;
      e.shieldHits = Math.max(0, e.shieldHits - hits);
      emit('shieldHit', { enemyId: e.id, left: e.shieldHits });
      if (e.shieldHits === 0) emit('shieldBreak', { enemyId: e.id });
      return 0;
    }
    let resist = 0;
    if (dmgType === 'phys') {
      resist = e.armor * (1 - (src.pierce || 0));
      if (sim.time < e.etherealUntil) resist = Math.max(resist, 0.9);
    } else if (dmgType === 'magic') {
      resist = e.warding;
    }
    const dmg = raw * (1 - resist);
    e.hp -= dmg;
    if (src.towerId) {
      const tw = sim.towers.find((t) => t.id === src.towerId);
      if (tw) tw.dmgDealt += dmg;
    }
    sim.stats.dmgByType[dmgType] = (sim.stats.dmgByType[dmgType] || 0) + dmg;
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
    emit('death', { enemyId: e.id, type: e.type, x: p.x, z: p.z, bounty: e.bounty, boss: e.boss });
    // Venom L3 death burst: dying poisoned enemy releases a cloud
    if (e.poisons.length && sim._venomBurst > 0) {
      for (const o of sim.enemies) {
        if (!o.alive || o.flying) continue;
        const op = sim.enemyPos(o);
        if (Math.hypot(op.x - p.x, op.z - p.z) < sim._venomBurst) {
          addPoison(o, sim._venomBurstDps, 3, null);
        }
      }
      emit('poisonBurst', { x: p.x, z: p.z, r: sim._venomBurst });
    }
  }

  function addPoison(e, dps, dur, towerId) {
    const max = 3;
    if (e.poisons.length >= max) {
      // refresh the oldest
      let oldest = e.poisons[0];
      for (const s of e.poisons) if (s.until < oldest.until) oldest = s;
      oldest.dps = Math.max(oldest.dps, dps);
      oldest.until = sim.time + dur;
    } else {
      e.poisons.push({ dps, until: sim.time + dur, towerId });
    }
  }

  // ---------- targeting ----------
  function inRange(tw, e, r2) {
    const p = sim.enemyPos(e);
    const dx = p.x - tw.x, dz = p.z - tw.z;
    return dx * dx + dz * dz <= r2;
  }
  function acquire(tw) {
    const r = effRange(tw);
    const r2 = r * r;
    let best = null, bestKey = 0;
    for (const e of sim.enemies) {
      if (!e.alive) continue;
      if (e.flying && !tw.def.canFlying) continue;
      if (!inRange(tw, e, r2)) continue;
      let key;
      switch (tw.mode) {
        case 'last': key = -e.dist; break;
        case 'strong': key = e.hp; break;
        case 'close': {
          const p = sim.enemyPos(e);
          key = -((p.x - tw.x) ** 2 + (p.z - tw.z) ** 2); break;
        }
        default: key = e.dist;
      }
      if (best === null || key > bestKey || (key === bestKey && e.id < best.id)) {
        best = e; bestKey = key;
      }
    }
    return best;
  }

  // ---------- firing ----------
  function fireTower(tw) {
    const kind = tw.def.kind;
    if (kind === 'support') return false;
    const target = acquire(tw);
    if (!target) return false;
    const dmg = effDmg(tw);
    const lvl = tw.level;
    const tp = sim.enemyPos(target);

    switch (kind) {
      case 'bullet': {
        sim.projectiles.push({
          id: uid(), kind: 'bolt', x: tw.x, z: tw.z, y: 1.6,
          targetId: target.id, speed: tw.def.projSpeed, dmg, towerId: tw.id,
        });
        emit('shot', { towerId: tw.id, type: tw.type, x: tw.x, z: tw.z, tx: tp.x, tz: tp.z });
        break;
      }
      case 'snipe': {
        const crit = rng.next() < tw.def.crit[lvl];
        const amount = crit ? dmg * tw.def.critMul : dmg;
        applyDamage(target, amount, 'phys', { towerId: tw.id, pierce: tw.def.armorPierce[lvl], crit });
        emit('snipe', { towerId: tw.id, x: tw.x, z: tw.z, tx: tp.x, tz: tp.z, crit });
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
          applyDamage(cur, curDmg, 'magic', { towerId: tw.id, shieldMul: tw.def.shieldMul });
          sim.stats.chainHits++;
          if (tw.def.stun[lvl] > 0 && !cur.boss) cur.stunUntil = Math.max(cur.stunUntil, sim.time + tw.def.stun[lvl]);
          // find next link
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
      case 'burn': {
        sim.projectiles.push({
          id: uid(), kind: 'ember', x: tw.x, z: tw.z, y: 1.7,
          targetId: target.id, speed: 22, dmg, towerId: tw.id,
          burnDps: tw.def.burnDps[lvl], burnDur: tw.def.burnDur[lvl],
          igniteSplash: tw.def.igniteSplash[lvl],
        });
        emit('shot', { towerId: tw.id, type: tw.type, x: tw.x, z: tw.z, tx: tp.x, tz: tp.z });
        break;
      }
      case 'slow': {
        sim.projectiles.push({
          id: uid(), kind: 'shard', x: tw.x, z: tw.z, y: 1.6,
          targetId: target.id, speed: 24, dmg, towerId: tw.id,
          slowPct: tw.def.slowPct[lvl], slowDur: tw.def.slowDur[lvl],
          freezeChance: tw.def.freezeChance[lvl],
        });
        emit('shot', { towerId: tw.id, type: tw.type, x: tw.x, z: tw.z, tx: tp.x, tz: tp.z });
        break;
      }
      case 'poison': {
        const flight = Math.hypot(tp.x - tw.x, tp.z - tw.z) / tw.def.projSpeed;
        sim.projectiles.push({
          id: uid(), kind: 'vial', x: tw.x, z: tw.z, y: 1.5,
          targetId: target.id, aim: { x: tp.x, z: tp.z }, arc: true,
          t: 0, flight: Math.max(0.35, flight), dmg, towerId: tw.id,
          poisonDps: tw.def.poisonDps[lvl], poisonDur: tw.def.poisonDur[lvl],
        });
        emit('shot', { towerId: tw.id, type: tw.type, x: tw.x, z: tw.z, tx: tp.x, tz: tp.z, arc: true });
        break;
      }
      case 'splash': {
        const lead = Math.hypot(tp.x - tw.x, tp.z - tw.z) / tw.def.projSpeed;
        const fut = posAlong(level.route, target.dist + target.def.speed * lead * 0.7);
        const shots = 1 + (tw.def.doubleShot[lvl] || 0);
        for (let s = 0; s < shots; s++) {
          sim.projectiles.push({
            id: uid(), kind: 'shell', x: tw.x, z: tw.z, y: 1.4,
            aim: { x: fut.x, z: fut.z }, arc: true,
            t: -s * 0.16, flight: Math.max(0.4, lead), dmg, towerId: tw.id,
            splash: tw.def.splash[lvl], falloff: tw.def.splashFalloff,
          });
        }
        emit('shot', { towerId: tw.id, type: tw.type, x: tw.x, z: tw.z, tx: fut.x, tz: fut.z, arc: true });
        break;
      }
    }
    return true;
  }

  // track venom L3 burst globally (any L3 venom tower enables it)
  function refreshVenomBurst() {
    sim._venomBurst = 0; sim._venomBurstDps = 0;
    for (const tw of sim.towers) {
      if (tw.type === 'venom' && tw.level === 2) {
        sim._venomBurst = tw.def.deathBurst[2];
        sim._venomBurstDps = tw.def.poisonDps[2] * 0.6;
      }
    }
  }

  // ---------- projectiles ----------
  function stepProjectiles(dt) {
    for (const pr of sim.projectiles) {
      if (pr.done) continue;
      if (pr.arc) {
        pr.t += dt;
        if (pr.t < pr.flight) continue;
        // resolve arc landing
        pr.done = true;
        if (pr.kind === 'vial') {
          const target = sim.enemies.find((e) => e.id === pr.targetId && e.alive);
          if (target && !target.flying) {
            applyDamage(target, pr.dmg, 'true', { towerId: pr.towerId });
            addPoison(target, pr.poisonDps, pr.poisonDur, pr.towerId);
          } else {
            // splash onto nearest ground enemy at aim point
            let best = null, bd = 1.6 * 1.6;
            for (const e of sim.enemies) {
              if (!e.alive || e.flying) continue;
              const p = sim.enemyPos(e);
              const d2 = (p.x - pr.aim.x) ** 2 + (p.z - pr.aim.z) ** 2;
              if (d2 < bd) { bd = d2; best = e; }
            }
            if (best) {
              applyDamage(best, pr.dmg, 'true', { towerId: pr.towerId });
              addPoison(best, pr.poisonDps, pr.poisonDur, pr.towerId);
            }
          }
          emit('vialLand', { x: pr.aim.x, z: pr.aim.z });
        } else if (pr.kind === 'shell') {
          const hits = [];
          for (const e of sim.enemies) {
            if (!e.alive || e.flying) continue;
            const p = sim.enemyPos(e);
            const d = Math.hypot(p.x - pr.aim.x, p.z - pr.aim.z);
            if (d <= pr.splash) hits.push({ e, d });
          }
          for (const { e, d } of hits) {
            const frac = 1 - pr.falloff * (d / pr.splash);
            applyDamage(e, pr.dmg * frac, 'phys', { towerId: pr.towerId });
          }
          emit('explode', { x: pr.aim.x, z: pr.aim.z, r: pr.splash });
        }
        continue;
      }
      // homing
      const target = sim.enemies.find((e) => e.id === pr.targetId && e.alive);
      if (!target) { pr.done = true; emit('fizzle', { x: pr.x, z: pr.z }); continue; }
      const p = sim.enemyPos(target);
      const dx = p.x - pr.x, dz = p.z - pr.z;
      const d = Math.hypot(dx, dz);
      const stepLen = pr.speed * dt;
      if (d <= Math.max(0.25, stepLen)) {
        pr.done = true;
        if (pr.kind === 'bolt') {
          applyDamage(target, pr.dmg, 'phys', { towerId: pr.towerId });
        } else if (pr.kind === 'ember') {
          applyDamage(target, pr.dmg, 'magic', { towerId: pr.towerId });
          if (target.alive) {
            target.burn = { dps: pr.burnDps, until: sim.time + pr.burnDur, towerId: pr.towerId };
            sim.stats.burnsApplied++;
            emit('ignite', { enemyId: target.id });
          }
          if (pr.igniteSplash > 0) {
            for (const o of sim.enemies) {
              if (!o.alive || o === target) continue;
              const op = sim.enemyPos(o);
              if (Math.hypot(op.x - p.x, op.z - p.z) < pr.igniteSplash) {
                o.burn = { dps: pr.burnDps * 0.6, until: sim.time + pr.burnDur * 0.7, towerId: pr.towerId };
                sim.stats.burnsApplied++;
              }
            }
          }
        } else if (pr.kind === 'shard') {
          applyDamage(target, pr.dmg, 'magic', { towerId: pr.towerId });
          if (target.alive) {
            const bossMul = target.boss ? 0.5 : 1;
            if (pr.slowPct * bossMul > target.slowPct || sim.time > target.slowUntil) {
              target.slowPct = pr.slowPct * bossMul;
              target.slowUntil = sim.time + pr.slowDur;
            }
            if (pr.freezeChance > 0 && !target.boss && sim.time > target.freezeCdUntil && rng.next() < pr.freezeChance) {
              target.freezeUntil = sim.time + 1.0;
              target.freezeCdUntil = sim.time + 4;
              sim.stats.freezeProcs++;
              emit('freeze', { enemyId: target.id });
            }
          }
        }
      } else {
        pr.x += (dx / d) * stepLen;
        pr.z += (dz / d) * stepLen;
      }
    }
    if (sim.projectiles.length > 60 || sim.projectiles.some((p) => p.done)) {
      sim.projectiles = sim.projectiles.filter((p) => !p.done);
    }
  }

  // ---------- enemy update ----------
  function stepEnemies(dt) {
    const gust = sim.time < sim.gustUntil ? 1.6 : 1;
    for (const e of sim.enemies) {
      if (!e.alive) continue;
      // DoTs
      if (e.burn && sim.time < e.burn.until) {
        applyDamage(e, e.burn.dps * dt, 'dot', { towerId: e.burn.towerId, event: false });
        if (!e.alive) continue;
      } else if (e.burn) e.burn = null;
      if (e.poisons.length) {
        for (const s of e.poisons) {
          if (sim.time < s.until) {
            applyDamage(e, s.dps * dt, 'dot', { towerId: s.towerId, event: false });
            sim.stats.poisonTicks += dt;
            if (!e.alive) break;
          }
        }
        if (!e.alive) continue;
        e.poisons = e.poisons.filter((s) => sim.time < s.until);
      }
      // regen (suppressed while burning)
      if (e.regen && !e.burn && e.hp < e.maxHp) {
        e.hp = Math.min(e.maxHp, e.hp + e.regen * dt);
      }
      // status decay
      if (sim.time > e.slowUntil) e.slowPct = 0;
      // move
      const frozen = sim.time < e.freezeUntil || sim.time < e.stunUntil;
      if (!frozen) {
        const spd = e.def.speed * e.speedJitter * (1 - e.slowPct) * gust;
        e.dist += spd * dt;
      }
      // abilities
      if (e.abil) {
        for (const [a, readyAt] of Object.entries(e.abil)) {
          if (sim.time >= readyAt) {
            runAbility(e, a);
            e.abil[a] = sim.time + abilityCd(a);
          }
        }
      }
      // leak
      if (e.dist >= level.route.total) {
        e.alive = false;
        sim.lives -= e.leak;
        sim.stats.leaks++;
        emit('leak', { enemyId: e.id, type: e.type, leak: e.leak, boss: e.boss });
        if (sim.lives <= 0) {
          sim.lives = 0;
          if (sim.phase !== 'lost') { sim.phase = 'lost'; emit('lose', {}); }
        }
      }
    }
    // prune dead (view keeps its own corpse anims from death events)
    if (sim.enemies.length && sim.enemies.some((e) => !e.alive)) {
      sim.enemies = sim.enemies.filter((e) => e.alive);
    }
  }

  // ---------- hazards ----------
  function stepHazards() {
    if (sim.ventState) {
      const vs = sim.ventState;
      if (!vs.warning && sim.time >= vs.nextAt - hazard.telegraph) {
        vs.warning = true;
        emit('ventWarn', { cells: ventCells, in: hazard.telegraph });
      }
      if (sim.time >= vs.nextAt) {
        for (const [cx, cy] of ventCells) {
          const tw = sim.towers.find((t) => t.cx === cx && t.cy === cy);
          if (tw) tw.disabledUntil = sim.time + hazard.stun;
        }
        emit('vent', { cells: ventCells });
        vs.nextAt = sim.time + hazard.interval[0] + rng.next() * (hazard.interval[1] - hazard.interval[0]);
        vs.warning = false;
      }
    }
    if (sim.hazardBlizz) {
      const hb = sim.hazardBlizz;
      if (sim.time >= hb.nextAt) {
        sim.blizzardUntil = sim.time + hazard.duration;
        emit('blizzard', { duration: hazard.duration });
        hb.nextAt = sim.time + hazard.interval[0] + rng.next() * (hazard.interval[1] - hazard.interval[0]);
      }
    }
    if (sim.surge) {
      if (sim.time >= sim.surge.nextAt) {
        const cands = sim.towers.filter((t) => t.type !== 'banner');
        if (cands.length) {
          const tw = cands[Math.floor(rng.next() * cands.length)];
          sim.surge.towerId = tw.id;
          sim.surge.until = sim.time + hazard.duration;
          emit('surge', { towerId: tw.id, duration: hazard.duration });
        }
        sim.surge.nextAt = sim.time + hazard.interval[0] + rng.next() * (hazard.interval[1] - hazard.interval[0]);
      }
    }
  }

  // ---------- main step ----------
  sim.step = (dt) => {
    if (sim.phase === 'won' || sim.phase === 'lost') return;
    sim.time += dt;

    // spawns
    while (sim.spawnQueue.length && sim.spawnQueue[0].at <= sim.time) {
      const s = sim.spawnQueue.shift();
      spawnEnemy(s.type, s);
    }

    stepEnemies(dt);
    if (sim.phase === 'lost') return;

    // towers
    refreshVenomBurst();
    for (const tw of sim.towers) {
      if (tw.def.kind === 'support') continue;
      if (sim.time < tw.disabledUntil) continue;
      tw.cooldown -= dt;
      if (tw.cooldown <= 0) {
        if (fireTower(tw)) {
          tw.cooldown = 1 / effRate(tw);
        } else {
          tw.cooldown = 0.08; // re-scan soon
        }
      }
    }

    stepProjectiles(dt);
    stepHazards();

    // wave end
    if (sim.phase === 'wave' && !sim.spawnQueue.length && sim.enemies.length === 0) {
      const wi = sim.waveIdx;
      const bonus = Math.round((40 + wi * 6) * (1 + bi * 0.5 + li * 0.07));
      sim.gold += bonus;
      sim.stats.goldEarned += bonus;
      sim.stats.wavesCleared++;
      emit('waveEnd', { idx: wi, bonus });
      if (!endless && wi >= level.waves.length - 1) {
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

  sim.stars = () => (sim.lives >= 18 ? 3 : sim.lives >= 10 ? 2 : sim.lives > 0 ? 1 : 0);

  // Synchronous fast-forward — the backbone of headless playtesting.
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
