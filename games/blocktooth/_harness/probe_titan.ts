// BLOCKTOOTH — titan-sim lane probe. Run: node _harness/probe_titan.ts   (Node 22 strips types)
// For each titan: a real world via createWorld (GRID-EAST, seed 7), a scripted driver that walks into the
// nearest flattenable food (cars/kiosks → shops as it grows), dashes, and presses the hook, for 60 s of
// ticks. Prints distance moved, props/floors eaten, xp/level/mass/rank, an events histogram, attack and
// ability counts, kit-specific counters; asserts no NaN in titan state, same-seed determinism and that
// every kit's auto / passive / hook actually produced its events. Then a unit block exercising gainXp
// (level steps, the level-driven rank-up, catch-up), gainGrowth, the retired gainMass, growToRank,
// hurtTitan (armor, iframes, shield, god, death), healTitan, dash charges,
// the CAISSON-4 winch leash (pull + resisting it), the HEARTHBACK shell store and acceleration feel.
// TITAN PASS: BRIARWICK kit C (seed pods: planted, burst, chained, POP-UP PARK cascade >= 4 pods, `rooted`
// events) replaces the old BLOOM TURRET asserts; VOLT-KITE GROUNDING lays wires with the dash never pressed.
// fb3: BRIARWICK BURR LASH aim units (best lane ahead, wind-up honesty, last-lane preference, forward arc while steering, view lane =
// damage lane, steady under a wobbling stick).
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
  /** BRIARWICK pods: bursts, deepest chain link, most bursts inside one POP-UP PARK press window, foes rooted */
  bursts: number; maxLink: number; maxPressBursts: number; rooted: number;
}

/** A POP-UP PARK press's cascade: bursts within this many seconds after the press count toward it
 *  (fuse 0.15 s + 0.06 s per rank: 20 pods ~ 1.35 s). */
const PRESS_WINDOW_S = 1.5;

function run(titan: TitanId, opts: { noDash?: boolean } = {}): RunResult {
  const w = WM.createWorld({ titan, biome: 'grideast', seed: 7 });
  const ev = new Map<string, number>();
  const attacks = new Map<string, number>();
  const maxHazards = new Map<string, number>();
  let dist = 0, abilities = 0, dashes = 0, nanAt: string | null = null, picked = 0;
  let maxWires = 0, maxTurrets = 0, maxStored = 0, stompExpl = 0, vacuumTicks = 0;
  const rankT: string[] = [];
  let arcMaxHits = 0, maxShield = 0;
  let bursts = 0, maxLink = 0, maxPressBursts = 0, rooted = 0, pressT = -1, pressN = 0;
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
    input.dash = !opts.noDash && i % 90 === 45;                 // a dash every 3 s (never, for the GROUNDING run)
    input.ability = i % 150 === 75;                             // the hook every 5 s
    input.abilityHeld = input.ability;
    const x0 = T.x, z0 = T.z;
    WM.stepWorld(w, input);
    // TITAN PASS (merge): HEARTHBACK's shell assert needs at least one landed hit. The drive used to get one by
    // luck (HEAD: 2 pellets, 3.3 dmg); the D1 draft's first-card picks change the run and the drive now dodges
    // every pellet (0 dmg), so one real enemy pellet lands at 30 s through the sim's own hurtTitan (armor, kit
    // onHurt, shield). The assert itself is unchanged.
    if (titan === 'hearthback' && i === 30 * HZ) TM.hurtTitan(w, 6, 'bullet', w.titan.x + 1, w.titan.z);
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
      if (e.type === 'ability') { maxPressBursts = Math.max(maxPressBursts, pressN); pressT = w.t; pressN = 0; }
      if (e.type === 'bloomBurst') {
        bursts++; maxLink = Math.max(maxLink, e.link);
        if (pressT >= 0 && w.t - pressT <= PRESS_WINDOW_S + 1e-9) pressN++;
      }
      if (e.type === 'rooted') rooted++;
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
  maxPressBursts = Math.max(maxPressBursts, pressN);
  return {
    hash: titanHash(w), dist, ev, attacks, abilities, dashes, nanAt, w, pickedUpgrades: picked,
    maxWires, maxTurrets, maxStored, stompExpl, vacuumTicks, maxHazards, rankT,
    arcMaxHits, seeds: seedIds.size, maxShield, bursts, maxLink, maxPressBursts, rooted,
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
  if (id === 'briarwick') console.log(`  pods: planted ${ev('bloomSpawn')} | bursts ${r.bursts} | deepest chain link ${r.maxLink} | most bursts in one POP-UP PARK window ${r.maxPressBursts} | foes rooted ${r.rooted}`);
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
      // kit C (TITAN PASS): the old turret asserts (bloomSpawn turret, spore, seeds fired) tested the retired
      // BLOOM TURRETS / SOW kit; their replacements test the pods that took over both jobs
      if (ev('vine') === 0) fail('briarwick: no vine events');
      if (ev('bloomSpawn') === 0) fail('briarwick: no seed pod planted');
      if (r.bursts === 0) fail('briarwick: no pod ever burst');
      if (r.maxLink < 2) fail(`briarwick: no pod chain reached 2 links (deepest ${r.maxLink})`);
      if (r.maxPressBursts < 4) fail(`briarwick: no POP-UP PARK press detonated 4 pods (best ${r.maxPressBursts})`);
      // (no `rooted` assert here: at Size I every foe a burst catches in this drive dies, and only survivors are
      //  rooted; the [unit] POP-UP PARK block below asserts the event on a foe that survives the ring)
      break;
  }
  const again = run(id);
  if (again.hash !== r.hash) fail(`${id}: NOT deterministic\n    ${r.hash}\n    ${again.hash}`);
  else console.log(`  deterministic ✓ (${r.hash.slice(0, 48)}…)`);
  if (id === 'voltkite') {
    // GROUNDING (TITAN PASS): every 2nd arc that strikes a foe / boss part lays a short LIVE WIRE, so the same
    // drive with the dash NEVER pressed must still put wires on the ground (RECAST has something real to blow)
    const g = run('voltkite', { noDash: true });
    const gw = g.maxHazards.get('wire') ?? 0;
    console.log(`  GROUNDING (dash never pressed): dashes ${g.dashes} | max live wires ${g.maxWires} | max wire hazards ${gw} | detonations ${g.ev.get('wireDetonate') ?? 0}`);
    if (g.dashes !== 0) fail('voltkite GROUNDING run: the dash was pressed');
    if (!(g.maxWires > 0 && gw > 0)) fail('voltkite: GROUNDING laid no wire without a dash');
  }
}

{
  // BRIARWICK POP-UP PARK, isolated: no spawns, one foe beside the horns, one press. The ring TANGLES the foe for
  // ringTangleS (a `rooted` event carrying that time), the 4-pod volley lands ripe and the cascade detonates every
  // pod outward, link 0, 1, 2, 3 ...
  console.log('\n[unit] BRIARWICK POP-UP PARK');
  const w = WM.createWorld({ titan: 'briarwick', biome: 'grideast', seed: 21 });
  w.cheats.noSpawns = true;
  const T = w.titan;
  const EN = await import('../src/ai/enemies.ts');
  const BW = await import('../src/titans/kits/briarwick.ts');
  const foe = EN.spawnEnemy(w, 'android', T.x + Math.sin(T.heading) * 0.8 * T.height, T.z + Math.cos(T.heading) * 0.8 * T.height);
  foe.hp = foe.maxHp = 1e9;                                     // survives the ring so its stun is observable
  const idle: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
  WM.stepWorld(w, { ...idle, ability: true, abilityHeld: true });
  const pressEv = w.events.filter((e) => e.type === 'ability').length;
  let rootN = 0, rootT = -1;
  for (const e of w.events as SimEvent[]) if (e.type === 'rooted') { rootN++; if (e.id === foe.id) rootT = e.t; }
  const chain = T.kit.chain;
  const links: number[] = [];
  let burstsSeen = 0;
  for (let i = 0; i < Math.ceil(PRESS_WINDOW_S * HZ); i++) {
    WM.stepWorld(w, idle);
    for (const e of w.events as SimEvent[]) if (e.type === 'bloomBurst') { burstsSeen++; links.push(e.link); }
  }
  const maxL = links.length ? Math.max(...links) : -1;
  console.log(`  press: ability events ${pressEv} | rooted events ${rootN} (foe t ${rootT.toFixed(2)} s, want ${BW.BRIAR.ringTangleS}) | cascade size ${chain} | bursts in ${PRESS_WINDOW_S} s ${burstsSeen} (links ${links.join(',')}) | cd ${T.abilityCd.toFixed(2)} s`);
  if (pressEv !== 1) fail('POP-UP PARK: one press should emit exactly one ability event');
  if (rootN === 0) fail('POP-UP PARK: TANGLE rooted nothing (no rooted events)');
  if (Math.abs(rootT - BW.BRIAR.ringTangleS) > 1e-9) fail('POP-UP PARK: the horn-stamp ring should root the adjacent foe for ringTangleS');
  if (!(chain >= BW.BRIAR.volleyN)) fail(`POP-UP PARK: cascade ${chain} < the ${BW.BRIAR.volleyN}-pod volley`);
  if (!(burstsSeen >= 4)) fail(`POP-UP PARK: detonated ${burstsSeen} pods (want >= 4)`);
  if (!(maxL >= 3)) fail(`POP-UP PARK: the cascade never reached link 3 (deepest ${maxL})`);
}

{
  // fb3 (owner playtest 2026-09-30: BURR LASH "is sloppy -- the tongue just goes out in all directions"). Isolated
  // BURR LASH aim + honesty units: no spawns, foes placed and held (stunned, unkillable) around the titan.
  //  L1 the lash takes the lane through the most foes AHEAD, not the nearest foe off to the side;
  //  L2 the crack goes where the wind-up cocked the horn (kit.lashDir committed windS before);
  //  L3 consecutive lashes at two equal clusters stay on one cluster (the last lane is preferred), no flip-flop;
  //  L4 while the stick is held the lash never whips outside the forward arc (foes only behind are not lashed);
  //     with the stick released the titan swivels and lashes them;
  //  L5 the view's lane = the damage lane: every `vine` runs from the titan's centre for exactly reach(w), and every
  //     foe standing inside that lane after the tick took a hit in it (what you see is what you hit; fx flashes them);
  //  L6 under a wobbling stick consecutive lashes keep to one lane (last-lane preference: goodFrac / trackN).
  console.log('\n[unit] BRIARWICK BURR LASH aim');
  const EN = await import('../src/ai/enemies.ts');
  const BW = await import('../src/titans/kits/briarwick.ts');
  const MA = await import('../src/core/math.ts');
  const DEGR = Math.PI / 180;
  const idle: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
  const mk = (seed: number) => {
    const w = WM.createWorld({ titan: 'briarwick', biome: 'grideast', seed });
    w.cheats.noSpawns = true;
    for (const e of w.enemies) e.alive = false;
    return w;
  };
  // placed foes are PINNED (re-placed after every tick): the lash's knockback and pod bursts scatter them, which is the
  // sim working, not the aim under test
  const pins = new Map<number, [number, number]>();
  const put = (w: World, a: number, dH: number) => {
    const T = w.titan;
    const e = EN.spawnEnemy(w, 'android', T.x + Math.sin(a) * dH * T.height, T.z + Math.cos(a) * dH * T.height);
    e.hp = e.maxHp = 1e9; e.stun = 1e9;
    pins.set(e.id, [e.x, e.z]);
    return e;
  };
  const pin = (w: World) => { for (const e of w.enemies) { const p = pins.get(e.id); if (p) { e.x = e.px = p[0]; e.z = e.pz = p[1]; } } };
  type Cast = { dir: number; hitIds: number[]; windDir: number | null; okLane: boolean; len: number };
  const laneBad: string[] = [];
  /** step until `n` vineLash casts (or maxT ticks); collects each cast's heading, the foes its lane hit, the committed wind-up */
  const casts = (w: World, n: number, maxT: number, input: TitanInput = idle): Cast[] => {
    const out: Cast[] = [];
    let windDir: number | null = null;
    for (let i = 0; i < maxT && out.length < n; i++) {
      const T = w.titan;
      pin(w);
      const x0 = T.x, z0 = T.z;
      WM.stepWorld(w, input);
      if ((T.kit.lashWind ?? -1) >= 0 && windDir === null) windDir = T.kit.lashDir;
      const evs = w.events as SimEvent[];
      const vi = evs.findIndex((e) => e.type === 'vine');
      if (vi < 0) continue;
      const v = evs[vi] as Extract<SimEvent, { type: 'vine' }>;
      const len = Math.hypot(v.x1 - v.x0, v.z1 - v.z0), dir = Math.atan2(v.x1 - v.x0, v.z1 - v.z0);
      const half = 0.5 * BW.BRIAR.lashWH * T.height * Math.max(0.1, T.stats.area || 1);
      const reachNow = BW.reach(w);
      const fx = Math.sin(dir), fz = Math.cos(dir);
      const inLane = (x: number, z: number, r: number) => {
        const dx = x - v.x0, dz = z - v.z0, along = dx * fx + dz * fz, side = dx * fz - dz * fx;
        return along >= -r - 1e-6 && along <= len + r + 1e-6 && Math.abs(side) <= half + r + 1e-6;
      };
      // the drawn lane starts at the titan, runs exactly reach(w), and every foe standing in it took a hit this tick
      // (enemyHit events are merged per foe per tick, so a pod burst earlier in the tick carries the lash's damage too)
      const hitSet = new Set<number>();
      for (const e of evs) if (e.type === 'enemyHit') hitSet.add(e.id);
      let okLane = Math.abs(len - reachNow) < 1e-6 && Math.hypot(v.x0 - x0, v.z0 - z0) < T.height * 0.5;
      const ids: number[] = [];
      for (const f of w.enemies) {
        const p = pins.get(f.id);                       // pinned foes: where they stood during the tick
        if (!f.alive || !inLane(p ? p[0] : f.x, p ? p[1] : f.z, f.radius)) continue;
        ids.push(f.id);
        if (!hitSet.has(f.id)) okLane = false;
      }
      if (!okLane) laneBad.push(`tick ${w.tick}: len ${len.toFixed(2)} vs reach ${reachNow.toFixed(2)}, foes in the lane ${ids.length}, not hit ${ids.filter((id) => !hitSet.has(id)).length}`);
      out.push({ dir, hitIds: ids, windDir, okLane, len });
      windDir = null;
    }
    return out;
  };
  const offDeg = (a: number, b: number) => Math.abs(MA.wrapAngle(a - b)) / DEGR;

  // L1 + L2: a line of 4 foes straight ahead (1.3-2.6 H) vs one closer foe 45° to the left (0.9 H)
  {
    const w = mk(21); const T = w.titan; const h = T.heading;
    const line = [1.3, 1.75, 2.2, 2.6].map((d) => put(w, h, d));
    const lone = put(w, h + 45 * DEGR, 0.9);
    const c = casts(w, 3, 150);
    const lineIds = new Set(line.map((e) => e.id));
    const inLine = c.map((k) => k.hitIds.filter((id) => lineIds.has(id)).length);
    console.log(`  L1 line ahead vs a nearer foe 45° off: ${c.length} casts | off the line ${c.map((k) => offDeg(k.dir, h).toFixed(1) + '°').join(', ')} | line foes hit ${inLine.join(', ')} | lone foe hit ${c.map((k) => k.hitIds.includes(lone.id) ? 1 : 0).join(', ')}`);
    if (c.length < 3) fail(`BURR LASH L1: ${c.length} casts in 5 s (want 3)`);
    if (!c.every((k) => offDeg(k.dir, h) <= 8)) fail('BURR LASH L1: a lash left the 4-foe line ahead for the nearer lone foe');
    if (!inLine.every((n) => n >= 4)) fail(`BURR LASH L1: a lash hit fewer than the 4 foes in the line (${inLine.join(', ')})`);
    const wound = c.filter((k) => k.windDir !== null);
    console.log(`  L2 wind-up honesty: ${wound.length} casts with a wind-up | crack − wind-up heading ${wound.map((k) => offDeg(k.dir, k.windDir as number).toFixed(2) + '°').join(', ')}`);
    if (wound.length < 2) fail(`BURR LASH L2: only ${wound.length} casts had a wind-up (want >= 2)`);
    if (!wound.every((k) => offDeg(k.dir, k.windDir as number) <= 3)) fail('BURR LASH L2: the crack left the heading the wind-up committed to');
  }
  // L3: two equal clusters (3 foes each) at ±30°, 1.6-2.4 H: 5 consecutive lashes stay on one side
  {
    const w = mk(22); const T = w.titan; const h = T.heading;
    for (const s of [1, -1]) for (const d of [1.6, 2.0, 2.4]) put(w, h + s * 30 * DEGR, d);
    const c = casts(w, 5, 220);
    const sides = c.map((k) => Math.sign(MA.wrapAngle(k.dir - h)));
    console.log(`  L3 two equal clusters at ±30°: sides ${sides.join(' ')} | foes hit ${c.map((k) => k.hitIds.length).join(', ')}`);
    if (c.length < 5) fail(`BURR LASH L3: ${c.length} casts (want 5)`);
    if (new Set(sides).size !== 1) fail('BURR LASH L3: consecutive lashes flip-flopped between two equal clusters');
    if (!c.every((k) => k.hitIds.length >= 3)) fail('BURR LASH L3: a lash hit fewer than its cluster of 3');
  }
  // L4: foes only BEHIND; 3 s steering straight ahead → no lash leaves the forward arc, the foes behind are never hit;
  // then the stick is released → the titan swivels and lashes them within 3 s
  {
    const w = mk(23); const T = w.titan; const h = T.heading;
    const back = [put(w, h + Math.PI, 1.4), put(w, h + Math.PI + 0.2, 1.9), put(w, h + Math.PI - 0.2, 1.9)];
    const line0 = new Set(back.map((e) => e.id));
    const backIds = new Set(back.map((e) => e.id));
    const fwd: TitanInput = { mx: Math.sin(h), mz: Math.cos(h), ability: false, abilityHeld: false, dash: false };
    const c1 = casts(w, 99, 90, fwd);
    const worst = c1.length ? Math.max(...c1.map((k) => offDeg(k.dir, h))) : 0;
    const hitBack = c1.some((k) => k.hitIds.some((id) => backIds.has(id)));
    for (const e of back) pins.delete(e.id);
    for (const e of back) { const T2 = w.titan; put(w, T2.heading + Math.PI + (e.id % 3 - 1) * 0.2, 1.6); e.alive = false; }
    backIds.clear();
    for (const e of w.enemies) if (e.alive && pins.has(e.id) && !line0.has(e.id)) backIds.add(e.id);
    const c2 = casts(w, 1, 90, idle);
    const hit2 = c2.length > 0 && c2[0].hitIds.some((id) => backIds.has(id));
    console.log(`  L4 steering ahead, foes behind: ${c1.length} casts (city ahead), worst ${worst.toFixed(1)}° off the move direction (arc ±${BW.BRIAR.aimArcDeg}°), behind foes hit ${hitBack} | stick released: ${c2.length} cast(s), behind foes hit ${hit2}`);
    if (worst > BW.BRIAR.aimArcDeg + 0.5) fail(`BURR LASH L4: a lash whipped ${worst.toFixed(1)}° off the move direction while steering`);
    if (hitBack) fail('BURR LASH L4: the lash whipped back at foes behind while the stick was held');
    if (!hit2) fail('BURR LASH L4: with the stick released the titan did not turn and lash the foes behind it');
  }
  // L6 (fb3 v3): a steady whip under an imprecise stick — the titan walks in place (re-placed every tick) while the stick
  // wobbles ±25° around one heading, re-rolled every 0.5 s (probe_balance's player-like steering); two equal clusters
  // (3 foes each, 4-7 H: Size I reaches 12.5 m) at ±20°, both always inside the arc. Consecutive lashes keep to one lane (median swing ≤ 10°, ≤ 1 swing > 20°), every
  // crack within the arc of the stick + 25° (a wind-up commits 0.2 s before a re-roll), each hits ≥ 2 foes. Control:
  // goodFrac 0 / trackN 0 (always the single best lane) must swing > 20° at least 3 times on this field (else the field proves nothing).
  {
    const run = (goodFrac: number, trackN: number) => {
      const keep = [BW.BRIAR.goodFrac, BW.BRIAR.trackN];
      BW.BRIAR.goodFrac = goodFrac; BW.BRIAR.trackN = trackN;
      const w = mk(24); const T = w.titan; const h = T.heading, x0 = T.x, z0 = T.z;
      for (const sg of [1, -1]) for (const d of [4, 5.5, 7]) put(w, h + sg * 20 * DEGR, d);
      let seed = 7, wob = 0;
      const out: { dir: number; n: number; stick: number }[] = [];
      for (let i = 0; i < 400 && out.length < 11; i++) {
        if (i % 15 === 0) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; wob = ((seed / 0x7fffffff) * 2 - 1) * 25 * DEGR; }
        const a = h + wob;
        T.x = T.px = x0; T.z = T.pz = z0;
        pin(w);
        WM.stepWorld(w, { mx: Math.sin(a), mz: Math.cos(a), ability: false, abilityHeld: false, dash: false });
        for (const e of w.events) if (e.type === 'titanAttack' && e.attack === 'vineLash') out.push({ dir: e.dir, n: e.hits, stick: a });
      }
      BW.BRIAR.goodFrac = keep[0]; BW.BRIAR.trackN = keep[1];
      const sw = out.slice(1).map((k, i) => offDeg(k.dir, out[i].dir)).sort((p, q) => p - q);
      return { out, med: sw.length ? sw[sw.length >> 1] : 0, big: sw.filter((x) => x > 20).length, worst: Math.max(0, ...out.map((k) => offDeg(k.dir, k.stick))) };
    };
    const r = run(BW.BRIAR.goodFrac, BW.BRIAR.trackN), c = run(0, 0);
    console.log(`  L6 wobbling stick, two clusters at ±20°: ${r.out.length} casts | median swing ${r.med.toFixed(1)}°, ${r.big} swing(s) > 20° (control, always the single best lane: median ${c.med.toFixed(1)}°, ${c.big} swing(s) > 20°) | worst ${r.worst.toFixed(1)}° off the stick | foes hit ${r.out.map((k) => k.n).join(', ')}`);
    if (r.out.length < 10) fail(`BURR LASH L6: ${r.out.length} casts (want >= 10)`);
    if (!(r.med <= 10)) fail(`BURR LASH L6: consecutive lashes swung a median ${r.med.toFixed(1)}° under a wobbling stick (want <= 10°)`);
    if (r.worst > BW.BRIAR.aimArcDeg + 25) fail(`BURR LASH L6: a lash cracked ${r.worst.toFixed(1)}° off the stick (arc ${BW.BRIAR.aimArcDeg}° + 25° re-roll)`);
    if (!r.out.every((k) => k.n >= 2)) fail('BURR LASH L6: a lash hit fewer than 2 foes');
    if (r.big > 1) fail(`BURR LASH L6: ${r.big} lashes swung more than 20° between the two clusters (want <= 1)`);
    if (c.big < 3) fail(`BURR LASH L6: the control (always the best lane) swung > 20° only ${c.big} time(s) — the field does not test steadiness`);
  }
  console.log(`  L5 view lane = damage lane: ${laneBad.length} bad cast(s)`);
  for (const b of laneBad.slice(0, 4)) console.log('    ' + b);
  if (laneBad.length) fail(`BURR LASH L5: ${laneBad.length} cast(s) whose vine lane is not the damage lane`);
}

// ─────────────────────────────── unit block ───────────────────────────────
console.log('\n[unit] growth / damage API');
{
  const w = WM.createWorld({ titan: 'molo', biome: 'grideast', seed: 11 });
  w.gates.unlocked = 4;   // GATEKEEPERS: this unit block tests the level-driven rank-up; open every gate (the growToRank dev bypass)
  const T = w.titan;
  console.log(`  createTitan: LV ${T.level} rank ${T.rank} H ${T.height} r ${T.radius.toFixed(3)} hp ${T.hp}/${T.maxHp} dash ${T.dashCharges}`);
  if (T.level !== 1 || T.rank !== 0 || Math.abs(T.height - CFG.titanHeightAt(0, 1)) > 1e-9 || T.hp !== T.maxHp || T.maxHp !== 140) fail('createTitan initial state');
  w.cheats.noSpawns = true;
  const idleN = (n: number): number => { let pk = 0; for (let i = 0; i < n; i++) { WM.stepWorld(w, WM.NO_INPUT); pk = Math.max(pk, T.height); } return pk; };
  // SIZE is driven by LEVEL: every level-up steps the body up; RANK_LEVELS[1] is the Size II breach
  const lv0 = T.level;
  const toLv3 = CFG.cumXpAt(3) - CFG.cumXpAt(1) + 1;
  TM.gainXp(w, toLv3);
  const lvEv = w.events.filter((e) => e.type === 'levelUp').length;
  console.log(`  gainXp(${toLv3}): LV ${lv0} → ${T.level}, pendingDrafts ${w.upgrades.pendingDrafts}, levelUp events ${lvEv}, rank ${T.rank}, growT ${T.growT.toFixed(2)}`);
  if (T.level !== 3 || w.upgrades.pendingDrafts !== T.level - lv0 || lvEv !== T.level - lv0) fail('gainXp level/draft/event mismatch');
  if (T.rank !== 0 || !(Math.abs(T.growT - CFG.LEVEL_GROW_S) < 1e-9)) fail('a level-up inside Size I must start the level grow tween, not a rank-up');
  idleN(Math.ceil(CFG.LEVEL_GROW_S * 30) + 2);
  console.log(`  level step: H ${CFG.titanHeightAt(0, 1).toFixed(3)} → ${T.height.toFixed(3)} (expect titanHeightAt(I, 3) = ${CFG.titanHeightAt(0, 3).toFixed(3)})`);
  if (Math.abs(T.height - CFG.titanHeightAt(0, 3)) > 1e-6) fail('height after a level-up must settle at titanHeightAt(rank, level)');
  if (!(CFG.titanHeightAt(0, 3) > CFG.titanHeightAt(0, 1) * 1.1)) fail('each Size I level must be a visible step (> +5 % per level)');

  w.events.length = 0;
  w.upgrades.pendingDrafts = 0;
  const hpMax0 = T.maxHp;
  T.hp = hpMax0 * 0.5;
  const toII = CFG.cumXpAt(CFG.RANK_LEVELS[1]) - (CFG.cumXpAt(T.level) + T.xp) + 0.01;   // exactly reaches the Size II level
  TM.gainXp(w, toII);
  const ru = w.events.filter((e) => e.type === 'rankUp').length;
  console.log(`  gainXp(${toII.toFixed(2)}) → LV ${T.level}: rank ${T.rank}, growT ${T.growT.toFixed(2)}, maxHp ${hpMax0} → ${T.maxHp.toFixed(1)}, hp ${T.hp.toFixed(1)} (expect 65 % of max), rankUp events ${ru}`);
  if (T.level !== CFG.RANK_LEVELS[1] || T.rank !== 1 || ru !== 1) fail(`reaching LV ${CFG.RANK_LEVELS[1]} should rank up to Size II exactly once`);
  if (!(Math.abs(T.growT - CFG.GROW_TWEEN_S) < 1e-9)) fail('a rank-up must run the full MASS BREACH tween');
  if (Math.abs(T.hp / T.maxHp - 0.65) > 0.01) fail('rank-up hp should keep ratio then +15 %');
  const peak = idleN(40);
  console.log(`  grow tween: peak H ${peak.toFixed(3)} (easeOutBack overshoot), settled H ${T.height.toFixed(3)}, radius ${T.radius.toFixed(3)}`);
  if (!(Math.abs(T.height - CFG.RANKS[1].height) < 1e-6)) fail('height after the breach tween must be the Size II base height');
  if (!(peak > 5.0)) fail('grow tween never reached rank II height');

  // catch-up rubber band: 1 min behind the rank III schedule → growth XP × 1.6
  w.upgrades.pendingDrafts = 0;
  const xp0 = T.xp, tSave = w.t;
  w.t = CFG.RANK_SCHEDULE_S[2] + 60;
  const pm = TM.paceMul(w);
  TM.gainXp(w, 5);
  const got = T.xp - xp0;
  w.t = tSave;
  const want = 5 * Math.min(CFG.CATCHUP_MAX, 1 + CFG.CATCHUP_PER_MIN);
  console.log(`  catch-up: gainXp(5) at 1 min behind → +${got.toFixed(2)} (expect ${want.toFixed(2)}; paceMul ${pm.toFixed(2)})`);
  if (Math.abs(got - want) > 1e-6) fail('catch-up multiplier');

  // 'mass' upgrade action → gainGrowth: an exact share of the current level's bar, no multipliers
  const xp1 = T.xp, bar = T.xpToNext, lv1 = T.level;
  w.t = CFG.RANK_SCHEDULE_S[2] + 60;                       // the rubber band must NOT apply to it
  TM.gainGrowth(w, 0.25);
  w.t = tSave;
  console.log(`  gainGrowth(0.25): xp ${xp1.toFixed(2)} → ${T.xp.toFixed(2)} of ${bar} (expect +${(0.25 * bar).toFixed(2)}), LV ${lv1} → ${T.level}`);
  if (T.level !== lv1 || Math.abs(T.xp - xp1 - 0.25 * bar) > 1e-6) fail('gainGrowth share of the bar');

  // gainMass is retired: no size, no XP; titan.mass stays the SIZE-progress mirror
  const snap = [T.level, T.xp, T.rank, T.height];
  TM.gainMass(w, 1e6);
  idleN(1);
  console.log(`  gainMass(1e6) (retired): LV ${T.level} xp ${T.xp.toFixed(2)} rank ${T.rank} · mass mirror ${T.mass.toFixed(1)} (expect ${CFG.sizeMassMirror(T.rank, T.level, T.xp).toFixed(1)})`);
  if (T.level !== snap[0] || T.xp !== snap[1] || T.rank !== snap[2]) fail('gainMass must no longer grow the titan');
  if (Math.abs(T.mass - CFG.sizeMassMirror(T.rank, T.level, T.xp)) > 1e-6) fail('titan.mass must mirror SIZE progress');

  // dev cheat growToRank: straight to Size V through the real rank-ups, no drafts owed
  w.events.length = 0;
  w.upgrades.pendingDrafts = 0;
  const rr = TM.growToRank(w, 4);
  const ru4 = w.events.filter((e) => e.type === 'rankUp').length;
  idleN(40);
  console.log(`  growToRank(4): rank ${rr} LV ${T.level} rankUp events ${ru4} drafts owed ${w.upgrades.pendingDrafts} H ${T.height.toFixed(2)}`);
  if (rr !== 4 || T.level !== CFG.RANK_LEVELS[4] || ru4 !== 3 || w.upgrades.pendingDrafts !== 0 || Math.abs(T.height - CFG.RANKS[4].height) > 1e-6) fail('growToRank');
  w.cheats.noSpawns = false;

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

{
  // VOLT-KITE STATIC SHIELD (VOLT lane 2026-09-30): a RECAST that blows n real wires adds
  // min(shieldPressCap, shieldPerWire × n) × abilityPower × maxHp of absorb shield, never past shieldMax × maxHp;
  // a RECAST with no wires (static burst) adds none.
  const { VOLT } = await import('../src/titans/kits/voltkite.ts');
  const w = WM.createWorld({ titan: 'voltkite', biome: 'grideast', seed: 5 });
  w.cheats.noSpawns = true;
  const T = w.titan;
  const idle: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
  const dash: TitanInput = { ...idle, dash: true };
  const press: TitanInput = { ...idle, ability: true, abilityHeld: true };
  WM.stepWorld(w, dash); for (let i = 0; i < 12; i++) WM.stepWorld(w, idle);
  WM.stepWorld(w, dash); for (let i = 0; i < 12; i++) WM.stepWorld(w, idle);
  const wires0 = T.kit.wires, sh0 = w.upgrades.shield;
  WM.stepWorld(w, press);
  const det = w.events.find((e) => e.type === 'wireDetonate');
  const blown = det && det.type === 'wireDetonate' ? det.pts.length / 4 : 0;
  const power = Math.max(0, T.stats.abilityPower ?? 1);
  const want = Math.min(VOLT.shieldMax * T.maxHp, sh0 + Math.min(VOLT.shieldPressCap, VOLT.shieldPerWire * blown) * power * T.maxHp);
  const sh1 = w.upgrades.shield;
  // RECAST is a deliberate moment, not spam (owner playtest fb3: "needs a longer cooldown as it allows me to melt
  // away at everything"): the press arms the full detCdS (× abilityCooldown, 1 on a fresh run), the cooldown is in
  // line with the other titans' hooks (>= 6 s; MOLO 9, BRIARWICK 8, HEARTHBACK 6), and a press while cooling does nothing.
  const cdArmed = T.abilityCd, cdWant = VOLT.detCdS * Math.max(0.35, T.stats.abilityCooldown ?? 1);
  for (let i = 0; i < 4 * HZ && T.dashCharges < 1; i++) WM.stepWorld(w, idle);    // a dash charge back (2.25 s each)
  WM.stepWorld(w, dash); for (let i = 0; i < 12; i++) WM.stepWorld(w, idle);   // a fresh wire to tempt the early press
  const wiresCool = T.kit.wires, shCool0 = w.upgrades.shield;
  if (!(wiresCool >= 1) || !(T.abilityCd > 0)) fail(`RECAST cooldown test: needs a live wire (${wiresCool}) while still cooling (${T.abilityCd} s)`);
  WM.stepWorld(w, press);
  const coolFired = w.events.some((e) => e.type === 'wireDetonate' || e.type === 'explosion');
  const wiresCoolAfter = T.kit.wires, shCool1 = w.upgrades.shield;
  console.log(`  RECAST cooldown: armed ${cdArmed.toFixed(2)} s (want ${cdWant.toFixed(2)}, detCdS ${VOLT.detCdS}); press while cooling: fired ${coolFired}, wires ${wiresCool} → ${wiresCoolAfter}, shield ${shCool0.toFixed(2)} → ${shCool1.toFixed(2)}`);
  if (!(VOLT.detCdS >= 6)) fail(`RECAST: detCdS ${VOLT.detCdS} s — must be >= 6 s, in line with the other titans' hooks (owner fb3)`);
  if (!(Math.abs(cdArmed - cdWant) <= 1 / HZ + 1e-6)) fail(`RECAST: press armed ${cdArmed} s of cooldown (want ${cdWant})`);
  if (coolFired || wiresCoolAfter < wiresCool || shCool1 > shCool0 + 1e-9) fail('RECAST: a press during the cooldown must not detonate, burst or shield');
  for (let i = 0; i < Math.ceil(cdWant * HZ) + 5 * HZ; i++) WM.stepWorld(w, idle);   // cooldown back, no wires left
  if (!(T.abilityCd <= 0)) fail(`RECAST: cooldown still ${T.abilityCd} s after ${cdWant + 5} s`);
  const sh2 = w.upgrades.shield;
  WM.stepWorld(w, press);
  const burst = w.events.some((e) => e.type === 'explosion'), sh3 = w.upgrades.shield;
  w.upgrades.shield = VOLT.shieldMax * T.maxHp - 0.5;              // cap: a big RECAST tops the pool at shieldMax
  for (let k = 0; k < 3; k++) { WM.stepWorld(w, dash); for (let i = 0; i < 12; i++) WM.stepWorld(w, idle); }
  w.upgrades.shield = VOLT.shieldMax * T.maxHp - 0.5;
  T.abilityCd = 0; WM.stepWorld(w, press);
  const sh4 = w.upgrades.shield;
  console.log(`  STATIC SHIELD: wires ${wires0} → blown ${blown}, shield ${sh0.toFixed(2)} → ${sh1.toFixed(2)} (want ${want.toFixed(2)} ± decay); burst press ${burst} shield ${sh2.toFixed(2)} → ${sh3.toFixed(2)}; near-cap press → ${sh4.toFixed(2)} (cap ${(VOLT.shieldMax * T.maxHp).toFixed(2)})`);
  if (!(blown >= 2)) fail('STATIC SHIELD test: two dashes should give RECAST 2 wires to blow');
  if (!(Math.abs(sh1 - want) <= 0.01 * T.maxHp)) fail(`STATIC SHIELD: RECAST blowing ${blown} wires gave shield ${sh1} (want ${want})`);
  if (!burst || sh3 > sh2 + 1e-9) fail('STATIC SHIELD: a no-wire RECAST (static burst) must add no shield');
  if (sh4 > VOLT.shieldMax * T.maxHp + 1e-6) fail(`STATIC SHIELD: pool ${sh4} past the cap ${VOLT.shieldMax * T.maxHp}`);
}

for (const [rank, strength] of [[0, 3], [2, 12], [4, 12]] as const) {
  // CAISSON-4 winch leash: pulled toward the anchor when idle; the player can resist by walking away.
  // (contract pull = 12 m/s; Size I uses a scaled-down pull so the test fits the open ground at spawn)
  const w = WM.createWorld({ titan: 'hearthback', biome: 'grideast', seed: 9 });
  w.cheats.noSpawns = true;
  const T = w.titan;
  const idle: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
  // straight to `rank` through the sim's real rank-ups (titansim growToRank), at t = 0
  if (rank > 0) { TM.growToRank(w, rank); for (let i = 0; i < 40; i++) WM.stepWorld(w, idle); }
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
    if (rank === 4) { TM.growToRank(w, 4); for (let i = 0; i < 60; i++) WM.stepWorld(w, WM.NO_INPUT); }
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

{
  // TITAN PASS: every number a titan card states is the code's number (the MOLO card said 10 dmg while the bite did 22).
  // Each card fact is derived from the kit constants here, so a retune that forgets the card fails this probe.
  console.log('\n[unit] titan cards = kit constants');
  const TD = (await import('../src/data/titans.ts')).TITANS;
  const { MOLO } = await import('../src/titans/kits/molo.ts');
  const { VOLT } = await import('../src/titans/kits/voltkite.ts');
  const { HEARTH } = await import('../src/titans/kits/hearthback.ts');
  const { BRIAR } = await import('../src/titans/kits/briarwick.ts');
  const pct = (f: number) => `${Math.round(f * 100)}%`;
  const pct1 = (f: number) => `${Math.round(f * 1000) / 10}%`;   // one decimal (VOLT STATIC SHIELD 2.5 %)
  const facts: [TitanId, 'auto' | 'hook' | 'dash', string][] = [
    ['molo', 'auto', `Every ${MOLO.biteEveryS} s`], ['molo', 'auto', `(${MOLO.biteHalfDeg}° each side), ${MOLO.biteDmg} dmg`],
    ['molo', 'auto', `within ${MOLO.biteAimDeg}°`], ['molo', 'auto', `${MOLO.pulseDmg} dmg foot-pulse`],
    ['molo', 'hook', `${MOLO.vacChannelS} s inhale over ${MOLO.vacRH} body-heights`], ['molo', 'hook', `${MOLO.vacDps} dmg/s`],
    ['molo', 'hook', `${pct(MOLO.vacShieldBase)} max HP + ${Math.round(MOLO.vacShieldPer * 1000) / 10}% per pickup swallowed (max ${pct(MOLO.vacShieldCap)})`],
    ['molo', 'hook', `+${pct(MOLO.vacMassMul - 1)} XP`], ['molo', 'hook', `${MOLO.vacCdS} s cooldown`],
    ['voltkite', 'auto', `Every ${VOLT.arcEveryS} s`], ['voltkite', 'auto', `within ${VOLT.arcRangeH} body-heights`],
    ['voltkite', 'auto', `${VOLT.arcDmg} dmg, −${pct(1 - VOLT.arcFalloff)} per jump`],
    ['voltkite', 'auto', `Every ${VOLT.groundEvery === 2 ? '2nd' : VOLT.groundEvery + 'th'} strike GROUNDS`],
    ['voltkite', 'auto', `lasts ${TD.voltkite.base.wireDuration * VOLT.groundLife} s, like a lunge wire`],   // VOLT lane 2026-09-30 (groundLife)
    ['voltkite', 'hook', `${VOLT.detDmg} dmg along each wire + ${VOLT.detPerSec} per second`],
    ['voltkite', 'hook', `${VOLT.burstDmg} dmg static burst`], ['voltkite', 'hook', `${VOLT.detCdS} s cooldown`],
    ['voltkite', 'hook', `STATIC SHIELD of ${pct1(VOLT.shieldPerWire)} max HP (up to ${pct1(VOLT.shieldPressCap)} per blow, ${pct1(VOLT.shieldMax)} in all)`],   // VOLT lane 2026-09-30
    ['voltkite', 'dash', `${VOLT.wireDps} dmg/s over ${TD.voltkite.base.wireDuration} s (up to ${VOLT.wireCap} wires)`],
    ['hearthback', 'auto', `Every ${HEARTH.stompEveryS} s`], ['hearthback', 'auto', `up to ${HEARTH.stompRangeH} body-heights`],
    ['hearthback', 'auto', `${TD.hearthback.base.stompDelay} s later for ${HEARTH.stompDmg} dmg`],
    ['hearthback', 'hook', `${pct(HEARTH.shellStoreFrac)} of damage taken`],
    ['hearthback', 'hook', `(${HEARTH.ventDmg} + ${HEARTH.ventPerStored} per point)`],
    ['hearthback', 'hook', `heals ${pct(HEARTH.ventHealFrac)}`], ['hearthback', 'hook', `${HEARTH.ventCdS} s cooldown`],
    ['briarwick', 'auto', `Every ${BRIAR.lashEveryS.toFixed(1)} s`],
    ['briarwick', 'auto', `${BRIAR.lashLenH} body-heights long (${(BRIAR.lashLenH * BRIAR.size1LenMul).toFixed(1)} at Size I), ${BRIAR.lashDmg} dmg`],
    ['briarwick', 'auto', `at Size I it always reaches ${BRIAR.size1ReachM} m`],   // CFIX 2026-09-30: Size I lash floor (added fact)
    ['briarwick', 'auto', `within ${BRIAR.aimArcDeg}° of where you are heading`],   // fb3 2026-09-30: forward-arc aim (added fact)
    ['briarwick', 'auto', `ripen in ${BRIAR.ripenS} s`], ['briarwick', 'auto', `${BRIAR.burstDmg} dmg, tangles`],
    ['briarwick', 'auto', `hits ${pct(BRIAR.linkBonus)} harder`],
    ['briarwick', 'hook', `(${BRIAR.ringDmg} dmg, tangles ${BRIAR.ringTangleS} s), ${BRIAR.volleyN} ripe seeds`],
    ['briarwick', 'hook', `within ${BRIAR.hookRH} body-heights`], ['briarwick', 'hook', `${BRIAR.hookCdS} s cooldown`],
    ['briarwick', 'dash', `drops ${BRIAR.dashPods} seed pods`],
  ];
  let bad = 0;
  for (const [t, part, fact] of facts) {
    const desc = TD[t][part].desc;
    if (!desc.includes(fact)) { bad++; fail(`${t} ${part} card does not state the code's "${fact}": ${desc}`); }
  }
  for (const t of TITANS) {
    const d = TD[t].base.dashDistance;
    if (!TD[t].dash.desc.includes(`${d} body-heights`) && t !== 'voltkite' && t !== 'hearthback') { bad++; fail(`${t} dash card does not state dashDistance ${d}`); }
  }
  if (TD.briarwick.base.turretCap !== 10) { bad++; fail(`briarwick base turretCap ${TD.briarwick.base.turretCap} (kit C: 10)`); }
  if (TD.voltkite.base.armor !== 12) { bad++; fail(`voltkite base armor ${TD.voltkite.base.armor} (TITAN PASS: 12)`); }
  console.log(`  ${facts.length} card facts + dash distances + base stats checked, ${bad} mismatch(es)`);
}

console.log(failures ? `\nprobe_titan: ${failures} FAILURE(S)` : '\nprobe_titan: OK');
process.exit(failures ? 1 : 0);
