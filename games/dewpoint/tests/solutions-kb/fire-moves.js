// Moves a keyboard player makes again and again in the Fire levels, built only on tests/lib/keyboard.js (W/A/S/D, Space,
// 1-4, R, with human timing). Nothing here touches the sim: every helper is a few key changes and some looking.
//
// The one idea that keeps these robust under input jitter: a person lines up STANDING STILL (goTo), then does a
// rehearsed move whose key changes are timed from the FIRST press, not from what is on screen. A constant shift of
// every reaction moves the whole rehearsed move in time but not in space; only the first press is a reaction.
//
// What a keyboard cannot do (and every helper here lives with): move at less than full speed, or change a key sooner
// than 0.15 s after the last change. So a stop is only good to about +-0.9 m of where the person aimed (a reaction is
// 0.15 s +-0.15 s, and an ember covers 6.2 m/s), and a correction tap moves about a metre. Tolerances below are the
// real tolerance of the task, never tighter than that.

export const by = (list, id) => list.find((q) => q.id === id);
export const form = (k, f) => (k.p.form === f ? k : k.form(f));

/**
 * A rehearsed leap from where Cinder stands: press `keys` (reaction), Space `run` s later (with `extra` keys added in the
 * same press and let go `extraFor` s later), let go of Space `hold` s after the Space press, then any planned key changes in the air `air: [[after, keys], ...]`
 * (each `after` s behind the one before) and finally let go of everything `release` s after the first press.
 * Returns once the last change is made (so Cinder is in the air); follow with k.land().
 */
export function leap(k, keys, { run = 0.15, hold = 0.45, release = null, extra = null, extraFor = 0.15, air = [] } = {}) {
  k.hold(keys);
  let t = run;
  if (extra) {
    // Space and the extra key go down together; the extra key comes up `extraFor` s later, Space when `hold` has passed
    k.hold(`${keys} Space ${extra}`, { after: run });
    k.hold(`${keys} Space`, { after: extraFor });
    k.hold(keys, { after: Math.max(0.15, hold - extraFor) });
    t += extraFor + Math.max(0.15, hold - extraFor);
  } else {
    k.jump({ after: run, hold });
    t += hold;
  }
  for (const [after, spec] of air) { k.hold(spec, { after }); t += after; }
  if (release !== null) k.release({ after: Math.max(0, release - t) });
  return k;
}

/** A rehearsed hop that lets go of the keys while still in the air, so Cinder lands nearly still. */
export function hop(k, keys, { run = 0.15, hold = 0.45, extra = null } = {}) {
  leap(k, keys, { run, hold, release: run + hold + 0.15, extra });
  return k.land().settle();
}

/**
 * Line up on the spot where a hop works (found by trying it from every spot of the platform: tests/solutions-kb notes),
 * do the rehearsed hop, and check where Cinder came down. h: { at: [x, z], keys ('W'), run, extra, extraFor, hold }.
 */
export function hopFrom(k, h, check, label = 'landed where it should') {
  if (h.at && !(process.env.KB_NOCHAIN && h.chain)) go(k, h.at[0], h.at[1], h.tol || 0.6, { order: h.order, fine: h.fine });
  leap(k, h.keys || 'W', { run: h.run ?? 0.15, hold: h.hold ?? 0.45, extra: h.extra || null, extraFor: h.extraFor ?? 0.15, release: (h.run ?? 0.15) + (h.hold ?? 0.45) + 0.15 });
  k.land().settle();
  return k.expect(check, label);
}

/**
 * A hop from standing still in one direction: the direction key and Space go down together, the direction key comes up
 * `tap` s later (the sideways speed it gave is kept in the air), Space `hold` s after the press. Lands nearly still.
 */
export function hopTap(k, dir, { tap = 0.15, hold = 0.45 } = {}) {
  k.hold(`${dir} Space`);
  k.hold('Space', { after: tap });
  k.hold('', { after: Math.max(0.15, hold - tap) });
  return k.land().settle();
}

/** Wait until the drop of drip `id` has just landed, so the column is clear for most of a period. */
export function afterDrop(k, id) {
  return k.until((s) => by(s.level.drips, id).live, { timeout: 8, label: `${id} lets go a drop` })
    .until((s) => !by(s.level.drips, id).live, { timeout: 8, label: `${id} drop lands` });
}

/** The finest tolerance the keyboard model promises for the form Cinder is in now (half of the smallest key step). */
export const minTol = (k) => k.tapDistance(0.15) / 2 + 0.01;

/**
 * Walk to (x, z) the way a person lines up: stop within `tol` of it on each axis (0.6 m; never finer than the smallest
 * key step allows for the form: see minTol). When the stop is still more than `fine` (0.45 m) off, one more look with
 * a few short taps tries to do better, and gives up quietly (the task's own check decides whether it was good enough).
 * opts: { order: 'xz' | 'zx', fine }.
 */
export function go(k, x, z, tol = 0.6, opts = {}) {
  const { fine = 0.45, ...rest } = opts;
  const lo = minTol(k);
  k.goTo(x, z, { tol: Math.max(tol, lo), ...rest });
  if (fine > 0 && !k.sim.completed && Math.max(Math.abs(x - k.p.x), Math.abs(z - k.p.z)) > Math.max(fine, lo)) {
    const d0 = k.sim.deaths;
    try { k.goTo(x, z, { ...rest, tol: Math.max(fine, lo), maxLegs: 3 }); } catch (e) { if (k.sim.deaths > d0) throw e; /* no closer than a tap allows */ }
  }
  return k;
}

/**
 * Walk up to something that must be touched (a lantern, a fuse's end) and look whether it took; if not, step closer,
 * as a person would. `done(sim)` says whether it worked. Fails (with the usual report) after `tries` goes.
 */
export function touch(k, x, z, done, { tol = 0.6, tries = 3, order, label = 'it took' } = {}) {
  go(k, x, z, tol, { order });
  for (let i = 1; i < tries && !done(k.sim); i++) {
    const d0 = k.sim.deaths;
    try { k.goTo(x, z, { order, tol: Math.max(0.45, minTol(k)), maxLegs: 3 }); } catch (e) { if (k.sim.deaths > d0) throw e; /* could not line up any closer: look again */ }
  }
  return k.expect(done, label);
}

/** Try `fn` (up to `tries` times) until `ok(sim, player)` says it worked, as a person who sees it did not work tries again. */
export function attempt(k, fn, ok, { tries = 3, label = 'it worked' } = {}) {
  for (let i = 0; i < tries; i++) { fn(i); if (ok(k.sim, k.p)) return k; }
  return k.expect(ok, label);
}

/**
 * A stretch that starts at a checkpoint (a brazier): run `fn`; if Cinder dies in it (the game wakes it at the checkpoint),
 * a person tries again, up to `k.retryBudget` goes in all (1 by default: no second chance, the first death fails the run).
 * `k.retries` counts the deaths that were retried.
 */
export function section(k, label, fn) {
  const budget = k.retryBudget || Number(process.env.KB_RETRY) || 1;
  for (let i = 1; ; i++) {
    const d0 = k.sim.deaths;
    try { fn(i); return k; } catch (e) {
      if (k.sim.deaths <= d0 || i >= budget) throw e;
      k.retries = (k.retries || 0) + 1;
      (k.retryLog = k.retryLog || []).push(label);
      k.release();
    }
  }
}

/**
 * Get a spark onto a post (a socket, or the start of a wire): line up, look whether it took (`done(sim, player)`: the
 * signal is on, the ride has begun), and if not line up again, up to `tries` times. A post asks for the spark within about
 * 0.4 m, and a spark moves 1.5 m with the shortest tap: a person gets there by trying.
 * opts: { tries (5), hold (seconds to stay once it took, for a socket on a timer), label }
 */
export function sitOn(k, x, z, done, { tries = 5, label = 'on the post' } = {}) {
  for (let i = 0; i < tries * 3 && !done(k.sim, k.p); i++) {
    const d0 = k.sim.deaths;
    try { k.goTo(x, z, { tol: Math.max(0.3, minTol(k) + 0.001), maxLegs: 1 }); } catch (e) { if (k.sim.deaths > d0) throw e; }
    k.wait(0.1);                                                        // one look per move: a post that took is not walked off again
  }
  return k.expect(done, label);
}
