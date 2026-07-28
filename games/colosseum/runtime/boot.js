// Colosseum — bootstrap.
//
// Responsibilities, in order: detect capability -> pick a quality tier ->
// create the renderer -> build the world -> run a fixed-timestep loop.
//
// MULTIPLAYER SEAM: the simulation is advanced in fixed steps from a command
// stream, and rendering only ever reads interpolated state. Nothing here
// reaches into sim state from a rAF callback, so an authoritative server can
// later drive the same step function with the same commands and produce the
// same world (see sim/ for the deterministic pieces).

import * as THREE from "three";
import { Colosseum } from "./view/colosseum.js";
import { Crowd } from "./view/crowd.js";
import { Sky } from "./view/sky.js";
import { Hypogeum } from "./view/hypogeum.js";
import { Gates } from "./view/gates.js";
import { loadFighter, loadBeast, Actor, attachWeapon, makeGladius, makeScutum, makeTrident } from "./view/actors.js";
import { preloadProps, makeWeapon } from "./view/props.js";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import { makeSand } from "./view/sand.js";
import { Equipment } from "./view/equipment.js";
import { Inventory } from "./sim/inventory.js";
import { Armoury } from "./ui/armoury.js";
import { Match, STATE } from "./sim/match.js";
import { BoutView, CombatCamera } from "./view/bout.js";
import { Post } from "./view/post.js";
import { VFX } from "./view/vfx.js";
import { HUD } from "./ui/hud.js";
import { Input } from "./core/input.js";
import { LADDER } from "./data/roster.js";
import { Audio } from "./core/audio.js";
import { Menu, SCREEN } from "./ui/menu.js";
import { ARENA } from "./data/arena_spec.js";
import { clamp, damp, TAU } from "./core/util.js";

const container = document.getElementById("game-container");

// Boot forensics: every uncaught error and rejection lands here, so a stalled
// boot can be diagnosed from the console instead of guessed at.
window.__BOOT_ERRORS__ = [];
window.addEventListener("error", (e) => window.__BOOT_ERRORS__.push(String(e.message)));
window.addEventListener("unhandledrejection", (e) => window.__BOOT_ERRORS__.push("rejection: " + String(e.reason && e.reason.message || e.reason)));

// ---------------------------------------------------------------------------
// Quality tier
// ---------------------------------------------------------------------------
function detectQuality() {
  const forced = new URLSearchParams(location.search).get("q");
  if (forced) return forced;
  try {
    const saved = localStorage.getItem("colosseum_quality");
    if (saved) return JSON.parse(saved);
  } catch (e) { /* first run */ }

  // Heuristic starting point; the perf monitor corrects it within a few seconds.
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (mobile) return mem >= 6 && cores >= 6 ? "medium" : "low";
  if (mem >= 8 && cores >= 8) return "high";
  if (mem >= 4 && cores >= 4) return "medium";
  return "low";
}

const QUALITY = detectQuality();
const DPR_CAP = { low: 1.0, medium: 1.25, high: 1.5, ultra: 2.0 }[QUALITY] ?? 1.5;

// ---------------------------------------------------------------------------
// Loading overlay
// ---------------------------------------------------------------------------
const loadEl = document.createElement("div");
loadEl.style.cssText = `position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;background:radial-gradient(ellipse at 50% 40%,#2a1c10,#0d0906 78%);
  z-index:10;color:#e8dcc0;font-family:Georgia,'Times New Roman',serif;transition:opacity .6s`;
loadEl.innerHTML = `
  <div style="font-size:52px;font-weight:900;letter-spacing:5px;
    background:linear-gradient(180deg,#ffeec4,#e0b558 52%,#a8471f);-webkit-background-clip:text;
    background-clip:text;color:transparent;text-align:center">COLOSSEUM</div>
  <div style="font-size:16px;letter-spacing:7px;color:#c9a86e;margin-top:4px">SANDS OF GLORY</div>
  <div style="width:320px;height:8px;border:1px solid #8a6b39;margin-top:34px;overflow:hidden;background:#1a120a">
    <div id="cl-bar" style="width:0%;height:100%;background:linear-gradient(90deg,#8a3418,#e0b558);transition:width .25s"></div></div>
  <div id="cl-txt" style="margin-top:14px;font-size:13px;color:#9c8760;letter-spacing:1px">Raising the arena…</div>`;
container.appendChild(loadEl);
const setProgress = (f, txt) => {
  const b = loadEl.querySelector("#cl-bar");
  if (b) b.style.width = `${Math.round(f * 100)}%`;
  if (txt) loadEl.querySelector("#cl-txt").textContent = txt;
};

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({
  antialias: QUALITY !== "low",
  powerPreference: "high-performance",
  stencil: false,
});
// Viewport size. The container can legitimately measure 0x0 at boot (hidden
// iframe, a pane that has not laid out yet, display:none ancestor), and a 0x0
// drawing buffer silently renders nothing forever. Fall back to the window and
// keep watching with a ResizeObserver so the game recovers the moment it is
// actually shown.
function viewportSize() {
  const w = container.clientWidth || window.innerWidth || 1280;
  const h = container.clientHeight || window.innerHeight || 720;
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio, DPR_CAP));
{
  const { w, h } = viewportSize();
  renderer.setSize(w, h);
}
// Count per FRAME, not per render() call — see the reset() in frame(). Without
// this, three zeroes the counters at the top of every pass and the reported
// cost is whatever the last full-screen quad happened to be. It also means the
// SHADOW pass is finally included, which it never was: the audit found the
// real per-frame cost was ~2x what this game had been reporting.
renderer.info.autoReset = false;
renderer.shadowMap.enabled = QUALITY !== "low";
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, viewportSize().w / viewportSize().h, 0.25, 1200);

// Post-processing. Constructed here so `post` exists for applyViewport below;
// init() is async (the addon passes are fetched) and the game renders through
// the plain path until it resolves, so a slow CDN delays polish, never play.
const post = new Post(renderer, scene, camera, { quality: QUALITY });
post.init().then((on) => console.log(`[post] ${on ? "enabled" : "off"} — ${JSON.stringify(post.stats())}`));

function applyViewport() {
  const { w, h } = viewportSize();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  // The composer owns its own render targets and does NOT track the renderer,
  // so a resize that skips it leaves the game rendering at the old resolution
  // and stretching the result.
  if (typeof post !== "undefined" && post) {
    const dpr = renderer.getPixelRatio();
    post.resize(w * dpr, h * dpr);
  }
}
applyViewport();
window.addEventListener("resize", applyViewport);
// A container that lays out late (or a pane being dragged) fires here, not on
// window resize — this is what rescues the 0x0 case.
if (window.ResizeObserver) new ResizeObserver(applyViewport).observe(container);

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
setProgress(0.1, "Raising the arena…");

const sky = new Sky(scene, { timeOfDay: "afternoon" });
sky.setShadowQuality(QUALITY);
renderer.toneMappingExposure = sky.exposure();

setProgress(0.3, "Raking the harena…");
// The sand carries procedural grain plus a persistent damage layer (blood,
// scuffs, drag trails) composited in the shader — one draw call, no decals.
const { material: sandMaterial, damage: sandDamage } = makeSand(renderer, {
  size: QUALITY === "low" ? 512 : 1024,
});

setProgress(0.35, "Cutting the travertine…");
const colosseum = new Colosseum({ scene, quality: QUALITY, seed: 20260724, sandMaterial }).build();

setProgress(0.62, "Hanging the gates…");
const gates = new Gates(colosseum.group, { materials: colosseum.mat, colosseum });
const hypogeum = new Hypogeum(colosseum.group, { quality: QUALITY, seed: 20260724, materials: colosseum.mat });

setProgress(0.75, "Seating the mob…");
const crowd = new Crowd(colosseum.group, { quality: QUALITY, seed: 20260724 });

// Bake the sky into an environment map. Must happen AFTER the geometry exists
// (the bake hides scene meshes so only the sky is captured) and it is what
// stops every metal surface from rendering black.
setProgress(0.9, "Catching the light…");
sky.bakeEnvironment(renderer);

// ---------------------------------------------------------------------------
// Actors. Loaded after the world so the loading bar reflects real work, and
// awaited before the first frame so nothing pops in.
// ---------------------------------------------------------------------------
setProgress(0.94, "Arming the fighters…");

// The career save. Restored before actors so the fighter is built already
// wearing whatever the player last equipped.
const inventory = Inventory.restore();

const actors = { player: null, beast: null };
// Shared libraries the bout view clones combatants from.
const actorLibs = { fighter: null, beasts: {}, armaturae: {}, mounts: {} };

/**
 * The eight generated armatura bodies. Loaded lazily and in parallel: a bout
 * only ever needs the two or three types actually on the card, so paying ~600 KB
 * for all eight up front would be wasted on a 1v1.
 */
const ARMATURA_BODIES = [
  "murmillo", "secutor", "retiarius", "thraex",
  "hoplomachus", "dimachaerus", "provocator", "crupellarius",
  // 2026-07-27: generated (20 credits each). The eques finally rides with his
  // own body; the minotaur is the arena's first mythological SPECTACLE
  // opponent — humanoid frame, identical 24-bone rig, inherits every clip.
  "eques", "minotaur", "scissor",
];

async function ensureArmaturaBodies(ids) {
  const want = [...new Set(ids)].filter((id) => ARMATURA_BODIES.includes(id) && !actorLibs.armaturae[id]);
  if (!want.length) return actorLibs.armaturae;
  const libs = await Promise.all(want.map((id) =>
    loadFighter(`assets/chars/${id}`).catch((e) => {
      console.warn(`[boot] armatura body '${id}' failed to load:`, e && e.message);
      return null;
    })));
  want.forEach((id, i) => { if (libs[i]) actorLibs.armaturae[id] = libs[i]; });
  return actorLibs.armaturae;
}

try {
  // The fighter is the ONLY body the title screen needs. The tiger (4.4 MB —
  // 58% of the old blocking payload) used to sit inside this await and gate
  // first paint; it now streams in AFTER the title reveals, and bouts load
  // their beasts on demand via ensureBeasts().
  const fighterLib = await loadFighter("assets/chars/murmillo");

  actorLibs.fighter = fighterLib;

  actors.player = new Actor(fighterLib, { height: 1.82, name: "player" });
  actors.player.pos.set(-16, 0, 4);
  actors.player.facing = Math.PI * 0.5;
  actors.player.play("idle");
  attachWeapon(actors.player, makeGladius(), { palm: 0.055 });
  // The scutum rides on the forearm facing forward: its local +z (the convex
  // face) must point away from the body, and its long axis runs down the arm.
  attachWeapon(actors.player, makeScutum(), {
    bone: /LeftHand|Hand_L|mixamorig.*LeftHand/i,
    palm: 0.04,
    align: "shield",
  });
  // Visible equipment: bone-attached Roman armour that the armoury drives.
  actors.player.equipment = new Equipment(actors.player);
  actors.player.equipment.applyLoadout({ armour: inventory.armourList() });

  scene.add(actors.player.root);

  // Run `fn` only after module evaluation completes. setTimeout(0) is NOT
  // enough: a fast (local) asset load resolves its .then during a LATER
  // top-level await, where macrotasks run while `match` is still in its
  // temporal dead zone — and typeof can't probe a TDZ `let` either. The
  // end-of-eval __FFG3D__ assignment is the deterministic "eval done" signal.
  const afterBoot = (fn) => {
    const go = () => (window.__FFG3D__ ? fn() : setTimeout(go, 100));
    setTimeout(go, 0);
  };

  // Meshy equipment props stream in behind the title screen the same way the
  // tiger does; when they land, the title fighter re-dresses in the real kit.
  preloadProps().then(() => afterBoot(() => {
    if (match || !actors.player || !actors.player.equipment) return;
    actors.player.equipment.applyLoadout({ armour: inventory.armourList() });
    syncHeldGear(inventory);
  }));

  // Title-screen tiger streams in late and never blocks (see above).
  loadBeast("assets/beasts/tiger.glb").then((beastLib) => {
    actorLibs.beasts.tiger = beastLib;
    actors.beast = new Actor(beastLib, {
      // Quadrupeds are sized by BODY LENGTH. A Bengal tiger is ~2.0 m nose to
      // tail-base; sizing by "height" turns a big cat into a house cat.
      length: 2.05,
      name: "beast",
      restClip: "Idle",
      clipMap: { idle: "Idle_Lie Prone", walk: "Walk", run: "Run", attack: "Attack", howl: "Howl" },
    });
    actors.beast.pos.set(2, 0, 6);
    actors.beast.facing = -Math.PI * 0.5;
    actors.beast.play("idle");
    // `match` is a let declared further down the module — same TDZ hazard as
    // the props above, same afterBoot gate.
    afterBoot(() => { if (!match) scene.add(actors.beast.root); });
  }).catch((e) => console.warn("[boot] tiger stream-in failed:", e && e.message));
} catch (e) {
  console.error("[boot] actor load failed:", e);
  window.__ACTOR_ERR__ = String(e && e.message || e);
}

// CROWD IMPOSTORS — bake the mid/far tiers' card atlas from the real fighter
// body now that its library is loaded. Failure logs and leaves the geometric
// crowd standing; the swap is all-or-nothing per tier.
try {
  if (actorLibs.fighter) {
    const ok = crowd.bakeImpostors(renderer, actorLibs.fighter, {
      makeBody: () => new Actor(actorLibs.fighter, { height: 1.75, name: "impostor_bake" }),
    });
    console.log(`[boot] crowd impostors ${ok ? "baked + swapped (mid/far)" : "SKIPPED"}`);
  }
} catch (e) {
  console.warn("[boot] crowd impostor bake failed:", e && e.message);
}

// SHADER PRE-WARM, with a render target BOUND.
//
// Adopted from Claude-of-Duty's measured post-mortem: three.js compiles a
// program per material x lighting x target-format VARIANT, and compiling
// against the canvas alone keyed 25 of their 47 programs to a variant the
// game never used — every first muzzle flash and first decal then hit a
// 100-600 ms mid-combat compile. compileAsync with a scratch target bound
// builds the variants the real frames will use, before frame 1. Async, so a
// slow GPU delays readiness, never play.
async function prewarmShaders() {
  try {
    const rt = new THREE.WebGLRenderTarget(64, 64, { samples: 0 });
    renderer.setRenderTarget(rt);
    await renderer.compileAsync(scene, camera);
    renderer.setRenderTarget(null);
    await renderer.compileAsync(scene, camera);   // the canvas variant too
    rt.dispose();
    console.log(`[boot] shaders pre-warmed — ${renderer.info.programs.length} programs`);
  } catch (e) {
    console.warn("[boot] shader pre-warm skipped:", e && e.message);
  }
}
await prewarmShaders();

setProgress(1.0, "Ready.");

// ---------------------------------------------------------------------------
// Bout runtime — the pieces that turn the headless sim into a fight you watch.
// ---------------------------------------------------------------------------
const vfx = new VFX(scene, { sand: sandDamage, camera });
const audio = new Audio({ volumes: inventory.settings.volumes || null });
// Decode the SFX as soon as the browser lets us; music streams separately.
audio.preload().then((r) => console.log(`[audio] ${r.loaded}/${r.loaded + r.failed} sfx decoded`));
const hud = new HUD(document.getElementById("hud"));
const input = new Input();
const combatCam = new CombatCamera(camera);

let bout = null;        // BoutView
let match = null;       // Match
// Bumped by every startMatch. Deferred callbacks capture it so a timer armed by
// one bout can never act on a later one — see the guard on the results timeout.
let matchEpoch = 0;

/**
 * Start one ladder entry.
 *
 * Async because the armatura bodies this card needs are loaded on demand —
 * a 1v1 pulls two bodies, not all eight.
 */
async function startMatch(matchId) {
  endMatch();
  const epoch = ++matchEpoch;
  const def = LADDER.find((m) => m.id === matchId) || LADDER[0];

  bout = new BoutView(scene, actorLibs, { sand: sandDamage, crowd, gates, hypogeum, vfx });

  match = new Match({
    def, inventory, seed: (Date.now() ^ 0x9e3779b9) >>> 0,
    hooks: {
      onSpawn: (list) => {
        for (const s of list) {
          // Stamp the armatura so the view can pick the right helmet crest.
          s.fighter.armaturaId = s.fighter.armaturaId || (s.fighter.champion && s.fighter.champion.armatura) || null;
          bout.spawn(s.fighter, s.role);
        }
      },
      onEvent: (e) => {
        bout.onEvent(e);
        onCombatSound(e);
        // Two layers per impact: the lens moves (CombatCamera) and the image
        // bites (Post). Neither one alone reads as weight.
        if (e.type === "hit") {
          combatCam.addShake(e.heavy ? 0.55 : 0.28); post.impact(e.heavy ? 1.0 : 0.45);
          // Floating damage number over the body that took it.
          hud.damage(new THREE.Vector3(e.x, 1.55, e.z), e.damage || 0,
            { zone: e.zone, heavy: e.heavy, mine: e.attacker === "player" });
        }
        else if (e.type === "death") { combatCam.addShake(0.8); post.impact(1.3, 0.42); }
        else if (e.type === "shield_break" || e.type === "guard_break") { combatCam.addShake(0.5); post.impact(0.85, 0.3); }
      },
      onCue: onMatchCue,
      onState: (s, m) => {
        if (s === STATE.ENTRY) { audio.crowdStart(); audio.music("prematch", { fade: 1.0 }); }
        else if (s === STATE.FIGHT) audio.music(def.type === "champion" ? "boss" : "combat", { fade: 1.6 });
        if (s === STATE.SALUTE) hud.banner(def.name.toUpperCase(), def.desc || "", 2.6);
        else if (s === STATE.FIGHT) hud.banner("BEGIN", "", 1.1);
        else if (s === STATE.VERDICT) {
          const v = m.verdict || {};
          hud.banner(v.playerWon ? "VICTORIA" : (v.spared ? "MISSIO" : "DEFEAT"),
            v.playerWon ? "" : (v.spared ? "The mob grants you your life" : ""), 3.0);
        }
      },
      onResult: (r) => {
        hud.banner(r.playerWon ? "VICTORIA" : "DEFEAT",
          `${r.purse} aurei${r.rankUp ? `  ·  ${r.rankUp.toUpperCase()}` : ""}`, 4.0);
        // Let the banner and the crowd land before the results card appears.
        //
        // GUARDED ON THE EPOCH. This timer used to call endMatch() unguarded,
        // and endMatch() sets `match = null`. startMatch awaits
        // ensureArmaturaBodies() before calling match.start(), so a timer armed
        // by the PREVIOUS bout landing inside that await nulls the NEW match and
        // the next line throws "Cannot read properties of null (reading
        // 'start')". A ladder sweep hit it on 4 of 28 bouts — g4 The Net, v1 The
        // Pursuer, v4 The Substitute and c1 Iron Gaul were simply unplayable —
        // and a player starting their next fight within 3.2 s of a verdict hits
        // exactly the same race.
        setTimeout(() => {
          if (epoch !== matchEpoch) return;      // a newer bout already owns the sand
          endMatch();
          menu.showResult(r, def.name);
          audio.music("ludus", { fade: 2.0 });
        }, 3200);
      },
    },
  });

  // Hide the idle showcase actors while a real bout owns the sand.
  if (actors.player) actors.player.root.visible = false;
  if (actors.beast) actors.beast.root.visible = false;

  // Load exactly the bodies this card calls for BEFORE anyone is spawned,
  // otherwise the view silently falls back to the shared placeholder. The
  // Meshy equipment props ride along — ~1.1 MB once, instant ever after —
  // so every bout actor gets the real galea/cuirass/blades, never a mix.
  await Promise.all([ensureArmaturaBodies(match.requiredBodies()), preloadProps()]);

  // Beasts load per species, on demand. panther.glb is a REAL staged
  // quadruped (its own clips); species without a staged file fall back to the
  // tiger with a console warning instead of silently wearing stripes.
  for (const b of def.beasts || []) {
    if (actorLibs.beasts[b]) continue;
    try {
      actorLibs.beasts[b] = await loadBeast(`assets/beasts/${b}.glb`);
      console.log(`[boot] beast staged: ${b}`);
    } catch (e) {
      if (!actorLibs.beasts.tiger) {
        try { actorLibs.beasts.tiger = await loadBeast("assets/beasts/tiger.glb"); } catch (e2) { /* logged below */ }
      }
      actorLibs.beasts[b] = actorLibs.beasts.tiger;
      console.warn(`[boot] no staged model for beast '${b}' — tiger stand-in`);
    }
  }
  // A venatio can begin before the title tiger stream-in finished.
  if ((def.beasts || []).length && !actorLibs.beasts.tiger) {
    try { actorLibs.beasts.tiger = await loadBeast("assets/beasts/tiger.glb"); } catch (e) { console.warn("[boot] tiger load failed"); }
  }

  // The joust needs its mount. Loaded on demand like the armatura bodies —
  // 1 MB of warhorse has no business in the boot payload of a foot bout.
  if (def.type === "joust" && !actorLibs.mounts.warhorse) {
    try {
      actorLibs.mounts.warhorse = await loadBeast("assets/mounts/warhorse.glb");
    } catch (e) {
      console.warn("[boot] warhorse failed to load:", e && e.message);
    }
  }

  match.start();
  lastMatchId = def.id;
  tutor = def.type === "paegniarius" ? makeTutor() : null;
  // Everyone else gets one controls line during the entry ceremony dead time.
  if (!tutor) hud.prompt("SHIFT hold = block · SPACE = dodge · push toward + click = THRUST", 6);
  combatCam.enabled = true;
  hud.show();
  camRig.auto = false;
  audio.crowdStart();
  return match;
}

function endMatch() {
  if (bout) { bout.clear(); bout = null; }
  match = null;
  paused = false;          // a dead match must never leave the sim frozen
  _buf.attack = null; _buf.dodge = 0;
  combatCam.enabled = false;
  hud.hide();
  audio.crowdStop();
  if (actors.player) actors.player.root.visible = true;
  if (actors.beast) actors.beast.root.visible = true;
}

/**
 * Combat events -> sound. Kept separate from the visual routing in bout.js so
 * neither can silently change the other.
 */
function onCombatSound(e) {
  if (tutor) tutor.onEvent(e);   // the tutorial listens to the same bus
  const at = (id) => {
    const f = match && match.combat.get(id);
    return f ? { x: f.x, z: f.z } : {};
  };
  switch (e.type) {
    case "swing":
      audio.play("swing", { ...at(e.id), gain: 0.55 });
      // The grunt of effort is what makes a swing feel like it costs something.
      if (Math.random() < 0.45) audio.play("effort", { ...at(e.id), gain: 0.5 });
      break;
    case "hit":
      audio.play("hit", { x: e.x, z: e.z, gain: e.heavy ? 1.0 : 0.75 });
      audio.play("hurt", { x: e.x, z: e.z, gain: e.heavy ? 0.85 : 0.55 });
      audio.crowdSurge(e.heavy ? 0.55 : 0.25, 0.12);
      // Being hit had no screen response at all — a bar twitched in a corner.
      if (e.target === "player" && post) post.impact(e.heavy ? 0.9 : 0.55, 0.3);
      break;
    case "block":
      audio.play("block", { ...at(e.target), gain: 0.7 });
      break;
    case "parry":
      audio.play("parry", { ...at(e.target), gain: 0.9, rate: 1.15 });
      audio.crowdSurge(0.5, 0.1);
      break;
    case "pass_begin":
      audio.horn("begin", 0.5);
      audio.crowdSurge(0.3, 0.15);
      break;
    case "joust_shield":
      audio.play("block", { x: e.x, z: e.z, gain: 0.95 });
      audio.crowdSurge(0.4, 0.1);
      break;
    case "joust_body":
      audio.play("hit", { x: e.x, z: e.z, gain: 1.0 });
      audio.play("hurt", { x: e.x, z: e.z, gain: 0.7 });
      audio.crowdSurge(0.6, 0.1);
      break;
    case "joust_unhorse":
      audio.play("shield_break", { x: e.x, z: e.z, gain: 1.0 });
      audio.play("death", { x: e.x, z: e.z, gain: 0.8 });
      audio.crowdSurge(1.0, 0.08);
      break;
    case "refused":
      audio.play("click", { gain: 0.5, rate: 0.7 });
      hud.pulseStamina();
      break;
    case "clash":
      // Steel-on-steel bind — the block sample pitched down reads as blade
      // weight rather than board thud.
      audio.play("parry", { x: e.x, z: e.z, gain: 1.0, rate: 0.9 });
      audio.crowdSurge(0.35, 0.1);
      break;
    case "bypass":
    case "maul":
      // A sica hooking the rim / a cat coming OVER the shield. These landed
      // as damage-through-a-correct-block with zero feedback, which the
      // playtest read as "block randomly fails" — the single legibility
      // caveat on an otherwise-perfect telegraph audit. A scraping pitch-bent
      // swing plus a HUD line names the mechanic the moment it first happens.
      audio.play("swing", { ...at(e.target), gain: 0.8, rate: 0.55 });
      audio.play("block", { ...at(e.target), gain: 0.4, rate: 1.5 });
      if (e.target === "player" && hud.prompt) {
        hud.prompt(e.type === "maul" ? "Over the rim — the beast climbs the shield!"
          : "Hooked past the rim — the sica curls around a guard!", 2.6);
      }
      break;
    case "shield_break":
    case "guard_break":
      audio.play("shield_break", { ...at(e.id), gain: 1.0 });
      audio.crowdSurge(0.7, 0.1);
      break;
    case "death":
      audio.play("death", { x: e.x, z: e.z, gain: 1.0 });
      audio.crowdSurge(1.0, 0.08);
      break;
    default: break;
  }
}

/** Match cues drive the building: gates, lifts, horns. */
function onMatchCue(name, data) {
  cueLog.push({ t: +(frames / 60).toFixed(2), kind: "match", name, ...data });
  if (name === "gate_open") {
    gates.open(data.gate);
    audio.play("gate", { gain: 0.7 });
    audio.crowdHush(0.6, 1.1);
    // Beasts come up out of the hypogeum instead of walking through a door.
    if (match && (match.def.beasts || []).length && data.gate === "triumphalis") hypogeum.open(0);
  } else if (name === "horn") {
    // The cornu is the signature sound of the games — synthesised, because no
    // library on the F: drive contains a Roman brass instrument.
    audio.horn(data.kind === "begin" ? "begin"
      : data.kind === "tertiarius" ? "tertiarius"
      : data.kind === "wave" ? "wave" : "fanfare");
    crowd.react(data.kind === "begin" ? 0.85 : 0.55);
    audio.crowdSurge(data.kind === "begin" ? 0.9 : 0.6, 0.5);
    if (data.kind === "fanfare") crowd.startWave({ laps: 1, speed: 2.6, strength: 1 });
  } else if (name === "verdict") {
    crowd.react(data.playerWon ? 1.0 : 0.6);
    audio.horn(data.playerWon ? "victory" : "death", 0.46);
    audio.crowdSurge(data.playerWon ? 1.0 : 0.5, data.playerWon ? 0.12 : 0.6);
    audio.music(data.playerWon ? "victory" : "defeat", { loop: false });
  } else if (name === "wave") {
    hud.banner(`WAVE ${data.wave}`, `of ${data.of}`, 1.8);
    crowd.react(0.8);
  }
}

// ---------------------------------------------------------------------------
// Armoury. The paper doll IS the live fighter, so a purchase is visible on the
// body the instant it is made.
// ---------------------------------------------------------------------------
const armoury = new Armoury(document.getElementById("hud"), inventory, {
  onEquip: (slot, id, inv) => {
    if (actors.player && actors.player.equipment) {
      actors.player.equipment.applyLoadout({ armour: inv.armourList() });
    }
    // Weapon and shield live on hand bones and are rebuilt by the actor layer.
    syncHeldGear(inv);
  },
  onPreviewRotate: (on) => { camRig.preview = on; },
});

// ---------------------------------------------------------------------------
// Menus. The game now OPENS on the title screen instead of a free-look arena.
// ---------------------------------------------------------------------------
const menu = new Menu(document.getElementById("hud"), {
  inventory, audio, ladder: LADDER,
  hooks: {
    onStartMatch: (id) => { startMatch(id); audio.play("confirm"); },
    // Settings needs the live Input to read and flip strafe handedness.
    getInput: () => input,
    onArmoury: () => { armoury.show(); },
    onBlacksmith: () => { armoury.show("smith"); },
    onTraining: () => { armoury.show("training"); },
    onNewCareer: () => {
      if (actors.player && actors.player.equipment) {
        actors.player.equipment.applyLoadout({ armour: inventory.armourList() });
      }
    },
    onQuality: () => { /* applied on the next boot; the note in Settings says so */ },
  },
});

// Returning from the armoury/blacksmith/training goes back to the hub.
armoury.hooks.onClose = () => { if (!match) menu.show(SCREEN.HUB); };

// ---------------------------------------------------------------------------
// Pause
// ---------------------------------------------------------------------------
// ESC used to call endMatch() directly: the bout was destroyed with no
// confirmation, no verdict, no purse, no recorded loss and no gear wear —
// a free rewind of any losing fight, on the key every player presses in their
// first session. There was also no pause of any kind: the fixed-step loop ran
// unconditionally and window.__PAUSE__ (which the shell's pause button and the
// fullscreen-exit handler in game_controls.js drive) was never assigned, so
// both silently no-opped.
let paused = false;
// Buffered player intents — see the INPUT BUFFER block in stepSim.
const _buf = { attack: null, dodge: 0 };

function setPaused(on) {
  paused = !!on;
  if (paused) {
    audio.music("menu", { fade: 0.6 });
  } else if (match) {
    audio.music(match.def.type === "champion" ? "boss" : "combat", { fade: 0.8 });
  }
}

function pauseMatch() {
  if (!match || paused) return;
  setPaused(true);
  menu.show(SCREEN.PAUSE);
}

menu.hooks.onResume = () => { setPaused(false); menu.hide(); };
// Defeat begs a rematch; the results screen offers the same card back.
let lastMatchId = null;
menu.hooks.onRetry = () => { if (lastMatchId) { menu.hide(); startMatch(lastMatchId); } };

// ---------------------------------------------------------------------------
// Onboarding — the tutorial bout TEACHES, driven by real events.
//
// The only controls documentation in the game was one italic paragraph inside
// Settings. t1 is literally titled "Learn the guard" and spawned zero
// instruction. This walks a new player through the four verbs against the
// paegniarius, each step gated on the player actually DOING the thing.
// ---------------------------------------------------------------------------
let tutor = null;
function makeTutor() {
  return {
    step: 0, moved: 0, blocks: 0, hits: 0, dodged: false, lastX: null, lastZ: null,
    onEvent(e) {
      if ((e.type === "block" || e.type === "parry") && e.target === "player") this.blocks++;
      if (e.type === "hit" && e.attacker === "player") this.hits++;
      if (e.type === "dodge" && e.id === "player") this.dodged = true;
    },
    tick(m) {
      const p = m.player;
      if (!p || !p.alive || m.state !== "fight") return;
      if (this.lastX !== null) this.moved += Math.hypot(p.x - this.lastX, p.z - this.lastZ);
      this.lastX = p.x; this.lastZ = p.z;
      switch (this.step) {
        case 0:
          hud.prompt("W A S D — close with him");
          if (this.moved > 4) this.step = 1;
          break;
        case 1:
          hud.prompt(`HOLD SHIFT to block — take his blows on the guard  (${Math.min(3, this.blocks)}/3)`);
          if (this.blocks >= 3) this.step = 2;
          break;
        case 2:
          hud.prompt(`Push TOWARD him + CLICK = thrust · sideways = cut  (${Math.min(2, this.hits)}/2 landed)`);
          if (this.hits >= 2) this.step = 3;
          break;
        case 3:
          hud.prompt("SPACE — roll clear of a swing");
          if (this.dodged) this.step = 4;
          break;
        case 4:
          hud.prompt("Finish it.", 4);
          this.step = 5;
          break;
        default: break;
      }
    },
  };
}
menu.hooks.onForfeit = () => {
  // Route the forfeit through the SAME verdict path a defeat takes, so the
  // loss, the purse and the wear are all real. _decide(false) moves the match
  // to VERDICT; the normal beat flow then runs EXIT and _finish -> settle.
  setPaused(false);
  menu.hide();
  if (match && !match.result) match._decide(false);
};

// The shell contract every sibling FFG game exposes (see aether-isles
// runtime/ffg_shell.js): the portal pause button and the fullscreen-exit
// auto-pause both drive this object.
window.__PAUSE__ = {
  pause: () => pauseMatch(),
  resume: () => { if (paused) { setPaused(false); if (menu.screen === SCREEN.PAUSE) menu.hide(); } },
  toggle: () => { paused ? window.__PAUSE__.resume() : pauseMatch(); },
  get paused() { return paused; },
};

window.addEventListener("keydown", (e) => {
  if (e.code === "Tab") {
    e.preventDefault();
    // The armoury is a between-bouts screen. Opening it MID-BOUT left the sim
    // running while shop clicks fired attacks into the live fight.
    if (match && !paused) return;
    if (!menu.screen || menu.screen === SCREEN.NONE) armoury.toggle();
  }
  if (e.code === "Escape") {
    e.preventDefault();
    if (armoury.open) { armoury.hide(); return; }
    if (match) {
      if (!paused) pauseMatch();
      else if (menu.screen === SCREEN.PAUSE) { setPaused(false); menu.hide(); }
      // paused but deeper in a submenu (Settings): let the menu's Back handle it
      return;
    }
    menu.show(menu.screen === SCREEN.NONE ? SCREEN.HUB : SCREEN.NONE);
  }
});

/** Rebuild the held weapon/shield to match the inventory. */
function syncHeldGear(inv) {
  const p = actors.player;
  if (!p) return;
  // Drop existing hand mounts.
  const kill = [];
  p.model.traverse((o) => { if (o.name === "weapon_mount") kill.push(o); });
  // Prop-weapon clones share geometry with the props.js template cache.
  kill.forEach((m) => { m.traverse((o) => { if (o.isMesh && !o.userData.sharedGeo) o.geometry.dispose(); }); m.removeFromParent(); });

  const wid = inv.equipped.weapon;
  const maker = { gladius: makeGladius, spatha: makeGladius, sica: makeGladius, trident: makeTrident, hasta: makeTrident, dimachaerus: makeGladius }[wid] || makeGladius;
  attachWeapon(p, makeWeapon(wid, maker), { palm: 0.055 });
  if (inv.equipped.shield && inv.equipped.shield !== "none") {
    attachWeapon(p, makeScutum(inv.equipped.shield === "parmula" ? { w: 0.44, h: 0.46, curve: 0.10 } : {}), {
      bone: /LeftHand|Hand_L|mixamorig.*LeftHand/i, palm: 0.04, align: "shield",
    });
  }
}

// ---------------------------------------------------------------------------
// Camera rig — a cinematic orbit until gameplay takes over.
// ---------------------------------------------------------------------------
const camRig = {
  target: new THREE.Vector3(0, 1.4, 0),
  theta: Math.PI * 0.82,
  phi: 0.30,
  dist: 46,
  auto: true,
};

function updateCamera(dt) {
  // A live bout owns the camera: it frames the player and the nearest threat,
  // pulls back as they separate, and drops low during a kill's slow motion.
  if (combatCam.enabled && match && match.player) {
    const p = match.player;
    const foes = match.combat.hostilesTo(match.player ? match.player.team : 0);
    const f = foes.length
      ? foes.reduce((a, b) => (Math.hypot(a.x - p.x, a.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? a : b))
      : null;
    combatCam.update(dt,
      new THREE.Vector3(p.x, 0, p.z),
      f ? new THREE.Vector3(f.x, 0, f.z) : null,
      { slowMo: match.combat.slowMo });
    return;
  }

  // Armoury preview: orbit the fighter close and slow so the player can see
  // what they just bought from every side.
  if (camRig.preview && actors.player) {
    camRig.theta += dt * 0.35;
    camRig.target.set(actors.player.pos.x, 1.02, actors.player.pos.z);
    camRig.dist = damp(camRig.dist, 3.4, 4, dt);
    camRig.phi = damp(camRig.phi, 0.12, 4, dt);
  } else if (camRig.auto) camRig.theta += dt * 0.055;
  const ce = Math.cos(camRig.phi);
  camera.position.set(
    camRig.target.x + Math.cos(camRig.theta) * camRig.dist * ce,
    camRig.target.y + Math.sin(camRig.phi) * camRig.dist,
    camRig.target.z + Math.sin(camRig.theta) * camRig.dist * ce
  );
  camera.lookAt(camRig.target);
}

// Mouse/touch orbit so the arena can be inspected from any angle.
let dragging = false, lastX = 0, lastY = 0;
renderer.domElement.addEventListener("pointerdown", (e) => {
  dragging = true; camRig.auto = false; lastX = e.clientX; lastY = e.clientY;
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener("pointerup", (e) => {
  dragging = false;
  try { renderer.domElement.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
});
renderer.domElement.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  camRig.theta -= (e.clientX - lastX) * 0.005;
  camRig.phi = clamp(camRig.phi + (e.clientY - lastY) * 0.004, -0.05, 1.35);
  lastX = e.clientX; lastY = e.clientY;
});
renderer.domElement.addEventListener("wheel", (e) => {
  e.preventDefault();
  camRig.dist = clamp(camRig.dist * (1 + Math.sign(e.deltaY) * 0.09), 8, 260);
}, { passive: false });

// ---------------------------------------------------------------------------
// Spectacle cues. The gate and lift systems emit events on exact beats; this
// is where they turn into crowd reactions (and, once audio lands, horns).
// ---------------------------------------------------------------------------
const cueLog = [];

/**
 * ONE fixed simulation step. Both the requestAnimationFrame loop and the
 * verification harness drive the world through here, so what an automated
 * check exercises is exactly what a player gets. (These were briefly two
 * separate code paths, and the harness silently advanced nothing but the
 * crowd — gates and lifts sat frozen at t=0 while every check reported
 * "opening".)
 *
 * This is also the multiplayer seam: a server tick calls exactly this.
 */
function stepSim(dt) {
  // Paused = frozen HERE, not just in the rAF accumulator — the verification
  // harness's step() drives stepSim directly, and a pause that only the
  // requestAnimationFrame path respects is a pause that cannot be tested.
  if (paused) return;
  crowd.update(dt);

  // --- the live bout ------------------------------------------------------
  if (match && bout) {
    // The player's intent, in camera space, aimed at the nearest threat.
    const p = match.player;
    let targetAngle = null;
    if (p && p.alive) {
      const foes = match.combat.hostilesTo(match.player ? match.player.team : 0);
      if (foes.length) {
        const f = foes.reduce((a, b) =>
          (Math.hypot(a.x - p.x, a.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? a : b));
        targetAngle = Math.atan2(f.x - p.x, f.z - p.z);
      }
    }
    // lookYaw, NOT yaw — see CombatCamera.lookYaw. `yaw` is where the camera
    // sits; input must be rotated into where it looks.
    const cmd = input.command({ cameraYaw: combatCam.lookYaw, targetAngle });

    // INPUT BUFFER — a press during your own swing is a queued intent, not a
    // dropped one. wasPressed() is edge-triggered and cleared every frame, and
    // canAttack() is false through the whole 0.52-0.98 s windup+active window,
    // so a combo input landing mid-swing simply vanished: the standard action-
    // game buffer (Souls, DMC, God of War all ship one) holds the last press
    // for 0.35 s and fires it on the first tick it becomes valid. The buffer
    // clears when the sim ACCEPTS the action (phase edge), watched below.
    const nowS = match.time;
    if (p && p.alive) {
      if (cmd.attack) _buf.attack = { t: nowS, dir: cmd.attackDir, heavy: cmd.heavy };
      else if (_buf.attack && nowS - _buf.attack.t < 0.35 && p.canAttack()) {
        cmd.attack = true; cmd.attackDir = _buf.attack.dir; cmd.heavy = _buf.attack.heavy;
      } else if (_buf.attack && nowS - _buf.attack.t >= 0.35) _buf.attack = null;
      if (cmd.dodge) _buf.dodge = nowS;
      else if (_buf.dodge && nowS - _buf.dodge < 0.35 && p.canAct() && p.stamina >= 22) {
        cmd.dodge = true;
      } else if (_buf.dodge && nowS - _buf.dodge >= 0.35) _buf.dodge = 0;
    }
    const prevPhase = p ? p.phase : null;
    match.update(dt, cmd);
    // Accepted? The phase edge is the receipt.
    if (p) {
      if (_buf.attack && p.phase === "windup" && prevPhase !== "windup") _buf.attack = null;
      if (_buf.dodge && p.phase === "dodge" && prevPhase !== "dodge") _buf.dodge = 0;
    }
    input.consume();

    // The sim scales its own step during a kill; the view has to move at the
    // same rate or bodies sprint through a slow-motion death.
    const simScale = match.combat.slowMo > 0 ? match.combat.slowMoScale : 1;
    bout.update(dt, simScale);
    if (match.state === "exit") bout.dragCorpses(dt, gates.entryPoint("libitinaria", 2.0));
    crowd.lookAt(new THREE.Vector3(p ? p.x : 0, 1, p ? p.z : 0));
    hud.update(match.hudState(), dt, camera);
    if (tutor) tutor.tick(match);
    // Low health closes the screen in — post.setDanger drives vignette+desat.
    if (post && match.player) {
      const hpF = match.player.maxHp ? Math.max(0, match.player.hp) / match.player.maxHp : 1;
      post.setDanger(match.player.alive && hpF < 0.35 ? (1 - hpF / 0.35) : 0);
    }

    // Audio follows the player and the crowd's visible mood, so what is heard
    // and what is seen cannot drift apart.
    if (p) {
      audio.setListener(p.x, p.z, combatCam.yaw);
      audio.step(p.x, p.z, p.speed);
    }
    audio.crowdExcitement(crowd.excitement);
  } else {
    if (actors.player) actors.player.update(dt, actors.player.speed);
    if (actors.beast) actors.beast.update(dt, actors.beast.speed);
  }

  // Particles ride the same clock as the bodies — blood hanging in the air at
  // full speed during a slow-motion kill is the tell that breaks the shot.
  vfx.update(dt * (match && match.combat.slowMo > 0 ? match.combat.slowMoScale : 1));
  // Gate and lift events are the cues the audio and crowd systems react to
  // (horn on gate-start, roar on cage-release), so they are dispatched here
  // rather than polled.
  for (const ev of gates.update(dt)) onGateEvent(ev);
  for (const ev of hypogeum.update(dt)) onLiftEvent(ev);
}

function onGateEvent(ev) {
  cueLog.push({ t: +(frames / 60).toFixed(2), kind: "gate", id: ev.id, event: ev.event });
  if (ev.event === "start") {
    // The grind of the Triumphalis opening is what quiets a crowd and then
    // detonates it — anticipation first, roar on the reveal.
    crowd.setExcitement(0.12, true);
  } else if (ev.event === "done") {
    crowd.react(0.85);
    if (ev.id === "triumphalis") crowd.startWave({ laps: 1, speed: 2.8, strength: 1 });
  }
}

function onLiftEvent(ev) {
  cueLog.push({ t: +(frames / 60).toFixed(2), kind: "lift", index: ev.lift.index, event: ev.event });
  if (ev.event === "doors") crowd.setExcitement(0.2, true);   // hush as the sand splits
  else if (ev.event === "rising") crowd.react(0.5);
  else if (ev.event === "released") { crowd.react(1.0); crowd.startWave({ laps: 1, speed: 3.4, strength: 1 }); }
}

// ---------------------------------------------------------------------------
// Perf monitor — a rolling frame-time average that can demote quality.
// ---------------------------------------------------------------------------
const perf = {
  samples: new Float32Array(120),
  idx: 0, filled: 0,
  push(ms) {
    this.samples[this.idx] = ms;
    this.idx = (this.idx + 1) % this.samples.length;
    if (this.filled < this.samples.length) this.filled++;
  },
  avg() {
    let s = 0;
    for (let i = 0; i < this.filled; i++) s += this.samples[i];
    return this.filled ? s / this.filled : 0;
  },
  fps() { const a = this.avg(); return a > 0 ? 1000 / a : 0; },
};

// ---------------------------------------------------------------------------
// Fixed-timestep loop
// ---------------------------------------------------------------------------
const FIXED_DT = 1 / 60;
let acc = 0;
let last = performance.now();
let frames = 0;
let bootRevealed = false;

/**
 * Drop the loading overlay and open the title screen. Idempotent, so a
 * verification harness can call it directly without racing the frame loop.
 */
function revealTitle() {
  bootRevealed = true;
  loadEl.style.opacity = "0";
  setTimeout(() => {
    loadEl.remove();
    // The game OPENS on the title screen. Everything — armoury, blacksmith,
    // training, the ladder — is reachable from here without a console.
    menu.show(SCREEN.TITLE);
    audio.music("menu", { fade: 2.2 });
  }, 700);
}

function frame(now) {
  requestAnimationFrame(frame);
  const rawMs = now - last;
  last = now;
  perf.push(rawMs);

  // Clamp so a tab-switch stall doesn't fast-forward the simulation.
  const dt = Math.min(rawMs / 1000, 0.1);
  // While paused the accumulator is DISCARDED, not banked — if it kept
  // accumulating, resume would fast-forward up to five sim steps per frame
  // until the debt drained, which reads as the fight lurching to catch up.
  if (paused) {
    acc = 0;
  } else {
    acc += dt;
  }
  let steps = 0;
  while (acc >= FIXED_DT && steps < 5) {
    stepSim(FIXED_DT);
    acc -= FIXED_DT;
    steps++;
  }

  updateCamera(dt);
  // Haze tracks how churned the sand is. A long, bloody bout ends visibly
  // dirtier than it started, and `clear()` between matches takes it back down
  // with the stains. Capped well below 1 — this is atmosphere, not fog.
  post.setDust(match ? Math.min(0.55, sandDamage.splats / 900) : 0);
  post.update(dt);

  // renderer.info.autoReset is OFF (set at construction). three resets the
  // counters at the start of every render() call, so with a composer in play
  // the numbers left standing afterwards describe only the LAST pass — one
  // full-screen triangle — and every draw-call reading becomes "1 call, 1
  // triangle". Resetting once per FRAME instead makes info accumulate across
  // the shadow pass, the scene pass and each post pass, which is the number
  // that actually matters.
  renderer.info.reset();
  post.render();

  // Demo choreography for the arena preview: periodic crowd swells and a wave.
  frames++;
  // Idle arena ambience, only while no bout owns the sand.
  if (!match) {
    if (frames % 600 === 120) crowd.startWave({ laps: 1, speed: 2.4, strength: 1 });
    if (frames % 300 === 0) crowd.react(0.55);
    crowd.lookAt(camRig.target);
  }

  // LATCHED, not `frames === 12`. An exact-equality check is skipped forever if
  // frames are ever batched or dropped (a stepped verification run, a stalled
  // tab), and the title screen then never appears at all.
  if (!bootRevealed && frames >= 12) {
    bootRevealed = true;
    revealTitle();
  }
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// Verification hooks (FFG convention — 3D games are verified by evaluating
// these, because WebGL screenshots hang the preview harness).
// ---------------------------------------------------------------------------
console.log("[boot] COMPLETE — __FFG3D__ assigned (v47)");
window.__FFG3D__ = {
  renderer, scene, camera, colosseum, crowd, sky, gates, hypogeum, actors,
  inventory, armoury, vfx, hud, input, combatCam, audio, post,
  get match() { return match; },
  get bout() { return bout; },
  quality: QUALITY,
  stats: () => ({
    quality: QUALITY,
    dpr: renderer.getPixelRatio(),
    fps: +perf.fps().toFixed(1),
    frameMs: +perf.avg().toFixed(2),
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    programs: renderer.info.programs ? renderer.info.programs.length : -1,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    crowd: crowd.stats(),
    gates: gates.stats(),
    hypogeum: hypogeum.stats(),
    arenaDrawCalls: colosseum.drawCallEstimate(),
    camera: { x: +camera.position.x.toFixed(1), y: +camera.position.y.toFixed(1), z: +camera.position.z.toFixed(1) },
    timeOfDay: sky.todKey,
    frames,
  }),
  __test: {
    setTimeOfDay: (k) => {
      sky.setTimeOfDay(k);
      renderer.toneMappingExposure = sky.exposure();
      sky.bakeEnvironment(renderer);   // the sky IS the fill light — re-bake it
      return k;
    },
    setCamera: (theta, phi, dist) => { camRig.auto = false; camRig.theta = theta; camRig.phi = phi; camRig.dist = dist; updateCamera(0); return true; },
    /**
     * Drive N complete frames synchronously. Verification harnesses run in a
     * hidden tab where requestAnimationFrame is suspended, so without this the
     * game looks dead to every automated check. Returns real timing measured
     * around gl.finish() so the numbers are GPU-inclusive, not just JS submit.
     */
    step: (n = 1, dt = 1 / 60) => {
      const gl = renderer.getContext();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        stepSim(dt);              // the SAME step the rAF loop runs
        updateCamera(dt);
        renderer.render(scene, camera);
        frames++;
      }
      gl.finish();
      const ms = performance.now() - t0;
      return {
        frames: n,
        totalMs: +ms.toFixed(2),
        msPerFrame: +(ms / n).toFixed(3),
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        size: [renderer.domElement.width, renderer.domElement.height],
      };
    },
    resize: (w, h) => {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      return [renderer.domElement.width, renderer.domElement.height];
    },
    /**
     * Render offscreen and read the pixels back, so the frame can be inspected
     * even when the page is not compositing (hidden tab / undisplayed pane).
     * Posts the image to the dev shot server. Returns the server's reply.
     *
     * Deliberately uses a RenderTarget + readRenderTargetPixels rather than
     * canvas.toDataURL(): the latter needs preserveDrawingBuffer and returns
     * whatever survived compositing, which in a hidden tab is often nothing.
     */
    capture: async (name = "shot.png", w = 1600, h = 900, opts = {}) => {
      const rt = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.UnsignedByteType,
        colorSpace: THREE.SRGBColorSpace,
        samples: opts.samples ?? 4,
      });
      const prevAspect = camera.aspect;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();

      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);

      const buf = new Uint8Array(w * h * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
      renderer.setRenderTarget(null);

      camera.aspect = prevAspect;
      camera.updateProjectionMatrix();

      // GL origin is bottom-left; canvas is top-left. Flip rows.
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d");
      const img = ctx.createImageData(w, h);
      const row = w * 4;
      for (let y = 0; y < h; y++) {
        const src = (h - 1 - y) * row;
        img.data.set(buf.subarray(src, src + row), y * row);
      }
      ctx.putImageData(img, 0, 0);

      const url = cv.toDataURL(opts.jpeg ? "image/jpeg" : "image/png", opts.quality ?? 0.88);
      rt.dispose();
      const res = await fetch(`/__shot/${name}`, { method: "POST", body: url });
      return { name, w, h, bytes: url.length, server: await res.text() };
    },
    wave: () => { crowd.startWave({ laps: 1 }); return true; },
    excite: (v) => { crowd.setExcitement(v, true); return v; },
    openGate: (id) => { gates.open(id); return gates.stats(); },
    closeGate: (id) => { gates.close(id); return gates.stats(); },
    openLift: (i) => { hypogeum.open(i); return hypogeum.stats(); },
    /** Equip/unequip on the live model — proves purchases become visible. */
    equip: (armour) => {
      if (!actors.player || !actors.player.equipment) return null;
      const worn = actors.player.equipment.applyLoadout({ armour: armour || [] });
      return { worn, drawCalls: actors.player.equipment.drawCalls() };
    },
    worn: () => (actors.player && actors.player.equipment ? actors.player.equipment.worn() : null),
    armoury: (open) => { open ? armoury.show() : armoury.hide(); return armoury.open; },
    buy: (kind, id) => { const r = inventory.buy(kind, id); armoury.render(); return r; },
    equipItem: (slot, id) => {
      const r = inventory.equip(slot, id);
      if (r.ok && actors.player && actors.player.equipment) {
        actors.player.equipment.applyLoadout({ armour: inventory.armourList() });
        syncHeldGear(inventory);
      }
      armoury.render();
      return r;
    },
    inv: () => ({
      gold: inventory.gold, wins: inventory.wins, rank: inventory.rank().name,
      equipped: { ...inventory.equipped }, owned: JSON.parse(JSON.stringify(inventory.owned)),
      mobility: inventory.mobility(), armatura: inventory.matchedArmatura()?.name || null,
    }),
    settle: (o) => inventory.settle(o),
    blood: (x, z, r = 0.5, s = 1) => sandDamage.splat(x, z, r, "blood", s),
    scuff: (x, z, r = 0.4, s = 0.7) => sandDamage.splat(x, z, r, "scuff", s),
    dragTrail: (x0, z0, x1, z1) => { sandDamage.trail(x0, z0, x1, z1); return sandDamage.splats; },
    clearSand: () => { sandDamage.clear(); return true; },
    sandSplats: () => sandDamage.splats,
    closeLift: (i) => { hypogeum.close(i); return hypogeum.stats(); },
    menu: (screen) => { menu.show(screen); return menu.screen; },
    menuText: () => (menu.el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 400),
    menuButtons: () => [...menu.el.querySelectorAll("button")].map((b) => b.textContent.trim().split(/\r?\n/)[0]),
    clickMenu: (txt) => {
      const b = [...menu.el.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith(txt));
      if (!b) return false;
      b.click();
      return menu.screen;
    },
    reveal: () => { revealTitle(); return true; },
    cues: () => cueLog.slice(-40),
    clearCues: () => { cueLog.length = 0; return true; },
    /** Start a ladder match by id (default: the first). */
    startMatch: async (id) => {
      const m = await startMatch(id || LADDER[0].id);
      return {
        id: m.def.id, name: m.def.name, type: m.def.type, spawned: m.spawned.length,
        bodies: m.requiredBodies(),
        loaded: Object.keys(actorLibs.armaturae),
      };
    },
    loadBodies: (ids) => ensureArmaturaBodies(ids).then(() => Object.keys(actorLibs.armaturae)),
    endMatch: () => { endMatch(); return true; },
    matchState: () => (match ? match.snapshot() : null),
    hudState: () => (match ? match.hudState() : null),
    boutStats: () => (bout ? bout.stats() : null),
    vfxStats: () => vfx.stats(),
    audioStats: () => audio.stats(),
    horn: (call) => audio.horn(call || "fanfare"),
    sfx: (cue, o) => !!audio.play(cue, o || {}),
    setVolume: (bus, v) => { audio.setVolume(bus, v); return audio.stats().volumes; },
    playMusic: (n) => { audio.music(n); return audio.currentMusic; },
    ladder: () => LADDER.map((m) => ({ id: m.id, rank: m.rank, type: m.type, name: m.name })),
    /** Drive N sim steps with a synthetic player command (for verification). */
    fight: (n = 60, cmd = {}) => {
      if (!match) return null;
      for (let i = 0; i < n; i++) { match.update(1 / 60, cmd); bout.update(1 / 60); vfx.update(1 / 60); }
      return match.hudState();
    },
    /** Rig diagnostics — proves clips actually bound, not just that files loaded. */
    actors: () => {
      const d = {};
      for (const k of ["player", "beast"]) {
        const a = actors[k];
        if (!a) { d[k] = null; continue; }
        d[k] = {
          clips: Object.keys(a.actions),
          playing: a.currentName,
          height: +a.height.toFixed(2),
          rawRigHeight: +a.rawHeight.toFixed(3),
          pos: [+a.pos.x.toFixed(2), +a.pos.y.toFixed(2), +a.pos.z.toFixed(2)],
          weaponMounts: (() => { let n = 0; a.model.traverse((o) => { if (o.name === "weapon_mount") n++; }); return n; })(),
        };
      }
      return d;
    },
    anim: (who, logical, once = false) => {
      const a = actors[who];
      if (!a) return null;
      return once ? a.playOnce(logical) : a.play(logical);
    },
    placeActor: (who, x, z, facing) => {
      const a = actors[who];
      if (!a) return null;
      a.pos.set(x, 0, z);
      if (facing !== undefined) { a.facing = facing; a.visualFacing = facing; }
      return [x, z];
    },
    dims: () => ({
      floor: { a: ARENA.floor.a, b: ARENA.floor.b },
      outer: colosseum.outer,
      caveaTop: colosseum.caveaTop,
      atticTop: colosseum.atticTop,
    }),
  },
};
