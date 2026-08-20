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
    until: null, // ADS pose is fully authored by setScenario (adsT=1, breath still)
    desc: "ADS on an AI at range — boulevard_long_rain re-posed: Corvus ADS " +
          "from the barricade line at the platform marksman, 78 m, sodium " +
          "pools receding into fog.",
    tests: "D5 viewmodel/sight alignment, D2 exposure, D3 atmosphere depth",
  },
  S3: {
    seed: 303, botSeed: 1303, rainPhase: 0.10, timeOfDay: "night",
    hud: false, settleFrames: 24, blind: true,
    until: null,
    desc: "Quiet establishing wide — dock_infil_skyline: quay, freighter/crane " +
          "silhouettes on the horizon ring, rain vs the glow. (v2.2: L_QUAY " +
          "god-ray clause dropped — ~70 deg off-axis behind this pose, A6/A11.)",
    tests: "D1 art direction, D3 atmosphere, D8 sky/horizon, D9 materials",
  },
  S4: {
    seed: 404, botSeed: 1404, rainPhase: 0.55, timeOfDay: "night",
    hud: false, settleFrames: 24, blind: true,
    until: null,
    desc: "Close-up ground/wall material in practical light — alley under " +
          "L_ALLEY_A (derived from alley_steam_cqb): wet asphalt + wall + steam.",
    tests: "D9 material close-up, D2 exposure, D7 practical-light falloff",
  },
  S5: {
    seed: 505, botSeed: 1505, rainPhase: 0.30, timeOfDay: "night",
    hud: false, settleFrames: 24, blind: true,
    until: null,
    desc: "Sky/horizon from elevated position — tram-platform deck (y +4.5) " +
          "looking S over the boulevard to the 3-ring harbor silhouette.",
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
    desc: "arcade_god_rays — interior lightwell shaft on the wet floor pool; " +
          "interior must show ZERO rain streaks (occlusion-volume proof).",
    tests: "D7 god-ray chiaroscuro, D3 interior/exterior contrast",
  },
  S8: {
    seed: 808, botSeed: 1808, rainPhase: 0.60, timeOfDay: "night",
    hud: false, settleFrames: 24, blind: false, // supplementary
    until: null,
    desc: "gate9_floodlight_stand — both flood god-ray beams full of rain, " +
          "wave silhouettes (incl. 1 heavy) rim-lit in the gate mouths.",
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
    until: "F.__test.counters().harness.reloads > 0", // reload actually committed
    script: [
      { hold: ["ShiftLeft", "KeyW"], frames: 180 },   // 3.0 s tac-sprint
      { release: "all",              frames: 30  },   // 0.5 s stop, sprint-out
      { fire: true,                  frames: 60  },   // 1.0 s hip burst
      { press: "KeyR",               frames: 0   },   // start reload
      { wait: true,                  frames: 60,  captureAt: "reload-mid" },
      { wait: true,                  frames: 30  },   // run out the 6.0 s
    ],
    desc: "6 s live capture: sprint -> stop -> fire burst -> reload; plaza " +
          "run with the Warden, HUD on.",
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
