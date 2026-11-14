// Deterministic RNG (mulberry32) + helpers. Pure module — no DOM.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function makeRng(seed) {
  const f = mulberry32(seed);
  return {
    next: f,
    range(min, max) { return min + f() * (max - min); },
    int(min, max) { return Math.floor(min + f() * (max - min + 1)); }, // inclusive
    pick(arr) { return arr[Math.floor(f() * arr.length)]; },
    chance(p) { return f() < p; },
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(f() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
}
