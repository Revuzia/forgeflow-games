// core/match/spawns.js [W2] — THE SPAWN DIRECTOR.
// PVP_BUILD_PLAN Part 4.1 row W2. Implements arena.md §2.4–2.5, modes.md
// §4.3–4.4, architecture.md §4.2–4.6 under the binding rulings C7 (merged
// veto table + relaxation ladders + V10) and C8 (merged FFA score: crowd
// repulsion + unsigned spread grid). Owner amendments Part 10 apply.
//
// THREE-free, deterministic, fixed-dt (GAME_DOCTRINE §4). Node-testable.
// Nothing else in the repo may choose a spawn point (arch Part 4).
//
// Published surface (frozen, W2 row):
//   makeSpawns(arena, opts) → { pick(m, actor) → {pointId, pos, yaw, stress} }
//   SCORE_WEIGHTS.{team, ffa}   — one table, readable at a glance (C8)
//
// Documented extras (wiring for W1's match.js — see the hooks block below):
//   director.rebuild(m, dt)     — match tick slot 8, 5 Hz: influence rebuild,
//                                 flip rule, trap-window expiry.
//   director.noteDeath(m, ev)   — from match.onActorDeath: feeds V6, the
//                                 trap override, and the death deposits
//                                 (team ±2.0 / FFA spread +2.0).
//   director.noteExplosion(pos, t) — from the sim 'explosion' event: feeds V5.
//   director.snapshot()         — JSON-safe counters/state for probes.
//   director.influenceFor(modeId) — the live grid (probes only).
//
// pick() extra fields (additive, never breaking): `protectS` is 3.0 on the
// never-fail centroid fallback (C7: "spawn at the cluster centroid with 3.0 s
// protection instead of the mode default, and log it"), else null and the
// match applies the mode default. `fallback` is true on that path.

import { makeInfluence } from "./influence.js";
import { mulberry32 } from "../rng.js";

// ---------------------------------------------------------------------------
// C8 — both weight tables side by side. Weights are the tuning surface; the
// SHAPE is not (safety saturates; friendly term is a proximity term; FFA
// safety is crowd repulsion over ALL living actors, never single-nearest).
export const SCORE_WEIGHTS = {
  team: {
    safety: 40, safetySatM: 55,        // 40 * min(1, dNearestEnemy/55)
    friendly: 22, friendlySatM: 35,    // 22 * (1 - min(1, dNearestFriendly/35))
    influence: 18,                     // signed grid, spawner's team positive
    modeBias: 14,                      // mode.spawnBias(m, actor, p) 0..1
    cover: 10,
    recency: 20,                       // 1.0 if used <12 s ago → 0 at 24 s
    facing: 15, facingMaxM: 60,        // max over enemies ≤60 m of clamp0(cosθ)
    jitter: 6,
  },
  ffa: {
    safety: 55, safetyLenM: 18,        // 55 * ffaSafety(p) — crowd repulsion
    spread: 18,                        // 18 * spread(p) — unsigned history grid
    cover: 12,
    recency: 20,
    facing: 18, facingMaxM: 40,        // C8: beyond 40 m the term is noise
    clusterHeat: 8,                    // 1.0 if any spawn in p.cluster <3.0 s
    jitter: 6,
  },
};

// C7 — THE single merged veto table, binding.
export const VETOES = {
  team: { v1: 12.0, v2: 25.0, v3: 20.0, v4: 1.5, v5: 12.0, v6: 5.0, v6r: 8.0 },
  ffa:  { v1: 10.0, v2: 20.0, v3: 16.0, v4: 1.5, v5: 12.0, v6: 5.0, v6r: 8.0, v10: 3.0 },
  coneCos: Math.cos((35 * Math.PI) / 180), // V3 ±35°
  headY: 1.55,                             // V2 head height
  // Relaxation ladder targets (C7): team V2 25→15, V1 12→8; FFA V2 20→13, V1 10→7.
  relax: { team: { v2: 15.0, v1: 8.0 }, ffa: { v2: 13.0, v1: 7.0 } },
  // Trap-override widening: team pvp_design §2.4 / arch §4.4; FFA modes §4.4.
  widen: { team: { v1: 32.0, v2: 80.0 }, ffa: { v1: 26.0, v2: 60.0 }, forS: 20.0 },
};

// C8 crowd repulsion — exported for the selftest's worked-value assertions
// (one actor at 22 m → 0.772, three at 22 m → 0.530, one at 60 m → 0.965).
export function ffaSafety(dists, lenM = SCORE_WEIGHTS.ffa.safetyLenM) {
  let crowd = 0;
  for (let i = 0; i < dists.length; i++) crowd += Math.exp(-dists[i] / lenM);
  return 1 / (1 + crowd);
}

const RECENT_S = 12.0;   // AC-11 reuse window (soft veto, rung R below)
const RECENT_OUT_S = 24.0;
const TRAP_DIE_S = 6.0;  // died within 6 s of spawning...
const TRAP_DIE_M = 20.0; // ...and within 20 m of the spawn point
const TRAP_OF_LAST = 5, TRAP_MIN = 3;
const FLIP_MEAN = -0.35, FLIP_HOLD_S = 3.0, FLIP_HYST_S = 12.0;
const CLUSTER_BAN_S = 20.0; // FFA per-actor cluster ban (modes §4.4)

function d2h(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
function distH(a, b) { return Math.sqrt(d2h(a[0], a[2], b[0], b[2])); }

export function makeSpawns(arena, opts = {}) {
  const allPoints = (arena && arena.spawnPoints ? arena.spawnPoints : []).map((p) => ({
    id: p.id,
    pos: [p.pos[0], p.pos[1] || 0, p.pos[2]],
    yaw: p.yaw || 0,
    cluster: p.cluster || "SC_DEFAULT",
    cover: p.cover != null ? p.cover : 0.5,
    modes: p.modes || ["tdm", "ctf", "ffa"],
    lastUsedT: -1e9, lastUsedTeam: -1, lastUsedActor: -1,
  }));
  const bounds = (arena && arena.bounds) || boundsOf(allPoints);
  const clusters = {}; // id → {points:[], centroid:[3]}
  for (const p of allPoints) {
    (clusters[p.cluster] || (clusters[p.cluster] = { points: [], centroid: [0, 0, 0], lastSpawnT: -1e9, lastSpawnActor: -1 })).points.push(p);
  }
  for (const id in clusters) {
    const c = clusters[id];
    for (const p of c.points) { c.centroid[0] += p.pos[0]; c.centroid[1] += p.pos[1]; c.centroid[2] += p.pos[2]; }
    const n = c.points.length;
    c.centroid[0] /= n; c.centroid[1] /= n; c.centroid[2] /= n;
  }

  // Two grid variants; deaths deposit into both so either mode reads a warm
  // grid. Only the active mode's grid is rebuilt (presence) at 5 Hz.
  const gridTeam = makeInfluence(bounds, {});
  const gridFFA = makeInfluence(bounds, { perActor: true });

  const homeClusters = Object.assign({}, opts.homeClusters || null); // team → clusterId
  const lockModes = opts.lockModes || ["ctf"]; // modes.md §4.3.2

  const deathLog = [];      // {pos:[3], t, team, actorId}
  const explosions = [];    // {pos:[3], t}
  const teamState = {};     // team → state
  const actorState = {};    // actorId → state (FFA)
  const rebuildScratch = [];
  const counters = {
    picks: 0, stressSum: 0, centroidFalls: 0, v10Vetoes: 0,
    flips: 0, traps: 0, compromised: [], // {team|actorId, t} — HUD line source
  };
  const fallbackRng = mulberry32((opts.seed == null ? 1 : opts.seed) ^ 0x5b34c1e7);

  function teamStateOf(team) {
    return teamState[team] || (teamState[team] = {
      home: homeClusters[team] != null ? homeClusters[team] : null,
      prevHome: null, revertAtT: -1e9,
      lastFlipT: -1e9, widenUntil: -1e9, meanBad: [], spawnLog: [],
    });
  }
  function actorStateOf(id) {
    return actorState[id] || (actorState[id] = {
      lastCluster: null, banCluster: null, banUntil: -1e9, widenUntil: -1e9, spawnLog: [],
    });
  }

  // -- m facade accessors (contract: arch §1.6; tolerant so the selftest and
  //    W1's real facade both work) --------------------------------------------
  function mTime(m) { return m.time != null ? m.time : (m.sim && m.sim.state ? m.sim.state.time || 0 : 0); }
  function mActors(m) { return m.actors || (m.state && m.state.actors) || []; }
  function mPosOf(m, a) { return m.posOf ? m.posOf(a) : a.pos; }
  function mYawOf(m, a) {
    if (m.bodyOf) { const b = m.bodyOf(a); if (b && b.yaw != null) return b.yaw; }
    return a.yaw != null ? a.yaw : 0;
  }
  function mModeId(m) {
    return (m.state && m.state.modeId) || (m.mode && m.mode.id) || "tdm";
  }
  function mIsFFA(m) {
    return mModeId(m) === "ffa" || (m.mode && m.mode.teamCount === "perActor");
  }
  function mRng(m) {
    if (opts.rng) return opts.rng;
    if (m.rng) { if (typeof m.rng.spawn === "function") return m.rng.spawn; if (typeof m.rng === "function") return m.rng; }
    if (m.sim && m.sim.rng && typeof m.sim.rng.spawn === "function") return m.sim.rng.spawn;
    return fallbackRng;
  }
  function mLos(m) {
    if (m.world && m.world.losBlocked) return m.world.losBlocked;
    if (opts.losBlocked) return opts.losBlocked;
    return null; // no geometry → LOS treated as CLEAR (conservative: vetoes bite)
  }
  function mGrenades(m) {
    return (m.sim && m.sim.internal && m.sim.internal.grenades) || [];
  }

  function livingOthers(m, actor, enemiesOnly) {
    const out = [];
    const actors = mActors(m);
    const ffa = mIsFFA(m);
    for (const a of actors) {
      if (!a || a === actor || !a.alive) continue;
      if (a.actorId != null && actor.actorId != null && a.actorId === actor.actorId) continue;
      if (enemiesOnly && !ffa && a.team === actor.team) continue;
      if (enemiesOnly === false && (ffa || a.team !== actor.team)) continue; // friendlies only
      out.push(a);
    }
    return out;
  }

  // -- hooks -----------------------------------------------------------------
  function noteExplosion(pos, t) {
    explosions.push({ pos: [pos[0], pos[1] || 0, pos[2]], t });
    if (explosions.length > 32) explosions.shift();
  }

  function noteDeath(m, ev) {
    const t = ev.t != null ? ev.t : mTime(m);
    const actorId = ev.actor && ev.actor.actorId != null ? ev.actor.actorId : ev.actorId;
    const team = ev.team != null ? ev.team : (ev.actor ? ev.actor.team : 0);
    const pos = ev.pos || (ev.actor ? mPosOf(m, ev.actor) : null);
    if (!pos) return;
    deathLog.push({ pos: [pos[0], pos[1] || 0, pos[2]], t, team, actorId });
    if (deathLog.length > 64) deathLog.shift();
    // Death deposits: team grid ±2.0 (signed), FFA spread history +2.0 (C8).
    gridTeam.deposit(pos, 2.0, team);
    gridFFA.deposit(pos, 2.0, team);
    // Trap bookkeeping: was this death close (in time and space) to the
    // actor's own spawn?
    const ffa = mIsFFA(m);
    const log = ffa ? actorStateOf(actorId).spawnLog : teamStateOf(team).spawnLog;
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i].actorId !== actorId) continue;
      if (t - log[i].t <= TRAP_DIE_S && distH(pos, log[i].pos) <= TRAP_DIE_M) log[i].trapDeath = true;
      break; // most recent spawn of this actor only
    }
    evalTrap(m, ffa ? actorId : team, ffa, t);
  }

  function evalTrap(m, key, ffa, t) {
    const st = ffa ? actorStateOf(key) : teamStateOf(key);
    const last = st.spawnLog.slice(-TRAP_OF_LAST);
    if (last.length < TRAP_MIN) return;
    let traps = 0;
    for (const r of last) if (r.trapDeath) traps++;
    if (traps < TRAP_MIN) return;
    counters.traps++;
    st.spawnLog.length = 0; // consume the window — no immediate re-trigger
    st.widenUntil = t + VETOES.widen.forS;
    if (ffa) {
      // modes §4.4: ban that actor's current cluster for 20 s.
      st.banCluster = st.lastCluster;
      st.banUntil = t + CLUSTER_BAN_S;
      counters.compromised.push({ actorId: key, t });
    } else {
      // Immediate flip ignoring hysteresis; CTF reverts after 20 s (§4.3.2).
      const target = bestFlipCluster(m, key, t);
      if (target && target !== st.home) {
        st.prevHome = st.home;
        st.revertAtT = lockActive(m) ? t + VETOES.widen.forS : -1e9;
        st.home = target;
        st.lastFlipT = t;
        counters.flips++;
      }
      counters.compromised.push({ team: key, t });
    }
  }

  function lockActive(m) { return lockModes.indexOf(mModeId(m)) >= 0; }

  function enemyHomeOf(m, team) {
    for (const k in teamState) if (+k !== team && teamState[k].home) return teamState[k].home;
    return null;
  }

  function bestFlipCluster(m, team, t) {
    const enemyHome = enemyHomeOf(m, team);
    const modeId = mModeId(m);
    let best = null, bestV = -Infinity;
    for (const id in clusters) {
      if (id === enemyHome) continue;
      const c = clusters[id];
      let any = false, sum = 0, n = 0;
      for (const p of c.points) {
        if (p.modes.indexOf(modeId) < 0) continue;
        any = true; sum += gridTeam.at(p.pos, team); n++;
      }
      if (!any) continue;
      const v = sum / n;
      if (v > bestV) { bestV = v; best = id; }
    }
    return best;
  }

  // 5 Hz — match tick slot 8. Rebuilds the active grid's presence layer,
  // evaluates the flip rule, expires trap windows.
  function rebuild(m, dt) {
    const t = mTime(m);
    const ffa = mIsFFA(m);
    const grid = ffa ? gridFFA : gridTeam;
    rebuildScratch.length = 0;
    for (const a of mActors(m)) {
      if (!a || !a.alive) continue;
      const p = mPosOf(m, a);
      if (!p) continue;
      rebuildScratch.push({ alive: true, team: a.team, pos: p });
    }
    grid.rebuild(rebuildScratch, dt);
    if (ffa) return; // FFA flip is per-actor and trap-driven only (modes §4.4)
    // Flip rule: home cluster mean < −0.35 for 3 consecutive s, hysteresis 12 s.
    // In lock modes (CTF) the periodic flip is OFF — trap override only
    // (modes §4.3.2) — but trapped homes revert when their window expires.
    for (const k in teamState) {
      const st = teamState[k], team = +k;
      if (st.revertAtT > 0 && t >= st.revertAtT && st.prevHome) {
        st.home = st.prevHome; st.prevHome = null; st.revertAtT = -1e9;
      }
      if (lockActive(m) || !st.home) { st.meanBad.length = 0; continue; }
      const c = clusters[st.home];
      if (!c) continue;
      let sum = 0, n = 0;
      for (const p of c.points) { sum += gridTeam.at(p.pos, team); n++; }
      const mean = n ? sum / n : 0;
      st.meanBad.push(mean < FLIP_MEAN ? 1 : 0);
      const need = Math.max(1, Math.round(FLIP_HOLD_S * (dt > 0 ? 1 / dt : 5)));
      if (st.meanBad.length > need) st.meanBad.shift();
      const held = st.meanBad.length >= need && st.meanBad.every((x) => x === 1);
      if (held && t - st.lastFlipT >= FLIP_HYST_S) {
        const target = bestFlipCluster(m, team, t);
        if (target && target !== st.home) {
          st.home = target; st.lastFlipT = t; st.meanBad.length = 0; counters.flips++;
        }
      }
    }
  }

  // -- veto evaluation -------------------------------------------------------
  // cfg: {v1, v2, v3on, v3, v6on, v10on, recentOn}
  function vetoed(m, actor, p, t, cfg, enemies, ffa) {
    // AC-11 soft veto, rung R: no reuse within 12 s unless the ladder forces it.
    if (cfg.recentOn && t - p.lastUsedT < RECENT_S) return "recent";
    // V4 — anyone (FFA) / a friendly (team) spawned at this exact point <1.5 s.
    if (t - p.lastUsedT < VETOES.team.v4) {
      if (ffa || p.lastUsedTeam === actor.team) return "v4";
    }
    // V10 — FFA cluster cooldown 3.0 s (C7).
    if (ffa && cfg.v10on) {
      const c = clusters[p.cluster];
      if (c && t - c.lastSpawnT < VETOES.ffa.v10 && c.lastSpawnActor !== actor.actorId) {
        counters.v10Vetoes++;
        return "v10";
      }
    }
    // V5 — live grenade or explosion <1.5 s within 12 m.
    for (const g of mGrenades(m)) {
      const gp = g.pos || g.p;
      if (gp && distH(gp, p.pos) <= VETOES.team.v5) return "v5";
    }
    for (let i = explosions.length - 1; i >= 0; i--) {
      const e = explosions[i];
      if (t - e.t > 1.5) break;
      if (distH(e.pos, p.pos) <= VETOES.team.v5) return "v5";
    }
    // V6 — a teammate (team) / anyone (FFA) died within 8 m in the last 5 s.
    if (cfg.v6on) {
      for (let i = deathLog.length - 1; i >= 0; i--) {
        const d = deathLog[i];
        if (t - d.t > VETOES.team.v6) break;
        if (!ffa && d.team !== actor.team) continue;
        if (distH(d.pos, p.pos) <= VETOES.team.v6r) return "v6";
      }
    }
    // V1/V2/V3 — against enemies (team) / all living actors (FFA).
    const los = mLos(m);
    const head = [p.pos[0], (p.pos[1] || 0) + VETOES.headY, p.pos[2]];
    for (const e of enemies) {
      const ep = mPosOf(m, e);
      if (!ep) continue;
      const d = distH(ep, p.pos);
      if (d <= cfg.v1) return "v1";
      if (d <= cfg.v2) {
        const eye = [ep[0], (ep[1] || 0) + VETOES.headY, ep[2]];
        if (!los || !los(eye, head)) return "v2";
      }
      if (cfg.v3on && d <= cfg.v3) {
        const yaw = mYawOf(m, e);
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        const dx = p.pos[0] - ep[0], dz = p.pos[2] - ep[2];
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        if ((fx * dx + fz * dz) / len >= VETOES.coneCos) return "v3";
      }
    }
    // V7 — the mode hook.
    if (m.mode && m.mode.spawnVeto && m.mode.spawnVeto(m, actor, p)) return "v7";
    return null;
  }

  function recencyOf(p, t) {
    const u = t - p.lastUsedT;
    if (u >= RECENT_OUT_S) return 0;
    if (u < RECENT_S) return 1;
    return (RECENT_OUT_S - u) / (RECENT_OUT_S - RECENT_S);
  }

  function facingOf(m, p, watchers, maxM) {
    let worst = 0;
    for (const e of watchers) {
      const ep = mPosOf(m, e);
      if (!ep) continue;
      const dx = p.pos[0] - ep[0], dz = p.pos[2] - ep[2];
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > maxM || d < 1e-6) continue;
      const yaw = mYawOf(m, e);
      const c = (-Math.sin(yaw) * dx + -Math.cos(yaw) * dz) / d;
      if (c > worst) worst = c;
    }
    return worst;
  }

  function scoreTeam(m, actor, p, t, enemies, friends, rng) {
    const W = SCORE_WEIGHTS.team;
    let dE = Infinity, dF = Infinity;
    for (const e of enemies) { const ep = mPosOf(m, e); if (ep) { const d = distH(ep, p.pos); if (d < dE) dE = d; } }
    for (const f of friends) { const fp = mPosOf(m, f); if (fp) { const d = distH(fp, p.pos); if (d < dF) dF = d; } }
    const safety = W.safety * Math.min(1, (dE === Infinity ? W.safetySatM : dE) / W.safetySatM);
    const friendly = dF === Infinity ? 0 : W.friendly * (1 - Math.min(1, dF / W.friendlySatM));
    const bias = m.mode && m.mode.spawnBias ? W.modeBias * (m.mode.spawnBias(m, actor, p) || 0) : 0;
    return safety + friendly
      + W.influence * gridTeam.at(p.pos, actor.team)
      + bias
      + W.cover * p.cover
      - W.recency * recencyOf(p, t)
      - W.facing * facingOf(m, p, enemies, W.facingMaxM)
      + W.jitter * rng();
  }

  function scoreFFA(m, actor, p, t, others, rng) {
    const W = SCORE_WEIGHTS.ffa;
    const dists = [];
    for (const o of others) { const op = mPosOf(m, o); if (op) dists.push(distH(op, p.pos)); }
    const c = clusters[p.cluster];
    const heat = c && t - c.lastSpawnT < VETOES.ffa.v10 ? 1 : 0;
    return W.safety * ffaSafety(dists, W.safetyLenM)
      + W.spread * gridFFA.spread(p.pos)
      + W.cover * p.cover
      - W.recency * recencyOf(p, t)
      - W.facing * facingOf(m, p, others, W.facingMaxM)
      - W.clusterHeat * heat
      + W.jitter * rng();
  }

  // -- the pick --------------------------------------------------------------
  function pick(m, actor) {
    const t = mTime(m);
    const ffa = mIsFFA(m);
    const modeId = mModeId(m);
    const V = ffa ? VETOES.ffa : VETOES.team;
    const R = ffa ? VETOES.relax.ffa : VETOES.relax.team;
    const rng = mRng(m);
    const st = ffa ? actorStateOf(actor.actorId != null ? actor.actorId : 0) : teamStateOf(actor.team || 0);
    const widened = t < st.widenUntil;
    const widen = ffa ? VETOES.widen.ffa : VETOES.widen.team;
    const baseV1 = widened ? Math.max(V.v1, widen.v1) : V.v1;
    const baseV2 = widened ? Math.max(V.v2, widen.v2) : V.v2;

    // Candidates: mode-eligible; CTF locked to the team's home cluster
    // (modes §4.3.2); FFA excludes the actor's banned cluster (modes §4.4).
    const cands = [];
    for (const p of allPoints) {
      if (p.modes.indexOf(modeId) < 0) continue;
      if (!ffa && lockActive(m) && st.home && p.cluster !== st.home) continue;
      if (ffa && st.banCluster && t < st.banUntil && p.cluster === st.banCluster) continue;
      cands.push(p);
    }
    const enemies = livingOthers(m, actor, true);
    const friends = ffa ? [] : livingOthers(m, actor, false);

    // The relaxation ladder (C7), one step at a time, re-scoring after each.
    // Rung 0 additionally excludes points used <12 s ago (AC-11): admitting
    // them is the FIRST relaxation, so any reuse inside 12 s carries stress.
    const rungs = [];
    rungs.push({ v1: baseV1, v2: baseV2, v3on: true, v3: V.v3, v6on: true, v10on: ffa, recentOn: true });
    rungs.push({ v1: baseV1, v2: baseV2, v3on: true, v3: V.v3, v6on: true, v10on: ffa, recentOn: false });
    rungs.push({ v1: baseV1, v2: baseV2, v3on: false, v3: V.v3, v6on: true, v10on: ffa, recentOn: false });
    rungs.push({ v1: baseV1, v2: baseV2, v3on: false, v3: V.v3, v6on: false, v10on: ffa, recentOn: false });
    if (ffa) rungs.push({ v1: baseV1, v2: baseV2, v3on: false, v3: V.v3, v6on: false, v10on: false, recentOn: false });
    rungs.push({ v1: baseV1, v2: Math.min(baseV2, R.v2), v3on: false, v3: V.v3, v6on: false, v10on: false, recentOn: false });
    rungs.push({ v1: Math.min(baseV1, R.v1), v2: Math.min(baseV2, R.v2), v3on: false, v3: V.v3, v6on: false, v10on: false, recentOn: false });

    for (let rung = 0; rung < rungs.length; rung++) {
      const cfg = rungs[rung];
      let best = null, bestScore = -Infinity;
      for (const p of cands) {
        if (vetoed(m, actor, p, t, cfg, enemies, ffa)) continue;
        const s = ffa
          ? scoreFFA(m, actor, p, t, enemies, rng)
          : scoreTeam(m, actor, p, t, enemies, friends, rng);
        if (s > bestScore) { bestScore = s; best = p; }
      }
      if (best) {
        record(m, actor, best, t, ffa, st);
        counters.picks++; counters.stressSum += rung;
        return { pointId: best.id, pos: [best.pos[0], best.pos[1], best.pos[2]], yaw: best.yaw, stress: rung, protectS: null };
      }
    }

    // Never fail to spawn (C7): cluster centroid, 3.0 s protection, logged.
    const stress = rungs.length;
    counters.picks++; counters.stressSum += stress; counters.centroidFalls++;
    let cid = !ffa && st.home ? st.home : null;
    if (!cid || !clusters[cid]) {
      // nearest eligible cluster by candidate count (stable order)
      for (const id in clusters) {
        if (ffa && st.banCluster && t < st.banUntil && id === st.banCluster) continue;
        if (clusters[id].points.some((p) => p.modes.indexOf(modeId) >= 0)) { cid = id; break; }
      }
    }
    const c = cid ? clusters[cid] : null;
    const pos = c ? [c.centroid[0], c.centroid[1], c.centroid[2]] : [0, 0, 0];
    let yaw = 0, bestD = Infinity;
    if (c) for (const p of c.points) { const d = distH(p.pos, pos); if (d < bestD) { bestD = d; yaw = p.yaw; } }
    record(m, actor, null, t, ffa, st, cid, pos);
    return { pointId: null, pos, yaw, stress, protectS: 3.0, fallback: true };
  }

  function record(m, actor, p, t, ffa, st, clusterId, pos) {
    const cid = p ? p.cluster : clusterId;
    const rpos = p ? p.pos : pos;
    if (p) {
      p.lastUsedT = t;
      p.lastUsedTeam = actor.team != null ? actor.team : -1;
      p.lastUsedActor = actor.actorId != null ? actor.actorId : -1;
    }
    const c = cid ? clusters[cid] : null;
    if (c) { c.lastSpawnT = t; c.lastSpawnActor = actor.actorId != null ? actor.actorId : -1; }
    if (ffa) st.lastCluster = cid;
    else if (!st.home) st.home = cid; // TDM: home = where the team spawns (descriptive)
    st.spawnLog.push({ actorId: actor.actorId != null ? actor.actorId : -1, pointId: p ? p.id : null, pos: [rpos[0], rpos[1], rpos[2]], t, trapDeath: false });
    if (st.spawnLog.length > 16) st.spawnLog.shift();
  }

  function snapshot() {
    const teams = {};
    for (const k in teamState) {
      const s = teamState[k];
      teams[k] = { home: s.home, widenUntil: s.widenUntil, lastFlipT: s.lastFlipT };
    }
    return {
      picks: counters.picks,
      stressMean: counters.picks ? counters.stressSum / counters.picks : 0,
      centroidFalls: counters.centroidFalls,
      v10Vetoes: counters.v10Vetoes,
      flips: counters.flips,
      traps: counters.traps,
      compromised: counters.compromised.slice(),
      teams,
    };
  }

  function influenceFor(modeId) { return modeId === "ffa" ? gridFFA : gridTeam; }

  return { pick, rebuild, noteDeath, noteExplosion, snapshot, influenceFor };
}

function boundsOf(points) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p.pos[0] < minX) minX = p.pos[0];
    if (p.pos[0] > maxX) maxX = p.pos[0];
    if (p.pos[2] < minZ) minZ = p.pos[2];
    if (p.pos[2] > maxZ) maxZ = p.pos[2];
  }
  if (minX === Infinity) { minX = -50; minZ = -50; maxX = 50; maxZ = 50; }
  return { min: [minX - 6, 0, minZ - 6], max: [maxX + 6, 8, maxZ + 6] };
}
