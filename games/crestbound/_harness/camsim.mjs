/**
 * CRESTBOUND camera solver sim — DETERMINISTIC, headless, no Chrome.
 *
 * camcheck.py is the contract gate and stays the gate. But every row in it is a
 * REAL-TIME measurement, so on a box under Chrome contention it reports the
 * contention (measured on this machine: one frame per ~700 ms, i.e. every easing
 * row "fails" having had a single frame of simulation). This drives the SAME
 * FollowCamera against the SAME Broadphase at a fixed 1/60 s step, so the
 * collision / framing solver can be proved independently of how many frames the
 * machine felt like handing out.
 *
 *   node _harness/camsim.mjs
 *
 * Exit 0 = every row passes.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const imp = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };

const THREE = await import('three');
const { Collider, Broadphase } = await imp('runtime/world/collider.js');
const { TUNE, applyGravity } = await imp('runtime/core/tuning.js');
const { FollowCamera } = await imp('runtime/player/camera.js');

const DT = 1 / 60;
const C = TUNE.cam;

const rows = [];
const row = (name, ok, detail) => { rows.push({ name, ok: !!ok, detail }); };

function makeRig() {
  const bp = new Broadphase();
  const add = (cx, cy, cz, hx, hy, hz, tag) => {
    const c = new Collider({ center: new THREE.Vector3(cx, cy, cz),
                             half: new THREE.Vector3(hx, hy, hz), surface: 'stone', userData: tag });
    if (typeof c.update === 'function') c.update();
    bp.add(c); if (typeof bp.refresh === 'function') bp.refresh(c);
    return c;
  };
  return { bp, add };
}

function makePlayer(x, y, z, facing) {
  return {
    pos: new THREE.Vector3(x, y, z),
    renderPos: new THREE.Vector3(x, y, z),
    vel: new THREE.Vector3(0, 0, 0),
    headPos: new THREE.Vector3(x, y + 1.4, z),
    facing, state: 'idle', grounded: true, submerged: false, heroFade: 0,
  };
}

const INPUT = { look: { dx: 0, dy: 0 }, suspended: false, peek: false,
                camTogglePressed: false, recenterPressed: false };

/** Run one scenario at a fixed step; returns the per-frame statistics. */
function run({ rig, player, yaw, pitch, frames, step }) {
  const cam3 = new THREE.PerspectiveCamera(C.fov, 16 / 9, 0.05, 2000);
  const fc = new FollowCamera(cam3, player, INPUT, { broadphase: rig.bp }, { camMode: 'follow' });
  fc.snapToPlayer();
  fc.__test.setYaw(yaw);
  fc.__test.setPitch(pitch === undefined ? C.defaultPitch : pitch);
  const chest = new THREE.Vector3();
  const ndc = new THREE.Vector3();
  const st = { maxDrop: 0, maxFade: 0, minDist: 1e9, lastDist: fc.dist,
               maxNdcY: 0, maxNdcX: 0, occFrames: 0, occRun: 0, worstOcc: 0,
               maxPitch: -9, minPitch: 9, maxDrop2: 0, focusYMin: 1e9, focusYMax: -1e9 };
  const ray = { t: 0, normal: new THREE.Vector3(), collider: null };
  const dir = new THREE.Vector3();
  for (let i = 0; i < frames; i++) {
    if (step) step(player, i);
    fc.update(DT);
    const s = fc.__test.state();
    const drop = st.lastDist - s.dist;
    if (drop > st.maxDrop) st.maxDrop = drop;
    st.lastDist = s.dist;
    if (s.heroFade > st.maxFade) st.maxFade = s.heroFade;
    if (s.dist < st.minDist) st.minDist = s.dist;
    // the hero's chest through the real projection
    chest.set(player.renderPos.x, player.renderPos.y + TUNE.height * 0.5, player.renderPos.z);
    cam3.updateMatrixWorld(true);
    ndc.copy(chest).project(cam3);
    if (Math.abs(ndc.y) > st.maxNdcY) st.maxNdcY = Math.abs(ndc.y);
    if (Math.abs(ndc.x) > st.maxNdcX) st.maxNdcX = Math.abs(ndc.x);
    if (s.pitch > st.maxPitch) st.maxPitch = s.pitch;
    if (s.pitch < st.minPitch) st.minPitch = s.pitch;
    if (s.focusDrop > st.maxDrop2) st.maxDrop2 = s.focusDrop;
    if (s.focus[1] < st.focusYMin) st.focusYMin = s.focus[1];
    if (s.focus[1] > st.focusYMax) st.focusYMax = s.focus[1];
    // lens -> chest occlusion: the same test camcheck's occlusion row runs
    dir.copy(chest).sub(cam3.position);
    const len = dir.length();
    let occ = false;
    if (len > 0.6) { dir.multiplyScalar(1 / len); occ = rig.bp.raycast(cam3.position, dir, len - 0.35, ray); }
    if (occ) { st.occFrames++; st.occRun += DT; if (st.occRun > st.worstOcc) st.worstOcc = st.occRun; }
    else st.occRun = 0;
    st.last = s; st.cam3 = cam3; st.fc = fc;
  }
  return st;
}

const r2 = (v) => +(+v).toFixed(3);

/* ── A. WALL PRESS — camcheck's own rig, at a fixed step ────────────────── */
{
  const rig = makeRig();
  rig.add(0, -1, 0, 60, 1, 14, 'floor');
  rig.add(6.0, 3, 0, 0.5, 4, 10, 'wall');
  const hx = 5.5 - 0.38 - 0.05;
  const p = makePlayer(hx, 0, 0, Math.PI / 2);
  const st = run({ rig, player: p, yaw: Math.PI / 2, pitch: 0.15, frames: 120 });
  const s = st.last;
  const wallDist = 5.5 - s.focus[0];
  const camX = s.pos[0];
  const ok = camX <= 5.45 && s.dist <= wallDist + 1e-3 && s.dist >= 0.05 && st.maxFade < 1.0;
  row('wall', ok, { camX: r2(camX), dist: r2(s.dist), wallDist: r2(wallDist), maxHeroFade: r2(st.maxFade),
                    yawSlide: r2(s.yawSlide), maxSingleFrameDrop_instant: r2(st.maxDrop) });
}

/* ── B. PILLAR BEHIND THE HERO — the reject that deleted him ────────────── */
{
  const rig = makeRig();
  rig.add(0, -1, 0, 60, 1, 60, 'floor');
  // 0.9 m square pillar 2.0 m behind the hero, dead on the camera vector
  rig.add(0, 2.5, 2.0, 0.45, 2.5, 0.45, 'pillar');
  const p = makePlayer(0, 0, 0, 0);            // facing -Z, camera behind at +Z
  const st = run({ rig, player: p, yaw: 0, frames: 180 });
  const s = st.last;
  const ok = s.dist >= C.frameMin - 0.05 && st.maxFade < 1.0 && st.worstOcc <= 0.30;
  row('pillar', ok, { dist: r2(s.dist), frameMin: C.frameMin, yawSlide: r2(s.yawSlide),
                      maxHeroFade: r2(st.maxFade), worstOcclusion_s: r2(st.worstOcc),
                      maxSingleFrameDrop_instant: r2(st.maxDrop), ndcYTransient: r2(st.maxNdcY) });
}

/* ── C. LOW OVERHANG — camcheck's occlusion roof ────────────────────────── */
{
  const rig = makeRig();
  rig.add(0, -1, 0, 60, 1, 14, 'floor');
  rig.add(0, 2.6, 0, 5, 0.4, 4, 'roof');       // underside 2.2 m over the floor
  const p = makePlayer(0, 0, 0, -Math.PI / 2);
  const st = run({ rig, player: p, yaw: -Math.PI / 2, frames: 180 });
  const s = st.last;
  const lensY = s.pos[1];
  const ok = lensY <= 2.2 + 1e-3 && st.worstOcc <= 0.30 && st.maxFade < 1.0 && s.dist >= 0.05;
  row('overhang', ok, { lensY: r2(lensY), roofUnderside: 2.2, dist: r2(s.dist),
                        worstOcclusion_s: r2(st.worstOcc), maxHeroFade: r2(st.maxFade),
                        pitch: r2(s.pitch), limitCeiling: !!st.fc._limitCeil });
}

/* ── D. OPEN GROUND — nothing may move ──────────────────────────────────── */
{
  const rig = makeRig();
  rig.add(0, -1, 0, 60, 1, 60, 'floor');
  const p = makePlayer(0, 0, 0, 0);
  const st = run({ rig, player: p, yaw: 0, frames: 120 });
  const s = st.last;
  const ok = Math.abs(s.dist - C.dist) < 1e-3 && s.yawSlide === 0 && st.maxFade === 0
             && Math.abs(s.pitch - C.defaultPitch) < 1e-3 && st.maxNdcY <= 0.4 && st.maxNdcX <= 0.4;
  row('open', ok, { dist: r2(s.dist), yawSlide: s.yawSlide, pitch: r2(s.pitch),
                    maxHeroFade: st.maxFade, ndcX: r2(st.maxNdcX), ndcY: r2(st.maxNdcY) });
}

/* ── E. LONG FALL — the landing must stay in frame ──────────────────────── */
{
  const rig = makeRig();
  rig.add(0, -1, 0, 60, 1, 60, 'floor');
  const p = makePlayer(0, 14, 0, 0);
  let vy = 0;
  const st = run({ rig, player: p, yaw: 0, frames: 90, step: (pl) => {
    if (pl.pos.y <= 0) { pl.pos.y = 0; pl.renderPos.y = 0; pl.grounded = true; pl.vel.y = 0; return; }
    pl.grounded = false;
    vy = applyGravity(vy, DT, false);               // THE gravity function
    pl.pos.y = Math.max(0, pl.pos.y + vy * DT);
    pl.renderPos.y = pl.pos.y;
    pl.vel.y = vy;
    pl.headPos.set(pl.pos.x, pl.pos.y + 1.4, pl.pos.z);
  } });
  const s = st.last;
  // the landing target must be in frame for the descent, and the lens must have
  // actually RESPONDED to the fall (pitch is no longer a constant)
  const ok = st.maxNdcY <= 0.60 && st.maxPitch - C.defaultPitch > 0.05 && st.maxDrop2 > 0.4;
  row('fall', ok, { maxNdcY: r2(st.maxNdcY), budget: 0.6, maxPitch: r2(st.maxPitch),
                    defaultPitch: C.defaultPitch, maxFocusDrop: r2(st.maxDrop2) });
}

/* ── F. SINGLE-JUMP HOP — the frame must NOT bob ────────────────────────── */
{
  const rig = makeRig();
  rig.add(0, -1, 0, 60, 1, 60, 'floor');
  const p = makePlayer(0, 0, 0, 0);
  let vy = TUNE.jumpV[0];                           // the real single jump
  const st = run({ rig, player: p, yaw: 0, frames: 90, step: (pl) => {
    if (pl.pos.y <= 0 && vy < 0) { pl.pos.y = 0; pl.renderPos.y = 0; pl.grounded = true; pl.vel.y = 0; return; }
    pl.grounded = false;
    vy = applyGravity(vy, DT);
    pl.pos.y = Math.max(0, pl.pos.y + vy * DT);
    pl.renderPos.y = pl.pos.y;
    pl.vel.y = vy;
  } });
  // "No bob" is a property of the FOCUS, not of the hero: the frame must still
  // LAG the hop rather than ride it. The measured lag is pre-existing and comes
  // from AIR_CATCHUP_DY (2.5 m) arming on the RISE — take-off is 11.4 m/s, so
  // the rise error 11.4/AIR_LAG_V = 3.26 m exceeds it on every single jump. That
  // is out of this lane's scope; what this row must prove is that the ADAPTIVE
  // code added here does not make it worse and does not fire on a hop at all:
  // the derived pitch must stay flat (a hop never falls past its own apex).
  const apex = (TUNE.jumpV[0] * TUNE.jumpV[0]) / (2 * TUNE.gravRise);
  const focusRise = st.focusYMax - st.focusYMin;
  const ok = focusRise <= apex * 0.70 && st.maxPitch - st.minPitch <= 0.05 && st.maxDrop2 <= 0.2;
  row('hop-no-bob', ok, { apex: r2(apex), focusRise: r2(focusRise), lagLimit: r2(apex * 0.70),
                          pitchRange: r2(st.maxPitch - st.minPitch), focusDrop: r2(st.maxDrop2),
                          maxNdcY: r2(st.maxNdcY) });
}

/* ── G. 24-HEADING SWEEP — the reject's own deterministic probe ─────────── */
{
  // A cluttered stone bay: pillars, a low parapet and a back wall, i.e. the
  // rampart / undercroft geometry the audit swept. The hero stands still and we
  // settle the camera at each of 24 orbit headings. The audit found 3 of 24 at
  // 1.50-1.60 m with heroFade 1.00 -- the hero simply gone. No heading may do
  // that, and no heading may sit occluded either.
  const rig = makeRig();
  rig.add(0, -1, 0, 40, 1, 40, 'floor');
  rig.add(2.6, 2.5, 1.4, 0.45, 2.5, 0.45, 'pillar-a');
  rig.add(-2.2, 2.5, -1.8, 0.45, 2.5, 0.45, 'pillar-b');
  rig.add(0, 0.55, 3.4, 6, 0.55, 0.4, 'parapet');      // top between chest and focus
  rig.add(-4.5, 3, 0, 0.5, 3, 8, 'back-wall');
  let worstFade = 0, below = 0, occluded = 0, minDist = 1e9;
  for (let k = 0; k < 24; k++) {
    const yaw = (k / 24) * Math.PI * 2 - Math.PI;
    const p = makePlayer(0, 0, 0, yaw);
    const st = run({ rig, player: p, yaw, frames: 150 });
    const s = st.last;
    if (s.heroFade > worstFade) worstFade = s.heroFade;
    if (s.dist < minDist) minDist = s.dist;
    if (s.dist < C.frameMin - 0.05) below++;
    if (st.occRun > 0.30) occluded++;
  }
  const ok = worstFade < 1.0 && occluded === 0;
  row('sweep24', ok, { headings: 24, worstHeroFade: r2(worstFade), minDist: r2(minDist),
                       headingsBelowFrameMin: below, headingsOccluded: occluded });
}

/* ── H. COMMITTED MOVE — the slide must never steer a long jump ─────────── */
{
  const rig = makeRig();
  rig.add(0, -1, 0, 60, 1, 60, 'floor');
  rig.add(0, 2.5, 2.0, 0.45, 2.5, 0.45, 'pillar');
  const p = makePlayer(0, 0, 0, 0);
  p.state = 'longjump';
  const st = run({ rig, player: p, yaw: 0, frames: 90 });
  const s = st.last;
  const ok = s.yawSlide === 0 && s.yawForMovement === 0;
  row('freeze', ok, { state: p.state, yawSlide: r2(s.yawSlide),
                      yawForMovement: r2(s.yawForMovement), dist: r2(s.dist) });
}

/* ── report ─────────────────────────────────────────────────────────────── */
let fails = 0;
console.log('='.repeat(96));
console.log('CRESTBOUND camera solver sim — fixed 1/60 s step, real Broadphase, real FollowCamera');
console.log('-'.repeat(96));
for (const r of rows) {
  if (!r.ok) fails++;
  console.log('  %s  %s  %s', r.name.padEnd(11), r.ok ? 'PASS' : 'FAIL', JSON.stringify(r.detail));
}
console.log('-'.repeat(96));
console.log(fails ? `CAMSIM FAILS (${fails} failing)` : `CAMSIM OK (${rows.length}/${rows.length})`);
process.exit(fails ? 1 : 0);
