/**
 * CRESTBOUND physics check — the collision resolver's contract, under Node.
 *
 * Builds a small world with the REAL runtime modules (world/collider.js,
 * player/collide.js, core/tuning.js against the real three.js from
 * forgeflow-games/node_modules) and drives moveAndCollide() the way the
 * controller will: fixed substeps, gravity from tuning.applyGravity, last
 * frame's `grounded` fed back. Every assertion is a number the design cares
 * about, not "it did not throw".
 *
 *   node _harness/physcheck.mjs            # run all
 *   node _harness/physcheck.mjs --verbose  # print every measurement
 *
 * World: floor box · 0.4 m ledge · 0.6 m ledge · wall · 30° ramp box ·
 *        heightfield hill (20° plane) · water volume · lava kill volume ·
 *        moving platform (linear + spinning) · low ceiling.
 *
 * Exit 0 = every assertion holds.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const VERBOSE = process.argv.includes('--verbose');

// ── minimal DOM shim (same approach as modulecheck.mjs) ──────────────────────
function shimDom() {
  const storage = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
             removeItem: (k) => m.delete(k), clear: () => m.clear(), key: () => null, get length() { return m.size; } };
  };
  const el = () => ({ style: {}, appendChild() {}, addEventListener() {}, removeEventListener() {}, getContext: () => null });
  const doc = { body: el(), head: el(), documentElement: el(), createElement: el, createElementNS: el,
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  const win = { document: doc, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720, addEventListener() {},
    removeEventListener() {}, localStorage: storage(), sessionStorage: storage(), performance,
    requestAnimationFrame: (fn) => setTimeout(() => fn(performance.now()), 16), cancelAnimationFrame: clearTimeout,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.localStorage = win.localStorage;
  globalThis.sessionStorage = win.sessionStorage;
  globalThis.requestAnimationFrame = win.requestAnimationFrame;
  globalThis.cancelAnimationFrame = win.cancelAnimationFrame;
  globalThis.HTMLCanvasElement = class {};
  globalThis.HTMLElement = class {};
}
shimDom();

const THREE = await import('three');
const { TUNE, applyGravity } = await import(pathToFileURL(join(ROOT, 'runtime', 'core', 'tuning.js')).href);
const C = await import(pathToFileURL(join(ROOT, 'runtime', 'world', 'collider.js')).href);
const P = await import(pathToFileURL(join(ROOT, 'runtime', 'player', 'collide.js')).href);
const { Collider, KillVolume, Volume, Heightfield, Broadphase } = C;
const { moveAndCollide, sweepGround, COLLIDE_CONST } = P;

// ── tiny assertion kit ───────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { passed++; if (VERBOSE) console.log(`  ok    ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failed++; failures.push(`${name}${detail ? '  (' + detail + ')' : ''}`); console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const f3 = (v) => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
const DEG = 180 / Math.PI;

const DT = 1 / 120;

// ── the world ────────────────────────────────────────────────────────────────
// Layout (all far enough apart that fixtures never interact):
//   floor        top y=0, x∈[-20,20], z∈[-20,20]
//   ledge04      top y=0.4 at x∈[3,6],   z∈[-1,1]
//   ledge06      top y=0.6 at x∈[3,6],   z∈[4,6]
//   wall         x∈[3,4], y∈[0,3], z∈[8,12]
//   ramp30       30° about Z, centred (12, ~, 0) — a tilted 6×0.4×4 slab
//   ceiling      low slab over x∈[-6,-3], z∈[-1,1], bottom at y=1.2
//   hill         heightfield: 20° plane along +x on x∈[30,50], z∈[-10,10]
//   water        volume x∈[-16,-10], y∈[-3, 0.5], z∈[-16,-10]  (surface y=0.5)
//   lava         kill box x∈[-16,-10], y∈[-1, 0.02], z∈[10,16]
//   platform     mover top y=2 at (0, *, -8), 3×0.4×3
//   carousel     spinning deck radius 4 centred (60,0,60), angVel 1.2 rad/s
const bp = new Broadphase(6);
const floor = bp.add(new Collider({ center: [0, -1, 0], half: [20, 1, 20], surface: 'stone' }));
const ledge04 = bp.add(new Collider({ center: [4.5, 0.2, 0], half: [1.5, 0.2, 1] }));
const ledge06 = bp.add(new Collider({ center: [4.5, 0.3, 5], half: [1.5, 0.3, 1] }));
const wall = bp.add(new Collider({ center: [3.5, 1.5, 10], half: [0.5, 1.5, 2] }));
const ramp30 = bp.add(new Collider({ center: [12, 1.5, 0], half: [3, 0.2, 2], quat: [0, 0, 30 / DEG] }));
const ceiling = bp.add(new Collider({ center: [-4.5, 1.7, 0], half: [1.5, 0.5, 1] }));
const breakable = bp.add(new Collider({ center: [-4.5, 0.25, 6], half: [0.6, 0.25, 0.6], props: { breakable: true } }));

// heightfield: h = tan(20°) * (x - 30), 21×21 samples, 1 m cells
const NX = 21, NZ = 21;
const hillH = new Float32Array(NX * NZ);
const SLOPE = Math.tan(20 / DEG);
for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) hillH[iz * NX + ix] = SLOPE * ix;
const hill = new Heightfield({ originX: 30, originZ: -10, sizeX: 20, sizeZ: 20, nx: NX, nz: NZ, heights: hillH, surface: 'grass', id: 'hill' });
bp.addHeightfield(hill);

// a second heightfield: a smooth bump so the analytic normal is tested on curvature too
const BX = 41, BZ = 41;
const bumpH = new Float32Array(BX * BZ);
const bumpFn = (x, z) => 2.0 * Math.exp(-((x - 80) * (x - 80) + (z - 80) * (z - 80)) / 18);
for (let iz = 0; iz < BZ; iz++) for (let ix = 0; ix < BX; ix++) bumpH[iz * BX + ix] = bumpFn(70 + ix * 0.5, 70 + iz * 0.5);
const bump = new Heightfield({ originX: 70, originZ: 70, sizeX: 20, sizeZ: 20, nx: BX, nz: BZ, heights: bumpH, surface: 'snow', id: 'bump' });
bp.addHeightfield(bump);

const water = new Volume({ center: [-13, -1.25, -13], half: [3, 1.75, 3], kind: 'water' });
const lava = new KillVolume({ type: 'box', kind: 'lava', center: [-13, -0.49, 13], half: [3, 0.51, 3] });
const platRef = { linVel: new THREE.Vector3(2, 0, 0) };
const platform = bp.add(new Collider({ center: [0, 1.8, -8], half: [1.5, 0.2, 1.5], ref: platRef, surface: 'metal' }));
const spinRef = { angVel: 1.2, angAxis: new THREE.Vector3(0, 1, 0), angCenter: new THREE.Vector3(60, 0, 60) };
const carousel = bp.add(new Collider({ center: [60, -0.2, 60], half: [6, 0.2, 6], ref: spinRef }));

const world = { broadphase: bp, killVolumes: [lava], volumes: [water] };

// ── a controller-shaped driver ───────────────────────────────────────────────
function makeState(x, y, z) {
  return { pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), grounded: false, jumped: false, crouching: false, poundFalling: false };
}
/** One substep: gravity, then resolve, then feed grounded back. Returns the result. */
function step(st, world, driveX, driveZ) {
  if (driveX !== undefined) st.vel.x = driveX;
  if (driveZ !== undefined) st.vel.z = driveZ;
  if (!st.grounded || st.vel.y < 0 || st.jumped) st.vel.y = applyGravity(st.vel.y, DT);
  else st.vel.y = applyGravity(st.vel.y, DT);   // grounded: the resolver removes the into-ground part
  const r = moveAndCollide(st, world, DT);
  st.grounded = r.grounded;
  st.jumped = false;
  return r;
}

console.log('CRESTBOUND physcheck');
console.log(`  body r=${TUNE.radius} h=${TUNE.height} stepUp=${TUNE.stepUp}  snap=${COLLIDE_CONST.SNAP_DIST}  dt=1/120`);

// ── 1. rest on the floor: jitter-free over 600 substeps ──────────────────────
{
  const st = makeState(0, 0, 0);
  st.grounded = true;
  let maxDev = 0, allGrounded = true, maxXZ = 0, surfaceOk = true, slopeOk = true;
  for (let i = 0; i < 600; i++) {
    const r = step(st, world, 0, 0);
    maxDev = Math.max(maxDev, Math.abs(st.pos.y));
    maxXZ = Math.max(maxXZ, Math.abs(st.pos.x), Math.abs(st.pos.z));
    if (!r.grounded) allGrounded = false;
    if (r.surface !== 'stone' || r.groundCollider !== floor) surfaceOk = false;
    if (r.groundSlopeDeg !== 0) slopeOk = false;
  }
  check('rest: feet stay at y=0 over 600 substeps', maxDev <= 1e-9, `max |y| = ${maxDev.toExponential(2)}`);
  check('rest: grounded every substep', allGrounded);
  check('rest: no lateral drift', maxXZ <= 1e-12);
  check('rest: surface + groundCollider reported', surfaceOk);
  check('rest: groundSlopeDeg = 0', slopeOk);
}

// ── 2. step-up 0.4 works, 0.6 blocks ─────────────────────────────────────────
{
  const st = makeState(1.5, 0, 0);
  st.grounded = true;
  let steppedAt = -1;
  for (let i = 0; i < 120; i++) {
    const r = step(st, world, 4, 0);
    if (r.stepped && steppedAt < 0) steppedAt = i;
  }
  check('step-up 0.4: mantled onto the ledge', near(st.pos.y, 0.4, 1e-6) && st.pos.x > 3.5, `y=${st.pos.y.toFixed(4)} x=${st.pos.x.toFixed(3)} steppedAt=${steppedAt}`);
  check('step-up 0.4: stayed grounded after', st.grounded);

  const st2 = makeState(1.5, 0, 5);
  st2.grounded = true;
  let lastR = null;
  for (let i = 0; i < 120; i++) lastR = step(st2, world, 4, 0);
  const face = 3 - TUNE.radius;
  check('step-up 0.6: blocked (feet stay at y=0)', near(st2.pos.y, 0, 1e-9), `y=${st2.pos.y.toExponential(2)}`);
  check('step-up 0.6: stopped at the ledge face', near(st2.pos.x, face, 1e-6), `x=${st2.pos.x.toFixed(5)} face=${face.toFixed(5)}`);
  check('step-up 0.6: reported as a wall (normal −X)', lastR.walls.length > 0 && near(lastR.walls[0].normal.x, -1, 1e-9), lastR.walls.length ? f3(lastR.walls[0].normal) : 'no walls');
  check('step-up 0.6: vel.x zeroed into the wall', near(st2.vel.x, 0, 1e-9));
}

// ── 3. wall stops X but not Z ────────────────────────────────────────────────
{
  const st = makeState(1.0, 0, 8.5);
  st.grounded = true;
  const z0 = st.pos.z;
  const N = 90;
  for (let i = 0; i < N; i++) step(st, world, 4, 3);
  const face = 3 - TUNE.radius;
  check('wall: X stopped at the face', st.pos.x <= face + 1e-6 && near(st.pos.x, face, 1e-6), `x=${st.pos.x.toFixed(5)} face=${face.toFixed(5)}`);
  check('wall: Z kept sliding', near(st.pos.z - z0, 3 * N * DT, 1e-6), `dz=${(st.pos.z - z0).toFixed(4)} expected ${(3 * N * DT).toFixed(4)}`);
  check('wall: still grounded on the floor', st.grounded);
}

// ── 4. heightfield: analytic normal within 2° ────────────────────────────────
{
  // plane hill: exact normal (−sin20, cos20, 0)
  const st = makeState(40, hill.heightAt(40, 0) + 0.02, 0);
  st.grounded = false;
  let r = null;
  for (let i = 0; i < 10; i++) r = step(st, world, 0, 0);
  const n = r.groundNormal;
  const ex = new THREE.Vector3(-Math.sin(20 / DEG), Math.cos(20 / DEG), 0);
  const angErr = Math.acos(Math.min(1, n.dot(ex))) * DEG;
  check('hf plane: landed grounded on the heightfield', r.grounded && r.groundHeightfield === hill && r.groundCollider === null);
  check('hf plane: normal within 2° of analytic', angErr <= 2, `err=${angErr.toFixed(4)}° n=${f3(n)}`);
  check('hf plane: groundSlopeDeg ≈ 20', near(r.groundSlopeDeg, 20, 0.05), `${r.groundSlopeDeg.toFixed(4)}`);
  check('hf plane: surface = grass', r.surface === 'grass');
  check('hf plane: feet exactly on the surface', near(st.pos.y, hill.heightAt(st.pos.x, st.pos.z), 1e-6), `dy=${(st.pos.y - hill.heightAt(st.pos.x, st.pos.z)).toExponential(2)}`);

  // curved bump: compare to the analytic gradient of the gaussian at several points
  let worst = 0;
  const tmp = new THREE.Vector3();
  for (const [x, z] of [[80, 80], [82.25, 80.25], [78.1, 81.7], [83.3, 76.6], [80.5, 84.9]]) {
    bump.normalAt(x, z, tmp);
    const dfdx = bumpFn(x, z) * (-(2 * (x - 80)) / 18), dfdz = bumpFn(x, z) * (-(2 * (z - 80)) / 18);
    const an = new THREE.Vector3(-dfdx, 1, -dfdz).normalize();
    const e = Math.acos(Math.min(1, tmp.dot(an))) * DEG;
    if (e > worst) worst = e;
  }
  check('hf bump: normalAt within 2° of the gaussian gradient (0.5 m cells)', worst <= 2, `worst=${worst.toFixed(3)}°`);
  check('hf: heightAt is NaN outside the footprint', Number.isNaN(hill.heightAt(29.9, 0)) && Number.isNaN(hill.heightAt(40, 10.1)));
}

// ── 5. heightfield: walk across the 20° slope, uphill then downhill ──────────
{
  for (const [label, vx, x0] of [['uphill', 5, 32], ['downhill', -5, 48], ['uphill@run', 9, 32], ['downhill@run', -9, 48]]) {
    const st = makeState(x0, hill.heightAt(x0, 0), 0);
    st.grounded = true;
    let lostGround = 0, maxOff = 0, wrongHf = 0;
    for (let i = 0; i < 200; i++) {
      const r = step(st, world, vx, 0);
      if (!r.grounded) lostGround++;
      if (r.groundHeightfield !== hill) wrongHf++;
      if (i >= 2) maxOff = Math.max(maxOff, Math.abs(st.pos.y - hill.heightAt(st.pos.x, st.pos.z)));
    }
    check(`hf walk ${label}: grounded every substep`, lostGround === 0, `lost ${lostGround}/200`);
    check(`hf walk ${label}: feet on the surface (≤1e-4)`, maxOff <= 1e-4, `max off ${maxOff.toExponential(2)}`);
    check(`hf walk ${label}: ground is the hill`, wrongHf === 0);
    check(`hf walk ${label}: travelled`, Math.abs(st.pos.x - x0) > 6, `dx=${(st.pos.x - x0).toFixed(2)}`);
  }
  // jump off the hill: the impulse frame must NOT be re-grounded
  const st = makeState(40, hill.heightAt(40, 0), 0);
  st.grounded = true;
  step(st, world, 5, 0);
  st.vel.y = TUNE.jumpV[0]; st.jumped = true;
  const r1 = step(st, world, 5, 0);
  // NOTE: the CollisionResult is a single reused instance (CONTRACT §10), and
  // `st.vel` keeps integrating — snapshot BOTH before driving any more steps.
  const impulseGrounded = r1.grounded, impulseVy = st.vel.y;
  let airborne = 0;
  for (let i = 0; i < 30; i++) { const r = step(st, world, 5, 0); if (!r.grounded) airborne++; }
  check('hf jump: impulse frame not grounded', !impulseGrounded && impulseVy > 8, `vy=${impulseVy.toFixed(2)} grounded=${impulseGrounded}`);
  check('hf jump: airborne for the next 30 substeps', airborne === 30, `${airborne}/30`);
}

// ── 5b. STEEP heightfield: still ground, never a wall, never jittery ─────────
// CONTRACT §10: "steep ground (> slope.slideDeg for the surface) reports
// grounded=true + groundSlopeDeg so the controller slides rather than the
// resolver blocking". A 50° scarp is well past slideDeg (38°) and past
// iceSlideDeg (20°) — the resolver must still carry the hero along it.
{
  const SX = 21, SZ = 21;
  const scarpH = new Float32Array(SX * SZ);
  const STEEP = Math.tan(50 / DEG);
  for (let iz = 0; iz < SZ; iz++) for (let ix = 0; ix < SX; ix++) scarpH[iz * SX + ix] = STEEP * ix;
  const scarp = new Heightfield({ originX: 100, originZ: -10, sizeX: 20, sizeZ: 20, nx: SX, nz: SZ, heights: scarpH, surface: 'ice', id: 'scarp' });
  bp.addHeightfield(scarp);

  // N chosen per speed so every walk stays inside the 20 m footprint.
  for (const [label, vx, N] of [['downhill', -4, 200], ['uphill', 4, 200], ['downhill@run', -9, 100], ['uphill@run', 9, 100]]) {
    const st = makeState(110, scarp.heightAt(110, 0), 0);
    st.grounded = true;
    const x0 = st.pos.x;
    let lost = 0, maxOff = 0, sMin = Infinity, sMax = -Infinity, short = 0, surfOk = true, wallHits = 0;
    for (let i = 0; i < N; i++) {
      const xBefore = st.pos.x;
      const r = step(st, world, vx, 0);
      if (!r.grounded) lost++;
      if (r.surface !== 'ice') surfOk = false;
      if (r.walls.length > 0) wallHits++;
      if (i >= 2) {
        maxOff = Math.max(maxOff, Math.abs(st.pos.y - scarp.heightAt(st.pos.x, st.pos.z)));
        if (r.groundSlopeDeg < sMin) sMin = r.groundSlopeDeg;
        if (r.groundSlopeDeg > sMax) sMax = r.groundSlopeDeg;
        if (Math.abs((st.pos.x - xBefore) - vx * DT) > 1e-9) short++;
      }
    }
    check(`steep hf ${label}: grounded every substep (slide-ready, not a wall)`, lost === 0, `lost ${lost}/${N}`);
    check(`steep hf ${label}: groundSlopeDeg ≈ 50 throughout`, near(sMin, 50, 0.05) && near(sMax, 50, 0.05), `${sMin.toFixed(3)}..${sMax.toFixed(3)}`);
    check(`steep hf ${label}: never reported as a wall`, wallHits === 0, `${wallHits}/${N}`);
    check(`steep hf ${label}: lateral motion never blocked`, short === 0, `${short}/${N - 2} substeps short`);
    check(`steep hf ${label}: feet stay on the surface (no jitter)`, maxOff <= 1e-4, `max off ${maxOff.toExponential(2)}`);
    check(`steep hf ${label}: surface passthrough (controller picks iceSlideDeg)`, surfOk);
    check(`steep hf ${label}: travelled`, Math.abs(st.pos.x - x0) > 5, `dx=${(st.pos.x - x0).toFixed(2)}`);
  }
  bp.removeHeightfield(scarp);
  check('steep hf: removeHeightfield unregisters it', bp.heightfields.indexOf(scarp) < 0 && bp.heightfields.length === 2);
}

// ── 5c. ground snap 0.18 m — gated on last frame's grounded and no impulse ───
{
  check('snap: constant is 0.18 m (contract)', near(COLLIDE_CONST.SNAP_DIST, 0.18, 1e-12), `${COLLIDE_CONST.SNAP_DIST}`);
  // One raw resolve (no driver gravity) so the gate is the only variable.
  const probe = (y, grounded, jumped) => {
    const s = makeState(0, y, 0);
    s.grounded = grounded; s.jumped = jumped; s.vel.set(0, -0.5, 0);
    return { s, r: moveAndCollide(s, world, DT) };
  };
  const a = probe(0.12, true, false);
  check('snap: grounded hero 0.12 m above the floor is pulled down onto it', a.r.grounded && near(a.s.pos.y, 0, 1e-9), `y=${a.s.pos.y.toExponential(2)}`);
  const b = probe(0.12, false, false);
  check('snap: airborne hero is NOT snapped (keeps falling)', !b.r.grounded && b.s.pos.y > 0.11, `y=${b.s.pos.y.toFixed(5)}`);
  const c = probe(0.12, true, true);
  check('snap: the impulse frame (state.jumped) is NOT snapped', !c.r.grounded && c.s.pos.y > 0.11, `y=${c.s.pos.y.toFixed(5)}`);
  const d = probe(0.25, true, false);
  check('snap: a gap beyond 0.18 m is NOT snapped', !d.r.grounded && d.s.pos.y > 0.24, `y=${d.s.pos.y.toFixed(5)}`);
  const e = makeState(0, 0.12, 0);                        // explicit ledge departure
  e.grounded = true; e.wantSnap = false; e.vel.set(0, -0.5, 0);
  const re = moveAndCollide(e, world, DT);
  check('snap: wantSnap:false vetoes the pull-down', !re.grounded && e.pos.y > 0.11, `y=${e.pos.y.toFixed(5)}`);
}

// ── 6. ramp box (30°): rest reports the slope, no jitter ─────────────────────
{
  // find the ramp top under x=12: rayDown via sweepGround
  const probe = sweepGround(new THREE.Vector3(12, 5, 0), world, 10);
  check('ramp: sweepGround hits the ramp', probe.hit && probe.collider === ramp30, `dist=${probe.dist.toFixed(3)}`);
  const st = makeState(12, probe.point.y + 0.01, 0);
  st.grounded = false;
  let r = null, slopeOk = true, groundedCount = 0;
  const ys = [];
  for (let i = 0; i < 120; i++) {
    r = step(st, world, 0, 0);
    st.vel.x = 0; st.vel.z = 0;                        // stand-in for the controller's ground friction
    if (r.grounded) groundedCount++;
    if (i > 5 && !near(r.groundSlopeDeg, 30, 0.05)) slopeOk = false;
    if (i > 5) ys.push(st.pos.y);
  }
  const jitter = Math.max(...ys) - Math.min(...ys);
  check('ramp: grounded on the ramp', groundedCount >= 118 && r.groundCollider === ramp30, `${groundedCount}/120`);
  check('ramp: groundSlopeDeg ≈ 30', slopeOk, `${r.groundSlopeDeg.toFixed(3)}`);
  check('ramp: rest is jitter-free (y range ≤ 1e-6)', jitter <= 1e-6, `range=${jitter.toExponential(2)}`);
}

// ── 7. mover carries the player exactly ──────────────────────────────────────
{
  const st = makeState(0, 2.0, -8);
  st.grounded = true;
  const N = 240;
  const startOff = st.pos.x - platform.center.x;
  let lost = 0;
  for (let i = 0; i < N; i++) {
    platform.center.x += platRef.linVel.x * DT;        // the hazard moves its deck …
    platform.update();                                 // … and rehashes
    const r = step(st, world, 0, 0);
    if (!r.grounded) lost++;
    if (i === 0) check('mover: platformVel reported', near(r.platformVel.x, 2, 1e-9), f3(r.platformVel));
  }
  const off = st.pos.x - platform.center.x;
  check('mover: carried exactly (offset drift ≤ 1e-9 over 2 s)', near(off, startOff, 1e-9), `drift=${(off - startOff).toExponential(2)}`);
  check('mover: never lost ground while riding', lost === 0, `lost ${lost}`);
  check('mover: feet stay on the deck', near(st.pos.y, 2.0, 1e-9));

  // spinning deck: radius from the pivot must be preserved (exact rotation, not a tangent step)
  const st2 = makeState(64, 0, 60);
  st2.grounded = true;
  const r0 = Math.hypot(st2.pos.x - 60, st2.pos.z - 60);
  let worstR = 0;
  for (let i = 0; i < 600; i++) {                      // 5 s = ~1 revolution
    step(st2, world, 0, 0);
    st2.vel.x = 0; st2.vel.z = 0;
    worstR = Math.max(worstR, Math.abs(Math.hypot(st2.pos.x - 60, st2.pos.z - 60) - r0));
  }
  const ang = 1.2 * 600 * DT;
  const ex = 60 + 4 * Math.cos(ang), ez = 60 - 4 * Math.sin(ang);
  check('carousel: radius preserved over a revolution', worstR <= 1e-9, `max |Δr|=${worstR.toExponential(2)}`);
  check('carousel: exact angle', near(st2.pos.x, ex, 1e-6) && near(st2.pos.z, ez, 1e-6), `${st2.pos.x.toFixed(5)},${st2.pos.z.toFixed(5)} vs ${ex.toFixed(5)},${ez.toFixed(5)}`);
}

// ── 8. raycast: wall at the right t, oriented box, heightfield ───────────────
{
  const out = { t: 0, normal: new THREE.Vector3(), point: new THREE.Vector3(), collider: null, heightfield: null };
  const o = new THREE.Vector3(0, 1, 10), d = new THREE.Vector3(1, 0, 0);
  const hit = bp.raycast(o, d, 10, out);
  check('ray: hits the wall', hit && out.collider === wall);
  check('ray: t = 3 exactly', near(out.t, 3, 1e-9), `t=${out.t}`);
  check('ray: normal −X', near(out.normal.x, -1, 1e-9) && near(out.normal.y, 0, 1e-9));
  check('ray: point on the face', near(out.point.x, 3, 1e-9));
  check('ray: misses when too short', !bp.raycast(o, d, 2.9, out) && out.t === 2.9);
  check('ray: unnormalised dir gives the same t', bp.raycast(o, new THREE.Vector3(5, 0, 0), 10, out) && near(out.t, 3, 1e-9), `t=${out.t}`);

  // oriented: the 30° ramp, straight down from above its centre
  const hit2 = bp.raycast(new THREE.Vector3(12, 5, 0), new THREE.Vector3(0, -1, 0), 10, out);
  const expT = 5 - (1.5 + 0.2 / Math.cos(30 / DEG));
  check('ray: oriented box t (30° ramp)', hit2 && out.collider === ramp30 && near(out.t, expT, 1e-9), `t=${out.t.toFixed(6)} exp=${expT.toFixed(6)}`);
  check('ray: oriented box normal is the ramp normal', near(out.normal.x, -Math.sin(30 / DEG), 1e-9) && near(out.normal.y, Math.cos(30 / DEG), 1e-9), f3(out.normal));

  // heightfield: a 45° down-slope camera ray into the 20° hill
  const o3 = new THREE.Vector3(45, hill.heightAt(45, 0) + 3, 0);
  const d3 = new THREE.Vector3(1, -1, 0).normalize();
  const hit3 = bp.raycast(o3, d3, 12, out);
  const surfErr = hit3 ? Math.abs(out.point.y - hill.heightAt(out.point.x, out.point.z)) : NaN;
  check('ray: heightfield hit', hit3 && out.heightfield === hill && out.collider === null);
  check('ray: heightfield hit point on the surface (≤1e-3)', surfErr <= 1e-3, `err=${surfErr.toExponential(2)} t=${out.t.toFixed(4)}`);
  // analytic: solve o.y - t/√2 = tan20 (o.x + t/√2 - 30)
  const s2 = Math.SQRT1_2;
  const tExp = (o3.y - SLOPE * (o3.x - 30)) / (s2 + SLOPE * s2);
  check('ray: heightfield t matches the analytic plane hit', near(out.t, tExp, 1e-3), `t=${out.t.toFixed(5)} exp=${tExp.toFixed(5)}`);
  check('ray: heightfield normal', near(out.normal.x, -Math.sin(20 / DEG), 1e-4), f3(out.normal));
  // ray starting under the terrain: blocked at t=0
  check('ray: origin under terrain hits at t=0', bp.raycast(new THREE.Vector3(40, hill.heightAt(40, 0) - 0.5, 0), d3, 5, out) && out.t === 0);
  // ray missing everything
  check('ray: clear sky misses', !bp.raycast(new THREE.Vector3(0, 50, 0), new THREE.Vector3(0, 1, 0), 100, out));
}

// ── 9. volumes + kills + ceiling + breakable ─────────────────────────────────
{
  const st = makeState(-13, -1, -13);
  const r = step(st, world, 0, 0);
  check('water: inWater = the volume', r.inWater === water);
  check('water: waterSurfaceY = volume top', near(r.waterSurfaceY, 0.5, 1e-12), `${r.waterSurfaceY}`);
  check('water: listed in result.volumes', r.volumes.length === 1 && r.volumes[0] === water);
  const st2 = makeState(0, 0, 0);
  const r2 = step(st2, world, 0, 0);
  // Snapshot: `r2` is the same reused instance the next step overwrites.
  const dryKill = r2.kill, dryWater = r2.inWater, drySurfY = r2.waterSurfaceY, dryVols = r2.volumes.length;
  check('water: not in water elsewhere', dryWater === null && Number.isNaN(drySurfY) && dryVols === 0);
  check('lava: no kill on the floor', dryKill === null);

  const st3 = makeState(-13, 0, 13);
  const r3 = step(st3, world, 0, 0);
  check('lava: kill reported', r3.kill === lava && r3.killKind === 'lava');

  // ceiling bonk: jump under the low slab (bottom y=1.2, body 1.5 tall)
  const st4 = makeState(-4.5, 0, 0);
  st4.grounded = true;
  st4.vel.y = TUNE.jumpV[0]; st4.jumped = true;
  let bonked = false, vyAfter = 1;
  for (let i = 0; i < 20; i++) { const r = step(st4, world, 0, 0); if (r.ceiling) { bonked = true; vyAfter = st4.vel.y; break; } }
  check('ceiling: bonk reported', bonked);
  check('ceiling: vy cancelled (≤ 0)', vyAfter <= 0, `vy=${vyAfter.toFixed(3)}`);

  // breakable: pound-fall onto the crate
  const st5 = makeState(-4.5, 1.5, 6);
  st5.poundFalling = true;
  st5.vel.y = -TUNE.pound.fall;
  let rb = null;
  for (let i = 0; i < 10; i++) { rb = step(st5, world, 0, 0); if (rb.grounded) break; }
  check('breakable: reported on pound landing', rb.grounded && rb.breakable === breakable && rb.poundFalling === true);
  check('breakable: the resolver stayed solid (feet on the crate top)', near(st5.pos.y, 0.5, 1e-9), `y=${st5.pos.y.toFixed(4)}`);
  breakable.active = false;                          // the controller breaks it …
  let fell = false;
  for (let i = 0; i < 10; i++) { const r = step(st5, world, 0, 0); if (st5.pos.y < 0.49) fell = true; }
  check('breakable: falls through once deactivated', fell);
  breakable.active = true;

  // crouch height honoured under the low slab
  const st6 = makeState(-4.5, 0, 0);
  st6.crouching = true; st6.grounded = true;
  const r6 = step(st6, world, 0, 0);
  check('crouch: 0.95 body fits under the 1.2 slab', r6.grounded && !r6.ceiling && near(st6.pos.y, 0, 1e-9));
}

// ── 10. no tunnelling at terminal velocity into a thin beam ──────────────────
{
  const beam = bp.add(new Collider({ center: [0, 6, 20], half: [1, 0.05, 1] }));
  const st = makeState(0, 12, 20);
  st.vel.y = -TUNE.terminal;
  let landed = false;
  for (let i = 0; i < 120; i++) { const r = step(st, world, 0, 0); if (r.grounded && r.groundCollider === beam) { landed = true; break; } }
  check('tunnelling: terminal-velocity fall lands on a 10 cm beam', landed && near(st.pos.y, 6.05, 1e-9), `y=${st.pos.y.toFixed(4)}`);
  bp.remove(beam);
}

// ── 11. result is one reused instance; capsule uses TUNE ─────────────────────
{
  const a = moveAndCollide(makeState(0, 0, 0), world, DT);
  const b = moveAndCollide(makeState(1, 0, 0), world, DT);
  check('result: single reused instance', a === b);
  const cap = C.Scratch.cap;
  check('capsule: radius = TUNE.radius', near(cap.r, TUNE.radius, 1e-12));
  check('capsule: spans the body height', near(cap.b.y - cap.a.y, TUNE.height - 2 * TUNE.radius, 1e-12));
  const keys = ['grounded', 'groundNormal', 'groundCollider', 'groundHeightfield', 'groundSlopeDeg', 'ceiling', 'walls',
    'platformVel', 'surface', 'surfaceProps', 'stepped', 'crushed', 'hitVel', 'kill', 'inWater', 'waterSurfaceY',
    'inQuicksand', 'wind', 'ladder', 'stepUpBlocked'];
  const missing = keys.filter((k) => !(k in a));
  check('result: every CONTRACT §10 field present', missing.length === 0, missing.join(','));
}

// ── report ───────────────────────────────────────────────────────────────────
console.log('\n' + '-'.repeat(70));
console.log(`${passed + failed} checks, ${failed} failing`);
if (failed) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  ${f}`);
}
process.exit(failed ? 1 : 0);
