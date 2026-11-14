/**
 * ASCENDANT geometry check — the defects reachcheck cannot see.
 *
 * reachcheck.mjs proves a stage is CONNECTED: that a jump path exists inside the
 * physics envelope. It says nothing about whether that path is physically sane.
 * The design critics found four classes it misses, every one of them fatal:
 *
 *   1. HEADROOM   — a walkway with 1.20 m of clearance for a 1.80 m player.
 *   2. CLIPPING   — a pendulum blade or rotor arm that passes THROUGH the deck it
 *                   swings over, so the hazard is inside the floor.
 *   3. BLOCKED    — a required jump whose arc runs into solid geometry.
 *   4. MONOTONY   — 166 m without a height change; the same obstacle five times.
 *   5. ROOFED JUMP — a jump TAKEN FROM UNDER A CEILING. Added after a spire-3 review
 *                   found a 1.80 m gap whose take-off ledge had 1.45 m of headroom:
 *                   the ceiling zeroes vy after 0.40 m of rise (controller.js:1032),
 *                   the player is crouched at 4.2 m/s (speedCrouch, because they do
 *                   not fit standing), and the reach is 0.58 m. Both gates passed it.
 *                   reachcheck cannot see this at all — it graphs top faces and
 *                   evaluates every edge at speedRun/speedSprint.
 *
 * This tool measures all four. Run it alongside reachcheck on every stage.
 *
 *   node _harness/geomcheck.mjs
 *   node _harness/geomcheck.mjs temple-3 --verbose
 *   node _harness/geomcheck.mjs --json geom.json
 *
 * Exit 0 = every stage clean.
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const STAGE_DIR = join(ROOT, 'runtime', 'data', 'stages');

const { TUNE } = await import(pathToFileURL(join(ROOT, 'runtime', 'core', 'tuning.js')).href);

const PLAYER_H = TUNE.height;          // 1.8
const CROUCH_H = TUNE.crouchHeight;    // 1.05
const PLAYER_R = TUNE.radius;          // 0.35
const APEX = (TUNE.jumpV * TUNE.jumpV) / (2 * TUNE.gravRise);
const T_RISE = TUNE.jumpV / TUNE.gravRise;

const v3 = (a, d = 0) => (Array.isArray(a) ? [+a[0] || 0, +a[1] || 0, +a[2] || 0] : [d, d, d]);
const num = (x, d = 0) => (Number.isFinite(+x) ? +x : d);

// ── object classification ────────────────────────────────────────────────────
const SOLID = new Set(['platform', 'beam', 'mover', 'vanish', 'ice', 'conveyor', 'sticky',
  'jumppad', 'speedpad', 'crusher', 'wall', 'pillar']);
const LANDABLE = new Set(['platform', 'beam', 'mover', 'vanish', 'ice', 'conveyor', 'sticky',
  'jumppad', 'speedpad']);
// decor is NOT solid: it must never be mistaken for geometry, and it never blocks.
const IGNORE = new Set(['deco', 'text', 'light', 'coin']);
// Solids that move or disappear: they gate a route in TIME, they do not seal it.
const DYNAMIC_SOLID = new Set(['mover', 'vanish', 'crusher']);

/** Axis-aligned box for an object, conservatively covering any yaw rotation. */
function boxOf(o) {
  const p = v3(o.p);
  const s = v3(o.s, 1);
  let hx = Math.abs(s[0]) / 2 || 0.5;
  const hy = Math.abs(s[1]) / 2 || 0.25;
  let hz = Math.abs(s[2]) / 2 || 0.5;
  if (o.rot && (o.rot[1] || o.rot[0] || o.rot[2])) {
    const c = Math.abs(Math.cos(o.rot[1] || 0)), sn = Math.abs(Math.sin(o.rot[1] || 0));
    const ex = hx * c + hz * sn, ez = hz * c + hx * sn;
    hx = ex; hz = ez;
  }
  return { x0: p[0] - hx, x1: p[0] + hx, y0: p[1] - hy, y1: p[1] + hy,
           z0: p[2] - hz, z1: p[2] + hz, cx: p[0], cy: p[1], cz: p[2] };
}

const overlap1 = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const areaXZ = (b) => Math.max(1e-6, (b.x1 - b.x0) * (b.z1 - b.z0));

// ── 1. HEADROOM ──────────────────────────────────────────────────────────────
function checkHeadroom(objs, boxes, problems, warnings) {
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i];
    if (!LANDABLE.has(o.kind)) continue;
    const L = boxes[i];
    const top = L.y1;
    const la = areaXZ(L);
    for (let j = 0; j < objs.length; j++) {
      if (i === j) continue;
      const b = objs[j];
      if (IGNORE.has(b.kind) || !SOLID.has(b.kind)) continue;
      const B = boxes[j];
      if (B.y0 <= top + 0.02) continue;            // not above
      const clear = B.y0 - top;
      if (clear > PLAYER_H + 0.9) continue;        // plenty of room
      const cov = (overlap1(L.x0, L.x1, B.x0, B.x1) * overlap1(L.z0, L.z1, B.z0, B.z1)) / la;
      if (cov < 0.3) continue;                     // an arch over a corner is fine
      // SURFACE LAYERING, not a ceiling: an ice/conveyor sheet laid just above a
      // platform (thin gap, near-total coverage, itself landable) IS the walking
      // surface — the platform below it is cladding. temple-1 hit this: an ice
      // skin 0.20 m over its slab was reported as an unusable 0.20 m tunnel.
      if (LANDABLE.has(b.kind) && clear < 0.6 && cov > 0.85) continue;
      const what = `obj ${i} (${o.kind}) under obj ${j} (${b.kind}) covers ${(cov * 100) | 0}% of it`;
      const bothMove = DYNAMIC_SOLID.has(o.kind) && DYNAMIC_SOLID.has(b.kind);
      if (clear < CROUCH_H) {
        const line = `HEADROOM: ${what} with ${clear.toFixed(2)} m clearance — the player (${CROUCH_H.toFixed(2)} m crouched) cannot fit at all`;
        // two movers can separate as they travel; a static roof never will
        if (bothMove) warnings.push(line + ' at their authored positions (both move — verify the clearance opens up)');
        else problems.push(line);
      } else if (clear < PLAYER_H && cov > 0.6) {
        warnings.push(`HEADROOM: ${what} with ${clear.toFixed(2)} m clearance — crouch-only (player is ${PLAYER_H} m). Intentional tunnels are fine; blanket coverage is not`);
      }
    }
  }
}

// ── 2. HAZARD CLIPPING ───────────────────────────────────────────────────────
/**
 * Normalise an `axis` field the way the runtime does: 'x'|'y'|'z' or a vector.
 * Returns a unit [x,y,z].
 */
function readAxis(a, dx, dy, dz) {
  if (a === 'x') return [1, 0, 0];
  if (a === 'y') return [0, 1, 0];
  if (a === 'z') return [0, 0, 1];
  if (Array.isArray(a)) {
    const v = v3(a);
    const l = Math.hypot(v[0], v[1], v[2]);
    if (l > 1e-6) return [v[0] / l, v[1] / l, v[2] / l];
  }
  return [dx, dy, dz];
}

/**
 * The lowest world Y a moving lethal part reaches, plus its XZ footprint.
 *
 * A rotor sweeps a DISC in the plane perpendicular to its spin axis, and a
 * pendulum sweeps an ARC in the plane perpendicular to its swing axis — neither
 * is a sphere. Treating them as spheres produced false "clipping" reports against
 * geometry sitting safely beside the wheel, so the footprint is per-plane here.
 *
 * Units follow the runtime, not intuition: pendulum `amp` is RADIANS
 * (pendulum.js:295-297 — `ampDeg` is the degrees convenience), and the rotor axis
 * default is 'y' for style 'bar' and 'z' otherwise (rotors.js:305).
 */
function hazardSweep(o) {
  const p = v3(o.p);
  switch (o.kind) {
    case 'pendulum': {
      const len = num(o.len, 4);
      const amp = o.ampDeg !== undefined
        ? num(o.ampDeg, 55) * Math.PI / 180
        : num(o.amp, 0.95);                       // radians, per pendulum.js
      // mode 'ball' sizes the head from `radius`, not from `blade` (pendulum.js:303),
      // and `blade` may be omitted entirely — falling back to a 1 m default there
      // would silently understate a wrecking ball's reach.
      const isBall = String(o.mode || 'axe').toLowerCase() === 'ball';
      const ballR = num(o.radius, o.blade ? num(o.blade.w, 1.6) * 0.46 : 0.8);
      const bw = isBall ? ballR * 2 : (o.blade ? num(o.blade.w, 1) : 1);
      const bh = isBall ? ballR * 2 : (o.blade ? num(o.blade.h, 1) : 1);
      const bd = isBall ? ballR * 2 : (o.blade ? num(o.blade.d, 0.3) : 0.3);
      const lowest = p[1] - len - bh * 0.5;       // straight down, head included
      const reach = len * Math.abs(Math.sin(amp)) + bw * 0.5;
      const ax = readAxis(o.axis, 0, 0, 1);       // default 'z' -> swings along +X
      // the swing plane is perpendicular to the axis: wide across the swing,
      // thin along the axis itself
      const rx = Math.abs(ax[0]) > 0.7 ? bd * 0.5 + 0.2 : reach;
      const rz = Math.abs(ax[2]) > 0.7 ? bd * 0.5 + 0.2 : reach;
      const highest = p[1] - len * Math.cos(amp) + bh * 0.5;   // top of the blade at max swing
      return { lowest, highest, cx: p[0], cz: p[2], rx, rz, what: 'pendulum blade' };
    }
    case 'rotor': {
      const len = num(o.len, 4);
      const thick = num(o.thick, 0.4);
      const style = o.style || 'bar';
      const ax = readAxis(o.axis, ...(style === 'bar' ? [0, 1, 0] : [0, 0, 1]));
      if (Math.abs(ax[1]) > 0.7) {
        // horizontal sweeper: the disc lies flat at p.y, so the underside is the
        // lowest lethal surface and the footprint really is a circle of radius len
        return { lowest: p[1] - thick * 0.5, highest: p[1] + thick * 0.5,
                 cx: p[0], cz: p[2], rx: len, rz: len, what: `rotor '${style}' arm` };
      }
      // vertical wheel: the tip reaches `len` below the hub, but only inside the
      // rotation plane — thin along the spin axis
      const rx = Math.abs(ax[0]) > 0.7 ? thick * 0.5 + 0.2 : len;
      const rz = Math.abs(ax[2]) > 0.7 ? thick * 0.5 + 0.2 : len;
      return { lowest: p[1] - len - thick * 0.5, highest: p[1] + len + thick * 0.5,
               cx: p[0], cz: p[2], rx, rz, what: `rotor '${style}' blade` };
    }
    case 'crusher': {
      const s = v3(o.s, 2);
      const travel = num(o.travel, 3);
      const ax = readAxis(o.axis, 0, 1, 0);
      if (Math.abs(ax[1]) < 0.7) return null;     // only a downward crusher can clip a deck
      return { lowest: p[1] - Math.abs(s[1]) / 2 - travel, highest: p[1] + Math.abs(s[1]) / 2,
               cx: p[0], cz: p[2], rx: Math.abs(s[0]) / 2, rz: Math.abs(s[2]) / 2,
               what: 'crusher head' };
    }
    default: return null;
  }
}

function checkClipping(objs, boxes, problems, warnings) {
  for (let j = 0; j < objs.length; j++) {
    const sw = hazardSweep(objs[j]);
    if (!sw) continue;
    for (let i = 0; i < objs.length; i++) {
      if (i === j) continue;
      const o = objs[i];
      if (!SOLID.has(o.kind)) continue;
      const B = boxes[i];
      // does the sweep footprint sit over this surface?
      const dx = Math.max(0, Math.max(B.x0 - (sw.cx + sw.rx), (sw.cx - sw.rx) - B.x1));
      const dz = Math.max(0, Math.max(B.z0 - (sw.cz + sw.rz), (sw.cz - sw.rz) - B.z1));
      if (dx > 0 || dz > 0) continue;                     // no overlap in XZ
      if (sw.lowest >= B.y1 - 0.03) continue;             // clears the top — fine
      const hi = Number.isFinite(sw.highest) ? sw.highest : sw.lowest;
      if (hi <= B.y0 + 0.03) continue;                    // sweeps entirely BELOW it — fine
      if (sw.lowest < B.y0 - 0.5) {
        // passes entirely through and out the bottom: unmistakably wrong
        problems.push(`CLIPPING: obj ${j} ${sw.what} sweeps to y=${sw.lowest.toFixed(2)} — straight through obj ${i} (${o.kind}, top ${B.y1.toFixed(2)}, bottom ${B.y0.toFixed(2)})`);
      } else {
        problems.push(`CLIPPING: obj ${j} ${sw.what} sweeps to y=${sw.lowest.toFixed(2)}, which is ${(B.y1 - sw.lowest).toFixed(2)} m BELOW the top of obj ${i} (${o.kind}) it passes over — the hazard is inside the floor`);
      }
    }
  }
}

// ── 5. ROOFED JUMPS ──────────────────────────────────────────────────────────
/**
 * Horizontal reach of a jump taken with a ceiling `h` metres above the feet, landing
 * `dyLand` metres up. Mirrors the controller exactly:
 *   - a player who does not fit standing is crouched, so speedCrouch, not speedRun
 *     (`_resolveStance` will not let them stand into geometry);
 *   - the rise stops when the head meets the ceiling — controller.js sets
 *     `res.ceiling` and zeroes a positive vy;
 *   - ducking in the AIR does not help: the airborne tuck lifts the FEET and pins the
 *     capsule top (FOOT_LIFT), so it buys no head clearance.
 * Returns null when the jump cannot reach the landing height at all.
 */
function roofedReach(h, dyLand) {
  const stand = h >= PLAYER_H;
  const speed = stand ? TUNE.speedRun : TUNE.speedCrouch;
  const rise = Math.min(APEX, Math.max(0, h - (stand ? PLAYER_H : CROUCH_H)));
  let tUp;
  if (rise >= APEX - 1e-6) tUp = T_RISE;
  else {
    const disc = TUNE.jumpV * TUNE.jumpV - 2 * TUNE.gravRise * rise;
    tUp = (TUNE.jumpV - Math.sqrt(Math.max(0, disc))) / TUNE.gravRise;
  }
  const drop = rise - dyLand;
  if (drop < 0) return null;                       // cannot get high enough at all
  return { reach: speed * (tUp + Math.sqrt(2 * drop / TUNE.gravFall)), stand, speed };
}

/** Lowest PERMANENT solid over a point, measured from `aboveY`. Movers and vanish
 *  panels are excluded: they gate a route in time, they are not a ceiling. */
function ceilingOver(objs, boxes, px, pz, aboveY, skipA, skipB) {
  let clear = Infinity, who = -1;
  for (let j = 0; j < objs.length; j++) {
    if (j === skipA || j === skipB) continue;
    const o = objs[j];
    if (!SOLID.has(o.kind) || DYNAMIC_SOLID.has(o.kind)) continue;
    const b = boxes[j];
    if (b.y0 <= aboveY + 0.02) continue;
    if (px < b.x0 - PLAYER_R || px > b.x1 + PLAYER_R) continue;
    if (pz < b.z0 - PLAYER_R || pz > b.z1 + PLAYER_R) continue;
    if (b.y0 - aboveY < clear) { clear = b.y0 - aboveY; who = j; }
  }
  return { clear, who };
}

function checkRoofed(objs, boxes, problems, warnings) {
  const rects = [];
  for (let i = 0; i < objs.length; i++) {
    if (!LANDABLE.has(objs[i].kind)) continue;
    rects.push({ i, b: boxes[i], top: boxes[i].y1 });
  }
  // pass 1: classify every jumpable pair as blocked-by-ceiling or not
  const blocked = [];
  const escapable = new Set();
  for (const a of rects) {
    for (const b of rects) {
      if (a === b) continue;
      const dy = b.top - a.top;
      const dx = Math.max(0, Math.max(a.b.x0 - b.b.x1, b.b.x0 - a.b.x1));
      const dz = Math.max(0, Math.max(a.b.z0 - b.b.z1, b.b.z0 - a.b.z1));
      const d = Math.hypot(dx, dz);
      // contiguous ground, or a step down you can walk off: never a roofed jump
      if (d < 0.05) { if (Math.abs(dy) <= TUNE.stepUp || dy < 0) escapable.add(a.i); continue; }
      if (dy > APEX - 0.02) continue;                        // out of reach anyway
      const tFall = Math.sqrt((2 * (APEX - dy)) / TUNE.gravFall);
      if (d > TUNE.speedSprint * (T_RISE + tFall)) continue;  // nobody could make it
      const tx = Math.min(Math.max((b.b.x0 + b.b.x1) / 2, a.b.x0), a.b.x1);
      const tz = Math.min(Math.max((b.b.z0 + b.b.z1) / 2, a.b.z0), a.b.z1);
      const c = ceilingOver(objs, boxes, tx, tz, a.top, a.i, b.i);
      // clearance under the crouch height is a HEADROOM defect, not a reach one: the
      // player cannot be standing there to jump at all, so checkHeadroom owns it.
      if (!Number.isFinite(c.clear) || c.clear >= PLAYER_H + 0.4 || c.clear < CROUCH_H) {
        escapable.add(a.i);
        continue;
      }
      const rr = roofedReach(c.clear, dy);
      if (rr && rr.reach >= d) { escapable.add(a.i); continue; }
      blocked.push({ a, b, d, dy, c, rr });
    }
  }
  // pass 2: a blocked pair on a surface with no other way out is a TRAP; a blocked
  // pair beside an open exit is only a route the ceiling quietly deletes.
  const seen = new Set();
  for (const { a, b, d, dy, c, rr } of blocked) {
    const key = `${a.i}>${b.i}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const how = rr === null
      ? `the ceiling stops the rise below the ${dy.toFixed(2)} m landing`
      : `${rr.reach.toFixed(2)} m of reach at ${rr.stand ? 'speedRun' : 'speedCrouch'} ${rr.speed}`;
    const line = `ROOFED JUMP: obj ${a.i} (${objs[a.i].kind}) -> obj ${b.i} (${objs[b.i].kind}) is ${d.toFixed(2)} m ` +
      `but the take-off has obj ${c.who} ${c.clear.toFixed(2)} m overhead — ${how}`;
    if (escapable.has(a.i)) warnings.push(line + ' (the surface has another way out, so this is a route the roof deletes)');
    else problems.push(line + ' — and it is the ONLY way off that surface');
  }
}

// ── 3. BLOCKED JUMP ARCS ─────────────────────────────────────────────────────
/** Sample the jump arc from a take-off point to a landing point. */
function arcSamples(from, to, n = 26) {
  const dx = to[0] - from[0], dz = to[2] - from[2], dy = to[1] - from[1];
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return [];
  // time of flight for this dy, using the same asymmetric gravity as the controller
  if (dy > APEX - 0.02) return [];
  const tFall = Math.sqrt((2 * (APEX - dy)) / TUNE.gravFall);
  const T = T_RISE + tFall;
  const out = [];
  for (let k = 1; k < n; k++) {
    const t = (k / n) * T;
    const y = t <= T_RISE
      ? from[1] + TUNE.jumpV * t - 0.5 * TUNE.gravRise * t * t
      : from[1] + APEX - 0.5 * TUNE.gravFall * (t - T_RISE) * (t - T_RISE);
    const f = t / T;
    out.push([from[0] + dx * f, y, from[2] + dz * f]);
  }
  return out;
}

function nearestPointOn(b, p) {
  return [Math.min(Math.max(p[0], b.x0), b.x1), b.y1, Math.min(Math.max(p[2], b.z0), b.z1)];
}

function checkBlocked(objs, boxes, waypoints, problems, warnings) {
  for (let w = 0; w + 1 < waypoints.length; w++) {
    const A = waypoints[w], B = waypoints[w + 1];
    if (A.idx === B.idx) continue;
    const ba = boxes[A.idx], bb = boxes[B.idx];
    const from = nearestPointOn(ba, [bb.cx, 0, bb.cz]);
    const to = nearestPointOn(bb, [ba.cx, 0, ba.cz]);
    const pts = arcSamples(from, to);
    if (!pts.length) continue;
    const hits = new Map();
    for (const p of pts) {
      for (let i = 0; i < objs.length; i++) {
        if (i === A.idx || i === B.idx) continue;
        const o = objs[i];
        if (!SOLID.has(o.kind)) continue;
        const b = boxes[i];
        if (p[0] < b.x0 - PLAYER_R || p[0] > b.x1 + PLAYER_R) continue;
        if (p[2] < b.z0 - PLAYER_R || p[2] > b.z1 + PLAYER_R) continue;
        // the player's body occupies [y, y + PLAYER_H] above the arc point
        if (p[1] + PLAYER_H < b.y0 || p[1] > b.y1) continue;
        hits.set(i, (hits.get(i) || 0) + 1);
      }
    }
    for (const [i, n] of hits) {
      if (n < 3) continue;                    // a graze is a clearance warning, not a wall
      const frac = n / pts.length;
      const kind = objs[i].kind;
      const msg = `BLOCKED: the required jump ${A.name} -> ${B.name} passes through obj ${i} (${kind}) for ${(frac * 100) | 0}% of its arc`;
      // A crusher, mover or vanish panel in the arc is a TIMED GATE — that is the
      // intended design, and a static check cannot know the window. Only permanently
      // solid geometry makes a jump impossible.
      if (DYNAMIC_SOLID.has(kind)) {
        warnings.push(msg + ' — timed gate: confirm the open window is generous enough to cross');
      } else if (frac > 0.18) problems.push(msg);
      else warnings.push(msg + ' — tight clearance');
    }
  }
}

// ── 4. MONOTONY ──────────────────────────────────────────────────────────────
function checkMonotony(objs, boxes, problems, warnings, isHub) {
  const lands = [];
  for (let i = 0; i < objs.length; i++) {
    if (!LANDABLE.has(objs[i].kind)) continue;
    lands.push({ i, x: boxes[i].cx, y: boxes[i].y1,
                 w: boxes[i].x1 - boxes[i].x0, d: boxes[i].z1 - boxes[i].z0 });
  }
  lands.sort((a, b) => a.x - b.x);
  if (lands.length < 4) return { flatRun: 0, sigRatio: 1, gapCv: 0, maxRepeat: 0 };

  // longest stretch of X with no meaningful height change
  let flatRun = 0, runStart = lands[0].x, lastY = lands[0].y;
  for (const L of lands) {
    if (Math.abs(L.y - lastY) > 0.75) { runStart = L.x; lastY = L.y; }
    else flatRun = Math.max(flatRun, L.x - runStart);
  }

  // shape variety: how many distinct (w,d) signatures per landable
  const sig = new Set(lands.map((L) => `${L.w.toFixed(1)}x${L.d.toFixed(1)}`));
  const sigRatio = sig.size / lands.length;

  // gap-length variation along the sorted run
  const gaps = [];
  for (let k = 1; k < lands.length; k++) gaps.push(lands[k].x - lands[k - 1].x);
  const mean = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);
  const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, gaps.length));
  const gapCv = mean > 0 ? sd / mean : 0;

  // longest run of consecutive IDENTICAL obstacles (same kind, size and height step)
  let maxRepeat = 1, cur = 1;
  for (let k = 1; k < lands.length; k++) {
    const a = lands[k - 1], b = lands[k];
    const same = objs[a.i].kind === objs[b.i].kind
      && Math.abs(a.w - b.w) < 0.05 && Math.abs(a.d - b.d) < 0.05
      && Math.abs((b.y - a.y) - (k > 1 ? lands[k - 1].y - lands[k - 2].y : 0)) < 0.05;
    cur = same ? cur + 1 : 1;
    maxRepeat = Math.max(maxRepeat, cur);
  }

  if (!isHub) {
    if (flatRun > 60) problems.push(`MONOTONY: ${flatRun.toFixed(0)} m of travel with no height change greater than 0.75 m — a flat corridor is not a stage`);
    else if (flatRun > 40) warnings.push(`MONOTONY: ${flatRun.toFixed(0)} m without a height change`);
    if (sigRatio < 0.18) problems.push(`MONOTONY: only ${sig.size} distinct platform sizes across ${lands.length} landable surfaces (${(sigRatio * 100) | 0}%) — everything is the same shape`);
    else if (sigRatio < 0.3) warnings.push(`MONOTONY: only ${sig.size} distinct platform sizes across ${lands.length} surfaces`);
    if (gapCv < 0.22) problems.push(`MONOTONY: gap lengths barely vary (coefficient of variation ${gapCv.toFixed(2)}, mean ${mean.toFixed(1)} m) — every jump feels the same`);
    else if (gapCv < 0.35) warnings.push(`MONOTONY: gap lengths vary little (cv ${gapCv.toFixed(2)})`);
    if (maxRepeat >= 5) problems.push(`MONOTONY: ${maxRepeat} identical obstacles in a row (same kind, same size, same height step)`);
    else if (maxRepeat === 4) warnings.push('MONOTONY: 4 identical obstacles in a row');
  }
  return { flatRun: +flatRun.toFixed(1), sigRatio: +sigRatio.toFixed(2),
           gapCv: +gapCv.toFixed(2), maxRepeat, landables: lands.length, sizes: sig.size };
}

// ── driver ───────────────────────────────────────────────────────────────────
function analyse(def) {
  const objs = (def.objects || []).filter(Boolean);
  const boxes = objs.map(boxOf);
  const problems = [], warnings = [];
  const isHub = def.id === 'hub' || def.isHub === true;

  // waypoints: nearest landable to spawn, each checkpoint, the finish
  const nearestIdx = (p) => {
    let best = -1, bd = 1e9;
    for (let i = 0; i < objs.length; i++) {
      if (!LANDABLE.has(objs[i].kind)) continue;
      const b = boxes[i];
      const cx = Math.min(Math.max(p[0], b.x0), b.x1);
      const cz = Math.min(Math.max(p[2], b.z0), b.z1);
      const d = Math.hypot(p[0] - cx, p[2] - cz) + Math.abs(p[1] - b.y1) * 0.6;
      if (d < bd) { bd = d; best = i; }
    }
    return bd <= 6 ? best : -1;
  };
  const way = [];
  const s = nearestIdx(v3(def.spawn && def.spawn.p));
  if (s >= 0) way.push({ name: 'spawn', idx: s });
  (def.checkpoints || []).forEach((c, k) => {
    const i = nearestIdx(v3(c.p));
    if (i >= 0) way.push({ name: `cp${k}`, idx: i });
  });
  if (def.finish) {
    const f = nearestIdx(v3(def.finish.p));
    if (f >= 0) way.push({ name: 'finish', idx: f });
  }

  checkHeadroom(objs, boxes, problems, warnings);
  checkClipping(objs, boxes, problems, warnings);
  checkRoofed(objs, boxes, problems, warnings);
  checkBlocked(objs, boxes, way, problems, warnings);
  // ── 5. CHECKPOINT SAFETY ─────────────────────────────────────────────────────
  // A respawn point inside a hazard's swept volume is a guaranteed second death:
  // temple-1's cp1 sat dead-centre under a censer pendulum (blade bottom 12.56 m,
  // standing head 13.0 m) and loopcheck measured every death there as two. The
  // sweep footprints are conservative per-plane volumes from hazardSweep().
  {
    const points = [];
    if (def.spawn && Array.isArray(def.spawn.p)) points.push({ name: 'spawn', p: v3(def.spawn.p) });
    (def.checkpoints || []).forEach((c, k) => {
      if (c && Array.isArray(c.p)) points.push({ name: 'cp' + k, p: v3(c.p) });
    });
    for (let j = 0; j < objs.length; j++) {
      const o = objs[j];
      const sw = hazardSweep(o);
      if (!sw) continue;
      // a 'bar' rotor is SOLID, not lethal, unless the def says kill — being hit
      // is a shove, not a guaranteed second death. Report those as warnings.
      const barPush = o.kind === 'rotor' && (o.style || 'bar') === 'bar' && !o.kill;
      let hi = Number.isFinite(sw.highest) ? sw.highest : sw.lowest;
      let lo = sw.lowest;
      for (const pt of points) {
        const ddx = pt.p[0] - sw.cx, ddz = pt.p[2] - sw.cz;
        // A y-axis sweeper traces a CIRCLE (rx === rz), so the box test
        // |dx|<=r && |dz|<=r wrongly flags the deck CORNERS — the one place a
        // player can legitimately stand. Use radial distance there; the thin-slab
        // footprints (pendulum arc, vertical wheel) keep the box test.
        const circular = Math.abs(sw.rx - sw.rz) < 1e-6;
        if (circular) {
          if (Math.hypot(ddx, ddz) > sw.rx + PLAYER_R) continue;
        } else if (Math.abs(ddx) > sw.rx + PLAYER_R || Math.abs(ddz) > sw.rz + PLAYER_R) {
          continue;
        }
        // Pendulums: the blade is LOWEST at the swing centre and rises toward the
        // ends — evaluate at this point's real offset instead of the global
        // minimum, or a checkpoint near the end of the arc false-positives.
        if (o.kind === 'pendulum') {
          const len = num(o.len, 4);
          const bh = (String(o.mode || 'axe').toLowerCase() === 'ball')
            ? num(o.radius, 0.8) : (o.blade ? num(o.blade.h, 1) : 1);
          const piv = v3(o.p);
          const ax = readAxis(o.axis, 0, 0, 1);
          // swing direction is perpendicular to the axis, in the XZ plane
          const d = Math.abs(ax[2]) > 0.7 ? (pt.p[0] - piv[0]) : (pt.p[2] - piv[2]);
          const dd = Math.min(Math.abs(d), len * 0.999);
          lo = piv[1] - Math.sqrt(len * len - dd * dd) - bh * 0.5;
          hi = lo + bh;
        }
        // the player occupies [y, y + height] standing at the respawn point
        const feet = pt.p[1], head = pt.p[1] + PLAYER_H;
        if (hi <= feet + 0.05 || lo >= head - 0.05) continue;
        const line = 'CHECKPOINT SAFETY: ' + pt.name + ' at [' + pt.p.map((v) => v.toFixed(1)).join(', ') +
          '] stands inside the sweep of obj ' + j + ' (' + sw.what + ', y ' + lo.toFixed(2) +
          '..' + hi.toFixed(2) + ' at this offset)';
        if (barPush) warnings.push(line + ' - solid bar: a shove off the pad, verify it cannot push the player into a drop');
        else problems.push(line + ' - every respawn there is a second death');
      }
    }
  }

  const mono = checkMonotony(objs, boxes, problems, warnings, isHub);

  return { id: def.id, name: def.name, objects: objs.length, mono,
           problems, warnings, pass: problems.length === 0 };
}

const argv = process.argv.slice(2);
let jsonOut = null, verbose = false;
const ji = argv.indexOf('--json');
if (ji >= 0) { jsonOut = argv[ji + 1]; argv.splice(ji, 2); }
const vi = argv.indexOf('--verbose');
if (vi >= 0) { verbose = true; argv.splice(vi, 1); }

let files = readdirSync(STAGE_DIR).filter((f) => f.endsWith('.js'));
if (argv.length) files = files.filter((f) => argv.includes(f.replace(/\.js$/, '')));

const reports = [];
for (const f of files.sort()) {
  try {
    const def = (await import(pathToFileURL(join(STAGE_DIR, f)).href)).default;
    reports.push(analyse(def));
  } catch (e) {
    reports.push({ id: f, pass: false, problems: [`import failed: ${e.message}`], warnings: [], mono: {} });
  }
}

console.log(`\nASCENDANT geometry check — player ${PLAYER_H} m standing / ${CROUCH_H} m crouched, radius ${PLAYER_R} m`);
console.log('headroom · hazard clipping · roofed jumps · blocked arcs · checkpoint safety · monotony\n');
console.log('id            obj  flatRun  sizes  gapCv  rep   status');
console.log('-'.repeat(74));
let failing = 0;
for (const r of reports) {
  if (!r.pass) failing++;
  const m = r.mono || {};
  console.log(
    `${String(r.id).padEnd(13)} ${String(r.objects ?? '-').padStart(4)} ` +
    `${String(m.flatRun ?? '-').padStart(8)} ${String(m.sizes ?? '-').padStart(6)} ` +
    `${String(m.gapCv ?? '-').padStart(6)} ${String(m.maxRepeat ?? '-').padStart(4)}   ${r.pass ? 'PASS' : 'FAIL'}`
  );
  for (const p of r.problems) console.log(`    X  ${p}`);
  const ws = verbose ? r.warnings : r.warnings.slice(0, 6);
  for (const w of ws) console.log(`    ~  ${w}`);
  if (!verbose && r.warnings.length > 6) console.log(`    ~  ...and ${r.warnings.length - 6} more warnings (--verbose)`);
}
console.log('-'.repeat(74));
console.log(`${reports.length} stages, ${failing} failing\n`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(reports, null, 2));
process.exit(failing ? 1 : 0);
