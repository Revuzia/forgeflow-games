// DYEFIELD — gate G7 (CONTRACT §12): MIST-RASP combat on the real Pier 18 collision + paint atlas,
// Rapier in plain Node. Runners are driven by PlayerIntents through MatchWorld.step (fire held, aim
// points, stick); positions between checks are set with the dev teleport.
//
//   node _harness/probe_combat.ts            # G7
//   node _harness/probe_combat.ts --verbose
//
// Exit: 0 all pass · 1 a check failed · 2 setup failure.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRapier, PhysicsWorld } from '../runtime/src/core/physics.ts';
import { loadMapGeometry, type MapGeometry } from '../runtime/src/core/mapgeo.ts';
import { buildAtlas } from '../runtime/src/core/paint/atlas.ts';
import { Painter } from '../runtime/src/core/paint/painter.ts';
import { mapById, WEAPONS } from '../runtime/src/core/data.ts';
import { COMBAT, HEALTH, MOVE, TANK, TICK } from '../runtime/src/core/config.ts';
import { DEG, emptyIntent, type PlayerIntent } from '../runtime/src/core/types.ts';
import type { Runner } from '../runtime/src/core/runner.ts';
import { MatchWorld } from '../runtime/src/core/match/world.ts';
import { defaultRoster } from '../runtime/src/core/match/roster.ts';
import type { SimEvent } from '../runtime/src/core/match/events.ts';
import { streamFire, projectileKind } from '../runtime/src/core/combat/kits.ts';

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

type Ev<T extends SimEvent['t']> = Extract<SimEvent, { t: T }>;

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
  const roster = defaultRoster({ humanKit: 'mist-rasp', seed: 11, skill: 'fresh' });
  const world = new MatchWorld({ def, geo, physics, painter, roster, seed: 11, countdownS: 0, durationS: 900 });
  const F = streamFire('mist-rasp');
  const K = projectileKind(F);
  const me = world.runners[0], ally = world.runners[1], foe = world.runners[4];
  console.log(`map pier18 · MIST-RASP: ${F.shotsPerSecond}/s, ${F.tankPerShot} tank/shot, dmg ${F.damage}, v ${F.projectileSpeed} m/s, straight ${F.straightTime} s, g ${F.gravity}, drag ${f3(K.drag)}/s (maxRange ${F.maxRange} m), impact r ${F.impactRadius}, drip ${F.dripRadius}/${F.dripEvery} s · setup ${((performance.now() - t0) / 1000).toFixed(2)} s`);
  console.log('-'.repeat(100));

  const intents: PlayerIntent[] = world.runners.map(() => emptyIntent());
  const it = intents[0];
  let events: SimEvent[] = [];
  const tick = (): void => { world.step(intents); world.drainEvents(events); };
  const run = (n: number, each?: (k: number) => void): void => { for (let k = 0; k < n; k++) { each?.(k); tick(); } };
  const S = (s: number): number => Math.round(s / TICK);
  const reset = (i: PlayerIntent, yaw: number): void => { Object.assign(i, emptyIntent()); i.yaw = yaw; };
  const place = (r: Runner, x: number, y: number, z: number, yaw: number): void => {
    world.devTeleport(r.id, x, y, z, yaw);
    reset(intents[r.id], yaw);
    run(S(0.25));
  };
  const home = (r: Runner): void => { const s = world.spawnFor(r); place(r, s.x, s.y, s.z, s.yaw); };
  const aimAt = (i: PlayerIntent, x: number, y: number, z: number): void => { i.hasAim = true; i.aimX = x; i.aimY = y; i.aimZ = z; };
  const take = <T extends SimEvent['t']>(t: T, from = 0): Ev<T>[] => events.slice(from).filter((e) => e.t === t) as Ev<T>[];

  // ── 1. rate of fire, tank per shot, drips, impacts (fire held 4 s, then 1 s for every droplet to land)
  {
    place(me, -15, 0, -30.5, 0);
    world.devSetTank(0, 100);
    const ev0 = events.length;
    const tank0 = me.tank;
    run(S(4.0), () => { it.yaw = 0; it.pitch = 0; it.fire = true; });
    const tank1 = me.tank;
    reset(it, 0);
    run(S(1.0));
    const n = take('shot', ev0).filter((e) => e.pid === 0).length;
    const rate = n / 4.0;
    const perShot = (tank0 - tank1) / Math.max(1, n);
    check('MIST-RASP rate 8.5 ± 0.5 shots/s while held', Math.abs(rate - F.shotsPerSecond) <= 0.5,
      `${n} shots in 4.00 s = ${f3(rate)}/s (spec ${F.shotsPerSecond})`);
    check('tank drops 0.9 per shot', Math.abs(perShot - F.tankPerShot) < 1e-6 && tank1 > 0,
      `tank ${f2(tank0)} → ${f3(tank1)} over ${n} shots = ${f3(perShot)}/shot (spec ${F.tankPerShot})`);
    // drips: small splats on the floor under the path, between the muzzle and the impacts
    const splats = take('splat', ev0);
    const drips = splats.filter((e) => Math.abs(e.r - F.dripRadius) < 1e-6);
    const impacts = splats.filter((e) => Math.abs(e.r - F.impactRadius) < 1e-6);
    const onFloor = drips.filter((e) => e.ny > 0.9 && Math.abs(e.y) < 0.06 && e.z > -30.5 + 1 && e.z < -30.5 + F.maxRange);
    const dripSun = drips.filter((e) => painter.surfaceAt(e.x, e.y, e.z, 0.12, 'floor')?.team === 1).length;
    check('drips land under the flight path (floor, between muzzle and impact) and dye it',
      drips.length >= 2 * n && onFloor.length === drips.length && dripSun >= drips.length * 0.95,
      `${drips.length} drips for ${n} shots (${f2(drips.length / Math.max(1, n))}/shot), on the floor under the path ${onFloor.length}, SUNCREW at the drip point ${dripSun}`);
    // impacts: one per shot, each exactly on the map surface along its normal
    let onSurf = 0;
    for (const e of impacts) {
      const h = physics.raycast(e.x + e.nx * 0.1, e.y + e.ny * 0.1, e.z + e.nz * 0.1, -e.nx, -e.ny, -e.nz, 0.3);
      if (h && Math.abs(h.toi - 0.1) < 0.02) onSurf++;
    }
    check('impact splats sit exactly on the map at the hit point (one per shot, normal = hit normal)', impacts.length === n && onSurf === impacts.length,
      `${impacts.length} impact splats for ${n} shots; ${onSurf} re-hit the surface 0.1 m along −normal within 2 cm`);
  }

  // ── 1b. one droplet's flight: straight for straightTime, then gravity + drag; reach < maxRange
  {
    place(me, -15, 0, -30.5, 0);
    world.devSetTank(0, 100);
    run(S(1.0));
    const trace: Array<{ age: number; x: number; y: number; z: number }> = [];
    run(1, () => { it.yaw = 0; it.pitch = 0; it.fire = true; });
    reset(it, 0);
    const P = world.projectiles;
    for (let k = 0; k < S(2) && P.count > 0; k++) {
      trace.push({ age: P.age[0], x: P.x[0], y: P.y[0], z: P.z[0] });
      tick();
    }
    const y0 = trace.length ? trace[0].y : NaN;
    const straight = trace.filter((p) => p.age <= F.straightTime + 1e-6);
    const later = trace.filter((p) => p.age > F.straightTime + TICK);
    const dyStraight = Math.max(0, ...straight.map((p) => Math.abs(p.y - y0)));
    const last = trace[trace.length - 1];
    const reach = last ? Math.hypot(last.x - me.x, last.z - me.z) : 0;
    const a = straight[0], b = straight[straight.length - 1];
    const slopeS = straight.length > 1 ? Math.abs((b.y - a.y) / Math.hypot(b.x - a.x, b.z - a.z)) : NaN;
    log(`trace ${trace.map((p) => `${f2(p.age)}:${f2(p.y)}@${f2(p.z)}`).join(' ')}`);
    check('flight: straight for straightTime (a line), then gravity + drag; reach < maxRange',
      straight.length >= 10 && slopeS < Math.tan(F.spreadDeg * DEG) && later.length > 2 && last.y < y0 - 0.5 && reach < F.maxRange,
      `${trace.length} ticks in flight; straight phase ${straight.length} ticks, |Δy| ≤ ${f3(dyStraight)} m (slope ${f3(slopeS)} = spread); landed y ${f2(last?.y)} (muzzle ${f2(y0)}) ${f2(reach)} m out (maxRange ${F.maxRange})`);
  }

  // ── 2. moving while firing: speed × moveSpeedWhileFiring
  {
    place(me, -17, 0, -6.5, 0);
    world.devSetTank(0, 100);
    let zA = 0, zB = 0;
    run(S(1.2), (k) => { it.yaw = 0; it.moveZ = 1; it.fire = true; if (k === S(0.4)) zA = me.z; if (k === S(1.2) - 1) zB = me.z; });
    const v = Math.abs(zB - zA) / ((S(1.2) - 1 - S(0.4)) * TICK);
    check('walking while firing: speed × moveSpeedWhileFiring', Math.abs(v - MOVE.walk * F.moveSpeedWhileFiring) < 0.15,
      `${f2(v)} m/s (walk ${MOVE.walk} × ${F.moveSpeedWhileFiring} = ${f2(MOVE.walk * F.moveSpeedWhileFiring)})`);
    reset(it, 0);
  }

  // ── 3. an empty tank dry-clicks: no droplet, no paint, 0.25 s apart
  {
    place(me, -15, 0, -30.5, 0);
    world.devSetTank(0, F.tankPerShot * 0.5);
    run(S(1.0));                               // let earlier droplets land
    const ev0 = events.length;
    const flips0 = painter.flips, pool0 = world.projectiles.count;
    let spawned = 0;
    run(S(1.0), () => { it.fire = true; if (world.projectiles.count > pool0) spawned++; });
    const dry = take('dry', ev0).filter((e) => e.pid === 0).length;
    const shots = take('shot', ev0).filter((e) => e.pid === 0).length;
    check('empty tank dry-clicks: dry events every 0.25 s, no projectile, no paint',
      shots === 0 && spawned === 0 && painter.flips === flips0 && dry >= 4 && dry <= 5 && !me.firing,
      `${dry} dry clicks in 1.00 s (cooldown ${TANK.dryCooldown} s), shots ${shots}, droplets spawned ${spawned}, texels flipped ${painter.flips - flips0}`);
    reset(it, 0);
    world.devSetTank(0, 100);
  }

  // ── 4. impact at the hit point: a wall and a floor
  {
    place(me, 0, 0, -26.5, 0);
    run(S(0.6));
    const ev0 = events.length;
    aimAt(it, 0, 0.6, -22.3);
    run(1, () => { it.fire = true; });
    reset(it, 0);
    run(S(0.6));
    const wallSplats = take('splat', ev0).filter((e) => Math.abs(e.r - F.impactRadius) < 1e-6);
    const w = wallSplats[0];
    const tex = w ? painter.surfaceAt(w.x, w.y, w.z, 0.2, 'wall') : null;
    const lateral = w ? Math.hypot(w.x - 0, w.y - 0.6) : NaN;
    const maxDev = Math.tan(F.spreadDeg * DEG) * 4.2 + 0.05;
    check('impact splats at the hit point: wall shot lands on the chevron face and dyes it',
      !!w && Math.abs(w.z - -22.3) < 0.03 && Math.abs(w.nz + 1) < 0.05 && lateral <= maxDev && tex?.team === 1,
      w ? `splat at (${f2(w.x)}, ${f2(w.y)}, ${f3(w.z)}) n (${f2(w.nx)}, ${f2(w.ny)}, ${f2(w.nz)}), ${f3(lateral)} m from the aim point (spread allows ${f3(maxDev)}), wall texel team ${tex?.team}, flips ${w.flips}` : 'no impact splat');

    place(me, 4, 0, -30, 0);
    const ev1 = events.length;
    aimAt(it, 4, 0, -24.5);
    run(1, () => { it.fire = true; });
    reset(it, 0);
    run(S(0.8));
    const fl = take('splat', ev1).find((e) => Math.abs(e.r - F.impactRadius) < 0.4 && e.r > F.dripRadius + 1e-6);
    const under = fl ? painter.teamUnder(fl.x, fl.y, fl.z) : null;
    check('impact splats at the hit point: floor shot dyes the floor where it lands',
      !!fl && fl.ny > 0.95 && Math.abs(fl.y) < 0.05 && under === 1 && Math.hypot(fl.x - 4, fl.z + 24.5) < 1.5,
      fl ? `splat at (${f2(fl.x)}, ${f3(fl.y)}, ${f2(fl.z)}) r ${f2(fl.r)}, aim (4, 0, −24.5), teamUnder ${under}` : 'no impact splat');
  }

  // ── 5. three hits wash (34 × 3 ≥ 100); hit / washed events; regen rules
  {
    place(me, 17, 0, -5, 0);
    place(foe, 17, 0, 0, Math.PI);
    world.devSetTank(0, 100);
    const ev0 = events.length;
    const hpAfter: number[] = [];
    for (let k = 0; k < S(1.5) && foe.alive; k++) {
      aimAt(it, foe.x, foe.y + 0.6, foe.z); it.fire = true;
      const h0 = foe.hp;
      tick();
      if (foe.hp < h0 || !foe.alive) hpAfter.push(Math.max(0, foe.hp));
    }
    reset(it, 0);
    const hits = take('hit', ev0).filter((e) => e.victim === 4);
    const washed = take('washed', ev0).find((e) => e.victim === 4);
    check('3 hits wash (34 × 3 ≥ 100): hit events by the shooter, then washed by the shooter (cause dye)',
      hits.length === 3 && hits.every((h) => h.by === 0 && h.dmg === F.damage) && !!washed && washed.by === 0 && washed.cause === 'dye' && !foe.alive && me.washes === 1,
      `hits ${hits.length} (dmg ${hits.map((h) => h.dmg).join(',')}; hp ${hpAfter.join(' → ')}), washed ${washed ? `by ${washed.by} (${washed.cause})` : 'NO'}, shooter washes ${me.washes}, victim alive ${foe.alive}`);
  }

  // ── 6. respawn after 3 s at the pad with a full tank
  {
    // the victim has been dead for (respawnSeconds − respawnT) s; step until its respawn event
    let ticks = 0;
    let respawned = false;
    const ev0 = events.length;
    const leftAtStart = foe.respawnT;
    while (ticks < S(5) && !respawned) {
      tick(); ticks++;
      respawned = take('respawn', ev0).some((e) => e.pid === 4);
    }
    const slot = world.spawnFor(foe);
    const atPad = Math.hypot(foe.x - slot.x, foe.z - slot.z) < 0.1 && Math.abs(foe.y - slot.y) < 0.15;
    const waited = WEAPONS.respawnSeconds - leftAtStart + ticks * TICK;
    check('respawn after 3 s at the team pad with a full tank (and full HP)',
      respawned && Math.abs(waited - WEAPONS.respawnSeconds) <= TICK + 1e-9 && atPad && foe.tank === TANK.max && foe.hp === WEAPONS.hp && foe.alive && world.onOwnPad(foe),
      `respawned ${f3(waited)} s after the wash (spec ${WEAPONS.respawnSeconds}) at (${f2(foe.x)}, ${f2(foe.y)}, ${f2(foe.z)}) = slot (${f2(slot.x)}, ${f2(slot.z)}), tank ${foe.tank}, hp ${foe.hp}, on own pad ${world.onOwnPad(foe)}`);
  }

  // ── 7. HP: no regen for 1.2 s after a hit, then +40/s
  {
    place(foe, 17, 0, 0, Math.PI);
    world.devDamage(4, F.damage, 0);
    const hp0 = foe.hp;
    run(S(1.1));
    const hpHold = foe.hp;
    run(S(1.0));
    const hpLater = foe.hp;
    check('HP: no regen for 1.2 s after a hit, then +40/s back to 100',
      hp0 === 100 - F.damage && hpHold === hp0 && hpLater === WEAPONS.hp,
      `after a hit ${hp0}; +1.1 s ${f2(hpHold)} (delay ${HEALTH.regenDelay} s); +2.1 s ${f2(hpLater)} (${HEALTH.regenPerSecond}/s)`);
  }

  // ── 8. no friendly fire: droplets pass through an ally
  {
    place(me, -17, 0, 0, 0);
    place(ally, -17, 0, 4, Math.PI);
    world.devSetTank(0, 100);
    const ev0 = events.length;
    run(S(1.0), () => { aimAt(it, ally.x, ally.y + 0.6, ally.z); it.fire = true; });
    reset(it, 0);
    run(S(0.6));
    const hitsOnAlly = take('hit', ev0).filter((e) => e.victim === 1).length;
    const beyond = take('splat', ev0).filter((e) => e.z > 4.6).length;
    check('no friendly fire: an ally in the stream takes nothing; the droplets fly through and dye beyond',
      hitsOnAlly === 0 && ally.hp === WEAPONS.hp && ally.alive && beyond > 5,
      `hits on the ally ${hitsOnAlly}, ally hp ${ally.hp}, splats beyond the ally ${beyond}`);
    home(ally);
  }

  // ── 9. no tunnelling: point blank through the 0.6 m chevron wall
  {
    place(me, 0, 0, -23.5, 0);
    run(S(0.6), () => { it.moveZ = 1; });                         // press into the south face (z −22.3)
    reset(it, 0);
    place(foe, 0, 0, -21.2, Math.PI);                              // right behind the wall (north face z −21.7)
    world.devSetTank(0, 100);
    const ev0 = events.length;
    const farSide = [-0.6, 0, 0.6].flatMap((x) => [-21.62, -21.5, -21.4].map((z) => painter.teamUnder(x, 0, z)));
    run(S(1.5), () => { aimAt(it, foe.x, foe.y + 0.6, foe.z); it.fire = true; });
    reset(it, 0);
    run(S(0.5));
    const shots = take('shot', ev0).filter((e) => e.pid === 0).length;
    const hitsFoe = take('hit', ev0).filter((e) => e.victim === 4).length;
    const farAfter = [-0.6, 0, 0.6].flatMap((x) => [-21.62, -21.5, -21.4].map((z) => painter.teamUnder(x, 0, z)));
    const leaked = farAfter.filter((t, i) => t === 1 && farSide[i] !== 1).length;
    const past = take('splat', ev0).filter((e) => e.z > -21.7 + 0.02 && e.y < 1.12).length;
    check('no tunnelling through the 0.6 m chevron wall at point blank (no hit, no paint behind it)',
      shots > 8 && hitsFoe === 0 && foe.hp === WEAPONS.hp && leaked === 0 && past === 0 && me.z < -22.3,
      `shooter at z ${f3(me.z)} (face −22.30), ${shots} shots, hits on the foe behind ${hitsFoe}, splats past the wall ${past}, far-side floor texels turned SUNCREW ${leaked}/${farAfter.length}`);
    home(foe);
  }

  // ── 10. airborne spread is wider than grounded spread
  {
    const dev = (list: Ev<'shot'>[], ay: number, ap: number): number[] => list.map((s) => {
      const yaw = Math.atan2(s.dx, s.dz), pitch = Math.asin(Math.max(-1, Math.min(1, s.dy)));
      let dyaw = yaw - ay; while (dyaw > Math.PI) dyaw -= 2 * Math.PI; while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
      return Math.hypot(dyaw, (pitch - ap) / COMBAT.verticalSpreadScale) / DEG;
    });
    place(me, -15, 0, -30.5, 0);
    world.devSetTank(0, 100);
    let ev0 = events.length;
    run(S(3.0), () => { it.yaw = 0; it.pitch = 0; it.fire = true; });
    const g = dev(take('shot', ev0).filter((e) => e.pid === 0), 0, 0);
    reset(it, 0);
    run(S(0.5));
    world.devSetTank(0, 100);
    ev0 = events.length;
    run(S(4.0), (k) => { it.yaw = 0; it.pitch = 0; it.fire = true; it.jump = k % 50 < 2; });
    // shots whose muzzle is >= 0.2 m above the standing muzzle height were fired airborne (jump spread)
    const air = dev(take('shot', ev0).filter((e) => e.pid === 0 && e.y > 0.02 + COMBAT.muzzleHeight + 0.2), 0, 0);
    reset(it, 0);
    const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    check('spread: grounded within spreadDeg; airborne wider, within jumpSpreadDeg',
      g.length > 15 && air.length > 5 && Math.max(...g) <= F.spreadDeg + 1e-6 && Math.max(...air) <= F.jumpSpreadDeg + 1e-6 && mean(air) > mean(g) * 1.5,
      `grounded ${g.length} shots: mean ${f2(mean(g))}°, max ${f2(Math.max(...g))}° (≤ ${F.spreadDeg}°); airborne ${air.length} shots: mean ${f2(mean(air))}°, max ${f2(Math.max(...air))}° (≤ ${F.jumpSpreadDeg}°)`);
  }

  // ── 11. the special meter fills from painted turf (+20 per wash)
  {
    const pts = (me.painted * (WEAPONS.specialCharge['pointsPerSquareMetre'] ?? 1) + me.washes * (WEAPONS.specialCharge['pointsPerWash'] ?? 20));
    const cp = 190;
    const want = Math.min(1, pts / cp);
    check('special meter fills per weapons.json specialCharge (1 pt / weighted m², +20 / wash, CLOUDBURST 190)',
      me.painted > 1 && Math.abs(me.special - want) < 1e-6,
      `painted ${f2(me.painted)} weighted m², washes ${me.washes} → ${f2(pts)} pts → meter ${f3(me.special)} (expected ${f3(want)})`);
  }

  // ── 12. the sea washes (walk off the pier edge): washed by nobody, cause sea; respawn at the pad
  {
    place(me, 20, 0, -38.5, Math.PI);
    const ev0 = events.length;
    let washedAt = -1, respawnAt = -1;
    run(S(6.0), (k) => {
      it.yaw = Math.PI; it.moveZ = me.alive && washedAt < 0 ? 1 : 0;
      if (washedAt < 0 && take('washed', ev0).some((e) => e.victim === 0)) washedAt = k;
      if (respawnAt < 0 && take('respawn', ev0).some((e) => e.pid === 0)) respawnAt = k;
    });
    reset(it, 0);
    const w = take('washed', ev0).find((e) => e.victim === 0);
    const slot = world.spawnFor(me);
    check('the sea washes: below killY → washed (by nobody, cause sea) → respawn 3 s later at the pad, full tank',
      !!w && w.by === null && w.cause === 'sea' && respawnAt > 0 && Math.abs((respawnAt - washedAt) * TICK - WEAPONS.respawnSeconds) <= 2 * TICK
        && me.alive && Math.hypot(me.x - slot.x, me.z - slot.z) < 0.1 && me.tank === TANK.max && world.stats.seaWashes >= 1,
      w ? `washed ${w.cause} by ${w.by} after ${f2(washedAt * TICK)} s, respawn ${f2((respawnAt - washedAt) * TICK)} s later at (${f2(me.x)}, ${f2(me.y)}, ${f2(me.z)}), tank ${me.tank}` : 'no washed event');
  }

  events = [];
  console.log('-'.repeat(100));
  console.log(`stats: ${JSON.stringify(world.stats)}`);
  const failed = checks.filter((c) => !c.pass);
  const verdict = failed.length ? `FAIL (${failed.length})` : 'OK';
  console.log(`probe_combat: ${checks.length - failed.length}/${checks.length} checks pass · ${((performance.now() - t0) / 1000).toFixed(2)} s`);
  console.log(`RESULT: ${verdict}`);
  try {
    const dir = resolve(HERE, '_reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'probe_combat.json'), JSON.stringify({ checks, stats: world.stats, verdict, at: new Date().toISOString() }, null, 2) + '\n', 'utf8');
  } catch { /* best-effort */ }
  physics.dispose();
  return failed.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => {
  console.log('SETUP FAILED:', (e as Error)?.stack ?? e);
  console.log('RESULT: FAIL');
  process.exit(2);
});
