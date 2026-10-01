/**
 * FFG runtime — 3d/ffg_warmup.js  (ES module)  — contract C7:
 *   await warmup(kernel, { extras: Object3D[] })  ->  stats
 *
 * Port of blocktooth/src/render/warmup.ts:24-69, adapted to the kernel's
 * EffectComposer and to a render loop that keeps running while a match loads.
 *
 * WHY: three r172 keys a program on the render TARGET — an RT-bound draw gets
 * linear output + no tone mapping, the canvas gets sRGB + ACES — and every scene
 * draw in Last Circle goes into the composer's RT (RenderPass), never the canvas.
 * The old warm-up (`renderer.compileAsync(scene, camera)` with the canvas bound,
 * ffg_royale3d.js:444 + fx.js:445) therefore compiled the variant play never
 * uses: measured 3/3 runs, +27 programs linked synchronously on the FIRST drop
 * frame. Shadow-depth variants only link inside a real shadow pass, and the
 * bloom / output programs only on a real composer frame. So:
 *
 *   1. force every object visible (hidden children included), every empty
 *      InstancedMesh to count >= 1, every drawable to frustumCulled = false and
 *      every THREE.LOD to autoUpdate = false, remembering exactly what changed —
 *      so the warm frame draws AND shadow-casts everything, not just what the
 *      loading camera happens to see. `extras` (objects the game creates later:
 *      a chute, LOD1 bodies, FX pools) are parented to the scene for the duration
 *      if they have no parent;
 *   2. compileAsync with the composer's readBuffer bound (the exact RT variant);
 *   3. ONE real composer.render(): shadow-depth programs, bloom + output
 *      programs, the deferred ANGLE link on first draw, and every texture /
 *      geometry / instance-buffer upload;
 *   4. restore visibility / counts / culling / LOD / render target / autoClear
 *      exactly, and schedule a clean shadow refresh.
 *
 * The forced state is only ever held inside SYNCHRONOUS blocks: the program
 * link wait in step 2 runs with the scene restored, so the kernel's live rAF
 * frames (the loading screen keeps rendering) never draw the forced scene.
 * The one warm frame is drawn under the loading overlay; the next live frame
 * overwrites it.
 *
 * Without a composer (bloom never enabled) the same steps run against the canvas.
 */
import * as THREE from "three";

function progCount(renderer) {
  const p = renderer.info && renderer.info.programs;
  return p ? p.length : 0;
}

/** Force the scene into its "draw everything" state. Returns the undo log. */
function force(scene, extras) {
  const forced = [];
  const added = [];
  for (const o of extras) {
    if (!o || !o.isObject3D) continue;
    if (!o.parent) { scene.add(o); added.push(o); }
  }
  scene.traverse((o) => {
    const isHull = !!(o.userData && o.userData.isOutline === true);
    const needCount = o.isInstancedMesh === true && !isHull && o.count === 0 && o.instanceMatrix && o.instanceMatrix.count > 0;
    const isDrawable = o.isMesh === true || o.isPoints === true || o.isLine === true || o.isSprite === true;
    const needCull = isDrawable && !isHull && o.frustumCulled === true;
    const needLod = o.isLOD === true && o.autoUpdate === true;
    if (!o.visible || needCount || needCull || needLod) {
      forced.push({ o, visible: o.visible, count: needCount ? 0 : null, culled: needCull ? true : null, lod: needLod });
      o.visible = true;
      if (needCount) o.count = 1;
      if (needCull) o.frustumCulled = false;
      if (needLod) o.autoUpdate = false;
    }
  });
  return { forced, added };
}

function restore(state) {
  const f = state.forced;
  for (let i = f.length - 1; i >= 0; i--) {
    const r = f[i];
    r.o.visible = r.visible;
    if (r.count !== null) r.o.count = r.count;
    if (r.culled !== null) r.o.frustumCulled = r.culled;
    if (r.lod) r.o.autoUpdate = true;
  }
  for (const o of state.added) if (o.parent) o.parent.remove(o);
}

/**
 * @param kernel   Kernel3D (renderer, scene, camera, optional composer)
 * @param opts     { extras?: Object3D[] }
 * @returns stats  { ms, target, forced, extras, skinBounds, programs: {before, afterCompile, afterRender} }
 */
export async function warmup(kernel, opts) {
  opts = opts || {};
  const renderer = kernel.renderer, scene = kernel.scene, camera = kernel.camera;
  const composer = kernel.composer || null;
  const extras = (opts.extras || []).filter((o) => o && o.isObject3D);
  const t0 = performance.now();
  const stats = { ms: 0, target: composer ? "composer" : "canvas", forced: 0, extras: extras.length, programs: { before: progCount(renderer), afterCompile: 0, afterRender: 0 } };

  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  const sm = renderer.shadowMap;

  // 1 + 2: RT-variant compile. compile() runs synchronously inside compileAsync;
  // only the link-readiness poll is async, and it does not need the forced state.
  let ready;
  let st = force(scene, extras);
  stats.forced = st.forced.length;
  // A SkinnedMesh's bounding sphere is computed LAZILY by three on its first
  // frustum test (Frustum.intersectsObject -> SkinnedMesh.computeBoundingSphere,
  // CPU-skinning every vertex): measured 126-242 ms on the first drop frame. The
  // warm frame below culls nothing, so without this that cost still lands on the
  // first live frame. Pre-pay it here, and only where three would compute it
  // anyway (boundingSphere === null) — a body given a fixed sphere at load keeps it.
  // applyBoneTransform reads bone.matrixWorld, so bring every matrix current
  // first, exactly as render() does before its first frustum test.
  stats.skinBounds = 0;
  scene.updateMatrixWorld();
  scene.traverse((o) => { if (o.isSkinnedMesh === true && o.boundingSphere === null) { o.computeBoundingSphere(); stats.skinBounds++; } });
  try {
    renderer.setRenderTarget(composer ? composer.readBuffer : null);
    ready = renderer.compileAsync ? renderer.compileAsync(scene, camera) : (renderer.compile(scene, camera), Promise.resolve());
  } finally {
    renderer.setRenderTarget(prevTarget);
    restore(st);
  }
  try { await ready; } catch (e) { /* an optimisation only — never block a match start on it */ }
  stats.programs.afterCompile = progCount(renderer);

  // 3: one real frame (synchronous), 4: exact restore.
  st = force(scene, extras);
  try {
    renderer.autoClear = true;
    if (sm && sm.enabled) sm.needsUpdate = true;    // a real shadow pass even when autoUpdate is off (glide cadence)
    if (composer) composer.render(0);
    else { renderer.setRenderTarget(null); renderer.render(scene, camera); }
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
    restore(st);
    // The warm pass left the FORCED casters in the shadow map. With autoUpdate on
    // the next frame redraws it anyway; with a cadence (autoUpdate off) this makes
    // the next live frame refresh it from the real scene instead of up to N frames later.
    if (sm && sm.enabled) sm.needsUpdate = true;
  }
  stats.programs.afterRender = progCount(renderer);
  if (renderer.info && renderer.info.reset) renderer.info.reset();
  stats.ms = Math.round((performance.now() - t0) * 10) / 10;
  if (kernel.prof && kernel.prof.enabled) {
    kernel.prof.annotate("warmup +" + (stats.programs.afterRender - stats.programs.before) + " programs " + stats.ms + "ms");
    kernel.prof.resync();
  }
  kernel.lastWarmup = stats;
  return stats;
}

export default warmup;
// Referenced so the import is not flagged unused; also lets a probe confirm the
// module shares the page's three instance (same importmap URL).
export const THREE_REVISION = THREE.REVISION;
