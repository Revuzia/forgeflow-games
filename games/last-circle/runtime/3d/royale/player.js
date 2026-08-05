/**
 * royale/player.js — unified ACTOR system for Last Circle.
 *
 * One code path for the human and all 49 bots: every actor carries an `input`
 * struct (move axes, look yaw/pitch, fire/ads/jump/... flags). The human's
 * keyboard+mouse writes into W.player.input; bot brains (royale/bots.js) write
 * into their actor's input. Movement, physics, animation, and camera all read
 * only from actor state — so bots ARE players mechanically.
 *
 * Owns: actor creation, character models (Quaternius rigs, 4 skins), the
 * glider drop, capsule-vs-world movement (terrain heightfield + static AABBs +
 * ramps + build pieces), animation state, name tags, the third-person camera,
 * spectate, and death/despawn.
 */
import * as THREE from "three";
// ?v= must propagate to intra-runtime imports (FFG gotcha) → top-level await
const { findArmBones, applyArmPose, measureLean, uprightTorso, twoBoneIK } = await import("./pose.js" + (new URL(import.meta.url).search || ""));
const rigPipe = await import("./rig_pipeline.js" + (new URL(import.meta.url).search || ""));

let K = null; // SIM shortcut set in init

export function init(W) {
  K = W.SIM;
  W.hurtActor = (victim, dmg, attackerId, weaponId, isHead) => hurtActor(W, victim, dmg, attackerId, weaponId, isHead);
  W.killActor = (victim, killerId, weaponId) => killActor(W, victim, killerId, weaponId);
  W.useConsumable = (a, id) => useConsumable(W, a, id);
  // net.js replays peers' emotes through the SAME path the local one uses, so a
  // remote wave looks identical to your own rather than being a second system
  W.attachToBone = rigPipe.attachToBone;          // the ONLY sanctioned attach path
  W.validateAttachments = rigPipe.validateAttachments;
  W.playRemoteEmote = (a, kind) => {
    if (!a || !a.clips || a.emoting) return;
    // SAME SHAPE as the local path ({t}), not a bare string: netRemote actors
    // skip stepActor today, but this game hands a slot back to a BOT when a peer
    // drops — and stepActor does `a.emoting.t -= dt`, which throws on a string
    // in strict mode. Matching the shape keeps that takeover safe.
    a.emoting = { t: 2.4, remote: kind };
    if (a.hand) a.hand.visible = false;
    playAnim(a, a.clips[kind] ? kind : "cheer", { once: true, force: true });
    setTimeout(() => {
      if (a.emoting && a.emoting.remote === kind) {
        a.emoting = null; a.anim = null;
        if (a.hand) a.hand.visible = true;
        playAnim(a, "idle", { force: true });
      }
    }, 2400);
  };
  W.events.on("useConsumable", (a, id) => useConsumable(W, a, id));
  installHumanInput(W);
}

// ── actor factory ────────────────────────────────────────────────────────────
export function createActor(W, opts) {
  const a = {
    id: opts.id, name: opts.name, isBot: !!opts.isBot,
    tier: opts.tier || 3, personality: opts.personality || "rotator",
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    hp: K.PLAYERK.hp, shield: 0, alive: true, downedAt: 0,
    // squads: null = its own side, so every bot and every offline match is
    // unchanged by construction. Only the friends path (net.js) ever sets it,
    // and hurtActor is the single place that reads it.
    teamId: opts.teamId || null,
    onGround: false, sprinting: false, gliding: false, inWater: false, swimming: false,
    input: mkInput(),
    inventory: {
      // everyone spawns with a pistol — this is a shooter, not a scavenger sim
      slots: [{ kind: "weapon", id: K.START_LOADOUT.weapon, rarity: K.START_LOADOUT.rarity, mag: K.WEAPONS[K.START_LOADOUT.weapon].mag }, null, null, null, null],
      active: 0,
      ammo: Object.assign({ light: 0, medium: 0, shells: 0, heavy: 0, grenades: 0 }, K.START_LOADOUT.ammo),
    },
    weapon: { id: K.START_LOADOUT.weapon, rarity: 0, magAmmo: K.WEAPONS[K.START_LOADOUT.weapon].mag, state: "ready", cd: 0, reloadT: 0 },
    aimErr: 0, lastShotT: -9, lastDamageT: -9, lastAttacker: null,
    healing: null,           // {id, tLeft}
    obj: new THREE.Group(), rig: null, nameTag: null, weaponMesh: null,
    // was "idle": playAnim early-returns when the requested clip is already the
    // current one, so the load-time playAnim(a,"idle") never reached rig.play and
    // any actor that never changed state stood in the rig's REST pose (most
    // visible on the practice dummies, which never move).
    anim: null, mixerLOD: 0,
    kills: 0,
    brain: null,
    netRemote: false,        // true = driven by network peer
  };
  a.obj.name = "actor_" + a.id;
  W.group("actors").add(a.obj);
  W.actors.push(a);
  W.actorById.set(a.id, a);
  return a;
}

function mkInput() {
  return {
    mx: 0, mz: 0, jump: false, sprint: false, crouch: false,
    yaw: 0, pitch: 0, fire: false, ads: false, reload: false,
    interact: false, interactDown: false, slot: -1,
  };
}

// ── models ───────────────────────────────────────────────────────────────────
// MESHY AI-GENERATED battle-royale cast (owner direction: no reused fantasy
// characters). Each skin = <key>.glb (mesh+skeleton+idle) + tiny clip-only
// GLBs (<key>_walk/_run/_death.glb) sharing the same skeleton — clips get
// merged into the cached gltf so every clone has the full action set.
// Round-2 fist cast (hands modeled CLOSED — Meshy rigs have no finger bones,
// so open-hand models can never grip; these were generated fists-first).
// drifter/SCRAP REMOVED — Meshy shipped his rig with a 27° baked-in forward
// slouch (every other fighter sits at 1-5°); un-slouchable without regen and
// the regen risked the same. Owner call: cut him.
const SKINS = ["soldier", "athlete", "wraith", "juggernaut", "viper"];
// Per-skin weapon-holder rotation (hand-bone local). Meshy rigs DON'T share a
// hand-bone rest orientation, so one fixed rotation left wraith/juggernaut
// aiming 35° high. These were auto-calibrated live (measure barrel → rotate to
// forward+level) and verified: dot 1.0, muzzle level on all five.
const HAND_AIM_ROT = {
  soldier:    [-1.449, -0.105, -0.779],
  athlete:    [-1.637, -0.090, -0.788],
  wraith:     [-1.067, -0.403, -0.680],
  juggernaut: [-1.094, -0.444, -0.676],
  viper:      [-1.338,  0.023, -0.788],
};
// Mixamo pistol/rifle/fall clips load alongside loco. When present they own the
// arms for that weapon family; pose.js is the fallback if a clip is missing.
// Mixamo jump starts at takeoff (no multi-second Meshy lead-in).
const JUMP_TAKEOFF_S = 0.05;
/** Meshy bakes ROOT TRANSLATION into its clips: Swim_Forward carries ~2.3 m of
 *  forward travel on the Hips position track, and the sprint clip carries its
 *  own stride displacement. The game drives position itself from the sim, so
 *  playing these in place makes the body surge away from its own collider and
 *  snap back once per loop — read on screen as "lagging back and forth" while
 *  sprinting, and as a rigid prop being dragged through the water while
 *  swimming. The rotation tracks are what we actually want from these clips.
 *
 *  Strip the HORIZONTAL component of the root position track and keep Y, so a
 *  jump still leaves the ground and a swimmer still bobs. Done here, at the one
 *  point every Meshy clip passes through, so all five skins and every clone
 *  inherit it — the alternative is per-clip fixes forever, and this is the
 *  generator. */
function stripRootMotion(clip) {
  if (!clip || !clip.tracks) return clip;
  for (const tr of clip.tracks) {
    if (!/\.position$/.test(tr.name || "")) continue;
    const node = tr.name.replace(/\.position$/, "");
    // only the ROOT drives the body through the world; other bones' translation
    // is legitimate skeletal animation and must be left alone
    if (!/(^|:|\|)(Hips|Root|Armature|mixamorig:?Hips)$/i.test(node)) continue;
    const v = tr.values;
    if (!v || v.length < 3) continue;
    const x0 = v[0], y0 = v[1], z0 = v[2];
    // Keeping Y was right for the bob clips (swim +/-3-6 cm, walk/run/crouch
    // 4-9 cm) but WRONG for jump: the engine already owns the vertical arc, and
    // the clip bakes ~3.5 m of its own on top, so a 1.38 m jump launched the
    // model two body-heights up with its feet a metre above the collider.
    // Strip Y only where the engine drives height.
    const flatY = /^(jump)$/i.test(clip.name || "");
    for (let i = 0; i < v.length; i += 3) {
      v[i] = x0; v[i + 2] = z0;
      if (flatY) v[i + 1] = y0;
    }
  }
  return clip;
}

// Base loco + combat set, then Mixamo BR weapon holds + freefall.
// File names on disk: assets/chars/meshy/{skin}_{clip}.glb
const MESHY_CLIPS = [
  "idle",   // real Mixamo breathing idle — the BASE GLB's baked animations[0]
            // is a 0-duration frozen frame (see the rename below), not an idle
  "walk", "run", "death", "death2", "death3", "hit", "dance", "cheer", "jump", "swim", "crouch",
  "fall",
  "pistol_idle", "pistol_walk", "pistol_run",
  "rifle_idle", "rifle_walk", "rifle_run", "rifle_reload", "rifle_crouch",
];
const _v3 = new THREE.Vector3();

/** "pistol" | "rifle" | null — SMG/AR/shotgun/sniper/GL all use the rifle set. */
function gunFamily(a) {
  if (!a.weapon || !a.weapon.id || String(a.weapon.id).startsWith("consumable")) return null;
  const def = K.WEAPONS && K.WEAPONS[a.weapon.id];
  if (!def) return null;
  return def.cls === "pistol" ? "pistol" : "rifle";
}

async function preloadMeshySkin(W, key, tick) {
  const url = W.assetBase + "assets/chars/meshy/" + key + ".glb";
  const rig = await W.kernel.loadCharacter(url);   // caches gltf; registers this throwaway clone's mixer
  if (tick) tick();
  rig.scene.visible = false;
  const cached = W.kernel._charCache[url];
  if (cached && !cached.__lcMerged) {
    cached.__lcMerged = true;
    if (cached.animations && cached.animations[0]) {
      // The Mixamo-rigged bases bake a 0-DURATION placeholder frame as
      // animations[0] ("mixamo.com") — calling that "idle" made every unarmed
      // actor a frozen statue (practice dummies T-posed). The real breathing
      // idle ships as <skin>_idle.glb via MESHY_CLIPS; park the baked frame
      // under a name nothing selects.
      cached.animations[0].name = cached.animations[0].duration > 0.1 ? "idle" : "baked";
    }
    // These 8 clip GLBs were fetched with an `await` INSIDE the loop, and this
    // runs once per skin: 8 round trips deep, five times over, sitting directly
    // on the path to the drop. They do not depend on each other — same bytes,
    // one round trip deep. Results are APPLIED in MESHY_CLIPS order after all
    // settle so the merged clip list stays deterministic, and the "idle" rename
    // above still happens first so animations[0] remains idle for classifyClips'
    // names[0] fallbacks. allSettled keeps the old per-clip failure tolerance:
    // a clip that 404s drops out and the rest of the skin still loads.
    const loaded = await Promise.allSettled(MESHY_CLIPS.map(async (clip) => {
      // async wrapper, not a bare .finally(): it turns a SYNCHRONOUS throw out of
      // the loader into a rejection too, which is the tolerance the old per-clip
      // try/catch had.
      try { return await W.kernel.loader.loadAsync(W.assetBase + "assets/chars/meshy/" + key + "_" + clip + ".glb"); }
      finally { if (tick) tick(); }
    }));
    for (let i = 0; i < loaded.length; i++) {
      const r = loaded[i];
      if (r.status !== "fulfilled") { console.warn("[chars] clip load failed", key, MESHY_CLIPS[i], r.reason); continue; }
      const g = r.value;
      if (g.animations && g.animations[0]) {
        g.animations[0].name = MESHY_CLIPS[i];
        stripRootMotion(g.animations[0]);
        cached.animations.push(g.animations[0]);
      }
    }
  } else if (tick) tick(MESHY_CLIPS.length);   // warm cache: those files are already done, say so
  // The warm-up clone exists only to populate the gltf cache, but
  // kernel.loadCharacter registers ITS mixer in the per-frame update list too.
  // loadActorModels runs every match, so this leaked 5 mixers per match — the
  // roster teardown in ffg_royale3d.js does not see these because they are
  // never actors. Measured: kernel mixer count climbed 61 -> 66 -> 71 -> 76
  // across four matches until this was disposed.
  if (W.kernel.disposeMixer && rig.mixer) W.kernel.disposeMixer(rig.mixer);
  return url;
}

export async function loadActorModels(W) {
  // 5 skins x (1 mesh GLB + 8 clip GLBs) is EVERY file this function fetches,
  // counted — and these fetches are essentially the whole pre-match wait (the
  // map build measures 302-701 ms against them), so the loading bar has no
  // excuse for guessing. W.loadProgress is a hook: absent = nothing to report
  // to, so this costs one null check. Clips merge into the cached gltf on the
  // first match only (__lcMerged), so on a requeue the skipped ones tick
  // straight through and the bar completes fast instead of pretending to work.
  const total = SKINS.length * (1 + MESHY_CLIPS.length);
  let done = 0;
  const tick = (n) => { done += (n || 1); if (W.loadProgress) W.loadProgress(done, total); };
  if (W.loadProgress) W.loadProgress(0, total);
  // tolerant preload: a still-baking skin just drops out of rotation
  const settled = await Promise.allSettled(SKINS.map((k) => preloadMeshySkin(W, k, tick)));
  const urls = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (!urls.length) throw new Error("no character skins available");
  const vr = K.mulberry32(W.seed ^ 0xfaceb);
  // the human's locker choice (menu skin bay) — bots keep rotating the cast
  let chosen = null;
  try { chosen = localStorage.getItem("lc_skin"); } catch (e) {}
  const chosenUrl = chosen && urls.find((u) => u.includes("/" + chosen + ".glb"));
  for (let i = 0; i < W.actors.length; i++) {
    const a = W.actors[i];
    const url = (!a.isBot && chosenUrl) ? chosenUrl : urls[i % urls.length];
    const rig = await W.kernel.loadCharacter(url);
    a.rig = rig;
    a.skin = url.split("/").pop().replace(/\.glb.*/, "");
    // Audit the rig against the skeleton contract ONCE per skin per session —
    // a rig that fails here is the root cause of every downstream "gear on the
    // wrong bone / arms broken" symptom, so it must fail LOUDLY at load, not
    // silently at the first firefight. (rig_pipeline.js owns the contract.)
    W._rigAudit = W._rigAudit || {};
    if (!W._rigAudit[a.skin]) W._rigAudit[a.skin] = rigPipe.inspectRig(rig.scene, a.skin);
    // PROCEDURAL VARIETY: 5 base rigs x a per-actor colour wash, so a lobby of
    // 50 does not read as ten clones of each skin.
    // This used to be `color.offsetHSL(hue, 0.02, +/-0.07)`, which is a no-op on
    // these models: every Meshy GLB ships a baseColorTexture with NO
    // baseColorFactor, so material.color starts at pure white (H0 S0 L1) and an
    // offset from L1 clamps. Measured across the 10 actors sharing the soldier
    // skin: #ffffff, #fbfbfb, #fcfcfc, #fefefe, #f8f8f8 ... — the darkest was
    // 97.3% white, i.e. indistinguishable. baseColor MULTIPLIES the texture, so
    // the tint has to be an actual colour, not a nudge away from white.
    // Two rounds of "raise the saturation" never worked (see the history above)
    // because the tint's output channel was DEAD. Meshy exports two things that
    // together make every character render fullbright and untintable, and both
    // have to be undone here before the wash means anything:
    //
    //   metalness — the GLBs omit metallicFactor entirely, and glTF 2.0 says an
    //     absent metallicFactor is 1.0, so GLTFLoader hands us metalness = 1. A
    //     metal MeshStandardMaterial has NO diffuse term: baseColor stops being
    //     albedo and becomes specular F0. With no scene.environment to reflect,
    //     m.color was multiplying into nothing, which is exactly why actors that
    //     had visibly different hex values still looked identical on screen.
    //   emissive — the GLBs ship emissiveFactor [1,1,1] with the emissiveTexture
    //     pointing at the SAME image as baseColorTexture. That is Meshy's
    //     self-illuminated preview look: it re-adds the albedo through the
    //     unlit, unshadowed emissive path, so a fighter standing inside a
    //     building was exactly as bright as one in open sun. In a BR, shade is
    //     supposed to be cover — this deleted that whole readability channel and
    //     made the cast read as flat cutouts pasted over a correctly-lit world.
    //
    // Verified on the live build before changing anything: all 5 skins reported
    // metalness 1, emissive #ffffff, emissiveMap === map, scene.environment null.
    // Removing the emissive costs real brightness, because these albedo textures
    // were BAKED DARK on the assumption that the emissive pass would light them.
    // The gain below multiplies the DIFFUSE path (colour multiplies the texture),
    // so brightness comes back through the lit channel and shade still means
    // something — as opposed to raising emissive, which would just restore the
    // fullbright bug under a different name. Colour is allowed to exceed 1.
    //
    // Calibrated by rendering a grounded actor offscreen and comparing its median
    // pixel luminance against the terrain around it, sun on vs sun occluded:
    //   as shipped      sun 66.5   shade 78.0   = 17% BRIGHTER in shade (fullbright)
    //   gain 2.2        sun 44.9   shade 20.0   = 55% darker,  0.4% clipped
    //   gain 3.2 (here) sun ~60    shade ~24    = ~60% darker, ~2.5% clipped
    //   gain 3.4        sun 67.4   shade 26.1   = 61% darker,  3.3% clipped
    // 3.2 sits just under the shipped brightness while keeping blown highlights
    // low enough that texture detail survives.
    const BODY_GAIN = 3.2;
    const hue = vr();                                   // full wheel
    const sat = 0.22 + vr() * 0.16;                     // 0.22-0.38 — reads now that diffuse is live
    const lig = 0.68 + vr() * 0.12;                     // 0.68-0.80 before gain
    const seen = new Map();
    rig.scene.traverse((o) => {
      if (!(o.isMesh || o.isSkinnedMesh) || !o.material) return;
      if (!seen.has(o.material)) {
        const m = o.material.clone();
        m.metalness = 0;                                // glTF default 1.0 killed the diffuse term
        if (m.emissiveMap) {                            // strip Meshy's self-illum preview hack
          m.emissiveMap = null;
          if (m.emissive) m.emissive.setHex(0x000000);
        }
        if (m.color) m.color.setHSL(hue, sat, lig).multiplyScalar(BODY_GAIN);
        // ONE hue over the whole body still reads as ten tinted copies of each
        // skin in a 50-player lobby. Splitting the albedo by material is not
        // available on this cast: every skin GLB carries exactly one mesh and
        // one material (parsed the glTF JSON chunk of all five —
        // meshes 1 | materials 1 | prims [1]), so there is no second slot to
        // tint. The zones come from BIND-POSE vertex height instead: `position`
        // is read before skinning, so the bands stay welded to the body while
        // the limbs animate. The thresholds are real metres — the POSITION
        // accessor of all five skins measures min.y ~0 (|y| < 3e-8) and max.y
        // 1.7999999, i.e. feet at the origin and 1.8 m tall, which is the
        // authoring convention noted below. Legs/torso/head take independently
        // rolled hues off the SAME seeded stream, so it stays deterministic per
        // seed while giving ~125x the silhouette variety for no new assets.
        // The patch divides m.color back out and multiplies the zone tint in, so
        // if this block is ever deleted the look degrades to exactly the wash
        // above rather than to something new.
        const zc = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
        for (let z = 0; z < 3; z++) zc[z].setHSL((hue + (vr() - 0.5) * 0.28 + 1) % 1, sat, lig).multiplyScalar(BODY_GAIN);
        // every actor gets its own material clone (the wash above needs one), so
        // without a shared cache key this is 50 identical shader COMPILES on the
        // load path. Only the uniform VALUES differ between them, so a constant
        // key is correct — three still folds in maps/skinning/lights itself.
        m.customProgramCacheKey = () => "lcZoneTint";
        m.onBeforeCompile = (sh) => {
          sh.uniforms.zLegs = { value: zc[0] }; sh.uniforms.zTorso = { value: zc[1] }; sh.uniforms.zHead = { value: zc[2] };
          // The zone tint below divides `diffuse` (= material.color) back out, so
          // ANYTHING animating material.color on these actors cancels algebraically
          // and renders zero pixels — fx.js's hit flash did exactly that and
          // shipped dead on 100% of actors. Give the flash its own uniform.
          sh.uniforms.zFlash = { value: new THREE.Vector3(1, 1, 1) };
          m.userData.zFlash = sh.uniforms.zFlash;
          sh.vertexShader = "varying float vZoneY;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n  vZoneY = position.y;");
          // injected AFTER <color_fragment>, which in three r172's meshphysical
          // fragment runs after <map_fragment> — so diffuseColor is already
          // (diffuse * texture) and dividing `diffuse` out leaves the texture.
          sh.fragmentShader = "varying float vZoneY;\nuniform vec3 zLegs;\nuniform vec3 zTorso;\nuniform vec3 zHead;\nuniform vec3 zFlash;\n" + sh.fragmentShader.replace(
            "#include <color_fragment>",
            "#include <color_fragment>\n  vec3 zTint = mix(zLegs, zTorso, smoothstep(0.80, 1.00, vZoneY));\n  zTint = mix(zTint, zHead, smoothstep(1.45, 1.60, vZoneY));\n  diffuseColor.rgb = diffuseColor.rgb / max(vec3(0.0001), diffuse) * zTint * zFlash;"
          );
        };
        m.needsUpdate = true;
        seen.set(o.material, m);
      }
      o.material = seen.get(o.material);
    });
    // Meshy rigs are authored at REAL METERS (rigging height_meters: 1.8,
    // feet at y=0) — do NOT bbox-normalize: the bind-pose bbox of a Meshy
    // SkinnedMesh reads ~0.1m (tiny armature node scales) and "normalizing"
    // it spawned 26m giants once the animation restored true proportions.
    rig.scene.scale.setScalar(1);
    rig.scene.position.y = 0;
    a.obj.add(rig.scene);
    a.clips = classifyClips(rig);
    // the capsule only shrinks when this actor can actually be SEEN crouching
    a.hasCrouchClip = !!a.clips.crouch;
    a.armBones = findArmBones(rig.scene);   // runtime arm-pose layer (pose.js)
    // detect a defective slouching rig (Meshy shipped drifter at ~27°; the
    // rest sit at 1-5°) → straighten its torso every frame
    a.obj.updateMatrixWorld(true);
    a.torsoFix = measureLean(a.armBones) > 0.20;   // >~11° = slouched
    playAnim(a, "idle");
    // name tag sprite (not for self)
    if (a.id !== (W.player && W.player.id)) a.nameTag = mkNameTag(W, a);
    // weapon holder on the RIGHT HAND bone (Meshy = "RightHand"; Quaternius
    // fallback "FistR"). Bone world scale varies wildly between rig families
    // (Meshy ~0.065 vs Quaternius ~5.5) — compensate so guns keep world size.
    let fist = null;
    rig.scene.traverse((o) => { if (o.isBone && /^RightHand$|^FistR$/i.test(o.name) && !fist) fist = o; });
    a.hand = new THREE.Group();
    a.handBone = fist;   // for per-frame barrel aiming (rig hand orientations differ)
    if (fist) {
      fist.add(a.hand);
      a.obj.updateMatrixWorld(true);
      fist.getWorldScale(_v3);
      const ws = Math.max(1e-4, _v3.x);
      a.hand.scale.setScalar(1 / ws);
      // grip orientation — grid-searched live against the gunReady arm pose so
      // the barrel points FORWARD and level out of the fist (was 37° down and
      // off to the right; owner: "gun is STILL pointing the wrong way").
      // dotForward 0.99 at (-90°, 0, -45°). Weapon grip anchor (weapons.js)
      // sits the handle at this origin.
      a.hand.position.set(0, 0.02 / ws, 0);
      const hr = HAND_AIM_ROT[a.skin] || [-Math.PI / 2, 0, -Math.PI / 4];
      a.hand.rotation.set(hr[0], hr[1], hr[2]);
    } else {
      a.hand.position.set(0.32, 1.15, 0.28);
      a.obj.add(a.hand);
    }
    // show the starting pistol in hand (re-equip wires slotRef + mesh)
    if (W.equipSlot) W.equipSlot(a, a.inventory.active);
    // one-shot attachment audit per actor: holder on a legal hand bone, scale
    // compensation inverting the bone scale, weapon length inside its band
    rigPipe.validateAttachments(a);
  }
}

function classifyClips(rig) {
  const names = Object.keys(rig.actions || {});
  const find = (pats) => {
    for (const p of pats) { const n = names.find((x) => p.test(x)); if (n) return n; }
    return null;
  };
  const idle = find([/^idle$/i, /^idle\b/i]) || names[0];
  const run = find([/^run$/i, /^run\b/i]) || names[0];
  const walk = find([/^walk$/i, /^walk\b/i]) || run;
  return {
    idle,
    run,
    walk,
    swim: find([/^swim$/i]) || run,
    // freefall is its own clip; jump must not steal it
    jump: find([/^jump$/i, /jump/i]),
    fall: find([/^fall$/i, /falling/i]),
    // exact-anchored so "death" never swallows the variants
    death: find([/^death$/i, /death|die|defeat/i]),
    death2: find([/^death2$/i]),
    death3: find([/^death3$/i]),
    hit: find([/^hit$/i]),
    shoot: find([/shoot|attack|punch|slash|hit/i]),
    dance: find([/^dance$/i, /dance/i]),
    cheer: find([/^cheer$/i, /cheer|wave|victory/i]),
    crouch: find([/^crouch$/i, /crouch/i]),
    pistol_idle: find([/^pistol_idle$/i]),
    pistol_walk: find([/^pistol_walk$/i]),
    pistol_run: find([/^pistol_run$/i]),
    rifle_idle: find([/^rifle_idle$/i]),
    rifle_walk: find([/^rifle_walk$/i]),
    rifle_run: find([/^rifle_run$/i]),
    rifle_reload: find([/^rifle_reload$/i]),
    rifle_crouch: find([/^rifle_crouch$/i]),
  };
}

function playAnim(a, key, opts) {
  if (!a.rig || !a.clips) return;
  const realKey = key;
  const clip = a.clips[realKey] || a.clips.idle;
  if (!clip) return;
  // `|| 1` swallowed an explicit timeScale of 0 (falsy), so "freeze this clip"
  // silently played at full speed — a crouching player marched in place.
  const ts = opts && opts.timeScale != null ? opts.timeScale : 1;
  if (a.anim === realKey && !(opts && opts.force)) {
    // same clip, new pace → retune the live action, never restart (restart
    // every frame while speed varies = visible stutter)
    if (a._animTS !== ts) {
      const act = a.rig.actions[clip];
      if (act) act.setEffectiveTimeScale(ts);
      a._animTS = ts;
    }
    return;
  }
  a.anim = realKey;
  a._animTS = ts;
  a.rig.play(clip, Object.assign({ timeScale: ts }, opts));
  // startAt: seek into the clip. Meshy's library clips carry long standing
  // lead-ins, so a short game action can otherwise show none of the motion.
  if (opts && opts.startAt != null) {
    const act = a.rig.actions[clip];
    if (act) act.time = opts.startAt;
  }
}

function mkNameTag(W, a) {
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 48;
  const ctx = cv.getContext("2d");
  ctx.font = "bold 26px system-ui";
  ctx.textAlign = "center";
  // Bots carry deliberately human-looking handles (BOT_NAMES: "SweatySteve",
  // "ClutchClara"), and every tag was the same white-on-black pill — so in a
  // mode whose menu button says SQUAD UP there was no way to tell your friend
  // from the 46 bots. Humans get a blue pill + outline; bots keep the original
  // colours byte for byte. Known edge: this texture is baked once at model load,
  // so a peer slot handed to a bot mid-match (net.js "bye" flips isBot) keeps
  // the friendly tint — acceptable, it is still that peer's slot.
  const human = !a.isBot;
  ctx.fillStyle = human ? "rgba(6,40,70,0.55)" : "rgba(0,0,0,0.45)";
  const w = Math.min(240, ctx.measureText(a.name).width + 22);
  ctx.beginPath(); ctx.roundRect(128 - w / 2, 4, w, 38, 8); ctx.fill();
  if (human) { ctx.strokeStyle = "rgba(110,196,255,0.9)"; ctx.lineWidth = 2; ctx.stroke(); }
  ctx.fillStyle = human ? "#8fd8ff" : "#fff";
  ctx.fillText(a.name, 128, 32);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  sp.scale.set(2.6, 0.49, 1);
  sp.position.y = 2.25;
  a.obj.add(sp);
  return sp;
}

// ── spawning / drop ─────────────────────────────────────────────────────────
export function spawnAll(W) {
  const modeK = K.MODE[W.mode] || K.MODE.standard;
  const rng = K.mulberry32(W.seed ^ 0x5eed);
  for (const a of W.actors) {
    if (modeK.drop === "glider" && W.mode !== "practice") {
      // airborne NEAR the actor's drop target (assignDrops refines bots right
      // after this) — like jumping from the bus at the right moment. Humans
      // spawn high over a random point and steer freely.
      const p = W.map.randomGroundPos(rng);
      a.pos.set(p.x, 240 + rng() * 30, p.z);
      a.gliding = true;
      a.vel.set(0, -2, 0);
    } else {
      const p = W.map.randomGroundPos(rng);
      a.pos.set(p.x, p.y + 0.1, p.z);
      a.gliding = false;
    }
    a.obj.position.copy(a.pos);
    a.shield = W.mode === "quick" ? 25 : 0;
  }
  // practice: give the player a full kit
  if (W.mode === "practice") {
    const inv = W.player.inventory;
    inv.slots[1] = { kind: "weapon", id: "ar", rarity: 2, mag: K.WEAPONS.ar.mag };
    inv.slots[2] = { kind: "weapon", id: "shotgun", rarity: 2, mag: K.WEAPONS.shotgun.mag };
    inv.slots[3] = { kind: "weapon", id: "sniper", rarity: 3, mag: K.WEAPONS.sniper.mag };
    inv.slots[4] = { kind: "weapon", id: "glauncher", rarity: 3, mag: K.WEAPONS.glauncher.mag };
    inv.ammo = { light: 999, medium: 999, shells: 999, heavy: 999, grenades: 999 };
  }
}

// The practice lobby advertised "RANGE TARGETS SOUTH, MOVEMENT COURSE EAST"
// and neither existed — the only match for that string in the whole runtime was
// the advertisement itself. This builds the range it promised: a row of dummies
// at real engagement distances, laid out south of wherever practice dropped you
// and sat on the terrain. They are deliberately NOT registered with W.match, so
// they cannot touch alive-count, placement or the victory check.
// Creation and placement are separate because models load BEFORE spawnAll runs:
// a dummy created after loadActorModels would have no rig, and one positioned
// before spawnAll would immediately be scattered by it.
export const RANGE_DISTANCES = [12, 22, 35, 55, 80];
export function createPracticeRange(W) {
  W.rangeDummies = RANGE_DISTANCES.map((d, i) => {
    const a = createActor(W, { id: "dummy" + i, name: d + "m", isBot: true });
    a.isDummy = true;
    a.netRemote = true;          // never brain-driven, never net-authoritative
    return a;
  });
  return W.rangeDummies;
}
export function placePracticeRange(W) {
  const p = W.player;
  if (!p || !W.rangeDummies) return;
  W.rangeDummies.forEach((a, i) => {
    const x = W.SIM.clamp(p.pos.x + (i - 2) * 3.5, -W.map.half + 10, W.map.half - 10);
    const z = W.SIM.clamp(p.pos.z - RANGE_DISTANCES[i], -W.map.half + 10, W.map.half - 10);
    a.pos.set(x, W.map.heightAt(x, z) + 0.1, z);
    a.yaw = Math.PI;             // face the shooter
    a.gliding = false;
    a.vel.set(0, 0, 0);
    a.obj.position.copy(a.pos);
    a.obj.rotation.y = a.yaw;
  });
}

// Move the human's glide start over a chosen landing zone (the drop-select
// screen). Bots already get this in bots.assignDrops — the player was the only
// actor on the field still falling on a random point. Altitude is untouched, so
// there is still a full glide to steer.
export function setDropTarget(W, t) {
  const a = W.player;
  if (!a || !t) return;
  const lim = W.map.half - 12;
  a.pos.x = W.SIM.clamp(t.x, -lim, lim);
  a.pos.z = W.SIM.clamp(t.z, -lim, lim);
  a.obj.position.copy(a.pos);
  W.dropTarget = { x: a.pos.x, z: a.pos.z, name: t.name || "" };
}

// ── human input ──────────────────────────────────────────────────────────────
function installHumanInput(W) {
  const dom = W.kernel.renderer.domElement;
  const keys = {};
  const bind = () => (W.settings.keys || {});

  // Keybind remap: settings.remap maps a custom physical key → the canonical
  // default code, so all logic below stays written against the defaults.
  // ShiftRight aliases ShiftLeft THROUGH the table, not around it: the sprint
  // toggle and the held-sprint read both used to test the raw "ShiftRight" code,
  // so right shift was a second, invisible sprint key that survived rebinding
  // AND "reset to defaults" (nothing in remap ever referred to it) — the same
  // duplicate-bind class the M/Q fix closed. Routing it through rm.ShiftLeft
  // means UNBOUND and RESET govern it like every other key, while an explicit
  // binding captured ON ShiftRight still wins.
  const canon = (c) => {
    const rm = W.settings.remap || {};
    if (rm[c]) return rm[c];
    return c === "ShiftRight" ? (rm.ShiftLeft || "ShiftLeft") : c;
  };
  window.addEventListener("keydown", (ev) => {
    if (ev.target && (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA")) return;
    if (W.captureKey) { W.captureKey(ev.code); ev.preventDefault(); return; }
    // `repeat` has to be copied across: the SPACE edge-gate below reads e.repeat,
    // and on a synthetic object with only {code, preventDefault} that is
    // undefined, so `!e.repeat` was permanently true and the gate it documents
    // never once fired — holding SPACE still strobed the chute.
    const e = { code: canon(ev.code), repeat: ev.repeat, preventDefault: () => ev.preventDefault() };
    keys[e.code] = true;
    // ESC before the guard: W.player is null until the first match and phase is
    // "menu" after one, so the guard swallowed Escape on exactly the screen where
    // Settings / How To Play are opened — they could only be closed with their
    // own button. hud's escPressed handler closes the topmost modal first and
    // only reaches togglePause while phase is "match"/"drop", so this is inert
    // on the menu by design rather than by accident.
    if (e.code === "Escape") { W.events.emit("escPressed"); return; }
    if (!W.player || W.phase === "menu") return;
    const inp = W.player.input;
    if (e.code === "KeyR") inp.reload = true;
    if (e.code === "KeyE") { inp.interact = true; inp.interactDown = true; }
    if (e.code === "Space" && !e.repeat) { inp.jump = true; e.preventDefault(); } // edge-gate: key-repeat was strobing the chute (deploy/cut/deploy) + multi-firing swim strokes
    if (e.code === "Digit1") inp.slot = 0;
    if (e.code === "Digit2") inp.slot = 1;
    if (e.code === "Digit3") inp.slot = 2;
    if (e.code === "Digit4") inp.slot = 3;
    if (e.code === "Digit5") inp.slot = 4;
    // [Q] drop the active weapon (loot.js W.dropActive — refuses the last gun)
    if (e.code === "KeyQ" && !ev.repeat && W.player.alive && W.dropActive) W.dropActive(W.player);
    // [ENTER] squad chat — online rooms only (hud owns the input; the guard at
    // the top of this handler ignores game keys while the input has focus)
    if (e.code === "Enter" && !ev.repeat && W.net && W.chatOpen) { W.chatOpen(); return; }
    // While ADS, SHIFT is BREATH-HOLD (weapons.js sway block), not the sprint
    // latch — you can't sprint while aiming anyway, and without this gate a
    // scoped breath-hold silently armed a sprint you'd trigger on unscope.
    if (e.code === "ShiftLeft" && !ev.repeat && W.settings.sprintToggle &&
        !(W.player && W.player.input.ads)) W._sprintLatch = !W._sprintLatch;
    // Spectate cycling. On death you were pinned to your KILLER's camera with no
    // way to look at anyone else — including the friend still alive in your
    // room. A/D (or the arrows) now step through the survivors.
    if (!W.player.alive && (e.code === "KeyA" || e.code === "KeyD" || ev.code === "ArrowLeft" || ev.code === "ArrowRight")) {
      const alive = W.actors.filter((x) => x.alive && !x.isDummy);
      if (alive.length) {
        const dir = (e.code === "KeyD" || ev.code === "ArrowRight") ? 1 : -1;
        const cur = alive.findIndex((x) => x.id === W.player.spectating);
        const nxt = alive[(((cur < 0 ? 0 : cur + dir) % alive.length) + alive.length) % alive.length];
        W.player.spectating = nxt.id;
        W.events.emit("spectateChanged", nxt);
      }
      ev.preventDefault();
    }
    if (e.code === "KeyM") W.events.emit("toggleBigMap");
    if (e.code === "KeyB") inp.emote = "dance";
    if (e.code === "KeyN") inp.emote = "cheer";
  });
  window.addEventListener("keyup", (ev) => {
    const code = canon(ev.code);
    keys[code] = false;
    if (code === "KeyE" && W.player) W.player.input.interactDown = false;
  });

  // Mouse model — mouse-look is the PRIMARY control (owner: "moving the mouse
  // should let me look around, instead of right click and hold"):
  //   any click     = engage pointer lock → then moving the mouse looks around
  //   locked        = mouse-look; LMB shoot; RMB ADS
  //   unlocked      = cursor-follow aim fallback; RMB-drag to look (preview /
  //                   lock-denied only — real play locks on the first click)
  const tryLock = () => {
    if (document.pointerLockElement !== dom) {
      try { const p = dom.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) {}
    }
  };
  let rmbDrag = false;
  dom.addEventListener("mousedown", (e) => {
    if (!W.player || W.phase === "menu" || W.paused) return;
    // Whether the mouse was ALREADY captured decides what this click means. Any
    // click re-acquires pointer lock, and the trigger used to be armed on the
    // same event — so the click you use to resume after ESC, after a settings
    // panel, or after the browser drops the lock also fired your weapon. That is
    // a wasted round and a position giveaway every single time you tab back in.
    // Swallow the LEFT button on the acquiring click only; button 2 is left
    // alone so the RMB-drag look fallback still works when lock is denied.
    // This used to swallow the shot whenever pointer lock was not ALREADY held:
    //     const wasLocked = document.pointerLockElement === dom;
    //     tryLock(); if (e.button === 0 && !wasLocked) return;
    // requestPointerLock is ASYNC, so pointerLockElement is still null on the
    // click that requests it — and on any click after the browser silently drops
    // the lock (tab-out, focus loss, the user never granting it at all). The
    // early return happens BEFORE _lmbDown / _fireEdge / input.fire are set, so
    // those clicks did nothing whatsoever: the reported "I couldn't shoot my
    // pistol" is exactly this, and it hit every weapon, not just the pistol.
    // Semi-autos just show it worse because each one is a discrete lost shot.
    // Now only a click following a DELIBERATE release (menu, map, end panel —
    // see releaseCursor in hud.js) is swallowed.
    tryLock();                     // ANY click grabs the mouse for looking
    if (e.button === 0 && W._suppressNextShot) { W._suppressNextShot = false; return; }
    if (e.button === 0) {
      W._lmbDown = true;
      W._fireEdge = performance.now();  // fresh click — semis consume it within the 300 ms buffer
      W.player.input.fire = true;   // never swallow the shot
    }
    if (e.button === 2) { W._rmbDown = true; W.player.input.ads = true; rmbDrag = document.pointerLockElement !== dom; }
  });
  window.addEventListener("mouseup", (e) => {
    // mouseup does NOT clear the fire edge any more (owner playtest: "pressing
    // mouse button doesn't actually fire ... it gets stuck") — a quick click
    // during a weapon's cooldown window (0.4 s ready delay after a swap, or
    // between semi shots) set the edge and erased it before the gun could
    // fire. The edge is a TIMESTAMP now; weapons.js honours it for 300 ms
    // (the standard input buffer) and consumes it on fire.
    if (e.button === 0) { W._lmbDown = false; }
    if (e.button === 2) { W._rmbDown = false; rmbDrag = false; }
    if (!W.player) return;
    if (e.button === 0) W.player.input.fire = false;
    if (e.button === 2) W.player.input.ads = false;
  });
  // safety: a mouseup outside the window would otherwise leave fire/ADS stuck
  // (stuck ADS = permanent 3.4 m/s — feels like the game is broken-slow)
  const clearButtons = () => { W._lmbDown = false; W._rmbDown = false; if (W.player) { W.player.input.fire = false; W.player.input.ads = false; } rmbDrag = false; };
  window.addEventListener("blur", clearButtons);
  document.addEventListener("mouseleave", clearButtons);
  dom.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("mousemove", (e) => {
    // ALWAYS track the cursor: without pointer lock the shot must land where
    // the visible mouse points, not at screen center (playtest: "I aim and my
    // pistol doesn't work")
    const rect = dom.getBoundingClientRect();
    W.mousePx = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    W.mouseNDC = {
      x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      y: -(((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1),
    };
    if (!W.player || W.paused || W.phase === "menu") return;
    const locked = document.pointerLockElement === dom;
    if (!locked && !rmbDrag) return;
    const sens = (W.player.input.ads ? W.settings.adsSensitivity : W.settings.sensitivity) * 0.0022;
    const mx2 = e.movementX || 0, my2 = e.movementY || 0;
    W.player.input.yaw -= mx2 * sens;
    W.player.input.pitch = K.clamp(W.player.input.pitch - my2 * sens, -1.35, 1.35);
  });
  window.addEventListener("wheel", (e) => {
    // scroll cycles weapon slots (standard shooter convention)
    if (!W.player || !W.player.alive || W.phase === "menu" || W.paused) return;
    const inv = W.player.inventory;
    const dir2 = e.deltaY > 0 ? 1 : -1;
    for (let step = 1; step <= 5; step++) {
      const idx = (inv.active + dir2 * step + 10) % 5;
      if (inv.slots[idx]) { W.player.input.slot = idx; break; }
    }
  });

  // continuous axes each frame — the human input struct is rebuilt EVERY
  // frame exclusively from live key/button state, so nothing (stale brain,
  // missed keyup, replayed event) can hold a phantom move or trigger
  W.kernel.onUpdate(() => {
    if (!W.player || !W.player.alive || W.phase === "menu" || W.paused) return;
    const inp = W.player.input;
    inp.mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    inp.mz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    const sprintHeld = !!keys.ShiftLeft;   // canon() folds ShiftRight into this
    // breath-hold reads the RAW key while aiming (weapons.js sway block)
    W._breathHeld = sprintHeld && !!inp.ads;
    // SHIFT toggles sprint on and off (owner direction). The latch drops when
    // you stop moving forward, so you never wander back into a fight still
    // sprinting from three minutes ago with no way to notice.
    if (W.settings.sprintToggle && W._sprintLatch && inp.mz <= 0.1) W._sprintLatch = false;
    inp.sprint = W.settings.sprintToggle ? !!W._sprintLatch : sprintHeld;
    // Crouch defaults to C, NOT Ctrl: this runs in a browser next to WASD, and
    // Ctrl+W closes the tab. Rebindable like any other action.
    inp.crouch = !!keys.KeyC;
    inp.fire = !!W._lmbDown;
    inp.ads = W.settings.adsToggle ? !!W._adsLatch : !!W._rmbDown;
  });
  // ADS toggle latch: flip on the RMB press edge (hold mode ignores it).
  // Same liveness guards as the main mousedown handler — without them a
  // right-click on the menu/pause/death screen armed the latch and you
  // spawned already toggled into ADS (sweep finding).
  dom.addEventListener("mousedown", (ev2) => {
    if (ev2.button === 2 && W.settings.adsToggle &&
        W.player && W.player.alive && W.phase !== "menu" && !W.paused) W._adsLatch = !W._adsLatch;
  });
  W.pointerLocked = () => document.pointerLockElement === dom;
  W.resetInputState = () => { for (const k in keys) keys[k] = false; W._lmbDown = false; W._rmbDown = false; W._sprintLatch = false; W._adsLatch = false; };
}

// ── movement + physics ──────────────────────────────────────────────────────
const STEP_UP = 0.55;
const tmpV = new THREE.Vector3();

/** highest walkable support under (x,z) at or below y+STEP_UP */
export function supportAt(W, x, z, y) {
  let s = W.map.heightAt(x, z);
  const cols = W.map.queryColliders(x, z, 0.6);
  for (const c of cols) {
    if (x < c.minX - 0.3 || x > c.maxX + 0.3 || z < c.minZ - 0.3 || z > c.maxZ + 0.3) continue;
    let top;
    if (c.kind === "ramp") {
      let f;
      if (c.dir === 0) f = (x - c.minX) / Math.max(0.01, c.maxX - c.minX);
      else if (c.dir === 1) f = (c.maxX - x) / Math.max(0.01, c.maxX - c.minX);
      else if (c.dir === 2) f = (z - c.minZ) / Math.max(0.01, c.maxZ - c.minZ);
      else f = (c.maxZ - z) / Math.max(0.01, c.maxZ - c.minZ);
      top = c.minY + (c.maxY - c.minY) * K.clamp(f, 0, 1);
    } else {
      top = c.maxY;
    }
    if (top <= y + STEP_UP && top > s) s = top;
  }
  return s;
}

function blockedHoriz(W, x, z, y, h) {
  // capsule side blocking vs boxes whose vertical span overlaps (feet+step, head)
  const r = K.PLAYERK.radius;
  const cols = W.map.queryColliders(x, z, r + 0.4);
  for (const c of cols) {
    if (c.kind === "ramp") continue;
    if (c.maxY <= y + STEP_UP || c.minY >= y + h) continue;
    const nx = K.clamp(x, c.minX, c.maxX), nz = K.clamp(z, c.minZ, c.maxZ);
    const dx = x - nx, dz = z - nz;
    if (dx * dx + dz * dz < r * r) return c;
  }
  return null;
}

export function update(W, dt) {
  // LOD is a VISIBILITY question, so it measures from the render viewpoint. It
  // used to measure from W.player.pos — which STOPS MOVING the moment you die
  // (killActor tweens obj.position, never pos), while the camera moves on to
  // whoever you are spectating. Any bot more than 250 m from your corpse then
  // had its mixer pinned at timeScale 0 AND was skipped by the whole
  // clip-selection block, so it slid across the ground in a frozen mid-stride
  // pose. On a 1600 m map that is the normal case, not the edge case — it is
  // why the spectated fighter appeared to have no run animation at all.
  // The weapon LOD a few lines below already keyed off the camera.
  const humanPos = (W.camera && W.camera.position) || (W.player ? W.player.pos : null);
  let anyDrop = false;
  for (const a of W.actors) {
    if (!a.alive) continue;
    if (a.netRemote) { interpRemote(W, a, dt); continue; }
    const far = a.isBot && humanPos && a.pos.distanceToSquared(humanPos) > 250 * 250;
    stepActor(W, a, dt, far);
    if (a.gliding) anyDrop = true;
  }
  if (W.phase === "drop" && !anyDrop) W.phase = "match";
  updateCamera(W, dt);

  // nametags: hide the camera-focus actor's own tag (it fills the screen when
  // spectating) and cull tags beyond readable range
  const camPos = W.camera.position;
  const wl = W.wpnLOD || 110, wl2 = wl * wl;
  for (const a of W.actors) {
    const d2 = a.pos.distanceToSquared(camPos);
    // GEOMETRY LOD for held weapons. Animation LOD already existed (syncObj
    // freezes mixers past 250 m) but the guns had none: every actor's weapon is
    // a full-detail model (5,943-6,169 tris) whether its holder is 3 m or 400 m
    // away, so the drop cluster paid ~300k triangles and ~50 extra meshes for
    // objects a few pixels across — in the heaviest frame of the match (measured
    // 1,010 draw calls / 4,456,503 tris / 17.77 ms). HIDDEN rather than swapped
    // for the composed box protos in weapons.js: those are 4-5 separate meshes
    // with their own materials, so a proxy would ADD draw calls to a frame that
    // is draw-call bound. The local player is ~4 m from the camera, so their own
    // weapon is always inside the radius.
    if (a.weaponMesh) a.weaponMesh.visible = d2 < wl2;
    if (!a.nameTag) continue;
    // Peers stay tagged out to 250 m — the game's own gunfire-audible radius
    // (hud.js: `if (d < 12 || d > 250) return;` on the direction chevrons), so a
    // friend you can HEAR is a friend you can find. Bots keep 70 m, otherwise
    // the horizon fills with 46 labels.
    const range = a.isBot ? 70 : 250;
    // Practice dummies' nametags ARE their distance labels ("12m".."80m"), so
    // they must show at their own range — the 55 m and 80 m markers sit past the
    // 70 m bot cull-squared and were invisible exactly where they teach the most.
    a.nameTag.visible = a.isDummy
      ? (a.alive && a !== W._camFocus)
      : (a.alive && a !== W._camFocus && d2 > 12 && d2 < range * range);
  }
}

function stepActor(W, a, dt, far) {
  const inp = a.input;
  a.yaw = inp.yaw; a.pitch = inp.pitch;

  // healing channel
  if (a.healing) {
    a.healing.tLeft -= dt;
    if (a.healing.tLeft <= 0) { applyHeal(W, a, a.healing.id); a.healing = null; }
  }

  // glide phase — real skydive: fast belly-down freefall with forward
  // momentum + steering, then an auto-deployed parachute for the final
  // stretch (Final Drop / Fortnite structure)
  if (a.gliding) {
    // landing surface = terrain OR any collider top (floating sky-islands,
    // roofs) — heightAt alone made parachuters fall straight through them
    const g = far ? W.map.heightAt(a.pos.x, a.pos.z) : supportAt(W, a.pos.x, a.pos.z, a.pos.y);
    const landY = Math.max(g, W.map.waterY);
    const agl = a.pos.y - landY;

    // SPACE TOGGLES the parachute — open it, cut it away, open it again, as
    // often as you like (Final Drop style). Failsafe: auto-deploy at 60m the
    // first time; once the player has toggled manually only the 22m hard
    // floor forces it (so cutting away below 60m actually works).
    if (inp.jump) {
      if (a.chute) { removeChute(a); a.chuteToggled = true; W.events.emit("chuteCut", a); }
      else if (agl > 14) { deployChute(W, a); a.chuteToggled = true; }
      inp.jump = false;
    }
    // deploy the canopy high (110m) the first time so most of the descent is a
    // gliding UMBRELLA (Final Drop feel), not a long freefall then a short chute.
    if (!a.chute && agl < (a.chuteToggled ? 22 : 110)) deployChute(W, a);

    const chuted = !!a.chute;
    const speed = chuted ? 8.5 : 15;                        // canopy glides, freefall carries
    const fallTarget = chuted ? -5.5 : (inp.sprint ? -34 : -20);
    const B = K.moveBasis(a.yaw);
    const dirX = B.fx, dirZ = B.fz;
    const fwd = K.clamp(inp.mz, -0.3, 1);
    // the umbrella glides forward gently even with no input (glide ratio), so it
    // reads as gliding not dropping. Kept SMALL (0.15x) so an AFK player drifts
    // only a little — the old 0.35x forced drift pushed them ~100m into the sea.
    const glideF = chuted ? Math.max(0.15, Math.max(0, fwd)) : Math.max(0, fwd);
    // strafe uses the SAME basis as forward — it previously used (cos, +sin)
    // against a (cos, -sin) ground basis, so A/D steered wrong off-axis
    const txv = dirX * speed * glideF + B.rx * speed * 0.5 * inp.mx;
    const tzv = dirZ * speed * glideF + B.rz * speed * 0.5 * inp.mx;
    a.vel.x += (txv - a.vel.x) * Math.min(1, dt * 2.2);      // air has inertia
    a.vel.z += (tzv - a.vel.z) * Math.min(1, dt * 2.2);
    a.vel.y += (fallTarget - a.vel.y) * Math.min(1, dt * (chuted ? 3 : 1.4));
    a.pos.addScaledVector(a.vel, dt);

    if (a.pos.y <= landY + 1.0) {
      a.pos.y = landY + 0.05; a.gliding = false; a.vel.set(0, 0, 0); a.onGround = true;
      removeChute(a);
      a.chuteToggled = false;
      W.events.emit("landed", a);
    }
    clampToMap(W, a);
    syncObj(W, a, dt, far);
    return;
  }

  // EMOTES: dance/cheer on the spot (B / N). Starts only grounded + safe;
  // any human input cancels; bots ride the timer (or cancel when shot).
  if (inp.emote) {
    if (a.onGround && !a.swimming && !a.emoting && (a.clips.dance || a.clips.cheer)) {
      a.emoting = { t: 4.2 };
      if (a.hand) a.hand.visible = false; // holster while emoting
      playAnim(a, a.clips[inp.emote] ? inp.emote : "cheer", { once: true, force: true });
      W.events.emit("emote", a, inp.emote);
    }
    inp.emote = null;
  }
  if (a.emoting) {
    a.emoting.t -= dt;
    const humanCancel = !a.isBot && (Math.abs(inp.mx) + Math.abs(inp.mz) > 0 || inp.fire || inp.jump);
    const shotCancel = W.t - a.lastDamageT < 0.3;
    if (a.emoting.t <= 0 || humanCancel || shotCancel) {
      a.emoting = null; a.anim = null;
      if (a.hand) a.hand.visible = true;
      playAnim(a, "idle", { force: true });
    } else {
      a.vel.x *= 0.75; a.vel.z *= 0.75;
      a.vel.y += K.MOVE.gravity * dt;
      a.pos.y += a.vel.y * dt;
      const supE = far ? W.map.heightAt(a.pos.x, a.pos.z) : supportAt(W, a.pos.x, a.pos.z, a.pos.y);
      if (a.pos.y <= supE + 0.02) { a.pos.y = supE; a.vel.y = 0; }
      a.obj.position.copy(a.pos);
      return;
    }
  }

  // ── MANTLE — modal, like emoting: a short scripted up-and-over ───────────
  // (trigger lives in the airborne integrate below). Vertical-first arc:
  // rise through the first 60% of the window, translate through the last —
  // a straight lerp clips the capsule's chest through the ledge lip.
  if (a.mantleT != null) {
    a.mantleT -= dt;
    const mk = 1 - Math.max(0, a.mantleT) / 0.45;
    const up = Math.min(1, mk / 0.6), fwd = Math.max(0, (mk - 0.4) / 0.6);
    const su = up * up * (3 - 2 * up), sf = fwd * fwd * (3 - 2 * fwd);
    a.pos.y = a._mFrom.y + (a._mTo.y - a._mFrom.y) * su;
    a.pos.x = a._mFrom.x + (a._mTo.x - a._mFrom.x) * sf;
    a.pos.z = a._mFrom.z + (a._mTo.z - a._mFrom.z) * sf;
    a.vel.set(0, 0, 0);
    if (a.mantleT <= 0) { a.mantleT = null; a.onGround = true; }
    a.obj.position.copy(a.pos);
    return;
  }

  // LAUNCH PORTALS: walk into a ring → flung back into the atmosphere, canopy
  // auto-opens on the way down (Final Drop-style island escape / rotation)
  if (!far && W.map.portals && !a._portalBoost && W.t - (a._portalT || 0) > 2.5) {
    for (const pt of W.map.portals) {
      const pdx = a.pos.x - pt.x, pdz = a.pos.z - pt.z, pdy = a.pos.y - pt.y;
      if (pdx * pdx + pdz * pdz < 1.7 * 1.7 && pdy > -1 && pdy < 3.4) {
        a._portalT = W.t;
        a._portalBoost = true;
        a.onGround = false;
        removeChute(a);
        a.vel.set(a.vel.x * 0.4, 42, a.vel.z * 0.4);
        a.pos.y += 0.6;
        W.events.emit("portalLaunch", a, pt);
        break;
      }
    }
  }
  // portal ascent: ballistic climb at half gravity (~80m), then hand over to
  // the skydive — canopy failsafe auto-opens at 60m on the way down
  if (a._portalBoost) {
    a.vel.y += K.MOVE.gravity * 0.55 * dt;
    a.pos.addScaledVector(a.vel, dt);
    if (a.vel.y <= 2) {
      a._portalBoost = false;
      a.gliding = true;
      a.chuteToggled = false;
    }
    clampToMap(W, a);
    syncObj(W, a, dt, far);
    return;
  }

  // water/swim state: deep water = terrain far enough below the surface
  const wy = W.map.waterY;
  const terrH = W.map.heightAt(a.pos.x, a.pos.z);
  const deepWater = terrH < wy - K.PLAYERK.swimDepth;
  const wasSwimming = a.swimming;
  a.swimming = deepWater && a.pos.y <= wy + 0.3;
  a.inWater = a.pos.y < wy + 0.25 && terrH < wy;
  if (a.swimming !== wasSwimming) W.events.emit("swimState", a, a.swimming);

  // desired horizontal velocity (local axes → world by yaw)
  // crouch: ground-only, and sprinting always wins (you stand up to run)
  a.crouching = !!inp.crouch && a.onGround && !a.swimming && !a.gliding && !(inp.sprint && inp.mz > 0.5);
  // Using a heal LOCKS OUT SPRINT for the whole channel (owner direction): you
  // may keep moving and reposition behind cover, you just cannot run while you
  // drink. Sprint is gated here rather than by clearing inp.sprint, so the
  // sprint TOGGLE latch survives the heal — you are not silently un-toggled and
  // left walking once the medkit finishes.
  // ADS hold-time: the sniper's scope (camera + overlay + accuracy bonus) gates
  // on this rather than snapping on the first RMB frame. Accrued here so bots
  // pay the same scope-in the player does.
  a._adsT = inp.ads ? (a._adsT || 0) + dt : 0;
  const healingNow = !!a.healing;
  // ── sprint ────────────────────────────────────────────────────────────────
  // INFINITE — the stamina meter (added 07-22) was removed by owner direction
  // 2026-07-28: no drain, no exhaust lock, no bar. !inp.ads: you can't sprint
  // while aiming (speed picks the ADS cap below).
  const wantsSprint = inp.sprint && inp.mz > 0.5 && !inp.ads && !(healingNow && K.HEAL.blocksSprint);
  const sprinting = wantsSprint;
  const spd = a.swimming
    ? (sprinting ? K.MOVE.swimSprint : K.MOVE.swim)
    : inp.ads ? K.MOVE.ads : (sprinting && !a.inWater) ? K.MOVE.sprint : K.MOVE.walk;
  let wspd = (a.inWater && !a.swimming) ? spd * 0.55 : spd;   // wading is slow
  if (a.crouching) wspd *= K.CROUCH.speedMult;
  if (healingNow) wspd *= K.HEAL.speedMult;                   // heals cost tempo
  const GB = K.moveBasis(a.yaw);
  const dx = GB.rx * inp.mx + GB.fx * inp.mz, dz = GB.rz * inp.mx + GB.fz * inp.mz;
  const dl = Math.hypot(dx, dz) || 1;
  const tx = (dx / dl) * wspd * (Math.abs(inp.mx) + Math.abs(inp.mz) > 0 ? 1 : 0);
  const tz = (dz / dl) * wspd * (Math.abs(inp.mx) + Math.abs(inp.mz) > 0 ? 1 : 0);
  const k = (a.onGround || a.swimming) ? Math.min(1, dt / K.MOVE.accelT) : K.MOVE.airControl * Math.min(1, dt / K.MOVE.accelT);
  a.vel.x += (tx - a.vel.x) * k;
  a.vel.z += (tz - a.vel.z) * k;

  a.sprinting = sprinting;   // heal-gated, so the run anim + FOV kick match the real speed

  if (a.swimming) {
    // buoyancy: settle chest-deep at the surface with a gentle bob; jump = stroke hop
    const targetY = wy - 0.55 + Math.sin(W.t * 2.2 + a.pos.x) * 0.06;
    a.vel.y = 0;
    a.pos.y += (targetY - a.pos.y) * Math.min(1, dt * 6);
    if (inp.jump) { a.vel.x *= 1.6; a.vel.z *= 1.6; W.events.emit("swimStroke", a); }
    inp.jump = false;
    a.onGround = false;
    // Swimming ignored collision entirely: this branch integrated straight into
    // pos, so you swam THROUGH the shipwreck hull and through piers. Use the
    // same axis-separated test the ground branch uses. The +0.45 on the probe
    // height widens blockedHoriz's built-in step allowance for a swimmer, so a
    // low deck near the waterline is something you can haul out onto rather
    // than a wall you bounce off — while a hull still stops you dead.
    const swimH = K.PLAYERK.height, swimStep = a.pos.y + 0.45;
    let sx = a.pos.x + a.vel.x * dt;
    if (!blockedHoriz(W, sx, a.pos.z, swimStep, swimH)) a.pos.x = sx; else a.vel.x = 0;
    let sz = a.pos.z + a.vel.z * dt;
    if (!blockedHoriz(W, a.pos.x, sz, swimStep, swimH)) a.pos.z = sz; else a.vel.z = 0;
    // HAUL OUT. This branch pins pos.y to the water surface every single frame
    // and never consulted supportAt, so water was a ONE-WAY TRAPDOOR: every
    // pier, boat deck, shipwreck and stilt hut could be dropped onto from the
    // sky but never re-boarded on foot. Anything you swam to was a dead end.
    // Probe for a ledge and climb onto it. supportAt already returns the
    // structure top when one is within STEP_UP of the probe height, so passing
    // the swimmer's chest gives exactly "a surface I could pull myself onto";
    // requiring it to sit above the waterline keeps the SEABED from qualifying,
    // which would otherwise beach the swimmer in open water.
    const ledge = supportAt(W, a.pos.x, a.pos.z, a.pos.y + 0.9);
    if (ledge > wy - 0.25 && ledge <= a.pos.y + 0.9) {
      a.pos.y = ledge;
      a.onGround = true; a.swimming = false; a.inWater = false;
      a.vel.y = 0;
      W.events.emit("swimState", a, false);
    }
  } else {
    // jump — and SPACE in mid-air with enough height re-opens the parachute
    // (stepping off a sky island must be an escape, not a death sentence)
    if (inp.jump && a.onGround) { a.vel.y = K.MOVE.jumpV; a.onGround = false; W.events.emit("jump", a); }
    else if (inp.jump && !a.onGround) {
      const aglJ = a.pos.y - Math.max(supportAt(W, a.pos.x, a.pos.z, a.pos.y), W.map.waterY);
      if (aglJ > 12) { a.gliding = true; a.chuteToggled = true; deployChute(W, a); }
    }
    inp.jump = false;

    // gravity
    a.vel.y += K.MOVE.gravity * dt;

    // integrate — X then Z with wall blocking, then Y with support
    const h = K.PLAYERK.height;
    if (!far) {
      let hitWall = false;
      let nx = a.pos.x + a.vel.x * dt;
      if (!blockedHoriz(W, nx, a.pos.z, a.pos.y, h)) a.pos.x = nx; else { a.vel.x = 0; hitWall = true; }
      let nz = a.pos.z + a.vel.z * dt;
      if (!blockedHoriz(W, a.pos.x, nz, a.pos.y, h)) a.pos.z = nz; else { a.vel.z = 0; hitWall = true; }
      // MANTLE trigger (research: ironhold ships it; the movement scorecard
      // rated it the missing S-effort verb): airborne, pushing forward INTO a
      // wall, and a ledge top within hand reach — above the 0.55 auto-step,
      // below feet+2.35 (jump apex 1.38 + arm reach). Headroom probe: a
      // support queried from ledge+2.2 that comes back ABOVE the ledge means
      // a slab in the pull-up space; the capsule-fits check covers walls.
      // Humans only — the bot aim/nav model doesn't need it and brains would
      // trip it on every wall they rub.
      if (hitWall && !a.onGround && !a.isBot && !a.netRemote && !a.gliding &&
          !a.swimming && inp.mz > 0 && a.vel.y < 6) {
        const mfx = -Math.sin(a.yaw), mfz = -Math.cos(a.yaw);
        const max2 = a.pos.x + mfx * 0.75, maz2 = a.pos.z + mfz * 0.75;
        const ledge = supportAt(W, max2, maz2, a.pos.y + 2.35);
        if (ledge > a.pos.y + 0.6 && ledge <= a.pos.y + 2.35 &&
            supportAt(W, max2, maz2, ledge + 2.2) <= ledge + 0.01 &&
            !blockedHoriz(W, max2, maz2, ledge + 0.1, h)) {
          a.mantleT = 0.45;
          a._mFrom = a._mFrom || new THREE.Vector3(); a._mFrom.copy(a.pos);
          a._mTo = a._mTo || new THREE.Vector3(); a._mTo.set(max2, ledge + 0.03, maz2);
          W.events.emit("mantle", a);
        }
      }
    } else {
      // far bots: cheap move, terrain only
      a.pos.x += a.vel.x * dt; a.pos.z += a.vel.z * dt;
    }
    a.pos.y += a.vel.y * dt;

    const sup = far ? W.map.heightAt(a.pos.x, a.pos.z) : supportAt(W, a.pos.x, a.pos.z, a.pos.y);
    // in deep water the "support" is the swim surface, not the seabed
    if (deepWater && a.pos.y <= wy + 0.05) {
      a.pos.y = wy - 0.55;   // enter swim next frame
    } else if (a.pos.y <= sup + 0.02) {
      // "landed" is emitted ONLY from the glide branch (the parachute touchdown),
      // so it fires once per actor per match and never for a jump — which left
      // fx.js's dust burst and audio.js's landing thump wired to a once-a-match
      // event while the second-most-used movement verb in the game landed in
      // total silence with nothing on screen. hardLand only covers vy < -16,
      // and a normal jump touches down around -8. Emit the ordinary case too.
      const impactV = -a.vel.y;
      if (impactV > 16) W.events.emit("hardLand", a, impactV);
      else if (impactV > 2.5) W.events.emit("touchdown", a, impactV);
      a.pos.y = sup; a.vel.y = 0; a.onGround = true;
    } else if (a.pos.y - sup > 0.1) {
      a.onGround = false;
    }
  }

  // footsteps: stride-distance accumulator → audible steps (walk ~2.4m,
  // sprint ~3.2m stride) — audio + the sound-visualization indicators
  if (!far && a.onGround && !a.swimming) {
    const sp2 = Math.hypot(a.vel.x, a.vel.z);
    if (sp2 > 1.5) {
      a._stepAcc = (a._stepAcc || 0) + sp2 * dt;
      const stride = a.sprinting ? 3.2 : 2.4;
      if (a._stepAcc >= stride) { a._stepAcc = 0; W.events.emit("footstep", a); }
    } else a._stepAcc = 0;
  }

  clampToMap(W, a);
  syncObj(W, a, dt, far);
}

function clampToMap(W, a) {
  const H = W.map.half;
  a.pos.x = K.clamp(a.pos.x, -H, H);
  a.pos.z = K.clamp(a.pos.z, -H, H);
}

// ── parachute (composed: canopy dome + rim lines + pack) ────────────────────
const CHUTE_COLORS = [0xe0685a, 0x57b0ff, 0xf2c14e, 0x7fb069, 0xb05cf0, 0x22d3a0];
function deployChute(W, a) {
  const grp = new THREE.Group();
  // The drop is the first ~30 s of every match and it is played in third person
  // with the camera pulled back to 10 m, so the canopy is the most-looked-at
  // surface in the game — worth owning. The locker writes a swatch INDEX into
  // settings.chuteColor (same shape as settings.crossColor); CHUTE_COLORS here
  // is the palette that row indexes into, so its ORDER is load-bearing. An index
  // the array does not have falls back to the hash rather than throwing.
  // Guarded on `a === W.player` and not `!a.isBot`, so netRemote humans keep
  // their own id-hashed canopy instead of all wearing the local player's pick.
  const own = a === W.player && W.settings ? W.settings.chuteColor : null;
  const color = (own != null && CHUTE_COLORS[own | 0] != null)
    ? CHUTE_COLORS[own | 0]
    : CHUTE_COLORS[Math.abs(hashCode(a.id)) % CHUTE_COLORS.length];
  // dome: top half-sphere squashed
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.7, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.85 })
  );
  dome.scale.y = 0.6;
  dome.position.y = 3.6;
  grp.add(dome);
  // alternating gores read as a real canopy
  const stripes = new THREE.Mesh(
    new THREE.SphereGeometry(1.72, 12, 6, 0, Math.PI / 4, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.85 })
  );
  stripes.scale.y = 0.6;
  stripes.position.y = 3.6;
  grp.add(stripes);
  const stripes2 = stripes.clone();
  stripes2.rotation.y = Math.PI;
  grp.add(stripes2);
  // suspension lines: rim → shoulders
  const lineMat = new THREE.LineBasicMaterial({ color: 0x444444 });
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(ang) * 1.55, 3.65, Math.sin(ang) * 1.55));
    pts.push(new THREE.Vector3(Math.cos(ang) * 0.25, 1.55, Math.sin(ang) * 0.18));
  }
  grp.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
  a.obj.add(grp);
  a.chute = grp;
  W.events.emit("chuteDeployed", a);
}
function removeChute(a) {
  if (a.chute) { if (a.chute.parent) a.chute.parent.remove(a.chute); a.chute = null; }
}
function hashCode(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

function syncObj(W, a, dt, far) {
  a.obj.position.copy(a.pos);
  // BODY FACING: outside combat the body turns toward where it's RUNNING
  // (pure camera-facing made strafing look like "running sideways"); while
  // aiming/shooting it squares up to the camera aim.
  let wantYaw = a.yaw + Math.PI;
  const spd2 = Math.hypot(a.vel.x, a.vel.z);
  const combat = a.input.ads || (W.t - a.lastShotT < 1.5);
  if (!a.gliding && !a.swimming && !combat && spd2 > 1.2) {
    wantYaw = Math.atan2(-a.vel.x, -a.vel.z) + Math.PI;
  }
  if (a._bodyYaw == null) a._bodyYaw = wantYaw;
  let dy = wantYaw - a._bodyYaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  a._bodyYaw += dy * Math.min(1, dt * 10);
  a.obj.rotation.y = a._bodyYaw;
  // body pose: freefall = belly-down skydive with banking; canopy = upright
  // with a gentle pendulum sway; everything else level
  let wantTiltX = 0, wantTiltZ = 0;
  if (a.gliding && !a.chute) {
    // NEGATIVE X pitches the model face-down (positive tipped it onto its
    // back — playtest report: "falling backwards")
    wantTiltX = a.input.sprint ? -1.15 : -1.35;
    wantTiltZ = a.input.mx * 0.45;                           // bank into turns
  } else if (a.gliding && a.chute) {
    wantTiltX = 0.12 + Math.sin(W.t * 1.7) * 0.06;           // sway under canopy
    wantTiltZ = -a.input.mx * 0.18 + Math.cos(W.t * 1.3) * 0.04;
  }
  a._tiltX = (a._tiltX || 0) + (wantTiltX - (a._tiltX || 0)) * Math.min(1, dt * 4);
  a._tiltZ = (a._tiltZ || 0) + (wantTiltZ - (a._tiltZ || 0)) * Math.min(1, dt * 4);
  a.obj.rotation.x = a._tiltX;
  a.obj.rotation.z = a._tiltZ;
  if (a.chute) a.chute.rotation.x = -a._tiltX;               // canopy stays upright
  // animation LOD: far actors freeze mixers
  if (a.rig) {
    a.rig.mixer.timeScale = far ? 0 : 1;
    // `!a.emoting` guards the CLIP chain only (the LOD line above still runs):
    // the local path returns inside stepActor's emote branch before it ever gets
    // here, but interpRemote calls syncObj unconditionally — so a peer's relayed
    // wave was overwritten by idle/walk on the very next frame and the whole
    // remote-emote relay was dead on arrival.
    if (!far && !a.emoting) {
      const gs = Math.hypot(a.vel.x, a.vel.z);
      // decays HERE, not inside its clip branch — a victim that leaves the
      // ground (bot jump-dodge) the instant it is shot must not bank the
      // flinch and play it stale half a second later on landing
      if (a.hitReactT > 0) a.hitReactT -= dt;
      // freefall: Mixamo falling-idle when present; else frozen run + skydive pose
      const fam = gunFamily(a);
      const useMixamoGun = !!(fam && a.clips[fam + "_idle"]);
      if (a.gliding && !a.chute) {
        if (a.clips.fall) playAnim(a, "fall", { timeScale: 1 });
        else playAnim(a, "run", { timeScale: 0.05 });
      }
      else if (a.gliding) playAnim(a, "idle");
      else if (a.swimming) playAnim(a, "swim", { timeScale: gs > 4.5 ? 1.25 : 1 });
      else if (a.mantleT != null && a.clips.crouch) {
        playAnim(a, "crouch", { timeScale: 0 });
      }
      else if (!a.onGround) playAnim(a, "jump", { once: true, startAt: JUMP_TAKEOFF_S });
      else if (a.hitReactT > 0 && a.clips.hit) {
        playAnim(a, "hit", { once: true });
      }
      else if (useMixamoGun && a.weapon && a.weapon.state === "reloading" && a.clips.rifle_reload) {
        playAnim(a, "rifle_reload", { once: true });
      }
      else if (useMixamoGun && a.crouching && fam === "rifle" && a.clips.rifle_crouch) {
        playAnim(a, "rifle_crouch", { timeScale: gs > 0.7 ? K.clamp(gs / 2.7, 0.55, 1.4) : 0 });
      }
      else if (a.crouching && a.clips.crouch && !(useMixamoGun && fam === "rifle" && a.clips.rifle_crouch)) {
        playAnim(a, "crouch", { timeScale: gs > 0.7 ? K.clamp(gs / 2.7, 0.55, 1.4) : 0 });
      }
      else if (useMixamoGun && gs > 0.7) {
        const back = (a.vel.x * -Math.sin(a._bodyYaw - Math.PI) + a.vel.z * -Math.cos(a._bodyYaw - Math.PI)) < -0.5;
        const dirK = back ? -0.9 : 1;
        const runKey = fam + "_run";
        const walkKey = fam + "_walk";
        if ((a.sprinting && gs > 5.5 && !back) || (gs > 4.4 && !back)) {
          if (a.clips[runKey]) playAnim(a, runKey, { timeScale: K.clamp(gs / 6.5, 0.85, 1.5) });
          else playAnim(a, "run", { timeScale: K.clamp(gs / 6.5, 0.9, 1.5) });
        } else if (a.clips[walkKey]) {
          playAnim(a, walkKey, { timeScale: dirK * K.clamp(gs / 3.0, 0.85, 2.0) });
        } else {
          playAnim(a, "walk", { timeScale: dirK * K.clamp(gs / 3.0, 0.85, 2.0) });
        }
      }
      else if (useMixamoGun) {
        playAnim(a, fam + "_idle");
      }
      else if (gs > 0.7) {
        const back = (a.vel.x * -Math.sin(a._bodyYaw - Math.PI) + a.vel.z * -Math.cos(a._bodyYaw - Math.PI)) < -0.5;
        const dirK = back ? -0.9 : 1;
        if (a.sprinting && gs > 5.5 && !back) {
          playAnim(a, "run", { timeScale: K.clamp(gs / 6.5, 0.9, 1.5) });
        } else if (gs > 4.4 && !back) {
          playAnim(a, "run", { timeScale: K.clamp(gs / 8.0, 0.7, 1.1) });
        } else {
          playAnim(a, "walk", { timeScale: dirK * K.clamp(gs / 3.0, 0.85, 2.0) });
        }
      }
      else { playAnim(a, "idle"); }

      // ── ARM-POSE LAYER (pose.js) ──────────────────────────────────────────
      // Skip when Mixamo gun/fall clips already own the arms (better than the
      // old Meshy retargets that folded over the face). Gun SOCKET + barrel aim
      // still run below so the mesh aligns to the hand.
      let mode = null;
      const armed = a.weapon && !a.weapon.id.startsWith("consumable");
      const mixamoOwnsArms = useMixamoGun || (a.gliding && !a.chute && a.clips.fall);
      if (!a.alive || a.emoting || mixamoOwnsArms) mode = null;
      else if (a.gliding && !a.chute) mode = "skydive";
      else if (a.gliding) mode = "hang";
      else if (a.swimming) mode = null;
      else if (armed && a.weapon.state === "reloading") mode = "reload";
      else if (armed && !combat) mode = "lowReady";
      else if (armed) mode = "gunReady";
      else mode = "relax";
      // straighten a slouched rig BEFORE the arm layer (arms hang off the
      // spine, so upright must happen first) — skip mid-air/emote where the
      // clip owns the whole body
      if (a.torsoFix && !a.gliding && !a.emoting) uprightTorso(a.obj, a.armBones, 1);
      const wantW = mode ? 1 : 0;
      a._armW = (a._armW == null ? wantW : a._armW + (wantW - a._armW) * Math.min(1, dt * 8));
      if (mode) a._armMode = mode;
      // input.pitch > 0 = looking UP (verified: mouse-up → +pitch; aimDir/camera use sin(pitch));
      // tiltDir(+) raises the muzzle, so pass pitch un-negated or the gun tilts the wrong way
      if (a._armW > 0.02 && a._armMode) applyArmPose(a.obj, a.armBones, a._armMode, a._armW, a.pitch);
      // ── BARREL AIM ────────────────────────────────────────────────────────
      // HAND_AIM_ROT is a STATIC local rotation grid-searched against ONE frame
      // of the idle clip. But applyArmPose aims the arm CHAIN (rArm->rFore,
      // rFore->rHand) and never sets the hand bone's own rotation — so the hand
      // bone's world orientation is whatever the current clip keyed it to, and a
      // fixed local offset cannot hold the barrel forward across clips. Measured
      // before this: mean 32.7 deg of barrel error, and SOLDIER — the default
      // player skin — 49.9 deg off.
      //
      // A previous attempt at per-frame aiming was reverted as "fragile and
      // unverifiable". The fragility was reading a STALE hand matrix: the mixer
      // advances between syncObj and any later evaluation. updateWorldMatrix on
      // the bone immediately before sampling is what makes this sound, and the
      // result is verified by screenshot, not by a cross-frame numeric probe.
      //
      // Only while a gun is actually up: emotes, death, swim and the glide poses
      // must keep the clip's own arms. Mixamo pistol/rifle clips also need the
      // socket aimed — arms come from the clip, barrel from this weld.
      const poseAim = (a._armMode === "gunReady" || a._armMode === "reload" || a._armMode === "lowReady") && a._armW > 0.5;
      const mixamoAim = useMixamoGun && armed && !a.gliding && !a.swimming && a.onGround;
      if (a.hand && a.handBone && !a.emoting && (poseAim || mixamoAim)) {
        a.handBone.updateWorldMatrix(true, false);          // fresh, not stale
        a.handBone.getWorldQuaternion(_gq);
        // lowReady carries the muzzle DOWN at ~32 deg instead of tracking aim
        // pitch — and, critically, extending barrel-aim to this mode kills the
        // out-of-combat backward hold (owner playtest: "rifle still held
        // backward"): the static HAND_AIM_ROT this mode used to fall back to
        // was calibrated on one clip frame and pointed some skins' guns at
        // their own chest.
        // Mixamo armed: always track pitch (clips already hold the weapon up).
        const bpitch = (!mixamoAim && a._armMode === "lowReady") ? -0.55 : a.pitch;
        const cp = Math.cos(bpitch), sp = Math.sin(bpitch);
        _gf.set(-Math.sin(a.yaw) * cp, sp, -Math.cos(a.yaw) * cp).normalize();
        // explicit basis (not setFromUnitVectors) so the gun cannot roll: +Z is
        // the barrel, +Y stays world-up-ish, +X is right.
        _gr.crossVectors(_gUp, _gf);
        if (_gr.lengthSq() < 1e-6) _gr.set(1, 0, 0); else _gr.normalize();
        _gu.crossVectors(_gf, _gr).normalize();
        _gm.makeBasis(_gr, _gu, _gf);
        _gd.setFromRotationMatrix(_gm);
        // local = inverse(parent world) * desired world; parent IS the hand bone
        a.hand.quaternion.copy(_gq.invert()).multiply(_gd);
      }
      // ── SUPPORT HAND — two-bone IK onto the foregrip ─────────────────────
      // History, so nobody hunts ghosts: this call spent weeks disabled under
      // the theory that "something later in the frame re-poses the arm". Wrong.
      // The kernel order is mixers -> updaters -> render, nothing runs after
      // syncObj that touches bones. The real fault was twoBoneIK's elbow-bend
      // sign driving the elbow AWAY from the target by the intended magnitude
      // every call (live-measured 94.3 -> 116.8 -> 161.8 deg across passes);
      // the shoulder swing partially recovered, so standalone probes looked
      // convergent while per-frame solves oscillated. Fixed in pose.js.
      //
      // gunReady only: the reload pose owns the left arm (mag change), lowReady
      // carries relaxed, and swim/glide/emote clips own the whole body.
      if (a.hand && a.weaponMesh && a.armBones && a.armBones.lArm && !a.emoting &&
          a._armMode === "gunReady" && a._armW > 0.5 &&
          (!a.rig.mixer || a.rig.mixer.timeScale !== 0)) {
        // the wid stamp gate: equipSlot changes a.weapon.id synchronously but
        // the mesh swap is microtask-deferred, and bots equip BEFORE this
        // updater runs — without the stamp check the measure below read the
        // OUTGOING gun's geometry, applied the NEW class fraction, and cached
        // the wrong grip for the whole hold (adversarial review finding,
        // confirmed 2/2). Stamp mismatch -> skip, re-measure after the flush.
        if (a._gripFor !== a.weapon.id &&
            a.weaponMesh.userData.wid === a.weapon.id) {
          // foregrip point, HOLDER space, measured once per weapon swap: the
          // proto is normalized/centered with +Z the barrel, so the support
          // palm cups forward of center by a class fraction of the front half,
          // on the underside. Async proto: no geometry yet -> retry next frame.
          // matrixWorld refresh first — same stale-matrix trap validateAttachments
          // hit (a 0.62 m AR measured 0.01 m against a not-yet-baked holder).
          a.obj.updateMatrixWorld(true);
          _ikM.copy(a.hand.matrixWorld).invert();
          let zMax = 0, yMin = 0, found = false;
          a.weaponMesh.traverse((o) => {
            if (!(o.isMesh || o.isSkinnedMesh) || !o.geometry) return;
            if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
            const bb = o.geometry.boundingBox;
            _ikM2.copy(_ikM).multiply(o.matrixWorld);
            for (let ci = 0; ci < 8; ci++) {
              _fgS.set(ci & 1 ? bb.max.x : bb.min.x, ci & 2 ? bb.max.y : bb.min.y,
                       ci & 4 ? bb.max.z : bb.min.z).applyMatrix4(_ikM2);
              if (!found) { zMax = _fgS.z; yMin = _fgS.y; found = true; }
              else { zMax = Math.max(zMax, _fgS.z); yMin = Math.min(yMin, _fgS.y); }
            }
          });
          if (found) {
            const cls = (K.WEAPONS[a.weapon.id] || {}).cls;
            // pistol: support hand cups the firing hand at the grip, not the
            // muzzle; long guns grip the front half; pump/bolt sit further out
            const zF = cls === "pistol" ? 0.05 : cls === "shotgun" ? 0.55
                     : cls === "launcher" ? 0.3 : cls === "sniper" ? 0.5 : 0.45;
            a._gripLocal = new THREE.Vector3(0, yMin * 0.6, zMax * zF);
            a._gripFor = a.weapon.id;
          }
        }
        if (a._gripLocal && a._gripFor === a.weapon.id) {
          a.hand.updateWorldMatrix(true, false);
          _fgW.copy(a._gripLocal); a.hand.localToWorld(_fgW);
          // REACH-AWARE GRIP SLIDE: at full ADS the class foregrip can sit
          // beyond the support arm's envelope (measured: AR grip 0.83 m from
          // the left shoulder vs 0.65 m of arm) — solving anyway leaves a
          // fully extended arm floating short of the rail, the exact "AI
          // game" tell. Real shooters shorten the hold instead: slide the
          // grip back along the barrel toward the receiver until reachable.
          // Sphere(shoulder, 0.94*reach) ∩ barrel line, largest t in [0, gz].
          // getWorldPosition (not setFromMatrixPosition): it refreshes the
          // ancestor chain, and the LEFT arm is not covered by the hand-chain
          // update above — after this frame's spine-aim writes the left
          // shoulder's cached matrixWorld is stale by the aim delta.
          a.armBones.lArm.getWorldPosition(_fgA);
          a.armBones.lFore.getWorldPosition(_fgB);
          a.armBones.lHand.getWorldPosition(_fgC);
          const _reach = (_fgA.distanceTo(_fgB) + _fgB.distanceTo(_fgC)) * 0.94;
          if (_fgA.distanceTo(_fgW) > _reach) {
            _fgL.set(0, a._gripLocal.y, 0); a.hand.localToWorld(_fgL);   // receiver end
            _fgS.copy(_fgW).sub(_fgL);                                   // barrel run
            const gz2 = _fgS.lengthSq();
            _fgW.copy(_fgL).sub(_fgA);                                   // H - S
            const bq = 2 * _fgS.dot(_fgW), cq = _fgW.lengthSq() - _reach * _reach;
            const disc = bq * bq - 4 * gz2 * cq;
            // disc<=0: the barrel line never enters the reach sphere. Fall back
            // to the CLOSEST point on the segment (perpendicular foot -bq/2a),
            // NOT t=0 — the receiver end can itself sit beyond reach (the right
            // hand measured 1.04x the LEFT arm's extension on this rig), so
            // t=0 could pick the segment's FARTHEST point and discard a
            // solvable mid-gun grip (adversarial review finding, confirmed 2/2).
            let t = 0;
            if (gz2 > 1e-8) t = disc > 0
              ? K.clamp((-bq + Math.sqrt(disc)) / (2 * gz2), 0, 1)
              : K.clamp(-bq / (2 * gz2), 0, 1);
            _fgW.copy(_fgL).addScaledVector(_fgS, t);
          }
          // pole: elbow points down and out to the character's LEFT (left dir
          // for yaw = (-cos, 0, +sin)) — the bend real support stances produce.
          // Without it the bend plane is whatever the clip left, and the elbow
          // can read as jutting up/inward on some animation frames.
          _fgL.copy(_fgA);
          _fgL.x -= Math.cos(a.yaw) * 0.25; _fgL.y -= 0.45; _fgL.z += Math.sin(a.yaw) * 0.25;
          // blend follows the arm-pose weight so the hand eases on/off with the
          // gunReady transition instead of snapping
          twoBoneIK(a.armBones.lArm, a.armBones.lFore, a.armBones.lHand, _fgW,
                    K.clamp((a._armW - 0.5) * 2, 0, 1), _fgL);
        }
      }
    }
  }
}

function interpRemote(W, a, dt) {
  // network remote actors lerp toward their last snapshot (net.js sets a.netTarget)
  if (a.netTarget) {
    const px = a.pos.x, pz = a.pos.z;
    // Follow the SNAPSHOT rate rather than a hardcoded one: net.js drops the
    // broadcast rate when the room fills, and a fixed dt*10 converges in ~100 ms
    // and then sits still until the next packet, which reads as stutter at 6 Hz.
    const lk = W._netLerpK || 10;
    a.pos.lerp(a.netTarget.pos, Math.min(1, dt * lk));
    a.yaw += (a.netTarget.yaw - a.yaw) * Math.min(1, dt * lk);
    // net.js pack() sends {id,x,y,z,yw,hp,sh,gl,wp} — no velocity, no onGround.
    // So a remote actor kept createActor's `onGround: false` FOREVER and syncObj's
    // `!a.onGround` branch pinned every peer (and, on a guest, all 45 bots) in the
    // jump clip, with vel 0,0,0 also starving the walk/run selection. Derive both
    // from the interpolated motion instead of widening the protocol. The 12 m/s
    // clamp keeps a snapshot catch-up (a lerp toward a far-away target on the
    // first packet after a stall) from reading as a sprint.
    const inv = 1 / Math.max(dt, 1e-3);
    a.vel.set(K.clamp((a.pos.x - px) * inv, -12, 12), 0, K.clamp((a.pos.z - pz) * inv, -12, 12));
    a.onGround = !a.gliding && a.pos.y <= supportAt(W, a.pos.x, a.pos.z, a.pos.y) + 0.2;
    // syncObj branches on `a.chute` for the canopy pose and the upright body,
    // but a.chute is only ever created inside stepActor — which netRemote actors
    // skip. So a peer under canopy rendered in the belly-down freefall pose with
    // NO parachute mesh at all, for the whole ~25 s descent: the longest single
    // stretch of a match. net.js sends the canopy state as a.netChute; both
    // helpers are module-local, so consuming it here needs no new export.
    if (a.gliding && a.netChute && !a.chute) deployChute(W, a);
    else if ((!a.netChute || !a.gliding) && a.chute) removeChute(a);
    syncObj(W, a, dt, false);
  }
}

// ── camera ───────────────────────────────────────────────────────────────────
const camTarget = new THREE.Vector3(), camPos = new THREE.Vector3(), camDir = new THREE.Vector3();
// barrel-aim scratch (reused every actor, every frame — never allocate here)
const _gq = new THREE.Quaternion(), _gd = new THREE.Quaternion();
const _gf = new THREE.Vector3(), _gr = new THREE.Vector3(), _gu = new THREE.Vector3();
const _gUp = new THREE.Vector3(0, 1, 0), _gm = new THREE.Matrix4();
const _fgW = new THREE.Vector3();   // foregrip target, world space
const _fgL = new THREE.Vector3(), _fgS = new THREE.Vector3();
const _fgA = new THREE.Vector3(), _fgB = new THREE.Vector3(), _fgC = new THREE.Vector3();
const _ikM = new THREE.Matrix4(), _ikM2 = new THREE.Matrix4();
const _uwCol = new THREE.Color(), _uwDeep = new THREE.Color(0x0d4a63);   // underwater fog/bg target
// shake state lives here, not on W: shakeT drives coherent noise (see below) and
// _shakeOff is last frame's offset, which has to be undone before the lerp.
let shakeT = 0;
const _shakeOff = new THREE.Vector3();
function updateCamera(W, dt) {
  const cam = W.camera;
  let focus = W.player;
  if (!focus) return;
  if (!focus.alive && focus.spectating) {
    const t = W.actorById.get(focus.spectating);
    if (t && t.alive) focus = t;
    else {
      // spectated target died — follow their killer, else any survivor
      const next = (t && t.lastAttacker && W.actorById.get(t.lastAttacker)) || W.actors.find((x) => x.alive);
      if (next) { W.player.spectating = next.id; focus = next; }
    }
  }
  W._camFocus = focus;
  const ads = focus.input.ads && focus.weapon && K.WEAPONS[focus.weapon.id] && !K.WEAPONS[focus.weapon.id].harvest;
  const _wdef = K.WEAPONS[focus.weapon.id];
  const scope = ads && _wdef && _wdef.scope && (focus._adsT || 0) >= (_wdef.adsTimeS || 0);
  // FIRST-PERSON down the scope: your own body must not block the shot
  // (owner: "when sniping im in the way of the cursor and can see myself")
  const firstPerson = scope;
  // AR/non-scope ADS pulls in tight over the RIGHT shoulder so the body sits
  // left of the reticle instead of covering it
  // _winDist is the victory hold's slow pull-back (ffg_royale3d.js advances it
  // only while W._winHold), so it is 0 in every normal frame.
  const dist = (focus.gliding ? (focus.chute ? 10 : 9) : firstPerson ? 0.02 : ads ? 1.7 : 4.2) + (W._winDist || 0);
  const sh = firstPerson ? 0 : ads ? 0.95 : 0.7;
  // crouch dips the camera, but SMOOTHLY — snapping the eye 0.65m is nauseating
  const wantEye = focus.swimming ? 0.7 : K.actorEyeY(focus);
  focus._eyeY = focus._eyeY == null ? wantEye : focus._eyeY + (wantEye - focus._eyeY) * Math.min(1, dt * 12);
  const eye = focus.pos.y + focus._eyeY;
  camTarget.set(focus.pos.x, eye, focus.pos.z);
  // the victory hold ORBITS the camera around the winner (W._winOrbit is
  // advanced by the frame pipeline while phase is "over") — camTarget stays on
  // the actor, so the shot circles them rather than panning off them. It also
  // rotates the aim ray with the camera, which is harmless: hurtActor returns
  // immediately once W.phase === "over".
  const camYaw = focus.yaw + (W._winOrbit || 0);
  const sy = Math.sin(camYaw), cy = Math.cos(camYaw);
  // during freefall the camera tracks the dive (looks down at the island)
  const pitchBias = focus.gliding ? (focus.chute ? -0.18 : -0.62) : 0;
  const effPitch = K.clamp(focus.pitch + pitchBias, -1.35, 1.35);
  const sp = Math.sin(effPitch), cp = Math.cos(effPitch);
  camDir.set(sy * cp, -sp, cy * cp).multiplyScalar(-1); // forward
  // hide the player's own model in first-person so it never blocks the view
  if (focus.rig && focus.rig.scene) focus.rig.scene.visible = !firstPerson;
  // camera sits behind + slightly right (or AT the eye for first-person)
  camPos.copy(camTarget)
    .addScaledVector(camDir, -dist)
    .add(tmpV.set(cy, 0, -sy).multiplyScalar(sh));
  camPos.y += firstPerson ? 0.05 : 0.25;
  // Swim camera: the third-person rig lifted the eye to y ~0.37 over a y=0
  // surface, so you always floated ABOVE the water and it read as a blank
  // near-opaque sheet — "it wasn't really watching someone swim". Pull the
  // camera down onto the waterline so the surface cuts across the screen, and
  // looking down now dips it under (which arms the underwater treatment below).
  if (focus.swimming && !firstPerson) {
    const surf = W.map.water ? W.map.water.position.y : (W.map.waterY || 0);
    camPos.y = Math.min(camPos.y, surf + 0.12) + Math.max(0, focus.pitch) * -1.4;
  }
  // keep camera out of terrain/structures (skip in first-person — at the eye)
  if (!firstPerson) {
    const minY = W.map.heightAt(camPos.x, camPos.z) + 0.35;
    if (camPos.y < minY) camPos.y = minY;
  }
  // The shake used to be written straight into cam.position, which is ALSO the
  // source of next frame's lerp — so each frame's jitter fed back through the
  // smoothing and the effective amplitude depended on framerate twice over.
  // Undo last frame's offset before the lerp, then re-apply this frame's.
  cam.position.sub(_shakeOff);
  // `dt * 18` is a first-order lag: the camera settles a constant v/k behind the
  // player, which at the old 9.6 m/s sprint was 0.53 m of permanent trail — read
  // on screen as the camera "not keeping up". It also scaled with framerate, so
  // a dip made the trail worse exactly when the game already felt bad.
  // 1 - exp(-k*dt) is the same filter sampled correctly: identical response at
  // any dt, and k raised to 26 pulls the steady-state trail to ~0.31 m at the
  // new 8.0 m/s sprint. Snap outright if we are ever more than 4 m adrift
  // (teleport, respawn, spectate switch) so it never visibly reels itself in.
  const camK = firstPerson ? 1 : 1 - Math.exp(-26 * dt);
  if (!firstPerson && cam.position.distanceToSquared(camPos) > 16) cam.position.copy(camPos);
  else cam.position.lerp(camPos, Math.min(1, camK));
  shakeT += dt;
  _shakeOff.set(0, 0, 0);
  let roll = 0;
  if (W.camShake > 0.01) {
    // A fresh Math.random() per frame is 144 Hz buzz on a fast machine and a
    // visible stutter on a slow one — the same camShake value produced a
    // different sensation on different hardware. Two sine sums at incommensurate
    // frequencies are temporally coherent, cost nothing, and the ROLL term is
    // what actually sells the impact.
    const s = W.camShake * (W.settings.shake != null ? W.settings.shake : 1);
    const nx = Math.sin(shakeT * 41.3) * 0.6 + Math.sin(shakeT * 27.1) * 0.4;
    const ny = Math.sin(shakeT * 33.7 + 1.7) * 0.6 + Math.sin(shakeT * 19.9 + 0.6) * 0.4;
    _shakeOff.set(nx * s, ny * s * 0.6, 0);
    cam.position.add(_shakeOff);
    roll = nx * s * 0.11;
  }
  // ── underwater treatment ────────────────────────────────────────────────
  // updateCamera never once looked at waterY, so crossing the surface changed
  // nothing: no fog, no tint, the single-sided water plane just disappeared, and
  // you swam through a blank void. Detect submersion here (the camera position is
  // final) with hysteresis — the swim camTarget sits ~0.15 m over a surface that
  // bobs +/-0.12, so a bare `<` strobes the whole effect every few seconds.
  const wy = W.map.waterY;
  if (wy != null && wy > -900) {
    const surf = W.map.water ? W.map.water.position.y : wy;
    const was = !!W._underwater;
    W._underwater = was ? cam.position.y < surf + 0.06 : cam.position.y < surf - 0.06;
    // lerp a 0..1 amount so the waterline is a transition, not a pop
    const tgt = W._underwater ? 1 : 0;
    W._uw = (W._uw == null ? tgt : W._uw + (tgt - W._uw) * Math.min(1, dt * 4));
    const fog = W.scene.fog, sf = W.map.fogSurface || { color: W.map.sky, density: 0.0018 };
    if (fog && W._uw > 0.001) {
      _uwCol.set(sf.color).lerp(_uwDeep, W._uw);
      fog.color.copy(_uwCol);
      fog.density = sf.density + (0.05 - sf.density) * W._uw;
      if (W.scene.background && W.scene.background.isColor) W.scene.background.copy(_uwCol);
    } else if (fog && W._uwWasOn) {
      fog.color.set(sf.color); fog.density = sf.density;
      if (W.scene.background && W.scene.background.isColor) W.scene.background.set(W.map.sky);
    }
    W._uwWasOn = W._uw > 0.001;
    if (W.__audio && W.__audio.setUnderwater) W.__audio.setUnderwater(W._underwater);
  }
  cam.lookAt(camTarget.x + camDir.x * 8, camTarget.y + camDir.y * 8, camTarget.z + camDir.z * 8);
  if (roll) cam.rotateZ(roll);   // lookAt zeroes roll, so it has to go on after
  // Decay HERE rather than in fx.update: fx runs AFTER weapons in the frame
  // order (ffg_royale3d.js), so a shake set by this frame's shot was decayed
  // once before the camera ever saw it.
  if (W.camShake > 0) W.camShake = Math.max(0, W.camShake - dt * 1.8);
  // vertical FOV ≈ industry BR (Fortnite ~55-60v): wider view + stronger
  // sprint kick = the speed reads on screen (raw m/s already beats Apex).
  // ADS zoom is PER WEAPON (sim adsFov): sniper 20 + scope overlay, AR 42,
  // launcher 45, SMG 47, pistol 48, shotgun 49.
  const adsDef = ads && K.WEAPONS[focus.weapon.id];
  const baseFov = W.settings.fov || 57;                       // user-set (50-85)
  const wantFov = scope ? (adsDef.adsFov || 22) : ads ? (adsDef.adsFov || 42) : focus.sprinting ? baseFov + 13 : baseFov;
  // Track the SMOOTHED base separately from the shot punch (fx.js sets
  // W.fovPunch and says so: "inert until updateCamera consumes it"). Adding the
  // punch to wantFov lets the dt*10 lerp swallow it — only ~17% of it lands in
  // one frame — and adding it to cam.fov AFTER the lerp makes it next frame's
  // starting value, so it never settles. The scope scale keeps a 5 deg shotgun
  // punch from being a 25% zoom jump at the sniper's adsFov 20. 45 deg/s decay =
  // a 2 deg SMG punch lasts 44 ms and a 5 deg shotgun/sniper punch 111 ms.
  W._fovBase = W._fovBase == null ? wantFov : W._fovBase + (wantFov - W._fovBase) * Math.min(1, dt * 10);
  if (W.fovPunch > 0.01) W.fovPunch = Math.max(0, W.fovPunch - dt * 45); else W.fovPunch = 0;
  cam.fov = W._fovBase + (W.fovPunch || 0) * Math.min(1, W._fovBase / 57);
  cam.updateProjectionMatrix();
  W.events.emit("scopeState", !!scope);
}

// ── damage / death ───────────────────────────────────────────────────────────
function hurtActor(W, victim, dmg, attackerId, weaponId, isHead) {
  if (!victim.alive || W.phase === "over") return;
  // SQUADS: the menu button says SQUAD UP and friends were nonetheless obliged
  // to shoot each other — nothing anywhere assigned or checked a team. One guard
  // here covers direct fire, splash and the network path alike, because
  // weapons.js routes remote hits to the victim's own client and that client
  // calls this function. `att !== victim` preserves self-splash, and storm
  // damage passes a null attackerId so it is untouched.
  const att = attackerId ? W.actorById.get(attackerId) : null;
  if (att && att !== victim && att.teamId && att.teamId === victim.teamId) return;
  const res = K.applyDamage(victim.shield, victim.hp, dmg);
  victim.shield = res.shield; victim.hp = res.hp;
  victim.lastDamageT = W.t;
  if (attackerId) { victim.lastAttacker = attackerId; victim.lastHurtByActorT = W.t; }
  W.match.recordDamage(attackerId, res.dealt);
  // per-PAIR damage + last-hit detail. W.match.damage is per-attacker totals
  // only, so "you had them down to 12 HP" was not answerable; the death recap
  // needs the exchange between these two actors specifically.
  if (attackerId) {
    // `att` is resolved once by the friendly-fire guard above — this used to
    // re-look it up, and two bindings of the same name in one function is how a
    // later edit ends up reading the wrong one.
    victim.dmgFrom = victim.dmgFrom || {};
    victim.dmgFrom[attackerId] = (victim.dmgFrom[attackerId] || 0) + res.dealt;
    victim.lastHit = {
      attackerId, weaponId, isHead,
      dist: att ? Math.round(att.pos.distanceTo(victim.pos)) : null,
      attHp: att ? Math.max(0, Math.round(att.hp)) : null,
      attShield: att ? Math.max(0, Math.round(att.shield)) : null,
    };
  }
  W.events.emit("actorHurt", victim, { dmg: res.dealt, attackerId, weaponId, isHead, broke: res.broke, toShield: res.toShield });
  // HIT REACT (Meshy 177 Gunshot_Reaction): a visible body flinch when a real
  // hit lands. Gated to meaningful damage, a 1.2s cooldown so autofire doesn't
  // stunlock the silhouette, and only while grounded and slow — a sprinter
  // frozen mid-stride by a full-body clip reads worse than no flinch. The arm
  // pose layer still owns the arms afterward, so an armed victim keeps the gun
  // up while torso/legs stagger — exactly the layered read shipping BRs use.
  if (!res.dead && res.dealt >= 10 && victim.onGround && !victim.swimming && !victim.gliding &&
      W.t - (victim._hitReactAt || -9) > 1.2 && Math.hypot(victim.vel.x, victim.vel.z) < 4) {
    victim._hitReactAt = W.t;
    victim.hitReactT = 0.5;
  }
  // Practice-range dummies absorb and reset rather than die — the hit feedback
  // (damage numbers, hitmarker) has already fired above, and a range you can
  // permanently delete in six seconds is not a range.
  if (victim.isDummy) {
    victim.dummyDamage = (victim.dummyDamage || 0) + res.dealt;
    if (isHead) victim.dummyHeadshots = (victim.dummyHeadshots || 0) + 1;
    if (res.dead) {
      victim.dummyPops = (victim.dummyPops || 0) + 1;
      victim.hp = K.PLAYERK.hp; victim.shield = 0;
      W.events.emit("dummyPopped", victim);
    }
    return;
  }
  if (res.dead) killActor(W, victim, attackerId, weaponId);
}

export function killActor(W, victim, killerId, weaponId) {
  if (!victim.alive) return;
  victim.alive = false;
  // if killed mid-emote, un-holster: the emote hid the weapon (player.js ~524) and
  // only the emote-timeout restores it, so a one-shot kill left the corpse empty-handed
  if (victim.emoting) { victim.emoting = null; if (victim.hand) victim.hand.visible = true; }
  const killer = killerId ? W.actorById.get(killerId) : null;
  if (killer) killer.kills++;
  W.match.eliminate(victim.id, killerId, weaponId, W.t);
  // per-class kill tally feeding the career's 'favourite weapon' row (sweep
  // finding: initialized in W.stats and rendered by the career panel, but no
  // code path ever incremented it — the row was permanently unreachable)
  if (killerId && W.player && killerId === W.player.id && weaponId && W.stats && W.stats.killsByCls) {
    const kcls = (K.WEAPONS[weaponId] || {}).cls || weaponId;
    W.stats.killsByCls[kcls] = (W.stats.killsByCls[kcls] || 0) + 1;
  }
  W.events.emit("actorDied", victim, killerId, weaponId);
  // death anim then sink away
  // A bot killed past 250m had its mixer frozen at timeScale 0 by syncObj's
  // animation LOD, and NOTHING ever restored it — so a long-range kill left a
  // mid-stride statue instead of a death animation. update() skips dead actors,
  // so this is the only place that can un-freeze it.
  if (victim.rig && victim.rig.mixer) victim.rig.mixer.timeScale = 1;
  // an actor killed mid-mantle must not freeze mid-air in the scripted arc —
  // update() skips dead actors, so nothing else would ever clear the state
  victim.mantleT = null;
  if (victim.rig) {
    // death VARIETY: random pick among whichever death clips this skin baked
    // (183 fall-backward / 184 fall-forward joined the original 8 "Dead") —
    // one identical crumple on all 50 actors was a top visible-quality tell
    const dk = ["death", "death2", "death3"].filter((k) => victim.clips[k]);
    if (dk.length) playAnim(victim, dk[(Math.random() * dk.length) | 0], { once: true });
  }
  // "sink away" was a lie the code told: the group was unparented in ONE frame,
  // so the corpse popped out of existence. Hold the clamped death pose, then sink
  // it under the terrain and remove on completion. Actors are rebuilt from
  // scratch each match and every group is cleared at match start, so a tween
  // still in flight across a restart writes into a discarded object and its
  // parent-guarded remove is a no-op.
  setTimeout(() => {
    if (!victim.obj.parent) return;
    W.kernel.tween({
      target: victim.obj, duration: 1.2,
      to: { "position.y": victim.obj.position.y - 1.6 },
      onComplete: () => { if (victim.obj.parent) victim.obj.parent.remove(victim.obj); },
    });
  }, 3000);
  // player death → spectate killer
  if (victim === W.player) {
    // A storm death passes killerId null (storm.js only credits an attacker who
    // hurt you in the last 8s), and updateCamera's spectate branch was gated on
    // `spectating` being truthy — so the most common non-combat death in the
    // genre pinned the camera to your own corpse for the rest of the match.
    // Fall back to any survivor so the handover always happens.
    victim.spectating = killerId
      || (W.actors.find((x) => x.alive && x !== victim && !x.isDummy) || {}).id
      || null;
    W.events.emit("playerDied", killerId, weaponId);
  }
}

function applyHeal(W, a, id) {
  const c = K.CONSUMABLES[id];
  if (!c) return;
  if (c.heals === "hp") a.hp = Math.min(c.cap, a.hp + c.amount);
  else a.shield = Math.min(c.cap, a.shield + c.amount);
  W.events.emit("healed", a, id);
}

/** start a heal channel if the actor has that consumable (used by human + bots) */
export function useConsumable(W, a, id) {
  if (a.healing) return false;
  const inv = a.inventory;
  const slot = inv.slots.find((s) => s && s.kind === "consumable" && s.id === id && s.count > 0);
  if (!slot) return false;
  const c = K.CONSUMABLES[id];
  if (!c) return false;
  if (c.heals === "hp" && a.hp >= c.cap) return false;
  if (c.heals === "shield" && a.shield >= c.cap) return false;
  slot.count--;
  if (slot.count <= 0) {
    const idx = inv.slots.indexOf(slot);
    inv.slots[idx] = null;
    // Using your LAST bandage emptied the slot but left a.weapon pointing at
    // "consumable:<id>" with a dangling slotRef, so the next click routed back
    // into useConsumable and returned false: the human was left holding nothing
    // and literally unable to shoot until they pressed a number key. Bots
    // recovered via ensureGunOut; the human had no equivalent.
    if (inv.active === idx) {
      const gun = inv.slots.findIndex((s2) => s2 && s2.kind === "weapon");
      if (gun >= 0) W.equipSlot(a, gun);
    }
  }
  a.healing = { id, tLeft: c.useS };
  W.events.emit("healStart", a, id, c.useS);
  return true;
}
