// Arcane Realms — deterministic seeded RNG (mulberry32). Pure data state so the
// whole game state (including rng position) survives structuredClone/JSON.
export function rngNext(state) {
  // advances state.rngState, returns float in [0,1)
  let t = (state.rngState = (state.rngState + 0x6D2B79F5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rngInt(state, n) {
  return Math.floor(rngNext(state) * n);
}

export function rngPick(state, arr) {
  return arr.length ? arr[rngInt(state, arr.length)] : undefined;
}

export function rngShuffle(state, arr) {
  // in-place Fisher-Yates
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rngInt(state, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function seedFrom(x) {
  // hash a string/number to a 32-bit seed
  const s = String(x);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}
