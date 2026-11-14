// core/sim/attachments.js — GUNSMITH: weapon attachments + camos (data, stat
// modifiers, validation, effective weapon tables). THREE-free, DOM-free,
// deterministic. Shared by the sim (spawn kits -> per-body effective weapon
// tables), the class store / class editor (validation, stat bars, lock keys)
// and the view (which optic / muzzle device / camo to show).
//
// MODEL
//   A BUILD is what a class carries per weapon:  { attach: [ids], camo: id|null }
//   `attach` holds only NON-FACTORY choices (one per slot). Every weapon ships
//   with FACTORY parts (the Warden's red dot, the Vesper's integral suppressor,
//   the Corvus' scope ...) whose effect is already inside weapon_data.js — a
//   build with no attachments IS the weapon exactly as it was before this file
//   existed (the selftest proves the table is the same object).
//   An attachment in a slot that has a factory part REPLACES that part.
//
// EVERY NUMBER LIVES IN `GUNSMITH` BELOW. Nothing else in the game hard-codes
// an attachment effect: the sim reads effective tables built here, the class
// editor draws bars from statLine() and writes its trade-off text from the same
// mods, so the words cannot drift from the numbers.
//
// PVP wording rule: player-facing text here names other combatants operators
// only.

// ------------------------------------------------------------------ slots
export const SLOTS = ["optic", "muzzle", "under", "mag", "receiver"];
export const SLOT_NAMES = { optic: "OPTIC", muzzle: "MUZZLE", under: "UNDERBARREL", mag: "MAGAZINE", receiver: "RECEIVER" };
// at most this many non-factory attachments on one weapon (5 slots: pick 4)
export const MAX_ATTACH = 4;

// ------------------------------------------------------------------ THE TABLE
// mods (all optional; multipliers unless noted):
//   adsTime    aim-down-sight time            range     falloffStart + falloffEnd
//   recoilV    vertical recoil (pattern pitch) recoilH   horizontal recoil (pattern yaw)
//   hipSpread  hip-fire cone                   sprintOut sprint-to-fire delay
//   move       all movement speed              adsMove   aimed walk speed
//   reload     magazine reload time            rpm       fire rate
//   suppressed (bool) no flash/report signature off the shot event; noTracer (bool)
// per-weapon numbers (magazine size, optic zoom) live in GUNSMITH.weapons.
export const GUNSMITH = {
  attachments: {
    // ---- optics (zoom per weapon: weapons[w].optics[id].adsFov)
    irons:   { slot: "optic", name: "IRON SIGHTS", short: "IRONS",
      blurb: "Fold-up iron sights. Nothing between you and the target but a post.",
      mods: { adsTime: 0.94 } },
    reddot:  { slot: "optic", name: "RED DOT", short: "DOT",
      blurb: "Compact reflex sight. One clean dot, small window.",
      mods: { adsTime: 1.04 } },
    holo:    { slot: "optic", name: "HOLO SIGHT", short: "HOLO",
      blurb: "Wide-window holographic sight with a ring reticle and a touch of magnification.",
      mods: { adsTime: 1.07 } },
    scope:   { slot: "optic", name: "VARIABLE SCOPE", short: "SCOPE",
      blurb: "Magnified riflescope. Long sight lines, slow to shoulder, heavy on the move.",
      mods: { adsTime: 1.30, adsMove: 0.85 } },
    // ---- muzzle
    suppressor:  { slot: "muzzle", name: "SUPPRESSOR", short: "SUPP",
      blurb: "Kills the flash and most of the report: your shots do not light you up. Rounds lose energy sooner.",
      mods: { suppressed: true, noTracer: true, range: 0.85, adsTime: 1.03 } },
    compensator: { slot: "muzzle", name: "COMPENSATOR", short: "COMP",
      blurb: "Ported muzzle that pushes the barrel back down. Heavier up front.",
      mods: { recoilV: 0.80, adsTime: 1.06 } },
    // ---- underbarrel
    grip:  { slot: "under", name: "FORE GRIP", short: "GRIP",
      blurb: "Vertical grip for a steadier side-to-side pattern. Extra weight slows you down.",
      mods: { recoilH: 0.70, recoilV: 0.95, move: 0.96 } },
    laser: { slot: "under", name: "LASER MODULE", short: "LASER",
      blurb: "Visible beam that tightens hip fire and speeds up the first shot out of a sprint.",
      mods: { hipSpread: 0.75, sprintOut: 0.85, adsTime: 1.04 } },
    // ---- magazine (rounds per weapon: weapons[w].extmag)
    extmag: { slot: "mag", name: "EXTENDED MAG", short: "EXT MAG",
      blurb: "More rounds per magazine. Longer and heavier to swap.",
      mods: { reload: 1.15, adsTime: 1.03 } },
    // ---- receiver
    rapidfire: { slot: "receiver", name: "RAPID FIRE", short: "RAPID",
      blurb: "Lightened bolt and a crisper trigger: faster cycling, harder to hold on target.",
      mods: { rpm: 1.12, recoilV: 1.15, recoilH: 1.15 } },
  },

  // Per weapon: what fits, what ships on it, and the per-weapon numbers.
  //   factory   slot -> factory part id (shown as the default choice; free, never locked)
  //   slots     slot -> attachment ids that fit (factory ids included)
  //   optics    optic id -> { adsFov (deg, world FOV at full ADS), adsTime (x base),
  //             scope (full-screen lens) } — the FACTORY optic entry is identity
  //   extmag    rounds per magazine with EXTENDED MAG
  weapons: {
    warden: {
      factory: { optic: "reddot", muzzle: "flash" },
      slots: { optic: ["reddot", "irons", "holo", "scope"], muzzle: ["flash", "suppressor", "compensator"],
               under: ["grip", "laser"], mag: ["extmag"], receiver: ["rapidfire"] },
      optics: { reddot: { adsFov: 55, adsTime: 1 }, irons: { adsFov: 57, adsTime: 0.94 },
                holo: { adsFov: 50, adsTime: 1.07 }, scope: { adsFov: 30, adsTime: 1.30, scope: true } },
      extmag: 40,
    },
    vesper: {
      factory: { optic: "reddot", muzzle: "suppressor" },
      slots: { optic: ["reddot", "irons", "holo"], muzzle: ["suppressor", "compensator"],
               under: ["grip", "laser"], mag: ["extmag"], receiver: ["rapidfire"] },
      optics: { reddot: { adsFov: 58, adsTime: 1 }, irons: { adsFov: 60, adsTime: 0.94 },
                holo: { adsFov: 53, adsTime: 1.07 } },
      extmag: 45,
    },
    corvus: {
      factory: { optic: "scope", muzzle: "brake" },
      slots: { optic: ["scope", "reddot", "holo"], muzzle: ["brake", "suppressor", "compensator"],
               under: ["grip", "laser"], mag: ["extmag"], receiver: ["rapidfire"] },
      // swapping the factory scope for a 1x-ish optic: a much faster shoulder
      optics: { scope: { adsFov: 21.5, adsTime: 1, scope: true }, reddot: { adsFov: 52, adsTime: 0.80 },
                holo: { adsFov: 47, adsTime: 0.84 } },
      extmag: 20,
    },
    breaker: {
      factory: { optic: "irons" },
      slots: { optic: ["irons", "reddot", "holo"], muzzle: ["suppressor"],
               under: ["laser"], mag: ["extmag"], receiver: ["rapidfire"] },
      optics: { irons: { adsFov: 56, adsTime: 1 }, reddot: { adsFov: 55, adsTime: 1.05 },
                holo: { adsFov: 52, adsTime: 1.08 } },
      extmag: 8,
    },
    pike: {
      factory: { optic: "irons" },
      slots: { optic: ["irons", "reddot"], muzzle: ["suppressor", "compensator"],
               under: ["laser"], mag: ["extmag"], receiver: ["rapidfire"] },
      optics: { irons: { adsFov: 60, adsTime: 1 }, reddot: { adsFov: 57, adsTime: 1.06 } },
      extmag: 17,
    },
  },
};

// factory-only parts (never selectable as attachments on another weapon; names for the UI)
export const FACTORY_NAMES = { flash: "FLASH HIDER", brake: "MUZZLE BRAKE" };

export const ATTACH_IDS = Object.keys(GUNSMITH.attachments);
export const ATTACHMENTS = GUNSMITH.attachments;

export function attachName(id) {
  return (ATTACHMENTS[id] && ATTACHMENTS[id].name) || FACTORY_NAMES[id] || String(id || "").toUpperCase();
}
export function slotOfAttachment(id) { return ATTACHMENTS[id] ? ATTACHMENTS[id].slot : null; }
export function weaponSpec(weaponId) { return GUNSMITH.weapons[weaponId] || null; }
export function factoryPart(weaponId, slot) {
  const s = GUNSMITH.weapons[weaponId];
  return (s && s.factory && s.factory[slot]) || null;
}
/** ids that fit `slot` on `weaponId` (factory part first when there is one). */
export function slotOptions(weaponId, slot) {
  const s = GUNSMITH.weapons[weaponId];
  return s && s.slots[slot] ? s.slots[slot].slice() : [];
}
/** Progression key for an attachment (factory parts: null = always available). */
export function attachKey(weaponId, id) {
  if (factoryPart(weaponId, slotOfAttachment(id) || "") === id) return null;
  if (id === "irons") return null; // folding irons ship in the box
  return "attach:" + weaponId + ":" + id;
}

// ------------------------------------------------------------------ camos
// Nine camos. `key` is the progression gate (weapon camos ride the weapon
// ladder, the rest the player level). Colours are sRGB hex; `kind` picks the
// procedural pattern in weapon_meshes.js (no texture files: zero payload).
export const CAMOS = {
  gunmetal:   { id: "gunmetal",   name: "GUNMETAL",   scope: "weapon", kind: "solid",   colors: ["#3a3f45", "#23272c", "#5a6168"] },
  nightglass: { id: "nightglass", name: "NIGHTGLASS", scope: "weapon", kind: "glass",   colors: ["#0d1626", "#142238", "#3d6ea8"] },
  lantern:    { id: "lantern",    name: "LANTERN",    scope: "weapon", kind: "brushed", colors: ["#5a3d17", "#2e1f0c", "#b7832f"] },
  harbour:    { id: "harbour",    name: "HARBOUR",    scope: "player", kind: "digital", colors: ["#2c3a4a", "#4c5d6e", "#18212b"] },
  tidewater:  { id: "tidewater",  name: "TIDEWATER",  scope: "player", kind: "waves",   colors: ["#24453f", "#6b6a52", "#14262a"] },
  rustline:   { id: "rustline",   name: "RUSTLINE",   scope: "player", kind: "blotch",  colors: ["#5c2e17", "#3a2514", "#7d5a3a"] },
  slate:      { id: "slate",      name: "SLATE",      scope: "player", kind: "splinter",colors: ["#3c3f42", "#26282a", "#4b4f52"] },
  ember:      { id: "ember",      name: "EMBER",      scope: "player", kind: "cracks",  colors: ["#161210", "#2a1a12", "#d0461a"] },
  blackridge: { id: "blackridge", name: "BLACKRIDGE", scope: "player", kind: "topo",    colors: ["#111214", "#1d1f22", "#4f8f7a"] },
};
export const CAMO_IDS = Object.keys(CAMOS);
export function camoKey(weaponId, camoId) {
  const c = CAMOS[camoId];
  if (!c) return null;
  return c.scope === "weapon" ? "camo:" + weaponId + ":" + camoId : "camo:" + camoId;
}

// ------------------------------------------------------------------ builds
export const EMPTY_BUILD = Object.freeze({ attach: Object.freeze([]), camo: null });

/** Repair a stored build for `weaponId`: unknown / incompatible / factory /
 *  duplicate-slot ids dropped, canonical slot order, at most MAX_ATTACH, camo
 *  must be a known id. Returns { build, fixed }. */
export function validateBuild(weaponId, b) {
  const spec = GUNSMITH.weapons[weaponId];
  let fixed = 0;
  if (b != null && typeof b !== "object") fixed++;
  const src = b && typeof b === "object" ? b : {};
  const inA = Array.isArray(src.attach) ? src.attach : [];
  if (src.attach != null && !Array.isArray(src.attach)) fixed++;
  const bySlot = {};
  for (const id of inA) {
    const a = ATTACHMENTS[id];
    if (!spec || !a || spec.slots[a.slot].indexOf(id) < 0 || bySlot[a.slot]) { fixed++; continue; }
    if (spec.factory[a.slot] === id) { fixed++; continue; } // the factory part is not an attachment
    bySlot[a.slot] = id;
  }
  let attach = SLOTS.map((s) => bySlot[s]).filter(Boolean);
  if (attach.length > MAX_ATTACH) { fixed += attach.length - MAX_ATTACH; attach = attach.slice(0, MAX_ATTACH); }
  // canonical order changed?
  if (!fixed && attach.join(",") !== inA.join(",")) fixed++;
  let camo = src.camo == null ? null : src.camo;
  if (camo !== null && !CAMOS[camo]) { fixed++; camo = null; }
  return { build: { attach, camo }, fixed };
}

/** Drop locked attachments / camo (resolveKit's progression gate). */
export function gateBuild(weaponId, build, ok) {
  const attach = build.attach.filter((id) => { const k = attachKey(weaponId, id); return !k || ok(k); });
  const camo = build.camo && ok(camoKey(weaponId, build.camo)) ? build.camo : null;
  return { attach, camo };
}

export function attachInSlot(build, slot) {
  if (!build || !build.attach) return null;
  for (const id of build.attach) if (ATTACHMENTS[id] && ATTACHMENTS[id].slot === slot) return id;
  return null;
}
/** The part that is actually on the gun in `slot` (attachment, else factory, else null). */
export function partInSlot(weaponId, build, slot) {
  return attachInSlot(build, slot) || factoryPart(weaponId, slot);
}

// ------------------------------------------------------------- opponents
// Plausible builds for every other operator, a pure function of
// (seed, actorId, weaponId) through the caller's integer hash — consumes no
// rng stream. Role shapes what they run (a marksman keeps the scope, an entry
// man likes a laser); counts are 0..3.
const ROLE_LIKES = {
  cqb:      { optic: ["reddot", "holo", null], muzzle: ["suppressor", null, null], under: ["laser", "grip"], mag: ["extmag", null], receiver: ["rapidfire", null, null] },
  rifleman: { optic: ["holo", "reddot", null, null], muzzle: ["compensator", "suppressor", null], under: ["grip", "laser", null], mag: ["extmag", null, null], receiver: [null, null, "rapidfire"] },
  marksman: { optic: [null, null, "holo"], muzzle: ["suppressor", "compensator", null], under: ["grip", null], mag: ["extmag", null], receiver: [null, null, "rapidfire"] },
};
export function opponentBuild(hash, seed, actorId, weaponId, role, salt) {
  const spec = GUNSMITH.weapons[weaponId];
  if (!spec) return { attach: [], camo: null };
  const likes = ROLE_LIKES[role] || ROLE_LIKES.rifleman;
  const want = (hash(seed, actorId, 40 + (salt | 0)) % 4); // 0..3 attachments
  const order = SLOTS.slice();
  // rotate the slot order so the first `want` picks differ per operator
  const rot = hash(seed, actorId, 41 + (salt | 0)) % order.length;
  const slots = order.slice(rot).concat(order.slice(0, rot));
  const picks = [];
  for (let i = 0; i < slots.length && picks.length < want; i++) {
    const s = slots[i];
    const pool = likes[s] || [null];
    const id = pool[hash(seed, actorId, 50 + i + 7 * (salt | 0)) % pool.length];
    if (id && spec.slots[s].indexOf(id) >= 0 && spec.factory[s] !== id) picks.push(id);
  }
  const camoRoll = hash(seed, actorId, 60 + (salt | 0)) % (CAMO_IDS.length + 4);
  const camo = camoRoll < CAMO_IDS.length ? CAMO_IDS[camoRoll] : null;
  return validateBuild(weaponId, { attach: picks, camo }).build;
}

// --------------------------------------------------------- effective table
// The weapon a body ACTUALLY fires: base table (already pvp-tuned by the sim)
// with the build's mods folded in. Pure; memoised per (base table, attach set).
const _memo = new WeakMap(); // base table -> Map(key -> effective)

export function effectiveWeapon(base, weaponId, attach) {
  if (!base || !attach || !attach.length || !GUNSMITH.weapons[weaponId]) return base;
  let m = _memo.get(base);
  if (!m) { m = new Map(); _memo.set(base, m); }
  const key = attach.join(",");
  let t = m.get(key);
  if (!t) { t = buildEffective(base, weaponId, attach); m.set(key, t); }
  return t;
}

function r4(x) { return Math.round(x * 1e6) / 1e6; }

function buildEffective(base, weaponId, attach) {
  const spec = GUNSMITH.weapons[weaponId];
  const t = Object.assign({}, base);
  t.damage = Object.assign({}, base.damage);
  t.spread = Object.assign({}, base.spread);
  t.recoil = Object.assign({}, base.recoil);
  t.view = Object.assign({}, base.view || {});
  if (base.reload) t.reload = Object.assign({}, base.reload);
  let adsT = 1, range = 1, rv = 1, rh = 1, hip = 1, sprintOut = 1, move = 1, adsMove = 1, reload = 1, rpm = 1;
  let optic = spec.factory.optic || null;
  for (const id of attach) {
    const a = ATTACHMENTS[id];
    if (!a) continue;
    const md = a.mods || {};
    if (a.slot === "optic") {
      optic = id;
      const o = spec.optics[id];
      if (o) adsT *= o.adsTime;          // per-weapon optic timing (replaces the generic mod)
      if (md.adsMove) adsMove *= md.adsMove;
      continue;
    }
    if (md.adsTime) adsT *= md.adsTime;
    if (md.range) range *= md.range;
    if (md.recoilV) rv *= md.recoilV;
    if (md.recoilH) rh *= md.recoilH;
    if (md.hipSpread) hip *= md.hipSpread;
    if (md.sprintOut) sprintOut *= md.sprintOut;
    if (md.move) move *= md.move;
    if (md.adsMove) adsMove *= md.adsMove;
    if (md.reload) reload *= md.reload;
    if (md.rpm) rpm *= md.rpm;
    if (a.slot === "muzzle") t.suppressed = !!md.suppressed; // replacing a factory can un-suppresses
    if (md.noTracer) t.noTracer = true;
    if (a.slot === "mag" && id === "extmag" && spec.extmag) {
      const k = spec.extmag / base.mag;
      t.mag = spec.extmag;
      t.reserve = Math.round(base.reserve * k);
    }
  }
  if (adsT !== 1) t.adsTime = r4(base.adsTime * adsT);
  if (range !== 1) {
    t.damage.falloffStart = r4(base.damage.falloffStart * range);
    t.damage.falloffEnd = r4(base.damage.falloffEnd * range);
  }
  if (rv !== 1 || rh !== 1) {
    t.recoil.pattern = base.recoil.pattern.map((r) => [r[0] * rh, r[1] * rv]);
    if (base.recoil.vmKick != null) t.recoil.vmKick = r4(base.recoil.vmKick * rv);
    if (base.recoil.vmPunch != null) t.recoil.vmPunch = r4(base.recoil.vmPunch * rv);
  }
  if (hip !== 1) { t.spread.hip = base.spread.hip * hip; t.spread.hipDeg = r4(base.spread.hipDeg * hip); }
  if (sprintOut !== 1) t.sprintOutMult = r4(sprintOut);
  if (move !== 1) t.moveMult = r4(move);
  if (adsMove !== 1) t.adsMoveMult = r4((base.adsMoveMult != null ? base.adsMoveMult : 0.6) * adsMove);
  if (reload !== 1) {
    t.reloadS = r4(base.reloadS * reload);
    t.reloadEmptyS = r4(base.reloadEmptyS * reload);
    if (t.reload && t.reload.mode === "shell") {
      // tube extension: the per-shell cadence is the hand, not the tube — only the
      // longer reach into the extended tube is slower
      t.reload.startS = r4(base.reload.startS * reload);
      t.reloadS = r4(t.reload.startS + t.reload.perShellS * t.mag + t.reload.endS);
      t.reloadEmptyS = t.reloadS;
    }
  }
  if (rpm !== 1) { t.rpm = r4(base.rpm * rpm); t.fireCarry = true; }
  // optic: world zoom + lens behaviour (view fields; the sim never reads them)
  const o = optic && spec.optics[optic];
  if (o && optic !== spec.factory.optic) {
    t.adsFov = o.adsFov;
    t.view.scope = !!o.scope;
    if (o.scope) { t.view.adsZoom = 0; t.view.adsStandoff = 0; }
    else { delete t.view.adsZoom; }
  }
  t.gunsmith = { weaponId, attach: attach.slice(), optic, muzzle: partOf(spec, attach, "muzzle") };
  return t;
}

function partOf(spec, attach, slot) {
  for (const id of attach) if (ATTACHMENTS[id] && ATTACHMENTS[id].slot === slot) return id;
  return spec.factory[slot] || null;
}

/** The effective table for weapon `id` in `body`'s hands (sim hook). */
export function weaponForBody(weapons, body, id) {
  const base = weapons[id];
  if (!base) return base;
  const b = body && body.kit && body.kit.builds && body.kit.builds[id];
  if (!b || !b.attach || !b.attach.length) return base;
  return effectiveWeapon(base, id, b.attach);
}

/** Rounds per minute the 60 Hz sim actually delivers on a held trigger: a
 *  stock gun's interval rounds UP to whole ticks (750 rpm = 5 ticks = 720),
 *  a RAPID FIRE build carries the remainder (player.js) and fires at its rpm. */
export function cadenceRpm(w) {
  if (!w || !w.rpm) return 0;
  if (w.fireCarry) return w.rpm;
  return 3600 / Math.ceil(3600 / w.rpm - 1e-9);
}

// ------------------------------------------------------------- stat bars
// Six bars for the class editor, each 0..1 with the raw number for the label.
// Scales are fixed across all five weapons so bars compare between guns.
function patternKick(w) {
  const pat = w.recoil && w.recoil.pattern ? w.recoil.pattern : [[0, 0]];
  const n = Math.min(pat.length, 12);
  let v = 0, h = 0;
  for (let i = 0; i < n; i++) { v += Math.abs(pat[i][1]); h += Math.abs(pat[i][0]); }
  return { v: (v / n) * 180 / Math.PI, h: (h / n) * 180 / Math.PI };
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export function statLine(w) {
  if (!w) return null;
  const pellets = w.pellets || 1;
  const dmg = w.damage.body * pellets;
  const k = patternKick(w);
  // recoil per second of fire (deg/s), the number that decides whether you hold on target
  const rps = (cadenceRpm(w) || 60) / 60;
  const climb = (k.v + k.h * 1.5) * Math.min(rps, 4);
  const handling = w.adsTime;
  const mob = (w.moveMult || 1) * (0.5 + 0.5 * ((w.adsMoveMult != null ? w.adsMoveMult : 0.6) / 0.7));
  return {
    damage:   { v: clamp01(dmg / 130), raw: Math.round(dmg), label: Math.round(dmg) + (pellets > 1 ? " (" + pellets + "x" + w.damage.body + ")" : "") },
    range:    { v: clamp01(w.damage.falloffEnd / 95), raw: w.damage.falloffEnd, label: Math.round(w.damage.falloffEnd) + " m" },
    recoil:   { v: clamp01(1 - climb / 9), raw: climb, label: climb.toFixed(1) + " deg/s" },
    handling: { v: clamp01((0.45 - handling) / 0.33), raw: handling, label: Math.round(handling * 1000) + " ms ADS" },
    mobility: { v: clamp01((mob - 0.6) / 0.45), raw: mob, label: Math.round((w.moveMult || 1) * 100) + "% move" },
    mag:      { v: clamp01(w.mag / 45), raw: w.mag, label: w.mag + " rds" },
    rpm:      { raw: cadenceRpm(w), label: Math.round(cadenceRpm(w)) + " rpm" },
  };
}
export const STAT_KEYS = ["damage", "range", "recoil", "handling", "mobility", "mag"];
export const STAT_NAMES = { damage: "DAMAGE", range: "RANGE", recoil: "CONTROL", handling: "HANDLING", mobility: "MOBILITY", mag: "MAGAZINE" };

/** Trade-off lines for an attachment ON a weapon, generated from the table
 *  (pros first). [{ text, good:bool }] */
export function describeAttachment(weaponId, id, base) {
  const a = ATTACHMENTS[id];
  const spec = GUNSMITH.weapons[weaponId];
  const out = [];
  if (!a || !spec) return out;
  const pct = (m) => Math.round(Math.abs(m - 1) * 100) + "%";
  const md = a.mods || {};
  if (a.slot === "optic") {
    const o = spec.optics[id], f = spec.optics[spec.factory.optic];
    if (o && f) {
      const zf = (deg) => (Math.tan(37 * Math.PI / 180) / Math.tan(deg * 0.5 * Math.PI / 180));
      out.push({ text: zf(o.adsFov).toFixed(1) + "x zoom" + (o.scope ? ", full lens" : ""), good: o.adsFov < f.adsFov, neutral: o.adsFov === f.adsFov });
      if (o.adsTime !== 1) out.push({ text: (o.adsTime < 1 ? "-" : "+") + pct(o.adsTime) + " aim time", good: o.adsTime < 1 });
    }
    if (md.adsMove) out.push({ text: "-" + pct(md.adsMove) + " aimed move speed", good: false });
    return out;
  }
  if (md.suppressed) out.push({ text: "No flash or tracer signature", good: true });
  if (md.recoilV && md.recoilV < 1) out.push({ text: "-" + pct(md.recoilV) + " vertical recoil", good: true });
  if (md.recoilH && md.recoilH < 1) out.push({ text: "-" + pct(md.recoilH) + " horizontal recoil", good: true });
  if (md.hipSpread) out.push({ text: "-" + pct(md.hipSpread) + " hip-fire spread", good: true });
  if (md.sprintOut) out.push({ text: "-" + pct(md.sprintOut) + " sprint-to-fire", good: true });
  if (id === "extmag" && spec.extmag) out.push({ text: base && base.mag ? "+" + (spec.extmag - base.mag) + " rounds per mag" : spec.extmag + " rounds per mag", good: true });
  if (md.rpm) {
    const r = base ? cadenceRpm(effectiveWeapon(base, weaponId, [id])) / cadenceRpm(base) : md.rpm;
    out.push({ text: "+" + pct(r) + " fire rate", good: true });
  }
  if (md.range) out.push({ text: "-" + pct(md.range) + " damage range", good: false });
  if (md.recoilV && md.recoilV > 1) out.push({ text: "+" + pct(md.recoilV) + " recoil", good: false });
  if (md.reload) out.push({ text: "+" + pct(md.reload) + " reload time", good: false });
  if (md.move) out.push({ text: "-" + pct(md.move) + " move speed", good: false });
  if (md.adsTime) out.push({ text: "+" + pct(md.adsTime) + " aim time", good: false });
  return out;
}
