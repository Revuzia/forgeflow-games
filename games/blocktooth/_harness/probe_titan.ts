// BLOCKTOOTH — titan-sim lane probe. Run: node _harness/probe_titan.ts   (Node 22 strips types)
// For each titan: a real world via createWorld (GRID-EAST, seed 7), a scripted driver that walks into the
// nearest flattenable food (cars/kiosks → shops as it grows), dashes, and presses the hook, for 60 s of
// ticks. Prints distance moved, props/floors eaten, xp/level/mass/rank, an events histogram, attack and
// ability counts, kit-specific counters; asserts no NaN in titan state, same-seed determinism and that
// every kit's auto / passive / hook actually produced its events. Then a unit block exercising gainXp,
// gainMass (rank-up, catch-up), hurtTitan (armor, iframes, shield, god, death), healTitan, dash charges,
// the CAISSON-4 winch leash (pull + resisting it), the HEARTHBACK shell store and acceleration feel.
//
// Parallel-build fallback: if (and only if) a module another lane owns does not exist on disk yet, a
// PROBE-LOCAL stub stands in for it (see STUBS) and the run is labelled STUBBED. The stub director spawns
// real CROSSING WARDENs through ai/enemies.ts so crush / targeting are exercised. Once the real modules
// exist the hooks never fire and the probe runs 100 % real code.
// Exit code: 0 ok, 1 assertion failure, 2 = the sim hub still cannot load.

import nodeModule from 'node:module';
import { pathToFileURL } from 'node:url';
import type { SimEvent, TitanId, TitanInput, World } from '../src/core/types.ts';

// ─────────────────────────────── missing-module stubs (probe-local) ───────────────────────────────
const SRC = pathToFileURL(process.cwd().replace(/\\/g, '/') + '/src/').href;
const STUBS: Record<string, string> = {
  'ai/director.ts': `
    import { spawnEnemy } from '${SRC}ai/enemies.ts';
    export function createDirector() {
      return { wave: 0, nextWaveT: 4, spawnBudget: 0, eliteT: Infinity, elitesSpawned: 0,
               bossT: Infinity, bossSpawned: false, squadSeq: 0, data: {} };
    }
    export function spawnRing(w) { return Math.max(14, 5 * w.titan.height); }
    export function stepDirector(w) {
      const D = w.director;
      if (w.cheats.noSpawns || w.t < D.nextWaveT) return;
      D.wave++; D.nextWaveT = w.t + 5;
      w.events.push({ type: 'waveStart', wave: D.wave });
      const r = spawnRing(w);
      for (let i = 0; i < 4; i++) {
        const a = w.rng.spawn() * Math.PI * 2;
        spawnEnemy(w, 'android', w.titan.x + Math.sin(a) * r, w.titan.z + Math.cos(a) * r);
      }
    }`,
  'ai/bosses/index.ts': `
    export function spawnBoss(w, id) {}
    export function stepBoss(w) {}
    export function damageBoss(w, part, dmg, opts) {}`,
};
const stubbed = new Set<string>();
type ResolveFn = (s: string, c: { parentURL?: string }) => { url: string; format?: string | null; shortCircuit?: boolean };
type LoadFn = (u: string, c: object) => { format?: string | null; source?: string | ArrayBuffer | null; shortCircuit?: boolean };
const reg = (nodeModule as unknown as {
  registerHooks?: (h: {
    resolve?: (s: string, c: { parentURL?: string }, next: ResolveFn) => ReturnType<ResolveFn>;
    load?: (u: string, c: object, next: LoadFn) => ReturnType<LoadFn>;
  }) => unknown;
}).registerHooks;
if (typeof reg === 'function') {
  reg({
    resolve(spec, ctx, next) {
      try { return next(spec, ctx); } catch (err) {
        if (ctx.parentURL && (spec.startsWith('.') || spec.startsWith('file:'))) {
          const href = new URL(spec, ctx.parentURL).href;
          for (const key of Object.keys(STUBS)) {
            if (href === SRC + key) { stubbed.add(key); return { url: href + '?probe-stub', format: 'module', shortCircuit: true }; }
          }
        }
        throw err;
      }
    },
    load(url, ctx, next) {
      if (url.endsWith('?probe-stub')) {
        const key = url.slice(SRC.length, -'?probe-stub'.length);
        return { format: 'module', source: STUBS[key], shortCircuit: true };
      }
      return next(url, ctx);
    },
  });
}

type WorldMod = typeof import('../src/core/world.ts');
type TitanMod = typeof import('../src/titans/titansim.ts');
type ConfigMod = typeof import('../src/core/config.ts');

let WM: WorldMod;
let TM: TitanMod;
let CFG: ConfigMod;
let draft: { rollOffer?: (w: World, chest?: boolean) => string[]; pickUpgrade?: (w: World, id: string) => void } = {};
try {
  WM = await import('../src/core/world.ts');
  TM = await import('../src/titans/titansim.ts');
  CFG = await import('../src/core/config.ts');
} catch (err) {
  console.log('SKIP: the sim hub cannot load yet (another lane\'s module is missing):');
  console.log('  ' + String((err as Error).message).split('\n')[0]);
  process.exit(2);
}
try { draft = await import('../src/upgrades/draft.ts'); } catch { /* drafts optional for this probe */ }
if (stubbed.size) console.log(`NOTE: STUBBED (missing on disk, probe-local stand-ins): ${[...stubbed].join(', ')}`);
else console.log('NOTE: all sim modules real (no stubs)');

const TITANS: TitanId[] = ['molo', 'voltkite', 'hearthback', 'briarwick'];
const SECONDS = 60;
const HZ = 30;
let failures = 0;
const fail = (msg: string) => { failures++; console.log('  FAIL ' + msg); };

function finiteDeep(o: unknown, path: string, out: string[]): void {
  if (typeof o === 'number') { if (!Number.isFinite(o) && o !== Infinity) out.push(path); return; }
  if (!o || typeof o !== 'object') return;
  for (const k of Object.keys(o as Record<string, unknown>)) finiteDeep((o as Record<string, unknown>)[k], path + '.' + k, out);
}

function titanHash(w: World): string {
  const T = w.titan;
  const nums = [T.x, T.z, T.heading, T.hp, T.mass, T.xp, T.level, T.rank, T.height, T.kills, T.floorsEaten, T.propsEaten,
    T.damageTaken, w.enemies.filter((e) => e.alive).length, w.pickups.filter((p) => p.alive).length, w.nextId];
  for (const k of Object.keys(T.kit).sort()) nums.push(T.kit[k]);
  return nums.map((v) => (Math.round(v * 1e4) / 1e4).toString()).join('|');
}

/** Nearest flattenable food: props and buildings the titan can flatten, by distance. */
function pickTarget(w: World): { x: number; z: number } | null {
  const T = w.titan;
  const flat = [0, 1, 2, 3, 4][T.rank];
  let best: { x: number; z: number } | null = null, bd = Infinity;
  for (const p of w.city.props) {
    if (!p.alive || p.tier > flat) continue;
    const d = Math.hypot(p.x - T.x, p.z - T.z);
    if (d < bd) { bd = d; best = { x: p.x, z: p.z }; }
  }
  for (const b of w.city.buildings) {
    if (b.collapsed || b.alive <= 0 || b.tier > flat) continue;
    const cx = Math.max(b.x - b.w / 2, Math.min(T.x, b.x + b.w / 2));
    const cz = Math.max(b.z - b.d / 2, Math.min(T.z, b.z + b.d / 2));
    const d = Math.hypot(cx - T.x, cz - T.z) * 0.9;           // mild preference for buildings (floors = mass)
    if (d < bd) { bd = d; best = { x: b.x, z: b.z }; }
  }
  return best;
}

interface RunResult {
  hash: string; dist: number; ev: Map<string, number>; attacks: Map<string, number>; abilities: number;
  dashes: number; nanAt: string | null; w: World; pickedUpgrades: number; maxWires: number; maxTurrets: number;
  maxStored: number; stompExpl: number; vacuumTicks: number; maxHazards: Map<string, number>; rankT: string[];
  arcMaxHits: number; seeds: number; maxShield: number;
}

function run(titan: TitanId): RunResult {
  const w = WM.createWorld({ titan, biome: 'grideast', seed: 7 });
  const ev = new Map<string, number>();
  const attacks = new Map<string, number>();
  const maxHazards = new Map<string, number>();
  let dist = 0, abilities = 0, dashes = 0, nanAt: string | null = null, picked = 0;
  let maxWires = 0, maxTurrets = 0, maxStored = 0, stompExpl = 0, vacuumTicks = 0;
  const rankT: string[] = [];
  let arcMaxHits = 0, maxShield = 0;
  const seedIds = new Set<number>();
  let tgt: { x: number; z: number } | null = null;
  let stuck = 0, lastX = w.titan.x, lastZ = w.titan.z, detour = 0;
  const input: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
  const ticks = SECONDS * HZ;
  for (let i = 0; i < ticks && !w.run.result; i++) {
    const T = w.titan;
    if (i % 10 === 0 || !tgt) tgt = pickTarget(w);
    let mx = 0, mz = 0;
    if (tgt) { const dx = tgt.x - T.x, dz = tgt.z - T.z, d = Math.hypot(dx, dz) || 1; mx = dx / d; mz = dz / d; }
    if (detour > 0) { detour--; const a = Math.atan2(mx, mz) + Math.PI / 2; mx = Math.sin(a); mz = Math.cos(a); }
    input.mx = mx; input.mz = mz;
    input.dash = i % 90 === 45;                                 // a dash every 3 s
    input.ability = i % 150 === 75;                             // the hook every 5 s
    input.abilityHeld = input.ability;
    const x0 = T.x, z0 = T.z;
    WM.stepWorld(w, input);
    dist += Math.hypot(w.titan.x - x0, w.titan.z - z0);
    if (i % 30 === 29) {                                        // stuck → side-step for 0.5 s
      if (Math.hypot(w.titan.x - lastX, w.titan.z - lastZ) < 0.2 * w.titan.height) { stuck++; detour = 15; }
      lastX = w.titan.x; lastZ = w.titan.z;
    }
    for (const e of w.events as SimEvent[]) {
      ev.set(e.type, (ev.get(e.type) ?? 0) + 1);
      if (e.type === 'titanAttack') attacks.set(e.attack, (attacks.get(e.attack) ?? 0) + 1);
      if (e.type === 'ability') abilities++;
      if (e.type === 'dash') dashes++;
      if (e.type === 'explosion' && e.kind === 'stomp') stompExpl++;
      if (e.type === 'arc' && e.kind === 'fork') arcMaxHits = Math.max(arcMaxHits, e.pts.length / 2 - 1);
      if (e.type === 'rankUp') rankT.push(`${['I', 'II', 'III', 'IV', 'V'][e.rank]}@${w.t.toFixed(1)}s`);
    }
    const K = w.titan.kit;
    maxWires = Math.max(maxWires, K.wires ?? 0);
    maxTurrets = Math.max(maxTurrets, K.turrets ?? 0);
    maxStored = Math.max(maxStored, K.stored ?? 0);
    if ((K.vacuumT ?? 0) > 0) vacuumTicks++;
    maxShield = Math.max(maxShield, w.upgrades.shield);
    for (const p of w.projectiles) if (p.alive && p.owner === 'titan' && p.kind === 'seed') seedIds.add(p.id);
    const hz = new Map<string, number>();
    for (const h of w.hazards) if (h.alive && h.owner === 'titan') hz.set(h.kind, (hz.get(h.kind) ?? 0) + 1);
    for (const [k, v] of hz) maxHazards.set(k, Math.max(maxHazards.get(k) ?? 0, v));
    // drafts: take the first card (the app freezes the sim while drafting; the probe just picks)
    while (w.upgrades.pendingDrafts > 0 && draft.rollOffer && draft.pickUpgrade) {
      const offer = draft.rollOffer(w);
      if (!offer || offer.length === 0) break;
      draft.pickUpgrade(w, offer[0]);
      picked++;
    }
    if (!nanAt) {
      const bad: string[] = [];
      finiteDeep(w.titan, 'titan', bad);
      if (bad.length) nanAt = `tick ${w.tick}: ${bad.slice(0, 6).join(', ')}`;
    }
  }
  return {
    hash: titanHash(w), dist, ev, attacks, abilities, dashes, nanAt, w, pickedUpgrades: picked,
    maxWires, maxTurrets, maxStored, stompExpl, vacuumTicks, maxHazards, rankT,
    arcMaxHits, seeds: seedIds.size, maxShield,
  };
}

const AUTO: Record<TitanId, string> = { molo: 'curbBite', voltkite: 'forkArc', hearthback: 'magmaStomp', briarwick: 'vineLash' };

console.log(`probe_titan — ${SECONDS}s scripted drive per titan, GRID-EAST seed 7`);
for (const id of TITANS) {
  const t0 = process.hrtime.bigint();
  const r = run(id);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const T = r.w.titan;
  const ev = (k: string) => r.ev.get(k) ?? 0;
  console.log(`\n[${id}] ${ms.toFixed(0)} ms wall (${(ms / (SECONDS * HZ)).toFixed(3)} ms/tick)  alive=${T.alive} t=${r.w.t.toFixed(1)}s`);
  console.log(`  moved ${r.dist.toFixed(1)} m | props eaten ${T.propsEaten} | floors eaten ${T.floorsEaten} | leveled ${T.buildingsLeveled} | kills ${T.kills} (crushed ${T.crushed})`);
  console.log(`  xp ${T.xp.toFixed(1)}/${T.xpToNext} LV ${T.level} | mass ${T.mass.toFixed(1)} rank ${['I', 'II', 'III', 'IV', 'V'][T.rank]} H ${T.height.toFixed(2)} m | hp ${T.hp.toFixed(1)}/${T.maxHp.toFixed(1)} dmgTaken ${T.damageTaken.toFixed(1)} | drafts picked ${r.pickedUpgrades} | rank-ups ${r.rankT.join(' ') || '-'}`);
  console.log(`  abilities ${r.abilities} | dashes ${r.dashes} | attacks ${[...r.attacks].map(([k, v]) => `${k}:${v}`).join(' ')}`);
  console.log(`  kit ${Object.entries(T.kit).filter(([k]) => !k.startsWith('sim_')).map(([k, v]) => `${k}=${Math.round(v * 100) / 100}`).join(' ')}`);
  console.log(`  titan hazards (max live) ${[...r.maxHazards].map(([k, v]) => `${k}:${v}`).join(' ') || '-'} | stomp eruptions ${r.stompExpl} | vacuum ticks ${r.vacuumTicks} | max shield ${r.maxShield.toFixed(1)} | max stored ${r.maxStored.toFixed(1)} | longest arc ${r.arcMaxHits} hits | seeds fired ${r.seeds}`);
  console.log(`  events ${[...r.ev].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  if (r.nanAt) fail(`${id}: non-finite titan state at ${r.nanAt}`);
  if (r.dist < 20) fail(`${id}: moved only ${r.dist.toFixed(1)} m`);
  if (T.propsEaten + T.floorsEaten === 0) fail(`${id}: ate nothing`);
  if (r.abilities === 0) fail(`${id}: hook never fired`);
  if ((r.attacks.get(AUTO[id]) ?? 0) === 0) fail(`${id}: auto ${AUTO[id]} never fired`);
  if (ev('footstep') === 0) fail(`${id}: no footsteps`);
  if (ev('dash') === 0) fail(`${id}: no dash`);
  if (ev('smash') === 0) fail(`${id}: no smash beats`);
  if (T.level <= 1) fail(`${id}: never levelled`);
  switch (id) {
    case 'molo':
      if (ev('pulse') === 0) fail('molo: no foot-pulse');
      if (r.vacuumTicks === 0) fail('molo: vacuum never channelled');
      if (!(r.maxShield > 0)) fail('molo: vacuum release granted no shield');
      break;
    case 'voltkite':
      if (ev('arc') === 0) fail('voltkite: no arc events');
      if (r.maxWires === 0) fail('voltkite: dashes laid no wires');
      if (ev('wireDetonate') === 0) fail('voltkite: no wire detonation');
      if (r.arcMaxHits < 2) fail('voltkite: fork-arc never jumped past its first target');
      break;
    case 'hearthback':
      if (r.stompExpl === 0) fail('hearthback: no stomp eruption');
      if (ev('vent') === 0) fail('hearthback: no vent');
      if (!(r.maxStored > 0)) fail('hearthback: shell never stored anything');
      break;
    case 'briarwick':
      if (ev('vine') === 0) fail('briarwick: no vine events');
      if (ev('bloomSpawn') === 0) fail('briarwick: no bloom turret');
      if (ev('spore') === 0) fail('briarwick: no spores');
      if (r.seeds === 0) fail('briarwick: bloom turrets never fired a seed');
      break;
  }
  const again = run(id);
  if (again.hash !== r.hash) fail(`${id}: NOT deterministic\n    ${r.hash}\n    ${again.hash}`);
  else console.log(`  deterministic ✓ (${r.hash.slice(0, 48)}…)`);
}

// ─────────────────────────────── unit block ───────────────────────────────
console.log('\n[unit] growth / damage API');
{
  const w = WM.createWorld({ titan: 'molo', biome: 'grideast', seed: 11 });
  const T = w.titan;
  console.log(`  createTitan: LV ${T.level} rank ${T.rank} H ${T.height} r ${T.radius.toFixed(3)} hp ${T.hp}/${T.maxHp} dash ${T.dashCharges}`);
  if (T.level !== 1 || T.rank !== 0 || Math.abs(T.height - CFG.titanHeight(0, 0)) > 1e-9 || T.hp !== T.maxHp || T.maxHp !== 140) fail('createTitan initial state');
  const lv0 = T.level;
  TM.gainXp(w, 500);
  const lvEv = w.events.filter((e) => e.type === 'levelUp').length;
  console.log(`  gainXp(500): LV ${lv0} → ${T.level}, pendingDrafts ${w.upgrades.pendingDrafts}, levelUp events ${lvEv}`);
  if (T.level <= lv0 || w.upgrades.pendingDrafts !== T.level - lv0 || lvEv !== T.level - lv0) fail('gainXp level/draft/event mismatch');

  w.events.length = 0;
  const hpMax0 = T.maxHp;
  T.hp = hpMax0 * 0.5;
  const m1 = CFG.RANKS[0].massToNext;              // the economy table in config.ts owns this number
  TM.gainMass(w, m1);
  const ru = w.events.filter((e) => e.type === 'rankUp').length;
  console.log(`  gainMass(${m1}): rank ${T.rank}, growT ${T.growT.toFixed(2)}, maxHp ${hpMax0} → ${T.maxHp.toFixed(1)}, hp ${T.hp.toFixed(1)} (expect 65 % of max), rankUp events ${ru}`);
  if (T.rank !== 1 || ru !== 1) fail(`gainMass(${m1}) should rank up exactly once`);
  if (Math.abs(T.hp / T.maxHp - 0.65) > 0.01) fail('rank-up hp should keep ratio then +15 %');
  let peak = 0;
  w.cheats.noSpawns = true;
  for (let i = 0; i < 40; i++) { WM.stepWorld(w, WM.NO_INPUT); peak = Math.max(peak, T.height); }
  console.log(`  grow tween: peak H ${peak.toFixed(3)} (easeOutBack overshoot), settled H ${T.height.toFixed(3)}, radius ${T.radius.toFixed(3)}`);
  if (!(T.height >= 5 && T.height < 5 * 1.13)) fail('height after grow tween out of range');
  if (!(peak > 5.0)) fail('grow tween never reached rank II height');

  // catch-up rubber band: 1 min behind the rank III schedule → × 1.6
  const m0 = T.mass;
  const tSave = w.t;
  w.t = CFG.RANK_SCHEDULE_S[2] + 60;
  TM.gainMass(w, 10);
  const got = T.mass - m0;
  w.t = tSave;
  console.log(`  catch-up: gainMass(10) at 1 min behind → +${got.toFixed(2)} (expect ${(10 * Math.min(CFG.CATCHUP_MAX, 1 + CFG.CATCHUP_PER_MIN)).toFixed(2)})`);
  if (Math.abs(got - 10 * Math.min(CFG.CATCHUP_MAX, 1 + CFG.CATCHUP_PER_MIN)) > 1e-6) fail('catch-up multiplier');

  w.events.length = 0;
  w.upgrades.shield = 0;
  T.iframeT = 0;
  const armor = T.stats.armor;
  const hp0 = T.hp;
  const took = TM.hurtTitan(w, 50, 'bullet', T.x + 5, T.z);
  const expect = 50 * 100 / (100 + armor);
  console.log(`  hurtTitan(50) armor ${armor}: took ${took.toFixed(2)} (expect ${expect.toFixed(2)}), iframes ${T.iframeT.toFixed(2)}, titanHurt events ${w.events.filter((e) => e.type === 'titanHurt').length}`);
  if (Math.abs(took - expect) > 1e-6 || Math.abs(hp0 - T.hp - took) > 1e-6) fail('armor math');
  if (Math.abs(T.damageTaken - took) > 1e-6) fail('damageTaken counter');
  const again = TM.hurtTitan(w, 50, 'bullet', T.x, T.z);
  if (again !== 0) fail('iframes should block a second hit');
  T.iframeT = 0;
  w.upgrades.shield = 1000;
  const shielded = TM.hurtTitan(w, 50, 'bullet', T.x, T.z);
  console.log(`  shield 1000: took ${shielded}, shield left ${w.upgrades.shield.toFixed(2)}`);
  if (shielded !== 0 || !(w.upgrades.shield < 1000)) fail('shield should absorb first');
  T.iframeT = 0; w.upgrades.shield = 0; w.cheats.god = true;
  if (TM.hurtTitan(w, 1e9, 'shell', T.x, T.z) !== 0 || !T.alive) fail('god cheat');
  w.cheats.god = false;
  const hpB = T.hp;
  TM.healTitan(w, 5);
  if (!(T.hp > hpB) || !w.events.some((e) => e.type === 'titanHeal')) fail('healTitan');
  T.iframeT = 0;
  TM.hurtTitan(w, 1e9, 'shell', T.x, T.z);
  console.log(`  lethal hit → alive=${T.alive} hp=${T.hp}`);
  if (T.alive || T.hp !== 0) fail('death');
  console.log(`  titanMaxSpeed at H=${T.height.toFixed(2)}: ${TM.titanMaxSpeed(w).toFixed(2)} m/s`);
}

{
  // dash: charges, i-frames, distance, recharge (VOLT-KITE: 2 charges, dashCooldown 0.75 → 2.25 s each)
  const w = WM.createWorld({ titan: 'voltkite', biome: 'grideast', seed: 5 });
  w.cheats.noSpawns = true;
  const T = w.titan;
  const inp: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: true };
  const c0 = T.dashCharges;
  const hx = T.x, hz = T.z;
  WM.stepWorld(w, inp);                                           // tick 1: first dash
  const afterOne = T.dashCharges, ifr = T.iframeT;
  inp.dash = false;
  let dashTicks = 1;
  while (T.dashT > 0 && dashTicks < 20) { WM.stepWorld(w, inp); dashTicks++; }
  const dashMoved = Math.hypot(T.x - hx, T.z - hz);               // path length at the moment the dash ends
  const dashWant = T.stats.dashDistance * T.height;
  for (let i = dashTicks; i < 11; i++) WM.stepWorld(w, inp);      // pad to tick 11 (dash lasts 0.22 s)
  const wiresAfterDash = T.kit.wires;
  inp.dash = true; WM.stepWorld(w, inp); inp.dash = false;        // tick 12: second dash
  const afterTwo = T.dashCharges;
  inp.dash = true; WM.stepWorld(w, inp); inp.dash = false;        // tick 13: no charge left
  const blocked = T.dashCharges;
  let rechargeT = -1;
  for (let i = 0; i < 200; i++) { WM.stepWorld(w, inp); if (rechargeT < 0 && T.dashCharges >= 1) rechargeT = (14 + i) / HZ; }
  const per = 3 * T.stats.dashCooldown;
  console.log(`  dash: charges ${c0} → ${afterOne} → ${afterTwo} (3rd press → ${blocked}), iframes ${ifr.toFixed(2)} s, moved ${dashMoved.toFixed(3)} m in ${dashTicks} ticks (dashDistance ${T.stats.dashDistance} × H = ${dashWant.toFixed(3)}), wires after dash ${wiresAfterDash}, first charge back ${rechargeT.toFixed(2)} s after the first dash (expect ${per.toFixed(2)})`);
  if (c0 !== 2 || afterOne !== 1 || afterTwo !== 0 || blocked !== 0) fail('dash charge accounting');
  if (!(ifr > 0.25)) fail('dash i-frames');
  if (Math.abs(dashMoved - dashWant) > 0.03 * dashWant) fail(`dash distance ${dashMoved} vs ${dashWant}`);
  if (Math.abs(rechargeT - (1 / HZ + per)) > 2 / HZ) fail(`dash recharge ${rechargeT} (expect ~${per} s after the first dash)`);
  if (!(wiresAfterDash >= 1)) fail('voltkite dash should leave a wire');
}

for (const [rank, strength] of [[0, 3], [2, 12], [4, 12]] as const) {
  // CAISSON-4 winch leash: pulled toward the anchor when idle; the player can resist by walking away.
  // (contract pull = 12 m/s; Size I uses a scaled-down pull so the test fits the open ground at spawn)
  const w = WM.createWorld({ titan: 'hearthback', biome: 'grideast', seed: 9 });
  w.cheats.noSpawns = true;
  const T = w.titan;
  const idle: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
  // enough mass to reach `rank` from Size I (cumulative config massToNext, +5 %), at t = 0
  const toRank = CFG.RANKS.slice(0, rank).reduce((a, r) => a + r.massToNext, 0) * 1.05;
  if (rank > 0) { TM.gainMass(w, rank === 4 ? 1e6 : toRank); for (let i = 0; i < 40; i++) WM.stepWorld(w, idle); }
  const fx = Math.sin(T.heading), fz = Math.cos(T.heading);
  const ax = T.x + fx * 400, az = T.z + fz * 400;                 // anchor far ahead
  const dAnchor = () => Math.hypot(ax - T.x, az - T.z);
  T.leash = { t: 0.5, lx: ax, lz: az, strength };
  const d0 = dAnchor();
  for (let i = 0; i < 12; i++) WM.stepWorld(w, idle);
  const d1 = dAnchor();
  let offEv = 0;
  for (let i = 0; i < 20; i++) { WM.stepWorld(w, idle); offEv += w.events.filter((e) => e.type === 'leash' && !e.on).length; }
  // turn around and get up to speed first, then attach the leash while walking away
  const away: TitanInput = { mx: -fx, mz: -fz, ability: false, abilityHeld: false, dash: false };
  for (let i = 0; i < 20; i++) WM.stepWorld(w, away);
  T.leash = { t: 1.0, lx: ax, lz: az, strength };
  const d2 = dAnchor();
  for (let i = 0; i < 15; i++) WM.stepWorld(w, away);
  const d3 = dAnchor();
  console.log(`  leash Size ${['I', 'II', 'III', 'IV', 'V'][T.rank]} pull ${strength} m/s (max speed ${TM.titanMaxSpeed(w).toFixed(1)}): idle ${d0.toFixed(2)} → ${d1.toFixed(2)} m from anchor; walking away while leashed ${d2.toFixed(2)} → ${d3.toFixed(2)} m; off events ${offEv}`);
  if (!(d1 < d0 - strength * 0.2)) fail('leash should pull the idle titan toward the anchor');
  if (!(d3 > d2)) fail(`Size ${T.rank + 1}: walking away should beat the leash pull`);
  if (offEv !== 1) fail('leash expiry should emit exactly one leash-off event');
}

{
  // HEARTHBACK shell: 60 % of post-armor damage stored; vent resets + heals
  const w = WM.createWorld({ titan: 'hearthback', biome: 'grideast', seed: 13 });
  w.cheats.noSpawns = true;
  const T = w.titan;
  T.iframeT = 0;
  const took = TM.hurtTitan(w, 40, 'shell', T.x, T.z);
  const stored = T.kit.stored;
  console.log(`  shell: took ${took.toFixed(2)} → stored ${stored.toFixed(2)} (expect ${(took * 0.6).toFixed(2)}), cap ${T.kit.cap}`);
  if (Math.abs(stored - took * 0.6) > 1e-6) fail('shell store');
  const hpBefore = T.hp;
  WM.stepWorld(w, { mx: 0, mz: 0, ability: true, abilityHeld: true, dash: false });
  console.log(`  vent: stored → ${T.kit.stored}, hp ${hpBefore.toFixed(2)} → ${T.hp.toFixed(2)}, vent events ${w.events.filter((e) => e.type === 'vent').length}, cd ${T.abilityCd.toFixed(2)}`);
  if (T.kit.stored !== 0 || !(T.hp > hpBefore) || !w.events.some((e) => e.type === 'vent')) fail('vent reset/heal/event');
}

{
  // acceleration feel: time to reach 95 % of max speed from rest at Size I, and at Size V
  for (const rank of [0, 4] as const) {
    const w = WM.createWorld({ titan: 'voltkite', biome: 'grideast', seed: 3 });
    w.cheats.noSpawns = true;
    const T = w.titan;
    if (rank === 4) { TM.gainMass(w, 1e6); for (let i = 0; i < 60; i++) WM.stepWorld(w, WM.NO_INPUT); }
    const inp: TitanInput = { mx: Math.sin(T.heading), mz: Math.cos(T.heading), ability: false, abilityHeld: false, dash: false };
    const max = TM.titanMaxSpeed(w);
    const sp: number[] = [];
    for (let i = 0; i < 30; i++) { WM.stepWorld(w, inp); sp.push(T.speed); }
    const plateau = sp[sp.length - 1];
    const reach = (sp.findIndex((s) => s >= 0.95 * plateau) + 1) / HZ;
    console.log(`  accel: Size ${['I', 'II', 'III', 'IV', 'V'][T.rank]} max ${max.toFixed(2)} m/s, plateau ${plateau.toFixed(2)} m/s (${(plateau / max * 100).toFixed(0)} % — plowing/pivot), 95 % of plateau in ${reach.toFixed(3)} s`);
    const want = rank === 0 ? 0.12 : 0.3;
    if (!(reach >= want * 0.5 && reach <= want * 1.8)) fail(`Size ${rank + 1} acceleration ${reach} s (want ~${want} s)`);
  }
}

console.log(failures ? `\nprobe_titan: ${failures} FAILURE(S)` : '\nprobe_titan: OK');
process.exit(failures ? 1 : 0);
