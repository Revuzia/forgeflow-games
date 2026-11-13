() => {
  // probe_citykit.js - the in-page half of citykit_probe.py (Wave 6, lane 6C). Installed once per page as window.__LCKIT__.
  // It builds a THROWAWAY THREE.Scene (own camera, own lights, a flat ground) and draws it with the game's own renderer, so no match has to load
  // and maps.js / W.map are never touched. citykit.js is imported the way Wave 7 will import it (createCityKit({ THREE, kernel, assetBase })),
  // its GLBs go through W.kernel.loadGLTF (the real GLTFLoader + the lazy meshopt decoder), and every number below is read from
  // renderer.info after a REAL render() call, never from the kit's own bookkeeping alone.
  // The page's kernel loop must be stopped first (citykit_probe.py does: s.freeze_loop()), so only these renders touch renderer.info.
  const C = window.__LC__, W = C.W, THREE = W.THREE, K = W.kernel, R = K.renderer;
  const CK_URL = new URL("runtime/3d/royale/citykit.js", W.assetBase).href;
  const MAN_URL = new URL("assets/props/city/manifest.json", W.assetBase).href;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const mulberry32 = (a) => () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let CK = null, MAN = null, S = null;
  async function load() {
    if (!CK) CK = await import(CK_URL);
    if (!MAN) MAN = await (await fetch(MAN_URL, { cache: "no-cache" })).json();
    return CK;
  }

  // ------------------------------------------------------------------ the throwaway scene
  function scene() {
    if (S) return S;
    const sc = new THREE.Scene();
    sc.background = new THREE.Color(0x9cc7e8);
    sc.fog = new THREE.Fog(0xb9d3e6, 500, 3200);
    const hemi = new THREE.HemisphereLight(0xbfdcff, 0x8a8470, 2.6); sc.add(hemi);                 // the game's ambient + IBL is far brighter than three's 1/pi: dim faces read black
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.6); sun.position.set(-300, 500, 200); sun.target.position.set(0, 0, 0);
    sun.castShadow = false; sun.shadow.mapSize.set(2048, 2048);
    const sc2 = sun.shadow.camera; sc2.left = -120; sc2.right = 120; sc2.top = 120; sc2.bottom = -120; sc2.near = 10; sc2.far = 1500;
    sc.add(sun); sc.add(sun.target);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0xb2a98a, roughness: 1, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(600, -0.03, 200); ground.receiveShadow = true; ground.name = "probe-ground";
    sc.add(ground);
    const cam = new THREE.PerspectiveCamera(57, 16 / 9, 0.3, 8000);
    S = { scene: sc, cam, ground, sun, hemi };
    return S;
  }
  function setView(v) {
    const { cam } = scene(), sz = R.getSize(new THREE.Vector2());
    cam.position.set(v.pos[0], v.pos[1], v.pos[2]); cam.up.set(0, 1, 0); cam.lookAt(v.look[0], v.look[1], v.look[2]);
    cam.fov = v.fov || 57; cam.far = v.far || 8000;
    cam.aspect = sz.x / Math.max(1, sz.y); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    return cam;
  }
  const VIEWS = {
    // a third-person street camera in district 0's first street, looking down it (+x)
    street: { pos: [-95, 2.6, -63], look: [60, 6, -63] },
    // the standard drop view: 330 m up over the middle of the six districts, pitched like the glide camera
    drop: { pos: [400, 330, 700], look: [400, 0, 200] },
    // everything in frame (all LODs forced to detail by the caller)
    all: { pos: [400, 1500, 200.1], look: [400, 0, 200] },
    // from the ground 560 m away: the skyline of the downtown district
    skyline: { pos: [800, 12, -600], look: [800, 40, 400] },
    // looking straight up from inside district 0 (its per-type bounding spheres contain the camera: they draw, by design)
    sky: { pos: [-95, 2.6, -63], look: [-95, 400, -63.1] },
    // outside every district (700 m south-west of them) looking away from all of them
    away: { pos: [-700, 2.6, -700], look: [-2700, 2.6, -2700] },
    // outside, looking AT district 0 only: a narrow lens and a 600 m far plane keep the neighbours out of the frustum
    one: { pos: [-420, 20, 0], look: [0, 10, 0], fov: 24, far: 600 },
  };
  function infoNow() { const i = R.info; return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs ? i.programs.length : null }; }
  function render(v, o) {
    o = o || {};
    const s = scene(); setView(typeof v === "string" ? VIEWS[v] : v);
    R.info.reset();
    const kitHidden = o.hideKit ? [] : null;
    if (kitHidden) s.scene.traverse((q) => { if (q.isLOD && q.visible) { q.visible = false; kitHidden.push(q); } });
    const prevShadow = R.shadowMap.enabled;
    if (o.shadows !== undefined) { s.sun.castShadow = !!o.shadows; R.shadowMap.enabled = !!o.shadows; }
    R.setRenderTarget(null);
    R.render(s.scene, s.cam);
    const out = infoNow();
    if (kitHidden) for (const q of kitHidden) q.visible = true;
    if (o.shadows !== undefined) { s.sun.castShadow = false; R.shadowMap.enabled = prevShadow; }
    return out;
  }
  // what the frustum test says SHOULD be drawn: every kit mesh whose ancestors are all visible and whose bounding sphere intersects the camera frustum
  function expectedDrawn() {
    const s = scene(), fr = new THREE.Frustum(), pm = new THREE.Matrix4();
    s.cam.updateMatrixWorld(true);
    pm.multiplyMatrices(s.cam.projectionMatrix, s.cam.matrixWorldInverse); fr.setFromProjectionMatrix(pm);
    let calls = 0, tris = 0;
    const vis = (o) => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
    s.scene.traverse((o) => {
      if (!(o.isMesh && o.name.startsWith("kit:")) || !vis(o)) return;
      if (!fr.intersectsObject(o)) return;
      calls++;
      const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3;
      tris += n * (o.isInstancedMesh ? o.count : 1);
    });
    return { calls, tris };
  }

  // ------------------------------------------------------------------ the 300-building list: 6 districts x 50 buildings
  const DIST = [
    { id: "town:outpost", c: [0, 0], pitch: 30, theme: "city", types: ["suburban/building-type-a", "suburban/building-type-c", "suburban/building-type-e", "suburban/building-type-g", "suburban/building-type-h", "commercial/building-c"] },
    { id: "town:metro", c: [400, 0], pitch: 30, theme: "city", types: ["suburban/building-type-i", "suburban/building-type-m", "suburban/building-type-o", "suburban/building-type-p", "suburban/building-type-q", "commercial/building-a"] },
    { id: "downtown", c: [800, 0], pitch: 40, theme: "city", types: ["skyscraper/building-skyscraper-a", "skyscraper/building-skyscraper-b", "skyscraper/building-skyscraper-c", "skyscraper/building-skyscraper-d", "skyscraper/building-skyscraper-e", "commercial/building-i", "commercial/building-m"] },
    { id: "town:mall", c: [0, 400], pitch: 36, theme: "resort", types: ["commercial/building-a", "commercial/building-c", "commercial/building-f", "commercial/building-h", "commercial/building-e"] },
    { id: "yard", c: [400, 400], pitch: 36, theme: "mill", types: ["commercial/building-e", "commercial/building-c", "suburban/building-type-h"] },
    { id: "farm", c: [800, 400], pitch: 30, theme: "farm", types: ["suburban/building-type-g", "suburban/building-type-h", "suburban/building-type-i", "suburban/building-type-p", "suburban/building-type-q"] },
  ];
  function makeList(seed) {
    const rng = mulberry32(seed || 7), list = [];
    for (const d of DIST) {
      const cols = 8, rows = 7, slots = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) slots.push([c, r]);
      // deterministic shuffle, take 50 of the 56 lots
      for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = slots[i]; slots[i] = slots[j]; slots[j] = t; }
      for (const [c, r] of slots.slice(0, 50)) {
        const x = d.c[0] + (c - (cols - 1) / 2) * d.pitch, z = d.c[1] + (r - (rows - 1) / 2) * d.pitch;
        list.push({ type: d.types[Math.floor(rng() * d.types.length)], x, y: 0, z, rot: Math.floor(rng() * 4), district: d.id });
      }
    }
    return list;
  }
  const THEMES_BY_DISTRICT = () => { const o = {}; for (const d of DIST) o[d.id] = { theme: d.theme }; return o; };
  const flat = (cs) => cs.map((c) => [c.minX, c.maxX, c.minY, c.maxY, c.minZ, c.maxZ]);
  function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, "0"); }
  const mk = (extra) => CK.createCityKit(extra && "W" in extra ? { W } : Object.assign({ THREE, kernel: K, assetBase: W.assetBase }, extra || {}));
  const sceneKit = () => { const n = []; scene().scene.traverse((o) => { if (o.name && o.name.startsWith("kit:")) n.push(o); }); return n; };
  const resourceCount = (re) => performance.getEntriesByType("resource").filter((e) => re.test(e.name)).length;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------------ main run (one kit, the 300-building scene)
  async function main(o) {
    o = o || {};
    await load(); scene();
    const out = { pageUrl: location.href, ckUrl: CK_URL };
    const list = makeList(o.seed || 7);
    out.list = list;
    out.counts = { entries: list.length, districts: new Set(list.map((e) => e.district)).size, types: new Set(list.map((e) => e.type)).size };
    // independent expectations from the manifest (never from the kit)
    const perD = {};
    for (const e of list) (perD[e.district] ||= new Set()).add(e.type);
    out.expect = { callsAll: Object.values(perD).reduce((a, s) => a + [...s].reduce((b, t) => b + (MAN.types[t].materials || 1), 0), 0), districtTypes: Object.fromEntries(Object.entries(perD).map(([k, s]) => [k, s.size])),
      trisAll: list.reduce((a, e) => a + MAN.types[e.type].tris, 0) };
    const base = render("all", { hideKit: true }); out.baseline = base;
    const memBase = infoNow();

    const kit = mk();
    const t0 = performance.now();
    const res = await kit.place(list, { parent: scene().scene, districts: THEMES_BY_DISTRICT() });
    out.placeMs = r3(performance.now() - t0);
    out.res = { meshes: res.meshes.length, colliders: res.colliders.length, skipped: res.skipped.length, failed: res.failed, error: res.error || null, districts: res.districts, inexact: res.inexactEntries };
    out.colliders = flat(res.colliders); out.colliderHash = fnv(JSON.stringify(out.colliders)); out.ranges = Array.from(res.ranges);
    out.colliderKeys = Object.keys(res.colliders[0] || {});
    out.stats0 = kit.stats();

    // A. every LOD forced to detail: draw calls = types x districts, triangles exactly instances x tris
    kit.setFarDistance(1e9);
    const all = render("all"), allG = render("all", { hideKit: true });
    const allK = { calls: all.calls - allG.calls, triangles: all.triangles - allG.triangles };
    out.detailAll = { measured: allK, stats: kit.stats().totals, expectCalls: out.expect.callsAll, expectTris: out.expect.trisAll, drawn: expectedDrawn() };
    // B. LOD at the default 250 m: which districts collapse from the drop camera and from the street
    kit.setFarDistance(250);
    const lodRows = (view) => {
      const cam = setView(VIEWS[view]); const rows = [];
      scene().scene.traverse((q) => {
        if (!q.isLOD || !q.name.startsWith("kit:")) return;
        const far = q.levels[1] ? q.levels[1].object : null, wasFar = far ? far.visible : false;
        rows.push({ id: q.name.slice(4), dist: r3(q.getWorldPosition(new THREE.Vector3()).distanceTo(cam.position)), thr: q.levels[1] ? q.levels[1].distance : null, wasFar });
      });
      return rows;
    };
    for (const view of ["drop", "street", "skyline"]) {
      // a fresh start for the hysteresis: all detail
      scene().scene.traverse((q) => { if (q.isLOD && q.levels[1]) { q.levels[1].object.visible = false; q.levels[0].object.visible = true; } });
      const pre = lodRows(view);
      const m = render(view);
      const hideOnly = render(view, { hideKit: true });
      const st = kit.stats();
      const post = []; scene().scene.traverse((q) => { if (q.isLOD && q.name.startsWith("kit:")) post.push({ id: q.name.slice(4), far: q.levels[1] ? q.levels[1].object.visible : false }); });
      out["lod_" + view] = { pre, post, measuredKitCalls: m.calls - hideOnly.calls, measuredKitTris: m.triangles - hideOnly.triangles, stats: st.totals, statsRows: Object.fromEntries(Object.entries(st.districts).map(([k, d]) => [k, { lod: d.lod, detailCalls: d.detailDrawCalls, proxyCalls: d.proxyDrawCalls, radius: r3(d.radius), centre: d.centre.map(r3) }])), drawn: expectedDrawn() };
    }
    // B2. hysteresis: a collapsed district stays collapsed until the camera is 4 % inside the threshold, and a detailed one collapses only AT it
    {
      const hy = [];
      scene().scene.traverse((q) => { if (q.isLOD && q.name === "kit:town:outpost") hy.push(q); });
      const lod = hy[0];
      if (!lod || !lod.levels[1]) { out.hysteresis = null; } else {
      const thr = lod.levels[1].distance, c = lod.getWorldPosition(new THREE.Vector3());
      const at = (f, startFar) => {
        lod.levels[1].object.visible = startFar; lod.levels[0].object.visible = !startFar;
        const d = thr * f; render({ pos: [c.x - d, c.y, c.z], look: [c.x, c.y, c.z] });
        return lod.levels[1].object.visible;
      };
      out.hysteresis = { thr: r3(thr), farStaysFar98: at(0.98, true), farBecomesDetail94: !at(0.94, true), detailStaysDetail98: !at(0.98, false), detailBecomesFar101: at(1.01, false) };
      }
    }
    // C. culling: the camera in district 0 looking AWAY from every district draws no kit mesh; looking at one district draws only what the frustum reaches
    scene().scene.traverse((q) => { if (q.isLOD && q.levels[1]) { q.levels[1].object.visible = false; q.levels[0].object.visible = true; } });
    kit.setFarDistance(1e9);
    const cull = {};
    for (const view of ["sky", "away", "one", "street", "all"]) {
      const m = render(view), g = render(view, { hideKit: true });
      const dr = expectedDrawn(), ds = new Set();
      scene().scene.traverse((q) => { if (q.isInstancedMesh && q.name.startsWith("kit:")) { const fr = new THREE.Frustum(), pm = new THREE.Matrix4(); pm.multiplyMatrices(scene().cam.projectionMatrix, scene().cam.matrixWorldInverse); fr.setFromProjectionMatrix(pm); if (fr.intersectsObject(q)) ds.add(q.userData.kitDistrict); } });
      cull[view] = { total: m.calls, ground: g.calls, kitCalls: m.calls - g.calls, kitTris: m.triangles - g.triangles, expected: dr, districtsInFrustum: [...ds] };
    }
    out.cull = cull;
    // bounding spheres: each detail InstancedMesh against its district
    const spheres = [];
    scene().scene.traverse((q) => {
      if (!(q.isInstancedMesh && q.name.startsWith("kit:"))) return;
      q.updateWorldMatrix(true, false);
      const c = q.boundingSphere ? q.boundingSphere.center.clone().applyMatrix4(q.matrixWorld) : null;
      const gs = q.geometry.boundingSphere, T = MAN.types[q.userData.kitType];
      spheres.push({ name: q.name, district: q.userData.kitDistrict, type: q.userData.kitType, count: q.count, r: r3(q.boundingSphere ? q.boundingSphere.radius : -1), has: !!q.boundingSphere, frustumCulled: q.frustumCulled,
        centre: c ? [r3(c.x), r3(c.y), r3(c.z)] : null, geomR: gs ? r3(gs.radius * T.suggested_scale) : null });
    });
    out.spheres = spheres;
    // D. shadows are information: the shadow pass doubles the casters inside the shadow frustum (the sun's +-120 m box)
    kit.setFarDistance(250);
    const sh0 = render("street"), sh1 = render("street", { shadows: true }), g0 = render("street", { hideKit: true }), g1 = render("street", { hideKit: true, shadows: true });
    out.shadows = { off: { calls: sh0.calls - g0.calls, tris: sh0.triangles - g0.triangles }, on: { calls: sh1.calls - g1.calls, tris: sh1.triangles - g1.triangles } };
    out.stats1 = kit.stats();
    out.programs = infoNow().programs;
    out.mem = { base: memBase, placed: infoNow() };
    const d = kit.dispose();
    out.disposeCounts = d;
    out.afterDispose = { kitObjects: sceneKit().length, scene: scene().scene.children.length };
    const after = render("all");
    out.mem.afterDispose = infoNow();
    out.disposed = kit.disposed;
    return out;
  }

  // ------------------------------------------------------------------ the leak cycle: place -> render -> dispose, three times
  async function cycles(n) {
    await load(); scene();
    const list = makeList(7), rows = [];
    render("all", { hideKit: true });
    const base = infoNow();
    for (let i = 0; i < (n || 3); i++) {
      const kit = mk();
      const res = await kit.place(list, { parent: scene().scene, districts: THEMES_BY_DISTRICT() });
      render("all"); render("street"); render("drop");
      const placed = infoNow();
      const d = kit.dispose();
      render("all", { hideKit: true });
      rows.push({ cycle: i + 1, placed: { geometries: placed.geometries, textures: placed.textures, programs: placed.programs }, after: infoNow(), dispose: d, kitObjectsLeft: sceneKit().length });
    }
    return { base, rows };
  }

  // ------------------------------------------------------------------ every type once: draws, triangles vs the manifest
  async function types() {
    await load(); scene();
    const ids = CK.typeIds(), list = [], rows = [];
    let x = 0;
    for (const id of ids) { const b = MAN.types[id].bbox_m, w = Math.max(b.x, b.z) + 6; list.push({ type: id, x: x + w / 2, y: 0, z: 0, rot: 0, district: "sheet:" + id }); x += w; }
    const kit = mk();
    const res = await kit.place(list, { parent: scene().scene, lod: "detail" });
    const st = kit.stats();
    for (const id of ids) {
      const D = st.districts["sheet:" + id];                                   // missing when a fault folds every entry into one district: the row then reads 0 and fails
      const T = MAN.types[id];
      const parts = D ? D.groups.length : 0, tris = D ? D.groups.reduce((a, g) => a + g.tris, 0) : 0;
      rows.push({ id, kind: T.kind, mode: T.collider_mode, manifestTris: T.tris, tris, parts, calls: D ? D.detailDrawCalls : 0, bytes: T.bytes, scale: T.suggested_scale, bbox: [T.bbox_m.x, T.bbox_m.y, T.bbox_m.z], failed: D ? D.failedTypes.length : 1 });
    }
    const m = render({ pos: [x / 2, x / 3, 300], look: [x / 2, 0, 0] });
    const out = { rows, failed: res.failed, total: st.totals, rendered: m, boxes: res.colliders.length, textures: st.totals.textures };
    kit.dispose();
    return out;
  }


  // ------------------------------------------------------------------ does the DRAWN mesh sit where the COLLIDERS are? every type x 4 quarter turns
  // The collider maths is proven bit-for-bit against an independent matrix in Node; this proves the instance MATRIX uses the same convention. For every
  // placed instance the geometry's own bounding box is carried through the instance matrix and the LOD offset, and every collider box of that entry must lie
  // inside it (the intake's rule: colliders inside bbox_m, +0.3 m). A mirrored or wrongly-signed rotation puts the footprint of any asymmetric type outside.
  async function agreement() {
    await load(); scene();
    const ids = CK.typeIds(), list = [];
    let n = 0;
    for (const id of ids) for (let q = 0; q < 4; q++) { const b = MAN.types[id].bbox_m, w = Math.max(b.x, b.z, 2) + 8; list.push({ type: id, x: (n % 18) * 70, y: 0, z: Math.floor(n / 18) * 70, rot: q, district: "ag" }); n++; void w; }
    const kit = mk();
    const res = await kit.place(list, { parent: scene().scene, lod: "detail" });
    // instance j of a (type) mesh is the j-th entry of that type (one palette: the district theme)
    const seen = {}, rows = [];
    scene().scene.updateMatrixWorld(true);                                          // nothing has been rendered yet: the LOD offsets are not in matrixWorld
    const meshes = []; scene().scene.traverse((q) => { if (q.isInstancedMesh && q.userData.kitDistrict === "ag") meshes.push(q); });
    const byType = {}; for (const m of meshes) (byType[m.userData.kitType] ||= []).push(m);
    const M4 = new THREE.Matrix4(), bb = new THREE.Box3();
    let worst = 0, bad = 0;
    list.forEach((e, i) => {
      const k = (seen[e.type] = (seen[e.type] || 0)), ms = byType[e.type] || [];
      seen[e.type]++;
      const box = new THREE.Box3();
      for (const m of ms) {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        m.getMatrixAt(k, M4); M4.premultiply(m.parent.parent.matrixWorld);          // detail group -> LOD (positioned at the district centre)
        bb.copy(m.geometry.boundingBox).applyMatrix4(M4); box.union(bb);
      }
      const r0 = res.ranges[i * 2], rn = res.ranges[i * 2 + 1];
      let out = 0;
      for (let j = 0; j < rn; j++) {
        const c = res.colliders[r0 + j];
        out = Math.max(out, box.min.x - c.minX, c.maxX - box.max.x, box.min.z - c.minZ, c.maxZ - box.max.z, box.min.y - c.minY, c.maxY - box.max.y);
      }
      if (out > worst) worst = out;
      if (out > 0.3 + 1e-6 || box.isEmpty() || (!rn && MAN.types[e.type].collider_mode !== "none")) { bad++; if (rows.length < 6) rows.push({ type: e.type, q: e.rot, out: r3(out), n: rn, empty: box.isEmpty() }); }
    });
    const out = { entries: list.length, meshes: meshes.length, worst: r3(worst), bad, rows };
    kit.dispose();
    return out;
  }

  // ------------------------------------------------------------------ the rest of the API: preload, auto-chunking, free yaw, scale, shadows
  async function misc() {
    await load(); scene();
    const kit = mk(), out = {};
    const pl = await kit.preload(["suburban/building-type-a", "cars/sedan", "props/hydrant"]);
    out.preload = { loaded: pl.loaded.length, failed: pl.failed.length };
    const list = [
      { type: "suburban/building-type-a", x: 10, y: 0, z: 10, rot: 0 },                          // no district: the 96 m grid
      { type: "suburban/building-type-a", x: 200, y: 0, z: 10, rot: 1 },
      { type: "suburban/building-type-c", x: 10, y: 0, z: 200, ry: 0.5 },                        // a free yaw
      { type: "cars/sedan", x: 30, y: 0, z: 30, rot: 2, scale: 1.5 },
      { type: "props/hydrant", x: 40, y: 0, z: 30, rot: 0 },
      { type: "no/such", x: 0, y: 0, z: 0 },
    ];
    const res = await kit.place(list, { parent: scene().scene, lod: "detail" });
    out.districts = res.districts; out.skipped = res.skipped.length; out.inexact = res.inexactEntries;
    out.yawBoxes = res.ranges[2 * 2 + 1]; out.manifestBoxes = MAN.types["suburban/building-type-c"].colliders.length;
    const flags = () => { const f = []; scene().scene.traverse((q) => { if (q.isInstancedMesh && q.name.startsWith("kit:")) f.push([q.userData.kitType, q.castShadow]); }); return f; };
    out.shadowAuto = flags();
    kit.setShadows(false); out.shadowOff = flags();
    kit.setShadows(true); out.shadowOn = flags();
    kit.setShadows("auto"); out.shadowBack = flags();
    // the sedan at scale 1.5, quarter 2: |m00| = suggested_scale * 1.5
    let sedan = null; scene().scene.traverse((q) => { if (q.isInstancedMesh && q.userData.kitType === "cars/sedan") sedan = q; });
    const M4 = new THREE.Matrix4(); sedan.getMatrixAt(0, M4);
    out.sedanScale = r3(Math.abs(M4.elements[0])); out.sedanExpect = r3(MAN.types["cars/sedan"].suggested_scale * 1.5);
    const m = render({ pos: [100, 400, 100.1], look: [100, 0, 100] }), g = render({ pos: [100, 400, 100.1], look: [100, 0, 100] }, { hideKit: true });
    out.kitCalls = m.calls - g.calls; out.stats = kit.stats().totals;
    const d = kit.dispose(); out.dispose = d;
    let threw = false; try { await kit.place(list, {}); } catch (e) { threw = /disposed/.test(String(e.message)); }
    out.placeAfterDisposeThrows = threw;
    return out;
  }


  // ------------------------------------------------------------------ the kit inside a REAL match scene (citykit_probe.py --in-match; a match is loaded, the page's loop stopped)
  // Wave 7 will place the kit inside buildMap, before the game's own warm-up. This does the same without touching maps.js: it parents the 300-building list to
  // W.group("map") on the terrain, runs kernel.warmup (the real C7 warm-up, which forces every LOD level visible), then counts programs and the kit's cost in real
  // composer frames (renderer.info accumulated over every pass: colour, shadow, bloom, output).
  async function inMatchPlace(o) {
    o = o || {};
    await load();
    const k = W.kernel, r = k.renderer, out = { map: W.mapId, programs0: r.info.programs.length };
    const list = makeList(7).map((e) => ({ ...e, x: e.x - 700, z: e.z + 200 }));
    let wet = 0, ymin = 1e9, ymax = -1e9;
    for (const e of list) { e.y = W.map.heightAt(e.x, e.z); ymin = Math.min(ymin, e.y); ymax = Math.max(ymax, e.y); if (e.y < 0.3) wet++; }
    out.terrain = { ymin: r3(ymin), ymax: r3(ymax), wet };
    const kit = mk({ W });                                                          // createCityKit({ W }): THREE, kernel and assetBase from the game's own W
    window.__KIT__ = kit;
    const t0 = performance.now();
    const res = await kit.place(list, { parent: W.group("map"), districts: THEMES_BY_DISTRICT() });
    out.placeMs = r3(performance.now() - t0); out.colliders = res.colliders.length; out.failed = res.failed.length;
    out.programsBeforeWarm = r.info.programs.length;
    const w = await k.warmup({ extras: [] });
    out.warm = w ? { ms: w.ms, forced: w.forced, programs: w.programs } : null;
    out.programsAfterWarm = r.info.programs.length;
    return out;
  }
  function inMatchStand() {
    const p = W.player, x = -700 - 95, z = 200 - 63, y = W.map.heightAt(x, z);
    p.alive = true; p.hp = 100; p.shield = 100; p.gliding = false; p.pos.set(x, y + 0.1, z); p.vel.set(0, 0, 0); p.onGround = true;
    p.yaw = -Math.PI / 2; p.input.yaw = p.yaw; p.pitch = 0.05; p.input.pitch = 0.05; if (p.obj) p.obj.position.copy(p.pos);
    return { x, y, z };
  }
  // the kit's cost per REAL frame: the same frames with the kit hidden and shown (the game alternates shadow-refresh frames, so every parity is reported)
  function inMatchMeasure() {
    const r = K.renderer, P = window.__H_PUMP__, lods = [];
    W.group("map").traverse((q) => { if (q.isLOD && q.name.startsWith("kit:")) lods.push(q); });
    r.info.autoReset = false;
    const frames = (show, n) => { for (const l of lods) l.visible = show; const rows = []; for (let i = 0; i < n; i++) { r.info.reset(); const p0 = r.info.programs.length; P.frame(1e-6, true); rows.push([r.info.render.calls, r.info.render.triangles, r.info.programs.length - p0]); } return rows; };
    frames(true, 3);
    const withKit = frames(true, 6), without = frames(false, 6);
    for (const l of lods) l.visible = true;
    frames(true, 2);
    const st = window.__KIT__.stats();
    return { withKit, without, lod: Object.fromEntries(Object.entries(st.districts).map(([k, d]) => [k, d.lod])), totals: st.totals };
  }
  function inMatchDispose() { return window.__KIT__ ? window.__KIT__.dispose() : null; }

  // ------------------------------------------------------------------ the GLB / manifest failure paths (run in a page whose GLB requests are blocked)
  async function failpaths() {
    await load(); scene();
    const list = makeList(7), out = {};
    const kit = mk();
    const res = await kit.place(list, { parent: scene().scene, districts: THEMES_BY_DISTRICT() });
    out.gl = { colliders: flat(res.colliders), hash: fnv(JSON.stringify(flat(res.colliders))), failed: res.failed.map((f) => f.type), nFailed: res.failed.length, ranges: Array.from(res.ranges) };
    const st = kit.stats();
    render("all", { hideKit: true });
    const m = render("all"), g = render("all", { hideKit: true });
    out.gl.stats = st.totals; out.gl.failedTypes = st.failedTypes.length; out.gl.kitCalls = m.calls - g.calls; out.gl.kitTris = m.triangles - g.triangles;
    out.gl.dist = Object.fromEntries(Object.entries(st.districts).map(([k, d]) => [k, { fallbackBoxes: d.fallbackBoxes, instances: d.instances, detailCalls: d.detailDrawCalls }]));
    out.gl.shot = render("drop").calls;
    kit.dispose();
    // the manifest unreachable too (the table still gives the colliders; every type draws as boxes)
    const kit2 = mk({ manifestUrl: new URL("assets/props/city/NO_SUCH_MANIFEST.json", W.assetBase).href });
    const res2 = await kit2.place(list, { parent: scene().scene, districts: THEMES_BY_DISTRICT() });
    out.nomanifest = { hash: fnv(JSON.stringify(flat(res2.colliders))), failed: res2.failed.length, manifest: !!kit2.manifest, stats: kit2.stats().totals };
    const m2 = render("all"), g2 = render("all", { hideKit: true });
    out.nomanifest.kitCalls = m2.calls - g2.calls;
    kit2.dispose();
    return out;
  }

  // ------------------------------------------------------------------ themes, far-only districts, per-entry palettes
  async function themes(keep) {
    await load(); scene();
    const kit = mk(), list = [], names = Object.keys(CK.THEMES), out = {};
    names.forEach((t, i) => { list.push({ type: "suburban/building-type-a", x: i * 16, y: 0, z: 0, rot: 0, district: "T:" + t }); list.push({ type: "commercial/building-c", x: i * 16, y: 0, z: -22, rot: 0, district: "T:" + t }); });
    list.push({ type: "suburban/building-type-a", x: 0, y: 0, z: 30, rot: 0, district: "T:city", palette: "sand" });       // an explicit variant inside the city district
    const dist = {}; names.forEach((t) => { dist["T:" + t] = { theme: t }; });
    const res = await kit.place(list, { parent: scene().scene, districts: dist, lod: "detail" });
    const st = kit.stats();
    out.districts = Object.fromEntries(Object.entries(st.districts).map(([k, d]) => [k, d.groups.map((g) => g.type.split("/")[1] + "=" + g.palette)]));
    const mats = new Set(); scene().scene.traverse((q) => { if (q.isInstancedMesh && q.name.startsWith("kit:")) mats.add(q.material); });
    out.distinctMaterials = mats.size; out.textures = st.totals.textures; out.materials = st.totals.materials;
    const tex = new Set([...mats].map((m) => m.map && m.map.name)); out.textureNames = [...tex];
    out.tints = [...mats].map((m) => m.color.getHexString());
    out.THEMES = JSON.parse(JSON.stringify(CK.THEMES)); out.names = names;
    out.x = names.length * 16;
    const m = render({ pos: [out.x / 2, 38, 70], look: [out.x / 2, 4, -8] });
    out.rendered = m;
    if (keep) { if (SHOT.kit) SHOT.kit.dispose(); SHOT.kit = kit; } else kit.dispose();
    return out;
  }
  async function farOnly() {
    await load(); scene();
    const list = makeList(7).filter((e) => e.district === "downtown" || e.district === "town:outpost");
    const before = resourceCount(/assets\/props\/city\/(skyscraper|commercial|suburban)\/.*\.glb/);
    const kit = mk();
    const res = await kit.place(list, { parent: scene().scene, lod: "far" });
    const after = resourceCount(/assets\/props\/city\/(skyscraper|commercial|suburban)\/.*\.glb/);
    const st = kit.stats(), m = render("all"), g = render("all", { hideKit: true });
    const out = { glbRequests: after - before, totals: st.totals, kitCalls: m.calls - g.calls, kitTris: m.triangles - g.triangles, colliders: res.colliders.length, failed: res.failed.length,
      lods: Object.values(st.districts).map((d) => d.lod) };
    kit.dispose();
    return out;
  }

  // ------------------------------------------------------------------ screenshots: each draws its own scene, then the python side reads the canvas in the same task
  const SHOT = { kit: null };
  async function shotScene(name) {
    await load(); scene();
    if (SHOT.kit) { SHOT.kit.dispose(); SHOT.kit = null; }
    const kit = mk(); SHOT.kit = kit;
    const sc = scene();
    if (name === "town") {
      const list = makeList(7);
      await kit.place(list, { parent: sc.scene, districts: THEMES_BY_DISTRICT() });
      sc.sun.castShadow = false;
      return { stats: kit.stats().totals };
    }
    if (name === "buildings") {
      // every palette-textured building type in a row (detail), the same row again as ONE far proxy (lod: "far")
      const ids = CK.typeIds().filter((id) => MAN.types[id].kind === "building" && MAN.types[id].palette), list = [], list2 = [];
      let x = 0;
      for (const id of ids) { const b = MAN.types[id].bbox_m, w = Math.max(b.x, b.z) + 5; list.push({ type: id, x: x + w / 2, y: 0, z: 0, rot: 0, district: "row" }); list2.push({ type: id, x: x + w / 2, y: 0, z: -60, rot: 0, district: "proxy" }); x += w; }
      await kit.place(list, { parent: sc.scene, lod: "detail", theme: "city" });
      await kit.place(list2, { parent: sc.scene, lod: "far", theme: "city" });
      SHOT.width = x;
      return { width: x, n: ids.length, stats: kit.stats().totals };
    }
    if (name.startsWith("sheet:")) {
      // every type of one manifest group in a row (detail), buildings with their far proxy in a second row behind
      const grp = name.slice(6), ids = CK.typeIds().filter((id) => MAN.types[id].group === grp), list = [], list2 = [];
      let x = 0;
      for (const id of ids) { const b = MAN.types[id].bbox_m, w = Math.max(b.x, b.z, 1.2) + (grp === "props" || grp === "furniture" ? 1.5 : grp === "cars" ? 2.5 : 5); list.push({ type: id, x: x + w / 2, y: 0, z: 0, rot: 0, district: "row" }); list2.push({ type: id, x: x + w / 2, y: 0, z: -60, rot: 0, district: "proxy" }); x += w; }
      await kit.place(list, { parent: sc.scene, lod: "detail", theme: "city" });
      if (MAN.types[ids[0]].kind === "building") await kit.place(list2, { parent: sc.scene, lod: "far", theme: "city" });
      SHOT.width = x;
      return { width: x, n: ids.length, ids, stats: kit.stats().totals };
    }
    if (name === "themes") { SHOT.kit = null; const t = await themes(true); kit.dispose(); return t; }
    return null;
  }
  function shotView(name, view) {
    const sc = scene();
    if (name === "town") { /* LODs update during this render */ }
    setView(typeof view === "string" ? VIEWS[view] : view);
    R.setRenderTarget(null);
    R.render(sc.scene, sc.cam);
    return infoNow();
  }
  function shotDispose() { if (SHOT.kit) { const d = SHOT.kit.dispose(); SHOT.kit = null; return d; } return null; }

  return { load, scene, render, setView, VIEWS, main, cycles, types, agreement, misc, inMatchPlace, inMatchStand, inMatchMeasure, inMatchDispose, failpaths, themes, farOnly, shotScene, shotView, shotDispose, makeList, expectedDrawn, fnv, DIST,
    width: () => SHOT.width };
}
