// core/render/prewarm.js [A6] — compileAsync ×2 + real draws, before the
// boot screen lifts (doctrine §3; ARCH §3.13). Programs are keyed per
// render-target-format variant AND compileAsync alone leaves ANGLE D3D11
// uploads cold (driftwake shadows.js:608, Claude-of-Duty 25/47 wasted
// programs) — so the sequence is:
//   1. bind a scratch HalfFloat RT (same format as post's HDR chain AND
//      reflect's planar/cube targets), compileAsync from TWO poses (the
//      dock vista + the plaza hipfire — Meridian's R10 S3/S1 anchors), and
//      DRAW the whole scene + every fx/viewmodel prewarmable into the RT.
//   2. unbind, compileAsync again for the canvas variant, then run the FULL
//      post chain once via globalThis.__BR_POST_WARM__ (post.js registers
//      it — this signature has no ctx) so bloom + composite programs are
//      inside the baseline too.
// Acceptance: renderer.info.programs delta == 0 during the first firefight
// (perfprobe FAIL gate); baseline ≤ 70 (Part 5). The baseline is printed so
// bootcheck's console dump carries it.
//
// Frozen export: prewarm(renderer, scene, camera, extras) → Promise<{programs}>.

import * as THREE from "three";

// Meridian anchor poses (R10 pose sources; colliders.nodes is not reachable
// from this frozen signature, so the two anchors are transcribed constants —
// dock_spawn ≈ (−38, 1.7, 50) looking at the plaza, plaza_center ≈ (−5, 1.6, 2)
// looking down the neon wall).
const POSES = [
  { pos: [-38, 1.7, 50], look: [-5, 2, 0] },
  { pos: [-5, 1.6, 8], look: [15.4, 5, -6] },
];

// LANE P1 (2026-08-24) — the VIEWMODEL light-set permutation was a prewarm
// hole. three's WebGLRenderer.compile() gathers lights filtered by
// `light.layers.test(camera.layers)` (vendored build :15627), and the vm
// pass renders with a camera on VM_LAYER only (viewmodel.js:213) lit by two
// VM_LAYER-only lights (vmFill/vmKey, :261/:266). Compiling with the MAIN
// camera therefore builds every vm material against the WORLD light counts —
// a program that never runs — and the real vm permutation compiled at first
// draw: measured +5 programs (br_glove, Material_0, 2 unnamed vm maps) on
// the first posed frame, the mid-combat "programs 101→102 / ~920 ms hitch"
// the perf lane recorded at first fx. The value 2 is viewmodel.js's frozen
// VM_LAYER const, duplicated here rather than imported: boot loads modules
// with ?v=N queries, so a bare import would instantiate a SECOND viewmodel
// module (see the dual-instance note in dynres.js).
const VM_LAYER = 2;

export async function prewarm(renderer, scene, camera, extras) {
  const t0 = performance.now();

  // LANE P1 (2026-08-24) — vm.prewarmables() returns [] at boot: viewmodel.js
  // imports weapon_meshes.js BARE while boot.js preloads warden+pike through
  // the ?v-keyed URL — two module instances, and the viewmodel reads the
  // empty one (the settings.js dual-instance footgun, see dynres.js's note).
  // So the weapon prototypes never reached this function through `extras`,
  // and their programs compiled at first equip. Reach the ?v-keyed instance
  // boot ACTUALLY preloaded via our own import.meta query and stage its
  // prototypes ourselves. The runtime vm later renders the OTHER instance's
  // clones, but an identical GLB loads to identical material parameters →
  // identical program cacheKeys → warming these warms those. (The dual
  // instance itself is a boot/viewmodel defect, flagged in the lane report —
  // this keeps prewarm honest either way.)
  let wmProtos = [];
  try {
    const q = new URL(import.meta.url).search || "";
    const wm = await import(`../weapons/weapon_meshes.js${q}`);
    if (wm && typeof wm.loadedPrototypes === "function") {
      wmProtos = wm.loadedPrototypes();
    }
  } catch (e) {
    console.warn("[prewarm] weapon_meshes reach-around failed:", e && e.message);
  }
  extras = [...(extras || []), ...wmProtos];

  // scratch RT — HalfFloat + depth matches every offscreen target we own
  const rt = new THREE.WebGLRenderTarget(256, 256, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
  });

  // stage the extras (fx pools, viewmodel proto, …) in front of the camera,
  // frustumCulled off so the RT draw actually uploads them
  const grp = new THREE.Group();
  grp.name = "prewarm-extras";
  // v2.2: THREE's add() REPARENTS — record each extra's original parent so the
  // finally block can give it back. Without this, fx/vm/weather pool meshes
  // ended up orphaned in the scratch group after boot (A7 needsElsewhere).
  const homes = [];
  for (const o of extras || []) {
    if (o && o.isObject3D) { homes.push([o, o.parent || null]); grp.add(o); }
  }
  grp.traverse((o) => { o.frustumCulled = false; });
  scene.add(grp);

  // save camera state
  const savedPos = camera.position.clone();
  const savedQuat = camera.quaternion.clone();

  const _look = new THREE.Vector3();

  // vm-permutation camera (see the VM_LAYER note above): same pose as the
  // main camera, layers = VM_LAYER only, so the DRAW gathers exactly the
  // lights the real vm pass sees and hits exactly its meshes. The vm pass
  // renders into post's HDR RT at runtime (post.js calls ctx.vmRenderPass
  // inside its RenderPass), so the RT-bound pass is the variant that must
  // exist; no canvas-variant compile is taken for it — that program never
  // runs and would only inflate the baseline.
  const vmCam = camera.clone();
  vmCam.layers.set(VM_LAYER);
  // The weapon prototypes sit on layer 0 until equip() calls setLayersDeep
  // (viewmodel.js:319), so a plain layer-2 draw at boot hits nothing. Stage
  // them on VM_LAYER for the vm sub-pass exactly as equip will, then restore.
  // Protos are the extras carrying weapon_meshes.js's mount offsets — the
  // fx/weather pools deliberately stay OFF layer 2, or their materials would
  // compile a vm-light permutation that never renders.
  const vmProtos = [];
  for (const o of extras || []) {
    if (o && o.isObject3D && o.userData &&
        (o.userData.muzzleOffset || o.userData.ejectOffset)) {
      vmProtos.push(o);
    }
  }
  const vmLayerSaves = [];
  function vmLayersOn() {
    vmLayerSaves.length = 0;
    for (const o of vmProtos) {
      o.traverse((n) => { vmLayerSaves.push([n, n.layers.mask]); n.layers.set(VM_LAYER); });
    }
  }
  function vmLayersOff() {
    for (const [n, mask] of vmLayerSaves) n.layers.mask = mask;
    vmLayerSaves.length = 0;
  }

  try {
    // ---------- pass 1: RT-bound compiles + real draws ----------
    renderer.setRenderTarget(rt);
    for (const p of POSES) {
      camera.position.set(p.pos[0], p.pos[1], p.pos[2]);
      camera.lookAt(_look.set(p.look[0], p.look[1], p.look[2]));
      camera.updateMatrixWorld();
      camera.getWorldDirection(_look);
      grp.position.copy(camera.position).addScaledVector(_look, 2.5);
      grp.updateMatrixWorld();
      try {
        await renderer.compileAsync(scene, camera);
      } catch (e) {
        console.warn("[prewarm] compileAsync (RT) failed:", e && e.message);
      }
      renderer.render(scene, camera); // the draws that warm ANGLE's uploads
      // vm permutation: DRAW (never compileAsync) the VM_LAYER view of the
      // same pose. render() respects mesh layers, so it compiles exactly the
      // vm materials against the vm light set and warms their uploads;
      // compileAsync ignores mesh layers and was measured to compile EVERY
      // world material a second time against the vm lights (+56 programs of
      // permutations that never run).
      vmCam.position.copy(camera.position);
      vmCam.quaternion.copy(camera.quaternion);
      vmCam.updateMatrixWorld();
      vmLayersOn();
      const progsBeforeVm = renderer.info.programs.length;
      renderer.render(scene, vmCam);
      console.log(`[prewarm] vm sub-pass: ${vmProtos.length} protos staged, programs ` +
                  `${progsBeforeVm} -> ${renderer.info.programs.length}`);
      vmLayersOff();
    }
    renderer.setRenderTarget(null);

    // ---------- pass 2: canvas-variant compiles ----------
    for (const p of POSES) {
      camera.position.set(p.pos[0], p.pos[1], p.pos[2]);
      camera.lookAt(_look.set(p.look[0], p.look[1], p.look[2]));
      camera.updateMatrixWorld();
      try {
        await renderer.compileAsync(scene, camera);
      } catch (e) {
        console.warn("[prewarm] compileAsync (canvas) failed:", e && e.message);
      }
    }

    // ---------- pass 3: the full post chain once (bloom + composite) ----------
    if (typeof globalThis.__BR_POST_WARM__ === "function") {
      globalThis.__BR_POST_WARM__();
    } else {
      renderer.render(scene, camera); // stub-post fallback: plain canvas draw
    }
  } finally {
    // restore — extras go back to their original parents (v2.2, see above)
    for (const [o, home] of homes) {
      if (home) home.add(o); else grp.remove(o);
    }
    scene.remove(grp);
    camera.position.copy(savedPos);
    camera.quaternion.copy(savedQuat);
    camera.updateMatrixWorld();
    renderer.setRenderTarget(null);
    rt.dispose();
  }

  const programs = renderer.info.programs ? renderer.info.programs.length : 0;
  const ms = Math.round(performance.now() - t0);
  console.log(`[prewarm] programs baseline: ${programs} (budget <= 70) in ${ms} ms — RT pass + canvas pass + post chain warmed`);
  return { programs };
}
