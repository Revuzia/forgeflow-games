// Ambient wildlife: purely decorative critters that wander the map, keep off
// the enemy road, and give each biome a bit of life. No gameplay interaction.
import * as THREE from 'three';
import { instantiate, getModel, resolveClip } from '../core/assets.js';
import { GRID_W, GRID_H, CELL, cellToWorld } from '../sim/path.js';
import { makeRng } from '../sim/rng.js';

export const CRITTER_FILES = ['deer', 'sheep', 'fox', 'snake', 'stag', 'crab', 'bfish', 'cat', 'frog'];

// Per-biome roster: model, tint, target height, count, float (hovers) flag.
const ROSTERS = [
  [ // forest — a living wood
    { model: 'deer', h: 1.7, count: 2 },
    { model: 'sheep', h: 1.0, count: 2 },
    { model: 'fox', h: 0.85, count: 2 },
  ],
  [ // volcanic — things that survive the heat
    { model: 'snake', h: 0.45, count: 3, tint: 0xa04828 },
    { model: 'frog', h: 0.7, count: 2, tint: 0xd94f1e },
    { model: 'crab', h: 0.65, count: 2, tint: 0x8a3020 },
  ],
  [ // tundra — white-coated cousins
    { model: 'stag', h: 1.8, count: 2, tint: 0xe8f0f8 },
    { model: 'fox', h: 0.85, count: 2, tint: 0xeef4fa },
    { model: 'sheep', h: 1.0, count: 2, tint: 0xf0f4f8 },
  ],
  [ // ruins — scavengers among the graves
    { model: 'cat', h: 0.7, count: 2, tint: 0x3a3a44 },
    { model: 'snake', h: 0.45, count: 2, tint: 0x6a7a6a },
    { model: 'frog', h: 0.65, count: 2, tint: 0x5a6a4a },
  ],
  [ // astral — strange drifting fauna
    { model: 'bfish', h: 0.8, count: 3, tint: 0xb89aff, float: true },
    { model: 'frog', h: 0.7, count: 3, tint: 0x8a6ee0 },
  ],
];

const normCache = new Map();
function normalization(model) {
  if (normCache.has(model)) return normCache.get(model);
  const entry = getModel(model);
  let out = { scale: 1, yOff: 0 };
  if (entry) {
    const box = new THREE.Box3().setFromObject(entry.scene);
    const h = Math.max(0.001, box.max.y - box.min.y);
    out = { scale: 1 / h, yOff: -box.min.y / h };
  }
  normCache.set(model, out);
  return out;
}

export function createCritters(scene, level) {
  const group = new THREE.Group();
  group.name = 'critters';
  scene.add(group);
  const rng = makeRng(level.seed ^ 0xC217);
  const roster = ROSTERS[level.bi] || ROSTERS[0];

  // valid wander points: on the grid, min 1.6u away from the road, off blocked cells
  const routePts = [];
  for (let d = 0; d < level.route.total; d += 1.5) {
    const { points, cum } = level.route;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
    const seg = cum[hi] - cum[lo] || 1;
    const t = (d - cum[lo]) / seg;
    routePts.push([points[lo][0] + (points[hi][0] - points[lo][0]) * t, points[lo][1] + (points[hi][1] - points[lo][1]) * t]);
  }
  const blocked = level.blocked.map(([cx, cy]) => cellToWorld(cx, cy));

  function roadDist(x, z) {
    let best = Infinity;
    for (const [px, pz] of routePts) {
      const d2 = (px - x) ** 2 + (pz - z) ** 2;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  }
  function nearestRoadPoint(x, z) {
    let best = Infinity, out = null;
    for (const [px, pz] of routePts) {
      const d2 = (px - x) ** 2 + (pz - z) ** 2;
      if (d2 < best) { best = d2; out = [px, pz]; }
    }
    return out;
  }
  function validPoint(clear = 1.9) {
    for (let tries = 0; tries < 40; tries++) {
      const x = (rng.next() - 0.5) * (GRID_W - 2) * CELL;
      const z = (rng.next() - 0.5) * (GRID_H - 2) * CELL;
      if (roadDist(x, z) < clear) continue;
      let ok = true;
      for (const b of blocked) {
        if ((b.x - x) ** 2 + (b.z - z) ** 2 < 1.5 * 1.5) { ok = false; break; }
      }
      if (ok) return { x, z };
    }
    return null;
  }
  // The straight walk between two valid points must ALSO stay off the road.
  function segmentClear(x1, z1, x2, z2, clear) {
    const d = Math.hypot(x2 - x1, z2 - z1);
    const steps = Math.max(2, Math.ceil(d / 0.7));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (roadDist(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t) < clear) return false;
    }
    return true;
  }

  const critters = [];
  for (const spec of roster) {
    for (let i = 0; i < spec.count; i++) {
      const inst = instantiate(spec.model, { tint: spec.tint ?? null });
      if (!inst) continue;
      const norm = normalization(spec.model);
      const root = new THREE.Group();
      inst.obj.scale.setScalar(norm.scale * spec.h);
      inst.obj.position.y = norm.yOff * spec.h;
      root.add(inst.obj);
      const clear = spec.h >= 1.5 ? 2.5 : 2.0; // big animals need more road clearance
      const start = validPoint(clear);
      if (!start) continue;
      root.position.set(start.x, spec.float ? 1.2 : 0, start.z);
      group.add(root);

      const mixer = new THREE.AnimationMixer(inst.obj);
      const walkClip = resolveClip(inst.animations, spec.float ? 'Swimming_Normal' : 'Walk', 'move');
      const idleClip = resolveClip(inst.animations, spec.float ? 'Swimming_Normal' : 'Idle', 'idle');
      const walk = walkClip ? mixer.clipAction(walkClip) : null;
      const idle = idleClip && idleClip !== walkClip ? mixer.clipAction(idleClip) : null;

      critters.push({
        root, mixer, walk, idle, spec, clear,
        state: 'idle', stateT: rng.range(0.5, 3),
        target: null, speed: rng.range(0.7, 1.3),
        phase: rng.next() * Math.PI * 2,
        current: null,
      });
    }
  }

  function setAnim(c, which) {
    if (c.current === which) return;
    c.current = which;
    const from = which === 'walk' ? c.idle : c.walk;
    const to = which === 'walk' ? c.walk : (c.idle || c.walk);
    if (from && from !== to) from.fadeOut(0.25);
    if (to) { to.reset().fadeIn(0.25).play(); }
    if (!c.idle && which === 'idle' && c.walk) c.walk.paused = true;
    if (c.walk && which === 'walk') c.walk.paused = false;
  }

  return {
    group,
    update(dt, t) {
      for (const c of critters) {
        c.stateT -= dt;
        if (c.state === 'idle') {
          setAnim(c, 'idle');
          if (c.stateT <= 0) {
            // target AND the straight walk to it must stay off the road
            const p = validPoint(c.clear);
            if (p && segmentClear(c.root.position.x, c.root.position.z, p.x, p.z, c.clear)) {
              c.target = p; c.state = 'walk';
            }
            c.stateT = rng.range(2, 5);
          }
        } else if (c.state === 'walk' && c.target) {
          setAnim(c, 'walk');
          const dx = c.target.x - c.root.position.x;
          const dz = c.target.z - c.root.position.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.25 || c.stateT <= -8) {
            c.state = 'idle';
            c.stateT = rng.range(1.5, 6);
          } else {
            const want = Math.atan2(dx, dz);
            let cur = c.root.rotation.y;
            let diff = ((want - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
            c.root.rotation.y = cur + diff * Math.min(1, dt * 4);
            c.root.position.x += (dx / d) * c.speed * dt;
            c.root.position.z += (dz / d) * c.speed * dt;
          }
        }
        // hard guarantee: if anything still drifts toward the road, shove it back and rethink
        const near = nearestRoadPoint(c.root.position.x, c.root.position.z);
        if (near) {
          const rdx = c.root.position.x - near[0];
          const rdz = c.root.position.z - near[1];
          const rd = Math.hypot(rdx, rdz);
          if (rd < c.clear * 0.85 && rd > 0.001) {
            const push = (c.clear * 0.85 - rd) + 0.05;
            c.root.position.x += (rdx / rd) * push;
            c.root.position.z += (rdz / rd) * push;
            c.state = 'idle';
            c.stateT = rng.range(0.5, 1.5);
            c.target = null;
          }
        }
        if (c.spec.float) {
          c.root.position.y = 1.2 + Math.sin(t * 1.8 + c.phase) * 0.25;
        }
        c.mixer.update(dt);
      }
    },
    dispose() { scene.remove(group); },
  };
}
