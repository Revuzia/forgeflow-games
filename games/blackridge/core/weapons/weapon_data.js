// core/weapons/weapon_data.js [A4] — THREE-free constants; the sim imports
// this. Field SHAPE per architecture §3.10 (as amended R4/R5); ids
// warden/vesper/corvus/pike; EVERY number transcribed from combat_spec §2
// (TTK-verified tables). Node-runnable, zero deps, zero THREE.
//
// RE-LAND NOTE: the wave-1 landing of this file was lost to a concurrent
// write (A0's stub stayed on disk — verified by A2 and A1). This is the
// complete transcription, re-landed in wave 2. sim.selftest.cjs's
// loaded-table-vs-§2.1 assertions arm on this file: A1's selftest greps the
// raw file text for the A0 stub marker (the word "S T U B" joined with the
// lane id), so that literal must NEVER appear in this file — an earlier
// re-land mentioned it in this very comment and kept the selftest skipping.
//
// UNITS: angles RADIANS (repo convention, architecture §3 "Angles radians");
// combat_spec prints degrees — deg() keeps the spec numbers visible. Times
// seconds. Distances metres.
//
// TRANSCRIPTION DECISIONS (wave-1 rulings, carried verbatim):
// - recoil pattern pairs are [dYaw, dPitch] per the frozen §3.10 shape;
//   combat_spec's tables print pitch FIRST — transposed here, loudly.
// - Pattern tail: sim (ballistics.js) loops the LAST 4 rows beyond the array
//   end — each pattern's final 4 rows ARE its loop segment; `loop`
//   {start,len} (0-based) documents the same window for view-side recoil.js.
// - Warden shots 13–16: spec says "alternate ±0.09" without a leading sign;
//   transcribed +,−,+,− (leading +). Both readings sum identically.
// - Corvus/Pike "yaw ± rolled once per shot": encoded as alternating-sign
//   rows (deterministic; the ±10/15% magnitude jitter comes from the sim's
//   weapons rng stream).
// - Corvus has BOTH vmKick 9.5 (rotational action-cycle read, spec §2.3
//   "viewmodel kick 9.5") and vmPunch 1.9 (the 5 cm barrel-axis slide from
//   the vmPunch summary list). Distinct fields, both consumed by
//   viewmodel.js. vmKick for the other three is A4 view tuning (unspecced).
// - spread.hip is radians (hipDeg twin provided); spread.ads is THE
//   full-ADS spread: 0 for warden/vesper/pike (§2.4 CoD model), Corvus keeps
//   sway-scale ≈0.05° (§2.4 "except Corvus" + §2.6 scope sway amp).
// - spread.moveMult/crouchMult exist for §3.10 shape compliance; ballistics
//   implements §2.5's graded speed model + fixed multipliers (SPREAD_MODEL
//   below) — probe_spread asserts those exactly.

const deg = (d) => (d * Math.PI) / 180;

// ---------------------------------------------------------------- patterns
// [dYaw, dPitch] radians. Final 4 rows = the loop segment (sim tail rule).

// Warden (AR) — learnable climb-then-right-drift; §2.3 table rows 1–16 +
// loop 17–20 [+0.08, +0.04, −0.05, −0.09] @ pitch 0.21.
// 2026-08-25 first-shot signature (spec §2.3 amendment, measured live at
// 0.42 = only +5% over shot 2 — below the genre-standard "noticeably larger
// first shot"): row 1 pitch 0.42 → 0.55 (1.38× shot 2). Full-mag climb
// 7.39° → 7.52°; aim-truth untouched (kick lands AFTER the round leaves).
const WARDEN_PATTERN = [
  [deg(+0.02), deg(0.55)], [deg(-0.03), deg(0.40)], [deg(+0.05), deg(0.38)],
  [deg(+0.08), deg(0.34)], [deg(+0.10), deg(0.30)], [deg(+0.12), deg(0.28)],
  [deg(+0.10), deg(0.26)], [deg(-0.06), deg(0.25)], [deg(-0.10), deg(0.24)],
  [deg(-0.12), deg(0.24)], [deg(-0.08), deg(0.23)], [deg(+0.06), deg(0.23)],
  [deg(+0.09), deg(0.22)], [deg(-0.09), deg(0.22)], [deg(+0.09), deg(0.22)],
  [deg(-0.09), deg(0.22)],
  // loop segment (shots 17–30 cycle these 4)
  [deg(+0.08), deg(0.21)], [deg(+0.04), deg(0.21)], [deg(-0.05), deg(0.21)],
  [deg(-0.09), deg(0.21)],
];

// Vesper (SMG) — fast, low, buzzy; rows 1–8 + loop 9–12
// [+0.07, −0.06, −0.08, +0.06] @ pitch 0.16.
// 2026-08-25 first-shot signature (same §2.3 amendment as the Warden):
// row 1 pitch 0.26 → 0.34 (1.42× shot 2); full-mag climb 5.48° → 5.56°.
const VESPER_PATTERN = [
  [deg(+0.03), deg(0.34)], [deg(-0.04), deg(0.24)], [deg(+0.06), deg(0.22)],
  [deg(+0.08), deg(0.20)], [deg(-0.07), deg(0.19)], [deg(-0.09), deg(0.18)],
  [deg(+0.07), deg(0.18)], [deg(+0.05), deg(0.17)],
  // loop segment
  [deg(+0.07), deg(0.16)], [deg(-0.06), deg(0.16)], [deg(-0.08), deg(0.16)],
  [deg(+0.06), deg(0.16)],
];

// Corvus (DMR) — one big honest kick per shot: pitch 1.9°, yaw ±0.25°
// (alternating rows = the per-shot ± roll, deterministic). 12 rows for the
// §3.10 ≥12 shape; the alternating tail keeps looping ±.
const CORVUS_PATTERN = [];
for (let i = 0; i < 12; i++) CORVUS_PATTERN.push([deg(i % 2 === 0 ? +0.25 : -0.25), deg(1.9)]);

// Pike (pistol) — pitch 0.85°, yaw ±0.15° alternating.
const PIKE_PATTERN = [];
for (let i = 0; i < 12; i++) PIKE_PATTERN.push([deg(i % 2 === 0 ? +0.15 : -0.15), deg(0.85)]);

// Breaker (pump shotgun) — one heavy kick per shell, yaw alternating. The
// pellet SPREAD (not the recoil) is what makes it a shotgun; the kick is the
// pump-action "you just fired a cannon" read, and the 0.77 s cycle lets it fully
// recover before the next shell.
const BREAKER_PATTERN = [];
for (let i = 0; i < 12; i++) BREAKER_PATTERN.push([deg(i % 2 === 0 ? +0.35 : -0.35), deg(3.6)]);

// ---------------------------------------------------------------- weapons
// view.* offsets are in VIEWMODEL-CAMERA space (camera at origin, −Z
// forward, vFOV 46): posHip/posAds place the weapon-group origin; muzzle/
// eject/sightY are LOCAL offsets from the weapon-group origin. GLB
// convention (assets/weapons/*.glb, built by tools/a4_build_fp_weapons.py):
// origin at the grip, barrel −Z, metres scale, sockets `SOCKET_muzzle` /
// `SOCKET_eject` baked as empties. These are VIEW-TUNING values (A4 owns
// them at the S2/S4 pixel-alignment gate) — NOT combat data.
export const WEAPONS = {
  warden: { // M-72 "Warden" — full-auto AR, mission primary (owns 15–58 m)
    name: "M-72 Warden", class: "ar", auto: true, rpm: 750,
    damage: { body: 28, headMult: 1.40, limbMult: 1.0, falloffStart: 32, falloffEnd: 58, min: 22 },
    spread: { hip: deg(2.4), hipDeg: 2.4, ads: 0, moveMult: 1.65, crouchMult: 0.75 },
    pellets: 1,
    recoil: {
      pattern: WARDEN_PATTERN, loop: { start: 16, len: 4 },
      scale: 1.0, jitter: 0.12, hipMult: 0.85,
      recoverPerS: deg(12), recoverDelayS: 0.08,
      vmKick: 3.2, vmPunch: 0.75, vmPunchDecayPerS: 6,
    },
    adsTime: 0.250, adsFov: 55, adsMoveMult: 0.55,
    mag: 30, reserve: 120, reloadS: 2.1, reloadEmptyS: 2.6,
    switchS: 0.45, raiseS: 0.45, holsterS: 0.30,
    sprintOutMs: 210, tacSprintOutMs: 315,
    muzzleVel: 700, tracerEvery: 2, // §3.1: 1-in-2 rounds
    penetration: { classes: ["soft", "metal_thin"], retain: 0.70, maxThickM: 0.25 },
    view: {
      // MEASURED from the built GLB (tools/a4_build_fp_weapons.py A4BUILD
      // report — single source; posAds.y = -sightY puts the sight line on
      // the vm camera's center ray BY CONSTRUCTION)
      glb: "assets/weapons/warden.glb",
      posHip: [0.14, -0.105, -0.33], posAds: [0, -0.134, -0.34],
      muzzle: [0, 0.064, -0.6834], eject: [0.0432, -0.004, -0.045], sightY: 0.134,
      scale: 1,
    },
  },

  vesper: { // KS-23 "Vesper" — suppressed SMG, CQB (wins ≤14 m)
    name: "KS-23 Vesper", class: "smg", auto: true, rpm: 900,
    damage: { body: 25, headMult: 1.35, limbMult: 1.0, falloffStart: 14, falloffEnd: 32, min: 17 },
    spread: { hip: deg(2.0), hipDeg: 2.0, ads: 0, moveMult: 1.65, crouchMult: 0.75 },
    pellets: 1,
    recoil: {
      pattern: VESPER_PATTERN, loop: { start: 8, len: 4 },
      scale: 1.0, jitter: 0.18, hipMult: 0.85, // buzzier than the AR by design
      recoverPerS: deg(12), recoverDelayS: 0.08,
      vmKick: 2.4, vmPunch: 0.5, vmPunchDecayPerS: 6,
    },
    adsTime: 0.205, adsFov: 58, adsMoveMult: 0.62,
    mag: 32, reserve: 128, reloadS: 1.8, reloadEmptyS: 2.3,
    switchS: 0.40, raiseS: 0.40, holsterS: 0.28,
    sprintOutMs: 160, tacSprintOutMs: 240,
    muzzleVel: 999, tracerEvery: 2, // "hitscan" CQB; §3.1: 1-in-2
    penetration: { classes: ["soft"], retain: 0.45, maxThickM: 0.15 },
    view: {
      glb: "assets/weapons/vesper.glb",
      posHip: [0.135, -0.10, -0.30], posAds: [0, -0.0997, -0.31],
      muzzle: [0, 0.0417, -0.6094], eject: [0.0282, -0.004, -0.035], sightY: 0.0997,
      scale: 1,
      anim: { kind: "gripmag", tilt: [20, 8, -34], lift: [-0.045, 0.09, 0.02], magDrop: 0.10 },
    },
  },

  corvus: { // LR-1 "Corvus" — semi-auto marksman (owns 45 m+), scope overlay
    name: "LR-1 Corvus", class: "dmr", auto: false,
    rpm: 257, // 233 ms min interval, click-buffered (§2.1)
    damage: { body: 60, headMult: 1.65, limbMult: 1.0, falloffStart: 45, falloffEnd: 90, min: 48 },
    // full-ADS keeps sway-scale spread (§2.4 "except Corvus"; §2.6 amp 0.05°)
    spread: { hip: deg(4.5), hipDeg: 4.5, ads: deg(0.05), moveMult: 1.65, crouchMult: 0.75 },
    pellets: 1,
    recoil: {
      pattern: CORVUS_PATTERN, loop: { start: 8, len: 4 },
      scale: 1.0, jitter: 0.10, hipMult: 0.85,
      recoverPerS: deg(14), recoverDelayS: 0.06, // §2.3: 14°/s from 60 ms
      vmKick: 9.5, vmPunch: 1.9, vmPunchDecayPerS: 6, // spec: BOTH fields
    },
    adsTime: 0.340, adsFov: 21.5, adsMoveMult: 0.42, // 3.9×, full-screen scope overlay
    mag: 15, reserve: 60, reloadS: 2.4, reloadEmptyS: 3.0,
    switchS: 0.55, raiseS: 0.55, holsterS: 0.35,
    sprintOutMs: 290, tacSprintOutMs: 435,
    muzzleVel: 850, tracerEvery: 1, // §3.1: every round
    penetration: { classes: ["soft", "metal_thin"], retain: 0.85, maxThickM: 0.40 },
    view: {
      glb: "assets/weapons/corvus.glb",
      // PRESENTATION PASS (2026-10): the optic is now a SOLID 3D scope on the gun
      // (tools/a4_build_fp_weapons.py build_scope_solid) and the sight picture at full
      // ADS is the HUD's full-screen scope overlay (hud.js #a10-scope), driven by
      // viewmodel.js `vm.scope`. `scope: true` makes the viewmodel (a) blend the 3D gun
      // out as the lens fades in (ADS progress 0.45 -> 0.85), (b) turn the ADS sway
      // into a REAL aim wobble that Shift (breath hold) steadies, and (c) widen the
      // world zoom: adsFov 34 -> 21.5 = 3.9x (was 2.2x, which read as barely
      // magnified). Mouse look scales with it automatically (input.js zoom law).
      scope: true,
      posHip: [0.15, -0.115, -0.36], posAds: [0, -0.123, -0.34],
      muzzle: [0, 0.025, -0.8635], eject: [0.046, -0.002, -0.10], sightY: 0.123,
      scale: 1,
      // the scope owns the frame at full ADS, so the gun takes none of the world's zoom
      adsZoom: 0,
      adsStandoff: 0,
      anim: { kind: "mag", tilt: [12, 4, -24], lift: [-0.04, 0.085, 0.0], magDrop: 0.13 },
    },
  },

  // B-12 "Breaker" — pump-action shotgun, CQB king (owns 0–9 m), slot 3.
  // 9 pellets × 14 body: inside ~7 m a centred blast is a one-shot kill, past
  // ~18 m the pellets are 3 dmg each and it is a bad choice (the fall-off IS the
  // balance). `pellets` was always honoured by ballistics.fireShot (cone sampled
  // per pellet); this is the first weapon to use it. `reload.mode "shell"` =
  // shells are loaded one at a time and the reload can be cut short by firing
  // (player.js stepActorWeapon); `reloadS` is the full empty→full duration for
  // anything (HUD, bots) that wants a single number.
  breaker: {
    name: "B-12 Breaker", class: "shotgun", auto: false, rpm: 78,
    damage: { body: 14, headMult: 1.5, limbMult: 1.0, falloffStart: 6, falloffEnd: 18, min: 3 },
    spread: { hip: deg(3.4), hipDeg: 3.4, ads: deg(2.3), moveMult: 1.65, crouchMult: 0.75 },
    pellets: 9,
    recoil: {
      pattern: BREAKER_PATTERN, loop: { start: 8, len: 4 },
      scale: 1.0, jitter: 0.12, hipMult: 0.9,
      recoverPerS: deg(22), recoverDelayS: 0.10,
      vmKick: 12, vmPunch: 2.6, vmPunchDecayPerS: 5,
    },
    reload: { mode: "shell", startS: 0.55, perShellS: 0.42, endS: 0.35 },
    adsTime: 0.230, adsFov: 56, adsMoveMult: 0.62,
    mag: 6, reserve: 30, reloadS: 3.4, reloadEmptyS: 3.4,
    switchS: 0.50, raiseS: 0.50, holsterS: 0.32,
    sprintOutMs: 190, tacSprintOutMs: 285,
    muzzleVel: 700, tracerEvery: 0,
    penetration: null,
    view: {
      // MEASURED from the built GLB (tools/a4_build_fp_weapons.py CFG "breaker",
      // A4BUILD report): pump shotgun off wpn_shotgun.glb, ghost-ring + bead sights,
      // `pump` forend node, SOCKET_eject on the receiver window.
      glb: "assets/weapons/breaker.glb",
      posHip: [0.15, -0.11, -0.34], posAds: [0, -0.1237, -0.25],
      muzzle: [0, 0.0877, -0.7469], eject: [0.0317, 0.082, -0.15], sightY: 0.1237,
      scale: 1,
      // hand animation (viewmodel.js): per-shell loading with the gun canted
      anim: { kind: "shell", tilt: [8, 0, -26], lift: [-0.03, 0.055, 0.0],
        hand: { port: { palm: [-0.012, 0.15, 0.002], fingers: [0.5, 1, 0.1], dir: [0.2, 0, 1] },
                pouch: { palm: [-0.15, 0.10, -0.15], fingers: [0.3, 0.5, 1], dir: [0.6, 0, 1] } } },
    },
  },

  pike: { // GS-9 "Pike" — sidearm, slot 5; the 2-headshot skill line
    name: "GS-9 Pike", class: "pistol", auto: false, rpm: 380,
    damage: { body: 30, headMult: 1.80, limbMult: 1.0, falloffStart: 12, falloffEnd: 26, min: 19 },
    spread: { hip: deg(1.8), hipDeg: 1.8, ads: 0, moveMult: 1.65, crouchMult: 0.75 },
    pellets: 1,
    recoil: {
      pattern: PIKE_PATTERN, loop: { start: 8, len: 4 },
      scale: 1.0, jitter: 0.15, hipMult: 0.85,
      recoverPerS: deg(12), recoverDelayS: 0.08,
      vmKick: 3.0, vmPunch: 0.7, vmPunchDecayPerS: 6,
    },
    adsTime: 0.180, adsFov: 60, adsMoveMult: 0.70,
    mag: 12, reserve: 48, reloadS: 1.5, reloadEmptyS: 1.9,
    switchS: 0.30, raiseS: 0.30, holsterS: 0.22, // fast-swap finisher role
    sprintOutMs: 130, tacSprintOutMs: 195,
    muzzleVel: 999, tracerEvery: 1, // §3.1: every round
    penetration: null, // §3.2: Pike penetrates nothing
    view: {
      glb: "assets/weapons/pike.glb",
      posHip: [0.095, -0.085, -0.26], posAds: [0, -0.0843, -0.34],
      muzzle: [0, 0.047, -0.1854], eject: [0.0269, -0.002, -0.01], sightY: 0.0843,
      scale: 1,
      anim: { kind: "gripmag", tilt: [26, 10, -38], lift: [-0.045, 0.10, 0.02], magDrop: 0.09 },
    },
  },
};

// ---------------------------------------------------------------- shared
// R4: killfeed/HUD always display-names, never internal ids (A10 consumes).
export const WEAPON_NAMES = {
  warden: "M-72 Warden",
  vesper: "KS-23 Vesper",
  breaker: "B-12 Breaker",
  corvus: "LR-1 Corvus",
  pike: "GS-9 Pike",
};

// FIXED INVENTORY SLOTS (keys 1-5). Every weapon owns one slot by class, so the
// number key you press is always the same gun — muscle memory beats a
// pick-up-order shuffle. A body holds slots[0..4] (weapon id or null);
// picking a weapon up fills ITS slot. The campaign loadout is Warden + Pike
// (keys 1 and 5); the rest are found — map racks, crates, and the guns bots
// drop when they die.
export const SLOT_COUNT = 5;
export const WEAPON_SLOT = { warden: 1, vesper: 2, breaker: 3, corvus: 4, pike: 5 }; // 1-based key numbers
export const SLOT_ORDER = ["warden", "vesper", "breaker", "corvus", "pike"];          // index = key-1
export function slotOf(weaponId) { return (WEAPON_SLOT[weaponId] || 0) - 1; }        // -1 = unknown weapon

// §1.8 + §2.2 feel constants (A1's player.js embeds the same values; this
// export is the declared single reference — keep them equal).
export const FEEL = {
  inputBufferS: 0.35,            // doctrine §2 / §1.8 — ALL verbs
  fireToSprintLockoutS: 0.25,    // §1.8
  adsFromSprintConcurrent: true, // §1.8: max(sprint-out, ADS-in), never sum
  adsSettleS: 0.2,               // §2.4 Ironhold settle
  adsSettleAmpMult: 2,           // settle sway amp ×2 → ×1
};

// §2.2 reload mechanics.
export const RELOAD_MODEL = {
  commitFraction: 0.65, // mag seats at 65% of the timer
  dryClickDelayS: 0.25, // dry click, then auto-reload if reserve > 0
};

// §2.5 shared crosshair-truth model constants. THE function lives in
// core/sim/ballistics.js effectiveSpread (A10's crosshair imports IT — one
// model, never two); these are the same numbers as data.
export const SPREAD_MODEL = {
  adsLerpFactor: 0.8,   // partial ADS: hip × (1 − 0.8·progress)
  speedCoef: 0.06,      // × (1 + min(cap, speed_mps × 0.06))
  speedCap: 0.65,
  airborneMult: 1.9,
  slideMult: 1.6,
  crouchMult: 0.75,
  steadyMult: 0.55,     // NOT last-circle's 0.15 laser
  steadyStillS: 0.4,
  steadyNoShotS: 0.45,
  landedMult: 1.35,
  landedWindowS: 0.4,
  landedMinFallM: 4.0,
};

// §2.8 first-shot audio-visual signature (A7 muzzle + A9 sfx consume; the
// sim tags qualifying shot events `firstShot:true`).
export const FIRST_SHOT = {
  gapS: 0.5,               // ≥0.5 s since last shot = new burst
  flashScaleMult: 1.2,
  flashIntensityMult: 1.25,
  mechLayerDb: 2,          // mechanical layer +2 dB
  transientLenMult: 1.15,  // 15% longer action transient
  fullTracer: true,        // one full tracer even on non-tracer rounds
};

// §3.1 tracer rendering constants (A7 consumes).
export const TRACER_MODEL = {
  cosmeticCapMps: 300, // visible streak — damage ray already resolved
  color: 0xffd9a0,     // warm white
};

// §2 hit zones (A1 embeds the same constants; declared reference).
export const HIT_ZONES = {
  headTopFrac: 0.14, // head = top 14% of the capsule ...
  headAxialM: 0.20,  // ... AND within 0.20 m of the capsule axis
};

// §3.2 penetration model (per-weapon tables ride WEAPONS[id].penetration).
export const PENETRATION_MODEL = {
  deviationDeg: 0.8, // added after penetration
  maxPenPerBullet: 1,
  classes: ["soft", "metal_thin", "hard"], // hard: never penetrable
};

// §2.6 sway + breath hold (viewmodel.js consumes; degrees kept visible).
export const SWAY = {
  // corvus: a REAL aim wobble through the 3.9x scope (viewmodel.js nudges the aim by the
  // differential of this signal), so it is sized to be seen and fought, not to be sub-pixel.
  adsAmpDeg: { warden: 0.030, vesper: 0.022, breaker: 0.028, pike: 0.026, corvus: 0.16 },
  baseFreqsHz: [0.9, 1.7], // two incommensurate sines per axis, differential
  movingMult: 2.2,
  corvusMovingMult: 2.5,
  scopedMovingMult: 2.2,   // any view.scope weapon while moving (shuffling at 3.9x is a mess)
  breath: { holdAmpMult: 0.06, meterS: 4.5, refillS: 1.8, windedAmpMult: 1.7, windedRefillFrac: 0.5 },
};

// §2.7 viewmodel constants (viewmodel.js consumes).
export const VIEWMODEL = {
  // PRESENTATION PASS: 60 -> 46. A wide viewmodel FOV pushes the gun into the corner, makes
  // the barrel foreshorten steeply toward the centre and shrinks hands + weapon to a sliver
  // (the owner's 'tiny gun, no hands'). CoD runs ~65 deg HORIZONTAL (~41 vertical). Every
  // pose below was re-authored against 46 (hip grip at ~(0.55, -0.7) NDC like CoD); ADS
  // distance rides posAds.z alone (adsStandoff 0) — alignment is unchanged by construction.
  fovDeg: 46,          // R8: vertical, independent of world FOV
  posLagTau: 0.045,    // translation lag τ 45 ms ...
  posLagMaxM: 0.032,   // ... max offset 3.2 cm
  rotLagTau: 0.065,    // rotation lag τ 65 ms ...
  rotLagMaxDeg: 4,     // ... max 4°

  // ---- ADS OCCLUSION (iter10, owner report: "it blocks alot of the vision
  // when aiming (right click)") --------------------------------------------
  // How much of the WORLD's ADS zoom the VIEWMODEL camera also applies to the
  // gun. 1 = the iter05 behaviour (hold the vm:world FOV ratio, so the weapon
  // is magnified by exactly the same factor as the world); 0 = the gun keeps
  // the angular size it has at the hip while the world zooms past it.
  //
  // MEASURED, live, 1600x900, mask read back through the vm camera with
  // scene.overrideMaterial forced flat (_harness/occlusion.py) at share = 1:
  //     weapon   ADS screen area   sight-picture disc (r = 12% of height)
  //     warden        10.86 %                26.6 % blocked
  //     vesper        12.61 %                48.6 % blocked
  //     corvus        12.61 %               100.0 % blocked
  //     pike           9.92 %                56.7 % blocked
  // i.e. right-clicking made the gun cover roughly TWICE the screen it covers
  // at the hip (4-6 %) — the moment the player most needs to see is the moment
  // the viewmodel grew. That is the owner's complaint, in numbers.
  //
  // WHY share = 0 IS THE PHYSICAL ANSWER, not a taste call: an optic (or the
  // focus shift of shouldering irons) magnifies the WORLD. It does not
  // magnify the rifle that is already 30 cm from your eye — that object's
  // angular size is set by where it is, and shouldering it moves it a few
  // centimetres, not a factor of 1.35. Applying the world's zoom to the
  // viewmodel is a rendering artefact of driving both cameras off one number.
  // Iron sights are 1x, so they get 0. The Corvus is a real 2.2x optic and
  // gets a partial share so the ocular still reads as glass you look THROUGH
  // rather than a bead on the barrel (see WEAPONS.corvus.view.adsZoom).
  //
  // The knob is exact and alignment-safe BY CONSTRUCTION: the vm camera zooms
  // about its own centre ray, and posAds.y = -sightY already parks the sight
  // line ON that ray, so any FOV change slides the sight along the ray and
  // never off it. Lane A's "where I aim is where it hits" cannot regress here.
  adsZoomShare: 0,     // default for anything without view.adsZoom

  // Extra metres the weapon is pushed AWAY from the eye at full ADS (default
  // for anything without view.adsStandoff). See the long note in
  // viewmodel.js: a 55 deg render is not a 120 deg human field, so a
  // physically-placed weapon subtends ~3.3x the fraction of the frame it does
  // in life.
  //
  // 0.18 m was picked off a live sweep, not by eye (_harness/occl_sweep.py,
  // Warden, 1600x900, the mask read back through the vm camera). The zoom
  // share alone moved almost nothing because the silhouette was CLIPPED —
  // shrinking it only pulled previously off-screen receiver into frame:
  //     share 1 -> 0 at standoff 0:      10.69 % -> 9.68 % of screen
  // Distance is the lever that actually empties the frame, and the two
  // compose:
  //     share 0, standoff 0.00 / 0.12 / 0.18 / 0.24
  //       area   9.68 / 8.00 / 6.95 / 6.23 %
  //       bboxW 33.3 / 26.6 / 25.0 / 24.9 % of screen width
  //       sight   40 /   30 /   26 /   24 px wide
  // 0.24 keeps paying in area but the sight assembly is down to 24 px at 900p
  // (~29 px at 1080p) and stops reading; 0.18 is the knee — a third of the
  // occlusion gone with the sight still legible. Every row of that sweep
  // measured the sight centroid at x = -0.5 px from screen centre (the
  // half-pixel is the pixel-grid convention, cx = w/2 vs pixel centres at
  // x+0.5): INVARIANT across both levers, which is the alignment proof.
  adsStandoff: 0,

  // sprint pose (blended in/out smoothly by viewmodel.js): gun across the chest, muzzle up-left,
  // still partly in frame. Offsets from the hip pose in camera space; rotations in degrees.
  sprint: { pos: [-0.045, -0.02, 0.05], rot: [-8, 38, -22] },
};
