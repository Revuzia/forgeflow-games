// Crownfire Arenas — enemy roster (models from the ForgeFlow creature library,
// copied into assets/enemies/). All units respect Shock/Burn/Frost statuses.

export const ENEMY_TYPES = {
  skeleton: { // rusher — bread and butter chaser
    model: "skeleton", height: 1.6, hp: 32, speed: 4.1, dmg: 1,
    atkRange: 1.5, atkCd: 1.1, atkWindup: 0.35, score: 50, gold: [1, 2],
    knockMult: 1,
  },
  imp: {      // swarm — fast, weak, comes in packs
    model: "imp", height: 1.15, hp: 14, speed: 5.3, dmg: 1,
    atkRange: 1.3, atkCd: 1.3, atkWindup: 0.25, score: 30, gold: [0, 1],
    knockMult: 1.5,
  },
  orc: {      // elite rusher — mid waves
    model: "orc", height: 1.9, hp: 64, speed: 3.7, dmg: 2,
    atkRange: 1.7, atkCd: 1.3, atkWindup: 0.4, score: 110, gold: [2, 3],
    knockMult: 0.8,
  },
  brute: {    // heavy — slow, tanky, hits hard
    model: "brute", height: 2.5, hp: 130, speed: 2.5, dmg: 2,
    atkRange: 2.0, atkCd: 1.8, atkWindup: 0.6, score: 170, gold: [3, 5],
    knockMult: 0.35,
  },
  wisp: {     // ranged — floats, keeps distance, lobs bolts
    model: "wisp", height: 1.2, hp: 24, speed: 3.4, dmg: 1,
    atkRange: 9.5, atkCd: 2.4, atkWindup: 0.5, score: 90, gold: [1, 2],
    ranged: { speed: 8.5, radius: 0.35 }, floatH: 1.1, keepDist: 7.5,
    knockMult: 1.2,
  },
  demon: {    // realm champion — final-wave miniboss on later realms
    model: "demon", height: 3.3, hp: 520, speed: 2.9, dmg: 2,
    atkRange: 2.6, atkCd: 1.6, atkWindup: 0.55, score: 600, gold: [10, 15],
    knockMult: 0.12, champion: true,
  },
};

// Wave composition per realm order (1-5). Each wave = list of [type, count].
// Escalates size + aggression; later realms mix in elites earlier and cap with
// a champion. Counts are tuned for readable-but-busy boards (~60fps budget).
export function waveComp(arenaOrder, waveIdx /* 0-based */, waveCount) {
  const last = waveIdx === waveCount - 1;
  const p = arenaOrder - 1;          // 0..4 realm difficulty bump
  const w = waveIdx;
  const comp = [];
  const n = (base, per) => Math.round(base + per * w + p * 1.2);
  comp.push(["skeleton", n(3, 1.4)]);
  if (w >= 1 || p >= 1) comp.push(["imp", n(2, 1.8)]);
  if (w >= 2 || p >= 2) comp.push(["orc", Math.max(1, n(-1, 0.9))]);
  if (w >= 2) comp.push(["brute", Math.max(1, Math.round((w - 1) * 0.6 + p * 0.4))]);
  if (w >= 1 && (p >= 1 || w >= 3)) comp.push(["wisp", Math.max(1, Math.round(w * 0.7 + p * 0.5))]);
  if (last && arenaOrder >= 3) comp.push(["demon", arenaOrder === 5 ? 2 : 1]);
  return comp;
}
