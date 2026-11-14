// core/events.js [A0] — event bus (double-buffered ring, zero alloc per frame).
// Contract (architecture §3.1): makeBus() → bus with emit/drain/count/resetCounters.
// Events are plain objects {t, type, data}; `t` is sim time — the sim's host
// (boot.js) advances bus.now before each sim.step so emits inside the tick are
// stamped with the tick's time. Nothing in here touches THREE or the DOM.

export function makeBus() {
  let pending = [];
  let spare = [];
  const counters = new Map();

  const bus = {
    now: 0, // sim time; boot.js writes this before each sim.step

    emit(type, data) {
      pending.push({ t: bus.now, type, data });
      counters.set(type, (counters.get(type) || 0) + 1);
    },

    // Returns and clears the pending list. Boot calls this exactly once per
    // render frame. Double-buffer swap so no array is allocated per frame.
    drain() {
      const out = pending;
      pending = spare;
      pending.length = 0;
      spare = out;
      return out;
    },

    count(type) {
      return counters.get(type) || 0;
    },

    // JSON-safe dump of every per-type counter (used by __test.counters()).
    countsByType() {
      const o = {};
      for (const [k, v] of counters) o[k] = v;
      return o;
    },

    resetCounters() {
      counters.clear();
    },
  };
  return bus;
}
