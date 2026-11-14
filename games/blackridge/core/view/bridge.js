// core/view/bridge.js [A0 — FROZEN at freeze time. NEVER edited after.]
// The single sim→view dispatcher (architecture §3.3). Consumers self-register
// via their own attach(bridge, ctx); nobody edits this file — that is how
// eleven lanes share one bridge without a single merge conflict.

export function makeBridge() {
  const handlers = new Map();
  return {
    register(type, fn) {
      let list = handlers.get(type);
      if (!list) { list = []; handlers.set(type, list); }
      list.push(fn);
    },

    dispatch(events) {
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        const list = handlers.get(e.type);
        if (!list) continue;
        for (let j = 0; j < list.length; j++) list[j](e.data, e.t);
      }
    },

    clear() { handlers.clear(); },
  };
}
