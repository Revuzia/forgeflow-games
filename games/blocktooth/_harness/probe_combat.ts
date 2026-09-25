// BLOCKTOOTH — combat lane unit probe (node _harness/probe_combat.ts). Exit code 0 = all pass.
//
// Runs the REAL combat modules (src/combat/*) + orchestrator core (math/config/rng) + the real
// data/enemies.ts table against a minimal HAND-BUILT World. Cross-lane sim modules (titansim,
// citysim, bosses, upgrade stats) are replaced IN-PROCESS by recording stubs via node:module
// registerHooks, so every number below is exact and this probe does not depend on other lanes.

import { registerHooks } from 'node:module';
import type {
  Building, Enemy, EnemyKind, Prop, Shape, SimEvent, StatBlock, StatKey, World, BossState, DamageKind,
} from '../src/core/types.ts';

// ─────────────────────────────── stubs for other lanes ───────────────────────────────
type Fn = (...a: any[]) => any;
type StubTable = Record<string, Record<string, Fn>>;
const G = globalThis as unknown as { __BT_STUBS__: StubTable };

const STUB_MODULES: Record<string, { re: RegExp; names: string[] }> = {
  titansim: { re: /titans\/titansim\.ts$/, names: ['createTitan', 'stepTitan', 'hurtTitan', 'healTitan', 'gainXp', 'gainMass', 'titanMaxSpeed'] },
  citysim: { re: /city\/citysim\.ts$/, names: ['stepCity', 'buildingsInRect', 'propsInRect', 'damageBuilding', 'damageProp', 'resolveCircleVsCity', 'blockOf', 'buildingById', 'nearestRubble'] },
  bosses: { re: /ai\/bosses\/index\.ts$/, names: ['spawnBoss', 'stepBoss', 'damageBoss'] },
  stats: { re: /upgrades\/stats\.ts$/, names: ['createUpgradeState', 'recomputeStats', 'stat', 'baseStatBlock'] },
  // v2 (FEATURES_V2 §2.7, L0): the pre-wired meta hooks in combat/* are other lanes' systems too —
  // stubbed inert here so this probe keeps testing combat alone (killEnemy drops its own scrap,
  // RED LIGHT is never on) and never pulls the world / director import chain in
  ultimate: { re: /meta\/ultimate\.ts$/, names: ['ultBankKill', 'addUproar', 'ultMoveMul', 'ultRadius'] },
  powerups: { re: /meta\/powerups\.ts$/, names: ['redLightActive', 'spawnPowerup', 'stepPowerups'] },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    for (const key of Object.keys(STUB_MODULES)) {
      if (STUB_MODULES[key].re.test(specifier)) return { url: 'btstub:' + key, shortCircuit: true, format: 'module' };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('btstub:')) {
      const key = url.slice('btstub:'.length);
      const src = STUB_MODULES[key].names
        .map((n) => `export function ${n}(...a) { return globalThis.__BT_STUBS__[${JSON.stringify(key)}][${JSON.stringify(n)}](...a); }`)
        .join('\n');
      return { format: 'module', source: src, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// recorders
const rec = {
  hurt: [] as { dmg: number; kind: DamageKind; x: number; z: number }[],
  heal: [] as number[],
  xp: 0, mass: 0,
  bld: [] as { id: number; amount: number; kind: DamageKind }[],
  prop: [] as { id: number; amount: number }[],
  boss: [] as { part: number; dmg: number }[],
};
function resetRec(): void {
  rec.hurt.length = 0; rec.heal.length = 0; rec.xp = 0; rec.mass = 0;
  rec.bld.length = 0; rec.prop.length = 0; rec.boss.length = 0;
}

G.__BT_STUBS__ = {
  titansim: {
    createTitan: () => { throw new Error('not used'); },
    stepTitan: () => {},
    hurtTitan: (w: World, dmg: number, kind: DamageKind, x: number, z: number) => {
      const T = w.titan;
      if (!T.alive || T.iframeT > 0) return 0;
      rec.hurt.push({ dmg, kind, x, z });
      T.hp -= dmg;
      return dmg;
    },
    healTitan: (w: World, amount: number) => {
      rec.heal.push(amount);
      w.titan.hp = Math.min(w.titan.maxHp, w.titan.hp + amount);
    },
    gainXp: (_w: World, xp: number) => { rec.xp += xp; },
    gainMass: (_w: World, m: number) => { rec.mass += m; },
    titanMaxSpeed: (w: World) => 3.2 + 1.9 * Math.pow(w.titan.height, 0.8),
  },
  citysim: {
    stepCity: () => {},
    buildingsInRect: (city: World['city'], minX: number, minZ: number, maxX: number, maxZ: number, out: number[]) => {
      out.length = 0;
      for (const b of city.buildings) {
        if (b.x + b.w / 2 < minX || b.x - b.w / 2 > maxX || b.z + b.d / 2 < minZ || b.z - b.d / 2 > maxZ) continue;
        out.push(b.id);
      }
      return out;
    },
    propsInRect: (city: World['city'], minX: number, minZ: number, maxX: number, maxZ: number, out: number[]) => {
      out.length = 0;
      for (const p of city.props) if (p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ) out.push(p.id);
      return out;
    },
    damageBuilding: (_w: World, id: number, amount: number, opts: { kind: DamageKind }) => { rec.bld.push({ id, amount, kind: opts.kind }); return 0; },
    damageProp: (w: World, id: number, amount: number) => {
      rec.prop.push({ id, amount });
      const p = w.city.props[id];
      p.hp -= amount;
      if (p.hp <= 0) { p.alive = false; return true; }
      return false;
    },
    resolveCircleVsCity: () => false,
    blockOf: () => 0,
    buildingById: (city: World['city'], id: number) => city.buildings[id],
    nearestRubble: (_c: unknown, _x: number, _z: number, _r: number, _m: number, out: number[]) => out,
  },
  bosses: {
    spawnBoss: () => {},
    stepBoss: () => {},
    damageBoss: (w: World, part: number, dmg: number) => {
      rec.boss.push({ part, dmg });
      if (w.boss) w.boss.hp -= dmg * w.boss.parts[part].hpMul;
    },
  },
  ultimate: {
    ultBankKill: () => false,
    addUproar: () => {},
    ultMoveMul: () => 1,
    ultRadius: () => 0,
  },
  powerups: {
    redLightActive: () => false,
    spawnPowerup: () => null,
    stepPowerups: () => {},
  },
  stats: {
    createUpgradeState: () => ({}),
    recomputeStats: () => {},
    stat: (w: World, k: StatKey) => w.titan.stats[k],
    baseStatBlock: () => baseStats(),
  },
};

// ─────────────────────────────── real modules (after hooks) ───────────────────────────────
const { makeStreams } = await import('../src/core/rng.ts');
const { CITY, SIM_DT, RANKS, OVERSIZE_DAMAGE_MUL } = await import('../src/core/config.ts');
const { circleInShape } = await import('../src/core/math.ts');
const { ENEMIES } = await import('../src/data/enemies.ts');
const SP = await import('../src/combat/spatial.ts');
const D = await import('../src/combat/damage.ts');
const TG = await import('../src/combat/targeting.ts');
const PR = await import('../src/combat/projectiles.ts');
const TL = await import('../src/combat/telegraphs.ts');
const HZ = await import('../src/combat/hazards.ts');
const PK = await import('../src/combat/pickups.ts');

// ─────────────────────────────── tiny test framework ───────────────────────────────
let pass = 0, fail = 0;
const lines: string[] = [];
function ok(cond: boolean, name: string, detail = ''): void {
  if (cond) { pass++; lines.push(`  PASS ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; lines.push(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(name: string): void { lines.push(`[${name}]`); }
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

// ─────────────────────────────── world builder ───────────────────────────────
function baseStats(): StatBlock {
  return {
    maxHp: 100, regen: 0.5, armor: 0, iframes: 0, thorns: 0, lifesteal: 0, rubbleHeal: 0,
    moveSpeed: 1, dashCharges: 1, dashCooldown: 1, dashDistance: 2.2,
    pickupRadius: 1.6, massGain: 1, xpGain: 1, luck: 0, rerolls: 1,
    damage: 1, attackRate: 1, attackRange: 1, area: 1, critChance: 0, critMult: 1.6, knockback: 1,
    chains: 0, chainRange: 1, projectiles: 0, buildingDamage: 1,
    smashDamage: 1, smashRadius: 1, sparkChance: 0,
    abilityCooldown: 1, abilityPower: 1,
    biteCleave: 0, pulseEvery: 4, vacuumRadius: 1,
    arcForks: 3, wireDuration: 4, wireDamage: 1,
    shellCapacity: 1, stompDelay: 0.6, magmaDuration: 0,
    turretCap: 4, turretRate: 1, sporeHeal: 1, vineLength: 1,
    // v2 UPROAR (FEATURES_V2 §3)
    ultCharge: 1, ultPower: 1,
  };
}

function makeWorld(seed = 1234): World {
  const titan = {
    id: 'molo', x: 0, z: 0, heading: 0, px: 0, pz: 0, pheading: 0, vx: 0, vz: 0, speed: 0, moving: false,
    hp: 1000, maxHp: 1000, level: 1, xp: 0, xpToNext: 10, mass: 0, rank: 0, height: 1.2, radius: 1.2 * 0.42,
    growT: 0, dashCharges: 1, dashRecharge: 0, dashT: 0, dashDirX: 0, dashDirZ: 0, iframeT: 0,
    abilityCd: 0, autoCd: 0, stepAcc: 0, slowT: 0, slowMul: 1, leash: null, stats: baseStats(), kit: {},
    alive: true, kills: 0, crushed: 0, floorsEaten: 0, buildingsLeveled: 0, propsEaten: 0, damageTaken: 0,
  };
  const w = {
    seed, titanId: 'molo', biomeId: 'grideast', tick: 0, t: 0, dt: SIM_DT, rng: makeStreams(seed),
    city: {
      seed, biome: 'grideast', blocksX: 1, blocksZ: 1, pitch: 72, roadW: 14, sidewalkW: 3, originX: -500, originZ: -500,
      bounds: { minX: -500, minZ: -500, maxX: 500, maxZ: 500 },
      buildings: [] as Building[], props: [] as Prop[], blockBuildings: [[]], blockProps: [[]],
      crosswalks: [], lanes: [], spawn: { x: 0, z: 0, heading: 0 }, flooded: false,
    },
    titan, enemies: [] as Enemy[], projectiles: [], telegraphs: [], hazards: [], pickups: [], boss: null,
    director: {}, upgrades: { owned: {}, order: [], pendingDrafts: 0, offer: null, rerolls: 1, icd: {}, buffs: [], shield: 0, chestDrafts: 0 },
    run: { phase: 'waves', endT: -1, result: null, tonnage: 0, blocksLeveled: 0, peakRank: 0 },
    events: [] as SimEvent[], input: { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false },
    cheats: { god: false, noSpawns: false }, nextId: 1,
  };
  return w as unknown as World;
}

function addEnemy(w: World, kind: EnemyKind, x: number, z: number, over: Partial<Enemy> = {}): Enemy {
  const def = ENEMIES[kind];
  const e: Enemy = {
    id: w.nextId++, kind, alive: true, x, z, y: 0, px: x, pz: z, py: 0, pheading: 0, vx: 0, vz: 0, heading: 0,
    hp: 1e6, maxHp: 1e6, radius: def.radius, height: def.height, state: 'idle', t: 0, cd: 0, squad: -1, slot: 0,
    elite: kind === 'elite', aimX: 0, aimZ: 0, flash: 0, stun: 0, slowT: 0, slowMul: 1, kx: 0, kz: 0, spawnT: 0,
    ...over,
  };
  w.enemies.push(e);
  return e;
}

function addBuilding(w: World, x: number, z: number, bw: number, bd: number, tier: 0 | 1 | 2 | 3 | 4): Building {
  const b: Building = {
    id: w.city.buildings.length, arch: 'probe', shape: 'box', tier, block: 0, x, z, w: bw, d: bd, floorH: 4,
    floors: 3, alive: 3, floorHp: 10, floorHpMax: 10, collapsed: false, variant: 0,
  };
  w.city.buildings.push(b);
  return b;
}

function addProp(w: World, kind: Prop['kind'], x: number, z: number, tier: 0 | 1 = 0): Prop {
  const p: Prop = { id: w.city.props.length, kind, tier, x, z, heading: 0, px: x, pz: z, pheading: 0, alive: true, hp: 3, lane: -1, laneS: 0, speed: 0, scared: 0 };
  w.city.props.push(p);
  return p;
}

/** A combat-only tick mirroring the stepWorld order for the combat systems. */
function tick(w: World): void {
  w.events.length = 0;
  for (const p of w.projectiles) { p.px = p.x; p.pz = p.z; p.py = p.y; }
  for (const p of w.pickups) { p.px = p.x; p.pz = p.z; p.py = p.y; }
  w.tick++;
  w.t += w.dt;
  SP.rebuildEnemyGrid(w);
  PR.stepProjectiles(w);
  TL.stepTelegraphs(w);
  HZ.stepHazards(w);
  PK.stepPickups(w);
}

function hitSet(w: World): string {
  return w.enemies.filter((e) => e.hp < e.maxHp).map((e) => e.id).sort((a, b) => a - b).join(',');
}
function resetEnemies(w: World): void { for (const e of w.enemies) { e.hp = e.maxHp; e.alive = true; e.kx = 0; e.kz = 0; e.stun = 0; e.flash = 0; } }
const titanOpts = { src: 'titan' as const, kind: 'bite' as const, noCrit: true };

// ══════════════════════════════ 1. damageArea — every shape path ══════════════════════════════
section('damageArea shape paths (enemies: exact sets; radius-aware)');
{
  const w = makeWorld();
  // androids r 0.45 placed on a line / around the origin
  const E = (x: number, z: number) => addEnemy(w, 'android', x, z);
  const a = E(0, 5);      // straight ahead (+Z) 5 m
  const b = E(0, 10.3);   // ahead 10.3 m (edge: circle r10 + e.r 0.45 → 10.45 reaches)
  const c = E(5, 0);      // +X 5 m
  const d = E(-3, -3);    // behind-left 4.24 m
  const e = E(0, 11);     // ahead 11 m (outside r10 circle)
  const f = E(0.9, 20);   // far ahead, slightly right
  const g = E(3.3, 7);    // off-axis
  SP.rebuildEnemyGrid(w);
  const ids = (xs: Enemy[]) => xs.map((q) => q.id).sort((p, q) => p - q).join(',');
  const cases: { name: string; s: Shape; want: Enemy[] }[] = [
    { name: 'circle r10', s: { k: 'circle', x: 0, z: 0, r: 10 }, want: [a, b, c, d, g] },
    { name: 'ring 4.8..10.5', s: { k: 'ring', x: 0, z: 0, r0: 5.5, r1: 10.5 }, want: [a, b, c, g, e].filter((q) => Math.hypot(q.x, q.z) + q.radius >= 5.5 && Math.hypot(q.x, q.z) - q.radius <= 10.5) },
    { name: 'cone +Z half 30° r 12', s: { k: 'cone', x: 0, z: 0, dir: 0, half: Math.PI / 6, r: 12 }, want: [a, b, e, g] },
    { name: 'lane +Z len 25 w 2', s: { k: 'lane', x: 0, z: 0, dir: 0, len: 25, w: 2 }, want: [a, b, e, f] },
    { name: 'oval rx 6 rz 2 rot 90° (long along world X)', s: { k: 'oval', x: 0, z: 0, rx: 2, rz: 6, rot: Math.PI / 2 }, want: [c] },
    { name: 'capsule (-4,-4)→(6,6) r 1', s: { k: 'capsule', x0: -4, z0: -4, x1: 6, z1: 6, r: 1 }, want: [d] },
  ];
  for (const cs of cases) {
    resetEnemies(w);
    const buf: Enemy[] = [];
    SP.enemiesInShape(w, cs.s, buf);
    const expectBrute = w.enemies.filter((q) => circleInShape(cs.s, q.x, q.z, q.radius));
    const hits = D.damageArea(w, cs.s, 1, titanOpts);
    ok(hitSet(w) === ids(cs.want) && ids(buf) === ids(expectBrute) && hits === cs.want.length,
      cs.name, `hit {${hitSet(w)}} want {${ids(cs.want)}} grid==brute:${ids(buf) === ids(expectBrute)}`);
  }
}

section('damageArea city: buildings (rectInShape), props (radius), oversize ×0.25, buildingMul × stats.buildingDamage');
{
  const w = makeWorld();
  w.titan.stats.buildingDamage = 2;
  const b0 = addBuilding(w, 0, 12, 8, 8, 0);     // flattenable, inside circle r10 (near face at z=8)
  const b1 = addBuilding(w, 12, 0, 6, 6, 2);     // oversize at Size I, near face at x=9 → inside
  const b2 = addBuilding(w, 30, 30, 6, 6, 0);    // far away
  const p0 = addProp(w, 'car', 0, -11.5);        // car r 2.1 → surface 9.4 → inside
  const p1 = addProp(w, 'hydrant', 0, -10.5);    // r .35 → 10.15 → outside
  resetRec();
  const hits = D.damageArea(w, { k: 'circle', x: 0, z: 0, r: 10 }, 10, { ...titanOpts, buildingMul: 0.5 });
  const got = (id: number) => rec.bld.find((r) => r.id === id);
  ok(hits === 3, 'city hit count', `hits=${hits}`);
  ok(!!got(b0.id) && near(got(b0.id)!.amount, 10 * 0.5 * 2), 'flattenable building amount = dmg×buildingMul×buildingDamage', `${got(b0.id)?.amount}`);
  ok(!!got(b1.id) && near(got(b1.id)!.amount, 10 * 0.5 * 2 * OVERSIZE_DAMAGE_MUL), 'oversize building ×OVERSIZE_DAMAGE_MUL', `${got(b1.id)?.amount}`);
  ok(!got(b2.id), 'far building untouched');
  ok(rec.prop.some((r) => r.id === p0.id) && !rec.prop.some((r) => r.id === p1.id), 'prop radius respected (car in, hydrant out)');
  resetRec();
  D.damageArea(w, { k: 'circle', x: 0, z: 0, r: 10 }, 10, { ...titanOpts, noCity: true });
  ok(rec.bld.length === 0 && rec.prop.length === 0, 'noCity skips the city');
  // at Size III (canFlatten 2) the tier-2 building is no longer oversize
  w.titan.rank = 2;
  resetRec();
  D.damageArea(w, { k: 'circle', x: 0, z: 0, r: 10 }, 10, titanOpts);
  ok(near(got(b1.id)!.amount, 20), 'tier ≤ canFlatten → full damage at Size III', `${got(b1.id)?.amount}`);
}

section('damageArea boss parts, hostile side, aggregation, knockback, lifesteal cap');
{
  const w = makeWorld();
  const boss = {
    id: 'caisson4', alive: true, x: 40, z: 0, heading: 0, px: 40, pz: 0, pheading: 0, hp: 1e6, maxHp: 1e6, phase: 1,
    meter: 0, staggerT: 0, attack: null, attackT: 0, cd: 0, introT: 0, subtitle: '', data: {},
    parts: [
      { name: 'body', ox: 0, oz: 0, r: 18, y0: 0, y1: 40, hpMul: 1, strainMul: 1, x: 40, z: 0 },
      { name: 'legFL', ox: -20, oz: 10, r: 7, y0: 0, y1: 20, hpMul: 1, strainMul: 2.5, x: 20, z: 10 },
      { name: 'boom', ox: 0, oz: 30, r: 8, y0: 30, y1: 70, hpMul: 0.5, strainMul: 1, x: 40, z: 30 },
    ],
  } as unknown as BossState;
  w.boss = boss;
  resetRec();
  const hits = D.damageArea(w, { k: 'circle', x: 14, z: 6, r: 10 }, 5, titanOpts);
  ok(rec.boss.length === 2 && rec.boss.map((r) => r.part).join(',') === '0,1' && hits === 2, 'damageBoss once per overlapping part', JSON.stringify(rec.boss));
  const bossTotal = rec.boss.reduce((a, r) => a + r.dmg, 0);
  ok(near(bossTotal, 5) && near(rec.boss[0].dmg, 2.5), 'one shape = one hit on the boss, shared by the overlapping parts', `total ${bossTotal}`);
  resetRec();
  D.damageArea(w, { k: 'circle', x: 40, z: 15, r: 200 }, 6, titanOpts);
  ok(rec.boss.length === 3 && near(rec.boss.reduce((a, r) => a + r.dmg, 0), 6), 'huge AoE covering every part still totals one hit', JSON.stringify(rec.boss.map((r) => +r.dmg.toFixed(3))));
  resetRec();
  TG.hitTarget(w, { kind: 'boss', part: 1 }, 5, titanOpts);
  ok(rec.boss.length === 1 && rec.boss[0].part === 1 && near(rec.boss[0].dmg, 5), 'hitTarget on a boss part = full damage to that part');

  // hostile side → hurtTitan
  resetRec();
  const hh = D.damageArea(w, { k: 'circle', x: 1, z: 0, r: 1 }, 7, { src: 'enemy', kind: 'rocket' });
  ok(hh === 1 && rec.hurt.length === 1 && rec.hurt[0].dmg === 7, 'hostile src forwards to the titan', JSON.stringify(rec.hurt));
  resetRec();
  const miss = D.damageTitanArea(w, { k: 'circle', x: 5, z: 0, r: 1 }, 7, 'rocket');
  ok(!miss && rec.hurt.length === 0, 'damageTitanArea misses when not overlapping');

  // aggregation: two hits same tick → ONE enemyHit with summed dmg; next tick → new event
  w.boss = null;
  const e = addEnemy(w, 'android', 2, 0);
  SP.rebuildEnemyGrid(w);
  w.events.length = 0;
  D.damageArea(w, { k: 'circle', x: 0, z: 0, r: 5 }, 3, titanOpts);
  D.damageArea(w, { k: 'circle', x: 0, z: 0, r: 5 }, 4, titanOpts);
  let evs = w.events.filter((q) => q.type === 'enemyHit' && q.id === e.id);
  ok(evs.length === 1 && (evs[0] as { dmg: number }).dmg === 7, 'enemyHit aggregated per enemy per tick', JSON.stringify(evs));
  w.tick++; w.events.length = 0;
  D.damageArea(w, { k: 'circle', x: 0, z: 0, r: 5 }, 2, titanOpts);
  evs = w.events.filter((q) => q.type === 'enemyHit' && q.id === e.id);
  ok(evs.length === 1 && (evs[0] as { dmg: number }).dmg === 2, 'new tick → fresh enemyHit event');

  // knockback: away from the shape origin, smaller for bigger bodies; opts.knock is the caller's finished
  // impulse (kits/engine fold stats.knockback in) so the stat must NOT be applied a second time here
  const small = addEnemy(w, 'android', 3, 0);
  const big = addEnemy(w, 'tank', 0, 4);
  e.alive = false;
  SP.rebuildEnemyGrid(w);
  w.titan.stats.knockback = 2;
  D.damageArea(w, { k: 'circle', x: 0, z: 0, r: 8 }, 1, { ...titanOpts, knock: 5 });
  ok(small.kx > 0 && near(small.kz, 0, 1e-9), 'knock direction = away from origin', `k=(${small.kx.toFixed(2)},${small.kz.toFixed(2)})`);
  ok(big.kz > 0 && big.kz < small.kx, 'bigger body knocked less', `small ${small.kx.toFixed(2)} vs tank ${big.kz.toFixed(2)}`);
  const smallK2 = small.kx;
  small.kx = 0; w.titan.stats.knockback = 1;
  D.damageArea(w, { k: 'circle', x: 0, z: 0, r: 8 }, 1, { ...titanOpts, knock: 5 });
  ok(near(smallK2, small.kx), 'stats.knockback not re-applied (impulse is caller-scaled)', `${smallK2.toFixed(3)} == ${small.kx.toFixed(3)}`);
  small.kx = 0;
  D.damageArea(w, { k: 'circle', x: 0, z: 0, r: 8 }, 1, { ...titanOpts, knock: 10 });
  ok(near(small.kx, 2 * smallK2), 'knock impulse is linear in opts.knock', `${small.kx.toFixed(3)} = 2×${smallK2.toFixed(3)}`);

  // lifesteal: 100 % of dealt, but ≤ 2 % maxHp per tick (knockback subjects removed first)
  small.alive = false; big.alive = false;
  w.titan.stats.lifesteal = 1; w.titan.hp = 100; w.titan.maxHp = 1000;
  resetRec(); w.tick++;
  const victims: Enemy[] = [];
  for (let i = 0; i < 6; i++) victims.push(addEnemy(w, 'android', -2 - i * 0.1, 1, { hp: 10, maxHp: 10 }));
  SP.rebuildEnemyGrid(w);
  D.damageArea(w, { k: 'circle', x: -2, z: 1, r: 3 }, 8, titanOpts);    // 6 × 8 = 48 dealt
  const healed = rec.heal.reduce((s, v) => s + v, 0);
  ok(near(healed, 20), 'lifesteal capped at 2 % maxHp per tick', `healed ${healed} (dealt 48, cap 20)`);
  w.tick++; resetRec();
  D.damageArea(w, { k: 'circle', x: -2, z: 1, r: 3 }, 1, titanOpts);    // 6 × min(1, hp 2) = 6
  ok(near(rec.heal.reduce((s, v) => s + v, 0), 6), 'cap resets next tick', `healed ${rec.heal.join('+')}`);
  w.titan.stats.lifesteal = 0;
}

// ══════════════════════════════ 2. kills, drops, thorns ══════════════════════════════
section('killEnemy drops (xp/mass conserved, elite chest), counters, thorns');
{
  const w = makeWorld();
  const kinds: EnemyKind[] = ['android', 'buggy', 'tank', 'walker', 'elite'];
  for (const k of kinds) {
    const before = w.pickups.length;
    const e = addEnemy(w, k, 10, 10, { hp: 1, maxHp: 1 });
    SP.rebuildEnemyGrid(w);
    D.damageEnemy(w, e, 5, titanOpts);
    const drops = w.pickups.slice(before);
    const scrap = drops.filter((p) => p.kind === 'scrap');
    const sx = scrap.reduce((s, p) => s + p.xp, 0), sm = scrap.reduce((s, p) => s + p.mass, 0);
    const chest = drops.filter((p) => p.kind === 'chest').length;
    ok(!e.alive && near(sx, ENEMIES[k].xp) && near(sm, ENEMIES[k].mass) && scrap.length >= 1 && scrap.length <= 4 && chest === (k === 'elite' ? 1 : 0),
      `kill ${k}`, `scrap×${scrap.length} xp ${sx}/${ENEMIES[k].xp} mass ${sm}/${ENEMIES[k].mass} chest ${chest}`);
  }
  ok(w.titan.kills === kinds.length && w.titan.crushed === 0, 'titan.kills counted', `kills ${w.titan.kills}`);
  const cr = addEnemy(w, 'android', 0, 0);
  D.killEnemy(w, cr, true);
  const kev = w.events.filter((q) => q.type === 'enemyKilled');
  ok(w.titan.crushed === 1 && (kev[kev.length - 1] as { crushed: boolean }).crushed === true, 'crush kill → crushed counter + event flag');

  // thorns: a pellet from a CROSSING WARDEN reflects stats.thorns × dmg to that shooter
  w.titan.stats.thorns = 0.5;
  const shooter = addEnemy(w, 'android', 6, 0, { hp: 100, maxHp: 100 });
  SP.rebuildEnemyGrid(w);
  resetRec();
  PR.spawnProjectile(w, { owner: 'enemy', kind: 'pellet', x: 6, z: 0, vx: -12, vz: 0, dmg: 8 });
  for (let i = 0; i < 30 && rec.hurt.length === 0; i++) tick(w);
  ok(rec.hurt.length === 1 && near(shooter.hp, 100 - 4), 'thorns reflect to the pellet shooter', `titan took ${rec.hurt[0]?.dmg}, shooter hp ${shooter.hp}`);
  w.titan.stats.thorns = 0;
}

// ══════════════════════════════ 3. crit determinism ══════════════════════════════
section('rollCrit (rng.combat) determinism + rate + multiplier');
{
  const seq = (seed: number) => {
    const w = makeWorld(seed);
    w.titan.stats.critChance = 0.25; w.titan.stats.critMult = 2;
    let s = '', n = 0, allMul = true;
    for (let i = 0; i < 4000; i++) {
      const c = D.rollCrit(w, 10);
      s += c.crit ? '1' : '0';
      if (c.crit) { n++; if (c.dmg !== 20) allMul = false; } else if (c.dmg !== 10) allMul = false;
    }
    return { s, n, allMul };
  };
  const A = seq(777), B = seq(777), C = seq(778);
  ok(A.s === B.s, 'same seed ⇒ identical crit sequence');
  ok(A.s !== C.s, 'different seed ⇒ different sequence');
  ok(Math.abs(A.n / 4000 - 0.25) < 0.03, 'crit rate ≈ critChance', `${(A.n / 40).toFixed(1)} %`);
  ok(A.allMul, 'crit damage = dmg × critMult');
  const w = makeWorld(5);
  w.titan.stats.damage = 1.5; w.titan.rank = 2;
  ok(near(D.titanDamage(w, 10), 10 * RANKS[2].dmgMul * 1.5), 'titanDamage = base × rank dmgMul × stats.damage', `${D.titanDamage(w, 10)}`);
}

// ══════════════════════════════ 4. telegraph timing ══════════════════════════════
section('telegraphs: windup → fire to the tick, active 5 Hz, onFire, hit flag, lifetime');
{
  const w = makeWorld();
  resetRec();
  let onFireAt = -1, onFireHurts = -1;
  const tg = TL.spawnTelegraph(w, {
    owner: 'enemy', style: 'circle', shape: { k: 'circle', x: 0, z: 0, r: 3 }, windup: 0.6, dmg: 10, kind: 'rocket',
    onFire: (ww) => { onFireAt = ww.tick; onFireHurts = rec.hurt.length; },
  });
  const startEv = w.events.find((q) => q.type === 'telegraphStart');
  ok(!!startEv && (startEv as { id: number }).id === tg.id, 'telegraphStart emitted on spawn');
  let fireTick = -1, hitFlag: boolean | null = null, steps = 0;
  while (steps < 60 && fireTick < 0) {
    tick(w); steps++;
    const f = w.events.find((q) => q.type === 'telegraphFire');
    if (f) { fireTick = steps; hitFlag = (f as { hit: boolean }).hit; }
  }
  ok(fireTick === 18, 'windup 0.6 s fires on the 18th step (30 Hz)', `fired at step ${fireTick}`);
  ok(hitFlag === true && tg.hitTitan && rec.hurt.length === 1 && rec.hurt[0].dmg === 10, 'hostile fire hurts the titan once, hit flag true');
  ok(onFireAt === w.tick && onFireHurts === 1, 'onFire invoked once, after the damage');
  ok(!tg.alive, 'instant telegraph dies on the fire tick');

  // miss → hit false
  resetRec();
  TL.spawnTelegraph(w, { owner: 'enemy', style: 'lane', shape: { k: 'lane', x: 10, z: 10, dir: 0, len: 20, w: 2 }, windup: 0.1, dmg: 10, kind: 'shell' });
  let missFlag: boolean | null = null;
  for (let i = 0; i < 10 && missFlag === null; i++) { tick(w); const f = w.events.find((q) => q.type === 'telegraphFire'); if (f) missFlag = (f as { hit: boolean }).hit; }
  ok(missFlag === false && rec.hurt.length === 0, 'miss → hit=false, no damage');

  // active: dps 10 for 1.0 s → 5 ticks × 2 = 10 total; alive until the active window ends
  resetRec();
  w.titan.iframeT = 0;
  const act = TL.spawnTelegraph(w, { owner: 'boss', style: 'cone', shape: { k: 'cone', x: 0, z: -5, dir: 0, half: 0.5, r: 20 }, windup: 0.5, dmg: 10, kind: 'breath', active: 1.0 });
  const hurtTicks: number[] = [];
  let deadAt = -1;
  for (let i = 1; i <= 60; i++) {
    const n0 = rec.hurt.length;
    tick(w);
    if (rec.hurt.length > n0) hurtTicks.push(i);
    if (!act.alive && deadAt < 0) deadAt = i;
  }
  const tot = rec.hurt.reduce((s, v) => s + v.dmg, 0);
  ok(hurtTicks.join(',') === '15,21,27,33,39', 'active ticks at 5 Hz from the fire tick', `ticks ${hurtTicks.join(',')}`);
  ok(near(tot, 10), 'active total = dps × active', `total ${tot}`);
  ok(deadAt === 45, 'alive = false when windup + active elapsed', `dead at step ${deadAt}`);

  // titan-owned telegraph damages the enemy side (not the titan)
  resetRec();
  const foe = addEnemy(w, 'android', 20, 0, { hp: 50, maxHp: 50 });
  TL.spawnTelegraph(w, { owner: 'titan', style: 'circle', shape: { k: 'circle', x: 20, z: 0, r: 2 }, windup: 0.2, dmg: 12, kind: 'stomp' });
  for (let i = 0; i < 8; i++) tick(w);
  ok(foe.hp === 38 && rec.hurt.length === 0, 'titan-owned telegraph hits enemies, never the titan', `foe hp ${foe.hp}`);

  // a telegraph spawned from inside stepTelegraphs (onFire) starts NEXT tick
  let childFire = -1, parentFire = -1;
  TL.spawnTelegraph(w, {
    owner: 'enemy', style: 'circle', shape: { k: 'circle', x: 50, z: 50, r: 1 }, windup: 0, dmg: 1, kind: 'generic',
    onFire: (ww) => { parentFire = ww.tick; TL.spawnTelegraph(ww, { owner: 'enemy', style: 'circle', shape: { k: 'circle', x: 50, z: 50, r: 1 }, windup: 0, dmg: 1, kind: 'generic', onFire: (w2) => { childFire = w2.tick; } }); },
  });
  for (let i = 0; i < 4; i++) tick(w);
  ok(parentFire > 0 && childFire === parentFire + 1, 'nested spawn during stepTelegraphs starts next tick', `parent ${parentFire} child ${childFire}`);
}

// ══════════════════════════════ 5. projectiles: lob landing, straight, pierce, cap ══════════════════════════════
section('projectiles: lob lands on (tx,tz) with its circle telegraph; straight hits; pierce order; cap');
{
  const w = makeWorld();
  resetRec();
  w.titan.x = 37.3; w.titan.z = -12.9; w.titan.radius = 2;
  const p = PR.spawnProjectile(w, { owner: 'enemy', kind: 'mortar', x: 0, z: 0, vx: 0, vz: 0, dmg: 30, lob: true, tx: 37.3, tz: -12.9, aoe: 6, life: 1.8 });
  ok(p.tg >= 0 && w.telegraphs.some((t) => t.id === p.tg && t.style === 'circle' && t.shape.k === 'circle' && (t.shape as { r: number }).r === 6),
    'lob auto-paints a circle telegraph r = aoe');
  let landStep = -1, lx = NaN, lz = NaN, tgFireStep = -1, maxY = 0;
  for (let i = 1; i <= 90 && landStep < 0; i++) {
    tick(w);
    maxY = Math.max(maxY, p.y);
    const ex = w.events.find((q) => q.type === 'explosion');
    if (ex) { landStep = i; lx = (ex as { x: number }).x; lz = (ex as { z: number }).z; }
    if (w.events.some((q) => q.type === 'telegraphFire' && q.id === p.tg)) tgFireStep = i;
  }
  const err = Math.hypot(lx - 37.3, lz + 12.9);
  ok(err < 0.1, 'lob landing position error < 0.1 m', `err ${err.toExponential(2)} m at step ${landStep}`);
  ok(landStep === 54, 'lands after life 1.8 s = 54 steps', `step ${landStep}`);
  ok(tgFireStep === landStep, 'its telegraph fires on the landing tick', `tg fire step ${tgFireStep}`);
  ok(maxY > 5, 'parabolic arc (apex > 5 m)', `apex ${maxY.toFixed(1)} m`);
  ok(rec.hurt.length === 1 && rec.hurt[0].dmg === 30, 'landing damages the titan inside the aoe');

  // straight titan shot, pierce 1: hits the two nearest along the path IN ORDER, then dies
  const w2 = makeWorld();
  const e3 = addEnemy(w2, 'android', 0, 9, { hp: 100, maxHp: 100 });
  const e1 = addEnemy(w2, 'android', 0, 3, { hp: 100, maxHp: 100 });
  const e2 = addEnemy(w2, 'android', 0.3, 6, { hp: 100, maxHp: 100 });
  const s = PR.spawnProjectile(w2, { owner: 'titan', kind: 'rubbleShot', x: 0, z: 0, vx: 0, vz: 40, dmg: 10, pierce: 1, crit: false });
  const order: number[] = [];
  for (let i = 0; i < 30 && s.alive; i++) {
    tick(w2);
    for (const ev of w2.events) if (ev.type === 'enemyHit') order.push(ev.id);
  }
  ok(order.join(',') === `${e1.id},${e2.id}` && e3.hp === 100 && !s.alive, 'pierce 1 → two nearest along the path, in order', `order ${order.join(',')}`);

  // hostile pellet vs moving titan
  const w3 = makeWorld();
  resetRec();
  w3.titan.x = 0; w3.titan.z = 10;
  PR.spawnProjectile(w3, { owner: 'enemy', kind: 'pellet', x: 0, z: 0, vx: 0, vz: 30, dmg: 3 });
  for (let i = 0; i < 20; i++) tick(w3);
  ok(rec.hurt.length === 1 && w3.events.length >= 0 && w3.projectiles.every((q) => !q.alive), 'hostile pellet hits the titan circle (swept) and dies');

  // cap: fill with titan shots + hostile pellets; overflow drops the OLDEST hostile pellets first
  const w4 = makeWorld();
  for (let i = 0; i < 100; i++) PR.spawnProjectile(w4, { owner: 'titan', kind: 'spark', x: 400, z: i, vx: 0, vz: 0, dmg: 1, life: 60, crit: false });
  const pellets = [];
  for (let i = 0; i < CITY.maxProjectiles - 100; i++) pellets.push(PR.spawnProjectile(w4, { owner: 'enemy', kind: 'pellet', x: -400, z: i, vx: 0, vz: 0, dmg: 1, life: 60 }));
  for (let i = 0; i < 25; i++) PR.spawnProjectile(w4, { owner: 'enemy', kind: 'shell', x: -300, z: i, vx: 0, vz: 0, dmg: 1, life: 60 });
  const alive = w4.projectiles.filter((q) => q.alive).length;
  const titanAlive = w4.projectiles.filter((q) => q.alive && q.owner === 'titan').length;
  ok(alive === CITY.maxProjectiles && titanAlive === 100 && pellets.slice(0, 25).every((q) => !q.alive) && pellets[25].alive,
    'maxProjectiles respected; oldest hostile pellets dropped first', `alive ${alive}, titan ${titanAlive}`);
}

// ══════════════════════════════ 6. hazards ══════════════════════════════
section('hazards: 5 Hz dps to the opposing side, frost slows, lifetime');
{
  const w = makeWorld();
  resetRec();
  const foe = addEnemy(w, 'android', 5, 0, { hp: 100, maxHp: 100 });
  const hz = HZ.spawnHazard(w, { owner: 'titan', kind: 'magma', shape: { k: 'circle', x: 5, z: 0, r: 2 }, life: 1.0, dps: 10 });
  const hpTrace: number[] = [];
  for (let i = 1; i <= 40; i++) { tick(w); hpTrace.push(foe.hp); }
  ok(near(100 - foe.hp, 10), 'titan magma: 1 s × 10 dps = 10 dmg to the enemy', `dealt ${100 - foe.hp}`);
  ok(!hz.alive && rec.hurt.length === 0, 'expires after life; never hurts the titan');
  ok(near(hpTrace[0], 98), 'first 5 Hz tick lands on the first step', `hp after step 1 = ${hpTrace[0]}`);
  const fr = HZ.spawnHazard(w, { owner: 'titan', kind: 'frost', shape: { k: 'circle', x: 5, z: 0, r: 2 }, life: 2 });
  tick(w);
  ok(foe.slowT > 0 && near(foe.slowMul, 0.6), 'titan frost slows enemies 40 %', `slowT ${foe.slowT} mul ${foe.slowMul}`);
  const hf = HZ.spawnHazard(w, { owner: 'boss', kind: 'frost', shape: { k: 'circle', x: 0, z: 0, r: 5 }, life: 2 });
  tick(w);
  ok(w.titan.slowT > 0 && near(w.titan.slowMul, 0.6), 'hostile frost slows the titan 40 %');
  fr.alive = false; hf.alive = false;
}

// ══════════════════════════════ 7. pickups ══════════════════════════════
section('pickups: burst + land ~0.5 s, magnet catches a fleeing titan, collection effects');
{
  const w = makeWorld();
  w.titan.height = 5; w.titan.radius = 5 * 0.42; w.titan.rank = 1;
  resetRec();
  PK.spawnPickup(w, 'rubble', 30, 0, 3, 5);
  const p = w.pickups[0];
  let landed = -1;
  for (let i = 1; i <= 40 && landed < 0; i++) { tick(w); if (p.y === 0 && p.vy === 0) landed = i; }
  ok(landed >= 13 && landed <= 17, 'burst lands in ~0.5 s', `landed at step ${landed} (${(landed / 30).toFixed(2)} s)`);
  ok(!p.magnet, 'outside the magnet radius it rests');
  // titan runs AWAY at max speed; start just inside the magnet radius (1.6 × 5 + 2 = 10 m)
  const vmax = 3.2 + 1.9 * Math.pow(5, 0.8);
  w.titan.x = p.x - 9.5; w.titan.z = p.z;
  let caught = -1;
  let prevGap = Infinity, grewAfter = false;
  for (let i = 1; i <= 300 && caught < 0; i++) {
    w.titan.x -= vmax * w.dt;   // fleeing along −X
    tick(w);
    if (!p.alive) { caught = i; break; }
    const gap = Math.hypot(p.x - w.titan.x, p.z - w.titan.z);
    if (i > 10 && gap > prevGap + 1e-9) grewAfter = true;
    prevGap = gap;
  }
  ok(caught > 0 && caught < 90, 'magnet catches a titan fleeing at max speed', `caught after ${(caught / 30).toFixed(2)} s`);
  ok(!grewAfter, 'gap shrinks monotonically once the pull is at speed');
  ok(near(rec.xp, 3) && near(rec.mass, 5), 'rubble → gainXp + gainMass', `xp ${rec.xp} mass ${rec.mass}`);
  const pev = w.events.find((q) => q.type === 'pickup');
  ok(!!pev, 'pickup event emitted');

  // rubbleHeal × rank hpMul; heal pickup = 10 % maxHp; chest → chestDrafts + chest event
  w.titan.stats.rubbleHeal = 2; w.titan.hp = 100; w.titan.maxHp = 1000;
  resetRec();
  PK.spawnPickup(w, 'scrap', w.titan.x, w.titan.z, 1, 1);
  PK.spawnPickup(w, 'heal', w.titan.x, w.titan.z, 0, 0);
  PK.spawnPickup(w, 'chest', w.titan.x, w.titan.z, 0, 0);
  let chestEv = false, chestAlert = 0;
  for (let i = 0; i < 30; i++) {
    tick(w);
    if (w.events.some((q) => q.type === 'chest')) chestEv = true;
    chestAlert += w.events.filter((q) => q.type === 'alert' && q.key === 'chest').length;
  }
  ok(rec.heal.some((h) => near(h, 2 * RANKS[1].hpMul)), 'rubbleHeal × rank hpMul per pickup', `heals ${rec.heal.join(',')}`);
  ok(rec.heal.some((h) => near(h, 100)), 'heal pickup restores 10 % maxHp');
  ok(w.upgrades.chestDrafts === 1 && chestEv, 'chest → upgrades.chestDrafts++ and chest event');
  ok(chestAlert === 1, 'chest collection raises exactly one SUPPLY CRATE alert', `alerts ${chestAlert}`);
  w.titan.stats.rubbleHeal = 0;
}

section('pickups: CITY.maxPickups merge conserves xp/mass; magnetAll collects everything');
{
  const w = makeWorld();
  w.titan.x = 5000; w.titan.z = 5000;   // far away: nothing magnetises during the fill
  let sx = 0, sm = 0;
  for (let i = 0; i < CITY.maxPickups + 250; i++) {
    const xp = 1 + (i % 7) * 0.5, mass = 2 + (i % 5);
    PK.spawnPickup(w, i % 2 ? 'rubble' : 'scrap', (i % 40) * 3, Math.floor(i / 40) * 3, xp, mass);
    sx += xp; sm += mass;
  }
  const alive = w.pickups.filter((q) => q.alive);
  const px = alive.reduce((s, q) => s + q.xp, 0), pm = alive.reduce((s, q) => s + q.mass, 0);
  ok(alive.length === CITY.maxPickups, 'alive pickups capped at CITY.maxPickups', `${alive.length}`);
  ok(near(px, sx, 1e-6) && near(pm, sm, 1e-6), 'merge keeps xp/mass totals', `xp ${px}/${sx} mass ${pm}/${sm}`);
  PK.spawnPickup(w, 'chest', 1, 1, 0, 0);
  ok(w.pickups.filter((q) => q.alive).length === CITY.maxPickups + 1, 'chests never merge away');
  // collect all: magnetAll(Infinity) then fly them home
  w.titan.x = 60; w.titan.z = 20; w.titan.height = 14; w.titan.radius = 14 * 0.42; w.titan.rank = 2;
  resetRec();
  const m = PK.magnetAll(w, Infinity);
  ok(m === CITY.maxPickups + 1, 'magnetAll returns newly magnetised count', `${m}`);
  ok(PK.magnetAll(w, Infinity) === 0, 'second magnetAll → 0 new');
  for (let i = 0; i < 30 * 20 && w.pickups.some((q) => q.alive); i++) tick(w);
  ok(w.pickups.every((q) => !q.alive), 'every magnetised pickup collected');
  ok(near(rec.xp, sx, 1e-6) && near(rec.mass, sm, 1e-6), 'collected xp/mass == spawned totals', `xp ${rec.xp.toFixed(3)} mass ${rec.mass.toFixed(3)}`);
}

// ══════════════════════════════ 8. targeting ══════════════════════════════
section('targeting: enemies → boss parts → flattenable city → oversize; tie-break by id');
{
  const w = makeWorld();
  const bFlat = addBuilding(w, 0, 8, 4, 4, 0);      // flattenable, surface 6
  const bOver = addBuilding(w, 4, 0, 2, 2, 3);      // oversize, surface 3 (nearer)
  let t = TG.findTarget(w, 0, 0, 10);
  ok(t?.kind === 'building' && t.id === bFlat.id, 'flattenable preferred over a nearer oversize block', JSON.stringify(t));
  bFlat.collapsed = true; bFlat.alive = 0;
  t = TG.findTarget(w, 0, 0, 10);
  ok(t?.kind === 'building' && t.id === bOver.id, 'oversize when nothing flattenable');
  const pos = TG.targetPos(w, t!);
  ok(near(pos.x, 3) && near(pos.z, 0), 'building targetPos = footprint point nearest the titan', JSON.stringify(pos));
  w.boss = { alive: true, introT: 0, x: 0, z: -12, parts: [{ x: 0, z: -12, r: 4 } as BossState['parts'][number], { x: 0, z: -9, r: 1 } as BossState['parts'][number]] } as unknown as BossState;
  t = TG.findTarget(w, 0, 0, 10);
  ok(t?.kind === 'boss' && t.part === 0, 'boss part preferred over the city (ties → lower index)', JSON.stringify(t));
  const d1 = addEnemy(w, 'drone', 9, 0);
  const d0 = addEnemy(w, 'android', -8.85, 0);   // same surface distance as the drone (8.4)
  SP.rebuildEnemyGrid(w);
  t = TG.findTarget(w, 0, 0, 10);
  ok(t?.kind === 'enemy' && t.e.id === Math.min(d0.id, d1.id), 'enemies first (drones included), equal distance → lower id', t?.kind === 'enemy' ? `id ${t.e.id}` : String(t));
  const t2 = TG.findTarget(w, 0, 0, 10, false);
  ok(t2?.kind === 'boss', 'preferEnemies=false → nearest of anything', JSON.stringify(t2?.kind));
  // hitTarget on a building applies the oversize rule
  resetRec();
  TG.hitTarget(w, { kind: 'building', id: bOver.id }, 8, titanOpts);
  bFlat.collapsed = false; bFlat.alive = 3;
  TG.hitTarget(w, { kind: 'building', id: bFlat.id }, 8, titanOpts);
  ok(near(rec.bld[0].amount, 8 * OVERSIZE_DAMAGE_MUL) && near(rec.bld[1].amount, 8), 'hitTarget city damage × oversize rule', rec.bld.map((b) => b.amount).join(','));
  const foe = addEnemy(w, 'android', 1, 0, { hp: 20, maxHp: 20 });
  TG.hitTarget(w, { kind: 'enemy', e: foe }, 5, titanOpts);
  ok(foe.hp === 15, 'hitTarget damages an enemy');
}

// ══════════════════════════════ 9. spatial + determinism ══════════════════════════════
section('spatial queries + whole-lane determinism');
{
  const w = makeWorld(99);
  for (let i = 0; i < 300; i++) {
    const a = i * 2.399963, r = 3 + (i % 50) * 1.7;
    addEnemy(w, i % 9 === 0 ? 'tank' : 'android', Math.sin(a) * r, Math.cos(a) * r);
  }
  SP.rebuildEnemyGrid(w);
  const out: Enemy[] = [];
  SP.nearestEnemies(w, 1, 1, 30, 12, out);
  const brute = w.enemies.map((e) => ({ e, d: Math.max(0, Math.hypot(e.x - 1, e.z - 1) - e.radius) }))
    .filter((q) => q.d <= 30).sort((p, q) => p.d - q.d || p.e.id - q.e.id).slice(0, 12).map((q) => q.e.id).join(',');
  ok(out.map((e) => e.id).join(',') === brute, 'nearestEnemies == brute force (sorted, ties by id)');
  const inC: Enemy[] = [];
  SP.enemiesInCircle(w, -5, 7, 12, inC);
  const bc = w.enemies.filter((e) => Math.hypot(e.x + 5, e.z - 7) <= 12 + e.radius).map((e) => e.id).join(',');
  ok(inC.map((e) => e.id).join(',') === bc, 'enemiesInCircle == brute force');

  // large candidate sets through the hashed path (> the in-place sort threshold) keep world order
  const shapes: Shape[] = [
    { k: 'circle', x: 3, z: -2, r: 40 },
    { k: 'ring', x: 0, z: 0, r0: 20, r1: 60 },
    { k: 'cone', x: 0, z: 0, dir: 0.7, half: 0.9, r: 80 },
    { k: 'lane', x: -60, z: -10, dir: 1.2, len: 120, w: 14 },
    { k: 'oval', x: 10, z: 10, rx: 30, rz: 12, rot: 0.4 },
    { k: 'capsule', x0: -50, z0: 40, x1: 50, z1: -40, r: 6 },
  ];
  for (const H of [1.2, 14, 60]) {
    w.titan.height = H;
    SP.rebuildEnemyGrid(w);
    let allOk = true, maxN = 0;
    for (const s of shapes) {
      const got: Enemy[] = [];
      SP.enemiesInShape(w, s, got);
      const want = w.enemies.filter((e) => e.alive && circleInShape(s, e.x, e.z, e.radius)).map((e) => e.id).join(',');
      if (got.map((e) => e.id).join(',') !== want) allOk = false;
      maxN = Math.max(maxN, got.length);
    }
    ok(allOk && maxN > 24, `enemiesInShape == brute force, world order, big sets (cell ${Math.max(8, H)} m)`, `largest set ${maxN}`);
  }
  w.titan.height = 1.2;
  SP.rebuildEnemyGrid(w);
  {
    // re-entrancy: a query issued from inside another query's filter must not corrupt the outer one
    let inner = 0;
    const nestedOut: Enemy[] = [];
    const outer = SP.nearestEnemy(w, 1, 1, 30, (e) => { SP.enemiesInCircle(w, e.x, e.z, 5, nestedOut); inner += nestedOut.length; return e.kind === 'tank'; });
    const bruteTank = w.enemies.filter((e) => e.kind === 'tank')
      .map((e) => ({ e, d: Math.max(0, Math.hypot(e.x - 1, e.z - 1) - e.radius) }))
      .filter((q) => q.d <= 30).sort((p, q) => p.d - q.d || p.e.id - q.e.id)[0];
    ok(!!outer && !!bruteTank && outer.id === bruteTank.e.id && inner > 0, 'nested query inside a filter keeps the outer result', `tank ${outer?.id} inner hits ${inner}`);
  }

  const run = (seed: number) => {
    const ww = makeWorld(seed);
    ww.titan.stats.critChance = 0.3;
    for (let i = 0; i < 120; i++) addEnemy(ww, i % 3 ? 'android' : 'buggy', Math.sin(i) * 25, Math.cos(i * 1.3) * 25, { hp: 30, maxHp: 30 });
    for (let k = 0; k < 90; k++) {
      SP.rebuildEnemyGrid(ww);
      if (k % 10 === 0) PR.spawnProjectile(ww, { owner: 'titan', kind: 'rubbleShot', x: 0, z: 0, vx: Math.sin(k) * 30, vz: Math.cos(k) * 30, dmg: 9, pierce: 2 });
      if (k % 15 === 0) TL.spawnTelegraph(ww, { owner: 'titan', style: 'circle', shape: { k: 'circle', x: Math.sin(k) * 10, z: 5, r: 6 }, windup: 0.3, dmg: 14, kind: 'stomp', knock: 4 });
      D.damageArea(ww, { k: 'cone', x: 0, z: 0, dir: k * 0.2, half: 0.6, r: 12 }, 4, { src: 'titan', kind: 'bite', knock: 3 });
      for (const e of ww.enemies) if (e.alive) { e.x += e.kx * ww.dt; e.z += e.kz * ww.dt; e.kx *= 0.8; e.kz *= 0.8; }
      tick(ww);
    }
    let h = 0;
    const mix = (v: number) => { h = Math.imul(h ^ Math.round(v * 1000), 0x01000193) >>> 0; };
    for (const e of ww.enemies) { mix(e.hp); mix(e.x); mix(e.z); mix(e.alive ? 1 : 0); }
    for (const p of ww.pickups) { mix(p.x); mix(p.z); mix(p.xp); }
    mix(ww.titan.kills);
    return { h, kills: ww.titan.kills, picks: ww.pickups.length };
  };
  const r1 = run(4242), r2 = run(4242);
  ok(r1.h === r2.h, 'mixed scenario: same seed ⇒ identical state hash', `hash ${r1.h.toString(16)} kills ${r1.kills} pickups ${r1.picks}`);
}

// ─────────────────────────────── report ───────────────────────────────
console.log(lines.join('\n'));
console.log(`\nprobe_combat: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
