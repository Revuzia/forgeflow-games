// What the player sees, measured: the game's own camera rig (src/render/camera.js - the code the renderer
// runs every frame) driven alongside the headless sim, and per frame the things a player would complain
// about: the camera jammed into the hero, the camera inside a wall, the hero off screen or hidden.
// Used by tests/camera.test.js (every level: spawn, checkpoints, along the scripted route, and walked into
// every big prop and wall) and by hand for sweeps.

import { CameraRig } from '../../src/render/camera.js';
import { DT } from '../../src/sim/constants.js';

/** The two screens the rig is checked on: a desktop window and a portrait phone. */
export const VIEWS = {
  desktop: { w: 1280, h: 720, portrait: false, fov: 55 },
  phone: { w: 375, h: 812, portrait: true, fov: 68 },
};

export const FRAME = 1 / 60;              // one rendered frame: two sim ticks at 120 Hz

/** A rig for `sim`, set up as the renderer sets it up at level start (or after a teleport). */
export function rigFor(sim, view = VIEWS.desktop, Rig = CameraRig) {
  const rig = new Rig();
  rig.portrait = view.portrait;
  rig.setLevel(sim);
  rig.snap(sim.player);
  return rig;
}

/** The hero's drawn position (the renderer interpolates; at a frame boundary that is the sim position). */
const hero = (sim) => sim.player;

/**
 * Advance one rendered frame as the game does: the stick (camera-space {x right, y forward, jump}, or null)
 * goes to the rig first (steer), the sim takes two ticks reading it against the rig's control yaw, exactly as
 * src/main.js + src/ui/input.js do, then the camera moves.
 */
export function frame(sim, rig, stick = null) {
  const x = stick ? stick.x || 0 : 0, y = stick ? stick.y || 0 : 0;
  if (rig.steer) rig.steer(x, y);
  const w = worldMove(rig.controlYaw === undefined ? rig.yaw : rig.controlYaw, x, y);
  const input = { mx: w.mx, mz: w.mz, jump: !!(stick && stick.jump) };
  const n = Math.round(FRAME / DT);
  for (let i = 0; i < n; i++) {
    sim.step(input);
    // a respawn: the renderer has the camera follow the hero back (Renderer.onEvent)
    if (sim.events.some((e) => e.type === 'respawn') && rig.follow) rig.follow(sim.player);
    sim.events.length = 0;
  }
  rig.update(FRAME, x, hero(sim));
}

/** A frame driven by a WORLD-space input (a scripted route): the stick a player would hold for it is told to the rig. */
export function frameWorld(sim, rig, mx, mz, jump = false) {
  const sy = Math.sin(rig.yaw), cy = Math.cos(rig.yaw);
  const x = mx * cy - mz * sy, y = -(mx * sy + mz * cy);
  if (rig.steer) rig.steer(x, y);
  rig.update(FRAME, x, hero(sim));
}

/** Camera-space stick (x right, y forward) to the world move the sim wants, exactly as src/ui/input.js does. */
export function worldMove(yaw, x, y) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  return { mx: x * c - y * s, mz: -x * s - y * c };
}
/** And back: the camera-space strafe (moveX) of a world move. */
export function strafeOf(yaw, mx, mz) { return mx * Math.cos(yaw) - mz * Math.sin(yaw); }

/** Is a solid something the eye cannot see through right now? (glass, grates and leaves are; a wall being cut away is.) */
function opaque(s, rig) {
  if (!s.active || s.oneWay || s.pass) return false;
  const t = s.owner && s.owner.type;
  if (t === 'pane' || t === 'slot') return false;
  const f = rig.fades.get(s);
  return !(f && f.a >= 0.5);
}

function segHits(s, ax, ay, az, bx, by, bz) {
  let t0 = 0, t1 = 1;
  const d = [bx - ax, by - ay, bz - az], o = [ax, ay, az], lo = [s.x0, s.y0, s.z0], hi = [s.x1, s.y1, s.z1];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-9) { if (o[k] < lo[k] || o[k] > hi[k]) return false; continue; }
    let a = (lo[k] - o[k]) / d[k], c = (hi[k] - o[k]) / d[k];
    if (a > c) { const t = a; a = c; c = t; }
    if (a > t0) t0 = a; if (c < t1) t1 = c;
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Measure the current frame. Returns
 *   dist     camera to the middle of the hero, metres
 *   inside   the solid the camera is inside of (within its near plane, 0.12 m), or null
 *   onScreen the middle of the hero is inside the picture (with a 5% margin)
 *   seen     how many of 5 points on the hero (feet, middle, head, either side) the eye can see
 */
export function look(sim, rig, view = VIEWS.desktop) {
  const m = hero(sim), P = rig.pos, cy = m.y + 0.45;
  const dist = Math.hypot(P.x - m.x, P.y - cy, P.z - m.z);
  let inside = null;
  const e = 0.12;
  for (const s of sim.solids) {
    if (!s.active || s.oneWay) continue;
    if (P.x > s.x0 - e && P.x < s.x1 + e && P.y > s.y0 - e && P.y < s.y1 + e && P.z > s.z0 - e && P.z < s.z1 + e) {
      if (s.kind === 'ramp' && aboveRamp(s, P, e)) continue;
      inside = s; break;
    }
  }
  // projection, as the renderer's PerspectiveCamera.lookAt(look - 0.25 up) with its view offset
  let fx = rig.look.x - P.x, fy = rig.look.y - 0.25 - P.y, fz = rig.look.z - P.z;
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;           // right = forward x up
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;                                // up = right x forward
  const ty = Math.tan(view.fov * Math.PI / 360), tx = ty * view.w / view.h;
  const proj = (x, y, z) => {
    const dx = x - P.x, dy = y - P.y, dz = z - P.z, zz = dx * fx + dy * fy + dz * fz;
    if (zz < 0.15) return null;
    return [(dx * rx + dz * rz) / zz / tx, (dx * ux + dy * uy + dz * uz) / zz / ty + 2 * rig.lookDrop];
  };
  const c = proj(m.x, cy, m.z);
  const onScreen = !!c && Math.abs(c[0]) < 0.95 && Math.abs(c[1]) < 0.95;
  const sx = -(P.z - m.z), sz = P.x - m.x, sl = Math.hypot(sx, sz) || 1;
  const pts = [[m.x, m.y + 0.15, m.z], [m.x, cy, m.z], [m.x, m.y + 0.8, m.z], [m.x + sx / sl * 0.3, cy, m.z + sz / sl * 0.3], [m.x - sx / sl * 0.3, cy, m.z - sz / sl * 0.3]];
  let seen = 0;
  for (const q of pts) {
    let hit = false;
    for (const s of sim.solids) {
      if (!opaque(s, rig)) continue;
      // a solid the hero is standing inside (film under a low wall, steam in a grate) does not hide it from itself
      if (q[0] > s.x0 && q[0] < s.x1 && q[1] > s.y0 && q[1] < s.y1 && q[2] > s.z0 && q[2] < s.z1) continue;
      if (s.kind === 'ramp' ? rampBlocks(s, P, q) : segHits(s, P.x, P.y, P.z, q[0], q[1], q[2])) { hit = true; break; }
    }
    if (!hit) seen++;
  }
  return { dist, inside, onScreen, seen, ndc: c };
}

function aboveRamp(s, p, e) {
  let u;
  switch (s.up) {
    case '+x': u = (p.x - s.x0) / (s.x1 - s.x0); break;
    case '-x': u = (s.x1 - p.x) / (s.x1 - s.x0); break;
    case '+z': u = (p.z - s.z0) / (s.z1 - s.z0); break;
    default: u = (s.z1 - p.z) / (s.z1 - s.z0);
  }
  return p.y > s.y0 + (s.y1 - s.y0) * Math.max(0, Math.min(1, u)) + e;
}
function rampBlocks(s, P, q) {
  if (!segHits(s, P.x, P.y, P.z, q[0], q[1], q[2])) return false;
  for (let k = 1; k < 16; k++) {
    const t = k / 16, x = P.x + (q[0] - P.x) * t, y = P.y + (q[1] - P.y) * t, z = P.z + (q[2] - P.z) * t;
    if (x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1 && y > s.y0 && !aboveRamp(s, { x, y, z }, 0)) return true;
  }
  return false;
}

/** Name a solid for a report. */
export function nameOf(s) {
  if (!s) return '-';
  const o = s.owner || {};
  return `${o.type || '?'}${o.kind ? `:${o.kind}` : ''}${o.id ? `#${o.id}` : ''} [${[s.x0, s.y0, s.z0, s.x1, s.y1, s.z1].map((v) => Math.round(v * 10) / 10).join(',')}]`;
}

/**
 * Keep a running worst case. `rec` accumulates: min distance (and where), frames with the camera inside
 * geometry, frames with the hero off screen, frames with the hero wholly hidden.
 */
export function newRecord() { return { frames: 0, minDist: Infinity, minAt: '', inside: 0, insideAt: '', off: 0, offAt: '', hidden: 0, hiddenAt: '', pop: 0, popAt: '' }; }
/** Start a new run in a record (the next frame is not compared with the last one for pops). */
export function cut(rec) { rec.prev = null; }
export function note(rec, r, where, sim = null, rig = null) {
  rec.frames++;
  if (sim && rig) {
    // a pop: the camera jumps relative to the hero by more than 0.5 m in one frame (30 m/s) - not a move, a cut
    const p = sim.player, rel = [rig.pos.x - p.x, rig.pos.y - p.y, rig.pos.z - p.z];
    if (rec.prev && p.warp === rec.warp) {
      const j = Math.hypot(rel[0] - rec.prev[0], rel[1] - rec.prev[1], rel[2] - rec.prev[2]);
      if (j > rec.pop) { rec.pop = j; rec.popAt = where; }
    }
    rec.prev = rel; rec.warp = p.warp;
  }
  if (r.dist < rec.minDist) { rec.minDist = r.dist; rec.minAt = where; }
  if (r.inside) { if (!rec.inside) rec.insideAt = `${where} in ${nameOf(r.inside)}`; rec.inside++; }
  if (!r.onScreen) { if (!rec.off) rec.offAt = `${where} ndc ${r.ndc ? r.ndc.map((v) => v.toFixed(2)) : 'behind'}`; rec.off++; }
  if (r.seen === 0) { if (!rec.hidden) rec.hiddenAt = where; rec.hidden++; }
}

/** Where a hero can stand: walkable spots next to every big prop and wall, plus the spawn and every checkpoint. */
export function spots(sim, { maxPerLevel = 400, wallMinH = 1.0, step = 3 } = {}) {
  const L = sim.level, out = [];
  const add = (x, y, z, kind, face) => out.push({ x, y, z, kind, face });
  add(L.spawn[0], L.spawn[1], L.spawn[2], 'spawn', null);
  for (const c of L.checkpoints) add(c.pos[0], c.pos[1], c.pos[2], 'checkpoint', null);
  if (L.braziers) for (const c of L.braziers) add(c.pos[0] + 0.9, c.pos[1], c.pos[2], 'brazier', null);
  const near = [];
  for (const s of sim.solids) {
    if (!s.active || s.oneWay || s.kind !== 'box') continue;
    const t = s.owner && s.owner.type, h = s.y1 - s.y0;
    if (!(t === 'prop' || ((t === 'block' || t === 'wood' || t === 'door') && h >= wallMinH))) continue;
    // the four faces: walk along each, a spot every `step` metres, 0.45 m out, on whatever floor is there
    const faces = [[s.x0 - 0.45, null, 1, 0], [s.x1 + 0.45, null, -1, 0], [null, s.z0 - 0.45, 0, 1], [null, s.z1 + 0.45, 0, -1]];
    for (const [fx, fz, nx, nz] of faces) {
      const len = fx !== null ? s.z1 - s.z0 : s.x1 - s.x0, n = Math.max(1, Math.min(6, Math.round(len / step)));
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        const x = fx !== null ? fx : s.x0 + (s.x1 - s.x0) * u, z = fz !== null ? fz : s.z0 + (s.z1 - s.z0) * u;
        const top = s.y0 + 1.2, d = sim.raycast(x, top, z, 0, -1, 0, 2.6, (q) => q.active && !q.pass);
        if (d >= 2.6) continue;
        const y = top - d;
        if (Math.abs(y - s.y0) > 0.7) continue;
        near.push({ x, y, z, kind: t === 'prop' ? `prop:${s.owner.kind}` : t, face: [nx, nz] });
      }
    }
  }
  // spread the wall spots evenly if a level has very many
  const k = Math.max(1, near.length / Math.max(1, maxPerLevel - out.length));
  for (let i = 0; i < near.length && out.length < maxPerLevel; i += k) out.push(near[Math.floor(i)]);
  return out;
}

/** Can the hero stand here? (teleport, settle a few ticks: still there, on the ground, alive) */
export function standAt(sim, s) {
  sim.teleport(s.x, s.y + 0.05, s.z);
  const d0 = sim.deaths;
  for (let i = 0; i < 12; i++) { sim.step(); sim.events.length = 0; }
  const p = sim.player;
  return sim.deaths === d0 && p.grounded && Math.hypot(p.x - s.x, p.z - s.z) < 0.4 && Math.abs(p.y - s.y) < 0.4;
}
