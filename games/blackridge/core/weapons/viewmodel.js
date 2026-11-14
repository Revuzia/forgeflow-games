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
  const vmFill = new THREE.HemisphereLight(0xa9bfdc, 0x2e2a26, 1.8);
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
  const vmKeyDir = mkDir("__vm_key_dir__", 0xe8eef8, 2.2, [-0.5, 0.9, 0.7], [0.0, -0.1, -1.0]);
  const vmRim = mkDir("__vm_rim__", 0x86a8ff, 1.5, [0.8, 0.5, -0.9], [0.0, 0.0, 0.0]);
  const VM_KEY_D = 0.42, VM_KEY_E = 0.45;
  const vmKey = new THREE.PointLight(0xc8d6ea, VM_KEY_E * VM_KEY_D * VM_KEY_D, 3.5, 2);
  vmKey.name = "__vm_key__";
  vmKey.position.set(0.38, 0.30, 0.25); // camera-space: over the right shoulder
  vmKey.layers.set(VM_LAYER);
  camera.add(vmKey);
  void vmKeyDir; void vmRim;

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
  const dbg = { reloadP: null, kind: null, empty: false, lower: null, pump: null, sprint: null, handL: null };

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
      const sm = r.shadowMap.autoUpdate;
      r.shadowMap.autoUpdate = false;
      const prevRT = r.getRenderTarget();
      r.setRenderTarget(warmRT);
      r.render(ctx.scene, vmCamera);
      r.setRenderTarget(prevRT);
      r.shadowMap.autoUpdate = sm;
      rig.visible = wasVisible;
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
  }

  // ---- hand / part poses -----------------------------------------------------
  // Keyframe lookup helpers read the weapon's view.anim block (weapon_data.js) over
  // ANIM_DEFAULT. Poses are in the BUILD frame and resolved to glTF per frame.
  function animOf(w) {
    const a = (w && w.view && w.view.anim) || {};
    return Object.assign({}, ANIM_DEFAULT, a);
  }

  // Compose the support-hand + part animation for this frame. Returns the gun-level
  // pose deltas (tilt/lift) through `out` and writes the part transforms directly.
  const out = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 };
  const _hp = new THREE.Vector3(), _hq = new THREE.Quaternion();

  function applyHands(group, w, anim, wp, dt, adsEase) {
    const parts = group.userData.parts || {};
    const armL = parts.armL, mag = parts.mag, pump = parts.pump;
    out.px = out.py = out.pz = out.rx = out.ry = out.rz = 0;
    if (!armL) return;

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
    if (dbg.reloadP != null) { reloading = true; p = dbg.reloadP; reloadEmpty = !!dbg.empty; dur = dbg.dur || 2.4; }
    const kind = (dbg.kind || anim.kind);
    reloadKind = kind;
    if (reloading) lastReloadP = p;
    reloadW = damp(reloadW, reloading ? 1 : 0, reloading ? 0.07 : 0.10, dt);
    if (reloadW < 0.002 && !reloading) reloadW = 0;

    // -- rest transforms --------------------------------------------------------
    // start every part at rest; the sections below override what they animate
    armL.node.position.copy(armL.restP);
    armL.node.quaternion.copy(armL.restQ);
    if (mag) { mag.node.position.copy(mag.restP); mag.node.scale.copy(mag.restS); mag.node.visible = true; }
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
      else reloadMag(group, w, anim, parts, pp, rw, kind);
    }

    if (dbg.handL) {      // dev: pin the support hand to an authored pose (tuning screenshots)
      handPose(dbg.handL, _hp, _hq);
      armL.node.position.copy(_hp); armL.node.quaternion.copy(_hq);
    }

    // pump rides on top of everything (it can follow the final reload rack too)
    if (pump && pumpOff > 0) {
      const d = 0.085 * pumpOff;
      pump.node.position.z = pump.restP.z + d;
      armL.node.position.z += d;
    }
  }

  // --- keyframe evaluator ------------------------------------------------------
  // keys: [{ t, P:Vector3, Q:Quaternion }] sorted by t; smoothstep between keys.
  function evalKeys(keys, t, outP, outQ) {
    if (t <= keys[0].t) { outP.copy(keys[0].P); outQ.copy(keys[0].Q); return; }
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (t <= b.t) {
        const s = smoothstep((t - a.t) / Math.max(1e-6, b.t - a.t));
        outP.copy(a.P).lerp(b.P, s);
        outQ.copy(a.Q).slerp(b.Q, s);
        return;
      }
    }
    const l = keys[keys.length - 1];
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
    if (c) return c;
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
      };
    }
    c = {};
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
    // where the magazine's centre sits relative to the palm while it is held
    c.holdOff = new THREE.Vector3(mag ? mag.center.x : 0, mag ? mag.center.y : -0.07, mag ? mag.center.z : -0.12);
    const pm = palmOf(c.mag.p, c.mag.q, new THREE.Vector3());
    c.holdOff.sub(pm);
    c.drop = slide;
    _handCache.set(ck, c);
    return c;
  }
  function dropHandCache(id) { for (const k of [..._handCache.keys()]) if (k.startsWith(id + ":")) _handCache.delete(k); }

  // --- magazine reload (rifles, DMR, and the in-grip magazines of pistol/SMG) -------
  const _palm = new THREE.Vector3();
  function reloadMag(group, w, anim, parts, p, rw, kind) {
    const armL = parts.armL, mag = parts.mag;
    const C = handKeys(group, anim, kind);
    const empty = reloadEmpty;
    const rest = armL.restP, restQ = armL.restQ;
    // timeline (fractions of the sim's reload time; the sim commits at 0.65)
    //   0.00-0.16 hand to the magazine   0.16-0.28 pull it out   0.28-0.44 to the pouch
    //   0.44-0.58 new magazine up        0.58-0.66 push home     (empty) 0.68-0.92 rack
    const ks = [];
    let n = 0;
    ks[n] = key(n, 0.00, rest, restQ); n++;
    ks[n] = key(n, 0.16, C.mag.p, C.mag.q); n++;
    ks[n] = key(n, 0.28, C.magOut.p, C.magOut.q); n++;
    ks[n] = key(n, 0.44, C.pouch.p, C.pouch.q); n++;
    ks[n] = key(n, 0.58, C.magBelow.p, C.magBelow.q); n++;
    ks[n] = key(n, 0.65, C.mag.p, C.mag.q); n++;
    if (empty) {
      ks[n] = key(n, 0.70, C.mag.p, C.mag.q); n++;
      ks[n] = key(n, 0.78, C.rack.p, C.rack.q); n++;
      _p2.copy(C.rack.p); _p2.z += 0.075;            // racking stroke toward the stock
      ks[n] = key(n, 0.85, _p2, C.rack.q); n++;
      ks[n] = key(n, 0.91, C.rack.p, C.rack.q); n++;
      ks[n] = key(n, 1.00, rest, restQ); n++;
    } else {
      ks[n] = key(n, 0.72, C.mag.p, C.mag.q); n++;
      ks[n] = key(n, 0.90, rest, restQ); n++;
      ks[n] = key(n, 1.00, rest, restQ); n++;
    }
    keyPool.length = Math.max(keyPool.length, n);
    const keys = ks.slice(0, n);
    evalKeys(keys, p, _hp, _hq);
    armL.node.position.lerp(_hp, rw);
    armL.node.quaternion.slerp(_hq, rw);

    // gun cant + lift while the hands work
    const cant = ramp(p, 0.0, 0.16) * (1 - ramp(p, empty ? 0.90 : 0.84, 1.0));
    out.rx += anim.tilt[0] * DEG * cant * rw;
    out.ry += anim.tilt[1] * DEG * cant * rw;
    out.rz += anim.tilt[2] * DEG * cant * rw;
    out.px += anim.lift[0] * cant * rw;
    out.py += anim.lift[1] * cant * rw;
    out.pz += (anim.lift[2] + 0.02) * cant * rw;
    // seat jolt as the magazine goes home
    if (p > 0.62 && p < 0.70) {
      const j = Math.sin(Math.PI * (p - 0.62) / 0.08);
      out.py -= 0.010 * j * rw; out.rx -= 2.4 * DEG * j * rw;
    }

    // ---- the magazine node ------------------------------------------------------
    if (mag) {
      const mp = mag.node.position;
      mp.copy(mag.restP);
      mag.node.visible = true;
      const held = (p >= 0.16 && p < 0.30) || (p >= 0.44 && p < 0.66);
      if (held) {
        // carried by the hand: centre = palm + holdOff, relative to rest
        palmOf(_hp, _hq, _palm).add(C.holdOff);
        mp.copy(mag.restP).add(_v.copy(_palm).sub(mag.center));
        // hands are blended with weight rw; keep the magazine on the same blend
        mp.lerp(mag.restP, 1 - rw);
      } else if (p >= 0.30 && p < 0.44) {
        // released: falls away under gravity, then is gone
        const tf = (p - 0.30) / 0.14;
        const tt = tf * 0.5;  // seconds-ish
        palmOf(C.magOut.p, C.magOut.q, _palm).add(C.holdOff);
        mp.copy(mag.restP).add(_v.copy(_palm).sub(mag.center));
        mp.x += -0.06 * tf; mp.y += -4.0 * tt * tt * 2.0; mp.z += 0.04 * tf;
        mag.node.visible = tf < 0.62;
      }
    }
  }

  // --- shell-by-shell reload (pump shotgun) --------------------------------------
  function reloadShell(group, w, anim, parts, p, rw, wp, dt) {
    const armL = parts.armL, pump = parts.pump;
    const rl = (w && w.reload) || { startS: 0.55, perShellS: 0.42, endS: 0.35 };
    const dur = (wp && wp._reloadDur) || (w && w.reloadS) || 3.4;
    const tr = (dbg.reloadP != null ? p * dur : (wp && wp.stateT) || p * dur);
    // Re-sync the per-shell cycle to the sim's own inserts: every time the magazine count rises by
    // exactly one while reloading, that is a shell going in — put the cycle at its 'push' beat
    // (0.70) right then, so hand and ammo counter agree whatever the sim's pacing is.
    if (wp && dbg.reloadP == null) {
      if (prevMag != null && wp.mag === prevMag + 1) { shellT0 = tr - 0.70 * rl.perShellS; }
      prevMag = wp.mag;
      if (tr < 0.05) shellT0 = null;
    }
    const t = tr - (shellT0 != null ? shellT0 : rl.startS);
    const endAt = Math.max(rl.startS + 0.1, dur - rl.endS);
    const C = handKeys(group, anim, "shell");
    const rest = armL.restP, restQ = armL.restQ;

    const tIn = ramp(tr, 0.0, rl.startS);                  // tilt in + hand to the port
    const tOutEnd = ramp(tr, endAt, dur);                  // hand back to the forend
    let towardBand = 0, push = 0;
    if (t > 0 && tr < endAt) {
      const c = (t % rl.perShellS) / rl.perShellS;
      // 0..0.30 at the bandolier -> 0.30..0.62 up to the port -> push 0.62..0.80 -> settle
      towardBand = c < 0.30 ? 1 : 1 - ramp(c, 0.30, 0.62);
      push = c > 0.62 && c < 0.82 ? Math.sin(Math.PI * (c - 0.62) / 0.20) : 0;
    }
    const gunTilt = tIn * (1 - tOutEnd);
    out.rx += anim.tilt[0] * DEG * gunTilt * rw;
    out.ry += anim.tilt[1] * DEG * gunTilt * rw;
    out.rz += anim.tilt[2] * DEG * gunTilt * rw;
    out.px += anim.lift[0] * gunTilt * rw;
    out.py += anim.lift[1] * gunTilt * rw;
    out.pz += (anim.lift[2] + 0.025) * gunTilt * rw;

    _hp.copy(rest); _hq.copy(restQ);
    _hp.lerp(C.port.p, tIn); _hq.slerp(C.port.q, tIn);
    if (t > 0 && tr < endAt) {
      _hp.copy(C.port.p).lerp(C.pouch.p, towardBand);
      _hq.copy(C.port.q).slerp(C.pouch.q, towardBand);
      _hp.y += 0.006 * push;           // glTF y = up
      _hp.z -= 0.016 * push;           // glTF -z = toward the muzzle
    }
    if (tOutEnd > 0) { _hp.lerp(rest, tOutEnd); _hq.slerp(restQ, tOutEnd); }
    armL.node.position.lerp(_hp, rw);
    armL.node.quaternion.slerp(_hq, rw);

    // closing rack: forend + hand stroke back and forward during the end phase
    if (pump && tr > endAt) {
      const re = (tr - endAt) / Math.max(1e-3, dur - endAt);
      const stroke = re < 0.5 ? ramp(re, 0, 0.5) : 1 - ramp(re, 0.5, 1.0);
      pump.node.position.z = pump.restP.z + 0.085 * stroke * rw;
      armL.node.position.z += 0.085 * stroke * rw;
    }
    void dt;
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
      }
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
      swayYaw = damp(swayYaw, Math.max(-maxR, Math.min(maxR, -(dYaw / dt) * gain)), VIEWMODEL.rotLagTau, dt);
      swayPitch = damp(swayPitch, Math.max(-maxR, Math.min(maxR, -(dPitch / dt) * gain)), VIEWMODEL.rotLagTau, dt);
    }
    prevYaw = yawNow; prevPitch = pitchNow;
    scopeS.lagX = swayYaw; scopeS.lagY = swayPitch;

    // -- pose selection ------------------------------------------------------
    const view = (w && w.view) || { posHip: [0.16, -0.18, -0.34], posAds: [0, -0.14, -0.26] };
    // arm/part animation first: it can contribute gun-level cant/lift
    if (current.group) applyHands(current.group, w, animOf(w), wp, dt, adsEase);

    // sprint / slide / mantle weights ease in and out — they used to step
    const sprintTarget = sprintState === "tac" ? 1 : sprintState === "sprint" ? 0.8 : 0;
    sprintBlend = damp(sprintBlend, dbg.sprint != null ? dbg.sprint : sprintTarget,
      (dbg.sprint != null ? dbg.sprint : sprintTarget) > sprintBlend ? 0.11 : 0.09, dt);
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
    }
    if (slideBlend > 0.001) {
      px += -0.02 * slideBlend; py += -0.05 * slideBlend; pz += 0.03 * slideBlend;
      rx += -8 * DEG * slideBlend; ry += 12 * DEG * slideBlend; rz += 14 * DEG * slideBlend;
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
        lowerAmt = switchProg < SWITCH_SWAP
          ? smoothstep(switchProg / SWITCH_SWAP)
          : 1 - smoothstep((switchProg - SWITCH_SWAP) / (1 - SWITCH_SWAP));
      } else if (raiseClock < raiseDur) {
        raiseClock += dt;
        lowerAmt = 1 - smoothstep(Math.min(1, raiseClock / raiseDur));
      }
      if (lowered) lowerAmt = Math.max(lowerAmt, 1);
      if (lowerAmt > 0.001) {
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
    mount.position.set(
      px + lagX + vmBobX,
      py + lagY + vmBobY + breatheY + dipY * 0.6 + K.posY.x,
      pz + lagZ + K.posZ.x,
    );
    mount.rotation.set(
      rx + vmBobRx + breatheRx + swayPitch * (1 - 0.7 * adsEase) + K.rotX.x,
      ry + swayYaw * (1 - 0.7 * adsEase) + K.rotY.x,
      rz + vmBobRz + swayYaw * 0.35 * (1 - adsEase) + K.rotZ.x,
      "YXZ",
    );

    // ---- wrist rig: the hands give against what the gun does ---------------
    {
      const parts = current.group.userData.parts;
      if (parts) {
        const cl = (v) => Math.max(-ARM.maxRad, Math.min(ARM.maxRad, v));
        armRoll = damp(armRoll, cl(-K.rotZ.x * ARM.kickRoll), ARM.tau, dt);
        armPitch = damp(armPitch, cl(-K.rotX.x * ARM.kickPitch), ARM.tau, dt);
        armLead = damp(armLead, cl(-swayYaw * ARM.swayLead), ARM.tau, dt);
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
      if (o == null) { dbg.reloadP = null; dbg.kind = null; dbg.lower = null; dbg.pump = null; dbg.sprint = null; dbg.handL = null; return; }
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
