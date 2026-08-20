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
export const CLIP_FILES = {
  rifle_idle: "assets/chars/clip_rifle_idle.glb",
  rifle_walk: "assets/chars/clip_rifle_walk.glb",
  rifle_run: "assets/chars/clip_rifle_run.glb",
  rifle_crouch: "assets/chars/clip_rifle_crouch.glb",
  rifle_reload: "assets/chars/clip_rifle_reload.glb", // shipped for A5's future reload-anim hook
  hit: "assets/chars/clip_hit.glb",
  death_a: "assets/chars/clip_death_a.glb",
};

/**
 * Semantic → clip name (frozen 10-key shape, architecture §3.15).
 * Notes on the mappings that are not 1:1:
 *  - aim/fire share rifle_idle: the Mixamo rifle idle IS the ready pose; the
 *    aim read comes from the spine aim-blend layer (VT §7) + muzzle fx, and
 *    sharing the clip means aim↔fire transitions never pop.
 *  - crouch_walk uses rifle_walk (a real stepping cycle) with a procedural
 *    hip-drop in soldiers.js — playing the static rifle_crouch pose while a
 *    bot translates would be sliding feet, the D10 hard-cap.
 *  - death_a AND death_b resolve to the one proven fall clip (see CLIP_FILES
 *    note); soldiers.js varies playback rate + fall direction per victim so
 *    no two nearby deaths read identical. The frozen 10-key SHAPE is intact.
 */
export const ANIMS = {
  idle: "rifle_idle",
  walk: "rifle_walk",
  run: "rifle_run",
  crouch_idle: "rifle_crouch",
  crouch_walk: "rifle_walk",
  aim: "rifle_idle",
  fire: "rifle_idle",
  hit: "hit",
  death_a: "death_a",
  death_b: "death_a",
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
