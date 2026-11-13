// core/chars/anim_map.js [A8] — semantic anim → GLB clip names (architecture
// §3.15; BUILD_PLAN R15). THREE-free pure data + the contract gate.
//
// The clip set is last-circle's baked Mixamo rifle set, repacked animation-only
// into assets/chars/clip_*.glb (one set — clips are armature-only and target
// the shared mixamorig skeleton, so they retarget onto BOTH bodies for free;
// byte-identity across skins md5-verified at repack time, see
// assets/manifest.a8.json). actor.js renames each file's chosen clip to the
// semantic key of CLIP_FILES below, so ANIMS values are stable names, never
// the raw exporter strings ("mixamo.com", "Armature|mixamo.com|Layer0", …).

/** clip-file table: loaded once, shared by every body (private to A8).
 *  NOTE (measured 2026-08-19): the source lineage of soldier_death2/death3 is
 *  a DIFFERENT Blender re-export rig — child-bone rests don't match this
 *  body, so only the hips animated (standing corpse). Those clips were
 *  removed from the shipped set; death variety is timescale + direction until
 *  two more deaths are baked through the Mixamo flow (clip-gap RESERVE,
 *  BUILD_PLAN Part 4). */
//
// 8-WAY LOCOMOTION PASS (2026-11-13). The forward rifle set the game shipped
// with (clip_rifle_idle/walk/run/crouch.glb, still on disk, no longer loaded)
// was last-circle's HIPS-FLATTENED bake: a constant 1.018 m hips on every
// frame. That is why `rifle_crouch` measured "hips identical to standing" —
// it IS Mixamo's "walk crouching forward", with the crouch flattened out of it
// — and why walk/run floated the boots 0.10-0.18 m. The set below is the SAME
// Mixamo Rifle 8-Way pack re-baked with the true hips height (last-circle
// art_a_make_loco8 "_g" + strafe bakes). Validated against THIS body before
// adoption (scratchpad FK + rotation compare, 2026-11-13):
//   - rotations are expressed in this body's bone frames: rifle_idle_g vs the
//     shipped rifle_idle, 52 bones, mean 0.02 deg (walk 0.24, run 0.63, crouch
//     0.41 deg — resampling only). The node RESTS stored in the _g files differ
//     from the body (RightUpLeg 174 deg) but every one of the 52 bones carries
//     a rotation track, so the stored rest is never sampled — the death2/3
//     "standing corpse" failure was missing/foreign-frame TRACKS, not rests.
//   - death_* files carry rests identical to the body (worst 0.04 deg), hips
//     start 0.953 m = rifle_idle_g, so the fall begins from the stance.
//   - feet: idle_g toe joints 0.036 m, hips 0.946-0.953 (grounded); crouch
//     hips 0.70-0.73 m, i.e. a real crouch.
// Rejected: last-circle `crouch.glb` (cm-unit Armature x0.01, hips rest 89
// deg off — foreign rig), `hit.glb` (same lineage as the rejected clip_hit:
// rests 22.8 deg off, unarmed flail), `land_hard` (2.0 s, hips to 0.46 m —
// a superhero landing, not a soldier stepping off a ledge), pistol strafes
// (gun at face height), `death_crouch_head` (cut for the ~600 KB budget;
// crouched victims enter a standing death mid-fall instead, see soldiers.js).
export const CLIP_FILES = {
  rifle_idle: "assets/chars/clip_rifle_idle_g.glb",
  rifle_walk: "assets/chars/clip_rifle_walk_g.glb",
  rifle_walk_left: "assets/chars/clip_rifle_walk_left.glb",
  rifle_walk_right: "assets/chars/clip_rifle_walk_right.glb",
  rifle_walk_back: "assets/chars/clip_rifle_walk_back.glb",
  rifle_run: "assets/chars/clip_rifle_run_g.glb",
  rifle_run_left: "assets/chars/clip_rifle_run_left.glb",
  rifle_run_right: "assets/chars/clip_rifle_run_right.glb",
  rifle_run_back: "assets/chars/clip_rifle_run_back.glb",
  rifle_sprint: "assets/chars/clip_rifle_sprint_g.glb",
  // a REAL crouch walk now (hips 0.70-0.73 m); crouch idle is this clip held
  // on its double-support frame (LOCO.crouchHold)
  rifle_crouch: "assets/chars/clip_rifle_crouch_g.glb",
  rifle_crouch_left: "assets/chars/clip_rifle_crouch_left.glb",
  rifle_crouch_right: "assets/chars/clip_rifle_crouch_right.glb",
  rifle_crouch_back: "assets/chars/clip_rifle_crouch_back.glb",
  rifle_reload: "assets/chars/clip_rifle_reload.glb", // played as an UPPER-BODY layer (CLIP_DERIVED)
  death_a: "assets/chars/clip_death_a.glb",           // falls backward
  death_front: "assets/chars/clip_death_front.glb",   // crumples forward
  death_front_head: "assets/chars/clip_death_front_head.glb", // backward
  death_back: "assets/chars/clip_death_back.glb",     // forward
  death_back_head: "assets/chars/clip_death_back_head.glb",   // forward
  death_right: "assets/chars/clip_death_right.glb",   // hit on the right, falls to his left
  jump_loop: "assets/chars/clip_jump_loop.glb",
  toss_grenade: "assets/chars/clip_toss_grenade.glb",
};

/**
 * Clips BUILT at load from a loaded one (actor.js loadClipSet), no new bytes:
 *  - mirror: swap the Left/Right bone tracks and reflect across the sagittal plane.
 *    Valid on this rig because its L/R rests are mirror images (measured:
 *    legs 0.00-0.9 deg, arms 0.7-1.9 deg; only finger rests differ, ~17 deg).
 *  - mask "upper": keep Spine..Head, shoulders, arms, hands only — the clip
 *    then rides ON TOP of the locomotion blend so the legs keep stepping.
 */
export const CLIP_DERIVED = {
  death_left: { from: "death_right", mirror: true },
  reload_upper: { from: "rifle_reload", mask: "upper" },
  throw_upper: { from: "toss_grenade", mask: "upper" },
};

/**
 * Locomotion blend table (actor.js loco system). Per gait, the four cardinal
 * clips by travel direction RELATIVE TO FACING (deg: 0 fwd, 90 = his left,
 * 180 back, -90 = his right). stride = metres of ground per cycle (Mixamo root
 * speed x duration, last-circle manifest_p1f/p23 on this rig) — the phase
 * advances by groundSpeed*dt/stride, which is what plants the feet.
 * sync = normalized time at which the LEFT foot leads furthest along the
 * travel direction (FK-measured per clip); every clip is sampled at
 * (phase + sync), so all four directions put the same foot down together
 * and a diagonal blend never crosses the legs.
 */
export const LOCO = {
  walk: [
    { anim: "walk", deg: 0, stride: 1.951, sync: 0.283 },
    { anim: "walk_left", deg: 90, stride: 1.889, sync: 0.300 },
    { anim: "walk_back", deg: 180, stride: 1.895, sync: 0.200 },
    { anim: "walk_right", deg: -90, stride: 1.889, sync: 0.200 },
  ],
  run: [
    { anim: "run", deg: 0, stride: 2.362, sync: 0.267 },
    { anim: "run_left", deg: 90, stride: 2.362, sync: 0.267 },
    { anim: "run_back", deg: 180, stride: 2.362, sync: 0.200 },
    { anim: "run_right", deg: -90, stride: 2.519, sync: 0.192 },
  ],
  sprint: [
    { anim: "sprint", deg: 0, stride: 3.542, sync: 0.267 },
  ],
  crouch: [
    { anim: "crouch_walk", deg: 0, stride: 2.005, sync: 0.300 },
    { anim: "crouch_left", deg: 90, stride: 2.140, sync: 0.217 },
    { anim: "crouch_back", deg: 180, stride: 2.005, sync: 0.200 },
    { anim: "crouch_right", deg: -90, stride: 2.005, sync: 0.233 },
  ],
  // quadrants [fromDeg, toDeg] whose cardinal pair does NOT blend linearly
  // (fwd+left, right+back: 2.6-2.7 m/s planted slide at run speed, measured)
  // — actor.js sharpens the blend there and turns the legs for the rest
  sharp: [[0, 90], [-180, -90]],
  // crouch idle = rifle_crouch frozen at its double-support frame (both toes
  // within 1.5 cm of the ground, hips 0.726 m — FK-measured)
  crouchHold: 0.642,
  // gait thresholds (m/s, sim ground speed): sim walk 4.6 / strafe 4.14 /
  // back 3.5 / ADS ~2.8 / crouch 2.4 / sprint 6.4
  walkRun: [2.3, 3.3],
  runSprint: [5.0, 6.0],
  move: [0.2, 1.1],
};

/**
 * Semantic → clip name (frozen 10-key shape, architecture §3.15).
 * Notes on the mappings that are not 1:1:
 *  - aim/fire share rifle_idle: the Mixamo rifle idle IS the ready pose; the
 *    aim read comes from the spine aim-blend layer (VT §7) + muzzle fx, and
 *    sharing the clip means aim↔fire transitions never pop.
 *  - crouch_walk uses rifle_walk (a real stepping cycle) — playing the static
 *    rifle_crouch pose while a bot translates would be sliding feet, the D10
 *    hard-cap.
 *  - MEASURED 2026-08-20, and it invalidates an assumption this file used to
 *    carry: `rifle_crouch` IS NOT A CROUCH. Sampled live on the shipped rig
 *    (world bone positions, 8 frames of playback): hips 0.952 m — IDENTICAL to
 *    the standing idle — head 1.43 vs 1.55, and the feet lifting to 0.32-0.46 m.
 *    It is a marching-in-place clip. So `crouch_idle` resolving to it renders a
 *    standing man raising his knees, which is what the AI's low-cover peek
 *    cycle (botfsm.js:904) has been drawing for its whole life. The crouch is
 *    now SOLVED procedurally in actor.js — a symmetric two-link squat with the
 *    hip drop measured off the rig so the boots stay planted — and this clip
 *    supplies only the upper-body pose it blends under. Do not "simplify" the
 *    procedural squat away on the belief that the clip already crouches.
 *    SUPERSEDED 2026-11-13: that clip was the hips-FLATTENED bake of Mixamo's
 *    crouch walk. `rifle_crouch` now loads the true-hips bake (0.70-0.73 m)
 *    and the procedural squat runs only when the crouch clips are missing
 *    (actor.hasClipCrouch false).
 *  - deaths (2026-11-13): soldiers.js picks the clip by the shot's direction
 *    relative to the victim's facing + headshot (death_front/back/left/right,
 *    *_head) and still varies rate per victim; death_a/death_b remain as the
 *    sim's latched semantic and the direction-unknown fallback. Note that
 *    since the 8-way pass, walk/run/crouch are not played through these keys
 *    one at a time — actor.js blends the LOCO table below by speed + travel
 *    direction. The frozen 10-key SHAPE is intact (keys only added).
 */
export const ANIMS = {
  idle: "rifle_idle",
  walk: "rifle_walk",
  run: "rifle_run",
  // 2026-11-13: both crouch keys now resolve to the real crouch walk (see
  // CLIP_FILES); crouch_idle is played held on LOCO.crouchHold by actor.js
  crouch_idle: "rifle_crouch",
  crouch_walk: "rifle_crouch",
  aim: "rifle_idle",
  fire: "rifle_idle",
  // the hit SLOT stays; there is still no usable rifle hit clip (see
  // CLIP_FILES rejections), so it resolves to the ready pose under the
  // procedural flinch (actor.hitImpulse) and clip_hit.glb is no longer loaded
  hit: "rifle_idle",
  death_a: "death_a",
  death_b: "death_front",
  // ADDED iter07 (D10 lane), 11th key — the 10 frozen keys above are untouched,
  // this is a pure addition. rifle_reload shipped in CLIP_FILES from day one
  // "for A5's future reload-anim hook" and NOTHING ever pointed at it: no
  // semantic key resolved to it, so a bot reloading played its idle and the
  // magazine change was invisible. sim exposes bot.weapon.state === "reloading"
  // and A5's §5.7 dry-reload behaviour drives it, so the hook is due now.
  reload: "rifle_reload",
  // ADDED 2026-11-13 (8-way locomotion / death variety pass) — pure additions
  walk_left: "rifle_walk_left",
  walk_right: "rifle_walk_right",
  walk_back: "rifle_walk_back",
  run_left: "rifle_run_left",
  run_right: "rifle_run_right",
  run_back: "rifle_run_back",
  sprint: "rifle_sprint",
  crouch_left: "rifle_crouch_left",
  crouch_right: "rifle_crouch_right",
  crouch_back: "rifle_crouch_back",
  death_front: "death_front",
  death_front_head: "death_front_head",
  death_back: "death_back",
  death_back_head: "death_back_head",
  death_right: "death_right",
  death_left: "death_left",
  jump: "jump_loop",
  reload_upper: "reload_upper",
  throw: "throw_upper",
};

/**
 * Contract gate (architecture §0.11 / §3.15): every clip name this module can
 * ever ask an actor to play MUST exist in the loaded clip set. THROWS on any
 * dangling reference — a dangling clip is a build failure at load, not a
 * silently-frozen soldier (the Colosseum empty-bout lesson, char edition).
 *
 * @param {string[]} protoClips  names of the AnimationClips actually loaded
 */
export function validateAnimMap(protoClips) {
  const have = new Set(protoClips || []);
  const need = new Set(Object.values(ANIMS));
  const missing = [...need].filter((n) => !have.has(n));
  if (missing.length) {
    throw new Error(
      `[anim_map] CONTRACT GATE: dangling clip refs [${missing.join(", ")}] — ` +
      `loaded clips: [${[...have].join(", ")}]. A semantic anim would freeze ` +
      `or bind-pose on stage; refusing to continue (doctrine §1).`
    );
  }
  return true;
}
