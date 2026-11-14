// core/meta/skill.js [identity lane] — the device-saved matchmaking record.
// One small versioned localStorage record; the math lives in core/ai/adaptive.js
// (pure, selftested). Nothing here renders, logs to the console in normal play,
// or is reachable from a menu: the record only chooses the operators' tier at
// match start (runtime/boot.js) and is folded once per finished PVP match.
//
//   createSkillRecord({ storage? }) → { attach(bridge, getSim), startTier(),
//     record(), fold(stats), _reset() }

import { foldMatch, normalise, startTier as tierFromRecord } from "../ai/adaptive.js";

export const SKILL_KEY = "blackridge.mmr.v1";
const MIN_LIVE_S = 60; // a match quit inside a minute says nothing about skill

function defaultStorage() {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (_) { return null; }
}

/** Stats for adaptive.matchPerf from a match's mission:end payload. */
export function statsFromEnd(d, liveS) {
  if (!d || !d.match || !Array.isArray(d.match.actors)) return null;
  const me = d.match.actors.find((a) => a && a.kind === "human") || d.match.actors[0];
  if (!me) return null;
  const st = d.stats || {};
  const mins = Math.max(1, liveS || 0) / 60;
  const fired = Number(st.shotsFired) || 0, hit = Number(st.shotsHit) || 0;
  return {
    kd: (me.kills | 0) / Math.max(1, me.deaths | 0),
    spm: (Number(me.score) || 0) / mins,
    acc: fired > 0 ? Math.min(1, hit / fired) : 0,
    win: d.result === "won",
  };
}

export function createSkillRecord(opts = {}) {
  const store = opts.storage !== undefined ? opts.storage : defaultStorage();
  let cache;
  function load() {
    if (cache !== undefined) return cache;
    cache = null;
    try {
      const raw = store && store.getItem(SKILL_KEY);
      if (raw) cache = normalise(JSON.parse(raw));
    } catch (_) { cache = null; }
    return cache;
  }
  function save(r) {
    cache = r;
    try { if (store) store.setItem(SKILL_KEY, JSON.stringify(r)); } catch (_) { /* private window: play on */ }
  }
  const api = {
    record: () => load(),
    startTier: () => tierFromRecord(load()),
    fold(stats) {
      if (!stats) return load();
      const r = foldMatch(load(), stats);
      save(r);
      return r;
    },
    attach(bridge, getSim) {
      bridge.register("mission:end", (d) => {
        try {
          if (!d || !d.match) return; // campaign missions do not count
          const sim = getSim && getSim();
          const live = sim && sim.state && sim.state.match ? Number(sim.state.match.elapsed) || 0 : 0;
          if (live < MIN_LIVE_S) return;
          api.fold(statsFromEnd(d, live));
        } catch (_) { /* never breaks the end screen */ }
      });
    },
    _reset() { cache = undefined; },
  };
  return api;
}
