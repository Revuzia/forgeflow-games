/**
 * FFG runtime — 3d/ffg_checkers3d.js  (ES module)
 * CHECKERS (American draughts) in clean 3D on the ffg_kernel_3d substrate. Turned
 * wooden discs on a warm board; men move diagonally forward, kings any direction,
 * captures are FORCED and multi-jumps chain, reaching the far rank crowns a king.
 * Single-player vs a minimax AI (4 skill levels). Calm, unhurried presentation.
 * Registers genre "checkers3d".
 */
import * as THREE from "three";
import { createClassicalMusic } from "./ffg_boardmusic.js";
const _V = new URL(import.meta.url).search;
const { register3d } = await import("./ffg_kernel_3d.js" + _V);

const T = 3.0;            // world units per square
const BOARD_N = 8;

function shade(hex, f) {
  let r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { r *= (1 + f); g *= (1 + f); b *= (1 + f); }
  const c = (v) => Math.max(0, Math.min(255, v | 0));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}
// vertical gradient sky (calm, warm) used as background + a soft IBL source
function makeSky(top, bot) {
  const cv = document.createElement("canvas"); cv.width = 8; cv.height = 256;
  const g = cv.getContext("2d").createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#" + top.toString(16).padStart(6, "0"));
  g.addColorStop(1, "#" + bot.toString(16).padStart(6, "0"));
  const ctx = cv.getContext("2d"); ctx.fillStyle = g; ctx.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

// ── the premium casino-table look (warm dark ambiance, gold trim, green felt) ──
const THEME = {
  sky_top: 0x241a12, sky_bot: 0x0e0905,          // warm dark casino ambiance — makes the lit table pop
  light_sq: 0xe4d8bc, dark_sq: 0x5a3a24,         // warm ivory vs rich walnut
  felt: 0x1a7d43, feltEdge: 0x115730,            // rich poker-green table surface
  frame: 0x3a2414, ring: 0x241610, ringRough: 0.5,   // dark wood frame + base
  fog: 0x120c07, fogD: 0.0055,
  key: 0xffe9c4, keyI: 2.4, hemiSky: 0x705e46, hemiGround: 0x241a12, hemiI: 0.5, ambI: 0.24, exposure: 1.06,
  rim: 0xbfd2ff, rimI: 0.55, env: 0.4,
  spot: 0xfff1d6, spotI: 6.0,                     // warm overhead spotlight pooling on the table
  gold: 0xd8b348,                                 // rich gold inlay trim
};
// piece colours — glossy warm red vs charcoal
const SIDE_COL = { r: 0xb23b2e, b: 0x26242c };
const SIDE_NAME = { r: "Red", b: "Black" };

register3d("checkers3d", async (kernel, content) => {
  const scene = kernel.scene;
  const music = createClassicalMusic(0.15);   // gentle procedural piano
  const maxAniso = (kernel.renderer.capabilities && kernel.renderer.capabilities.getMaxAnisotropy) ? kernel.renderer.capabilities.getMaxAnisotropy() : 1;

  const W = BOARD_N * T, Hd = BOARD_N * T;
  const cell = (x, y) => new THREE.Vector3((x + 0.5) * T - W / 2, 0, (y + 0.5) * T - Hd / 2);
  const FT = 0.16;

  // ── environment ──
  scene.background = makeSky(THEME.sky_top, THEME.sky_bot);
  if (kernel.setEnvironment) kernel.setEnvironment(scene.background, THEME.env);
  scene.fog = new THREE.FogExp2(THEME.fog, THEME.fogD);
  if (kernel.sun) { kernel.sun.color = new THREE.Color(THEME.key); kernel.sun.intensity = THEME.keyI; kernel.sun.position.set(W * 0.25, Hd * 1.4, Hd * 0.55); }
  scene.add(new THREE.HemisphereLight(THEME.hemiSky, THEME.hemiGround, THEME.hemiI));
  scene.add(new THREE.AmbientLight(0xffffff, THEME.ambI));
  { const rim = new THREE.DirectionalLight(THEME.rim, THEME.rimI); rim.position.set(-W * 0.42, Hd * 0.85, -Hd * 0.95); scene.add(rim); }  // cool back-rim: edge sheen + separation
  { const spot = new THREE.SpotLight(THEME.spot, THEME.spotI, 0, Math.PI * 0.33, 0.62, 1.1); spot.position.set(0, 27, 3); spot.target.position.set(0, 0, 0); scene.add(spot.target); scene.add(spot); }  // warm overhead spotlight pooling on the table — the casino look
  kernel.renderer.toneMappingExposure = THEME.exposure;
  // AO (contact shadows) grounds the discs on the board — the biggest not-flat-lit jump
  if (kernel.enableBloom) kernel.enableBloom({ ssao: true, ssaoRadius: 0.9, ssaoMin: 0.002, ssaoMax: 0.07, strength: 0.2, radius: 0.6, threshold: 0.86 });

  // ── procedural surface textures: felt weave + wood grain (tactile, not flat) ──
  function feltTex() {
    const s = 512, cv = document.createElement("canvas"); cv.width = cv.height = s; const ctx = cv.getContext("2d");
    ctx.fillStyle = "#" + THEME.felt.toString(16).padStart(6, "0"); ctx.fillRect(0, 0, s, s);
    const img = ctx.getImageData(0, 0, s, s), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 26; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    ctx.putImageData(img, 0, 0);
    ctx.globalAlpha = 0.06; ctx.strokeStyle = "#000";
    for (let x = 0; x < s; x += 3) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, s); ctx.stroke(); }
    ctx.globalAlpha = 0.045; ctx.strokeStyle = "#dfeee6";
    for (let y = 0; y < s; y += 3) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke(); }
    ctx.globalAlpha = 1;
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; return t;
  }
  function woodTex(base) {
    const s = 512, cv = document.createElement("canvas"); cv.width = cv.height = s; const ctx = cv.getContext("2d");
    ctx.fillStyle = "#" + base.toString(16).padStart(6, "0"); ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      const y = Math.random() * s, dark = Math.random() < 0.55;
      ctx.strokeStyle = dark ? "rgba(0,0,0,0.15)" : "rgba(255,228,196,0.07)"; ctx.lineWidth = 0.6 + Math.random() * 2.6;
      ctx.beginPath(); ctx.moveTo(0, y);
      for (let x = 0; x <= s; x += 14) ctx.lineTo(x, y + Math.sin(x * 0.018 + i) * 3.5 + (Math.random() - 0.5) * 2.4);
      ctx.stroke();
    }
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; return t;
  }

  // ── board + casino table ──
  const squareMeshes = {};
  (function buildBoard() {
    // warm wooden floor beneath — grounds the scene into a room receding into fog
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: woodTex(0x241811), roughness: 0.82, metalness: 0.0, envMapIntensity: 0.2 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, -1.5, 0); floor.receiveShadow = true; scene.add(floor);
    // rich green felt table the checkerboard sits on
    const felt = new THREE.Mesh(new THREE.BoxGeometry(W + T * 4, 1.46, Hd + T * 4),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: feltTex(), emissive: new THREE.Color(THEME.felt).multiplyScalar(0.05), roughness: 0.78, metalness: 0.0, envMapIntensity: 0.3 }));
    felt.position.set(0, -0.75, 0); felt.receiveShadow = true; scene.add(felt);
    // board base + frame — dark wood, grain-textured
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(W + T * 0.8, T * 0.5, Hd + T * 0.8),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: woodTex(shade(THEME.frame, -0.25)), roughness: THEME.ringRough, metalness: 0.12, envMapIntensity: 0.3 }));
    plinth.position.set(0, -T * 0.25 + FT, 0); plinth.receiveShadow = true; scene.add(plinth);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(W + T * 0.4, T * 0.12, Hd + T * 0.4),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: woodTex(THEME.frame), roughness: THEME.ringRough * 0.68, metalness: 0.2, envMapIntensity: 0.45 }));
    frame.position.set(0, FT - 0.22, 0); frame.receiveShadow = true; scene.add(frame);
    // gold inlaid border framing the board — premium casino trim that glints under the spotlight
    const goldMat = new THREE.MeshStandardMaterial({ color: THEME.gold, roughness: 0.26, metalness: 0.92, envMapIntensity: 1.1 });
    const gi = W * 0.5 + T * 0.62, gt = 0.16;
    for (const [gw, gd, gx, gz] of [[gi * 2 + gt, gt, 0, gi], [gi * 2 + gt, gt, 0, -gi], [gt, gi * 2 + gt, gi, 0], [gt, gi * 2 + gt, -gi, 0]]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(gw, 0.06, gd), goldMat); bar.position.set(gx, 0.06, gz); bar.castShadow = true; scene.add(bar);
    }
    // playing squares — clean warm ivory & rich walnut, lit by the scene (was self-glowing)
    const lc = new THREE.Color(THEME.light_sq), dc = new THREE.Color(THEME.dark_sq);
    const lightMat = new THREE.MeshStandardMaterial({ color: lc, emissive: lc.clone().multiplyScalar(0.10), roughness: 0.6, metalness: 0.02, envMapIntensity: 0.3 });
    const darkMat = new THREE.MeshStandardMaterial({ color: dc, emissive: dc.clone().multiplyScalar(0.10), roughness: 0.55, metalness: 0.03, envMapIntensity: 0.35 });
    const geo = new THREE.BoxGeometry(T * 0.98, T * 0.12, T * 0.98);
    for (let y = 0; y < BOARD_N; y++) for (let x = 0; x < BOARD_N; x++) {
      const isLight = (x + y) % 2 === 1;
      const m = new THREE.Mesh(geo, (isLight ? lightMat : darkMat).clone());
      const w = cell(x, y); m.position.set(w.x, FT + 0.06, w.z); m.receiveShadow = true;
      m.userData = { sqx: x, sqy: y, base: m.material.color.getHex(), emBase: m.material.emissiveIntensity };
      scene.add(m); squareMeshes[x + "," + y] = m;
    }
  })();

  // ── checkers SIM ────────────────────────────────────────────────────────────
  // bd[y][x] = null | { s:'r'|'b', k:bool }. red starts rows 0-2 (moves +y),
  // black rows 5-7 (moves -y). Pieces sit on DARK squares: (x+y)%2===0.
  const RED_DIRS = [[1, 1], [-1, 1]], BLK_DIRS = [[1, -1], [-1, -1]], KING_DIRS = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
  const onb = (x, y) => x >= 0 && x < 8 && y >= 0 && y < 8;
  const cloneBd = (bd) => bd.map((r) => r.map((c) => (c ? { s: c.s, k: c.k } : null)));
  const dirsFor = (p) => (p.k ? KING_DIRS : (p.s === "r" ? RED_DIRS : BLK_DIRS));
  const other = (s) => (s === "r" ? "b" : "r");
  function newBoard() {
    const bd = Array.from({ length: 8 }, () => Array(8).fill(null));
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      if ((x + y) % 2 !== 0) continue;          // dark squares only
      if (y <= 2) bd[y][x] = { s: "r", k: false };
      else if (y >= 5) bd[y][x] = { s: "b", k: false };
    }
    return bd;
  }
  function pieceCaptures(bd, x, y) {
    const p0 = bd[y][x]; if (!p0) return []; const out = [];
    (function rec(cx, cy, isK, board, path, caps) {
      let extended = false;
      const dirs = isK ? KING_DIRS : (p0.s === "r" ? RED_DIRS : BLK_DIRS);
      for (const [dx, dy] of dirs) {
        const mx = cx + dx, my = cy + dy, lx = cx + 2 * dx, ly = cy + 2 * dy;
        if (!onb(lx, ly)) continue;
        const mid = board[my][mx];
        if (mid && mid.s !== p0.s && !board[ly][lx]) {
          const nb = cloneBd(board); nb[ly][lx] = nb[cy][cx]; nb[cy][cx] = null; nb[my][mx] = null;
          const kinged = !isK && ((p0.s === "r" && ly === 7) || (p0.s === "b" && ly === 0));
          const nPath = path.concat([[lx, ly]]), nCaps = caps.concat([[mx, my]]);
          if (kinged) out.push({ path: nPath, caps: nCaps, king: true });
          else { extended = true; rec(lx, ly, isK, nb, nPath, nCaps); }
        }
      }
      if (!extended && caps.length > 0) out.push({ path, caps, king: false });
    })(x, y, p0.k, bd, [[x, y]], []);
    return out.filter((s) => s.caps.length > 0);
  }
  function pieceSimple(bd, x, y) {
    const p = bd[y][x]; if (!p) return []; const out = [];
    for (const [dx, dy] of dirsFor(p)) { const nx = x + dx, ny = y + dy;
      if (onb(nx, ny) && !bd[ny][nx]) { const kinged = !p.k && ((p.s === "r" && ny === 7) || (p.s === "b" && ny === 0)); out.push({ path: [[x, y], [nx, ny]], caps: [], king: kinged }); } }
    return out;
  }
  function allMoves(bd, side) {
    let caps = [], simples = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const p = bd[y][x]; if (!p || p.s !== side) continue; caps = caps.concat(pieceCaptures(bd, x, y)); simples = simples.concat(pieceSimple(bd, x, y)); }
    return caps.length ? caps : simples;   // captures are forced
  }
  function applyMove(bd, mv) {
    const from = mv.path[0], to = mv.path[mv.path.length - 1];
    const p = bd[from[1]][from[0]]; bd[from[1]][from[0]] = null;
    for (const [cx, cy] of mv.caps) bd[cy][cx] = null;
    if (mv.king) p.k = true; bd[to[1]][to[0]] = p; return p;
  }
  function evalBd(bd, side) {
    let s = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const p = bd[y][x]; if (!p) continue;
      let v = p.k ? 3.4 : 1; if (!p.k) v += (p.s === "r" ? y : 7 - y) * 0.06;
      if (x > 0 && x < 7) v += 0.05; const back = (p.s === "r" && y === 0) || (p.s === "b" && y === 7); if (back && !p.k) v += 0.12;
      s += (p.s === side ? v : -v); }
    return s;
  }
  function minimax(bd, side, depth, alpha, beta, root) {
    const moves = allMoves(bd, side);
    if (moves.length === 0) return side === root ? -1000 - depth : 1000 + depth;   // no moves = loss for side
    if (depth === 0) return evalBd(bd, root);
    let best = side === root ? -Infinity : Infinity;
    for (const mv of moves) {
      const nb = cloneBd(bd); applyMove(nb, mv);
      const v = minimax(nb, other(side), depth - 1, alpha, beta, root);
      if (side === root) { if (v > best) best = v; if (v > alpha) alpha = v; } else { if (v < best) best = v; if (v < beta) beta = v; }
      if (beta <= alpha) break;
    }
    return best;
  }
  function chooseAI(bd, side, depth) {
    const moves = allMoves(bd, side); if (!moves.length) return null;
    let best = null, bestv = -Infinity;
    for (const mv of moves) { const nb = cloneBd(bd); applyMove(nb, mv); let v = minimax(nb, other(side), depth - 1, -Infinity, Infinity, side); v += (kernel._testRand ? 0 : Math.random() * 0.03); if (v > bestv) { bestv = v; best = mv; } }
    return best;
  }

  // ── piece VIEWS ──────────────────────────────────────────────────────────────
  const DISC_MAT = { r: new THREE.MeshStandardMaterial({ color: SIDE_COL.r, roughness: 0.22, metalness: 0.03, envMapIntensity: 0.9 }),
                     b: new THREE.MeshStandardMaterial({ color: SIDE_COL.b, roughness: 0.22, metalness: 0.03, envMapIntensity: 0.85 }) };
  const CROWN_MAT = new THREE.MeshStandardMaterial({ color: 0xf3c964, roughness: 0.3, metalness: 0.75, emissive: 0x5a3d00, emissiveIntensity: 0.35 });
  const discGeo = new THREE.CylinderGeometry(T * 0.34, T * 0.36, T * 0.15, 40);
  const ridgeGeo = new THREE.TorusGeometry(T * 0.30, T * 0.028, 8, 40);
  function buildDisc(side, king) {
    const g = new THREE.Group(); const mat = DISC_MAT[side];
    const d = new THREE.Mesh(discGeo, mat); d.castShadow = true; d.receiveShadow = true; g.add(d);
    const ridge = new THREE.Mesh(ridgeGeo, mat); ridge.rotation.x = Math.PI / 2; ridge.position.y = T * 0.06; g.add(ridge);
    if (king) {
      const d2 = new THREE.Mesh(discGeo, mat); d2.castShadow = true; d2.position.y = T * 0.15; g.add(d2);
      const crown = new THREE.Mesh(new THREE.TorusGeometry(T * 0.16, T * 0.04, 10, 24), CROWN_MAT); crown.rotation.x = Math.PI / 2; crown.position.y = T * 0.24; g.add(crown);
    }
    return g;
  }
  const pieceViews = {};   // "x,y" -> { group, side, king }
  function spawnView(x, y, side, king) {
    const g = new THREE.Group(); const w = cell(x, y); g.position.set(w.x, 0, w.z);
    g.add(buildDisc(side, king)); g.children[0].position.y = FT + T * 0.14;
    scene.add(g); pieceViews[x + "," + y] = { group: g, side, king, x, y }; return pieceViews[x + "," + y];
  }
  function clearViews() { for (const k in pieceViews) { scene.remove(pieceViews[k].group); delete pieceViews[k]; } }
  function rebuildViews() { clearViews(); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const p = board[y][x]; if (p) spawnView(x, y, p.s, p.k); } }

  // ── highlights ──
  const _hints = [];
  function clearHints() { for (const h of _hints) { scene.remove(h); h.geometry.dispose(); h.material.dispose(); } _hints.length = 0;
    for (const k in squareMeshes) { const m = squareMeshes[k]; m.material.emissiveIntensity = m.userData.emBase; } }
  function hintSquare(x, y, isCap) {
    const col = isCap ? 0xff7a3c : 0x5fd08a; const w = cell(x, y);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(T * 0.30, T * 0.05, 10, 28), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = Math.PI / 2; ring.position.set(w.x, FT + 0.16, w.z); scene.add(ring); _hints.push(ring);
    const sq = squareMeshes[x + "," + y]; if (sq) sq.material.emissiveIntensity = 0.6;
  }
  function selectRing(x, y) { const w = cell(x, y); const r = new THREE.Mesh(new THREE.TorusGeometry(T * 0.38, T * 0.045, 10, 32), new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })); r.rotation.x = Math.PI / 2; r.position.set(w.x, FT + 0.18, w.z); scene.add(r); _hints.push(r); }

  // ── game state ──
  let board = newBoard();
  const playerSide = content.playerSide === "b" ? "b" : "r";
  const aiSide = other(playerSide);
  let turn = "r";               // red moves first (standard)
  let busy = false, phase = "menu", selected = null, selMoves = [];
  let aiDepth = content.aiDepth || 3;
  const SKILL_DEPTH = { gentle: 1, casual: 3, sharp: 5, expert: 7 };
  function setDifficulty(d) { aiDepth = SKILL_DEPTH[String(d || "casual").toLowerCase()] || 3; }
  function sfx(n, v) { const u = content.sfx && content.sfx[n]; if (u) kernel.playSound(u, v == null ? 0.5 : v); }

  // ── move animation (slide through the path, hop over captures) ──
  function animateMove(mv, done) {
    busy = true; clearHints();
    const from = mv.path[0]; const view = pieceViews[from[0] + "," + from[1]];
    // remove captured discs (sink) as we go
    const capSet = mv.caps.map((c) => c[0] + "," + c[1]);
    let step = 0;
    function nextStep() {
      if (step >= mv.path.length - 1) {
        // land: re-key the view, king if needed
        delete pieceViews[from[0] + "," + from[1]];
        const to = mv.path[mv.path.length - 1];
        const p = applyMove(board, mv);
        // rebuild the moved disc if it just became a king
        if (mv.king && view) { view.group.remove(view.group.children[0]); const nd = buildDisc(p.s, true); nd.position.y = FT + T * 0.14; view.group.add(nd); view.king = true; }
        if (view) { view.x = to[0]; view.y = to[1]; pieceViews[to[0] + "," + to[1]] = view; }
        busy = false; if (done) done();
        return;
      }
      const a = mv.path[step], b = mv.path[step + 1]; const wb = cell(b[0], b[1]);
      const isJump = Math.abs(b[0] - a[0]) === 2;
      const baseY = view.group.position.y, lift = isJump ? T * 0.5 : T * 0.18;
      kernel.tween({ target: view.group.position, to: { x: wb.x, z: wb.z }, duration: isJump ? 0.34 : 0.28, ease: (t) => t * t * (3 - 2 * t),
        onUpdate: (e) => { view.group.position.y = baseY + Math.sin(Math.min(1, e) * Math.PI) * lift; },
        onComplete: () => {
          view.group.position.y = baseY;
          if (isJump) { // remove the disc jumped between a and b
            const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, key = cx + "," + cy;
            if (capSet.indexOf(key) >= 0 && pieceViews[key]) { const cvw = pieceViews[key]; delete pieceViews[key];
              sfx("hit", 0.5);
              kernel.tween({ target: cvw.group.position, to: { y: cvw.group.position.y - T * 0.7 }, duration: 0.4 });
              kernel.tween({ target: cvw.group.scale, to: { x: 0.02, y: 0.02, z: 0.02 }, duration: 0.4, onComplete: () => scene.remove(cvw.group) });
            }
          } else sfx("click", 0.4);
          step++; nextStep();
        } });
    }
    nextStep();
  }

  // ── turn flow ──
  function statusOf() { // 'r-win' | 'b-win' | null
    const rm = allMoves(board, "r").length, bm = allMoves(board, "b").length;
    const rc = countSide("r"), bc = countSide("b");
    if (rc === 0 || rm === 0) return "b-win"; if (bc === 0 || bm === 0) return "r-win"; return null;
  }
  function countSide(s) { let n = 0; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (board[y][x] && board[y][x].s === s) n++; return n; }
  function afterMove() {
    const st = statusOf();
    if (st) { phase = "ended"; const win = st === (playerSide + "-win"); sfx(win ? "victory" : "defeat", 0.7); setTimeout(() => { if (shell) shell.end(win, (win ? "You win — " : "You lose — ") + countSide(playerSide) + " vs " + countSide(aiSide) + " pieces"); }, 1000); return; }
    turn = other(turn);
    if (turn === aiSide) setTimeout(aiTurn, 420);
  }
  function aiTurn() {
    if (phase !== "playing") return;
    const mv = chooseAI(board, aiSide, aiDepth);
    if (!mv) { afterMove(); return; }
    animateMove(mv, afterMove);
  }

  // ── input ──
  function deselect() { selected = null; selMoves = []; clearHints(); }
  function selectPiece(x, y) {
    const legal = allMoves(board, playerSide);
    const mine = legal.filter((m) => m.path[0][0] === x && m.path[0][1] === y);
    if (!mine.length) { sfx("click", 0.3); return; }
    deselect(); selected = [x, y]; selMoves = mine; selectRing(x, y);
    for (const m of mine) { const d = m.path[m.path.length - 1]; hintSquare(d[0], d[1], m.caps.length > 0); }
  }
  function onPointerDown(ev) {
    if (phase !== "playing" || busy || turn !== playerSide) return;
    if (ev.button !== 0) return;
    const hit = kernel.raycast(ev.clientX, ev.clientY, scene.children);
    if (!hit.length) return;
    // find the board square under the hit
    let sx = null, sy = null;
    for (const h of hit) { let o = h.object; while (o && !(o.userData && o.userData.sqx != null) && o.parent) o = o.parent;
      if (o && o.userData && o.userData.sqx != null) { sx = o.userData.sqx; sy = o.userData.sqy; break; }
      // fall back to world-point -> square
    }
    if (sx == null) { const p = hit[0].point; sx = Math.floor((p.x + W / 2) / T); sy = Math.floor((p.z + Hd / 2) / T); if (sx < 0 || sy < 0 || sx > 7 || sy > 7) return; }
    // clicked own piece -> select; clicked a highlighted destination -> move
    if (selected) {
      const mv = selMoves.find((m) => { const d = m.path[m.path.length - 1]; return d[0] === sx && d[1] === sy; });
      if (mv) { const s = selected; deselect(); sfx("confirm", 0.5); animateMove(mv, afterMove); return; }
    }
    if (board[sy] && board[sy][sx] && board[sy][sx].s === playerSide) selectPiece(sx, sy);
    else deselect();
  }
  kernel.renderer.domElement.addEventListener("pointerdown", onPointerDown);

  // ── camera (straight, square-on) ──
  const span = Math.max(W, Hd);
  kernel.camera.fov = 40; kernel.camera.updateProjectionMatrix();
  const startZ = playerSide === "r" ? -span * 0.72 : span * 0.72;
  kernel.camera.position.set(0, span * 1.15, startZ);
  const orbit = kernel.enableOrbit({ target: { x: 0, y: 0, z: 0 }, minDistance: T * 6, maxDistance: span * 2.2, minPolarAngle: 0.12, maxPolarAngle: Math.PI * 0.44, rotateButton: "right", autoRotate: true, autoRotateSpeed: 0.35, wasdPan: true, panSpeed: span * 0.5 });

  // ── F3 debug overlay ──
  (function debugOverlay() {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;left:10px;top:10px;z-index:9999;font:12px/1.55 ui-monospace,Menlo,Consolas,monospace;color:#8effc0;background:rgba(6,12,20,.74);border:1px solid rgba(120,220,180,.35);border-radius:8px;padding:7px 11px;pointer-events:none;white-space:pre;display:none";
    (kernel.parent || document.body).appendChild(el);
    let on = false, frames = 0, acc = 0, fps = 0, lo = 999;
    kernel.onUpdate((dt) => { if (!on) return; frames++; acc += dt; const inst = dt > 0 ? 1 / dt : 0; if (inst < lo) lo = inst;
      if (acc >= 0.5) { fps = Math.round(frames / acc); frames = 0; acc = 0; const _lo = Math.round(lo); lo = 999; const r = kernel.renderer, info = r && r.info;
        el.textContent = "FPS " + fps + "  (low " + _lo + ")\nDPR " + (r ? r.getPixelRatio().toFixed(2) : "?") + "\ndraw calls " + (info ? info.render.calls : "?") + "\ntriangles " + (info ? info.render.triangles.toLocaleString() : "?") + "\npieces " + Object.keys(pieceViews).length; } });
    window.addEventListener("keydown", (e) => { if (e.key === "F3" || e.code === "F3") { e.preventDefault(); on = !on; el.style.display = on ? "block" : "none"; if (on) el.textContent = "FPS …"; } });
    window.__CHECKERS_DEBUG__ = { toggle: () => { on = !on; el.style.display = on ? "block" : "none"; return on; }, fps: () => fps };
  })();

  // ── shell wiring ──
  let shell = null;
  function beginGame() {
    phase = "playing"; board = newBoard(); turn = "r"; deselect(); busy = false; rebuildViews();
    if (orbit) orbit.autoRotate = false;
    kernel.camera.position.set(0, span * 1.15, startZ); if (orbit) { orbit.target.set(0, 0, 0); orbit.update(); }
    try { music.start(); } catch (e) {}
    try { const _arm = () => { try { music.start(); } catch (e) {} window.removeEventListener("pointerdown", _arm); window.removeEventListener("keydown", _arm); }; window.addEventListener("pointerdown", _arm); window.addEventListener("keydown", _arm); } catch (e) {}
    if (turn === aiSide) setTimeout(aiTurn, 500);
  }
  if (window.FFG && window.FFG.Shell) {
    shell = new window.FFG.Shell({
      title: content.title || "Checkers",
      tagline: content.tagline || "",
      difficulties: ["Gentle", "Casual", "Sharp", "Expert"],
      defaultDifficulty: "Casual",
      howTo: [
        { h: "GOAL", p: "Capture all of the enemy discs, or leave them with no legal move. A quiet game of position and forced trades." },
        { h: "MOVE", p: "Left-click one of your discs, then a highlighted square. Men step diagonally forward one square." },
        { h: "JUMP", p: "Captures are FORCED — if you can jump, you must. Land beyond an enemy disc; if the same disc can jump again, it chains (multi-jump, shown orange)." },
        { h: "KING", p: "Reach the far row and your disc is crowned a KING — it can move and jump diagonally in any direction." },
      ],
      onPlay: (d) => { setDifficulty(d); beginGame(); },
      onPause: () => { kernel.stop(); try { music.stop(); } catch (e) {} },
      onResume: () => { kernel.start(); try { music.start(); } catch (e) {} },
    });
    // menu spin preview
    rebuildViews();
    shell.start();
  } else { rebuildViews(); beginGame(); }

  // ── test hooks (parity / verification) ──
  const controller = {
    __test: {
      start: () => { if (shell) { shell.hide && shell.hide(); } kernel._testRand = true; beginGame(); return true; },
      state: () => ({ phase, turn, busy, pieces: Object.keys(pieceViews).length, status: statusOf(), counts: { r: countSide("r"), b: countSide("b") } }),
      counts: () => ({ r: countSide("r"), b: countSide("b") }),
      moves: (x, y) => allMoves(board, board[y] && board[y][x] ? board[y][x].s : "r").filter((m) => m.path[0][0] === x && m.path[0][1] === y).map((m) => m.path[m.path.length - 1]),
      allMoves: (side) => allMoves(board, side || turn).length,
      // apply a move by from/to squares (auto-resolves the matching legal move incl. multi-jump), animated
      move: (fx, fy, tx, ty) => { const legal = allMoves(board, turn); const mv = legal.find((m) => m.path[0][0] === fx && m.path[0][1] === fy && m.path[m.path.length - 1][0] === tx && m.path[m.path.length - 1][1] === ty); if (!mv) return false; animateMove(mv, afterMove); return true; },
      aiMove: () => { const mv = chooseAI(board, turn, aiDepth); if (!mv) return false; animateMove(mv, afterMove); return true; },
      // fast pure-sim playout to a finished game (no views) — proves the ruleset terminates
      autoResolve: () => { let bd = newBoard(), side = "r", n = 0; while (n++ < 400) { const mv = chooseAI2(bd, side); if (!mv) break; applyMove(bd, mv); side = other(side); } const rc = bd.flat().filter((p) => p && p.s === "r").length, bc = bd.flat().filter((p) => p && p.s === "b").length; return { ended: rc === 0 || bc === 0 || n < 400 || allMoves(bd, side).length === 0, moves: n, r: rc, b: bc }; },
      setDifficulty,
    },
  };
  function chooseAI2(bd, side) { const ms = allMoves(bd, side); if (!ms.length) return null; return ms[(Math.random() * ms.length) | 0]; }
  return controller;
});
