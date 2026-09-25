// DYEFIELD — gate G10 part 1 (CONTRACT_P6_11 §18.1): the phase-6 kits, JELLY CHARGE, the special meter,
// CLOUDBURST and WELLSPRING on the real Pier 18 collision + paint atlas, Rapier in plain Node. Runners are
// driven by scripted PlayerIntents through MatchWorld.step (fire / sub / special held, stick, aim points);
// positions between checks are set with the dev teleport. Every expected number is read from
// data/weapons.json (geometry knobs from config.ts KITS), never re-typed here.
//
//   node _harness/probe_kits.ts            # G10 kits
//   node _harness/probe_kits.ts --verbose
//
// Part 2 of G10 is `node _harness/probe_bots.ts --lineup mixed` (every kit in a full bot match).
// Exit: 0 all pass · 1 a check failed · 2 setup failure.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRapier, PhysicsWorld } from '../runtime/src/core/physics.ts';
import { loadMapGeometry, type MapGeometry } from '../runtime/src/core/mapgeo.ts';
import { buildAtlas } from '../runtime/src/core/paint/atlas.ts';
import { Painter } from '../runtime/src/core/paint/painter.ts';
import { mapById, WEAPONS } from '../runtime/src/core/data.ts';
import { COMBAT, HITBOX, KITS, MOVE, TICK } from '../runtime/src/core/config.ts';
import { emptyIntent, type PlayerIntent } from '../runtime/src/core/types.ts';
import type { Runner } from '../runtime/src/core/runner.ts';
import { MatchWorld } from '../runtime/src/core/match/world.ts';
import { defaultRoster } from '../runtime/src/core/match/roster.ts';
import type { SimEvent } from '../runtime/src/core/match/events.ts';
import {
  KIND_BURST, KIND_CLOUD, KIND_FLICK, KIND_JELLY, PSTATE_HOVER,
} from '../runtime/src/core/combat/projectiles.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERBOSE = process.argv.includes('--verbose');

interface Check { name: string; pass: boolean; detail: string }
const checks: Check[] = [];
function check(name: string, pass: boolean, detail: string): void {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
}
const f2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const f3 = (v: number): string => (Number.isFinite(v) ? v.toFixed(3) : String(v));
function log(...a: unknown[]): void { if (VERBOSE) console.log('   ', ...a); }
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

type Ev<T extends SimEvent['t']> = Extract<SimEvent, { t: T }>;

// ── weapons.json rows (the numbers under test) ──
interface RollRow { rollWidth: number; rollSpeed: number; tankPerMetre: number; flattenDamage: number; flattenReach: number;
  flick: { windup: number; cooldown: number; tankCost: number; splats: number; reach: number; damageNear: number; damageFar: number; paintRadius: number } }
interface ChargeRow { chargeSeconds: number; minRange: number; maxRange: number; damageMin: number; damageFull: number; tankFull: number;
  tankMin: number; moveSpeedWhileCharging: number; paint: { lineSpacing: number; lineRadius: number; endRadius: number } }
interface BurstRow { shotsPerSecond: number; tankPerShot: number; projectileSpeed: number; maxRange: number; airburstAtMaxRange: boolean;
  directDamage: number; splashDamage: number; splashRadius: number; paint: { impactRadius: number; airburstRadius: number } }
interface JellyRow { tankCost: number; throwSpeed: number; gravity: number; puddleFuse: number; blastRadius: number; damageCenter: number; damageEdge: number; paintRadius: number }
interface CloudRow { chargePoints: number; throwRange: number; hoverHeight: number; duration: number; soakRadius: number; dropsPerSecond: number; dropPaintRadius: number; damagePerSecond: number }
interface WellRow { chargePoints: number; leapHeight: number; ringRadius: number; ringWidth: number; coreDamage: number; coreRadius: number; knockback: number }

const kitFireRow = <T>(id: string): T => (WEAPONS.kits.find((k) => k.id === id) as Record<string, unknown>)['fire'] as T;
const DRUM_F = kitFireRow<RollRow>('sheet-drum');
const NEEDLE_F = kitFireRow<ChargeRow>('needle-glint');
const POP_F = kitFireRow<BurstRow>('pop-well');
const JELLY = WEAPONS.subs.find((s) => s.id === 'jelly-charge') as unknown as JellyRow;
const CLOUD = WEAPONS.specials.find((s) => s.id === 'cloudburst') as unknown as CloudRow;
const WELL = WEAPONS.specials.find((s) => s.id === 'wellspring') as unknown as WellRow;
const SPC = WEAPONS.specialCharge as { pointsPerSquareMetre: number; pointsPerWash: number; keepOnWashed: number };

/** distance from a point to a runner's hit-capsule axis (the splash / blast measure, CONTRACT §10.2 CHANGED(KITSIM)) */
function axisDist(v: Runner, x: number, y: number, z: number): number {
  const h = v.slickForm ? HITBOX.slickHeight : HITBOX.height;
  const rad = Math.min(HITBOX.radius, h / 2);
  const y0 = v.y + rad, y1 = v.y + h - rad;
  return Math.hypot(x - v.x, y - Math.min(y1, Math.max(y0, y)), z - v.z);
}

async function main(): Promise<number> {
  const t0 = performance.now();
  const def = mapById('pier18');
  let geo: MapGeometry;
  let R: Awaited<ReturnType<typeof loadRapier>>;
  try {
    R = await loadRapier();
    geo = await loadMapGeometry(def);
  } catch (e) { console.log('SETUP FAILED:', (e as Error).stack ?? e); return 2; }
  const sc = def.scoring ?? { wallWeight: 0.35, floorMinNy: 0.45 };
  const atlas = buildAtlas(geo.paint, geo.atlasSize, { wallWeight: sc.wallWeight, floorMinNy: sc.floorMinNy });
  const painter = new Painter(atlas);
  const physics = new PhysicsWorld(R, geo);
  // SUNCREW: 0 SHEET-DRUM (WELLSPRING), 1 NEEDLE-GLINT (CLOUDBURST), 2 POP-WELL (WELLSPRING), 3 MIST-RASP (JELLY tests)
  // GULF CREW: 4-7 targets
  const roster = defaultRoster({ humanKit: 'sheet-drum', seed: 5, skill: 'fresh',
    botKits: ['needle-glint', 'pop-well', 'mist-rasp', 'mist-rasp', 'mist-rasp', 'mist-rasp', 'mist-rasp'] });
  const world = new MatchWorld({ def, geo, physics, painter, roster, seed: 5, countdownS: 0, durationS: 900 });
  const [DRUM, NEEDLE, POP, MIST] = [0, 1, 2, 3].map((i) => world.runners[i]);
  const FOES = [4, 5, 6, 7].map((i) => world.runners[i]);
  console.log(`map pier18 · kits ${world.runners.map((r) => `${r.id}:${r.kit}`).join(' ')} · setup ${((performance.now() - t0) / 1000).toFixed(2)} s`);
  console.log('-'.repeat(100));

  const intents: PlayerIntent[] = world.runners.map(() => emptyIntent());
  const events: SimEvent[] = [];
  const evTick: number[] = [];
  const kindsSeen = new Set<number>();
  const P = world.projectiles;
  const tick = (): void => {
    world.step(intents);
    const n0 = events.length;
    world.drainEvents(events);
    for (let i = n0; i < events.length; i++) evTick.push(world.tick);
    for (let i = 0; i < P.count; i++) kindsSeen.add(P.kind[i]);
  };
  const run = (n: number, each?: (k: number) => void): void => { for (let k = 0; k < n; k++) { each?.(k); tick(); } };
  const S = (s: number): number => Math.round(s / TICK);
  const reset = (i: PlayerIntent, yaw: number): void => { Object.assign(i, emptyIntent()); i.yaw = yaw; };
  const place = (r: Runner, x: number, y: number, z: number, yaw: number): void => {
    world.devTeleport(r.id, x, y, z, yaw);
    reset(intents[r.id], yaw);
    run(S(0.25));
  };
  const heal = (r: Runner): void => { r.hp = WEAPONS.hp; r.lastHitT = 1e9; };
  const waitAlive = (...rs: Runner[]): void => { let g = 0; while (rs.some((r) => !r.alive) && g++ < S(6)) tick(); };
  const park = (...rs: Runner[]): void => { for (const r of rs) { const s = world.spawnFor(r); world.devTeleport(r.id, s.x, s.y, s.z, s.yaw); reset(intents[r.id], s.yaw); } };
  const aimAt = (i: PlayerIntent, x: number, y: number, z: number): void => { i.hasAim = true; i.aimX = x; i.aimY = y; i.aimZ = z; };
  const take = <T extends SimEvent['t']>(t: T, from = 0): Ev<T>[] => events.slice(from).filter((e) => e.t === t) as Ev<T>[];
  const takeT = <T extends SimEvent['t']>(t: T, from = 0): Array<{ e: Ev<T>; tick: number }> => {
    const out: Array<{ e: Ev<T>; tick: number }> = [];
    for (let i = from; i < events.length; i++) if (events[i].t === t) out.push({ e: events[i] as Ev<T>, tick: evTick[i] });
    return out;
  };
  const sunAt = (x: number, z: number, y = 0): boolean => painter.surfaceAt(x, y, z, 0.08, 'floor')?.team === 1;
  const ringShare = (cx: number, cz: number, r: number, n: number): number => {
    let k = 0;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; if (sunAt(cx + r * Math.sin(a), cz + r * Math.cos(a))) k++; }
    return k / n;
  };
  const fresh = (): void => { painter.reset(); for (const r of world.runners) if (r.alive) heal(r); };

  // readouts seen
  let maxCharge = 0, rollingSeen = false, flickingSeen = false;
  const watch = (r: Runner): void => { maxCharge = Math.max(maxCharge, r.charge); rollingSeen ||= r.rolling; flickingSeen ||= r.flicking; };

  park(...FOES);
  run(S(0.3));

  // ═══════════════════ SHEET-DRUM ═══════════════════
  // A1. roll: held + grounded + moving → strip rollWidth wide, speed ≤ rollSpeed, tank −tankPerMetre per m
  {
    fresh();
    const me = DRUM, it = intents[0];
    place(me, -17.5, 0, -24, 0);
    world.devSetTank(0, 100);
    const ev0 = events.length;
    const tank0 = me.tank, sun0 = painter.weighted(1);
    let zBefore = NaN, zFirst = NaN, zLast = NaN;
    const speeds: number[] = [];
    for (let k = 0; k < S(2.5); k++) {
      it.yaw = 0; it.moveZ = 1; it.fire = true;
      tick(); watch(me);
      if (me.rolling) { if (!Number.isFinite(zFirst)) { zFirst = me.z; zBefore = me.pz; } zLast = me.z; }
      if (k >= S(1.0)) speeds.push(me.speed);
    }
    reset(it, 0);
    run(S(0.3));
    const meanV = speeds.reduce((a, v) => a + v, 0) / Math.max(1, speeds.length);
    const rolls = take('roll', ev0).filter((e) => e.pid === 0);
    check('SHEET-DRUM: fire held + moving → rolling at ≤ rollSpeed (roll on / off events)',
      Math.abs(meanV - DRUM_F.rollSpeed) < 0.05 && rolls.length === 2 && rolls[0].on && !rolls[1].on && rollingSeen,
      `mean speed ${f3(meanV)} m/s (rollSpeed ${DRUM_F.rollSpeed}, walk ${MOVE.walk}); roll events ${rolls.map((e) => (e.on ? 'on' : 'off')).join(',')}`);
    const drained = tank0 - me.tank, dist = zLast - zBefore;
    check('SHEET-DRUM: tank drains tankPerMetre per metre rolled', Math.abs(drained - dist * DRUM_F.tankPerMetre) < 0.02,
      `rolled ${f3(dist)} m → tank −${f3(drained)} (expected −${f3(dist * DRUM_F.tankPerMetre)} at ${DRUM_F.tankPerMetre}/m)`);
    const hw = DRUM_F.rollWidth / 2, e = KITS.rollEdgeNoise;
    let inside = 0, inN = 0, outside = 0, outN = 0;
    for (let s = 0; s < 7; s++) {
      const z = lerp(zFirst, zLast, (s + 1) / 8) + KITS.drumAhead;
      for (const lat of [-(hw * (1 - e) - 0.08), -0.5, 0, 0.5, hw * (1 - e) - 0.08]) { inN++; if (sunAt(-17.5 + lat, z)) inside++; }
      for (const lat of [-(hw * (1 + e) + 0.08), hw * (1 + e) + 0.08]) { outN++; if (sunAt(-17.5 + lat, z)) outside++; }
    }
    check('SHEET-DRUM: strip is rollWidth wide (all dyed inside ±w/2·(1−noise), none beyond ±w/2·(1+noise))',
      inside === inN && outside === 0, `inside ${inside}/${inN} dyed, outside ${outside}/${outN} dyed (rollWidth ${DRUM_F.rollWidth}, edge noise ${e})`);
    const L = zLast - zFirst;
    const want = L * DRUM_F.rollWidth + Math.PI * hw * hw;
    const gain = painter.weighted(1) - sun0;
    check('SHEET-DRUM: strip area = length × rollWidth + end caps (±6 %)', Math.abs(gain / want - 1) < 0.06,
      `dyed ${f2(gain)} m² for a ${f2(L)} m stroke (expected ${f2(want)} m², ratio ${f3(gain / want)})`);
    const ahead = sunAt(-17.5, zLast + KITS.drumAhead + hw * (1 - e) - 0.1), beyond = sunAt(-17.5, zLast + KITS.drumAhead + hw * (1 + e) + 0.1);
    check('SHEET-DRUM: the strip is painted at the drum, ahead of the feet', ahead && !beyond,
      `dyed at feet+${f2(KITS.drumAhead + hw * (1 - e) - 0.1)} m: ${ahead}; at feet+${f2(KITS.drumAhead + hw * (1 + e) + 0.1)} m: ${beyond}`);
  }

  // A2. flatten: an enemy in front of the drum takes flattenDamage (a wash); one beside the strip is untouched
  {
    fresh();
    const me = DRUM, it = intents[0];
    const foe = FOES[0], side = FOES[1];
    waitAlive(foe, side);
    place(foe, -17.5, 0, -20, Math.PI);
    place(side, -17.5 - (DRUM_F.rollWidth / 2 + 0.55), 0, -21, 0);
    place(me, -17.5, 0, -24, 0);
    world.devSetTank(0, 100);
    heal(foe); heal(side);
    const ev0 = events.length;
    let distAt = NaN;
    for (let k = 0; k < S(1.6); k++) {
      it.yaw = 0; it.moveZ = 1; it.fire = true;
      const fz = foe.z;
      tick();
      if (!Number.isFinite(distAt) && take('hit', ev0).some((h) => h.victim === foe.id)) distAt = fz - me.z;
    }
    reset(it, 0);
    run(S(0.2));
    const hits = take('hit', ev0).filter((h) => h.victim === foe.id && h.by === 0);
    const washed = take('washed', ev0).find((w) => w.victim === foe.id);
    const sideHits = take('hit', ev0).filter((h) => h.victim === side.id);
    const lo = KITS.drumAhead + DRUM_F.flattenReach + HITBOX.radius;
    check('SHEET-DRUM: flatten — an enemy within flattenReach in front of the drum takes flattenDamage and is washed',
      hits.length === 1 && Math.abs(hits[0].dmg - DRUM_F.flattenDamage) < 1e-9 && washed?.by === 0 && washed?.cause === 'dye'
        && distAt <= lo + 1e-3 && distAt >= lo - DRUM_F.rollSpeed * TICK - 0.02,
      `${hits.length} hit(s) of ${hits.map((h) => h.dmg).join(',')} (flattenDamage ${DRUM_F.flattenDamage}); washed ${washed ? `by ${washed.by} (${washed.cause})` : 'no'}; feet→foe ${f3(distAt)} m at contact (drum ${KITS.drumAhead} + reach ${DRUM_F.flattenReach} + hit radius ${HITBOX.radius} = ${f3(lo)})`);
    check('SHEET-DRUM: an enemy beside the strip (outside the drum width) is not flattened', sideHits.length === 0,
      `${sideHits.length} hits on the runner ${f2(DRUM_F.rollWidth / 2 + 0.55)} m to the side`);
    park(side);
  }

  // A3. flick: press while standing → windup → `splats` droplets (kind 1) in a vertical column to `reach`; tankCost; cooldown
  {
    fresh();
    const me = DRUM, it = intents[0];
    park(...FOES);
    place(me, -17.5, 0, -24, 0);
    world.devSetTank(0, 100);
    const ev0 = events.length;
    const tank0 = me.tank;
    let flick1 = -1, maxFlickKinds = 0;
    run(S(1.2), (k) => {
      it.yaw = 0; it.pitch = 0; it.fire = k < 2;
      watch(me);
      let n = 0; for (let i = 0; i < P.count; i++) if (P.kind[i] === KIND_FLICK) n++;
      maxFlickKinds = Math.max(maxFlickKinds, n);
    });
    reset(it, 0);
    const fl = takeT('flick', ev0).filter((x) => x.e.pid === 0);
    const shots = takeT('shot', ev0).filter((x) => x.e.pid === 0);
    if (fl.length) flick1 = fl[0].tick;
    const wind = shots.length ? (shots[0].tick - flick1) * TICK : NaN;
    check('SHEET-DRUM flick: a press while standing starts the flick; droplets leave `windup` later',
      fl.length === 1 && shots.length === 1 && Math.abs(wind - DRUM_F.flick.windup) <= TICK + 1e-9 && flickingSeen,
      `${fl.length} flick event(s), ${shots.length} shot(s); windup ${f3(wind)} s (spec ${DRUM_F.flick.windup})`);
    const splats = take('splat', ev0).filter((e) => Math.abs(e.r - DRUM_F.flick.paintRadius) < 1e-6);
    const ds = splats.map((e) => Math.hypot(e.x - me.x, e.z - me.z)).sort((a, b) => a - b);
    const want = Array.from({ length: DRUM_F.flick.splats }, (_, j) => DRUM_F.flick.reach * (j + 1) / DRUM_F.flick.splats);
    const err = ds.length === want.length ? Math.max(...ds.map((d, j) => Math.abs(d - want[j]))) : Infinity;
    const onLine = splats.every((e) => Math.abs(e.x - me.x) < 0.05 && e.ny > 0.9);
    check('SHEET-DRUM flick: `splats` kind-1 droplets in a vertical column, landing evenly out to `reach` (paintRadius splats)',
      maxFlickKinds === DRUM_F.flick.splats && splats.length === DRUM_F.flick.splats && err < 0.15 && onLine,
      `${maxFlickKinds} kind-1 droplets in flight; ${splats.length} splats r ${DRUM_F.flick.paintRadius} at ${ds.map(f2).join(', ')} m (want ${want.map(f2).join(', ')}; max err ${f3(err)}); on the aim line & floor: ${onLine}`);
    check('SHEET-DRUM flick: costs tankCost', Math.abs(tank0 - me.tank - DRUM_F.flick.tankCost) < 1e-9,
      `tank ${f2(tank0)} → ${f2(me.tank)} (tankCost ${DRUM_F.flick.tankCost})`);
    // held while standing → a flick every windup + cooldown
    world.devSetTank(0, 100);
    const ev1 = events.length;
    run(S(2.8), () => { it.yaw = 0; it.fire = true; });
    reset(it, 0);
    run(S(0.6));
    const fl2 = takeT('flick', ev1).filter((x) => x.e.pid === 0).map((x) => x.tick);
    const gaps = fl2.slice(1).map((t, i) => (t - fl2[i]) * TICK);
    const period = DRUM_F.flick.windup + DRUM_F.flick.cooldown;
    check('SHEET-DRUM flick: fire held while standing flicks again after windup + cooldown',
      fl2.length >= 3 && gaps.every((g) => g >= period - 1e-9 && g <= period + 3 * TICK),
      `${fl2.length} flicks in 2.8 s, gaps ${gaps.map(f3).join(', ')} s (windup + cooldown ${f3(period)})`);
    // tap while moving: rolls for < 0.2 s, then the release flicks
    place(me, -17.5, 0, -24, 0);
    world.devSetTank(0, 100);
    const ev2 = events.length;
    run(S(0.1), () => { it.yaw = 0; it.moveZ = 1; it.fire = true; });
    reset(it, 0);
    run(S(0.6));
    const r2 = take('roll', ev2).filter((e) => e.pid === 0);
    const fl3 = take('flick', ev2).filter((e) => e.pid === 0);
    check('SHEET-DRUM flick: a tap (released within 0.2 s) while rolling flicks',
      r2.length >= 1 && r2[0].on && fl3.length === 1, `roll events ${r2.map((e) => (e.on ? 'on' : 'off')).join(',')}, flicks ${fl3.length}`);
  }

  // A4. flick damage: damageNear → damageFar by distance; a point-blank flick washes
  {
    fresh();
    const me = DRUM, it = intents[0], foe = FOES[0];
    waitAlive(foe);
    const per: string[] = [];
    let formulaOk = true, nearWash = false, nearMin = Infinity, farMax = 0, nearN = 0, farN = 0;
    for (const d of [1.6, 6.4]) {
      place(foe, -17.5, 0, -24 + d, Math.PI);
      place(me, -17.5, 0, -24, 0);
      heal(foe);
      world.devSetTank(0, 100);
      const ev0 = events.length;
      run(S(1.0), (k) => { it.yaw = 0; it.pitch = 0; it.fire = k < 2; });
      reset(it, 0);
      const hits = take('hit', ev0).filter((h) => h.victim === foe.id && h.by === 0);
      for (const h of hits) {
        const travel = Math.hypot(h.x - me.x, h.z - me.z);
        const want = lerp(DRUM_F.flick.damageNear, DRUM_F.flick.damageFar, Math.min(1, travel / DRUM_F.flick.reach));
        if (Math.abs(h.dmg - want) > 0.05) formulaOk = false;
        if (d < 3) { nearMin = Math.min(nearMin, h.dmg); nearN++; } else { farMax = Math.max(farMax, h.dmg); farN++; }
      }
      if (d < 3) nearWash = take('washed', ev0).some((w) => w.victim === foe.id && w.by === 0);
      per.push(`${d} m: ${hits.length} hits [${hits.map((h) => f2(h.dmg)).join(' ')}]`);
      waitAlive(foe);
    }
    check('SHEET-DRUM flick damage: lerp(damageNear, damageFar, travel / reach) per droplet; point blank washes',
      formulaOk && nearN >= 2 && farN >= 1 && nearWash && nearMin > farMax,
      `${per.join(' · ')}; formula ${formulaOk ? 'exact' : 'MISMATCH'}; point-blank washed ${nearWash}`);
    park(foe);
  }

  // ═══════════════════ NEEDLE-GLINT ═══════════════════
  {
    fresh();
    const me = NEEDLE, it = intents[1], foe = FOES[1];
    waitAlive(foe);
    park(...FOES);
    // B1. charge rate + glints + full charge washes at 25 m
    place(foe, -17.5, 0, 1, Math.PI);
    place(me, -17.5, 0, -24, 0);
    world.devSetTank(1, 100);
    heal(foe);
    const ev0 = events.length;
    const tank0 = me.tank;
    let c30 = NaN, c60 = NaN;
    run(S(1.2), (k) => {
      it.yaw = 0; it.fire = true; aimAt(it, foe.x, foe.y + HITBOX.height / 2, foe.z);
      if (k === 30) c30 = me.charge;
      if (k === 60) c60 = me.charge;
      watch(me);
    });
    const glints = take('glint', ev0).filter((e) => e.pid === 1);
    const gT = takeT('glint', ev0).filter((x) => x.e.pid === 1).map((x) => x.tick);
    const g60 = gT.filter((t) => t - gT[0] < S(NEEDLE_F.chargeSeconds)).length;
    const gGaps = gT.slice(1).map((t, i) => t - gT[i]);
    const gapOk = gGaps.every((g) => g === S(KITS.glintEvery));
    const gDirOk = glints.every((g) => Math.hypot(g.dx, g.dy, g.dz) > 0.999 && g.dz > 0.99 && Math.abs(g.y - (me.y + COMBAT.muzzleHeight)) < 0.01);
    check('NEEDLE-GLINT: charge 0→1 over chargeSeconds; a glint (origin, dir, charge) every 0.1 s while charging',
      Math.abs(c30 - 30 * TICK / NEEDLE_F.chargeSeconds) < 1e-6 && c60 === 1 && g60 === Math.round(NEEDLE_F.chargeSeconds / KITS.glintEvery)
        && gDirOk && gapOk && glints[glints.length - 1].charge === 1 && glints[0].charge > 0,
      `charge after 30 ticks ${f3(c30)}, after 60 ${f3(c60)}; ${g60} glints in the first ${NEEDLE_F.chargeSeconds} s (${glints.length} total), gaps ${Math.min(...gGaps)}–${Math.max(...gGaps)} ticks, dir/origin ok ${gDirOk}, last glint charge ${f2(glints[glints.length - 1]?.charge ?? NaN)}`);
    const ev1 = events.length;
    it.fire = false;
    run(S(0.3));
    reset(it, 0);
    const beams = take('beam', ev1).filter((e) => e.pid === 1);
    const hits = take('hit', ev1).filter((h) => h.victim === foe.id && h.by === 1);
    const washed = take('washed', ev1).some((w) => w.victim === foe.id && w.by === 1);
    const blen = beams.length ? Math.hypot(beams[0].x1 - beams[0].x0, beams[0].y1 - beams[0].y0, beams[0].z1 - beams[0].z0) : NaN;
    check('NEEDLE-GLINT: a full charge releases a hitscan beam that washes at 25 m (damageFull, tankFull)',
      beams.length === 1 && beams[0].charge === 1 && hits.length === 1 && hits[0].dmg === NEEDLE_F.damageFull && washed
        && Math.abs(tank0 - me.tank - NEEDLE_F.tankFull) < 1e-9 && blen < 25.2,
      `${beams.length} beam(s) charge ${f2(beams[0]?.charge ?? NaN)} length ${f2(blen)} m; hit ${hits.map((h) => h.dmg).join(',')} (damageFull ${NEEDLE_F.damageFull}); washed ${washed}; tank −${f2(tank0 - me.tank)} (tankFull ${NEEDLE_F.tankFull})`);
    waitAlive(foe);

    // B2. partial charge: range lerp(min, max, c) → misses at 25 m; line splats every lineSpacing + an end splat
    fresh();
    place(foe, -17.5, 0, 1, Math.PI);
    place(me, -17.5, 0, -24, 0);
    world.devSetTank(1, 100);
    heal(foe);
    const ev2 = events.length;
    const tank2 = me.tank;
    run(30, () => { it.yaw = 0; it.fire = true; aimAt(it, foe.x, foe.y + HITBOX.height / 2, foe.z); });
    const cHalf = me.charge;
    it.fire = false;
    run(S(0.3));
    reset(it, 0);
    const b2 = take('beam', ev2).filter((e) => e.pid === 1);
    const h2 = take('hit', ev2).filter((h) => h.victim === foe.id);
    const len2 = b2.length ? Math.hypot(b2[0].x1 - b2[0].x0, b2[0].y1 - b2[0].y0, b2[0].z1 - b2[0].z0) : NaN;
    const wantLen = lerp(NEEDLE_F.minRange, NEEDLE_F.maxRange, cHalf);
    check('NEEDLE-GLINT: a partial charge reaches only lerp(minRange, maxRange, charge) — no hit at 25 m; costs lerp(tankMin, tankFull, charge)',
      b2.length === 1 && Math.abs(len2 - wantLen) < 0.01 && h2.length === 0
        && Math.abs(tank2 - me.tank - lerp(NEEDLE_F.tankMin, NEEDLE_F.tankFull, cHalf)) < 1e-6,
      `charge ${f3(cHalf)} → beam ${f3(len2)} m (want ${f3(wantLen)}), hits ${h2.length}, tank −${f3(tank2 - me.tank)} (want ${f3(lerp(NEEDLE_F.tankMin, NEEDLE_F.tankFull, cHalf))})`);
    const line = take('splat', ev2).filter((e) => Math.abs(e.r - NEEDLE_F.paint.lineRadius) < 1e-6);
    const endS = take('splat', ev2).filter((e) => Math.abs(e.r - NEEDLE_F.paint.endRadius) < 1e-6);
    const zs = line.map((e) => e.z).sort((a, b) => a - b);
    const gaps = zs.slice(1).map((z, i) => z - zs[i]);
    const wantN = Math.floor((len2 - 1e-6) / NEEDLE_F.paint.lineSpacing);
    const onProj = line.every((e) => Math.abs(e.x - me.x) < 0.02 && Math.abs(e.y) < 0.03 && e.ny > 0.99);
    const endOk = endS.length === 1 && b2.length === 1 && Math.hypot(endS[0].x - b2[0].x1, endS[0].z - b2[0].z1) < 0.02 && Math.abs(endS[0].y) < 0.03;
    check('NEEDLE-GLINT: line splats (lineRadius) every lineSpacing on the beam\'s floor projection + an endRadius splat at the end',
      line.length === wantN && gaps.every((g) => Math.abs(g - NEEDLE_F.paint.lineSpacing) < 0.02) && onProj && endOk,
      `${line.length} line splats (want ${wantN}), spacing ${f3(Math.min(...gaps))}–${f3(Math.max(...gaps))} m (lineSpacing ${NEEDLE_F.paint.lineSpacing}); on the floor under the beam ${onProj}; end splat r ${NEEDLE_F.paint.endRadius} under the beam end ${endOk}`);

    // B3. partial charge at 15 m: lerp(damageMin, damageFull, charge), not a wash
    place(foe, -17.5, 0, -9, Math.PI);
    place(me, -17.5, 0, -24, 0);
    world.devSetTank(1, 100);
    heal(foe);
    const ev3 = events.length;
    run(30, () => { it.yaw = 0; it.fire = true; aimAt(it, foe.x, foe.y + HITBOX.height / 2, foe.z); });
    const c3 = me.charge;
    it.fire = false;
    run(S(0.3));
    reset(it, 0);
    const h3 = take('hit', ev3).filter((h) => h.victim === foe.id && h.by === 1);
    const w3 = take('washed', ev3).some((w) => w.victim === foe.id);
    check('NEEDLE-GLINT: a partial charge deals lerp(damageMin, damageFull, charge) and does not wash',
      h3.length === 1 && Math.abs(h3[0].dmg - lerp(NEEDLE_F.damageMin, NEEDLE_F.damageFull, c3)) < 1e-6 && !w3 && foe.alive,
      `charge ${f3(c3)} at 15 m → ${h3.map((h) => f2(h.dmg)).join(',')} (want ${f2(lerp(NEEDLE_F.damageMin, NEEDLE_F.damageFull, c3))}), washed ${w3}, hp ${f2(foe.hp)}`);

    // B4. below 15 %: nothing, free. Too little tank: dry click, no charge.
    world.devSetTank(1, 100);
    const ev4 = events.length;
    const tank4 = me.tank;
    run(8, () => { it.yaw = 0; it.fire = true; });
    const c4 = me.charge;
    it.fire = false;
    run(S(0.3));
    const b4 = take('beam', ev4).filter((e) => e.pid === 1).length + take('shot', ev4).filter((e) => e.pid === 1).length;
    world.devSetTank(1, NEEDLE_F.tankMin - 1);
    const ev5 = events.length;
    run(S(0.5), () => { it.yaw = 0; it.fire = true; });
    const c5 = me.charge;
    it.fire = false;
    run(2);
    const dry5 = take('dry', ev5).filter((e) => e.pid === 1).length, gl5 = take('glint', ev5).length;
    check('NEEDLE-GLINT: release below 15 % fires nothing and costs nothing; tank < tankMin dry-clicks',
      c4 < 0.15 && b4 === 0 && me.tank === NEEDLE_F.tankMin - 1 && Math.abs(tank4 - 100) < 1e-9 && dry5 >= 1 && gl5 === 0 && c5 === 0,
      `released at ${f3(c4)} → ${b4} shots/beams; tank ${NEEDLE_F.tankMin - 1}: ${dry5} dry clicks, ${gl5} glints, charge ${c5}`);

    // B5. move speed while charging
    world.devSetTank(1, 100);
    place(me, -17.5, 0, -24, 0);
    const sp: number[] = [];
    run(S(1.0), (k) => { it.yaw = 0; it.moveZ = 1; it.fire = true; if (k > S(0.5)) sp.push(me.speed); });
    reset(it, 0);
    run(S(0.3));
    const mv = sp.reduce((a, v) => a + v, 0) / sp.length;
    check('NEEDLE-GLINT: moves at moveSpeedWhileCharging × walk while charging', Math.abs(mv - MOVE.walk * NEEDLE_F.moveSpeedWhileCharging) < 0.03,
      `${f3(mv)} m/s (want ${f3(MOVE.walk * NEEDLE_F.moveSpeedWhileCharging)})`);
    park(foe);
  }

  // ═══════════════════ POP-WELL ═══════════════════
  {
    fresh();
    const me = POP, it = intents[2];
    park(...FOES);
    waitAlive(...FOES);
    // C1. rate, tank, airburst at maxRange (+ airburstRadius paint on the floor below)
    place(me, -17.5, 0, -24, 0);
    world.devSetTank(2, 100);
    const ev0 = events.length;
    let maxBurstKinds = 0;
    run(S(4.0), () => {
      it.yaw = 0; it.pitch = 0; it.fire = true;
      for (let i = 0; i < P.count; i++) if (P.kind[i] === KIND_BURST) maxBurstKinds = Math.max(maxBurstKinds, 1);
    });
    const tank1 = me.tank;
    reset(it, 0);
    run(S(1.0));
    const shots = take('shot', ev0).filter((e) => e.pid === 2);
    const wantShots = Math.floor(4.0 * POP_F.shotsPerSecond) + 1;
    check('POP-WELL: shotsPerSecond while held, tankPerShot each (kind-2 projectiles)',
      shots.length === wantShots && Math.abs(100 - tank1 - shots.length * POP_F.tankPerShot) < 1e-9 && maxBurstKinds === 1,
      `${shots.length} shots in 4.00 s (want ${wantShots} at ${POP_F.shotsPerSecond}/s incl. the first), tank −${f2(100 - tank1)} (${POP_F.tankPerShot}/shot)`);
    const bursts = take('burst', ev0).filter((e) => e.pid === 2);
    const bd = bursts.map((b, i) => Math.hypot(b.x - shots[i].x, b.y - shots[i].y, b.z - shots[i].z));
    const air = take('splat', ev0).filter((e) => Math.abs(e.r - POP_F.paint.airburstRadius) < 1e-6);
    const airOk = air.length === bursts.length && air.every((s, i) => Math.abs(s.y) < 0.03 && Math.hypot(s.x - bursts[i].x, s.z - bursts[i].z) < 0.02);
    check('POP-WELL: airburst at maxRange (air, r = splashRadius) + an airburstRadius splat on the floor below',
      bursts.length === shots.length && bursts.every((b) => b.air && b.r === POP_F.splashRadius) && bd.every((d) => Math.abs(d - POP_F.maxRange) < 0.02) && airOk,
      `${bursts.length} bursts, all air ${bursts.every((b) => b.air)}, at ${f3(Math.min(...bd))}–${f3(Math.max(...bd))} m (maxRange ${POP_F.maxRange}); ${air.length} floor splats r ${POP_F.paint.airburstRadius} under them ${airOk}`);

    // C2. direct hit
    fresh();
    const foe = FOES[0];
    place(foe, -17.5, 0, -19, Math.PI);
    place(me, -17.5, 0, -24, 0);
    world.devSetTank(2, 100);
    heal(foe);
    const ev1 = events.length;
    run(S(1.0), (k) => { it.yaw = 0; it.fire = k < 1; aimAt(it, foe.x, foe.y + 0.6, foe.z); });
    reset(it, 0);
    const dh = take('hit', ev1).filter((h) => h.victim === foe.id && h.by === 2);
    const b1 = take('burst', ev1).filter((e) => e.pid === 2);
    check('POP-WELL: a direct capsule hit deals directDamage (and washes)',
      dh.length === 1 && dh[0].dmg === POP_F.directDamage && b1.length === 1 && !b1[0].air && take('washed', ev1).some((w) => w.victim === foe.id && w.by === 2),
      `hits ${dh.map((h) => h.dmg).join(',')} (directDamage ${POP_F.directDamage}); bursts ${b1.length} (air ${b1[0]?.air})`);
    waitAlive(foe);

    // C3. splash on a floor impact: linear falloff to 40 % at splashRadius; nothing beyond; impactRadius paint
    fresh();
    const [e5, e6] = [FOES[1], FOES[2]];
    const Pz = -18, Px = -17.5;
    place(e5, Px + 1.2, 0, Pz, 0);
    place(e6, Px, 0, Pz + 3.4, 0);
    place(me, -17.5, 0, -24, 0);
    world.devSetTank(2, 100);
    heal(e5); heal(e6);
    const ev2 = events.length;
    run(S(1.0), (k) => { it.yaw = 0; it.fire = k < 1; aimAt(it, Px, 0, Pz); });
    reset(it, 0);
    const b2 = take('burst', ev2).filter((e) => e.pid === 2);
    const s5 = take('hit', ev2).filter((h) => h.victim === e5.id), s6 = take('hit', ev2).filter((h) => h.victim === e6.id);
    const d5 = b2.length ? axisDist(e5, b2[0].x, b2[0].y, b2[0].z) : NaN;
    const want5 = POP_F.splashDamage * (1 - (1 - KITS.splashEdgeFactor) * d5 / POP_F.splashRadius);
    const imp = take('splat', ev2).filter((e) => Math.abs(e.r - POP_F.paint.impactRadius) < 1e-6);
    check('POP-WELL: splash within splashRadius with linear falloff to 40 %; none beyond; impactRadius splat at the impact',
      b2.length === 1 && !b2[0].air && Math.hypot(b2[0].x - Px, b2[0].z - Pz) < 0.05 && s5.length === 1 && Math.abs(s5[0].dmg - want5) < 0.01
        && s6.length === 0 && imp.length === 1 && Math.hypot(imp[0].x - Px, imp[0].z - Pz) < 0.05,
      `burst at (${f2(b2[0]?.x ?? NaN)}, ${f2(b2[0]?.z ?? NaN)}); foe at axis ${f3(d5)} m took ${s5.map((h) => f3(h.dmg)).join(',')} (want ${f3(want5)} = ${POP_F.splashDamage}×(1−0.6·d/${POP_F.splashRadius})); foe ${f2(axisDist(e6, b2[0]?.x ?? 0, b2[0]?.y ?? 0, b2[0]?.z ?? 0))} m away: ${s6.length} hits; impact splats r ${POP_F.paint.impactRadius}: ${imp.length}`);

    // C4. splash checks line of sight (a foe behind the chevron wall takes nothing; one in the open does)
    fresh();
    place(e5, -13.8, 0, -10.9, 0);
    place(e6, -12, 0, -9.1, Math.PI);
    place(me, -12, 0, -16, 0);
    world.devSetTank(2, 100);
    heal(e5); heal(e6);
    const ev3 = events.length;
    run(S(1.0), (k) => { it.yaw = 0; it.fire = k < 1; aimAt(it, -12, 0, -10.9); });
    reset(it, 0);
    const b3 = take('burst', ev3).filter((e) => e.pid === 2);
    const o5 = take('hit', ev3).filter((h) => h.victim === e5.id).length, o6 = take('hit', ev3).filter((h) => h.victim === e6.id).length;
    const d6 = b3.length ? axisDist(e6, b3[0].x, b3[0].y, b3[0].z) : NaN;
    check('POP-WELL: splash damage checks line of sight', b3.length === 1 && o5 === 1 && o6 === 0 && d6 < POP_F.splashRadius,
      `open-side foe ${o5} hit; foe behind the wall at axis ${f2(d6)} m (< ${POP_F.splashRadius}): ${o6} hits`);
    park(...FOES);
  }

  // ═══════════════════ JELLY CHARGE ═══════════════════
  {
    fresh();
    const me = MIST, it = intents[3];
    waitAlive(...FOES);
    park(...FOES);
    place(me, -15, 0, -25, 0);
    // D1. tank gate: < tankCost dry-clicks; ≥ tankCost throws and pays on the throw
    world.devSetTank(3, JELLY.tankCost - 10);
    const ev0 = events.length;
    run(3, () => { it.yaw = 0; it.sub = true; aimAt(it, -15, 0, -18); });
    it.sub = false;
    run(S(0.5));
    const dry0 = take('dry', ev0).filter((e) => e.pid === 3).length, thr0 = take('sub', ev0).length;
    check('JELLY: tank < tankCost → dry click, nothing thrown, nothing paid', dry0 >= 1 && thr0 === 0 && me.tank === JELLY.tankCost - 10,
      `${dry0} dry, ${thr0} sub events, tank ${me.tank}`);
    // D2. throw at the aim point; lands there; puddleFuse; damage falloff with LOS; paint
    const Px = -15, Pz = -18;
    const [a, b, c, d] = FOES;
    place(a, Px + 0.8, 0, Pz, 0);
    place(b, Px - 1.8, 0, Pz, 0);
    place(c, Px, 0, Pz + 2.6, 0);
    place(d, Px, 0, Pz - 3.4, 0);
    for (const f of FOES) heal(f);
    world.devSetTank(3, 100);
    const ev1 = events.length;
    it.sub = true; aimAt(it, Px, 0, Pz);
    tick();
    it.sub = false;
    const cd = me.subCooldown, tankT = me.tank;
    let jellySeen = false;
    run(S(2.5), () => { for (let i = 0; i < P.count; i++) if (P.kind[i] === KIND_JELLY) jellySeen = true; });
    reset(it, 0);
    const subs = takeT('sub', ev1).filter((x) => x.e.pid === 3);
    const thr = subs.find((x) => x.e.phase === 'throw'), land = subs.find((x) => x.e.phase === 'land'), pop = subs.find((x) => x.e.phase === 'pop');
    check('JELLY: the throw pays tankCost; kind 3 flies to the aim point (throwSpeed, gravity) and lands there; subCooldown read-out',
      !!thr && !!land && Math.abs(100 - tankT - JELLY.tankCost) < 1e-9 && Math.hypot(land.e.x - Px, land.e.z - Pz) < 0.25 && jellySeen && Math.abs(cd - KITS.subCooldown) < 1e-9,
      `tank 100 → ${f2(tankT)}; landed ${land ? f2(Math.hypot(land.e.x - Px, land.e.z - Pz)) : '—'} m from the aim point after ${land && thr ? f2((land.tick - thr.tick) * TICK) : '—'} s; subCooldown ${f2(cd)}`);
    const fuse = land && pop ? (pop.tick - land.tick) * TICK : NaN;
    check('JELLY: the puddle pops puddleFuse after landing', Math.abs(fuse - JELLY.puddleFuse) <= 0.5 * TICK,
      `${f3(fuse)} s (puddleFuse ${JELLY.puddleFuse})`);
    const rows: string[] = [];
    let dmgOk = !!pop;
    for (const f of FOES) {
      const dd = pop ? axisDist(f, pop.e.x, pop.e.y, pop.e.z) : NaN;
      const hs = take('hit', ev1).filter((h) => h.victim === f.id && h.by === 3);
      const want = dd <= JELLY.blastRadius ? lerp(JELLY.damageCenter, JELLY.damageEdge, dd / JELLY.blastRadius) : 0;
      const got = hs.reduce((s, h) => s + h.dmg, 0);
      if (Math.abs(got - want) > 0.01 || (want > 0) !== (hs.length === 1)) dmgOk = false;
      rows.push(`${f2(dd)} m → ${f2(got)} (want ${f2(want)})`);
    }
    const w = take('washed', ev1).filter((x) => x.by === 3);
    check('JELLY: pop damage lerp(damageCenter, damageEdge, d / blastRadius), nothing beyond blastRadius; washes are cause sub',
      dmgOk && w.length >= 1 && w.every((x) => x.cause === 'sub'), `${rows.join(' · ')}; washed ${w.map((x) => `${x.victim}(${x.cause})`).join(',')}`);
    waitAlive(...FOES);

    // D3. paint radius (no foes around)
    fresh();
    park(...FOES);
    place(me, -15, 0, -25, 0);
    world.devSetTank(3, 100);
    const sun0 = painter.weighted(1);
    const ev2 = events.length;
    it.sub = true; aimAt(it, Px, 0, Pz);
    tick();
    it.sub = false;
    run(S(2.5));
    reset(it, 0);
    const pop2 = take('sub', ev2).find((e) => e.pid === 3 && e.phase === 'pop');
    const gain = painter.weighted(1) - sun0;
    const area = Math.PI * JELLY.paintRadius * JELLY.paintRadius;
    const e = 0.18;
    const inner = pop2 ? ringShare(pop2.x, pop2.z, JELLY.paintRadius * (1 - e) - 0.1, 32) : 0;
    const outer = pop2 ? ringShare(pop2.x, pop2.z, JELLY.paintRadius * (1 + e) + 0.1, 32) : 1;
    check('JELLY: the pop paints a paintRadius splat (area ≈ π r² ± 12 %, solid inside r·(1−noise), nothing beyond r·(1+noise))',
      !!pop2 && Math.abs(gain / area - 1) < 0.12 && inner === 1 && outer === 0,
      `dyed ${f2(gain)} m² (π·${JELLY.paintRadius}² = ${f2(area)}, ratio ${f3(gain / area)}); ring at ${f2(JELLY.paintRadius * (1 - e) - 0.1)} m ${f2(inner * 100)} % dyed, at ${f2(JELLY.paintRadius * (1 + e) + 0.1)} m ${f2(outer * 100)} %`);

    // D4. line of sight: a foe behind the chevron wall inside blastRadius takes nothing
    fresh();
    place(a, -13.8, 0, -10.9, 0);
    place(b, -12, 0, -9.1, Math.PI);
    place(me, -12, 0, -16, 0);
    heal(a); heal(b);
    world.devSetTank(3, 100);
    run(S(0.6));
    const ev3 = events.length;
    it.sub = true; aimAt(it, -12, 0, -10.9);
    tick();
    it.sub = false;
    run(S(2.5));
    reset(it, 0);
    const pop3 = take('sub', ev3).find((x) => x.pid === 3 && x.phase === 'pop');
    const ha = take('hit', ev3).filter((h) => h.victim === a.id).length, hb = take('hit', ev3).filter((h) => h.victim === b.id).length;
    const db = pop3 ? axisDist(b, pop3.x, pop3.y, pop3.z) : NaN;
    check('JELLY: pop damage checks line of sight', !!pop3 && ha === 1 && hb === 0 && db < JELLY.blastRadius,
      `open-side foe ${ha} hit; foe behind the wall at ${f2(db)} m (< ${JELLY.blastRadius}): ${hb} hits`);
    waitAlive(...FOES);
    park(...FOES);
  }

  // ═══════════════════ SPECIAL METER ═══════════════════
  {
    fresh();
    const me = DRUM, it = intents[0];
    place(me, -17.5, 0, -24, 0);
    world.devSetTank(0, 100);
    me.special = 0; me.specialReady = false;
    const p0 = me.painted, sun0 = painter.weighted(1);
    run(S(1.0), () => { it.yaw = 0; it.moveZ = 1; it.fire = true; });
    reset(it, 0);
    run(S(0.2));
    const gained = me.painted - p0;
    const wantM = gained * SPC.pointsPerSquareMetre / WELL.chargePoints;
    check('special meter: pointsPerSquareMetre per weighted m² newly dyed by the runner (roll strip), over the kit special\'s chargePoints',
      gained > 1 && Math.abs(gained - (painter.weighted(1) - sun0)) < 1e-6 && Math.abs(me.special - wantM) < 1e-9,
      `rolled ${f2(gained)} m² (team gain ${f2(painter.weighted(1) - sun0)}) → meter ${f3(me.special)} (want ${f3(wantM)} = m²/${WELL.chargePoints})`);
    // 'ready' fires once
    me.special = 0.99;
    place(me, -17.5, 0, -24, 0);
    const ev0 = events.length;
    run(S(1.5), () => { it.yaw = 0; it.moveZ = 1; it.fire = true; });
    reset(it, 0);
    run(S(0.2));
    const ready = take('special', ev0).filter((e) => e.pid === 0 && e.phase === 'ready');
    check('special meter: a special:ready event fires once when the meter fills', ready.length === 1 && me.specialReady && me.special === 1 && ready[0].id === 'wellspring',
      `${ready.length} ready event(s) (${ready[0]?.id}), meter ${f3(me.special)}, specialReady ${me.specialReady}`);
    // washed keeps keepOnWashed
    me.special = 0.8; me.specialReady = false;
    world.devDamage(0, 200, 4);
    const kept = me.special;
    waitAlive(me);
    check('special meter: being washed keeps keepOnWashed', Math.abs(kept - 0.8 * SPC.keepOnWashed) < 1e-9,
      `0.800 → ${f3(kept)} (keepOnWashed ${SPC.keepOnWashed})`);
    // not ready → intent.special does nothing
    me.special = 0.5; me.specialReady = false;
    place(me, -17.5, 0, -24, 0);
    const ev1 = events.length;
    run(3, () => { it.special = true; });
    reset(it, 0);
    check('special: intent.special does nothing until ready', take('special', ev1).filter((e) => e.pid === 0 && e.phase === 'start').length === 0 && me.specialActive === '' && me.special === 0.5,
      `start events ${take('special', ev1).filter((e) => e.phase === 'start').length}, meter ${f2(me.special)}`);
  }

  // ═══════════════════ CLOUDBURST ═══════════════════
  {
    fresh();
    const me = NEEDLE, it = intents[1];
    waitAlive(...FOES);
    park(...FOES);
    const [under, outside] = [FOES[0], FOES[1]];
    const Cx = -12, Cz = -18;
    place(under, Cx + 2, 0, Cz, 0);
    place(outside, Cx, 0, Cz + CLOUD.soakRadius + 1.5, 0);
    place(me, -14, 0, -27, 0);
    heal(under); heal(outside);
    world.devSetTank(1, 100);
    me.special = 1; me.specialReady = true;
    const sun0 = painter.weighted(1);
    const ev0 = events.length;
    it.special = true; aimAt(it, Cx, 0, Cz);
    tick();
    it.special = false;
    const started = me.specialActive, meter0 = me.special;
    let landTick = -1, landX = NaN, landZ = NaN, hoverY = NaN, maxMeter = 0, cloudSeen = false, maxT = 0;
    let guard = 0;
    while (guard++ < S(10) && !take('special', ev0).some((e) => e.pid === 1 && e.phase === 'end')) {
      tick();
      maxMeter = Math.max(maxMeter, me.special);
      maxT = Math.max(maxT, me.specialT);
      for (let i = 0; i < P.count; i++) {
        if (P.kind[i] !== KIND_CLOUD) continue;
        cloudSeen = true;
        if (P.state[i] === PSTATE_HOVER && landTick < 0) { landTick = world.tick; landX = P.x[i]; landZ = P.z[i]; }
        if (landTick >= 0 && world.tick === landTick + S(KITS.cloudRiseSeconds)) hoverY = P.y[i];
      }
    }
    reset(it, 0);
    const sp = takeT('special', ev0).filter((x) => x.e.pid === 1);
    const st = sp.find((x) => x.e.phase === 'start'), en = sp.find((x) => x.e.phase === 'end');
    check('CLOUDBURST: intent.special when ready starts it (meter → 0, specialActive), thrown as kind 4 to the aim point',
      !!st && started === 'cloudburst' && meter0 === 0 && cloudSeen && Math.hypot(landX - Cx, landZ - Cz) < 0.6,
      `start ${!!st}, specialActive '${started}', meter ${meter0}; landed ${f2(Math.hypot(landX - Cx, landZ - Cz))} m from the aim point`);
    check('CLOUDBURST: rises to hoverHeight above the floor', Math.abs(hoverY - CLOUD.hoverHeight) < 0.02,
      `hover y ${f3(hoverY)} over floor y 0 (hoverHeight ${CLOUD.hoverHeight})`);
    const rainS = en ? (en.tick - landTick) * TICK - KITS.cloudRiseSeconds : NaN;
    check('CLOUDBURST: rains for `duration`, then special:end (specialT read-out, specialActive cleared)',
      !!en && Math.abs(rainS - CLOUD.duration) <= 0.5 * TICK && me.specialActive === '' && maxT > CLOUD.duration,
      `rain ${f3(rainS)} s after a ${KITS.cloudRiseSeconds} s rise (duration ${CLOUD.duration}); specialT reached ${f2(maxT)} s; active now '${me.specialActive}'`);
    const drops = take('splat', ev0).filter((e) => Math.abs(e.r - CLOUD.dropPaintRadius) < 1e-6);
    const wantDrops = Math.round(CLOUD.dropsPerSecond * CLOUD.duration);
    const inDisk = drops.every((e) => Math.hypot(e.x - landX, e.z - landZ) <= CLOUD.soakRadius + 1e-3);
    check('CLOUDBURST: dropsPerSecond × duration drops, each a dropPaintRadius splat inside soakRadius (raycast down)',
      drops.length === wantDrops && inDisk && drops.every((e) => Math.abs(e.y) < 0.03),
      `${drops.length} drops (want ${wantDrops}), all inside ${CLOUD.soakRadius} m: ${inDisk}`);
    const gain = painter.weighted(1) - sun0;
    const disk = Math.PI * CLOUD.soakRadius * CLOUD.soakRadius;
    check('CLOUDBURST: paints the soak disk over its duration (0.75–1.1 × π·soakRadius²)', gain / disk > 0.75 && gain / disk < 1.1,
      `dyed ${f2(gain)} m² vs disk ${f2(disk)} m² (ratio ${f3(gain / disk)})`);
    const hu = take('hit', ev0).filter((h) => h.victim === under.id && h.by === 1), ho = take('hit', ev0).filter((h) => h.victim === outside.id);
    const dealt = hu.reduce((s, h) => s + h.dmg, 0);
    check('CLOUDBURST: damagePerSecond to enemies under the disk only', Math.abs(dealt - CLOUD.damagePerSecond * CLOUD.duration) < 1e-6 && ho.length === 0,
      `foe under the disk took ${f2(dealt)} in ${hu.length} ticks (want ${f2(CLOUD.damagePerSecond * CLOUD.duration)}); foe ${f2(CLOUD.soakRadius + 1.5)} m out: ${ho.length} hits`);
    check('special meter: no charge while the special runs', maxMeter === 0, `max meter during CLOUDBURST ${maxMeter}`);
    park(...FOES);
  }

  // ═══════════════════ WELLSPRING ═══════════════════
  {
    fresh();
    const me = DRUM, it = intents[0];
    waitAlive(...FOES);
    park(...FOES);
    const Cx = -12, Cz = -20;
    const [near, far] = [FOES[0], FOES[1]];
    place(near, Cx + 2, 0, Cz, 0);
    place(far, Cx, 0, Cz + 4, 0);
    place(me, Cx, 0, Cz, 0);
    heal(near); heal(far); heal(me);
    world.devSetTank(0, 100);
    me.special = 1; me.specialReady = true;
    const sun0 = painter.weighted(1);
    const y0 = me.y, x0 = me.x, z0 = me.z;
    const ev0 = events.length;
    it.special = true;
    tick();
    it.special = false;
    const startTick = world.tick;
    let maxY = y0, drift = 0, hp = me.hp, ringTick = -1, leapSeen = false;
    let nv = NaN, nvx = 0, nvz = 0;
    for (let k = 0; k < S(3) && ringTick < 0; k++) {
      const probeInput = k < 20;
      it.moveZ = probeInput ? 1 : 0; it.fire = probeInput;
      if (k === 12) world.devDamage(0, 50, 4);
      tick();
      leapSeen ||= me.leaping;
      maxY = Math.max(maxY, me.y);
      drift = Math.max(drift, Math.hypot(me.x - x0, me.z - z0));
      hp = Math.min(hp, me.hp);
      if (take('ring', ev0).length) { ringTick = world.tick; nv = Math.hypot(near.vx, near.vz); nvx = near.vx; nvz = near.vz; }
    }
    reset(it, 0);
    const shotsDuring = take('shot', ev0).filter((e) => e.pid === 0).length + take('roll', ev0).filter((e) => e.pid === 0 && e.on).length;
    const air = (ringTick - startTick) * TICK;
    check('WELLSPRING: leaps leapHeight (≈ 0.6 s) and slams on landing (special start → ring → end)',
      leapSeen && Math.abs(maxY - y0 - WELL.leapHeight) < 0.1 && Math.abs(air - KITS.leapSeconds) <= 3 * TICK
        && take('special', ev0).some((e) => e.pid === 0 && e.phase === 'start') && take('special', ev0).some((e) => e.pid === 0 && e.phase === 'end'),
      `apex +${f3(maxY - y0)} m (leapHeight ${WELL.leapHeight}), slam after ${f3(air)} s (${KITS.leapSeconds} s)`);
    check('WELLSPRING: the leap can\'t be interrupted (damage ignored; move / fire intents ignored)',
      hp === WEAPONS.hp && drift < 0.02 && shotsDuring === 0,
      `hp stayed ${f2(hp)} after a 50-damage hit mid-leap; drift ${f3(drift)} m with the stick held; ${shotsDuring} shots/rolls`);
    const ring = take('ring', ev0)[0];
    const hn = take('hit', ev0).filter((h) => h.victim === near.id && h.by === 0), hf = take('hit', ev0).filter((h) => h.victim === far.id);
    const dirOk = nv > 0 && nvx / nv > 0.95;
    check('WELLSPRING: coreDamage within coreRadius (none outside) + a knockback impulse outward',
      hn.length === 1 && hn[0].dmg === WELL.coreDamage && hf.length === 0 && Math.abs(nv - WELL.knockback) < 0.3 && dirOk,
      `foe at 2 m: ${hn.map((h) => h.dmg).join(',')} (coreDamage ${WELL.coreDamage}), knocked at ${f2(nv)} m/s (knockback ${WELL.knockback}) outward ${dirOk}; foe at 4 m: ${hf.length} hits`);
    const gain = painter.weighted(1) - sun0;
    const rx = ring?.x ?? Cx, rz = ring?.z ?? Cz;
    const onRing = ringShare(rx, rz, WELL.ringRadius, 48), gap = ringShare(rx, rz, (WELL.coreRadius * 1.18 + WELL.ringRadius - WELL.ringWidth / 2 * 1.18) / 2, 48);
    const core = Math.min(ringShare(rx, rz, 1.2, 16), ringShare(rx, rz, WELL.coreRadius * 0.82 - 0.1, 32));
    const want = 2 * Math.PI * WELL.ringRadius * WELL.ringWidth + Math.PI * WELL.coreRadius * WELL.coreRadius;
    check('WELLSPRING: paints a ring (ringRadius × ringWidth) plus a core splat; the gap between stays clean',
      ring?.r === WELL.ringRadius && onRing >= 0.9 && gap === 0 && core === 1 && gain / want > 0.8 && gain / want < 1.2,
      `ring r ${ring?.r}: ${f2(onRing * 100)} % dyed on the circle, ${f2(gap * 100)} % in the gap, core ${f2(core * 100)} %; dyed ${f2(gain)} m² (ring + core ≈ ${f2(want)}, ratio ${f3(gain / want)})`);
    run(S(0.6));
    check('WELLSPRING: the knocked foe carries away from the slam', Math.hypot(near.x - rx, near.z - rz) > 2 + 2.0,
      `foe now ${f2(Math.hypot(near.x - rx, near.z - rz))} m from the slam (was 2.00)`);
  }

  // ═══════════════════ read-outs / pool kinds ═══════════════════
  check('ProjectilePool kinds: 1 flick, 2 burst, 3 jelly, 4 cloudburst cell all seen in flight',
    kindsSeen.has(KIND_FLICK) && kindsSeen.has(KIND_BURST) && kindsSeen.has(KIND_JELLY) && kindsSeen.has(KIND_CLOUD),
    `kinds seen: ${[...kindsSeen].sort().join(', ')}`);
  check('Runner read-outs: charge reaches 1, rolling and flicking observed', maxCharge === 1 && rollingSeen && flickingSeen,
    `max charge ${maxCharge}, rolling ${rollingSeen}, flicking ${flickingSeen}`);

  console.log('-'.repeat(100));
  console.log(`stats: ${JSON.stringify(world.stats)}`);
  const failed = checks.filter((c) => !c.pass);
  const verdict = failed.length ? `FAIL (${failed.length})` : 'OK';
  console.log(`probe_kits: ${checks.length - failed.length}/${checks.length} checks pass · ${((performance.now() - t0) / 1000).toFixed(2)} s`);
  console.log(`RESULT: ${verdict}`);
  log('verbose');
  try {
    const dir = resolve(HERE, '_reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'probe_kits.json'), JSON.stringify({ checks, stats: world.stats, verdict, at: new Date().toISOString() }, null, 2) + '\n', 'utf8');
  } catch { /* best-effort */ }
  physics.dispose();
  return failed.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => {
  console.log('SETUP FAILED:', (e as Error)?.stack ?? e);
  console.log('RESULT: FAIL');
  process.exit(2);
});
