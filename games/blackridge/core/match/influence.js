// core/match/influence.js [W2] — the spawn director's influence / danger grid.
// PVP_BUILD_PLAN Part 4.1 row W2; implements pvp_design §2.4 as adopted by
// arena.md §2.4–2.5 and arch §4.4/§4.6, under rulings C7/C8.
//
// THREE-free, deterministic, fixed-dt (GAME_DOCTRINE §4). Node-testable.
//
// Two layers over one 4 m cell grid spanning the arena AABB:
//   live — PRESENCE, rebuilt from scratch at every rebuild() (5 Hz, match
//          tick slot 8): each living actor deposits 1.0 (team-signed in team
//          mode, unsigned when perActor) with linear falloff to 0 at 25 m.
//   hist — HISTORY: kill/death deposits (±2.0 team, +2.0 perActor) that decay
//          with the whole grid at ×0.85 per second toward 0.
//
// Published surface (frozen, W2 row): makeInfluence(bounds, { perActor })
//   → { deposit, decay, at, spread }   (+ documented extras rebuild, snapshot)
//
//   deposit(pos, amount, team)  — history-layer deposit (kills/deaths).
//                                 team ignored when perActor (unsigned).
//   decay(dt)                   — ×0.85^dt on the history layer.
//   at(pos, forTeam)            — team mode: −1..+1 from forTeam's point of
//                                 view (own team positive). perActor: 0..1
//                                 unsigned hostile pressure.
//   spread(pos)                 — UNSIGNED (AC-12): 1/(1+v) over the unsigned
//                                 cell value — 1.0 where the map is empty,
//                                 → 0 as it heats. arena.md §2.5.3.
//   rebuild(actors, dt)         — decay(dt), then clear live and deposit
//                                 every living actor. actors: iterable of
//                                 {alive, team, pos:[3]}-likes.

const CELL = 4.0; // m — pvp_design §2.4
const FALLOFF_M = 25.0; // linear presence falloff
const DECAY_PER_S = 0.85; // whole-grid decay toward 0

export function makeInfluence(bounds, opts = {}) {
  const perActor = !!(opts && opts.perActor);
  const minX = bounds && bounds.min ? bounds.min[0] : -50;
  const minZ = bounds && bounds.min ? bounds.min[2] : -50;
  const maxX = bounds && bounds.max ? bounds.max[0] : 50;
  const maxZ = bounds && bounds.max ? bounds.max[2] : 50;
  const nx = Math.max(1, Math.ceil((maxX - minX) / CELL));
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / CELL));
  const live = new Float32Array(nx * nz);
  const hist = new Float32Array(nx * nz);

  function idx(pos) {
    let cx = ((pos[0] - minX) / CELL) | 0;
    let cz = ((pos[2] - minZ) / CELL) | 0;
    if (cx < 0) cx = 0; else if (cx >= nx) cx = nx - 1;
    if (cz < 0) cz = 0; else if (cz >= nz) cz = nz - 1;
    return cz * nx + cx;
  }

  // Splat `amount` (already signed) into `layer` with linear falloff to 0 at
  // FALLOFF_M. Bounded loop over the affected cell window only.
  function splat(layer, pos, amount) {
    const r = FALLOFF_M;
    const cx0 = Math.max(0, ((pos[0] - r - minX) / CELL) | 0);
    const cx1 = Math.min(nx - 1, ((pos[0] + r - minX) / CELL) | 0);
    const cz0 = Math.max(0, ((pos[2] - r - minZ) / CELL) | 0);
    const cz1 = Math.min(nz - 1, ((pos[2] + r - minZ) / CELL) | 0);
    for (let cz = cz0; cz <= cz1; cz++) {
      const zc = minZ + (cz + 0.5) * CELL;
      for (let cx = cx0; cx <= cx1; cx++) {
        const xc = minX + (cx + 0.5) * CELL;
        const dx = xc - pos[0], dz = zc - pos[2];
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d >= r) continue;
        layer[cz * nx + cx] += amount * (1 - d / r);
      }
    }
  }

  function signFor(team) {
    if (perActor) return 1; // unsigned danger map (modes §4.4, C8)
    return team === 0 ? 1 : -1; // team 0 positive by convention; at() re-signs
  }

  // History deposit — kills/deaths (±2.0). pvp_design §2.4.
  function deposit(pos, amount, team) {
    splat(hist, pos, Math.abs(amount) * signFor(team));
  }

  function decay(dt) {
    if (!(dt > 0)) return;
    const k = Math.pow(DECAY_PER_S, dt);
    for (let i = 0; i < hist.length; i++) hist[i] *= k;
  }

  // 5 Hz rebuild: decay history, clear presence, redeposit living actors.
  function rebuild(actors, dt) {
    decay(dt);
    live.fill(0);
    if (!actors) return;
    for (const a of actors) {
      if (!a || !a.alive) continue;
      const p = a.pos || (a.body && a.body.pos);
      if (!p) continue;
      splat(live, p, 1.0 * signFor(a.team));
    }
  }

  // Soft normalisation: v/(1+|v|) — monotone, bounded, no tuning constant.
  function norm(v) { return v / (1 + Math.abs(v)); }

  function raw(pos) { const i = idx(pos); return live[i] + hist[i]; }

  // Team mode: −1..+1 from forTeam's POV (own team positive).
  // perActor: 0..1 unsigned pressure.
  function at(pos, forTeam) {
    const v = norm(raw(pos));
    if (perActor) return Math.max(0, v);
    return forTeam === 0 || forTeam == null ? v : -v;
  }

  // UNSIGNED spread (AC-12): 1 where the map is cold, → 0 as it heats.
  // HISTORY layer only — C8: "crowd repulsion is instantaneous geometry,
  // spread is time-decayed HISTORY (deaths deposit +2.0, decay ×0.85/s)";
  // including live presence here would double-count ffaSafety, which C8
  // explicitly forbids. Magnitude of the cell so it is sign-free in both
  // grid variants.
  function spread(pos) {
    const v = Math.abs(hist[idx(pos)]);
    return 1 / (1 + v);
  }

  function snapshot() {
    return { perActor, nx, nz, cell: CELL, minX, minZ };
  }

  return { deposit, decay, at, spread, rebuild, snapshot };
}
