/**
 * Enemy locomotion pathing — the industry-standard three-tier stack for
 * open-field mobs on a dune heightfield: steering + local avoidance every
 * frame, with a budgeted grid-A* fallback for the rare genuine stall. There
 * is deliberately NO navmesh: the map is an open heightfield whose only
 * obstacles are steep dune faces, the shrine, and the pack itself.
 *
 *   Tier 1 — SLOPE-AWARE STEERING. Before a unit commits to a step it probes
 *     `terrain.heightAt` a body-length ahead along the intended direction.
 *     A climb steeper than CLIMB_MAX deflects the step along the contour,
 *     with a COMMITTED turn side (held ≥ CONTOUR_HOLD_S) so the unit walks
 *     around the face instead of dithering at its foot.
 *   Tier 2 — SEPARATION. Pack members repel inside a personal radius, an
 *     O(n²) pass over live units (n ≤ 24) computed once per frame into
 *     preallocated fields. It is a STEERING INPUT mixed into the desired
 *     direction — never a position write — so the standoff/reach logic in
 *     enemies.js keeps full authority over when a unit stops.
 *   Tier 3 — BUDGETED LOCAL A*. A unit that wanted to move but covered
 *     < STALL_DIST over STALL_WINDOW_S requests a path: A* over a 24×24
 *     grid of 2 m cells centred between unit and target, cost = distance ×
 *     (1 + grade penalty), edges impassable above CLIMB_MAX (directional —
 *     downhill is always walkable). The raw cell path is string-pulled by a
 *     line-of-walk test into few waypoints. ONE search per frame across all
 *     units (round-robin), ≥ REPATH_S between searches per unit. Most
 *     frames it never runs.
 *
 * CLIMB_MAX calibration (qa_pathfinding.py scan, 2026-08-12): the player's
 * walk mode has no grade clamp at all (controller.js slope handling exists
 * only in SURF via slopeAssist), so the limit is a design constant, not a
 * parity copy. The map's grade histogram peaks at 0.1–0.3 rise/run with a
 * max of 1.23; 0.62 sits in the owner band (0.55–0.7) and is exceeded by
 * real dune faces, so the tier actually engages.
 *
 * UNREACHABLE-CHEESE GUARD: when a search proves NO passable route exists
 * (the player is on ground only reachable across a >CLIMB_MAX face), the
 * unit gets DESPERATION_S of slope-limit immunity and grinds straight up —
 * ugly beats unreachable. The player can climb anything, so enemies must
 * never be cheesable by standing where A* has no answer.
 *
 * Zero allocation on the frame path: every array, heap and scratch below is
 * preallocated at construction; no Math.random anywhere (deterministic under
 * the harnesses).
 */

/** Max climbable rise/run for enemy locomotion. See calibration note above. */
export const CLIMB_MAX = 0.62;

// ------------------------------------------------------------- tier 1: slope
/** Probe distance ahead of the body, m — roughly one body length. */
const LOOK_AHEAD = 1.8;
/** Side-probe angle (rad) used to pick the cheaper contour side. */
const SIDE_ANGLE = 0.7;
/** Rotation ladder tried on the committed side, then mirrored. */
const STEP_ANGLES = [0.55, 1.05, 1.55, 2.05];
/** Seconds a chosen contour side is held before it may flip (anti-dither). */
const CONTOUR_HOLD_S = 1.0;

// -------------------------------------------------------- tier 2: separation
/** Personal radius = (rA + rB) × SEP_MULT, floored at SEP_MIN_R (m). The
 *  floor exists because two imps are 0.7 m of capsule — bare ×1.4 settles
 *  them at 0.98 m, which still reads as a blob on screen. */
const SEP_MULT = 1.4;
const SEP_MIN_R = 2.0;
/** Separation weight vs the unit desired direction (which has length 1). */
const SEP_W = 1.2;

// ------------------------------------------------------------- tier 3: A*
const STALL_WINDOW_S = 1.2;
const STALL_DIST = 0.5;
/** Min seconds between searches for one unit. */
const REPATH_S = 1.5;
/** A path older than this is dropped; the stall detector re-queues if needed. */
const PATH_TTL_S = 4.0;
/** Waypoint arrival radius, m. */
const WP_ARRIVE = 1.4;
/** Within this of the target the path is dropped — direct steering resumes. */
const PATH_DROP_NEAR = 6.0;
/** Slope-limit immunity after a provably unreachable target, s. */
const DESPERATION_S = 3.0;

const GRID = 24;               // cells per side
const CELL = 2;                // m per cell
const CELLS = GRID * GRID;     // 576
const MAX_WP = 16;
/** Edge cost multiplier: dist × (1 + GRADE_COST × (up/CLIMB_MAX)²). */
const GRADE_COST = 3;
/** Line-of-walk sampling step for string pulling, m. */
const LOW_STEP = 1.0;

export class Pathing {
    /**
     * @param {{heightAt(x:number,z:number):number}} terrain
     * @param {{stReturn:number, max:number}} cfg enemies.js hands over its
     *        ST_RETURN id (to route stalled returners home, not at the
     *        player) and its pool size. No enemies.js import — no cycle.
     */
    constructor(terrain, cfg) {
        this.terrain = terrain;
        this._stReturn = cfg.stReturn;
        const N = cfg.max;
        this._N = N;

        /** steer() output — read immediately by the caller. */
        this.outX = 0;
        this.outZ = 0;

        // ---- per-slot state (all preallocated) ----
        this.sepX = new Float32Array(N);
        this.sepZ = new Float32Array(N);
        this._stallT = new Float32Array(N);
        this._winX = new Float32Array(N);
        this._winZ = new Float32Array(N);
        this._moved = new Uint8Array(N);      // steered this frame (gap detect)
        this._repathCd = new Float32Array(N);
        this._despT = new Float32Array(N);
        this._contourDir = new Int8Array(N);
        this._contourT = new Float32Array(N);
        this._wantPath = new Uint8Array(N);
        this._pathLen = new Uint8Array(N);
        this._pathIdx = new Uint8Array(N);
        this._pathAge = new Float32Array(N);
        this._pathX = new Float32Array(N * MAX_WP);
        this._pathZ = new Float32Array(N * MAX_WP);

        // ---- A* scratch ----
        this._gh = new Float32Array(CELLS);        // cell-centre heights
        this._gG = new Float32Array(CELLS);        // g-score
        this._gF = new Float32Array(CELLS);        // f-score
        this._gCame = new Int16Array(CELLS);
        this._gState = new Uint8Array(CELLS);      // 0 new / 1 open / 2 closed
        this._heap = new Int16Array(CELLS);
        this._heapN = 0;
        this._cellPath = new Int16Array(CELLS);
        this._rr = 0;                              // round-robin cursor
    }

    /**
     * Once per enemies.update, BEFORE the brains run: timers, the O(n²)
     * separation field, and at most ONE queued A* search (round-robin).
     * @param {import("./enemies.js").Enemies} en
     * @param {number} dt seconds, caller guarantees > 0
     */
    beginFrame(en, dt) {
        const N = this._N;

        // Timers + gap detection: a slot that did not steer last frame is
        // standing by choice (attacking, guarding) — its stall window resets
        // so an attack pause can never read as a terrain stall.
        for (let i = 0; i < N; i++) {
            this.sepX[i] = 0;
            this.sepZ[i] = 0;
            if (!en.alive[i]) continue;
            if (this._repathCd[i] > 0) this._repathCd[i] -= dt;
            if (this._despT[i] > 0) this._despT[i] -= dt;
            if (this._contourT[i] > 0) this._contourT[i] -= dt;
            else this._contourDir[i] = 0;
            if (this._pathLen[i] > 0) {
                this._pathAge[i] += dt;
                if (this._pathAge[i] > PATH_TTL_S) this._pathLen[i] = 0;
            }
            if (!this._moved[i]) {
                this._stallT[i] = 0;
                this._winX[i] = en.x[i];
                this._winZ[i] = en.z[i];
            }
            this._moved[i] = 0;
        }

        // Separation field — live pairs only, symmetric push.
        for (let i = 0; i < N; i++) {
            if (!en.alive[i]) continue;
            const ui = en.units[en.unitOf[i]];
            for (let j = i + 1; j < N; j++) {
                if (!en.alive[j]) continue;
                const dx = en.x[j] - en.x[i];
                const dz = en.z[j] - en.z[i];
                const r = Math.max(
                    (ui.radius + en.units[en.unitOf[j]].radius) * SEP_MULT,
                    SEP_MIN_R);
                const d2 = dx * dx + dz * dz;
                if (d2 >= r * r || d2 < 1e-6) continue;
                const d = Math.sqrt(d2);
                const w = (r - d) / (r * d);       // (1 − d/r) on the unit vec
                this.sepX[i] -= dx * w; this.sepZ[i] -= dz * w;
                this.sepX[j] += dx * w; this.sepZ[j] += dz * w;
            }
        }

        // One search per frame, round-robin over requesters.
        for (let k = 0; k < N; k++) {
            const i = (this._rr + k) % N;
            if (!en.alive[i] || !this._wantPath[i]) continue;
            if (this._repathCd[i] > 0) { this._wantPath[i] = 0; continue; }
            this._wantPath[i] = 0;
            this._repathCd[i] = REPATH_S;
            this._search(en, i);
            this._rr = (i + 1) % N;
            break;
        }
    }

    /**
     * Adjust one unit's desired locomotion direction. Called from
     * enemies._move with the unit-length intent (mx, mz); the result lands
     * in this.outX/outZ (unit length, or 0,0 when fully blocked). Feeds
     * direction ONLY — the caller keeps speed, state and position writes.
     * @param {import("./enemies.js").Enemies} en
     * @param {number} i slot @param {number} mx @param {number} mz
     * @param {number} dt
     */
    steer(en, i, mx, mz, dt) {
        let dx = mx, dz = mz;
        if (dx === 0 && dz === 0) { this.outX = 0; this.outZ = 0; return; }
        const x = en.x[i], z = en.z[i];

        // ---- tier 3 follow: an active path overrides the intent ----------
        const tgtPlayer = en.state[i] !== this._stReturn;
        const tx = tgtPlayer ? en.controller.position.x : en.homeX[i];
        const tz = tgtPlayer ? en.controller.position.z : en.homeZ[i];
        if (this._pathLen[i] > 0) {
            const tdx = tx - x, tdz = tz - z;
            if (tdx * tdx + tdz * tdz < PATH_DROP_NEAR * PATH_DROP_NEAR) {
                this._pathLen[i] = 0;              // close enough — go direct
            } else {
                let wp = this._pathIdx[i];
                let wx = this._pathX[i * MAX_WP + wp];
                let wz = this._pathZ[i * MAX_WP + wp];
                let wdx = wx - x, wdz = wz - z;
                if (wdx * wdx + wdz * wdz < WP_ARRIVE * WP_ARRIVE) {
                    wp = ++this._pathIdx[i];
                    if (wp >= this._pathLen[i]) {
                        this._pathLen[i] = 0;      // path exhausted
                    } else {
                        wx = this._pathX[i * MAX_WP + wp];
                        wz = this._pathZ[i * MAX_WP + wp];
                        wdx = wx - x; wdz = wz - z;
                    }
                }
                if (this._pathLen[i] > 0) {
                    const wl = Math.sqrt(wdx * wdx + wdz * wdz) || 1;
                    dx = wdx / wl; dz = wdz / wl;
                }
            }
        }

        // ---- tier 2: separation is a steering input ----------------------
        const sx = this.sepX[i], sz = this.sepZ[i];
        if (sx !== 0 || sz !== 0) {
            dx += sx * SEP_W;
            dz += sz * SEP_W;
            const l = Math.sqrt(dx * dx + dz * dz);
            if (l > 1e-4) { dx /= l; dz /= l; }
            else { dx = mx; dz = mz; }             // exact cancel: keep intent
        }

        // ---- tier 1: slope gate on the FINAL direction -------------------
        if (this._despT[i] <= 0) {
            const h0 = this.terrain.heightAt(x, z);
            if (this._climb(x, z, h0, dx, dz) > CLIMB_MAX) {
                // Pick (or keep) the committed contour side.
                let side = this._contourDir[i];
                if (side === 0) {
                    const cs = Math.cos(SIDE_ANGLE), sn = Math.sin(SIDE_ANGLE);
                    const gl = this._climb(x, z, h0,
                        dx * cs - dz * sn, dz * cs + dx * sn);
                    const gr = this._climb(x, z, h0,
                        dx * cs + dz * sn, dz * cs - dx * sn);
                    side = gl <= gr ? 1 : -1;      // +1 = CCW (left)
                    this._contourDir[i] = side;
                }
                this._contourT[i] = CONTOUR_HOLD_S;
                let ok = false;
                for (let pass = 0; pass < 2 && !ok; pass++) {
                    const s = pass === 0 ? side : -side;
                    for (let a = 0; a < STEP_ANGLES.length; a++) {
                        const ang = STEP_ANGLES[a] * s;
                        const cs = Math.cos(ang), sn = Math.sin(ang);
                        const rx = dx * cs - dz * sn;
                        const rz = dz * cs + dx * sn;
                        if (this._climb(x, z, h0, rx, rz) <= CLIMB_MAX) {
                            dx = rx; dz = rz; ok = true;
                            break;
                        }
                    }
                }
                if (!ok) { dx = 0; dz = 0; }       // boxed in — stall tier 3
            }
        }

        // ---- stall detection (wants to move, isn't) ----------------------
        this._moved[i] = 1;
        this._stallT[i] += dt;
        if (this._stallT[i] >= STALL_WINDOW_S) {
            const px = x - this._winX[i], pz = z - this._winZ[i];
            if (px * px + pz * pz < STALL_DIST * STALL_DIST &&
                this._pathLen[i] === 0 && this._repathCd[i] <= 0) {
                this._wantPath[i] = 1;
            }
            this._stallT[i] = 0;
            this._winX[i] = x;
            this._winZ[i] = z;
        }

        this.outX = dx;
        this.outZ = dz;
    }

    /**
     * Separation for a unit STANDING at reach (between swings). The radial
     * axis belongs to the reach/standoff logic, so the separation field is
     * offered CLAMPED to the stand band: the outward component is zeroed at
     * `maxDist` (just inside the walk-in threshold — the unit never exits
     * the band and never re-triggers the approach branch) and the inward
     * component is zeroed at `minDist` (no hugging the player). Tangential
     * spread is always free — this is what un-stacks two token-holders that
     * arrived on the same bearing, and un-nests radial pairs.
     * outX/outZ = unit drift direction; returns the clamped field magnitude
     * (0 under the dead-zone — micro-jitter is worse than contact).
     * @param {import("./enemies.js").Enemies} en @param {number} i
     * @param {number} ux @param {number} uz unit vector toward the player
     * @param {number} dist current distance to the player
     * @param {number} minDist @param {number} maxDist stand-band bounds
     * @returns {number}
     */
    standDrift(en, i, ux, uz, dist, minDist, maxDist) {
        let sx = this.sepX[i], sz = this.sepZ[i];
        // rad > 0 = the field pushes toward the player (dist would shrink).
        const rad = sx * ux + sz * uz;
        if (rad < 0 && dist >= maxDist) { sx -= rad * ux; sz -= rad * uz; }
        if (dist < minDist) {
            // Nested below the stand ring: shed the inward part and seek
            // back out to the ring — a unit buried inside the pack surfaces
            // instead of sitting in tangential equilibrium at the player's
            // feet (its neighbours are all further out, so its raw field
            // points inward forever).
            if (rad > 0) { sx -= rad * ux; sz -= rad * uz; }
            const k = (minDist - dist) / minDist;
            sx -= ux * k;
            sz -= uz * k;
        }
        const m = Math.sqrt(sx * sx + sz * sz);
        if (m < 0.12) { this.outX = 0; this.outZ = 0; return 0; }
        this.outX = sx / m;
        this.outZ = sz / m;
        return m;
    }

    /** Rise/run of the step LOOK_AHEAD along (dx,dz) from height h0. */
    _climb(x, z, h0, dx, dz) {
        return (this.terrain.heightAt(x + dx * LOOK_AHEAD, z + dz * LOOK_AHEAD)
            - h0) / LOOK_AHEAD;
    }

    // ------------------------------------------------------------------ A*

    /**
     * One bounded search for slot i: unit → its current target, on a GRID²
     * patch centred between them. Directional edges (up-grade only blocks),
     * best-effort partial path when the goal cell is out of reach, waypoint
     * string pulling by line-of-walk. Preallocated scratch throughout.
     */
    _search(en, i) {
        const T = this.terrain;
        const x = en.x[i], z = en.z[i];
        const tgtPlayer = en.state[i] !== this._stReturn;
        const tx = tgtPlayer ? en.controller.position.x : en.homeX[i];
        const tz = tgtPlayer ? en.controller.position.z : en.homeZ[i];

        const ox = (x + tx) * 0.5 - (GRID / 2 - 0.5) * CELL;
        const oz = (z + tz) * 0.5 - (GRID / 2 - 0.5) * CELL;
        const gh = this._gh;
        for (let cz = 0; cz < GRID; cz++) {
            for (let cx = 0; cx < GRID; cx++) {
                gh[cz * GRID + cx] = T.heightAt(ox + cx * CELL, oz + cz * CELL);
            }
        }

        const cellOf = (wx, wz) => {
            const cx = Math.max(0, Math.min(GRID - 1, Math.round((wx - ox) / CELL)));
            const cz = Math.max(0, Math.min(GRID - 1, Math.round((wz - oz) / CELL)));
            return cz * GRID + cx;
        };
        const start = cellOf(x, z);
        const goal = cellOf(tx, tz);
        if (start === goal) return;

        const gG = this._gG, gF = this._gF, came = this._gCame, st = this._gState;
        st.fill(0);
        came.fill(-1);
        this._heapN = 0;
        const gx0 = goal % GRID, gz0 = (goal - gx0) / GRID;
        const hOf = (c) => {
            const cx = c % GRID, cz = (c - cx) / GRID;
            const ddx = cx - gx0, ddz = cz - gz0;
            return CELL * Math.sqrt(ddx * ddx + ddz * ddz);
        };

        gG[start] = 0;
        gF[start] = hOf(start);
        this._hpush(start, gF);
        st[start] = 1;
        let best = start, bestH = hOf(start), reached = false;

        while (this._heapN > 0) {
            const c = this._hpop(gF);
            if (c === goal) { reached = true; best = goal; break; }
            st[c] = 2;
            const hc = hOf(c);
            if (hc < bestH) { bestH = hc; best = c; }
            const cx = c % GRID, cz = (c - cx) / GRID;
            for (let dj = -1; dj <= 1; dj++) {
                for (let di = -1; di <= 1; di++) {
                    if (di === 0 && dj === 0) continue;
                    const nx = cx + di, nz = cz + dj;
                    if (nx < 0 || nx >= GRID || nz < 0 || nz >= GRID) continue;
                    const n = nz * GRID + nx;
                    if (st[n] === 2) continue;
                    const d = CELL * (di !== 0 && dj !== 0 ? 1.4142135 : 1);
                    const up = (gh[n] - gh[c]) / d;
                    if (up > CLIMB_MAX) continue;          // un-climbable edge
                    const gr = up > 0 ? up / CLIMB_MAX : 0;
                    const cost = d * (1 + GRADE_COST * gr * gr);
                    const ng = gG[c] + cost;
                    if (st[n] === 1 && ng >= gG[n]) continue;
                    gG[n] = ng;
                    gF[n] = ng + hOf(n);
                    came[n] = c;
                    if (st[n] !== 1) { this._hpush(n, gF); st[n] = 1; }
                    else this._hup(n, gF);                 // decrease-key
                }
            }
        }

        if (!reached && best === start) {
            // Provably boxed in: nothing but the start is reachable toward
            // the target. Desperation: ignore the slope limit briefly.
            if (tgtPlayer) this._despT[i] = DESPERATION_S;
            this._pathLen[i] = 0;
            return;
        }

        // Reconstruct backwards into scratch, then string-pull forward.
        let n = 0, c = best;
        while (c >= 0 && n < CELLS) { this._cellPath[n++] = c; c = came[c]; }
        // cellPath[0..n-1] = best..start; walk it start→best.
        const wpBase = i * MAX_WP;
        let wCount = 0;
        let curX = x, curZ = z;
        let k = n - 2;                       // skip the start cell itself
        while (k >= 0 && wCount < MAX_WP) {
            // furthest cell on the remaining path with a clear line-of-walk
            let pick = k;
            for (let j = 0; j >= 0 && j <= k; j++) {
                const cc = this._cellPath[j];
                const wx = ox + (cc % GRID) * CELL;
                const wz = oz + ((cc - cc % GRID) / GRID) * CELL;
                if (this._lineOfWalk(curX, curZ, wx, wz)) { pick = j; break; }
            }
            const cc = this._cellPath[pick];
            const wx = ox + (cc % GRID) * CELL;
            const wz = oz + ((cc - cc % GRID) / GRID) * CELL;
            this._pathX[wpBase + wCount] = wx;
            this._pathZ[wpBase + wCount] = wz;
            wCount++;
            curX = wx; curZ = wz;
            k = pick - 1;
        }
        this._pathLen[i] = wCount;
        this._pathIdx[i] = 0;
        this._pathAge[i] = 0;
    }

    /** Every LOW_STEP m step along a→b climbs ≤ CLIMB_MAX. */
    _lineOfWalk(ax, az, bx, bz) {
        const T = this.terrain;
        const dx = bx - ax, dz = bz - az;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < 1e-3) return true;
        const ns = Math.max(1, Math.ceil(d / LOW_STEP));
        const sl = d / ns;
        let h0 = T.heightAt(ax, az);
        for (let s = 1; s <= ns; s++) {
            const t = s / ns;
            const h1 = T.heightAt(ax + dx * t, az + dz * t);
            if ((h1 - h0) / sl > CLIMB_MAX) return false;
            h0 = h1;
        }
        return true;
    }

    // ------------------------------------------------- binary heap (f-score)

    /** @param {number} c @param {Float32Array} f */
    _hpush(c, f) {
        const h = this._heap;
        let k = this._heapN++;
        h[k] = c;
        while (k > 0) {
            const p = (k - 1) >> 1;
            if (f[h[p]] <= f[h[k]]) break;
            const t = h[p]; h[p] = h[k]; h[k] = t;
            k = p;
        }
    }

    /** @param {Float32Array} f @returns {number} min-f cell */
    _hpop(f) {
        const h = this._heap;
        const top = h[0];
        const last = h[--this._heapN];
        if (this._heapN > 0) {
            h[0] = last;
            let k = 0;
            for (;;) {
                const l = 2 * k + 1, r = l + 1;
                let m = k;
                if (l < this._heapN && f[h[l]] < f[h[m]]) m = l;
                if (r < this._heapN && f[h[r]] < f[h[m]]) m = r;
                if (m === k) break;
                const t = h[m]; h[m] = h[k]; h[k] = t;
                k = m;
            }
        }
        return top;
    }

    /** Sift cell c up after a decrease-key. @param {number} c */
    _hup(c, f) {
        const h = this._heap;
        let k = -1;
        for (let j = 0; j < this._heapN; j++) {
            if (h[j] === c) { k = j; break; }
        }
        if (k < 0) return;
        while (k > 0) {
            const p = (k - 1) >> 1;
            if (f[h[p]] <= f[h[k]]) break;
            const t = h[p]; h[p] = h[k]; h[k] = t;
            k = p;
        }
    }
}
