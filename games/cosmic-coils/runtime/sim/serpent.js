/**
 * Cosmic Coils — runtime/sim/serpent.js
 * Deterministic spherical-planet snake-battle simulation. Pure ESM, zero deps
 * (no three.js) so the node selftest and the net layer can drive it headless.
 *
 * World model: every snake lives ON the surface of a sphere of radius R.
 * A snake is (u, t, mass, path):
 *   u    — unit vector, head position on the unit sphere
 *   t    — unit tangent (⊥ u), current heading
 *   path — ring buffer of on-sphere unit points the head has traveled through;
 *          the body is placed by walking BACK along this path at fixed spacing,
 *          so the body always follows the exact head trail (slither model).
 *
 * Motion is great-circle transport:  u' = u·cosθ + t·sinθ,  t' = t·cosθ − u·sinθ
 * Steering rotates t around u (Rodrigues, u ⊥ t):  t' = t·cosφ + (u×t)·sinφ
 *
 * Ownership (mirrors Last Circle's proven net model): a sim instance only
 * SIMULATES snakes it owns (local player, and bots when we're host/practice).
 * netRemote snakes are moved by the net layer (remoteFeed) but their bodies
 * still participate in local collision checks — each client has authority over
 * its OWN death only.
 */

// ── seeded rng ────────────────────────────────────────────────────────────────
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(a, b) { // int,int → 0..1 deterministic
  let h = (Math.imul(a, 0x85EBCA6B) ^ Math.imul(b, 0xC2B2AE35)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x27D4EB2F) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ── tiny vec3 (plain objects, allocation-conscious) ──────────────────────────
export const V = {
  make: (x = 0, y = 0, z = 0) => ({ x, y, z }),
  set: (o, x, y, z) => { o.x = x; o.y = y; o.z = z; return o; },
  copy: (o, a) => { o.x = a.x; o.y = a.y; o.z = a.z; return o; },
  add: (o, a, b) => { o.x = a.x + b.x; o.y = a.y + b.y; o.z = a.z + b.z; return o; },
  sub: (o, a, b) => { o.x = a.x - b.x; o.y = a.y - b.y; o.z = a.z - b.z; return o; },
  scale: (o, a, s) => { o.x = a.x * s; o.y = a.y * s; o.z = a.z * s; return o; },
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  cross: (o, a, b) => {
    const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x;
    o.x = x; o.y = y; o.z = z; return o;
  },
  len: (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z),
  norm: (o, a) => { const l = V.len(a) || 1; o.x = a.x / l; o.y = a.y / l; o.z = a.z / l; return o; },
  dist: (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2),
};
const _tmpA = V.make(), _tmpB = V.make(), _tmpC = V.make();

// angular (great-circle) distance between two unit vectors, radians
export function angDist(a, b) {
  const d = Math.min(1, Math.max(-1, V.dot(a, b)));
  return Math.acos(d);
}

// ── deterministic 3D value noise (shared by sim terrain + renderer displace) ─
function vhash(ix, iy, iz, seed) {
  let h = (Math.imul(ix, 0x9E3779B1) ^ Math.imul(iy, 0x85EBCA6B) ^ Math.imul(iz, 0xC2B2AE35) ^ Math.imul(seed | 0, 0x27D4EB2F)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2C1B3C6D) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297A2D39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
const _sm = (t) => t * t * (3 - 2 * t);
export function noise3(x, y, z, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = _sm(x - ix), fy = _sm(y - iy), fz = _sm(z - iz);
  let r = 0;
  for (let dz = 0; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
    const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
    r += w * vhash(ix + dx, iy + dy, iz + dz, seed);
  }
  return r; // 0..1
}
export function fbm3(x, y, z, seed = 0, oct = 3) {
  let a = 0.5, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f, seed + i * 101); n += a; a *= 0.5; f *= 2.13; }
  return s / n; // 0..1
}
/** terrain height offset at unit-sphere point u (world units, signed). */
export function terrainH(u, seed, amp = 1.6) {
  const n = fbm3(u.x * 2.3 + 7.7, u.y * 2.3 + 3.1, u.z * 2.3 + 9.4, seed, 4);
  return (n - 0.5) * 2 * amp;
}

// ── constants ────────────────────────────────────────────────────────────────
export const CONST = {
  R: 96,                 // planet radius (world units) — doubled from 48
  SLOTS: 12,             // total snakes in a match
  FOOD_TARGET: 1200,     // gems kept in the world (~same density on 4× surface)
  PATH_STEP: 0.30,       // arc distance between recorded path samples
  BASE_SPEED: 7.0,       // u/s
  BOOST_MULT: 1.78,
  TURN_RATE: 3.1,        // rad/s at base size
  START_MASS: 10,
  MASS_CAP: Infinity,    // no gameplay mass limit (was 620 → display length 1488)
  SEG_MAX: 2048,         // body sample budget per snake (GPU/collision ceiling; mass still uncapped)
  BOOST_DRAIN: 6.0,      // mass/s while boosting
  BOOST_MIN_MASS: 16,    // can't boost below this
  PELLET_EVERY: 0.55,    // s between dropped boost pellets
  SHIELD_TIME: 3.0,      // spawn invulnerability
  RESPAWN_BOT_MIN: 3.5, RESPAWN_BOT_MAX: 8.0,
  ESSENCE_TTL: 55,       // s before dropped essence fades
  PELLET_TTL: 30,
  MAGNET_R: 2.3,         // food gets pulled to head inside this
  TERRAIN_AMP: 1.6,
  PATH_CAP: 16384,       // ring buffer points per snake (long titans)
  THROTTLE_UP: 0.42,     // W / hold-forward: up to +42% speed (free, ramped)
  THROTTLE_DOWN: 0.28,   // S / RMB: down to −28% speed
  SELF_SKIP_ARC: 8,      // arc units of "neck" exempt from self-collision —
                         // the tightest legal turn keeps the head ~4.5u clear
                         // of its own path, so this only excludes the bend
};

// mass → visual/gameplay scale
export function segRadius(mass) { return 0.42 * (1 + Math.min(1.7, (mass - CONST.START_MASS) / 240)); }
// slither.io-style stubby start: mass 10 → ~6 segments. Grows with mass; body
// samples soft-capped only by SEG_MAX (mass itself is uncapped).
export function segCount(mass) { return Math.min(CONST.SEG_MAX, Math.max(5, Math.round(1 + mass * 0.5))); }
export function segSpacing(mass) { return segRadius(mass) * 1.18; }
export function turnRate(mass) { return CONST.TURN_RATE / (0.72 + segRadius(mass) * 0.75); }
export function speedOf(mass) { return CONST.BASE_SPEED * (1 - Math.min(0.18, (mass - CONST.START_MASS) / 2600)); }

// food tiers: [massValue, visual radius]
export const FOOD_TIERS = {
  0: { mass: 1.0, r: 0.30 },   // boost pellet
  1: { mass: 1.6, r: 0.38 },   // common gem
  2: { mass: 4.0, r: 0.55 },   // rich gem
  3: { mass: 9.0, r: 0.78 },   // rare gem
  9: { mass: 3.2, r: 0.62 },   // essence (value set per-orb, this is fallback)
};

// ── weather (pure function of time+seed+biome → identical on all clients) ────
export const BIOMES = ["verdant", "ember", "glacier", "dune", "abyss"];
const WEATHER_KINDS = {
  verdant: ["rain", "fireflies"],
  ember: ["ashstorm", "emberrain"],
  glacier: ["blizzard", "aurora"],
  dune: ["sandstorm", "heatwave"],
  abyss: ["sporestorm", "voidstorm"],
};
const WEATHER_MODS = {
  calm:      { speed: 1.00, turn: 1.00, food: 1.0, vis: 1.00 },
  rain:      { speed: 1.00, turn: 1.06, food: 1.6, vis: 0.82 },
  fireflies: { speed: 1.00, turn: 1.00, food: 1.3, vis: 1.00 },
  ashstorm:  { speed: 0.97, turn: 1.00, food: 1.4, vis: 0.62 },
  emberrain: { speed: 1.00, turn: 1.00, food: 1.5, vis: 0.88 },
  blizzard:  { speed: 0.93, turn: 0.97, food: 1.5, vis: 0.60 },
  aurora:    { speed: 1.03, turn: 1.00, food: 1.2, vis: 1.00 },
  sandstorm: { speed: 0.96, turn: 0.94, food: 1.6, vis: 0.55 },
  heatwave:  { speed: 1.06, turn: 1.00, food: 1.2, vis: 0.92 },
  sporestorm:{ speed: 1.00, turn: 1.00, food: 1.7, vis: 0.70 },
  voidstorm: { speed: 1.04, turn: 1.05, food: 1.4, vis: 0.85 },
};
/** deterministic weather at match-time t (s). Epochs: calm 38-64s, event 20-34s. */
export function weatherAt(biome, seed, t) {
  // walk epochs from t=0 (cheap: ~t/50 iterations, t is minutes at most)
  let time = 0, i = 0;
  const kinds = WEATHER_KINDS[biome] || ["rain", "fireflies"];
  while (i < 4000) {
    const calmLen = 38 + hash2(seed + i, 11) * 26;
    if (t < time + calmLen) {
      const into = t - time;
      const rampIn = Math.min(1, into / 4);
      return { kind: "calm", phase: (t - time) / calmLen, intensity: 0, mods: WEATHER_MODS.calm, ramp: rampIn, next: kinds[Math.floor(hash2(seed + i, 29) * kinds.length)] };
    }
    time += calmLen;
    const evLen = 20 + hash2(seed + i, 17) * 14;
    const kind = kinds[Math.floor(hash2(seed + i, 29) * kinds.length)];
    if (t < time + evLen) {
      const into = t - time;
      const ramp = Math.min(1, Math.min(into / 5, (evLen - into) / 5)); // ramp in/out
      const mods = WEATHER_MODS[kind];
      return {
        kind, phase: into / evLen, intensity: ramp,
        mods: {
          speed: 1 + (mods.speed - 1) * ramp, turn: 1 + (mods.turn - 1) * ramp,
          food: 1 + (mods.food - 1) * ramp, vis: 1 + (mods.vis - 1) * ramp,
        },
      };
    }
    time += evLen;
    i++;
  }
  return { kind: "calm", phase: 0, intensity: 0, mods: WEATHER_MODS.calm };
}

// ── snake path ring buffer ───────────────────────────────────────────────────
function pathInit(sn) {
  sn.path = new Float32Array(CONST.PATH_CAP * 3);
  sn.pathLen = new Float32Array(CONST.PATH_CAP); // cumulative arc length at sample
  sn.pathHead = 0;   // index of most recent sample
  sn.pathCount = 0;
  sn.pathTotal = 0;  // total arc length recorded (monotonic)
}
function pathPush(sn, u, step) {
  sn.pathHead = (sn.pathHead + 1) % CONST.PATH_CAP;
  const i3 = sn.pathHead * 3;
  sn.path[i3] = u.x; sn.path[i3 + 1] = u.y; sn.path[i3 + 2] = u.z;
  sn.pathTotal += step;
  sn.pathLen[sn.pathHead] = sn.pathTotal;
  sn.pathCount = Math.min(sn.pathCount + 1, CONST.PATH_CAP);
}
function pathAt(sn, idxBack, out) { // idxBack: 0 = newest
  const i = ((sn.pathHead - idxBack) % CONST.PATH_CAP + CONST.PATH_CAP) % CONST.PATH_CAP;
  const i3 = i * 3;
  out.x = sn.path[i3]; out.y = sn.path[i3 + 1]; out.z = sn.path[i3 + 2];
  return sn.pathLen[i];
}

/**
 * Fill segsOut (Float32Array len ≥ n*3) with n on-UNIT-SPHERE body sample
 * points, spaced `spacing` arc units apart, starting at the head. Returns n
 * actually written. Segment 0 = head position itself.
 */
export function bodyPoints(W, sn, segsOut, n, spacing) {
  let wrote = 0;
  // head first
  segsOut[0] = sn.u.x; segsOut[1] = sn.u.y; segsOut[2] = sn.u.z;
  wrote = 1;
  if (sn.pathCount < 2) return wrote;
  // distance from head to newest sample = arc since last push
  let want = spacing;
  const newestLen = sn.pathLen[sn.pathHead];
  const headExtra = sn._sinceSample || 0; // arc distance head is ahead of newest sample
  let ia = 0; // walking back: between sample ia and ia+1
  let la = newestLen + headExtra; // arc "position" of head measured in pathLen space
  const maxBack = sn.pathCount - 1;
  const pa = _tmpA, pb = _tmpB;
  while (wrote < n && ia < maxBack) {
    const lb = pathAt(sn, ia + 1, pb);       // older point
    const laCur = pathAt(sn, ia, pa);        // newer point
    // want-th distance behind head lies in [head - want]; convert to pathLen coordinate:
    const target = la - want;
    if (target > laCur) {
      // between head and newest sample (only possible for ia==0 and can't occur
      // while spacing > PATH_STEP; clamp to the newest sample to stay safe)
      const o = wrote * 3;
      segsOut[o] = pa.x; segsOut[o + 1] = pa.y; segsOut[o + 2] = pa.z;
      wrote++; want += spacing;
      continue;
    }
    if (target >= lb) {
      const span = Math.max(1e-6, laCur - lb);
      const t = (laCur - target) / span; // 0 at newer, 1 at older
      const x = pa.x * (1 - t) + pb.x * t, y = pa.y * (1 - t) + pb.y * t, z = pa.z * (1 - t) + pb.z * t;
      const il = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
      const o = wrote * 3;
      segsOut[o] = x * il; segsOut[o + 1] = y * il; segsOut[o + 2] = z * il;
      wrote++;
      want += spacing;
      continue;
    }
    ia++; // step to older pair
  }
  return wrote;
}

// ── world ────────────────────────────────────────────────────────────────────
export function createWorld(opts = {}) {
  const seed = (opts.seed != null ? opts.seed : 1234567) >>> 0;
  const rng = mulberry32(seed);
  const W = {
    seed, rng,
    biome: opts.biome || BIOMES[Math.floor(mulberry32(seed ^ 0xB105EED)() * BIOMES.length)],
    R: opts.R || CONST.R,
    time: 0,
    snakes: [],
    food: new Map(),      // id → {id, u:{x,y,z}, tier, value, r, ttl|null, born}
    foodIdN: 1,
    foodIdPrefix: opts.idPrefix || "f",   // per-client prefix so MP clients never collide
    events: [],           // drained by renderer/net: {type, ...}
    weather: weatherAt(opts.biome || "verdant", seed, 0),
    slots: opts.slots || CONST.SLOTS,
    foodTarget: Math.round((opts.foodTarget || CONST.FOOD_TARGET)),
    simulateBots: opts.simulateBots !== false, // host/practice = true
    deathCounts: {},      // slot → n (deterministic essence ids)
    _segScratch: new Float32Array((CONST.SEG_MAX + 4) * 3),
  };
  // initial food field
  while (W.food.size < W.foodTarget) spawnFood(W, null, 1 + (rng() < 0.15 ? 1 : 0) + (rng() < 0.03 ? 1 : 0));
  return W;
}

export function emit(W, ev) { if (W.events.length < 512) W.events.push(ev); }
export function drainEvents(W) { const e = W.events; W.events = []; return e; }

// random unit vector
function randUnit(rng, out) {
  let x, y, z, l;
  do { x = rng() * 2 - 1; y = rng() * 2 - 1; z = rng() * 2 - 1; l = x * x + y * y + z * z; } while (l < 0.001 || l > 1);
  const il = 1 / Math.sqrt(l);
  return V.set(out || V.make(), x * il, y * il, z * il);
}

export function spawnFood(W, at, tier = 1, value = null, ttl = null, id = null) {
  const u = at ? V.norm(V.make(), at) : randUnit(W.rng, V.make());
  const f = {
    id: id || (W.foodIdPrefix + (W.foodIdN++)),
    u, tier,
    value: value != null ? value : FOOD_TIERS[tier].mass,
    r: FOOD_TIERS[tier].r,
    ttl, born: W.time,
    seed: Math.floor(W.rng() * 1e9),
  };
  W.food.set(f.id, f);
  emit(W, { type: "foodAdd", f });
  return f;
}
export function removeFood(W, id, eatenBy = null) {
  const f = W.food.get(id);
  if (!f) return false;
  W.food.delete(id);
  emit(W, { type: "foodDel", id, eatenBy, tier: f.tier, u: f.u });
  return true;
}

/** world-space surface point for a unit vector (includes terrain height). */
export function surfacePoint(W, u, out, lift = 0) {
  const h = terrainH(u, W.seed, CONST.TERRAIN_AMP);
  const r = W.R + h + lift;
  return V.set(out || V.make(), u.x * r, u.y * r, u.z * r);
}

// ── snakes ───────────────────────────────────────────────────────────────────
export const SKINS = [
  { name: "Nova",    a: 0xff3d81, b: 0xffb703, glow: 0xff5c8a },
  { name: "Voltage", a: 0x00e5ff, b: 0x7c4dff, glow: 0x40c4ff },
  { name: "Toxin",   a: 0x76ff03, b: 0x00bfa5, glow: 0x76ff03 },
  { name: "Solar",   a: 0xffd600, b: 0xff6d00, glow: 0xffea00 },
  { name: "Frost",   a: 0x80d8ff, b: 0xe1f5fe, glow: 0x80d8ff },
  { name: "Ember",   a: 0xff3d00, b: 0xffab00, glow: 0xff6e40 },
  { name: "Orchid",  a: 0xea80fc, b: 0x536dfe, glow: 0xea80fc },
  { name: "Mint",    a: 0x64ffda, b: 0x18ffff, glow: 0x64ffda },
  { name: "Blood",   a: 0xd50000, b: 0xff8a80, glow: 0xff1744 },
  { name: "Ghost",   a: 0xf5f5f5, b: 0x90a4ae, glow: 0xcfd8dc },
];
export const BOT_NAMES = ["Zix", "Korath", "Mamba", "Noodle", "Sly", "Vypra", "Coilin", "Fang", "Sizzle", "Loop", "Twist", "Naga", "Basil", "Wyrm", "Kaa", "Slink", "Ouro", "Vex", "Hiss", "Rattle", "Momo", "Glide"];

export function spawnSnake(W, slot, o = {}) {
  let sn = W.snakes.find((s) => s.slot === slot);
  if (!sn) { sn = { slot }; W.snakes.push(sn); }
  const rng = W.rng;
  // safe spawn: min angular distance from other heads
  const u = V.make();
  let tries = 0;
  do { randUnit(rng, u); tries++; } while (
    tries < 60 &&
    W.snakes.some((s) => s !== sn && s.alive && angDist(u, s.u) < 22 / W.R)
  );
  // random tangent
  const ref = Math.abs(u.y) < 0.9 ? V.set(_tmpA, 0, 1, 0) : V.set(_tmpA, 1, 0, 0);
  const t = V.norm(V.make(), V.cross(V.make(), V.cross(_tmpB, ref, u), u));
  Object.assign(sn, {
    alive: true,
    isBot: o.isBot !== false,
    netRemote: !!o.netRemote,
    name: o.name || BOT_NAMES[(slot * 7 + Math.floor(rng() * BOT_NAMES.length)) % BOT_NAMES.length],
    skinId: o.skinId != null ? o.skinId : (slot + Math.floor(rng() * SKINS.length)) % SKINS.length,
    u, t,
    mass: o.mass != null ? o.mass : CONST.START_MASS,
    kills: sn.kills || 0,
    best: sn.best || 0,
    steer: 0, boost: false, throttle: 0, boostRamp: 0,
    shield: CONST.SHIELD_TIME,
    pelletT: 0,
    deathT: 0, respawnAt: null,
    _sinceSample: 0,
    segs: (sn.segs && sn.segs.length >= (CONST.SEG_MAX + 4) * 3) ? sn.segs : new Float32Array((CONST.SEG_MAX + 4) * 3),
    segN: 0,
    ai: sn.isBot || o.isBot !== false ? {
      thinkAt: W.time + rng() * 0.12,
      aggression: 0.25 + rng() * 0.65,
      greed: 0.5 + rng() * 0.5,
      caution: 0.35 + rng() * 0.6,
      wanderSeed: Math.floor(rng() * 1e9),
      boostUntil: 0,
    } : null,
  });
  if (o.name) sn.name = o.name;
  pathInit(sn);
  // pre-fill path BEHIND head so the body exists at spawn
  const back = V.make(), bt = V.make();
  V.copy(back, u); V.copy(bt, t);
  const pre = [];
  for (let d = 0; d < 240; d++) {
    const th = CONST.PATH_STEP / W.R;
    // walk backwards: u_prev = u cosθ − t sinθ ; t stays "forward"
    const nx = back.x * Math.cos(th) - bt.x * Math.sin(th);
    const ny = back.y * Math.cos(th) - bt.y * Math.sin(th);
    const nz = back.z * Math.cos(th) - bt.z * Math.sin(th);
    const tx = bt.x * Math.cos(th) + back.x * Math.sin(th);
    const ty = bt.y * Math.cos(th) + back.y * Math.sin(th);
    const tz = bt.z * Math.cos(th) + back.z * Math.sin(th);
    V.set(back, nx, ny, nz); V.norm(back, back);
    V.set(bt, tx, ty, tz);
    // re-orthonormalize tangent
    const d2 = V.dot(bt, back);
    V.set(bt, bt.x - back.x * d2, bt.y - back.y * d2, bt.z - back.z * d2);
    V.norm(bt, bt);
    pre.push([back.x, back.y, back.z]);
  }
  for (let i = pre.length - 1; i >= 0; i--) pathPush(sn, V.set(_tmpA, pre[i][0], pre[i][1], pre[i][2]), CONST.PATH_STEP);
  pathPush(sn, u, CONST.PATH_STEP);
  emit(W, { type: "spawn", slot: sn.slot });
  return sn;
}

export function snakeBySlot(W, slot) { return W.snakes.find((s) => s.slot === slot); }

export function setInput(W, slot, inp) {
  const sn = snakeBySlot(W, slot);
  if (!sn || !sn.alive) return;
  if (inp.steer != null) sn.steer = Math.max(-1, Math.min(1, inp.steer));
  if (inp.boost != null) sn.boost = !!inp.boost;
  // throttle ∈ [-1,1]: W ramps up (free, capped +42%), S/RMB slows (floor -28%).
  // Distinct from BOOST (space/LMB), which is faster still but burns mass.
  if (inp.throttle != null) sn.throttle = Math.max(-1, Math.min(1, inp.throttle));
}

/** helper: steer value that turns snake toward world-dir `d` (projected). */
export function steerToward(W, sn, d) {
  // project onto tangent plane at u
  const k = V.dot(d, sn.u);
  V.set(_tmpA, d.x - sn.u.x * k, d.y - sn.u.y * k, d.z - sn.u.z * k);
  if (V.len(_tmpA) < 1e-5) return 0;
  V.norm(_tmpA, _tmpA);
  const cosA = Math.max(-1, Math.min(1, V.dot(sn.t, _tmpA)));
  V.cross(_tmpB, sn.t, _tmpA);
  const sign = V.dot(_tmpB, sn.u) >= 0 ? 1 : -1;
  const ang = Math.acos(cosA) * sign;
  return Math.max(-1, Math.min(1, ang / 0.42)); // saturate ~24° off-heading
}

/** owner-death: kill snake, drop essence along its body. */
export function killSnake(W, sn, killerSlot = null, opts = {}) {
  if (!sn.alive) return;
  sn.alive = false;
  sn.deathT = W.time;
  sn.best = Math.max(sn.best || 0, Math.round(sn.mass));
  const dc = (W.deathCounts[sn.slot] = (W.deathCounts[sn.slot] || 0) + 1);
  // essence: one orb every 3rd segment, total value ≈ 58% of mass
  const n = Math.max(3, Math.floor(segCount(sn.mass) / 3));
  const per = (sn.mass * 0.58) / n;
  const spacing = segSpacing(sn.mass) * 3;
  const pts = W._segScratch;
  const wrote = bodyPoints(W, sn, pts, Math.min(n, CONST.SEG_MAX), spacing);
  const essence = [];
  for (let i = 0; i < wrote; i++) {
    const id = `e${sn.slot}_${dc}_${i}`;
    const u = V.make(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
    if (!opts.remoteEssence) {
      const f = spawnFood(W, u, 9, per, CONST.ESSENCE_TTL, id);
      essence.push(f);
    }
  }
  const killer = killerSlot != null ? snakeBySlot(W, killerSlot) : null;
  if (killer && killer !== sn) killer.kills = (killer.kills || 0) + 1;
  if (sn.isBot && W.simulateBots && !sn.netRemote) {
    sn.respawnAt = W.time + CONST.RESPAWN_BOT_MIN + W.rng() * (CONST.RESPAWN_BOT_MAX - CONST.RESPAWN_BOT_MIN);
  }
  emit(W, { type: "death", slot: sn.slot, killer: killerSlot, mass: sn.mass, essenceN: wrote, deathN: dc });
}

/** net layer feeds a remote snake's authoritative head sample. */
export function remoteFeed(W, sn, u, tHint, mass, boost) {
  if (!sn.alive) return;
  const prev = _tmpA; V.copy(prev, sn.u);
  V.norm(sn.u, u);
  if (tHint && V.len(tHint) > 0.5) {
    const k = V.dot(tHint, sn.u);
    V.set(sn.t, tHint.x - sn.u.x * k, tHint.y - sn.u.y * k, tHint.z - sn.u.z * k);
    V.norm(sn.t, sn.t);
  } else {
    // derive heading from motion
    const d = angDist(prev, sn.u);
    if (d > 1e-4) {
      V.sub(_tmpB, sn.u, V.scale(_tmpB, prev, V.dot(prev, sn.u)));
      V.norm(sn.t, _tmpB);
    }
  }
  if (mass != null) sn.mass = mass;
  if (boost != null) sn.boost = !!boost;
  // append to path (arc distance from previous head)
  const arc = angDist(prev, sn.u) * W.R;
  sn._sinceSample += arc;
  while (sn._sinceSample >= CONST.PATH_STEP) {
    sn._sinceSample -= CONST.PATH_STEP;
    pathPush(sn, sn.u, CONST.PATH_STEP);
  }
}

/** replace a snake's entire trail with the given on-sphere points
 * (oldest → newest, flat [x,y,z,...]) — used when taking over a bot mid-match. */
export function seedPath(W, sn, flatPts) {
  pathInit(sn);
  const n = Math.floor(flatPts.length / 3);
  for (let i = 0; i < n; i++) {
    V.set(_tmpA, flatPts[i * 3], flatPts[i * 3 + 1], flatPts[i * 3 + 2]);
    V.norm(_tmpA, _tmpA);
    pathPush(sn, _tmpA, CONST.PATH_STEP);
  }
  if (n) {
    const i3 = (n - 1) * 3;
    V.set(sn.u, flatPts[i3], flatPts[i3 + 1], flatPts[i3 + 2]);
    V.norm(sn.u, sn.u);
  }
  sn._sinceSample = 0;
}

/** attach a fresh AI brain (host adopting a disconnected human's snake). */
export function attachBrain(W, sn) {
  sn.isBot = true;
  sn.netRemote = false;
  sn.ai = {
    thinkAt: W.time,
    aggression: 0.25 + W.rng() * 0.65,
    greed: 0.5 + W.rng() * 0.5,
    caution: 0.35 + W.rng() * 0.6,
    wanderSeed: Math.floor(W.rng() * 1e9),
    boostUntil: 0,
  };
}

// ── AI ───────────────────────────────────────────────────────────────────────
const AI_STEERS = [0, 0.45, -0.45, 0.95, -0.95];
function aiThink(W, sn) {
  const ai = sn.ai;
  ai.thinkAt = W.time + 0.11 + hash2(ai.wanderSeed, Math.floor(W.time * 9)) * 0.05;
  const myR = segRadius(sn.mass);
  const spd = speedOf(sn.mass) * (sn.boost ? CONST.BOOST_MULT : 1);
  const horizon = 1.15; // s lookahead
  const tr = turnRate(sn.mass);

  let bestScore = -1e9, bestSteer = 0, wantBoost = false;

  // threat scan once: nearest bigger head aiming at us, and bodies near
  let fleeDir = null, threat = 0;
  for (const s2 of W.snakes) {
    if (s2 === sn || !s2.alive) continue;
    const dAng = angDist(sn.u, s2.u) * W.R;
    if (dAng < 9 && s2.mass > sn.mass * 1.15 && s2.shield <= 0) {
      // are they heading toward me?
      V.sub(_tmpA, sn.u, s2.u);
      const toward = V.dot(_tmpA, s2.t);
      if (toward > 0) {
        const th = (9 - dAng) / 9 * (0.5 + toward * 0.5);
        if (th > threat) {
          threat = th;
          fleeDir = V.sub(V.make(), sn.u, s2.u);
        }
      }
    }
  }

  for (const st of AI_STEERS) {
    // simulate arc: heading rotated by st*tr over time, position advanced
    let score = hash2(ai.wanderSeed + (st * 100) | 0, Math.floor(W.time * 2)) * 0.35; // wander tiebreak
    // sample 3 future points
    const su = V.copy(V.make(), sn.u), stan = V.copy(V.make(), sn.t);
    let dead = false;
    for (let k = 1; k <= 3; k++) {
      const dt = (horizon / 3);
      // rotate tangent
      const phi = st * tr * dt;
      V.cross(_tmpB, su, stan);
      V.set(stan,
        stan.x * Math.cos(phi) + _tmpB.x * Math.sin(phi),
        stan.y * Math.cos(phi) + _tmpB.y * Math.sin(phi),
        stan.z * Math.cos(phi) + _tmpB.z * Math.sin(phi));
      const th = (spd * dt) / W.R;
      const c = Math.cos(th), s = Math.sin(th);
      V.set(su, su.x * c + stan.x * s, su.y * c + stan.y * s, su.z * c + stan.z * s);
      V.norm(su, su);
      const d2 = V.dot(stan, su);
      V.set(stan, stan.x - su.x * d2, stan.y - su.y * d2, stan.z - su.z * d2);
      V.norm(stan, stan);
      // danger: proximity to any snake body sample (own body included, past
      // the same neck window used for the real self-collision rule)
      for (const s2 of W.snakes) {
        const isSelf = s2 === sn;
        if (!s2.alive || (!isSelf && s2.shield > 0)) continue;
        if (!isSelf) {
          const gap = angDist(su, s2.u) * W.R;
          const reach = segCount(s2.mass) * segSpacing(s2.mass);
          if (gap > reach + 4) continue;
        }
        // sample the body coarsely (every 6th cached seg)
        for (let i = isSelf ? selfSkipSegs(sn) : 0; i < s2.segN; i += 6) {
          const dx = su.x - s2.segs[i * 3], dy = su.y - s2.segs[i * 3 + 1], dz = su.z - s2.segs[i * 3 + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * W.R; // segs are unit-sphere pts
          const kill = (myR + segRadius(s2.mass)) / W.R * W.R * 1.15 + 0.55;
          if (d < kill) { score -= 4000 / k; dead = true; break; }
          else if (d < kill + 3.2) score -= (kill + 3.2 - d) * (26 / k);
        }
        if (dead) break;
      }
      if (dead) break;
      // food attraction at this sample
      let fscore = 0;
      for (const f of W.food.values()) {
        const d = angDist(su, f.u) * W.R;
        if (d < 5.5) fscore += (f.tier === 9 ? 2.6 : 1) * f.value * (1 - d / 5.5);
      }
      score += fscore * ai.greed * (1.15 - k * 0.25);
    }
    // flee bias
    if (fleeDir && threat > 0.15) {
      // score steering options by alignment with fleeDir after first rotation
      const phi = st * tr * 0.4;
      V.cross(_tmpB, sn.u, sn.t);
      V.set(_tmpC,
        sn.t.x * Math.cos(phi) + _tmpB.x * Math.sin(phi),
        sn.t.y * Math.cos(phi) + _tmpB.y * Math.sin(phi),
        sn.t.z * Math.cos(phi) + _tmpB.z * Math.sin(phi));
      const k2 = V.dot(fleeDir, sn.u);
      V.set(_tmpA, fleeDir.x - sn.u.x * k2, fleeDir.y - sn.u.y * k2, fleeDir.z - sn.u.z * k2);
      if (V.len(_tmpA) > 1e-4) {
        V.norm(_tmpA, _tmpA);
        score += V.dot(_tmpC, _tmpA) * threat * ai.caution * 160;
      }
    }
    if (score > bestScore) { bestScore = score; bestSteer = st; }
  }

  // hunting: cut in front of a smaller nearby snake
  if (threat < 0.2 && ai.aggression > 0.45) {
    for (const s2 of W.snakes) {
      if (s2 === sn || !s2.alive || s2.shield > 0 || s2.mass * 1.35 > sn.mass) continue;
      const d = angDist(sn.u, s2.u) * W.R;
      if (d < 7.5 && d > 2.0) {
        // aim at point ahead of their head
        const lead = Math.min(3.4, d * 0.55) / W.R;
        const c = Math.cos(lead), s = Math.sin(lead);
        V.set(_tmpA, s2.u.x * c + s2.t.x * s, s2.u.y * c + s2.t.y * s, s2.u.z * c + s2.t.z * s);
        const cut = steerToward(W, sn, _tmpA);
        bestSteer = bestSteer * 0.35 + cut * 0.65;
        if (d < 4.5 && hash2(ai.wanderSeed, Math.floor(W.time * 3)) < ai.aggression * 0.5) {
          ai.boostUntil = W.time + 0.5;
        }
        break;
      }
    }
  }
  if (threat > 0.5 && sn.mass > CONST.BOOST_MIN_MASS + 8) ai.boostUntil = W.time + 0.45;

  sn.steer = bestSteer;
  wantBoost = W.time < ai.boostUntil && sn.mass > CONST.BOOST_MIN_MASS + 4;
  sn.boost = wantBoost;
}

// ── main step ────────────────────────────────────────────────────────────────
export function step(W, dt) {
  dt = Math.min(0.05, Math.max(0.0005, dt));
  W.time += dt;
  W.weather = weatherAt(W.biome, W.seed, W.time);
  const wm = W.weather.mods;

  // bot respawns
  if (W.simulateBots) {
    for (const sn of W.snakes) {
      if (!sn.alive && sn.isBot && !sn.netRemote && sn.respawnAt != null && W.time >= sn.respawnAt) {
        sn.respawnAt = null;
        spawnSnake(W, sn.slot, { isBot: true, skinId: sn.skinId, name: sn.name });
      }
    }
  }

  // movement + trails for locally-simulated snakes
  for (const sn of W.snakes) {
    if (!sn.alive) continue;
    if (sn.shield > 0) sn.shield -= dt;
    if (sn.netRemote) { computeSegs(W, sn); continue; }
    if (sn.isBot && W.simulateBots && sn.ai && W.time >= sn.ai.thinkAt) aiThink(W, sn);

    // BOOST (owner round 2: W/LMB/SPACE are ONE control): while held — and only
    // above the mass floor — speed RAMPS UP over ~0.9s ("longer you hold,
    // faster it goes") toward BOOST_MULT; mass drain scales with the ramp.
    const canBoost = sn.boost && sn.mass > CONST.BOOST_MIN_MASS;
    sn.boostRamp = Math.max(0, Math.min(1, (sn.boostRamp || 0) + (canBoost ? dt / 0.9 : -dt / 0.45)));
    const boosting = canBoost && sn.boostRamp > 0.12;
    if (canBoost && sn.boostRamp > 0.1) {
      sn.mass = Math.max(CONST.BOOST_MIN_MASS - 0.01, sn.mass - CONST.BOOST_DRAIN * sn.boostRamp * dt);
      sn.pelletT += dt;
      if (sn.pelletT >= CONST.PELLET_EVERY) {
        sn.pelletT = 0;
        // drop a pellet at the tail
        const nseg = segCount(sn.mass);
        const wrote = bodyPoints(W, sn, W._segScratch, Math.min(nseg, CONST.SEG_MAX), segSpacing(sn.mass));
        if (wrote > 2) {
          const i3 = (wrote - 1) * 3;
          spawnFood(W, V.set(_tmpA, W._segScratch[i3], W._segScratch[i3 + 1], W._segScratch[i3 + 2]), 0, 1.0, CONST.PELLET_TTL);
        }
      }
    } else sn.pelletT = 0;
    sn.boosting = boosting;

    // steer: rotate tangent around u
    const tr = turnRate(sn.mass) * wm.turn;
    const phi = sn.steer * tr * dt;
    if (phi !== 0) {
      V.cross(_tmpB, sn.u, sn.t);
      const c = Math.cos(phi), s = Math.sin(phi);
      V.set(sn.t,
        sn.t.x * c + _tmpB.x * s,
        sn.t.y * c + _tmpB.y * s,
        sn.t.z * c + _tmpB.z * s);
    }
    // advance along great circle. Speed = base × ramped boost × slow-throttle
    // (S/RMB, negative only from inputs) × weather. The ramp IS the boost:
    // 1.0 → BOOST_MULT as boostRamp builds; the slow lever is ignored while
    // meaningfully boosting so W+S don't fight.
    const boostMul = 1 + (CONST.BOOST_MULT - 1) * sn.boostRamp;
    const th01 = sn.throttle || 0;
    const throttleMul = sn.boostRamp > 0.3 ? 1 : (1 + (th01 > 0 ? CONST.THROTTLE_UP * th01 : CONST.THROTTLE_DOWN * th01));
    const spd = speedOf(sn.mass) * boostMul * throttleMul * wm.speed;
    const th = (spd * dt) / W.R;
    {
      const c = Math.cos(th), s = Math.sin(th);
      const ux = sn.u.x * c + sn.t.x * s, uy = sn.u.y * c + sn.t.y * s, uz = sn.u.z * c + sn.t.z * s;
      const tx = sn.t.x * c - sn.u.x * s, ty = sn.t.y * c - sn.u.y * s, tz = sn.t.z * c - sn.u.z * s;
      V.set(sn.u, ux, uy, uz); V.norm(sn.u, sn.u);
      V.set(sn.t, tx, ty, tz);
      const d = V.dot(sn.t, sn.u);
      V.set(sn.t, sn.t.x - sn.u.x * d, sn.t.y - sn.u.y * d, sn.t.z - sn.u.z * d);
      V.norm(sn.t, sn.t);
    }
    // record path
    sn._sinceSample += spd * dt;
    while (sn._sinceSample >= CONST.PATH_STEP) {
      sn._sinceSample -= CONST.PATH_STEP;
      pathPush(sn, sn.u, CONST.PATH_STEP);
    }
    computeSegs(W, sn);
  }

  // food: magnet + eating (locally simulated snakes only — owner authority)
  const eatList = [];
  for (const sn of W.snakes) {
    if (!sn.alive || sn.netRemote) continue;
    if (sn.isBot && !W.simulateBots) continue;
    const headR = segRadius(sn.mass);
    const eatR = (headR + 0.55) / W.R;      // radians
    const magR = CONST.MAGNET_R / W.R;
    for (const f of W.food.values()) {
      const d = angDist(sn.u, f.u);
      if (d < eatR + f.r / W.R) {
        eatList.push([sn, f]);
      } else if (d < magR) {
        // pull food toward head along the sphere
        const pull = (1 - d / magR) * 6.5 * dt;
        V.set(_tmpA,
          f.u.x + (sn.u.x - f.u.x) * pull,
          f.u.y + (sn.u.y - f.u.y) * pull,
          f.u.z + (sn.u.z - f.u.z) * pull);
        V.norm(f.u, _tmpA);
      }
    }
  }
  for (const [sn, f] of eatList) {
    if (!W.food.has(f.id)) continue; // already eaten this tick
    removeFood(W, f.id, sn.slot);
    sn.mass = sn.mass + f.value; // no mass ceiling
    emit(W, { type: "eat", slot: sn.slot, tier: f.tier, value: f.value, u: f.u });
  }

  // food TTL + respawn to target (respawn only when we own the world food —
  // i.e. simulateBots true = practice/host; guests receive spawns via net)
  for (const f of Array.from(W.food.values())) {
    if (f.ttl != null && W.time - f.born > f.ttl) removeFood(W, f.id);
  }
  if (W.simulateBots) {
    const want = Math.round(W.foodTarget * wm.food);
    let live = 0;
    for (const f of W.food.values()) if (f.tier !== 0 && f.tier !== 9) live++;
    const rate = 26 * dt; // max spawns/s
    let spawned = 0;
    while (live + spawned < want && spawned < rate) {
      const r = W.rng();
      spawnFood(W, null, r < 0.03 ? 3 : r < 0.18 ? 2 : 1);
      spawned++;
    }
  }

  // collisions — only for snakes WE own (owner-authority deaths)
  const dead = [];
  for (const sn of W.snakes) {
    if (!sn.alive || sn.netRemote || sn.shield > 0) continue;
    if (sn.isBot && !W.simulateBots) continue;
    const myR = segRadius(sn.mass);
    // SELF-collision: crossing your own body is death. The neck window skips
    // as much body as the tightest possible turn circle (at full boost speed)
    // can bring back to the head, so ordinary curling never false-kills.
    const skipN = selfSkipSegs(sn);
    let selfHit = false;
    for (let i = skipN; i < sn.segN; i++) {
      const dx = sn.u.x - sn.segs[i * 3], dy = sn.u.y - sn.segs[i * 3 + 1], dz = sn.u.z - sn.segs[i * 3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * W.R;
      if (d < myR * 0.72 + myR * 0.9) { selfHit = true; break; }
    }
    if (selfHit) { dead.push([sn, sn.slot]); continue; }
    for (const s2 of W.snakes) {
      if (s2 === sn || !s2.alive || s2.shield > 0) continue;
      // broadphase: my head vs their whole body reach
      const reach = (segCount(s2.mass) * segSpacing(s2.mass) + 6) / W.R;
      const hh = angDist(sn.u, s2.u);
      if (hh > reach) continue;
      // head-vs-head
      const headKill = (myR * 0.82 + segRadius(s2.mass) * 0.82) ;
      if (hh * W.R < headKill) {
        dead.push([sn, s2.slot]);
        break;
      }
      // my head vs their body segments (skip their first 3 segs = their head zone, handled above)
      const n = s2.segN;
      let hit = false;
      for (let i = 3; i < n; i++) {
        const dx = sn.u.x - s2.segs[i * 3], dy = sn.u.y - s2.segs[i * 3 + 1], dz = sn.u.z - s2.segs[i * 3 + 2];
        // chord distance on unit sphere ≈ angle for small d; convert to world
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * W.R;
        if (d < myR * 0.78 + segRadius(s2.mass) * 0.9) { hit = true; break; }
      }
      if (hit) { dead.push([sn, s2.slot]); break; }
    }
  }
  for (const [sn, killer] of dead) killSnake(W, sn, killer);

  return W;
}

/** segments to ignore for self-collision — the NECK only.
 * v3 bug (owner: "I hit my tail and lived"): this window used the whole
 * boost-circle CIRCUMFERENCE (~29u), which exceeds a small/medium snake's
 * entire body, silently disabling self-collision. The geometry only requires
 * a few units: on the tightest legal circle (slow-throttle 0.72× speed,
 * +6% weather turn) the head-to-segment chord at arc s is 2R·sin(s/2R),
 * which already exceeds the kill distance at s ≈ 1.5u for every mass; skip
 * ~3.2u (scaled up for girth) and everything past the bend is collidable. */
export function selfSkipSegs(sn) {
  const arc = Math.max(3.2, segRadius(sn.mass) * 4.5);
  return 3 + Math.ceil(arc / segSpacing(sn.mass));
}

/** compute + cache world segment sample points (UNIT sphere) for a snake. */
export function computeSegs(W, sn) {
  const n = Math.min(segCount(sn.mass), CONST.SEG_MAX);
  if (!sn.segs || sn.segs.length < n * 3) sn.segs = new Float32Array((CONST.SEG_MAX + 4) * 3);
  sn.segN = bodyPoints(W, sn, sn.segs, n, segSpacing(sn.mass));
  return sn.segN;
}

/** leaderboard: alive snakes sorted by mass desc. */
export function ranking(W) {
  return W.snakes.filter((s) => s.alive).sort((a, b) => b.mass - a.mass);
}

// compact state hash for determinism tests
export function stateHash(W) {
  let h = 0;
  const mix = (x) => { h = (Math.imul(h ^ ((x * 8192) | 0), 0x9E3779B1) >>> 0); };
  for (const sn of W.snakes) {
    mix(sn.alive ? 1 : 0); mix(sn.u.x); mix(sn.u.y); mix(sn.u.z); mix(sn.mass);
  }
  mix(W.food.size);
  return h >>> 0;
}
