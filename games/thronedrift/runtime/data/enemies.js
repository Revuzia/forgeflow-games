// Realm enemies (models from the ForgeFlow creature library, copied into
// assets/enemies/). All units respect Shock/Burn/Frost statuses.
//
// move styles (per-type personality): walk | hop (slime bounce) | float (wisp
// hover) | lumber (brute sway). Speeds tuned DOWN from iteration 1 — the owner
// called the first pass "an onslaught right away"; wave 1 should feel like a
// warm-up, not a mugging.

export const ENEMY_TYPES = {
  skeleton: { // rusher — bread and butter chaser
    model: "skeleton", name: "Gravebound", role: "Rusher",
    lore: "Foot-soldiers of the fallen realms. They remember how to march, and little else.",
    height: 1.6, hp: 32, speed: 3.1, dmg: 1, move: "walk",
    atkRange: 1.5, atkCd: 1.4, atkWindup: 0.55, score: 50, gold: [1, 2],
    knockMult: 1,
  },
  imp: {      // swarm — fast, weak, comes in packs
    model: "imp", name: "Cinder Imp", role: "Swarmer",
    lore: "Small, spiteful, and never alone. Kill three and five more take offense.",
    height: 1.15, hp: 14, speed: 4.1, dmg: 1, move: "walk",
    atkRange: 1.3, atkCd: 1.5, atkWindup: 0.4, score: 30, gold: [0, 1],
    knockMult: 1.5,
  },
  slime: {    // bouncer — hops in arcs, squishy but weirdly persistent
    model: "slime", name: "Vault Ooze", role: "Bouncer",
    lore: "It ate a rune once. Now it bounces. Nobody knows where the rune went.",
    height: 1.05, hp: 26, speed: 3.4, dmg: 1, move: "hop",
    atkRange: 1.4, atkCd: 1.6, atkWindup: 0.45, score: 45, gold: [1, 2],
    knockMult: 1.8,
  },
  orc: {      // elite rusher — mid waves
    model: "orc", name: "Warband Orc", role: "Elite Rusher",
    lore: "Sold his axe-arm to four different warlords. All four collected.",
    height: 1.9, hp: 64, speed: 2.9, dmg: 2, move: "walk",
    atkRange: 1.7, atkCd: 1.5, atkWindup: 0.5, score: 110, gold: [2, 3],
    knockMult: 0.8,
  },
  brute: {    // heavy — slow, tanky, hits hard
    model: "brute", name: "Realm Brute", role: "Heavy",
    lore: "Realm champions are chosen for wit, heart, or strength. The brutes weren't chosen at all — they just showed up.",
    height: 2.5, hp: 130, speed: 2.0, dmg: 2, move: "lumber",
    atkRange: 2.0, atkCd: 2.0, atkWindup: 0.75, score: 170, gold: [3, 5],
    knockMult: 0.35,
  },
  wisp: {     // ranged — floats, keeps distance, lobs bolts
    model: "wisp", name: "Hex Wisp", role: "Ranged",
    lore: "A grudge with a glow. It has never forgiven anyone for anything.",
    height: 1.2, hp: 24, speed: 2.7, dmg: 1, move: "float",
    atkRange: 9.5, atkCd: 2.8, atkWindup: 0.6, score: 90, gold: [1, 2],
    ranged: { speed: 7.5, radius: 0.35 }, floatH: 1.1, keepDist: 7.5,
    knockMult: 1.2,
  },
  demon: {    // realm champion — final-wave miniboss on later realms
    model: "demon", name: "Throne Warden", role: "Realm Champion",
    lore: "Each realm keeps one warden bound to its throne. They do not kneel to challengers. They collect them.",
    height: 3.3, hp: 520, speed: 2.4, dmg: 2, move: "lumber",
    atkRange: 2.6, atkCd: 1.8, atkWindup: 0.7, score: 600, gold: [10, 15],
    knockMult: 0.12, champion: true,
  },
};

// Wave composition per realm order (1-5). Each wave = list of [type, count].
// Gentler opening than iteration 1: wave 1 of realm 1 is 3 slow rushers, and
// swarm/elite/heavy layers phase in a wave later than before.
export function waveComp(arenaOrder, waveIdx /* 0-based */, waveCount) {
  const last = waveIdx === waveCount - 1;
  const p = arenaOrder - 1;          // 0..4 realm difficulty bump
  const w = waveIdx;
  const comp = [];
  const n = (base, per) => Math.round(base + per * w + p * 1.1);
  comp.push(["skeleton", n(3, 1.2)]);
  if (w >= 1 || p >= 1) comp.push(["slime", Math.max(1, n(-1, 1.0))]);
  if (w >= 2 || p >= 1) comp.push(["imp", Math.max(2, n(0, 1.5))]);
  if (w >= 3 || p >= 2) comp.push(["orc", Math.max(1, n(-2, 0.8))]);
  if (w >= 3) comp.push(["brute", Math.max(1, Math.round((w - 2) * 0.6 + p * 0.4))]);
  if (w >= 2 && (p >= 1 || w >= 3)) comp.push(["wisp", Math.max(1, Math.round(w * 0.6 + p * 0.5))]);
  if (last && arenaOrder >= 3) comp.push(["demon", arenaOrder === 5 ? 2 : 1]);
  return comp;
}
