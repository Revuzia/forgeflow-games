// CUT3 (PHYS): the BROAD PHASE and the BUDGET ACCOUNTANT for many bodies on the mat.
//
// `SoftBody.collide(others)` is pairwise: called for every body with every other body it costs n (n - 1) sphere tests (2,016 at 64 bodies), each of which measures a bound radius in O(particles).
// `ContactPlanner.run(bodies)` does the whole contact pass of one frame instead: it takes the bounding sphere of every body once (a sleeper's is measured once for good), finds the pairs
// of overlapping spheres by sort-and-sweep along x (the order of the previous frame is the start of the next sort: bodies move little in a frame, so the sort is almost free), skips every pair
// of two sleeping bodies, and calls `body.collide(its candidates)` for each AWAKE body only (a sleeping body pushes nothing: the awake bodies that reach it lean on it or wake it, see
// softbody.ts SLEEP). The candidates of a body are listed in the order of `bodies`, so for two bodies the calls are exactly those of the pairwise loop it replaces.
//
// THE CALL THE SHELL MAKES (src/shell/bodies.ts, step): one planner for the manager, `rebuildContacts()` keeps the list of the bodies that take part in contact (the bodies with a `collide`
// that are not ghosts: today's `all`), and the contact loop of step() becomes
//     if (contactBodies.length >= 2) { try { planner.run(contactBodies); } catch (e) { d.report(e); } }
// before `body.step(dt)` and the extras' steps, as before. Nothing is allocated per frame once the arrays have grown to the body count.
//
// THE ACCOUNTANT: `awakeParticles(bodies)` is the solver's cost of a frame in particles (0 for a sleeping body); the budget of CUT3.md section 3 is at most 3 x a whole body (about 1,900) for the
// awake set. `planner.stats` carries the numbers of the last run for the shell's debug hook and the harness.
import type { SoftBodyLike } from '../contracts.ts';
import { SoftBody } from './softbody.ts';

/** Extra radius (m) of every sphere: the bodies move between the snapshot of the planner and the moment `collide` looks at them. */
export const PLAN_MARGIN = 0.02;

/** The particles the solver steps for these bodies this frame: a sleeping piece costs none. A body that is not a SoftBody counts its vertexCount. */
export function awakeParticles(bodies: readonly SoftBodyLike[]): number {
  let n = 0;
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    n += b instanceof SoftBody ? b.awakeParticles : (b.vertexCount | 0);
  }
  return n;
}

export interface PlannerStats {
  /** bodies given to the last run, and how many of them were awake */
  bodies: number; awake: number;
  /** the particles of the awake bodies (the accountant), and of all of them */
  awakeParticles: number; allParticles: number;
  /** pairs of overlapping spheres that were handed to collide (each counted once), pairs skipped because both bodies sleep, and the pairs the pairwise loop would have tested */
  pairs: number; skippedAsleep: number; naivePairs: number;
  /** sphere tests the sweep itself made */
  tests: number;
}

export class ContactPlanner {
  readonly stats: PlannerStats = { bodies: 0, awake: 0, awakeParticles: 0, allParticles: 0, pairs: 0, skippedAsleep: 0, naivePairs: 0, tests: 0 };
  private cap = 0;
  private lastN = -1;
  private S = new Float64Array(0);        // per body: centre x, y, z, radius
  private key = new Float64Array(0);      // x - radius, the sort key
  private order = new Int32Array(0);      // body indices sorted by key (the previous frame's order is the next sort's start)
  private nb = new Int32Array(0);         // per body: its candidate indices, nbStride each
  private cnt = new Int32Array(0);
  private nbStride = 0;
  private soft = new Uint8Array(0);       // 1: a SoftBody
  private lists: SoftBodyLike[][] = [];
  private others: SoftBodyLike[] = [];

  private grow(n: number): void {
    if (n <= this.cap) return;
    const c = Math.max(8, n * 2);
    this.S = new Float64Array(c * 4); this.key = new Float64Array(c); this.cnt = new Int32Array(c); this.soft = new Uint8Array(c);
    this.order = new Int32Array(c); this.lastN = -1;
    this.nbStride = c; this.nb = new Int32Array(c * c);
    while (this.lists.length < c) this.lists.push([]);
    this.cap = c;
  }

  /** One frame of contact for `bodies`: plan the candidate pairs and call collide on every awake body. */
  run(bodies: readonly SoftBodyLike[]): void {
    const n = bodies.length, st = this.stats;
    this.grow(n);
    const S = this.S, key = this.key, order = this.order, cnt = this.cnt, soft = this.soft, nb = this.nb, stride = this.nbStride;
    let awake = 0, awakeP = 0, allP = 0;
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      cnt[i] = 0;
      if (b instanceof SoftBody) {
        soft[i] = 1; b.boundSphere(S, i * 4);
        S[i * 4 + 3] += PLAN_MARGIN;
        key[i] = S[i * 4] - S[i * 4 + 3];
        allP += b.vertexCount;
        if (!b.sleeping) { awake++; awakeP += b.vertexCount; }
      } else { soft[i] = 0; key[i] = -1e30; S[i * 4 + 3] = 0; allP += b.vertexCount | 0; awake++; awakeP += b.vertexCount | 0; }
    }
    // insertion sort of `order` by key: the order of the last frame is nearly right (a different body count starts from the identity)
    if (n !== this.lastN) { for (let k = 0; k < n; k++) order[k] = k; this.lastN = n; }
    for (let a = 1; a < n; a++) {
      const v = order[a], kv = key[v];
      let b = a - 1;
      while (b >= 0 && key[order[b]] > kv) { order[b + 1] = order[b]; b--; }
      order[b + 1] = v;
    }
    // sweep
    let tests = 0, pairs = 0, skipped = 0;
    for (let a = 0; a < n; a++) {
      const i = order[a];
      if (soft[i] === 0) continue;
      const xi = S[i * 4], yi = S[i * 4 + 1], zi = S[i * 4 + 2], ri = S[i * 4 + 3], xmax = xi + ri;
      const ai = !(bodies[i] as SoftBody).sleeping;
      for (let c = a + 1; c < n; c++) {
        const j = order[c];
        if (key[j] > xmax) break;
        if (soft[j] === 0) continue;
        tests++;
        const dx = S[j * 4] - xi, dy = S[j * 4 + 1] - yi, dz = S[j * 4 + 2] - zi, rr = ri + S[j * 4 + 3];
        if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
        const aj = !(bodies[j] as SoftBody).sleeping;
        if (!ai && !aj) { skipped++; continue; }
        pairs++;
        // (both directions, whoever sleeps now: a sleeper that an awake body wakes during this very pass is awake when its turn comes and then collides with its neighbours, as the pairwise loop does)
        nb[i * stride + cnt[i]++] = j;
        nb[j * stride + cnt[j]++] = i;
      }
    }
    // each awake body collides with its candidates, in the order of `bodies`
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (soft[i] === 0) { this.callOther(b, bodies, i); continue; }
      if ((b as SoftBody).sleeping) continue;
      const k = cnt[i], base = i * stride;
      for (let x = 1; x < k; x++) { const v = nb[base + x]; let y = x - 1; while (y >= 0 && nb[base + y] > v) { nb[base + y + 1] = nb[base + y]; y--; } nb[base + y + 1] = v; }
      const list = this.lists[i];
      list.length = 0;
      for (let x = 0; x < k; x++) list.push(bodies[nb[base + x]]);
      b.collide!(list);
    }
    st.bodies = n; st.awake = awake; st.awakeParticles = awakeP; st.allParticles = allP; st.pairs = pairs; st.skippedAsleep = skipped; st.naivePairs = (n * (n - 1)) / 2; st.tests = tests;
  }

  /** A body that is not a SoftBody (a mock, a proxy) that offers collide gets every other body, as before. */
  private callOther(b: SoftBodyLike, bodies: readonly SoftBodyLike[], i: number): void {
    if (typeof b.collide !== 'function') return;
    const list = this.others;
    list.length = 0;
    for (let k = 0; k < bodies.length; k++) if (k !== i) list.push(bodies[k]);
    b.collide(list);
  }
}
