// Helpers for Fire tests: a mini level whose hero is Cinder, and a few probes.
import { run, mini } from './mini.js';
import { play } from './play.js';

/** Runner on a flat-floor Fire level (60 x 20 floor, top at y = 0, spawn at the origin), settled. */
export function frun(pieces = [], extra = {}) { return run(pieces, { element: 'fire', ...extra }); }
export function fmini(pieces = [], extra = {}) { return mini(pieces, { element: 'fire', ...extra }); }

/** Place Cinder at (x, y, z) in `form` on a level (deaths allowed), let it settle for 0.3 s. */
export function at(level, x, y, z, form, gauge) {
  const r = play(level);
  r.allowDeath = true;
  r.sim.teleport(x, y, z);
  if (form) r.sim.forceForm(form);
  if (gauge !== undefined) r.p.gauge = gauge;
  r.wait(0.3);
  return r;
}

/** Hold a stick direction for `seconds` (jumping in bursts if asked), tracking the extremes reached. */
export function hold(r, mx, mz, seconds, { jump = false } = {}) {
  const ext = { minX: Infinity, maxX: -Infinity, maxY: -Infinity, minY: Infinity, minZ: Infinity, maxZ: -Infinity };
  const n = Math.round(seconds * 120);
  for (let i = 0; i < n; i++) {
    r.tick(mx, mz, jump && i % 70 < 30);
    const p = r.p;
    ext.minX = Math.min(ext.minX, p.x); ext.maxX = Math.max(ext.maxX, p.x);
    ext.minY = Math.min(ext.minY, p.y); ext.maxY = Math.max(ext.maxY, p.y);
    ext.minZ = Math.min(ext.minZ, p.z); ext.maxZ = Math.max(ext.maxZ, p.z);
  }
  return ext;
}
