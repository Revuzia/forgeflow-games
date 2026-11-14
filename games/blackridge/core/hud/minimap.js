// core/hud/minimap.js — TACTICAL MINIMAP + full-map overlay (view layer only).
//
// Reference: the Call of Duty minimap. Top-left disc, rotating with the
// player's yaw (your facing is always "up"), the arena's walls and buildings
// drawn from the LEVEL'S OWN COLLIDER DATA (no image files: each arena is
// rasterised once, at first sight, into a small offscreen canvas).
//
// WHAT IT SHOWS — and the fairness rule behind every item. The minimap may
// never tell the player something the rules have not already granted:
//   you            centre arrow + a faint view wedge
//   teammates      arrows with facing, always (team modes only — FFA has none)
//   death marks    an X where you / a teammate fell, ~3.5 s
//   enemy fire     a red dot where an enemy fired an UNSUPPRESSED weapon. The
//                  dot stays where the shot happened (it is a snapshot, never a
//                  live track) and fades over ~2 s. Suppressed fire: nothing.
//   SIGNAL SWEEP   the recon streak's contact snapshots, pulsing until the next
//                  sweep. The contact list comes from the sim (streaks.js
//                  hostiles()), which already drops COLD SIGNAL (ghost) players.
//   objectives     STRONGHOLD zones (owner colour, capture progress, contested
//                  blink) and CTF flags + stands. A flag carried by the enemy is
//                  drawn ONLY at its public beacon once revealed (flags.js
//                  pubPos/beacon honesty boundary) — never its live position.
//                  Off-map objectives clamp to the rim.
//   your tripmines small wedges (yours only)
//   smoke          soft grey clouds (they are visible to everyone anyway)
//
// COST: one 2D canvas (two while the full map is open), redrawn at <= 20 Hz,
// steady state allocates nothing (pooled pings, preallocated scratch, constant
// style strings). stats() reports the measured average.
//
// The pure logic (world->map transform, ping lifetime, visibility rules, rim
// clamp, raster plan) is exported DOM-free and covered by minimap.selftest.cjs.

// ---------------------------------------------------------------- constants
export const MM = {
  PPM: 6,              // raster pixels per metre (full map stays crisp)
  PPM_MINI: 4,         // raster for the rotating minimap (~4.6 device px/m at dpr 2)
  HZ: 20,              // max redraw rate
  FIRE_TTL: 2.0,       // s, enemy unsuppressed-fire dot
  SWEEP_TTL: 2.3,      // s, recon contact (sweep period is 2.4 s)
  DEATH_TTL: 3.5,      // s, death X
  MERGE_M: 1.5,        // same shooter within this distance refreshes the dot (no new dot)
  POOL: 32,
  SIZES: { small: 150, medium: 184, large: 224 },   // css px (desktop)
  RANGE_M: 40,         // world metres from centre to rim
};

export const KIND = { FIRE: 1, SWEEP: 2, DEATH_SELF: 3, DEATH_MATE: 4 };

// ---------------------------------------------------------------- pure logic
/**
 * World (x,z) -> minimap offset (screen px, +x right, +y down) for a viewer at
 * (px,pz) whose map is rotated by theta (theta = player yaw for the rotating
 * minimap -> facing is up; theta = 0 for the north-up full map). k = px/metre.
 * Yaw convention (core/hud/hud.js relDegTo, botfsm yawTo): forward =
 * (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw).
 */
export function worldToMap(px, pz, theta, x, z, k, out) {
  const dx = x - px, dz = z - pz;
  const c = Math.cos(theta), s = Math.sin(theta);
  out[0] = (dx * c - dz * s) * k;
  out[1] = (dx * s + dz * c) * k;
  return out;
}

/** Screen rotation (canvas, clockwise +) of an arrow for a body with `yaw` on a map rotated by theta. */
export function arrowAngle(theta, yaw) { return theta - yaw; }

/** Clamp an offset to a rim of radius R. Returns true if it was outside (clamped). */
export function clampToRim(out, R) {
  const d = Math.hypot(out[0], out[1]);
  if (d <= R) return false;
  out[0] *= R / d; out[1] *= R / d;
  return true;
}

/** Clamp an offset to a half-width/half-height rectangle. Returns true if clamped. */
export function clampToRect(out, hw, hh) {
  const ax = Math.abs(out[0]) / hw, ay = Math.abs(out[1]) / hh;
  const m = Math.max(ax, ay);
  if (m <= 1) return false;
  out[0] /= m; out[1] /= m;
  return true;
}

/** A shot event that represents a real trigger pull (not an impact replay / pen exit / extra pellet). */
export function isTriggerShot(d) {
  return !!(d && d.shooter != null && d.origin && !d.impactOnly && !d.pen && !(d.pellet > 0));
}

/**
 * Suppressed? Order: an explicit `suppressed` flag on the shot event (the
 * attachments lane), then a `suppressed` field on the weapon table, then the
 * default: the Vesper is the integrally suppressed SMG (weapon_data.js
 * "KS-23 Vesper — suppressed SMG"), every other weapon is loud.
 */
export function isSuppressedShot(d, weapons) {
  if (d && typeof d.suppressed === "boolean") return d.suppressed;
  const w = weapons && d && weapons[d.weaponId];
  if (w && typeof w.suppressed === "boolean") return w.suppressed;
  return !!(d && d.weaponId === "vesper");
}

/** relation of `who` to the human: 'self' | 'mate' | 'enemy'. ffa → no mates. */
export function relationOf(who, sameTeamFn) {
  if (who === "P") return "self";
  return sameTeamFn && sameTeamFn("P", who) ? "mate" : "enemy";
}

/** The fairness gate for a shot ping. */
export function shotShowsDot(d, rel, weapons) {
  return rel === "enemy" && isTriggerShot(d) && !isSuppressedShot(d, weapons);
}

/**
 * Where (if anywhere) a CTF flag may be drawn for the human. AT_STAND and
 * DROPPED are public; a flag carried by your own side is where your teammate
 * is (you can see them anyway); a flag carried by the enemy is shown only at
 * its revealed beacon (flags.js honesty boundary). Returns a [3] or null.
 */
export function flagShownPos(f, carrierIsFriendly) {
  if (!f) return null;
  if (f.state === "CARRIED") {
    if (carrierIsFriendly) return f.pos || null;
    return f.revealed && f.beacon && f.beacon.pos ? f.beacon.pos : null;
  }
  return f.pubPos || f.pos || null;
}

/** Alpha of a ping at time t (0 = gone). Sweep pings pulse. */
export function pingAlpha(kind, t0, t) {
  const age = t - t0;
  if (age < 0) return 0;
  if (kind === KIND.FIRE) {
    if (age >= MM.FIRE_TTL) return 0;
    const u = age / MM.FIRE_TTL;
    return 1 - u * u;
  }
  if (kind === KIND.SWEEP) {
    if (age >= MM.SWEEP_TTL) return 0;
    const fade = age < MM.SWEEP_TTL - 0.5 ? 1 : (MM.SWEEP_TTL - age) / 0.5;
    return fade * (0.62 + 0.38 * Math.cos(age * 9));
  }
  if (age >= MM.DEATH_TTL) return 0;
  return age < MM.DEATH_TTL - 0.8 ? 1 : (MM.DEATH_TTL - age) / 0.8;
}

/** Fixed pool of pings. No allocation after construction. */
export function makePings(n = MM.POOL) {
  const items = [];
  for (let i = 0; i < n; i++) items.push({ kind: 0, key: null, x: 0, y: 0, z: 0, t0: -1e9 });
  function ttlOf(kind) {
    return kind === KIND.FIRE ? MM.FIRE_TTL : kind === KIND.SWEEP ? MM.SWEEP_TTL : MM.DEATH_TTL;
  }
  const pings = {
    items,
    add(kind, key, x, y, z, t) {
      let slot = null, oldest = items[0];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const live = it.kind !== 0 && t - it.t0 < ttlOf(it.kind);
        if (!live) { if (!slot) slot = it; continue; }
        // merge: the same shooter firing again from (nearly) the same spot
        // refreshes that dot rather than stacking a new one. The position is
        // NOT moved — a dot is where a shot happened, never a live track.
        if (kind === KIND.FIRE && it.kind === KIND.FIRE && it.key === key &&
            Math.hypot(it.x - x, it.z - z) <= MM.MERGE_M) { it.t0 = t; return it; }
        if (it.t0 < oldest.t0) oldest = it;
      }
      if (!slot) slot = oldest;
      slot.kind = kind; slot.key = key; slot.x = x; slot.y = y; slot.z = z; slot.t0 = t;
      return slot;
    },
    clear() { for (const it of items) { it.kind = 0; it.key = null; it.t0 = -1e9; } },
    liveCount(t) {
      let n2 = 0;
      for (const it of items) if (it.kind !== 0 && pingAlpha(it.kind, it.t0, t) > 0) n2++;
      return n2;
    },
  };
  return pings;
}

/**
 * Raster plan for an arena from its collider set (colliders.js shape).
 * Returns {minX, minZ, w, h (metres), walk:[[x0,z0,x1,z1]], shapes:[{layer, pts:[x,z]*4}]}
 * layers: 1 raised deck/stair, 2 low cover, 3 wall/building. rayOnly compound
 * sub-boxes are skipped (each prop's coarse hull already covers the footprint).
 */
export function rasterPlan(col) {
  const b = (col && col.bounds) || { min: [-60, 0, -60], max: [60, 10, 60] };
  const plan = {
    minX: b.min[0], minZ: b.min[2],
    w: b.max[0] - b.min[0], h: b.max[2] - b.min[2],
    walk: [], shapes: [],
  };
  for (const r of (col && col.walkRects) || []) {
    plan.walk.push([r.min[0], r.min[1], r.max[0], r.max[1], r.y || 0]);
  }
  for (const box of (col && col.boxes) || []) {
    if (box.rayOnly) continue;
    const y0 = box.min[1], y1 = box.max[1], h = y1 - y0;
    let layer;
    if (y0 >= 0.3) layer = h >= 1.2 ? 3 : 1;      // upper-floor wall, or deck/slab/stair
    else if (h < 0.45) continue;                   // kerbs, rubble
    else if (h < 1.4) layer = 2;                   // waist cover
    else layer = 3;                                // walls, buildings, vehicles
    let pts;
    const o = box.obb;
    if (o) {
      const cl = (lx, lz) => [o.cx + o.c * lx + o.s * lz, o.cz - o.s * lx + o.c * lz];
      const a = cl(-o.hx, -o.hz), b2 = cl(o.hx, -o.hz), c2 = cl(o.hx, o.hz), d2 = cl(-o.hx, o.hz);
      pts = [a[0], a[1], b2[0], b2[1], c2[0], c2[1], d2[0], d2[1]];
    } else {
      pts = [box.min[0], box.min[2], box.max[0], box.min[2], box.max[0], box.max[2], box.min[0], box.max[2]];
    }
    // declutter: crates, bins, bollards under ~0.6 m² read as noise at map scale
    const area = o ? 4 * o.hx * o.hz : (box.max[0] - box.min[0]) * (box.max[2] - box.min[2]);
    if (area < 0.6 && layer !== 3) continue;
    plan.shapes.push({ layer, top: y1, pts });
  }
  plan.shapes.sort((p, q) => (p.layer - q.layer) || (p.top - q.top));
  return plan;
}

// ---------------------------------------------------------------- browser side
const CSS = `
/* [minimap lane] core/hud/minimap.js */
#mm-wrap{position:absolute;left:20px;top:20px;pointer-events:none;}
#mm-wrap canvas{display:block;}
body.kc-on #mm-wrap,body.kc-on #mm-full{visibility:hidden;}  /* kill cam (also covered by killcam.js's #hud > * rule) */
#mm-full{position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;
  padding-top:64px;background:rgba(6,8,10,.62);pointer-events:none;}
#mm-full .mm-t{font-size:12px;letter-spacing:.32em;opacity:.8;margin-bottom:8px;}
#mm-full .mm-k{font-size:10px;letter-spacing:.24em;opacity:.55;margin-top:8px;}
body.br-touch #mm-wrap{left:calc(12px + env(safe-area-inset-left));top:calc(60px + env(safe-area-inset-top));pointer-events:auto;cursor:pointer;}
/* [polish v149] touch: tap the minimap for the full map, tap the full map to close it */
body.br-touch #mm-full{pointer-events:auto;padding-top:0;}
body.br-touch #mm-full .mm-t{display:none;}
body.br-touch.mm-on #objective{left:calc(124px + env(safe-area-inset-left));}
body.br-touch.mm-on #a10-banner{left:calc(124px + env(safe-area-inset-left));}
`;

const COL = {
  bg: "rgba(10,12,14,0.62)",
  walk: "rgba(48,55,60,0.78)",
  raised: "rgba(78,86,92,0.85)",
  cover: "rgba(104,112,112,0.88)",
  wall: "rgba(146,152,148,0.94)",
  wallEdge: "rgba(20,22,24,0.9)",
  rim: "rgba(232,232,228,0.55)",
  ink: "#e8e8e4",
  self: "#ffffff",
  enemy: "#ff3b30",
  smoke: "#9aa0a4",
  neutral: "#e8e8e4",
  dark: "#0c0e10",
  cone: "rgba(232,232,228,0.10)",
};
const TINT_DEFAULT = ["#d9a441", "#7c9fd0"];
const FONT_RIM = "600 10px Oswald, 'Arial Narrow', system-ui, sans-serif";
const FONT_OBJ = "600 11px Oswald, 'Arial Narrow', system-ui, sans-serif";
const FONT_OBJ_L = "600 14px Oswald, 'Arial Narrow', system-ui, sans-serif";

export function readSettings(S, out) {
  // other lanes add these; read defensively (absent → on / medium)
  out = out || {};
  let on = true;
  const v = S && (S.minimap !== undefined ? S.minimap : undefined);
  if (v === false || v === "off" || v === 0) on = false;
  let size = S && (S.minimapSize || S.minimap_size);
  if (size === "med") size = "medium";
  if (size === "sm") size = "small";
  if (size === "lg") size = "large";
  if (typeof size !== "string" || !MM.SIZES[size]) size = "medium";
  out.on = on; out.size = size;
  return out;
}

/**
 * createMinimap(ctx, {hud}) → {attach(bridge), update(dt), toggleFull(on?), stats(), _state}
 * Mounted inside the HUD root, so it hides with the HUD and with the kill cam
 * (body.kc-on #hud > * {visibility:hidden}).
 */
export function createMinimap(ctx, opts = {}) {
  const hud = opts.hud || null;
  const CAMPAIGN = opts.campaign !== undefined ? !!opts.campaign : true;

  if (!document.getElementById("mm-style")) {
    const el = document.createElement("style");
    el.id = "mm-style";
    el.textContent = CSS;
    document.head.appendChild(el);
  }
  const host = (hud && hud._root) || document.body;
  const wrap = document.createElement("div");
  wrap.id = "mm-wrap";
  const cv = document.createElement("canvas");
  wrap.appendChild(cv);
  wrap.style.display = "none";
  host.appendChild(wrap);
  const g = cv.getContext("2d");

  const full = document.createElement("div");
  full.id = "mm-full";
  full.innerHTML = `<div class="mm-t">TACTICAL MAP</div><canvas></canvas><div class="mm-k">M  CLOSE</div>`;
  host.appendChild(full);
  const fcv = full.querySelector("canvas");
  const fg = fcv.getContext("2d");

  const pings = makePings(MM.POOL);
  const raster = new WeakMap(); // colliders object → {img, plan}
  const tmp = [0, 0];
  const cfgScratch = { on: true, size: "medium" };
  const st = {
    acc: 1, shown: false, fullOpen: false,
    cssSize: 0, dpr: 0, fW: 0, fH: 0,
    costSum: 0, costN: 0, costMax: 0, frames: 0,
    cur: null, // current raster
    lastSim: null,
  };
  // view descriptors (preallocated)
  const vMini = { g, dpr: 1, cx: 0, cy: 0, R: 0, hw: 0, hh: 0, round: true, theta: 0, k: 1, px: 0, pz: 0 };
  const vFull = { g: fg, dpr: 1, cx: 0, cy: 0, R: 0, hw: 0, hh: 0, round: false, theta: 0, k: 1, px: 0, pz: 0 };

  const sim = () => (ctx.sim ? ctx.sim() : null);
  const simNow = () => { const s = sim(); return s && s.state ? s.state.time : 0; };
  const weapons = () => ctx.weapons || null;

  function sameTeamFn() {
    const s = sim();
    if (s && s.match && typeof s.match.sameTeam === "function") return s.match.sameTeam;
    return campaignSameTeam;
  }
  // campaign: every bot is team 1 against the team-0 player (streaks.js rule)
  function campaignSameTeam(a, b) {
    const s = sim();
    if (!s) return false;
    const ta = a === "P" ? (s.state.player.team | 0) : teamOfBot(s, a);
    const tb = b === "P" ? (s.state.player.team | 0) : teamOfBot(s, b);
    return ta === tb && ta >= 0;
  }
  function teamOfBot(s, id) {
    const bots = s.state.bots;
    for (let i = 0; i < bots.length; i++) if (bots[i].id === id) return bots[i].team == null ? 1 : bots[i].team | 0;
    return -1;
  }

  // team colours: the match's own team table (roster.js tints — the same values
  // soldiers.js and the STRONGHOLD HUD use), or a ctx.teamTint(team) hook if the
  // HUD palette lane publishes one, so a colour-blind palette change propagates.
  // Colour-blind palettes (settings lane): the same live handle hud.js's
  // STRONGHOLD HUD and soldiers.js read — {friend, enemy} or null (authored tints).
  function cbColors() {
    const h = globalThis.__BR_SETTINGS__;
    return h && typeof h.teamColors === "function" ? h.teamColors() : null;
  }
  function tint(team) {
    if (typeof ctx.teamTint === "function") {
      const c = ctx.teamTint(team);
      if (c) return c;
    }
    if (team !== 0 && team !== 1) return COL.neutral;
    const cb = cbColors();
    if (cb) return team === 0 ? cb.friend : cb.enemy;
    const s = sim();
    const M = s && s.state.match;
    const t = M && M.teams && M.teams[team];
    return (t && t.tint) || TINT_DEFAULT[team];
  }
  function enemyCol() {
    if (typeof ctx.enemyTint === "function") { const c = ctx.enemyTint(); if (c) return c; }
    const cb = cbColors(); // protan/deutan cannot pick red dots off the map: use the palette's enemy colour
    if (cb && cb.enemy) return cb.enemy;
    return COL.enemy;
  }

  // ------------------------------------------------------------ rasterise
  // Two rasters per arena: PPM for the full map, PPM_MINI (close to the
  // minimap's on-screen density at dpr 2) so the per-redraw rotated blit is
  // ~4x fewer texels and does not alias when minified.
  function paint(plan, P) {
    const img = document.createElement("canvas");
    img.width = Math.max(8, Math.ceil(plan.w * P));
    img.height = Math.max(8, Math.ceil(plan.h * P));
    const x = img.getContext("2d");
    const X = (wx) => (wx - plan.minX) * P, Z = (wz) => (wz - plan.minZ) * P;
    x.fillStyle = COL.walk;
    if (plan.walk.length) {
      for (const w of plan.walk) x.fillRect(X(w[0]), Z(w[1]), (w[2] - w[0]) * P, (w[3] - w[1]) * P);
    } else x.fillRect(0, 0, img.width, img.height);
    const fills = [null, COL.raised, COL.cover, COL.wall];
    for (const s of plan.shapes) {
      const p = s.pts;
      x.beginPath();
      x.moveTo(X(p[0]), Z(p[1])); x.lineTo(X(p[2]), Z(p[3]));
      x.lineTo(X(p[4]), Z(p[5])); x.lineTo(X(p[6]), Z(p[7]));
      x.closePath();
      x.fillStyle = fills[s.layer];
      x.fill();
      if (s.layer === 3) { x.lineWidth = P >= 5 ? 1 : 0.6; x.strokeStyle = COL.wallEdge; x.stroke(); }
    }
    return img;
  }
  function rasterFor(col) {
    if (!col) return null;
    let r = raster.get(col);
    if (r) return r;
    const t0 = performance.now();
    const plan = rasterPlan(col);
    r = { img: paint(plan, MM.PPM), ppm: MM.PPM, mini: paint(plan, MM.PPM_MINI), ppmMini: MM.PPM_MINI, plan, ms: 0 };
    r.ms = performance.now() - t0;
    raster.set(col, r);
    return r;
  }

  // ------------------------------------------------------------ events
  function onShot(d) {
    if (!isTriggerShot(d)) return;
    const rel = relationOf(d.shooter, sameTeamFn());
    if (!shotShowsDot(d, rel, weapons())) return;
    const o = d.origin;
    pings.add(KIND.FIRE, d.shooter, o[0], o[1], o[2], simNow());
  }
  function onStreak(d) {
    if (!d || d.phase !== "sweep" || !d.contacts) return;
    const t = simNow();
    for (const c of d.contacts) {
      if (!c || !c.pos) continue;
      // the contact list is already the sim's rule (living hostiles minus
      // COLD SIGNAL); re-check the team relation defensively.
      if (relationOf(c.id, sameTeamFn()) !== "enemy") continue;
      pings.add(KIND.SWEEP, c.id, c.pos[0], c.pos[1], c.pos[2], t);
    }
  }
  function onDeath(d) {
    if (!d || !d.pos) return;
    const rel = relationOf(d.victim, sameTeamFn());
    if (rel === "enemy") return; // enemy deaths are not map intel
    pings.add(rel === "self" ? KIND.DEATH_SELF : KIND.DEATH_MATE, d.victim, d.pos[0], d.pos[1], d.pos[2], simNow());
  }
  function onStart() { pings.clear(); st.acc = 1; }

  // ------------------------------------------------------------ input (M)
  function keyBoundElsewhere(code) {
    try {
      const raw = localStorage.getItem("blackridge.keybinds.v1");
      if (!raw) return false;
      const o = JSON.parse(raw);
      for (const k in o) if (o[k] === code) return true;
    } catch (e) { /* defaults */ }
    return false;
  }
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "Escape" && st.fullOpen) { toggleFull(false); return; }
    if (e.code !== "KeyM") return;
    if (!st.shown && !st.fullOpen) return;
    if (!ctx.input || !ctx.input.enabled) return;
    if (keyBoundElsewhere("KeyM")) return;
    toggleFull();
  });
  // [polish v149] touch + controller access to the full map (input_gamepad.js
  // taps VIEW; touch taps the minimap / the open map)
  function canToggle() { return (st.shown || st.fullOpen) && !!(ctx.input && ctx.input.enabled); }
  globalThis.__BR_FULLMAP__ = { toggle: () => { if (canToggle()) toggleFull(); }, isOpen: () => st.fullOpen };
  wrap.addEventListener("pointerdown", (e) => { if (!document.body.classList.contains("br-touch")) return; e.preventDefault(); e.stopPropagation(); if (canToggle()) toggleFull(true); });
  full.addEventListener("pointerdown", (e) => { if (!document.body.classList.contains("br-touch")) return; e.preventDefault(); e.stopPropagation(); toggleFull(false); });
  function toggleFull(on) {
    const want = on === undefined ? !st.fullOpen : !!on;
    if (want === st.fullOpen) return;
    st.fullOpen = want;
    if (want) { // [polish v149] the close prompt for the device in hand
      const k = full.querySelector(".mm-k");
      const dev = document.body.classList.contains("br-touch") ? "touch" : ctx.input && ctx.input.lastDevice;
      if (k) k.textContent = dev === "touch" ? "TAP TO CLOSE" : dev === "pad" ? "VIEW  CLOSE" : "M  CLOSE";
    }
    full.style.display = want ? "flex" : "none";
    wrap.style.display = want || !st.shown ? "none" : "block";
    st.acc = 1;
  }

  // ------------------------------------------------------------ drawing
  function sizeCanvas(c, cssW, cssH, dpr) {
    const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const sw = cssW + "px", sh = cssH + "px";
    if (c.style.width !== sw) c.style.width = sw;
    if (c.style.height !== sh) c.style.height = sh;
  }

  function arrow(G, v, x, y, ang, size, fill, stroke) {
    const d = v.dpr, c = Math.cos(ang) * d, s = Math.sin(ang) * d;
    G.setTransform(c, s, -s, c, x * d, y * d);
    G.beginPath();
    G.moveTo(0, -size);
    G.lineTo(size * 0.72, size * 0.78);
    G.lineTo(0, size * 0.36);
    G.lineTo(-size * 0.72, size * 0.78);
    G.closePath();
    G.fillStyle = fill; G.fill();
    if (stroke) { G.lineWidth = 1.2; G.strokeStyle = stroke; G.stroke(); }
  }

  function ident(G, v) { G.setTransform(v.dpr, 0, 0, v.dpr, 0, 0); }

  function offMap(v, out) {
    return v.round ? clampToRim(out, v.R - 8) : clampToRect(out, v.hw - 10, v.hh - 10);
  }

  function drawView(v, s, r) {
    const G = v.g, S = s.state, p = S.player, t = S.time;
    const M = S.match;
    const W = G.canvas.width, H = G.canvas.height;
    G.setTransform(1, 0, 0, 1, 0, 0);
    G.clearRect(0, 0, W, H);
    ident(G, v);
    // text state once per redraw (save/restore below brings it back unchanged)
    G.font = v.round ? FONT_OBJ : FONT_OBJ_L;
    G.textAlign = "center"; G.textBaseline = "middle";
    // ---- background + clip
    G.save();
    G.beginPath();
    if (v.round) G.arc(v.cx, v.cy, v.R, 0, Math.PI * 2);
    else G.rect(v.cx - v.hw, v.cy - v.hh, v.hw * 2, v.hh * 2);
    G.fillStyle = COL.bg; G.fill();
    G.clip();
    // ---- arena raster
    if (r) {
      const useMini = v.round;
      const P = useMini ? r.ppmMini : r.ppm, d = v.dpr;
      const c = Math.cos(v.theta), sn = Math.sin(v.theta);
      const kk = v.k / P;
      G.setTransform(c * kk * d, sn * kk * d, -sn * kk * d, c * kk * d, v.cx * d, v.cy * d);
      G.imageSmoothingEnabled = true;
      G.drawImage(useMini ? r.mini : r.img, -(v.px - r.plan.minX) * P, -(v.pz - r.plan.minZ) * P);
      ident(G, v);
    }
    const sameTeam = sameTeamFn();
    // ---- smoke
    const smokes = S.smokes;
    if (smokes && smokes.length) {
      G.fillStyle = COL.smoke;
      for (let i = 0; i < smokes.length; i++) {
        const sm = smokes[i];
        if (!sm || !sm.pos || (sm.until != null && t > sm.until)) continue;
        worldToMap(v.px, v.pz, v.theta, sm.pos[0], sm.pos[2], v.k, tmp);
        const rr = Math.max(2, (sm.radius || 4) * v.k);
        G.globalAlpha = 0.22;
        G.beginPath(); G.arc(v.cx + tmp[0], v.cy + tmp[1], rr * 1.2, 0, Math.PI * 2); G.fill();
        G.globalAlpha = 0.32;
        G.beginPath(); G.arc(v.cx + tmp[0], v.cy + tmp[1], rr * 0.8, 0, Math.PI * 2); G.fill();
      }
      G.globalAlpha = 1;
    }
    // ---- STRONGHOLD zones (in-map part)
    const zones = M && (M.modeId === "dom" || M.modeId === "hill") && M.mode && M.mode.zones; // [lane modes] + the OUTPOST hill
    if (zones) {
      for (let i = 0; i < zones.length; i++) {
        const z = zones[i];
        worldToMap(v.px, v.pz, v.theta, z.pos[0], z.pos[2], v.k, tmp);
        const x = v.cx + tmp[0], y = v.cy + tmp[1];
        const rr = Math.max(7, (z.r || 4) * v.k);
        const own = tint(z.owner);
        if (z.preview) G.setLineDash([3, 3]); // [lane modes] the next hill: dashed ghost
        G.globalAlpha = z.preview ? 0.06 : z.owner >= 0 ? 0.32 : 0.14;
        G.fillStyle = own;
        G.beginPath(); G.arc(x, y, rr, 0, Math.PI * 2); G.fill();
        G.globalAlpha = z.contested ? (Math.floor(t * 4) % 2 ? 1 : 0.35) : 0.9;
        G.lineWidth = 1.5; G.strokeStyle = z.contested ? COL.enemy : own;
        G.stroke();
        if (z.prog > 0 && z.capTeam >= 0) {
          G.globalAlpha = 1; G.lineWidth = 3; G.strokeStyle = tint(z.capTeam);
          G.beginPath(); G.arc(x, y, rr + 2.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, z.prog)); G.stroke();
        }
        G.globalAlpha = 1;
        G.fillStyle = COL.dark; G.fillText(z.label, x + 1, y + 1);
        G.fillStyle = own === COL.neutral ? COL.ink : own; G.fillText(z.label, x, y);
        if (z.preview) G.setLineDash([]);
      }
    }
    // ---- [lane modes] RECLAIM tags: small diamonds in the victim's colour
    const tagsL = M && M.modeId === "tags" && M.mode && M.mode.tags;
    if (tagsL && tagsL.length) {
      for (let i = 0; i < tagsL.length; i++) {
        const g = tagsL[i];
        worldToMap(v.px, v.pz, v.theta, g.pos[0], g.pos[2], v.k, tmp);
        if (offMap(v, tmp)) continue;
        const x = v.cx + tmp[0], y = v.cy + tmp[1];
        G.globalAlpha = g.expiresT - t < 5 ? (Math.floor(t * 4) % 2 ? 1 : 0.4) : 0.95;
        G.fillStyle = tint(g.team);
        G.beginPath(); G.moveTo(x, y - 4); G.lineTo(x + 3, y); G.lineTo(x, y + 4); G.lineTo(x - 3, y); G.closePath(); G.fill();
        G.strokeStyle = COL.dark; G.lineWidth = 1; G.stroke();
      }
      G.globalAlpha = 1;
    }
    // ---- CTF stands + flags
    const flags = M && M.flags;
    if (flags && flags.length) {
      for (let i = 0; i < flags.length; i++) {
        const f = flags[i];
        const col = tint(f.team);
        if (f.home) {
          worldToMap(v.px, v.pz, v.theta, f.home[0], f.home[2], v.k, tmp);
          G.globalAlpha = 0.6; G.strokeStyle = col; G.lineWidth = 1.5;
          G.strokeRect(v.cx + tmp[0] - 5, v.cy + tmp[1] - 5, 10, 10);
          G.globalAlpha = 1;
        }
        const fp = flagShownPos(f, f.carrier != null && relationOf(f.carrier, sameTeam) !== "enemy");
        if (!fp) continue;
        worldToMap(v.px, v.pz, v.theta, fp[0], fp[2], v.k, tmp);
        if (offMap(v, tmp)) continue; // rim pass draws it
        flagGlyph(G, v.cx + tmp[0], v.cy + tmp[1], col, f.state, t, 1);
      }
    }
    // ---- your tripmines
    const E = s.internal && s.internal.equip;
    if (E && E.mines && E.mines.length) {
      for (let i = 0; i < E.mines.length; i++) {
        const m = E.mines[i];
        if (m.who !== "P" || !m.pos) continue;
        worldToMap(v.px, v.pz, v.theta, m.pos[0], m.pos[2], v.k, tmp);
        const x = v.cx + tmp[0], y = v.cy + tmp[1];
        const d = v.dpr, a = typeof m.yaw === "number" ? arrowAngle(v.theta, m.yaw) : 0;
        const c = Math.cos(a) * d, sn = Math.sin(a) * d;
        G.setTransform(c, sn, -sn, c, x * d, y * d);
        G.beginPath(); G.moveTo(0, 0); G.arc(0, 0, 7, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); G.closePath();
        G.globalAlpha = 0.85; G.fillStyle = tint(p.team | 0); G.fill();
        G.globalAlpha = 1; G.fillStyle = COL.ink; G.fillRect(-1.5, -1.5, 3, 3);
        ident(G, v);
      }
    }
    // ---- pings (deaths, sweep contacts, enemy fire)
    const items = pings.items;
    const red = enemyCol();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === 0) continue;
      const a = pingAlpha(it.kind, it.t0, t);
      if (a <= 0) continue;
      worldToMap(v.px, v.pz, v.theta, it.x, it.z, v.k, tmp);
      const x = v.cx + tmp[0], y = v.cy + tmp[1];
      G.globalAlpha = a;
      if (it.kind === KIND.FIRE) {
        G.fillStyle = red;
        G.beginPath(); G.arc(x, y, 4, 0, Math.PI * 2); G.fill();
        G.lineWidth = 1; G.strokeStyle = COL.dark; G.stroke();
      } else if (it.kind === KIND.SWEEP) {
        G.fillStyle = red;
        G.beginPath(); G.moveTo(x, y - 5.5); G.lineTo(x + 5.5, y); G.lineTo(x, y + 5.5); G.lineTo(x - 5.5, y); G.closePath();
        G.fill();
        G.lineWidth = 1; G.strokeStyle = COL.ink; G.stroke();
      } else {
        G.lineWidth = 2.2;
        G.strokeStyle = it.kind === KIND.DEATH_SELF ? COL.self : tint(p.team | 0);
        G.beginPath(); G.moveTo(x - 4, y - 4); G.lineTo(x + 4, y + 4); G.moveTo(x + 4, y - 4); G.lineTo(x - 4, y + 4); G.stroke();
      }
    }
    G.globalAlpha = 1;
    // ---- teammates
    const bots = S.bots;
    const mate = tint(p.team | 0);
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      if (!b || !b.alive || !b.pos) continue;
      if (relationOf(b.id, sameTeam) !== "mate") continue;
      worldToMap(v.px, v.pz, v.theta, b.pos[0], b.pos[2], v.k, tmp);
      arrow(G, v, v.cx + tmp[0], v.cy + tmp[1], arrowAngle(v.theta, b.yaw || 0), 6, mate, COL.dark);
    }
    ident(G, v);
    // ---- you
    if (p.alive || !v.round) {
      worldToMap(v.px, v.pz, v.theta, p.pos[0], p.pos[2], v.k, tmp);
      const x = v.cx + tmp[0], y = v.cy + tmp[1];
      const ang = arrowAngle(v.theta, p.yaw);
      if (v.round) {
        // faint view wedge
        const d = v.dpr, c = Math.cos(ang) * d, sn = Math.sin(ang) * d;
        G.setTransform(c, sn, -sn, c, x * d, y * d);
        G.beginPath(); G.moveTo(0, 0); G.arc(0, 0, v.R * 0.62, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62); G.closePath();
        G.fillStyle = COL.cone; G.fill();
      }
      arrow(G, v, x, y, ang, 7.5, COL.self, COL.dark);
      ident(G, v);
    }
    G.restore();
    ident(G, v);
    // ---- rim
    G.lineWidth = 1.5; G.strokeStyle = COL.rim;
    G.beginPath();
    if (v.round) G.arc(v.cx, v.cy, v.R - 0.75, 0, Math.PI * 2);
    else G.rect(v.cx - v.hw + 0.75, v.cy - v.hh + 0.75, v.hw * 2 - 1.5, v.hh * 2 - 1.5);
    G.stroke();
    if (v.round) {
      // north tick: world −Z
      worldToMap(0, 0, v.theta, 0, -1, 1, tmp);
      const nx = v.cx + tmp[0] * (v.R - 8), ny = v.cy + tmp[1] * (v.R - 8);
      G.fillStyle = COL.dark; G.beginPath(); G.arc(nx, ny, 7, 0, Math.PI * 2); G.fill();
      G.font = FONT_RIM;
      G.fillStyle = COL.ink; G.fillText("N", nx, ny + 0.5);
    }
    // ---- off-map objectives clamped to the rim
    if (zones) {
      if (!v.round) G.font = FONT_RIM;
      for (let i = 0; i < zones.length; i++) {
        const z = zones[i];
        worldToMap(v.px, v.pz, v.theta, z.pos[0], z.pos[2], v.k, tmp);
        if (!offMap(v, tmp)) continue;
        const x = v.cx + tmp[0], y = v.cy + tmp[1];
        const own = tint(z.owner);
        G.fillStyle = COL.dark; G.beginPath(); G.arc(x, y, 7.5, 0, Math.PI * 2); G.fill();
        G.lineWidth = 1.5; G.strokeStyle = z.contested ? COL.enemy : own; G.stroke();
        G.fillStyle = own === COL.neutral ? COL.ink : own; G.fillText(z.label, x, y + 0.5);
      }
    }
    if (flags && flags.length) {
      for (let i = 0; i < flags.length; i++) {
        const f = flags[i];
        const fp = flagShownPos(f, f.carrier != null && relationOf(f.carrier, sameTeam) !== "enemy");
        if (!fp) continue;
        worldToMap(v.px, v.pz, v.theta, fp[0], fp[2], v.k, tmp);
        if (!offMap(v, tmp)) continue;
        flagGlyph(G, v.cx + tmp[0], v.cy + tmp[1], tint(f.team), f.state, t, 0.85);
      }
    }
  }

  function flagGlyph(G, x, y, col, state, t, scale) {
    const sc = scale || 1;
    G.globalAlpha = state === "DROPPED" ? (Math.floor(t * 3) % 2 ? 1 : 0.45) : 1;
    G.fillStyle = COL.dark; G.beginPath(); G.arc(x, y, 8 * sc, 0, Math.PI * 2); G.fill();
    G.strokeStyle = col; G.lineWidth = 1.5; G.stroke();
    G.fillStyle = col;
    G.fillRect(x - 3.5 * sc, y - 5 * sc, 1.4 * sc, 10 * sc);
    G.beginPath(); G.moveTo(x - 2.1 * sc, y - 5 * sc); G.lineTo(x + 5 * sc, y - 2.5 * sc); G.lineTo(x - 2.1 * sc, y); G.closePath(); G.fill();
    if (state === "CARRIED") { G.lineWidth = 1; G.strokeStyle = COL.ink; G.beginPath(); G.arc(x, y, 10.5 * sc, 0, Math.PI * 2); G.stroke(); }
    G.globalAlpha = 1;
  }

  function wantShown(s) {
    if (!s || !s.state) return false;
    if (hud && hud._root && hud._root.style.display === "none") return false;
    const S = s.state;
    // warmup: the class picker owns the top-left; nothing moves yet anyway
    if (S.match) return S.match.phase !== "ended" && S.match.phase !== "warmup" && S.match.phase !== "pre";
    if (!CAMPAIGN) return false;
    const ph = S.phase;
    return ph === "infil" || ph === "assault" || ph === "exfil";
  }

  function update(dt) {
    st.frames++;
    const s = sim();
    const cfg = readSettings(ctx.settings, cfgScratch);
    const show = cfg.on && wantShown(s);
    if (show !== st.shown) {
      st.shown = show;
      wrap.style.display = show && !st.fullOpen ? "block" : "none";
      document.body.classList.toggle("mm-on", show);
      if (!show) toggleFull(false);
      st.acc = 1;
    }
    if (!show) return;
    st.acc += dt;
    if (st.acc < 1 / MM.HZ) return;
    st.acc = 0;
    const t0 = performance.now();
    const r = rasterFor(ctx.colliders || (s && s.colliders));
    const p = s.state.player;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const vw = window.innerWidth || 1280, vh = window.innerHeight || 720;
    // ---- minimap (skipped while the full map covers it)
    if (!st.fullOpen) {
      let css = MM.SIZES[cfg.size];
      const small = Math.min(vw, vh);
      if (small < 560) css = Math.max(104, Math.round(css * small / 640)); // phones
      if (css !== st.cssSize || dpr !== st.dpr) { sizeCanvas(cv, css, css, dpr); st.cssSize = css; st.dpr = dpr; }
      vMini.dpr = dpr; vMini.cx = css / 2; vMini.cy = css / 2; vMini.R = css / 2 - 1;
      vMini.theta = p.yaw; vMini.k = (css / 2) / MM.RANGE_M;
      vMini.px = p.pos[0]; vMini.pz = p.pos[2];
      drawView(vMini, s, r);
    } else if (r) {
      // ---- full map: north-up, whole arena fitted
      const pl = r.plan;
      const maxW = vw * 0.86, maxH = vh * 0.64 - 64; // clear of the streak bar + score line
      const k = Math.min(maxW / pl.w, maxH / pl.h);
      const cw = Math.round(pl.w * k), ch = Math.round(pl.h * k);
      if (cw !== st.fW || ch !== st.fH || dpr !== vFull.dpr) { sizeCanvas(fcv, cw, ch, dpr); st.fW = cw; st.fH = ch; }
      vFull.dpr = dpr; vFull.cx = cw / 2; vFull.cy = ch / 2; vFull.hw = cw / 2; vFull.hh = ch / 2;
      vFull.theta = 0; vFull.k = k;
      vFull.px = pl.minX + pl.w / 2; vFull.pz = pl.minZ + pl.h / 2;
      drawView(vFull, s, r);
    }
    const ms = performance.now() - t0;
    st.costSum += ms; st.costN++;
    if (ms > st.costMax) st.costMax = ms;
  }

  return {
    attach(bridge) {
      bridge.register("shot", onShot);
      bridge.register("streak", onStreak);
      bridge.register("death", onDeath);
      bridge.register("mission:start", onStart);
    },
    update,
    toggleFull,
    /** measured cost: avg ms per redraw, and averaged over every update() call (frame) */
    stats() {
      return {
        redraws: st.costN, frames: st.frames,
        avgMsPerRedraw: st.costN ? st.costSum / st.costN : 0,
        avgMsPerFrame: st.frames ? st.costSum / st.frames : 0,
        maxMs: st.costMax, shown: st.shown, fullOpen: st.fullOpen,
        livePings: pings.liveCount(simNow()),
      };
    },
    resetStats() { st.costSum = 0; st.costN = 0; st.costMax = 0; st.frames = 0; },
    _state: st, _pings: pings, _raster: (col) => rasterFor(col), _wrap: wrap, _full: full,
  };
}
