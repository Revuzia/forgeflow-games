// DYEFIELD — gate G2 (CONTRACT §7): movement on the real Pier 18 collision, Rapier in plain Node.
//
//   node _harness/probe_move.ts               # G2: art/gltf/map_pier18.glb (the real map)
//   node _harness/probe_move.ts --synthetic   # early smoke only: an in-memory MapGeometry built
//                                             # from the maps.json brushes (boxes/wedges) — NOT G2
//   node _harness/probe_move.ts --verbose     # per-leg traces
//
// The runner is driven the way a player drives it: a PlayerIntent per 60 Hz tick (camera yaw +
// stick), through Player.step → Rapier KCC. Waypoint legs steer the camera yaw toward a target and
// push the stick forward; nothing is teleported except the explicit respawns between legs.
//
// Checks (G2): walk forward 3 s from spawn A (> 12 m, never in the water); walk down a base ramp to
// y ≈ 0; walk up a side ramp onto a side deck (y ≈ 2.0); jump apex 1.1–1.5 m; walking off the pier
// edge drops below killY and respawns at spawn A. Extra (APP-lane features): coyote jump, jump
// buffer, wall stop (no tunnelling), and — when the PAINT lane is present — the dev brush dyes the
// floor under the feet (teamUnder === SUNCREW).
// Exit: 0 all pass · 1 a check failed · 2 setup failure (missing module / GLB / Rapier).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRapier, PhysicsWorld } from '../runtime/src/core/physics.ts';
import { Player, type SpawnPoint } from '../runtime/src/core/player.ts';
import { MOVE, TICK, DEV_BRUSH } from '../runtime/src/core/config.ts';
import { mapById, type MapDef, type V3 } from '../runtime/src/core/data.ts';
import { DEG, emptyIntent, type PlayerIntent, type TeamId } from '../runtime/src/core/types.ts';
import type { MapGeometry } from '../runtime/src/core/mapgeo.ts';
import type { Painter } from '../runtime/src/core/paint/painter.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const SYNTH = argv.includes('--synthetic');
const VERBOSE = argv.includes('--verbose');
const MAP_ID = (() => { const i = argv.indexOf('--map'); return i >= 0 ? argv[i + 1] : 'pier18'; })();

interface Check { name: string; pass: boolean; detail: string; gate: boolean }
const checks: Check[] = [];
function check(name: string, pass: boolean, detail: string, gate = true): void {
  checks.push({ name, pass, detail, gate });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
}
const f2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const f3 = (v: number): string => (Number.isFinite(v) ? v.toFixed(3) : String(v));

// ───────────────────────────── synthetic geometry (smoke only) ─────────────────────────────
function synthGeometry(def: MapDef): MapGeometry {
  const P: number[] = [];
  const I: number[] = [];
  const quad = (a: V3, b: V3, c: V3, d: V3): void => {
    const o = P.length / 3;
    P.push(...a, ...b, ...c, ...d);
    I.push(o, o + 1, o + 2, o, o + 2, o + 3);
  };
  const tri = (a: V3, b: V3, c: V3): void => {
    const o = P.length / 3;
    P.push(...a, ...b, ...c);
    I.push(o, o + 1, o + 2);
  };
  const box = (mn: V3, mx: V3): void => {
    const [x0, y0, z0] = mn, [x1, y1, z1] = mx;
    quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);      // top
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);      // bottom
    quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);      // -z
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);      // +z
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);      // -x
    quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);      // +x
  };
  const ramp = (mn: V3, mx: V3, rise: string): void => {
    const [x0, y0, z0] = mn, [x1, y1, z1] = mx;
    // corners at the bottom plane; the top edge height depends on the rise direction
    const h = (x: number, z: number): number => {
      const t = rise === '+x' ? (x - x0) / (x1 - x0) : rise === '-x' ? (x1 - x) / (x1 - x0)
        : rise === '+z' ? (z - z0) / (z1 - z0) : (z1 - z) / (z1 - z0);
      return y0 + (y1 - y0) * t;
    };
    const c: V3[] = [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]];
    const top = c.map(([x, , z]) => [x, h(x, z), z] as V3);
    quad(top[0], top[3], top[2], top[1]);
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4], ta = top[i], tb = top[(i + 1) % 4];
      const ya = ta[1], yb = tb[1];
      if (ya - y0 < 1e-6 && yb - y0 < 1e-6) continue;
      const A: V3 = [a[0], y0, a[2]], B: V3 = [b[0], y0, b[2]];
      if (ya - y0 < 1e-6) tri(A, tb, B);
      else if (yb - y0 < 1e-6) tri(A, ta, B);
      else quad(A, ta, tb, B);
    }
  };
  const mirror = (v: V3): V3 => [-v[0], v[1], -v[2]];
  const flipRise = (r: string): string => ({ '+x': '-x', '-x': '+x', '+z': '-z', '-z': '+z' } as Record<string, string>)[r] ?? r;
  for (const raw of (def.brushes ?? []) as Array<Record<string, any>>) {
    const emit = (b: Record<string, any>): void => {
      switch (b.kind) {
        case 'box': case 'curb': box(b.min, b.max); break;
        case 'ramp': ramp(b.min, b.max, b.rise); break;
        case 'crate': { const s = b.size / 2; box([b.center[0] - s, b.center[1], b.center[2] - s], [b.center[0] + s, b.center[1] + b.size, b.center[2] + s]); break; }
        case 'planter': { const [w, hh, d] = b.size; box([b.center[0] - w / 2, b.center[1], b.center[2] - d / 2], [b.center[0] + w / 2, b.center[1] + hh, b.center[2] + d / 2]); break; }
        case 'spawnpad': { const r = b.radius; box([b.center[0] - r, b.center[1] - 0.05, b.center[2] - r], [b.center[0] + r, b.center[1], b.center[2] + r]); break; }
        default: break;
      }
    };
    emit(raw);
    if (raw.mirror) {
      const m: Record<string, any> = { ...raw };
      if (raw.min && raw.max) {
        const a = mirror(raw.min), b = mirror(raw.max);
        m.min = [Math.min(a[0], b[0]), a[1], Math.min(a[2], b[2])];
        m.max = [Math.max(a[0], b[0]), b[1], Math.max(a[2], b[2])];
      }
      if (raw.center) m.center = mirror(raw.center);
      if (raw.rise) m.rise = flipRise(raw.rise);
      emit(m);
    }
  }
  const sp = def.spawns!;
  const empty = new Float32Array(0);
  return {
    id: def.id,
    paint: { positions: empty, normals: empty, uv1: empty, indices: new Uint32Array(0), triMaterial: new Uint16Array(0), materials: [] },
    collision: { positions: new Float32Array(P), indices: new Uint32Array(I) },
    spawns: {
      A: { x: sp.A.pos[0], y: sp.A.pos[1], z: sp.A.pos[2], yaw: sp.A.yaw * DEG },
      B: { x: sp.B.pos[0], y: sp.B.pos[1], z: sp.B.pos[2], yaw: sp.B.yaw * DEG },
    },
    atlasSize: 0, texelsPerMeter: 0, paintArea: 0, info: { synthetic: true },
  };
}

// ───────────────────────────── driving helpers ─────────────────────────────
interface Trace { ticks: number; minY: number; maxY: number; groundedTicks: number; respawns: number; path: Array<[number, number, number]> }

function newTrace(p: Player): Trace {
  return { ticks: 0, minY: p.y, maxY: p.y, groundedTicks: 0, respawns: 0, path: [[p.x, p.y, p.z]] };
}

function tick(p: Player, it: PlayerIntent, painter: Painter, tr: Trace): void {
  const r0 = p.respawns;
  p.step(TICK, it, painter);
  tr.ticks++;
  if (p.respawns !== r0) tr.respawns++;
  tr.minY = Math.min(tr.minY, p.y);
  tr.maxY = Math.max(tr.maxY, p.y);
  if (p.grounded) tr.groundedTicks++;
  if (tr.ticks % 15 === 0) tr.path.push([p.x, p.y, p.z]);
}

/** Steer toward (tx, tz) with the stick forward until within tol (or maxS elapses). */
function driveTo(p: Player, painter: Painter, tx: number, tz: number, maxS: number, tol = 0.35, tr?: Trace, stopOnRespawn = false): { ok: boolean; trace: Trace } {
  const trace = tr ?? newTrace(p);
  const it = emptyIntent();
  const n = Math.ceil(maxS / TICK);
  for (let i = 0; i < n; i++) {
    const dx = tx - p.x, dz = tz - p.z;
    if (Math.hypot(dx, dz) <= tol) {
      // brake to a stop so the next leg starts from rest-ish
      settle(p, painter, trace, 0.25);
      return { ok: true, trace };
    }
    it.yaw = Math.atan2(dx, dz);
    it.moveZ = 1;
    it.moveX = 0;
    const r0 = p.respawns;
    tick(p, it, painter, trace);
    if (stopOnRespawn && p.respawns !== r0) return { ok: false, trace };
  }
  return { ok: false, trace };
}

function settle(p: Player, painter: Painter, tr: Trace, s: number): void {
  const it = emptyIntent();
  it.yaw = p.yaw;
  const n = Math.ceil(s / TICK);
  for (let i = 0; i < n; i++) tick(p, it, painter, tr);
}

function log(...a: unknown[]): void { if (VERBOSE) console.log('   ', ...a); }

// ───────────────────────────── main ─────────────────────────────
async function main(): Promise<number> {
  const t0 = performance.now();
  let def: MapDef;
  try { def = mapById(MAP_ID); } catch (e) { console.log('SETUP FAILED:', (e as Error).message); return 2; }
  const killY = def.killY ?? -1;

  let R: Awaited<ReturnType<typeof loadRapier>>;
  try { R = await loadRapier(); } catch (e) { console.log('SETUP FAILED: Rapier init:', (e as Error).stack ?? e); return 2; }

  let geo: MapGeometry;
  if (SYNTH) {
    geo = synthGeometry(def);
    console.log(`map: SYNTHETIC in-memory geometry from maps.json brushes (${geo.collision.indices.length / 3} tris) — smoke run, NOT gate G2`);
  } else {
    try {
      const mg = await import('../runtime/src/core/mapgeo.ts');
      geo = await mg.loadMapGeometry(def);
    } catch (e) {
      console.log(`SETUP FAILED: loadMapGeometry(${MAP_ID}) — ${(e as Error).message ?? e}`);
      return 2;
    }
    console.log(`map: art/gltf/map_${MAP_ID}.glb — collision ${geo.collision.indices.length / 3} tris, paint ${geo.paint.indices.length / 3} tris, atlas ${geo.atlasSize}`);
  }
  const tGeo = performance.now();

  // painter: the real one when the PAINT lane's modules + a paint soup exist; else a no-op stub
  let painter: Painter;
  let realPainter = false;
  if (!SYNTH && geo.paint.indices.length > 0) {
    try {
      const atlasMod = await import('../runtime/src/core/paint/atlas.ts');
      const painterMod = await import('../runtime/src/core/paint/painter.ts');
      const sc = def.scoring ?? { wallWeight: 0.35, floorMinNy: 0.45 };
      const atlas = atlasMod.buildAtlas(geo.paint, geo.atlasSize, { wallWeight: sc.wallWeight, floorMinNy: sc.floorMinNy });
      painter = new painterMod.Painter(atlas);
      realPainter = true;
      console.log(`painter: real (atlas ${atlas.size}² · ${atlas.count} texels · overlaps ${atlas.overlaps})`);
    } catch (e) {
      console.log(`painter: stub (PAINT lane modules unavailable: ${(e as Error).message ?? e})`);
      painter = { splat: () => 0 } as unknown as Painter;
    }
  } else {
    painter = { splat: () => 0 } as unknown as Painter;
    console.log('painter: stub (no paint soup)');
  }

  const pw = new PhysicsWorld(R, geo);
  const body = pw.createCharacter(MOVE.radius, MOVE.halfHeight);
  const spawnA: SpawnPoint = { ...geo.spawns.A };
  const team: TeamId = 1;
  const p = new Player(team, body, spawnA, { killY });
  console.log(`spawn A: (${f2(spawnA.x)}, ${f2(spawnA.y)}, ${f2(spawnA.z)}) yaw ${f2(spawnA.yaw / DEG)}°  · killY ${killY} · physics ${pw.triangles} tris · setup ${((tGeo - t0) / 1000).toFixed(2)} s`);
  console.log('-'.repeat(96));

  // settle onto the pad
  settle(p, painter, newTrace(p), 0.3);
  check('spawn A: runner stands on the pad', p.grounded && Math.abs(p.y - spawnA.y) < 0.15,
    `feet y ${f3(p.y)} (pad ${f2(spawnA.y)}), grounded ${p.grounded}`);

  // ── 1. walk forward 3 s from spawn A
  {
    p.respawn(spawnA);
    settle(p, painter, newTrace(p), 0.2);
    const sx = p.x, sz = p.z;
    const tr = newTrace(p);
    const it = emptyIntent();
    it.yaw = spawnA.yaw; it.moveZ = 1;
    let minSpd = Infinity, minAt = -1;
    for (let i = 0; i < Math.round(3 / TICK); i++) {
      const wasG = p.grounded;
      const qx = p.x, qy = p.y, qz = p.z;
      tick(p, it, painter, tr);
      // after the 0.15 s wind-up, a grounded runner must never stall: 3-D speed (rolling over the pad
      // rim / a bevel turns some horizontal speed into climb, which is fine; a stop is not)
      const v3 = Math.hypot(p.x - qx, p.y - qy, p.z - qz) / TICK;
      if (i > 9 && wasG && p.grounded && v3 < minSpd) { minSpd = v3; minAt = i; }
    }
    const d = Math.hypot(p.x - sx, p.z - sz);
    log('walk path', tr.path.map((q) => q.map(f2).join(',')).join(' | '));
    check('walk forward 3 s from spawn A: > 12 m, stays on the deck',
      d > 12 && tr.minY > -0.1 && tr.respawns === 0 && p.y > -0.1,
      `${f2(d)} m in 3.00 s (${f2(d / 3)} m/s avg) → (${f2(p.x)}, ${f2(p.y)}, ${f2(p.z)}), min y ${f3(tr.minY)}, respawns ${tr.respawns}`);
    check('no snag: grounded speed never stalls on the way (pad rim, deck bevels, tile seams)', minSpd >= 3.5,
      `min grounded 3-D speed ${f2(minSpd)} m/s at tick ${minAt} (walk ${MOVE.walk})`);
  }

  // ── 2. walk down a base ramp (west) to y ≈ 0
  let rampBottom = { x: -9.5, z: -24.5 };
  {
    p.respawn(spawnA);
    settle(p, painter, newTrace(p), 0.2);
    const top = driveTo(p, painter, -9.5, -35.2, 8);
    const yTop = p.y;
    const tr = newTrace(p);
    const down = driveTo(p, painter, rampBottom.x, rampBottom.z, 6, 0.35, tr);
    const groundedFrac = tr.groundedTicks / Math.max(1, tr.ticks);
    log('ramp-down path', tr.path.map((q) => q.map(f2).join(',')).join(' | '));
    check('walk down a base ramp to y ≈ 0',
      top.ok && down.ok && Math.abs(yTop - 1.2) < 0.15 && Math.abs(p.y) < 0.1 && groundedFrac > 0.9 && tr.respawns === 0,
      `deck y ${f3(yTop)} → bottom (${f2(p.x)}, ${f3(p.y)}, ${f2(p.z)}); grounded ${(groundedFrac * 100).toFixed(0)} % of ${tr.ticks} ticks (a walk, not a fall)`);
    rampBottom = { x: p.x, z: p.z };
  }

  // ── 3. walk up a side ramp onto a side deck (y ≈ 2.0)
  {
    const tr = newTrace(p);
    const a = driveTo(p, painter, -24, -25.6, 8, 0.35, tr);
    const yBase = p.y;
    const b = driveTo(p, painter, -24, -10, 8, 0.35, tr);
    settle(p, painter, tr, 0.3);
    log('side-ramp path', tr.path.map((q) => q.map(f2).join(',')).join(' | '));
    check('walk up a side ramp onto a side deck (y ≈ 2.0)',
      a.ok && b.ok && Math.abs(p.y - 2.0) < 0.12 && p.grounded && tr.respawns === 0,
      `ramp foot y ${f3(yBase)} → deck (${f2(p.x)}, ${f3(p.y)}, ${f2(p.z)}), grounded ${p.grounded}`);
  }

  // ── 4. jump apex 1.1–1.5 m (standing jump on the side deck)
  {
    settle(p, painter, newTrace(p), 0.2);
    const y0 = p.y;
    const tr = newTrace(p);
    const it = emptyIntent();
    it.yaw = p.yaw; it.jump = true;
    tick(p, it, painter, tr);
    it.jump = false;
    let landedAt = -1;
    for (let i = 0; i < 120; i++) {
      tick(p, it, painter, tr);
      if (p.grounded && landedAt < 0) { landedAt = tr.ticks; break; }
    }
    const apex = tr.maxY - y0;
    check('jump apex 1.1–1.5 m', apex >= 1.1 && apex <= 1.5 && landedAt > 0,
      `apex ${f3(apex)} m (analytic v²/2g = ${f3(MOVE.jump * MOVE.jump / (2 * MOVE.gravity))}), airtime ${f2(landedAt * TICK)} s, landed back at y ${f3(p.y)}`);
  }

  // ── 4b. jump buffer: a press 0.08 s before touching down still jumps on landing
  {
    settle(p, painter, newTrace(p), 0.3);
    const it = emptyIntent();
    it.yaw = p.yaw; it.jump = true;
    const tr = newTrace(p);
    tick(p, it, painter, tr);
    it.jump = false;
    // fall until ~5 ticks before landing (estimate from the analytic arc), then press
    const flight = (2 * MOVE.jump) / MOVE.gravity;
    const pressAt = Math.round(flight / TICK) - 5;
    let jumps0 = p.jumps;
    let secondJump = false;
    for (let i = 1; i < 150; i++) {
      it.jump = i === pressAt || i === pressAt + 1;
      tick(p, it, painter, tr);
      if (p.jumps > jumps0 && i >= pressAt) { secondJump = true; break; }
    }
    settle(p, painter, newTrace(p), 1.4);
    check('jump buffer (press 0.08 s before landing → jumps on touch-down)', secondJump,
      `second take-off ${secondJump ? 'happened' : 'did NOT happen'} (buffer ${MOVE.jumpBuffer} s)`);
    jumps0 = 0;
  }

  // ── 4c. coyote: jump pressed 0.05 s after walking off the side-deck edge still jumps
  {
    // side deck inner edge is x = -20 (y 2.0 → plate y 0). Stand at x -21.2 facing +x, walk off, press late.
    p.teleport(-21.4, 2.0, -4.0, Math.PI / 2);
    settle(p, painter, newTrace(p), 0.25);
    const it = emptyIntent();
    it.yaw = Math.PI / 2; it.moveZ = 1;
    const tr = newTrace(p);
    let leftAt = -1;
    let coyoteJump = false;
    const j0 = p.jumps;
    for (let i = 0; i < 90; i++) {
      it.jump = leftAt >= 0 && tr.ticks - leftAt === 3;   // 3 ticks = 0.05 s after leaving the ledge
      tick(p, it, painter, tr);
      if (leftAt < 0 && !p.grounded) leftAt = tr.ticks;
      if (p.jumps > j0) { coyoteJump = true; break; }
    }
    settle(p, painter, newTrace(p), 1.2);
    check('coyote time (jump 0.05 s after leaving a ledge still jumps)', coyoteJump,
      `left the ledge at tick ${leftAt}, jump ${coyoteJump ? 'taken' : 'REFUSED'} (coyote ${MOVE.coyote} s)`);
  }

  // ── 4d. wall stop: walking into the chevron wall for 2 s never tunnels through it
  {
    // chevron_base spans x −3..3, z −22.3..−21.7 (1.1 m tall). Approach from the south (z −25).
    p.respawn(spawnA);
    const tr = newTrace(p);
    driveTo(p, painter, 0, -26.5, 8, 0.35, tr);
    const it = emptyIntent();
    it.yaw = 0; it.moveZ = 1;
    for (let i = 0; i < 120; i++) tick(p, it, painter, tr);
    check('walls stop the runner (no tunnelling through the 0.6 m chevron wall)', p.z < -22.3 && tr.respawns === 0,
      `pushing +Z into the wall for 2 s → z ${f3(p.z)} (wall face at −22.30), y ${f3(p.y)}`, true);
  }

  // ── 5. walk off the pier edge → below killY → respawn at spawn A
  {
    p.respawn(spawnA);
    const tr = newTrace(p);
    const a = driveTo(p, painter, 20, -38.5, 10, 0.35, tr);
    const edgeStart = { x: p.x, y: p.y, z: p.z };
    const r0 = p.respawns;
    let lowest = Infinity;
    let deathTick = -1;
    const it = emptyIntent();
    it.yaw = Math.PI; it.moveZ = 1;                    // face −Z: straight off the south edge (z = −42)
    const tr2 = newTrace(p);
    for (let i = 0; i < Math.round(6 / TICK); i++) {
      const yBefore = p.y;
      tick(p, it, painter, tr2);
      if (p.respawns !== r0) { deathTick = tr2.ticks; lowest = Math.min(lowest, yBefore); break; }
      lowest = Math.min(lowest, p.y);
    }
    const back = Math.hypot(p.x - spawnA.x, p.z - spawnA.z) < 0.2 && Math.abs(p.y - spawnA.y) < 0.2;
    check('walk off the pier edge → below killY → respawn at spawn A',
      a.ok && deathTick > 0 && lowest < killY + 0.5 && back,
      `edge run from (${f2(edgeStart.x)}, ${f2(edgeStart.y)}, ${f2(edgeStart.z)}); last y before respawn ${f3(lowest)} (killY ${killY}); respawned after ${f2(deathTick * TICK)} s at (${f2(p.x)}, ${f2(p.y)}, ${f2(p.z)})`);
  }

  // ── 6. dev brush dyes the floor under the feet (only with the real PAINT lane)
  if (realPainter) {
    p.respawn(spawnA);
    const tr = newTrace(p);
    driveTo(p, painter, 0, -30, 6, 0.35, tr);        // on the plate in front of the base deck
    settle(p, painter, tr, 0.3);
    const it = emptyIntent();
    it.yaw = p.yaw; it.fire = true;
    const before = painter.teamUnder(p.x, p.y, p.z);
    const t1 = performance.now();
    for (let i = 0; i < Math.round(1.2 / TICK); i++) tick(p, it, painter, tr);
    const ms = performance.now() - t1;
    const under = painter.teamUnder(p.x, p.y, p.z);
    const cov = painter.coverage();
    check('dev brush: HOLD fire 1.2 s → teamUnder(feet) === SUNCREW, coverage.sun > 0',
      under === 1 && cov.sun > 0 && p.splats >= Math.floor(1.2 * DEV_BRUSH.perSecond),
      `under before ${before} → after ${under}; splats ${p.splats}, texels flipped ${p.painted}; coverage sun ${(cov.sun * 100).toFixed(3)} %; ${f2(ms)} ms for ${Math.round(1.2 / TICK)} ticks`);
  } else {
    console.log('SKIP  dev brush check (no real painter in this run)');
  }

  console.log('-'.repeat(96));
  const failed = checks.filter((c) => c.gate && !c.pass);
  const verdict = SYNTH ? (failed.length ? 'SMOKE FAIL' : 'SMOKE OK (synthetic geometry — not gate G2)') : (failed.length ? `FAIL (${failed.length})` : 'OK');
  console.log(`probe_move: ${checks.length - failed.length}/${checks.length} checks pass · ${((performance.now() - t0) / 1000).toFixed(2)} s`);
  console.log(`RESULT: ${verdict}`);
  try {
    const dir = resolve(HERE, '_reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, SYNTH ? 'probe_move_synthetic.json' : 'probe_move.json'),
      JSON.stringify({ map: MAP_ID, synthetic: SYNTH, checks, verdict, at: new Date().toISOString() }, null, 2) + '\n', 'utf8');
  } catch { /* report is best-effort */ }
  pw.dispose();
  return failed.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => {
  console.log('SETUP FAILED:', (e as Error)?.stack ?? e);
  console.log('RESULT: FAIL');
  process.exit(2);
});
