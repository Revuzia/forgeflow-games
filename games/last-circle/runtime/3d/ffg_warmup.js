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
 *      geometry / instance-buffer upload. The shadow pass gets one
 *      representative caster per depth signature wearing its own depth
 *      material (armDepthVariants below), so EVERY depth program the shared
 *      depth material can derive later is already linked, not just the ones
 *      this frame's draw order happened to derive (Wave 7, lane 7F);
 *   4. restore visibility / counts / culling / LOD / render target / autoClear
 *      exactly (and the representatives' cast flag + depth material), and
 *      schedule a clean shadow refresh.
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

// ── shadow-depth programs: every key, not every draw ────────────────────────────────────────────────
// WHY (Wave 7, lane 7F; measured with _harness: framecheck "sampled frames new programs == 0" failed on Savanna AND on the live
// build 60b854d0, and deepwood failed on drop frame 6): three draws EVERY shadow caster with ONE shared MeshDepthMaterial
// (WebGLShadowMap._depthMaterial) and, before each draw, copies the caster's map / side onto it. A material's program is only
// re-derived from that state when setProgram() sees a flip - instancing or skinning changing between two consecutive draws,
// or a new version - so the depth program a draw gets is decided by the ORDER of the shadow pass: the warm frame (everything
// forced visible, casters in one order) compiled the keys {plain, skinned+map, double-sided+map, ...} its own flips happened
// to derive, and the live pass - a different caster set (cast toggles on districts, loot and bodies, the shadow frustum
// culling, instanced pools that were empty at warm) - flipped at another object and derived (map, front-side, plain), a key
// nothing had compiled: a synchronous link on a drop frame (7 to 25 ms of stall, once per map, at an arbitrary second).
// Every key the shared material can ever derive is a pure function of the CASTER'S OWN signature (instancing, instance colour,
// skinning, morph targets, map / alpha-map uv channel, alpha test, depth side), because getDepthMaterial() writes that
// caster's map / side onto the material right before the draw. So the warm frame gives ONE representative per signature its
// own customDepthMaterial (a session-lived MeshDepthMaterial built exactly like three's: RGBA packing) and draws it in the
// shadow pass: the program for that signature is derived on the first draw of that material, whatever the order, and every
// later flip of the shared material is a program-cache hit. No object keeps the material, no texture stays referenced.
const SHADOW_SIDE = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
const _depthPool = new Map();     // signature -> MeshDepthMaterial. Session-lived and NEVER disposed: it holds the program reference.

function depthSignature(o, m, vsm) {
  const g = o.geometry;
  if (!g) return null;
  const mo = g.morphAttributes || {};
  const morphAttr = mo.position || mo.normal || mo.color;
  const side = (m.shadowSide !== null && m.shadowSide !== undefined) ? m.shadowSide : (vsm ? m.side : SHADOW_SIDE[m.side]);
  return [
    o.isInstancedMesh === true ? (o.instanceColor ? "Ic" : "I") + (o.morphTexture ? "m" : "") : "-",
    o.isBatchedMesh === true ? "B" + (o._colorsTexture ? "c" : "") : "-",
    o.isSkinnedMesh === true ? "S" : "-",
    (mo.position ? "p" : "") + (mo.normal ? "n" : "") + (mo.color ? "k" : "") + (morphAttr ? morphAttr.length : 0),
    m.map ? m.map.channel : -1,
    m.alphaMap ? m.alphaMap.channel : -1,
    m.alphaTest > 0 ? 1 : 0,
    m.displacementMap && m.displacementScale !== 0 ? m.displacementMap.channel : -1,
    side,
  ].join(",");
}

/** Pick one representative caster per depth signature and give it its own depth material for the warm frame.
 *  Call AFTER force() (everything visible, un-culled) and before the one real composer frame. Returns { reps, undo }. */
function armDepthVariants(renderer, scene, camera) {
  const sm = renderer.shadowMap;
  const out = { reps: 0, skipped: 0, undo() {} };
  if (!sm || !sm.enabled) return out;                 // low tier: no shadow pass, no depth programs
  const vsm = sm.type === THREE.VSMShadowMap;
  const reps = new Map();                             // signature -> object (a current caster wins over a toggled-off one)
  scene.traverse((o) => {
    if (o.isMesh !== true || (o.userData && o.userData.isOutline === true)) return;
    if (o.customDepthMaterial !== undefined) return;  // already owns its depth material: nothing is shared
    const m = o.material;
    // a shadow participant: casts now, or is a mesh whose creator toggles it (districts, loot, bodies keep receiveShadow on)
    if (!m || !m.isMaterial || !(o.castShadow === true || o.receiveShadow === true)) return;
    if (Array.isArray(m)) { out.skipped++; return; }  // groups share one customDepthMaterial: left to the live path
    if (m.visible === false) return;
    const sig = depthSignature(o, m, vsm);
    if (sig === null) return;
    const have = reps.get(sig);
    if (!have || (o.castShadow === true && have.castShadow !== true)) reps.set(sig, o);
  });
  // SYNTHETIC COVERAGE (P23 boot, C-GFX "0 programs after the first drop frame on every tier"): a signature no mesh wears
  // at warm time can still appear later - measured once on ULTRA (late_probe 03:07, ashgrid s11): a plain front-side caster
  // with no map ("-,-,-,0,-1,-1,0,-1,1") linked its depth program at t 53.6 s mid-fight; the warm frame had no such caster
  // (a later loot / pile / FX mesh switching its shadow on). The common signature space (instanced or not x map or not x
  // the three depth sides) is small, so every member nobody represents gets a one-triangle stand-in inside the shadow
  // box but OUTSIDE the view frustum: three's shadow pass frustum-tests it against the shadow camera and draws it with the
  // shared depth path; the colour pass culls it, so no colour program is linked for it. (Added after force(), so it keeps
  // frustumCulled = true. three tests an object's layers against the VIEW camera in the shadow pass too, so a private
  // layer cannot hide it from the colour pass alone.)
  const synth = synthDepthReps(scene, camera, vsm, reps);
  const armed = [];
  for (const [sig, o] of reps) {
    let d = _depthPool.get(sig);
    if (!d) { d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); _depthPool.set(sig, d); }   // (no name: it would become the program's SHADER_NAME)
    armed.push({ o, d, cast: o.castShadow });
    o.castShadow = true;
    o.customDepthMaterial = d;
  }
  out.reps = armed.length;
  out.synth = synth.n;
  out.list = armed.map((a) => (a.o.name || a.o.type) + (a.cast === true ? "*" : ""));   // diagnostics: the representative of each signature (* = a current caster)
  out.sigs = [...reps.keys()];                       // diagnostics: the depth signatures this warm frame linked (W._warm.depthSigs)
  out.undo = () => {
    for (const a of armed) {
      a.o.castShadow = a.cast;
      delete a.o.customDepthMaterial;
      // getDepthMaterial() copied the caster's textures onto the pooled material: drop them so a finished match is never held alive
      a.d.map = null; a.d.alphaMap = null; a.d.displacementMap = null;
    }
    synth.undo();
  };
  return out;
}

// the synthetic stand-ins: one shared triangle (with uv, so a map variant is a real draw), one 1x1 texture, session-lived
let _synthGeo = null, _synthTex = null;
const _synthMats = new Map();       // "map|side" -> MeshBasicMaterial (never drawn by a colour pass: view-frustum culled)
function synthDepthReps(scene, camera, vsm, reps) {
  const res = { n: 0, undo() {} };
  const light = (() => { let l = null; scene.traverse((o) => { if (!l && o.isDirectionalLight && o.castShadow) l = o; }); return l; })();
  if (!light || !light.shadow || !light.shadow.camera || !camera || !camera.isCamera) return res;
  if (!_synthGeo) {
    _synthGeo = new THREE.BufferGeometry();
    _synthGeo.setAttribute("position", new THREE.Float32BufferAttribute([-0.05, 0, 0, 0.05, 0, 0, 0, 0.05, 0], 3));
    _synthGeo.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    _synthGeo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
    _synthTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    _synthTex.needsUpdate = true;
  }
  // a spot inside the shadow box (centred on the light's target, half-size = the shadow camera's right) that the view
  // frustum does not contain: the target itself, else half the box out in one of 8 directions (one is always behind the view)
  const sc = light.shadow.camera, half = Math.max(1, Math.abs(sc.right || 10)) * 0.5;
  const tgt = new THREE.Vector3();
  if (light.target) light.target.getWorldPosition(tgt);
  camera.updateMatrixWorld();
  const vf = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const at = new THREE.Vector3();
  let found = false;
  for (let k = -1; k < 8 && !found; k++) {
    at.copy(tgt); at.y += 1;
    if (k >= 0) { at.x += Math.cos(k * Math.PI / 4) * half; at.z += Math.sin(k * Math.PI / 4) * half; }
    found = !vf.containsPoint(at);
  }
  if (!found) return res;
  const sideOf = (s) => (vsm ? s : SHADOW_SIDE[s]);
  const made = [];
  for (const inst of [false, true]) for (const map of [false, true]) for (const side of [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide]) {
    const sig = [inst ? "I" : "-", "-", "-", "0", map ? 0 : -1, -1, 0, -1, sideOf(side)].join(",");
    if (reps.has(sig)) continue;
    const mk = (map ? 1 : 0) + "|" + side;
    let m = _synthMats.get(mk);
    if (!m) { m = new THREE.MeshBasicMaterial({ side, map: map ? _synthTex : null }); _synthMats.set(mk, m); }
    const o = inst ? new THREE.InstancedMesh(_synthGeo, m, 1) : new THREE.Mesh(_synthGeo, m);
    if (inst) { o.setMatrixAt(0, new THREE.Matrix4()); o.instanceMatrix.needsUpdate = true; }
    o.position.copy(at); o.frustumCulled = true; o.castShadow = true; o.receiveShadow = false;
    o.name = "warm-depth-synth";
    scene.add(o); o.updateMatrixWorld(true);
    reps.set(sig, o); made.push(o);
  }
  if (!made.length) return res;
  res.n = made.length;
  res.undo = () => {
    for (const o of made) { if (o.parent) o.parent.remove(o); if (o.isInstancedMesh && o.dispose) o.dispose(); }
  };
  return res;
}

/**
 * @param kernel   Kernel3D (renderer, scene, camera, optional composer)
 * @param opts     { extras?: Object3D[] }
 * @returns stats  { ms, target, forced, extras, skinBounds, depthVariants, programs: {before, afterCompile, afterRender} }
 *                 (depthVariants = depth signatures given their own depth material for the warm frame; absent without a shadow pass)
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
  let dv = null;
  try {
    renderer.autoClear = true;
    if (sm && sm.enabled) sm.needsUpdate = true;    // a real shadow pass even when autoUpdate is off (glide cadence)
    try { dv = armDepthVariants(renderer, scene, camera); stats.depthVariants = dv.reps; stats.depthVariantList = dv.list; stats.depthSigs = dv.sigs; stats.depthSynth = dv.synth; } catch (e) { dv = null; /* an optimisation only */ }
    if (composer) composer.render(0);
    else { renderer.setRenderTarget(null); renderer.render(scene, camera); }
  } finally {
    if (dv) dv.undo();
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
