/**
 * FFG runtime — 3d/ffg_chess3d.js  (ES module)
 * WARBOARD CHESS — 3D battle-chess on the ffg_kernel_3d substrate. Standard chess
 * on an 8×8 board, but every piece is a RIGGED + ANIMATED character (kernel
 * loadCharacter); on a capture the attacker walks in and plays a melee/attack
 * clip while the defender plays its death clip, then the captured piece is
 * removed. The board sits in one of several ENVIRONMENT THEMES (mountains /
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
    fog: 0x9fb6cc, fogD: 0.0085, ibl: 0.62, exposure: 1.05,
    light_sq: 0xcfd6dc, dark_sq: 0x5b6b7e, ring: 0x4a5564, ringRough: 0.85,
    accent: 0x8fd0ff,
  },
  forest: {
    name: "Forest Clearing",
    sky: ["#13251c", "#1f3d2c", "#3f6b48", "#9fb87f"],
    light: { key: 0xfff0c0, keyI: 1.8, hemiSky: 0xbfe0a0, hemiGround: 0x2a3320, hemiI: 0.8, ambI: 0.32 },
    fog: 0x6f8a5a, fogD: 0.0105, ibl: 0.5, exposure: 1.02,
    light_sq: 0xd7cfa8, dark_sq: 0x4f6b3c, ring: 0x3a4a28, ringRough: 0.95,
    accent: 0xbfff8f,
  },
  desert: {
    name: "Desert Mesa",
    sky: ["#3a2b1c", "#8a6a3c", "#d9b06a", "#f0d8a0"],
    light: { key: 0xfff0c8, keyI: 2.3, hemiSky: 0xffe0a8, hemiGround: 0x6a5230, hemiI: 0.95, ambI: 0.4 },
    fog: 0xe8cf9a, fogD: 0.0072, ibl: 0.7, exposure: 1.08,
    light_sq: 0xe6d2a0, dark_sq: 0x9c7a48, ring: 0x7a5d34, ringRough: 1.0,
    accent: 0xffcf6a,
  },
  snow: {
    name: "Frozen Tundra",
    sky: ["#22324a", "#506d8e", "#9fc0d8", "#dfeaf2"],
    light: { key: 0xeaf2ff, keyI: 2.1, hemiSky: 0xcfe6ff, hemiGround: 0x6a7686, hemiI: 1.0, ambI: 0.46 },
    fog: 0xdfeaf2, fogD: 0.0095, ibl: 0.72, exposure: 1.06,
    light_sq: 0xeef4fa, dark_sq: 0x8fa6bc, ring: 0x7088a0, ringRough: 0.7,
    accent: 0x9fe6ff,
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
  if (kernel.sun) { kernel.sun.color = new THREE.Color(theme.light.key); kernel.sun.intensity = theme.light.keyI * 0.62; kernel.sun.position.set(W * 0.45, Hd * 1.1, -Hd * 0.35); }
  scene.add(new THREE.HemisphereLight(theme.light.hemiSky, theme.light.hemiGround, theme.light.hemiI * 0.6));
  scene.add(new THREE.AmbientLight(0xffffff, theme.light.ambI * 0.5));
  kernel.renderer.toneMappingExposure = theme.exposure * 0.88;
  if (kernel.enableBloom) kernel.enableBloom({ strength: 0.22, radius: 0.55, threshold: 0.9, ssao: true, ssaoRadius: 1.0 });

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
    const N = 26, ring0 = W * 0.75, ring1 = W * 2.4;
    let seed = 0xC0FFEE ^ (themeKey.charCodeAt(0) * 2654435761);
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < N; i++) {
      const ang = rnd() * Math.PI * 2, rad = ring0 + rnd() * (ring1 - ring0);
      const px = Math.cos(ang) * rad, pz = Math.sin(ang) * rad;
      let mesh;
      if (themeKey === "forest") {
        const g = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(T * 0.12, T * 0.16, T * 1.2, 6), new THREE.MeshStandardMaterial({ color: 0x4a3526, roughness: 0.95 }));
        trunk.position.y = T * 0.6; g.add(trunk);
        const foliage = new THREE.Mesh(new THREE.ConeGeometry(T * (0.7 + rnd() * 0.5), T * (1.8 + rnd() * 1.4), 7), new THREE.MeshStandardMaterial({ color: shade(0x2e4a24, rnd() * 0.2 - 0.1), roughness: 0.9 }));
        foliage.position.y = T * (1.7 + rnd() * 0.5); g.add(foliage);
        mesh = g;
      } else if (themeKey === "mountains" || themeKey === "snow") {
        const h = T * (2.5 + rnd() * 5);
        mesh = new THREE.Mesh(new THREE.ConeGeometry(T * (1.2 + rnd() * 1.5), h, 5),
          new THREE.MeshStandardMaterial({ color: themeKey === "snow" ? shade(0xb8c6d2, rnd() * 0.2) : shade(0x4a5260, rnd() * 0.3 - 0.1), roughness: 0.95, flatShading: true }));
        mesh.position.y = h / 2 - T * 0.2;
        if (themeKey === "snow" && mesh.material) mesh.material.color = new THREE.Color(shade(0xc8d6e2, rnd() * 0.15));
      } else { // desert dunes / mesas
        const h = T * (1.2 + rnd() * 2.2);
        mesh = new THREE.Mesh(new THREE.BoxGeometry(T * (1.5 + rnd() * 2), h, T * (1.5 + rnd() * 2)),
          new THREE.MeshStandardMaterial({ color: shade(0x9c7a48, rnd() * 0.25 - 0.1), roughness: 1.0, flatShading: true }));
        mesh.position.y = h / 2 - T * 0.2;
      }
      mesh.position.x = px; mesh.position.z = pz;
      mesh.traverse && mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
      scene.add(mesh);
    }
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
  // side tints — white army cool steel-blue, black army warm crimson
  const SIDE_TINT = { w: 0x9fb6e0, b: 0xe08a7a };
  const SIDE_RING = { w: 0x6fa0ff, b: 0xff6a5a };

  function resolveClip(char, name) { return (name && char.actions[name]) ? name : null; }

  // ── piece views ──────────────────────────────────────────────────────────────
  // pieceViews keyed by a stable piece id (we assign one per starting piece and
  // carry it through moves). value: { group, char, clips, ring, side, type, dead }
  const pieceViews = {};        // id -> view
  let nextPieceId = 1;
  const squareToId = {};        // "x,y" -> piece id currently on that square (mirror of sim board for views)

  async function makePieceView(side, type, x, y) {
    const id = nextPieceId++;
    const def = TYPE_TO_MODEL[type];
    const model = PIECE_MODELS[def.model];
    const g = new THREE.Group();
    const w = cell(x, y);
    g.position.set(w.x, 0, w.z);

    // base ring (team colour, doubles as selection highlight)
    const ringMat = new THREE.MeshStandardMaterial({ color: SIDE_RING[side], emissive: SIDE_RING[side], emissiveIntensity: 0.25, roughness: 0.5, metalness: 0.3 });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(T * 0.42, T * 0.42, 0.12, 28), ringMat);
    ring.position.y = FT + 0.13; g.add(ring);

    let char = null;
    try { char = await kernel.loadCharacter(CHAR_BASE + model.url); } catch (e) { char = null; }
    const clips = { idle: null, walk: null, run: null, die: null, attack: null, attack2: null, hurt: null };
    if (char) {
      for (const k in model.clips) clips[k] = resolveClip(char, model.clips[k]);
      if (!clips.idle) clips.idle = (char.animations[0] && char.animations[0].name) || null;
      const mdl = char.scene;
      g.add(mdl);
      mdl.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.frustumCulled = false; });
      const targetH = model.th * def.scale;
      mdl.scale.setScalar(targetH / model.h);
      mdl.position.y = FT + 0.18 + (model.hover ? model.hover : 0); // feet on the square (drones hover)
      // tint by side: lerp materials toward the team colour + faint emissive so
      // the two armies read clearly against any theme.
      const tint = new THREE.Color(SIDE_TINT[side]);
      mdl.traverse((o) => {
        if ((o.isMesh || o.isSkinnedMesh) && o.material) {
          o.material = o.material.clone();
          if (o.material.color) o.material.color.lerp(tint, side === "w" ? 0.42 : 0.5);
          o.material.emissive = tint.clone().multiplyScalar(0.16);
          o.material.envMapIntensity = 1.0;
        }
      });
      if (clips.idle) char.play(clips.idle, { fade: 0 });
    } else {
      // fallback: a coloured obelisk so the piece still exists if a GLB fails
      const body = new THREE.Mesh(new THREE.ConeGeometry(T * 0.26, T * 0.9, 6), new THREE.MeshStandardMaterial({ color: SIDE_TINT[side] }));
      body.position.y = FT + 0.6; g.add(body);
    }

    // a small floating crown/marker for the King so it's identifiable
    if (type === "K") {
      const crown = new THREE.Mesh(new THREE.TorusGeometry(T * 0.16, T * 0.04, 8, 16), new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xffb000, emissiveIntensity: 0.5, metalness: 0.8, roughness: 0.3 }));
      crown.position.set(0, model.th * def.scale + FT + 0.5, 0); crown.rotation.x = Math.PI / 2; g.add(crown);
      kernel.onUpdate((dt, t) => { crown.rotation.z = t * 0.8; });
    }

    scene.add(g);
    const view = { id, group: g, char, clips, ring, side, type, dead: false, x, y, model: def.model };
    pieceViews[id] = view;
    faceForward(view);
    return view;
  }

  // white pieces look toward +z (up the board at black); black looks toward -z.
  function faceForward(v) { if (v.char) v.char.scene.rotation.y = v.side === "w" ? 0 : Math.PI; }
  function faceToward(v, tx, ty) {
    if (!v.char) return;
    const a = Math.atan2(tx - v.x, ty - v.y); // +z is "up the board"; model faces +z at rot 0
    v.char.scene.rotation.y = a;
  }
  function anim(v, intent, opts) { if (v && v.char && v.clips[intent]) v.char.play(v.clips[intent], opts); }

  // ── game state ────────────────────────────────────────────────────────────────
  let sim = null;
  let selected = null;          // selected piece id (player turn)
  let legalForSel = [];         // detailed legal moves for the selected piece
  let busy = false;             // true while an animation/AI turn is playing
  let phase = "menu";           // menu | playing | ended
  const playerSide = (content.playerSide === "b") ? "b" : "w"; // human plays white by default
  const aiSide = playerSide === "w" ? "b" : "w";
  const aiDepth = content.aiDepth != null ? content.aiDepth : 2;
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
  function clearHighlights() {
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
  function showSelection(id) {
    clearHighlights();
    const v = pieceViews[id]; if (!v) return;
    highlightSquare(v.x, v.y, theme.accent, true);
    legalForSel = sim.legalMovesDetailed(H.sq(v.x, v.y));
    for (const m of legalForSel) {
      const tx = fileOf(m.to), ty = rankOf(m.to);
      // capture squares glow red, quiet moves glow theme-accent
      highlightSquare(tx, ty, (m.capture || m.enPassant) ? 0xff5a3c : 0x4fd06a, false);
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

      faceToward(v, toX, toY);
      anim(v, "walk", { fade: 0.12 });
      sfx("select", 0.3);

      if (defender) {
        // ── THE FIGHT ──────────────────────────────────────────────────────────
        // Attacker advances to JUST SHORT of the defender's square, plays an
        // attack clip; defender plays its death clip; then the defender is
        // removed and the attacker finishes onto the square.
        const dv = cell(toX, toY);
        // a staging point ~0.55 tile back from the target along the approach
        const ax = v.x, ay = v.y;
        const dirx = Math.sign(toX - ax), diry = Math.sign(toY - ay);
        const stageX = dv.x - dirx * T * 0.5, stageZ = dv.z - diry * T * 0.5;
        const walkDur = Math.max(0.7, Math.min(2.2, (Math.abs(toX - ax) + Math.abs(toY - ay)) * 0.42)); // SAIL/walk pace, not a zip
        kernel.tween({
          target: v.group.position, to: { x: stageX, z: stageZ }, duration: walkDur,
          onComplete: () => {
            // face the defender + attack
            faceToward(v, toX, toY);
            const atkClip = v.clips.attack ? "attack" : "idle";
            anim(v, atkClip, { once: true, fade: 0.08 });
            sfx("hit_heavy", 0.6);
            screenShake(7);
            // defender reacts then dies
            if (defender.clips.hurt) anim(defender, "hurt", { once: true, fade: 0.06 });
            // strike impact ~ partway through the attack clip
            setTimeout(() => {
              clashFx(cell(toX, toY));
              sfx("hit", 0.6);
              defender.dead = true;
              anim(defender, defender.clips.die ? "die" : "idle", { once: true, fade: 0.12 });
              floatText(cell(toX, toY), "CAPTURED", 0xff7a5a);
              // remove the captured view after its death plays
              const removeDelay = defender.clips.die ? 900 : 300;
              setTimeout(() => { fadeOutAndRemove(defender); }, removeDelay);
              // attacker steps onto the now-empty square + returns to idle
              setTimeout(() => {
                anim(v, "walk", { fade: 0.12, timeScale: 0.85 });
                kernel.tween({
                  target: v.group.position, to: { x: targetW.x, z: targetW.z }, duration: 0.5,
                  onComplete: () => { anim(v, "idle", { fade: 0.2 }); faceForward(v); finalize(); }
                });
              }, 360);
            }, 260);
          }
        });
      } else {
        // quiet move: walk to the square
        const walkDur = Math.max(0.7, Math.min(2.4, (Math.abs(toX - v.x) + Math.abs(toY - v.y)) * 0.42)); // proper walking pace
        kernel.tween({
          target: v.group.position, to: { x: targetW.x, z: targetW.z }, duration: walkDur,
          onComplete: () => { anim(v, "idle", { fade: 0.2 }); faceForward(v); finalize(); }
        });
      }

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
    // sink + fade then remove from scene + maps
    kernel.tween({ target: v.group.position, to: { y: v.group.position.y - 0.5 }, duration: 0.6 });
    v.group.traverse((o) => { if ((o.isMesh || o.isSkinnedMesh) && o.material) { o.material.transparent = true; kernel.tween({ target: o.material, to: { opacity: 0 }, duration: 0.6 }); } });
    setTimeout(() => {
      scene.remove(v.group);
      if (v.char) kernel.disposeMixer(v.char.mixer);
      delete pieceViews[v.id];
    }, 700);
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
  async function doMove(from, to, promo) {
    if (busy) return false;
    const result = sim.move(from, to, promo);
    if (!result.ok) return false;
    busy = true;
    deselect();
    moveLog.push((result.mover === "w" ? "" : "… ") + result.san);
    setHUD();
    await animateMove(result);
    // status banners
    if (result.checkmate) { onCheckmate(result); busy = false; return true; }
    if (result.stalemate || result.draw) { onDraw(result); busy = false; return true; }
    if (result.check) { banner("CHECK!", theme.accent, 900); sfx("overwatch", 0.5); }
    busy = false;
    setHUD();
    // hand off to the AI if it's now the AI's move
    if (!suppressAI && phase === "playing" && sim.turn === aiSide) { setTimeout(aiTurn, 420); }
    return true;
  }

  async function aiTurn() {
    if (busy || phase !== "playing" || sim.turn !== aiSide) return;
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
    const winner = result.mover; // the side that delivered mate
    const youWin = winner === playerSide;
    banner(youWin ? "CHECKMATE — YOU WIN" : "CHECKMATE — YOU LOSE", youWin ? 0x4fd06a : 0xff5a3c, 2600);
    sfx(youWin ? "victory" : "defeat", 0.8);
    setTimeout(() => { if (shell) shell.end(youWin, (youWin ? "Checkmate · " : "Defeated · ") + sim.fullmove + " moves · " + theme.name); }, 1700);
  }
  function onDraw(result) {
    phase = "ended"; clearHighlights();
    const why = result.stalemate ? "Stalemate" : result.fiftyMove ? "50-move draw" : result.insufficient ? "Insufficient material" : "Draw";
    banner("DRAW — " + why, theme.accent, 2400);
    sfx("confirm", 0.6);
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
    const lastMoves = moveLog.slice(-6).join("  ");
    const tcol = turnSide === playerSide ? theme.accent : 0xff8a6a;
    const tHex = "#" + tcol.toString(16).padStart(6, "0");
    kernel.hud(
      `<div style="position:absolute;top:14px;left:0;right:0;text-align:center;font-family:'Segoe UI',monospace">
        <div style="display:inline-block;background:rgba(8,14,24,0.72);border:1px solid ${tHex};border-radius:10px;padding:8px 18px">
          <span style="font-size:18px;font-weight:800;letter-spacing:1px;color:${tHex}">${note || toMove}</span>${checkTag}
          <div style="font-size:11px;opacity:0.8;margin-top:2px">You play ${youColor} · ${theme.name} · move ${sim.fullmove}</div>
        </div>
      </div>
      <div style="position:absolute;bottom:12px;left:0;right:0;text-align:center;font-family:monospace;font-size:12px;opacity:0.75;color:#dfeaff">${lastMoves}</div>
      <div style="position:absolute;bottom:32px;right:14px;font-family:monospace;font-size:11px;opacity:0.6;color:#aab4c8">Left-click select + move · Right-drag rotate · scroll zoom</div>`
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
  });

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
    try { chessMusic.start(); } catch (e) {} // gentle classical piano (PLAY click = the audio gesture)
    await buildGame();
    setHUD();
    sfx("confirm", 0.5);
    if (content.audio && content.audio.music && shell && shell._playMusic) { /* shell handles music */ }
    // if the human plays black, the AI (white) moves first
    if (sim.turn === aiSide) setTimeout(aiTurn, 600);
  }

  buildBoard();
  kernel.renderer.domElement.addEventListener("pointerdown", onPointerDown);

  if (window.FFG && window.FFG.Shell) {
    shell = new window.FFG.Shell({
      parent: kernel.parent,
      title: content.title || "Warboard Chess",
      tagline: content.tagline || "Command an army of living pieces.",
      music: null, // chess uses the procedural CLASSICAL loop (createClassicalMusic), not a file track
      menuImage: (content.assets && content.assets.menu_image) || null,
      howTo: [
        { h: "GOAL", p: "Checkmate the enemy king. Standard chess rules — but your pieces are living warriors who fight when they capture." },
        { h: "MOVE", p: "Click one of your pieces to select it; legal squares light up (green = move, red = capture). Click a lit square to move there." },
        { h: "BATTLE", p: "When you capture, your piece advances and strikes; the defender falls before it's removed from the board." },
        { h: "CAMERA", p: "<b>Right-drag</b> to orbit the board, scroll to zoom. The match is set in a different environment each time." },
      ],
      onPlay: () => { beginGame(); },
      onPause: () => { kernel.stop(); try { chessMusic.stop(); } catch (e) {} },
      onResume: () => { kernel.start(); try { chessMusic.start(); } catch (e) {} },
    });
    // optional autostart (for the smoke test / uploader)
    let autostart = false;
    try { const k = "ffg_autostart_" + (content.slug || "chess"); autostart = window.sessionStorage.getItem(k) === "1"; if (autostart) window.sessionStorage.removeItem(k); } catch (e) {}
    if (autostart) { shell.hide(); shell.phase = "playing"; if (shell._playMusic) shell._playMusic(); beginGame(); }
    else shell.start();
  } else {
    beginGame();
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
