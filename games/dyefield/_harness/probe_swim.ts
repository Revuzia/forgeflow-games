// DYEFIELD — gate G6 (CONTRACT §12): swim / slog / tank drink / wall-slick / hidden, on the real Pier 18
// collision + paint atlas, Rapier in plain Node.
//
//   node _harness/probe_swim.ts            # G6
//   node _harness/probe_swim.ts --verbose  # per-check traces
//
// Dye is prepared with Painter splats (test setup). The runner is then driven the way a player drives
// it: one PlayerIntent per 60 Hz tick through MatchWorld.step → Runner.step → Rapier KCC. Positioning
// between checks uses the dev teleport; every measured motion comes from intents.
// Exit: 0 all pass · 1 a check failed · 2 setup failure.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRapier, PhysicsWorld } from '../runtime/src/core/physics.ts';
import { loadMapGeometry, type MapGeometry } from '../runtime/src/core/mapgeo.ts';
import { buildAtlas } from '../runtime/src/core/paint/atlas.ts';
import { Painter } from '../runtime/src/core/paint/painter.ts';
import { mapById } from '../runtime/src/core/data.ts';
import { MOVE, SLICK, TANK, TICK } from '../runtime/src/core/config.ts';
import { emptyIntent, type PlayerIntent, type TeamId } from '../runtime/src/core/types.ts';
import { Runner } from '../runtime/src/core/runner.ts';
import { MatchWorld } from '../runtime/src/core/match/world.ts';
import { defaultRoster } from '../runtime/src/core/match/roster.ts';
import type { SimEvent } from '../runtime/src/core/match/events.ts';

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

const YAW_PX = Math.PI / 2;    // facing +X
const YAW_NX = -Math.PI / 2;   // facing −X

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
  const roster = defaultRoster({ humanKit: 'mist-rasp', seed: 7, skill: 'fresh' });
  const world = new MatchWorld({ def, geo, physics, painter, roster, seed: 7, countdownS: 0, durationS: 900 });
  const me = world.runners[0];
  const foe = world.runners[4];
  console.log(`map pier18: atlas ${atlas.size}² · ${atlas.count} texels · physics ${physics.triangles} tris · runners ${world.runners.length} · setup ${((performance.now() - t0) / 1000).toFixed(2)} s`);
  console.log('-'.repeat(100));

  const intents: PlayerIntent[] = world.runners.map(() => emptyIntent());
  const events: SimEvent[] = [];
  const it = intents[0];
  const reset = (i: PlayerIntent, yaw: number): void => {
    Object.assign(i, emptyIntent());
    i.yaw = yaw;
  };
  const tick = (): void => { world.step(intents); world.drainEvents(events); };
  const run = (n: number, each?: (k: number) => void): void => { for (let k = 0; k < n; k++) { each?.(k); tick(); } };
  const S = (s: number): number => Math.round(s / TICK);
  const place = (r: Runner, x: number, y: number, z: number, yaw: number): void => {
    world.devTeleport(r.id, x, y, z, yaw);
    reset(intents[r.id], yaw);
    run(S(0.25));                        // settle onto the floor
  };
  const stripe = (team: TeamId, x: number, z0: number, z1: number, r = 1.3): void => {
    for (let z = z0; z <= z1 + 1e-6; z += 0.8) painter.splat(x, 0.02, z, { radius: r, team, nx: 0, ny: 1, nz: 0, minFacing: 0.3, seed: Math.round(z * 100) });
  };
  const wallPatch = (team: TeamId, zc: number): void => {
    for (const y of [0.35, 0.95, 1.55, 1.95]) for (const dz of [-1.0, 0, 1.0]) {
      painter.splat(-20, y, zc + dz, { radius: 0.9, team, nx: 1, ny: 0, nz: 0, minFacing: 0.35, seed: Math.round((y + dz) * 1000) });
    }
  };

  // ── dye preparation (test setup)
  stripe(1, -17, -19, 3);           // SUNCREW lane on the west plate
  stripe(2, -17, 4.2, 9);           // …ending in GULF dye
  stripe(2, 17, -19, 3);            // GULF lane on the east plate (SLOG for SUNCREW)
  wallPatch(1, -3);                 // own-dyed side-deck inner wall (x = −20)
  wallPatch(2, -10);                // enemy-dyed stretch of the same wall
  wallPatch(1, 2.2);                // own-dyed stretch that will be re-dyed GULF mid-climb
  {
    const w = painter.surfaceAt(-20, 1.0, -3, 0.3, 'wall');
    const u = painter.surfaceAt(-20, 1.0, 8, 0.3, 'wall');
    const e = painter.surfaceAt(-20, 1.0, -10, 0.3, 'wall');
    log(`wall texels: z=-3 team ${w?.team} · z=8 team ${u?.team} · z=-10 team ${e?.team}`);
    if (!w || w.team !== 1 || !u || u.team !== 0 || !e || e.team !== 2) {
      console.log(`SETUP FAILED: side-deck inner wall texels not prepared (z=-3 ${w?.team}, z=8 ${u?.team}, z=-10 ${e?.team})`);
      return 2;
    }
  }

  // ── 1. SHIFT on neutral floor: no slick, walk speed, no refill
  {
    place(me, -15, 0, -30.5, 0);       // plate west of the base deck, neutral and clear (x −15, z −30.5 … −25)
    world.devSetTank(0, 50);
    let slickTicks = 0;
    const z0 = me.z;
    let zMid = 0;
    run(S(1.0), (k) => { it.moveZ = 1; it.slick = true; if (k === S(0.4)) zMid = me.z; if (me.state === 'slick' || me.slickForm) slickTicks++; });
    const v = (me.z - zMid) / 0.6;
    check('SHIFT on neutral floor: no SLICK, walk speed, no refill',
      slickTicks === 0 && Math.abs(v - MOVE.walk) < 0.2 && me.tank === 50 && me.state === 'walk',
      `slick ticks ${slickTicks}, speed ${f2(v)} m/s (walk ${MOVE.walk}), tank ${f2(me.tank)} (was 50), state ${me.state}, moved ${f2(me.z - z0)} m`);
  }

  // ── 2. no refill while standing tall on own dye; no passive regen anywhere
  {
    place(me, -17, 0, -10, 0);
    world.devSetTank(0, 40);
    run(S(1.5));
    const onOwn = painter.teamUnder(me.x, me.y, me.z);
    check('no refill standing tall on own dye / no passive regen', me.tank === 40 && onOwn === 1 && me.state === 'walk',
      `teamUnder ${onOwn}, tank ${f2(me.tank)} after 1.5 s (was 40), state ${me.state}`);
  }

  // ── 3. SLICK on own dye: speed ≈ 8.4, capsule shrinks, moving slicker not hidden
  {
    place(me, -17, 0, -18.5, 0);
    world.devSetTank(0, 100);
    const ev0 = events.length;
    let firstSlick = -1, zA = 0, zB = 0, hiddenMoving = 0, capH = 0;
    run(S(1.5), (k) => {
      it.moveZ = 1; it.slick = true;
      if (firstSlick < 0 && me.state === 'slick') firstSlick = k;
      if (k === S(0.5)) zA = me.z;
      if (k === S(1.5) - 1) zB = me.z;
      if (k > S(0.5) && me.hidden) hiddenMoving++;
      if (k === S(1.0)) capH = me.capsuleHeight();
    });
    const v = (zB - zA) / ((S(1.5) - 1 - S(0.5)) * TICK);
    const slickOn = events.slice(ev0).some((e) => e.t === 'slick' && e.pid === 0 && e.on && !e.wall);
    check('SLICK on own dye: enters at once, speed ≈ 8.4 m/s', firstSlick >= 0 && firstSlick <= 2 && Math.abs(v - MOVE.slick) < 0.25 && slickOn,
      `slick from tick ${firstSlick}, steady speed ${f2(v)} m/s (spec ${MOVE.slick}), 'slick' on event ${slickOn}, z ${f2(zA)} → ${f2(zB)}`);
    check('SLICK capsule shrinks to crest height; a moving slicker is never hidden',
      Math.abs(capH - 2 * (MOVE.slickHalfHeight + MOVE.radius)) < 1e-6 && hiddenMoving === 0,
      `capsule ${f3(capH)} m (tall ${f3(2 * (MOVE.halfHeight + MOVE.radius))}), hidden ticks while moving ${hiddenMoving}`);
  }

  // ── 4. slicking into enemy dye: surfaces into SLOG at once
  {
    // continue from check 3: the lane ends at z ≈ 3.5 and GULF dye starts at z ≈ 3.2
    let slogAt = -1, slickAfter = 0;
    let firstEnemy = -1;
    run(S(1.2), (k) => {
      it.moveZ = 1; it.slick = true;
      const u = painter.teamUnder(me.x, me.y, me.z);
      if (firstEnemy < 0 && me.grounded && u === 2) firstEnemy = k;
      if (firstEnemy >= 0 && k > firstEnemy + 1 && me.slickForm) slickAfter++;
      if (slogAt < 0 && me.state === 'slog') slogAt = k;
    });
    check('SLICK into enemy dye → surfaces into SLOG (cannot slick on enemy dye)',
      firstEnemy >= 0 && slogAt >= 0 && slogAt - firstEnemy <= 2 && slickAfter === 0 && !me.slickForm,
      `enemy dye underfoot at tick ${firstEnemy}, SLOG at tick ${slogAt}, slick-form ticks on enemy dye ${slickAfter}, final state ${me.state} @ z ${f2(me.z)}`);
  }

  // ── 5. SLOG on enemy dye ≈ 2.0 m/s; SHIFT there never slicks nor refills
  {
    place(me, 17, 0, -18.5, 0);
    world.devSetTank(0, 30);
    let zA = 0, zB = 0, slogTicks = 0, slickTicks = 0, n = 0;
    run(S(2.0), (k) => {
      it.moveZ = 1; it.slick = k >= S(1.2);
      if (k === S(0.4)) zA = me.z;
      if (k === S(1.2)) zB = me.z;
      if (k > S(0.4)) { n++; if (me.state === 'slog') slogTicks++; }
      if (me.slickForm) slickTicks++;
    });
    const v = (zB - zA) / ((S(1.2) - S(0.4)) * TICK);
    check('SLOG on enemy dye ≈ 2.0 m/s', Math.abs(v - MOVE.slog) < 0.12 && slogTicks >= n - 2,
      `speed ${f2(v)} m/s (spec ${MOVE.slog}), SLOG ${slogTicks}/${n} ticks`);
    check('SHIFT on enemy dye: never SLICK, no refill', slickTicks === 0 && me.tank === 30,
      `slick-form ticks ${slickTicks}, tank ${f2(me.tank)} (was 30)`);
  }

  // ── 6. refill 0 → 100 while SLICK on own dye (and a still slicker is hidden)
  {
    place(me, -17, 0, -8, 0);
    world.devSetTank(0, 0);
    let full = -1, hiddenTicks = 0, n = 0;
    const low0 = me.refillsFromLow;
    run(S(3.5), (k) => {
      it.slick = true;
      if (full < 0 && me.tank >= TANK.max) full = k + 1;
      if (k > 3) { n++; if (me.hidden) hiddenTicks++; }
    });
    const secs = full * TICK;
    check('refill 0 → 100 in 2.6–3.0 s (SLICK on own dye)', full > 0 && secs >= 2.6 && secs <= 3.0 && me.refillsFromLow === low0 + 1,
      `full after ${f3(secs)} s (spec ${TANK.refillPerSecond}/s → ${f3(TANK.max / TANK.refillPerSecond)} s), refills-from-low ${me.refillsFromLow - low0}`);
    check('hidden: a still slicker is hidden', hiddenTicks >= n - 1 && me.state === 'slick',
      `hidden ${hiddenTicks}/${n} ticks, state ${me.state}`);
  }

  // ── 7. releasing SHIFT surfaces in ~0.12 s
  {
    // still slicking from check 6
    const ev0 = events.length;
    reset(it, 0);
    let slickLeft = -1, canFireAt = -1, tallAt = -1;
    run(S(0.5), (k) => {
      if (slickLeft < 0 && me.state !== 'slick' && !me.slickForm) slickLeft = k;
      if (canFireAt < 0 && me.canFire()) canFireAt = k;
      if (tallAt < 0 && me.isTall) tallAt = k;
    });
    const off = events.slice(ev0).some((e) => e.t === 'slick' && e.pid === 0 && !e.on);
    const s = canFireAt * TICK;
    check('releasing SHIFT surfaces in ~0.12 s (slick off at once, capsule regrows, firing back after the surfacing)',
      slickLeft === 1 && tallAt === 1 && canFireAt > 0 && s >= 0.1 && s <= 0.15 && off && Math.abs(me.capsuleHeight() - 2 * (MOVE.halfHeight + MOVE.radius)) < 1e-6,
      `(ticks counted from the release, sampled after each step) slick off after ${slickLeft}, tall after ${tallAt}, can fire after ${f3(s)} s (surfaceTime ${SLICK.surfaceTime}), 'slick' off event ${off}`);
  }

  // ── 8. own pad counts as own dye (slick + refill)
  {
    const sp = world.spawnFor(me);
    place(me, sp.x, sp.y, sp.z, sp.yaw);
    world.devSetTank(0, 10);
    let slickTicks = 0;
    run(S(1.0), () => { it.slick = true; if (me.state === 'slick') slickTicks++; });
    const under = painter.teamUnder(me.x, me.y, me.z);
    check('own pad counts as own dye: SLICK + refill on the (unpaintable) pad',
      world.onOwnPad(me) && under === null && slickTicks >= S(1.0) - 2 && Math.abs(me.tank - (10 + TANK.refillPerSecond * (slickTicks) * TICK)) < 1.5 && me.tank > 40,
      `onOwnPad ${world.onOwnPad(me)}, teamUnder ${under}, slick ${slickTicks} ticks, tank 10 → ${f2(me.tank)}`);
    reset(it, 0);
    run(S(0.3));
  }

  // ── 9. an enemy is pushed out of the pad
  {
    const pad = world.pads.A;
    place(foe, pad.x, pad.y, pad.z + 4.0, Math.PI);          // GULF runner on the SUNCREW base deck, facing the pad
    let minD = Infinity;
    run(S(2.0), () => { intents[4].moveZ = 1; minD = Math.min(minD, Math.hypot(foe.x - pad.x, foe.z - pad.z)); });
    reset(intents[4], Math.PI);
    world.devTeleport(4, pad.x + 0.4, pad.y + 0.05, pad.z, Math.PI);
    run(S(0.6));
    const dOut = Math.hypot(foe.x - pad.x, foe.z - pad.z);
    check('enemy pushed out of the pad (walks in → held at the rim; dropped inside → shoved out)',
      minD >= pad.r - 0.05 && dOut >= pad.r && foe.alive,
      `walking in for 2 s: closest ${f2(minD)} m from the centre (pad r ${pad.r}); teleported 0.4 m from the centre → ${f2(dOut)} m after 0.6 s`);
    const home = world.spawnFor(foe);
    place(foe, home.x, home.y, home.z, home.yaw);
  }

  // ── 10. hidden / canSee rules
  {
    place(me, -17, 0, -6, 0);
    run(S(0.3), () => { it.slick = true; });               // still slicker
    const hidden = me.hidden;
    world.devTeleport(4, -17, 0, -1, Math.PI); run(1, () => { it.slick = true; });
    const far = world.canSee(foe, me);                      // 5 m
    world.devTeleport(4, -17, 0, -3.5, Math.PI); run(1, () => { it.slick = true; });
    const near = world.canSee(foe, me);                     // 2.5 m
    world.devTeleport(4, -17, 0, 6, Math.PI); run(1, () => { it.slick = true; });
    // moving slicker (visible at any range with line of sight)
    let movingSeen = 0, movingN = 0;
    run(S(0.8), (k) => { it.slick = true; it.moveZ = 0; it.moveX = k % 2 ? 1 : 1; if (k > 10) { movingN++; if (!me.hidden && world.canSee(foe, me)) movingSeen++; } });
    reset(it, 0);
    run(S(0.3));
    const ally = world.canSee(world.runners[1], me);
    // line of sight through the base chevron wall (x −3…3, z −22.3…−21.7, 1.1 m)
    place(me, 0, 0, -23.6, 0);
    world.devTeleport(4, 0, 0, -20.4, Math.PI);
    run(2);
    const blocked = world.canSee(foe, me);
    world.devTeleport(4, 8, 0, -20.4, Math.PI);
    run(2);
    const clear = world.canSee(foe, me);
    check('hidden: still slicker invisible to enemies beyond 3 m, visible within 3 m; moving slicker visible',
      hidden && !far && near && movingN > 0 && movingSeen === movingN,
      `hidden ${hidden}; enemy at 5 m sees ${far}, at 2.5 m sees ${near}; moving slicker seen ${movingSeen}/${movingN} ticks`);
    check('canSee: allies always; line of sight blocked by a wall', ally && !blocked && clear,
      `ally sees ${ally}; through the chevron wall ${blocked}; around it ${clear}`);
    const home = world.spawnFor(foe);
    place(foe, home.x, home.y, home.z, home.yaw);
  }

  // ── 11. wall-slick up an own-dyed side-deck inner wall (x = −20, 2.0 m) to the deck top
  const climb = (z: number, s = 2.5, onTick?: (k: number) => void): { wall: number; maxVy: number; maxY: number; topAt: number } => {
    place(me, -18.3, 0, z, YAW_NX);
    let wall = 0, maxVy = 0, maxY = -Infinity, topAt = -1;
    let py = me.y;
    run(S(s), (k) => {
      it.yaw = YAW_NX; it.moveZ = 1; it.slick = true;
      onTick?.(k);
      if (me.state === 'wallslick') { wall++; maxVy = Math.max(maxVy, (me.y - py) / TICK); }
      py = me.y;
      maxY = Math.max(maxY, me.y);
      if (topAt < 0 && me.grounded && me.y > 1.9) topAt = k;
    });
    return { wall, maxVy, maxY, topAt };
  };
  {
    const ev0 = events.length;
    const c = climb(-3);
    const wallEv = events.slice(ev0).some((e) => e.t === 'slick' && e.pid === 0 && e.on && e.wall);
    check('WALL-SLICK climbs an own-dyed side-deck wall at ≈ 5.2 m/s and pops onto the deck (y ≈ 2.0)',
      c.wall > 5 && Math.abs(c.maxVy - MOVE.wallSlick) < 0.35 && c.topAt > 0 && Math.abs(me.y - 2.0) < 0.12 && me.x < -20.2 && me.grounded && wallEv,
      `wall-slick ${c.wall} ticks, climb ${f2(c.maxVy)} m/s (spec ${MOVE.wallSlick}), on the deck after ${f2(c.topAt * TICK)} s at (${f2(me.x)}, ${f3(me.y)}, ${f2(me.z)}), 'slick' wall event ${wallEv}`);
    reset(it, 0);
    run(S(0.2));
  }
  {
    const u = climb(8, 2.0);
    const undyedY = u.maxY;
    const e = climb(-10, 2.0);
    check('WALL-SLICK refused on an undyed wall and on an enemy-dyed wall',
      u.wall === 0 && e.wall === 0 && undyedY < 0.2 && e.maxY < 0.2,
      `undyed: wall ticks ${u.wall}, max y ${f3(undyedY)}; enemy-dyed: wall ticks ${e.wall}, max y ${f3(e.maxY)}`);
  }
  {
    // the wall loses its dye mid-climb → drop
    let redyedAt = -1, droppedAt = -1;
    const c = climb(2.2, 2.0, (k) => {
      if (redyedAt < 0 && me.state === 'wallslick' && me.y > 0.6) { wallPatch(2, 2.2); redyedAt = k; }
      if (redyedAt >= 0 && droppedAt < 0 && me.state !== 'wallslick') droppedAt = k;
    });
    check('WALL-SLICK: a wall losing its dye under you drops you',
      redyedAt > 0 && droppedAt >= 0 && droppedAt - redyedAt <= 2 && me.y < 0.1 && c.maxY < 1.6,
      `re-dyed GULF at tick ${redyedAt} (y > 0.6), off the wall at tick ${droppedAt}, max y ${f3(c.maxY)}, final y ${f3(me.y)}`);
  }

  // ── 12. head clearance: a slicker under a low slab cannot surface until it is clear (synthetic slab world)
  {
    const slabGeo = boxWorld([
      [[-10, -0.5, -10], [10, 0, 10]],            // floor
      [[-3, 0.92, 2], [3, 1.3, 7]],               // low slab, underside at 0.92 m (slick capsule 0.74 fits; tall 1.15 does not)
    ]);
    const ph2 = new PhysicsWorld(R, slabGeo);
    const stub = { splat: () => 0, teamUnder: () => null, surfaceAt: () => null, weighted: () => 0 } as unknown as Painter;
    const body = ph2.createCharacter(MOVE.radius, MOVE.halfHeight);
    const r = new Runner({ id: 0, name: 'probe', team: 1, kit: 'mist-rasp', bot: false }, body, { x: 0, y: 0, z: -2, yaw: 0 },
      { physics: ph2, ownPad: { x: 0, y: 0, z: 0, r: 30 }, killY: -5 });
    const i2 = emptyIntent();
    const stepN = (n: number, f: (k: number) => void): void => { for (let k = 0; k < n; k++) { f(k); r.step(TICK, i2, stub, null); } };
    // walking tall into the slab is blocked
    stepN(S(1.2), () => { i2.moveZ = 1; });
    const tallZ = r.z;
    // slick under it, release SHIFT under it
    r.teleport(0, 0, -2, 0);
    stepN(S(0.9), () => { i2.moveZ = 1; i2.slick = true; });
    const underZ = r.z;
    let grewUnder = 0;
    stepN(S(0.4), () => { i2.moveZ = 0; i2.slick = false; if (r.isTall) grewUnder++; });
    const stuckSmall = !r.isTall && r.y < 0.05 && !r.canFire();
    stepN(S(1.2), () => { i2.moveZ = 1; i2.slick = false; });
    const out = r.z, grown = r.isTall;
    check('head clearance: slick passes under a 0.92 m slab, stays small until clear, then grows back',
      tallZ < 2 - MOVE.radius + 0.05 && underZ > 3 && grewUnder === 0 && stuckSmall && out > 7 && grown,
      `tall runner stopped at z ${f2(tallZ)} (slab edge z 2); slicker reached z ${f2(underZ)}; grew under the slab ${grewUnder} ticks; after walking out z ${f2(out)} tall ${grown}`);
    ph2.dispose();
  }

  console.log('-'.repeat(100));
  const failed = checks.filter((c) => !c.pass);
  const verdict = failed.length ? `FAIL (${failed.length})` : 'OK';
  console.log(`probe_swim: ${checks.length - failed.length}/${checks.length} checks pass · ${((performance.now() - t0) / 1000).toFixed(2)} s`);
  console.log(`RESULT: ${verdict}`);
  try {
    const dir = resolve(HERE, '_reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'probe_swim.json'), JSON.stringify({ checks, verdict, at: new Date().toISOString() }, null, 2) + '\n', 'utf8');
  } catch { /* best-effort */ }
  physics.dispose();
  return failed.length ? 1 : 0;
}

/** Tiny collision-only MapGeometry of axis-aligned boxes (no paint). */
function boxWorld(boxes: Array<[[number, number, number], [number, number, number]]>): MapGeometry {
  const P: number[] = [], I: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]): void => {
    const o = P.length / 3; P.push(...a, ...b, ...c, ...d); I.push(o, o + 1, o + 2, o, o + 2, o + 3);
  };
  for (const [[x0, y0, z0], [x1, y1, z1]] of boxes) {
    quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
    quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
  }
  const empty = new Float32Array(0);
  return {
    id: 'slab', paint: { positions: empty, normals: empty, uv1: empty, indices: new Uint32Array(0), triMaterial: new Uint16Array(0), materials: [] },
    collision: { positions: new Float32Array(P), indices: new Uint32Array(I) },
    spawns: { A: { x: 0, y: 0, z: -2, yaw: 0 }, B: { x: 0, y: 0, z: 8, yaw: Math.PI } },
    atlasSize: 0, texelsPerMeter: 0, paintArea: 0, info: {},
  };
}

main().then((code) => process.exit(code), (e) => {
  console.log('SETUP FAILED:', (e as Error)?.stack ?? e);
  console.log('RESULT: FAIL');
  process.exit(2);
});
