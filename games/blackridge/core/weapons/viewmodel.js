// core/weapons/viewmodel.js [A4] — arms+gun rig: sway, bob, ADS spring
// layers, kick, muzzle/eject sockets, and the FIRST-PERSON CAMERA RIG.
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
// target) and `ctx.vmCamera`. A6's post.js should call ctx.vmRenderPass(
// renderer) immediately after its world scene pass — inside the HDR target,
// before bloom/composite — and call ctx.claimVmPass() once at construction.
// INTERIM AUTO-PASS: until a post implementation claims the pass, a sentinel
// object's onAfterRender runs the same nested render at the end of the
// default-framebuffer scene pass (three supports nested render via its state
// stacks), so the gun is visible even against A0's stub post. The sentinel
// only fires on the DEFAULT framebuffer (render-target passes — planar
// reflection, HDR chains — never get an un-claimed vm pass drawn into them).
// LIGHT LAYERS (A6): pool lights must enable VM_LAYER (light.layers
// .enableAll() at pool creation) or the vm camera collects zero lights and
// the gun renders black — flagged in needsElsewhere.
//
// CAMERA RIG OWNERSHIP: no other lane drives the world camera from sim state
// (verified: boot sets it once at (0,1.7,0)). This module owns the
// first-person camera per architecture §3.4 ("the camera renders from sim
// state plus view-only bob/kick offsets") and combat_spec §1.3/§1.4/§1.6/
// §1.7/§2.4: eye heights + 140 ms crouch lerp, slide eye 0.90 m + 2.5° roll
// + FOV +4°, head-bob (camera share, bob slider applies here only), landing
// dips, ADS/sprint FOV kinetics, §2.6 ADS sway + Corvus breath hold applied
// DIFFERENTIALLY (render-rotation offsets only — input.state is never
// written by this module; recoil.js owns aim writes through input.addLook).
// The rig only drives while: vm visible AND !ctx.cameraDetached AND the
// mission phase is live AND the player is alive. A11's detached scenarios
// (S9, menu framings) set ctx.cameraDetached = true (flagged) or call
// vm.setVisible(false); either releases the camera completely.

import * as THREE from "three";
import { WEAPONS, SWAY, VIEWMODEL, FEEL } from "./weapon_data.js";
import { loadWeaponGLB, loadedPrototypes } from "./weapon_meshes.js";

export const VM_LAYER = 2;

const DEG = Math.PI / 180;
const LIVE_PHASES = new Set(["infil", "assault", "exfil"]);

// §1.6 head-bob table — camera-share amplitudes (m) and vertical freqs (Hz).
// Viewmodel bob = camera numbers × 2.3. Lateral runs at half the vertical
// frequency (the table's lateral rows), amplitude column 3.
const BOB = {
  walk:   { v: 0.0048, hz: 2.1, l: 0.0027 },
  sprint: { v: 0.0084, hz: 2.6, l: 0.0042, roll: 0.4 * DEG, rollHz: 1.3 },
  tac:    { v: 0.0100, hz: 2.9, l: 0.0050, roll: 0.5 * DEG, rollHz: 1.45 },
  crouch: { v: 0.0030, hz: 1.5, l: 0.0018 },
};

const EYE_STAND = 1.62, EYE_CROUCH = 1.10, EYE_SLIDE = 0.90; // §1.3/§1.4

// ===== FIRE RESPONSE (combat_spec §2.3, VT §5 layer 6, VT §7) ==============
// iter05 measurement, live build, C1 pose, Warden, 12 rounds of auto (probe
// sampled every rAF): mount.rotation.x peaked at 0.020-0.028 rad (1.1-1.6°)
// and sat at 0.009-0.015 rad (0.5-0.9°) at the ticks C1 actually photographs
// (240, 269); camera.rotation.z was EXACTLY 0 on every frame; camera.fov was
// EXACTLY 74.000 on every frame. Two of the four channels the scorecard names
// (roll, FOV) were not implemented at all, and the two that were had decayed
// to a fifth of their peak by capture time — which is why 3/3 critics read
// "no weapon kick, no camera pitch, no roll, no FOV change" off a filmstrip
// whose manifest proves rounds were leaving the barrel.
//
// ROOT CAUSE of the invisibility (not the amplitudes alone): a shot was
// SETTING a value that then decayed to zero — `damp(rotPunch, 0, 0.07)`
// (τ 70 ms) and `punchT -= 6·dt` (0.75 units gone in 125 ms, exactly one
// 750-rpm shot interval). A set-then-decay term is at its maximum for one
// frame and near zero for the rest, so an arbitrarily-sampled frame almost
// never catches it, and sustained fire never accumulates.
//
// FIX: every channel is an under-damped SPRING that a round IMPULSES (adds
// velocity to), integrated every frame. Three consequences, all wanted:
//   1. a single shot peaks inside VT §5.6's per-shot envelope (translation
//      back 8-15 mm, rotation up 1-3°);
//   2. sustained auto fire ACCUMULATES — 8 impulses/s into a 0.45 s-period
//      spring settles at a HELD displacement, exactly as a real spring-mass
//      under repeated impulses does — so EVERY frame inside a burst reads as
//      displaced, not just the one frame after a round;
//   3. the return overshoots slightly and settles over ~0.5 s, so frames
//      after the burst read as RECOVERING rather than as a different still.
// Aim is untouched: these are render-only offsets on the camera (the same
// differential seam §2.6 sway uses). input.state is written only by
// recoil.js — the climb the player fights stays the spec'd one, so a punchy
// burst costs no aimability.
const KICK = {
  omega: 14.0, zeta: 0.50,        // viewmodel spring: period 0.45 s, settles ~0.6 s
  camOmega: 16.0, camZeta: 0.55,  // camera spring: faster, tighter
  // impulses are per unit of the weapon's recoil.vmKick / vmPunch, so all
  // four weapons scale off the numbers already in weapon_data.js
  rotXPerKick: 0.364,   // rad/s of pitch-up  (Warden 3.2 -> 3.0° single-shot peak)
  rotZPerKick: 0.260,   // rad/s of roll, sign alternates per round
  rotYPerKick: 0.119,   // rad/s of yaw, sign alternates opposite the roll
  posYPerKick: 0.069,   // m/s of rise
  posZPerPunch: 0.444,  // m/s back along the barrel (Warden 0.75 -> 15 mm peak)
  camPitchPerKick: 0.250, // rad/s of view-only camera pitch punch
  camRollPerKick: 0.140,  // rad/s of view-only camera roll, alternating
  camYawPerKick: 0.075,   // rad/s of view-only camera yaw, alternating
  fovPerKick: 15.0,       // deg/s of FOV punch
  // caps — the linear spring is self-limiting, these only guard a hitch
  maxRotX: 0.16, maxRotZ: 0.075, maxRotY: 0.045,
  maxPosY: 0.035, maxPosZ: 0.070,
  maxCamPitch: 0.060, maxCamRoll: 0.032, maxCamYaw: 0.026, maxFov: 3.0,
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
function smoothstep(t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }

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

  // ---- VM FILL RIG (iter01 F2 fix) -----------------------------------------
  // The blue-hour scene's ambient floor is (correctly) near zero — VT §1
  // demands darkness — but that left the gun a BLACK CUTOUT at night (iter01
  // S1 "shattered black polygon soup" / S2 "no viewmodel visible": the
  // camera-facing surfaces collected ~no light; a 3.4× albedo lift changed
  // nothing, verified by capture). The viewmodel is ~30% of every frame and
  // MUST read (VT §5) — CoD ships a dedicated viewmodel lighting rig for
  // exactly this reason. Two lights on VM_LAYER ONLY: camera layer masks
  // filter light collection, so the WORLD pass never sees them and the
  // world's key:ambient discipline (VT §1 ≥4:1) is untouched. Created ONCE
  // at boot, always visible, constant intensity, never added/removed after
  // — doctrine §3 compliant (light COUNT is a shader-permutation key; the
  // boot prewarm's vm pass compiles this permutation before frame 1).
  //
  // W1 (iter03) LEVEL FIX — the rig was ~15x too hot and THAT is what made the
  // viewmodel a white blob, not the geometry (the geometry defect was the torn
  // arm chunks; fixed in a4_build_fp_weapons.py). Two numbers were wrong:
  //   * the point light. decay 2 means irradiance = intensity / d^2, and the
  //     gun sits 0.30-0.35 m from the camera, so d^2 ~= 0.10: intensity 0.5
  //     delivered ~5 units at the receiver. The WORLD pool delivers ~3.2 total
  //     (moon 3.8 x lum(#a8c0e0) 0.51 + hemi 8.0 x lum(#5c7290) 0.164,
  //     lighting.js) — and that is across a whole night street, most of it at
  //     grazing incidence. The viewmodel was taking a full-strength key at
  //     point-blank range while post.js reports an AgX night frame living in
  //     [0.004 .. 0.06]; the gun measured ~0.75 there, and post's above-pivot
  //     contrast gain then finished the job by pushing it to paper white.
  //   * the hemisphere sky tint #9db4d6 is luminance ~0.68 — it was carrying
  //     level as well as colour. Tint at unit-ish luminance, intensity is the
  //     level knob (the same discipline lighting.js's W2 exposure fix imposed
  //     on the world pool).
  // Levels are expressed against the vm key distance so the intent survives:
  // VM_KEY_D is the working distance, VM_KEY_E the irradiance we want there.
  const VM_KEY_D = 0.42;              // m, light -> receiver at the hip pose
  const VM_KEY_E = 1.15;              // irradiance at VM_KEY_D (world pool ~3.2)
  const vmFill = new THREE.HemisphereLight(0x8fa6c4, 0x2a2420, 0.55);
  vmFill.name = "__vm_fill__";
  vmFill.layers.set(VM_LAYER);        // NOT enableAll — vm pass only
  ctx.scene.add(vmFill);              // scene-parented: hemi axis stays world-up
  const vmKey = new THREE.PointLight(0xc8d6ea, VM_KEY_E * VM_KEY_D * VM_KEY_D, 3.5, 2);
  vmKey.name = "__vm_key__";
  vmKey.position.set(0.38, 0.30, 0.25); // camera-space: over the right shoulder
  vmKey.layers.set(VM_LAYER);
  camera.add(vmKey);

  // ---- state ---------------------------------------------------------------
  let visible = true;
  let current = null;        // { id, w, group }
  let equipEpoch = 0;
  let raiseClock = Infinity; // seconds since last equip swap (raise anim)

  // camera rig
  let eyeH = EYE_STAND;
  let bobPhase = 0, bobAmpV = 0, bobAmpL = 0, bobRollAmp = 0;
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

  const _v = new THREE.Vector3();
  const _q = new THREE.Quaternion();

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
    renderer.clearDepth();                 // R8: viewmodel never clips
    renderer.render(ctx.scene, vmCamera);
    renderer.shadowMap.autoUpdate = sm;
    inPass = false;
  }
  ctx.vmRenderPass = vmRenderPass;
  ctx.claimVmPass = () => { claimed = true; };

  // Interim auto-pass sentinel: fires at the end of any DEFAULT-framebuffer
  // scene render until a real post chain claims the pass. colorWrite=false,
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
    // Fire ONLY for the world camera's scene pass — this includes a post
    // chain's HDR render (the gun then gets bloom/grade like everything
    // else) but excludes planar-reflection, env-bake, and any other camera's
    // pass (shadow passes never invoke these hooks at all).
    if (cam !== ctx.camera) return;
    vmRenderPass(renderer);
  };
  ctx.scene.add(sentinel);

  // ---- resize ---------------------------------------------------------------
  window.addEventListener("resize", () => {
    vmCamera.aspect = window.innerWidth / window.innerHeight;
    vmCamera.updateProjectionMatrix();
  });

  // ---- equip ----------------------------------------------------------------
  async function equip(weaponId) {
    const tok = ++equipEpoch;
    const proto = await loadWeaponGLB(weaponId);
    if (tok !== equipEpoch) return; // superseded mid-await
    if (current && current.group && current.group.parent === mount) {
      mount.remove(current.group);
    }
    setLayersDeep(proto);
    mount.add(proto);
    current = { id: weaponId, w: WEAPONS[weaponId] || null, group: proto };
    raiseClock = 0;
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
  }

  function kick(weaponId) {
    const w = WEAPONS[weaponId];
    if (!w || !w.recoil) return;
    let n = 1;
    // dedup impactOnly/pen replays via the fire-time-only shotsFired counter
    try {
      const sim = ctx.sim && ctx.sim();
      const c = sim && sim.state && sim.state.counters;
      if (c) {
        if (lastShotsFired == null) lastShotsFired = Math.max(0, c.shotsFired - 1);
        n = c.shotsFired - lastShotsFired;
        lastShotsFired = c.shotsFired;
        if (n <= 0) return;
        n = Math.min(n, 4); // batched fire events under a hitch — never lose one
      }
    } catch (e) { /* fall through — kick anyway */ }
    const wp = (() => {
      try { const s = ctx.sim && ctx.sim(); return s && s.state && s.state.player && s.state.player.weapon; }
      catch (e) { return null; }
    })();
    const adsEase = smoothstep(wp ? (wp.adsT || 0) : 0);
    for (let i = 0; i < n; i++) impulse(w, adsEase);
  }

  // ---- update ---------------------------------------------------------------
  function update(dt) {
    if (!(dt > 0)) dt = 1 / 60;
    const S = ctx.settings;
    const sim = ctx.sim && ctx.sim();
    const st = sim && sim.state;
    const p = st && st.player;
    const m = (p && p._m) || {};
    const input = ctx.input;

    // -- auto-equip: mirror the sim's held weapon (switch timing is sim's) --
    if (p && p.weapon && p.weapon.id && (!current || current.id !== p.weapon.id)) {
      equip(p.weapon.id);
    }
    const w = current && current.w;
    const wp = p && p.weapon;

    const driving = visible && !ctx.cameraDetached && p && p.alive &&
      st && LIVE_PHASES.has(st.phase);

    // -- fire-response springs: integrated EVERY frame, before anything reads
    // them, and before the `!rig.visible` early-out below — a spring that only
    // ticks while the rig draws would freeze mid-kick across a hidden frame.
    // Sub-stepped at 120 Hz so a hitch cannot blow the integrator up.
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
    }

    // ================= CAMERA RIG =================
    let rollOut = 0;
    let camSwayYaw = 0, camSwayPitch = 0;
    const speedNorm = p ? (p.speedNorm || 0) : 0;
    const sprintState = m.sprintState || "none";
    const sliding = !!m.sliding;
    const adsT = wp ? (wp.adsT || 0) : 0;
    const adsEase = smoothstep(adsT);

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
      if (moving && stateRow) bobPhase += 2 * Math.PI * stateRow.hz * dt;
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
      if (adsFull && w) {
        const id = current.id;
        let amp = (SWAY.adsAmpDeg[id] != null ? SWAY.adsAmpDeg[id] : 0.03) * DEG;
        const movingMult = id === "corvus" ? SWAY.corvusMovingMult : SWAY.movingMult;
        if (speedNorm > 0.03) amp *= movingMult;
        // settle: ×2 → ×1 over FEEL.adsSettleS after ADS completes
        if (settleClock < FEEL.adsSettleS) {
          amp *= FEEL.adsSettleAmpMult - (FEEL.adsSettleAmpMult - 1) * (settleClock / FEEL.adsSettleS);
        }
        // breath hold (Corvus scope): Shift while scoped
        if (id === "corvus") {
          const holding = !!input.state.sprint && breathMeter > 0 && !winded;
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

      // position + rotation
      camera.position.set(
        p.pos[0] + camBobX * Math.cos(input.state.yaw),
        p.pos[1] + eyeH + camBobY + dipY,
        p.pos[2] - camBobX * Math.sin(input.state.yaw),
      );
      // VT §7 fire response, camera share: pitch punch + roll + yaw, all
      // RENDER-ONLY (input.state is recoil.js's alone), so the burst reads as
      // physical without stealing a degree of aim from the player.
      camera.rotation.set(
        input.state.pitch + camSwayPitch + K.camP.x,
        input.state.yaw + camSwayYaw + K.camY.x,
        rollOut + K.camR.x, "YXZ",
      );

      // FOV kinetics (§1.4, §2.4, VT §7): base → adsFov by eased adsT,
      // sprint +5 (tac +7) over 0.25 s, slide +4 (0.12 in / 0.2 out)
      const base = (S && S.fov) || 74;
      const adsFovTarget = w ? w.adsFov : base;
      const fovAim = base + (adsFovTarget - base) * adsEase;
      fovSprint = damp(fovSprint,
        sprintState === "tac" ? 7 : sprintState === "sprint" ? 5 : 0, 0.12, dt);
      fovSlide = damp(fovSlide, sliding ? 4 : 0, sliding ? 0.06 : 0.1, dt);
      const fov = fovAim + fovSprint + fovSlide + K.fov.x;
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }

      // VT §5 layer 4: "world FOV -15 to -20 deg, VIEWMODEL FOV TIGHTENS".
      // W1 (iter05): the vm camera was pinned at VIEWMODEL.fovDeg forever, so
      // ADS zoomed the WORLD and left the weapon at hip scale — which is why
      // the corvus optic occupied ~21% of frame height in an ADS frame that is
      // supposed to be a sight picture, and why S2 read as "more receiver than
      // scope". Hold the vm:world FOV RATIO instead of the vm FOV: the gun
      // keeps exactly the apparent size relative to the world it has at the
      // hip, and the magnification an optic implies (Corvus 74 -> 34 = 2.2x)
      // reaches the thing the player is looking through. Iron sights barely
      // move (74 -> 55 = 1.35x), which is correct — they are 1x.
      const vmFov = VIEWMODEL.fovDeg * (fovAim / Math.max(1, base));
      if (Math.abs(vmCamera.fov - vmFov) > 0.01) {
        vmCamera.fov = vmFov;
        vmCamera.updateProjectionMatrix();
      }
    }

    // ================= VIEWMODEL LAYERS =================
    // hidden outside live mission phases (no gun floating behind the menu)
    rig.visible = visible && !!current && !ctx.cameraDetached &&
      !!st && LIVE_PHASES.has(st.phase);
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

    // -- pose selection ------------------------------------------------------
    const view = (w && w.view) || { posHip: [0.16, -0.18, -0.34], posAds: [0, -0.14, -0.26] };
    let px = view.posHip[0] + (view.posAds[0] - view.posHip[0]) * adsEase;
    let py = view.posHip[1] + (view.posAds[1] - view.posHip[1]) * adsEase;
    let pz = view.posHip[2] + (view.posAds[2] - view.posHip[2]) * adsEase;
    // W1 (iter03) HIP REAR STANDOFF: weapon_meshes.js measures how far this
    // prototype's rearmost vertex has to move to stop being inside the eye at
    // the hip pose (warden's butt pad sat 9.4 cm from the camera and filled the
    // frame with macro-range receiver facets — the iter01-03 "shattered white
    // polygon" read). Hip only: at full ADS the push is 0, because the sight
    // picture is the subject and a pushed-back weapon shrinks it.
    if (current.group && current.group.userData.hipPush) {
      pz -= current.group.userData.hipPush * (1 - adsEase);
    }
    let rx = 0, ry = 0, rz = 0;

    const sprintBlend = sprintState === "tac" ? 1 : sprintState === "sprint" ? 0.7 : 0;
    if (sprintBlend > 0) {
      // §1.1/VT §5: sprint = canted low; tac = across the chest
      px += (-0.045 - 0.03 * sprintBlend) * sprintBlend;
      py += -0.075 * sprintBlend;
      pz += 0.06 * sprintBlend;
      rx += -18 * DEG * sprintBlend;
      ry += 22 * DEG * sprintBlend;
      rz += -14 * DEG * sprintBlend;
    }

    // mantle: weapon lowered hard (§1.5), raise handled by mantleRaiseUntil
    if (m.mantle) {
      py += -0.16; pz += 0.07; rx += -35 * DEG; rz += 10 * DEG;
    }

    // reload / switch dips driven by the sim's own state machine + timers
    if (wp && wp.state === "reloading" && w) {
      const dur = wp._reloadDur || w.reloadS || 2;
      const prog = Math.min(1, (wp.stateT || 0) / dur);
      const env = prog < 0.15 ? smoothstep(prog / 0.15)
        : prog > 0.85 ? 1 - smoothstep((prog - 0.85) / 0.15) : 1;
      py += -0.055 * env;
      pz += 0.02 * env;
      rx += -16 * DEG * env;
      rz += 9 * DEG * env;
      // commit twitch at 65% (mag seats — RELOAD_MODEL.commitFraction)
      const c = Math.abs(prog - 0.65);
      if (c < 0.05) py += -0.008 * (1 - c / 0.05);
    } else if (wp && wp.state === "switching" && w) {
      const dur = wp._switchDur || w.switchS || 0.45;
      const prog = Math.min(1, (wp.stateT || 0) / dur);
      const env = Math.sin(Math.PI * prog); // down then up
      py += -0.14 * env;
      rx += -30 * DEG * env;
    }

    // equip raise (just after the mesh swap)
    if (raiseClock < ((w && w.raiseS) || 0.45)) {
      raiseClock += dt;
      const rp = Math.min(1, raiseClock / ((w && w.raiseS) || 0.45));
      const env = 1 - smoothstep(rp);
      py += -0.12 * env;
      rx += -25 * DEG * env;
    }

    // vm bob: camera numbers × 2.3, in camera space (not the bob slider)
    const vmBobY = Math.sin(bobPhase) * bobAmpV * 2.3;
    const vmBobX = Math.sin(bobPhase * 0.5) * bobAmpL * 2.3;

    // idle breathe (VT §5 layer 1): ±1.5 mm dual sine
    const breatheY = 0.0015 * (Math.sin(swayT * 2 * Math.PI * 0.32) * 0.7 +
                               Math.sin(swayT * 2 * Math.PI * 0.53 + 1.1) * 0.3);

    // fire response, viewmodel share (springs integrated at the top of update)
    mount.position.set(
      px + lagX + vmBobX,
      py + lagY + vmBobY + breatheY + dipY * 0.6 + K.posY.x,
      pz + lagZ + K.posZ.x,
    );
    mount.rotation.set(
      rx + swayPitch * (1 - 0.7 * adsEase) + K.rotX.x,
      ry + swayYaw * (1 - 0.7 * adsEase) + K.rotY.x,
      rz + swayYaw * 0.35 * (1 - adsEase) + K.rotZ.x,
      "YXZ",
    );
  }

  // ---- sockets ---------------------------------------------------------------
  function muzzleWorld(outVec3) {
    const out = outVec3 || new THREE.Vector3();
    if (current && current.group) {
      const s = current.group.userData.muzzle;
      if (s) { s.updateWorldMatrix(true, false); return s.getWorldPosition(out); }
      const off = current.group.userData.muzzleOffset || [0, 0.05, -0.5];
      out.set(off[0], off[1], off[2]);
      mount.updateWorldMatrix(true, false);
      return mount.localToWorld(out);
    }
    camera.updateWorldMatrix(true, false);
    out.set(0.15, -0.1, -0.6);
    return camera.localToWorld(out);
  }

  // private: shell-ejection world position (A7 casings)
  function ejectWorld(outVec3) {
    const out = outVec3 || new THREE.Vector3();
    if (current && current.group) {
      const s = current.group.userData.eject;
      if (s) { s.updateWorldMatrix(true, false); return s.getWorldPosition(out); }
      const off = current.group.userData.ejectOffset || [0.03, 0.05, -0.1];
      out.set(off[0], off[1], off[2]);
      mount.updateWorldMatrix(true, false);
      return mount.localToWorld(out);
    }
    return muzzleWorld(out);
  }

  return {
    equip,
    update,
    kick,
    muzzleWorld,
    setVisible(on) { visible = !!on; rig.visible = !!on && !!current; },
    prewarmables() {
      // every loaded weapon prototype — their materials must compile during
      // boot prewarm or the first ADS frame hitches (doctrine §3)
      return loadedPrototypes();
    },
    // ---- private extras (not in the frozen surface) -----------------------
    ejectWorld,
    renderPass: vmRenderPass,
    get camera() { return vmCamera; },
    get currentId() { return current ? current.id : null; },
    get _breath() { return { meter: breathMeter, winded }; },
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
