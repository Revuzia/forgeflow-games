/**
 * FFG runtime — sim/royale.js  (Last Circle)
 * Pure, deterministic battle-royale rules core. NO rendering, NO three.js —
 * the single source of truth consumed by the 3D genre module (ffg_royale3d.js),
 * the bot brains (royale/bots.js), and the node selftest.
 *
 * Owns: seeded RNG, the weapon/consumable tables, storm phase math, damage
 * resolution, loot rolls, and match bookkeeping (alive count, placements,
 * kill feed entries).
 *
 * !! NO BUILDING / NO HARVESTING — removed by owner decision; do NOT reintroduce.
 * There is no build grid, no support graph, no pickaxe and no materials, and the
 * exports below carry no build/harvest functions. Benchmark games (Fortnite, and
 * Final Drop, which does ship building) are NOT parity targets on this axis —
 * a parity pass must skip it. Historical CHANGELOG entries mentioning builds are
 * history, not a spec.
 *
 * Design numbers come from forgeflow-games/state/research_battle_royale.json
 * (Fortnite building/storm, PUBG ballistics/loot, Apex shields/feedback,
 * Final Drop browser-BR formula).
 *
 * Dual export: Node require() and browser window.FFG.sim.Royale.
 */
(function (root) {
  "use strict";

  // ── deterministic PRNG (family shared with iron-tide/navalfree) ────────────
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function dist2d(ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ═══════════════════════════════════════════════════════════════════════════
  // TABLES
  // ═══════════════════════════════════════════════════════════════════════════

  var RARITY = ["common", "uncommon", "rare", "epic", "legendary"];
  var RARITY_COLOR = { common: "#9da5b4", uncommon: "#3ec46d", rare: "#3fa9f5", epic: "#b05cf0", legendary: "#f2a33c" };
  var RARITY_DMG_MULT = [1.0, 1.08, 1.16, 1.24, 1.32];       // +8%/tier
  var RARITY_SPREAD_MULT = [1.0, 0.9, 0.81, 0.73, 0.66];     // -10%/tier

  // damage = body damage at full effect; falloff -> linear to 40% floor
  var WEAPONS = {
    // SIDEARM balance (owner: "PISTOL deals too much" + CoD/FN research):
    // 24 dmg @ 400rpm was 160 DPS — 97% of the AR — with the BEST hitscan head
    // multiplier and 50m reach. FN tolerates pistol≈AR DPS only because bloom
    // taxes it past ~25m; our first-shot accuracy is a laser, so the pistol
    // must pay in the COD way instead: ~80% of AR DPS (20 dmg → 133), hard
    // range falloff (18/38m — CoD sidearm band), head 1.75 (between BO's 1.4
    // and FN's 2.0). Ladder: SMG 204 close > AR 165 mid > pistol 133 backup.
    pistol:   { cls: "pistol", damage: 20, headMult: 1.75, rpm: 400, mag: 16, reloadS: 1.3, ammo: "light", speed: 999, falloff: [18, 38], spreadDeg: 1.3, adsFov: 48 },
    smg:      { cls: "smg", damage: 17, headMult: 1.5, rpm: 720, mag: 30, reloadS: 2.0, ammo: "light", speed: 999, falloff: [18, 40], spreadDeg: 2.2, adsFov: 47 },
    ar:       { cls: "ar", damage: 30, headMult: 1.5, rpm: 330, mag: 30, reloadS: 2.4, ammo: "medium", speed: 300, falloff: [60, 120], spreadDeg: 1.5, adsFov: 42 },
    // Shotgun was 10 dmg / 70 rpm / 4.0 s reload = 90 per blast, 105 DPS: the WORST
    // gun in the table at its own 7 m preferred range (SMG 204, AR 165, pistol 160)
    // and 3 blasts to break a 200 EHP bar in 1.71 s vs the SMG's 0.92 s. 13 dmg is
    // 117 per blast — a clean 2-blast kill at 156 DPS, still under the SMG's sustained
    // lane. It also un-collapses the rarity ladder: hitDamage rounds PER PELLET, so
    // base 10 gave 10/11/12/12/13 (rare and epic identical); base 13 gives 13/14/15/16/17.
    shotgun:  { cls: "shotgun", damage: 13, headMult: 1.75, rpm: 80, mag: 5, reloadS: 3.0, ammo: "shells", speed: 999, falloff: [8, 20], pellets: 9, spreadDeg: 4.0, adsFov: 49 },
    // adsTimeS: scope-in gate. Instant full-accuracy zoom on a 2.5x-headshot
    // one-tap breaks the genre contract hardest on this weapon — Warzone sniper
    // ADS runs 520-650ms vs AR 240-280ms (COMBAT_CALIBRATION.md, secondary).
    // The 0.5x ADS spread bonus, the scope camera and the overlay all gate on it.
    sniper:   { cls: "sniper", damage: 105, headMult: 2.5, rpm: 35, mag: 1, reloadS: 3.0, ammo: "heavy", speed: 700, falloff: [200, 400], spreadDeg: 0.15, scope: true, adsFov: 20, adsTimeS: 0.5 },
    glauncher:{ cls: "launcher", damage: 95, headMult: 1.0, rpm: 55, mag: 4, reloadS: 3.2, ammo: "grenades", speed: 26, arc: true, fuseS: 2.0, splashR: 3.5, spreadDeg: 0.8, adsFov: 45 },
    // FRAG GRENADE (parity P1-A, LC-14; BUILT DARK). The blast definition explode() and hitDamage() read by
    // id - it is NOT a gun: it is deliberately absent from WEAPON_IDS (loot, bot weapon choice and every
    // per-gun selftest loop iterate that list), it has no magazine or ammo, and nothing ever equips "frag"
    // as a.weapon.id. The carried item is CONSUMABLES.frag (kind "consumable", thrown by its own branch in
    // weapons.js stepWeapon, never through useConsumable / applyHeal). Apex's frag deals 100 with falloff;
    // splashScale here runs linearly to 25 % at splashR + 0.8 (the launcher's convention), fuse from the throw.
    frag:     { cls: "throwable", damage: 100, headMult: 1.0, rpm: 60, speed: 20, arc: true, fuseS: 3.0, splashR: 4.5, spreadDeg: 0 },
  };
  var WEAPON_IDS = ["pistol", "smg", "ar", "shotgun", "sniper", "glauncher"]; // lootable guns (never the frag: see WEAPONS.frag)
  // Display names. The kill feed threw away the weaponId it was handed and the
  // death screen printed the raw internal id ("glauncher"), so the one place a
  // player learns what killed them showed them a variable name.
  var WEAPON_NAMES = {
    pistol: "Pistol", smg: "SMG", ar: "Assault Rifle",
    shotgun: "Shotgun", sniper: "Sniper", glauncher: "Grenade Launcher",
    frag: "Frag Grenade",
    storm: "the Storm",
  };
  function weaponName(id) { return WEAPON_NAMES[id] || String(id || "?"); }
  /** Rough sustained-DPS worth of a gun, rarity weighted. `damage` is PER PELLET,
   *  so a shotgun scores below a pistol without the pellet term. */
  function gunScore(id, rarity) {
    var d = WEAPONS[id];
    if (!d) return -1;
    return (d.damage * (d.pellets || 1) * d.rpm / 60) + (rarity || 0) * 20;
  }

  var AMMO = {
    light:    { box: 24, max: 300 },
    medium:   { box: 20, max: 240 },
    shells:   { box: 8,  max: 60 },
    heavy:    { box: 6,  max: 36 },
    grenades: { box: 4,  max: 20 },
  };
  // every actor spawns armed — a BR shooter, not a scavenger sim
  var START_LOADOUT = { weapon: "pistol", rarity: 0, ammo: { light: 36 } };

  var CONSUMABLES = {
    bandage:     { heals: "hp", amount: 15, cap: 75, useS: 4, stack: 15 },
    medkit:      { heals: "hp", amount: 100, cap: 100, useS: 8, stack: 3 },
    mini_shield: { heals: "shield", amount: 25, cap: 50, useS: 2, stack: 6 },
    big_shield:  { heals: "shield", amount: 50, cap: 100, useS: 5, stack: 3 },
    // LC-14 frag, BUILT DARK: no `heals` key, so every heal path refuses it (player.js useConsumable/applyHeal,
    // bots.js usable(): `c.heals === "hp" ? ... : a.shield < c.cap` reads cap undefined -> false). `throws`
    // names the WEAPONS entry the blast uses. Loot weight 0 until P2-D turns it on with bot throws (P2-B).
    frag:        { throws: "frag", useS: 0, stack: 3 },
  };

  /** Throw tunables for CONSUMABLES with `throws` (weapons.js throwRound). The launch is the aim direction
   *  raised by `loft` (a natural over-arm release, so a level aim still carries ~25 m), at `speed` m/s, under
   *  `gravity`. `cycleS` = time between throws. Pure data: fragLaunch / predictArc below are the shared math,
   *  so an arc preview (P2-A HUD) and the live round can never disagree. */
  var FRAG = { speed: 20, loft: 0.17, gravity: -15, cycleS: 0.9, minElev: -0.7, maxElev: 1.25 };

  /** Launch velocity of a throw along the unit aim (dx,dy,dz). Writes {vx,vy,vz} into `out` (optional). */
  function fragLaunch(dx, dy, dz, out) {
    out = out || {};
    var hl = Math.sqrt(dx * dx + dz * dz);
    var hx = hl > 1e-6 ? dx / hl : 0, hz = hl > 1e-6 ? dz / hl : -1;
    var el = clamp(Math.atan2(dy, hl > 1e-6 ? hl : 1e-6) + FRAG.loft, FRAG.minElev, FRAG.maxElev);
    var c = Math.cos(el) * FRAG.speed;
    out.vx = hx * c; out.vy = Math.sin(el) * FRAG.speed; out.vz = hz * c;
    return out;
  }

  /** First contact of a ballistic round launched from (x,y,z) at (vx,vy,vz) under gravity g (m/s^2, negative),
   *  sampled every 1/120 s of flight on the EXACT parabola (weapons.js integrates arcing rounds exactly, so this
   *  is the same curve), tested against the terrain (heightAt(x,z)) and, when `query` is given, against static
   *  colliders swept per sample segment (query(x, z, r, buf) = maps.queryColliders). Returns
   *  {x, y, z, t, kind: "terrain"|"collider"|null, nx, ny, nz} written into `out` (optional); kind null = no contact
   *  within maxT (x/y/z then the position at maxT). Terrain contact is interpolated inside the sample segment. */
  function predictArc(x, y, z, vx, vy, vz, g, maxT, heightAt, query, buf, out) {
    out = out || {};
    var h = 1 / 120, px = x, py = y, pz = z, t = 0, n = Math.ceil((maxT || 4) / h);
    var hPrev = heightAt(px, pz);
    for (var i = 1; i <= n; i++) {
      t = i * h;
      var cx = x + vx * t, cy = y + vy * t + 0.5 * g * t * t, cz = z + vz * t;
      if (query) {
        var mx = (px + cx) * 0.5, mz = (pz + cz) * 0.5, ex = (cx - px) * 0.5, ez = (cz - pz) * 0.5;
        var cols = query(mx, mz, Math.sqrt(ex * ex + ez * ez) + 0.6, buf);
        var sh = cols && cols.length ? segmentColliders(px, py, pz, cx, cy, cz, cols) : null;
        if (sh && sh.t > 0) {
          out.x = px + (cx - px) * sh.t; out.y = py + (cy - py) * sh.t; out.z = pz + (cz - pz) * sh.t;
          out.t = t - h + h * sh.t; out.kind = "collider"; out.nx = sh.nx; out.ny = sh.ny; out.nz = sh.nz;
          return out;
        }
      }
      var hc = heightAt(cx, cz);
      if (cy <= hc) {
        var da = py - hPrev, db = cy - hc;
        var f = da > 0 && da - db > 1e-9 ? da / (da - db) : 1;
        out.x = px + (cx - px) * f; out.z = pz + (cz - pz) * f; out.y = heightAt(out.x, out.z);
        out.t = t - h + h * f; out.kind = "terrain"; out.nx = 0; out.ny = 1; out.nz = 0;
        return out;
      }
      px = cx; py = cy; pz = cz; hPrev = hc;
    }
    out.x = px; out.y = py; out.z = pz; out.t = t; out.kind = null; out.nx = 0; out.ny = 0; out.nz = 0;
    return out;
  }

  // arcade-BR speeds (owner: "not industry standard" at 8.4 — browser BRs
  // like Final Drop run ~9-10 sprint with a strong FOV kick)
  var MOVE = {
    walk: 6.0, sprint: 8.0, ads: 3.8,
    swim: 4.0, swimSprint: 5.6,
    jumpV: 7.8, gravity: -22, accelT: 0.13, airControl: 0.4,
  };

  var PLAYERK = { hp: 100, shield: 100, radius: 0.45, height: 1.8, eyeY: 1.62, swimDepth: 1.1 };

  // Crouch: the one basic shooter verb the game did not have. Today it trades
  // 55% of your movement speed for a markedly tighter hipfire cone and a lower
  // camera.
  // heightMult is MEASURED off the shipped crouch clip, not chosen. Meshy action
  // 524 "Cautious_Crouch_Walk_Forward" puts the head bone at 1.34m (max 1.36
  // across the cycle) against 1.62m standing; the standing capsule sits 0.18m
  // above the head bone, so the crouched capsule is 1.36+0.18 = 1.54m -> 0.86.
  // An earlier guess of 0.62 would have been a lie: it is a cautious crouch
  // walk, not a deep tactical squat, and a capsule shorter than the visible
  // head means shots passing through a head the player can plainly see.
  // (A procedural leg-fold was tried first and rejected — captures showed the
  // character kneeling in mid-air; there is no IK here to plant the feet.)
  var CROUCH = { speedMult: 0.72, heightMult: 0.86, eyeMult: 0.60, spreadMult: 0.62 };
  // Drinking/bandaging used to be COMPLETELY free — you could chug an 8s medkit
  // at full sprint while closing on someone, so the heal carried no cost and no
  // tell. Using one now slows you to a walk-shuffle and locks sprint out for the
  // duration: you can still reposition behind cover, you just cannot run.
  var HEAL = { speedMult: 0.45, blocksSprint: true };
  // Sprint was ENDLESS, so there was never a reason not to hold it — which made
  // 9.6 m/s the game's real movement speed rather than its burst speed, and left
  // the camera permanently trailing a runner it could not catch. Stamina turns
  // Sprint stamina REMOVED by owner direction 2026-07-28 (it was itself an
  // owner direction on 07-22 — the reversal is deliberate): sprint is infinite,
  // no meter, no exhaust lock. MOVE.sprint alone governs the chase.
  /** Height of an actor's hit capsule. Only shrinks for an actor that actually
   *  HAS the crouch clip loaded — if a skin's clip failed to bake it still
   *  stands upright, and shrinking its capsule would reintroduce the lie. */
  function actorHeight(a) {
    return PLAYERK.height * (a && a.crouching && a.hasCrouchClip ? CROUCH.heightMult : 1);
  }
  /** Eye height, accounting for crouch (camera + muzzle origin). */
  function actorEyeY(a) { return PLAYERK.eyeY * (a && a.crouching ? CROUCH.eyeMult : 1); }

  /** The ONE movement basis for a given yaw: forward (f*) and strafe-right (r*).
   *  Ground movement and the glide each derived this inline, and the glide got
   *  the strafe sign wrong — it used (cos, +sin) where the ground uses
   *  (cos, -sin), so the two axes were not perpendicular (dot = -sin(2*yaw)) and
   *  A/D under the parachute pulled the wrong way at every non-cardinal heading.
   *  Sharing it here also makes the error testable from the node selftest. */
  /** The ONE spread model, in degrees. fire() computed this inline and the
   *  crosshair guessed at it with a different, much cruder formula that knew
   *  only about moving and ADS — so the reticle never showed crouch (a 38%
   *  tighter cone), airborne (a 2x penalty), rarity, first-shot accuracy (0.15x,
   *  the biggest term of all), or even the weapon's own base spread: a shotgun
   *  and a sniper drew the same reticle. The player was never shown when they
   *  were actually accurate. Both now read from here.
   *  st: {ads, moving, airborne, crouching, sinceLastShotS} */
  function effectiveSpread(weaponId, rarity, st) {
    var def = WEAPONS[weaponId];
    if (!def) return 1;
    st = st || {};
    var spread = (def.spreadDeg || 1) * (RARITY_SPREAD_MULT[rarity] || 1);
    if (st.ads) spread *= 0.5;
    // Movement penalty GRADED BY SPEED, not a binary "are you moving".
    // It used to be a flat 1.4x for anything over 1 m/s, which meant walking and
    // sprinting cost exactly the same accuracy — so sprint was free and plain
    // walking was a strictly dominated state with no reason to ever use it.
    // Now: still 1.00, crouch-walk (~2.7) 1.20, walk (6.0) 1.45, sprint (9.6) 1.72.
    var sp = st.speed != null ? st.speed : (st.moving ? MOVE.walk : 0);
    var movePen = 1 + Math.min(0.8, Math.max(0, sp) * 0.075);
    var airPen = st.airborne ? 2 : 1;
    spread *= movePen * airPen;
    if (st.crouching) spread *= CROUCH.spreadMult;
    // FIRST-SHOT ACCURACY: a deliberate single shot while standing still goes
    // exactly where the reticle points — no bloom lottery. Tolerance rather than
    // an exact compare now that movePen is continuous.
    if (def.cls !== "shotgun" && !st.airborne && sp < 0.6) {
      // PER-SHOT BLOOM (parity P1-A, LC-33). The rule below the `if` was binary: 0.15x after 0.5 s idle,
      // else the full cone from shot 2 on, so a held AR's 2nd round was as wild as its 30th and there was
      // nothing to learn about tapping vs spraying. With a heat value the cone now opens shot by shot
      // (0.15x -> 1.0x) and closes again after you stop. `st.heat` = the heat right AFTER the last shot,
      // decayed here by st.sinceLastShotS, so a caller that only knows the time since the last shot (the
      // reticle) reads the same cone the next shot will use.
      //   st.heat === null       -> the legacy binary rule (bots: their aim error is their own model and
      //                             D8 pacing is tuned on it; gunValueAt's estimates)
      //   st.heat a number       -> the bloom model (weapons.js fire(), the local non-touch human)
      //   st.heat undefined      -> the live-heat registry below if it holds this weapon, else legacy:
      //                             hud.js reads the reticle without knowing about heat
      var heat = st.heat;
      if (heat === undefined) heat = LIVE_HEAT.id === weaponId ? LIVE_HEAT.heat : null;
      if (heat === null) {
        if ((st.sinceLastShotS || 0) > 0.5) spread *= FIRST_SHOT_MULT;
      } else {
        spread *= FIRST_SHOT_MULT + (1 - FIRST_SHOT_MULT) * heatNow(heat, st.sinceLastShotS || 0);
      }
    }
    return spread;
  }
  var FIRST_SHOT_MULT = 0.15;
  /** Heat per shot (0..1 scale: 1 = the full cone). After shot 1 the cone is 0.15 + 0.85 x perShot of the
   *  maximum (<= 0.35x for every gun here), and it is fully open by shot ceil(1 / perShot) + 1. The heat is
   *  HELD for holdS after each shot (any automatic's interval is shorter, so a held trigger accumulates)
   *  and then cools at coolPerS: a full spray is back to first-shot accuracy 0.30 + 1/3 = 0.63 s after the
   *  last round (the legacy rule: 0.5 s), a single tap after 0.37 s. The shotgun has no first-shot regime. */
  var BLOOM = {
    pistol:    { perShot: 0.20 },
    smg:       { perShot: 0.14 },
    ar:        { perShot: 0.20 },
    sniper:    { perShot: 0.50 },
    glauncher: { perShot: 0.50 },
    holdS: 0.30, coolPerS: 3.0,
  };
  function heatNow(heatAfterShot, sinceS) {
    var h = heatAfterShot - Math.max(0, sinceS - BLOOM.holdS) * BLOOM.coolPerS;
    return h < 0 ? 0 : h > 1 ? 1 : h;
  }
  /** Heat right after a shot fired at `heatBefore` (already decayed). */
  function heatAfterShot(weaponId, heatBefore) {
    var b = BLOOM[weaponId];
    return b ? Math.min(1, heatBefore + b.perShot) : 1;
  }
  // The ONE mutable thing in this module: the local human's heat, registered by weapons.js on every shot
  // (and cleared on swap / death / match reset / touch), so the reticle (hud.js -> effectiveSpread with no
  // `heat` field) draws the bloom. It never feeds the sim's outcome: fire() always passes heat explicitly.
  var LIVE_HEAT = { id: null, heat: 0 };
  function setLiveHeat(weaponId, heat) { LIVE_HEAT.id = weaponId || null; LIVE_HEAT.heat = heat || 0; }

  // ── RECOIL PATTERNS (parity P1-A, LC-01) ──────────────────────────────────
  // The human's kick re-centred at 0.12 rad/s, faster than an AR could add it (5.5 shots/s x 0.011 rad =
  // 0.06 rad/s), so a 30-round spray never climbed past ONE kick (0.52 deg, measured) and there was no
  // recoil to control. Automatics now follow a fixed per-gun pattern, shot index by shot index: the pitch
  // kick decays from a strong opening (pitch[i] = A e^(-i/tau) + B) so an uncompensated AR spray climbs
  // ~3.6 deg and plateaus, and a deterministic yaw wobble (plus the seeded jitter the old kick had)
  // makes the drift learnable. Recovery is HELD while the trigger is held and firing, then re-centres at
  // recoverPerS, never below the pitch the burst started from (a player who pulled down keeps their aim).
  // Human only (bots model error themselves), automatics only, never on touch (the touch path keeps the
  // legacy kick byte for byte). `cap` bounds the total climb whatever the stance multiplier.
  function recoilTable(n, A, tau, B, Y, w, ph) {
    var p = [], y = [];
    for (var i = 0; i < n; i++) { p.push(A * Math.exp(-i / tau) + B); y.push(Y * Math.sin(w * i + ph)); }
    return { pitch: p, yaw: y };
  }
  var RECOIL = {
    ar:  (function () { var t = recoilTable(30, 0.0078, 6, 0.0004, 0.0012, 0.45, 0.6);
      return { pitch: t.pitch, yaw: t.yaw, jitter: 0.0008, cap: 0.07, hipMult: 1.15, crouchMult: 0.85, recoverPerS: 0.26, recoverYawPerS: 0.15 }; })(),
    smg: (function () { var t = recoilTable(30, 0.0047, 8, 0.0002, 0.0010, 0.6, 2.0);
      return { pitch: t.pitch, yaw: t.yaw, jitter: 0.0007, cap: 0.05, hipMult: 1.15, crouchMult: 0.85, recoverPerS: 0.22, recoverYawPerS: 0.15 }; })(),
  };
  /** Pitch kick (rad) of shot `idx` (0-based) of a burst, before the cap. stance: {ads, crouching}. */
  function recoilPitchKick(weaponId, idx, stance) {
    var r = RECOIL[weaponId];
    if (!r) return 0;
    var k = r.pitch[idx < r.pitch.length ? idx : r.pitch.length - 1];
    if (!(stance && stance.ads)) k *= r.hipMult;
    if (stance && stance.crouching) k *= r.crouchMult;
    return k;
  }

  /** `out` is optional: pass a reusable {fx,fz,rx,rz} object on per-frame paths
   *  (player movement, every bot's fire-on-the-move) and nothing is allocated.
   *  Without it a fresh object comes back, exactly as before. */
  function moveBasis(yaw, out) {
    var s = Math.sin(yaw), c = Math.cos(yaw);
    if (out) { out.fx = -s; out.fz = -c; out.rx = c; out.rz = -s; return out; }
    return { fx: -s, fz: -c, rx: c, rz: -s };
  }

  // ── swept collision (bullets + bot line-of-sight) ──────────────────────────
  // Bullets used to test only whether a sub-step's END POINT landed inside a
  // box. Sub-steps are capped at 2.5 m, so a 0.32 m wall was missed roughly
  // 87% of the time and ramps (kind !== "box") were skipped outright: cover did
  // not stop bullets, and bot LOS shared the flaw. These are the swept tests
  // both paths now use — pure, so the node selftest can hold them honest.

  /** Segment (a→b) vs AABB, slab method. null on miss, else {t, tExit, nx,ny,nz}
   *  where t is the ENTRY fraction along a→b and n* the entry face normal
   *  (0,0,0 when the segment starts already inside). */
  // Slab state for segmentBox. The old form built five little arrays per call
  // (o, d, lo, hi, n) — and bullets, bot sight lines and cover scans call it for
  // every collider they touch, a measured 14 KB of garbage per frame on its own.
  // Scalars in module scope instead; the result object is only built on a HIT.
  // (Wave 7b, lane S1) ... and in a Float64Array, not three closure variables: a double stored into a closure slot is a fresh heap
  // number every time (two per slab test). SB[0] = entry t, SB[1] = exit t, SB[2] = the entry axis (-1 none).
  var SB = new Float64Array(3);
  function _slab(o, d, lo, hi, axis) {
    if (d > -1e-9 && d < 1e-9) return !(o < lo || o > hi);   // parallel: inside the slab or a miss
    var inv = 1 / d;
    var t1 = (lo - o) * inv, t2 = (hi - o) * inv;
    if (t1 > t2) { var sw = t1; t1 = t2; t2 = sw; }
    if (t1 > SB[0]) { SB[0] = t1; SB[2] = axis; }
    if (t2 < SB[1]) SB[1] = t2;
    return SB[0] <= SB[1];
  }
  function segmentBox(ax, ay, az, bx, by, bz, box) {
    var dx = bx - ax, dy = by - ay, dz = bz - az;
    SB[0] = 0; SB[1] = 1; SB[2] = -1;
    if (!_slab(ax, dx, box.minX, box.maxX, 0)) return null;
    if (!_slab(ay, dy, box.minY, box.maxY, 1)) return null;
    if (!_slab(az, dz, box.minZ, box.maxZ, 2)) return null;
    var nx = 0, ny = 0, nz = 0;
    var axis = SB[2];
    if (axis === 0) nx = dx > 0 ? -1 : 1;
    else if (axis === 1) ny = dy > 0 ? -1 : 1;
    else if (axis === 2) nz = dz > 0 ? -1 : 1;
    return { t: SB[0], tExit: SB[1], nx: nx, ny: ny, nz: nz };
  }

  /** Top surface of a ramp collider at (x,z) — same formula the movement
   *  support test uses, shared so the two can never disagree. */
  function rampTopAt(c, x, z) {
    var f;
    if (c.dir === 0) f = (x - c.minX) / Math.max(0.01, c.maxX - c.minX);
    else if (c.dir === 1) f = (c.maxX - x) / Math.max(0.01, c.maxX - c.minX);
    else if (c.dir === 2) f = (z - c.minZ) / Math.max(0.01, c.maxZ - c.minZ);
    else f = (c.maxZ - z) / Math.max(0.01, c.maxZ - c.minZ);
    return c.minY + (c.maxY - c.minY) * clamp(f, 0, 1);
  }

  // ── C-RAMP (Wave 5, lane 5C): a ramp is a 0.3 m SLOPED SLAB ─────────────────
  // The collider record is a box (footprint x minY..maxY) plus `dir`, but the thing
  // drawn is a plank (maps.js addRamp: BoxGeometry(w, 0.3, run), tilted, centred on
  // the walk line minY -> maxY). Bullets and sight used to treat the WHOLE wedge
  // under the surface as solid, so anyone who walked in under a ramp (movement
  // skipped ramps entirely) sat bullet-proof, and the sides could be walked through.
  //   walkable : the walk line rampTopAt (support: step <= stepUp, from any edge)
  //   bullets / sight : the plank only, |y - line| <= half its vertical thickness
  //   movement : the sides and the underside block (rampBlocks); the open space
  //              under a high ramp is walkable where a standing capsule fits
  var RAMP_THICK = 0.3;

  /** Half the plank's VERTICAL thickness: 0.15 / cos(slope). */
  function rampHalfV(c) {
    var along = (c.dir === 0 || c.dir === 1) ? c.maxX - c.minX : c.maxZ - c.minZ;
    var k = (c.maxY - c.minY) / Math.max(0.01, along);
    return RAMP_THICK * 0.5 * Math.sqrt(1 + k * k);
  }

  /** Segment vs the ramp's PLANK (not the wedge under it). Exact: inside the
   *  footprint the walk line is linear in t, so the band |y - line| <= halfV is
   *  one interval of t. null on miss, else {t, tExit, nx, ny, nz}; the normal is
   *  the plank's face normal on the side the segment arrives from (up for a shot
   *  from above, down for one from underneath); t = 0 when it starts inside. */
  function segmentRamp(ax, ay, az, bx, by, bz, c) {
    var dx = bx - ax, dy = by - ay, dz = bz - az;
    var along = (c.dir === 0 || c.dir === 1) ? c.maxX - c.minX : c.maxZ - c.minZ;
    var k = (c.maxY - c.minY) / Math.max(0.01, along);
    var s = Math.sqrt(1 + k * k);
    var hv = RAMP_THICK * 0.5 * s;
    // clip to the footprint prism; the plank never leaves minY - hv .. maxY + hv
    SB[0] = 0; SB[1] = 1; SB[2] = -1;
    if (!_slab(ax, dx, c.minX, c.maxX, 0)) return null;
    if (!_slab(az, dz, c.minZ, c.maxZ, 2)) return null;
    if (!_slab(ay, dy, c.minY - hv, c.maxY + hv, 1)) return null;
    var lo = SB[0], hi = SB[1];
    var u0, du;                                   // run coordinate from the low edge, and its rate along the segment
    if (c.dir === 0) { u0 = ax - c.minX; du = dx; }
    else if (c.dir === 1) { u0 = c.maxX - ax; du = -dx; }
    else if (c.dir === 2) { u0 = az - c.minZ; du = dz; }
    else { u0 = c.maxZ - az; du = -dz; }
    var g0 = ay - c.minY - k * u0, g1 = dy - k * du;   // height above the walk line at t = 0, and its rate
    if (g1 > -1e-12 && g1 < 1e-12) { if (g0 < -hv || g0 > hv) return null; }
    else {
      var ta = (-hv - g0) / g1, tb = (hv - g0) / g1;
      if (ta > tb) { var sw = ta; ta = tb; tb = sw; }
      if (ta > lo) lo = ta;
      if (tb < hi) hi = tb;
      if (lo > hi) return null;
    }
    var m = k / s, ny = 1 / s, nx = 0, nz = 0;
    if (c.dir === 0) nx = -m; else if (c.dir === 1) nx = m; else if (c.dir === 2) nz = -m; else nz = m;
    if (g0 + g1 * lo < 0) { nx = -nx; ny = -ny; nz = -nz; }   // arriving from underneath
    return { t: lo, tExit: hi, nx: nx, ny: ny, nz: nz };
  }

  /** C-RAMP movement test: does this ramp stop a capsule (radius r, feet at yd,
   *  height h) centred on (x, z)? It blocks like a wall where
   *    - the capsule overlaps the footprint (nearest footprint point closer than r),
   *    - the walk line there is above the step height (yd + stepUp), so it cannot
   *      be stepped onto (the same rule the support test uses), and
   *    - the plank's underside, at the lowest point the capsule disc reaches, is
   *      below the head (yd + h): the side face, and the underside, of the plank.
   *  So a ramp is climbed from its low edge (and from any side while the line is
   *  within a step), its sides are not walked through, and the open space under a
   *  high ramp is walkable exactly where a standing capsule fits under the plank.
   *  Pure; player.js blockedIn calls it with its own STEP_UP. */
  function rampBlocks(c, x, z, yd, h, r, stepUp) {
    _rbA[0] = x; _rbA[1] = z; _rbA[2] = yd; _rbA[3] = h; _rbA[4] = r; _rbA[5] = stepUp;
    return rampBlocksA(c, _rbA);
  }
  /** rampBlocks with its numbers in an array A = [x, z, yd, h, r, stepUp] (any Float64Array or array): the per-tick callers
   *  (player.js blockedF) pass them this way, because a call that is not inlined boxes every double argument (Wave 7b, lane S1:
   *  the allocation round). ONE body: rampBlocks is this function. */
  var _rbA = new Float64Array(6);
  function rampBlocksA(c, A) {
    var x = A[0], z = A[1], yd = A[2], h = A[3], r = A[4], stepUp = A[5];
    var nx = x < c.minX ? c.minX : x > c.maxX ? c.maxX : x;
    var nz = z < c.minZ ? c.minZ : z > c.maxZ ? c.maxZ : z;
    var ex = x - nx, ez = z - nz;
    if (ex * ex + ez * ez >= r * r) return false;
    var along, uc, ev;                            // run length, the centre's run coordinate, its distance outside the footprint across the run
    if (c.dir === 0) { along = c.maxX - c.minX; uc = x - c.minX; ev = ez; }
    else if (c.dir === 1) { along = c.maxX - c.minX; uc = c.maxX - x; ev = ez; }
    else if (c.dir === 2) { along = c.maxZ - c.minZ; uc = z - c.minZ; ev = ex; }
    else { along = c.maxZ - c.minZ; uc = c.maxZ - z; ev = ex; }
    var al = along > 0.01 ? along : 0.01;
    var k = (c.maxY - c.minY) / al;
    var uN = uc < 0 ? 0 : uc > al ? al : uc;      // the nearest footprint point's run coordinate
    if (c.minY + k * uN <= yd + stepUp) return false;   // low enough to step onto or over
    var reach = r * r - ev * ev;
    reach = reach > 0 ? Math.sqrt(reach) : 0;
    var uLow = uc - reach;
    if (uLow < 0) uLow = 0; else if (uLow > al) uLow = al;
    // rampHalfV(c), inlined (term for term: a call here returned a boxed double)
    var alongV = (c.dir === 0 || c.dir === 1) ? c.maxX - c.minX : c.maxZ - c.minZ;
    var kV = (c.maxY - c.minY) / Math.max(0.01, alongV);
    return c.minY + k * uLow - RAMP_THICK * 0.5 * Math.sqrt(1 + kV * kV) < yd + h;
  }

  /** LANDING SWEEP. The support test is a POINT test: the highest top <= feet + stepUp.
   *  A faller moves g*t*dt per tick, past stepUp at ~33 m/s (a drop of ~27 m), so
   *  a 0.3 m roof slab fell wholly between two ticks and the actor landed on the
   *  ground INSIDE the building (first pass-through at a 26.7 m drop, about 1 drop in 4 from 40 m up).
   *  This returns the highest top under (x, z) that the feet segment y0 -> y1 crossed
   *  this tick and the point test at y1 cannot see: y1 + stepUp < top <= y0, using
   *  the same footprint margin and the same ramp walk line as the support test. -Infinity
   *  when there is none, and always for a tick that moved no more than stepUp, so
   *  every ordinary tick is byte-identical to the point test. cols = queryColliders
   *  output (dead colliders are already skipped there). */
  function sweepSupport(cols, x, z, y0, y1, stepUp) {
    var best = -Infinity;
    if (!(y0 - y1 > stepUp)) return best;
    var floor = y1 + stepUp;
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      if (c.dead) continue;
      if (x < c.minX - 0.3 || x > c.maxX + 0.3 || z < c.minZ - 0.3 || z > c.maxZ + 0.3) continue;
      var top = c.kind === "ramp" ? rampTopAt(c, x, z) : c.maxY;
      if (top > floor && top <= y0 && top > best) best = top;
    }
    return best;
  }

  /** THE FLOOR PROBE HEIGHT OF ONE MOVER TICK (Wave 7 completion, lane D3). player.js decides "this box is a step, not a wall"
   *  in TWO places: blockedIn lets the capsule into a box whose top is <= feet + STEP_UP with the feet as they were BEFORE the tick
   *  (y0), and the support test that raises the capsule onto it ran AFTER gravity at the lower feet (y1). A box whose rise over y0
   *  is in (STEP_UP - (y0 - y1), STEP_UP] - 5.5 mm on the ground (gravity * dt^2), more in a fall - was neither a wall nor
   *  liftable: the capsule walked into it and sank. Both tests now read the floor from the same height: the support test probes from
   *  the HIGHER of the two feet (a rising tick already did: y1 > y0). Pure; on a tick that does not fall it returns y1 untouched, so
   *  jumping, walking up and every flat tick are byte-identical. Used by player.js stepActor's landing/support test. */
  function supportProbeY(y0, y1) {
    return y0 > y1 ? y0 : y1;
  }

  /** First blocking collider along a segment. `cols` is any iterable of
   *  colliders (boxes and ramps). Returns the nearest {t, n*, c} or null. */
  function segmentColliders(ax, ay, az, bx, by, bz, cols) {
    var best = null;
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      if (c.dead) continue;
      var h = c.kind === "ramp"
        ? segmentRamp(ax, ay, az, bx, by, bz, c)
        : c.kind === "box" ? segmentBox(ax, ay, az, bx, by, bz, c) : null;
      if (h && (!best || h.t < best.t)) { best = h; best.c = c; }
    }
    return best;
  }

  /** CROSSHAIR MARCH (weapons.js crosshairPoint). Distance along the unit ray
   *  (ox,oy,oz) + d*(dx,dy,dz) of the first solid thing between d0 and dMax, else
   *  dMax. The shot flies muzzle -> this point, so it has to find what the bullets
   *  will hit, and it did not:
   *    - colliders were POINT-tested every 0.75 m, which steps over a 0.32 m house
   *      wall 57 % of the time (0.40 m tower wall 47 %, 0.5 m rubble 34 %), and
   *    - only kind "box" counted, so a ramp slope was invisible to it.
   *  Colliders are now swept exactly like bullets and sight lines are (segmentBox /
   *  segmentRamp over spans of 24 m, nearest hit of the first span that has one);
   *  the terrain keeps its 0.75 m heightfield march. A collider the ray STARTS inside
   *  (t = 0) is skipped: d0 is the camera ray's closest approach to the shooter's eye,
   *  and a lens or eye grazing a trunk or ledge must not collapse the aim point onto
   *  the shooter. heightAt(x, z) and query(x, z, r, out) are the map's own functions;
   *  `out` is the caller's scratch array for query. Pure given those. */
  function aimRayDist(ox, oy, oz, dx, dy, dz, d0, dMax, heightAt, query, out) {
    var best = dMax;
    var d, x, y, z;
    for (d = d0; d < best; d += 0.75) {
      x = ox + dx * d; y = oy + dy * d; z = oz + dz * d;
      if (heightAt(x, z) > y) { best = d; break; }
    }
    var SPAN = 24;
    for (var s0 = d0; s0 < best; s0 += SPAN) {
      var s1 = s0 + SPAN < best ? s0 + SPAN : best;
      var ax = ox + dx * s0, ay = oy + dy * s0, az = oz + dz * s0;
      var bx = ox + dx * s1, by = oy + dy * s1, bz = oz + dz * s1;
      var hx = (bx - ax) * 0.5, hz = (bz - az) * 0.5;
      var cols = query((ax + bx) * 0.5, (az + bz) * 0.5, Math.sqrt(hx * hx + hz * hz) + 0.6, out);
      var bt = 2, minT = s0 === d0 ? 1e-9 : -1;       // only the FIRST span skips a collider the ray starts inside
      for (var i = 0; i < cols.length; i++) {
        var c = cols[i];
        if (c.dead) continue;
        var h = c.kind === "ramp" ? segmentRamp(ax, ay, az, bx, by, bz, c)
              : c.kind === "box" ? segmentBox(ax, ay, az, bx, by, bz, c) : null;
        if (h && h.t > minT && h.t < bt) bt = h.t;
      }
      if (bt <= 1) { best = s0 + (s1 - s0) * bt; break; }
    }
    return best;
  }

  // Storm phase tables per mode. radiusFrac × (map halfsize) = target radius.
  // Final Drop pacing (owner: circle "shrinks too much too quickly") —
  // gentler early cuts (~58-64% radius kept per phase vs ~46% before), longer
  // waits, one extra phase: ~13.5 min total on standard.
  var STORM_PHASES = {
    // PACING RESHAPED 2026-08-20 (owner: "the circle shrinks too fast").
    // Researched against the live tables: Apex ring 1 is 75 s hold + ~260 s
    // close and eats 28% of the whole match; Fortnite holds the FULL island for
    // 60 s at zero damage, then phase 1 is 110 s wait + 85 s close; PUBG gives
    // 120 s before the first circle is even drawn. Ours ran 60 s + 80 s — the
    // first wall started moving barely 20 s after a player finished landing.
    // Early phases are now long and gentle, late phases stay tight.
    // STRETCHED x1.12 2026-10-05 (owner decision D8: every bot match ended in circle 2 of 8, so the late
    // circles never played). Phase ends were 240/390/505/600/675/735/780/820 s; now 269/437/566/673/757/825/875/920 s (worst closing edge 2.5 m/s over 40 seeds; sprint is 8).
    // Every wait and shrink grew by the same 12 %, so the wall is only ever SLOWER (never faster than a player), the
    // radii, dps and the per-phase shape are untouched, and the total stays inside the 13-16 min the selftest holds.
    // A table-only stretch is NOT what lengthens the match (measured: x1.25 alone moved the median end from 326 s to
    // 417 s; the bots' own pacing, BOT_PACE below, does the rest) - what it buys is that "the hunt starts at circle 5"
    // (BOT_PACE.endgamePhase) lands at 673 s instead of 600 s.
    standard: [
      { wait: 112, shrink: 157, radiusFrac: 0.78,  dps: 1 },
      { wait:  73, shrink:  95, radiusFrac: 0.58,  dps: 1 },
      { wait:  56, shrink:  73, radiusFrac: 0.42,  dps: 2 },
      { wait:  45, shrink:  62, radiusFrac: 0.28,  dps: 3 },
      { wait:  34, shrink:  50, radiusFrac: 0.17,  dps: 5 },
      { wait:  25, shrink:  43, radiusFrac: 0.09,  dps: 7 },
      // Late phases trade WAIT for SHRINK, same per-phase totals (60s / 65s):
      // Fortnite's circles 7-9 have zero wait — the endgame storm never stops
      // moving, which is what makes final circles frantic instead of campy.
      // Ours idled 25s then 20s at exactly the moment the genre goes continuous.
      { wait: 11, shrink: 39, radiusFrac: 0.04,  dps: 9 },
      // final circle HOLDS at ~10m — closing to zero storm-killed every
      // survivor simultaneously and crowned a corpse; someone must WIN the fight
      { wait: 0, shrink: 45, radiusFrac: 0.012, dps: 12 },
    ],
    quick: [
      { wait: 30, shrink: 35, radiusFrac: 0.28, dps: 2 },
      { wait: 24, shrink: 30, radiusFrac: 0.17, dps: 4 },
      { wait: 18, shrink: 26, radiusFrac: 0.09, dps: 6 },
      { wait: 14, shrink: 22, radiusFrac: 0.04, dps: 10 },
      { wait: 12, shrink: 28, radiusFrac: 0.02, dps: 14 },
    ],
    practice: [],
  };
  // quick mode starts pre-shrunk:
  var MODE = {
    // startRadiusFrac 1.0 => opening ring sits exactly on the map edge, and the
    // ENTIRE first shrink is visible. It used to be 1.35 (and briefly 1.42 while
    // chasing square-corner coverage), which put the ring off the minimap and off
    // the 3D wall's own visibility gate: the player saw nothing move for the
    // first ~190 s and then watched the whole perceptible collapse happen in the
    // last minute — read as "it starts shrunk, then shrinks too fast".
    // Covering the square's CORNERS is unnecessary: isla_viva's islandMask
    // (maps.js mkHeightFn) reaches zero at 714 m from centre, so every metre of
    // land already sits inside a 784 m circle; the corners are open ocean.
    standard: { players: 50, startRadiusFrac: 1.0, lootMult: 1.0, drop: "glider" },
    quick:    { players: 50, startRadiusFrac: 0.75, lootMult: 1.8, drop: "ground" },
    practice: { players: 1,  startRadiusFrac: 1.35, lootMult: 1.0, drop: "ground" },
  };

  var LOOT_WEIGHTS = {
    floor: [40, 30, 18, 9, 3],
    chest: [15, 30, 30, 18, 7],
    supply: [0, 0, 10, 35, 55],
  };

  // AI skill tiers (1-indexed by tier-1) — wide spread so the lobby reads as
  // real players: beginners whiff constantly, experts are genuinely scary
  var BOT_TIERS = [
    { reactionMs: 700, aimErrDeg: 7.5 },
    { reactionMs: 500, aimErrDeg: 4.5 },
    { reactionMs: 380, aimErrDeg: 2.8 },
    { reactionMs: 300, aimErrDeg: 1.8 },
    { reactionMs: 210, aimErrDeg: 0.9 },
  ];
  // Difficulty BANDS, indexed by the account skill rating (see hud.js `skill`).
  // Every band sums to 49 (the lobby is always modeK.players and the local player
  // takes one slot). >=69% of every band sits in tiers 3-5, per the owner's call:
  // this is a bot-only opposition, not Fortnite-style filler beside real humans,
  // so it needs a real difficulty curve rather than a farmable floor.
  //
  // Tier 1 is near-eliminated on MEASURED grounds, not taste: a tier-1 bot scored
  // a 0% kill rate (0/54) in the audit while still consuming a lobby slot. It is a
  // wasted opponent, not a gentle one. The soft end is carried by tier 2-3.
  var BOT_TIER_BANDS = [
    [1, 14, 22,  9,  3],   // B0  mean tier 2.98
    [0, 10, 22, 12,  5],   // B1  3.24
    [0,  6, 20, 15,  8],   // B2  3.51
    [0,  3, 17, 19, 10],   // B3  3.73
    [0,  1, 13, 21, 14],   // B4  3.98
  ];

  /** Blend the two adjacent bands for a skill in [0,1]. The rounding remainder is
   *  pushed into the largest bucket so the result ALWAYS sums to 49 — the draw and
   *  the shipped selftest both depend on that invariant. */
  function skillMix(s01) {
    var s = clamp(s01, 0, 1) * (BOT_TIER_BANDS.length - 1);
    var i = Math.min(BOT_TIER_BANDS.length - 2, Math.floor(s));
    var f = s - i, a = BOT_TIER_BANDS[i], b = BOT_TIER_BANDS[i + 1];
    var out = [], sum = 0, big = 0;
    for (var k = 0; k < 5; k++) {
      out[k] = Math.round(a[k] + (b[k] - a[k]) * f);
      sum += out[k];
      if (out[k] > out[big]) big = k;
    }
    out[big] += 49 - sum;
    return out;
  }

  /** Mean tier of a mix, as a 0-1 scalar. This is the "how hard was that lobby"
   *  number the rating servo compares against — it is what lets ONE rating drive
   *  bots today and human matchmaking later. */
  function mixRating(mix) {
    var n = 0, w = 0;
    for (var i = 0; i < 5; i++) { n += mix[i]; w += mix[i] * (i + 1); }
    return n ? clamp((w / n - 1) / 4, 0, 1) : 0.5;
  }

  /** BOT_TIERS holds 5 discrete rows, but the in-match ramp produces FRACTIONAL
   *  tiers. Interpolating keeps a bot from snapping a whole tier sharper at a
   *  phase boundary, which is what would read as rubber-banding. */
  function interpTierK(tier) {
    var t = clamp(tier, 1, 5) - 1;
    var i = Math.min(3, Math.floor(t)), f = t - i;
    var a = BOT_TIERS[i], b = BOT_TIERS[i + 1];
    return {
      reactionMs: a.reactionMs + (b.reactionMs - a.reactionMs) * f,
      aimErrDeg: a.aimErrDeg + (b.aimErrDeg - a.aimErrDeg) * f,
    };
  }

  // Back-compat: the shipped selftest asserts both of these sum to 49.
  var BOT_TIER_MIX = { standard: BOT_TIER_BANDS[2], quick: skillMix(0.65) };
  var BOT_PERSONALITIES = ["rusher", "flanker", "camper", "loot_goblin", "rotator", "sniper"];

  // ── BOT PACING TABLE (owner decision D8, 2026-10-05) ───────────────────────
  // Target: a bot match whose MEDIAN end is >= 600 s with at most 12 of 49 dead in the first 60 s, so the late circles
  // are played. Measured before (storm on, 6 runs, isla_viva 1 and 7, ashgrid 11 and 12, deepwood 13 and 23): ends
  // 264-380 s (median 326), 9-21 dead in the first 60 s, every match over in circle 2 of 8, and ZERO storm kills - all 49
  // deaths were bot-vs-bot. Table-only fixes were measured and fall short: softening tiers 1-3 (aim 9/6/4.2 deg,
  // reaction 900/700/520 ms) +12 % (367 s), a x1.25 storm +28 % (417 s). What does it:
  //  * landing proximity (killdiag: every first-minute death is 1-36 s after touchdown, 5-60 m from the killer, mostly
  //    by a tier-4/5 AR): dropSepM keeps assigned landing spots this far apart;
  //  * the chase (kills sit at the 30-45 m a bot closes to, wherever it first noticed the target): chaseM, noticeM and
  //    pushM cap how far an UN-PROVOKED bot walks at a stranger by tier - once it is shot at (4 s) it fights as before;
  //  * convergence (everyone outside the next ring walked to its centre from second 0): rotateEdge / rotateLeadS;
  //  * the end (<= 10 alive switches the whole lobby to HUNT ~100 s before the storm would): endgamePhase;
  //  * the touchdown (all 49 bots landed inside the same 11 s, so every landing zone was live at once): earlyChutePct.
  //    Measured on 9 storm-on matches (isla_viva 1/7/3, ashgrid 11/12/5, deepwood 13/23/9): median end 701 s, first-60-s
  //    deaths max 9 (median 2), circle 5 reached in 8 of 9. A shorter notice reach just after touchdown was tried and is
  //    WORSE (23-25 dead in the first minute on isla_viva): bots that see each other at range trade low-hit shots, bots
  //    that first meet at 30 m kill each other.
  // Tier rows BOT_TIERS are NOT touched here: the 5-tier difficulty curve is the owner's, and in combination the softer
  // rows measured no better (444 s vs 477 s).  bots.js reads this table through feature detection (a sim without it
  // plays as before; QUICK mode ignores it).  All lengths are metres, tiers index 1..5.
  // WAVE-5 RE-TUNE (2026-10-13, lane F3-pacing). The 701 s / 8-of-9 above was measured on the very nine runs the table was
  // tuned on. On 63 storm-on matches (3 maps, 27 + 36 unseen seeds) BOTH Wave 4 (7f6a9fb2) and Wave 5 (4fdc31d2) reach circle 5
  // in only 30 of 63 (48 %) with a mean end of 655 s (W4) and 662 s (W5), so the Wave-5 "shift" was set A regressing to its
  // mean, not a regression. Where the deaths are (identical in both builds): 99 % bot-vs-bot (9 storm kills in 1323), 73 % in circle 1,
  // 99 % outdoors, killer in ENGAGE 99 %, median 31 m. Levers measured one at a time over 27 matches (mean end, base 657 s):
  // chaseM x0.7 +35 s and x1.4 -30 s, noticeM x1.3 +37 s and x0.7 -18 s, rotateEdge 0.95 +28 s; pushM, pushPct, dropSepM,
  // earlyChutePct, rotateLeadS and endgamePhase moved nothing beyond the +-10 s noise. It is the same mechanism as the D8 note
  // above: a bot that SEES the stranger but may not charge him trades low-hit fire at range instead of being ambushed at 30 m.
  // Chosen: noticeM x1.5 (tiers 4 and 5 are back at the old 200 m cap) and chaseM x0.6 (four candidates were compared on 36
  // seeds, this one picked). On 45 further seeds that played no part in choosing it: median end 732 s, circle 5 in 42 of 45,
  // first-60-s deaths max 8. Over all 108 matches it was run on: circle 5 in 103 (95 % interval 90-98 %), 3 matches under 650 s
  // (623-638), median end 736 s, first-60-s deaths max 8; Wave 5 on 63 of those same seeds: circle 5 in 30, max 12 dead in 60 s.
  // Side effect to know about: a bot that holds at range crouch-strafes at 0.4 x 0.45 of walk speed, and _harness/navcheck.py counts
  // any tick under 1 cm of travel as "blocked". Its ENGAGE-indoor row (bar 3 %) rises from 2.53 % to 3.42 % on the six matches it
  // plays and from 2.34 % to 2.66 % on 18 others, all of it in blocked runs shorter than 6 ticks (direction reversals): blocked runs
  // of 6+ ticks, i.e. real grinding, stay 0.50 % -> 0.53 % (Wave 4: 22.25 %). The same pacing was measured with noticeM
  // [90,115,140,180,200] / chaseM [22,28,32,40,50] (circle 5 in 87 of 90); that row sat at 2.95 % - the proxy is within its noise.
  var BOT_PACE = {
    noticeM:  [105, 135, 165, 200, 200],  // how far a bot notices a stranger who has not shot it (200 for every tier before D8; 70-170 in D8)
    chaseM:   [27, 33, 39, 48, 60],       // how far it will WALK at one it has not been hit by (unlimited before D8; 45-100 in D8; 27-60 now)
    pushM:    120, pushPct: 50,           // gunfire answered inside this range, by this share of the aggressive personalities (was 250 m, 100 %)
    dropSepM: 100,                        // landing spots this far apart (was: up to a dozen bots per POI)
    rotateEdge: 0.8, rotateLeadS: 0,      // rotate to 0.8 x the next ring's radius on the bot's own bearing (was a random point inside 25-75 %); no 40-score rotation before the 70 one
    endgamePhase: 5,                      // "endgame" (<= 10 alive: HUNT, +20 ENGAGE, no camping) only from this circle on (was: always)
    earlyChutePct: 40,                    // this share of the non-rushers opens the canopy at the jump: touchdowns spread 22-49 s (was all 49 inside 22-33 s)
  };

  var BOT_NAMES = [
    "Zephyx", "NoScopeNate", "CrackedTina", "BushWookie7", "DriftKing", "PixelPete", "QuietStorm",
    "RampRat", "MetaMike", "SoloQueueSue", "TiltedTy", "90sKid", "BoxedLikeAFish", "LaserLena",
    "CamperVan", "WKeyWarrior", "EditLord", "MatsForDays", "StormDodger", "GreyZone", "HotDropHank",
    "SniperSloth", "CrateCarl", "VendettaV", "MongoalMax", "PhaseRunner", "JitterJay", "OneShotOna",
    "TarpTown", "GoldenGoose", "FishstickFan", "RezMePls", "ZeroBuildZoe", "PumpPeek", "CraftyKat",
    "LlamaLarry", "StreamSniped", "AFKAndy", "ClutchClara", "BaitedBen", "TunnelTim", "HighGroundHera",
    "DoubleRampDan", "PrefireFreya", "GhostPeeker", "ShotgunSherpa", "MinigunMona", "BunnyHopBo",
    "SweatySteve", "DefaultDave", "CoachCarter", "PlateStacker", "RiftWalker", "EchoFox", "NadeParade",
    "TenaciousTee", "BlueprintBill", "StormSurferSam", "CozyCampfire", "FlickMaster", "JuiceBoxJin",
    "VaultedVicky", "OGSkinOtto", "PicklePlays", "TurboTess", "WallTaker", "KeyboardKai", "MildSalsa",
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // STORM
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * Deterministic storm schedule. Built once from (seed, mode, map halfsize).
   * Query with stateAt(t) -> { center:{x,z}, radius, dps, phase, phaseState,
   * tToNext, closing } — pure function of time, so host and clients agree.
   */
  function Storm(opts) {
    this.mode = opts.mode || "standard";
    this.half = opts.half;                    // map half-size (m)
    this.phases = STORM_PHASES[this.mode] || [];
    var rng = mulberry32((opts.seed >>> 0) ^ 0x51f0c3);
    var startR = (MODE[this.mode] || MODE.standard).startRadiusFrac * this.half;
    // Precompute circle sequence: each target circle fully inside the previous.
    this.circles = [{ x: 0, z: 0, r: startR }];
    var prev = this.circles[0];
    for (var i = 0; i < this.phases.length; i++) {
      var r = this.phases[i].radiusFrac * this.half;
      // 0.5 (was 0.8): the offset ADDS to how far the trailing edge sweeps, and
      // at 0.8 a bad roll made the far side close at (1.8 x dR)/shrink — up to
      // 10 m/s on standard phase 1 and 19 m/s on quick vs 8.0 sprint: a death
      // with no counterplay. 0.5 keeps circles wandering without doubling the sweep.
      // Fortnite's early safe zones are STRICTLY CONCENTRIC — move distance is
      // literally 0 m through phase 6 — and only relocate from phase 7 on, which
      // is a deliberate anti-camping device: holding the centre is correct early
      // and worthless late. Copy that shape. It also matters mechanically here,
      // because the centre offset ADDS to the distance the far edge must sweep,
      // and a wandering opening circle is what makes the first storm feel like
      // it is chasing you across the map.
      var OFF_FRAC = [0.06, 0.10, 0.22, 0.34, 0.46, 0.55, 0.60, 0.60];
      var maxOff = Math.max(0, prev.r - r) * (OFF_FRAC[i] != null ? OFF_FRAC[i] : 0.5);
      var ang = rng() * Math.PI * 2, off = rng() * maxOff;
      var cx = prev.x + Math.cos(ang) * off, cz = prev.z + Math.sin(ang) * off;
      // clamp inside map bounds
      cx = clamp(cx, -this.half + r, this.half - r);
      cz = clamp(cz, -this.half + r, this.half - r);
      var c = { x: cx, z: cz, r: r };
      this.circles.push(c);
      prev = c;
    }
    // OUTRUNNABLE GUARANTEE: a sprinting player (8.0 m/s) caught at the far rim
    // must be able to stay just ahead of the closing edge. The edge's worst-case
    // travel this phase is (radius delta + center offset) — both known exactly
    // here — so extend the shrink time until edge speed <= EDGE_MAX. Purely a
    // function of (seed, mode, half), so host and clients still agree.
    // Edge speed as a FRACTION OF SPRINT (MOVE.sprint = 8.0 m/s), per phase.
  // A single global 6.4 (80% of sprint) applied the endgame's pressure to the
  // opening circle. Researched shape: Apex ring 1 closes at 54-55% of sprint;
  // PUBG's early zones are outrunnable at a jog while its LATE walls run
  // 1.5-3.0 m/s (24-48% of sprint) because the zones are tiny by then. So:
  // gentle early, demanding mid, and late phases capped by small absolute
  // distances rather than raw speed.
  var EDGE_FRAC = [0.50, 0.55, 0.60, 0.65, 0.70, 0.72, 0.75, 0.75];
    this.shrinkS = [];
    for (var m = 0; m < this.phases.length; m++) {
      var ca = this.circles[m], cb = this.circles[m + 1];
      var edgeTravel = (ca.r - cb.r) + Math.sqrt((cb.x - ca.x) * (cb.x - ca.x) + (cb.z - ca.z) * (cb.z - ca.z));
      var cap = (EDGE_FRAC[m] != null ? EDGE_FRAC[m] : 0.75) * MOVE.sprint;
      this.shrinkS.push(Math.max(this.phases[m].shrink, edgeTravel / cap));
    }
    // Phase timeline: [waitEnd, shrinkEnd] pairs cumulative
    this.timeline = [];
    var t = 0;
    for (var j = 0; j < this.phases.length; j++) {
      var ph = this.phases[j];
      this.timeline.push({ waitStart: t, shrinkStart: t + ph.wait, end: t + ph.wait + this.shrinkS[j] });
      t += ph.wait + this.shrinkS[j];
    }
    this.totalS = t;
  }

  /** The state is a pure function of t, and every frame asks for the SAME t many
   *  times (storm.js, the HUD, every thinking brain, loot): three fresh objects per
   *  call was ~1 KB of garbage a frame. The last answer is kept and handed back
   *  for a repeat t. Callers only read it (no writes into a returned state
   *  anywhere in runtime/, grep 2026-10-01); a NEW t always builds a new object, so
   *  a state an event listener kept is never changed under it. */
  Storm.prototype.stateAt = function (t) {
    if (this._memo !== undefined && this._memoT === t) return this._memo;
    var s = this._stateAt(t);
    this._memoT = t; this._memo = s;
    return s;
  };
  Storm.prototype._stateAt = function (t) {
    if (!this.phases.length) {
      return { center: { x: 0, z: 0 }, radius: this.circles[0].r, dps: 0, phase: 0, phaseState: "idle", tToNext: Infinity, closing: false, done: false };
    }
    for (var i = 0; i < this.timeline.length; i++) {
      var tl = this.timeline[i], ph = this.phases[i];
      var from = this.circles[i], to = this.circles[i + 1];
      if (t < tl.shrinkStart) {
        // Both rings are always visible, as in Fortnite and PUBG. An earlier fix
        // hid the first target circle during the opening wait (Apex does that),
        // but the bots read nextCenter/nextRadius directly for their rotation
        // scoring — so hiding it from the HUD only handicapped the human.
        return { center: { x: from.x, z: from.z }, radius: from.r, dps: i === 0 ? 0 : this.phases[i - 1].dps,
                 phase: i + 1, phaseState: "waiting", tToNext: tl.shrinkStart - t, closing: false, done: false,
                 nextCenter: { x: to.x, z: to.z }, nextRadius: to.r };
      }
      if (t < tl.end) {
        var k = (t - tl.shrinkStart) / (tl.end - tl.shrinkStart);
        return { center: { x: lerp(from.x, to.x, k), z: lerp(from.z, to.z, k) }, radius: lerp(from.r, to.r, k),
                 phase: i + 1, phaseState: "closing", dps: ph.dps, tToNext: tl.end - t, closing: true, done: false,
                 nextCenter: { x: to.x, z: to.z }, nextRadius: to.r };
      }
    }
    var last = this.circles[this.circles.length - 1];
    return { center: { x: last.x, z: last.z }, radius: last.r, dps: this.phases[this.phases.length - 1].dps,
             phase: this.phases.length, phaseState: "done", tToNext: Infinity, closing: false, done: true };
  };

  Storm.prototype.damageAt = function (t, x, z) {
    var s = this.stateAt(t);
    if (s.dps <= 0) return 0;
    var d = dist2d(x, z, s.center.x, s.center.z);
    return d > s.radius ? s.dps : 0;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // DAMAGE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Effective damage for one hit. */
  // Damage is a RANGE, not a constant (owner direction 2026-09-15: "damage of
  // attack weapons isnt always the same, rather it is within a RANGE of damage,
  // which makes sense for that specific weapon"). This is the +/- fraction of
  // nominal a single hit can swing, chosen per weapon so the spread reads as
  // that weapon's character: a sniper is a precision instrument and barely
  // varies, a cheap SMG sprays, a shotgun is the loosest thing in the game.
  var DMG_SPREAD = {
    sniper: 0.04,      // 101-109 at base 105
    ar:     0.08,      // 28-32 at base 30
    pistol: 0.10,      // 18-22 at base 20
    glauncher: 0.10,   // variable explosive yield
    smg:    0.12,      // 15-19 at base 17
    shotgun: 0.15,     // per PELLET, on top of how many pellets land
    frag: 0.10,        // same explosive yield swing as the launcher
  };

  /** `roll` is an optional [0,1) sample. Omit it for the NOMINAL value — every
   *  pre-existing caller and the selftest's exact-value assertions rely on that
   *  — pass one per shot to get the weapon's damage range. */
  function hitDamage(weaponId, rarityTier, distM, isHead, roll) {
    var w = WEAPONS[weaponId];
    if (!w) return 0;
    var dmg = w.damage * (RARITY_DMG_MULT[rarityTier || 0] || 1);
    if (w.falloff) {
      var f0 = w.falloff[0], f1 = w.falloff[1];
      if (distM > f0) dmg *= lerp(1, 0.4, clamp((distM - f0) / Math.max(1, f1 - f0), 0, 1));
    }
    if (isHead) dmg *= w.headMult;
    if (roll != null) {
      var sp = DMG_SPREAD[weaponId] != null ? DMG_SPREAD[weaponId] : 0.08;
      dmg *= 1 + (clamp(roll, 0, 1) * 2 - 1) * sp;
    }
    // a hit that connects always registers — never round a graze down to zero
    return Math.max(1, Math.round(dmg));
  }

  /** Shield-first application. Returns { shield, hp, dealt, broke, dead, toShield, toHp }. */
  function applyDamage(shield, hp, dmg) {
    var toShield = Math.min(shield, dmg);
    var toHp = Math.min(hp, dmg - toShield);
    var ns = shield - toShield, nh = hp - toHp;
    return { shield: ns, hp: nh, dealt: toShield + toHp, broke: shield > 0 && ns === 0, dead: nh <= 0, toShield: toShield, toHp: toHp };
  }

  /** Splash damage scale by distance from blast center (linear to 25% at edge). */
  function splashScale(distM, splashR) {
    if (distM >= splashR) return 0;
    return lerp(1, 0.25, distM / splashR);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOOT
  // ═══════════════════════════════════════════════════════════════════════════

  function weightedIndex(rng, weights) {
    var total = 0, i;
    for (i = 0; i < weights.length; i++) total += weights[i];
    var roll = rng() * total;
    for (i = 0; i < weights.length; i++) { roll -= weights[i]; if (roll <= 0) return i; }
    return weights.length - 1;
  }

  function rollRarity(rng, table) { return weightedIndex(rng, LOOT_WEIGHTS[table] || LOOT_WEIGHTS.floor); }

  // ── FLOOR LOOT ECONOMY (audit 2026-09, bots-match M2/M5/M6) ────────────────
  // Measured over 11 storm-on matches: 74.8% of bot lives ended holding the starter
  // pistol and 60.2% of gun kills were pistol kills — and at 72% of those pistol
  // kills there was NO better gun or chest within 40 m of the killer. It was
  // scarcity, not bad choices: 1.42-2.32 guns per player on the map, and isla_viva
  // spawned ONE light-ammo box for 50 players. So a floor gun now always lies with
  // 1-2 boxes of its own ammo beside it (as rollChest already did), guns are a
  // larger share of floor spawns, and the floor pistol is rarer: everyone already
  // spawns holding one, so a floor pistol is the least useful gun in the game.
  var FLOOR_GUN_SHARE = 0.55;
  var FLOOR_AMMO_SHARE = 0.20;           // standalone ammo; guns bring their own
  var FLOOR_GUN_WEIGHTS = [8, 24, 26, 20, 12, 10];   // pistol smg ar shotgun sniper glauncher
  // consumable rolls; the trailing "frag" entry is weight 0 until P2-D (LC-14 built dark)
  var FLOOR_CON_IDS = ["bandage", "mini_shield", "medkit", "big_shield", "frag"];
  var FLOOR_CON_WEIGHTS = [32, 34, 18, 16, 0];
  var CHEST_CON_IDS = ["mini_shield", "big_shield", "medkit", "bandage", "frag"];
  var CHEST_CON_WEIGHTS = [34, 26, 20, 20, 0];

  /** One floor-spawn item. kind: weapon|ammo|consumable.
   *  A weapon carries `companions`: its own ammo, 1-2 boxes' worth, as ONE item
   *  (one pickup, one mesh — a box per box would double the loot draw calls). */
  function rollFloorItem(rng) {
    var r = rng();
    if (r < FLOOR_GUN_SHARE) {
      var wid = WEAPON_IDS[weightedIndex(rng, FLOOR_GUN_WEIGHTS)];
      var gun = { kind: "weapon", id: wid, rarity: rollRarity(rng, "floor") };
      var am = WEAPONS[wid].ammo;
      if (am && AMMO[am]) {
        var boxes = rng() < 0.5 ? 1 : 2;
        gun.companions = [{ kind: "ammo", id: am, count: AMMO[am].box * boxes }];
      }
      return gun;
    }
    if (r < FLOOR_GUN_SHARE + FLOOR_AMMO_SHARE) {
      var aid = ["light", "medium", "shells", "heavy", "grenades"][weightedIndex(rng, [30, 28, 22, 12, 8])];
      return { kind: "ammo", id: aid, count: AMMO[aid].box };
    }
    // "frag" rides LAST at weight 0 (LC-14, built dark): weightedIndex never lands on a trailing zero-weight
    // entry (the running roll is already <= 0 at the last positive weight) and the total is unchanged, so
    // every seed rolls exactly what it rolled before. P2-D raises the weight with MAP_GEN_VERSION.
    var cid = FLOOR_CON_IDS[weightedIndex(rng, FLOOR_CON_WEIGHTS)];
    return { kind: "consumable", id: cid, count: cid === "bandage" ? 5 : cid === "mini_shield" ? 3 : cid === "frag" ? 2 : 1 };
  }

  /** Flat list for one floor roll: [item, ...its companions], companions stripped
   *  off the item so they never ride along into an inventory slot. */
  function rollFloorSpawn(rng) {
    var it = rollFloorItem(rng);
    var out = [it];
    if (it.companions) {
      for (var i = 0; i < it.companions.length; i++) out.push(it.companions[i]);
      delete it.companions;
    }
    return out;
  }

  /** How many floor rolls a loot point gets. First roll almost always, a second
   *  one sometimes — a pile, not a single item. `lootMult` is MODE[mode].lootMult. */
  var FLOOR_ROLL_P = [0.85, 0.25];
  function floorRollCount(rng, lootMult) {
    var m = lootMult || 1;
    var n = 0;
    if (rng() < Math.min(0.97, FLOOR_ROLL_P[0] * Math.sqrt(m))) n++;
    if (rng() < Math.min(0.9, FLOOR_ROLL_P[1] * m)) n++;
    return n;
  }

  // ── RANGE-AWARE WEAPON VALUE ──────────────────────────────────────────────
  // Bots chose weapons by raw sustained DPS: pistol 133, sniper 61, launcher 87,
  // so a sniper of ANY rarity never cleared 1.15 x pistol and ensureGunOut swapped
  // every sniper and most launchers straight back to the starter pistol (34.4% of
  // sniper/launcher carriers held the pistol; 4 sniper kills in 539). What a gun is
  // worth depends on HOW FAR the target is and HOW HURT it is, so this is a
  // TIME-TO-KILL estimate against a man-sized target, built only from the game's own
  // tables: damage + falloff (hitDamage), spread (effectiveSpread — which already
  // hands a slow-cycling sniper its first-shot bonus on every shot), mag, fire rate,
  // reload, projectile speed. A fixed ~1 deg of hand wobble sits on top of the
  // weapon's spread, and a slow shell gives the target time to move (2 m/s of
  // unpredictable motion over the flight). No class bonus is invented: the sniper
  // overtakes the pistol at ~40 m because 105 at full damage with first-shot
  // accuracy beats 8 damage a round past the pistol's 38 m falloff — the table.
  // Returns a rate (target EHP / seconds-to-kill); higher is better; 0 = useless.
  var VALUE_AIM_DEG = 1.0;              // typical hand wobble on top of weapon spread
  var VALUE_DODGE_MS = 2.0;             // target motion a slow round has to absorb
  var TARGET_HALF_W = 0.45, TARGET_HALF_H = 0.9;
  var LAUNCHER_MAX_M = 40;              // 26 m/s shell, 2 s fuse, ~0.7 rad max lob
  /** opts: {ehp (target shield+hp, default 150), speed (shooter m/s),
   *  mag (rounds loaded; omit = full), reserve (rounds in reserve; omit = plenty),
   *  aimDeg (the shooter's RMS aim error in degrees; omit = VALUE_AIM_DEG),
   *  trackM (a LINEAR miss at the target in metres that does not shrink with range:
   *  a turret that lags a strafing target by a fixed time misses it by
   *  lateral speed x lag wherever it stands; omit = 0)} */
  function gunValueAt(id, rarity, distM, opts) {
    var d = WEAPONS[id];
    if (!d) return 0;
    opts = opts || {};
    var dist = Math.max(0.5, distM || 0);
    if (d.arc && dist > LAUNCHER_MAX_M) return 0;             // shell cannot reach
    var ehp = Math.max(1, opts.ehp != null ? opts.ehp : 150);
    var interval = 60 / d.rpm;
    var loaded = opts.mag != null ? opts.mag : d.mag;
    var reserve = opts.reserve != null ? opts.reserve : Infinity;
    if (loaded + reserve <= 0) return 0;                        // dry: worth nothing
    var spread = effectiveSpread(id, rarity || 0, {
      ads: dist > 25, speed: opts.speed || 0, airborne: false, crouching: false, sinceLastShotS: interval, heat: null,
    });
    var aim = opts.aimDeg != null ? opts.aimDeg : VALUE_AIM_DEG;   // the shooter's own aim error, when known
    var ang = Math.sqrt(spread * spread + aim * aim) * Math.PI / 180;
    var flight = d.speed ? dist / d.speed : 0;
    var track = opts.trackM || 0;
    var reach = Math.sqrt(Math.pow(dist * Math.tan(ang), 2) + Math.pow(flight * VALUE_DODGE_MS, 2) + track * track);
    var splash = d.splashR ? d.splashR * 0.5 : 0;
    var fx = Math.min(1, (TARGET_HALF_W + splash) / Math.max(1e-6, reach));
    var fy = Math.min(1, (TARGET_HALF_H + splash) / Math.max(1e-6, reach));
    var pHit = fx * fy;                                         // one round lands
    var pellets = d.pellets || 1;
    var dmg = hitDamage(id, rarity || 0, dist, false);          // per round that lands
    // expected trigger pulls to kill: enough landed damage, and at least one landed pull
    var perPull = dmg * pellets * pHit;
    var pPull = 1 - Math.pow(1 - pHit, pellets);                // any pellet lands
    var pulls = Math.max(1 / Math.max(1e-6, pPull), ehp / Math.max(1e-6, perPull));
    var t = 0;
    if (loaded <= 0) { t += d.reloadS; loaded = Math.min(d.mag, reserve); reserve -= loaded; }
    // AMMO LIMIT: when the rounds on hand run out before the kill, the gun delivers
    // only that share of it, at its own rate. This used to return a flat 0.01
    // ("cannot finish this fight"), a cliff: a bot with 60 rifle rounds and a 3 deg
    // wobble at 40 m valued its AR at nothing and fought with the pistol, whose
    // light ammo is the commonest box (measured 2026-09-30: 6-8 of ~25 pistol kills
    // per match were by bots carrying a loaded AR).
    // The RATE is the full kill's (reloads included), so more ammo can never make a
    // gun worth less; only the deliverable share shrinks.
    var have = loaded + reserve;
    var frac = pulls > have ? have / pulls : 1;
    t += (pulls - 1) * interval + flight;
    // Rounds beyond the loaded magazine cost reloads. The fire-rate timer keeps
    // running during a reload (weapons.js stepWeapon), so each reload adds only
    // what it outlasts the shot interval by — a 1-round sniper cycles at its 3.0 s
    // reload, not at 1.71 s + 3.0 s.
    if (pulls > loaded) t += Math.max(0, d.reloadS - interval) * (pulls - loaded) / Math.max(1, d.mag);   // expected, not ceil: smooth in range
    var v = ehp * frac / (t + 0.3);                             // 0.3 s: first-shot latency
    if (d.splashR && dist < d.splashR + 1.5) v *= 0.25;         // it would hit you too
    return v;
  }

  /** Chest burst: weapon + ammo for it + one extra. */
  function rollChest(rng) {
    var wid = WEAPON_IDS[weightedIndex(rng, [8, 20, 26, 20, 14, 12])];
    var w = WEAPONS[wid];
    var items = [{ kind: "weapon", id: wid, rarity: rollRarity(rng, "chest") }];
    if (w.ammo) items.push({ kind: "ammo", id: w.ammo, count: AMMO[w.ammo].box * 2 });
    var r = rng();
    if (r < 0.55) {
      var cid = CHEST_CON_IDS[weightedIndex(rng, CHEST_CON_WEIGHTS)];   // frag last at weight 0 (see rollFloorItem)
      items.push({ kind: "consumable", id: cid, count: cid === "bandage" ? 5 : cid === "mini_shield" ? 3 : cid === "frag" ? 2 : 1 });
    } else {
      items.push({ kind: "ammo", id: ["light", "medium", "shells"][weightedIndex(rng, [34, 34, 32])], count: 20 });
    }
    return items;
  }

  function rollSupplyDrop(rng) {
    var wid = WEAPON_IDS[weightedIndex(rng, [0, 5, 30, 20, 25, 20])];
    return [
      { kind: "weapon", id: wid, rarity: rollRarity(rng, "supply") },
      { kind: "consumable", id: "big_shield", count: 2 },
      { kind: "consumable", id: "medkit", count: 1 },
      { kind: "ammo", id: WEAPONS[wid].ammo || "medium", count: (AMMO[WEAPONS[wid].ammo || "medium"] || AMMO.medium).box * 3 },
    ];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MATCH BOOKKEEPING
  // ═══════════════════════════════════════════════════════════════════════════
  /** Tracks alive/placement/kills. Actors registered by id. */
  function Match(opts) {
    this.mode = (opts && opts.mode) || "standard";
    this.totalPlayers = (opts && opts.players) || 50;
    this.alive = new Set();
    this.placements = [];   // ids in elimination order (first died = index 0)
    this.kills = {};        // id -> count
    this.damage = {};       // id -> total damage dealt
    this.feed = [];         // {t, killer, victim, weapon}
    this.over = false;
    this.winner = null;
    // Squads: optional teamOf(id) -> team key. Left null for solo, where every
    // player is their own team and _teamsAlive() collapses back to alive.size.
    this.teamOf = (opts && opts.teamOf) || null;
    this.winners = null;    // every surviving member of the winning squad
  }
  Match.prototype.register = function (id) { this.alive.add(id); this.kills[id] = 0; this.damage[id] = 0; };
  Match.prototype.aliveCount = function () { return this.alive.size; };
  /** Distinct squads still alive. Solo (no teamOf) = one squad per player. */
  Match.prototype._teamsAlive = function () {
    if (!this.teamOf) return this.alive.size;
    var seen = Object.create(null), n = 0, self = this;
    this.alive.forEach(function (id) {
      var t = self.teamOf(id);
      if (!seen[t]) { seen[t] = 1; n++; }
    });
    return n;
  };
  Match.prototype.recordDamage = function (attackerId, amount) {
    if (attackerId != null && this.damage[attackerId] != null) this.damage[attackerId] += amount;
  };
  Match.prototype.eliminate = function (victimId, killerId, weaponId, t) {
    if (!this.alive.has(victimId) || this.over) return null;
    this.alive.delete(victimId);
    this.placements.push(victimId);
    if (killerId != null && killerId !== victimId && this.kills[killerId] != null) this.kills[killerId]++;
    this.feed.push({ t: t || 0, killer: killerId, victim: victimId, weapon: weaponId || "storm" });
    if (this._teamsAlive() === 1) {
      this.over = true;
      // The whole surviving squad wins, so all of them go on the placement list.
      // winner stays the first survivor for callers that still read the scalar.
      this.winners = Array.from(this.alive);
      this.winner = this.winners[0];
      for (var i = 0; i < this.winners.length; i++) this.placements.push(this.winners[i]);
    }
    return { placement: this.totalPlayers - this.placements.length + 1 };
  };
  /** 1 = winner. For an id that died: position at elimination. */
  Match.prototype.placementOf = function (id) {
    // A winning squad shares placement 1. Without this the second member sits one
    // slot further down `placements` and would read as #0.
    if (this.winners && this.winners.indexOf(id) >= 0) return 1;
    var idx = this.placements.indexOf(id);
    if (idx < 0) return null;
    return this.totalPlayers - idx;
  };
  /** True for every member of the winning squad, not just the scalar winner. */
  Match.prototype.isWinner = function (id) {
    return this.winners ? this.winners.indexOf(id) >= 0 : this.winner === id;
  };

  // exports -------------------------------------------------------------------
  var api = {
    mulberry32: mulberry32, clamp: clamp, dist2d: dist2d, lerp: lerp,
    RARITY: RARITY, RARITY_COLOR: RARITY_COLOR, RARITY_DMG_MULT: RARITY_DMG_MULT, RARITY_SPREAD_MULT: RARITY_SPREAD_MULT,
    WEAPONS: WEAPONS, WEAPON_IDS: WEAPON_IDS, WEAPON_NAMES: WEAPON_NAMES, weaponName: weaponName, gunScore: gunScore, AMMO: AMMO, CONSUMABLES: CONSUMABLES, START_LOADOUT: START_LOADOUT,
    MOVE: MOVE, PLAYERK: PLAYERK, CROUCH: CROUCH, HEAL: HEAL, DMG_SPREAD: DMG_SPREAD, effectiveSpread: effectiveSpread,
    actorHeight: actorHeight, actorEyeY: actorEyeY, moveBasis: moveBasis,
    segmentBox: segmentBox, rampTopAt: rampTopAt, segmentRamp: segmentRamp,
    segmentColliders: segmentColliders,
    RAMP_THICK: RAMP_THICK, rampHalfV: rampHalfV, rampBlocks: rampBlocks, rampBlocksA: rampBlocksA, sweepSupport: sweepSupport, supportProbeY: supportProbeY, aimRayDist: aimRayDist,
    STORM_PHASES: STORM_PHASES, MODE: MODE, LOOT_WEIGHTS: LOOT_WEIGHTS,
    BOT_TIERS: BOT_TIERS, BOT_TIER_MIX: BOT_TIER_MIX, BOT_PERSONALITIES: BOT_PERSONALITIES, BOT_NAMES: BOT_NAMES,
    BOT_TIER_BANDS: BOT_TIER_BANDS, skillMix: skillMix, mixRating: mixRating, interpTierK: interpTierK, BOT_PACE: BOT_PACE,
    clamp: clamp,
    Storm: Storm, Match: Match,
    hitDamage: hitDamage, applyDamage: applyDamage, splashScale: splashScale,
    weightedIndex: weightedIndex, rollRarity: rollRarity, rollFloorItem: rollFloorItem, rollChest: rollChest, rollSupplyDrop: rollSupplyDrop,
    rollFloorSpawn: rollFloorSpawn, floorRollCount: floorRollCount, FLOOR_GUN_WEIGHTS: FLOOR_GUN_WEIGHTS,
    gunValueAt: gunValueAt,
    // parity P1-A
    FRAG: FRAG, fragLaunch: fragLaunch, predictArc: predictArc,
    BLOOM: BLOOM, FIRST_SHOT_MULT: FIRST_SHOT_MULT, heatNow: heatNow, heatAfterShot: heatAfterShot, setLiveHeat: setLiveHeat,
    RECOIL: RECOIL, recoilPitchKick: recoilPitchKick,
    FLOOR_CON_IDS: FLOOR_CON_IDS, FLOOR_CON_WEIGHTS: FLOOR_CON_WEIGHTS, CHEST_CON_IDS: CHEST_CON_IDS, CHEST_CON_WEIGHTS: CHEST_CON_WEIGHTS,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FFG = root.FFG || {};
  root.FFG.sim = root.FFG.sim || {};
  root.FFG.sim.Royale = api;
})(typeof window !== "undefined" ? window : globalThis);
