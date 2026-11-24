// Helpers for Clay tests and scripts: a mini level whose hero is Dab, and the moves Dab has that
// the generic Runner (play.js) does not know about - climbing, hanging, being fired, shedding.
// LEVELS.md section 11.6 documents them for level authors.
import { run, mini } from './mini.js';
import { at, hold } from './fire.js';

export { at, hold };

/** Runner on a flat-floor Clay level (60 x 20 floor, top at y = 0, spawn at the origin), settled. */
export function crun(pieces = [], extra = {}) { return run(pieces, { element: 'clay', ...extra }); }
export function cmini(pieces = [], extra = {}) { return mini(pieces, { element: 'clay', ...extra }); }

/** Become `form` unless Dab is that form already (pressing the same button again would be a special). */
export function be(r, form) { if (r.p.form !== form) r.form(form); return r; }

const into = (r, x, z) => {
  const dx = x - r.p.x, dz = z - r.p.z, d = Math.hypot(dx, dz);
  return d > 1e-6 ? [dx / d, dz / d] : [0, 0];
};

/**
 * Walk into the rough wall in direction (mx, mz) - the stick pointing INTO the wall - take hold,
 * and climb until Dab stands on top (or `until(sim, p)` is true). Fails if Dab never takes hold,
 * or lets go before the top.
 */
export function climb(r, mx, mz, opts = {}) {
  const timeout = opts.timeout === undefined ? 8 : opts.timeout;
  const y0 = r.p.y;
  r.waitUntil((s, p) => !!p.climb, { mx, mz, timeout: opts.grabTimeout || 3, label: 'takes hold of the rough wall' });
  r.waitUntil((s, p) => (opts.until ? opts.until(s, p) : (!p.climb && p.grounded && p.y > y0 + 0.3)) || (!p.climb && !p.grounded && p.vy < -1), { mx, mz, timeout, label: 'climbs to the top' });
  if (!opts.until && !(r.p.grounded && r.p.y > y0 + 0.3)) r.fail('let go of the wall before the top');
  return r;
}

/** Jump at a rough wall in direction (mx, mz) and take hold of it in the air. */
export function jumpGrab(r, mx, mz, opts = {}) {
  r.tick(mx, mz, false);
  r.waitUntil((s, p) => !!p.climb, { mx, mz, jump: true, timeout: opts.timeout || 2, label: 'jumps and takes hold' });
  return r;
}

/** Jump up into a rough ceiling and hang from it. */
export function jumpHang(r, opts = {}) {
  r.tick(opts.mx || 0, opts.mz || 0, false);
  r.waitUntil((s, p) => p.climb && p.climb.mode === 'ceil', { mx: opts.mx || 0, mz: opts.mz || 0, jump: true, timeout: opts.timeout || 2, label: 'hangs from the ceiling' });
  return r;
}

/** While hanging, move under the rough ceiling toward (x, z); then let go (jump) unless opts.hold. */
export function hangTo(r, x, z, opts = {}) {
  r.waitUntil((s, p) => Math.hypot(p.x - x, p.z - z) < (opts.tol || 0.15), {
    toward: [x, z], timeout: opts.timeout || 8, label: `hangs across to (${x}, ${z})`,
  });
  if (!r.p.climb) r.fail('let go of the ceiling on the way');
  if (!opts.hold) { r.tick(0, 0, false); r.tick(0, 0, true); r.tick(0, 0, false); }
  return r;
}

/** Walk into a kiln heat zone at (x, z) and wait until Dab has been fired to stone. */
export function kiln(r, x, z, opts = {}) {
  r.waitUntil((s, p) => p.form === 'stone', { toward: [x, z], timeout: opts.timeout || 6, label: 'fired in the kiln heat' });
  return r;
}

/** Walk into water at (x, z) until Dab is soaked to `form` (slip, by default). */
export function soak(r, x, z, form = 'slip', opts = {}) {
  r.waitUntil((s, p) => p.form === form, { toward: [x, z], timeout: opts.timeout || 6, label: `soaked to ${form}` });
  return r;
}

/** The pack's grip gauge, 0..1. */
export const gripOf = (r) => r.p.grip;

export { into };
