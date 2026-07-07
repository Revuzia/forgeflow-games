// Persistence: profile in localStorage.
const KEY = 'bastion_stronghold_save_v1';

const DEFAULTS = {
  stars: {},          // 'bi:li' -> 0..3
  wins: {},           // 'bi:li' -> true
  endlessBest: {},    // bi -> best wave reached
  achievements: {},   // id -> true
  counters: {
    kills: 0, pierces: 0, runeBlasts: 0, chains: 0, repairs: 0, sold: 0,
    flawlessWins: 0, wins: 0,
    typesBuilt: [], maxedTypes: [],
  },
  settings: { music: 0.7, sfx: 0.8, quality: 'high', shake: true },
  seenIntro: false,
};

let profile = null;

export function loadProfile() {
  if (profile) return profile;
  try {
    const raw = localStorage.getItem(KEY);
    profile = raw ? { ...structuredClone(DEFAULTS), ...JSON.parse(raw) } : structuredClone(DEFAULTS);
    profile.counters = { ...structuredClone(DEFAULTS.counters), ...(profile.counters || {}) };
    profile.settings = { ...structuredClone(DEFAULTS.settings), ...(profile.settings || {}) };
  } catch {
    profile = structuredClone(DEFAULTS);
  }
  return profile;
}

export function saveProfile() {
  try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* full/blocked */ }
}

export function resetProfile() {
  profile = structuredClone(DEFAULTS);
  saveProfile();
  return profile;
}

// ---- progression helpers ----
export function starsFor(bi, li) { return loadProfile().stars[bi + ':' + li] || 0; }
export function recordResult(bi, li, stars) {
  const p = loadProfile();
  const k = bi + ':' + li;
  p.stars[k] = Math.max(p.stars[k] || 0, stars);
  if (stars > 0) p.wins[k] = true;
  saveProfile();
}
export function isLevelUnlocked(bi, li) {
  if (bi === 0 && li === 0) return true;
  const p = loadProfile();
  if (li === 0) return !!p.wins[(bi - 1) + ':8'];   // beat previous biome finale
  return !!p.wins[bi + ':' + (li - 1)];
}
export function isBiomeUnlocked(bi) { return isLevelUnlocked(bi, 0); }
export function isEndlessUnlocked(bi) { return !!loadProfile().wins[bi + ':8']; }
export function totalStars() {
  const p = loadProfile();
  return Object.values(p.stars).reduce((a, b) => a + b, 0);
}
export function biomeStars(bi) {
  const p = loadProfile();
  let n = 0;
  for (let li = 0; li < 9; li++) n += p.stars[bi + ':' + li] || 0;
  return n;
}
export function recordEndless(bi, wave) {
  const p = loadProfile();
  p.endlessBest[bi] = Math.max(p.endlessBest[bi] || 0, wave);
  saveProfile();
}
