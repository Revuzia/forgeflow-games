/**
 * ASCENDANT reach check — the "no impossible jump" gate.
 *
 * Reads every stage def, extracts every landable surface, builds a reachability
 * graph using the SAME jump maths the player controller uses (runtime/core/tuning.js),
 * and proves that spawn -> each checkpoint -> finish is connected by jumps that fit
 * inside the reach envelope. It also reports the stage's real shape: obstacle count,
 * length, checkpoint spacing, hazard mix and difficulty ramp — so "is this a real
 * stage or four platforms" is a measured fact, not an opinion.
 *
 *   node _harness/reachcheck.mjs                 # all stages
 *   node _harness/reachcheck.mjs neon-1 neon-2   # specific stages
 *   node _harness/reachcheck.mjs --json report.json
 *
 * Exit code 0 = every stage passes.
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const STAGE_DIR = join(ROOT, 'runtime', 'data', 'stages');

const { TUNE } = await import(pathToFileURL(join(ROOT, 'runtime', 'core', 'tuning.js')).href);

// ── jump envelope, derived from TUNE (identical maths to the controller) ───────
const APEX = (TUNE.jumpV * TUNE.jumpV) / (2 * TUNE.gravRise);
const T_RISE = TUNE.jumpV / TUNE.gravRise;

/** Max horizontal distance of a jump from a surface to one `dy` metres above it. */
function maxJumpDist(speed, dy) {
  if (dy > APEX - 0.02) return -1;                       // cannot get high enough
  const tFall = Math.sqrt((2 * (APEX - dy)) / TUNE.gravFall);
  return speed * (T_RISE + tFall);
}
/** Max horizontal distance of a plain run-off (no jump) to a lower surface. */
function maxFallDist(speed, dy) {
  if (dy >= 0) return -1;
  return speed * Math.sqrt((2 * -dy) / TUNE.gravFall);
}

const SAFE = 0.83;                    // authoring margin (4.4 / 5.29)
const RUN = TUNE.speedRun;
const SPRINT = TUNE.speedSprint;
const MAX_STEP = TUNE.stepUp;
const PLAYER_R = TUNE.radius;

// ── jump-pad envelope ─────────────────────────────────────────────────────────
// A PAD IS NOT A JUMP. controller.js `_applyBounce` sets vel.y = sqrt(2*gravFall*power)
// and raises `_bounceRise`, and `_gravity` then integrates the RISE at gravFall too
// (controller.js: `const g = vel.y > 0 ? (this._bounceRise ? T.gravFall : T.gravRise)`).
// So both halves of a bounce arc run at gravFall — computing the rise at gravRise
// overstates the flight time, and therefore the reach, by ~26%.
//
// The arc is also FIXED: the pad adds nothing horizontal, so the only variable is the
// speed you carried onto it. The old test ("can the pad throw me AT LEAST this far")
// is meaningless for a fixed arc — what matters is whether the parabola ENDS on the
// target. WALK is the slowest credible entry (a player who strolled on), SPRINT the
// fastest; HELD is the +25% apex for holding jump on the contact frame
// (BOUNCE_HELD_BONUS), which stretches the flight and therefore the landing.
const WALK = 6.0;
const HELD = 1.25;

/** Flight time of a bounce arc of apex `power` down to a surface `dy` above the pad. */
function padFlight(power, dy) {
  return Math.sqrt(2 * power / TUNE.gravFall) + Math.sqrt(2 * (power - dy) / TUNE.gravFall);
}

/**
 * Horizontal [near, far] distance from a pad's LAUNCH POINT to a target rect,
 * measured along the pad -> target direction. The pad fires on first contact, i.e.
 * one player radius short of the pad edge the player crosses, not at its centre.
 */
function padSpan(a, b) {
  const acx = (a.x0 + a.x1) / 2, acz = (a.z0 + a.z1) / 2;
  const bcx = (b.x0 + b.x1) / 2, bcz = (b.z0 + b.z1) / 2;
  let ux = bcx - acx, uz = bcz - acz;
  const ul = Math.hypot(ux, uz);
  if (ul < 1e-6) return [0, 0];
  ux /= ul; uz /= ul;
  // The player runs ONTO the pad, so the bounce fires at the pad's TRAILING edge —
  // the first face their capsule touches — one radius before it, not at the centre
  // and certainly not at the far lip.
  let launch = Infinity;
  for (const cx of [a.x0, a.x1]) {
    for (const cz of [a.z0, a.z1]) {
      const d = cx * ux + cz * uz;
      if (d < launch) launch = d;
    }
  }
  launch -= PLAYER_R;
  let lo = Infinity, hi = -Infinity;
  for (const cx of [b.x0, b.x1]) {
    for (const cz of [b.z0, b.z1]) {
      const d = cx * ux + cz * uz - launch;
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
  }
  return [Math.max(0, lo), Math.max(0, hi)];
}

// ── surface extraction ────────────────────────────────────────────────────────
const LANDABLE = new Set(['platform', 'beam', 'mover', 'vanish', 'ice', 'conveyor',
  'jumppad', 'speedpad', 'sticky', 'crusher', 'elevator']);
const HAZARD_KINDS = new Set(['mover', 'vanish', 'rotor', 'pendulum', 'crusher', 'laser',
  'lava', 'risinglava', 'spikes', 'jumppad', 'speedpad', 'conveyor', 'ice', 'wind', 'chase', 'saw']);

const v3 = (a, d = 0) => (Array.isArray(a) ? [+a[0] || 0, +a[1] || 0, +a[2] || 0] : [d, d, d]);

/** A landable rectangle: x/z extents plus the top surface height. */
function rectsFor(o, i) {
  if (!LANDABLE.has(o.kind)) return [];
  const p = v3(o.p);
  const s = v3(o.s, 1);
  const half = [Math.abs(s[0]) / 2 || 0.5, Math.abs(s[1]) / 2 || 0.25, Math.abs(s[2]) / 2 || 0.5];
  // a rotated slab is approximated by its AABB (conservative for reach: it can only
  // make a gap look SMALLER, so we also shrink by the rotation error below)
  let ex = half[0], ez = half[2], shrink = 0;
  if (o.rot && (o.rot[1] || o.rot[0] || o.rot[2])) {
    const c = Math.abs(Math.cos(o.rot[1] || 0)), sn = Math.abs(Math.sin(o.rot[1] || 0));
    ex = half[0] * c + half[2] * sn;
    ez = half[2] * c + half[0] * sn;
    shrink = 0.25;
  }
  const mk = (cx, cy, cz, tag) => ({
    id: `${i}:${o.kind}${tag || ''}`, kind: o.kind, idx: i,
    x0: cx - ex + shrink, x1: cx + ex - shrink,
    z0: cz - ez + shrink, z1: cz + ez - shrink,
    y: cy + half[1],
    moving: o.kind === 'mover' || o.kind === 'crusher' || o.kind === 'elevator',
    vanishing: o.kind === 'vanish',
    pad: o.kind === 'jumppad' ? (o.power || 0) : 0,
  });
  const out = [mk(p[0], p[1], p[2])];
  // a mover is landable at BOTH ends of its travel
  if (o.kind === 'mover' && o.motion) {
    const m = o.motion;
    if (m.to) out.push(mk(...v3(m.to), '@to'));
    if (m.type === 'circle' || m.type === 'orbit') {
      const r = m.radius || 0, ax = (m.axis || 'y');
      if (ax === 'y') {
        out.push(mk(p[0] + r, p[1], p[2], '@+r'), mk(p[0] - r, p[1], p[2], '@-r'),
                 mk(p[0], p[1], p[2] + r, '@+t'), mk(p[0], p[1], p[2] - r, '@-t'));
      } else {
        out.push(mk(p[0], p[1] + r, p[2], '@up'), mk(p[0], p[1] - r, p[2], '@dn'));
      }
    }
    if (m.type === 'oscillate' && m.axis) {
      const a = v3(m.axis), amp = m.amp ?? m.radius ?? 2;
      out.push(mk(p[0] + a[0] * amp, p[1] + a[1] * amp, p[2] + a[2] * amp, '@+o'));
      out.push(mk(p[0] - a[0] * amp, p[1] - a[1] * amp, p[2] - a[2] * amp, '@-o'));
    }
    if (m.type === 'elevator' || m.type === 'sink') {
      const t = m.to ? v3(m.to) : [p[0], p[1] + (m.travel || 4), p[2]];
      out.push(mk(t[0], t[1], t[2], '@lift'));
    }
  }
  return out;
}

/** Horizontal gap between two rectangles (0 when they overlap). */
function gap(a, b) {
  const dx = Math.max(0, Math.max(a.x0 - b.x1, b.x0 - a.x1));
  const dz = Math.max(0, Math.max(a.z0 - b.z1, b.z0 - a.z1));
  return Math.hypot(dx, dz);
}

/** Can a player get from surface a to surface b? Returns the cheapest means or null. */
function edge(a, b) {
  const d = gap(a, b);
  const dy = b.y - a.y;
  if (d < 0.001 && Math.abs(dy) <= MAX_STEP) return { how: 'step', d, dy, cost: 0 };
  // a jump pad throws you far higher than a normal jump — but on a FIXED arc
  if (a.pad > 0) {
    const padApex = a.pad;
    if (dy < padApex - 0.05) {
      const tMin = padFlight(padApex, dy);
      const held = padApex * HELD;
      const tMax = dy < held - 0.05 ? padFlight(held, dy) : tMin;
      const dLo = WALK * tMin, dHi = SPRINT * tMax;
      const span = padSpan(a, b);
      if (dHi >= span[0] && dLo <= span[1]) {
        return { how: 'pad', d, dy, cost: 1, band: [dLo, dHi], span, pad: padApex };
      }
    }
  }
  const runFall = maxFallDist(RUN, dy);
  if (runFall > 0 && d <= runFall * SAFE) return { how: 'walkoff', d, dy, cost: 1 };
  const runJump = maxJumpDist(RUN, dy);
  if (runJump > 0 && d <= runJump * SAFE) return { how: 'run', d, dy, cost: 2 };
  if (runJump > 0 && d <= runJump) return { how: 'run-tight', d, dy, cost: 4 };
  const sprintJump = maxJumpDist(SPRINT, dy);
  if (sprintJump > 0 && d <= sprintJump * SAFE) return { how: 'sprint', d, dy, cost: 6 };
  if (sprintJump > 0 && d <= sprintJump) return { how: 'sprint-tight', d, dy, cost: 9 };
  return null;
}

function nearestSurface(rects, p, maxDist = 4.5) {
  let best = null, bd = 1e9;
  for (const r of rects) {
    const cx = Math.min(Math.max(p[0], r.x0), r.x1);
    const cz = Math.min(Math.max(p[2], r.z0), r.z1);
    const d = Math.hypot(p[0] - cx, p[2] - cz) + Math.abs(p[1] - r.y) * 0.6;
    if (d < bd) { bd = d; best = r; }
  }
  return bd <= maxDist ? best : null;
}

// ── per-stage analysis ────────────────────────────────────────────────────────
function analyse(def) {
  const objs = def.objects || [];
  const rects = [];
  for (let i = 0; i < objs.length; i++) rects.push(...rectsFor(objs[i], i));

  const problems = [], warnings = [];
  if (!rects.length) problems.push('stage has NO landable surfaces');

  // build the graph
  const adj = new Map(rects.map((r) => [r.id, []]));
  let tight = 0;
  for (const a of rects) {
    for (const b of rects) {
      if (a === b) continue;
      if (Math.abs(a.x1 - b.x0) > 30 && Math.abs(b.x1 - a.x0) > 30) continue; // far apart in X
      const e = edge(a, b);
      if (e) {
        adj.get(a.id).push({ to: b.id, ...e });
        if (e.how.endsWith('-tight')) tight++;
      }
    }
  }

  // A MOVER CARRIES YOU (CONTRACT §12: moving-platform carry). Its poses are
  // therefore joined to each other by simply standing still, which is why a lift
  // or an orbiting deck is a legitimate route and not just two disconnected
  // rectangles. Riding costs a little because it costs TIME.
  const poses = new Map();
  for (const r of rects) {
    if (!r.moving) continue;
    if (!poses.has(r.idx)) poses.set(r.idx, []);
    poses.get(r.idx).push(r);
  }
  for (const group of poses.values()) {
    for (const a of group) {
      for (const b of group) {
        if (a === b) continue;
        adj.get(a.id).push({ to: b.id, how: 'ride', d: 0, dy: b.y - a.y, cost: 2 });
      }
    }
  }

  // waypoints: spawn -> checkpoints -> finish
  const way = [];
  const sp = nearestSurface(rects, v3(def.spawn && def.spawn.p), 6);
  if (!sp) problems.push(`spawn ${JSON.stringify(def.spawn && def.spawn.p)} is not above any landable surface`);
  else way.push({ name: 'spawn', r: sp });
  (def.checkpoints || []).forEach((c, i) => {
    const r = nearestSurface(rects, v3(c.p), 6);
    if (!r) problems.push(`checkpoint ${i} at ${JSON.stringify(c.p)} is not above any landable surface`);
    else way.push({ name: `cp${i}`, r });
  });
  const fin = nearestSurface(rects, v3(def.finish && def.finish.p), 6);
  if (!fin) problems.push(`finish ${JSON.stringify(def.finish && def.finish.p)} is not above any landable surface`);
  else way.push({ name: 'finish', r: fin });

  // CHEAPEST route for each leg, not the fewest hops. A hop-count search reports the
  // hardest jump on the route with the fewest jumps, which is the opposite of what a
  // player does: it prefers one 7 m sprint-tight leap over three comfortable hops and
  // then warns about the leap the stage never asked for. Dijkstra over `cost` answers
  // the question the gate is actually asking — is there a route inside the envelope —
  // and `hardest` then means "the hardest jump on the EASIEST route".
  const bfs = (fromId, toId) => {
    const dist = new Map([[fromId, 0]]);
    const prev = new Map();
    const done = new Set();
    while (true) {
      let cur = null, best = Infinity;
      for (const [id, d] of dist) { if (!done.has(id) && d < best) { best = d; cur = id; } }
      if (cur === null) break;
      if (cur === toId) {
        const path = [];
        for (let n = toId; prev.has(n); ) { const e = prev.get(n); path.push(e); n = e.from; }
        return path.reverse();
      }
      done.add(cur);
      for (const e of adj.get(cur) || []) {
        if (done.has(e.to)) continue;
        const nd = best + e.cost + 0.01;               // +0.01 so a shorter chain still wins ties
        if (nd < (dist.has(e.to) ? dist.get(e.to) : Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, { ...e, from: cur });
        }
      }
    }
    return null;
  };
  const legs = [];
  for (let i = 0; i + 1 < way.length; i++) {
    const path = bfs(way[i].r.id, way[i + 1].r.id);
    if (!path) {
      problems.push(`UNREACHABLE: no jump path from ${way[i].name} (${way[i].r.id}) to ${way[i + 1].name} (${way[i + 1].r.id})`);
    } else {
      const worst = path.reduce((m, e) => (e.cost > m.cost ? e : m), path[0] || { cost: 0 });
      legs.push({ from: way[i].name, to: way[i + 1].name, hops: path.length,
                  hardest: worst && worst.how, hardestGap: worst && +(worst.d || 0).toFixed(2) });
      for (const e of path) {
        if (e.how === 'sprint-tight' || e.how === 'run-tight') {
          warnings.push(`${way[i].name}->${way[i + 1].name}: a ${e.how} jump of ${e.d.toFixed(2)} m (dy ${e.dy.toFixed(2)}) sits outside the safe envelope`);
        }
        // A pad arc is fixed; the deck it lands on must swallow the WHOLE entry-speed
        // band or a hesitant (or a sprinting) player is thrown into the void.
        if (e.how === 'pad' && e.band) {
          if (e.band[0] < e.span[0] - 1e-3) {
            warnings.push(`${way[i].name}->${way[i + 1].name}: pad apex ${e.pad} lands a walk-speed entry ${(e.span[0] - e.band[0]).toFixed(2)} m SHORT of the deck`);
          }
          if (e.band[1] > e.span[1] + 1e-3) {
            warnings.push(`${way[i].name}->${way[i + 1].name}: pad apex ${e.pad} throws a sprint entry ${(e.band[1] - e.span[1]).toFixed(2)} m PAST the deck`);
          }
        }
      }
    }
  }

  // orphan surfaces (nothing can reach them) — usually a typo, sometimes a coin ledge
  const reachedFromSpawn = new Set();
  if (sp) {
    const q = [sp.id]; reachedFromSpawn.add(sp.id);
    while (q.length) {
      const c = q.shift();
      for (const e of adj.get(c) || []) if (!reachedFromSpawn.has(e.to)) { reachedFromSpawn.add(e.to); q.push(e.to); }
    }
  }
  const orphans = rects.filter((r) => !reachedFromSpawn.has(r.id));

  // coins should be reachable too
  (def.coins || []).forEach((c, i) => {
    const p = v3(c.p);
    const near = rects.some((r) => {
      const cx = Math.min(Math.max(p[0], r.x0), r.x1);
      const cz = Math.min(Math.max(p[2], r.z0), r.z1);
      return reachedFromSpawn.has(r.id) && Math.hypot(p[0] - cx, p[2] - cz) < 3.2 && p[1] - r.y < 3.4 && p[1] - r.y > -1.5;
    });
    if (!near) warnings.push(`coin ${i} at ${JSON.stringify(c.p)} is not within a jump of any reachable surface`);
  });

  // shape metrics
  const xs = rects.map((r) => (r.x0 + r.x1) / 2);
  const length = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const kinds = {};
  for (const o of objs) kinds[o.kind] = (kinds[o.kind] || 0) + 1;
  const hazardCount = objs.filter((o) => HAZARD_KINDS.has(o.kind)).length;
  const obstacleCount = objs.filter((o) => o.kind !== 'deco' && o.kind !== 'light' && o.kind !== 'text').length;
  const cpXs = (def.checkpoints || []).map((c) => v3(c.p)[0]).sort((a, b) => a - b);
  const cpSpacing = cpXs.slice(1).map((x, i) => +(x - cpXs[i]).toFixed(1));

  // content floor — a stage must actually be a stage
  const isHub = def.id === 'hub';
  if (!isHub) {
    if (obstacleCount < 40) problems.push(`only ${obstacleCount} gameplay objects — a stage needs >= 40`);
    if (length < 120) problems.push(`stage is only ${length.toFixed(0)} m long — needs >= 120 m of travel`);
    if ((def.checkpoints || []).length < 3) problems.push(`only ${(def.checkpoints || []).length} checkpoints — needs >= 3`);
    if (hazardCount < 8) warnings.push(`only ${hazardCount} dynamic hazards`);
    const distinct = Object.keys(kinds).filter((k) => HAZARD_KINDS.has(k)).length;
    if (distinct < 3) warnings.push(`only ${distinct} distinct hazard families — risks feeling copy-paste`);
    for (const sp2 of cpSpacing) if (sp2 > 90) warnings.push(`a ${sp2} m gap between checkpoints — a death there costs too much`);
  }

  return {
    id: def.id, name: def.name, world: def.world, difficulty: def.difficulty,
    surfaces: rects.length, objects: objs.length, obstacleCount, hazardCount,
    lengthM: +length.toFixed(1), checkpoints: (def.checkpoints || []).length,
    cpSpacing, coins: (def.coins || []).length, kinds,
    tightEdges: tight, orphanSurfaces: orphans.length,
    orphanSample: orphans.slice(0, 6).map((o) => o.id),
    legs, problems, warnings,
    pass: problems.length === 0,
  };
}

// ── run ───────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let jsonOut = null;
const wantIdx = argv.indexOf('--json');
if (wantIdx >= 0) { jsonOut = argv[wantIdx + 1]; argv.splice(wantIdx, 2); }

let files;
try {
  files = readdirSync(STAGE_DIR).filter((f) => f.endsWith('.js'));
} catch {
  console.error(`no stage directory at ${STAGE_DIR}`);
  process.exit(2);
}
if (argv.length) files = files.filter((f) => argv.includes(f.replace(/\.js$/, '')));

const reports = [];
for (const f of files.sort()) {
  let def;
  try {
    def = (await import(pathToFileURL(join(STAGE_DIR, f)).href)).default;
  } catch (e) {
    reports.push({ id: f, pass: false, problems: [`import failed: ${e.message}`], warnings: [] });
    continue;
  }
  try {
    reports.push(analyse(def));
  } catch (e) {
    reports.push({ id: def && def.id || f, pass: false, problems: [`analysis crashed: ${e.stack}`], warnings: [] });
  }
}

console.log(`\nASCENDANT reach check — apex ${APEX.toFixed(2)} m, airtime ${(T_RISE + Math.sqrt(2 * APEX / TUNE.gravFall)).toFixed(3)} s`);
console.log(`run gap max ${maxJumpDist(RUN, 0).toFixed(2)} m (safe ${(maxJumpDist(RUN, 0) * SAFE).toFixed(2)}), sprint ${maxJumpDist(SPRINT, 0).toFixed(2)} m\n`);
console.log('id            len   obj  haz  cp  surf  orph  status');
console.log('-'.repeat(72));
let failing = 0;
for (const r of reports) {
  if (!r.pass) failing++;
  console.log(
    `${String(r.id).padEnd(13)} ${String(r.lengthM ?? '-').padStart(5)} ${String(r.obstacleCount ?? '-').padStart(4)} ` +
    `${String(r.hazardCount ?? '-').padStart(4)} ${String(r.checkpoints ?? '-').padStart(3)} ` +
    `${String(r.surfaces ?? '-').padStart(5)} ${String(r.orphanSurfaces ?? '-').padStart(5)}  ${r.pass ? 'PASS' : 'FAIL'}`
  );
  for (const p of r.problems || []) console.log(`    X  ${p}`);
  for (const w of (r.warnings || []).slice(0, 8)) console.log(`    ~  ${w}`);
}
console.log('-'.repeat(72));
console.log(`${reports.length} stages, ${failing} failing\n`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(reports, null, 2));
process.exit(failing ? 1 : 0);
