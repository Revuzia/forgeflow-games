// core/render/replay_buffer.js — view-side recording for the kill cam.
//
// WHAT THIS IS. A fixed-size ring of the last few seconds of the match, sampled
// at a fixed rate OFF THE SIM'S OWN STATE after it has ticked: every roster
// actor's body (position, facing, aim point, velocity, stance/anim/weapon,
// alive) plus the fire-time shot events, deaths and explosions, each stamped
// with sim time. core/render/killcam.js copies the ring into a frozen "clip"
// when a kill should be replayed and plays the clip back by driving the
// existing third-person soldier actors from it.
//
// WHY IT CANNOT TOUCH DETERMINISM. Nothing here is read by sim.step, written
// into sim.state, serialised or sent to a peer: the recorder only READS the
// state the 60 Hz lockstep already produced. The sim is never re-run.
//
// BUDGET. All storage is typed arrays allocated once at construction; record,
// copy and lookup allocate nothing per frame. The only growth is the string
// intern table (anim names, weapon ids, surfaces), which is bounded by the
// game's own vocabularies (a few dozen strings for a whole session).
// At the defaults (16 slots, 30 Hz, 6.6 s, 1024 shots, 128 events) one buffer
// is ~0.27 MB; the kill cam keeps three (live ring + two clips) ≈ 0.8 MB.
//
// DOM-free and THREE-free on purpose: core/render/replay_buffer.selftest.cjs
// runs it under plain node.

// ---- actor sample layout (floats per slot per sample) ------------------------
export const A = {
  X: 0, Y: 1, Z: 2, YAW: 3, PITCH: 4, VX: 5, VZ: 6, AX: 7, AY: 8, AZ: 9,
  FLAGS: 10, WEAPON: 11, ANIM: 12, PRESENT: 13,
  STRIDE: 14,
};
export const F = {
  ALIVE: 1, CROUCH: 2, GROUNDED: 4, RELOAD: 8, READY: 16, HAS_AIM: 32,
};
// ---- shot layout ---------------------------------------------------------------
export const S = {
  T: 0, SLOT: 1, OX: 2, OY: 3, OZ: 4, DX: 5, DY: 6, DZ: 7,
  HAS_HIT: 8, HX: 9, HY: 10, HZ: 11, NX: 12, NY: 13, NZ: 14,
  SURF: 15, ENTITY: 16, WEAPON: 17, FLAGS: 18, PELLET: 19,
  STRIDE: 20,
};
export const SF = { TRACER: 1, FIRST: 2, HEAD: 4 };
// ---- event layout (deaths, explosions) ---------------------------------------
export const E = {
  T: 0, KIND: 1, A: 2, B: 3, X: 4, Y: 5, Z: 6, R: 7, HEAD: 8, AUX: 9,
  STRIDE: 10,
};
export const EK = { DEATH: 1, EXPLOSION: 2 };

// Shared, append-only string table. One per kill cam (all buffers share it, so a
// copied clip's indices stay valid). Index 0 is the empty string.
export function createInterner() {
  const list = [""];
  const map = new Map([["", 0]]);
  return {
    id(s) {
      if (s == null) return 0;
      const k = typeof s === "string" ? s : String(s);
      let i = map.get(k);
      if (i === undefined) { i = list.length; list.push(k); map.set(k, i); }
      return i;
    },
    str(i) { return list[i | 0] || ""; },
    get size() { return list.length; },
  };
}

function wrapPi(a) {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

export function createReplayBuffer(opts = {}) {
  const slots = opts.slots | 0 || 16;
  const hz = opts.hz || 30;
  const seconds = opts.seconds || 6.6;
  const N = Math.ceil(hz * seconds) + 2;          // sample capacity
  const SHOTS = opts.shots | 0 || 1024;
  const EVENTS = opts.events | 0 || 128;
  const TELEPORT = opts.teleportM || 2.0;          // never lerp across a jump

  const times = new Float64Array(N);
  const act = new Float32Array(N * slots * A.STRIDE);
  const shots = new Float32Array(SHOTS * S.STRIDE);
  const evts = new Float32Array(EVENTS * E.STRIDE);

  // ring cursors (head = next write index; count = valid entries)
  let head = 0, count = 0;
  let sHead = 0, sCount = 0;
  let eHead = 0, eCount = 0;
  let cur = -1;          // sample being written (between begin/end)

  const buf = {
    slots, hz, N, SHOTS, EVENTS,
    get count() { return count; },
    get shotCount() { return sCount; },
    get eventCount() { return eCount; },
    bytes: times.byteLength + act.byteLength + shots.byteLength + evts.byteLength,

    clear() { head = count = sHead = sCount = eHead = eCount = 0; cur = -1; },

    // ---- time span -----------------------------------------------------------
    oldestT() { return count ? times[(head - count + N) % N] : NaN; },
    newestT() { return count ? times[(head - 1 + N) % N] : NaN; },

    // ---- recording -------------------------------------------------------------
    // beginSample(t) then writeActor() for each present slot. Slots not written
    // in a sample are marked absent (PRESENT 0).
    beginSample(t) {
      cur = head;
      times[cur] = t;
      const base = cur * slots * A.STRIDE;
      for (let s = 0; s < slots; s++) act[base + s * A.STRIDE + A.PRESENT] = 0;
      head = (head + 1) % N;
      if (count < N) count++;
      return cur;
    },
    writeActor(slot, x, y, z, yaw, pitch, vx, vz, ax, ay, az, flags, weaponIdx, animIdx) {
      if (cur < 0 || slot < 0 || slot >= slots) return;
      const o = (cur * slots + slot) * A.STRIDE;
      act[o] = x; act[o + 1] = y; act[o + 2] = z;
      act[o + 3] = yaw; act[o + 4] = pitch;
      act[o + 5] = vx; act[o + 6] = vz;
      act[o + 7] = ax; act[o + 8] = ay; act[o + 9] = az;
      act[o + 10] = flags; act[o + 11] = weaponIdx; act[o + 12] = animIdx;
      act[o + 13] = 1;
    },
    endSample() { cur = -1; },

    pushShot(t, slot, o, d, hit, nrm, surfIdx, entity, weaponIdx, flags, pellet) {
      const b = sHead * S.STRIDE;
      shots[b] = t; shots[b + 1] = slot;
      shots[b + 2] = o[0]; shots[b + 3] = o[1]; shots[b + 4] = o[2];
      shots[b + 5] = d[0]; shots[b + 6] = d[1]; shots[b + 7] = d[2];
      if (hit) {
        shots[b + 8] = 1;
        shots[b + 9] = hit[0]; shots[b + 10] = hit[1]; shots[b + 11] = hit[2];
        shots[b + 12] = nrm ? nrm[0] : 0; shots[b + 13] = nrm ? nrm[1] : 1; shots[b + 14] = nrm ? nrm[2] : 0;
      } else shots[b + 8] = 0;
      shots[b + 15] = surfIdx; shots[b + 16] = entity;
      shots[b + 17] = weaponIdx; shots[b + 18] = flags; shots[b + 19] = pellet;
      sHead = (sHead + 1) % SHOTS;
      if (sCount < SHOTS) sCount++;
    },

    pushEvent(t, kind, a, b, x, y, z, r, head_, aux) {
      const o = eHead * E.STRIDE;
      evts[o] = t; evts[o + 1] = kind; evts[o + 2] = a; evts[o + 3] = b;
      evts[o + 4] = x; evts[o + 5] = y; evts[o + 6] = z; evts[o + 7] = r;
      evts[o + 8] = head_; evts[o + 9] = aux;
      eHead = (eHead + 1) % EVENTS;
      if (eCount < EVENTS) eCount++;
    },

    // ---- snapshot ---------------------------------------------------------------
    // Freeze `src` into this buffer (same geometry required). TypedArray.set is
    // a memcpy: ~0.27 MB in well under a millisecond, and only on a kill.
    copyFrom(src) {
      const r = src._raw();
      if (r.N !== N || r.slots !== slots || r.SHOTS !== SHOTS || r.EVENTS !== EVENTS) {
        throw new Error("replay_buffer.copyFrom: geometry mismatch");
      }
      times.set(r.times); act.set(r.act); shots.set(r.shots); evts.set(r.evts);
      head = r.head; count = r.count; sHead = r.sHead; sCount = r.sCount;
      eHead = r.eHead; eCount = r.eCount; cur = -1;
    },
    _raw() {
      return { N, slots, SHOTS, EVENTS, times, act, shots, evts, head, count, sHead, sCount, eHead, eCount };
    },

    // ---- lookup -----------------------------------------------------------------
    // Bracketing samples for time t. Returns false when the buffer is empty.
    // out.i0/out.i1 are ring indices, out.k the lerp factor in [0,1]. Times
    // outside the recorded span clamp to the ends.
    locate(t, out) {
      if (!count) return false;
      const first = (head - count + N) % N;
      // binary search over logical positions 0..count-1 (times are monotonic)
      let lo = 0, hi = count - 1;
      if (t <= times[first]) { out.i0 = out.i1 = first; out.k = 0; return true; }
      const last = (first + count - 1) % N;
      if (t >= times[last]) { out.i0 = out.i1 = last; out.k = 0; return true; }
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (times[(first + mid) % N] <= t) lo = mid; else hi = mid;
      }
      const i0 = (first + lo) % N, i1 = (first + hi) % N;
      const t0 = times[i0], t1 = times[i1];
      out.i0 = i0; out.i1 = i1;
      out.k = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
      return true;
    },

    // Interpolated actor state for `slot` at the located bracket. Writes into
    // `out` (a reusable plain object). Returns false when the actor is absent
    // in BOTH bracketing samples. Discrete fields (flags/anim/weapon) come
    // from the EARLIER sample, so a death shows on the first sample that saw
    // it and never early.
    readActor(slot, loc, out) {
      const o0 = (loc.i0 * slots + slot) * A.STRIDE;
      const o1 = (loc.i1 * slots + slot) * A.STRIDE;
      const p0 = act[o0 + A.PRESENT] > 0, p1 = act[o1 + A.PRESENT] > 0;
      if (!p0 && !p1) return false;
      const a = p0 ? o0 : o1, b = p1 ? o1 : o0;
      let k = p0 && p1 ? loc.k : 0;
      const dx = act[b] - act[a], dy = act[b + 1] - act[a + 1], dz = act[b + 2] - act[a + 2];
      if (dx * dx + dy * dy + dz * dz > TELEPORT * TELEPORT) k = k < 0.5 ? 0 : 1; // respawn / teleport
      // aliveness changing between the two samples: hold the earlier body
      const fa = act[a + A.FLAGS], fb = act[b + A.FLAGS];
      if (((fa | 0) & F.ALIVE) !== ((fb | 0) & F.ALIVE)) k = 0;
      out.x = act[a] + dx * k;
      out.y = act[a + 1] + dy * k;
      out.z = act[a + 2] + dz * k;
      out.yaw = act[a + 3] + wrapPi(act[b + 3] - act[a + 3]) * k;
      out.pitch = act[a + 4] + (act[b + 4] - act[a + 4]) * k;
      out.vx = act[a + 5] + (act[b + 5] - act[a + 5]) * k;
      out.vz = act[a + 6] + (act[b + 6] - act[a + 6]) * k;
      const ha = ((fa | 0) & F.HAS_AIM) !== 0, hb = ((fb | 0) & F.HAS_AIM) !== 0;
      if (ha && hb) {
        out.ax = act[a + 7] + (act[b + 7] - act[a + 7]) * k;
        out.ay = act[a + 8] + (act[b + 8] - act[a + 8]) * k;
        out.az = act[a + 9] + (act[b + 9] - act[a + 9]) * k;
      } else if (ha) {
        out.ax = act[a + 7]; out.ay = act[a + 8]; out.az = act[a + 9];
      } else if (hb) {
        out.ax = act[b + 7]; out.ay = act[b + 8]; out.az = act[b + 9];
      }
      out.flags = (fa | 0) & ~F.HAS_AIM;
      if (ha || hb) out.flags |= F.HAS_AIM;
      out.weapon = act[a + A.WEAPON] | 0;
      out.anim = act[a + A.ANIM] | 0;
      return true;
    },

    // Raw sample access (selftest / diagnostics).
    sampleTime(i) { return times[i]; },

    // Iterate shots with t in (t0, t1]. cb(shotsArray, baseOffset). Oldest
    // first. No allocation.
    forShots(t0, t1, cb) {
      for (let n = 0; n < sCount; n++) {
        const i = (sHead - sCount + n + SHOTS) % SHOTS;
        const b = i * S.STRIDE;
        const t = shots[b];
        if (t > t0 && t <= t1) cb(shots, b);
      }
    },
    forEvents(t0, t1, cb) {
      for (let n = 0; n < eCount; n++) {
        const i = (eHead - eCount + n + EVENTS) % EVENTS;
        const b = i * E.STRIDE;
        const t = evts[b];
        if (t > t0 && t <= t1) cb(evts, b);
      }
    },
    // Latest event of `kind` (optionally matching a/b slots; -1 = any) at or
    // before tMax. Returns the base offset into the events array, or -1.
    findEvent(kind, a, b, tMax) {
      for (let n = eCount - 1; n >= 0; n--) {
        const i = (eHead - eCount + n + EVENTS) % EVENTS;
        const o = i * E.STRIDE;
        if (evts[o + 1] !== kind || evts[o] > tMax) continue;
        if (a >= 0 && evts[o + 2] !== a) continue;
        if (b >= 0 && evts[o + 3] !== b) continue;
        return o;
      }
      return -1;
    },
    events: evts,
  };
  return buf;
}
