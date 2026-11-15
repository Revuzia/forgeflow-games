// Simple object pool

export function createPool(factory, initial = 16) {
  const free = [];
  const active = [];
  for (let i = 0; i < initial; i++) free.push(factory());

  return {
    active,
    acquire() {
      const obj = free.pop() || factory();
      obj._alive = true;
      active.push(obj);
      return obj;
    },
    release(obj) {
      if (!obj._alive) return;
      obj._alive = false;
      const i = active.indexOf(obj);
      if (i >= 0) active.splice(i, 1);
      free.push(obj);
    },
    releaseAll() {
      while (active.length) {
        const obj = active.pop();
        obj._alive = false;
        free.push(obj);
      }
    },
    forEachAlive(fn) {
      for (let i = active.length - 1; i >= 0; i--) {
        const obj = active[i];
        if (obj._alive) fn(obj, i);
      }
    },
  };
}
