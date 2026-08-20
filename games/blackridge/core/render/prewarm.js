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

export async function prewarm(renderer, scene, camera, extras) {
  const t0 = performance.now();

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
