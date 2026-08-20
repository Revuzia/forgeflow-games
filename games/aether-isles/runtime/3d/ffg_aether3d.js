/**
 * FFG runtime — 3d/ffg_aether3d.js  (ES module)
 * AETHER ISLES — floating-isles resource/build game (Catan, reimagined). Registers "aether3d".
 *
 * MILESTONE M2-turns: full 2-player-vs-AI loop on the verified rules core (ffg_aether_rules.js).
 * Snake-draft setup (2 settlements each) → per-turn ROLL→produce → BUILD (road / settlement /
 * city with real costs + road connectivity + distance rule) → end turn. First to 8 VP wins.
 * Greedy Skyfarer AI. Next: N seats (2–5), trade, Storm Spirit, art, online via ffg_seatplay.
 */
import * as THREE from "three";
const _V = new URL(import.meta.url).search;
const { register3d } = await import("./ffg_kernel_3d.js" + _V);
const A = await import("./ffg_aether_rules.js" + _V);

const SCALE = 3.0, TOPY = 0.7, WIN_VP = 8;   // TOPY = top surface of the raised painted hex prism

register3d("aether3d", async (kernel, content) => {
  const { scene, camera } = kernel;
  const loader = new THREE.TextureLoader();

  scene.background = new THREE.Color(0x14233c);
  scene.fog = new THREE.FogExp2(0x14233c, 0.011);   // atmosphere so the board's far edges melt into the sky
  const skyTex = loader.load("assets/art/board_bg.jpg"); skyTex.colorSpace = THREE.SRGBColorSpace; skyTex.wrapS = THREE.RepeatWrapping; skyTex.repeat.x = 2;
  // FULL SKYDOME — the painted sky wraps the whole scene, so any rotate/zoom/turn always shows sky (no empty blue)
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(180, 48, 24), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
  scene.add(skyDome);
  const key = new THREE.DirectionalLight(0xdfeaff, 2.1); key.position.set(12, 26, 16);
  key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.camera.far = 100;
  key.shadow.camera.left = -34; key.shadow.camera.right = 34; key.shadow.camera.top = 34; key.shadow.camera.bottom = -34; scene.add(key);
  scene.add(new THREE.DirectionalLight(0xffcf9a, 0.7).translateX(-14).translateY(10).translateZ(8));
  scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x241a3a, 0.55)); scene.add(new THREE.AmbientLight(0x51608a, 0.34));

  const RES = { lumber: { top: 0x3e8a5a, glow: 0x5fb87a }, ore: { top: 0x6a4fa0, glow: 0xb06cf0 }, grain: { top: 0xc7a24e, glow: 0xf0d27a }, wool: { top: 0x4f9e8c, glow: 0x7fe0c8 }, brick: { top: 0xa8623e, glow: 0xe0885a }, aether: { top: 0x3a4a68, glow: 0x7fe0f5 } };
  const basalt = new THREE.MeshStandardMaterial({ color: 0x33404f, roughness: 0.9, flatShading: true });
  function tokenTex(n) { const cv = document.createElement("canvas"); cv.width = cv.height = 64; const c = cv.getContext("2d"); c.fillStyle = "#efe3c8"; c.beginPath(); c.arc(32, 32, 30, 0, 7); c.fill(); c.strokeStyle = "#b8a678"; c.lineWidth = 3; c.stroke(); c.fillStyle = (n === 6 || n === 8) ? "#b03030" : "#2a2a2a"; c.font = "bold 34px Georgia,serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(String(n), 32, 35); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; }
  const hexSide = new THREE.MeshStandardMaterial({ color: 0x28313f, roughness: 0.92, flatShading: true });
  // painted flat top-down biome art (xAI) as the hex-tile SURFACE — matches the card quality, lays flat correctly
  const groundTex = {}; for (const r of ["lumber", "ore", "grain", "wool", "brick", "aether"]) { groundTex[r] = loader.load("assets/ground/" + r + ".jpg"); groundTex[r].colorSpace = THREE.SRGBColorSpace; groundTex[r].anisotropy = 4; }
  // Real 3D biome props that POP OUT of each isle (procedural low-poly; props cast no shadow -> FPS-safe).
  // Scattered in a ring so the number token stays readable in the center.
  // props must clear the CENTRE so they never cover the number token (disc r=0.82) — TOK_CLEAR is
  // that radius plus the widest prop's half-width, so no decoration can sit on top of the number.
  const TOK_CLEAR = 1.45;
  function scatter(n, r0) { const out = []; const lo = Math.min(TOK_CLEAR, r0 - 0.15); for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, d = lo + Math.random() * Math.max(0.12, r0 - lo); out.push([Math.cos(a) * d, Math.sin(a) * d]); } return out; }
  const spinners = [];
  // A beautiful faceted glowing crystal cluster (recreating the xAI amethyst-mine look in real 3D):
  // translucent flat-shaded hex crystals with bright inner cores, on a dark rock base.
  function crystalCluster(color, coreColor) {
    const g = new THREE.Group(), n = 5 + (Math.random() * 3 | 0);
    const shellMat = new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 0.42, roughness: 0.1, metalness: 0.25, transparent: true, opacity: 0.8, flatShading: true });
    const coreMat = new THREE.MeshBasicMaterial({ color: coreColor, transparent: true, opacity: 0.92 });
    for (let i = 0; i < n; i++) {
      const h = 0.6 + Math.random() * 1.5, r = 0.13 + Math.random() * 0.16, c = new THREE.Group();
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.015, r, h, 6), shellMat); shell.position.y = h / 2; c.add(shell);
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.006, r * 0.4, h * 0.82, 6), coreMat); core.position.y = h * 0.42; c.add(core);
      const a = Math.random() * 6.28, d = Math.random() * 0.42; c.position.set(Math.cos(a) * d, 0, Math.sin(a) * d); c.rotation.set((Math.random() - 0.5) * 0.55, Math.random() * 6, (Math.random() - 0.5) * 0.55); g.add(c);
    }
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 0), new THREE.MeshStandardMaterial({ color: 0x2a2438, roughness: 0.92, flatShading: true })); rock.position.y = -0.12; rock.scale.y = 0.45; g.add(rock);
    return g;
  }
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x5aa04a, roughness: 0.9, flatShading: true });
  function grassTuft(x, z) { const t = new THREE.Group(); for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.15 + Math.random() * 0.13, 3), grassMat); b.position.set((Math.random() - 0.5) * 0.12, 0.08, (Math.random() - 0.5) * 0.12); b.rotation.z = (Math.random() - 0.5) * 0.45; t.add(b); } t.position.set(x, TOPY, z); return t; }
  const woolMat = new THREE.MeshStandardMaterial({ color: 0xf0ece2, roughness: 0.95, flatShading: true }), sheepDark = new THREE.MeshStandardMaterial({ color: 0x33302e, roughness: 0.8 }), sheepLeg = new THREE.MeshStandardMaterial({ color: 0x2a2724 });
  function makeSheep() {
    const g = new THREE.Group();
    for (const [x, y, z, s] of [[0, 0.32, 0, 0.3], [0.18, 0.34, 0.05, 0.22], [-0.16, 0.34, -0.04, 0.22], [0.04, 0.42, 0.13, 0.18], [0.02, 0.4, -0.13, 0.18]]) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), woolMat); b.position.set(x, y, z); g.add(b); }
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 7, 6), sheepDark); head.position.set(0.33, 0.36, 0); head.scale.set(1, 1.2, 0.85); g.add(head);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 4), sheepDark); e.position.set(0.33, 0.46, 0.08 * s); e.scale.set(0.5, 1, 1.4); g.add(e); }
    for (const [x, z] of [[0.14, 0.1], [0.14, -0.1], [-0.14, 0.1], [-0.14, -0.1]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.26, 5), sheepLeg); l.position.set(x, 0.13, z); g.add(l); }
    return g;
  }
  function makeProps(res) {
    const g = new THREE.Group();
    if (res === "lumber") { const trunk = new THREE.MeshStandardMaterial({ color: 0x5a3d28, roughness: 0.9 }), leaf = new THREE.MeshStandardMaterial({ color: 0x2e7d46, roughness: 0.85, flatShading: true });
      for (const [x, z] of scatter(5, SCALE * 0.72)) { const h = 0.9 + Math.random() * 0.9, t = new THREE.Group(); const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, h * 0.45, 5), trunk); tr.position.y = h * 0.22; t.add(tr); for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.36 - k * 0.09, 0.55, 6), leaf); c.position.y = h * 0.45 + k * 0.3; t.add(c); } t.position.set(x, TOPY, z); g.add(t); }
      for (const [x, z] of scatter(7, SCALE * 0.8)) g.add(grassTuft(x, z)); }
    else if (res === "ore") { for (const [x, z] of scatter(2, SCALE * 0.62)) { const c = crystalCluster(0xb06cf0, 0xf2d8ff); c.position.set(x, TOPY, z); c.scale.setScalar(0.8 + Math.random() * 0.55); g.add(c); } }
    else if (res === "grain") { const stemMat = new THREE.MeshStandardMaterial({ color: 0xbfa24a, roughness: 0.85, flatShading: true }), headMat = new THREE.MeshStandardMaterial({ color: 0xf2cf5a, roughness: 0.7, flatShading: true });
      for (const [x, z] of scatter(6, SCALE * 0.74)) { const bunch = new THREE.Group(); for (let k = 0; k < 5; k++) { const h = 0.55 + Math.random() * 0.3, st = new THREE.Group(); const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, h, 4), stemMat); stem.position.y = h / 2; st.add(stem); const head = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.26, 5), headMat); head.position.y = h + 0.11; st.add(head); st.position.set((Math.random() - 0.5) * 0.18, 0, (Math.random() - 0.5) * 0.18); st.rotation.z = (Math.random() - 0.5) * 0.28; bunch.add(st); } bunch.position.set(x, TOPY, z); g.add(bunch); } }
    else if (res === "wool") { for (const [x, z] of scatter(3, SCALE * 0.6)) { const s = makeSheep(); s.position.set(x, TOPY, z); s.rotation.y = Math.random() * 6; s.scale.setScalar(0.85 + Math.random() * 0.3); g.add(s); }
      for (const [x, z] of scatter(4, SCALE * 0.76)) g.add(grassTuft(x, z)); }
    else if (res === "brick") { const rm = new THREE.MeshStandardMaterial({ color: 0xa8623e, roughness: 0.95, flatShading: true }), dk = new THREE.MeshStandardMaterial({ color: 0x7a4028, roughness: 0.95, flatShading: true });
      for (const [x, z] of scatter(3, SCALE * 0.78)) { const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.22, 0.5), rm); shelf.position.set(x, TOPY + 0.11, z); shelf.rotation.y = Math.random() * 6; g.add(shelf); const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), dk); b.position.set(x + 0.28, TOPY + 0.2, z + 0.1); b.rotation.set(Math.random() * 6, Math.random() * 6, 0); g.add(b); }
      const kiln = new THREE.Group(); const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 0.62, 8), dk); body.position.y = 0.31; kiln.add(body); const top = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.3, 8), dk); top.position.y = 0.74; kiln.add(top); const ember = new THREE.Mesh(new THREE.CircleGeometry(0.13, 8), new THREE.MeshBasicMaterial({ color: 0xff7a30 })); ember.rotation.x = -0.5; ember.position.set(0, 0.28, 0.34); kiln.add(ember);
      { const ka = Math.random() * 6.28, kd = TOK_CLEAR + 0.25; kiln.position.set(Math.cos(ka) * kd, TOPY, Math.sin(ka) * kd); }   // off-centre: the kiln used to sit ON the number token
      g.add(kiln); }
    else { const ring = new THREE.Mesh(new THREE.TorusGeometry(SCALE * 0.5, 0.1, 8, 22), new THREE.MeshStandardMaterial({ color: 0x7fe0f5, emissive: new THREE.Color(0x4fb0d0), emissiveIntensity: 0.55, roughness: 0.3 })); ring.rotation.x = Math.PI / 2; ring.position.y = TOPY + 0.28; g.add(ring);
      const cl = crystalCluster(0x9fe8ff, 0xffffff); cl.position.set(0, TOPY, 0); cl.scale.setScalar(1.05); g.add(cl); spinners.push(cl); }
    return g;
  }
  function makeIsle(res, token, deco) {
    const g = new THREE.Group(), b = RES[res];
    const prism = new THREE.Mesh(new THREE.CylinderGeometry(SCALE, SCALE * 0.86, 1.4, 6), [hexSide, new THREE.MeshStandardMaterial({ map: groundTex[res], roughness: 0.9 }), hexSide]);
    prism.rotation.y = Math.PI / 6; prism.castShadow = true; prism.receiveShadow = true; g.add(prism);
    const under = new THREE.Mesh(new THREE.ConeGeometry(SCALE * 0.9, 3.4, 6, 1, true), basalt); under.rotation.y = Math.PI / 6; under.position.y = -2.3; under.castShadow = true; g.add(under);
    // background decorative isles get a light prop set (crystal accent only) to keep the mesh/draw-call count in check
    if (deco) { if (res === "ore" || res === "aether") { const c = crystalCluster(res === "ore" ? 0xb06cf0 : 0x9fe8ff, res === "ore" ? 0xf2d8ff : 0xffffff); c.position.y = TOPY; c.scale.setScalar(0.9); g.add(c); } }
    else g.add(makeProps(res));
    if (token) { const d = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.14, 20), new THREE.MeshStandardMaterial({ map: tokenTex(token), roughness: 0.6 })); d.position.y = TOPY + 0.08; g.add(d); }
    return g;
  }

  // MAP SEED — randomised per game in beginGame(); online, the host broadcasts it so all clients build the same map.
  let SEED = 1337, board = A.makeBoard(SEED);
  let PORTS = A.makePorts(board, SEED);   // 9 skyports on the rim: 4x generic 3:1 + 5x specialist 2:1
  // -- resource dictionary: drives the hover tooltips, port signs and trade UI --
  const RES_LABEL = { lumber: "Skywood", ore: "Aether Crystal", grain: "Sungrain", wool: "Cloudwool", brick: "Sky Clay" };
  const RES_INFO = {
    lumber: { icon: "🌲", src: "Forest isles",   what: "Timber cut from the floating groves.", used: "Roads, Settlements" },
    brick:  { icon: "🧱", src: "Clay quarries",  what: "Clay fired in the red quarries.",      used: "Roads, Settlements" },
    grain:  { icon: "🌾", src: "Wheat terraces", what: "Wheat from the terraced sky-fields.",  used: "Settlements, Cities (x2), Relics" },
    wool:   { icon: "🐑", src: "Pasture isles",  what: "Fleece from the cloud pastures.",      used: "Settlements, Relics" },
    ore:    { icon: "🔮", src: "Crystal mines",  what: "Violet crystal from the deep mines.",  used: "Cities (x3), Relics" },
  };
  const RES5 = ["lumber", "ore", "grain", "wool", "brick"];
  const world = new THREE.Group(); scene.add(world);
  const isleGroups = [];
  function buildIsles() {
    board.hexes.forEach((h, i) => { const g = makeIsle(h.res, h.token); g.position.set(h.cx * SCALE, 0, h.cz * SCALE); g.userData = { bob: Math.random() * 6.28, hi: i, y0: 0 }; world.add(g); isleGroups.push(g); });
  }
  buildIsles();
  // decorative floating isles ringing the play area — so the board sits IN a sky of islands, not on a flat image
  function buildDecoIsles() {
    { const dk = ["lumber", "ore", "grain", "wool", "brick", "aether"], rr = A.makeRng(SEED ^ 0x7);
    for (let i = 0; i < 9; i++) { const ang = (i / 9) * Math.PI * 2 + 0.4, rad = 26 + rr() * 26, by = -5 - rr() * 12; const g = makeIsle(dk[i % 6], 0, true); g.scale.setScalar(0.5 + rr() * 0.5); g.position.set(Math.cos(ang) * rad, by, Math.sin(ang) * rad - 8); g.userData = { bob: rr() * 6.28, deco: true, y0: by }; world.add(g); isleGroups.push(g); } }
  }
  buildDecoIsles();

  const vgeo = new THREE.SphereGeometry(0.15, 10, 8);   // smaller marker dots (owner: too big/glowy)
  const vIdle = new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 0.7, transparent: true, opacity: 0.25 });
  const vOk = new THREE.MeshBasicMaterial({ color: 0x8affa8, transparent: true, opacity: 0.55, depthWrite: false });
  // ── SKYPORT markers: a floating dock sign between the port's two rim vertices, showing its rate ──
  function portSignTex(type, ratio) {
    const cv = document.createElement("canvas"); cv.width = 256; cv.height = 128; const c = cv.getContext("2d");
    const g = c.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, "#123047"); g.addColorStop(1, "#0a1a28");
    c.fillStyle = g; c.fillRect(0, 0, 256, 128);
    c.strokeStyle = type === "any" ? "#7fe0f5" : "#f0d27a"; c.lineWidth = 7; c.strokeRect(5, 5, 246, 118);
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillStyle = type === "any" ? "#bff0ff" : "#ffe9b0"; c.font = "bold 58px 'Segoe UI',sans-serif";
    c.fillText(ratio + ":1", 128, 44);
    c.font = "bold 30px 'Segoe UI',sans-serif"; c.fillStyle = "#dfeaff";
    c.fillText(type === "any" ? "ANY" : RES_LABEL[type].toUpperCase(), 128, 94);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  let portGroups = [];
  function buildPorts() { portGroups = PORTS.map((p) => {
    const va = board.vertices[p.vertices[0]], vb = board.vertices[p.vertices[1]];
    const mx = (va.x + vb.x) / 2 * SCALE, mz = (va.z + vb.z) / 2 * SCALE;
    const out = Math.hypot(mx, mz) || 1, px = mx + (mx / out) * 2.2, pz = mz + (mz / out) * 2.2;   // pushed outward, off the isles
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 1.7, 6), new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.9 }));
    post.position.y = TOPY + 0.85; g.add(post);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.95), new THREE.MeshBasicMaterial({ map: portSignTex(p.type, p.ratio), transparent: true, side: THREE.DoubleSide }));
    sign.position.y = TOPY + 2.1; g.add(sign);
    // little jetty planks pointing at the two vertices it serves
    for (const v of [va, vb]) {
      const dx = v.x * SCALE - px, dz = v.z * SCALE - pz, len = Math.hypot(dx, dz);
      const plank = new THREE.Mesh(new THREE.BoxGeometry(len * 0.8, 0.09, 0.28), new THREE.MeshStandardMaterial({ color: 0x6a5030, roughness: 0.85 }));
      plank.position.set(px + dx * 0.4 - px + dx * 0.0, TOPY + 0.1, pz + dz * 0.4 - pz + dz * 0.0);
      plank.position.set(dx * 0.42, TOPY + 0.1, dz * 0.42); plank.rotation.y = -Math.atan2(dz, dx); g.add(plank);
    }
    g.position.set(px, 0, pz); g.userData = { port: p, sign };
    world.add(g); return g;
  }); }
  buildPorts();
  let vMarks = [];
  function buildVMarks() { vMarks = board.vertices.map((v) => { const m = new THREE.Mesh(vgeo, vIdle); m.position.set(v.x * SCALE, TOPY + 0.5, v.z * SCALE); m.userData = { vid: v.id }; world.add(m); return m; }); }
  buildVMarks();
  // edge markers (road build targets), hidden unless road mode
  let eMarks = [];
  function buildEMarks() { eMarks = board.edges.map((e) => { const va = board.vertices[e.a], vb = board.vertices[e.b]; const ax = va.x * SCALE, az = va.z * SCALE, bx = vb.x * SCALE, bz = vb.z * SCALE; const m = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(bx - ax, bz - az) * 0.7, 0.14, 0.32), new THREE.MeshBasicMaterial({ color: 0x7CFC9A, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })); m.position.set((ax + bx) / 2, TOPY + 0.28, (az + bz) / 2); m.rotation.y = -Math.atan2(bz - az, bx - ax); m.userData = { edge: e }; m.visible = false; world.add(m); return m; }); }
  buildEMarks();

  const SEAT_COLORS = [0x7CFC9A, 0xff9a6a, 0x9bb8ff, 0xffe27a, 0xd08cff], AI_NAMES = ["Skyfarer", "Nimbus", "Zephyr", "Cirrus"];
  let SEATS = [{ name: "You", ai: false, color: SEAT_COLORS[0] }, { name: "Skyfarer AI", ai: true, color: SEAT_COLORS[1] }];
  let gcfg = { total: 3, ais: 2 };   // creator-chosen roster: total 2–5, `ais` filled by AI, rest human (hotseat)
  function buildSeats() {
    SEATS = []; const humans = gcfg.total - gcfg.ais;
    for (let i = 0; i < humans; i++) SEATS.push({ name: i === 0 ? "You" : "Player " + (i + 1), ai: false, color: SEAT_COLORS[SEATS.length] });
    for (let i = 0; i < gcfg.ais; i++) SEATS.push({ name: AI_NAMES[i % 4] + " AI", ai: true, color: SEAT_COLORS[SEATS.length] });
    res = SEATS.map(() => emptyRes());
  }
  let phase = "menu", curSeat = 0, rolled = false, buildMode = null, setupOrder = [], setupIdx = 0, lastRoll = 0, setupSub = "settle", pendingV = -1;
  let frRolls = [], frSeat = 0, firstSeat = 0;   // opening roll-for-turn-order (offline)
  let buildings = {}, roads = {}, res = [emptyRes(), emptyRes()];
  // ── online (ffg_seatplay) — N-seat networked play; purely additive, gated on netMode ──
  let netMode = false, seatplay = null, _spApi = null, mySeat = 0, _applyingRemote = false;
  function _actingSeat() { return phase === "setup" ? setupOrder[setupIdx] : curSeat; }               // whose action it is now
  function _blocked() { const a = _actingSeat(); return netMode ? a !== mySeat : (SEATS[a] ? SEATS[a].ai : true); }   // online: only my seat may act
  function _notMyNetTurn() { return netMode && _actingSeat() !== mySeat; }
  function _drivesAI() { return !netMode || (seatplay && seatplay.isHost); }   // this client drives AI seats (offline: always; online: HOST only)
  // Broadcast ONE authoritative sub-action. next = same acting seat (sub-action, no dispatch) or the next seat (turn-ending).
  function bcast(payload, rng, next) { if (netMode && !_applyingRemote && seatplay && seatplay.amActing(seatplay.turnSeat)) seatplay.localMoved(payload, rng || null, next); }
  function resolveEdge(e) { return board.edges.find((x) => x.a === e.a && x.b === e.b) || e; }         // {a,b} -> the canonical board edge
  // ── relics (development cards) ──
  let relicDeck = [], relicPtr = 0, relics = {}, relicPlayed = {}, relicPlayedTurn = {}, stormWardenSeat = -1, turn = 0, stormHex = -1, relicMode = null;
  function rState() { return { res, roads, relicPlayed, relicPlayedTurn, stormWardenSeat, turn, stormHex }; }
  function initRelics() { relics = {}; relicPlayed = {}; relicPlayedTurn = {}; SEATS.forEach((_, i) => { relics[i] = []; relicPlayed[i] = A.emptyRelicPlayed(); relicPlayedTurn[i] = -1; }); relicDeck = A.makeRelicDeck(SEED); relicPtr = 0; stormWardenSeat = -1; turn = 0; stormHex = -1; relicMode = null; if (stormToken) stormToken.visible = false; }
  const bGroup = new THREE.Group(); world.add(bGroup); const bldMesh = {};
  let rng = A.makeRng(SEED ^ 0x99);
  function emptyRes() { return { lumber: 0, ore: 0, grain: 0, wool: 0, brick: 0 }; }
  function seatMat(seat) { return new THREE.MeshStandardMaterial({ color: SEATS[seat].color, emissive: new THREE.Color(SEATS[seat].color), emissiveIntensity: 0.5, roughness: 0.4, toneMapped: false }); }
  function makeSettlement(seat) {
    const g = new THREE.Group(), wall = seatMat(seat), roofM = new THREE.MeshStandardMaterial({ color: new THREE.Color(SEATS[seat].color).multiplyScalar(0.5), roughness: 0.6, flatShading: true }), dark = new THREE.MeshStandardMaterial({ color: 0x1a2230 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.42, 0.56), wall); base.position.y = 0.21; g.add(base);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.47, 0.4, 4), roofM); roof.rotation.y = Math.PI / 4; roof.position.y = 0.6; g.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, 0.04), dark); door.position.set(0, 0.13, 0.29); g.add(door);
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.04), new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: new THREE.Color(0x6fc8e0), emissiveIntensity: 0.5 })); win.position.set(-0.15, 0.26, 0.29); g.add(win);
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.24, 0.09), roofM); chim.position.set(0.16, 0.66, 0.1); g.add(chim);
    g.castShadow = true; return g;
  }
  function makeCity(seat) {
    const g = new THREE.Group(), m = seatMat(seat), roofM = new THREE.MeshStandardMaterial({ color: new THREE.Color(SEATS[seat].color).multiplyScalar(0.5), roughness: 0.6, flatShading: true });
    const keep = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.85, 0.5), m); keep.position.y = 0.42; g.add(keep);
    const kr = new THREE.Mesh(new THREE.ConeGeometry(0.43, 0.42, 4), roofM); kr.rotation.y = Math.PI / 4; kr.position.y = 1.06; g.add(kr);
    for (const s of [-1, 1]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.66, 6), m); t.position.set(0.33 * s, 0.33, 0.08); g.add(t); const tr = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.3, 6), roofM); tr.position.set(0.33 * s, 0.82, 0.08); g.add(tr); }
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.11, 0.5, 6), new THREE.MeshStandardMaterial({ color: 0xdff6ff, emissive: new THREE.Color(0x8fe0ff), emissiveIntensity: 0.9, roughness: 0.2, transparent: true, opacity: 0.85 })); spire.position.y = 1.5; g.add(spire);
    g.castShadow = true; return g;
  }

  // ── HUD ──
  const mkHud = (css) => { const d = document.createElement("div"); d.style.cssText = css; (kernel.parent || document.body).appendChild(d); d.style.display = "none"; return d; };
  const topBar = mkHud("position:absolute;top:14px;left:0;right:0;text-align:center;z-index:42;font-family:'Segoe UI',system-ui,monospace;pointer-events:none");
  const actionBar = mkHud("position:absolute;bottom:16px;left:0;right:0;text-align:center;z-index:43;font-family:'Segoe UI',system-ui,monospace;pointer-events:none");
  // painted resource-card hand (the resources you collect, as illustrated xAI cards)
  const cardHand = document.createElement("div");
  cardHand.style.cssText = "position:absolute;bottom:78px;left:0;right:0;text-align:center;z-index:41;pointer-events:none";
  (kernel.parent || document.body).appendChild(cardHand); cardHand.style.display = "none";
  const CARD_IMG = { lumber: "assets/cards/card_lumber.jpg", ore: "assets/cards/card_ore.jpg", grain: "assets/cards/card_grain.jpg", wool: "assets/cards/card_wool.jpg", brick: "assets/cards/card_brick.jpg" };
  // The hand shows only the cards you actually HOLD (collected on rolls) — a fanned stack per resource
  // you have, with a count badge; it grows and shrinks as you gain and spend. Not a fixed 5-slot rack.
  // tooltip element (shared by cards + the trade panel)
  const tipEl = document.createElement("div");
  tipEl.style.cssText = "position:absolute;z-index:70;pointer-events:none;display:none;max-width:230px;background:rgba(8,16,30,.97);border:1px solid #7fe0f5;border-radius:10px;padding:9px 12px;color:#dfeaff;font:600 12px 'Segoe UI';box-shadow:0 6px 22px rgba(0,0,0,.6)";
  (kernel.parent || document.body).appendChild(tipEl);
  function showResTip(k, anchor) {
    const i = RES_INFO[k]; if (!i) return;
    const rate = A.tradeRate(PORTS, buildings, curSeat, k);
    tipEl.innerHTML = `<div style="font:800 14px 'Segoe UI';color:#7fe0f5">${i.icon} ${RES_LABEL[k]}</div>`
      + `<div style="opacity:.75;margin:3px 0 6px">${i.what}</div>`
      + `<div><span style="opacity:.6">From:</span> ${i.src}</div>`
      + `<div style="margin-top:3px"><span style="opacity:.6">Builds:</span> ${i.used}</div>`
      + `<div style="margin-top:5px;color:#f0d27a"><span style="opacity:.7">Trade in at</span> ${rate}:1${rate < 4 ? " — skyport!" : ""}</div>`;
    const pr = (kernel.parent || document.body).getBoundingClientRect(), ar = anchor.getBoundingClientRect();
    tipEl.style.display = "block";
    tipEl.style.left = Math.max(6, Math.min(pr.width - 240, ar.left - pr.left + ar.width / 2 - 115)) + "px";
    tipEl.style.top = Math.max(6, ar.top - pr.top - tipEl.offsetHeight - 10) + "px";
  }
  function hideTip() { tipEl.style.display = "none"; }

  // ── Card hand: PERSISTENT elements (no innerHTML wipe) so cards never blink out.
  // Gains are DEALT: a card flies in from the resource pile and lands in your hand.
  const cardEls = new Map();       // res -> { wrap, badge, count }
  let _handRow = null;
  function ensureHandRow() {
    if (_handRow && _handRow.isConnected) return _handRow;
    cardHand.innerHTML = "";
    _handRow = document.createElement("div");
    _handRow.style.cssText = "display:inline-flex;align-items:flex-end;gap:14px;pointer-events:auto";
    cardHand.appendChild(_handRow);
    cardEls.clear();
    return _handRow;
  }
  function makeCardEl(k) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:relative;width:58px;height:82px;transition:transform .15s";
    wrap.innerHTML = `<img src="${CARD_IMG[k]}" style="position:relative;width:58px;height:82px;object-fit:cover;border-radius:7px;border:1.5px solid #7fe0f5cc;box-shadow:0 3px 12px rgba(0,0,0,.55)">`
      + `<span class="cnt" style="position:absolute;bottom:-5px;right:-5px;z-index:2;background:#0c1526;border:1px solid #7fe0f5;border-radius:11px;color:#dfeaff;font:bold 12px 'Segoe UI',monospace;padding:1px 7px">0</span>`;
    wrap.onmouseenter = () => { wrap.style.transform = "translateY(-6px)"; showResTip(k, wrap); };
    wrap.onmouseleave = () => { wrap.style.transform = "none"; hideTip(); };
    return { wrap, badge: wrap.querySelector(".cnt"), count: 0 };
  }
  // fly a card image from the pile into the hand slot — the "dealt" feel
  function dealAnim(k, target, n) {
    if (reduceMotion || !target || !target.isConnected) return;
    const host = kernel.parent || document.body, hr = host.getBoundingClientRect(), tr = target.getBoundingClientRect();
    for (let i = 0; i < Math.min(n, 4); i++) {
      const fly = document.createElement("img");
      fly.src = CARD_IMG[k];
      fly.style.cssText = "position:absolute;z-index:60;width:58px;height:82px;object-fit:cover;border-radius:7px;border:1.5px solid #7fe0f5;box-shadow:0 6px 20px rgba(0,0,0,.6);pointer-events:none;transition:transform .5s cubic-bezier(.2,.8,.3,1),opacity .5s";
      const sx = hr.width - 90, sy = 90;                                     // the draw pile (top-right)
      fly.style.left = sx + "px"; fly.style.top = sy + "px";
      fly.style.transform = "scale(.55) rotate(-14deg)"; fly.style.opacity = "0.2";
      host.appendChild(fly);
      const dx = (tr.left - hr.left) - sx, dy = (tr.top - hr.top) - sy;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        fly.style.transform = `translate(${dx}px, ${dy}px) scale(1) rotate(0deg)`; fly.style.opacity = "1";
      }));
      setTimeout(() => { fly.remove(); if (target.isConnected) { target.style.transform = "translateY(-9px)"; setTimeout(() => { target.style.transform = "none"; }, 130); } }, 520 + i * 60);
    }
  }
  function renderCards() {
    if (phase === "menu" || phase === "ended") { cardHand.style.display = "none"; hideTip(); return; }
    cardHand.style.display = "block";
    const r = res[curSeat] || res[0];
    const row = ensureHandRow();
    let anyHeld = false;
    for (const k of RES5) {
      const n = r[k] || 0;
      let e = cardEls.get(k);
      if (n > 0) {
        anyHeld = true;
        if (!e) { e = makeCardEl(k); cardEls.set(k, e); }
        if (!e.wrap.isConnected) row.appendChild(e.wrap);
        if (n !== e.count) {
          const gained = n - e.count;
          e.badge.textContent = n;
          if (gained > 0) dealAnim(k, e.wrap, gained);
          e.count = n;
        }
      } else if (e && e.wrap.isConnected) { e.wrap.remove(); e.count = 0; }
    }
    // keep the row ordered consistently (lumber, ore, grain, wool, brick)
    for (const k of RES5) { const e = cardEls.get(k); if (e && e.wrap.isConnected) row.appendChild(e.wrap); }
    let empty = row.querySelector(".ff-empty");
    if (!anyHeld) {
      if (!empty) { empty = document.createElement("div"); empty.className = "ff-empty"; empty.style.cssText = "color:#9fb4cc;font:600 12px 'Segoe UI';opacity:.6;background:rgba(8,16,30,.6);border-radius:8px;padding:6px 14px"; empty.textContent = "✦ no cards yet — roll to collect resources"; row.appendChild(empty); }
    } else if (empty) empty.remove();
  }
  const ICON = { lumber: "🌲", ore: "🔮", grain: "🌾", wool: "🐑", brick: "🧱" };
  // ── portal integration: achievements + weekly leaderboard (no-ops outside the portal iframe) ──
  const _achDone = new Set();
  function ach(slug) { if (_achDone.has(slug)) return; _achDone.add(slug); try { if (window.ForgeFlow && window.ForgeFlow.unlockAchievement) window.ForgeFlow.unlockAchievement(slug); } catch (e) {} }
  function submitFinalScore(n) { try { if (window.ForgeFlow && window.ForgeFlow.gameOver) window.ForgeFlow.gameOver(Math.max(0, n | 0)); } catch (e) {} }
  const localSeat = () => (netMode ? mySeat : 0);   // the seat this human owns (offline hotseat = seat 0)
  // ── accessibility: honor prefers-reduced-motion + a polite live region for screen readers ──
  const reduceMotion = (() => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } })();
  const liveRegion = (() => { const d = document.createElement("div"); d.setAttribute("role", "status"); d.setAttribute("aria-live", "polite"); d.style.cssText = "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0"; (kernel.parent || document.body).appendChild(d); return d; })();
  let _lastSpoken = "";
  function announce(msg) { if (!msg || msg === _lastSpoken) return; _lastSpoken = msg; liveRegion.textContent = msg; }
  // ── UNDO (offline only — a networked game can't be unilaterally rewound) ──
  let undoStack = [];
  function pushUndo() { if (netMode) return; try { undoStack.push(serializeState()); if (undoStack.length > 20) undoStack.shift(); } catch (e) {} }
  function undoTurn() {
    if (netMode || (phase !== "play" && phase !== "setup") || !undoStack.length) return false;
    loadState(undoStack.pop());
    buildMode = null; relicMode = null; diceState = null;
    refreshMarkers(); updateHud(); saveGame(); announce("Turn undone.");
    return true;
  }
  function updateHud() {
    renderCards(); renderRelicShelf();
    topBar.style.display = "block";
    const chips = SEATS.map((s, i) => {
      const c = i === curSeat && phase !== "ended";
      const rc = (relics[i] ? relics[i].length : 0) + (relicPlayed[i] ? relicPlayed[i].sigil : 0);   // face-down relic count (unplayed + hidden crowns)
      const extra = (rc ? ` <span style="color:#c9a6ea;font-size:12px">✦${rc}</span>` : "") + (stormWardenSeat === i ? ` <span title="Storm Warden +2★" style="color:#f0d27a;font-size:12px">⚔</span>` : "");
      return `<span style="display:inline-block;margin:0 5px;padding:5px 13px;border-radius:20px;background:${c ? "rgba(127,224,245,.16)" : "rgba(8,16,30,.62)"};border:1px solid ${c ? "#7fe0f5" : "#33465f"};color:#${s.color.toString(16).padStart(6, "0")};font-weight:800;font-size:14px;box-shadow:${c ? "0 0 14px rgba(127,224,245,.35)" : "none"}">${c ? "▸ " : ""}${s.name} <span style="opacity:.85">${A.vpFor(buildings, i)}★</span>${extra}</span>`;
    }).join("");
    const cur = SEATS[curSeat] ? SEATS[curSeat].name : "";
    let msg;
    if (phase === "firstroll") { const n = SEATS[frSeat] ? SEATS[frSeat].name : ""; msg = frSeat >= SEATS.length ? "Deciding who founds first…" : (SEATS[frSeat].ai ? `${n} is rolling for turn order…` : `${n} — roll the dice to decide who founds first`); }
    else if (phase === "setup") msg = (SEATS[curSeat].ai || _notMyNetTurn()) ? `${cur} is founding a colony…` : (setupSub === "road" ? `${cur} — now click a glowing bridge to lay your road` : `${cur} — click a glowing corner to found a settlement`);
    else if (phase === "ended") msg = "Game over";
    else msg = (SEATS[curSeat].ai || _notMyNetTurn()) ? `${cur} is playing…` : (rolled ? `${cur === "You" ? "Your" : cur + "'s"} turn — build, or end your turn` : `${cur} — roll the dice to begin`);
    topBar.innerHTML = `<div>${chips}</div><div style="margin-top:7px;display:inline-block;background:rgba(8,16,30,.72);border-radius:8px;padding:4px 15px;color:#cfe3f0;font-size:13px;font-weight:600">${msg}${lastRoll ? "　·　🎲 " + lastRoll : ""}</div>`;
    announce(`${msg}${lastRoll ? ". Rolled " + lastRoll : ""}. Stars: ` + SEATS.map((s, i) => `${s.name} ${A.vpFor(buildings, i)}`).join(", "));
    renderActionBar();
  }
  function renderActionBar() {
    if (phase !== "play" || SEATS[curSeat].ai || !rolled || _notMyNetTurn()) { actionBar.style.display = "none"; return; }
    actionBar.style.display = "block";
    if (relicMode) {   // a relic targeting flow owns the board — offer only a clear way out
      const hint = relicMode.type === "stormWard" ? "Storm-Ward — click an isle" : `Skybridge — road ${relicMode.placed + 1} of 2`;
      actionBar.innerHTML = `<span style="display:inline-block;margin:0 10px;color:#c9b6ea;font:700 13px 'Segoe UI';vertical-align:middle">✦ ${hint}</span><button data-a="cancelrelic" style="pointer-events:auto;cursor:pointer;padding:9px 18px;border-radius:11px;border:1px solid #b06cf0;background:rgba(30,16,46,.9);color:#e7d6ff;font:800 13px 'Segoe UI'">✕ Cancel</button>`;
      actionBar.querySelector("[data-a=cancelrelic]").onclick = () => cancelRelic();
      return;
    }
    const r = res[curSeat];
    const btn = (id, label, cost, afford, active) => `<button data-a="${id}" ${afford ? "" : "disabled"} style="pointer-events:auto;cursor:${afford ? "pointer" : "not-allowed"};margin:0 4px;padding:9px 15px;border-radius:11px;border:1px solid ${active ? "#7fe0f5" : afford ? "#5a7a92" : "#2a3340"};background:${active ? "linear-gradient(#2a5a72,#173a4e)" : afford ? "rgba(16,28,46,.92)" : "rgba(14,18,26,.7)"};color:${afford ? "#eaf4ff" : "#556575"};font:700 13px 'Segoe UI'">${label} <span style="opacity:.6;font-size:11px">${cost}</span></button>`;
    const deckEmpty = relicPtr >= relicDeck.length, canRelic = !deckEmpty && A.canAfford(r, "relic");
    actionBar.innerHTML =
      btn("road", "🛤 Road", "🌲🧱", A.canAfford(r, "road"), buildMode === "road") +
      btn("settlement", "🏠 Settle", "🌲🧱🌾🐑", A.canAfford(r, "settlement"), buildMode === "settlement") +
      btn("city", "🏛 City", "🌾🌾🔮🔮🔮", A.canAfford(r, "city"), buildMode === "city") +
      `<button data-a="buyrelic" ${canRelic ? "" : "disabled"} style="pointer-events:auto;cursor:${canRelic ? "pointer" : "not-allowed"};margin:0 4px 0 10px;padding:9px 15px;border-radius:11px;border:1px solid ${canRelic ? "#b06cf0" : "#3a2a4a"};background:${canRelic ? "linear-gradient(#4a2a72,#2e1a4e)" : "rgba(20,14,28,.7)"};color:${canRelic ? "#f0e0ff" : "#6a5a7a"};font:700 13px 'Segoe UI'">✦ ${deckEmpty ? "No relics" : "Relic"} <span style="opacity:.6;font-size:11px">${deckEmpty ? "" : "🔮🌾🐑"}</span></button>` +
      `<button data-a="trade" style="pointer-events:auto;cursor:pointer;margin:0 4px 0 10px;padding:9px 15px;border-radius:11px;border:1px solid #7fe0f5;background:linear-gradient(#20506a,#123448);color:#dfeaff;font:700 13px 'Segoe UI'">🤝 Trade</button>` +
      `<button data-a="end" style="pointer-events:auto;cursor:pointer;margin:0 4px 0 12px;padding:9px 20px;border-radius:11px;border:1px solid #7CFC9A;background:linear-gradient(#3aa85a,#237a3f);color:#eafff0;font:800 13px 'Segoe UI'">End Turn ▸</button>` +
      (!netMode && undoStack.length ? `<button data-a="undo" style="pointer-events:auto;cursor:pointer;margin:0 4px 0 8px;padding:9px 15px;border-radius:11px;border:1px solid #5a7a92;background:rgba(16,28,46,.92);color:#eaf4ff;font:700 13px 'Segoe UI'">↶ Undo</button>` : "");
    const LBL = { trade: "Open the trade panel", road: "Build a road", settlement: "Build a settlement", city: "Upgrade a settlement to a city", buyrelic: "Buy an Aether Relic", end: "End your turn", undo: "Undo your turn" };
    actionBar.querySelectorAll("button").forEach((b) => {
      const a = b.dataset.a; b.setAttribute("aria-label", LBL[a] || a);
      b.onclick = () => { if (a === "trade") openTrade(); else if (a === "end") endTurn(); else if (a === "buyrelic") buyRelic(curSeat); else if (a === "undo") undoTurn(); else { buildMode = buildMode === a ? null : a; refreshMarkers(); } };
    });
  }

  function refreshMarkers() {
    const stormT = relicMode && relicMode.type === "stormWard" && SEATS[curSeat] && !SEATS[curSeat].ai;
    hexRings.forEach((r, i) => r.visible = !!stormT && i !== stormHex);
    if (relicMode) {
      for (const m of vMarks) m.visible = false;
      for (const m of eMarks) { const e = m.userData.edge; m.visible = relicMode.type === "leyLine" && !SEATS[curSeat].ai && A.canRoad(board, buildings, roads, e, curSeat, A.roadNetwork(roads, curSeat)); }
      updateHud(); return;
    }
    const human = (netMode ? _actingSeat() === mySeat : !SEATS[curSeat].ai), setupSettle = phase === "setup" && setupSub === "settle";
    for (const m of vMarks) {
      const vid = m.userData.vid; let ok = false, show = false;
      if (setupSettle) { ok = A.canSettle(board, buildings, vid); show = human; }
      else if (phase === "play" && buildMode === "settlement") { ok = A.canBuildSettlement(board, buildings, roads, vid, curSeat) && A.canAfford(res[curSeat], "settlement"); show = human; }
      else if (phase === "play" && buildMode === "city") { ok = A.canBuildCity(buildings, vid, curSeat) && A.canAfford(res[curSeat], "city"); show = human; }
      m.material = ok ? vOk : vIdle; m.visible = show;
    }
    const setupRoadP = phase === "setup" && setupSub === "road" && human, playRoad = human && phase === "play" && buildMode === "road";
    for (const m of eMarks) { const e = m.userData.edge;
      if (setupRoadP) m.visible = (e.a === pendingV || e.b === pendingV) && roads[e.a + "-" + e.b] === undefined;
      else m.visible = playRoad && A.canRoad(board, buildings, roads, e, curSeat, A.roadNetwork(roads, curSeat)) && A.canAfford(res[curSeat], "road");
    }
    updateHud();
  }
  function placeSettlement(vId, seat, isSetup) {
    buildings[vId] = { seat, kind: "settlement" };
    const v = board.vertices[vId], mesh = makeSettlement(seat); mesh.position.set(v.x * SCALE, TOPY + 0.4, v.z * SCALE); bGroup.add(mesh); bldMesh[vId] = mesh;
    if (isSetup) { for (const hi of v.hexes) { const h = board.hexes[hi]; if (h.res !== A.WILD) res[seat][h.res] += 1; } }   // road is chosen separately (setupRoad)
    if (seat === localSeat()) ach("first_settlement");
  }
  function upgradeCity(vId, seat) { buildings[vId].kind = "city"; bGroup.remove(bldMesh[vId]); const v = board.vertices[vId], mesh = makeCity(seat); mesh.position.set(v.x * SCALE, TOPY + 0.4, v.z * SCALE); bGroup.add(mesh); bldMesh[vId] = mesh; if (seat === localSeat()) ach("crystal_city"); }
  function placeRoad(edge, seat) {
    const ek = edge.a + "-" + edge.b; if (roads[ek] !== undefined) return; roads[ek] = seat;
    const va = board.vertices[edge.a], vb = board.vertices[edge.b], ax = va.x * SCALE, az = va.z * SCALE, bx = vb.x * SCALE, bz = vb.z * SCALE, len = Math.hypot(bx - ax, bz - az) * 0.82, grp = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.34), new THREE.MeshStandardMaterial({ color: 0x6a5030, roughness: 0.75, flatShading: true })); grp.add(deck);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.1), new THREE.MeshStandardMaterial({ color: SEATS[seat].color, emissive: new THREE.Color(SEATS[seat].color), emissiveIntensity: 0.55, roughness: 0.4 })); rail.position.y = 0.09; grp.add(rail);
    grp.position.set((ax + bx) / 2, TOPY + 0.28, (az + bz) / 2); grp.rotation.y = -Math.atan2(bz - az, bx - ax); bGroup.add(grp);
  }
  function flashHex(i) { const g = isleGroups[i], ring = new THREE.Mesh(new THREE.RingGeometry(SCALE * 0.8, SCALE * 1.05, 18), new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.set(g.position.x, TOPY + 0.3, g.position.z); world.add(ring); let life = 0.8; kernel.onUpdate((dt) => { life -= dt; ring.scale.multiplyScalar(1 + dt); ring.material.opacity = Math.max(0, life); if (life <= 0) world.remove(ring); }); }

  function roll(forced) { if (rolled || phase !== "play") return 0; const r = forced || (1 + (rng() * 6 | 0)) + (1 + (rng() * 6 | 0)); lastRoll = r; rolled = true; for (const o of A.produce(board, buildings, r, stormHex)) res[o.seat][o.res] += o.amount; board.hexes.forEach((h, i) => { if (h.token === r && h.res !== A.WILD && i !== stormHex) flashHex(i); }); refreshMarkers(); bcast({ kind: "roll" }, { roll: r }, curSeat); return r; }
  function build(kind, target) {
    if (phase !== "play" || !rolled) return false;
    if (kind === "road") { if (!A.canRoad(board, buildings, roads, target, curSeat, A.roadNetwork(roads, curSeat)) || !A.canAfford(res[curSeat], "road")) return false; A.pay(res[curSeat], "road"); placeRoad(target, curSeat); }
    else if (kind === "settlement") { if (!A.canBuildSettlement(board, buildings, roads, target, curSeat) || !A.canAfford(res[curSeat], "settlement")) return false; A.pay(res[curSeat], "settlement"); placeSettlement(target, curSeat, false); }
    else if (kind === "city") { if (!A.canBuildCity(buildings, target, curSeat) || !A.canAfford(res[curSeat], "city")) return false; A.pay(res[curSeat], "city"); upgradeCity(target, curSeat); }
    else return false;
    const won = checkWin();   // checkWin BEFORE bcast so phase==="ended" when seatplay.localMoved tests isOver()
    bcast({ kind: "build", bkind: kind, target: kind === "road" ? { a: target.a, b: target.b } : target }, null, curSeat);
    if (!won) refreshMarkers(); return true;
  }
  function checkWin() {
    const st = rState();
    for (let s = 0; s < SEATS.length; s++) {
      if (A.totalVpFor(st, buildings, s) < WIN_VP) continue;
      phase = "ended"; clearSave(); relicMode = null; updateHud();
      const me = localSeat(), iWon = s === me;
      // leaderboard: a win scores 1000 minus turns taken (fast wins rank higher); a loss scores your VP.
      submitFinalScore(iWon ? Math.max(100, 1000 - turn * 5) : A.totalVpFor(st, buildings, me) * 10);
      if (iWon) { ach("isles_ruler"); if (SEATS.length === 5) ach("crown_of_isles"); }
      announce(`Game over. ${SEATS[s].name} reaches ${WIN_VP} stars.`);
      if (!netMode && shell) shell.end(iWon, `${SEATS[s].name} reaches ${WIN_VP}★ — victory!`);
      return true;
    }
    return false;
  }
  function endTurn() { if (phase !== "play" || relicMode) return; rolled = false; buildMode = null; lastRoll = 0; turn += 1; const next = (curSeat + 1) % SEATS.length; curSeat = next; startTurn(); bcast({ kind: "endTurn" }, null, next); saveGame(); }
  function startTurn() { if (phase !== "play") return; rolled = false; buildMode = null; if (!netMode && !SEATS[curSeat].ai) pushUndo(); refreshMarkers(); if (!netMode && SEATS[curSeat].ai) setTimeout(aiTurn, 700); }
  // AI uses the BANK/skyports to close its own build gap. It never cold-calls the human with
  // offers (no spam) — the player initiates player trades, and the AI judges them via evaluateTrade.
  function aiTradePhase() {
    const seat = curSeat, diff = difficultyKey();
    if (!SEATS[seat] || !SEATS[seat].ai || phase !== "play") return;
    for (let guard = 0; guard < 3; guard++) {
      const goal = A.nearestGoal(res[seat]);
      if (!goal || !goal.need || !goal.missing) return;
      if (diff === "gentle" && goal.missing > 1) return;          // a gentle AI only fixes a 1-card gap
      const wantRes = Object.keys(goal.need)[0];
      let give = null, rate = 99;
      for (const k of RES5) {
        if (k === wantRes || goal.need[k]) continue;              // never trade away what the goal needs
        const rr = A.tradeRate(PORTS, buildings, seat, k);
        if ((res[seat][k] || 0) - rr >= 0 && rr < rate) { rate = rr; give = k; }
      }
      if (!give || !A.doBankTrade(res[seat], PORTS, buildings, seat, give, wantRes)) return;
      bcast({ kind: "bankTrade", give, get: wantRes }, null, curSeat);
      relicToast(SEATS[seat].name + " trades " + rate + "x " + RES_LABEL[give] + " for " + RES_LABEL[wantRes], SEATS[seat].color);
    }
  }
  function aiTurn() {
    if (phase !== "play" || !SEATS[curSeat].ai) return;
    roll();
    aiRelicPhase();
    aiTradePhase();
    let acted = true;
    while (acted && phase === "play") {
      acted = false;
      for (const vId in buildings) { if (A.canBuildCity(buildings, +vId, curSeat) && A.canAfford(res[curSeat], "city")) { build("city", +vId); acted = true; break; } }
      if (acted) continue;
      for (const v of board.vertices) { if (A.canBuildSettlement(board, buildings, roads, v.id, curSeat) && A.canAfford(res[curSeat], "settlement")) { build("settlement", v.id); acted = true; break; } }
      if (acted) continue;
      for (const e of board.edges) { if (A.canRoad(board, buildings, roads, e, curSeat, A.roadNetwork(roads, curSeat)) && A.canAfford(res[curSeat], "road")) { build("road", e); acted = true; break; } }
    }
    if (phase === "play") endTurn();
  }

  // Setup AI is driven LOCALLY by whoever owns AI (offline: this client; online: the HOST). Snake-draft setup has
  // consecutive same-seat turns (next===actor -> seatplay fires NO _dispatch), so it can't be driven off _dispatch.
  // ── OPENING ROLL: like the real game, everyone rolls for turn order before anything is placed.
  // Highest total founds first (ties: earliest seat). Offline only — online keeps the deterministic
  // seat-0 start so every client agrees with zero extra messages.
  function beginFirstRoll() {
    if (netMode) { firstSeat = 0; beginSetup(0); return; }
    phase = "firstroll"; frRolls = []; frSeat = 0; curSeat = 0; diceState = null;
    refreshMarkers(); updateHud();
    if (SEATS[0].ai) setTimeout(() => forceRollDice(), 700);
  }
  function forceRollDice() { if (diceState || phase !== "firstroll") return; diceState = { t: 0, d1: 1 + (Math.random() * 6 | 0), d2: 1 + (Math.random() * 6 | 0) }; }
  function firstRollLanded(tot) {
    frRolls[frSeat] = tot;
    relicToast(`🎲 ${SEATS[frSeat].name} rolled ${tot}`, SEATS[frSeat].color);
    frSeat++;
    if (frSeat < SEATS.length) {
      curSeat = frSeat; refreshMarkers(); updateHud();
      if (SEATS[frSeat].ai) setTimeout(() => forceRollDice(), 800);
      return;
    }
    let best = 0; for (let i = 1; i < frRolls.length; i++) if (frRolls[i] > frRolls[best]) best = i;
    firstSeat = best;
    relicToast(`🏆 ${SEATS[best].name} rolled highest — founds first!`, SEATS[best].color);
    announce(`${SEATS[best].name} rolled highest and goes first.`);
    setTimeout(() => beginSetup(best), 1200);
  }
  function beginSetup(startSeat) {
    const N = SEATS.length, s0 = ((startSeat | 0) % N + N) % N;
    firstSeat = s0; phase = "setup"; setupSub = "settle"; pendingV = -1;
    setupOrder = [];
    for (let i = 0; i < N; i++) setupOrder.push((s0 + i) % N);          // snake draft, starting with the roll winner
    for (let i = N - 1; i >= 0; i--) setupOrder.push((s0 + i) % N);
    setupIdx = 0; curSeat = setupOrder[0]; refreshMarkers();
    if (_drivesAI() && SEATS[curSeat] && SEATS[curSeat].ai) setTimeout(aiSetup, 600);
  }
  function setupPlace(vId) { if (setupSub !== "settle" || !A.canSettle(board, buildings, vId)) return false; placeSettlement(vId, setupOrder[setupIdx], true); pendingV = vId; setupSub = "road"; refreshMarkers(); bcast({ kind: "setupPlace", vId }, null, setupOrder[setupIdx]); return true; }   // next = SAME seat (setupPlace does not advance the seat)
  function setupRoad(edge) {
    if (setupSub !== "road" || !(edge.a === pendingV || edge.b === pendingV) || roads[edge.a + "-" + edge.b] !== undefined) return false;
    placeRoad(edge, setupOrder[setupIdx]); pendingV = -1; setupSub = "settle"; setupIdx++;
    let next;
    if (setupIdx >= setupOrder.length) { next = firstSeat; phase = "play"; curSeat = firstSeat; startTurn(); }   // setup done -> play starts with the roll winner
    else { next = setupOrder[setupIdx]; curSeat = next; refreshMarkers(); if (_drivesAI() && SEATS[curSeat] && SEATS[curSeat].ai) setTimeout(aiSetup, 600); }   // host re-drives the next setup AI locally (covers snake-draft consecutive AI turns)
    bcast({ kind: "setupRoad", edge: { a: edge.a, b: edge.b } }, null, next);   // next captured before dispatch: seat 0 (play) OR the new setup actor
    saveGame();
    return true;
  }
  function aiSetup() { if (phase !== "setup") return; const v = board.vertices.find((v) => A.canSettle(board, buildings, v.id)); if (!v) return; setupPlace(v.id); const e = board.edges.find((e) => (e.a === v.id || e.b === v.id) && roads[e.a + "-" + e.b] === undefined); if (e) setTimeout(() => setupRoad(e), 380); }

  // ── 3D dice (click to roll) ──
  function dieFaceTex(n) {
    const cv = document.createElement("canvas"); cv.width = cv.height = 128; const c = cv.getContext("2d");
    c.fillStyle = "#f5f2e9"; const rr = 22; c.beginPath(); c.moveTo(rr, 0); c.arcTo(128, 0, 128, 128, rr); c.arcTo(128, 128, 0, 128, rr); c.arcTo(0, 128, 0, 0, rr); c.arcTo(0, 0, 128, 0, rr); c.fill();
    c.fillStyle = "#1a1a1a"; const pip = (x, y) => { c.beginPath(); c.arc(x, y, 13, 0, 7); c.fill(); };
    ({ 1: [[64, 64]], 2: [[38, 38], [90, 90]], 3: [[34, 34], [64, 64], [94, 94]], 4: [[38, 38], [90, 38], [38, 90], [90, 90]], 5: [[38, 38], [90, 38], [64, 64], [38, 90], [90, 90]], 6: [[38, 34], [90, 34], [38, 64], [90, 64], [38, 94], [90, 94]] })[n].forEach((p) => pip(p[0], p[1]));
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const dieMats = [3, 4, 1, 6, 2, 5].map((n) => new THREE.MeshStandardMaterial({ map: dieFaceTex(n), roughness: 0.42 }));   // faces +x,-x,+y,-y,+z,-z (opposite sum 7)
  const ORIENT = { 1: [0, 0, 0], 6: [Math.PI, 0, 0], 3: [0, 0, Math.PI / 2], 4: [0, 0, -Math.PI / 2], 2: [-Math.PI / 2, 0, 0], 5: [Math.PI / 2, 0, 0] };
  const diceMeshes = [], diceGroup = new THREE.Group(); diceGroup.position.set(0, TOPY + 3.2, SCALE * 3.4); scene.add(diceGroup);
  for (const dx of [-0.9, 0.9]) { const d = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), dieMats); d.position.x = dx; d.rotation.set(0.3, 0.5, 0); d.castShadow = true; diceGroup.add(d); diceMeshes.push(d); }
  const dGlow = new THREE.Mesh(new THREE.RingGeometry(1.5, 2.3, 26), new THREE.MeshBasicMaterial({ color: 0x7fe0f5, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })); dGlow.rotation.x = -Math.PI / 2; dGlow.position.y = -0.85; diceGroup.add(dGlow);
  let diceState = null;
  // the opening roll uses the same dice: it's rollable when THIS seat is a local human awaiting its turn-order roll
  function canRoll() {
    if (diceState) return false;
    if (phase === "firstroll") return !netMode && frSeat < SEATS.length && !SEATS[frSeat].ai;
    return phase === "play" && !rolled && !_blocked();
  }
  function rollDice() { if (!canRoll()) return; if (phase === "firstroll") { forceRollDice(); return; } diceState = { t: 0, d1: 1 + (rng() * 6 | 0), d2: 1 + (rng() * 6 | 0) }; }

  // ── input ──
  const ray = new THREE.Raycaster();
  function pick(cx, cy, objs) { const rect = kernel.renderer.domElement.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1), camera); const h = ray.intersectObjects(objs.filter((o) => o.visible), false); return h.length ? h[0].object.userData : null; }
  function pickHex(cx, cy) { const rect = kernel.renderer.domElement.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1), camera); const hits = ray.intersectObjects(isleGroups, true); for (const h of hits) { let o = h.object; while (o) { if (o.userData && o.userData.hi !== undefined && !o.userData.deco) return o.userData.hi; o = o.parent; } } return -1; }
  kernel.renderer.domElement.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || _blocked()) return;
    if (relicMode) { if (relicMode.type === "stormWard") { const hi = pickHex(e.clientX, e.clientY); if (hi >= 0) doStormWard(hi); } else if (relicMode.type === "leyLine") { const u = pick(e.clientX, e.clientY, eMarks); if (u) placeFreeRoad(u.edge); } return; }
    if (canRoll()) { const rect = kernel.renderer.domElement.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera); if (ray.intersectObjects(diceMeshes, false).length) { rollDice(); return; } }
    if (phase === "setup") { if (setupSub === "settle") { const u = pick(e.clientX, e.clientY, vMarks); if (u) setupPlace(u.vid); } else { const u = pick(e.clientX, e.clientY, eMarks); if (u) setupRoad(u.edge); } }
    else if (phase === "play" && buildMode) { if (buildMode === "road") { const u = pick(e.clientX, e.clientY, eMarks); if (u) build("road", u.edge); } else { const u = pick(e.clientX, e.clientY, vMarks); if (u) build(buildMode, u.vid); } }
  });
  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { e.preventDefault(); undoTurn(); return; }   // Ctrl/Cmd+Z = undo your turn
    if (phase === "firstroll") { if (e.code === "Space") { e.preventDefault(); rollDice(); } return; }   // SPACE also rolls for turn order
    if (_blocked() || phase !== "play") return;
    if (e.code === "Escape") { cancelRelic(); return; }
    if (relicMode) return;   // a relic targeting flow owns input; Esc cancels
    if (e.code === "Space") { e.preventDefault(); rollDice(); }
    else if (e.code === "KeyE") { endTurn(); }
    else if (e.code === "Digit1") { buildMode = "road"; refreshMarkers(); }
    else if (e.code === "Digit2") { buildMode = "settlement"; refreshMarkers(); }
    else if (e.code === "Digit3") { buildMode = "city"; refreshMarkers(); }
    else if (e.code === "Digit4") { buyRelic(curSeat); }
    else if (e.code === "KeyT") { openTrade(); }
  });

  let tt = 0; kernel.onUpdate((dt) => {
    tt += dt; for (const g of isleGroups) g.position.y = (g.userData.y0 || 0) + Math.sin(tt * 0.5 + g.userData.bob) * 0.2; for (const s of spinners) s.rotation.y += dt * 0.8;
    if (diceState) { diceState.t += dt; if (diceState.t < 0.85) { for (const d of diceMeshes) { d.rotation.x += dt * 15; d.rotation.y += dt * 12; d.rotation.z += dt * 9; } } else { const o1 = ORIENT[diceState.d1], o2 = ORIENT[diceState.d2]; diceMeshes[0].rotation.set(o1[0], o1[1], o1[2]); diceMeshes[1].rotation.set(o2[0], o2[1], o2[2]); const tot = diceState.d1 + diceState.d2; diceState = null; if (phase === "firstroll") firstRollLanded(tot); else roll(tot); } }
    dGlow.visible = canRoll(); if (dGlow.visible) dGlow.material.opacity = reduceMotion ? 0.5 : 0.28 + Math.abs(Math.sin(tt * 3)) * 0.32;
  });
  camera.fov = 44; camera.updateProjectionMatrix(); camera.position.set(0, 30, 30);
  const orbit = kernel.enableOrbit({ target: { x: 0, y: 0, z: 0 }, minDistance: SCALE * 3.5, maxDistance: SCALE * 14, minPolarAngle: 0.16, maxPolarAngle: Math.PI * 0.47, rotateButton: "right", autoRotate: !reduceMotion, autoRotateSpeed: 0.3, wasdPan: true });
  if (kernel.enableBloom) kernel.enableBloom({ ssao: false, strength: 0.28, radius: 0.55, threshold: 0.88 });   // dialed WAY back — owner: "too much glow"

  /* ══════════════════════ AETHER RELICS — renderer layer ══════════════════════ */
  const RELIC_ART = { stormWard: "assets/cards/relic_stormward.jpg", sigil: "assets/cards/relic_sigil.jpg", leyLine: "assets/cards/relic_leyline.jpg", bounty: "assets/cards/relic_bounty.jpg", levy: "assets/cards/relic_levy.jpg" };
  const RELIC_NAME = { stormWard: "Storm-Ward", sigil: "Crown", leyLine: "Skybridge", bounty: "Bounty", levy: "Tithe" };
  // Storm Spirit 3D token (only appears once a Storm-Ward is played) + per-hex violet target rings.
  const stormToken = (() => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 0), new THREE.MeshStandardMaterial({ color: 0x2a1840, emissive: new THREE.Color(0x7030b8), emissiveIntensity: 0.75, roughness: 0.5, flatShading: true })));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.1, 8, 20), new THREE.MeshBasicMaterial({ color: 0xb06cf0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = Math.PI / 2; g.add(ring); spinners.push(ring);
    g.visible = false; world.add(g); return g;
  })();
  function moveStorm(hi) { stormHex = hi; const p = isleGroups[hi].position; stormToken.position.set(p.x, TOPY + 1.4, p.z); stormToken.visible = true; }
  let hexRings = [];
  function buildHexRings() { hexRings = board.hexes.map((h) => { const r = new THREE.Mesh(new THREE.RingGeometry(SCALE * 0.55, SCALE * 0.82, 20), new THREE.MeshBasicMaterial({ color: 0xb06cf0, transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); r.rotation.x = -Math.PI / 2; r.position.set(h.cx * SCALE, TOPY + 0.4, h.cz * SCALE); r.visible = false; world.add(r); return r; }); }
  buildHexRings();

  // relic DOM: right-anchored shelf, a shared modal overlay, and a toast — violet/gold so they never read as cyan resource cards
  const relStyle = document.createElement("style"); relStyle.textContent = "@keyframes relpulse{0%,100%{box-shadow:0 0 0 1px #f0d27a55,0 3px 10px rgba(0,0,0,.6)}50%{box-shadow:0 0 11px 2px #b06cf0cc,0 3px 10px rgba(0,0,0,.6)}}"; document.head.appendChild(relStyle);
  const relicShelf = document.createElement("div"); relicShelf.style.cssText = "position:absolute;bottom:92px;right:16px;z-index:44;font-family:'Segoe UI';pointer-events:auto"; (kernel.parent || document.body).appendChild(relicShelf); relicShelf.style.display = "none";
  const relicOv = document.createElement("div"); relicOv.style.cssText = "position:absolute;inset:0;z-index:61;display:none;align-items:center;justify-content:center;background:rgba(6,4,14,.5);font-family:'Segoe UI'"; (kernel.parent || document.body).appendChild(relicOv);
  function closeRelicOv() { relicOv.style.display = "none"; relicOv.innerHTML = ""; }
  const relicToastEl = document.createElement("div"); relicToastEl.style.cssText = "position:absolute;top:98px;left:0;right:0;text-align:center;z-index:62;font-family:'Segoe UI';pointer-events:none;display:none"; (kernel.parent || document.body).appendChild(relicToastEl);
  let toastT = null;
  function relicToast(msg, color) { relicToastEl.style.display = "block"; relicToastEl.innerHTML = `<span style="display:inline-block;background:rgba(20,10,34,.94);border:1px solid #b06cf0;border-radius:20px;padding:8px 20px;color:#${(color || 0xf0d27a).toString(16).padStart(6, "0")};font:800 14px 'Segoe UI';box-shadow:0 4px 18px rgba(0,0,0,.5)">${msg}</span>`; if (toastT) clearTimeout(toastT); toastT = setTimeout(() => { relicToastEl.style.display = "none"; }, 2300); }

  function renderRelicShelf() {
    const show = (phase === "play" || phase === "setup") && SEATS[curSeat] && !SEATS[curSeat].ai && !_notMyNetTurn();
    const hand = show ? (relics[curSeat] || []) : [];
    if (!hand.length) { relicShelf.style.display = "none"; return; }
    relicShelf.style.display = "block";
    let h = `<div style="text-align:right;color:#f0d27a;font:800 10px 'Segoe UI';letter-spacing:2px;margin-bottom:4px">✦ RELICS</div><div style="display:flex;gap:6px;justify-content:flex-end">`;
    hand.forEach((card, idx) => {
      const playable = A.canPlayRelic(rState(), curSeat, card, rolled), sealed = card.boughtTurn >= turn;
      h += `<div data-ci="${idx}" style="position:relative;width:52px;height:74px;border-radius:8px;overflow:hidden;border:2px solid #b06cf0;box-shadow:0 0 0 1px #f0d27a55,0 3px 10px rgba(0,0,0,.6);cursor:${playable ? "pointer" : "default"};opacity:${playable ? 1 : 0.5};${playable ? "animation:relpulse 1.6s ease-in-out infinite" : ""}"><img src="${RELIC_ART[card.type]}" style="width:100%;height:100%;object-fit:cover"><div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,#1a0e2ee0);color:#f0d27a;font:800 9px 'Segoe UI';text-align:center;padding:7px 0 2px">${RELIC_NAME[card.type]}</div>${sealed ? `<div style="position:absolute;top:2px;right:3px;font-size:12px">🔒</div>` : ""}</div>`;
    });
    relicShelf.innerHTML = h + "</div>";
    relicShelf.querySelectorAll("[data-ci]").forEach((el) => el.onclick = () => startPlayRelic(+el.dataset.ci));
  }

  function buyRelic(seat) {
    if (phase !== "play" || !rolled || relicMode) return false;
    if (!A.canAfford(res[seat], "relic") || relicPtr >= relicDeck.length) return false;
    const idx = relicPtr, type = relicDeck[idx];
    A.pay(res[seat], "relic"); relicPtr = idx + 1;
    if (seat === localSeat()) { ach("relic_seeker"); if (type === "sigil") ach("crown_shard"); }
    let won = false;
    if (type === "sigil") { relicPlayed[seat].sigil += 1; relicToast(SEATS[seat].ai ? `✦ ${SEATS[seat].name} draws a relic` : `✦ You claim a Crown Shard (+1★, secret)`, SEATS[seat].color); won = checkWin(); }
    else { relics[seat].push({ id: idx, type, boughtTurn: turn }); relicToast(SEATS[seat].ai ? `✦ ${SEATS[seat].name} buys a relic` : `✦ New relic: ${RELIC_NAME[type]} — charging, ready next turn`, SEATS[seat].color); }
    bcast({ kind: "buyRelic" }, { type }, curSeat);   // ship drawn type as a desync assertion; relicPtr is the lockstep counter (receiver re-draws same)
    if (!won) refreshMarkers(); return true;
  }

  function startPlayRelic(idx) {
    if (SEATS[curSeat].ai || relicMode || _notMyNetTurn()) return;
    const card = relics[curSeat][idx]; if (!card || !A.canPlayRelic(rState(), curSeat, card, rolled)) return;
    if (card.type === "bounty") openBountyModal(idx);
    else if (card.type === "levy") openLevyModal(idx);
    else if (card.type === "stormWard") { relicMode = { type: "stormWard", idx }; refreshMarkers(); relicToast("Storm-Ward — click an isle to send the Storm", 0xb06cf0); }
    else if (card.type === "leyLine") { relicMode = { type: "leyLine", idx, left: 2, placed: 0, edges: [] }; refreshMarkers(); relicToast("Skybridge — place 2 free roads", 0xb06cf0); }
  }
  function finishRelicPlay(seat, idx) { if (relics[seat] && relics[seat][idx]) relics[seat].splice(idx, 1); relicPlayedTurn[seat] = turn; }
  function cancelRelic() {
    if (relicMode) { if (relicMode.type === "leyLine" && relicMode.placed > 0) { relicPlayed[curSeat].leyLine += 1; finishRelicPlay(curSeat, relicMode.idx); bcast({ kind: "playRelic", relicType: "leyLine", choices: { edges: relicMode.edges } }, null, curSeat); } relicMode = null; refreshMarkers(); }
    closeRelicOv();
  }
  function openBountyModal(idx) {
    const picks = [];
    const draw = () => {
      relicOv.style.display = "flex";
      relicOv.innerHTML = `<div style="background:rgba(14,8,26,.97);border:1px solid #b06cf0;border-radius:16px;padding:24px 30px;text-align:center;color:#dfeaff;box-shadow:0 12px 40px rgba(0,0,0,.6)"><div style="font:800 18px 'Segoe UI';color:#f0d27a;letter-spacing:1px;margin-bottom:4px">✦ AETHER BOUNTY</div><div style="opacity:.8;font-size:13px;margin-bottom:14px">Call down 2 gifts — pick ${2 - picks.length} more</div><div style="display:flex;gap:9px;justify-content:center;margin-bottom:16px">${RES5.map((r) => `<div data-r="${r}" style="cursor:pointer;width:60px;height:84px;border-radius:9px;overflow:hidden;border:2px solid ${picks.includes(r) ? "#f0d27a" : "#7fe0f5aa"};position:relative"><img src="${CARD_IMG[r]}" style="width:100%;height:100%;object-fit:cover">${picks.filter((x) => x === r).length ? `<span style="position:absolute;top:2px;right:4px;color:#f0d27a;font:800 15px 'Segoe UI';text-shadow:0 1px 3px #000">+${picks.filter((x) => x === r).length}</span>` : ""}</div>`).join("")}</div><button data-a="cancel" style="cursor:pointer;padding:7px 18px;border-radius:8px;border:1px solid #55617a;background:rgba(20,26,40,.8);color:#cdd8ea;font:700 12px 'Segoe UI'">✕ Cancel</button></div>`;
      relicOv.querySelectorAll("[data-r]").forEach((el) => el.onclick = () => { if (picks.length < 2) { picks.push(el.dataset.r); if (picks.length === 2) { const st = rState(); A.playBounty(st, curSeat, { picks }); finishRelicPlay(curSeat, idx); bcast({ kind: "playRelic", relicType: "bounty", choices: { picks: picks.slice() } }, null, curSeat); closeRelicOv(); relicToast(`✦ Bounty: +${ICON[picks[0]]} +${ICON[picks[1]]}`, SEATS[curSeat].color); refreshMarkers(); } else draw(); } });
      relicOv.querySelector("[data-a=cancel]").onclick = () => closeRelicOv();
    };
    draw();
  }
  function openLevyModal(idx) {
    let sel = null;
    const draw = () => {
      relicOv.style.display = "flex";
      relicOv.innerHTML = `<div style="background:rgba(14,8,26,.97);border:1px solid #b06cf0;border-radius:16px;padding:24px 30px;text-align:center;color:#dfeaff;box-shadow:0 12px 40px rgba(0,0,0,.6)"><div style="font:800 18px 'Segoe UI';color:#f0d27a;letter-spacing:1px;margin-bottom:4px">✦ AETHER TITHE</div><div style="opacity:.8;font-size:13px;margin-bottom:14px">Name one resource — every rival hands you all of theirs</div><div style="display:flex;gap:9px;justify-content:center;margin-bottom:16px">${RES5.map((r) => `<div data-r="${r}" style="cursor:pointer;width:60px;height:84px;border-radius:9px;overflow:hidden;border:2px solid ${sel === r ? "#f0d27a" : "#7fe0f5aa"}"><img src="${CARD_IMG[r]}" style="width:100%;height:100%;object-fit:cover"></div>`).join("")}</div><button data-a="go" ${sel ? "" : "disabled"} style="cursor:${sel ? "pointer" : "default"};padding:8px 22px;border-radius:8px;border:1px solid #7CFC9A;background:${sel ? "linear-gradient(#4fd06a,#2fa050)" : "rgba(30,40,30,.5)"};color:${sel ? "#06210f" : "#5a6b7a"};font:800 13px 'Segoe UI';margin-right:8px">Take it!</button><button data-a="cancel" style="cursor:pointer;padding:8px 15px;border-radius:8px;border:1px solid #55617a;background:rgba(20,26,40,.8);color:#cdd8ea;font:700 12px 'Segoe UI'">✕</button></div>`;
      relicOv.querySelectorAll("[data-r]").forEach((el) => el.onclick = () => { sel = el.dataset.r; draw(); });
      relicOv.querySelector("[data-a=go]").onclick = () => { if (!sel) return; const st = rState(); const took = A.playLevy(st, curSeat, { res: sel }); finishRelicPlay(curSeat, idx); bcast({ kind: "playRelic", relicType: "levy", choices: { res: sel } }, null, curSeat); closeRelicOv(); relicToast(took ? `✦ Tithe: +${took} ${ICON[sel]} seized` : `Tithe — nobody held ${ICON[sel]}`, SEATS[curSeat].color); refreshMarkers(); };
      relicOv.querySelector("[data-a=cancel]").onclick = () => closeRelicOv();
    };
    draw();
  }
  function doStormWard(hi) {
    if (!relicMode || relicMode.type !== "stormWard" || hi < 0 || hi === stormHex) return;
    const seat = curSeat, idx = relicMode.idx, card = relics[seat][idx];
    moveStorm(hi);
    const victims = new Set(); for (const vId of board.hexes[hi].corners) { const b = buildings[vId]; if (b && b.seat !== seat) victims.add(b.seat); }
    const doPlay = (victim) => { const st = rState(); const stolen = victim >= 0 ? A.rollSteal(st, victim, SEED, turn, card ? card.id : idx) : { stolen: null }; A.playStormWard(st, seat, { toHex: hi, victimSeat: victim }, stolen); stormWardenSeat = st.stormWardenSeat; finishRelicPlay(seat, idx); relicMode = null; relicToast(victim >= 0 && stolen.stolen ? `⚡ Storm-Ward — swiped ${ICON[stolen.stolen]} from ${SEATS[victim].name}` : "⚡ Storm-Ward moved", SEATS[seat].color); if (seat === localSeat() && stolen.stolen) ach("storm_thief"); const won = checkWin(); bcast({ kind: "playRelic", relicType: "stormWard", choices: { toHex: hi, victimSeat: victim } }, { stolen: stolen.stolen }, curSeat); if (!won) refreshMarkers(); };
    const arr = [...victims];
    if (arr.length <= 1) doPlay(arr.length ? arr[0] : -1);
    else { relicOv.style.display = "flex"; relicOv.innerHTML = `<div style="background:rgba(14,8,26,.97);border:1px solid #b06cf0;border-radius:14px;padding:20px 26px;text-align:center;color:#dfeaff"><div style="font:800 15px 'Segoe UI';color:#f0d27a;margin-bottom:12px">Swipe a card from…</div>${arr.map((s) => `<button data-s="${s}" style="cursor:pointer;margin:3px;padding:8px 16px;border-radius:8px;border:1px solid #${SEATS[s].color.toString(16).padStart(6, "0")};background:rgba(20,26,40,.85);color:#${SEATS[s].color.toString(16).padStart(6, "0")};font:800 13px 'Segoe UI'">${SEATS[s].name}</button>`).join("")}</div>`; relicOv.querySelectorAll("[data-s]").forEach((el) => el.onclick = () => { closeRelicOv(); doPlay(+el.dataset.s); }); }
  }
  function placeFreeRoad(edge) {
    if (!relicMode || relicMode.type !== "leyLine") return;
    if (!A.canRoad(board, buildings, roads, edge, curSeat, A.roadNetwork(roads, curSeat))) return;
    placeRoad(edge, curSeat); relicMode.placed++; relicMode.left--; relicMode.edges.push({ a: edge.a, b: edge.b });
    const more = relicMode.left > 0 && board.edges.some((e) => A.canRoad(board, buildings, roads, e, curSeat, A.roadNetwork(roads, curSeat)));
    if (!more) { const n = relicMode.placed, idx = relicMode.idx, edges = relicMode.edges; relicPlayed[curSeat].leyLine += 1; finishRelicPlay(curSeat, idx); relicMode = null; relicToast(`✦ Skybridge — ${n} road${n > 1 ? "s" : ""} laid`, SEATS[curSeat].color); const won = checkWin(); bcast({ kind: "playRelic", relicType: "leyLine", choices: { edges } }, null, curSeat); if (won) return; }
    refreshMarkers();
  }

  // ── AI relic policy (greedy; all effects run through the same apply path) ──
  function aiNeeds(seat, n) { return ["lumber", "brick", "grain", "wool", "ore"].sort((a, b) => (res[seat][a] || 0) - (res[seat][b] || 0)).slice(0, n); }
  function giveFreeRoads(seat, n) { let placed = 0; for (let k = 0; k < n; k++) { const e = board.edges.find((e) => A.canRoad(board, buildings, roads, e, seat, A.roadNetwork(roads, seat))); if (!e) break; placeRoad(e, seat); placed++; } return placed; }
  function aiStormTarget(seat) {
    let best = { hi: -1, victim: -1, score: -1 };
    board.hexes.forEach((h, i) => { if (h.res === A.WILD || i === stormHex) return;
      let victim = -1, vScore = -1;
      for (const vId of h.corners) { const b = buildings[vId]; if (b && b.seat !== seat) { const tot = Object.values(res[b.seat]).reduce((a, c) => a + c, 0) + A.vpFor(buildings, b.seat) * 3; if (tot > vScore) { vScore = tot; victim = b.seat; } } }
      if (victim < 0) return; const score = A.pips(h.token) + vScore * 0.1; if (score > best.score) best = { hi: i, victim, score };
    });
    if (best.hi < 0) { const alt = board.hexes.findIndex((h, i) => h.res !== A.WILD && i !== stormHex); best = { hi: alt < 0 ? 0 : alt, victim: -1, score: 0 }; }
    return best;
  }
  function aiPlayRelic(seat, idx) {
    const card = relics[seat][idx]; if (!card) return;
    let payload = null, rngX = null;   // capture the AI's picks so the same effect ships once, after checkWin
    if (card.type === "levy") { let bestR = "lumber", bestN = -1; for (const r of RES5) { let n = 0; for (let s = 0; s < SEATS.length; s++) if (s !== seat) n += res[s][r] || 0; if (n > bestN) { bestN = n; bestR = r; } } const st = rState(); const took = A.playLevy(st, seat, { res: bestR }); finishRelicPlay(seat, idx); relicToast(`⚡ ${SEATS[seat].name} levies ${took} ${ICON[bestR]}`, SEATS[seat].color); payload = { kind: "playRelic", relicType: "levy", choices: { res: bestR } }; }
    else if (card.type === "bounty") { const picks = aiNeeds(seat, 2); const st = rState(); A.playBounty(st, seat, { picks }); finishRelicPlay(seat, idx); relicToast(`✦ ${SEATS[seat].name} calls a Bounty`, SEATS[seat].color); payload = { kind: "playRelic", relicType: "bounty", choices: { picks: picks.slice() } }; }
    else if (card.type === "stormWard") { const t = aiStormTarget(seat); moveStorm(t.hi); const st = rState(); const stolen = t.victim >= 0 ? A.rollSteal(st, t.victim, SEED, turn, card.id) : { stolen: null }; A.playStormWard(st, seat, { toHex: t.hi, victimSeat: t.victim }, stolen); stormWardenSeat = st.stormWardenSeat; finishRelicPlay(seat, idx); relicToast(t.victim >= 0 && stolen.stolen ? `⚡ ${SEATS[seat].name} Storm-Ward: took ${ICON[stolen.stolen]}` : `⚡ ${SEATS[seat].name} plays Storm-Ward`, SEATS[seat].color); payload = { kind: "playRelic", relicType: "stormWard", choices: { toHex: t.hi, victimSeat: t.victim } }; rngX = { stolen: stolen.stolen }; }
    else if (card.type === "leyLine") { const edges = []; for (let k = 0; k < 2; k++) { const e = board.edges.find((e) => A.canRoad(board, buildings, roads, e, seat, A.roadNetwork(roads, seat))); if (!e) break; placeRoad(e, seat); edges.push({ a: e.a, b: e.b }); } relicPlayed[seat].leyLine += 1; finishRelicPlay(seat, idx); relicToast(`✦ ${SEATS[seat].name} raises a Skybridge (${edges.length})`, SEATS[seat].color); payload = { kind: "playRelic", relicType: "leyLine", choices: { edges } }; }
    const won = checkWin();
    if (payload) bcast(payload, rngX, curSeat);
    if (!won) refreshMarkers();
  }
  function aiRelicPhase() {
    const seat = curSeat; if (!SEATS[seat].ai || phase !== "play") return;
    const idx = (relics[seat] || []).findIndex((c) => A.canPlayRelic(rState(), seat, c, rolled));
    if (idx >= 0) aiPlayRelic(seat, idx);
    if (phase === "play" && (relics[seat] || []).length < 2 && A.canAfford(res[seat], "relic") && relicPtr < relicDeck.length) buyRelic(seat);
  }

  /* ══════════════════════ TRADING: bank/skyport + player-to-player ══════════════════════ */
  const tradeOv = document.createElement("div");
  tradeOv.style.cssText = "position:absolute;inset:0;z-index:62;display:none;align-items:center;justify-content:center;background:rgba(6,12,24,.55);font-family:'Segoe UI',monospace";
  (kernel.parent || document.body).appendChild(tradeOv);
  let tradeTab = "bank", offerGive = {}, offerWant = {}, tradeMsg = "", bankGive = null, bankGet = null;
  function difficultyKey() { const d = (shell && shell.difficulty ? String(shell.difficulty) : "balanced").toLowerCase(); return d.startsWith("g") ? "gentle" : d.startsWith("f") ? "fierce" : "balanced"; }
  function closeTrade() { tradeOv.style.display = "none"; tradeOv.innerHTML = ""; hideTip(); }
  function openTrade() {
    if (phase !== "play" || !rolled || _blocked() || relicMode) return;
    tradeTab = "bank"; offerGive = {}; offerWant = {}; tradeMsg = ""; bankGive = null; bankGet = null;
    tradeOv.style.display = "flex"; drawTrade();
  }
  function bagStr(b) { return RES5.filter((k) => b[k]).map((k) => b[k] + "x " + RES_LABEL[k]).join(", ") || "nothing"; }
  function tile(k, sub, dim, sel, pick) {
    return '<div data-r="' + k + '" data-pick="' + pick + '" style="cursor:pointer;width:66px;border-radius:10px;overflow:hidden;border:' + (sel ? "3px solid #f0d27a" : "2px solid " + (dim ? "#33465f" : "#7fe0f5")) + ';opacity:' + (dim ? .45 : 1) + ';background:rgba(10,20,34,.9);text-align:center">'
      + '<img src="' + CARD_IMG[k] + '" style="width:100%;height:70px;object-fit:cover;pointer-events:none">'
      + '<div style="font:800 10px \'Segoe UI\';color:#dfeaff;padding:3px 0 4px;pointer-events:none">' + sub + '</div></div>';
  }
  function drawTrade() {
    const r = res[curSeat], me = curSeat;
    const tab = (id, label) => '<button data-t="' + id + '" style="cursor:pointer;margin:0 4px;padding:7px 18px;border-radius:9px;border:1px solid ' + (tradeTab === id ? "#7fe0f5" : "#33465f") + ';background:' + (tradeTab === id ? "linear-gradient(#2a5a72,#173a4e)" : "rgba(16,26,44,.85)") + ';color:#dfeaff;font:800 13px \'Segoe UI\'">' + label + '</button>';
    let body = "";
    if (tradeTab === "bank") {
      body = '<div style="opacity:.8;font-size:12px;margin-bottom:8px">Trade goods to the bank. Owning a <b>skyport</b> on the rim improves your rate.</div>'
        + '<div style="font:800 11px \'Segoe UI\';color:#9fb4cc;letter-spacing:1px;margin:6px 0 4px">YOU GIVE</div><div style="display:flex;gap:8px;justify-content:center">'
        + RES5.map((k) => { const rate = A.tradeRate(PORTS, buildings, me, k); return tile(k, rate + ":1 · have " + (r[k] || 0), (r[k] || 0) < rate, bankGive === k, "give"); }).join("")
        + '</div><div style="font:800 11px \'Segoe UI\';color:#9fb4cc;letter-spacing:1px;margin:12px 0 4px">YOU RECEIVE</div><div style="display:flex;gap:8px;justify-content:center">'
        + RES5.map((k) => tile(k, RES_LABEL[k], bankGive === k, bankGet === k, "get")).join("")
        + '</div>';
    } else {
      const counter = (side, k) => {
        const n = (side === "give" ? offerGive : offerWant)[k] || 0;
        return '<div style="display:flex;flex-direction:column;align-items:center;gap:3px"><img data-r="' + k + '" src="' + CARD_IMG[k] + '" style="width:44px;height:60px;object-fit:cover;border-radius:6px;border:1.5px solid ' + (n ? "#f0d27a" : "#33465f") + '">'
          + '<div style="display:flex;align-items:center;gap:4px"><button data-adj="' + side + ':' + k + ':-1" style="cursor:pointer;width:20px;height:20px;border-radius:5px;border:1px solid #3a4d66;background:rgba(16,26,44,.9);color:#dfeaff;font:800 12px \'Segoe UI\';padding:0">-</button>'
          + '<span style="min-width:14px;font:800 13px \'Segoe UI\';color:' + (n ? "#f0d27a" : "#6b7d92") + '">' + n + '</span>'
          + '<button data-adj="' + side + ':' + k + ':1" style="cursor:pointer;width:20px;height:20px;border-radius:5px;border:1px solid #3a4d66;background:rgba(16,26,44,.9);color:#dfeaff;font:800 12px \'Segoe UI\';padding:0">+</button></div>'
          + '<div style="font:600 9px \'Segoe UI\';color:#6b7d92">have ' + (r[k] || 0) + '</div></div>';
      };
      const others = SEATS.map((s, i) => i).filter((i) => i !== me);
      body = '<div style="opacity:.8;font-size:12px;margin-bottom:8px">Offer a swap. Rivals judge it on their own needs — and on how much it helps <i>you</i>.</div>'
        + '<div style="font:800 11px \'Segoe UI\';color:#9fb4cc;letter-spacing:1px;margin:4px 0 4px">YOU GIVE</div><div style="display:flex;gap:10px;justify-content:center">' + RES5.map((k) => counter("give", k)).join("") + '</div>'
        + '<div style="font:800 11px \'Segoe UI\';color:#9fb4cc;letter-spacing:1px;margin:12px 0 4px">YOU WANT</div><div style="display:flex;gap:10px;justify-content:center">' + RES5.map((k) => counter("want", k)).join("") + '</div>'
        + '<div style="margin-top:14px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">'
        + others.map((i) => '<button data-offer="' + i + '" style="cursor:pointer;padding:9px 16px;border-radius:10px;border:1px solid #' + SEATS[i].color.toString(16).padStart(6, "0") + ';background:rgba(16,26,44,.9);color:#' + SEATS[i].color.toString(16).padStart(6, "0") + ';font:800 12px \'Segoe UI\'">Offer to ' + SEATS[i].name + '</button>').join("")
        + '</div>';
    }
    tradeOv.innerHTML = '<div style="background:rgba(10,18,34,.97);border:1px solid #7fe0f5;border-radius:16px;padding:20px 26px;text-align:center;color:#dfeaff;min-width:430px;max-width:600px;box-shadow:0 12px 40px rgba(0,0,0,.6)">'
      + '<div style="font-size:20px;font-weight:800;letter-spacing:2px;color:#7fe0f5;margin-bottom:10px">🤝 TRADE</div>'
      + '<div style="margin-bottom:12px">' + tab("bank", "🏦 Bank / Skyport") + (netMode ? "" : tab("players", "👥 Players")) + '</div>'
      + body
      + '<div style="min-height:20px;margin-top:12px;font:700 12px \'Segoe UI\';color:#f0d27a">' + tradeMsg + '</div>'
      + '<div style="margin-top:6px">' + (tradeTab === "bank" ? '<button data-a="dobank" style="cursor:pointer;padding:10px 26px;border-radius:9px;border:1px solid #7CFC9A;background:linear-gradient(#4fd06a,#2fa050);color:#06210f;font:bold 14px \'Segoe UI\';margin-right:8px">Trade</button>' : "")
      + '<button data-a="close" style="cursor:pointer;padding:10px 20px;border-radius:9px;border:1px solid #55617a;background:rgba(20,26,40,.85);color:#cdd8ea;font:700 13px \'Segoe UI\'">Close</button></div></div>';
    tradeOv.querySelectorAll("[data-t]").forEach((b) => b.onclick = () => { tradeTab = b.dataset.t; tradeMsg = ""; drawTrade(); });
    tradeOv.querySelectorAll("[data-pick]").forEach((el) => el.onclick = () => {
      const k = el.dataset.r;
      if (el.dataset.pick === "give") { if ((res[curSeat][k] || 0) >= A.tradeRate(PORTS, buildings, curSeat, k)) { bankGive = k; if (bankGet === k) bankGet = null; } }
      else if (bankGive !== k) bankGet = k;
      tradeMsg = ""; drawTrade();
    });
    tradeOv.querySelectorAll("[data-r]").forEach((el) => { el.onmouseenter = () => showResTip(el.dataset.r, el); el.onmouseleave = hideTip; });
    tradeOv.querySelectorAll("[data-adj]").forEach((b) => b.onclick = () => {
      const parts = b.dataset.adj.split(":"), side = parts[0], k = parts[1], d = +parts[2];
      const bag = side === "give" ? offerGive : offerWant, cap = side === "give" ? (res[curSeat][k] || 0) : 9;
      bag[k] = Math.max(0, Math.min(cap, (bag[k] || 0) + d));
      if (!bag[k]) delete bag[k];
      tradeMsg = ""; drawTrade();
    });
    const bk = tradeOv.querySelector("[data-a=dobank]"); if (bk) bk.onclick = () => bankTradeGo();
    tradeOv.querySelectorAll("[data-offer]").forEach((b) => b.onclick = () => sendOffer(+b.dataset.offer));
    tradeOv.querySelector("[data-a=close]").onclick = () => closeTrade();
  }
  function bankTradeGo() {
    if (!bankGive || !bankGet) { tradeMsg = "Pick what to give and what to receive."; return drawTrade(); }
    const rate = A.doBankTrade(res[curSeat], PORTS, buildings, curSeat, bankGive, bankGet);
    if (!rate) { tradeMsg = "You can't afford that trade."; return drawTrade(); }
    bcast({ kind: "bankTrade", give: bankGive, get: bankGet }, null, curSeat);
    tradeMsg = "Traded " + rate + "x " + RES_LABEL[bankGive] + " for 1 " + RES_LABEL[bankGet] + ".";
    if (rate < 4) ach("skyport_trader");
    bankGive = null; bankGet = null;
    refreshMarkers(); drawTrade();
  }
  function sendOffer(toSeat) {
    const give = { ...offerGive }, want = { ...offerWant };
    if (!A.canOfferTrade(res, curSeat, give, want)) { tradeMsg = "Set what you'd give and what you want (and you must hold what you offer)."; return drawTrade(); }
    const s = SEATS[toSeat];
    if (s.ai) {
      const v = A.evaluateTrade(rState(), buildings, toSeat, curSeat, give, want, difficultyKey());
      if (v.accept) { A.applyTrade(res, curSeat, toSeat, give, want); tradeMsg = "✅ " + s.name + ': "' + v.reason + '"'; offerGive = {}; offerWant = {}; ach("dealmaker"); refreshMarkers(); }
      else tradeMsg = "❌ " + s.name + ': "' + v.reason + '"';
    } else {
      if (!A.canAcceptTrade(res, toSeat, want)) { tradeMsg = s.name + " doesn't hold that."; return drawTrade(); }
      const okAsk = confirm(s.name + ": " + SEATS[curSeat].name + " offers " + bagStr(give) + " for your " + bagStr(want) + ".\n\nAccept?");
      if (okAsk) { A.applyTrade(res, curSeat, toSeat, give, want); tradeMsg = "✅ " + s.name + " accepted."; offerGive = {}; offerWant = {}; ach("dealmaker"); refreshMarkers(); }
      else tradeMsg = "❌ " + s.name + " declined.";
    }
    drawTrade();
  }

  // player-count config overlay (creator picks total players + how many are AI; rest are hotseat humans)
  const cfgOv = document.createElement("div");
  cfgOv.style.cssText = "position:absolute;inset:0;z-index:60;display:none;align-items:center;justify-content:center;background:rgba(6,12,24,.55);font-family:'Segoe UI',monospace";
  (kernel.parent || document.body).appendChild(cfgOv);
  function showConfig() {
    if (shell) shell.hide && shell.hide();
    cfgOv.style.display = "flex";
    const draw = () => {
      const humans = gcfg.total - gcfg.ais;
      const btn = (label, on, cur) => `<button data-a="${on}" style="cursor:pointer;margin:2px;min-width:38px;padding:7px 11px;border-radius:8px;border:1px solid ${cur ? "#7fe0f5" : "#33465f"};background:${cur ? "linear-gradient(#2a5a72,#183a4e)" : "rgba(20,30,50,.7)"};color:#dfeaff;font:bold 14px 'Segoe UI'">${label}</button>`;
      cfgOv.innerHTML = `<div style="background:rgba(10,18,34,.96);border:1px solid #7fe0f5;border-radius:16px;padding:26px 34px;text-align:center;color:#dfeaff;min-width:340px;box-shadow:0 12px 40px rgba(0,0,0,.6)">
        <div style="font-size:24px;font-weight:800;letter-spacing:3px;margin-bottom:4px;color:#7fe0f5">SKYFARERS</div>
        <div style="opacity:.7;font-size:13px;margin-bottom:16px">Choose your table</div>
        <div style="opacity:.85;margin-bottom:6px;font-size:13px">PLAYERS</div>
        <div style="margin-bottom:16px">${[2, 3, 4, 5].map((t) => btn(t, "t" + t, gcfg.total === t)).join("")}</div>
        <div style="opacity:.85;margin-bottom:6px;font-size:13px">AI OPPONENTS <span style="opacity:.6">(rest are hotseat)</span></div>
        <div style="margin-bottom:18px">${Array.from({ length: gcfg.total }, (_, a) => a).map((a) => btn(a, "a" + a, gcfg.ais === a)).join("")}</div>
        <div style="opacity:.7;font-size:12px;margin-bottom:14px">${humans} human${humans > 1 ? "s" : ""} + ${gcfg.ais} AI</div>
        <button data-a="go" style="cursor:pointer;padding:11px 40px;border-radius:9px;border:1px solid #7CFC9A;background:linear-gradient(#4fd06a,#2fa050);color:#06210f;font:bold 16px 'Segoe UI';letter-spacing:1px">▶ START</button>
      </div>`;
      cfgOv.querySelectorAll("button").forEach((b) => b.onclick = () => {
        const a = b.dataset.a;
        if (a === "go") { cfgOv.style.display = "none"; beginGame(); return; }
        if (a[0] === "t") { gcfg.total = +a.slice(1); if (gcfg.ais > gcfg.total - 1) gcfg.ais = gcfg.total - 1; }
        else if (a[0] === "a") gcfg.ais = Math.min(+a.slice(1), gcfg.total - 1);
        draw();
      });
    };
    draw();
  }
  /** Tear down the current map's meshes and build a brand-new one from `seed`.
   *  makeBoard shuffles 19 isle-resources AND 18 number tokens, and makePorts shuffles 9 port
   *  types — so a 32-bit seed yields billions of distinct layouts; repeats are effectively never. */
  function rebuildBoard(seed) {
    SEED = (seed >>> 0) || 1;
    for (const g of isleGroups) world.remove(g); isleGroups.length = 0;
    for (const g of portGroups) world.remove(g);
    for (const m of vMarks) world.remove(m);
    for (const m of eMarks) world.remove(m);
    for (const r of hexRings) world.remove(r);
    board = A.makeBoard(SEED);
    PORTS = A.makePorts(board, SEED);
    rng = A.makeRng(SEED ^ 0x99);
    buildIsles(); buildDecoIsles(); buildPorts(); buildVMarks(); buildEMarks(); buildHexRings();
    stormHex = -1; if (stormToken) stormToken.visible = false;
  }
  function beginGame(seed) {
    clearSave();   // a fresh game must not resume a stale save (resumeGame does NOT route through here)
    if (orbit) orbit.autoRotate = false;
    // a NEW random map every game (online: the host's seed arrives in the start payload)
    rebuildBoard(seed != null ? seed : (Math.floor(Math.random() * 0xFFFFFFFF) >>> 0));
    buildSeats();
    // online: the seat roster is authoritative from seatplay (kind->ai, "You" for my seat). res must match the new count; initRelics runs AFTER so relic arrays match SEATS.
    if (netMode && seatplay && seatplay.seats.length) { SEATS = seatplay.seats.map((s, i) => ({ name: s.kind === "ai" ? s.name : (i === mySeat ? "You" : "Player " + (i + 1)), ai: s.kind === "ai", color: SEAT_COLORS[i % SEAT_COLORS.length] })); res = SEATS.map(() => emptyRes()); }
    initRelics();
    for (const c of [...bGroup.children]) bGroup.remove(c); for (const k in bldMesh) delete bldMesh[k];
    buildings = {}; roads = {}; lastRoll = 0; buildMode = null;
    beginFirstRoll();   // roll for turn order first (offline); online starts deterministically at seat 0
  }

  let shell = null;
  if (window.FFG && window.FFG.Shell) {
    shell = new window.FFG.Shell({
      title: content.title || "Aether Isles", tagline: content.tagline || "Settle the floating isles. Ride the aether currents.",
      music: "assets/audio/theme_village.mp3",   // ambient fantasy bed (shipped in assets/audio) — the shell owns loop + volume
      difficulties: ["Gentle", "Balanced", "Fierce"], defaultDifficulty: "Balanced",
      howTo: [
        { h: "FOUND", p: "Setup: click two glowing corners to found your first settlements — each collects resources from the isles it touches." },
        { h: "ROLL", p: "On your turn press SPACE to roll — every isle showing that number sends its resource to the settlements around it." },
        { h: "BUILD", p: "Spend resources: [1] road (🌲🧱), [2] settlement (🌲🧱🌾🐑, must touch your roads), [3] upgrade a settlement to a crystal city (🌾🌾🔮🔮🔮) for double yield. Press [E] to end your turn." },
        { h: "RELICS", p: "Buy an Aether Relic ([4] · 🔮🌾🐑) — draw a hidden sky-charm. Play one per turn from your shelf: Storm-Ward moves the Storm & swipes a card, Skybridge lays 2 free roads, Bounty gifts 2 resources, Tithe seizes one resource from every rival, Crown is a secret +1★." },
        { h: "WIN", p: "Settlements are 1★, cities 2★, a played Storm-Ward trio earns the Storm Warden ⚔ (+2★). First skyfarer to 8★ rules the isles." },
        { h: "TRADE", p: "Press [T] or the Trade button. BANK: swap 4 alike for 1 of anything. SKYPORTS: the 9 rim docks improve that rate for whoever owns a settlement on them - a generic port trades 3:1, a specialist port trades its own good 2:1. PLAYERS: offer a swap to a rival - they weigh it against what they need, and against how much it helps you win." },
        { h: "RELICS", p: "Aether Relics ARE the development cards: Storm-Ward moves the Storm and swipes a card, Skybridge lays 2 free roads, Bounty gifts 2 goods, Tithe seizes one good from every rival, and the hidden Crown is a secret star." },
        { h: "UNDO + SAVE", p: "Misplayed a turn? Press Ctrl+Z or the ↶ Undo button to rewind to the start of it (single-player only). Every turn autosaves — pick up where you left off with RESUME GAME on the title screen." },
      ],
      onPlay: () => showConfig(), onPause: () => { try { kernel.stop(); } catch (e) {} }, onResume: () => { try { kernel.start(); } catch (e) {} },
    });
    shell.start();
  } else beginGame();

  /* ══════════════════════ ONLINE (ffg_seatplay) — N-seat networked play, purely additive ══════════════════════ */
  // Remove one relic of `type` from a seat's hand + mark relic-used-this-turn (receive-side mirror of finishRelicPlay,
  // which the sender calls by index; receivers match by type since same-type cards are interchangeable + hands are lockstep).
  function _consumeRelic(seat, type) { const hand = relics[seat] || []; const idx = hand.findIndex((c) => c.type === type); if (idx >= 0) finishRelicPlay(seat, idx); else relicPlayedTurn[seat] = turn; }
  // Re-apply a relic effect from shipped choices (no interactive picker). Mirrors the authoritative human/AI plays exactly.
  function applyRelicPlay(seat, relicType, choices, rng) {
    if (relicType === "stormWard") { moveStorm(choices.toHex); const st = rState(); A.playStormWard(st, seat, { toHex: choices.toHex, victimSeat: choices.victimSeat }, { stolen: rng && rng.stolen }); stormWardenSeat = st.stormWardenSeat; _consumeRelic(seat, "stormWard"); }
    else if (relicType === "bounty") { const st = rState(); A.playBounty(st, seat, { picks: choices.picks || [] }); _consumeRelic(seat, "bounty"); }
    else if (relicType === "levy") { const st = rState(); A.playLevy(st, seat, { res: choices.res }); _consumeRelic(seat, "levy"); }
    else if (relicType === "leyLine") { for (const e of (choices.edges || [])) placeRoad(resolveEdge(e), seat); relicPlayed[seat].leyLine += 1; _consumeRelic(seat, "leyLine"); }
    if (!checkWin()) refreshMarkers();
  }
  // Receive an authoritative sub-action from another seat's authority; drive the SAME local functions (guarded by _applyingRemote).
  function applyRemoteMove(seat, p, rng) {
    _applyingRemote = true;
    try {
      switch (p.kind) {
        case "setupPlace": setupPlace(p.vId); break;
        case "setupRoad": setupRoad(resolveEdge(p.edge)); break;
        case "roll": roll(rng.roll); break;                                             // FORCED total -> receiver consumes 0 rng, skips the spin
        case "build": build(p.bkind, p.bkind === "road" ? resolveEdge(p.target) : p.target); break;
        case "bankTrade": A.doBankTrade(res[seat], PORTS, buildings, seat, p.give, p.get); break;
        case "buyRelic": buyRelic(seat); break;                                         // re-draws relicDeck[relicPtr] in lockstep
        case "playRelic": applyRelicPlay(seat, p.relicType, p.choices, rng); break;
        case "endTurn": endTurn(); break;
      }
    } finally { _applyingRemote = false; }
  }
  function serializeState() {
    return {
      seed: SEED,                                    // the map itself — a resume/sync MUST rebuild the same board
      buildings: JSON.parse(JSON.stringify(buildings)), roads: { ...roads }, res: res.map((r) => ({ ...r })),
      relics: JSON.parse(JSON.stringify(relics)), relicPlayed: JSON.parse(JSON.stringify(relicPlayed)), relicPlayedTurn: { ...relicPlayedTurn },
      relicPtr, stormHex, stormWardenSeat, turn, curSeat, phase,
      setupOrder: [...setupOrder], setupIdx, setupSub, pendingV, rolled, lastRoll,
    };
  }
  function loadState(s) {
    if (s.seed != null && (s.seed >>> 0) !== SEED) rebuildBoard(s.seed);   // same map as the saver/host
    for (const c of [...bGroup.children]) bGroup.remove(c); for (const k in bldMesh) delete bldMesh[k];
    buildings = {}; roads = {};
    for (const vId in s.buildings) { const b = s.buildings[vId]; placeSettlement(+vId, b.seat, false); if (b.kind === "city") upgradeCity(+vId, b.seat); }
    for (const ek in s.roads) { const p = ek.split("-"); placeRoad({ a: +p[0], b: +p[1] }, s.roads[ek]); }
    res = s.res.map((r) => ({ ...r }));
    relics = JSON.parse(JSON.stringify(s.relics)); relicPlayed = JSON.parse(JSON.stringify(s.relicPlayed)); relicPlayedTurn = { ...s.relicPlayedTurn };
    relicPtr = s.relicPtr; stormHex = s.stormHex; stormWardenSeat = s.stormWardenSeat; turn = s.turn; curSeat = s.curSeat; phase = s.phase;
    setupOrder = [...(s.setupOrder || [])]; setupIdx = s.setupIdx; setupSub = s.setupSub; pendingV = s.pendingV; rolled = s.rolled; lastRoll = s.lastRoll;
    if (stormHex >= 0) moveStorm(stormHex); else if (stormToken) stormToken.visible = false;
    refreshMarkers();
  }

  // ── AUTOSAVE + RESUME (M6) — local single-player persistence; wholly inert during online (gated on !netMode) ──
  const SAVE_KEY = "ffg_aether_save";
  function saveGame() {   // capture the latest in-progress LOCAL game each setup-/turn-advance; reuses serializeState (never online)
    if (netMode || (phase !== "play" && phase !== "setup")) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, gcfg: { total: gcfg.total, ais: gcfg.ais }, state: serializeState() })); } catch (e) {}
  }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
  function hasSave() { try { const sv = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); return (sv && sv.v === 1 && sv.state && sv.gcfg) ? sv : null; } catch (e) { return null; } }
  function resumeGame() {   // rebuild the saved LOCAL game (offline) — mirrors beginGame's reset, then loadState instead of beginSetup
    netMode = false;
    const sv = hasSave(); if (!sv) return false;
    gcfg = sv.gcfg; buildSeats();
    if (orbit) orbit.autoRotate = false;
    if (sv.state && sv.state.seed != null) rebuildBoard(sv.state.seed);   // resume the SAME map you were playing
    initRelics();                                     // rebuild the deterministic relicDeck (counters are overwritten by loadState); relicDeck is not serialized
    for (const c of [...bGroup.children]) bGroup.remove(c); for (const k in bldMesh) delete bldMesh[k];
    buildings = {}; roads = {}; lastRoll = 0; buildMode = null;
    loadState(sv.state);                              // restores buildings/roads/res/relics/phase/curSeat/setup*/rolled/... + rebuilds meshes + refreshMarkers
    if (SEATS[curSeat] && SEATS[curSeat].ai) {        // re-arm the current seat's AI the way startTurn/beginSetup do
      if (phase === "play") setTimeout(aiTurn, 700);
      else if (phase === "setup") setTimeout(aiSetup, 600);
    }
    updateHud();
    return true;
  }
  function boardHash() {
    if (!board) return "nil";
    const b = Object.keys(buildings).sort((a, c) => +a - +c).map((k) => k + ":" + buildings[k].seat + buildings[k].kind[0]).join(",");
    const rd = Object.keys(roads).sort().map((k) => k + ":" + roads[k]).join(",");
    const rs = res.map((r) => RES5.map((k) => r[k] || 0).join("/")).join("|");
    const rp = SEATS.map((_, i) => { const p = relicPlayed[i] || {}; return [p.stormWard || 0, p.sigil || 0, p.leyLine || 0, p.bounty || 0, p.levy || 0].join("."); }).join("|");
    return b + "||" + rd + "||" + rs + "||" + relicPtr + "|" + rp + "|" + stormHex + "|" + stormWardenSeat + "|" + turn + "|" + curSeat + "|" + phase + "|" + setupIdx;
  }
  // clock-timeout fallback for MY seat: make one legal progressing move through the chokepoints
  function randomMove(seat) {
    if (phase === "setup") {
      if (setupSub === "settle") { const v = board.vertices.find((v) => A.canSettle(board, buildings, v.id)); if (v) setupPlace(v.id); }
      if (setupSub === "road" && pendingV >= 0) { const e = board.edges.find((e) => (e.a === pendingV || e.b === pendingV) && roads[e.a + "-" + e.b] === undefined); if (e) setupRoad(e); }
      return true;
    }
    if (phase !== "play") return false;
    if (!rolled) roll(); endTurn(); return true;
  }
  // 2-tab harness: one legal action for MY seat (place setup, else roll or end) — enough to cycle turns
  function testPlayOne() {
    if (!netMode) return false;
    if (phase === "setup" && _actingSeat() === mySeat) {
      if (setupSub === "settle") { const v = board.vertices.find((v) => A.canSettle(board, buildings, v.id)); return v ? setupPlace(v.id) : false; }
      if (setupSub === "road" && pendingV >= 0) { const e = board.edges.find((e) => (e.a === pendingV || e.b === pendingV) && roads[e.a + "-" + e.b] === undefined); return e ? setupRoad(e) : false; }
      return false;
    }
    if (phase !== "play" || curSeat !== mySeat) return false;
    if (!rolled) { roll(); return true; }
    endTurn(); return true;
  }
  function buildSeatIface() {
    return {
      gameId: "aether3d", parent: kernel.parent, title: "Aether Isles", turnSeconds: 45,
      onLobbyOpen: () => { if (orbit) orbit.autoRotate = true; },
      onLobbyBack: () => { netMode = false; if (shell) { shell.phase = "menu"; shell.start(); } },
      startGame: (a) => { netMode = true; mySeat = a.mySeat; beginGame(a.seed || 1337); },   // host broadcasts the map seed -> identical board on every client
      onTurn: ({ turnSeat }) => { if (turnSeat === mySeat && SEATS[turnSeat] && !SEATS[turnSeat].ai) { refreshMarkers(); updateHud(); } else updateHud(); },
      applyRemoteMove,
      driveAiTurn: (seat) => { if (phase === "play" && SEATS[seat] && SEATS[seat].ai) aiTurn(); },   // host-only, PLAY AI. Setup AI is driven locally (snake-draft consecutive turns fire no _dispatch). aiTurn routes through the broadcasting chokepoints.
      randomMove: (seat) => randomMove(seat),
      isOver: () => phase === "ended",
      winnerSeat: () => { const st = rState(); for (let s = 0; s < SEATS.length; s++) if (A.totalVpFor(st, buildings, s) >= WIN_VP) return s; return null; },
      serializeState, loadState, boardHash, setStatus: () => updateHud(),
      end: (r) => { phase = "ended"; relicMode = null; updateHud(); if (shell) shell.end(r && r.winner === mySeat, r && r.reason ? r.reason : (r && r.winner != null && SEATS[r.winner] ? `${SEATS[r.winner].name} reaches ${WIN_VP}★ — victory!` : "Game over")); },
      onPeerDrop: (seat) => { if (SEATS[seat]) { SEATS[seat].ai = true; SEATS[seat].name = (SEATS[seat].name || "Player") + " (AI)"; } updateHud(); },
      testPlayOne: () => testPlayOne(),
    };
  }
  async function startOnline() {
    if (!_spApi) { const mod = await import("../net/ffg_seatplay.js" + _V); _spApi = mod.installSeatPlay(buildSeatIface()); seatplay = _spApi.controller; }
    netMode = true; _spApi.openLobby();
  }
  // inject a "PLAY ONLINE" button beside the shell's PLAY (the shell rebuilds ov.innerHTML each menu())
  if (shell && typeof shell.menu === "function") {
    const _origMenu = shell.menu.bind(shell);
    shell.menu = function () {
      _origMenu();
      try {
        if (shell.phase !== "menu" || !shell.ov) return;
        const ob = document.createElement("button");
        ob.textContent = "🌐  PLAY ONLINE";
        ob.style.cssText = "font:bold 15px 'Segoe UI',system-ui,monospace;padding:11px 26px;cursor:pointer;min-width:200px;letter-spacing:1px;border-radius:7px;margin-top:8px;color:#06121f;background:linear-gradient(#9fe0ff,#4fb6e0);border:1px solid #7fd0f0;box-shadow:0 4px 18px rgba(80,180,224,.32)";
        ob.onclick = () => { shell.hide(); shell.phase = "playing"; startOnline(); };
        const playBtn = Array.prototype.find.call(shell.ov.querySelectorAll("button"), (b) => /PLAY/i.test(b.textContent) && !/ONLINE/i.test(b.textContent));
        if (playBtn && playBtn.parentNode) playBtn.parentNode.insertBefore(ob, playBtn.nextSibling); else shell.ov.appendChild(ob);
      } catch (e) {}
    };
    if (shell.phase === "menu") shell.menu();
  }
  // inject a "RESUME GAME" button beside PLAY when a local save exists (same monkey-patch technique as PLAY ONLINE)
  if (shell && typeof shell.menu === "function") {
    const _menuNoResume = shell.menu.bind(shell);
    shell.menu = function () {
      _menuNoResume();
      try {
        if (shell.phase !== "menu" || !shell.ov || !hasSave()) return;
        const rb = document.createElement("button");
        rb.textContent = "↺  RESUME GAME";
        rb.style.cssText = "font:bold 15px 'Segoe UI',system-ui,monospace;padding:11px 26px;cursor:pointer;min-width:200px;letter-spacing:1px;border-radius:7px;margin-top:8px;color:#2a1e06;background:linear-gradient(#ffe6a0,#f0c250);border:1px solid #f0d27a;box-shadow:0 4px 18px rgba(240,210,122,.32)";
        rb.onclick = () => { shell.hide(); shell.phase = "playing"; resumeGame(); };
        const playBtn = Array.prototype.find.call(shell.ov.querySelectorAll("button"), (b) => /PLAY/i.test(b.textContent) && !/ONLINE/i.test(b.textContent) && !/RESUME/i.test(b.textContent));
        if (playBtn && playBtn.parentNode) playBtn.parentNode.insertBefore(rb, playBtn.nextSibling); else shell.ov.appendChild(rb);
      } catch (e) {}
    };
    if (shell.phase === "menu") shell.menu();
  }
  try { if (new URLSearchParams(location.search).get("mode") === "online" && shell) { shell.hide(); shell.phase = "playing"; startOnline(); } } catch (e) {}
  if (typeof window !== "undefined") window.__aeDbg = () => ({ netMode, applyingRemote: _applyingRemote, hasSeatplay: !!seatplay, curSeat, mySeat, phase, boardHash: boardHash() });

  return {
    __test: {
      state: () => ({ phase, curSeat, curAI: !!(SEATS[curSeat] && SEATS[curSeat].ai), seats: SEATS.length, rolled, turn, vp: SEATS.map((_, i) => A.vpFor(buildings, i)), totalVp: SEATS.map((_, i) => A.totalVpFor(rState(), buildings, i)), res: { ...(res[curSeat] || res[0]) }, settlements: Object.keys(buildings).length, roads: Object.keys(roads).length, lastRoll, relicPtr, stormHex, stormWardenSeat, relicHand: (relics[curSeat] || []).map((c) => c.type), relicPlayed: { ...(relicPlayed[curSeat] || {}) } }),
      start: (cfg) => { if (cfg) { if (cfg.total) gcfg.total = cfg.total; if (cfg.ais != null) gcfg.ais = Math.min(cfg.ais, gcfg.total - 1); } if (shell) shell.hide && shell.hide(); beginGame(); return true; },
      // relics (headless): buy from deck, inject a specific type, or play the current seat's first playable relic
      buyRelic: () => buyRelic(curSeat),
      grantRelic: (type, ago = 1) => { relics[curSeat].push({ id: 9000 + relics[curSeat].length, type, boughtTurn: turn - ago }); refreshMarkers(); return true; },
      playRelic: (type) => {
        const seat = curSeat, hand = relics[seat] || [], idx = hand.findIndex((c) => (!type || c.type === type) && A.canPlayRelic(rState(), seat, c, rolled));
        if (idx < 0) return false; const card = hand[idx];
        if (card.type === "bounty") { const st = rState(); A.playBounty(st, seat, { picks: ["ore", "ore"] }); finishRelicPlay(seat, idx); }
        else if (card.type === "levy") { const st = rState(); A.playLevy(st, seat, { res: "wool" }); finishRelicPlay(seat, idx); }
        else if (card.type === "leyLine") { giveFreeRoads(seat, 2); relicPlayed[seat].leyLine += 1; finishRelicPlay(seat, idx); }
        else if (card.type === "stormWard") { const t = aiStormTarget(seat); moveStorm(t.hi); const st = rState(); const stolen = t.victim >= 0 ? A.rollSteal(st, t.victim, SEED, turn, card.id) : { stolen: null }; A.playStormWard(st, seat, { toHex: t.hi, victimSeat: t.victim }, stolen); stormWardenSeat = st.stormWardenSeat; finishRelicPlay(seat, idx); }
        if (!checkWin()) refreshMarkers(); return true;
      },
      autoSetup: () => { if (phase !== "setup" || setupSub !== "settle" || (SEATS[curSeat] && SEATS[curSeat].ai)) return false; const v = board.vertices.find((v) => A.canSettle(board, buildings, v.id)); if (!v || !setupPlace(v.id)) return false; const e = board.edges.find((e) => (e.a === v.id || e.b === v.id) && roads[e.a + "-" + e.b] === undefined); return e ? setupRoad(e) : false; },
      roll: (f) => roll(f),
      // give the current seat resources (for driving a build test deterministically)
      grant: (r) => { for (const k in r) res[curSeat][k] = (res[curSeat][k] || 0) + r[k]; refreshMarkers(); },
      buildAuto: (kind) => {
        if (kind === "city") { for (const v in buildings) if (A.canBuildCity(buildings, +v, curSeat) && A.canAfford(res[curSeat], "city")) return build("city", +v); return false; }
        if (kind === "settlement") { for (const v of board.vertices) if (A.canBuildSettlement(board, buildings, roads, v.id, curSeat) && A.canAfford(res[curSeat], "settlement")) return build("settlement", v.id); return false; }
        if (kind === "road") { for (const e of board.edges) if (A.canRoad(board, buildings, roads, e, curSeat, A.roadNetwork(roads, curSeat)) && A.canAfford(res[curSeat], "road")) return build("road", e); return false; }
        return false;
      },
      endTurn: () => endTurn(),
      mapInfo: () => ({ seed: SEED, hexes: board.hexes.map((h) => h.res.slice(0, 2) + (h.token || 0)).join(","), ports: PORTS.map((p) => p.type).join(",") }),
      undo: () => undoTurn(),
      canUndo: () => undoStack.length,
      // opening roll (headless: skips the dice tween, which needs rAF)
      frState: () => ({ phase, frSeat, frRolls: [...frRolls], firstSeat, setupOrder: [...setupOrder] }),
      frRoll: (total) => { if (phase !== "firstroll") return false; firstRollLanded(total || (2 + (Math.random() * 11 | 0))); return true; },
    },
  };
});
