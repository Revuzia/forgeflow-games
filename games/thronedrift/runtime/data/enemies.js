// Thronedrift — enemy roster: 15 regulars (3 per realm) + 5 realm BOSSES.
// Models from the ForgeFlow creature library (assets/enemies/). All units
// respect Shock/Burn/Frost. Every projectile in the game flies STRAIGHT —
// nothing homes; spells and arrows are always dodgeable.
//
// move styles: walk | hop (bounce + squash) | float (hover) | lumber (sway).

export const ENEMY_TYPES = {
  // ── Emberthrone (realm 1) ────────────────────────────────────────────────
  imp: {
    model: "imp", name: "Cinder Imp", role: "Swarmer", realm: 1,
    lore: "Small, spiteful, and never alone. Kill three and five more take offense.",
    height: 1.15, hp: 14, speed: 4.1, dmg: 1, move: "walk",
    atkRange: 1.3, atkCd: 1.5, atkWindup: 0.4, score: 30, gold: [0, 1], knockMult: 1.5,
  },
  skeleton: {
    model: "skeleton", name: "Gravebound", role: "Rusher", realm: 1,
    lore: "Foot-soldiers of the fallen realms. They remember how to march, and little else.",
    height: 1.6, hp: 32, speed: 3.1, dmg: 1, move: "walk",
    atkRange: 1.5, atkCd: 1.4, atkWindup: 0.55, score: 50, gold: [1, 2], knockMult: 1,
  },
  brute: {
    model: "brute", name: "Ember Brute", role: "Heavy", realm: 1,
    lore: "Realm champions are chosen for wit, heart, or strength. The brutes just showed up.",
    height: 2.5, hp: 130, speed: 2.0, dmg: 2, move: "lumber",
    atkRange: 2.0, atkCd: 2.0, atkWindup: 0.75, score: 170, gold: [3, 5], knockMult: 0.35,
  },
  // ── Glacier Court (realm 2) ──────────────────────────────────────────────
  slime: {
    model: "slime", name: "Rime Ooze", role: "Bouncer", realm: 2,
    lore: "It ate a rune once. Now it bounces. Nobody knows where the rune went.",
    height: 1.05, hp: 30, speed: 3.4, dmg: 1, move: "hop",
    atkRange: 1.4, atkCd: 1.6, atkWindup: 0.45, score: 45, gold: [1, 2], knockMult: 1.8,
  },
  bat: {
    model: "bat", name: "Frostwing", role: "Swarm Flyer", realm: 2,
    lore: "The Court's belfries froze centuries ago. The bats simply refused to leave.",
    height: 0.95, hp: 16, speed: 4.6, dmg: 1, move: "float", floatH: 1.4,
    atkRange: 1.4, atkCd: 1.4, atkWindup: 0.35, score: 40, gold: [0, 1], knockMult: 1.6,
  },
  yeti: {
    model: "yeti", name: "Court Yeti", role: "Heavy", realm: 2,
    lore: "Politely announces each attack with a roar. Etiquette matters at Court.",
    height: 2.6, hp: 160, speed: 1.9, dmg: 2, move: "lumber",
    atkRange: 2.1, atkCd: 2.1, atkWindup: 0.8, score: 200, gold: [3, 5], knockMult: 0.3,
  },
  // ── Tempest Ring (realm 3) ───────────────────────────────────────────────
  spider: {
    model: "spider", name: "Static Spinner", role: "Swarmer", realm: 3,
    lore: "Its webs conduct. Its bite does too.",
    height: 1.0, hp: 22, speed: 4.4, dmg: 1, move: "walk",
    atkRange: 1.3, atkCd: 1.3, atkWindup: 0.35, score: 45, gold: [0, 2], knockMult: 1.4,
  },
  gargoyle: {
    model: "gargoyle", name: "Ring Warden", role: "Flyer", realm: 3,
    lore: "Carved to guard the Ring. Nobody carved instructions for stopping.",
    height: 1.8, hp: 55, speed: 3.3, dmg: 1, move: "float", floatH: 1.0,
    atkRange: 1.7, atkCd: 1.5, atkWindup: 0.5, score: 100, gold: [2, 3], knockMult: 0.7,
  },
  wisp: {
    model: "wisp", name: "Hex Wisp", role: "Ranged", realm: 3,
    lore: "A grudge with a glow. It has never forgiven anyone for anything.",
    height: 1.2, hp: 24, speed: 2.7, dmg: 1, move: "float", floatH: 1.1,
    atkRange: 9.5, atkCd: 2.8, atkWindup: 0.6, score: 90, gold: [1, 2],
    ranged: { speed: 7.5, radius: 0.35 }, keepDist: 7.5, knockMult: 1.2,
  },
  // ── Umbra Throne (realm 4) ───────────────────────────────────────────────
  zombie: {
    model: "zombie", name: "Throne Thrall", role: "Rusher", realm: 4,
    lore: "Kneeled to the eclipsed king once. Now it cannot stop kneeling forward.",
    height: 1.7, hp: 48, speed: 2.8, dmg: 1, move: "walk",
    atkRange: 1.5, atkCd: 1.5, atkWindup: 0.6, score: 70, gold: [1, 2], knockMult: 0.9,
  },
  skull: {
    model: "skull", name: "Grinning Remnant", role: "Swarm Flyer", realm: 4,
    lore: "The rest of it gave up. The grin kept going.",
    height: 0.8, hp: 15, speed: 4.8, dmg: 1, move: "float", floatH: 1.3,
    atkRange: 1.2, atkCd: 1.2, atkWindup: 0.3, score: 40, gold: [0, 1], knockMult: 1.7,
  },
  ghost: {
    model: "ghost", name: "Pale Courtier", role: "Ranged", realm: 4,
    lore: "Still petitioning a king who no longer has ears. Throws the paperwork.",
    height: 1.5, hp: 34, speed: 2.6, dmg: 1, move: "float", floatH: 0.9,
    atkRange: 10, atkCd: 2.6, atkWindup: 0.55, score: 110, gold: [1, 3],
    ranged: { speed: 8, radius: 0.35 }, keepDist: 8, knockMult: 1.1,
  },
  // ── Aurelian Bastion (realm 5) ───────────────────────────────────────────
  orc: {
    model: "orc", name: "Gilded Orc", role: "Elite Rusher", realm: 5,
    lore: "Sold his axe-arm to four different warlords. All four collected.",
    height: 1.9, hp: 80, speed: 3.0, dmg: 2, move: "walk",
    atkRange: 1.7, atkCd: 1.5, atkWindup: 0.5, score: 130, gold: [2, 4], knockMult: 0.8,
  },
  myconid: {
    model: "myconid", name: "Sunspore", role: "Ranged", realm: 5,
    lore: "Grew in the one shadow the Bastion allows. Resents the sunlight loudly.",
    height: 1.4, hp: 40, speed: 2.4, dmg: 1, move: "walk",
    atkRange: 9, atkCd: 2.5, atkWindup: 0.6, score: 120, gold: [1, 3],
    ranged: { speed: 7, radius: 0.4 }, keepDist: 7, knockMult: 1,
  },
  cyclops: {
    model: "cyclops", name: "Bastion Colossus", role: "Heavy", realm: 5,
    lore: "One eye, zero depth perception, endless enthusiasm.",
    height: 2.9, hp: 220, speed: 1.9, dmg: 2, move: "lumber",
    atkRange: 2.3, atkCd: 2.2, atkWindup: 0.85, score: 260, gold: [4, 7], knockMult: 0.25,
  },
};

// ── Realm bosses — one per throne, each fights like a CLASS ────────────────
// Kits are ability lists the boss AI cycles through. All projectiles STRAIGHT.
export const BOSS_TYPES = {
  vulkar: {
    model: "demon", name: "Vulkar, Ember Warden", role: "BOSS — Warrior", realm: 1, boss: true,
    lore: "First to hold a throne. First to burn everyone who asked to share it.",
    height: 3.4, hp: 650, speed: 2.5, dmg: 2, move: "lumber",
    atkRange: 2.7, atkCd: 1.7, atkWindup: 0.65, score: 900, gold: [12, 18], knockMult: 0.1,
    kit: [
      { type: "slam", cd: 7, radius: 4.5, dmg: 2, windup: 1.0 },
      { type: "charge", cd: 10, speed: 15, dmg: 2, windup: 0.8, dur: 0.8 },
    ],
  },
  boreas: {
    model: "giant", name: "Boreas the Sundered", role: "BOSS — Frost Warrior", realm: 2, boss: true,
    lore: "The Court split him in half with cold. He kept both halves working.",
    height: 3.8, hp: 820, speed: 2.2, dmg: 2, move: "lumber",
    atkRange: 3.0, atkCd: 1.9, atkWindup: 0.7, score: 1100, gold: [14, 20], knockMult: 0.08,
    kit: [
      { type: "slam", cd: 8, radius: 5, dmg: 2, windup: 1.1 },
      { type: "nova", cd: 9, count: 10, speed: 7, dmg: 1, windup: 0.9 },
      { type: "summon", cd: 13, unit: "slime", count: 2 },
    ],
  },
  skalvyrn: {
    model: "dragon", name: "Skalvyrn of the Storm", role: "BOSS — Archer", realm: 3, boss: true,
    lore: "Does not breathe fire. Breathes aim.",
    height: 3.2, hp: 900, speed: 3.0, dmg: 2, move: "float", floatH: 0.8,
    atkRange: 11, atkCd: 2.2, atkWindup: 0.6, score: 1300, gold: [16, 22], knockMult: 0.1,
    ranged: { speed: 9, radius: 0.4 }, keepDist: 8.5,
    kit: [
      { type: "volley", cd: 6, count: 3, spread: 0.5, speed: 10, dmg: 1, windup: 0.7 },
      { type: "nova", cd: 11, count: 8, speed: 8, dmg: 1, windup: 0.9 },
      { type: "blink", cd: 9, range: [6, 10] },
    ],
  },
  zhymoth: {
    model: "cthulhu", name: "Zhy'moth, Umbral Sage", role: "BOSS — Mage", realm: 4, boss: true,
    lore: "Read every book in the drowned library. Agreed with none of them.",
    height: 3.5, hp: 1000, speed: 2.2, dmg: 2, move: "float", floatH: 0.6,
    atkRange: 12, atkCd: 2.4, atkWindup: 0.7, score: 1600, gold: [18, 26], knockMult: 0.06,
    ranged: { speed: 6, radius: 0.6 }, keepDist: 9,
    kit: [
      { type: "volley", cd: 7, count: 5, spread: 0.9, speed: 6, dmg: 1, windup: 0.9 },
      { type: "summon", cd: 12, unit: "skull", count: 3 },
      { type: "blink", cd: 8, range: [7, 11] },
    ],
  },
  aurex: {
    model: "ninja", name: "Aurex the Dawnblade", role: "BOSS — Blademaster", realm: 5, boss: true,
    lore: "The Bastion's last duelist. Considers your combo meter a personal insult.",
    height: 2.2, hp: 1150, speed: 4.2, dmg: 2, move: "walk",
    atkRange: 2.0, atkCd: 1.2, atkWindup: 0.45, score: 2200, gold: [24, 32], knockMult: 0.3,
    kit: [
      { type: "charge", cd: 6, speed: 19, dmg: 2, windup: 0.6, dur: 0.6 },
      { type: "volley", cd: 8, count: 5, spread: 1.0, speed: 12, dmg: 1, windup: 0.6 },
      { type: "slam", cd: 10, radius: 3.6, dmg: 2, windup: 0.8 },
    ],
  },
};

export const ALL_TYPES = { ...ENEMY_TYPES, ...BOSS_TYPES };

// per-realm spawn pools: [swarm-ish, mid, heavy/ranged] + boss key
export const REALM_ROSTERS = {
  1: { units: ["imp", "skeleton", "brute"], boss: "vulkar" },
  2: { units: ["bat", "slime", "yeti"], boss: "boreas" },
  3: { units: ["spider", "gargoyle", "wisp"], boss: "skalvyrn" },
  4: { units: ["skull", "zombie", "ghost"], boss: "zhymoth" },
  5: { units: ["orc", "myconid", "cyclops"], boss: "aurex" },
};

// Wave composition. Gentle opening; the realm's three units phase in one wave
// apart; FINAL wave = the realm boss + a light escort.
export function waveComp(arenaOrder, waveIdx /* 0-based */, waveCount) {
  const roster = REALM_ROSTERS[arenaOrder] || REALM_ROSTERS[1];
  const [u0, u1, u2] = roster.units;
  const last = waveIdx === waveCount - 1;
  const p = arenaOrder - 1;
  const w = waveIdx;
  if (last) {
    return [[roster.boss, 1], [u0, 3 + p], [u1, Math.max(1, Math.round(w * 0.5))]];
  }
  const comp = [];
  comp.push([u0, Math.round(3 + w * 1.3 + p * 0.8)]);
  if (w >= 1) comp.push([u1, Math.round(1 + w * 1.0 + p * 0.5)]);
  if (w >= 2) comp.push([u2, Math.max(1, Math.round((w - 1) * 0.7 + p * 0.4))]);
  return comp;
}
