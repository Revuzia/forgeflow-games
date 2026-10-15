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
const tagsMod = await import("./nametags.js" + (new URL(import.meta.url).search || ""));

let K = null; // SIM shortcut set in init

// Per-match registry of what this module put on the GPU / on the kernel's mixer
// list, so disposeMatch (C8) can free it: every actor rig (mixer, Skeleton bone
// texture) and every cloned body material. The Stage-0 texture census traced the
// biggest rematch leak to exactly these bone textures (+60/+49 per match).
const R = { W: null, rigs: [], mats: [] };

export function init(W) {
  K = W.SIM;
  W._camWall = { f: 1, target: 1, dist: 0, free: 0, pulled: false };   // camera wall pull-in readback (probes); one object, written in place
  W.rimGain = RIM_GAIN;      // the shared rim-strength uniform ({value}); tuning + the edge probe read/write it
  // read-only window into this module for the browser gates (clip download mode, which canopy is in use,
  // the death pick as a pure function, the corpse timeline): nothing in the game calls it
  W._playerProbe = {
    canopy: canopyStats, clips: clipLoadStats,
    pickDeath: (v) => pickDeath(W, v),
    pickLog: PICK_LOG,                           // [victim id, fall, dir, moving, head, heavy weapon] per kill (capped): the death variety gate reads it
    corpse: (a) => ({ sinkT: a._sinkT, hold: a._sinkHold, y0: a._sinkY0, parented: !!(a.obj && a.obj.parent), anim: a.anim,
                      fall: a._sinkFall, floor: a._sinkFloor, chute: !!a.chute }),
    deathClips: DEATH_CLIPS.slice(),
  };
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
    // EVERY field any module ever writes on an actor, present from birth, so all
    // 50 actors share ONE hidden class. They used to be grown on first use, in
    // event order (a hit, a heal, a chute, a storm tick...): 16 hidden classes
    // across 41 live actors were measured mid-match (V8 %HaveSameMap), which
    // makes every actor field access in the per-frame loops megamorphic, and a
    // megamorphic store/load of a number hands out a fresh heap box — player.js
    // update() alone allocated 45.7 KB a frame. (L6 did the same for the bot
    // blackboards.) Each start value behaves exactly like the old `undefined` at
    // every reader: numbers only meet `|| 0`-style defaults or `> 0` tests, the
    // rest only truthiness / `== null`; the three null-tested numbers got flags.
    crouching: false, emoting: null, mantleT: null,
    chute: null, _chuteH: null, chuteToggled: false,
    skin: null, clips: null, hasCrouchClip: false, armBones: null, torsoFix: false, hand: null, handBone: null,
    _bodies: null, _lod0Geo: null, _lod1Geo: null, _lod: 0, _bodyShadow: true, _wpnRef: null, _wpnMeshes: null, _wpnShadow: null,
    _evalNow: false, _mixT: 0, _skipUsed: false, _onScreen: false, _dEff: 0, _agl: 0, _synced: false,
    _bodyYaw: 0, _hasBodyYaw: false, _tiltX: 0, _tiltZ: 0, _eyeY: 0, _hasEyeY: false,
    _armW: 0, _hasArmW: false, _armMode: null, _animTS: 1, _adsT: 0, _stepAcc: 0,
    hitReactT: 0, _hitReactAt: -9, _portalT: 0, _portalBoost: false, _ovReload: false,
    // rim light (P1.8): 0 = not applied yet, 1 = the faint cool rim, 2 = SQUAD UP ally rim.
    // _sinkT: corpse timeline on SIM time (killActor / corpseStep), -1 = not a corpse;
    // _sinkFall: a corpse that died in the air drops to its floor first (_sinkVy, _sinkFloor).
    _rimMode: 0, _sinkT: -1, _sinkHold: 3, _sinkY0: 0, _sinkFall: false, _sinkVy: 0, _sinkFloor: 0,
    _gripLocal: null, _gripFor: null, _mFrom: null, _mTo: null,
    lastHit: null, dmgFrom: null, lastHurtByActorT: 0, spectating: null,
    netTarget: null, netChute: false,
    isDummy: false, dummyDamage: 0, dummyHeadshots: 0, dummyPops: 0,
    // written by other modules (fx hit flash, loot hold-E, net fire relay,
    // storm damage ramp, weapons view-model kick + recoil)
    _flashMats: null, _flashT: 0, _flashShield: false, _eHoldT: 0, _fireRelayT: 0, _stormT: 0,
    vmKick: 0, recoilYaw: 0, recoilPitch: 0,
    // fixed tick (C5): the pose BEFORE the latest tick (frame() draws between it
    // and pos), the tick it was taken on, and how the frame shows this actor
    // (0 = not at all, 1 = full view sync, 2 = position only: emote / mantle)
    _pp: new THREE.Vector3(), _pyaw: 0, _ppT: -1, _vmode: 0,
  };
  a.obj.name = "actor_" + a.id;
  // yaw outermost: the dive / canopy tilts (syncObj) pitch and roll about the BODY's own axes
  a.obj.rotation.order = "YXZ";
  W.group("actors").add(a.obj);
  W.actors.push(a);
  W.actorById.set(a.id, a);
  return a;
}

function mkInput() {
  return {
    mx: 0, mz: 0, jump: false, sprint: false, crouch: false,
    yaw: 0, pitch: 0, fire: false, ads: false, reload: false,
    interact: false, interactDown: false, slot: -1, emote: null,
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

// ── readability rim (P1.8, D12) ──────────────────────────────────────────────
// Added to a character's OUTGOING light in the zone-tint patch (see the shader in
// loadActorModels). Emissive glare bar: START LOW. The plan's ceiling is a 0.45
// term at grazing angles; the first pass peaks at RIM_FAR * RIM_GAIN = 0.36 * 0.8 =
// 0.29 (a far, up-facing silhouette edge) and is tuned from the edge-vs-body probe,
// never from a hunch. RIM_GAIN is ONE shared uniform object (every body material
// points at it), so the strength is a runtime knob: init() exposes it as W.rimGain.
const RIM_COOL = 0x9cc8ff;               // faint cool edge for everyone
const RIM_ALLY = 0x3dffa0;               // SQUAD UP teammate edge (friendly green)
const RIM_NEAR = 0.16, RIM_FAR = 0.36;   // strength at <= 8 m / >= 60 m from the camera
const RIM_ALLY_NEAR = 0.30, RIM_ALLY_FAR = 0.45;
const RIM_GAIN = { value: 0.8 };
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
  // NON-ROOT translation/scale tracks are DROPPED entirely. They encode the
  // SOURCE skeleton's bone lengths — the Mixamo gun/fall set bakes all 65 bone
  // translations in X-Bot units, which stretched our rigs ~9m tall the moment
  // those clips actually played (owner: "can't see the main character at all";
  // the pistol floated at ankle height on the collapsed hand bone). Rotations
  // carry the animation; the rig keeps its own proportions.
  const isRoot = (node) => /(^|:|\|)(Hips|Root|Armature|mixamorig:?Hips)$/i.test(node);
  clip.tracks = clip.tracks.filter((tr) => {
    const m = /\.(position|scale)$/.exec(tr.name || "");
    if (!m) return true;
    return isRoot(tr.name.slice(0, -m[0].length));
  });
  for (const tr of clip.tracks) {
    if (!/\.position$/.test(tr.name || "")) continue;
    const node = tr.name.replace(/\.position$/, "");
    // only the ROOT drives the body through the world (non-root position
    // tracks were already dropped above)
    if (!isRoot(node)) continue;
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
    // FOREIGN-UNIT GUARD: a root track authored in centimetres (or bone-local
    // micro-units) would put the body 100x off. The proven standing root height
    // across the working set is ~0.99m — rescale any implausible mean into it.
    if (!flatY) {
      let s = 0;
      for (let i = 1; i < v.length; i += 3) s += v[i];
      const mean = s / (v.length / 3);
      if (mean > 3 || (mean > 1e-6 && mean < 0.2)) {
        const f = 0.99 / mean;
        for (let i = 1; i < v.length; i += 3) v[i] *= f;
      }
    }
  }
  return clip;
}

/** ROOT FRAME. A clip GLB animates its root bone in ITS OWN parent's space. Four
 *  of the shared clip files (death2, death3, swim, crouch) were exported with the
 *  Hips under an FBX "Armature" node — rotated +90 deg about X, scaled 0.01 (cm,
 *  Z-up) — while every base rig (and every other clip) has the Hips under an
 *  identity RootNode. Their root keys were therefore read as metres in the wrong
 *  axes: measured 2026-10-01 on the committed build, playing them put the hips
 *  93.99 m (death2/death3), 72.32 m (swim) and 46.39 m (crouch, also 0.4-0.7 m
 *  below the feet) away from the actor — two corpses in three, every swimmer and
 *  every pistol/unarmed croucher rendered somewhere else on the map, and the
 *  root rotation was 90 deg off. Re-express the root position + rotation keys in
 *  the base rig's frame: p' = inv(baseParent) * srcParent * p, q' = rot * q.
 *  A no-op for clips whose root parent already matches (the other 14). */
const _rbM = new THREE.Matrix4(), _rbB = new THREE.Matrix4(), _rbQ = new THREE.Quaternion(), _rbV = new THREE.Vector3(), _rbS = new THREE.Vector3(), _rbK = new THREE.Quaternion();
function rootBone(scene) {
  let r = null;
  scene.traverse((o) => { if (!r && (o.isBone || /Hips$/.test(o.name)) && /(^|:)?(mixamorig:?)?Hips$/i.test(o.name)) r = o; });
  return r;
}
function rebaseRootTracks(clip, srcScene, baseScene) {
  if (!clip || !clip.tracks) return false;
  const src = rootBone(srcScene), base = rootBone(baseScene);
  if (!src || !base || !src.parent || !base.parent) return false;
  srcScene.updateMatrixWorld(true); baseScene.updateMatrixWorld(true);
  _rbM.copy(base.parent.matrixWorld).invert().multiply(src.parent.matrixWorld);
  const e = _rbM.elements;
  let id = true;
  for (let i = 0; i < 16; i++) if (Math.abs(e[i] - (i % 5 === 0 ? 1 : 0)) > 1e-4) { id = false; break; }
  if (id) return false;
  _rbM.decompose(_rbV, _rbQ, _rbS);
  const node = src.name;
  for (const tr of clip.tracks) {
    if (tr.name === node + ".position") {
      const v = tr.values;
      for (let i = 0; i < v.length; i += 3) { _rbV.fromArray(v, i).applyMatrix4(_rbM); _rbV.toArray(v, i); }
    } else if (tr.name === node + ".quaternion") {
      const v = tr.values;
      for (let i = 0; i < v.length; i += 4) { _rbK.fromArray(v, i).premultiply(_rbQ); _rbK.toArray(v, i); }
    }
  }
  return true;
}
/** A "death" clip that ends with the root back up and upright (fall-and-recover
 *  clips: after rebasing, death2 and death3 drop to 0.47 m / 0.16 m and return
 *  to 0.97 m / 0.93 m fully upright by their last key) would stand the corpse
 *  back up for its 4 s on the ground. True when the LAST root key is above
 *  0.6 m with the body within ~37 deg of vertical. */
function endsUpright(clip, rootName) {
  const tp = clip.tracks.find((t) => t.name === rootName + ".position");
  const tq = clip.tracks.find((t) => t.name === rootName + ".quaternion");
  if (!tp || !tq) return false;
  const y = tp.values[tp.values.length - 2];
  _rbK.fromArray(tq.values, tq.values.length - 4);
  const up = _rbV.set(0, 1, 0).applyQuaternion(_rbK).y;
  return y > 0.6 && up > 0.8;
}

// Base loco + combat set, then Mixamo BR weapon holds + freefall.
// File names on disk: assets/chars/clips/{clip}.glb (ONE shared file per clip, P1.1) with
// assets/chars/meshy/{skin}_{clip}.glb as the per-skin fallback for the names below.
// death2 / death3 are GONE (P1.6): they were Meshy-library actions 183/184, against the
// Mixamo-only rule, and two of the three shipped clips that stood the corpse back up. The
// single `death` stays as the fallback when the seven Mixamo death clips are absent.
const MESHY_CLIPS = [
  "idle",   // real Mixamo breathing idle — the BASE GLB's baked animations[0]
            // is a 0-duration frozen frame (see the rename below), not an idle
  "walk", "run", "death", "hit", "dance", "cheer", "jump", "swim", "crouch",
  // fall + pistol_* clips deliberately NOT loaded: freefall reverted to the
  // original frozen-run + skydive pose (owner: "falling isnt FREEFALL"), and
  // pistols use the procedural pose system (see gunFamily).
  "rifle_idle", "rifle_walk", "rifle_run", "rifle_reload", "rifle_crouch",
];
// The seven Mixamo death falls (P1.6), shared files only (no per-skin fallback exists):
// shot from the front / back / right, the same from the head, a crouching headshot, and a
// walking-to-dying. Chosen per kill in pickDeath from where the last hit came from.
const DEATH_CLIPS = ["death_front", "death_front_head", "death_back", "death_back_head", "death_right", "death_crouch_head", "death_walking"];
const ALL_CLIPS = MESHY_CLIPS.concat(DEATH_CLIPS);

// ── P1.1: every clip downloaded ONCE ────────────────────────────────────────────────────
// The 17 loco clips were md5-identical across the five skins, yet fetched as <skin>_<clip>.glb
// under five URLs each (8.83 MB, 85 GLB parses). They are now fetched once from
// assets/chars/clips/<clip>.glb (single animation = animations[0]; translation/scale tracks
// stripped except the Hips) and each skin gets a CLONE of the AnimationClip, because the
// per-skin passes below (rebaseRootTracks, stripRootMotion, pruneClipTracks, the reload split)
// REWRITE the clip for that skin's rig: one shared AnimationClip object would hand skin A's
// root frame and skin B's missing finger bones to everyone else.
// A skin whose shared file 404s falls back to its own <skin>_<clip>.glb (the old path), so the
// game boots whether or not the shared files are on the server. The first request is a PROBE
// (the smallest clip), so a server that has none costs ONE failed request, not 22.
// ONCE PER PAGE SESSION, never retried: clips merge into each skin's cached gltf on the first
// match only (__lcMerged), so a later match would download the files for nobody. A skin whose
// merge happens later (its base failed in an earlier match) reads the same settled result.
// ORDER: the shared files are requested only once every skin's BASE mesh has settled, so 22 clip
// requests never compete with the five base GLBs, which carry the kernel's 30 s per-asset timeout
// (a base that misses it drops its skin from the match). The old per-skin path was ordered the same
// way (each skin's clips after its base). Measured 2026-10-12 on the contended harness box: with the
// clips started in parallel, a 236 s match load lost 4 of 5 skins to that timeout.
const SHARED = { p: null, mode: "unknown", requests: 0, hits: 0 };
function sharedClipUrl(W, name) { return W.assetBase + "assets/chars/clips/" + name + ".glb"; }
/** loader.loadAsync with the kernel's per-asset timeout: a request that never settles rejects
 *  instead of wedging the match-start await (the kernel's own loads already do this). */
function loadBounded(W, url) {
  const p = W.kernel.loader.loadAsync(url);
  const ms = W.kernel.loadTimeoutMs > 0 ? W.kernel.loadTimeoutMs : 30000;
  let to = 0;
  const timer = new Promise((_, rej) => { to = setTimeout(() => rej(new Error("timed out loading " + url)), ms); });
  return Promise.race([p, timer]).finally(() => clearTimeout(to));
}
/** Start (once per page session) the shared clip loads; resolves to a Map name -> gltf.
 *  `tick` is the loading bar of the match that started it: one tick per file, and the files a
 *  failed probe will never fetch are ticked off at once so the bar still reaches the end. */
function loadSharedClips(W, tick) {
  if (SHARED.p) return SHARED.p;
  const load = async (name) => {
    SHARED.requests++;
    try { const g = await loadBounded(W, sharedClipUrl(W, name)); SHARED.hits++; return g; }
    catch (e) { return null; }
    finally { if (tick) tick(); }
  };
  SHARED.p = (async () => {
    const out = new Map();
    const probe = "hit";
    const g0 = await load(probe);
    if (!g0 || !g0.animations || !g0.animations[0]) {
      SHARED.mode = "per-skin";
      if (tick) tick(ALL_CLIPS.length - 1);
      return out;
    }
    out.set(probe, g0);
    const rest = ALL_CLIPS.filter((n) => n !== probe);
    const got = await Promise.all(rest.map(load));
    got.forEach((g, i) => { if (g && g.animations && g.animations[0]) out.set(rest[i], g); });
    SHARED.mode = "shared";
    return out;
  })();
  return SHARED.p;
}
/** test / probe read-back */
export function clipLoadStats() {
  return { mode: SHARED.mode, requests: SHARED.requests, loaded: SHARED.hits, shared: ALL_CLIPS.length, deathClips: DEATH_CLIPS.slice() };
}

const _v3 = new THREE.Vector3();

/** "pistol" | "rifle" | null — SMG/AR/shotgun/sniper/GL all use the rifle set. */
function gunFamily(a) {
  if (!a.weapon || !a.weapon.id || String(a.weapon.id).startsWith("consumable")) return null;
  const def = K.WEAPONS && K.WEAPONS[a.weapon.id];
  if (!def) return null;
  // PISTOLS use the procedural pose system, NOT the Mixamo hold set: the
  // Mixamo pistol clips carry the gun at FACE height (owner: "why is he
  // holding it up HIGH... note the way he holds the pistol") — the pose layer
  // gives the natural low carry with a plain arm-swing run, and the barrel
  // weld still aims the gun exactly. Long guns keep the Mixamo rifle set.
  return def.cls === "pistol" ? null : "rifle";
}

async function preloadMeshySkin(W, key, tick, sharedP, grow, baseSettled) {
  const url = W.assetBase + "assets/chars/meshy/" + key + ".glb";
  let rig = null;
  // caches gltf; registers this throwaway clone's mixer. baseSettled (loaded OR failed) opens the
  // shared clip downloads once every skin's base is through (see SHARED above).
  try { rig = await W.kernel.loadCharacter(url); }
  finally { if (baseSettled) baseSettled(!!rig); }
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
    // The clip files are fetched ONCE for all five skins (loadSharedClips, P1.1: they used
    // to be 8.83 MB of md5-identical <skin>_<clip>.glb) and are all in flight in ONE round
    // trip, as the earlier per-skin version was. Results are APPLIED in ALL_CLIPS order after
    // they settle so the merged clip list stays deterministic, and the "idle" rename above
    // still happens first so animations[0] remains idle for classifyClips' names[0]
    // fallbacks. A clip that fails drops out and the rest of the skin still loads.
    // The far LOD body (<skin>_lod1.glb, ~2.5k tris) loads in the same round
    // trip as the clips. Optional by design: a 404 or a body that does not
    // match LOD0 just leaves this skin on LOD0 everywhere (lod1From checks).
    // The handler is attached HERE, not at the await below: lodP is awaited only
    // after the clip loads settle, so a LOD1 fetch that failed first was an
    // unhandled rejection page error (Wave-2 VERIFY run A: "Failed to fetch ...
    // preloadMeshySkin"). A failed LOD1 resolves null = this skin stays on LOD0.
    const lodP = (async () => {
      try { return await loadBounded(W, W.assetBase + "assets/chars/meshy/" + key + "_lod1.glb"); }
      finally { if (tick) tick(); }
    })().catch((e) => { console.warn("[chars] LOD1 body not loaded, staying on LOD0:", key, e && e.message); return null; });
    const shared = await sharedP;
    // what this skin must still fetch ITSELF (the old per-skin path): every MESHY_CLIPS name the
    // shared set lacks (all of them when the server has no shared files). The death falls have no
    // per-skin file, so a missing one simply leaves that fall out of the pool.
    const own = MESHY_CLIPS.filter((n) => !shared.has(n));
    if (own.length && grow) grow(own.length);   // the loading bar counts these extra files too
    const ownLoaded = await Promise.allSettled(own.map(async (clip) => {
      // async wrapper, not a bare .finally(): it turns a SYNCHRONOUS throw out of
      // the loader into a rejection too, which is the tolerance the old per-clip
      // try/catch had.
      try { return await loadBounded(W, W.assetBase + "assets/chars/meshy/" + key + "_" + clip + ".glb"); }
      finally { if (tick) tick(); }
    }));
    const ownMap = new Map();
    own.forEach((n, i) => {
      const r = ownLoaded[i];
      if (r.status === "fulfilled") ownMap.set(n, r.value);
      else console.warn("[chars] clip load failed", key, n, r.reason);
    });
    for (const name of ALL_CLIPS) {
      const sg = shared.get(name);
      const g = sg || ownMap.get(name);
      if (!g || !g.animations || !g.animations[0]) continue;
      // a SHARED clip is cloned (AnimationClip.clone copies every track's times + values), so the
      // rewrites below touch this skin's copy only; a per-skin file is already this skin's own
      const clip = sg ? g.animations[0].clone() : g.animations[0];
      clip.name = name;
      rebaseRootTracks(clip, g.scene, cached.scene);   // BEFORE the root-motion strip
      stripRootMotion(clip);
      if (/^death/.test(name)) {
        const rb = rootBone(cached.scene);
        if (rb && endsUpright(clip, rb.name)) (cached.__lcRecovers || (cached.__lcRecovers = new Set())).add(name);
      }
      cached.animations.push(clip);
    }
    // The clip GLBs are shared by all five skins and animate the full 65-bone
    // Mixamo hand; athlete's rig has 34 bones. Every orphan track warned once per
    // mixer per clip ("No target node found", ~180 lines per load) and bound
    // nothing. Drop them here, once, before any actor builds its mixer.
    rigPipe.pruneClipTracks(cached.scene, cached.animations);
    let lodG = null;
    try { lodG = await lodP; } catch (e) { lodG = null; }
    cached.__lcLod1 = lodG ? lod1From(lodG, cached) : null;
    // SPLIT-BODY RELOAD (industry-standard layered clip): the full-body reload
    // froze the legs, so reloading on the move SLID across the ground (owner
    // report). Derive an upper-body-only variant — the state machine overlays
    // it on walk/run so the legs keep their stride while the arms swap the mag.
    const rl = cached.animations.find((c) => c.name === "rifle_reload");
    if (rl && !cached.animations.some((c) => c.name === "rifle_reload_upper")) {
      const tracks = rl.tracks.filter((t) => /Spine|Neck|Head|Shoulder|Arm|ForeArm|Hand/.test(t.name));
      if (tracks.length) cached.animations.push(new THREE.AnimationClip("rifle_reload_upper", rl.duration, tracks));
    }
  } else if (tick) tick(1);   // warm cache: this skin's LOD1 (the shared clips are once per session) is already done, say so
  // The warm-up clone exists only to populate the gltf cache, but
  // kernel.loadCharacter registers ITS mixer in the per-frame update list too.
  // loadActorModels runs every match, so this leaked 5 mixers per match — the
  // roster teardown in ffg_royale3d.js does not see these because they are
  // never actors. Measured: kernel mixer count climbed 61 -> 66 -> 71 -> 76
  // across four matches until this was disposed.
  if (W.kernel.disposeMixer && rig.mixer) W.kernel.disposeMixer(rig.mixer);
  return url;
}

/** The LOD1 body's geometry, or null when it cannot be swapped onto a LOD0
 *  actor as-is. The swap keeps the LOD0 SkinnedMesh — its skeleton, bind
 *  matrix, cloned material and bounding sphere — and only changes `geometry`,
 *  so the two files must agree on everything the skinning reads: the same
 *  attribute set (a missing attribute is a new program variant), the same joint
 *  order + inverse bind matrices, the same bind matrix, and no joint index past
 *  the skeleton. L2's generator asserts all of this offline; this re-checks it
 *  at load so a regenerated file that breaks it degrades to LOD0, not to a
 *  scrambled body. */
function lod1From(lodGltf, cached) {
  let m = null, b = null;
  lodGltf.scene.traverse((o) => { if (o.isSkinnedMesh && !m) m = o; });
  cached.scene.traverse((o) => { if (o.isSkinnedMesh && !b) b = o; });
  if (!m || !b || !m.skeleton || !b.skeleton) return null;
  const ga = m.geometry.attributes, gb = b.geometry.attributes;
  if (Object.keys(ga).sort().join() !== Object.keys(gb).sort().join()) return null;
  const mb = m.skeleton.bones, bb = b.skeleton.bones;
  if (mb.length !== bb.length) return null;
  for (let i = 0; i < mb.length; i++) {
    if (mb[i].name !== bb[i].name) return null;
    if (!m.skeleton.boneInverses[i].equals(b.skeleton.boneInverses[i])) return null;
  }
  if (!m.bindMatrix.equals(b.bindMatrix)) return null;
  const si = ga.skinIndex && ga.skinIndex.array;
  if (!si) return null;
  for (let i = 0; i < si.length; i++) if (si[i] >= bb.length) return null;
  if (m.material && m.material.dispose) m.material.dispose();   // placeholder material, never drawn
  return m.geometry;
}

export async function loadActorModels(W) {
  // 5 skins x (1 mesh GLB + 8 clip GLBs) is EVERY file this function fetches,
  // counted — and these fetches are essentially the whole pre-match wait (the
  // map build measures 302-701 ms against them), so the loading bar has no
  // excuse for guessing. W.loadProgress is a hook: absent = nothing to report
  // to, so this costs one null check. Clips merge into the cached gltf on the
  // first match only (__lcMerged), so on a requeue the skipped ones tick
  // straight through and the bar completes fast instead of pretending to work.
  // mesh + LOD1 body per skin, plus the shared clip files once per page session (P1.1). A skin that
  // has to fetch its own <skin>_<clip>.glb (no shared file on the server) grows the total itself.
  let total = SKINS.length * 2 + (SHARED.p ? 0 : ALL_CLIPS.length);
  let done = 0;
  // The previous match's rigs are gone from the scene by now (the orchestrator
  // cleared the groups); free what they still hold on the GPU before building
  // the next roster. disposeMatch is idempotent, so the orchestrator's own C8
  // call (L4) and this one never double-free anything.
  disposeMatch(W);
  R.W = W;
  ensureChute();
  const actorsGroup = W.group("actors");
  tagsMod.beginMatch(actorsGroup);
  if (CH.mesh.parent !== actorsGroup) { actorsGroup.add(CH.mesh); actorsGroup.add(CH.lines); }
  installRenderHook(W);
  const tick = (n) => { done += (n || 1); if (W.loadProgress) W.loadProgress(done, total); };
  const grow = (n) => { total += n; if (W.loadProgress) W.loadProgress(done, total); };
  if (W.loadProgress) W.loadProgress(0, total);
  // the shared clip files start once every skin's BASE has settled (loaded or failed: see SHARED),
  // one promise for all five skins; a warm session resolves at once. When NO base loaded (a faulted
  // network: the match start fails and the menu offers a retry) nothing is requested and the
  // once-per-session probe is left for the retry, instead of locking the session to per-skin.
  let basesLeft = SKINS.length, basesOk = 0, openShared = null;
  const basesP = new Promise((res) => { openShared = res; });
  const baseSettled = (ok) => { if (ok) basesOk++; if (--basesLeft === 0) openShared(); };
  const sharedP = basesP.then(() => (basesOk > 0 ? loadSharedClips(W, tick) : new Map()));
  // the canopy GLB (if the server has one) loads in parallel with the skins and is awaited with them:
  // it must be in place BEFORE the warm-up uploads the chute buffers
  const canopyP = loadCanopy(W);
  // tolerant preload: a still-baking skin just drops out of rotation
  const settled = await Promise.allSettled(SKINS.map((k) => preloadMeshySkin(W, k, tick, sharedP, grow, baseSettled)));
  await canopyP;
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
    R.rigs.push(rig);
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
        // "Rim1": the readability rim (P1.8) is part of this program now; the key MUST
        // change whenever the injected GLSL does, or three would hand a stale program
        // from the cache to a material expecting the new uniforms
        m.customProgramCacheKey = () => "lcZoneTintRim1";
        m.onBeforeCompile = (sh) => {
          sh.uniforms.zLegs = { value: zc[0] }; sh.uniforms.zTorso = { value: zc[1] }; sh.uniforms.zHead = { value: zc[2] };
          // rim light: colour + (near, far) strength per material (SQUAD UP allies get
          // their own colour, see applyRim), one shared master gain for tuning
          sh.uniforms.zRimCol = { value: new THREE.Color(RIM_COOL) };
          sh.uniforms.zRimP = { value: new THREE.Vector2(RIM_NEAR, RIM_FAR) };
          sh.uniforms.zRimK = RIM_GAIN;
          m.userData.zRimCol = sh.uniforms.zRimCol;
          m.userData.zRimP = sh.uniforms.zRimP;
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
          sh.fragmentShader = "varying float vZoneY;\nuniform vec3 zLegs;\nuniform vec3 zTorso;\nuniform vec3 zHead;\nuniform vec3 zFlash;\nuniform vec3 zRimCol;\nuniform vec2 zRimP;\nuniform float zRimK;\n" + sh.fragmentShader.replace(
            "#include <color_fragment>",
            "#include <color_fragment>\n  vec3 zTint = mix(zLegs, zTorso, smoothstep(0.80, 1.00, vZoneY));\n  zTint = mix(zTint, zHead, smoothstep(1.45, 1.60, vZoneY));\n  diffuseColor.rgb = diffuseColor.rgb / max(vec3(0.0001), diffuse) * zTint * zFlash;"
          ).replace(
            // RIM (VALORANT-style readability edge): added to the OUTGOING light, so it
            // is the same everywhere on the cast whatever the sun/shade there, which is
            // exactly what lifts a black skin off a dark background. pow(1-N.V, 3)
            // keeps it to the silhouette, the up-facing term puts it on head, shoulders
            // and arms (not the shins), and the strength grows with distance (the far
            // read is where a dark skin vanishes). Peak term = zRimP.y * zRimK <= 0.45.
            "#include <opaque_fragment>",
            "{\n" +
            "  vec3 rV = normalize( vViewPosition );\n" +
            "  float rF = pow( clamp( 1.0 - dot( normal, rV ), 0.0, 1.0 ), 3.0 );\n" +
            "  float rUp = dot( normal, normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) ) * 0.5 + 0.5;\n" +
            "  float rD = mix( zRimP.x, zRimP.y, smoothstep( 8.0, 60.0, length( vViewPosition ) ) );\n" +
            "  outgoingLight += zRimCol * ( rF * rUp * rD * zRimK );\n" +
            "}\n#include <opaque_fragment>"
          );
        };
        m.needsUpdate = true;
        seen.set(o.material, m);
        R.mats.push(m);
      }
      o.material = seen.get(o.material);
    });
    // The BODY: the skinned mesh(es) whose shadow, LOD and culling the view pass
    // drives every frame (every shipping skin has exactly one).
    a._bodies = [];
    rig.scene.traverse((o) => { if (o.isSkinnedMesh) a._bodies.push(o); });
    // Meshy rigs are authored at REAL METERS (rigging height_meters: 1.8,
    // feet at y=0) — do NOT bbox-normalize: the bind-pose bbox of a Meshy
    // SkinnedMesh reads ~0.1m (tiny armature node scales) and "normalizing"
    // it spawned 26m giants once the animation restored true proportions.
    rig.scene.scale.setScalar(1);
    rig.scene.position.y = 0;
    a.obj.add(rig.scene);
    a.clips = classifyClips(rig);
    // a fall-and-recover clip is not a death: keep it out of killActor's pool
    // (see endsUpright) — the corpse would otherwise stand back up
    const recovers = W.kernel._charCache && W.kernel._charCache[url] && W.kernel._charCache[url].__lcRecovers;
    if (recovers) for (const k of ["death"].concat(DEATH_CLIPS)) if (a.clips[k] && recovers.has(a.clips[k])) a.clips[k] = null;
    // the capsule only shrinks when this actor can actually be SEEN crouching
    a.hasCrouchClip = !!a.clips.crouch;
    a.armBones = findArmBones(rig.scene);   // runtime arm-pose layer (pose.js)
    // detect a defective slouching rig (Meshy shipped drifter at ~27°; the
    // rest sit at 1-5°) → straighten its torso every frame
    a.obj.updateMatrixWorld(true);
    a.torsoFix = measureLean(a.armBones) > 0.20;   // >~11° = slouched
    // FIXED BOUNDING SPHERE. three computes a SkinnedMesh's sphere lazily on its
    // first frustum test by CPU-skinning every vertex (126-242 ms on the first
    // drop frame), and computes it in whatever pose the actor holds at that
    // instant — measured on the live build: centre 0.03-0.19 m above the feet,
    // radius 1.03-1.20 m, i.e. the head of a standing actor (1.8 m) sat OUTSIDE
    // its own culling sphere and could be culled while on screen. A fixed sphere
    // that bounds every pose this cast takes (standing 1.8 m, arms up under the
    // canopy, splayed skydive, lying corpse) costs nothing per frame and is
    // never recomputed (the warm-up only computes spheres that are null).
    setBodySphere(a);
    // far LOD body: same SkinnedMesh, geometry swapped by the view pass
    const cachedG = W.kernel._charCache && W.kernel._charCache[url];
    a._lod0Geo = a._bodies.length ? a._bodies[0].geometry : null;
    a._lod1Geo = (cachedG && cachedG.__lcLod1) || null;
    a._lod = 0;
    a._bodyShadow = true;          // kernel.loadCharacter sets castShadow on every mesh
    playAnim(a, "idle");
    // name tag (not for self): one atlas cell + one instance of the shared billboard
    if (a.id !== (W.player && W.player.id)) a.nameTag = tagsMod.addTag(a, a.name, !a.isBot);
    // weapon holder on the RIGHT HAND bone (Meshy = "RightHand"; Quaternius
    // fallback "FistR"). Bone world scale varies wildly between rig families
    // (Meshy ~0.065 vs Quaternius ~5.5) — compensate so guns keep world size.
    let fist = null;
    // Mixamo re-rig (2026-08): bones are now "mixamorig:RightHand" (THREE
    // sanitizes the colon away -> "mixamorigRightHand"). The old exact-name
    // match silently fell back to the static chest socket for EVERY skin —
    // guns floated at the sternum instead of riding the hand (owner report).
    rig.scene.traverse((o) => { if (o.isBone && /^(mixamorig:?)?RightHand$|^FistR$/i.test(o.name) && !fist) fist = o; });
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
    death: find([/^death$/i, /^(?!death_).*(death|die|defeat)/i]),
    // the seven Mixamo death falls (P1.6), each exact-anchored: none may be swallowed by a looser
    // pattern below (crouch in particular: /crouch/i would otherwise hand a crouching player
    // "death_crouch_head" the day the real crouch clip is missing)
    death_front: find([/^death_front$/i]),
    death_front_head: find([/^death_front_head$/i]),
    death_back: find([/^death_back$/i]),
    death_back_head: find([/^death_back_head$/i]),
    death_right: find([/^death_right$/i]),
    death_crouch_head: find([/^death_crouch_head$/i]),
    death_walking: find([/^death_walking$/i]),
    hit: find([/^hit$/i]),
    shoot: find([/shoot|attack|punch|slash|hit/i]),
    dance: find([/^dance$/i, /dance/i]),
    cheer: find([/^cheer$/i, /cheer|wave|victory/i]),
    crouch: find([/^crouch$/i, /^(?!death).*crouch/i]),
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

// Name tags live in nametags.js (one atlas texture + one instanced billboard
// for the whole lobby). Bots carry deliberately human-looking handles, so humans
// keep the blue pill + outline there. Known edge, unchanged: a tag is baked at
// model load, so a peer slot handed to a bot mid-match keeps the friendly tint.

// Body bounding sphere, in actor space: centre 0.9 m up, radius 1.55 m. Sized
// from measurement, not guessed: every skinned vertex of every live actor over
// a standard match (2026-10-01, 1,108 actor samples, all 5 skins, freefall /
// canopy / ground / run / swim / crouch / corpse) stayed within 1.40 m of this
// centre — the worst were a canopy hang (hands up at 2.17 m) and a corpse. 1.55
// is that plus 10 %. Converted into each body's own mesh space, since three
// tests the object's sphere through the mesh's matrixWorld.
const BODY_SPHERE_Y = 0.9, BODY_SPHERE_R = 1.55;
const _bsM = new THREE.Matrix4(), _bsS = new THREE.Vector3();
function setBodySphere(a) {
  for (const b of a._bodies) {
    b.updateWorldMatrix(true, false);
    // mesh -> actor-root transform, inverted: actor space -> mesh space
    _bsM.copy(a.obj.matrixWorld).invert().multiply(b.matrixWorld);
    _bsS.setFromMatrixScale(_bsM);
    const sc = Math.max(1e-6, Math.max(_bsS.x, _bsS.y, _bsS.z));
    _bsM.invert();
    const sph = new THREE.Sphere(new THREE.Vector3(0, BODY_SPHERE_Y, 0).applyMatrix4(_bsM), BODY_SPHERE_R / sc);
    b.boundingSphere = sph;
  }
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

/** Landing zone chosen FOR the player, now that the drop-select map is gone
 *  (owner direction 2026-09-15: "I want to just drop straight in when joining a
 *  match"). Same idea the old screen used when its timer ran out — the quietest
 *  named POI, scored off the bots' own declared drop targets (bots.assignDrops
 *  runs before this) — so the player still lands somewhere with loot instead of
 *  the random ground point spawnAll hands out.
 *
 *  MUST BE DRY. Some POIs are water by design: on isla_viva, Shipwreck Cove
 *  (-5.3 m) and Lagoon Docks (-4.5 m) both have an underwater centre and zero
 *  land on a ring around them, so "quietest" alone auto-dropped the player into
 *  open sea on 2 of 8 zones. Candidates therefore need a dry centre AND mostly
 *  dry ground on a 35 m ring — 35 m because the canopy glide carries you ~25 m
 *  past the marker even with no steering input. Quietest wins, most-land breaks
 *  the tie, and the match seed breaks what is left so repeat matches on one map
 *  don't always funnel to the same corner. */
export function autoDropTarget(W) {
  const pois = (W.map && W.map.pois) || [];
  if (!pois.length) return null;
  const wy = W.map.waterY;
  const dryness = (p) => {
    if (W.map.heightAt(p.x, p.z) <= wy + 0.5) return 0;   // wet centre disqualifies
    let n = 0;
    for (let i = 0; i < 8; i++) {
      const th = (i / 8) * Math.PI * 2;
      if (W.map.heightAt(p.x + Math.cos(th) * 35, p.z + Math.sin(th) * 35) > wy + 0.5) n++;
    }
    return n;
  };
  const cand = pois.map((p) => {
    let heat = 0;
    for (const a of W.actors) {
      const t = a.brain && a.brain.bb && a.brain.bb.dropTarget;
      if (!t) continue;
      const dx = t.x - p.x, dz = t.z - p.z;
      if (dx * dx + dz * dz <= (p.r * 1.35) * (p.r * 1.35)) heat++;
    }
    return { p, heat, land: dryness(p) };
  });
  // prefer solidly dry zones; fall back to merely-dry before giving up
  let pool = cand.filter((c) => c.land >= 5);
  if (!pool.length) pool = cand.filter((c) => c.land > 0);
  if (!pool.length) return null;                 // no dry POI — spawnAll's point stands
  let minHeat = Infinity;
  for (const c of pool) if (c.heat < minHeat) minHeat = c.heat;
  const tied = pool.filter((c) => c.heat === minHeat);
  let maxLand = 0;
  for (const c of tied) if (c.land > maxLand) maxLand = c.land;
  const finalists = tied.filter((c) => c.land === maxLand);
  const rng = K.mulberry32(((W.seed >>> 0) ^ 0xd0d0) >>> 0);
  const c = finalists[Math.floor(rng() * finalists.length) % finalists.length];
  return { x: c.p.x, z: c.p.z, name: c.p.name || "" };
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
  // TOUCH MODE (contract C6): touch.js (L10) owns the phone controls and writes
  // W.touch. While it is active, the mouse path stands down entirely: a tap
  // produces COMPATIBILITY mouse events, and letting those through would ask a
  // phone for pointer lock (which phones refuse), fire on every tap anywhere on
  // the canvas, and spend `_suppressNextShot` on a tap that was never a shot —
  // eating the first real FIRE press after a menu. Feature-detected: without
  // touch.js W.touch is undefined and nothing below changes.
  const touchOn = () => !!(W.touch && W.touch.active);
  let rmbDrag = false;
  dom.addEventListener("mousedown", (e) => {
    if (!W.player || W.phase === "menu" || W.paused) return;
    if (touchOn()) return;
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
  // CANVAS RECT, CACHED (C1). mousemove used to call getBoundingClientRect on
  // every event — a forced synchronous layout whenever anything had dirtied the
  // page since the last frame (framecheck: 0.02 forced layouts per frame). The
  // canvas only moves or resizes on a viewport change, so the offset is read
  // once per change: the kernel's ResizeObserver-cached viewW/viewH (C1) are the
  // size, and a window resize/scroll drops the cached offset.
  let _rect = null, _rectW = -1, _rectH = -1;
  const canvasRect = () => {
    const k = W.kernel, vw = k.viewW || 0, vh = k.viewH || 0;
    if (!_rect || vw !== _rectW || vh !== _rectH) {
      const r = dom.getBoundingClientRect();
      _rect = { left: r.left, top: r.top, width: r.width, height: r.height };
      _rectW = vw; _rectH = vh;
    }
    return _rect;
  };
  window.addEventListener("resize", () => { _rect = null; });
  window.addEventListener("scroll", () => { _rect = null; }, { passive: true });
  const _mPx = { x: 0, y: 0 }, _mNdc = { x: 0, y: 0 };
  window.addEventListener("mousemove", (e) => {
    // ALWAYS track the cursor: without pointer lock the shot must land where
    // the visible mouse points, not at screen center (playtest: "I aim and my
    // pistol doesn't work")
    const rect = canvasRect();
    const w = W.kernel.viewW || rect.width, h = W.kernel.viewH || rect.height;
    _mPx.x = e.clientX - rect.left; _mPx.y = e.clientY - rect.top;
    _mNdc.x = (_mPx.x / Math.max(1, w)) * 2 - 1;
    _mNdc.y = -((_mPx.y / Math.max(1, h)) * 2 - 1);
    W.mousePx = _mPx; W.mouseNDC = _mNdc;
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
  W.kernel.onUpdate((dt) => {
    if (!W.player || !W.player.alive || W.phase === "menu" || W.paused) return;
    const inp = W.player.input;
    // NO UNCOMMANDED CAMERA MOTION. A previous build panned the camera toward
    // wherever the OS cursor sat whenever pointer lock was not held — up to
    // 177 deg/s of continuous rotation, with the cursor hidden and the reticle
    // pinned to centre, so nothing on screen explained it (owner: "camera seems
    // drunk, it doesn't hold properly"). Shooters do not edge-pan; that is an
    // RTS/MOBA convention. Pointer lock is the only look mode, RMB-drag is the
    // explicit fallback when the browser denies it, and an unlocked camera now
    // holds perfectly still while the HUD tells the player to click.
    const T = touchOn() ? W.touch : null;
    // touch.js's own complete merge (look x sensitivity + aim assist, press-COUNT
    // edges so a tap shorter than a frame is never lost, USE held, fire / ads /
    // sprint OR-ed, the stick over mx / mz) runs at the END of this rebuild;
    // without it, the merge below is done here by hand
    const Tm = T && typeof T.applyTo !== "function" ? T : null;
    let mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    let mz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    // touch stick (C6: mx/mz in -1..1, +mz forward — the same axes as WASD)
    if (Tm) { mx = K.clamp(mx + (+Tm.mx || 0), -1, 1); mz = K.clamp(mz + (+Tm.mz || 0), -1, 1); }
    inp.mx = mx;
    inp.mz = mz;
    const sprintHeld = !!keys.ShiftLeft;   // canon() folds ShiftRight into this
    // breath-hold reads the RAW key while aiming (weapons.js sway block)
    W._breathHeld = sprintHeld && !!inp.ads;
    // SHIFT toggles sprint on and off (owner direction). The latch drops when
    // you stop moving forward, so you never wander back into a fight still
    // sprinting from three minutes ago with no way to notice.
    if (W.settings.sprintToggle && W._sprintLatch && inp.mz <= 0.1) W._sprintLatch = false;
    inp.sprint = (W.settings.sprintToggle ? !!W._sprintLatch : sprintHeld) || !!(Tm && Tm.sprint);
    // Crouch defaults to C, NOT Ctrl: this runs in a browser next to WASD, and
    // Ctrl+W closes the tab. Rebindable like any other action.
    inp.crouch = !!keys.KeyC;
    inp.fire = !!W._lmbDown || !!(Tm && Tm.fire);
    inp.ads = (W.settings.adsToggle ? !!W._adsLatch : !!W._rmbDown) || !!(Tm && Tm.ads);
    if (T && !Tm) T.applyTo(inp, dt);
    else if (Tm) touchFrame(W, Tm, inp, keys, dt);
    else W._touchPrev = null;
  });
  // ADS toggle latch: flip on the RMB press edge (hold mode ignores it).
  // Same liveness guards as the main mousedown handler — without them a
  // right-click on the menu/pause/death screen armed the latch and you
  // spawned already toggled into ADS (sweep finding).
  dom.addEventListener("mousedown", (ev2) => {
    if (ev2.button === 2 && W.settings.adsToggle && !touchOn() &&
        W.player && W.player.alive && W.phase !== "menu" && !W.paused) W._adsLatch = !W._adsLatch;
  });
  W.pointerLocked = () => document.pointerLockElement === dom;
  W.resetInputState = () => { for (const k in keys) keys[k] = false; W._lmbDown = false; W._rmbDown = false; W._sprintLatch = false; W._adsLatch = false; W._touchPrev = null; };
}

/** One frame of touch input (C6), after the held axes/buttons above:
 *  press EDGES for the one-shot verbs (jump, reload, use, pause, slot taps) and
 *  the look drag from W.touch.takeLook() -> {dyaw, dpitch} (radians, added to
 *  the aim exactly as DYEFIELD's Input adds them: drag right = negative yaw =
 *  turn right, drag up = positive pitch), scaled by the same sensitivity
 *  setting the mouse uses, then the touch-only aim assist. */
function touchFrame(W, T, inp, keys, dt) {
  const P = W._touchPrev || (W._touchPrev = { jump: false, reload: false, use: false, pause: false });
  const jump = !!T.jump, reload = !!T.reload, use = !!T.use, pause = !!T.pause;
  if (jump && !P.jump) inp.jump = true;
  if (reload && !P.reload) inp.reload = true;
  if (use && !P.use) inp.interact = true;
  // USE is HELD to open a chest (loot.js reads interactDown); releasing it only
  // clears the hold if the E key is not also down
  if (use) inp.interactDown = true;
  else if (P.use) inp.interactDown = !!keys.KeyE;
  if (pause && !P.pause) W.events.emit("escPressed");
  P.jump = jump; P.reload = reload; P.use = use; P.pause = pause;
  // slot taps: hud (L7) may call W.equipSlot directly; a `slot` field on
  // W.touch is honoured too (consumed here, like a number key)
  if (typeof T.slot === "number" && T.slot >= 0) { inp.slot = T.slot | 0; T.slot = -1; }
  let dyaw = 0, dpitch = 0;
  if (typeof T.takeLook === "function") {
    const L = T.takeLook();
    if (L) { dyaw = +L.dyaw || 0; dpitch = +L.dpitch || 0; }
  }
  const sens = (inp.ads ? W.settings.adsSensitivity : W.settings.sensitivity) || 1;
  dyaw *= sens; dpitch *= sens;
  const as = aimAssistStep(W, inp, !!T.fire, (Math.abs(inp.mx) + Math.abs(inp.mz) > 0) || dyaw !== 0 || dpitch !== 0, dt);
  inp.yaw += dyaw * as.slow + as.dyaw;
  inp.pitch = K.clamp(inp.pitch + dpitch * as.slow + as.dpitch, -1.35, 1.35);
}

// ── touch aim assist (L10's aimassist.js, touch mode only) ──────────────────
// Loaded on the FIRST touch frame, never on desktop, so a desktop session never
// requests the file. The module is DYEFIELD's M3 pure function; its angle
// convention (DYEFIELD yaw: forward = (sin y, ., cos y); ours: (-sin y, ., -cos y))
// is not assumed — one synthetic target straight ahead decides which mapping
// the module answers to, and an unrecognised module simply stays off.
const AA = { fn: null, loading: false, off: 0, foes: [], pool: [], res: { slow: 1, dyaw: 0, dpitch: 0 }, eye: { x: 0, y: 0, z: 0 } };
function aimAssistLoad() {
  if (AA.fn || AA.loading) return;
  AA.loading = true;
  import("./aimassist.js" + (new URL(import.meta.url).search || "")).then((m) => {
    const fn = m && (m.aimAssist || m.default || m.assist);
    if (typeof fn !== "function") return;
    // the module may declare its convention ("lc" = this file's yaw); else probe
    // it with a firing, moving synthetic target dead ahead (it acts only then)
    if (m.CONVENTION === "lc") { AA.off = 0; AA.fn = fn; return; }
    if (m.CONVENTION === "dyefield") { AA.off = Math.PI; AA.fn = fn; return; }
    for (const off of [0, Math.PI]) {
      const y = 0.3, probe = { camYaw: y + off, camPitch: 0, eye: { x: 0, y: 0, z: 0 },
        foes: [{ x: -Math.sin(y) * 10, y: 0, z: -Math.cos(y) * 10, visible: true }],
        range: 50, firing: true, moving: true, dt: 1 / 60, strength: 1 };
      try { const r = fn(probe); if (r && r.slow < 1) { AA.off = off; AA.fn = fn; return; } } catch (e) {}
    }
  }).catch(() => {});
}
function aimAssistStep(W, inp, firing, moving, dt) {
  const res = AA.res;
  res.slow = 1; res.dyaw = 0; res.dpitch = 0;
  aimAssistLoad();
  const me = W.player;
  if (!AA.fn || !me || !me.weapon) return res;
  const def = K.WEAPONS[me.weapon.id];
  if (!def) return res;
  const strength = W.settings.aimAssist != null ? +W.settings.aimAssist : 1;
  if (!(strength > 0)) return res;
  const range = Math.min(150, def.falloff ? def.falloff[1] * 1.6 : 60);
  const cam = W.camera.position, eye = AA.eye;
  eye.x = cam.x; eye.y = cam.y; eye.z = cam.z;
  const cp = Math.cos(inp.pitch), fx = -Math.sin(inp.yaw) * cp, fy = Math.sin(inp.pitch), fz = -Math.cos(inp.yaw) * cp;
  const foes = AA.foes, pool = AA.pool;
  foes.length = 0;
  for (let i = 0; i < W.actors.length; i++) {
    const a = W.actors[i];
    if (a === me || !a.alive) continue;
    if (me.teamId && a.teamId === me.teamId) continue;
    const x = a.pos.x, y = a.pos.y + 1.2, z = a.pos.z;
    const dx = x - eye.x, dy = y - eye.y, dz = z - eye.z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > range * range || d2 < 1e-4) continue;
    // only targets near the reticle can matter to an 8 deg pull / 6 deg slowdown;
    // the line-of-sight march is paid for those few, never for the whole lobby
    const c = (dx * fx + dy * fy + dz * fz) / Math.sqrt(d2);
    if (c < 0.98) continue;                                    // ~11.5 deg
    const f = pool[foes.length] || (pool[foes.length] = { x: 0, y: 0, z: 0, visible: false });
    f.x = x; f.y = y; f.z = z;
    f.visible = !(W.map && W.map.losBlocked && W.map.losBlocked(eye.x, eye.y, eye.z, x, y, z));
    foes.push(f);
  }
  if (!foes.length) return res;
  let r = null;
  try {
    r = AA.fn({ camYaw: inp.yaw + AA.off, camPitch: inp.pitch, eye, foes, range, firing, moving, dt, strength,
                visible: (f) => !!f.visible, canSee: (f) => !!f.visible });
  } catch (e) { r = null; }
  if (r) { res.slow = Number.isFinite(r.slow) ? r.slow : 1; res.dyaw = +r.dyaw || 0; res.dpitch = +r.dpitch || 0; }
  return res;
}

// ── movement + physics ──────────────────────────────────────────────────────
const STEP_UP = 0.55;
const tmpV = new THREE.Vector3();

/** highest walkable support under (x,z) at or below y+STEP_UP */
export function supportAt(W, x, z, y) {
  return supportIn(W, W.map.queryColliders(x, z, 0.6), x, z, y);
}

/** supportAt over a collider list the caller already holds. queryColliders
 *  returns every collider in the 16 m grid cells its box touches, so a list
 *  queried around the actor with a radius that covers this frame's move is a
 *  SUPERSET of what a per-point query returns — and the exact footprint tests
 *  below make the answer identical. */
function supportIn(W, cols, x, z, y) {
  let s = W.map.heightAt(x, z);
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
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

/** Capsule side blocking for a move (x0,z0) -> (x,z) by an actor whose feet are
 *  at y. Two rules on top of the plain overlap test (bots S6 / VERIFY #12):
 *   - the head band is measured at the DESTINATION's floor height. The old
 *     test used the current feet, so walking up a slope or step under a slab
 *     only met the slab after the move — the support step then lifted the
 *     capsule INTO it;
 *   - a move that does not go deeper into a collider the capsule ALREADY
 *     overlaps is allowed. The old test refused every direction while
 *     overlapped, so an actor that ended up inside a slab (that slope, a
 *     landing under a deck) was pinned for good: bots were measured pinned
 *     200+ s at isla_viva (-46, 38.6, -34.8) and deepwood (490.5, 25.6, -366.3).
 *  Walls the capsule is not inside block exactly as before. */
function blockedIn(W, cols, x0, z0, x, z, y, h, isMove) {
  const r = K.PLAYERK.radius, r2 = r * r;
  const yd = isMove ? Math.max(y, supportIn(W, cols, x, z, y)) : y;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (c.kind === "ramp") {
      // C-RAMP (Wave 5, 5C): a ramp used to be skipped here, so its sides and
      // underside were walk-through (and the wedge under it a bullet-proof pocket).
      // It is a sloped slab: walkable from its low edge (supportIn lifts the capsule
      // onto it, so rampBlocks reads false there), its sides and underside block.
      // Same "already held" rule as a box: a capsule that is already inside the
      // slab's zone may leave, or slide, but not go deeper.
      if (!K.rampBlocks(c, x, z, yd, h, r, STEP_UP)) continue;
      if (isMove && K.rampBlocks(c, x0, z0, y, h, r, STEP_UP)) {
        const ex0 = x - K.clamp(x, c.minX, c.maxX), ez0 = z - K.clamp(z, c.minZ, c.maxZ);
        const ex1 = x0 - K.clamp(x0, c.minX, c.maxX), ez1 = z0 - K.clamp(z0, c.minZ, c.maxZ);
        if (ex0 * ex0 + ez0 * ez0 >= ex1 * ex1 + ez1 * ez1) continue;
      }
      return c;
    }
    if (c.maxY <= yd + STEP_UP || c.minY >= yd + h) continue;
    let ex = x - K.clamp(x, c.minX, c.maxX), ez = z - K.clamp(z, c.minZ, c.maxZ);
    const d2 = ex * ex + ez * ez;
    if (d2 >= r2) continue;
    if (isMove && c.maxY > y + STEP_UP && c.minY < y + h) {
      ex = x0 - K.clamp(x0, c.minX, c.maxX); ez = z0 - K.clamp(z0, c.minZ, c.maxZ);
      const d20 = ex * ex + ez * ez;
      if (d20 < r2 && d2 >= d20) continue;     // already inside it: leaving / sliding is fine
    }
    return c;
  }
  return null;
}

/** CORNER SLIDE. The axis move to (x,z) was refused by collider c. When the
 *  contact is one of c's vertical EDGES (the capsule centre lies outside the
 *  box's extent on BOTH axes: a door jamb, a building corner), a round capsule
 *  does not stop dead on it, it is deflected round the edge: the centre is
 *  pushed out to exactly the capsule radius from that edge, and the move is
 *  taken if nothing else blocks the result. Face contacts block exactly as
 *  before. Measured 2026-10-01 (T-tick-actors, probe_match): with every bot on
 *  full collision (L5 d) bots pinned themselves on door jambs and building
 *  corners - the bots.js walk grid keeps 0.3 m from a wall, the capsule is
 *  0.45 m - and stuck rose to 2.0-4.7 % of moving samples (16 episodes for one
 *  bot); with the slide 0.5-1.1 %. The push is at most the radius minus the
 *  distance already reached, i.e. never more than this frame's own move. */
function cornerSlide(W, cols, a, c, x, z, h) {
  if ((x >= c.minX && x <= c.maxX) || (z >= c.minZ && z <= c.maxZ)) return false;   // a face
  const cx = x < c.minX ? c.minX : c.maxX, cz = z < c.minZ ? c.minZ : c.maxZ;
  const ex = x - cx, ez = z - cz;
  const len = Math.sqrt(ex * ex + ez * ez);
  if (len < 1e-4) return false;
  const k = (K.PLAYERK.radius + 1e-3) / len;
  const px = cx + ex * k, pz = cz + ez * k;
  if (blockedIn(W, cols, a.pos.x, a.pos.z, px, pz, a.pos.y, h, true)) return false;
  a.pos.x = px; a.pos.z = pz;
  return true;
}

/** "does a standing capsule fit HERE" (the mantle's ledge probe): the plain
 *  overlap test at the given feet height, no move rules */
function blockedHoriz(W, x, z, y, h) {
  return blockedIn(W, W.map.queryColliders(x, z, K.PLAYERK.radius + 0.4), x, z, x, z, y, h, false);
}

/** ONE collider query per actor per frame: every movement test of this frame
 *  (X move, Z move, landing support) reads this list. queryColliders was the
 *  hottest function in the game (423 calls a frame at the audit); per actor it
 *  was 3 queries on the ground path, and far bots now run the full collision
 *  path instead of a terrain-only shortcut. The list is this module's own
 *  array (the map's shared scratch array is valid only until the next query). */
const _moveCols = [];
function moveCols(W, x, z, reach) {
  // + one more radius: a cornerSlide result lies up to a radius past the move
  return W.map.queryColliders(x, z, Math.max(K.PLAYERK.radius + 0.4, 0.6) + K.PLAYERK.radius + reach, _moveCols);
}
const _mb = { fx: 0, fz: 0, rx: 0, rz: 0 };   // K.moveBasis out-param (no per-frame object)

// ── FIXED TICK / FRAME SPLIT (contract C5) ──────────────────────────────────
// tick(W, dt) is the SIMULATION: every actor's movement + collision, run by the
// orchestrator at a fixed SIM_DT (1/60) whatever the display rate, so a jump, a
// fall or a sprint is the same distance at 20 Hz and at 165 Hz (BLOCKTOOTH
// loop.ts). frame(W, dt, alpha) is the VIEW, once per rendered frame with the
// real frame dt (W.frameDt): each actor drawn between its pose before the last
// tick and its pose after it (alpha = the fraction of a tick elapsed since), the
// camera (the human's mouse look read from the LIVE input every frame, not from
// the last tick), then the view pass. update(W, dt) = tick + frame(alpha = 1):
// exactly the old one-call behaviour, for any caller that does not split.
let _tickN = 0;
const TELEPORT2 = 6 * 6;   // a > 6 m jump inside one tick (spawn, portal, net snap) is drawn, not interpolated

export function tick(W, dt) {
  // SIM: every actor runs the SAME movement and collision whatever the camera
  // is doing. The old far-bot LOD (> 250 m from the camera: terrain-only moves,
  // no walls, no roofs, no launch portals, no footsteps) made the simulation
  // depend on where the human looked — a far bot walked through buildings and a
  // spectator's camera changed the match. LOD is a VIEW question and lives in
  // viewPass below; it drops animation and detail, never collision (bots S6).
  _tickN++;
  let anyDrop = false;
  const actors = W.actors;
  for (let i = 0; i < actors.length; i++) {
    const a = actors[i];
    if (!a.alive) { a._vmode = 0; if (a._sinkT >= 0) corpseStep(W, a, dt); continue; }
    a._pp.copy(a.pos); a._pyaw = a.yaw; a._ppT = _tickN;
    a._vmode = 0;
    if (a.netRemote) { interpRemote(W, a, dt); continue; }
    stepActor(W, a, dt);
    if (a.gliding) anyDrop = true;
  }
  if (W.phase === "drop" && !anyDrop) W.phase = "match";
}

export function frame(W, dt, alpha) {
  const k = alpha >= 0 && alpha < 1 ? alpha : 1;
  const actors = W.actors;
  for (let i = 0; i < actors.length; i++) {
    const a = actors[i];
    a._synced = false;
    if (!a.alive || !a._vmode) continue;
    if (k < 1 && a._ppT === _tickN && a._pp.distanceToSquared(a.pos) < TELEPORT2) a.obj.position.lerpVectors(a._pp, a.pos, k);
    else a.obj.position.copy(a.pos);
    if (a._vmode === 1) syncObj(W, a, dt);
  }
  updateCamera(W, dt, k);
  viewPass(W, dt);
}

export function update(W, dt) {
  tick(W, dt);
  frame(W, dt, 1);
}

/** Shortest-arc angle lerp (yaw wraps at +-pi). */
function lerpAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

// ── VIEW PASS: shadows, LOD, mixer policy, culling, name tags ───────────────
// Runs after the camera has moved this frame. LOD is a VISIBILITY question, so
// it measures from the render viewpoint (never W.player.pos, which stops moving
// at death while the camera spectates on), and in SCREEN terms: the distance is
// scaled by the zoom, so a bot 300 m away through a 20-degree sniper scope is
// treated like one ~100 m away with the naked eye instead of a frozen statue.
const TAN_BASE = Math.tan((57 / 2) * Math.PI / 180);   // default vertical fov
const SHADOW_BODY_M = 45, SHADOW_WPN_M = 20, GLIDE_SHADOW_AGL = 40;
const LOD1_IN = 37, LOD1_OUT = 33;                   // hysteresis around ~35 m (screen-scaled)
const MIX_SKIP_M = 250, MIX_FULL_M = 40, MIX_HALF_M = 120;
const _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4(), _vSph = new THREE.Sphere(), _camW = new THREE.Vector3();

function viewPass(W, dt) {
  const cam = W.camera;
  if (!cam) return;
  cam.updateMatrixWorld();
  _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_pm);
  _camW.setFromMatrixPosition(cam.matrixWorld);
  const fovK = Math.tan((cam.fov || 57) * Math.PI / 360) / TAN_BASE;
  const focus = W._camFocus;
  const actors = W.actors;
  for (let i = 0; i < actors.length; i++) {
    const a = actors[i];
    if (a.alive && a.rig) actorView(W, a, focus, fovK);
  }
  // clip selection + the pose layers, for every actor whose transform was
  // synced this frame (emotes and mantles own their pose, as before)
  for (let i = 0; i < actors.length; i++) if (actors[i]._synced) animate(W, actors[i], dt);

  // nametags: hide the camera-focus actor's own tag (it fills the screen when
  // spectating) and cull tags beyond readable range
  const camPos = W.camera.position;
  const wl = W.wpnLOD || 110, wl2 = wl * wl;
  for (let i = 0; i < actors.length; i++) {
    const a = actors[i];
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
    // && !emoting: HOLSTER DURING EMOTES (genre standard) — the weld
    // disengages while an emote clip owns the arms, which left the gun on the
    // stale static grip: spectators saw kill-taunting bots "holding the gun
    // backwards" (owner screenshots x2). This line is the ONE authority on
    // weapon visibility per frame — a separate toggle elsewhere just lost the
    // write race against it.
    // && !gliding (P1.5): the raised hand under the canopy / in the dive held a
    // pistol in the drop shots (LOOK/camera-characters/shots/03_parachute_tpp.png);
    // nobody shoots from a parachute, and the weapon is back on the first grounded
    // frame because this line runs every frame. Also one fewer draw per nearby glider.
    if (a.weaponMesh) a.weaponMesh.visible = d2 < wl2 && !a.emoting && !a.gliding;
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

/** Point one actor's body material at the rim colour/strength for `mode` (1 =
 *  everyone's faint cool edge, 2 = SQUAD UP ally). The uniform objects exist only
 *  after the material's first compile (onBeforeCompile), so before that this does
 *  nothing and the next frame retries; the default values already ARE mode 1. */
function applyRim(a, mode) {
  const b = a._bodies && a._bodies[0];
  const ud = b && b.material && b.material.userData;
  if (!ud || !ud.zRimCol) return;
  ud.zRimCol.value.setHex(mode === 2 ? RIM_ALLY : RIM_COOL);
  ud.zRimP.value.set(mode === 2 ? RIM_ALLY_NEAR : RIM_NEAR, mode === 2 ? RIM_ALLY_FAR : RIM_FAR);
  a._rimMode = mode;
}

/** One live actor's view state for this frame. */
function actorView(W, a, focus, fovK) {
  const p = a.obj.position;
  const dx = p.x - _camW.x, dy = p.y - _camW.y, dz = p.z - _camW.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const dEff = d * fovK;
  a._dEff = dEff;
  const isFocus = a === focus || a === W.player;
  // RIM (P1.8 / D12): everyone wears the faint cool edge; a SQUAD UP teammate wears
  // the green one. teamId is set by net.js (null offline), so every offline match
  // and every bot keeps mode 1 by construction. Two integer compares per actor.
  const rimWant = (a.teamId && W.player && a !== W.player && a.teamId === W.player.teamId) ? 2 : 1;
  if (a._rimMode !== rimWant) applyRim(a, rimWant);
  // ON SCREEN: a sphere round the whole actor (canopy included while it is up)
  _vSph.center.copy(p);
  if (a.chute) { _vSph.center.y += 2.4; _vSph.radius = 3.9; } else { _vSph.center.y += BODY_SPHERE_Y; _vSph.radius = BODY_SPHERE_R; }
  const onScreen = isFocus || _frustum.intersectsSphere(_vSph);

  // (a) NEAR-ONLY SHADOWS. Every actor cast a skinned shadow at any range: 86.5%
  // of the drop frame's triangles were character shadows (audit: 8.57 M of
  // 9.91 M). A body casts within 45 m, except while gliding more than 40 m above
  // the ground (its shadow lands on terrain far below, a blur at best); a held
  // weapon casts within 20 m. The local player is ~4 m from the camera, so the
  // player's own shadow on landing is unaffected.
  const bodyShadow = d < SHADOW_BODY_M && !(a.gliding && (a._agl || 0) > GLIDE_SHADOW_AGL);
  if (bodyShadow !== a._bodyShadow) {
    a._bodyShadow = bodyShadow;
    for (let i = 0; i < a._bodies.length; i++) a._bodies[i].castShadow = bodyShadow;
  }
  if (a.weaponMesh !== a._wpnRef) {
    // weapons.js swaps the held mesh asynchronously (proto clone); re-collect
    a._wpnRef = a.weaponMesh;
    const list = a._wpnMeshes || (a._wpnMeshes = []);
    list.length = 0;
    if (a.weaponMesh) a.weaponMesh.traverse((o) => { if (o.isMesh) list.push(o); });
    a._wpnShadow = null;
  }
  const wpnShadow = d < SHADOW_WPN_M;
  if (wpnShadow !== a._wpnShadow && a._wpnMeshes) {
    a._wpnShadow = wpnShadow;
    for (let i = 0; i < a._wpnMeshes.length; i++) a._wpnMeshes[i].castShadow = wpnShadow;
  }

  // (b) LOD1 beyond ~35 m on screen: the same SkinnedMesh (skeleton, bind
  // matrix, cloned material, fixed bounding sphere) wearing the ~2.5k-tri body.
  // The camera focus always keeps LOD0.
  if (a._lod1Geo && a._bodies.length) {
    const want = isFocus ? 0 : (a._lod === 1 ? (dEff > LOD1_OUT ? 1 : 0) : (dEff > LOD1_IN ? 1 : 0));
    if (want !== a._lod) {
      a._lod = want;
      a._bodies[0].geometry = want ? a._lod1Geo : a._lod0Geo;
    }
  }

  // (c) MIXER POLICY via the kernel's C4 flags (timeScale 0 still evaluated
  // every binding in three r172 — the old "LOD" paid full price). The flags set
  // here are read by NEXT frame's mixer step; `_evalNow` records whether THIS
  // frame's step re-keyed the bones (the pose layers below depend on it).
  const m = a.rig.mixer;
  a._evalNow = m.time !== a._mixT;
  a._mixT = m.time;
  a._skipUsed = m._ffgSkip === true;
  let skip = false, rate = 1;
  if (!isFocus) {
    if (dEff > MIX_SKIP_M) skip = true;
    else if (!onScreen) { if (bodyShadow) rate = 2; else skip = true; }     // its shadow may still be in view
    else rate = dEff <= MIX_FULL_M ? 1 : dEff <= MIX_HALF_M ? 2 : 4;
  }
  m._ffgSkip = skip;
  m._ffgRate = rate;
  a._onScreen = onScreen;
}

// shared option objects for per-frame playAnim calls (playAnim and the kernel's
// play() only READ them) — an object literal per actor per frame was most of
// syncObj's 11 KB/frame allocation in framecheck's heap sampling
const PA_ONCE = { once: true }, PA_FREEZE = { timeScale: 0 }, PA_DIVE = { timeScale: 0.05 };
const PA_JUMP = { once: true, startAt: JUMP_TAKEOFF_S }, _paTs = { timeScale: 1 };
const paTs = (ts) => { _paTs.timeScale = ts; return _paTs; };
const FAM_KEYS = { rifle: { idle: "rifle_idle", walk: "rifle_walk", run: "rifle_run" } };

function stepActor(W, a, dt) {
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
  // The modal / rare branches live in their own functions (glideStep,
  // emoteStep, mantleStep, portalStep, swimStep, mantleTrigger): one rarely
  // taken branch hit for the first time used to throw this whole hot function
  // back out of optimized code (V8 kept stepActor in its baseline / mid tier for
  // the whole match — measured with %GetOptimizationStatus — and the boxed
  // doubles that tier allocates were most of player.js's per-frame garbage).
  if (a.gliding) { glideStep(W, a, inp, dt); return; }
  a._agl = 0;


  // CHUTE SAFETY NET: whatever exotic path ended a glide without the normal
  // landing branch (roof clip, mantle interrupt, a mid-toggle race), a canopy
  // must never survive on a grounded actor (owner: "the parachute is still
  // stuck on him as im on the ground"). netRemote chutes are driven by stance
  // bits — leave those to the net layer.
  if (a.chute && !a.gliding && a.onGround && !a.netRemote) removeChute(a);

  // EMOTES: dance/cheer on the spot (B / N). Starts only grounded + safe;
  // any human input cancels; bots ride the timer (or cancel when shot).
  if (inp.emote) emoteStart(W, a, inp);
  if (a.emoting && emoteStep(W, a, inp, dt)) return;

  // ── MANTLE — modal, like emoting: a short scripted up-and-over ───────────
  // (trigger lives in the airborne integrate below). Vertical-first arc:
  // rise through the first 60% of the window, translate through the last —
  // a straight lerp clips the capsule's chest through the ledge lip.
  if (a.mantleT != null) { mantleStep(a, dt); return; }

  // LAUNCH PORTALS: walk into a ring → flung back into the atmosphere, canopy
  // auto-opens on the way down (Final Drop-style island escape / rotation)
  if (W.map.portals && !a._portalBoost && W.t - (a._portalT || 0) > 2.5) portalCheck(W, a);
  // portal ascent: ballistic climb at half gravity (~80m), then hand over to
  // the skydive — canopy failsafe auto-opens at 60m on the way down
  if (a._portalBoost) { portalStep(W, a, dt); return; }

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
  const GB = K.moveBasis(a.yaw, _mb);
  const dx = GB.rx * inp.mx + GB.fx * inp.mz, dz = GB.rz * inp.mx + GB.fz * inp.mz;
  const dl = Math.sqrt(dx * dx + dz * dz) || 1;
  const tx = (dx / dl) * wspd * (Math.abs(inp.mx) + Math.abs(inp.mz) > 0 ? 1 : 0);
  const tz = (dz / dl) * wspd * (Math.abs(inp.mx) + Math.abs(inp.mz) > 0 ? 1 : 0);
  const k = (a.onGround || a.swimming) ? Math.min(1, dt / K.MOVE.accelT) : K.MOVE.airControl * Math.min(1, dt / K.MOVE.accelT);
  a.vel.x += (tx - a.vel.x) * k;
  a.vel.z += (tz - a.vel.z) * k;

  a.sprinting = sprinting;   // heal-gated, so the run anim + FOV kick match the real speed

  if (a.swimming) swimStep(W, a, inp, dt, wy);
  else {
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

    // integrate — X then Z with wall blocking, then Y with support. EVERY actor,
    // at any distance from the camera (the old far-bot branch moved on terrain
    // only: through walls, under roofs). One collider query covers all three.
    const h = K.PLAYERK.height;
    const mvx = a.vel.x * dt, mvz = a.vel.z * dt;
    const cols = moveCols(W, a.pos.x, a.pos.z, Math.abs(mvx) + Math.abs(mvz));
    {
      let hitWall = false;
      const nx = a.pos.x + mvx;
      let bc = blockedIn(W, cols, a.pos.x, a.pos.z, nx, a.pos.z, a.pos.y, h, true);
      if (!bc) a.pos.x = nx;
      else if (!cornerSlide(W, cols, a, bc, nx, a.pos.z, h)) { a.vel.x = 0; hitWall = true; }
      const nz = a.pos.z + mvz;
      bc = blockedIn(W, cols, a.pos.x, a.pos.z, a.pos.x, nz, a.pos.y, h, true);
      if (!bc) a.pos.z = nz;
      else if (!cornerSlide(W, cols, a, bc, a.pos.x, nz, h)) { a.vel.z = 0; hitWall = true; }
      // MANTLE trigger (research: ironhold ships it; the movement scorecard
      // rated it the missing S-effort verb): airborne, pushing forward INTO a
      // wall, and a ledge top within hand reach — above the 0.55 auto-step,
      // below feet+2.35 (jump apex 1.38 + arm reach). Headroom probe: a
      // support queried from ledge+2.2 that comes back ABOVE the ledge means
      // a slab in the pull-up space; the capsule-fits check covers walls.
      // Humans only — the bot aim/nav model doesn't need it and brains would
      // trip it on every wall they rub.
      if (hitWall && !a.onGround && !a.isBot && !a.netRemote && !a.gliding &&
          !a.swimming && inp.mz > 0 && a.vel.y < 6) mantleTrigger(W, a, h);
    }
    const feetY0 = a.pos.y;
    a.pos.y += a.vel.y * dt;

    // `cols` is still this frame's list: the mantle probes above use their own
    // queries (and only on the rare frame a human pushes into a ledge), which
    // never touch this module-owned array
    // WAVE-7 completion (lane D3): the floor is probed from the HIGHER of the feet before and after
    // gravity (K.supportProbeY), the height blockedIn already used to decide a box was a step, not a wall.
    // Probing from the lowered feet left a window (gravity * dt^2 = 5.5 mm on the ground, more in a fall)
    // where a box 0.544-0.550 m over the feet was neither a wall nor liftable: the capsule walked 0.6-1.3 m
    // into the rock and sank (5 of 13,432 swept rock sprints). A tick that does not fall is untouched.
    let sup = supportIn(W, cols, a.pos.x, a.pos.z, K.supportProbeY(feetY0, a.pos.y));
    // LANDING SWEEP (Wave 5, 5C). supportIn is a POINT test (tops <= feet + STEP_UP), and
    // a faller covers more than STEP_UP per tick past ~33 m/s (a drop of ~27 m: a sky
    // island, the crane), so a 0.3 m roof slab fell between two ticks and the actor
    // landed on the ground inside the building. Test the feet SEGMENT: a top the feet
    // crossed this tick wins. Ticks that moved <= STEP_UP are untouched (-Infinity).
    if (feetY0 - a.pos.y > STEP_UP) {
      const swept = K.sweepSupport(cols, a.pos.x, a.pos.z, feetY0, a.pos.y, STEP_UP);
      if (swept > sup) sup = swept;
    }
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
  if (a.onGround && !a.swimming) {
    const sp2 = Math.sqrt(a.vel.x * a.vel.x + a.vel.z * a.vel.z);
    if (sp2 > 1.5) {
      a._stepAcc = (a._stepAcc || 0) + sp2 * dt;
      const stride = a.sprinting ? 3.2 : 2.4;
      if (a._stepAcc >= stride) { a._stepAcc = 0; W.events.emit("footstep", a); }
    } else a._stepAcc = 0;
  }

  clampToMap(W, a);
  a._vmode = 1;                 // frame() draws it (interpolated) and runs syncObj
}

/** Glide phase — real skydive: fast belly-down freefall with forward momentum + steering, then an auto-deployed parachute for the final stretch (Final Drop / Fortnite structure). */
function glideStep(W, a, inp, dt) {
  // landing surface = terrain OR any collider top (floating sky-islands,
  // roofs) — heightAt alone made parachuters fall straight through them
  const g = supportAt(W, a.pos.x, a.pos.z, a.pos.y);
  const landY = Math.max(g, W.map.waterY);
  const agl = a.pos.y - landY;
  a._agl = agl;                       // the view pass drops a high glider's shadow

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
  const B = K.moveBasis(a.yaw, _mb);
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
  a._vmode = 1;                 // frame() draws it (interpolated) and runs syncObj
}

/** EMOTES: dance/cheer on the spot (B / N). Starts only grounded + safe. */
function emoteStart(W, a, inp) {
  if (a.onGround && !a.swimming && !a.emoting && (a.clips.dance || a.clips.cheer)) {
    a.emoting = { t: 4.2 };
    if (a.hand) a.hand.visible = false; // holster while emoting
    playAnim(a, a.clips[inp.emote] ? inp.emote : "cheer", { once: true, force: true });
    W.events.emit("emote", a, inp.emote);
  }
  inp.emote = null;
}

/** Any human input cancels an emote; bots ride the timer (or cancel when shot). true = the emote owns this frame. */
function emoteStep(W, a, inp, dt) {
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
    const supE = supportAt(W, a.pos.x, a.pos.z, a.pos.y);
    if (a.pos.y <= supE + 0.02) { a.pos.y = supE; a.vel.y = 0; }
    a._vmode = 2;               // frame() moves it; the emote clip owns the pose
    return true;
  }
  return false;
}

/** MANTLE — the scripted up-and-over arc (vertical first, then across the lip). */
function mantleStep(a, dt) {
  a.mantleT -= dt;
  const mk = 1 - Math.max(0, a.mantleT) / 0.45;
  const up = Math.min(1, mk / 0.6), fwd = Math.max(0, (mk - 0.4) / 0.6);
  const su = up * up * (3 - 2 * up), sf = fwd * fwd * (3 - 2 * fwd);
  a.pos.y = a._mFrom.y + (a._mTo.y - a._mFrom.y) * su;
  a.pos.x = a._mFrom.x + (a._mTo.x - a._mFrom.x) * sf;
  a.pos.z = a._mFrom.z + (a._mTo.z - a._mFrom.z) * sf;
  a.vel.set(0, 0, 0);
  if (a.mantleT <= 0) { a.mantleT = null; a.onGround = true; }
  a._vmode = 2;                 // frame() moves it; the mantle owns the pose
}

/** LAUNCH PORTALS: walk into a ring -> flung back into the atmosphere. */
function portalCheck(W, a) {
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

/** Portal ascent: ballistic climb at half gravity, then hand over to the skydive. */
function portalStep(W, a, dt) {
  a.vel.y += K.MOVE.gravity * 0.55 * dt;
  a.pos.addScaledVector(a.vel, dt);
  if (a.vel.y <= 2) {
    a._portalBoost = false;
    a.gliding = true;
    a.chuteToggled = false;
  }
  clampToMap(W, a);
  a._vmode = 1;                 // frame() draws it (interpolated) and runs syncObj
}

/** Swimming: buoyancy at the surface, collision against hulls/piers, haul-out onto a ledge. */
function swimStep(W, a, inp, dt, wy) {
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
  const swimH = K.PLAYERK.height, swimFeet = a.pos.y + 0.45;
  const smx = a.vel.x * dt, smz = a.vel.z * dt;
  const scols = moveCols(W, a.pos.x, a.pos.z, Math.abs(smx) + Math.abs(smz));
  const sx = a.pos.x + smx;
  if (!blockedIn(W, scols, a.pos.x, a.pos.z, sx, a.pos.z, swimFeet, swimH, true)) a.pos.x = sx; else a.vel.x = 0;
  const sz = a.pos.z + smz;
  if (!blockedIn(W, scols, a.pos.x, a.pos.z, a.pos.x, sz, swimFeet, swimH, true)) a.pos.z = sz; else a.vel.z = 0;
  // HAUL OUT. This branch pins pos.y to the water surface every single frame
  // and never consulted supportAt, so water was a ONE-WAY TRAPDOOR: every
  // pier, boat deck, shipwreck and stilt hut could be dropped onto from the
  // sky but never re-boarded on foot. Anything you swam to was a dead end.
  // Probe for a ledge and climb onto it. supportAt already returns the
  // structure top when one is within STEP_UP of the probe height, so passing
  // the swimmer's chest gives exactly "a surface I could pull myself onto";
  // requiring it to sit above the waterline keeps the SEABED from qualifying,
  // which would otherwise beach the swimmer in open water.
  const ledge = supportIn(W, scols, a.pos.x, a.pos.z, a.pos.y + 0.9);
  if (ledge > wy - 0.25 && ledge <= a.pos.y + 0.9) {
    a.pos.y = ledge;
    a.onGround = true; a.swimming = false; a.inWater = false;
    a.vel.y = 0;
    W.events.emit("swimState", a, false);
  }
}

/** MANTLE trigger: airborne, pushing forward INTO a wall, a ledge top within hand reach and headroom above it (humans only). */
function mantleTrigger(W, a, h) {
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


function clampToMap(W, a) {
  const H = W.map.half;
  a.pos.x = K.clamp(a.pos.x, -H, H);
  a.pos.z = K.clamp(a.pos.z, -H, H);
}

// ── parachute (canopy dome + 2 white gores + suspension lines) ──────────────
// EVERY canopy in the lobby is ONE InstancedMesh (dome and gores merged into
// one geometry; the gore mask rides in the vertex colour and the canopy colour
// in instanceColor) plus ONE LineSegments holding every chute's suspension
// lines in world space. The composed version built a Group, 4 meshes, 3
// SphereGeometries, 3 materials and a line geometry on EVERY deploy — and SPACE
// toggles the chute — so the drop cluster paid ~4 draw calls per canopy (200 of
// 482) and GPU geometries climbed +3 per toggle without ever coming back.
// Deploy/remove now only add/remove the actor from a list; instances are packed
// from the actors' current transforms right before each render (render hook).
const CHUTE_COLORS = [0xe0685a, 0x57b0ff, 0xf2c14e, 0x7fb069, 0xb05cf0, 0x22d3a0];
const CHUTE_MAX = 64;
// suspension lines, chute space: rim -> shoulders (6 pairs)
// (a `let`: P2.6 replaces it with the lines of assets/props/canopy.json when that file loads)
let CHUTE_LINES = new Float32Array(36);
for (let i = 0; i < 6; i++) {
  const ang = (i / 6) * Math.PI * 2;
  CHUTE_LINES.set([Math.cos(ang) * 1.55, 3.65, Math.sin(ang) * 1.55, Math.cos(ang) * 0.25, 1.55, Math.sin(ang) * 0.18], i * 6);
}
const CH = { mesh: null, lines: null, list: [] };
const _cm = new THREE.Matrix4(), _cr = new THREE.Matrix4();

function ensureChute() {
  if (CH.mesh) return CH;
  // dome: top half-sphere squashed; alternating gores read as a real canopy.
  // The old per-mesh transforms (scale.y 0.6, y 3.6, second gore turned 180
  // deg) are baked into the vertices.
  const parts = [
    new THREE.SphereGeometry(1.7, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.SphereGeometry(1.72, 12, 6, 0, Math.PI / 4, 0, Math.PI / 2),
    new THREE.SphereGeometry(1.72, 12, 6, 0, Math.PI / 4, 0, Math.PI / 2).rotateY(Math.PI),
  ];
  const mask = [0, 1, 1];
  let nv = 0, ni = 0;
  for (const g of parts) { g.scale(1, 0.6, 1); g.translate(0, 3.6, 0); nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3);
  const idx = new Uint16Array(ni);
  let vo = 0, io = 0;
  parts.forEach((g, p) => {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    for (let k = 0; k < c; k++) col[(vo + k) * 3] = mask[p];
    const ia = g.index.array;
    for (let k = 0; k < ia.length; k++) idx[io + k] = ia[k] + vo;
    vo += c; io += ia.length;
    g.dispose();
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
  // canopy colour where the mask is 0, white gores where it is 1 (instanceColor
  // would otherwise MULTIPLY into the gores and tint them)
  mat.customProgramCacheKey = () => "lcChuteGore";
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <color_vertex>",
      "#include <color_vertex>\n#if defined( USE_INSTANCING_COLOR ) && defined( USE_COLOR )\n  vColor.xyz = mix( instanceColor.xyz, vec3( 1.0 ), color.r );\n#endif");
  };
  const mesh = new THREE.InstancedMesh(geo, mat, CHUTE_MAX);
  mesh.name = "actor-chute";
  mesh.setColorAt(0, new THREE.Color(0xffffff));      // allocates instanceColor now: no program variant change later
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.visible = false;
  mesh.frustumCulled = false;                          // instances are anywhere on the map
  mesh.castShadow = false; mesh.receiveShadow = false; // as the composed canopy (Mesh defaults)
  const lgeo = new THREE.BufferGeometry();
  const lpos = new THREE.BufferAttribute(new Float32Array(CHUTE_MAX * CHUTE_LINES.length), 3);
  lpos.setUsage(THREE.DynamicDrawUsage);
  lgeo.setAttribute("position", lpos);
  lgeo.setDrawRange(0, 0);
  const lines = new THREE.LineSegments(lgeo, new THREE.LineBasicMaterial({ color: 0x444444 }));
  lines.name = "actor-chute-lines";
  lines.frustumCulled = false;
  lines.visible = false;
  CH.mesh = mesh; CH.lines = lines;
  return CH;
}

// ── P2.6: the ram-air canopy (assets/props/canopy.glb + canopy.json) ─────────────────────
// A half-sphere dome was a primitive used as final art. When ART-A's canopy is on the server it
// REPLACES the dome geometry inside the very same InstancedMesh (still ONE draw for every canopy
// in the lobby, instanceColor still paints it) and the suspension lines come from canopy.json
// (still ONE LineSegments). Contract C-ART-CANOPY: one mesh node named Canopy, COLOR_0 = the gore
// mask (red channel, 1 = white gore), metres, +Y up, nose toward -Z, origin at the harness hang
// point; canopy.json {lines:[{x,y,z}...], span, hang:{x,y,z}} where `lines` is a list of segment
// END POINT PAIRS (lines[2i] on the canopy underside, lines[2i+1] on the riser) and `hang` is where
// the canopy's origin sits in ACTOR space (shoulder height on the centreline). The json is fetched
// first (tiny): a server without the canopy answers ONE 404, not two. Anything missing, malformed
// or over budget leaves the dome exactly as it was.
// hang*: the point (actor space) where the canopy frame hangs from the body = where its risers end
// (the dome's lines end at the shoulders, 1.55 m; canopy.json `hang` replaces it). refreshChutes reads it.
const CANOPY = { state: "none", tris: 0, lines: 0, span: 0, hangX: 0, hangY: 1.55, hangZ: 0 };
const CANOPY_HANG_DEFAULT = { x: 0, y: 1.55, z: 0 };   // the shoulders the dome's lines ended at too
const CANOPY_MAX_TRIS = 6000;
async function loadCanopy(W) {
  if (CANOPY.state !== "none") return;
  CANOPY.state = "loading";
  try {
    const base = W.assetBase + "assets/props/canopy";
    // bounded like every GLB here: a request that never settles must not wedge the match start
    const ac = typeof AbortController === "function" ? new AbortController() : null;
    const abortT = ac ? setTimeout(() => ac.abort(), W.kernel.loadTimeoutMs > 0 ? W.kernel.loadTimeoutMs : 30000) : 0;
    let r;
    try { r = await fetch(base + ".json", ac ? { cache: "force-cache", signal: ac.signal } : { cache: "force-cache" }); }
    finally { clearTimeout(abortT); }
    if (!r || !r.ok) { CANOPY.state = "absent"; return; }
    const info = await r.json();
    const ln = info && info.lines;
    if (!Array.isArray(ln) || ln.length < 4 || ln.length > 128 || (ln.length & 1) || !ln.every((q) => q && isFinite(q.x) && isFinite(q.y) && isFinite(q.z))) { CANOPY.state = "bad-json"; return; }
    const hang = info.hang && isFinite(info.hang.x) && isFinite(info.hang.y) && isFinite(info.hang.z) ? info.hang : CANOPY_HANG_DEFAULT;
    const g = await loadBounded(W, base + ".glb");
    let mesh = null;
    g.scene.updateMatrixWorld(true);
    g.scene.traverse((o) => { if (o.isMesh && (o.name === "Canopy" || !mesh)) mesh = o; });
    if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) { CANOPY.state = "no-mesh"; return; }
    const src = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const n = src.attributes.position.count;
    const tris = src.index ? src.index.count / 3 : n / 3;
    if (tris > CANOPY_MAX_TRIS || n > 65535) { CANOPY.state = "over-budget"; return; }
    // the actor faces +Z (rig space) and the canopy's nose points -Z: half a turn, then up to the shoulders it hangs from
    src.rotateY(Math.PI);
    src.translate(hang.x, hang.y, hang.z);
    if (!src.attributes.normal) src.computeVertexNormals();
    const col = new Float32Array(n * 3);
    const ca = src.attributes.color;
    if (ca) for (let i = 0; i < n; i++) col[i * 3] = ca.getX(i);          // the red channel is the gore mask
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(src.attributes.position.array), 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(src.attributes.normal.array), 3));
    geo.setAttribute("uv", src.attributes.uv ? new THREE.BufferAttribute(new Float32Array(src.attributes.uv.array), 2) : new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    if (src.index) geo.setIndex(new THREE.BufferAttribute(new Uint16Array(src.index.array), 1));
    src.dispose();
    // suspension lines: the same half turn and lift as the geometry; consecutive point pairs are segments
    const L = new Float32Array(ln.length * 3);
    ln.forEach((q, i) => { L[i * 3] = -q.x + hang.x; L[i * 3 + 1] = q.y + hang.y; L[i * 3 + 2] = -q.z + hang.z; });
    ensureChute();
    const old = CH.mesh.geometry;
    CH.mesh.geometry = geo;
    old.dispose();
    CHUTE_LINES = L;
    // the line batch is sized from CHUTE_LINES: rebuild its buffer for the new segment count
    const lpos = new THREE.BufferAttribute(new Float32Array(CHUTE_MAX * L.length), 3);
    lpos.setUsage(THREE.DynamicDrawUsage);
    const lg = CH.lines.geometry;
    CH.lines.geometry = new THREE.BufferGeometry();
    CH.lines.geometry.setAttribute("position", lpos);
    CH.lines.geometry.setDrawRange(0, 0);
    lg.dispose();
    CANOPY.state = "loaded"; CANOPY.tris = tris; CANOPY.lines = ln.length / 2; CANOPY.span = +info.span || 0;
    CANOPY.hangX = +hang.x; CANOPY.hangY = +hang.y; CANOPY.hangZ = +hang.z;
  } catch (e) {
    CANOPY.state = "failed";
    console.warn("[chars] canopy not loaded, keeping the dome:", e && e.message);
  }
}
/** probe read-back: which canopy is in use */
export function canopyStats() { return Object.assign({}, CANOPY, { instances: CH.mesh ? CH.mesh.count : 0, triangles: CH.mesh && CH.mesh.geometry.index ? CH.mesh.geometry.index.count / 3 : 0 }); }

function deployChute(W, a) {
  if (a.chute) return;
  ensureChute();
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
  // a.chute is a reusable per-actor handle (truthy while deployed — hud.js,
  // net.js and the harness read `!!a.chute`); nothing is allocated per deploy
  const h = a._chuteH || (a._chuteH = { color: new THREE.Color(), actor: a });
  h.color.setHex(color);
  a.chute = h;
  if (CH.list.indexOf(a) < 0 && CH.list.length < CHUTE_MAX) CH.list.push(a);
  W.events.emit("chuteDeployed", a);
}
function removeChute(a) {
  if (!a.chute) return;
  a.chute = null;
  const i = CH.list.indexOf(a);
  if (i >= 0) CH.list.splice(i, 1);
}
function hashCode(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

/** Pack every deployed canopy into the instance + line buffers from the
 *  actors' CURRENT world matrices. The canopy frame is UPRIGHT (the body's yaw,
 *  plus its bank in turns) and HUNG AT THE BODY'S REAL SHOULDER POINT, so the
 *  risers end on the shoulders however the body sways under the wing. (It used
 *  to be the body matrix times Rx(-tiltX), pivoting at the FEET: the body's
 *  Euler order is XYZ, so that tilt is about the WORLD x axis and the "counter-
 *  rotation" only cancelled it at yaw 0; at other headings the wing sat ~1 m
 *  off the shoulders with the lines ending in mid-air, which the symmetric dome
 *  hid and the ram-air wing shows: player_canopy side view, 2026-10-12.)
 *  A body killed under its canopy loses it at once (startCorpse). */
const _cq = new THREE.Vector3(), _cv = new THREE.Vector3();
function refreshChutes() {
  const mesh = CH.mesh;
  if (!mesh || !mesh.parent) return 0;
  const im = mesh.instanceMatrix.array, lp = CH.lines.geometry.attributes.position.array;
  const hx = CANOPY.hangX, hy = CANOPY.hangY, hz = CANOPY.hangZ;
  let n = 0;
  for (let i = 0; i < CH.list.length; i++) {
    const a = CH.list[i];
    if (!a.chute || !a.obj.parent) { CH.list.splice(i, 1); i--; continue; }
    _cq.set(hx, hy, hz).applyMatrix4(a.obj.matrixWorld);                      // the shoulders, where the body really is
    _cm.makeRotationY(a.obj.rotation.y).multiply(_cr.makeRotationZ(a._tiltZ || 0));
    _cv.set(hx, hy, hz).applyMatrix4(_cm);
    _cm.setPosition(_cq.x - _cv.x, _cq.y - _cv.y, _cq.z - _cv.z);            // M = T(shoulders) . R . T(-hang)
    _cm.toArray(im, n * 16);
    mesh.setColorAt(n, a.chute.color);
    const e = _cm.elements, nl = CHUTE_LINES.length, b = n * nl;
    for (let k = 0; k < nl; k += 3) {
      const x = CHUTE_LINES[k], y = CHUTE_LINES[k + 1], z = CHUTE_LINES[k + 2];
      lp[b + k] = e[0] * x + e[4] * y + e[8] * z + e[12];
      lp[b + k + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      lp[b + k + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
    n++;
  }
  mesh.count = n;
  mesh.visible = n > 0;
  CH.lines.visible = n > 0;
  CH.lines.geometry.setDrawRange(0, n * (CHUTE_LINES.length / 3));
  if (n) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    CH.lines.geometry.attributes.position.needsUpdate = true;
  }
  return n;
}

// ── render hook: instanced actor parts are packed right before each render ──
// three r172 calls scene.onBeforeRender after its matrix update and BEFORE
// culling/upload, so buffers written here are the ones this frame draws (an
// object's own onBeforeRender runs after upload: a frame late). Chained, so any
// other user of the hook keeps working. Inactive outside drop/match/over: the
// lobby keeps whatever the warm-up parked (count 1, far below the world).
function installRenderHook(W) {
  const scene = W.scene;
  if (!scene || scene.__lcActorHook) return;
  const prev = scene.onBeforeRender;
  scene.onBeforeRender = function (renderer, sc, camera, rt) {
    if (typeof prev === "function") prev.call(this, renderer, sc, camera, rt);
    const ph = R.W && R.W.phase;
    if (ph === "drop" || ph === "match" || ph === "over") {
      refreshChutes();
      tagsMod.refresh(camera);
    }
  };
  scene.__lcActorHook = true;
}

/** View sync for one actor, from frame() (its obj.position is already set,
 *  interpolated between the last two ticks): body facing and the glide tilt,
 *  eased with the FRAME dt. */
function syncObj(W, a, dt) {
  a._synced = true;
  // BODY FACING: outside combat the body turns toward where it's RUNNING
  // (pure camera-facing made strafing look like "running sideways"); while
  // aiming/shooting it squares up to the camera aim.
  let wantYaw = a.yaw + Math.PI;
  const spd2 = Math.sqrt(a.vel.x * a.vel.x + a.vel.z * a.vel.z);
  const combat = a.input.ads || (W.t - a.lastShotT < 1.5);
  if (!a.gliding && !a.swimming && !combat && spd2 > 1.2) {
    wantYaw = Math.atan2(-a.vel.x, -a.vel.z) + Math.PI;
  }
  if (!a._hasBodyYaw) { a._bodyYaw = wantYaw; a._hasBodyYaw = true; }
  let dy = wantYaw - a._bodyYaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  a._bodyYaw += dy * Math.min(1, dt * 10);
  a.obj.rotation.y = a._bodyYaw;
  // body pose: freefall = belly-down skydive with banking; canopy = upright
  // with a gentle pendulum sway; everything else level
  // The body's Euler order is YXZ (createActor): yaw outermost, so tiltX pitches about the BODY'S
  // OWN left-right axis and tiltZ rolls about its own forward axis at every heading. (With three's
  // default XYZ the pitch was about the WORLD x axis: the belly-down dive was right only when the
  // body faced -Z; at 90 / 270 deg it lay on its side and at 0 deg on its back, measured 2026-10-12
  // on 40 divers, r2/dive_probe.log. The old "negative = face-down" was tuned at that one heading,
  // which is why the signs below are the opposite of the old ones: same look there, right everywhere.)
  let wantTiltX = 0, wantTiltZ = 0;
  if (a.gliding && !a.chute) {
    // POSITIVE X pitches the head forward = face-down (the playtest's "falling backwards" was the
    // back-down pose)
    wantTiltX = a.input.sprint ? 1.15 : 1.35;
    wantTiltZ = a.input.mx * 0.45;                           // bank into turns
  } else if (a.gliding && a.chute) {
    wantTiltX = -0.12 - Math.sin(W.t * 1.7) * 0.06;          // sway under canopy (reclined in the harness)
    wantTiltZ = -a.input.mx * 0.18 + Math.cos(W.t * 1.3) * 0.04;
  }
  a._tiltX = (a._tiltX || 0) + (wantTiltX - (a._tiltX || 0)) * Math.min(1, dt * 4);
  a._tiltZ = (a._tiltZ || 0) + (wantTiltZ - (a._tiltZ || 0)) * Math.min(1, dt * 4);
  a.obj.rotation.x = a._tiltX;
  a.obj.rotation.z = a._tiltZ;
  // (the canopy hangs upright from the body's shoulders whatever this tilt is: refreshChutes)
}

/** Clip selection + the pose layers for one synced actor (view pass, after the
 *  camera has moved). The mixer was already stepped this frame by the kernel —
 *  or not, under the C4 policy set by actorView. */
function animate(W, a, dt) {
  if (a.rig) {
    // The clip chain is skipped where the kernel skips the mixer for distance
    // (a bot beyond 250 m in screen terms), exactly as the old far LOD skipped
    // it. `!a.emoting` guards the CLIP chain: the local path returns inside
    // stepActor's emote branch before it ever gets here, but interpRemote calls
    // syncObj unconditionally — so a peer's relayed wave was overwritten by
    // idle/walk on the very next frame and the whole remote-emote relay was
    // dead on arrival.
    const farAnim = a.isBot && a._dEff > MIX_SKIP_M && a !== W._camFocus;
    if (!farAnim && !a.emoting) {
      const combat = a.input.ads || (W.t - a.lastShotT < 1.5);
      const gs = Math.sqrt(a.vel.x * a.vel.x + a.vel.z * a.vel.z);
      // decays HERE, not inside its clip branch — a victim that leaves the
      // ground (bot jump-dodge) the instant it is shot must not bank the
      // flinch and play it stale half a second later on landing
      if (a.hitReactT > 0) a.hitReactT -= dt;
      // freefall: Mixamo falling-idle when present; else frozen run + skydive pose
      const fam = gunFamily(a);
      const FK = fam ? FAM_KEYS[fam] : null;
      const useMixamoGun = !!(FK && a.clips[FK.idle]);
      selectClip(a, gs, fam, FK, useMixamoGun);

      // moving reload overlay: upper-body reload layered over the locomotion
      // clip playing above (disjoint track sets — the mixer blends them clean)
      reloadOverlay(a, gs, useMixamoGun);

      // (g) GATE FOR EVERYTHING BELOW THAT WRITES BONES (spine aim offset,
      // upright fix, arm pose, barrel weld, support-hand IK). Two conditions:
      //   - on screen: off-screen bones are never seen (their shadow, when one
      //     is cast, keeps the last pose for the frame or two it is off-screen);
      //   - the mixer re-keyed the bones THIS frame. Under the reduced-rate
      //     policy (C4 _ffgRate 2/4) the bones on an in-between frame still hold
      //     last frame's LAYERED pose, and the aim offset below is additive
      //     (`+=` on the spine): re-applying it would lean the torso twice.
      // A mixer the kernel SKIPPED this frame (off screen / far last frame) but
      // that is on screen now is stepped once right here, so an actor never
      // pops into view in a stale pose for a frame.
      let layers = a._onScreen && a._evalNow;
      if (!layers && a._onScreen && a._skipUsed) {
        a.rig.mixer.update(dt);
        a._mixT = a.rig.mixer.time;
        layers = true;
      }
      // ── ARM-POSE LAYER (pose.js) ──────────────────────────────────────────
      // Skip when Mixamo gun/fall clips already own the arms (better than the
      // old Meshy retargets that folded over the face). Gun SOCKET + barrel aim
      // still run below so the mesh aligns to the hand.
      let mode = null;
      const armed = a.weapon && !a.weapon.id.startsWith("consumable");
      const mixamoOwnsArms = useMixamoGun;   // freefall skydive pose is back (fall clip unloaded)
      if (!a.alive || a.emoting || mixamoOwnsArms) mode = null;
      else if (a.gliding && !a.chute) mode = "skydive";
      else if (a.gliding) mode = "hang";
      else if (a.swimming) mode = null;
      else if (armed && a.weapon.state === "reloading") mode = "reload";
      else if (armed && !combat) mode = "lowReady";
      else if (armed) mode = "gunReady";
      else mode = "relax";
      // AIM OFFSET (industry-standard upper-body layer): additively lean the
      // spine toward the aim pitch AND twist it toward the aim yaw AFTER the
      // clip pose. Lower body faces movement (_bodyYaw), upper body twists
      // toward the camera (clamped like every AAA third-person rig) — and the
      // gun welds to the TWISTED chest below, so hands, weapon and aim always
      // agree (owner: "at this angle the gun is backwards").
      const bodyFwdYaw = a._hasBodyYaw ? a._bodyYaw - Math.PI : a.yaw;
      let aimDelta = a.yaw - bodyFwdYaw;
      while (aimDelta > Math.PI) aimDelta -= Math.PI * 2;
      while (aimDelta < -Math.PI) aimDelta += Math.PI * 2;
      const twist = K.clamp(aimDelta, -0.6, 0.6);
      if (layers && a.armBones && useMixamoGun && armed && a.onGround && !a.gliding && !a.swimming && !a.emoting && a.alive) {
        // negative: +rotation.x on these spines bends FORWARD, and looking UP
        // (pitch > 0) must arch the torso BACK (verified by pitch-sweep probe)
        const lean = K.clamp(a.pitch, -1.1, 1.1) * -0.30;
        if (a.armBones.spine1) { a.armBones.spine1.rotation.x += lean * 0.5; a.armBones.spine1.rotation.y += twist * 0.5; }
        if (a.armBones.spine2) { a.armBones.spine2.rotation.x += lean * 0.5; a.armBones.spine2.rotation.y += twist * 0.5; }
        else if (a.armBones.spine && !a.armBones.spine1) { a.armBones.spine.rotation.x += lean; a.armBones.spine.rotation.y += twist; }
      }
      // straighten a slouched rig BEFORE the arm layer (arms hang off the
      // spine, so upright must happen first) — skip mid-air/emote where the
      // clip owns the whole body
      if (layers && a.torsoFix && !a.gliding && !a.emoting) uprightTorso(a.obj, a.armBones, 1);
      const wantW = mode ? 1 : 0;
      a._armW = (!a._hasArmW ? wantW : a._armW + (wantW - a._armW) * Math.min(1, dt * 8));
      a._hasArmW = true;
      if (mode) a._armMode = mode;
      // input.pitch > 0 = looking UP (verified: mouse-up → +pitch; aimDir/camera use sin(pitch));
      // tiltDir(+) raises the muzzle, so pass pitch un-negated or the gun tilts the wrong way
      if (layers && a._armW > 0.02 && a._armMode) applyArmPose(a.obj, a.armBones, a._armMode, a._armW, a.pitch);
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
      // The weld is NOT additive (it sets the holder's world orientation from the
      // hand bone outright), so unlike the layers above it also runs OFF screen on
      // every frame the mixer re-keyed the bones: an off-screen pistol bot inside
      // shadow range (rate-2 mixer) otherwise carried the raw run clip's hand with
      // the static grip - gun backwards in its shadow, and for the one frame it
      // re-entered the frustum on a non-evaluating frame (rigcheck (c): 3 bots,
      // barrel . chest -0.31 / -0.99 / -0.98, all off screen, 7.7-30.2 m).
      if ((layers || a._evalNow) && a.hand && a.handBone && !a.emoting && (poseAim || mixamoAim)) barrelWeld(a, bodyFwdYaw, twist, mixamoAim);
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
      if (layers && a.hand && a.weaponMesh && a.armBones && a.armBones.lArm && !a.emoting &&
          a._armMode === "gunReady" && a._armW > 0.5) supportHandIK(a);
    }
  }
}

/** Clip selection for one actor this frame (freefall / canopy / swim / jump / hit / reload / crouch / locomotion). */
function selectClip(a, gs, fam, FK, useMixamoGun) {
  if (a.gliding && !a.chute) {
    // ORIGINAL freefall (owner: "falling isnt FREEFALL, check animation on
    // the original fall"): frozen run + the skydive arm pose reads as a
    // proper belly-down dive; the Mixamo "falling idle" clip was a feet-
    // down flail and is no longer loaded.
    playAnim(a, "run", PA_DIVE);
  }
  else if (a.gliding) playAnim(a, "idle");
  else if (a.swimming) playAnim(a, "swim", paTs(gs > 4.5 ? 1.25 : 1));
  else if (a.mantleT != null && a.clips.crouch) {
    playAnim(a, "crouch", PA_FREEZE);
  }
  else if (!a.onGround) playAnim(a, "jump", PA_JUMP);
  else if (a.hitReactT > 0 && a.clips.hit) {
    playAnim(a, "hit", PA_ONCE);
  }
  else if (useMixamoGun && a.weapon && a.weapon.state === "reloading" && a.clips.rifle_reload && gs <= 0.7) {
    // standing still: the full-body reload clip owns everything.
    // MOVING reloads fall through to the locomotion branch below — legs
    // keep walking/running and the upper-body overlay (managed after this
    // chain) swaps the mag.
    playAnim(a, "rifle_reload", PA_ONCE);
  }
  else if (useMixamoGun && a.crouching && fam === "rifle" && a.clips.rifle_crouch) {
    playAnim(a, "rifle_crouch", paTs(gs > 0.7 ? K.clamp(gs / 2.7, 0.55, 1.4) : 0));
  }
  else if (a.crouching && a.clips.crouch && !(useMixamoGun && fam === "rifle" && a.clips.rifle_crouch)) {
    playAnim(a, "crouch", paTs(gs > 0.7 ? K.clamp(gs / 2.7, 0.55, 1.4) : 0));
  }
  else if (useMixamoGun && gs > 0.7) {
    const back = (a.vel.x * -Math.sin(a._bodyYaw - Math.PI) + a.vel.z * -Math.cos(a._bodyYaw - Math.PI)) < -0.5;
    const dirK = back ? -0.9 : 1;
    const runKey = FK.run;
    const walkKey = FK.walk;
    if ((a.sprinting && gs > 5.5 && !back) || (gs > 4.4 && !back)) {
      if (a.clips[runKey]) playAnim(a, runKey, paTs(K.clamp(gs / 6.5, 0.85, 1.5)));
      else playAnim(a, "run", paTs(K.clamp(gs / 6.5, 0.9, 1.5)));
    } else if (a.clips[walkKey]) {
      playAnim(a, walkKey, paTs(dirK * K.clamp(gs / 3.0, 0.85, 2.0)));
    } else {
      playAnim(a, "walk", paTs(dirK * K.clamp(gs / 3.0, 0.85, 2.0)));
    }
  }
  else if (useMixamoGun) {
    playAnim(a, FK.idle);
  }
  else if (gs > 0.7) {
    const back = (a.vel.x * -Math.sin(a._bodyYaw - Math.PI) + a.vel.z * -Math.cos(a._bodyYaw - Math.PI)) < -0.5;
    const dirK = back ? -0.9 : 1;
    if (a.sprinting && gs > 5.5 && !back) {
      playAnim(a, "run", paTs(K.clamp(gs / 6.5, 0.9, 1.5)));
    } else if (gs > 4.4 && !back) {
      playAnim(a, "run", paTs(K.clamp(gs / 8.0, 0.7, 1.1)));
    } else {
      playAnim(a, "walk", paTs(dirK * K.clamp(gs / 3.0, 0.85, 2.0)));
    }
  }
  else { playAnim(a, "idle"); }
}

/** Moving reload: the upper-body reload clip layered over locomotion (disjoint track sets). */
function reloadOverlay(a, gs, useMixamoGun) {
  const wantOv = useMixamoGun && a.weapon && a.weapon.state === "reloading" && gs > 0.7 && a.rig.actions.rifle_reload_upper;
  if (wantOv && !a._ovReload) {
    const ov = a.rig.actions.rifle_reload_upper;
    ov.reset(); ov.setLoop(THREE.LoopOnce, 1); ov.clampWhenFinished = true;
    ov.setEffectiveWeight(1); ov.fadeIn(0.08); ov.play();
    a._ovReload = true;
  } else if (!wantOv && a._ovReload) {
    const ov = a.rig.actions.rifle_reload_upper;
    if (ov) ov.fadeOut(0.12);
    a._ovReload = false;
  }
}

/** BARREL AIM weld: the holder's local rotation that points the barrel along the twisted chest + aim pitch. */
function barrelWeld(a, bodyFwdYaw, twist, mixamoAim) {
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
  // barrel follows the TWISTED CHEST, not the raw camera yaw: when the
  // body runs at an angle to the aim, welding to camera yaw pointed the
  // gun sideways/backwards out of the hands. Shots still originate from
  // the crosshair raycast — this weld is purely the visual.
  const gunYaw = bodyFwdYaw + twist;
  _gf.set(-Math.sin(gunYaw) * cp, sp, -Math.cos(gunYaw) * cp).normalize();
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

/** SUPPORT HAND: two-bone IK of the left arm onto the weapon's foregrip. */
function supportHandIK(a) {
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
    a._vmode = 1;               // frame() draws it (interpolated) and runs syncObj
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

// ── camera vs walls (P3.1, owner decision D3 = yes) ──────────────────────────
// Inside a building the third-person boom (4.2 m, +0.7 m to the right) used to sit
// BEHIND the wall: a wall filled about half the frame in every probe shot, because
// the only thing the camera ever tested was the terrain (heightAt). Now the free
// camera position F (smoothed exactly as before) is cast against the static box
// colliders FROM THE EYE. The rules, all from the owner's call:
//   * SNAP IN on contact: the kept fraction of the boom drops to the safe value the
//     same frame, so the lens is never inside or behind a wall;
//   * EASE OUT slowly (CAM_EASE_RATE, ~0.45 s time constant) once the view is free;
//   * NEVER ROTATE: only the position moves, along the boom, and the look target is
//     translated by the same offset (a pure dolly), so the camera's orientation is
//     bit-identical to the one it would have had without a wall;
//   * the reticle stays centred (it is a screen-space element), and shots still go to
//     the crosshair ray (weapons.js crosshairPoint reads W.camera as it is drawn).
// The cast is a ray against boxes grown by the lens radius (a sphere cast with the
// corners squared off: conservative, never optimistic). ONE queryColliders per frame
// (budget 150/frame for the whole game, framecheck counts them), no allocation: the
// result array is this module's own and the slab test is inline.
const CAM_R = 0.28;              // lens sphere radius (m): near plane 0.1 + margin so a wall face never clips the view
const CAM_EASE_RATE = 2.2;       // 1/s release rate once the view is free (slow on purpose)
const CAM_HIDE_IN = 0.75, CAM_HIDE_OUT = 0.95;   // the body is hidden when the lens is this close to the eye (hysteresis)
const CAM_MIN_D = 0.12;          // the lens never comes closer than this to the eye
const _camWallOff = new THREE.Vector3();         // last frame's pull-in offset (output - free-space position)
let _camWallF = 1;               // fraction of the free boom kept (1 = nothing in the way)
let _camWallFocus = null;        // the actor _camWallF belongs to (a focus change resets it)
let _camHidden = null;           // the actor whose model the pull-in hid (so a focus change can hand it back)
let _camClose = false;
const _cwCols = [];              // own out array for queryColliders (never the shared scratch)

/** Earliest t in (0, best) at which the ray o + t*d enters a wall box grown by r, else `best`.
 *  An eye already inside a box's grown volume (a wall closer than r, e.g. squeezed against a face)
 *  does not get that box ignored: the lens radius shrinks to what the eye actually has to the real
 *  face, so the ray still stops at the face and never passes through it. An eye IN the box (a ledge,
 *  a prop edge) has nothing to pull in from and ignores it. Trunks and barrels (props under 2 m
 *  wide) never count: a forest must not pump the camera, and a trunk the lens passes through hides
 *  nothing. */
function camRayHit(cols, ox, oy, oz, dx, dy, dz, r, best) {
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (c.kind !== "box" || c.dead) continue;
    if (c.prop != null && c.maxX - c.minX < 2.0) continue;
    let rr = r;
    for (let pass = 0; pass < 2; pass++) {
      let t0 = 0, t1 = best, miss = false;
      // X slab
      if (dx > -1e-9 && dx < 1e-9) { if (ox < c.minX - rr || ox > c.maxX + rr) miss = true; }
      else {
        let a = (c.minX - rr - ox) / dx, b = (c.maxX + rr - ox) / dx;
        if (a > b) { const t = a; a = b; b = t; }
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 > t1) miss = true;
      }
      // Y slab
      if (!miss) {
        if (dy > -1e-9 && dy < 1e-9) { if (oy < c.minY - rr || oy > c.maxY + rr) miss = true; }
        else {
          let a = (c.minY - rr - oy) / dy, b = (c.maxY + rr - oy) / dy;
          if (a > b) { const t = a; a = b; b = t; }
          if (a > t0) t0 = a;
          if (b < t1) t1 = b;
          if (t0 > t1) miss = true;
        }
      }
      // Z slab
      if (!miss) {
        if (dz > -1e-9 && dz < 1e-9) { if (oz < c.minZ - rr || oz > c.maxZ + rr) miss = true; }
        else {
          let a = (c.minZ - rr - oz) / dz, b = (c.maxZ + rr - oz) / dz;
          if (a > b) { const t = a; a = b; b = t; }
          if (a > t0) t0 = a;
          if (b < t1) t1 = b;
          if (t0 > t1) miss = true;
        }
      }
      if (miss) break;
      if (t0 > 0) { best = t0; break; }                    // the lens sphere meets the box at t0
      if (pass === 1) break;
      // t0 == 0: the eye is inside the grown volume. Distance from the eye to the REAL box:
      const ex = ox < c.minX ? c.minX - ox : ox > c.maxX ? ox - c.maxX : 0;
      const ey = oy < c.minY ? c.minY - oy : oy > c.maxY ? oy - c.maxY : 0;
      const ez = oz < c.minZ ? c.minZ - oz : oz > c.maxZ ? oz - c.maxZ : 0;
      const dd = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (dd <= 0.03) break;                                // the eye is in the box itself
      rr = dd - 0.015;                                      // retest with the radius the eye really has
    }
  }
  return best;
}

/** Pull `cam.position` (the free-space smoothed camera) in along the boom when a wall is in the
 *  way. Writes the offset to _camWallOff and the state to W._camWall (read by the probes). */
function camWall(W, cam, focus, dt, snapped) {
  const st = W._camWall;
  const ox = camTarget.x, oy = camTarget.y, oz = camTarget.z;
  const dx = cam.position.x - ox, dy = cam.position.y - oy, dz = cam.position.z - oz;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  let f = 1;
  if (len > 0.3 && W.map && W.map.queryColliders && !W.noCamWall) {
    const cols = W.map.queryColliders(ox + dx * 0.5, oz + dz * 0.5, len * 0.5 + CAM_R + 0.1, _cwCols);
    if (cols.length) {
      const t = camRayHit(cols, ox, oy, oz, dx, dy, dz, CAM_R, 1);
      if (t < 1) f = Math.max(CAM_MIN_D / len, t - 0.015);
    }
  }
  if (focus !== _camWallFocus || snapped) { _camWallFocus = focus; _camWallF = f; }       // new subject / teleport: no ease
  else if (f < _camWallF) _camWallF = f;                                                    // snap IN on contact
  else if (f > _camWallF) {                                                                 // ease OUT, slowly, never past the safe fraction
    _camWallF += (f - _camWallF) * Math.min(1, dt * CAM_EASE_RATE);
    if (f - _camWallF < 0.002) _camWallF = f;
  }
  const kept = _camWallF < 1 ? _camWallF : 1;
  const nx = ox + dx * kept, ny = oy + dy * kept, nz = oz + dz * kept;
  _camWallOff.set(nx - cam.position.x, ny - cam.position.y, nz - cam.position.z);
  cam.position.set(nx, ny, nz);
  if (st) { st.f = kept; st.target = f; st.dist = len * kept; st.free = len; st.pulled = kept < 0.999; }
}

function updateCamera(W, dt, alpha) {
  const k = alpha == null ? 1 : alpha;
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
  focus._eyeY = !focus._hasEyeY ? wantEye : focus._eyeY + (wantEye - focus._eyeY) * Math.min(1, dt * 12);
  focus._hasEyeY = true;
  // FIXED TICK: follow the actor where it is DRAWN this frame (obj.position,
  // interpolated between the last two ticks by frame()), so the camera and the
  // body move together at any display rate. Look: the live human reads the
  // INPUT yaw/pitch, which mouse / touch events write the moment they arrive
  // (applied every frame, never held until the next tick); anyone spectated
  // turns smoothly between its last two ticks.
  const fp = (focus.alive && focus._vmode) ? focus.obj.position : focus.pos;
  const eye = fp.y + focus._eyeY;
  camTarget.set(fp.x, eye, fp.z);
  const liveLook = focus === W.player && focus.alive && !focus.netRemote;
  const fYaw = liveLook ? focus.input.yaw : (focus._ppT === _tickN ? lerpAngle(focus._pyaw, focus.yaw, k) : focus.yaw);
  const fPitch = liveLook ? focus.input.pitch : focus.pitch;
  // the victory hold ORBITS the camera around the winner (W._winOrbit is
  // advanced by the frame pipeline while phase is "over") — camTarget stays on
  // the actor, so the shot circles them rather than panning off them. It also
  // rotates the aim ray with the camera, which is harmless: hurtActor returns
  // immediately once W.phase === "over".
  const camYaw = fYaw + (W._winOrbit || 0);
  const sy = Math.sin(camYaw), cy = Math.cos(camYaw);
  // during freefall the camera tracks the dive (looks down at the island)
  const pitchBias = focus.gliding ? (focus.chute ? -0.18 : -0.62) : 0;
  const effPitch = K.clamp(fPitch + pitchBias, -1.35, 1.35);
  const sp = Math.sin(effPitch), cp = Math.cos(effPitch);
  camDir.set(sy * cp, -sp, cy * cp).multiplyScalar(-1); // forward
  // A model THIS function hid (first-person scope, or the lens right at the eye) goes back the
  // moment the camera follows someone else: the old line only ever wrote the CURRENT focus, so a
  // spectate switch left the previous one invisible for good. The hide itself is below, after
  // the wall pull-in has said how close the lens really is.
  if (_camHidden && _camHidden !== focus) {
    if (_camHidden.rig && _camHidden.rig.scene) _camHidden.rig.scene.visible = true;
    _camHidden = null; _camClose = false;
  }
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
    camPos.y = Math.min(camPos.y, surf + 0.12) + Math.max(0, fPitch) * -1.4;
  }
  // keep camera out of terrain/structures (skip in first-person — at the eye)
  if (!firstPerson) {
    const minY = W.map.heightAt(camPos.x, camPos.z) + 0.35;
    // Snap UP instantly so terrain never clips the view, but ease back DOWN —
    // the standard third-person collision rule (pull in on contact, release
    // slowly). This is a SINGLE-SAMPLE probe at the orbiting camera position,
    // so turning beside a slope sweeps it through metres of height in a
    // fraction of a second; applying that raw made the camera heave on its own
    // while the player was only looking around.
    const wantLift = Math.max(0, minY - camPos.y);
    W._camLift = (W._camLift == null || wantLift > W._camLift)
      ? wantLift
      : W._camLift + (wantLift - W._camLift) * Math.min(1, dt * 4);
    camPos.y += W._camLift;
  }
  // The shake used to be written straight into cam.position, which is ALSO the
  // source of next frame's lerp — so each frame's jitter fed back through the
  // smoothing and the effective amplitude depended on framerate twice over.
  // Undo last frame's offset before the lerp, then re-apply this frame's.
  cam.position.sub(_shakeOff).sub(_camWallOff);      // back to the FREE smoothed position (shake and wall offset are both re-applied below)
  // `dt * 18` is a first-order lag: the camera settles a constant v/k behind the
  // player, which at the old 9.6 m/s sprint was 0.53 m of permanent trail — read
  // on screen as the camera "not keeping up". It also scaled with framerate, so
  // a dip made the trail worse exactly when the game already felt bad.
  // 1 - exp(-k*dt) is the same filter sampled correctly: identical response at
  // any dt, and k raised to 26 pulls the steady-state trail to ~0.31 m at the
  // new 8.0 m/s sprint. Snap outright if we are ever more than 4 m adrift
  // (teleport, respawn, spectate switch) so it never visibly reels itself in.
  const camK = firstPerson ? 1 : 1 - Math.exp(-26 * dt);
  let camSnapped = false;
  if (!firstPerson && cam.position.distanceToSquared(camPos) > 16) { cam.position.copy(camPos); camSnapped = true; }
  else cam.position.lerp(camPos, Math.min(1, camK));
  // WALL PULL-IN (P3.1): not in first-person (the lens is AT the eye) and not under a canopy or in
  // freefall (open sky; the boom is 9-10 m and nothing but a sky island can be in it).
  if (!firstPerson && !focus.gliding) camWall(W, cam, focus, dt, camSnapped);
  else {
    _camWallOff.set(0, 0, 0); _camWallF = 1; _camWallFocus = focus;
    const st0 = W._camWall; if (st0) { st0.f = 1; st0.target = 1; st0.pulled = false; st0.dist = 0; st0.free = 0; }
  }
  // the body is hidden while the lens is right at the eye (a head filling the screen is worse than
  // no head), with hysteresis so it cannot flicker on the threshold
  const stc = W._camWall;
  _camClose = !!(!firstPerson && stc && stc.pulled && (_camClose ? stc.dist < CAM_HIDE_OUT : stc.dist < CAM_HIDE_IN));
  if (focus.rig && focus.rig.scene) focus.rig.scene.visible = !(firstPerson || _camClose);
  _camHidden = (firstPerson || _camClose) ? focus : null;
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
  if (wy != null && wy > -900) underwaterFx(W, cam, wy, dt);
  // the look target moves with the wall offset, so a pull-in is a pure DOLLY: the direction from the
  // lens to the target is the one it would have had with no wall in the way (nothing rotates)
  cam.lookAt(camTarget.x + camDir.x * 8 + _camWallOff.x, camTarget.y + camDir.y * 8 + _camWallOff.y, camTarget.z + camDir.z * 8 + _camWallOff.z);
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

/** Underwater treatment: fog/background tint and the audio low-pass while the camera is below the surface. */
function underwaterFx(W, cam, wy, dt) {
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

// ── corpses + death falls (P1.6) ───────────────────────────────────────────────────────────
const CORPSE_MIN_HOLD_S = 3, CORPSE_MAX_HOLD_S = 6, CORPSE_SINK_S = 1.2, CORPSE_SINK_M = 1.6;
// ART-A measured the soldier mesh 8-17 cm BELOW the floor in the final pose of every fall (the shipped
// death: 14.8 cm). The body is raised by this much while it goes down, so it lies on the ground, not in it.
const CORPSE_LIFT_M = 0.1, CORPSE_LIFT_S = 1.0;

/** Start the corpse timeline: hold the clamped death pose for the clip's length (3-6 s), then sink. */
const CORPSE_FALL_VMAX = 55;     // m/s: a body dropping from the dive height stops accelerating here

function startCorpse(W, victim) {
  let dur = CORPSE_MIN_HOLD_S;
  const cn = victim.anim && victim.clips ? victim.clips[victim.anim] : null;
  const act = cn && victim.rig && victim.rig.actions ? victim.rig.actions[cn] : null;
  if (act && act.getClip) dur = act.getClip().duration || dur;
  victim._sinkHold = Math.min(CORPSE_MAX_HOLD_S, Math.max(CORPSE_MIN_HOLD_S, dur + 0.6));
  victim._sinkT = 0;
  // A death in the dive / under the canopy: the canopy goes (it used to ride the corpse) and the
  // skydive tilt is levelled, so the fall clip plays on an upright root like every other death.
  removeChute(victim);
  victim._tiltX = 0; victim._tiltZ = 0;
  victim.obj.rotation.x = 0; victim.obj.rotation.z = 0;
  // A body killed in the AIR (a jump, a mantle, the dive) used to hang there for the whole hold and
  // sink out of mid-air. It now drops to its floor first (the game's gravity, sim time) and the
  // hold starts when it lands. Floor = the terrain or a roof under it (supportAt), or just under the
  // water surface when there is water above that floor.
  const p = victim.pos, vy = victim.obj.position.y;
  let floor = supportAt(W, p.x, p.z, Math.max(p.y, vy));
  const wy = W.map ? W.map.waterY : null;
  if (wy != null && wy > -900 && wy - 0.3 > floor) floor = wy - 0.3;
  victim._sinkFloor = floor;
  victim._sinkVy = 0;
  victim._sinkFall = vy > floor + 0.05;
  victim._sinkY0 = victim._sinkFall ? floor : vy;
}

/** One SIM tick of a corpse's timeline (called from tick() for dead actors): paused or hit-stopped
 *  time does not advance it. The pose itself is the mixer's, as before. */
function corpseStep(W, a, dt) {
  if (a._sinkFall) {
    // still dropping to the floor: the hold has not started
    a._sinkVy = Math.max(-CORPSE_FALL_VMAX, a._sinkVy + K.MOVE.gravity * dt);
    const y = a.obj.position.y + a._sinkVy * dt;
    if (y > a._sinkFloor) { a.obj.position.y = y; return; }
    a.obj.position.y = a._sinkFloor;
    a._sinkFall = false; a._sinkVy = 0; a._sinkY0 = a._sinkFloor; a._sinkT = 0;
    return;
  }
  a._sinkT += dt;
  const t = a._sinkT - a._sinkHold;
  if (t <= 0) {
    // going down: ease the body up off the floor it is sinking into (the pose is the mixer's, this is the root)
    const u = a._sinkT >= CORPSE_LIFT_S ? 1 : a._sinkT / CORPSE_LIFT_S;
    a.obj.position.y = a._sinkY0 + CORPSE_LIFT_M * (u * u * (3 - 2 * u));
    return;
  }
  if (!a.obj.parent) { a._sinkT = -1; return; }             // its group was cleared (match restart)
  const k = t >= CORPSE_SINK_S ? 1 : t / CORPSE_SINK_S;
  a.obj.position.y = a._sinkY0 + CORPSE_LIFT_M - CORPSE_SINK_M * (k * k * (3 - 2 * k));
  if (k >= 1) {
    a._sinkT = -1;
    a.obj.parent.remove(a.obj);
    // the corpse is gone for good: its mixer stops ticking (it played the clamped death pose for
    // the whole hold, ~49 per match, until the next match's teardown) and its skeleton's bone
    // texture is freed now
    disposeRig(W, a.rig);
  }
}

/** Which of the seven Mixamo death falls this kill plays, or null (use the single `death`).
 *  Names follow Mixamo's: "death from the front" = the victim was SHOT from the front (each clip
 *  falls the way Mixamo animated it; ART-A's assets/chars/clips/manifest.json lists where each
 *  one ends). Direction is where the last hit came from relative to the way the victim faces:
 *  front / back / right (a hit from the left has no clip of its own: it takes a front or back
 *  fall, seeded). A headshot takes the head variant, a crouching headshot its own clip, and a
 *  victim on the move may take the walking-to-dying. Every pick that is not forced comes from a
 *  stream seeded by (match seed, victim, sim tick), never Math.random(). */
const PICK_LOG = [];                              // probe read-back only (kills are rare: no per-frame cost)
const _pickWhy = { dir: "-", moving: false, head: false, heavy: false };
function pickDeath(W, victim) {
  _pickWhy.dir = "-"; _pickWhy.moving = false; _pickWhy.head = false; _pickWhy.heavy = false;
  const c = victim.clips;
  if (!c) return null;
  let any = false;
  for (let i = 0; i < DEATH_CLIPS.length; i++) if (c[DEATH_CLIPS[i]]) { any = true; break; }
  if (!any) return null;
  const has = (k) => !!c[k];
  const rng = K.mulberry32((((W.seed | 0) ^ Math.imul(hashCode(String(victim.id)), 2654435761) ^ Math.imul(W.simTick | 0, 40503)) >>> 0));
  const pick2 = (a, b) => (has(a) && has(b) ? (rng() < 0.5 ? a : b) : has(a) ? a : has(b) ? b : null);
  const lh = victim.lastHit;
  const att = lh && lh.attackerId ? W.actorById.get(lh.attackerId) : null;
  const head = !!(lh && lh.isHead);
  // where the shot came from, in the victim's own frame (obj.rotation.y = the way it faces; forward
  // = (sin, cos), right = (-cos, sin))
  let dir = "none";
  if (att && att !== victim) {
    let dx = att.pos.x - victim.pos.x, dz = att.pos.z - victim.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 0.05) {
      dx /= d; dz /= d;
      const b = victim.obj.rotation.y;
      const front = dx * Math.sin(b) + dz * Math.cos(b), side = -dx * Math.cos(b) + dz * Math.sin(b);
      dir = Math.abs(front) >= Math.abs(side) ? (front > 0 ? "front" : "back") : (side > 0 ? "right" : "left");
    }
  }
  const moving = victim.onGround && !victim.swimming && Math.sqrt(victim.vel.x * victim.vel.x + victim.vel.z * victim.vel.z) > 2.2;
  // a shotgun blast, a sniper round or a grenade hits hard enough to throw the victim off its feet
  const wid = lh ? lh.weaponId : null;
  const heavy = wid === "shotgun" || wid === "sniper" || wid === "glauncher";
  _pickWhy.dir = dir; _pickWhy.moving = moving; _pickWhy.head = head; _pickWhy.heavy = heavy;
  let k = null;
  if (victim.crouching && head && has("death_crouch_head")) return "death_crouch_head";
  // A runner hit ALONG its line of travel (from the front or the back) stumbles on before it drops: the
  // walking-to-dying. A hit from the side knocks it sideways, so a lateral hit always takes its own fall.
  // (Measured on bot kills, 2026-10-12: about half of all deaths are a runner shot from the front and one
  // in four is lateral. A walking share of .55 made half of every match's corpses the same clip.)
  if (moving && dir !== "right" && dir !== "left" && has("death_walking") && rng() < (head ? 0.15 : 0.4)) return "death_walking";
  // the head falls (knocked back face-up / thrown forward face-down) are for headshots AND for a heavy
  // weapon from the front or the back: half of those throw the victim instead of dropping it
  const knock = head || (heavy && (dir === "front" || dir === "back") && rng() < 0.5);
  if (knock) {
    k = dir === "front" ? "death_front_head" : dir === "back" ? "death_back_head" : pick2("death_front_head", "death_back_head");
  } else if (dir === "front") {
    // a runner shot from the front keeps its momentum and tips either way: the crumple or the forward fall
    // (death_front and death_back both end on the side with the head forward, ART-A manifest)
    k = moving ? pick2("death_front", "death_back") : "death_front";
  } else {
    k = dir === "back" ? "death_back" : dir === "right" ? "death_right" : pick2("death_front", "death_back");
  }
  if (k && has(k)) return k;
  // the variant for this hit is missing from this build: any other fall that is not the crouch-only one
  const pool = DEATH_CLIPS.filter((n) => n !== "death_crouch_head" && has(n));
  if (pool.length) return pool[(rng() * pool.length) | 0];
  return has("death_crouch_head") ? "death_crouch_head" : null;
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
  // A bot killed while its mixer was skipped (far / off screen, C4 flags) would
  // otherwise keep that flag forever — update() skips dead actors, so the view
  // pass never revisits it — and a long-range kill left a mid-stride statue
  // instead of a death animation. Full rate for the corpse's short life; the
  // mixer is disposed when the corpse sinks out (below).
  if (victim.rig && victim.rig.mixer) { victim.rig.mixer._ffgSkip = false; victim.rig.mixer._ffgRate = 1; }
  // an actor killed mid-mantle must not freeze mid-air in the scripted arc —
  // update() skips dead actors, so nothing else would ever clear the state
  victim.mantleT = null;
  if (victim.rig) {
    // P1.6: one of the seven Mixamo falls, matched to where the last hit came from (pickDeath).
    // SEEDED, so the same match and the same kill play the same fall (the old Math.random() pick
    // could not be replayed). None of the seven shipped = the single baked `death`.
    const dk = pickDeath(W, victim) || (victim.clips.death ? "death" : null);
    if (PICK_LOG.length < 256) PICK_LOG.push([victim.id, dk, _pickWhy.dir, _pickWhy.moving, _pickWhy.head, _pickWhy.heavy]);
    if (dk) playAnim(victim, dk, { once: true });
  }
  // The corpse holds its death pose, then sinks under the terrain and is removed. That timeline
  // runs on SIM time (corpseStep, from tick): it used to be a wall-clock setTimeout(3000) plus a
  // kernel tween, which kept going through a pause (the body vanished while the menu was up) and
  // ignored hit-stop. Actors are rebuilt from scratch each match and every group is cleared at
  // match start, so a corpse still sinking across a restart finds `obj.parent` null and just stops.
  startCorpse(W, victim);
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

// ── C7 warm-up extras / C8 disposal ─────────────────────────────────────────
/** Free one rig: off the kernel's mixer list, actions/bindings uncached, and
 *  each skeleton's bone texture released. Idempotent (a corpse is freed when it
 *  sinks out, and again — harmlessly — by disposeMatch). */
function disposeRig(W, rig) {
  if (!rig) return 0;
  const k = W && W.kernel;
  if (rig.mixer) {
    if (k && k.disposeMixer) k.disposeMixer(rig.mixer);
    if (!rig.__lcFreed) { rig.mixer.stopAllAction(); rig.mixer.uncacheRoot(rig.scene); }
  }
  let n = 0;
  if (rig.scene) rig.scene.traverse((o) => { if (o.isSkinnedMesh && o.skeleton) { o.skeleton.dispose(); n++; } });
  rig.__lcFreed = true;
  return n;
}

/** C7: objects the warm-up must draw once under the loading screen so the drop
 *  links no program and uploads no buffer — the canopy batch, the line batch,
 *  the name-tag billboard (each parked as ONE instance far below the world;
 *  the first live render of the match repacks them), and, per skin with a far
 *  LOD, a throwaway SkinnedMesh wearing the LOD1 geometry on that skin's live
 *  material + skeleton (same program as LOD0: this uploads the LOD1 buffers).
 *  Call after loadActorModels. */
export function warmObjects(W) {
  ensureChute();
  const out = [];
  _cm.makeTranslation(0, -10000, 0);
  _cm.toArray(CH.mesh.instanceMatrix.array, 0);
  CH.mesh.count = 1; CH.mesh.visible = true;
  CH.mesh.instanceMatrix.needsUpdate = true;
  const lp = CH.lines.geometry.attributes.position.array;
  for (let k = 0; k < CHUTE_LINES.length; k += 3) { lp[k] = CHUTE_LINES[k]; lp[k + 1] = CHUTE_LINES[k + 1] - 10000; lp[k + 2] = CHUTE_LINES[k + 2]; }
  CH.lines.geometry.attributes.position.needsUpdate = true;
  CH.lines.geometry.setDrawRange(0, CHUTE_LINES.length / 3);
  CH.lines.visible = true;
  out.push(CH.mesh, CH.lines, tagsMod.warmObject());
  const done = new Set();
  for (const a of (W && W.actors) || []) {
    if (!a.rig || !a._lod1Geo || !a._bodies || !a._bodies.length || done.has(a._lod1Geo)) continue;
    done.add(a._lod1Geo);
    const b = a._bodies[0];
    const m = new THREE.SkinnedMesh(a._lod1Geo, b.material);
    m.name = "lc-warm-lod1";
    m.bind(b.skeleton, b.bindMatrix);
    m.frustumCulled = false;
    out.push(m);
  }
  // The zone-tint body program carries the rim light (P1.8, key "lcZoneTintRim1").
  // Every live rig is already in the scene and the warm frame forces all of it
  // visible, so that program compiles there; this throwaway body on a LIVE body
  // material guarantees it even for a roster whose skins have no far LOD (each
  // match's material clones share the one program, only uniform values differ).
  if (!done.size) {
    for (const a of (W && W.actors) || []) {
      if (!a.rig || !a._lod0Geo || !a._bodies || !a._bodies.length) continue;
      const b = a._bodies[0];
      const m = new THREE.SkinnedMesh(a._lod0Geo, b.material);
      m.name = "lc-warm-rim";
      m.bind(b.skeleton, b.bindMatrix);
      m.frustumCulled = false;
      out.push(m);
      break;
    }
  }
  return out;
}

/** C8: release everything this module created for the match that is ending —
 *  every actor rig (mixer off the kernel list, Skeleton bone textures: the
 *  Stage-0 census's largest rematch leak), every cloned body material, the
 *  name-tag atlas's GPU copy, the canopy list. Idempotent; loadActorModels also
 *  runs it before building the next roster. The shared canopy/tag meshes are
 *  session singletons (reused, never re-created per match). */
export function disposeMatch(W) {
  const out = { rigs: 0, skeletons: 0, materials: 0, tags: 0 };
  const w = W || R.W;
  for (const rig of R.rigs) { out.skeletons += disposeRig(w, rig); out.rigs++; }
  for (const m of R.mats) { m.dispose(); out.materials++; }
  R.rigs.length = 0;
  R.mats.length = 0;
  PICK_LOG.length = 0;
  // camera wall pull-in state belongs to the match that is ending (its rigs are gone)
  _camWallOff.set(0, 0, 0); _camWallF = 1; _camWallFocus = null; _camClose = false; _camHidden = null;
  out.tags = tagsMod.disposeMatch().tags;
  CH.list.length = 0;
  if (CH.mesh) {
    CH.mesh.count = 0; CH.mesh.visible = false;
    CH.lines.geometry.setDrawRange(0, 0); CH.lines.visible = false;
    if (CH.mesh.parent) CH.mesh.parent.remove(CH.mesh);
    if (CH.lines.parent) CH.lines.parent.remove(CH.lines);
  }
  return out;
}

/** read-back for probes / the harness: the view policy as it stands */
export function readback(W) {
  const r = { actors: 0, lod1: 0, shadowBodies: 0, shadowWeapons: 0, onScreen: 0, mixSkip: 0, mixRate: { 1: 0, 2: 0, 4: 0 },
              chutes: CH.list.length, chuteDrawn: CH.mesh ? CH.mesh.count : 0, tags: tagsMod.stats(), rigs: R.rigs.length };
  for (const a of (W && W.actors) || []) {
    if (!a.alive || !a.rig) continue;
    r.actors++;
    if (a._lod === 1) r.lod1++;
    if (a._bodyShadow) r.shadowBodies++;
    if (a._wpnShadow) r.shadowWeapons++;
    if (a._onScreen) r.onScreen++;
    const m = a.rig.mixer;
    if (m._ffgSkip) r.mixSkip++; else r.mixRate[m._ffgRate || 1]++;
  }
  return r;
}
