// core/ai/perception.js [A5] — awareness meter (0→1) + night light-factor,
// hearing table (updates lastKnown ONLY — never a wallhack), LOS
// (combat_spec §5.1–5.2; architecture §3.9). THREE-free, deterministic (all
// rolls from the passed rngAi stream). Frozen signature perceive(...).
//
// Awareness (§5.1): fill = 2.5/s × distFactor × facingFactor × lightFactor ×
// stanceFactor × speedFactor; decay 0.25/s with no stimulus; 0.5 →
// INVESTIGATE, 1.0 → confirmed (botfsm rolls the latched reaction).
// detectRange = 18 + 62 × light (×1.2 while the bot is in 'alert' — R17).
// Muzzle flash: player fired ≤1.2 s ago → effective light 1.0 within 120 m
// LOS (flashes are information both ways).
// Hearing (§5.2): caps awareness at 0.85 — a bot must SEE the player (or be
// hit) to confirm. Being hit = instant awareness 1.0 toward the origin
// sector (±4 m fuzz).
//
// noTarget (sim.flags.noTarget): the player does not exist to perception —
// keeps A1's ballistic probes clean (their needsElsewhere contract point 3).

const BASE_FILL = 2.5;
const DECAY_PER_S = 0.25;
const HEARD_CAP = 0.85;
const FLASH_WINDOW_S = 1.2;
const FLASH_RANGE_M = 120;

export function detectRange(light, alert) {
  return (18 + 62 * Math.min(1, Math.max(0, light))) * (alert ? 1.2 : 1);
}

export function lightFactor(light) {
  return 0.30 + 0.70 * Math.min(1, Math.max(0, light));
}

// facing: 1.0 inside the 110° cone; 0.35 in the 110–160° periphery (≤12 m
// only); 0 behind. `ang` = |angle between facing and to-target| in radians.
export function facingFactor(ang, dist) {
  const HALF_CONE = (110 / 2) * Math.PI / 180;   // 0.9599
  const HALF_PERI = (160 / 2) * Math.PI / 180;   // 1.3963
  if (ang <= HALF_CONE) return 1.0;
  if (ang <= HALF_PERI && dist <= 12) return 0.35;
  return 0;
}

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function botEye(bot) {
  return [bot.pos[0], bot.pos[1] + (bot.stance === "crouch" ? 1.10 : 1.62), bot.pos[2]];
}

export function perceive(bot, sim, world, dt, rngAi) {
  const S = sim.state;
  const t = S.time;
  if (!bot.percept) {
    bot.percept = {
      seesPlayer: false, lastKnown: null, heardAt: null, firstSeenT: -1,
      awareness: 0, lastSeenT: -9, lastHeardT: -9, heardKind: null,
      prevPlayerShotT: -9, prevHitT: bot.lastHitT != null ? bot.lastHitT : -9,
      prevReloading: false, lastSlideBumpT: -9,
    };
    // don't trigger on stale pre-spawn shots
    bot.percept.prevPlayerShotT = (S.player.weapon && S.player.weapon.lastShotT != null)
      ? S.player.weapon.lastShotT : -9;
  }
  const P = bot.percept;
  const player = S.player;

  if (sim.flags && sim.flags.noTarget || !player || !player.alive) {
    P.seesPlayer = false;
    P.awareness = Math.max(0, P.awareness - DECAY_PER_S * dt);
    return;
  }

  const eye = botEye(bot);
  const chestY = player.pos[1] + (player.stance === "crouch" ? 0.75 : 1.05);
  const headY = player.pos[1] + (player.stance === "crouch" ? 1.02 : 1.55);
  const dx = player.pos[0] - eye[0], dz = player.pos[2] - eye[2];
  const d = Math.hypot(dx, chestY - eye[1], dz);
  const hd = Math.hypot(dx, dz) || 1e-9;

  const pm = player._m || null; // A1's movement scratch (guarded reads only)
  const hspeed = Math.hypot(player.vel[0], player.vel[2]);
  const sliding = !!(pm && pm.sliding);

  // ---- light at the TARGET's position (+ muzzle-flash override)
  let L = sim.nav && sim.nav.lightAt ? sim.nav.lightAt(player.pos[0], player.pos[2]) : 0.5;
  const pShotT = player.weapon && player.weapon.lastShotT != null ? player.weapon.lastShotT : -9;
  const flash = t - pShotT <= FLASH_WINDOW_S && d <= FLASH_RANGE_M;

  // ---- sight
  const toYaw = Math.atan2(-dx, -dz);
  const ang = Math.abs(angDiff(toYaw, bot.yaw));
  const facing = facingFactor(ang, d);
  const losA = [player.pos[0], chestY, player.pos[2]];
  const losB = [player.pos[0], headY, player.pos[2]];
  const visible = facing > 0 &&
    (!world.losBlocked(eye, losA) || !world.losBlocked(eye, losB));
  if (flash && visible) L = 1.0;

  const range = detectRange(L, bot.state === "alert");
  const distFactor = Math.min(1, Math.max(0, 1 - d / range));
  let stimulated = false;

  if (visible && distFactor > 0) {
    const stance = player.stance === "crouch" ? 0.6 : (sliding ? 1.2 : 1.0);
    const speed = 0.7 + 0.3 * Math.min(1, hspeed / 6.4);
    const fill = BASE_FILL * distFactor * facing * lightFactor(L) * stance * speed;
    P.awareness = Math.min(1, P.awareness + fill * dt);
    P.lastKnown = player.pos.slice();
    P.lastSeenT = t;
    stimulated = true;
  }
  P.seesPlayer = visible && distFactor > 0;

  // ---- hearing (§5.2 table — updates lastKnown only, caps at 0.85)
  const hear = (kind, pos, bump) => {
    P.heardAt = pos;
    P.heardKind = kind;
    P.lastHeardT = t;
    if (!P.lastKnown || t - P.lastSeenT > 0.3) P.lastKnown = pos;
    P.awareness = Math.max(P.awareness, Math.min(HEARD_CAP, P.awareness + bump));
    stimulated = true;
  };

  // gunshot: 300 m alert / ≤120 m accurate; fuzz ±6 m beyond 120
  if (pShotT > P.prevPlayerShotT) {
    P.prevPlayerShotT = pShotT;
    if (d <= 300) {
      let pos = player.pos.slice();
      if (d > 120) {
        pos = [pos[0] + (rngAi() * 2 - 1) * 6, pos[1], pos[2] + (rngAi() * 2 - 1) * 6];
      }
      hear("gunshot", pos, HEARD_CAP); // unmistakable at night
    }
  }
  // footsteps (continuous): sprint 14 m, walk 7 m, crouch-walk 2.5 m; ±3 m fuzz
  if (player.grounded && hspeed > 0.8) {
    const r = hspeed >= 5.5 ? 14 : (player.stance === "crouch" ? 2.5 : 7);
    if (d <= r) {
      const fz = player.stance === "crouch" ? 2 : 3;
      const pos = [player.pos[0] + (rngAi() * 2 - 1) * fz, player.pos[1],
                   player.pos[2] + (rngAi() * 2 - 1) * fz];
      hear("steps", pos, 2.0 * (1 - d / r) * dt);
    }
  }
  // reload: 10 m (edge-triggered)
  const reloading = player.weapon && player.weapon.state === "reloading";
  if (reloading && !P.prevReloading && d <= 10) {
    hear("reload", [player.pos[0] + (rngAi() * 2 - 1) * 2, player.pos[1],
                    player.pos[2] + (rngAi() * 2 - 1) * 2], 0.5);
  }
  P.prevReloading = !!reloading;
  // slide / mantle: 12 m (rate-limited 1 s)
  if (pm && (pm.sliding || pm.mantle) && d <= 12 && t - P.lastSlideBumpT > 1.0) {
    P.lastSlideBumpT = t;
    hear("slide", [player.pos[0] + (rngAi() * 2 - 1) * 3, player.pos[1],
                   player.pos[2] + (rngAi() * 2 - 1) * 3], 0.5);
  }
  // player grenade bounce/land: 20 m, exact
  const grenades = sim.internal && sim.internal.grenades;
  if (grenades) {
    for (let i = 0; i < grenades.length; i++) {
      const g = grenades[i];
      if (g.who !== "P" || (!g.bounced && !g.landed)) continue;
      const gd = Math.hypot(g.pos[0] - eye[0], g.pos[2] - eye[2]);
      if (gd <= 20) hear("grenade", g.pos.slice(), 0.6);
    }
  }

  // ---- being hit: instant awareness 1.0 toward the origin sector
  if (bot.lastHitT != null && bot.lastHitT > P.prevHitT) {
    P.prevHitT = bot.lastHitT;
    P.awareness = 1.0;
    P.lastKnown = [player.pos[0] + (rngAi() * 2 - 1) * 4, player.pos[1],
                   player.pos[2] + (rngAi() * 2 - 1) * 4];
    stimulated = true;
    if (P.firstSeenT < 0) P.firstSeenT = t;
  }

  if (!stimulated) P.awareness = Math.max(0, P.awareness - DECAY_PER_S * dt);
  if (P.seesPlayer && P.awareness >= 1 && P.firstSeenT < 0) P.firstSeenT = t;
}
