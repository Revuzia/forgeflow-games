/**
 * BLACKRIDGE shot battery — the R10 scenario seed table.
 *
 * ONE vocabulary (BUILD_PLAN R10): the canonical scenario ids below are shared
 * verbatim by content.json `scenarios` (A2 owns the POSES: spawn nodes, camera,
 * bot placements), core/test/scenarios.js (`__test.setScenario(id)` consumes
 * them), visual_target.md's scorecard, and `_shots/scores.jsonl`. This file
 * holds what the HARNESS owns and nothing else: per-scenario SEEDS + capture
 * parameters + drive descriptors (R21: "the per-scenario seed table lives in
 * shots.js ... setScenario consumes it atomically — re-seed every stream,
 * freeze sky/rain phase, zero transient state").
 *
 * Data only, no I/O. Injected by shotbattery.py as a classic script (exports
 * stripped). Poses are NOT here — content.json may not even exist yet; the
 * game reads it at runtime and setScenario resolves id -> pose there.
 *
 * Capture discipline (R10/R21): every battery capture is 1920x1080 at DPR 1.5,
 * post chain ON, after prewarm, fixed per-scenario seeds. Frames are counted
 * on the fixed-dt sim (`__test.step`) or rAF counts — NEVER wall clock
 * (driftwake 05-trail-berms lesson: a wall-clock walk measures frame rate).
 *
 * Fields per scenario:
 *   seed         master seed; setScenario re-seeds EVERY mulberry32 stream
 *   botSeed      bot-brain stream seed (spawn rolls, bands, aim jitter)
 *   rainPhase    frozen weather phase [0..1) — particle field + puddle ripple
 *   timeOfDay    'night' (the only shipped state, R2)
 *   hud          HUD visible in the capture (S6 = yes; beauty shots = no)
 *   settleFrames rAF frames to let run after setScenario before capture
 *   until        string predicate over F = __FPS__, or null; recorded in the
 *                manifest as untilReached — an unfired `until` makes the frame
 *                NOT comparable and blocks the iteration
 *   blind        member of the blind-verdict set (VT fixes it at S1–S5)
 *   desc/tests   critic-facing framing intent (D1–D10 dimension ids, R27)
 */

// Hidden-chrome sweep used when hud:false — `__test.hud(false)` first, then
// this belt-and-braces selector pass (harness_plan §2.2).
export const HUD_SELECTORS = [
  "#hud", "#crosshair", "#hitmarker", "#killfeed", "#ammo", "#compass",
  "#objective", "#hint", ".overlay", "#perf",
  // the pose-hold uses the pause gate — its overlay must never leak into a
  // beauty shot (S6 is the ONE scenario that shows it, and S6 is hud:true)
  "#pause", "#pause-overlay", ".pause-overlay",
];

export const CAPTURE = { width: 1920, height: 1080, dpr: 1.5 };

export const SCENARIOS = {
  S1: {
    seed: 101, botSeed: 1101, rainPhase: 0.25, timeOfDay: "night",
    hud: false, settleFrames: 24, blind: true,
    until: "F.__test.counters().shotsFired > 0",   // mid-burst frame really fired
    desc: "Hip-fire mid-firefight with muzzle flash live — plaza hero " +
          "(market_neon_rain pose): neon wall, hero puddles w/ planar " +
          "reflections, >=2 bots, Warden hip mid-burst, flash light leased.",
    tests: "D1 art direction, D4 fx, D6 permanence, D7 lighting discipline",
  },
  S2: {
    seed: 202, botSeed: 1202, rainPhase: 0.40, timeOfDay: "night",
    hud: false, settleFrames: 24, blind: true,
    // ADS must be OBSERVABLY engaged in the captured state, not just authored:
    // the frame is only comparable if the sight picture is up (F4, iter01).
    until: "F.__test.state().player.weapon.adsT > 0.98",
    desc: "ADS sight picture on an AI at range — Corvus from the boulevard " +
          "centre lane at Z+18 onto a contact standing IN the L_BLVD_3 sodium " +
          "pool at 44 m (top-lit, ~75 px tall); a second contact fires at 22 m " +
          "frame-right. (iter02 aimed at the platform marksman at 82 m in no " +
          "practical at all — 40 px of unlit silhouette, no readable subject.)",
    tests: "D5 viewmodel/sight alignment, D2 exposure, D3 atmosphere depth",
  },
  S3: {
    seed: 303, botSeed: 1303, rainPhase: 0.10, timeOfDay: "night",
    hud: false, settleFrames: 24, blind: true,
    // iter03 (W3): S3 is now a FIREFIGHT establishing wide, so the frame is
    // only comparable if a player round actually left the barrel — same gate
    // S1 uses. Without it the capture is a posed tableau with no flash and
    // the 55 ms muzzle light cannot survive the settle wait.
    until: "F.__test.counters().shotsFired > 0",
    desc: "Establishing wide of the compound, mid-firefight — quay run east " +
          "from (-44,49): L_QUAY sodium pool + god-ray ~1 deg off the sight " +
          "axis, compound rooflines right, canal + city-glow band left, quay " +
          "edge as foreground anchor; player 4-round burst live, 3 quay bots " +
          "engaged at 21-36 m with tracers in flight. (iter02 aimed 40 m past " +
          "the far bank at Z+90 and captured empty water — no compound, no " +
          "subject, no combat.)",
    tests: "D1 art direction, D3 atmosphere, D6 combat VFX, D8 sky/horizon",
  },
  S4: {
    seed: 404, botSeed: 1404, rainPhase: 0.55, timeOfDay: "night",
    hud: false, settleFrames: 24, blind: true,
    until: null,
    desc: "Close-up ground/wall material in practical light — low (0.95 m) " +
          "crop of WET COBBLE at the plaza east neon wall: sign colours " +
          "streaked along the wet stone toward the lens, wall base + grime " +
          "line. (iter02 stood 4.5 m from the arcade lightwell with the " +
          "god-ray cone card BETWEEN lens and floor: the capture was cone " +
          "alpha, a blue haze ellipse, not material. S7 keeps that shaft.)",
    tests: "D9 material close-up, D2 exposure, D7 practical-light falloff",
  },
  S5: {
    seed: 505, botSeed: 1505, rainPhase: 0.30, timeOfDay: "night",
    hud: false, settleFrames: 24, blind: true,
    until: null,
    desc: "Sky/horizon from elevated position — tram-platform deck (y +4.5) " +
          "looking S over the boulevard, pitch ~+7 deg at fov 62 so the sky " +
          "owns the top two thirds and the sodium pools recede along the " +
          "bottom. (iter02 sat 2 deg off level at fov 50: buildings ate the " +
          "horizon and the sky was a featureless strip.)",
    tests: "D8 night-storm ramp (LUT sky, horizon event, parallax cloud layers)",
  },
  S6: {
    seed: 606, botSeed: 1606, rainPhase: 0.25, timeOfDay: "night",
    hud: true, settleFrames: 24, blind: false,
    until: "F.__test.isPaused()",  // ESC overlay genuinely up, sim held
    desc: "Pause menu + in-mission HUD — ESC overlay over a live plaza frame.",
    tests: "D10 HUD/UI craft (type, compass tape, ammo block, menu blur)",
  },
  S7: {
    seed: 707, botSeed: 1707, rainPhase: 0.20, timeOfDay: "night",
    hud: false, settleFrames: 24, blind: false, // supplementary (R10 note)
    until: null,
    desc: "arcade_god_rays — the WHOLE L_ARCADE_SKY shaft (head, column, wet " +
          "floor pool) with a rim-lit contact at the pool edge for scale; " +
          "interior must show ZERO rain streaks (occlusion-volume proof). " +
          "(iter02 centred at pitch -21.5 deg: shaft jammed against the top " +
          "edge, ~70% of frame unlit black floor.)",
    tests: "D7 god-ray chiaroscuro, D3 interior/exterior contrast",
  },
  S8: {
    seed: 808, botSeed: 1808, rainPhase: 0.60, timeOfDay: "night",
    hud: false, settleFrames: 24, blind: false, // supplementary
    until: null,
    desc: "gate9_floodlight_stand — HERO-BEAM framing (iter03 amendment): " +
          "camera swung ~44 deg E onto L_FLOOD_E, now 8 deg off-axis, with " +
          "wave-3 bots (incl. the heavy) re-posed INSIDE that beam's cone at " +
          "25/28/35 m. Measured: from the iter02 aim BOTH poles sat at 51 deg " +
          "against a 50.2 deg half-fov — on the frame edges — so one beam " +
          "clipped in at the margin and the left 55% was an unlit black wall.",
    tests: "D7 volumetric beams, D4 silhouette readability",
  },
  S9: {
    seed: 909, botSeed: 1909, rainPhase: 0.25, timeOfDay: "night",
    hud: false, settleFrames: 24, blind: false, // supplementary
    until: null,
    desc: "Soldier close-up ~2 m, three-quarter, RUNNING clip mid-pose — " +
          "never bind pose (doctrine §1). The Meshy-body-at-2m stress test.",
    tests: "D9 character material/texture bar, pose naturalness, no-primitive bar",
  },

  // C1 — the one MOVING capture (VT: "6 s capture: sprint -> stop -> fire
  // burst -> reload", plaza run, Warden). 360 sim frames at fixed dt 1/60.
  // The script is DATA; shotbattery.py's interpreter dispatches REAL
  // KeyboardEvent/MouseEvent per step (doctrine §5 — never a sim bypass) and
  // counts sim frames, capturing one PNG at the annotated step.
  C1: {
    seed: 601, botSeed: 1601, rainPhase: 0.25, timeOfDay: "night",
    hud: true, settleFrames: 12, blind: false,
    // The PNG is taken at captureAt "reload-mid": the comparable state is the
    // reload MOTION live (weapon.state === 'reloading'), not the completed
    // count — waiting on reloads>0 let the reload FINISH before the capture
    // (F4, iter01). The done-count stays as a fallback for a fast commit.
    until: "F.__test.state().player.weapon.state === 'reloading' || " +
           "F.__test.counters().harness.reloads > 0",
    script: [
      { hold: ["ShiftLeft", "KeyW"], frames: 180 },   // 3.0 s tac-sprint
      { release: "all",              frames: 30  },   // 0.5 s stop, sprint-out
      { fire: true,                  frames: 60  },   // 1.0 s hip burst
      { press: "KeyR",               frames: 0   },   // start reload
      { wait: true,                  frames: 60,  captureAt: "reload-mid" },
      { wait: true,                  frames: 30  },   // run out the 6.0 s
    ],
    desc: "6 s live capture: sprint -> stop -> fire burst -> reload; plaza " +
          "run with the Warden, HUD on. iter03: start slid to (-14,34) on a " +
          "NE heading so the stop-and-fire lands INSIDE the plaza facing the " +
          "neon wall, with two contacts pinned firing at 16-19 m. NOTE: the " +
          "HUD is DOM and capture() reads the GL drawing buffer, so `hud: " +
          "true` cannot appear in this PNG until the capture path composites " +
          "a page screenshot (cross-file, reported by W3).",
    tests: "D5 viewmodel motion (sprint pose, sway, recoil, reload anim), D10 HUD",
  },

  // Utility scenarios — never part of the scored battery.
  menu: {
    seed: 901, botSeed: 1901, rainPhase: 0.25, timeOfDay: "night",
    hud: false, settleFrames: 24, blind: false,
    until: null,
    desc: "Title screen: menu visible over the in-engine captured still, HUD hidden.",
    tests: "D10 menu craft (utility — not scored in the battery)",
  },
  bench: {
    seed: 911, botSeed: 1911, rainPhase: 0.25, timeOfDay: "night",
    hud: true, settleFrames: 0, blind: false,
    until: null,
    // R10: `?bench=1` = scenario S1 pose + autoplay('objective', 30) +
    // perf.benchDump() -> window.__BENCH__ + POST /__shot/bench.json.
    // perfprobe.py drives this; shotbattery never captures it.
    desc: "Perf fixture: S1 pose + autoplay('objective', 30). Not a capture.",
    tests: "perf gate only (Part 5.2) — no D-dimension scoring",
  },
};

// Default battery order — exactly the 10 PNGs an iteration produces (R10:
// S1–S9 scored on D1–D10; C1 the motion capture; menu/bench excluded).
export const BATTERY = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "C1"];
