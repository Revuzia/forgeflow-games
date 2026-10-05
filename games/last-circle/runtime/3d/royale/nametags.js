import * as THREE from "three";

/** ── NAME TAGS — every tag in the match in ONE draw ─────────────────────────
 *
 *  Each actor used to own a THREE.Sprite with its own 256x48 CanvasTexture and
 *  SpriteMaterial: one draw call, one texture upload and one material per tag
 *  (measured: 49 nametag calls in the drop cluster, and +10 leaked canvas
 *  textures per rematch in the Stage-0 census). Now:
 *
 *    - ONE atlas canvas (1024 x 1024 = 64 cells of 256 x 64). A tag is drawn
 *      into its cell exactly as the old sprite canvas drew it (same pill, font,
 *      colours, human/bot styling), inside an 8 px transparent margin so mip
 *      levels do not bleed one name into the next.
 *    - ONE InstancedMesh of unit quads with a MeshBasicMaterial patched into a
 *      camera-facing billboard (same world size as the old sprite: 2.6 x 0.49 m,
 *      2.25 m above the actor's feet). A per-instance attribute picks the cell.
 *    - Instances are packed back-to-front every render (the transparent sort the
 *      per-sprite path used to get from three for free).
 *
 *  The caller owns the visibility RULES (player.js update); this module only
 *  draws what `handle.visible` says, at the actor's current transform. Packing
 *  runs from a scene.onBeforeRender hook installed by player.js, i.e. after
 *  three's matrix update and before its culling, so the instance buffer that is
 *  drawn is always this frame's.
 *
 *  Lifetime: the mesh, geometry, material, canvas and texture are created once
 *  per session and reused by every match (nothing per match to leak). Each
 *  match clears the atlas and redraws its roster; disposeMatch releases the GPU
 *  copy of the atlas (re-uploaded by the next match's first draw). */

export const NAME = "actor-nametag";
const CELL_W = 256, CELL_H = 64, COLS = 4, ROWS = 16;
const ATLAS_W = CELL_W * COLS, ATLAS_H = CELL_H * ROWS;
const MARGIN = 8;                       // transparent rows above/below the 48 px tag band
const MAX = COLS * ROWS;                // 64 >= 50 actors + 5 range dummies
const TAG_W = 2.6, TAG_H = 0.49, TAG_Y = 2.25;

let S = null;

function ensure() {
  if (S) return S;
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_W; canvas.height = ATLAS_H;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(1, 1);
  const cellAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
  cellAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("aCell", cellAttr);
  // fog / tone mapping / colour space exactly like the SpriteMaterial it
  // replaces (both are unlit "basic" shading); alphaTest keeps the transparent
  // margins out of the depth buffer.
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: true, alphaTest: 0.01 });
  mat.customProgramCacheKey = () => "lcNameTagBillboard";
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = "attribute vec4 aCell;\n" + sh.vertexShader
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n  vMapUv = aCell.xy + uv * aCell.zw;")
      .replace("#include <project_vertex>",
        // billboard: the instance translation is the tag anchor, the instance
        // scale its world size; the quad is expanded in VIEW space so it always
        // faces the camera (what THREE.Sprite does), never rolls with the body
        "vec4 mvPosition = modelViewMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 );\n" +
        "  mvPosition.xy += position.xy * vec2( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 1 ].xyz ) );\n" +
        "  gl_Position = projectionMatrix * mvPosition;");
  };
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.name = NAME;
  mesh.count = 0;
  mesh.visible = false;
  mesh.frustumCulled = false;            // instances are anywhere; three's instanced bounds would go stale
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  S = {
    canvas, ctx, tex, geo, mat, mesh, cellAttr,
    handles: [], free: [], order: [], key: new Float32Array(MAX),
    dirty: false, uploaded: false,
    m: new THREE.Matrix4(), v: new THREE.Vector3(), cam: new THREE.Vector3(),
  };
  for (let i = MAX - 1; i >= 0; i--) S.free.push(i);
  return S;
}

/** Start of a match: forget every handle, clear the atlas, park the mesh under
 *  `parent` (the actors group — cleared by the orchestrator between matches). */
export function beginMatch(parent) {
  const s = ensure();
  for (const h of s.handles) h.cell = -1;
  s.handles.length = 0;
  s.free.length = 0;
  for (let i = MAX - 1; i >= 0; i--) s.free.push(i);
  s.ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);
  s.dirty = true;
  s.mesh.count = 0;
  s.mesh.visible = false;
  if (parent && s.mesh.parent !== parent) parent.add(s.mesh);
  return s.mesh;
}

/** Bake `name` into a free cell and return the tag handle the actor keeps as
 *  `a.nameTag` ({ visible, cell, actor }). null when the atlas is full (only
 *  possible beyond 64 tagged actors — that actor simply has no tag). */
export function addTag(actor, name, human) {
  const s = ensure();
  if (!s.free.length) return null;
  const cell = s.free.pop();
  drawCell(s, cell, String(name == null ? "" : name), !!human);
  const h = { visible: false, cell, actor };
  s.handles.push(h);
  return h;
}

/** Give a cell back (actor removed mid-match). */
export function releaseTag(h) {
  if (!S || !h || h.cell < 0) return;
  const i = S.handles.indexOf(h);
  if (i >= 0) S.handles.splice(i, 1);
  const x = (h.cell % COLS) * CELL_W, y = Math.floor(h.cell / COLS) * CELL_H;
  S.ctx.clearRect(x, y, CELL_W, CELL_H);
  S.free.push(h.cell);
  h.cell = -1; h.visible = false;
  S.dirty = true;
}

function drawCell(s, cell, name, human) {
  const ctx = s.ctx;
  const x0 = (cell % COLS) * CELL_W, y0 = Math.floor(cell / COLS) * CELL_H + MARGIN;
  ctx.save();
  // the old per-tag canvas was 256 wide and clipped a long name at its edges;
  // the atlas must clip at the cell or a long handle would paint into the next
  ctx.beginPath(); ctx.rect(x0, y0 - MARGIN, CELL_W, CELL_H); ctx.clip();
  // Byte-for-byte the old mkNameTag drawing, offset into the cell. Bots carry
  // deliberately human-looking handles, so humans get a blue pill + outline and
  // bots keep the white-on-black pill — that is how a squadmate is told apart
  // from the 46 bots in SQUAD UP.
  ctx.font = "bold 26px system-ui";
  ctx.textAlign = "center";
  ctx.fillStyle = human ? "rgba(6,40,70,0.55)" : "rgba(0,0,0,0.45)";
  const w = Math.min(240, ctx.measureText(name).width + 22);
  ctx.beginPath(); ctx.roundRect(x0 + 128 - w / 2, y0 + 4, w, 38, 8); ctx.fill();
  if (human) { ctx.strokeStyle = "rgba(110,196,255,0.9)"; ctx.lineWidth = 2; ctx.stroke(); }
  ctx.fillStyle = human ? "#8fd8ff" : "#fff";
  ctx.fillText(name, x0 + 128, y0 + 32);
  ctx.restore();
  s.dirty = true;
}

/** Pack the visible tags into the instance buffers, farthest first. Called once
 *  per render (scene.onBeforeRender) and from player.update as a fallback. */
export function refresh(camera) {
  const s = S;
  if (!s || !s.mesh.parent) return 0;
  if (s.dirty) { s.tex.needsUpdate = true; s.dirty = false; }
  const cam = camera ? s.cam.setFromMatrixPosition(camera.matrixWorld) : s.cam.set(0, 0, 0);
  const order = s.order, key = s.key;
  let n = 0;
  for (let i = 0; i < s.handles.length; i++) {
    const h = s.handles[i];
    if (!h.visible || h.cell < 0) continue;
    const o = h.actor && h.actor.obj;
    if (!o || !o.parent) continue;
    const e = o.matrixWorld.elements;
    const dx = e[12] - cam.x, dy = e[13] + TAG_Y - cam.y, dz = e[14] - cam.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    // insertion sort, farthest first (<= 64 entries, no allocation)
    let j = n++;
    while (j > 0 && key[j - 1] < d2) { order[j] = order[j - 1]; key[j] = key[j - 1]; j--; }
    order[j] = h; key[j] = d2;
  }
  const mesh = s.mesh;
  mesh.count = n;
  mesh.visible = n > 0;
  if (!n) return 0;
  // Anchor the mesh at the NEAREST tag so three's transparent sort places the
  // whole batch by its most important member; instances are stored relative.
  const near = order[n - 1].actor.obj.matrixWorld.elements;
  mesh.position.set(near[12], near[13] + TAG_Y, near[14]);
  mesh.updateMatrixWorld(true);
  const im = mesh.instanceMatrix.array, ca = s.cellAttr.array;
  for (let i = 0; i < n; i++) {
    const h = order[i], e = h.actor.obj.matrixWorld.elements, b = i * 16, c = i * 4;
    im[b] = TAG_W; im[b + 1] = 0; im[b + 2] = 0; im[b + 3] = 0;
    im[b + 4] = 0; im[b + 5] = TAG_H; im[b + 6] = 0; im[b + 7] = 0;
    im[b + 8] = 0; im[b + 9] = 0; im[b + 10] = 1; im[b + 11] = 0;
    im[b + 12] = e[12] - mesh.position.x; im[b + 13] = e[13] + TAG_Y - mesh.position.y; im[b + 14] = e[14] - mesh.position.z; im[b + 15] = 1;
    const x0 = (h.cell % COLS) * CELL_W, y0 = Math.floor(h.cell / COLS) * CELL_H + MARGIN;
    // CanvasTexture flipY: canvas row y maps to v = 1 - y / H
    ca[c] = x0 / ATLAS_W; ca[c + 1] = 1 - (y0 + 48) / ATLAS_H; ca[c + 2] = CELL_W / ATLAS_W; ca[c + 3] = 48 / ATLAS_H;
  }
  mesh.instanceMatrix.needsUpdate = true;
  s.cellAttr.needsUpdate = true;
  return n;
}

/** C7 warm-up extra: the tag mesh with one instance parked far below the world,
 *  so the warm frame links its program and uploads the atlas + buffers. The
 *  first real refresh of the match overwrites it. */
export function warmObject() {
  const s = ensure();
  if (s.dirty) { s.tex.needsUpdate = true; s.dirty = false; }
  const im = s.mesh.instanceMatrix.array;
  im.fill(0, 0, 16);
  im[0] = TAG_W; im[5] = TAG_H; im[10] = 1; im[13] = -10000; im[15] = 1;
  s.cellAttr.array.fill(0, 0, 4);
  s.mesh.position.set(0, 0, 0);
  s.mesh.count = 1;
  s.mesh.visible = true;
  s.mesh.instanceMatrix.needsUpdate = true;
  s.cellAttr.needsUpdate = true;
  return s.mesh;
}

/** C8: release this match's tags. The atlas texture's GPU copy is freed (the
 *  object itself is reused, so nothing new is allocated next match). Idempotent. */
export function disposeMatch() {
  if (!S) return { tags: 0 };
  const n = S.handles.length;
  for (const h of S.handles) { h.cell = -1; h.visible = false; }
  S.handles.length = 0;
  S.free.length = 0;
  for (let i = MAX - 1; i >= 0; i--) S.free.push(i);
  S.mesh.count = 0;
  S.mesh.visible = false;
  if (S.mesh.parent) S.mesh.parent.remove(S.mesh);
  S.tex.dispose();
  S.ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);
  S.dirty = true;
  return { tags: n };
}

/** read-back for probes */
export function stats() {
  return S ? { handles: S.handles.length, free: S.free.length, drawn: S.mesh.count, visible: S.mesh.visible, parented: !!S.mesh.parent } : null;
}
