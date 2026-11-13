// core/weapons/viewmodel.js [A4] — arms+gun rig: sway, bob, ADS spring
// layers, kick, weapon-switch / reload / pump animation, scope state, and the
// FIRST-PERSON CAMERA RIG.
//
// Frozen surface (architecture §3.11 + changelog v2.1c):
//   createViewmodel(ctx) → { equip, update, kick, muzzleWorld, setVisible,
//                            prewarmables }
//
// R8 (BINDING): DUAL-CAMERA, SAME SCENE. The weapon rig lives in the main
// scene on VM_LAYER, parented to the world camera; a second
// PerspectiveCamera at 60° VERTICAL FOV (VIEWMODEL.fovDeg — independent of
// world FOV) renders ONLY that layer after a clearDepth(). Same scene graph,
// same fixed light pool — the dual-SCENE 20× irradiance trap stays banned.
//
// RENDER-PASS SEAM (A6): this module exposes `ctx.vmRenderPass(renderer)`
// (clearDepth + render scene with the vm camera into the CURRENT render
// target) and `ctx.vmCamera`. post.js calls ctx.vmRenderPass(renderer)
// immediately after its world scene pass — inside the HDR target, before
// bloom/composite — and calls ctx.claimVmPass() once at construction.
// INTERIM AUTO-PASS: until a post implementation claims the pass, a sentinel
// object's onAfterRender runs the same nested render at the end of the
// default-framebuffer scene pass.
// LIGHT LAYERS (A6): pool lights enable VM_LAYER (light.layers.enableAll()) or
// the vm camera collects zero lights and the gun renders black.
//
// TICK INTERPOLATION: update(dt, alpha) builds the camera's BASE position by
// lerping the player's last two SIM TICKS (boot owns that history, handed back
// through ctx.playerRenderPos(alpha, out)). Only POSITION is interpolated —
// yaw/pitch stay raw off input.state (interpolating look trades smoothness for
// input latency). Every offset below — eye height, crouch lerp, bob, landing
// dip, recoil/ADS — is applied ON TOP of that base.
//
// CAMERA RIG OWNERSHIP: this module owns the first-person camera per
// architecture §3.4 ("the camera renders from sim state plus view-only bob/kick
// offsets") and combat_spec §1.3/§1.4/§1.6/§1.7/§2.4: eye heights + 140 ms
// crouch lerp, slide eye 0.90 m + 2.5° roll + FOV +4°, head-bob (camera share,
// bob slider applies here only), landing dips, ADS/sprint FOV kinetics, §2.6 ADS
// sway + Corvus breath hold. The rig only drives while: vm visible AND
// !ctx.cameraDetached AND the mission phase is live AND the player is alive.
//
// PRESENTATION PASS (2026-10) — what is new in this file:
//   * LIGHT RIG: hemisphere fill + camera-space key + cool rim, VM_LAYER only
//     (the viewmodel was a dark navy silhouette; the owner: "muddy").
//   * SWITCH: the held weapon is lowered, the MESH SWAPS AT 42% OF THE SIM'S
//     switchS (sim only changes weapon.id at the end), the new one is raised.
//     All five GLBs are preloaded + material-warmed at construction, so a swap
//     is synchronous and never hitches.
//   * RELOAD: per-class hand animation from the sim's reloading state — magazine
//     out / drop / new magazine / seat / rack (rifles), grip magazine (pistol,
//     SMG), per-shell insertion with the gun canted (shotgun).
//   * PUMP: the shotgun forend and the support hand rack after every blast.
//   * SPRINT / SLIDE poses blend smoothly instead of stepping.
//   * SCOPE: weapons flagged view.scope get a scope blend (0..1) that hides the
//     3D gun at full ADS and drives the HUD scope overlay (hud.js reads
//     `vm.scope`). The scoped weapon's sway is a REAL aim wobble (via recoil's
//     nudge), so what the lens shows is where the round goes; breath-hold
//     (Shift) steadies it.
//   * SHOTGUN CONTRACT: nine "shot" events per blast — kick() counts ROUNDS (shots
//     fired ÷ pellets), never pellets.

import * as THREE from "three";
import { WEAPONS, SWAY, VIEWMODEL, FEEL, SLOT_ORDER } from "./weapon_data.js";
import { loadWeaponGLB, loadedPrototypes, loadAllWeapons, invalidateWeapon } from "./weapon_meshes.js";
// The SAME stride model the footsteps run on (player.js §1.6).
import { strideLength } from "../sim/player.js";

export const VM_LAYER = 2;

// fraction of the sim's switchS at which the held mesh is swapped (lower first half, raise second)
const SWITCH_SWAP = 0.42;

const DEG = Math.PI / 180;
const LIVE_PHASES = new Set(["infil", "assault", "exfil"]);

// §1.6 head-bob table — camera-share amplitudes (m) and vertical freqs (Hz).
// Viewmodel bob = camera numbers × 2.3. Lateral runs at half the vertical
// frequency (the table's lateral rows), amplitude column 3.
// 2026-10-14 (owner: movement "seems to slide rather than run"): the old camera
// share — 4.8 mm walking, 8.4 mm sprinting — was below what reads as a footfall
// at 60 fps. Raised to ~9 / 16 / 19 mm with more sprint roll; the bob setting
// slider still scales the camera share, and ADS still cuts it to 25%.
const BOB = {
  walk:   { v: 0.0090, hz: 2.1, l: 0.0048 },
  sprint: { v: 0.0160, hz: 2.6, l: 0.0075, roll: 0.75 * DEG, rollHz: 1.3 },
  tac:    { v: 0.0190, hz: 2.9, l: 0.0088, roll: 0.95 * DEG, rollHz: 1.45 },
  crouch: { v: 0.0055, hz: 1.5, l: 0.0032 },
};

const EYE_STAND = 1.62, EYE_CROUCH = 1.10, EYE_SLIDE = 0.90; // §1.3/§1.4

// CAMERA SHAKE (2026-10-14 review: "no camera shake anywhere" — a mortar landing
// 8 m away did not move the view at all). Trauma model: events ADD trauma (0..1),
// it bleeds off linearly, and the visible shake is trauma^2 so small hits stay
// subtle while a call-in on top of you rattles the frame. Render-only, like the
// fire-response springs: aim (input.state) is never touched.
const SHAKE = {
  decay: 1.35,                // trauma per second
  pitch: 0.030, yaw: 0.026, roll: 0.045,   // rad at trauma 1
  pos: 0.030,                 // m of eye jitter at trauma 1
  hz: 23,                     // base noise rate
};

// ===== FIRE RESPONSE (combat_spec §2.3, VT §5 layer 6, VT §7) ==============
// Every channel is an under-damped SPRING that a round IMPULSES (adds velocity
// to), integrated every frame: a single shot peaks inside VT §5.6's per-shot
// envelope (translation back 8-15 mm, rotation up 1-3°); sustained auto fire
// ACCUMULATES to a HELD displacement; the return overshoots slightly and settles
// over ~0.5 s. Render-only offsets (input.state is written only by recoil.js).
// Gains were set BY MEASUREMENT against that envelope (see git history for the
// iter05-iter08 sweeps) — do not "tune by eye".
const KICK = {
  omega: 14.0, zeta: 0.50,        // viewmodel spring: period 0.45 s, settles ~0.6 s
  camOmega: 16.0, camZeta: 0.55,  // camera spring: faster, tighter
  rotXPerKick: 0.468,   // rad/s of pitch-up  (Warden 3.2 -> 3.00° single-shot peak)
  rotZPerKick: 0.420,   // rad/s of roll, sign alternates per round
  rotYPerKick: 0.190,   // rad/s of yaw, sign alternates opposite the roll
  posYPerKick: 0.090,   // m/s of rise
  posZPerPunch: 0.562,  // m/s back along the barrel (Warden 0.75 -> 15.0 mm peak)
  camPitchPerKick: 0.520, // rad/s of view-only camera pitch punch (the ceiling —
                          // a view-only pitch decouples the crosshair from the bullet)
  camRollPerKick: 0.620,  // free channel: rolling about the view axis moves nothing
  camYawPerKick: 0.120,
  fovPerKick: 34.0,       // deg/s of FOV punch (uniform scale about the view centre)
  maxRotX: 0.200, maxRotZ: 0.130, maxRotY: 0.075,
  maxPosY: 0.045, maxPosZ: 0.090,
  maxCamPitch: 0.105, maxCamRoll: 0.130, maxCamYaw: 0.042, maxFov: 6.5,
  // ADS keeps the sight picture readable: the gun is braced and the shooter
  // is deliberate, so the same round moves less of the frame.
  adsVmMult: 0.55, adsCamMult: 0.45,
  altRollMult: -0.55,   // every other round rolls the other way, weaker
};

// ===== HANDLING FEEL (2026-11 lane VM) =======================================
// A SECOND family of under-damped springs for the non-fire motion: reload beats
// (magazine out, seat slap, charging-handle release, shell push), ADS settle, the
// dry click, jump, landing and slide entry. Same integrator and sub-stepping as
// KICK but a separate set, so the MEASURED fire-response gains above are untouched.
// Impulses are rad/s and m/s (velocity kicks); the spring turns each into a short
// overshooting move that reads as the weight of the gun.
const MOVE_SPRING = {
  omega: 15.0, zeta: 0.42,
  maxPosX: 0.030, maxPosY: 0.045, maxPosZ: 0.040, maxRotX: 0.16, maxRotY: 0.08, maxRotZ: 0.16,
};
// Turn sway is a spring too (it was a first-order lag): the gun trails a flick and
// OVERSHOOTS a little when the look stops, instead of gliding back to centre.
const TURN = { omega: 15.0, zeta: 0.58, rollShare: 0.45, slideM: 0.05 };
// Strafe tilt: the gun rolls INTO the direction of lateral travel and pitches a
// hair with forward travel. Normalised by speedRef (m/s), kept at adsKeep down
// the sights so the picture stays readable.
const STRAFE = { rollDeg: 5.0, yawDeg: 1.6, fwdPitchDeg: 1.2, fwdBack: 0.007, speedRef: 5.0, tau: 0.13, adsKeep: 0.15 };
// ADS travel: the gun arcs (rolls + dips) on the way in/out; zero at both ends.
const ADS_TRAVEL = { rollDeg: 7.0, dropM: 0.010, outMult: -0.7 };
// Sprint swing (figure-eight across the chest), on top of the bob.
const SPRINT_SWING = { x: 0.012, y: 0.006, rzDeg: 4.5, ryDeg: 3.0, rxDeg: 2.0 };
// INSPECT (key I, view-only): one-shot gun showcase. Keys: [t, px, py, pz, rx, ry, rz]
// (metres / degrees) — smoothstep between keys, zero at both ends so a full play
// blends out with no step; any cancel fades the weight out in ~0.1 s.
const INSPECT_S = 2.6;
const INSPECT_KEYS = [
  [0.00, 0.000, 0.000, 0.000, 0, 0, 0],
  [0.17, -0.070, 0.035, 0.045, 10, 40, -16],
  [0.40, -0.078, 0.040, 0.050, 13, 46, -21],
  [0.55, -0.050, 0.050, 0.025, 18, -14, 42],
  [0.78, -0.045, 0.055, 0.025, 15, -19, 47],
  [0.90, -0.008, 0.008, 0.004, 2, 2, 3],
  [1.00, 0.000, 0.000, 0.000, 0, 0, 0],
];
// GRENADE (sim: player._m.cooking = pin pulled, released = thrown). The support hand
// leaves the gun, holds the frag low-left, winds back and sweeps it forward. Poses in
// the BUILD frame (x right, y muzzle, z up) like every hand key; gun dips right.
// The sim spawns the frag the instant the key is released, so the throw is FAST: a
// short draw-back (0-0.05 s), the sweep (0.05-0.17 s), and the in-hand frag is gone by
// releaseAt — it must not be seen twice. Fingers always point UP-ish so the rigid
// forearm trails DOWN out of frame (fingers-down poses swing the sleeve across the lens).
const NADE = {
  throwS: 0.60, releaseAt: 0.06, backT: 0.05, fwdT: 0.17,
  gun: { pos: [0.035, -0.05, 0.025], rot: [-12, -8, 16] },
  // palm centre, FOREARM direction (wrist -> elbow) and a palm-facing hint, build frame.
  // The rigid arm meshes are baked differently per weapon (the pike's forearm leaves the
  // wrist along the hand's -x, the long guns' along the back of the hand), so these are
  // solved per weapon against the MEASURED arm axis (armSolve), not authored as fingers.
  hold: { palm: [-0.22, 0.14, 0.06], arm: [-0.35, -0.45, -0.82], face: [1, 0.2, 0.3] },
  back: { palm: [-0.25, 0.06, 0.11], arm: [-0.30, -0.35, -0.89], face: [0.5, 0.8, 0.1] },
  fwd: { palm: [-0.11, 0.36, 0.11], arm: [-0.20, -0.80, -0.56], face: [0.1, 0.3, -1] },
};
// Empty-reload rack phase: the gun rolls the other way to show the charging side.
const RACK_TILT = { mag: [4, 5, -7], gripmag: [9, -3, 7] };
// Optional moving action part (cycles on every shot when the GLB has one).
const ACTION_NAMES = ["bolt", "slide", "bolt_carrier", "charging_handle", "charge"];

function easeOutBack(t, s) {
  t = clamp01(t) - 1;
  return 1 + (s + 1) * t * t * t + s * t * t;
}

// Semi-implicit Euler on { x, v }. Sub-stepped by the caller so a frame hitch
// cannot make the integrator explode.
function springStep(s, omega, zeta, dt, cap) {
  s.v += (-omega * omega * s.x - 2 * zeta * omega * s.v) * dt;
  s.x += s.v * dt;
  if (s.x > cap) { s.x = cap; if (s.v > 0) s.v = 0; }
  else if (s.x < -cap) { s.x = -cap; if (s.v < 0) s.v = 0; }
}

function damp(cur, target, tau, dt) {
  return cur + (target - cur) * (1 - Math.exp(-dt / Math.max(1e-4, tau)));
}
function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
function smoothstep(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
// eased 0..1 ramp of p across [a,b]
function ramp(p, a, b) { return smoothstep((p - a) / Math.max(1e-6, b - a)); }
function clampS(v, m) { return v < -m ? -m : v > m ? m : v; }
// 0 -> 1 -> 0 sine pulse across [a,b]
function bell(p, a, b) { return p <= a || p >= b ? 0 : Math.sin(Math.PI * (p - a) / (b - a)); }
function lerp(a, b, t) { return a + (b - a) * t; }

// ---- WRIST RIG ------------------------------------------------------------
// The arms are STATIC, NON-SKINNED meshes, but each arm node's origin is the
// WRIST, so a small rotation on it is an anatomically correct wrist flex. Without
// it every recoil kick and every fast turn moves hands and weapon as one solid
// lump; real hands ABSORB the kick. Composed ABSOLUTELY from each node's cached
// rest quaternion every frame, never accumulating onto the live value (the
// prototypes are cached, re-equipping returns the SAME nodes).
const ARM = {
  kickRoll: 0.55,    // share of the gun's kick roll the wrist gives back
  kickPitch: 0.42,   // ...and of the muzzle climb
  swayLead: 0.30,    // hands trail the gun on a fast turn
  maxRad: 0.20,      // hard clamp — a wrist, not a rag doll
  tau: 0.06,
};

// ---- hand pose helper: build frame (x right, y MUZZLE, z up) -> glTF ----------
// The generator places a hand from (fingers_dir, palm_dir): canonical y = fingers,
// canonical -z = palm, x = y × z. Poses below are authored in the same vocabulary
// and the wrist is derived from the PALM centre, so a key pose says where the palm
// is and which way it faces — never a raw wrist coordinate.
// The mesh is exported in glTF axes ((x,y,z)_blender -> (x,z,-y)), so a node's LOCAL frame is the
// canonical hand frame converted by C and the node rotation is R = C·M·C⁻¹, NOT the converted basis
// itself. handPose builds the converted basis B = C·M and right-multiplies C⁻¹. The palm centre in
// that node-local frame is C·(0, 0.05, -0.012) = (0, -0.012, -0.05).
const PALM_LOCAL = new THREE.Vector3(0.0, -0.012, -0.050);
const C_INV = new THREE.Matrix4().set(1, 0, 0, 0,  0, 0, -1, 0,  0, 1, 0, 0,  0, 0, 0, 1);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
function bfv(a, out) { return out.set(a[0], a[2], -a[1]); }
function handPose(pose, outP, outQ) {
  const f = bfv(pose.fingers, _v1).normalize();
  const zc = bfv(pose.dir, _v2).normalize().negate();   // canonical +Z = -palm direction
  const xc = _v3.crossVectors(f, zc).normalize();
  zc.crossVectors(xc, f).normalize();
  _m4.makeBasis(xc, f, zc).multiply(C_INV);
  outQ.setFromRotationMatrix(_m4);
  bfv(pose.palm, outP);
  outP.sub(_v1.copy(PALM_LOCAL).applyQuaternion(outQ));
}
function palmOf(restP, restQ, out) {
  return out.copy(PALM_LOCAL).applyQuaternion(restQ).add(restP);
}

// Per-class animation defaults. view.anim in weapon_data.js overrides any key.
// All key poses are in the BUILD frame (x right, y toward the muzzle, z up).
const ANIM_DEFAULT = {
  kind: "mag",
  // gun cant / lift while the hands work (deg, applied on top of the pose)
  tilt: [8, 0, -16],           // rx (muzzle up), ry (yaw), rz (roll)
  lift: [-0.03, 0.05, 0.0],    // metres the gun rises/shifts toward the centre while the hands work, so
                               // the magazine well and the support hand stay IN FRAME (build x/y/z = right/up/back)
  magDrop: 0.13,               // metres the magazine slides before it is released
  shellsPerCycle: 1,
};

export function createViewmodel(ctx) {
  const camera = ctx.camera;
  camera.rotation.order = "YXZ";

  // ---- scene graph: rig + vm camera parented to the world camera ----------
  const vmCamera = new THREE.PerspectiveCamera(
    VIEWMODEL.fovDeg, camera.aspect, 0.01, 8);
  vmCamera.layers.set(VM_LAYER);
  camera.add(vmCamera);

  const rig = new THREE.Group();      // camera-space root (lag/bob offsets)
  rig.name = "__vm_rig__";
  const mount = new THREE.Group();    // weapon-space (pose + kick)
  mount.name = "__vm_mount__";
  rig.add(mount);
  camera.add(rig);

  ctx.vmCamera = vmCamera;

  // ---- VM LIGHT RIG ---------------------------------------------------------
  // The blue-hour scene's ambient floor is (correctly) near zero, which left the gun
  // a BLACK CUTOUT (iter01 S1/S2). CoD ships a dedicated viewmodel lighting rig for
  // exactly this reason. All lights on VM_LAYER ONLY (camera layer masks filter light
  // collection, so the WORLD pass never sees them and the world's key:ambient
  // discipline is untouched). Created ONCE at boot, constant, never added/removed
  // after — doctrine §3 (light COUNT is a shader-permutation key; the boot prewarm's
  // vm pass compiles this permutation before frame 1).
  //   fill  — sky/ground hemisphere: sets the shadow side so the form never goes
  //           black (the world pool still adds its moon + street practicals).
  //   key   — camera-space directional from upper-left-front: models the receiver,
  //           the glove knuckles and the sleeve folds (what makes it read 3D).
  //   rim   — cool directional from behind-right: separates the dark gun/arms from
  //           the dark night scene with a silhouette edge (the readability fix).
  //   point — the old over-the-shoulder point, kept low (muzzle flash adds its own).
  // 2026-11-13 retune (measured on captures): the key came from near the camera axis,
  // so every face pointing at the player was lit flat and pale. It now rakes down from
  // upper-left; fill lowered and rim raised so form comes from shading, not from wash.
  const vmFill = new THREE.HemisphereLight(0xa9bfdc, 0x2e2a26, 1.1);
  vmFill.name = "__vm_fill__";
  vmFill.layers.set(VM_LAYER);        // NOT enableAll — vm pass only
  ctx.scene.add(vmFill);              // scene-parented: hemi axis stays world-up
  const mkDir = (name, color, intensity, pos, tgt) => {
    const l = new THREE.DirectionalLight(color, intensity);
    l.name = name;
    l.position.set(pos[0], pos[1], pos[2]);
    l.layers.set(VM_LAYER);
    camera.add(l);
    const t = new THREE.Object3D();
    t.position.set(tgt[0], tgt[1], tgt[2]);
    camera.add(t);
    l.target = t;
    return l;
  };
  const vmKeyDir = mkDir("__vm_key_dir__", 0xe8eef8, 1.7, [-0.7, 1.3, 0.15], [0.0, -0.1, -1.0]);
  const vmRim = mkDir("__vm_rim__", 0x86a8ff, 1.9, [0.8, 0.5, -0.9], [0.0, 0.0, 0.0]);
  const VM_KEY_D = 0.42, VM_KEY_E = 0.45;
  const vmKey = new THREE.PointLight(0xc8d6ea, VM_KEY_E * VM_KEY_D * VM_KEY_D, 3.5, 2);
  vmKey.name = "__vm_key__";
  vmKey.position.set(0.38, 0.30, 0.25); // camera-space: over the right shoulder
  vmKey.layers.set(VM_LAYER);
  camera.add(vmKey);
  void vmKeyDir; void vmRim;

  // ---- VM FRAG (the grenade in the support hand while cooking / throwing) -------
  // Built once, parented to the mount (weapon space), VM_LAYER only. Compiled by the
  // staged warm below (warmOne shows it for that one draw) so the first cook never
  // hitches on a shader compile.
  const nade = new THREE.Group();
  nade.name = "__vm_nade__";
  {
    // dark olive: the VM key + rim rig is bright (it has to lift a near-black gun), so a
    // mid olive read as pale teal on captures (lane_vm/nadeW_02)
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1c2116, roughness: 0.78, metalness: 0.05 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x8c9094, roughness: 0.36, metalness: 0.85 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.029, 18, 14), bodyMat);
    body.scale.set(1, 1.18, 1);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.018, 14), metalMat);
    cap.position.y = 0.039;
    const spoon = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.056, 0.004), metalMat);
    spoon.position.set(0.017, 0.018, 0.0);
    spoon.rotation.z = -0.22;
    nade.add(body, cap, spoon);
    nade.traverse((o) => { o.layers.set(VM_LAYER); if (o.isMesh) o.frustumCulled = false; });
  }
  nade.visible = false;
  mount.add(nade);
  const NADE_FIX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  // Per-prototype grenade hand keys (WeakMap: a re-exported GLB is a new group). The
  // arm's own axis is measured ONCE per prototype — the farthest arm vertex from the
  // wrist, in the node's local frame — and each pose's rotation maps that axis onto the
  // pose's forearm direction, rolled so the palm normal (local -y) best faces `face`.
  const _nadeCache = new WeakMap();
  function nadeKeysFor(group, armL) {
    let c = _nadeCache.get(group);
    if (c) return c;
    const node = armL.node;
    // measure at the REST transform (the node may be mid-animation right now)
    const sp = node.position.clone(), sq = node.quaternion.clone();
    node.position.copy(armL.restP); node.quaternion.copy(armL.restQ);
    node.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    const v = new THREE.Vector3(), m = new THREE.Matrix4();
    const a = new THREE.Vector3(0, 0, 1);
    let best = 0;
    node.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      const pos = o.geometry.attributes.position;
      m.copy(o.matrixWorld).premultiply(inv);
      for (let i = 0; i < pos.count; i += 3) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        const d = v.lengthSq();
        if (d > best) { best = d; a.copy(v); }
      }
    });
    node.position.copy(sp); node.quaternion.copy(sq);
    a.normalize();
    // local frame: a, palm normal n=(0,-1,0) made orthogonal to a
    const n = new THREE.Vector3(0, -1, 0);
    n.addScaledVector(a, -n.dot(a)).normalize();
    const loc = new THREE.Matrix4().makeBasis(a, n, new THREE.Vector3().crossVectors(a, n));
    const locInv = loc.clone().invert();
    c = {};
    for (const k of ["hold", "back", "fwd"]) {
      const P = NADE[k];
      const F = bfv(P.arm, new THREE.Vector3()).normalize();
      const H = bfv(P.face, new THREE.Vector3());
      H.addScaledVector(F, -H.dot(F)).normalize();
      const tgt = new THREE.Matrix4().makeBasis(F, H, new THREE.Vector3().crossVectors(F, H));
      const q = new THREE.Quaternion().setFromRotationMatrix(tgt.multiply(locInv));
      const p = bfv(P.palm, new THREE.Vector3()).sub(PALM_LOCAL.clone().applyQuaternion(q));
      c[k] = { p, q };
    }
    _nadeCache.set(group, c);
    return c;
  }

  // ---- state ---------------------------------------------------------------
  let visible = true;
  let lowered = false;       // setLowered(): test seam — weapon held down
  let current = null;        // { id, w, group }
  let armRoll = 0, armPitch = 0, armLead = 0;   // wrist rig, damped
  const _armE = new THREE.Euler();
  const _armQ = new THREE.Quaternion();
  let equipEpoch = 0;
  let raiseClock = Infinity; // seconds since last equip swap (raise anim)
  let raiseDur = 0.45;
  let sinceShot = 9;         // seconds since the last round (pump cycle clock)
  let swapPending = null;    // id wanted but not yet loaded

  // camera rig
  let eyeH = EYE_STAND;
  let bobPhase = 0, bobAmpV = 0, bobAmpL = 0, bobRollAmp = 0;
  let trauma = 0, shakeT = 0;
  let dipY = 0, dipVel = 0, dipTimer = -1, dipDur = 0, dipRec = 0, dipAmp = 0;
  let prevGrounded = true, airVy = 0;
  let fovSprint = 0, fovSlide = 0;
  let slideRoll = 0;

  // vm springs
  let swayYaw = 0, swayPitch = 0;      // look-lag rotation (rad)
  let prevYaw = null, prevPitch = null;
  let lagX = 0, lagY = 0, lagZ = 0;    // translation lag (m, camera space)
  const prevCamPos = new THREE.Vector3();
  let havePrevCam = false;

  // smoothed pose channels
  let sprintBlend = 0, slideBlend = 0, mantleBlend = 0;
  let reloadW = 0;           // eased reload weight 0..1
  let lastReloadP = 0;       // last evaluated reload progress (frozen while the weight decays)
  let reloadKind = "mag";
  let reloadEmpty = false;
  let prevMag = null, shellClock = 0, shellsSeen = 0, reloadT0Mag = 0, shellT0 = null;
  let prevWState = "idle";

  // kick — one under-damped spring per channel (see KICK above)
  const K = {
    rotX: { x: 0, v: 0 }, rotZ: { x: 0, v: 0 }, rotY: { x: 0, v: 0 },
    posY: { x: 0, v: 0 }, posZ: { x: 0, v: 0 },
    camP: { x: 0, v: 0 }, camR: { x: 0, v: 0 }, camY: { x: 0, v: 0 },
    fov:  { x: 0, v: 0 },
  };
  let kickSide = 1;          // alternates per round (roll/yaw shimmy)
  let lastShotsFired = null; // dedup vs impactOnly replays (see recoil.js note)

  // handling-feel springs (see MOVE_SPRING) — reload beats, ADS settle, jump/land
  const MS = {
    posX: { x: 0, v: 0 }, posY: { x: 0, v: 0 }, posZ: { x: 0, v: 0 },
    rotX: { x: 0, v: 0 }, rotY: { x: 0, v: 0 }, rotZ: { x: 0, v: 0 },
  };
  let swayYawV = 0, swayPitchV = 0;     // turn-sway spring velocities
  let strafeR = 0, strafeF = 0;         // damped lateral / forward travel (-1..1)
  let airLift = 0;                      // gun float in the air (-1..1)
  let adsDirS = 1;                      // ADS travel arc sign, smoothed (in 1, out -0.7)
  let prevAdsWant = false, prevAdsT = 0;
  let prevSliding = false;
  let prevBeatP = -1;                   // reload progress last frame (beat crossings)
  let prevShellTr = -1;                 // shell reload clock last frame
  let prevLastShotT = null, prevShotsSeen = null; // dry-click detector
  let landSide = 1;
  // inspect
  let inspectT = -1, inspectW = 0, inspectQ = 0, lastInspectReq = null;
  // grenade
  let cookW = 0, throwT = -1, cookAtRelease = 0, prevCooking = false, nadeHandW = 0;
  // optional action part (bolt / slide) cycle
  let actionT = 9, rackStroke = 0;
  const _actionCache = new WeakMap();

  // breath / sway (§2.6)
  let breathMeter = SWAY.breath.meterS;
  let winded = false;
  let settleClock = Infinity; // time since adsT reached 1 (FEEL.adsSettleS)
  let prevAdsFull = false;
  let swayT = 0;
  let scopeSwayYaw = 0, scopeSwayPitch = 0;   // last applied REAL aim wobble (rad)

  // scope state read by hud.js (see `scope` getter at the bottom)
  const scopeS = {
    blend: 0, active: false, zoom: 1, lagX: 0, lagY: 0,
    breath: 1, winded: false, holding: false, swayX: 0, swayY: 0, kick: 0,
  };

  // MEASUREMENT SEAM (iter10, private extra — never the frozen surface).
  let zoomShareOverride = null;
  let standoffOverride = null;   // metres added to the ADS standoff (same seam)
  // dev: freeze the reload pose at progress p (screenshots) — see _dbg()
  const dbg = { reloadP: null, kind: null, empty: false, lower: null, pump: null, sprint: null, handL: null,
    inspect: null, nade: null };

  const _v = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3();
  const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  const _e0 = new THREE.Euler();

  // Interpolated camera base position (see the TICK INTERPOLATION note in the
  // header). Scratch array, refilled every frame — never retained.
  const _base = [0, 0, 0];
  function basePos(p, alpha) {
    const f = ctx.playerRenderPos;
    if (f) {
      const o = f(alpha, _base);
      if (o) return o; // lerp of the last two sim ticks
    }
    _base[0] = p.pos[0]; _base[1] = p.pos[1]; _base[2] = p.pos[2];
    return _base;
  }

  function setLayersDeep(o) {
    o.traverse((n) => n.layers.set(VM_LAYER));
  }

  // ---- render pass seam (R8) ------------------------------------------------
  let claimed = false;
  let inPass = false;
  function vmRenderPass(renderer) {
    if (inPass || !visible || !current) return;
    inPass = true;
    const sm = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false; // vm pass re-renders no shadow maps
    // The vm camera's ASPECT must track the WORLD camera's, not the window's
    // (capture() renders at its own aspect without touching this camera).
    if (Math.abs(vmCamera.aspect - ctx.camera.aspect) > 1e-6) {
      vmCamera.aspect = ctx.camera.aspect;
      vmCamera.updateProjectionMatrix();
    }
    renderer.clearDepth();                 // R8: viewmodel never clips
    renderer.render(ctx.scene, vmCamera);
    renderer.shadowMap.autoUpdate = sm;
    inPass = false;
  }
  ctx.vmRenderPass = vmRenderPass;
  ctx.claimVmPass = () => { claimed = true; };

  // Interim auto-pass sentinel: fires at the end of any DEFAULT-framebuffer
  // scene render until a post chain claims the pass. colorWrite=false,
  // 1 degenerate triangle — costs one no-op draw call.
  const sentinel = new THREE.Mesh(
    new THREE.BufferGeometry().setAttribute("position",
      new THREE.BufferAttribute(new Float32Array(9), 3)),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }),
  );
  sentinel.name = "__vm_autopass__";
  sentinel.frustumCulled = false;
  sentinel.renderOrder = 1e9;
  sentinel.onAfterRender = (renderer, _scene, cam) => {
    if (claimed || inPass) return;
    if (cam !== ctx.camera) return;
    vmRenderPass(renderer);
  };
  ctx.scene.add(sentinel);

  // ---- resize ---------------------------------------------------------------
  window.addEventListener("resize", () => {
    vmCamera.aspect = window.innerWidth / window.innerHeight;
    vmCamera.updateProjectionMatrix();
  });

  // ---- preload + warm ----------------------------------------------------------
  // ALL FIVE slot weapons are fetched at construction (boot only awaits warden+pike
  // for the mission loadout, R26) and each prototype's materials + textures are
  // compiled/uploaded by one synchronous draw into a scratch RT — three keys programs
  // on the RT's *format*, not its size, and any render target compiles the same
  // (linear, un-tonemapped) variant the post chain's HDR target uses. So a weapon
  // switch is a synchronous mesh swap with no shader compile, no texture upload.
  let warmRT = null;
  const warmed = new WeakSet();
  function warmOne(proto) {
    if (!proto || warmed.has(proto)) return;
    warmed.add(proto);
    if (proto.parent === mount) return;   // the equipped gun is drawn every frame anyway
    const r = ctx.renderer;
    if (!r || !r.render) return;
    try {
      if (!warmRT) warmRT = new THREE.WebGLRenderTarget(8, 8, { type: THREE.HalfFloatType });
      setLayersDeep(proto);
      const prevParent = proto.parent;
      mount.add(proto);
      const wasVisible = rig.visible;
      rig.visible = true;
      const nadeWas = nade.visible;
      nade.visible = true;                // compile the frag's materials in the same draw
      const sm = r.shadowMap.autoUpdate;
      r.shadowMap.autoUpdate = false;
      const prevRT = r.getRenderTarget();
      r.setRenderTarget(warmRT);
      r.render(ctx.scene, vmCamera);
      r.setRenderTarget(prevRT);
      r.shadowMap.autoUpdate = sm;
      rig.visible = wasVisible;
      nade.visible = nadeWas;
      mount.remove(proto);
      if (prevParent && prevParent !== mount) prevParent.add(proto);
    } catch (e) {
      console.warn("[vm] warm failed:", e && e.message);
    }
  }
  function warmAllWhenReady() {
    loadAllWeapons().then((protos) => {
      // staged: one weapon per timer tick so the menu never stalls on four compiles
      let i = 0;
      const next = () => {
        if (i >= protos.length) return;
        const pr = protos[i++];
        if (!(current && current.group === pr)) warmOne(pr);
        setTimeout(next, 120);
      };
      setTimeout(next, 200);
    }).catch((e) => console.warn("[vm] preload failed:", e && e.message));
  }
  warmAllWhenReady();

  // ---- equip ----------------------------------------------------------------
  function installProto(weaponId, proto) {
    if (current && current.group && current.group.parent === mount) {
      mount.remove(current.group);
    }
    setLayersDeep(proto);
    mount.add(proto);
    current = { id: weaponId, w: WEAPONS[weaponId] || null, group: proto };
    // arms/parts back to their authored rest (a cached prototype may have been
    // left mid-animation by the previous equip)
    resetParts(proto);
    prevMag = null; shellT0 = null; shellsSeen = 0; shellClock = 0; reloadW = 0; lastReloadP = 0;
  }
  function resetParts(proto) {
    const parts = proto && proto.userData.parts;
    if (!parts) return;
    for (const k of Object.keys(parts)) {
      const pt = parts[k];
      pt.node.position.copy(pt.restP);
      pt.node.quaternion.copy(pt.restQ);
      pt.node.scale.copy(pt.restS);
      pt.node.visible = true;
    }
  }
  async function equip(weaponId) {
    const tok = ++equipEpoch;
    const proto = await loadWeaponGLB(weaponId);
    if (tok !== equipEpoch) return; // superseded mid-await
    installProto(weaponId, proto);
    raiseClock = 0;
    raiseDur = (WEAPONS[weaponId] && WEAPONS[weaponId].raiseS) || 0.45;
  }
  // ---- kick -----------------------------------------------------------------
  // One round's worth of impulse into every fire-response spring. `adsEase`
  // is the eased ADS blend at the moment of the shot.
  function impulse(w, adsEase) {
    const vmK = w.recoil.vmKick || 3;     // rotational action-cycle read
    const vmP = w.recoil.vmPunch || 0.7;  // barrel-axis slide
    const gv = KICK.adsVmMult + (1 - KICK.adsVmMult) * (1 - adsEase);
    const gc = KICK.adsCamMult + (1 - KICK.adsCamMult) * (1 - adsEase);
    const side = kickSide > 0 ? 1 : KICK.altRollMult;
    kickSide = -kickSide;

    K.rotX.v += vmK * KICK.rotXPerKick * gv;          // muzzle climbs
    K.posY.v += vmK * KICK.posYPerKick * gv;          // gun rides up
    K.posZ.v += vmP * KICK.posZPerPunch * gv;         // gun drives back into the eye
    K.rotZ.v += vmK * KICK.rotZPerKick * gv * side;   // torque roll, alternating
    K.rotY.v -= vmK * KICK.rotYPerKick * gv * side;   // opposite lateral swing

    K.camP.v += vmK * KICK.camPitchPerKick * gc;      // view-only pitch punch
    K.camR.v += vmK * KICK.camRollPerKick * gc * side;
    K.camY.v += vmK * KICK.camYawPerKick * gc * side;
    K.fov.v  += vmK * KICK.fovPerKick * gc;           // brief FOV widen
    scopeS.kick = Math.min(1, scopeS.kick + 0.6);
  }

  function kick(weaponId) {
    const w = WEAPONS[weaponId];
    if (!w || !w.recoil) return;
    let n = 1;
    // Dedup impactOnly/pen replays AND multi-pellet volleys via the fire-time-only
    // shotsFired counter, which increments once per PELLET at fire time. A shotgun
    // blast therefore arrives as nine events but one ROUND: count rounds, not pellets,
    // or one Breaker shot kicks nine times (eight, with the batching cap).
    const pellets = Math.max(1, w.pellets || 1);
    try {
      const sim = ctx.sim && ctx.sim();
      const c = sim && sim.state && sim.state.counters;
      if (c) {
        if (lastShotsFired == null) lastShotsFired = Math.max(0, c.shotsFired - pellets);
        const raw = c.shotsFired - lastShotsFired;
        lastShotsFired = c.shotsFired;
        if (raw <= 0) return;
        n = Math.max(1, Math.round(raw / pellets));
        n = Math.min(n, 4); // batched fire events under a hitch — never lose one
      }
    } catch (e) { /* fall through — kick anyway */ }
    const wp = (() => {
      try { const s = ctx.sim && ctx.sim(); return s && s.state && s.state.player && s.state.player.weapon; }
      catch (e) { return null; }
    })();
    const adsEase = smoothstep(wp ? (wp.adsT || 0) : 0);
    for (let i = 0; i < n; i++) impulse(w, adsEase);
    sinceShot = 0;
    actionT = 0;          // cycle the bolt / slide (when the GLB has one)
    inspectT = -1;        // firing cancels an inspect
  }

  // ---- hand / part poses -----------------------------------------------------
  // Keyframe lookup helpers read the weapon's view.anim block (weapon_data.js) over
  // ANIM_DEFAULT. Poses are in the BUILD frame and resolved to glTF per frame.
  const _animCache = new WeakMap();
  const _animNone = Object.assign({}, ANIM_DEFAULT);
  function animOf(w) {
    if (!w) return _animNone;
    let c = _animCache.get(w);   // cached: update() must not allocate per frame
    if (!c) { c = Object.assign({}, ANIM_DEFAULT, (w.view && w.view.anim) || {}); _animCache.set(w, c); }
    return c;
  }
  function msImpulse(px, py, pz, rx, ry, rz) {
    MS.posX.v += px; MS.posY.v += py; MS.posZ.v += pz;
    MS.rotX.v += rx; MS.rotY.v += ry; MS.rotZ.v += rz;
  }
  function actionPart(group) {
    let a = _actionCache.get(group);
    if (a !== undefined) return a;
    a = null;
    for (const nm of ACTION_NAMES) {
      const n = group.getObjectByName(nm);
      if (n) { a = { node: n, restP: n.position.clone(), stroke: nm === "slide" ? 0.030 : 0.024 }; break; }
    }
    _actionCache.set(group, a);
    return a;
  }

  // Compose the support-hand + part animation for this frame. Returns the gun-level
  // pose deltas (tilt/lift) through `out` and writes the part transforms directly.
  const out = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 };
  const _hp = new THREE.Vector3(), _hq = new THREE.Quaternion();

  function applyHands(group, w, anim, wp, dt, adsEase) {
    const parts = group.userData.parts || {};
    const armL = parts.armL, mag = parts.mag, pump = parts.pump;
    out.px = out.py = out.pz = out.rx = out.ry = out.rz = 0;
    rackStroke = 0;
    if (!armL) { nade.visible = false; return; }

    // -- weights --------------------------------------------------------------
    // reload: derived from the sim state machine
    let reloading = !!(wp && wp.state === "reloading");
    let p = 0;
    let dur = 2;
    if (reloading) {
      dur = wp._reloadDur || (w && w.reloadS) || 2;
      p = clamp01((wp.stateT || 0) / dur);
      reloadEmpty = (wp._preReloadMag === 0);
    }
    const live = reloading;                 // a real (not dbg-pinned) reload
    if (dbg.reloadP != null) { reloading = true; p = dbg.reloadP; reloadEmpty = !!dbg.empty; dur = dbg.dur || 2.4; }
    const kind = (dbg.kind || anim.kind);
    reloadKind = kind;
    if (reloading) lastReloadP = p;
    reloadW = damp(reloadW, reloading ? 1 : 0, reloading ? 0.07 : 0.10, dt);
    if (reloadW < 0.002 && !reloading) reloadW = 0;

    // -- reload BEATS: velocity kicks into the handling springs as the timeline
    // crosses each beat (the weight of the gun: magazine out, seat slap, charging
    // handle released). Only on a live reload — a pinned dbg progress has no motion.
    if (live && dbg.reloadP == null && kind !== "shell") {
      if (p < prevBeatP) prevBeatP = -1;           // a new reload started
      const q0 = prevBeatP;
      if (reloadEmpty) {
        if (q0 < 0.18 && p >= 0.18) msImpulse(0, 0.06, 0, 0.55, 0.05, -0.25);    // released: the gun lightens
        if (q0 < 0.645 && p >= 0.645) msImpulse(0, 0.24, 0.02, 1.5, 0, -0.7);   // slapped home
        // rifle: the catch is struck at 0.875; pistol/SMG: the slide is let go at 0.89
        if (kind === "gripmag") {
          if (q0 < 0.84 && p >= 0.84) msImpulse(0, 0.08, -0.22, 1.6, -0.2, 0.8);  // slide dropped: flick
        } else if (q0 < 0.875 && p >= 0.875) msImpulse(0, -0.05, -0.30, -1.0, 0.1, 0.55); // catch struck: bolt slams
      } else {
        if (q0 < 0.18 && p >= 0.18) msImpulse(0, -0.10, 0, -0.6, 0, 0.3);       // tugged out: the gun dips
        if (q0 < 0.655 && p >= 0.655) msImpulse(0, 0.22, 0.02, 1.4, 0, -0.6);   // seated + palm slap
      }
      prevBeatP = p;
    } else if (!reloading) prevBeatP = -1;

    // -- rest transforms --------------------------------------------------------
    // start every part at rest; the sections below override what they animate
    armL.node.position.copy(armL.restP);
    armL.node.quaternion.copy(armL.restQ);
    if (mag) { mag.node.position.copy(mag.restP); mag.node.quaternion.copy(mag.restQ); mag.node.scale.copy(mag.restS); mag.node.visible = true; }
    if (pump) pump.node.position.copy(pump.restP);

    // -- pump (shotgun): forend + support hand rack after every blast ---------------
    let pumpOff = 0;
    if (pump) {
      let t = sinceShot;
      if (dbg.pump != null) t = dbg.pump;
      // sfx.js racks BACK at +0.36 s and FORWARD 0.15 s later (PUMP_BACK_S / PUMP_FWD_GAP_S):
      // the stroke is centred on those two sounds — back 0.28->0.40, hold, forward 0.46->0.60
      const tb = t - 0.28;
      if (tb > 0 && tb < 0.32) {
        pumpOff = tb < 0.12 ? ramp(tb, 0, 0.12)
          : tb < 0.18 ? 1
          : 1 - ramp(tb, 0.18, 0.32);
      }
    }

    if (reloadW > 0.001) {
      const pp = reloading ? p : lastReloadP;
      const rw = reloadW;
      if (kind === "shell") reloadShell(group, w, anim, parts, pp, rw, wp, dt);
      else reloadMag(group, w, anim, parts, pp, rw, kind, dur);
    }

    // -- INSPECT: magazine check (mag weapons) — the support hand drops to the
    // magazine, tugs it a centimetre and seats it again while the gun is rolled over
    if (inspectW > 0.001 && kind !== "shell" && mag) {
      const q = inspectQ;
      const hw = ramp(q, 0.55, 0.63) * (1 - ramp(q, 0.80, 0.88)) * inspectW * (1 - reloadW);
      if (hw > 0.001) {
        const C = handKeys(group, anim, kind);
        const tug = bell(q, 0.64, 0.76) * 0.012;
        _hp.copy(C.mag.p); _hq.copy(C.mag.q);
        _hp.y -= tug;                                  // glTF +y = up
        armL.node.position.lerp(_hp, hw);
        armL.node.quaternion.slerp(_hq, hw);
        mag.node.position.y -= tug * hw;
      }
    }

    // -- GRENADE: the support hand leaves the gun (cook = hold low-left, release =
    // wind back + sweep forward), the frag rides the palm until the release beat
    nade.visible = false;
    if (nadeHandW > 0.001) {
      const nadeKeys = nadeKeysFor(group, armL);
      if (throwT >= 0) {
        const t = throwT;
        // key 0: wherever the hold had got to when the pin was released (quick tap = 0)
        _p0.copy(armL.node.position).lerp(nadeKeys.hold.p, cookAtRelease);
        _q0.copy(armL.node.quaternion).slerp(nadeKeys.hold.q, cookAtRelease);
        const tb = NADE.backT, tf = NADE.fwdT;
        if (t < tb) {
          const s = smoothstep(t / tb);
          _hp.copy(_p0).lerp(nadeKeys.back.p, s); _hq.copy(_q0).slerp(nadeKeys.back.q, s);
        } else if (t < tf) {
          const s = smoothstep((t - tb) / (tf - tb));
          _hp.copy(nadeKeys.back.p).lerp(nadeKeys.fwd.p, s); _hq.copy(nadeKeys.back.q).slerp(nadeKeys.fwd.q, s);
        } else {
          const s = smoothstep((t - tf) / (NADE.throwS - tf));
          _hp.copy(nadeKeys.fwd.p).lerp(armL.restP, s); _hq.copy(nadeKeys.fwd.q).slerp(armL.restQ, s);
        }
        armL.node.position.copy(_hp); armL.node.quaternion.copy(_hq);
      } else {
        armL.node.position.lerp(nadeKeys.hold.p, nadeHandW);
        armL.node.quaternion.slerp(nadeKeys.hold.q, nadeHandW);
      }
      const showNade = throwT >= 0 ? (throwT < NADE.releaseAt && cookAtRelease + throwT > 0.05) : nadeHandW > 0.35;
      if (showNade) {
        // frag centre = palm centre + 3.2 cm along the palm normal (node-local -y), in
        // group space, then into mount space through the group's own transform
        palmOf(armL.node.position, armL.node.quaternion, _palm);
        _v.set(0, -0.032, 0).applyQuaternion(armL.node.quaternion);
        _palm.add(_v);
        group.updateMatrix();
        nade.position.copy(_palm).applyMatrix4(group.matrix);
        nade.quaternion.copy(group.quaternion).multiply(armL.node.quaternion).multiply(NADE_FIX);
        nade.visible = true;
      }
    }

    if (dbg.handL) {      // dev: pin the support hand to an authored pose (tuning screenshots)
      handPose(dbg.handL, _hp, _hq);
      armL.node.position.copy(_hp); armL.node.quaternion.copy(_hq);
    }

    // pump rides on top of everything (it can follow the final reload rack too)
    if (pump && pumpOff > 0 && nadeHandW < 0.5) {
      const d = 0.085 * pumpOff;
      pump.node.position.z = pump.restP.z + d;
      armL.node.position.z += d;
    }
  }

  // --- keyframe evaluator ------------------------------------------------------
  // keys[0..n): [{ t, P:Vector3, Q:Quaternion }] sorted by t; smoothstep between keys.
  function evalKeys(keys, n, t, outP, outQ) {
    if (t <= keys[0].t) { outP.copy(keys[0].P); outQ.copy(keys[0].Q); return; }
    for (let i = 0; i < n - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (t <= b.t) {
        const s = smoothstep((t - a.t) / Math.max(1e-6, b.t - a.t));
        outP.copy(a.P).lerp(b.P, s);
        outQ.copy(a.Q).slerp(b.Q, s);
        return;
      }
    }
    const l = keys[n - 1];
    outP.copy(l.P); outQ.copy(l.Q);
  }
  const keyPool = [];
  function key(i, t, P, Q) {
    let k = keyPool[i];
    if (!k) { k = keyPool[i] = { t: 0, P: new THREE.Vector3(), Q: new THREE.Quaternion() }; }
    k.t = t; k.P.copy(P); k.Q.copy(Q);
    return k;
  }

  // Key hand poses for a weapon: authored in view.anim.hand (build frame), with generic
  // defaults derived from the magazine's own bounds so every weapon animates sensibly
  // out of the box and view.anim only has to correct what the eye disagrees with.
  const _handCache = new Map();
  function handKeys(group, anim, kind) {
    const id = group.userData.weaponId;
    const ck = id + ":" + kind;
    let c = _handCache.get(ck);
    if (c && c.group === group) return c;
    const parts = group.userData.parts || {};
    const H = anim.hand || {};
    const mag = parts.mag;
    // build-frame centre/size of the magazine (glTF (x,y,z) -> build (x,-z,y))
    const mc = mag ? [mag.center.x, -mag.center.z, mag.center.y] : [0, 0.12, -0.07];
    const ms = mag ? [mag.size.x, mag.size.z, mag.size.y] : [0.03, 0.08, 0.10];
    const bot = mc[2] - ms[2] / 2;
    const slide = anim.magDrop;
    const mk = (o) => ({ p: new THREE.Vector3(), q: new THREE.Quaternion(), pose: o });
    const boreZ = (group.userData.muzzleOffset && group.userData.muzzleOffset[1]) || 0.06;
    let defs;
    if (kind === "gripmag") {
      // magazine inside the grip (pistol, SMG): the support hand cups the floor plate from
      // below and pulls it straight down
      defs = {
        mag: H.mag || { palm: [mc[0] - 0.004, mc[1], bot - 0.026], fingers: [0.9, 0.3, 0.3], dir: [0.15, 0, 1] },
        pouch: H.pouch || { palm: [mc[0] - 0.13, mc[1] - 0.02, bot - 0.20], fingers: [0.5, 0.5, 1], dir: [0.6, 0, 1] },
        rack: H.rack || { palm: [0.0, -0.05, boreZ + 0.06], fingers: [0.6, 1, 0], dir: [0, 0, -1] },
        port: H.port || { palm: [0, 0, 0], fingers: [1, 0, 0], dir: [0, 0, 1] },
      };
    } else {
      defs = {
        mag: H.mag || { palm: [mc[0] - (ms[0] / 2 + 0.021), mc[1], mc[2] - 0.004],
                        fingers: [0.1, 0.6, 1], dir: [1, 0, 0] },
        pouch: H.pouch || { palm: [mc[0] - 0.13, mc[1] - 0.05, mc[2] - 0.20],
                            fingers: [0.3, 0.4, 1], dir: [1, 0, 0.3] },
        rack: H.rack || { palm: [0.0, -0.06, boreZ + 0.075], fingers: [0.6, 1, 0], dir: [0, 0, -1] },
        port: H.port || { palm: [mc[0] - 0.02, mc[1], mc[2] - 0.02], fingers: [0.5, 1, 0.1], dir: [0.2, 0, 1] },
        // bolt catch: flat palm on the left of the receiver just above the magazine well
        catch: H.catch || { palm: [mc[0] - (ms[0] / 2 + 0.034), mc[1] - 0.012, mc[2] + ms[2] / 2 + 0.012],
                            fingers: [0.05, 0.75, 0.65], dir: [1, 0, 0] },
      };
    }
    c = { group };
    for (const k of Object.keys(defs)) {
      c[k] = mk(defs[k]);
      handPose(defs[k], c[k].p, c[k].q);
    }
    // the magazine pulled out: the same grip, `slide` lower
    const out = JSON.parse(JSON.stringify(defs.mag));
    out.palm[2] -= slide;
    c.magOut = mk(out);
    handPose(out, c.magOut.p, c.magOut.q);
    // the new magazine just below the well, before it is pushed home
    const below = JSON.parse(JSON.stringify(defs.mag));
    below.palm[2] -= slide * 0.75;
    c.magBelow = mk(below);
    handPose(below, c.magBelow.p, c.magBelow.q);
    // the palm SLAP: a centimetre past seated (the gun takes the blow, see the beats)
    const slap = JSON.parse(JSON.stringify(defs.mag));
    slap.palm[2] += 0.012;
    c.slap = mk(slap);
    handPose(slap, c.slap.p, c.slap.q);
    // charging handle / slide pulled to the rear (empty reload)
    const rb = JSON.parse(JSON.stringify(defs.rack));
    rb.palm[1] -= 0.075;                       // build -y = toward the stock
    c.rackBack = mk(rb);
    handPose(rb, c.rackBack.p, c.rackBack.q);
    if (defs.catch) {
      // ...and the STRIKE: the palm 1.6 cm further in, driving the catch
      const ch = JSON.parse(JSON.stringify(defs.catch));
      ch.palm[0] += 0.016;
      c.catchHit = mk(ch);
      handPose(ch, c.catchHit.p, c.catchHit.q);
    }
    // where the magazine's centre sits relative to the palm while it is held
    c.holdOff = new THREE.Vector3(mag ? mag.center.x : 0, mag ? mag.center.y : -0.07, mag ? mag.center.z : -0.12);
    const pm = palmOf(c.mag.p, c.mag.q, new THREE.Vector3());
    c.holdOff.sub(pm);
    c.magQInv = c.mag.q.clone().invert();
    c.drop = slide;
    _handCache.set(ck, c);
    return c;
  }
  function dropHandCache(id) { for (const k of [..._handCache.keys()]) if (k.startsWith(id + ":")) _handCache.delete(k); }

  // --- magazine reload (rifles, DMR, and the in-grip magazines of pistol/SMG) -------
  // TWO DISTINCT CHOREOGRAPHIES, both locked to the sim + sfx beats (mag_out at 18%,
  // ammo commit + mag_in at 65%, rack at 84% on empty — sfx.js onReload):
  //   TACTICAL (rounds left) — retention: thumb the release, tug the magazine out,
  //     carry it down to the pouch, bring the fresh one up, push it in and SLAP it
  //     home; the gun takes the slap. No rack (a round is chambered).
  //   EMPTY — speed reload: the gun cants harder, the spent magazine is released and
  //     FALLS FREE under gravity (tumbling) while the hand goes straight to the pouch,
  //     fresh magazine in + slap, then the gun rolls the other way and the hand pulls
  //     the charging handle / slide to the rear and lets it slam forward.
  const _palm = new THREE.Vector3();
  const _magR = new THREE.Quaternion();
  const _tumble = new THREE.Quaternion();
  const _xAxis = new THREE.Vector3(1, 0, 0);
  const _magKeys = [];
  function reloadMag(group, w, anim, parts, p, rw, kind, dur) {
    const armL = parts.armL, mag = parts.mag;
    const C = handKeys(group, anim, kind);
    const empty = reloadEmpty;
    const rest = armL.restP, restQ = armL.restQ;
    const ks = _magKeys;
    let n = 0;
    if (!empty) {
      ks[n] = key(n, 0.00, rest, restQ); n++;
      ks[n] = key(n, 0.12, C.mag.p, C.mag.q); n++;
      ks[n] = key(n, 0.18, C.mag.p, C.mag.q); n++;          // thumb on the release
      ks[n] = key(n, 0.27, C.magOut.p, C.magOut.q); n++;    // tugged out
      ks[n] = key(n, 0.40, C.pouch.p, C.pouch.q); n++;      // retained, to the pouch
      ks[n] = key(n, 0.54, C.magBelow.p, C.magBelow.q); n++;
      ks[n] = key(n, 0.62, C.mag.p, C.mag.q); n++;          // pushed in
      ks[n] = key(n, 0.655, C.slap.p, C.slap.q); n++;       // slap
      ks[n] = key(n, 0.70, C.mag.p, C.mag.q); n++;
      ks[n] = key(n, 0.88, rest, restQ); n++;
      ks[n] = key(n, 1.00, rest, restQ); n++;
    } else {
      ks[n] = key(n, 0.00, rest, restQ); n++;
      ks[n] = key(n, 0.10, C.mag.p, C.mag.q); n++;
      ks[n] = key(n, 0.18, C.mag.p, C.mag.q); n++;          // release pressed — it drops
      ks[n] = key(n, 0.34, C.pouch.p, C.pouch.q); n++;      // straight to the pouch
      ks[n] = key(n, 0.50, C.magBelow.p, C.magBelow.q); n++;
      ks[n] = key(n, 0.60, C.mag.p, C.mag.q); n++;
      ks[n] = key(n, 0.645, C.slap.p, C.slap.q); n++;
      ks[n] = key(n, 0.68, C.mag.p, C.mag.q); n++;
      if (C.catchHit) {
        // RIFLE: up the left of the receiver and SLAP the bolt catch — the bolt (locked
        // back since the last round) slams home on the strike. The hand never crosses
        // the lens (a rigid forearm over the top fills a third of the frame).
        ks[n] = key(n, 0.78, C.catch.p, C.catch.q); n++;
        ks[n] = key(n, 0.85, C.catch.p, C.catch.q); n++;
        ks[n] = key(n, 0.875, C.catchHit.p, C.catchHit.q); n++; // strike
        ks[n] = key(n, 0.90, C.catch.p, C.catch.q); n++;
        ks[n] = key(n, 1.00, rest, restQ); n++;
        rackStroke = p < 0.875 ? 1 : 1 - ramp(p, 0.875, 0.89);
      } else {
        // PISTOL / SMG: the support hand goes back to the grip and the shooting thumb
        // drops the slide — a sharp flick of the whole gun on the 84% rack sound. (An
        // overhand rack was tried: with a rigid forearm and the eye 30 cm behind the
        // gun, the sleeve covered half the frame — lane_vm/vesE filmstrip.)
        ks[n] = key(n, 0.80, rest, restQ); n++;
        ks[n] = key(n, 1.00, rest, restQ); n++;
        rackStroke = p < 0.84 ? 1 : 1 - ramp(p, 0.84, 0.855);
      }
      rackStroke *= rw;
    }
    evalKeys(ks, n, p, _hp, _hq);
    armL.node.position.lerp(_hp, rw);
    armL.node.quaternion.slerp(_hq, rw);

    // gun cant + lift while the hands work; empty cants harder and, for the rack,
    // rolls the other way to show the charging side
    const cIn = ramp(p, 0.0, empty ? 0.10 : 0.12);
    const cOut = empty ? ramp(p, 0.68, 0.78) : ramp(p, 0.72, 0.92);
    const cant = cIn * (1 - cOut) * (empty ? 1.15 : 1.0) * rw;
    out.rx += anim.tilt[0] * DEG * cant;
    out.ry += anim.tilt[1] * DEG * cant;
    out.rz += anim.tilt[2] * DEG * cant;
    out.px += anim.lift[0] * cant;
    out.py += anim.lift[1] * cant;
    out.pz += (anim.lift[2] + 0.02) * cant;
    if (empty) {
      const RT = anim.rackTilt || RACK_TILT[kind] || RACK_TILT.mag;
      const rk = ramp(p, 0.68, 0.78) * (1 - ramp(p, 0.90, 1.0)) * rw;
      out.rx += RT[0] * DEG * rk; out.ry += RT[1] * DEG * rk; out.rz += RT[2] * DEG * rk;
      out.px += -0.02 * rk; out.py += 0.035 * rk;
    }

    // ---- the magazine node ------------------------------------------------------
    if (mag) {
      const mp = mag.node.position;
      mp.copy(mag.restP);
      mag.node.quaternion.copy(mag.restQ);
      mag.node.visible = true;
      const held = empty ? (p >= 0.34 && p < 0.60) : (p >= 0.18 && p < 0.62);
      if (held) {
        // carried by the hand: rotate WITH the hand about the palm. R = hand · grip⁻¹
        // takes the seated grip to this frame's grip; the node origin rides along.
        _magR.copy(_hq).multiply(C.magQInv);
        palmOf(_hp, _hq, _palm);
        _v.copy(C.holdOff).applyQuaternion(_magR).add(_palm);          // new centre
        _v2.copy(mag.center).sub(mag.restP).applyQuaternion(_magR);     // centre - origin
        mp.copy(_v).sub(_v2);
        mag.node.quaternion.copy(_magR).multiply(mag.restQ);
        // hands are blended with weight rw; keep the magazine on the same blend
        mp.lerp(mag.restP, 1 - rw);
        mag.node.quaternion.slerp(mag.restQ, 1 - rw);
      } else if (empty && p >= 0.18 && p < 0.34) {
        // released: falls free from the well under real gravity, drifting out and
        // tumbling; hidden once it is well out of frame
        const tf = (p - 0.18) * dur;                  // seconds since release
        mp.x += -0.10 * tf;
        mp.y += -0.5 * 9.8 * tf * tf - 0.05 * tf;     // glTF +y = up
        mp.z += 0.12 * tf;
        _tumble.setFromAxisAngle(_xAxis, -3.2 * tf);
        mag.node.quaternion.copy(_tumble).multiply(mag.restQ);
        mag.node.visible = tf < 0.36;
      }
    }
  }

  // --- shell-by-shell reload (pump shotgun) --------------------------------------
  // CLOCK (2026-11 fix): the sim ends a shell reload at ITS `_shellEndAt` (last shell +
  // endS), which is earlier than `_reloadDur - endS` whenever fewer shells go in than the
  // estimate — the closing pump used to be keyed to the latter and was never seen. The
  // end phase now starts at the sim's own last insert, and the closing stroke is centred
  // on sfx.js's rack (back at +0.10 s, forward at +0.25 s after the last shell). While the
  // weight fades after the sim goes idle, the clock is FROZEN at its last live value
  // (it used to read the idle stateT and swing the hand back toward the port).
  let shellTrLast = 0, shellEndAtLast = 1e9, shellDurLast = 3.4;
  function reloadShell(group, w, anim, parts, p, rw, wp, dt) {
    const armL = parts.armL, pump = parts.pump;
    const rl = (w && w.reload) || { startS: 0.55, perShellS: 0.42, endS: 0.35 };
    const liveR = !!(wp && wp.state === "reloading") && dbg.reloadP == null;
    let dur, tr, endAt;
    if (dbg.reloadP != null) {
      dur = (wp && wp._reloadDur) || (w && w.reloadS) || 3.4;
      tr = p * dur;
      endAt = Math.max(rl.startS + 0.1, dur - rl.endS);
    } else if (liveR) {
      tr = wp.stateT || 0;
      if (wp._shellPhase === "end" && wp._shellEndAt != null) {
        endAt = wp._shellEndAt - rl.endS;
        dur = wp._shellEndAt;
      } else {
        endAt = 1e9;                    // still loading: the end is not known yet
        dur = (wp._reloadDur || (w && w.reloadS) || 3.4);
      }
      shellTrLast = tr; shellEndAtLast = endAt; shellDurLast = dur;
    } else {
      tr = shellTrLast; endAt = shellEndAtLast; dur = shellDurLast;
    }
    // Re-sync the per-shell cycle to the sim's own inserts: every time the magazine count rises by
    // exactly one while reloading, that is a shell going in — put the cycle at its 'push' beat
    // (0.70) right then, so hand and ammo counter agree whatever the sim's pacing is.
    if (liveR) {
      if (prevMag != null && wp.mag === prevMag + 1) {
        shellT0 = tr - 0.70 * rl.perShellS;
        // the thumb drives the shell home: a small upward shove through the gun
        msImpulse(0, 0.07, -0.03, 0.45, 0, -0.15);
      }
      prevMag = wp.mag;
      if (tr < 0.05) shellT0 = null;
      // closing pump: the gun is jerked back by the stroke, then shoved forward
      if (prevShellTr < endAt + 0.10 && tr >= endAt + 0.10) msImpulse(0, -0.03, 0.12, -0.35, 0, 0.2);
      if (prevShellTr < endAt + 0.25 && tr >= endAt + 0.25) msImpulse(0, 0.04, -0.18, 0.55, 0, -0.25);
      prevShellTr = tr < prevShellTr ? -1 : tr;
    } else if (wp && wp.state !== "reloading") prevMag = wp.mag;
    const t = tr - (shellT0 != null ? shellT0 : rl.startS);
    // an EMPTY gun is loaded rolled further over (the port faces the camera)
    const emptyMult = reloadEmpty ? 1.25 : 1.0;
    const C = handKeys(group, anim, "shell");
    const rest = armL.restP, restQ = armL.restQ;

    const te = tr - endAt;                                  // time into the end phase
    const tIn = ramp(tr, 0.0, rl.startS);                   // tilt in + hand to the port
    const handBack = te > 0 ? ramp(te, 0, 0.09) : 0;        // hand to the forend for the rack
    const tiltOut = te > 0 ? ramp(te, 0.0, 0.30) : 0;       // gun levels through the rack
    let towardBand = 0, push = 0;
    if (t > 0 && te < 0) {
      const c = (t % rl.perShellS) / rl.perShellS;
      // 0..0.30 at the bandolier -> 0.30..0.62 up to the port -> push 0.62..0.80 -> settle
      towardBand = c < 0.30 ? 1 : 1 - ramp(c, 0.30, 0.62);
      push = c > 0.62 && c < 0.82 ? Math.sin(Math.PI * (c - 0.62) / 0.20) : 0;
    }
    const gunTilt = tIn * (1 - tiltOut);
    out.rx += anim.tilt[0] * DEG * gunTilt * rw;
    out.ry += anim.tilt[1] * DEG * gunTilt * rw;
    out.rz += anim.tilt[2] * DEG * gunTilt * rw * emptyMult;
    out.px += anim.lift[0] * gunTilt * rw;
    out.py += anim.lift[1] * gunTilt * rw;
    out.pz += (anim.lift[2] + 0.025) * gunTilt * rw;

    _hp.copy(rest); _hq.copy(restQ);
    _hp.lerp(C.port.p, tIn); _hq.slerp(C.port.q, tIn);
    if (t > 0 && te < 0) {
      _hp.copy(C.port.p).lerp(C.pouch.p, towardBand);
      _hq.copy(C.port.q).slerp(C.pouch.q, towardBand);
      _hp.y += 0.006 * push;           // glTF y = up
      _hp.z -= 0.016 * push;           // glTF -z = toward the muzzle
    }
    if (handBack > 0) { _hp.lerp(rest, handBack); _hq.slerp(restQ, handBack); }
    armL.node.position.lerp(_hp, rw);
    armL.node.quaternion.slerp(_hq, rw);

    // closing rack: forend + hand stroke back (0.03-0.11 s) and forward (0.19-0.28 s)
    if (pump && te > 0) {
      const stroke = te < 0.03 ? 0 : te < 0.11 ? ramp(te, 0.03, 0.11) : te < 0.19 ? 1 : 1 - ramp(te, 0.19, 0.28);
      pump.node.position.z = pump.restP.z + 0.085 * stroke * rw;
      armL.node.position.z += 0.085 * stroke * rw;
    }
    void dt; void dur;
  }

  // the slide's lean side, same convention as the §1.4 camera roll (+1 / -1)
  function slideRollTargetSign(m, input) {
    if (!m.slideDir) return 1;
    const fy = input.state.yaw;
    const side = m.slideDir[0] * Math.cos(fy) + m.slideDir[1] * -Math.sin(fy);
    return side >= 0 ? -1 : 1;
  }

  // ---- update ---------------------------------------------------------------
  function update(dt, alpha) {
    if (!(dt > 0)) dt = 1 / 60;
    // Default 1 = "render the tick that just ran" (boot's stepFrames path).
    if (!(alpha >= 0)) alpha = 1; // covers undefined and NaN
    else if (alpha > 1) alpha = 1;
    const S = ctx.settings;
    const sim = ctx.sim && ctx.sim();
    const st = sim && sim.state;
    const p = st && st.player;
    const m = (p && p._m) || {};
    const input = ctx.input;
    const wp0 = p && p.weapon;

    sinceShot += dt;

    // -- which weapon is on screen? Mirror the sim's held weapon, EXCEPT during a
    // switch: the sim only changes weapon.id when the switch ENDS, so the swap is
    // done here at SWITCH_SWAP of the way through, from `_switchTo`.
    let wantId = wp0 && wp0.id;
    let switchProg = -1;
    if (wp0 && wp0.state === "switching" && wp0._switchTo) {
      const sdur = wp0._switchDur || 0.45;
      switchProg = clamp01((wp0.stateT || 0) / sdur);
      if (switchProg >= SWITCH_SWAP) wantId = wp0._switchTo;
    }
    if (dbg.lower != null) { switchProg = dbg.lower; }
    if (wantId && (!current || current.id !== wantId)) {
      const proto = peek(wantId);
      if (proto) {
        installProto(wantId, proto);
        if (switchProg < 0) { raiseClock = 0; raiseDur = (WEAPONS[wantId] && WEAPONS[wantId].raiseS) || 0.45; }
      } else if (swapPending !== wantId) {
        swapPending = wantId;
        equip(wantId).then(() => { swapPending = null; });
      }
    }
    const w = current && current.w;
    const wp = wp0;

    const driving = visible && !ctx.cameraDetached && p && p.alive &&
      st && LIVE_PHASES.has(st.phase);

    // -- fire-response springs: integrated EVERY frame, before anything reads
    // them, and before the `!rig.visible` early-out below.
    {
      let rem = Math.min(dt, 0.25);
      while (rem > 1e-6) {
        const h = Math.min(rem, 1 / 120);
        rem -= h;
        springStep(K.rotX, KICK.omega, KICK.zeta, h, KICK.maxRotX);
        springStep(K.rotZ, KICK.omega, KICK.zeta, h, KICK.maxRotZ);
        springStep(K.rotY, KICK.omega, KICK.zeta, h, KICK.maxRotY);
        springStep(K.posY, KICK.omega, KICK.zeta, h, KICK.maxPosY);
        springStep(K.posZ, KICK.omega, KICK.zeta, h, KICK.maxPosZ);
        springStep(K.camP, KICK.camOmega, KICK.camZeta, h, KICK.maxCamPitch);
        springStep(K.camR, KICK.camOmega, KICK.camZeta, h, KICK.maxCamRoll);
        springStep(K.camY, KICK.camOmega, KICK.camZeta, h, KICK.maxCamYaw);
        springStep(K.fov,  KICK.camOmega, KICK.camZeta, h, KICK.maxFov);
        const mo = MOVE_SPRING.omega, mz = MOVE_SPRING.zeta;
        springStep(MS.posX, mo, mz, h, MOVE_SPRING.maxPosX);
        springStep(MS.posY, mo, mz, h, MOVE_SPRING.maxPosY);
        springStep(MS.posZ, mo, mz, h, MOVE_SPRING.maxPosZ);
        springStep(MS.rotX, mo, mz, h, MOVE_SPRING.maxRotX);
        springStep(MS.rotY, mo, mz, h, MOVE_SPRING.maxRotY);
        springStep(MS.rotZ, mo, mz, h, MOVE_SPRING.maxRotZ);
      }
      scopeS.kick *= Math.exp(-dt / 0.18);
    }

    // ================= CAMERA RIG =================
    let rollOut = 0;
    let camSwayYaw = 0, camSwayPitch = 0;
    const speedNorm = p ? (p.speedNorm || 0) : 0;
    const sprintState = m.sprintState || "none";
    const sliding = !!m.sliding;
    const adsT = wp ? (wp.adsT || 0) : 0;
    const adsEase = smoothstep(adsT);
    const isScoped = !!(w && w.view && w.view.scope);

    // ================= HANDLING STATE (view-only, polled off the sim) =========
    // Nothing here writes the sim or input.state; it reads them and drives the
    // MS springs and the inspect / grenade clocks.
    if (driving && wp) {
      // ADS: a roll as the gun starts to travel, and a settle overshoot when it
      // arrives (in) or comes to rest at the hip (out)
      if (wp.ads && !prevAdsWant) msImpulse(0, 0, 0, 0, 0, 0.35);
      if (!wp.ads && prevAdsWant) msImpulse(0, -0.03, 0, 0, 0, -0.45);
      if (adsT >= 0.999 && prevAdsT < 0.999) msImpulse(0, -0.05, 0.03, -0.22, 0, 0);
      if (adsT <= 0.001 && prevAdsT > 0.001) msImpulse(0, -0.07, 0, -0.35, 0, 0.15);
      prevAdsWant = !!wp.ads; prevAdsT = adsT;

      // DRY CLICK: the sim stamps lastShotT on an empty trigger pull without firing
      const c = st.counters;
      const sf = c ? c.shotsFired : 0;
      if (prevLastShotT != null && wp.lastShotT !== prevLastShotT && sf === prevShotsSeen && wp.mag === 0) {
        msImpulse(0, 0.012, 0.022, 0.30, 0, 0.08);
      }
      prevLastShotT = wp.lastShotT; prevShotsSeen = sf;

      // GRENADE: player._m.cooking is the pin-pulled hold; its falling edge is the throw
      const cooking = !!m.cooking || (dbg.nade != null && dbg.nade.cook === true);
      if (prevCooking && !cooking) { throwT = 0; cookAtRelease = cookW; }
      prevCooking = cooking;
      cookW = damp(cookW, cooking ? 1 : 0, cooking ? 0.07 : 0.05, dt);
      if (dbg.nade != null && dbg.nade.throwT != null) { throwT = dbg.nade.throwT; cookAtRelease = 1; }
      else if (throwT >= 0) { throwT += dt; if (throwT > NADE.throwS) throwT = -1; }
      nadeHandW = throwT >= 0 ? 1 : cookW;

      // INSPECT (key I — input.state.inspect is a press COUNTER, never in the cmd)
      const req = input.state.inspect | 0;
      if (lastInspectReq == null) lastInspectReq = req;
      if (req !== lastInspectReq) {
        lastInspectReq = req;
        const busy = wp.ads || adsT > 0.05 || sprintState !== "none" || sliding || cooking ||
          throwT >= 0 || wp.state === "reloading" || wp.state === "switching" || switchProg >= 0;
        if (!busy) inspectT = (inspectT >= 0 ? -1 : 0);   // a second press puts it away
      }
      if (inspectT >= 0) {
        if (input.state.fire || wp.ads || sprintState !== "none" || sliding || cooking ||
            wp.state === "reloading" || wp.state === "switching" || sinceShot < 0.05) inspectT = -1;
        else { inspectT += dt; if (inspectT >= INSPECT_S) inspectT = -1; }
      }
    } else {
      inspectT = -1; throwT = -1; cookW = 0; nadeHandW = 0; prevCooking = false;
      // a press in a menu / while dead is dropped, never replayed on respawn
      lastInspectReq = input && input.state ? (input.state.inspect | 0) : lastInspectReq;
    }
    if (dbg.inspect != null) { inspectQ = dbg.inspect; inspectW = 1; }
    else {
      if (inspectT >= 0) inspectQ = inspectT / INSPECT_S;
      inspectW = damp(inspectW, inspectT >= 0 ? 1 : 0, inspectT >= 0 ? 0.06 : 0.07, dt);
      if (inspectW < 0.002 && inspectT < 0) inspectW = 0;
    }
    actionT += dt;

    if (driving) {
      // eye height (§1.3 140 ms crouch lerp; §1.4 slide 0.90 over 110 ms)
      const eyeTarget = sliding ? EYE_SLIDE
        : p.stance === "crouch" ? EYE_CROUCH : EYE_STAND;
      eyeH = damp(eyeH, eyeTarget, sliding ? 0.055 : 0.07, dt);

      // bob (§1.6) — advance phase only when grounded and moving
      const stateRow = sliding ? null
        : sprintState === "tac" ? BOB.tac
        : sprintState === "sprint" ? BOB.sprint
        : p.stance === "crouch" ? BOB.crouch : BOB.walk;
      const moving = p.grounded && !sliding && speedNorm > 0.03;
      const adsBobMult = 1 - 0.75 * adsEase; // ADS row: ×0.25
      const targetAmpV = moving && stateRow ? stateRow.v * adsBobMult : 0;
      const targetAmpL = moving && stateRow ? stateRow.l * adsBobMult : 0;
      bobAmpV = damp(bobAmpV, targetAmpV, 0.12, dt);
      bobAmpL = damp(bobAmpL, targetAmpL, 0.12, dt);
      // BOB FREQUENCY IS DISTANCE-BASED, NOT A CLOCK: one stride of ground = one bob
      // cycle, at every speed, always — the footsteps run on the same accumulator
      // (player.js strideLength), so feet and view agree, through accel and decel.
      if (moving && stateRow) {
        const hs = Math.hypot(p.vel[0], p.vel[2]);
        const stride = Math.max(0.3, strideLength(hs, p.stance, sprintState !== "none"));
        bobPhase += 2 * Math.PI * (hs * dt) / stride;
        if (bobPhase > 1e6) bobPhase %= 2 * Math.PI; // never let it drift huge
      }
      const bobSlider = S && S.bob != null ? S.bob : 1; // camera share only
      const camBobY = Math.sin(bobPhase) * bobAmpV * bobSlider;
      const camBobX = Math.sin(bobPhase * 0.5) * bobAmpL * bobSlider;
      bobRollAmp = damp(bobRollAmp,
        moving && stateRow && stateRow.roll ? stateRow.roll : 0, 0.15, dt);
      rollOut += Math.sin(bobPhase * (stateRow && stateRow.rollHz ? stateRow.rollHz / (stateRow.hz || 1) : 0.5)) * bobRollAmp * bobSlider;

      // landing dip (§1.7)
      if (!p.grounded) airVy = p.vel[1];
      if (p.grounded && !prevGrounded) {
        const fallH = (airVy < 0) ? (airVy * airVy) / (2 * 20) : 0;
        if (fallH >= 4.0) { dipAmp = 0.09; dipDur = 0.12; dipRec = 0.32; dipTimer = 0; }
        else if (fallH >= 1.5) { dipAmp = 0.04; dipDur = 0.09; dipRec = 0.22; dipTimer = 0; }
        // the gun's weight on touchdown: it keeps falling for a beat, muzzle dips,
        // then springs back up past rest (under-damped). Every landing, scaled by
        // impact speed — the camera dip above only fires on real drops.
        const s = Math.min(1, Math.max(0, (-airVy - 1.5) / 9));
        if (s > 0) {
          landSide = -landSide;
          msImpulse(0.02 * s * landSide, -0.10 - 0.30 * s, 0.02 * s, -0.5 - 1.5 * s, 0, (0.25 + 0.5 * s) * landSide);
        }
      }
      // take-off: the body goes up first, the gun lags down and the muzzle dips
      if (!p.grounded && prevGrounded && p.vel[1] > 1.0) msImpulse(0, -0.16, 0.01, -0.85, 0, 0.18);
      // slide entry: the gun is thrown over toward the lean side
      if (sliding && !prevSliding) msImpulse(-0.03, -0.12, 0.03, -0.4, 0.2, slideRollTargetSign(m, input) * 1.3);
      prevSliding = sliding;
      prevGrounded = !!p.grounded;
      dipY = 0;
      if (dipTimer >= 0) {
        dipTimer += dt;
        if (dipTimer <= dipDur) {
          dipY = -dipAmp * smoothstep(dipTimer / dipDur);
        } else if (dipTimer <= dipDur + dipRec) {
          const r = (dipTimer - dipDur) / dipRec;
          dipY = -dipAmp * (1 - r) * (1 - r) * (1 + 2 * r); // cubic-out
        } else { dipTimer = -1; }
      }

      // slide camera roll (§1.4: 2.5° toward the lean side)
      let slideRollTarget = 0;
      if (sliding && m.slideDir) {
        const fy = input.state.yaw;
        const rightX = Math.cos(fy), rightZ = -Math.sin(fy); // camera right in XZ
        const side = m.slideDir[0] * rightX + m.slideDir[1] * rightZ;
        slideRollTarget = (side >= 0 ? -1 : 1) * 2.5 * DEG;
      }
      slideRoll = damp(slideRoll, slideRollTarget, 0.08, dt);
      rollOut += slideRoll;

      // §2.6 ADS sway + breath — DIFFERENTIAL camera offsets (never input)
      swayT += dt;
      const adsFull = adsT >= 0.999;
      if (adsFull && !prevAdsFull) settleClock = 0; else settleClock += dt;
      prevAdsFull = adsFull;
      let holding = false;
      let swayAmpOut = 0;
      if (adsFull && w) {
        const id = current.id;
        let amp = (SWAY.adsAmpDeg[id] != null ? SWAY.adsAmpDeg[id] : 0.03) * DEG;
        const movingMult = isScoped ? (SWAY.scopedMovingMult || SWAY.corvusMovingMult) : SWAY.movingMult;
        if (speedNorm > 0.03) amp *= movingMult;
        // settle: ×2 → ×1 over FEEL.adsSettleS after ADS completes
        if (settleClock < FEEL.adsSettleS) {
          amp *= FEEL.adsSettleAmpMult - (FEEL.adsSettleAmpMult - 1) * (settleClock / FEEL.adsSettleS);
        }
        // breath hold (scoped weapons): Shift while scoped
        if (isScoped) {
          holding = !!input.state.sprint && breathMeter > 0 && !winded;
          if (holding) {
            breathMeter = Math.max(0, breathMeter - dt);
            if (breathMeter === 0) winded = true;
            amp *= SWAY.breath.holdAmpMult;
          } else {
            breathMeter = Math.min(SWAY.breath.meterS,
              breathMeter + dt * (SWAY.breath.meterS / SWAY.breath.refillS));
            if (winded) {
              amp *= SWAY.breath.windedAmpMult;
              if (breathMeter >= SWAY.breath.meterS * SWAY.breath.windedRefillFrac) winded = false;
            }
          }
        }
        swayAmpOut = amp;
        const [f1, f2] = SWAY.baseFreqsHz;
        camSwayYaw = amp * (Math.sin(2 * Math.PI * f1 * swayT) * 0.6 +
                            Math.sin(2 * Math.PI * f2 * swayT + 1.3) * 0.4);
        camSwayPitch = amp * (Math.sin(2 * Math.PI * f1 * swayT + 4.2) * 0.6 +
                              Math.sin(2 * Math.PI * f2 * swayT + 2.1) * 0.4);
      } else {
        breathMeter = Math.min(SWAY.breath.meterS,
          breathMeter + dt * (SWAY.breath.meterS / SWAY.breath.refillS));
        if (breathMeter >= SWAY.breath.meterS * SWAY.breath.windedRefillFrac) winded = false;
      }
      scopeS.holding = holding;
      scopeS.winded = winded;
      scopeS.breath = breathMeter / SWAY.breath.meterS;

      // SCOPED WEAPON: the sway is a REAL aim wobble. The player's aim (input.state)
      // is nudged by the differential of the sway signal, so the reticle on the lens,
      // the world drifting under it and the bullet's path are one thing — never a
      // cosmetic offset that lies about where the round goes. Applied through recoil's
      // nudge (it keeps its pulldown bookkeeping honest). Not applied to iron sights:
      // their ±0.03° view sway is below what anyone can see or exploit.
      if (isScoped && swayAmpOut > 0) {
        const nudge = globalThis.__BR_RECOIL__ && globalThis.__BR_RECOIL__.nudge;
        const dY = camSwayYaw - scopeSwayYaw, dP = camSwayPitch - scopeSwayPitch;
        if (nudge && (Math.abs(dY) + Math.abs(dP)) > 0) nudge(dY, dP);
        scopeSwayYaw = camSwayYaw; scopeSwayPitch = camSwayPitch;
        camSwayYaw = 0; camSwayPitch = 0;   // the world moves because the AIM moved
      } else {
        scopeSwayYaw = 0; scopeSwayPitch = 0;
      }
      scopeS.swayX = scopeSwayYaw; scopeS.swayY = scopeSwayPitch;

      // position + rotation. The BASE is the player's last two sim ticks lerped
      // by this frame's alpha; eyeH / bob / dip ride ON TOP. Rotation is raw
      // input.state, zero latency.
      const bp = basePos(p, alpha);
      camera.position.set(
        bp[0] + camBobX * Math.cos(input.state.yaw),
        bp[1] + eyeH + camBobY + dipY,
        bp[2] - camBobX * Math.sin(input.state.yaw),
      );
      // VT §7 fire response, camera share: pitch punch + roll + yaw, all
      // RENDER-ONLY.
      // camera shake (see SHAKE): sum-of-sines noise, three incommensurate rates
      trauma = Math.max(0, trauma - SHAKE.decay * dt);
      shakeT += dt;
      const tt = trauma * trauma;
      let shP = 0, shY = 0, shR = 0;
      if (tt > 1e-5) {
        const w = shakeT * SHAKE.hz;
        const n1 = Math.sin(w * 1.00) * 0.6 + Math.sin(w * 2.31 + 1.3) * 0.4;
        const n2 = Math.sin(w * 1.17 + 2.1) * 0.6 + Math.sin(w * 2.73 + 0.4) * 0.4;
        const n3 = Math.sin(w * 0.83 + 4.2) * 0.6 + Math.sin(w * 1.91 + 2.9) * 0.4;
        shP = n1 * SHAKE.pitch * tt; shY = n2 * SHAKE.yaw * tt; shR = n3 * SHAKE.roll * tt;
        camera.position.y += n2 * SHAKE.pos * tt * 0.6;
        camera.position.x += n3 * SHAKE.pos * tt * 0.4;
      }
      camera.rotation.set(
        input.state.pitch + camSwayPitch + K.camP.x + shP,
        input.state.yaw + camSwayYaw + K.camY.x + shY,
        rollOut + K.camR.x + shR, "YXZ",
      );

      // FOV kinetics (§1.4, §2.4, VT §7): base → adsFov by eased adsT,
      // sprint +5 (tac +7) over 0.25 s, slide +4 (0.12 in / 0.2 out)
      const base = (S && S.fov) || 74;
      const adsFovTarget = w ? w.adsFov : base;
      const fovAim = base + (adsFovTarget - base) * adsEase;
      fovSprint = damp(fovSprint,
        sprintState === "tac" ? 7 : sprintState === "sprint" ? 5 : 0, 0.12, dt);
      fovSlide = damp(fovSlide, sliding ? 4 : 0, sliding ? 0.06 : 0.1, dt);
      // a scoped lens must not breathe with the fire-response FOV punch
      const fov = fovAim + fovSprint + fovSlide + (isScoped ? K.fov.x * (1 - adsEase) : K.fov.x);
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }

      // vm camera FOV: share of the world's ADS zoom that reaches the gun (see
      // weapon_data VIEWMODEL.adsZoomShare). Done in TANGENT space, where
      // "magnification" lives; alignment is safe BY CONSTRUCTION (a FOV change on
      // the vm camera is a pure scale about its centre ray, and view.posAds.y =
      // -view.sightY parks the sight line ON that ray).
      const vmBase = (ctx.vmFovBase != null && ctx.vmFovBase > 0)
        ? ctx.vmFovBase : base;
      const share = zoomShareOverride != null ? zoomShareOverride
        : (w && w.view && w.view.adsZoom != null)
          ? w.view.adsZoom
          : (VIEWMODEL.adsZoomShare != null ? VIEWMODEL.adsZoomShare : 1);
      const halfBase = Math.tan(0.5 * DEG * Math.max(1, vmBase));
      const halfAim = Math.tan(0.5 * DEG * Math.max(1, fovAim));
      const magWorld = Math.max(1e-3, halfBase / Math.max(1e-6, halfAim));
      const magVm = share === 0 ? 1 : Math.pow(magWorld, share);
      const vmFov = 2 * Math.atan(Math.tan(0.5 * DEG * VIEWMODEL.fovDeg) / magVm) / DEG;
      if (Math.abs(vmCamera.fov - vmFov) > 0.01) {
        vmCamera.fov = vmFov;
        vmCamera.updateProjectionMatrix();
      }
      scopeS.zoom = halfBase / Math.max(1e-6, Math.tan(0.5 * DEG * Math.max(1, adsFovTarget)));
    }

    // ---- scope blend: the 3D weapon fades out and the HUD lens fades in
    {
      const target = (isScoped && wp && wp.ads) ? ramp(adsT, 0.45, 0.85) : 0;
      // follow the sim's own ADS progress both ways (no extra smoothing: adsT is
      // already a ramp, and a second filter would desync lens and zoom)
      const tb = isScoped ? ramp(adsT, 0.45, 0.85) : 0;
      scopeS.blend = (wp && (wp.ads || adsT > 0.01)) ? tb : 0;
      void target;
      scopeS.active = scopeS.blend > 0.02;
    }

    // ================= VIEWMODEL LAYERS =================
    // hidden outside live mission phases (no gun floating behind the menu); hidden
    // too while a scope owns the whole frame
    const scopeHides = scopeS.blend > 0.985;
    rig.visible = visible && !!current && !ctx.cameraDetached &&
      !!st && LIVE_PHASES.has(st.phase) && !scopeHides;
    if (!rig.visible) { havePrevCam = false; return; }

    // -- translation lag (§2.7: τ 45 ms, max 3.2 cm) — camera-space ---------
    camera.updateMatrixWorld();
    if (havePrevCam) {
      _v.copy(camera.position).sub(prevCamPos); // world Δ this frame
      _q.copy(camera.quaternion).invert();
      _v.applyQuaternion(_q);                    // camera-local Δ
      const vx = _v.x / dt, vy = _v.y / dt, vz = _v.z / dt;
      lagX = damp(lagX, -vx * VIEWMODEL.posLagTau, VIEWMODEL.posLagTau, dt);
      lagY = damp(lagY, -vy * VIEWMODEL.posLagTau, VIEWMODEL.posLagTau, dt);
      lagZ = damp(lagZ, -vz * VIEWMODEL.posLagTau, VIEWMODEL.posLagTau, dt);
      const lagMag = Math.hypot(lagX, lagY, lagZ);
      if (lagMag > VIEWMODEL.posLagMaxM) {
        const k = VIEWMODEL.posLagMaxM / lagMag;
        lagX *= k; lagY *= k; lagZ *= k;
      }
    }
    prevCamPos.copy(camera.position);
    havePrevCam = true;

    // -- rotation lag / sway (§2.7 τ 65 ms max 4°; VT §5 layer 2) -----------
    const yawNow = ctx.input.state.yaw, pitchNow = ctx.input.state.pitch;
    if (prevYaw != null) {
      let dYaw = yawNow - prevYaw;
      if (dYaw > Math.PI) dYaw -= 2 * Math.PI;
      else if (dYaw < -Math.PI) dYaw += 2 * Math.PI;
      const dPitch = pitchNow - prevPitch;
      const maxR = VIEWMODEL.rotLagMaxDeg * DEG;
      const gain = VIEWMODEL.rotLagTau; // rad per (rad/s) — lag ≈ look vel × τ
      const tY = Math.max(-maxR, Math.min(maxR, -(dYaw / dt) * gain));
      const tP = Math.max(-maxR, Math.min(maxR, -(dPitch / dt) * gain));
      // under-damped spring toward the lag target (TURN): the gun trails a flick and
      // swings a little PAST centre when the look stops — weight, not a glide.
      // Sub-stepped like the kick springs; hard-clamped so a teleport cannot fling it.
      const o = TURN.omega, z2 = 2 * TURN.zeta * TURN.omega, cap = maxR * 1.3;
      let rem = Math.min(dt, 0.25);
      while (rem > 1e-6) {
        const h = Math.min(rem, 1 / 120);
        rem -= h;
        swayYawV += (o * o * (tY - swayYaw) - z2 * swayYawV) * h;
        swayYaw += swayYawV * h;
        swayPitchV += (o * o * (tP - swayPitch) - z2 * swayPitchV) * h;
        swayPitch += swayPitchV * h;
      }
      if (swayYaw > cap) { swayYaw = cap; swayYawV = 0; } else if (swayYaw < -cap) { swayYaw = -cap; swayYawV = 0; }
      if (swayPitch > cap) { swayPitch = cap; swayPitchV = 0; } else if (swayPitch < -cap) { swayPitch = -cap; swayPitchV = 0; }
    }
    prevYaw = yawNow; prevPitch = pitchNow;
    scopeS.lagX = swayYaw; scopeS.lagY = swayPitch;

    // -- pose selection ------------------------------------------------------
    const view = (w && w.view) || { posHip: [0.16, -0.18, -0.34], posAds: [0, -0.14, -0.26] };
    // arm/part animation first: it can contribute gun-level cant/lift
    if (current.group) applyHands(current.group, w, animOf(w), wp, dt, adsEase);

    // sprint / slide / mantle weights ease in and out — they used to step
    const sprintTarget = sprintState === "tac" ? 1 : sprintState === "sprint" ? 0.8 : 0;
    // sprint-to-fire: a trigger pull while sprinting snaps the gun up faster (the sim's
    // sprint-out is 0.2 s per class — the muzzle has to be on target by then)
    const sprintOutTau = input.state.fire ? 0.055 : 0.09;
    sprintBlend = damp(sprintBlend, dbg.sprint != null ? dbg.sprint : sprintTarget,
      (dbg.sprint != null ? dbg.sprint : sprintTarget) > sprintBlend ? 0.11 : sprintOutTau, dt);
    slideBlend = damp(slideBlend, sliding ? 1 : 0, sliding ? 0.08 : 0.14, dt);
    mantleBlend = damp(mantleBlend, m.mantle ? 1 : 0, m.mantle ? 0.06 : 0.14, dt);
    const sb = sprintBlend * (1 - adsEase);

    let px = view.posHip[0] + (view.posAds[0] - view.posHip[0]) * adsEase;
    let py = view.posHip[1] + (view.posAds[1] - view.posHip[1]) * adsEase;
    let pz = view.posHip[2] + (view.posAds[2] - view.posHip[2]) * adsEase;
    // HIP REAR STANDOFF: weapon_meshes.js measures how far this prototype has to move
    // so no weapon vertex sits inside the eye at the hip pose. Hip only: at full ADS
    // the push is 0 (the sight picture is the subject).
    if (current.group && current.group.userData.hipPush) {
      pz -= current.group.userData.hipPush * (1 - adsEase);
    }
    // ADS STANDOFF: the eye-to-weapon distance is the ONLY lever that shrinks the
    // weapon's solid angle without distorting it, and it is exact (the sight line
    // lies ON the vm camera's centre ray, so translating along -Z slides the sight
    // ALONG that ray). A shouldered rifle really sits ~0.25 m from the eye, but the
    // game renders 55° where a human reads a 120° field — so a physically-placed gun
    // subtends ~3.3x the fraction of the frame it does in life. Applied on adsEase so
    // the hip pose is bit-identical.
    {
      const so = standoffOverride != null ? standoffOverride
        : (w && w.view && w.view.adsStandoff != null) ? w.view.adsStandoff
          : (VIEWMODEL.adsStandoff || 0);
      if (so) pz -= so * adsEase;
    }
    let rx = 0, ry = 0, rz = 0;

    if (sb > 0.001) {
      // §1.1/VT §5: sprint = gun across the chest, muzzle up-left, low (CoD "high port"): the
      // weapon stays PARTLY in frame at the bottom-right so the player still sees a gun.
      // Per-weapon override: view.sprint = { pos:[x,y,z], rot:[rx,ry,rz deg] }.
      const SP = (w && w.view && w.view.sprint) || VIEWMODEL.sprint || { pos: [-0.045, -0.02, 0.05], rot: [-8, 38, -22] };
      px += SP.pos[0] * sb;
      py += SP.pos[1] * sb;
      pz += SP.pos[2] * sb;
      rx += SP.rot[0] * DEG * sb;
      ry += SP.rot[1] * DEG * sb;
      rz += SP.rot[2] * DEG * sb;
      // the swing of a carried rifle: a figure-eight locked to the stride phase
      const s1 = Math.sin(bobPhase * 0.5), s2 = Math.sin(bobPhase);
      const sw = sb * Math.min(1, speedNorm * 1.2);
      px += SPRINT_SWING.x * s1 * sw;
      py += SPRINT_SWING.y * s2 * sw;
      rz += SPRINT_SWING.rzDeg * DEG * s1 * sw;
      ry += SPRINT_SWING.ryDeg * DEG * s1 * sw;
      rx += SPRINT_SWING.rxDeg * DEG * s2 * sw;
    }
    if (slideBlend > 0.001) {
      px += -0.02 * slideBlend; py += -0.05 * slideBlend; pz += 0.03 * slideBlend;
      rx += -8 * DEG * slideBlend; ry += 12 * DEG * slideBlend; rz += 14 * DEG * slideBlend;
      rz += slideRoll * 2.5 * slideBlend;   // and leans with the camera's slide roll
    }

    // STRAFE TILT + travel pitch: the gun rolls INTO lateral travel (moving right =
    // clockwise) and dips/pulls back a hair with forward travel; damped, and kept to
    // STRAFE.adsKeep down the sights so the sight picture stays readable.
    if (p) {
      const fy = input.state.yaw, cy = Math.cos(fy), sy = Math.sin(fy);
      const vR = p.vel[0] * cy - p.vel[2] * sy;
      const vF = -p.vel[0] * sy - p.vel[2] * cy;
      const g = p.grounded ? 1 : 0.5;
      strafeR = damp(strafeR, clampS(vR / STRAFE.speedRef, 1) * g, STRAFE.tau, dt);
      strafeF = damp(strafeF, clampS(vF / STRAFE.speedRef, 1) * g, STRAFE.tau, dt);
      airLift = damp(airLift, p.grounded ? 0 : clampS(-p.vel[1] / 10, 1), 0.12, dt);
    }
    {
      const keep = 1 - (1 - STRAFE.adsKeep) * adsEase;
      const ns = 1 - sb * 0.6;                    // the sprint pose owns the gun when sprinting
      rz += -STRAFE.rollDeg * DEG * strafeR * keep * ns;
      ry += STRAFE.yawDeg * DEG * strafeR * keep * ns;
      rx += -STRAFE.fwdPitchDeg * DEG * strafeF * keep * ns;
      pz += STRAFE.fwdBack * Math.max(0, strafeF) * keep * ns;
      // airborne: low on the way up, floats up as you fall
      py += 0.012 * airLift * (1 - 0.7 * adsEase);
      rx += 3 * DEG * airLift * (1 - 0.7 * adsEase);
    }

    // ADS TRAVEL ARC: the gun rolls and dips on its way to the eye and back; zero at
    // both ends (sin(pi*adsT)), so the hip pose and the sight picture are untouched
    {
      adsDirS = damp(adsDirS, (wp && wp.ads) ? 1 : ADS_TRAVEL.outMult, 0.06, dt);
      const arc = Math.sin(Math.PI * clamp01(adsT));
      rz += ADS_TRAVEL.rollDeg * DEG * arc * adsDirS;
      py += -ADS_TRAVEL.dropM * arc;
    }

    // INSPECT pose (see INSPECT_KEYS), weighted so a cancel fades it out
    if (inspectW > 0.001) {
      const q = inspectQ;
      let i = 0;
      while (i < INSPECT_KEYS.length - 2 && q > INSPECT_KEYS[i + 1][0]) i++;
      const a = INSPECT_KEYS[i], b = INSPECT_KEYS[i + 1];
      const s = smoothstep((q - a[0]) / Math.max(1e-6, b[0] - a[0]));
      // a slow drift on top so the held beats are never dead still
      const drift = Math.sin(q * Math.PI * 5.0) * bell(q, 0.12, 0.88);
      const wI = inspectW;
      px += lerp(a[1], b[1], s) * wI;
      py += (lerp(a[2], b[2], s) + 0.003 * drift) * wI;
      pz += lerp(a[3], b[3], s) * wI;
      rx += (lerp(a[4], b[4], s) + 1.5 * drift) * DEG * wI;
      ry += lerp(a[5], b[5], s) * DEG * wI;
      rz += (lerp(a[6], b[6], s) + 2.0 * drift) * DEG * wI;
    }

    // GRENADE: the gun drops right while the support hand is off it
    if (nadeHandW > 0.001) {
      const gW = throwT >= 0 ? (1 - ramp(throwT, 0.32, NADE.throwS)) * Math.max(0.6, cookAtRelease) : cookW;
      const swing = throwT >= 0 ? bell(throwT, 0.03, 0.24) : 0;   // the body turns into the throw
      px += NADE.gun.pos[0] * gW + 0.015 * swing;
      py += NADE.gun.pos[1] * gW - 0.012 * swing;
      pz += NADE.gun.pos[2] * gW;
      rx += NADE.gun.rot[0] * DEG * gW;
      ry += NADE.gun.rot[1] * DEG * gW - 6 * DEG * swing;
      rz += NADE.gun.rot[2] * DEG * gW + 6 * DEG * swing;
    }

    // handling springs (reload beats, ADS settle, jump/land/slide, dry click)
    px += MS.posX.x; py += MS.posY.x; pz += MS.posZ.x;
    rx += MS.rotX.x; ry += MS.rotY.x; rz += MS.rotZ.x;

    // ACTION CYCLE: a bolt / slide node (if the GLB has one) snaps back on every
    // shot and returns; a slide locks open on an empty magazine; the empty-reload
    // rack drives it too. Absent part = no-op.
    {
      const ap = actionPart(current.group);
      if (ap) {
        let d = actionT < 0.016 ? actionT / 0.016 : actionT < 0.075 ? 1 - smoothstep((actionT - 0.016) / 0.059) : 0;
        // last round fired: the bolt / slide holds open until the empty reload releases it
        if (wp && wp.mag === 0 && wp.state !== "reloading") d = 1;
        d = Math.max(d, rackStroke);
        ap.node.position.copy(ap.restP);
        ap.node.position.z += ap.stroke * d;      // glTF +z = toward the stock
      }
    }
    // mantle: weapon lowered hard (§1.5)
    if (mantleBlend > 0.001) {
      py += -0.16 * mantleBlend; pz += 0.07 * mantleBlend;
      rx += -35 * DEG * mantleBlend; rz += 10 * DEG * mantleBlend;
    }

    // reload / pump animation contributions (cant, lift)
    px += out.px; py += out.py; pz += out.pz; rx += out.rx; ry += out.ry; rz += out.rz;

    // weapon switch: lower the old gun, swap the mesh, raise the new one. One
    // continuous 0..1 "lowered" channel across both halves.
    {
      let lowerAmt = 0;
      if (switchProg >= 0) {
        // the raise half eases out with a slight OVERSHOOT (the gun comes up a hair
        // past its rest and settles) — reads as a deliberate draw, not a lift
        lowerAmt = switchProg < SWITCH_SWAP
          ? smoothstep(switchProg / SWITCH_SWAP)
          : 1 - easeOutBack((switchProg - SWITCH_SWAP) / (1 - SWITCH_SWAP), 1.25);
      } else if (raiseClock < raiseDur) {
        raiseClock += dt;
        lowerAmt = 1 - easeOutBack(Math.min(1, raiseClock / raiseDur), 1.25);
      }
      if (lowered) lowerAmt = Math.max(lowerAmt, 1);
      if (Math.abs(lowerAmt) > 0.001) {
        py += -0.17 * lowerAmt; px += 0.05 * lowerAmt; pz += 0.05 * lowerAmt;
        rx += -42 * DEG * lowerAmt; ry += -10 * DEG * lowerAmt; rz += 16 * DEG * lowerAmt;
      }
    }

    // vm bob: camera numbers × 2.3, in camera space (not the bob slider)
    const vmBobY = Math.sin(bobPhase) * bobAmpV * 2.3;
    const vmBobX = Math.sin(bobPhase * 0.5) * bobAmpL * 2.3;
    // the gun also pitches and rolls a little with the stride (a held weight)
    const vmBobRx = Math.sin(bobPhase + 0.6) * bobAmpV * 14 * (1 - adsEase);
    const vmBobRz = Math.sin(bobPhase * 0.5) * bobAmpL * 28 * (1 - adsEase);

    // idle breathe (VT §5 layer 1): ±2.5 mm dual sine + a hair of pitch
    const breatheY = 0.0025 * (Math.sin(swayT * 2 * Math.PI * 0.32) * 0.7 +
                               Math.sin(swayT * 2 * Math.PI * 0.53 + 1.1) * 0.3);
    const breatheRx = 0.0035 * Math.sin(swayT * 2 * Math.PI * 0.32 + 0.4) * (1 - 0.8 * adsEase);

    // fire response, viewmodel share (springs integrated at the top of update)
    // turn sway: rotation + a little sideways drift + roll into the turn
    const swayKeep = 1 - 0.7 * adsEase;
    mount.position.set(
      px + lagX + vmBobX + swayYaw * TURN.slideM * swayKeep,
      py + lagY + vmBobY + breatheY + dipY * 0.6 + K.posY.x - swayPitch * TURN.slideM * 0.5 * swayKeep,
      pz + lagZ + K.posZ.x,
    );
    mount.rotation.set(
      rx + vmBobRx + breatheRx + swayPitch * swayKeep + K.rotX.x,
      ry + swayYaw * swayKeep + K.rotY.x,
      rz + vmBobRz + swayYaw * TURN.rollShare * (1 - adsEase) + K.rotZ.x,
      "YXZ",
    );

    // ---- wrist rig: the hands give against what the gun does ---------------
    {
      const parts = current.group.userData.parts;
      if (parts) {
        armRoll = damp(armRoll, clampS(-K.rotZ.x * ARM.kickRoll, ARM.maxRad), ARM.tau, dt);
        armPitch = damp(armPitch, clampS(-K.rotX.x * ARM.kickPitch, ARM.maxRad), ARM.tau, dt);
        armLead = damp(armLead, clampS(-swayYaw * ARM.swayLead, ARM.maxRad), ARM.tau, dt);
        _armE.set(armPitch, armLead, armRoll, "YXZ");
        _armQ.setFromEuler(_armE);
        // post-multiply: the wrist flexes in its own local frame, on top of whatever
        // the reload animation set this frame
        if (parts.armR) parts.armR.node.quaternion.copy(parts.armR.restQ).multiply(_armQ);
        if (parts.armL) parts.armL.node.quaternion.multiply(_armQ);
      }
    }
  }

  // sync reader for a prototype that has already resolved
  function peek(id) {
    for (const pr of loadedPrototypes()) {
      if (pr && pr.userData && pr.userData.weaponId === id) return pr;
    }
    return null;
  }

  // ---- sockets ---------------------------------------------------------------
  function muzzleWorld(outVec3) {
    const o = outVec3 || new THREE.Vector3();
    if (current && current.group) {
      const s = current.group.userData.muzzle;
      if (s) { s.updateWorldMatrix(true, false); return s.getWorldPosition(o); }
      const off = current.group.userData.muzzleOffset || [0, 0.05, -0.5];
      o.set(off[0], off[1], off[2]);
      mount.updateWorldMatrix(true, false);
      return mount.localToWorld(o);
    }
    camera.updateWorldMatrix(true, false);
    o.set(0.15, -0.1, -0.6);
    return camera.localToWorld(o);
  }

  // private: shell-ejection world position (A7 casings)
  function ejectWorld(outVec3) {
    const o = outVec3 || new THREE.Vector3();
    if (current && current.group) {
      const s = current.group.userData.eject;
      if (s) { s.updateWorldMatrix(true, false); return s.getWorldPosition(o); }
      const off = current.group.userData.ejectOffset || [0.03, 0.05, -0.1];
      o.set(off[0], off[1], off[2]);
      mount.updateWorldMatrix(true, false);
      return mount.localToWorld(o);
    }
    return muzzleWorld(o);
  }

  return {
    equip,
    update,
    kick,
    // add camera-shake trauma (0..1); see SHAKE
    shake(amount) { trauma = Math.min(1, trauma + Math.max(0, +amount || 0)); },
    muzzleWorld,
    setVisible(on) { visible = !!on; rig.visible = !!on && !!current; },
    setLowered(on) { lowered = !!on; },
    prewarmables() {
      // every loaded weapon prototype — their materials must compile during
      // boot prewarm or the first ADS frame hitches (doctrine §3)
      return loadedPrototypes();
    },
    // ---- private extras (not in the frozen surface) -----------------------
    ejectWorld,
    // iter10 A/B seam — see zoomShareOverride above.
    setAdsZoomShareOverride(v) { zoomShareOverride = (v == null ? null : +v); },
    // combat_spec §1.6: "a step SOUND lands on a bob TROUGH". The frequency
    // already matches the gait; this keeps the PHASE honest so the plant and the
    // lowest point of the head coincide. Nudged, not snapped.
    onStep(d) {
      if (!d || d.who !== "P") return;
      const TROUGH = 3 * Math.PI / 2;        // sin() minimum
      const TWO_PI = 2 * Math.PI;
      const cur = ((bobPhase % TWO_PI) + TWO_PI) % TWO_PI;
      let delta = TROUGH - cur;
      if (delta > Math.PI) delta -= TWO_PI;
      if (delta < -Math.PI) delta += TWO_PI;
      bobPhase += delta * 0.35;
    },
    setAdsStandoffOverride(v) { standoffOverride = (v == null ? null : +v); },
    renderPass: vmRenderPass,
    get camera() { return vmCamera; },
    get currentId() { return current ? current.id : null; },
    get _breath() { return { meter: breathMeter, winded }; },
    // scope state for the HUD lens (hud.js reads this every frame)
    get scope() { return scopeS; },
    get parts() { return current && current.group ? current.group.userData.parts : null; },
    get group() { return current ? current.group : null; },
    get mount() { return mount; },
    // dev: pin an animation at a fixed progress for screenshots. reload: {p, kind, empty}
    _dbg(o) {
      if (o == null) {
        dbg.reloadP = null; dbg.kind = null; dbg.lower = null; dbg.pump = null; dbg.sprint = null; dbg.handL = null;
        dbg.inspect = null; dbg.nade = null; return;
      }
      // inspect: pin the inspect pose at progress 0..1. nade: {cook:true} holds the
      // cook pose, {throwT:s} pins the throw at s seconds.
      if ("inspect" in o) dbg.inspect = o.inspect;
      if ("nade" in o) dbg.nade = o.nade;
      if ("handL" in o) dbg.handL = o.handL;
      if ("reloadP" in o) dbg.reloadP = o.reloadP;
      if ("kind" in o) dbg.kind = o.kind;
      if ("empty" in o) dbg.empty = o.empty;
      if ("dur" in o) dbg.dur = o.dur;
      if ("lower" in o) dbg.lower = o.lower;
      if ("pump" in o) dbg.pump = o.pump;
      if ("sprint" in o) dbg.sprint = o.sprint;
    },
    // dev: authored-pose helpers for hand tuning
    _handPose(pose) { const P = new THREE.Vector3(), Q = new THREE.Quaternion(); handPose(pose, P, Q); return { p: P.toArray(), q: Q.toArray() }; },
    _clearHands() { _handCache.clear(); },
    // dev: forget a cached GLB and re-fetch it (after a Blender re-export)
    async _hot(id) {
      invalidateWeapon(id);
      const proto = await loadWeaponGLB(id);
      installProto(id, proto);
      return id;
    },
    // handling-feel state (lane VM probes; never frozen surface)
    get _handling() {
      return {
        inspectT, inspectW, inspectQ, cookW, throwT, nadeVisible: nade.visible,
        strafeR, strafeF, airLift, swayYaw, swayPitch, reloadW, reloadEmpty, rackStroke,
        ms: { px: MS.posX.x, py: MS.posY.x, pz: MS.posZ.x, rx: MS.rotX.x, ry: MS.rotY.x, rz: MS.rotZ.x },
        action: !!(current && current.group && actionPart(current.group)),
      };
    },
    // fire-response spring state — the D10 probe reads this to assert the
    // burst is displaced at the ticks C1 photographs (never frozen surface)
    get _kick() {
      return {
        vmPitch: K.rotX.x, vmRoll: K.rotZ.x, vmYaw: K.rotY.x,
        vmUp: K.posY.x, vmBack: K.posZ.x,
        camPitch: K.camP.x, camRoll: K.camR.x, camYaw: K.camY.x,
        fov: K.fov.x,
      };
    },
  };
}
