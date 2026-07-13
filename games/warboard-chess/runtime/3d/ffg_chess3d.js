/**
 * FFG runtime — 3d/ffg_chess3d.js  (ES module)
 * WARBOARD CHESS — a REGULAR 3D chess game on the ffg_kernel_3d substrate. The
 * pieces are a classic Staunton set built procedurally with Three.js/WebGL2:
 * turned LatheGeometry silhouettes for pawn/rook/bishop/queen/king + a sculpted
 * (extruded) knight (see buildChessPiece), ivory vs ebony. A move LIFTS the piece,
 * glides it to the square, and sets it down; a capture SINKS the taken piece away.
 * The board sits in one of several ENVIRONMENT THEMES (mountains /
 * forest / desert / snow) chosen per match — each swaps the sky gradient, the
 * ground tint/material, and the kernel IBL tint (setEnvironment).
 *
 * Reuses the void-skirmish-3d patterns: T tile size + cell(x,y) world mapping,
 * the verified character GLBs + their real clip names, faceToward / play(once),
 * tween, orbit camera, DOM HUD, the FFG.Shell menu. Registers genre "chess3d".
 *
 * Single-player vs a simple AI (the sim's negamax). The net layer / PvP is a
 * later add — the sim is already side-agnostic so a remote opponent can drive
 * applyRemoteMove() in place of the AI.
 */
import * as THREE from "three";
import { createClassicalMusic } from "./ffg_chessmusic.js";
const _V = new URL(import.meta.url).search;
await import("../sim/chess.js" + _V);                 // sets window.FFG.sim.Chess
const { register3d } = await import("./ffg_kernel_3d.js" + _V);

const T = 3.0;                 // world units per board square (big so characters read large)
const BOARD_N = 8;

// shade a hex colour toward white (f>0) or black (f<0)
function shade(hex, f) {
  let r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { r *= (1 + f); g *= (1 + f); b *= (1 + f); }
  const c = (v) => Math.max(0, Math.min(255, v | 0));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

// ── Environment THEMES ────────────────────────────────────────────────────────
// Each theme: a vertical sky gradient (used as scene.background AND the IBL
// source), light tints, fog, and the two board-square colours + ground ring
// colour/material. Picked per match (cycled by a match counter or random).
const THEMES = {
  mountains: {
    name: "Mountain Pass",
    sky: ["#1a2740", "#33547e", "#6f93b8", "#9fb6cc"],
    light: { key: 0xfff1d8, keyI: 2.0, hemiSky: 0x9fc0e8, hemiGround: 0x3a4250, hemiI: 0.85, ambI: 0.34 },
    fog: 0x8a9fb4, fogD: 0.0042, ibl: 0.5, exposure: 1.0,
    light_sq: 0xcfd6dc, dark_sq: 0x5b6b7e, ring: 0x4a5564, ringRough: 0.85,
    accent: 0x8fd0ff, ground: 0x3e4a3a, groundRough: 0.95, mote: 0xcfe0f0,
  },
  forest: {
    name: "Forest Clearing",
    sky: ["#13251c", "#1f3d2c", "#3f6b48", "#9fb87f"],
    light: { key: 0xfff0c0, keyI: 1.8, hemiSky: 0xbfe0a0, hemiGround: 0x2a3320, hemiI: 0.8, ambI: 0.32 },
    fog: 0x5a7048, fogD: 0.0050, ibl: 0.46, exposure: 0.98,
    light_sq: 0xd7cfa8, dark_sq: 0x4f6b3c, ring: 0x3a4a28, ringRough: 0.95,
    accent: 0xbfff8f, ground: 0x2f4a28, groundRough: 1.0, mote: 0xd8ec9a,
  },
  desert: {
    name: "Desert Mesa",
    sky: ["#3a2b1c", "#8a6a3c", "#d9b06a", "#f0d8a0"],
    light: { key: 0xfff0c8, keyI: 2.3, hemiSky: 0xffe0a8, hemiGround: 0x6a5230, hemiI: 0.95, ambI: 0.4 },
    fog: 0xcdb98a, fogD: 0.0040, ibl: 0.6, exposure: 1.02,
    light_sq: 0xe6d2a0, dark_sq: 0x9c7a48, ring: 0x7a5d34, ringRough: 1.0,
    accent: 0xffcf6a, ground: 0xb89055, groundRough: 1.0, mote: 0xf0dca8,
  },
  snow: {
    name: "Frozen Tundra",
    sky: ["#1a2636", "#39506a", "#73879b", "#a7b4c0"],
    light: { key: 0xdfe8f2, keyI: 1.8, hemiSky: 0xb4cae0, hemiGround: 0x5a6676, hemiI: 0.85, ambI: 0.4 },
    fog: 0xaab8c6, fogD: 0.0052, ibl: 0.55, exposure: 0.95,
    light_sq: 0xeef4fa, dark_sq: 0x8fa6bc, ring: 0x7088a0, ringRough: 0.7,
    accent: 0x9fe6ff, ground: 0xccd8e2, groundRough: 0.7, mote: 0xffffff,
  },
};
const THEME_ORDER = ["mountains", "forest", "desert", "snow"];

// a tall vertical sky CanvasTexture from a 4-stop gradient (also feeds IBL)
function makeSkyTexture(stops) {
  const c = document.createElement("canvas"); c.width = 16; c.height = 256;
  const g = c.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0.00, stops[0]);
  grd.addColorStop(0.45, stops[1]);
  grd.addColorStop(0.80, stops[2]);
  grd.addColorStop(1.00, stops[3]);
  g.fillStyle = grd; g.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

register3d("chess3d", async (kernel, content) => {
  const scene = kernel.scene;
  const Chess = window.FFG.sim.Chess;
  const H = window.FFG.sim.ChessHelpers;
  const chessMusic = createClassicalMusic(0.16); // procedural classical piano (no naval track)
  const { fileOf, rankOf, algebraic } = H;

  // pick a theme: explicit content.theme, else cycle by a persisted match counter
  let themeKey = content.theme && THEMES[content.theme] ? content.theme
    : THEME_ORDER[(matchCounter() | 0) % THEME_ORDER.length];
  let theme = THEMES[themeKey];

  function matchCounter() {
    try { const k = "warboard_match_n"; const n = (parseInt(localStorage.getItem(k) || "0", 10) || 0); localStorage.setItem(k, String(n + 1)); return n; }
    catch (e) { return (Math.random() * 4) | 0; }
  }

  const W = BOARD_N * T, Hd = BOARD_N * T;
  // world centre of a board square (file x, rank y). Board centred on origin;
  // white (rank 0) sits at -z ("near" the default camera), black at +z.
  const cell = (x, y) => new THREE.Vector3((x + 0.5) * T - W / 2, 0, (y + 0.5) * T - Hd / 2);
  // reverse: world point -> {x:file, y:rank} or null
  function squareAt(px, pz) {
    const x = Math.floor((px + W / 2) / T), y = Math.floor((pz + Hd / 2) / T);
    return (x >= 0 && y >= 0 && x < BOARD_N && y < BOARD_N) ? { x, y } : null;
  }

  // ── sky + lighting + IBL for the chosen theme ───────────────────────────────
  scene.background = makeSkyTexture(theme.sky);
  if (kernel.setEnvironment) kernel.setEnvironment(scene.background, theme.ibl);
  scene.fog = new THREE.FogExp2(theme.fog, theme.fogD);
  // recolour the kernel's existing sun + add theme fill/hemi/ambient (never ADD a
  // runtime light per-move — shader recompiles freeze the game; we set these once)
  // De-washed for a clean, industry-standard chess presentation: a directional key
  // for crisp piece shadows + restrained fill, so the CHECKER reads with contrast
  // (the themes were over-lit — keyI 2+, exposure 1+ — flattening the board to grey).
  if (kernel.sun) { kernel.sun.color = new THREE.Color(theme.light.key); kernel.sun.intensity = theme.light.keyI * 0.72; kernel.sun.position.set(W * 0.45, Hd * 1.1, -Hd * 0.35); }
  scene.add(new THREE.HemisphereLight(theme.light.hemiSky, theme.light.hemiGround, theme.light.hemiI * 0.72));
  scene.add(new THREE.AmbientLight(0xffffff, theme.light.ambI * 0.62));   // more FILL so the ivory/ebony pieces read on the darker themes (was 0.44/0.36 → pieces too dark)
  kernel.renderer.toneMappingExposure = theme.exposure * 0.98;   // brightened for the calm regular-chess look (was 0.74 → pieces read too dark)
  // SSAO was the main chess choppiness — a heavy full-screen depth pass for little gain
  // on a clean board. Drop it; keep cinematic bloom + SMAA (cheap) for the glow + edges.
  if (kernel.enableBloom) kernel.enableBloom({ strength: 0.26, radius: 0.6, threshold: 0.88, ssao: false, gtao: false, smaa: true });

  // distant horizon ring (a big inverted cone of theme colour) so the board isn't
  // floating in a void — recedes into the fog. Cheap, single mesh.
  try {
    const horizon = new THREE.Mesh(
      new THREE.CylinderGeometry(W * 5, W * 5, Hd * 2.2, 32, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.sky[2]), side: THREE.BackSide, fog: true }));
    horizon.position.y = Hd * 0.4; scene.add(horizon);
  } catch (e) {}

  // ── board ───────────────────────────────────────────────────────────────────
  const FT = 0.16; // top of the board surface
  let groundPlane = null;
  const squareMeshes = {}; // "x,y" -> mesh (for highlight tinting)
  function buildBoard() {
    // a thick plinth under the board
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(W + T * 0.8, T * 0.5, Hd + T * 0.8),
      new THREE.MeshStandardMaterial({ color: shade(theme.ring, -0.2), roughness: theme.ringRough, metalness: 0.15, envMapIntensity: 1.0 }));
    plinth.position.set(0, -T * 0.25 + FT, 0); plinth.receiveShadow = true; scene.add(plinth);
    // decorative border frame — MUST sit BELOW the play surface (it was a tall slab
    // whose top covered the whole checker). Thin + low so it only peeks as a rim.
    const frame = new THREE.Mesh(new THREE.BoxGeometry(W + T * 0.4, T * 0.12, Hd + T * 0.4),
      new THREE.MeshStandardMaterial({ color: theme.ring, roughness: theme.ringRough * 0.8, metalness: 0.2, envMapIntensity: 0.5 }));
    frame.position.set(0, FT - 0.22, 0); frame.receiveShadow = true; scene.add(frame);

    // 64 square tiles (checker pattern). Slight bevel via inset top box.
    // De-shined + high-contrast so the CHECKER reads (metal/IBL was mirroring the
    // bright sky and washing the board to a uniform light grey). Matte, low env,
    // light squares lifted + dark squares pushed well down.
    // CLASSIC high-contrast chess squares (cream vs deep brown) with a light theme
    // tint so it still belongs to the environment but unmistakably reads as a board.
    // The IBL env was flooding the matte board to a uniform sky-grey (proven by
    // pixel-sampling). Opt the squares OUT of IBL (envMapIntensity 0) and give each
    // an EMISSIVE tint of its own colour so the cream/dark checker renders no matter
    // the lighting — guaranteed contrast, the industry-standard board read.
    const lc = new THREE.Color(0xece2cb).lerp(new THREE.Color(theme.light_sq), 0.1);
    const dc = new THREE.Color(0x231d15).lerp(new THREE.Color(theme.dark_sq), 0.1);
    const lightMat = new THREE.MeshStandardMaterial({ color: lc, emissive: lc.clone().multiplyScalar(0.28), roughness: 0.9, metalness: 0.0, envMapIntensity: 0.12 });
    const darkMat = new THREE.MeshStandardMaterial({ color: dc, emissive: dc.clone().multiplyScalar(0.35), roughness: 0.85, metalness: 0.0, envMapIntensity: 0.12 });
    const geo = new THREE.BoxGeometry(T * 0.98, T * 0.12, T * 0.98);
    for (let y = 0; y < BOARD_N; y++) {
      for (let x = 0; x < BOARD_N; x++) {
        const isLight = (x + y) % 2 === 1; // a1 (0,0) dark
        const m = new THREE.Mesh(geo, (isLight ? lightMat : darkMat).clone());
        const w = cell(x, y);
        m.position.set(w.x, FT + 0.06, w.z);
        m.receiveShadow = true;
        m.userData = { sqx: x, sqy: y, base: m.material.color.getHex(), isLight };
        scene.add(m); squareMeshes[x + "," + y] = m;
      }
    }
    // Explicit GRID LINES on the cell boundaries so the 8x8 board reads instantly
    // in every theme/lighting (the checker fill alone can wash out). Dark, thin.
    try {
      const grid = new THREE.GridHelper(T * BOARD_N, BOARD_N, 0x05080d, 0x05080d);
      grid.position.set(0, FT + 0.14, 0);
      if (grid.material) { grid.material.transparent = true; grid.material.opacity = 0.78; grid.material.depthWrite = false; }
      scene.add(grid);
    } catch (e) {}
    // invisible ground plane for raycasting clicks -> square
    groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(W, Hd), new THREE.MeshBasicMaterial({ visible: false }));
    groundPlane.rotation.x = -Math.PI / 2; groundPlane.position.set(0, FT + 0.13, 0); scene.add(groundPlane);

    // rank/file labels as small emissive markers? Keep it clean — skip for now.
    buildScatterDecor();
  }

  // theme-specific scatter beyond the board (rocks / trees / dunes / drifts) so
  // each environment reads distinctly. Cheap instanced-ish boxes/cones, no lights.
  function buildScatterDecor() {
    let seed = 0xC0FFEE ^ (themeKey.charCodeAt(0) * 2654435761);
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    // GROUND — a real grass/sand/snow surface the board sits in (was just a flat
    // horizon ring + fog). A big disc + scattered tone patches so it isn't one flat colour.
    const groundCol = theme.ground != null ? theme.ground : 0x35402a;
    const ground = new THREE.Mesh(new THREE.CircleGeometry(W * 3.2, 64),
      new THREE.MeshStandardMaterial({ color: groundCol, roughness: theme.groundRough || 1.0, metalness: 0.0 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; scene.add(ground);
    for (let i = 0; i < 24; i++) {
      const pr = W * (0.65 + rnd() * 2.4), pa = rnd() * Math.PI * 2;
      const patch = new THREE.Mesh(new THREE.CircleGeometry(T * (0.8 + rnd() * 2.4), 14),
        new THREE.MeshStandardMaterial({ color: shade(groundCol, rnd() * 0.22 - 0.11), roughness: 1.0 }));
      patch.rotation.x = -Math.PI / 2; patch.position.set(Math.cos(pa) * pr, 0.0, Math.sin(pa) * pr); patch.receiveShadow = true; scene.add(patch);
    }

    // SCATTER props in a ring, grounded at y=0. The ring starts WELL OUTSIDE the
    // board (board corners reach 0.707·W) so peaks/trees never sit on the checker —
    // each prop is also clamped so its base never reaches inside BOARD_CLEAR.
    const N = 0, ring0 = W * 1.25, ring1 = W * 3.1;   // scatter props (trees/peaks) REMOVED — battle clutter that read as floating artifacts on the calm chess board; the ground disc + fog + sky stay
    const BOARD_CLEAR = W * 0.82;   // nothing's footprint may cross this radius
    function makeTree() {
      const g = new THREE.Group();
      const trunkH = T * (0.9 + rnd() * 0.5);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(T * 0.1, T * 0.15, trunkH, 6),
        new THREE.MeshStandardMaterial({ color: shade(0x4a3526, rnd() * 0.2 - 0.1), roughness: 0.95 }));
      trunk.position.y = trunkH / 2; g.add(trunk);
      const base = shade(0x2e4a24, rnd() * 0.18 - 0.06); // varied evergreen
      for (let t = 0; t < 3; t++) { // stacked tiers = a real conifer silhouette
        const r = T * (0.9 - t * 0.22) * (0.9 + rnd() * 0.25), ch = T * (1.15 - t * 0.18);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(r, ch, 8),
          new THREE.MeshStandardMaterial({ color: shade(base, t * 0.06), roughness: 0.92, flatShading: true }));
        cone.position.y = trunkH + t * (ch * 0.6); g.add(cone);
      }
      g._br = T * 0.9;
      return g;
    }
    // a JAGGED, ridged low-poly mountain (displaced cone) with a snow cap painted via
    // per-vertex colour (snow above the snowline) — reads as a real rugged peak, not
    // a smooth ice-cream cone. snowy=true (tundra) => more snow, lower snowline.
    function makeMountain(snowy) {
      const h = T * (3.2 + rnd() * 5.5), baseR = T * (1.4 + rnd() * 1.8);
      const seg = 6 + (rnd() * 3 | 0);
      const geo = new THREE.ConeGeometry(baseR, h, seg, 4, false);
      const pos = geo.attributes.position, n = pos.count;
      const col = new Float32Array(n * 3);
      const rock = new THREE.Color(0x5b626c), snowC = new THREE.Color(0xeaf2fb);
      const snowline = snowy ? 0.32 : 0.62;
      for (let i = 0; i < n; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const t = (y + h / 2) / h;                       // 0 base .. 1 apex
        if (t > 0.02 && t < 0.985) {                     // ridge the sides, leave apex sharp
          const j = 1 + (rnd() - 0.5) * 0.55;
          pos.setX(i, x * j); pos.setZ(i, z * j);
          pos.setY(i, y + (rnd() - 0.5) * h * 0.05);
        }
        const c = t >= snowline ? snowC : (t >= snowline - 0.12 ? rock.clone().lerp(snowC, (t - (snowline - 0.12)) / 0.12) : rock);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, flatShading: true }));
      m.position.y = h / 2 - T * 0.12; m._br = baseR * 1.5;
      return m;
    }
    // a low grass tuft = a few thin blades; clusters of these read as real grass.
    function makeGrassTuft() {
      const g = new THREE.Group();
      const base = shade(0x4a7a32, rnd() * 0.22 - 0.08);
      const blades = 4 + (rnd() * 4 | 0);
      for (let b = 0; b < blades; b++) {
        const bh = T * (0.18 + rnd() * 0.28);
        const blade = new THREE.Mesh(new THREE.ConeGeometry(T * 0.03, bh, 3),
          new THREE.MeshStandardMaterial({ color: shade(base, rnd() * 0.12 - 0.06), roughness: 1.0, flatShading: true }));
        blade.position.set((rnd() - 0.5) * T * 0.4, bh / 2, (rnd() - 0.5) * T * 0.4);
        blade.rotation.z = (rnd() - 0.5) * 0.5; g.add(blade);
      }
      g._br = T * 0.3;
      return g;
    }
    function place(mesh, rad, ang) {
      const br = mesh._br || (mesh.geometry && mesh.geometry.boundingSphere ? mesh.geometry.boundingSphere.radius : T);
      if (rad - br < BOARD_CLEAR) rad = BOARD_CLEAR + br;     // never let a footprint touch the board
      mesh.position.x = Math.cos(ang) * rad; mesh.position.z = Math.sin(ang) * rad;
      mesh.traverse && mesh.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      if (mesh.isMesh) { mesh.castShadow = false; mesh.receiveShadow = false; }
      scene.add(mesh);
    }
    for (let i = 0; i < N; i++) {
      const ang = rnd() * Math.PI * 2, rad = ring0 + rnd() * (ring1 - ring0);
      let mesh;
      if (themeKey === "forest") { mesh = makeTree(); mesh.scale.setScalar(0.8 + rnd() * 0.9); mesh.rotation.y = rnd() * Math.PI * 2; }
      else if (themeKey === "mountains") mesh = makeMountain(false);
      else if (themeKey === "snow") mesh = makeMountain(true);
      else { // desert BUTTES — flat-topped, jagged sandstone mesas (not crude boxes)
        const h = T * (2 + rnd() * 4.5), rT = T * (1.0 + rnd() * 1.3), rB = rT * (1.35 + rnd() * 0.5);
        const seg = 6 + (rnd() * 3 | 0);
        const geo = new THREE.CylinderGeometry(rT, rB, h, seg, 3, false);
        const pos = geo.attributes.position, n = pos.count;
        const col = new Float32Array(n * 3);
        const lo = new THREE.Color(0x9a6f3c), hi = new THREE.Color(0xc79a5c); // sandstone strata: darker base -> lighter cap
        for (let i = 0; i < n; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), t = (y + h / 2) / h;
          if (t > 0.02 && t < 0.985) { const j = 1 + (rnd() - 0.5) * 0.4; pos.setX(i, x * j); pos.setZ(i, z * j); }
          const c = lo.clone().lerp(hi, t * 0.85 + (rnd() * 0.1));
          col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        }
        geo.setAttribute("color", new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
        mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0, flatShading: true }));
        mesh.position.y = h / 2 - T * 0.12; mesh._br = rB * 1.3;
      }
      place(mesh, rad, ang);
    }
    // GROUND DETAIL ring (closer in, but still clear of the board): grass tufts in the
    // forest, low snow drifts on the tundra — so the surface reads as real grass / snow.
    if (themeKey === "forest" || themeKey === "snow") {
      for (let i = 0; i < 60; i++) {
        const ang = rnd() * Math.PI * 2, rad = BOARD_CLEAR + rnd() * W * 1.8;
        let m;
        if (themeKey === "forest") { m = makeGrassTuft(); m.scale.setScalar(0.8 + rnd() * 1.1); }
        else { // snow drift: a low, wide, irregular white mound
          const dr = T * (0.6 + rnd() * 1.6);
          const dg = new THREE.SphereGeometry(dr, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2);
          const dp = dg.attributes.position; for (let k = 0; k < dp.count; k++) { dp.setX(k, dp.getX(k) * (1 + (rnd() - 0.5) * 0.4)); dp.setZ(k, dp.getZ(k) * (1 + (rnd() - 0.5) * 0.4)); }
          dg.computeVertexNormals();
          m = new THREE.Mesh(dg, new THREE.MeshStandardMaterial({ color: shade(0xe6eef6, rnd() * 0.06 - 0.03), roughness: 0.55, flatShading: true }));
          m.scale.y = 0.4;
        }
        place(m, rad, ang);
      }
    }

    buildAmbientParticles();
  }

  // drifting ambient motes (pollen / leaves / dust / snow) — gives the weak background
  // life + depth. Cheap THREE.Points, animated on the kernel update loop.
  function buildAmbientParticles() {
    const COUNT = 240, spanXZ = W * 3.0, spanY = Hd * 2.0;
    const geo = new THREE.BufferGeometry(), pos = new Float32Array(COUNT * 3), vel = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * spanXZ; pos[i * 3 + 1] = Math.random() * spanY; pos[i * 3 + 2] = (Math.random() - 0.5) * spanXZ;
      vel[i] = 0.25 + Math.random() * 0.8;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: theme.mote != null ? theme.mote : 0xffffff, size: T * 0.1, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    const motes = new THREE.Points(geo, mat); motes.frustumCulled = false; scene.add(motes);
    const fall = themeKey === "snow" ? 1.5 : 0.6;
    kernel.onUpdate((dt) => {
      const a = geo.attributes.position.array;
      for (let i = 0; i < COUNT; i++) {
        a[i * 3 + 1] -= vel[i] * fall * dt * 6;
        a[i * 3] += Math.sin((a[i * 3 + 1] + i) * 0.4) * dt * 4; // gentle sway
        if (a[i * 3 + 1] < -1) { a[i * 3 + 1] = spanY; a[i * 3] = (Math.random() - 0.5) * spanXZ; a[i * 3 + 2] = (Math.random() - 0.5) * spanXZ; }
      }
      geo.attributes.position.needsUpdate = true;
    });
  }

  // ── piece models (verified rigged GLBs + their real clip names) ──────────────
  // Each chess piece TYPE maps to a character model. The two rich humanoid rigs
  // (swat, adventurer) carry melee clips (Sword_Slash / Punch / Kick) which sell
  // the FIGHT; the robot rigs carry an "Attack"/"Shoot" + "Death"/"Dead". `h` is
  // the model's measured native height (feet at origin) for correct scaling; `th`
  // is the target world height; clips map our intents -> the model's clip names.
  const CHAR_BASE = new URL("./characters/", import.meta.url).href;
  const PIECE_MODELS = {
    // humanoid soldier — King & Pawn (foot soldiers); melee via Sword_Slash/Punch
    swat:       { url: "swat.glb",                  h: 1.854, th: T * 0.92, clips: { idle: "Idle_Gun", walk: "Walk", run: "Run", die: "Death", attack: "Sword_Slash", attack2: "Punch_Right", hurt: "HitRecieve" } },
    adventurer: { url: "adventurer.glb",            h: 1.854, th: T * 0.96, clips: { idle: "Idle",     walk: "Walk", run: "Run", die: "Death", attack: "Sword_Slash", attack2: "Kick_Right", hurt: "HitRecieve" } },
    // robot foes for the heavy pieces — distinct silhouettes
    robotLegs:  { url: "robot_enemy_legs_gun.glb",  h: 0.952, th: T * 0.9,  clips: { idle: "Idle", walk: "Walk", run: "Run", die: "Death", attack: "Attack" } },
    robotBig:   { url: "robot_enemy_large_gun.glb", h: 1.279, th: T * 1.12, clips: { idle: "Idle", walk: "Walk", run: "Run", die: "Death", attack: "Attack" } },
    robotFly:   { url: "robot_enemy_flying_gun.glb",h: 0.696, th: T * 0.86, clips: { idle: "Idle", walk: "Walk", run: "Run", die: "Dead",  attack: "Attack" }, hover: 0.5 },
  };
  // chess type -> model key + relative scale (heavier pieces = bigger/distinct)
  const TYPE_TO_MODEL = {
    P: { model: "swat",       scale: 0.86 },  // pawn = small soldier
    N: { model: "robotFly",   scale: 1.0  },  // knight = flying drone (the "leaper")
    B: { model: "robotLegs",  scale: 1.0  },  // bishop = walker bot
    R: { model: "robotBig",   scale: 1.0  },  // rook = heavy gun-platform (a tower)
    Q: { model: "adventurer", scale: 1.18 },  // queen = elite warrior (melee)
    K: { model: "swat",       scale: 1.16 },  // king = commander soldier
  };
  // CLASSIC chess armies: white = ivory/bone, black = ebony/charcoal. Strongly
  // override the GLB's tan base so the two sides read unmistakably (not muddy tints).
  const SIDE_TINT = { w: 0xeae3d2, b: 0x24272f };
  const SIDE_RING = { w: 0xf0ead8, b: 0x3a3f49 }; // base discs: pale ivory vs dark slate

  function resolveClip(char, name) { return (name && char.actions[name]) ? name : null; }

  // ── PROCEDURAL classic (Staunton) chess set ──────────────────────────────────
  // A REAL chess set built with Three.js/WebGL2: turned lathe silhouettes for the
  // pawn/rook/bishop/queen/king + a sculpted (extruded) knight. No character models.
  const PIECE_MAT = {
    w: new THREE.MeshStandardMaterial({ color: 0xf1e8d0, roughness: 0.42, metalness: 0.06, envMapIntensity: 0.9, emissive: 0xd0c6a8, emissiveIntensity: 0.52 }),  // ivory — emissive floor so it reads on any theme (AgX crushed the shadowed faces to near-black)
    b: new THREE.MeshStandardMaterial({ color: 0x2a2932, roughness: 0.38, metalness: 0.14, envMapIntensity: 0.7, emissive: 0x2a2a34, emissiveIntensity: 0.5 }),  // ebony — faint emissive so it's a readable dark, not a void
  };
  const PIECE_H = { P: 1.06, N: 1.28, B: 1.46, R: 1.12, Q: 1.70, K: 1.86 };   // heights in units of T
  // normalized silhouettes [radiusFrac, heightFrac]; r in base-radius units, y in piece-height units
  const PIECE_PROF = {
    P: [[0,0],[0.42,0],[0.42,0.05],[0.30,0.10],[0.22,0.15],[0.20,0.19],[0.27,0.23],[0.19,0.27],[0.13,0.34],[0.115,0.50],[0.21,0.56],[0.15,0.61],[0.235,0.71],[0.20,0.81],[0.11,0.91],[0,0.97]],
    R: [[0,0],[0.46,0],[0.46,0.06],[0.33,0.11],[0.27,0.16],[0.25,0.20],[0.31,0.24],[0.25,0.28],[0.25,0.32],[0.27,0.66],[0.35,0.70],[0.35,0.82],[0.30,0.84],[0.30,0.92],[0,0.92]],
    B: [[0,0],[0.43,0],[0.43,0.05],[0.31,0.10],[0.22,0.15],[0.20,0.19],[0.26,0.23],[0.19,0.27],[0.13,0.35],[0.12,0.44],[0.23,0.56],[0.24,0.64],[0.16,0.74],[0.185,0.78],[0.12,0.82],[0.165,0.88],[0.09,0.95],[0,0.99]],
    Q: [[0,0],[0.47,0],[0.47,0.06],[0.34,0.11],[0.25,0.17],[0.22,0.21],[0.29,0.25],[0.20,0.29],[0.15,0.37],[0.13,0.57],[0.22,0.67],[0.24,0.73],[0.18,0.82],[0.26,0.86],[0.24,0.90],[0,0.90]],
    K: [[0,0],[0.48,0],[0.48,0.06],[0.35,0.11],[0.26,0.17],[0.23,0.21],[0.30,0.25],[0.21,0.29],[0.16,0.37],[0.14,0.60],[0.23,0.72],[0.25,0.78],[0.19,0.86],[0.25,0.89],[0.23,0.92],[0,0.92]],
    N: [[0,0],[0.45,0],[0.45,0.06],[0.32,0.11],[0.26,0.16],[0.24,0.20],[0.30,0.24],[0.24,0.28],[0.22,0.33]],   // knight = base only; horse head added separately
  };
  function _latheMesh(prof, mat) {
    const pts = prof.map((p) => new THREE.Vector2(Math.max(0.0001, p[0]), p[1]));
    const g = new THREE.LatheGeometry(pts, 44); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m;
  }
  function _knightHead(mat, H) {
    // stylized horse head+neck silhouette in x(forward)-y(up), extruded along z
    const s = new THREE.Shape();
    const P = [[0.06,0.00],[0.10,0.20],[0.06,0.34],[0.30,0.40],[0.36,0.50],[0.30,0.56],[0.22,0.60],[0.18,0.70],[0.24,0.83],[0.14,0.74],[0.08,0.87],[0.00,0.72],[-0.10,0.50],[-0.16,0.24],[-0.10,0.00]];
    s.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) s.lineTo(P[i][0], P[i][1]); s.closePath();
    const depth = 0.30;
    const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, steps: 1 });
    geo.translate(0, 0, -depth / 2); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
    const k = (0.70 * H) / 0.87;                 // shape y-range ~0.87 -> occupy top 0.70 of the piece
    m.scale.setScalar(k); m.position.set(-0.02 * T, 0.30 * H, 0);   // sit on the base, balanced slightly back
    return m;
  }
  function buildChessPiece(type, side) {
    const mat = PIECE_MAT[side] || PIECE_MAT.w;
    const grp = new THREE.Group();
    const H = (PIECE_H[type] || 1) * T, R = T * 0.44;
    const prof = (PIECE_PROF[type] || PIECE_PROF.P).map((p) => [p[0] * R, p[1] * H]);
    grp.add(_latheMesh(prof, mat));
    if (type === "R") {                          // castle crenellations
      const merl = 8, rr = 0.24 * R, ry = 0.88 * H;
      for (let i = 0; i < merl; i += 2) { const a = (i / merl) * Math.PI * 2; const b = new THREE.Mesh(new THREE.BoxGeometry(0.13 * R, 0.10 * H, 0.13 * R), mat); b.position.set(Math.cos(a) * rr, ry, Math.sin(a) * rr); b.castShadow = true; grp.add(b); }
    } else if (type === "B") {                   // mitre finial
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.09 * R, 16, 12), mat); ball.position.y = 1.0 * H; ball.castShadow = true; grp.add(ball);
    } else if (type === "Q") {                    // coronet points + center jewel
      const pts = 7, rr = 0.20 * R, ry = 0.90 * H;
      for (let i = 0; i < pts; i++) { const a = (i / pts) * Math.PI * 2; const sp = new THREE.Mesh(new THREE.SphereGeometry(0.07 * R, 12, 10), mat); sp.position.set(Math.cos(a) * rr, ry, Math.sin(a) * rr); sp.castShadow = true; grp.add(sp); }
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.10 * R, 16, 12), mat); top.position.y = 0.97 * H; top.castShadow = true; grp.add(top);
    } else if (type === "K") {                    // surmounting cross
      const arm = 0.10 * R, up = new THREE.Mesh(new THREE.BoxGeometry(arm, 0.22 * H, arm), mat); up.position.y = 1.02 * H; up.castShadow = true; grp.add(up);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.24 * R, arm, arm), mat); cross.position.y = 1.05 * H; cross.castShadow = true; grp.add(cross);
    } else if (type === "N") {                    // sculpted horse head
      grp.add(_knightHead(mat, H));
    }
    grp.userData.pieceH = H;
    return grp;
  }

  // ── piece views ──────────────────────────────────────────────────────────────
  // pieceViews keyed by a stable piece id (we assign one per starting piece and
  // carry it through moves). value: { group, char, clips, ring, side, type, dead }
  const pieceViews = {};        // id -> view
  let nextPieceId = 1;
  const squareToId = {};        // "x,y" -> piece id currently on that square (mirror of sim board for views)

  async function makePieceView(side, type, x, y) {
    const id = nextPieceId++;
    const g = new THREE.Group();
    const w = cell(x, y);
    g.position.set(w.x, 0, w.z);

    // base ring (team colour, doubles as selection highlight)
    const ringMat = new THREE.MeshStandardMaterial({ color: SIDE_RING[side], emissive: SIDE_RING[side], emissiveIntensity: 0.25, roughness: 0.5, metalness: 0.3 });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(T * 0.42, T * 0.42, 0.12, 28), ringMat);
    ring.position.y = FT + 0.13; g.add(ring);

    // the procedural chess piece (turned lathe silhouette / sculpted knight)
    const piece = buildChessPiece(type, side);
    piece.position.y = FT + 0.14;
    g.add(piece);

    scene.add(g);
    const view = { id, group: g, char: null, piece, clips: {}, ring, side, type, dead: false, x, y };
    pieceViews[id] = view;
    faceForward(view);
    return view;
  }

  // only the KNIGHT visibly faces a direction (its head); the turned pieces are
  // radially symmetric so their rotation is irrelevant. White knight faces +z (up
  // the board toward black), black faces -z. Head is modelled with the muzzle at +x,
  // so +z needs a -90° yaw.
  function faceForward(v) { if (!v.piece) return; v.piece.rotation.y = (v.type === "N") ? (v.side === "w" ? -Math.PI / 2 : Math.PI / 2) : 0; }
  function faceToward(v, tx, ty) { /* pieces glide without turning in regular chess; knight keeps its forward facing */ }
  function anim(v, intent, opts) { if (v && v.char && v.clips && v.clips[intent]) v.char.play(v.clips[intent], opts); }   // inert now (procedural pieces carry no clips) but kept so callers don't throw

  // ── game state ────────────────────────────────────────────────────────────────
  let sim = null;
  let selected = null;          // selected piece id (player turn)
  let legalForSel = [];         // detailed legal moves for the selected piece
  let busy = false;             // true while an animation/AI turn is playing
  let phase = "menu";           // menu | playing | ended
  let playerSide = (content.playerSide === "b") ? "b" : "w"; // human plays white by default (online flips this)
  let aiSide = playerSide === "w" ? "b" : "w";
  // AI strength by CHESS skill. The menu sets this; higher = deeper negamax search =
  // genuinely stronger play. Novice also blunders sometimes (see chooseAIMove).
  const SKILL_DEPTH = { novice: 1, intermediate: 2, master: 3, grandmaster: 4 };
  let aiDepth = content.aiDepth != null ? content.aiDepth : 2;
  let aiSkill = "intermediate";
  function setAIDifficulty(d) {
    aiSkill = String(d || "intermediate").toLowerCase();
    aiDepth = SKILL_DEPTH[aiSkill] != null ? SKILL_DEPTH[aiSkill] : 2;
  }
  // ── online play (lazy) ──────────────────────────────────────────────────────
  let netMode = false;          // true once PLAY ONLINE starts a networked match
  let online = null;            // OnlineController (move-relay turn machine)
  let _onlineApi = null;
  // ── ranking (online-only, vs logged-in players) ─────────────────────────────
  let myProfile = null;         // {id, username} of the signed-in player (or null)
  let oppProfile = null;        // opponent's {id, username} (exchanged at match start)
  let matchNonce = null;        // host-generated; makes a deterministic match_id
  let _ratings = null;          // lazy ffg_ratings module
  let moveLog = [];

  function sfx(name, vol) { const u = content.sfx && content.sfx[name]; if (u) kernel.playSound(u, vol == null ? 0.55 : vol); }

  function buildGame() {
    sim = new Chess({ allowCastling: true, allowEnPassant: true });
    // spawn a view for every piece on the board, recording its id by square
    const tasks = [];
    for (let s = 0; s < 64; s++) {
      const p = sim.get(s); if (!p) continue;
      const x = fileOf(s), y = rankOf(s);
      tasks.push(makePieceView(p[0], p[1], x, y).then((v) => { squareToId[x + "," + y] = v.id; }));
    }
    return Promise.all(tasks);
  }

  // ── highlights ────────────────────────────────────────────────────────────────
  const _moveHints = [];
  function clearMoveHints() {
    for (const h of _moveHints) { scene.remove(h); if (h.geometry) h.geometry.dispose(); if (h.material) h.material.dispose(); }
    _moveHints.length = 0;
  }
  function clearHighlights() {
    clearMoveHints();
    for (const k in squareMeshes) {
      const m = squareMeshes[k];
      m.material.emissive && m.material.emissive.setHex(0x000000);
      m.material.emissiveIntensity = 0;
      m.material.color.setHex(m.userData.base);
      m.position.y = FT + 0.06;
    }
  }
  function highlightSquare(x, y, colorHex, lift) {
    const m = squareMeshes[x + "," + y]; if (!m) return;
    m.material.emissive && m.material.emissive.setHex(colorHex);
    m.material.emissiveIntensity = 0.6;
    if (lift) m.position.y = FT + 0.1;
  }
  // a bright floating marker on a legal square: a glowing DOT for a quiet move, a
  // glowing RING for a capture (classic chess-hint language). Bloom makes them pop.
  function addMoveHint(x, y, isCapture) {
    const w = cell(x, y), col = isCapture ? 0xff7a3c : 0x4fd06a;
    const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.3, roughness: 0.4, transparent: true, opacity: 0.95 });
    let h;
    if (isCapture) { h = new THREE.Mesh(new THREE.TorusGeometry(T * 0.36, T * 0.05, 10, 26), mat); h.rotation.x = Math.PI / 2; }
    else { h = new THREE.Mesh(new THREE.CylinderGeometry(T * 0.15, T * 0.15, 0.05, 22), mat); }
    h.position.set(w.x, FT + 0.17, w.z); h.renderOrder = 5; scene.add(h); _moveHints.push(h);
  }
  function showSelection(id) {
    clearHighlights();
    const v = pieceViews[id]; if (!v) return;
    highlightSquare(v.x, v.y, theme.accent, true);
    legalForSel = sim.legalMovesDetailed(H.sq(v.x, v.y));
    for (const m of legalForSel) {
      const tx = fileOf(m.to), ty = rankOf(m.to);
      const cap = !!(m.capture || m.enPassant);
      highlightSquare(tx, ty, cap ? 0xff5a3c : 0x4fd06a, false);
      addMoveHint(tx, ty, cap); // bright floating dot (move) / ring (capture)
    }
    // raise the selected piece's ring glow
    v.ring.material.emissiveIntensity = 0.9;
  }
  function deselect() {
    if (selected && pieceViews[selected]) pieceViews[selected].ring.material.emissiveIntensity = 0.25;
    selected = null; legalForSel = []; clearHighlights();
  }

  // ── applying a move with animation (incl. the FIGHT on capture) ──────────────
  // Returns a Promise that resolves when the animation completes.
  function animateMove(result) {
    return new Promise((resolve) => {
      const fromX = fileOf(result.from), fromY = rankOf(result.from);
      const toX = fileOf(result.to), toY = rankOf(result.to);
      const moverId = squareToId[fromX + "," + fromY];
      const v = pieceViews[moverId];
      if (!v) { resolve(); return; }

      // handle castling: the rook also slides (no fight)
      let rookAnimDone = Promise.resolve();
      if (result.castle && result.castleRook) {
        const rfx = fileOf(result.castleRook.from), rfy = rankOf(result.castleRook.from);
        const rtx = fileOf(result.castleRook.to), rty = rankOf(result.castleRook.to);
        const rookId = squareToId[rfx + "," + rfy];
        const rv = pieceViews[rookId];
        if (rv) {
          delete squareToId[rfx + "," + rfy];
          squareToId[rtx + "," + rty] = rookId;
          rv.x = rtx; rv.y = rty;
          faceToward(rv, rtx, rty); anim(rv, "walk", { fade: 0.15 });
          const rw = cell(rtx, rty);
          rookAnimDone = new Promise((res) => kernel.tween({ target: rv.group.position, to: { x: rw.x, z: rw.z }, duration: 0.5, onComplete: () => { anim(rv, "idle", { fade: 0.2 }); faceForward(rv); res(); } }));
        }
      }

      const targetW = cell(toX, toY);
      const capturedSq = result.capturedSquare; // -1 if none; en-passant differs from `to`
      const capturedId = (capturedSq != null && capturedSq >= 0) ? squareToId[fileOf(capturedSq) + "," + rankOf(capturedSq)] : null;
      const defender = capturedId != null ? pieceViews[capturedId] : null;

      // ── clean chess move: LIFT → glide → PLACE (no marching/fighting). A capture
      // sinks the taken piece as the mover arrives; the knight hops higher. ──
      const dist = Math.abs(toX - v.x) + Math.abs(toY - v.y);
      const dur = Math.max(0.34, Math.min(0.72, dist * 0.12));
      const lift = (v.type === "N" ? 0.95 : 0.5) * T;
      const baseY = v.group.position.y;
      if (defender) { defender.dead = true; sfx("hit", 0.5); fadeOutAndRemove(defender); }
      kernel.tween({
        target: v.group.position, to: { x: targetW.x, z: targetW.z }, duration: dur, ease: (x) => x * x * (3 - 2 * x),
        onUpdate: (e) => { v.group.position.y = baseY + Math.sin(Math.min(1, e) * Math.PI) * lift; },   // parabolic lift-and-place arc
        onComplete: () => {
          v.group.position.y = baseY;
          if (defender) { sfx("hit_heavy", 0.45); screenShake(4); clashFx(cell(toX, toY)); floatText(cell(toX, toY), "CAPTURED", 0xff8a5a); }
          faceForward(v); finalize();
        },
      });

      function finalize() {
        // update the view bookkeeping: mover now on (toX,toY)
        delete squareToId[fromX + "," + fromY];
        if (defender && capturedSq >= 0) delete squareToId[fileOf(capturedSq) + "," + rankOf(capturedSq)];
        squareToId[toX + "," + toY] = moverId;
        v.x = toX; v.y = toY;
        // promotion: swap the pawn model out for a queen model in place
        if (result.promotion) promoteView(v, result.promotion).then(() => Promise.all([rookAnimDone]).then(resolve));
        else rookAnimDone.then(resolve);
      }
    });
  }

  // swap a promoting pawn's model for the promoted type (default Q) in place
  async function promoteView(v, promoType) {
    const x = v.x, y = v.y, side = v.side;
    // remove old model group contents (keep nothing) and rebuild as the new type
    scene.remove(v.group);
    if (v.char) kernel.disposeMixer(v.char.mixer);
    delete pieceViews[v.id];
    const nv = await makePieceView(side, promoType, x, y);
    // preserve the id mapping so squareToId stays correct
    delete pieceViews[nv.id];
    nv.id = v.id; pieceViews[v.id] = nv;
    squareToId[x + "," + y] = v.id;
    floatText(cell(x, y), "PROMOTED", 0xffd24a);
  }

  function fadeOutAndRemove(v) {
    // a captured piece SINKS into the board + shrinks away, then is removed. We
    // transform the GROUP (per-instance) rather than fade materials — the piece
    // materials are SHARED across the army, so an opacity fade would dim them all.
    kernel.tween({ target: v.group.position, to: { y: v.group.position.y - T * 0.7 }, duration: 0.5, ease: (x) => x * x });
    kernel.tween({ target: v.group.scale, to: { x: 0.02, y: 0.02, z: 0.02 }, duration: 0.5, onComplete: () => { scene.remove(v.group); if (v.char) kernel.disposeMixer(v.char.mixer); delete pieceViews[v.id]; } });
  }

  // ── small VFX (no runtime lights) ─────────────────────────────────────────────
  function clashFx(pos) {
    // an expanding additive ring + spark burst at the strike point
    const ring = new THREE.Mesh(new THREE.TorusGeometry(T * 0.2, 0.05, 8, 20), new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.set(pos.x, FT + T * 0.5, pos.z); ring.rotation.x = Math.PI / 2; scene.add(ring);
    kernel.tween({ target: ring.scale, to: { x: 4, y: 4, z: 4 }, duration: 0.4 });
    kernel.tween({ target: ring.material, to: { opacity: 0 }, duration: 0.4, onComplete: () => scene.remove(ring) });
    // sparks
    const N = 10, geo = new THREE.BufferGeometry(), p = new Float32Array(N * 3), vel = [];
    for (let i = 0; i < N; i++) { p[i * 3] = pos.x; p[i * 3 + 1] = FT + T * 0.5; p[i * 3 + 2] = pos.z; vel.push([(Math.random() - 0.5) * 6, Math.random() * 6, (Math.random() - 0.5) * 6]); }
    geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffd27a, size: T * 0.1, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(pts);
    let life = 0; const upd = (dt) => {
      life += dt; const a = geo.attributes.position.array;
      for (let i = 0; i < N; i++) { a[i * 3] += vel[i][0] * dt; a[i * 3 + 1] += (vel[i][1] - 9.8 * life) * dt; a[i * 3 + 2] += vel[i][2] * dt; }
      geo.attributes.position.needsUpdate = true; pts.material.opacity = Math.max(0, 1 - life / 0.6);
      if (life > 0.6) { scene.remove(pts); const i = kernel._updaters.indexOf(upd); if (i >= 0) kernel._updaters.splice(i, 1); }
    };
    kernel.onUpdate(upd);
  }
  function screenShake(mag) {
    const el = kernel.renderer && kernel.renderer.domElement; if (!el || !mag) return;
    const reduce = (window.FFG && window.FFG.reducedMotion) ? 0.3 : 1;
    const start = performance.now(), dur = 240;
    (function frame(now) {
      const pr = (now - start) / dur;
      if (pr >= 1) { el.style.transform = ""; return; }
      const k = mag * (1 - pr) * reduce;
      el.style.transform = `translate(${(Math.random() * 2 - 1) * k}px, ${(Math.random() * 2 - 1) * k}px)`;
      requestAnimationFrame(frame);
    })(start);
  }
  const _floaters = [];
  function floatText(pos, text, colorHex) {
    const c = document.createElement("canvas"); c.width = 256; c.height = 64;
    const ctx = c.getContext("2d");
    ctx.font = "bold 40px 'Segoe UI',monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#000"; ctx.fillText(text, 130, 34);
    ctx.fillStyle = "#" + (colorHex || 0xffffff).toString(16).padStart(6, "0"); ctx.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(c);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(T * 1.1, T * 0.28, 1); spr.position.set(pos.x, FT + T * 1.4, pos.z); scene.add(spr);
    const f = { spr, t: 0 }; _floaters.push(f);
  }
  kernel.onUpdate((dt) => {
    for (let i = _floaters.length - 1; i >= 0; i--) {
      const f = _floaters[i]; f.t += dt; f.spr.position.y += dt * 0.8; f.spr.material.opacity = Math.max(0, 1 - f.t / 1.3);
      f.spr.quaternion.copy(kernel.camera.quaternion);
      if (f.t > 1.3) { scene.remove(f.spr); _floaters.splice(i, 1); }
    }
  });

  // ── turn flow ───────────────────────────────────────────────────────────────
  // Apply a move on the sim + animate it; then check status and either let the
  // human move (if it's their turn) or fire the AI. `byAI` flags AI-originated.
  let suppressAI = false; // test-only: when true, doMove won't auto-fire the AI reply
  async function doMove(from, to, promo, remote) {
    if (busy) return false;
    const result = sim.move(from, to, promo);
    if (!result.ok) return false;
    busy = true;
    deselect();
    moveLog.push({ side: result.mover, san: result.san });
    setHUD();
    await animateMove(result);
    // ONLINE: a LOCAL move (user click or timeout) is broadcast so the opponent's
    // sim applies the same move. A `remote` move came FROM the opponent — don't echo.
    if (netMode && !remote && online) {
      try { online.localMoved({ from, to, promo: (result.promotion || promo) || null }); } catch (e) {}
    }
    // status banners
    if (result.checkmate) { onCheckmate(result); busy = false; return true; }
    if (result.stalemate || result.draw) { onDraw(result); busy = false; return true; }
    if (result.check) { banner("CHECK!", theme.accent, 900); sfx("overwatch", 0.5); }
    busy = false;
    setHUD();
    // hand off to the AI if it's now the AI's move (single-player only — never online)
    if (!suppressAI && !netMode && phase === "playing" && sim.turn === aiSide) { setTimeout(aiTurn, 420); }
    return true;
  }

  async function aiTurn() {
    if (netMode || busy || phase !== "playing" || sim.turn !== aiSide) return;
    busy = true; setHUD("AI is thinking…");
    // compute on a microtask so the HUD repaints
    await new Promise((r) => setTimeout(r, 30));
    const pick = sim.allLegalMoves(aiSide);
    if (!pick.length) { busy = false; const st = sim.status(); if (st.checkmate) onCheckmate({ mover: playerSide }); else onDraw(st); return; }
    // use the sim's negamax to choose, but we apply via doMove for animation.
    // _chooseAIMove returns {from,to,promotion} without mutating.
    const choice = chooseAIMove(aiDepth);
    busy = false; // doMove sets its own busy
    if (choice) await doMove(choice.from, choice.to, choice.promotion);
  }

  // choose (don't apply) the AI's best move using a shallow negamax search by
  // cloning move application through the sim's apply/undo (read-only to caller).
  function chooseAIMove(depth) {
    const moves = sim.allLegalMoves(aiSide);
    if (!moves.length) return null;
    // Novice blunders ~30% of the time (random legal move) so a beginner can actually
    // win; deeper tiers never blunder and search deeper. This makes the curve FELT.
    if (aiSkill === "novice" && Math.random() < 0.3) {
      const r = moves[(Math.random() * moves.length) | 0];
      return { from: r.from, to: r.to, promotion: r.promotion };
    }
    moves.sort((a, b) => sim._moveOrder(b) - sim._moveOrder(a));
    let bestScore = -Infinity; const best = [];
    for (const m of moves) {
      const undo = sim._apply(m);
      const score = -sim._negamax(depth - 1, -Infinity, Infinity);
      sim._undo(undo);
      if (score > bestScore + 0.0001) { bestScore = score; best.length = 0; best.push(m); }
      else if (Math.abs(score - bestScore) <= 0.0001) best.push(m);
    }
    const pick = best[(Math.random() * best.length) | 0] || moves[0];
    return { from: pick.from, to: pick.to, promotion: pick.promotion };
  }

  function onCheckmate(result) {
    phase = "ended"; clearHighlights();
    if (netMode && online) { try { online.finish(); } catch (e) {} try { reportOnlineResult(result.mover === "w" ? "white" : "black"); } catch (e) {} }
    const winner = result.mover; // the side that delivered mate
    const youWin = winner === playerSide;
    banner(youWin ? "CHECKMATE — YOU WIN" : "CHECKMATE — YOU LOSE", youWin ? 0x4fd06a : 0xff5a3c, 2600);
    sfx(youWin ? "victory" : "defeat", 0.8);
    setTimeout(() => { if (shell) shell.end(youWin, (youWin ? "Checkmate · " : "Defeated · ") + sim.fullmove + " moves · " + theme.name); }, 1700);
  }
  function onDraw(result) {
    phase = "ended"; clearHighlights();
    if (netMode && online) { try { online.finish(); } catch (e) {} try { reportOnlineResult("draw"); } catch (e) {} }
    const why = result.stalemate ? "Stalemate" : result.fiftyMove ? "50-move draw" : result.insufficient ? "Insufficient material" : "Draw";
    banner("DRAW — " + why, theme.accent, 2400);
    // (per-move confirm blip removed — the move animation + capture hit carry it)
    setTimeout(() => { if (shell) shell.end(false, why + " · " + sim.fullmove + " moves"); }, 1700);
  }

  // ── input: click to select / move (player turn only) ─────────────────────────
  function onPointerDown(ev) {
    if (phase !== "playing" || busy || sim.turn !== playerSide) return;
    if (ev.button !== undefined && ev.button !== 0) return; // left-click only (right = camera)
    // raycast pieces first (so clicking a model selects/targets it), then ground
    const pieceObjs = [];
    for (const id in pieceViews) { const v = pieceViews[id]; if (!v.dead) pieceObjs.push(v.group); }
    let sqHit = null, idHit = null;
    const hitsP = kernel.raycast(ev.clientX, ev.clientY, pieceObjs);
    if (hitsP.length) {
      // find which view owns the hit object
      let o = hitsP[0].object;
      outer: for (const id in pieceViews) { const v = pieceViews[id]; if (v.dead) continue; v.group.traverse((c) => { if (c === o) { idHit = +id; } }); if (idHit) break outer; }
      if (idHit) { const v = pieceViews[idHit]; sqHit = { x: v.x, y: v.y }; }
    }
    if (!sqHit) {
      const hitsG = kernel.raycast(ev.clientX, ev.clientY, [groundPlane]);
      if (hitsG.length) sqHit = squareAt(hitsG[0].point.x, hitsG[0].point.z);
    }
    if (!sqHit) { deselect(); return; }

    const clickedId = squareToId[sqHit.x + "," + sqHit.y];
    const clickedPiece = clickedId ? pieceViews[clickedId] : null;

    if (selected) {
      // is the clicked square a legal destination?
      const dest = H.sq(sqHit.x, sqHit.y);
      const m = legalForSel.find((mm) => mm.to === dest);
      if (m) { doMove(H.sq(pieceViews[selected].x, pieceViews[selected].y), dest, m.isPromo ? "Q" : undefined); return; }
      // clicked another own piece -> reselect; else deselect
      if (clickedPiece && clickedPiece.side === playerSide) { selected = clickedId; showSelection(selected); sfx("click", 0.3); return; }
      deselect(); return;
    }
    // no selection yet: select an own piece
    if (clickedPiece && clickedPiece.side === playerSide) { selected = clickedId; showSelection(selected); sfx("click", 0.35); }
  }

  // ── HUD + banners ────────────────────────────────────────────────────────────
  function setHUD(note) {
    if (!sim) return;
    const turnSide = sim.turn;
    const toMove = turnSide === playerSide ? "YOUR MOVE" : "OPPONENT";
    const youColor = playerSide === "w" ? "White" : "Black";
    const st = sim.status();
    const checkTag = st.inCheck ? `<span style="color:#ff6a4a;font-weight:700"> · CHECK</span>` : "";
    const tcol = turnSide === playerSide ? theme.accent : 0xff8a6a;
    const tHex = "#" + tcol.toString(16).padStart(6, "0");
    // ── move-history panel: two columns (White left, Black right), paired by move
    // number. Shows the most recent rows so a long game stays readable. (No bottom
    // move line — that was the cramped single row the user asked to remove.)
    const rows = [];
    for (let i = 0; i < moveLog.length; i++) {
      const m = moveLog[i]; const isW = m.side === "w";
      let row = rows.length ? rows[rows.length - 1] : null;
      if (isW || !row || row.b) { row = { n: rows.length + 1, w: "", b: "" }; rows.push(row); }
      if (isW) row.w = m.san; else row.b = m.san;
    }
    const recent = rows.slice(-12);
    const rowsHtml = recent.map(r =>
      `<tr><td style="color:#6f7d92;text-align:right;padding-right:8px;width:22px">${r.n}.</td>` +
      `<td style="color:#f1f4fa;width:60px">${r.w || ""}</td>` +
      `<td style="color:#c8d2e2;width:60px">${r.b || "…"}</td></tr>`).join("") ||
      `<tr><td colspan="3" style="color:#6f7d92;font-style:italic">no moves yet</td></tr>`;
    const youW = playerSide === "w";
    const movePanel =
      `<div style="position:absolute;top:64px;left:14px;background:rgba(8,14,24,0.74);border:1px solid #2a3a52;border-radius:9px;padding:8px 10px;font-family:'Segoe UI Semibold',monospace;font-size:12.5px;min-width:172px">
        <div style="display:flex;justify-content:space-between;font-size:10px;letter-spacing:1px;color:#8ea2bd;border-bottom:1px solid #2a3a52;padding-bottom:4px;margin-bottom:4px">
          <span style="margin-left:30px;color:#f1f4fa">WHITE${youW ? " (you)" : ""}</span><span style="color:#c8d2e2">BLACK${!youW ? " (you)" : ""}</span>
        </div>
        <table style="border-collapse:collapse;line-height:1.45">${rowsHtml}</table>
      </div>`;
    kernel.hud(
      `<div style="position:absolute;top:14px;left:0;right:0;text-align:center;font-family:'Segoe UI',monospace">
        <div style="display:inline-block;background:rgba(8,14,24,0.72);border:1px solid ${tHex};border-radius:10px;padding:8px 18px">
          <span style="font-size:18px;font-weight:800;letter-spacing:1px;color:${tHex}">${note || toMove}</span>${checkTag}
          <div style="font-size:11px;opacity:0.8;margin-top:2px">You play ${youColor} · ${theme.name} · move ${sim.fullmove}</div>
        </div>
      </div>
      ${movePanel}
      <div style="position:absolute;bottom:14px;right:14px;font-family:monospace;font-size:11px;opacity:0.6;color:#aab4c8">Left-click select + move · <b>WASD</b> pan · Right-drag rotate · scroll zoom</div>`
    );
  }
  let _bannerEl = null;
  function banner(text, colorHex, ms) {
    try {
      if (!_bannerEl) {
        _bannerEl = document.createElement("div");
        Object.assign(_bannerEl.style, { position: "absolute", top: "42%", left: "0", right: "0", textAlign: "center", pointerEvents: "none", zIndex: "40", fontFamily: "'Segoe UI',monospace", fontWeight: "900", textShadow: "0 3px 14px #000", transition: "opacity 0.3s" });
        kernel.parent.appendChild(_bannerEl);
      }
      _bannerEl.style.color = "#" + (colorHex || 0xffffff).toString(16).padStart(6, "0");
      _bannerEl.style.fontSize = "clamp(28px,5vw,56px)";
      _bannerEl.textContent = text; _bannerEl.style.opacity = "1";
      clearTimeout(_bannerEl._t);
      _bannerEl._t = setTimeout(() => { if (_bannerEl) _bannerEl.style.opacity = "0"; }, ms || 1200);
    } catch (e) {}
  }

  // ── camera (orbit + zoom) ─────────────────────────────────────────────────────
  const span = Math.max(W, Hd);
  kernel.camera.fov = 42; kernel.camera.updateProjectionMatrix();
  // start behind the player's back rank looking up the board
  // Proper chess look-DOWN (~58°) so the whole board + grid read — not the old
  // near-horizontal angle that foreshortened it. Stable (no auto-rotate in play).
  const startZ = playerSide === "w" ? -span * 0.72 : span * 0.72;
  kernel.camera.position.set(0, span * 1.18, startZ);
  const orbit = kernel.enableOrbit({
    target: { x: 0, y: 0, z: 0 },
    minDistance: T * 6, maxDistance: span * 2.4,
    minPolarAngle: 0.12, maxPolarAngle: Math.PI * 0.44,
    rotateButton: "right",
    autoRotate: false,
    wasdPan: true, panSpeed: span * 0.5, // W/A/S/D glide the camera around the board (was off)
  });

  // ── F3 DEBUG overlay: FPS + DPR + draw calls + triangles + live piece count ──
  (function setupDebugOverlay() {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;left:10px;top:10px;z-index:9999;font:12px/1.55 ui-monospace,Menlo,Consolas,monospace;color:#8effc0;background:rgba(6,12,20,.74);border:1px solid rgba(120,220,180,.35);border-radius:8px;padding:7px 11px;pointer-events:none;white-space:pre;display:none";
    (kernel.parent || document.body).appendChild(el);
    let on = false, frames = 0, acc = 0, fps = 0, lo = 999;
    kernel.onUpdate((dt) => {
      if (!on) return;
      frames++; acc += dt; const inst = dt > 0 ? 1 / dt : 0; if (inst < lo) lo = inst;
      if (acc >= 0.5) { fps = Math.round(frames / acc); frames = 0; acc = 0; const _lo = Math.round(lo); lo = 999;
        const r = kernel.renderer, info = r && r.info;
        el.textContent = "FPS " + fps + "  (low " + _lo + ")\nDPR " + (r ? r.getPixelRatio().toFixed(2) : "?") +
          "\ndraw calls " + (info ? info.render.calls : "?") + "\ntriangles " + (info ? info.render.triangles.toLocaleString() : "?") +
          "\npieces " + Object.keys(pieceViews).length; }
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "F3" || e.code === "F3") { e.preventDefault(); on = !on; el.style.display = on ? "block" : "none"; if (on) el.textContent = "FPS …"; }
    });
    window.__CHESS_DEBUG__ = { toggle: () => { on = !on; el.style.display = on ? "block" : "none"; return on; }, fps: () => fps };
  })();

  // ── shell wiring ────────────────────────────────────────────────────────────
  let shell = null;
  async function beginGame() {
    phase = "playing";
    // (re)build a fresh game; clear any prior views
    for (const id in pieceViews) { const v = pieceViews[id]; scene.remove(v.group); if (v.char) kernel.disposeMixer(v.char.mixer); }
    for (const k in pieceViews) delete pieceViews[k];
    for (const k in squareToId) delete squareToId[k];
    moveLog = []; selected = null; busy = false;
    if (orbit) orbit.autoRotate = false; // stop the menu spin once playing
    // ALWAYS start square-on. The menu slowly auto-rotates the camera, so on Play we
    // reset to the straight look STRAIGHT up the board — otherwise the board "starts
    // tilted" at whatever azimuth the menu spin happened to reach.
    kernel.camera.position.set(0, span * 1.18, startZ);
    if (orbit) { orbit.target.set(0, 0, 0); orbit.update(); }
    // gentle classical piano. The ?mode=ai launcher deep-link auto-starts WITHOUT a
    // user gesture on this page, so the AudioContext is suspended and start() can't
    // resume — arm a one-shot gesture (any click/key) to resume it. A normal Play
    // click already carries the gesture, so it begins immediately in that case.
    try { chessMusic.start(); } catch (e) {}
    try {
      const _arm = () => { try { chessMusic.start(); } catch (e) {} window.removeEventListener("pointerdown", _arm); window.removeEventListener("keydown", _arm); };
      window.addEventListener("pointerdown", _arm); window.addEventListener("keydown", _arm);
    } catch (e) {}
    await buildGame();
    setHUD();
    sfx("confirm", 0.5);
    if (content.audio && content.audio.music && shell && shell._playMusic) { /* shell handles music */ }
    // if the human plays black, the AI (white) moves first (single-player only)
    if (!netMode && sim.turn === aiSide) setTimeout(aiTurn, 600);
  }

  buildBoard();
  kernel.renderer.domElement.addEventListener("pointerdown", onPointerDown);

  if (window.FFG && window.FFG.Shell) {
    shell = new window.FFG.Shell({
      parent: kernel.parent,
      title: content.title || "Chess",
      tagline: content.tagline || "A calm, classic game of chess in 3D.",
      music: null, // chess uses the procedural CLASSICAL loop (createClassicalMusic), not a file track
      menuImage: (content.assets && content.assets.menu_image) || null,
      // difficulty BY CHESS SKILL — each maps to a real negamax search depth so the
      // AI genuinely gets stronger (Novice also blunders; Grandmaster searches deepest).
      difficulties: ["Novice", "Intermediate", "Master", "Grandmaster"],
      defaultDifficulty: "Intermediate",
      howTo: [
        { h: "GOAL", p: "Checkmate the enemy king. Standard chess rules — but your pieces are living warriors who fight when they capture." },
        { h: "MOVE", p: "Click one of your pieces to select it; legal squares light up (green = move, red = capture). Click a lit square to move there." },
        { h: "BATTLE", p: "When you capture, your piece advances and strikes; the defender falls before it's removed from the board." },
        { h: "CAMERA", p: "<b>WASD</b> to pan around the board, <b>right-drag</b> to orbit, scroll to zoom. The match is set in a different environment each time." },
      ],
      onPlay: (d) => { setAIDifficulty(d); beginGame(); },
      onPause: () => { kernel.stop(); try { chessMusic.stop(); } catch (e) {} },
      onResume: () => { kernel.start(); try { chessMusic.start(); } catch (e) {} },
    });
    // optional autostart (for the smoke test / uploader)
    let autostart = false;
    try { const k = "ffg_autostart_" + (content.slug || "chess"); autostart = window.sessionStorage.getItem(k) === "1"; if (autostart) window.sessionStorage.removeItem(k); } catch (e) {}
    if (autostart) { shell.hide(); shell.phase = "playing"; if (shell._playMusic) shell._playMusic(); beginGame(); }
    else shell.start();

    // ── PLAY ONLINE: inject a button beside the shell's PLAY without editing the
    // shared shell. The shell rebuilds ov.innerHTML on every menu(), so re-add it
    // each time the title returns. (Same technique Iron Tide uses.)
    const _origMenu = shell.menu.bind(shell);
    shell.menu = function () {
      _origMenu();
      try {
        if (shell.phase !== "menu" || !shell.ov) return;
        const ob = document.createElement("button");
        ob.textContent = "🌐  PLAY ONLINE";
        ob.style.cssText = "font:bold 15px 'Segoe UI',system-ui,monospace;padding:11px 26px;cursor:pointer;min-width:200px;" +
          "letter-spacing:1px;border-radius:7px;margin-top:8px;color:#06121f;background:linear-gradient(#9fe0ff,#4fb6e0);" +
          "border:1px solid #7fd0f0;box-shadow:0 4px 18px rgba(80,180,224,.32);transition:transform .08s";
        ob.onmouseenter = () => { ob.style.transform = "translateY(-1px)"; };
        ob.onmouseleave = () => { ob.style.transform = "none"; };
        ob.onclick = () => { shell.hide(); shell.phase = "playing"; startOnline(); };
        const playBtn = Array.prototype.find.call(shell.ov.querySelectorAll("button"), (b) => /PLAY/i.test(b.textContent) && !/ONLINE/i.test(b.textContent));
        if (playBtn && playBtn.parentNode) playBtn.parentNode.insertBefore(ob, playBtn.nextSibling);
        else shell.ov.appendChild(ob);
      } catch (e) { /* additive — never block the menu */ }
    };
    // If we're sitting on the title right now, re-render so the button appears.
    if (shell.phase === "menu") shell.menu();
    // Launcher deep-link. ?mode=ai -> just SHOW THE MENU (the owner wants the difficulty
    // picker + music): the normal PLAY button starts the vs-Computer match with the chosen
    // skill, and that click is the user gesture that lets the AudioContext play. Auto-
    // starting here skipped the menu AND left music suspended (no gesture) — the recurring
    // "no menu / no difficulty / no music" bug when launched from _play.html?mode=ai.
    // ?mode=online still jumps straight to the online lobby (no difficulty there).
    try {
      const _m = new URLSearchParams(location.search).get("mode");
      if (_m === "online") { shell.hide(); shell.phase = "playing"; startOnline(); }
      // _m === "ai" (or none): leave shell.start()'s menu up.
    } catch (e) { /* deep-link optional */ }
  } else {
    beginGame();
  }

  // ── online play (lazy) ────────────────────────────────────────────────────────
  // A tiny HUD line for the online turn timer / status + a rank chip (SP ignores it).
  let _onlineHud = null, _rankLine = "", _lastStatus = null;
  function onlineStatus(o) {
    if (!o) { if (_onlineHud) _onlineHud.style.display = "none"; return; }
    _lastStatus = o;
    if (!_onlineHud) {
      _onlineHud = document.createElement("div");
      _onlineHud.style.cssText = "position:absolute;top:64px;left:0;right:0;text-align:center;z-index:40;" +
        "font-family:'Segoe UI',monospace;pointer-events:none";
      (kernel.parent || document.body).appendChild(_onlineHud);
    }
    _onlineHud.style.display = "block";
    const t = o.secsLeft != null ? o.secsLeft : "";
    const col = o.myTurn ? "#7CFC9A" : "#ff9a6a";
    const clock = o.secsLeft != null ? `<span style="font-weight:900"> · ⏱ ${t}s</span>` : "";
    const rank = _rankLine ? `<div style="font-size:11px;opacity:.8;margin-top:3px;color:#bcd">${_rankLine}</div>` : "";
    _onlineHud.innerHTML = `<div style="display:inline-block;background:rgba(8,14,24,.78);border:1px solid ${col};border-radius:9px;padding:6px 16px;color:${col};font-size:14px;font-weight:700;letter-spacing:1px">${o.banner || ""}${clock}${rank}</div>`;
  }

  // ── ranking glue ──────────────────────────────────────────────────────────
  async function loadRatings() {
    if (!_ratings) _ratings = await import("../net/ffg_ratings.js" + new URL(import.meta.url).search);
    return _ratings;
  }
  // On match start: learn who I am (if signed in), tell the opponent, learn who they
  // are. Host coins a nonce so both sides derive the same match_id. All best-effort —
  // a signed-out player just plays unrated.
  async function setupRatingHandshake(isHost) {
    myProfile = null; oppProfile = null; matchNonce = isHost ? Math.random().toString(36).slice(2, 10) : null;
    try {
      const R = await loadRatings();
      myProfile = await R.currentPlayer();
      if (online) online.sendRaw("hello", { id: myProfile ? myProfile.id : null, name: myProfile ? myProfile.username : null, nonce: matchNonce });
      if (myProfile) {
        const r = await R.getRating(myProfile.id, "warboard-chess");
        const tier = R.rankTier(r.rating);
        _rankLine = `${myProfile.username} · ${r.rating} ${tier.name} · ${r.wins}W-${r.losses}L-${r.draws}D`;
      } else { _rankLine = "Playing unrated — sign in on the site to rank up"; }
      _repaintStatus();
    } catch (e) {}
  }
  // Report the finished online game (online + both signed in only). Shows the delta.
  function reportOnlineResult(outcome /* 'white'|'black'|'draw' */) {
    if (!netMode || !myProfile || !oppProfile || !matchNonce) return;
    const room = (online && online.net) ? online.net.room : "r";
    const matchId = "warboard-chess:" + room + ":" + matchNonce;
    const whiteId = (playerSide === "w") ? myProfile.id : oppProfile.id;
    const blackId = (playerSide === "w") ? oppProfile.id : myProfile.id;
    loadRatings().then((R) => R.reportResult("warboard-chess", whiteId, blackId, outcome, matchId).then((res) => {
      if (!res) return;
      const mine = (playerSide === "w") ? res.white : res.black;
      const delta = mine && mine.delta != null ? mine.delta : (mine && mine.after != null ? mine.after - (mine.before || 0) : 0);
      const after = mine && mine.after != null ? mine.after : null;
      if (after != null) {
        const tier = R.rankTier(after);
        banner(`${delta >= 0 ? "+" : ""}${delta} → ${after} (${tier.name})`, delta >= 0 ? 0x7CFC9A : 0xff8a6a, 3200);
      }
    }));
  }
  function _repaintStatus() { if (_lastStatus) onlineStatus(_lastStatus); }

  function buildOnlineIface() {
    return {
      parent: kernel.parent,
      gameId: "warboard-chess",
      onLobbyOpen: () => { if (orbit) orbit.autoRotate = false; },
      onLobbyBack: () => { netMode = false; phase = "menu"; onlineStatus(null); shell && shell.start(); },
      onPeerMessage: (t, d) => {
        if (t === "hello" && d) {
          oppProfile = d.id ? { id: d.id, username: d.name || "Opponent" } : null;
          if (d.nonce && !matchNonce) matchNonce = d.nonce; // guest adopts host's nonce
        }
      },
      startGame: (isHost) => {
        netMode = true; suppressAI = true;
        playerSide = isHost ? "w" : "b";   // host plays White (moves first)
        aiSide = playerSide === "w" ? "b" : "w";
        onlineStatus({ myTurn: isHost, banner: isHost ? "You play White" : "You play Black", secsLeft: null });
        beginGame();
        setupRatingHandshake(isHost);
      },
      isMyTurn: () => !!sim && phase === "playing" && sim.turn === playerSide,
      isOver: () => phase === "ended",
      applyRemoteMove: (p) => { if (!p) return; return doMove(p.from, p.to, p.promo || undefined, true); },
      randomMove: () => {
        if (!sim) return;
        const mv = sim.allLegalMoves(playerSide);
        if (mv.length) { const m = mv[(Math.random() * mv.length) | 0]; doMove(m.from, m.to, m.promotion || undefined); }
      },
      setStatus: (s) => onlineStatus(s),
      end: (victory, sub) => { phase = "ended"; clearHighlights(); onlineStatus(null); banner(victory ? "YOU WIN" : "YOU LOSE", victory ? 0x4fd06a : 0xff5a3c, 2400); setTimeout(() => { if (shell) shell.end(victory, sub || ""); }, 1400); },
      onError: (msg) => { try { console.warn("[online]", msg); } catch (e) {} },
    };
  }
  async function startOnline() {
    if (!_onlineApi) {
      const mod = await import("../net/ffg_online.js" + new URL(import.meta.url).search);
      _onlineApi = mod.installOnline(buildOnlineIface());
      online = _onlineApi.controller;
    }
    netMode = true;
    _onlineApi.openLobby();
  }

  // ── controller + test affordances ────────────────────────────────────────────
  const controller = {
    get sim() { return sim; },
    theme: () => themeKey,
    __test: {
      start: () => { if (shell) { shell.hide(); shell.phase = "playing"; } return beginGame(); },
      state: () => ({
        phase, turn: sim ? sim.turn : null, busy,
        check: sim ? sim.inCheck(sim.turn) : false,
        status: sim ? sim.status() : null,
        pieces: Object.keys(pieceViews).length,
        sceneChildren: scene.children.length,
        theme: themeKey,
        moveLog: moveLog.slice(),
      }),
      // apply a player move by algebraic squares, animated (drives the fight path)
      move: (from, to, promo) => doMove(H.fromAlgebraic(from), H.fromAlgebraic(to), promo),
      // force the AI to take one move now (animated)
      aiMove: () => aiTurn(),
      // play a FRESH game out to a resolution (random legal moves, both sides) so the
      // feel-gate can certify chess reaches an end state. Pure sim — never touches the
      // live board/views.
      autoResolve: () => {
        try {
          const g = new Chess(); let n = 0;
          while (n++ < 240) {
            const st = g.status(); if (st.checkmate || st.stalemate || st.draw) break;
            const mv = g.allLegalMoves(g.turn); if (!mv.length) break;
            const m = mv[(Math.random() * mv.length) | 0];
            if (!g.move(m.from, m.to, m.promotion).ok) break;
          }
          const st = g.status();
          // mate/stale/explicit-draw/no-moves OR a 240-ply game (random play rarely
          // mates — a game this long IS a draw, and real chess draws it by 75-move/
          // repetition). Either way the engine drove a complete game = resolved.
          const ended = !!(st.checkmate || st.stalemate || st.draw) || g.allLegalMoves(g.turn).length === 0 || n >= 240;
          return { ended, victory: !!st.checkmate && st.turn === "b", result: st.checkmate ? "checkmate" : st.stalemate ? "stalemate" : st.draw ? "draw" : "draw-by-length", moves: g.fullmove };
        } catch (e) { return { ended: false, err: String(e) }; }
      },
      // TEST-ONLY: play a deterministic move sequence (both sides), animated,
      // WITHOUT the AI interjecting — so a capture/fight can be forced reliably.
      // moves = [["e2","e4"],["d7","d5"],["e4","d5"]] etc. Resolves when done.
      playLine: async (moves) => {
        suppressAI = true;
        try {
          for (const mv of moves) {
            // wait for any in-flight animation to settle
            let guard = 0; while (busy && guard++ < 200) { await new Promise((r) => setTimeout(r, 30)); }
            await doMove(H.fromAlgebraic(mv[0]), H.fromAlgebraic(mv[1]), mv[2]);
          }
        } finally { suppressAI = false; }
        let guard = 0; while (busy && guard++ < 200) { await new Promise((r) => setTimeout(r, 30)); }
        return true;
      },
      // legal destinations (algebraic) for a square, for assertions
      legal: (sqAlg) => (sim ? sim.legalMoves(H.fromAlgebraic(sqAlg)).map(algebraic) : []),
      // count live piece views per side
      counts: () => { let w = 0, b = 0; for (const id in pieceViews) { const v = pieceViews[id]; if (v.dead) continue; if (v.side === "w") w++; else b++; } return { w, b }; },
      setTheme: (k) => { if (THEMES[k]) { themeKey = k; theme = THEMES[k]; } return themeKey; },
      busy: () => busy,
    },
  };
  return controller;
});
